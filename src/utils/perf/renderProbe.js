/**
 * Render probe: `window.__renderProbe`. It counts React commits and their
 * durations from <Profiler onRender> callbacks, so a perf scenario can ask
 * "how many times did NodeCanvas commit, and how long did it take?"
 * (NodeCanvas refactor, card P0.01; scenarios live in
 * documentation/dev-ops/nodecanvas-refactor/METRICS.md).
 *
 *   <Profiler id="NodeCanvas" onRender={onRenderProbe}>…</Profiler>
 *
 *   // Playwright page.evaluate, or the DevTools console
 *   __renderProbe.enable()            // or load the page with ?probe=1
 *   __renderProbe.start('S1 drag-pan')
 *   …interact…
 *   __renderProbe.stop()              // → plain JSON, see stop() below
 *
 * Which builds it works in. React only calls onRender in development builds and
 * in the profiling build (`npm run build:profile`: Vite mode "profile", which
 * aliases react-dom to react-dom/profiling). A normal production build never
 * calls it, so the probe is not put on window there. A harness pointed at the
 * wrong build then fails loudly instead of reporting zero commits.
 * Development runs under StrictMode (F-28), so commit counts are right there
 * but durations are inflated. Take milliseconds from the profile build.
 *
 * Cost when off: onRender returns on its first check unless the probe is
 * enabled and a session is running.
 *
 * Profiler ids must be unique among mounted Profilers. Two Profilers that share
 * an id are merged in byId and each of their reports counts as a commit.
 */

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const round = (ms) => Math.round(ms * 1000) / 1000;

function newSession(label) {
  return {
    label,
    startedAt: now(),
    commits: 0,
    totalMs: 0,
    maxMs: 0,
    byId: new Map(),
    // Grouping onRender calls into React commits (see onRender).
    commitTime: null,
    idsInCommit: new Set(),
    commitMs: 0,
  };
}

/**
 * Create an independent probe. The app uses the singleton below; tests create
 * their own.
 */
export function createRenderProbe({ enabled = false } = {}) {
  let isOn = Boolean(enabled);
  let session = null;

  /**
   * React Profiler onRender sink. Signature per React 18:
   * (id, phase, actualDuration, baseDuration, startTime, commitTime).
   */
  function onRender(id, phase, actualDuration, _baseDuration, _startTime, commitTime) {
    if (!isOn || session === null) return;
    const s = session;

    // React calls onRender once for every Profiler that rendered in a commit,
    // synchronously and with the same commitTime. A different commitTime, or an
    // id already reported under this one (a synchronous follow-up commit inside
    // the timer's resolution), starts a new commit.
    if (commitTime !== s.commitTime || s.idsInCommit.has(id)) {
      s.commits += 1;
      s.commitTime = commitTime;
      s.idsInCommit.clear();
      s.commitMs = 0;
    }
    s.idsInCommit.add(id);

    // A commit's duration is the largest actualDuration reported in it. When
    // Profilers are nested (layers inside NodeCanvas), that is the outermost
    // one, which already includes the inner ones. Sibling Profilers that commit
    // together are under-counted here; read them from byId.
    if (actualDuration > s.commitMs) {
      s.totalMs += actualDuration - s.commitMs;
      s.commitMs = actualDuration;
      if (actualDuration > s.maxMs) s.maxMs = actualDuration;
    }

    let entry = s.byId.get(id);
    if (entry === undefined) {
      entry = { commits: 0, totalMs: 0, maxMs: 0, phases: { mount: 0, update: 0, 'nested-update': 0 } };
      s.byId.set(id, entry);
    }
    entry.commits += 1;
    entry.totalMs += actualDuration;
    if (actualDuration > entry.maxMs) entry.maxMs = actualDuration;
    entry.phases[phase] = (entry.phases[phase] || 0) + 1;
  }

  function assertEnabled(action) {
    if (!isOn) {
      throw new Error(
        `renderProbe.${action}(): the probe is off. Load the page with ?probe=1 ` +
        'or call window.__renderProbe.enable() first.'
      );
    }
  }

  return {
    onRender,

    /** Turn recording on. Returns true. */
    enable() {
      isOn = true;
      return true;
    },

    /** Turn recording off and discard any running session. Returns false. */
    disable() {
      isOn = false;
      session = null;
      return false;
    },

    isEnabled() {
      return isOn;
    },

    /**
     * Begin a session. A session already running is discarded. Throws when the
     * probe is off, so a scenario can't silently record nothing.
     */
    start(label = '') {
      assertEnabled('start');
      session = newSession(String(label));
    },

    /**
     * End the session and return its results as plain JSON, or null when no
     * session is running.
     *
     *   {
     *     label, commits, totalMs, maxMs,
     *     wallMs,   // time between start() and stop(), for commits per second
     *     byId: { [id]: { commits, totalMs, maxMs,
     *                     phases: { mount, update, 'nested-update' } } }
     *   }
     *
     * Top-level `commits` counts React commits in which any Profiler reported.
     */
    stop() {
      if (session === null) return null;
      const s = session;
      session = null;
      const byId = {};
      for (const [id, e] of s.byId) {
        byId[id] = { commits: e.commits, totalMs: round(e.totalMs), maxMs: round(e.maxMs), phases: { ...e.phases } };
      }
      return {
        label: s.label,
        commits: s.commits,
        totalMs: round(s.totalMs),
        maxMs: round(s.maxMs),
        wallMs: round(now() - s.startedAt),
        byId,
      };
    },

    /**
     * The running session's totals so far, without ending it; null when none
     * is running. Lets a scenario wait until commits stop before calling stop().
     */
    peek() {
      if (session === null) return null;
      return { commits: session.commits, totalMs: round(session.totalMs), maxMs: round(session.maxMs) };
    },

    /** Discard any running session and its data. The enabled flag is kept. */
    reset() {
      session = null;
    },
  };
}

// True in dev (and vitest) and in the profile build; false in every other
// production build. Vite replaces both values at build time.
const REACT_REPORTS_RENDERS = import.meta.env.DEV || import.meta.env.MODE === 'profile';

function requestedByUrl() {
  try {
    return new URLSearchParams(window.location.search).get('probe') === '1';
  } catch {
    return false;
  }
}

const hasWindow = typeof window !== 'undefined';

export const renderProbe = createRenderProbe({
  enabled: REACT_REPORTS_RENDERS && hasWindow && requestedByUrl(),
});

/** Stable onRender for <Profiler>. */
export const onRenderProbe = renderProbe.onRender;

if (REACT_REPORTS_RENDERS && hasWindow) {
  window.__renderProbe = renderProbe;
}
