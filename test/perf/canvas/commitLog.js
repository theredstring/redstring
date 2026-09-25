// What each commit under NodeCanvas was, for `npm run perf:canvas -- --explain`
// (refactor P0.04). Where selfRenders.js counts, this explains: for every
// commit in the measured window it records
//   - whether NodeCanvas ran, and whether that run rendered or bailed out
//   - which of NodeCanvas's state and store hooks changed, with a preview of
//     the old and new value. State hooks are named when the build tags them
//     (vite.explain.config.mjs puts each setter in globalThis.__stateNames);
//     store hooks show as `store#<hook index>`, recognisable by their value.
//   - which other components rendered (+Name for a mount), most frequent first
// It walks the whole NodeCanvas subtree on every commit, so its timings are
// meaningless: use it on the --explain build, never for the median table.
//
// Also keeps window.__nodeCanvasRenders the way selfRenders.js does, so the
// runner can use it in place of that script.

export function logCommits() {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
  const PERFORMED_WORK = 1;
  const PROFILER = 12;
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const counter = { ran: 0, rendered: 0, found: false, mountedAt: null };
  const log = { on: false, t0: 0, commits: [] };
  window.__nodeCanvasRenders = counter;
  window.__commitLog = log;

  const isNodeCanvas = (f) => !!f && f.return?.tag === PROFILER && f.return.memoizedProps?.id === 'NodeCanvas';
  const find = (root) => {
    const stack = [root.current];
    while (stack.length) {
      const f = stack.pop();
      if (isNodeCanvas(f)) return f;
      for (let c = f.child; c; c = c.sibling) stack.push(c);
    }
    return null;
  };
  const nameOf = (f) => {
    const t = f.type;
    return t?.displayName || t?.name || t?.render?.displayName || t?.render?.name
      || t?.type?.displayName || t?.type?.name || 'Anonymous';
  };
  const preview = (v) => {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'function') return 'fn';
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    if (typeof v !== 'object') return JSON.stringify(v).slice(0, 32);
    if (v instanceof Map) return `Map(${v.size})`;
    if (v instanceof Set) return `Set(${v.size})`;
    if (Array.isArray(v)) return `Array(${v.length})`;
    return `{${Object.keys(v).slice(0, 4).join(',')}}`;
  };
  // State (useState/useReducer) and store (useSyncExternalStore) hooks whose
  // value changed against the previous render.
  const changedHooks = (f) => {
    const out = [];
    let h = f.memoizedState;
    let a = f.alternate?.memoizedState;
    for (let i = 0; h; i++, h = h.next, a = a?.next) {
      if (!h.queue || !a) continue;
      const kind = h.queue.getSnapshot ? 'store' : h.queue.dispatch ? 'state' : null;
      if (!kind || Object.is(h.memoizedState, a.memoizedState)) continue;
      const name = kind === 'state' ? globalThis.__stateNames?.get(h.queue.dispatch) : null;
      out.push(`${name || `${kind}#${i}`} ${preview(a.memoizedState)}→${preview(h.memoizedState)}`);
    }
    return out;
  };
  // Components under `f` that rendered this commit. DevTools' rule: only descend
  // where the child list was rebuilt; a subtree that wasn't cloned didn't render.
  const renderedUnder = (f, out) => {
    for (let c = f.child; c; c = c.sibling) {
      if (c.alternate && c.child === c.alternate.child && !(c.flags & PERFORMED_WORK)) continue;
      if (COMPONENT_TAGS.has(c.tag) && (c.flags & PERFORMED_WORK)) out.push(c.alternate ? nameOf(c) : `+${nameOf(c)}`);
      renderedUnder(c, out);
    }
    return out;
  };

  let last = null;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject() { return 1; },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_rendererId, root) {
      const f = find(root);
      if (!f) { last = null; return; }
      counter.found = true;
      if (!f.alternate && f !== last) counter.mountedAt = performance.now();
      const ran = f !== last && (!f.alternate || f.memoizedState !== f.alternate.memoizedState);
      const rendered = ran && !!(f.flags & PERFORMED_WORK);
      if (ran) counter.ran += 1;
      if (rendered) counter.rendered += 1;
      if (log.on) {
        const entry = { t: Math.round(performance.now() - log.t0), ran, rendered, hooks: ran ? changedHooks(f) : [] };
        const counts = {};
        // The whole tree, not just under NodeCanvas: since P2 the shell's hosts
        // (Header, Panels, modals, …) render outside it.
        for (const k of renderedUnder(root.current, [])) counts[k] = (counts[k] || 0) + 1;
        entry.children = Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k, n]) => (n > 1 ? `${k}×${n}` : k));
        log.commits.push(entry);
      }
      last = f;
    },
  };
}

/** The commit log as text, one line per commit. `children` is cut to `maxChildren`. */
export function formatCommitLog(id, probe, commits, { maxChildren = 8 } = {}) {
  const ran = commits.filter((c) => c.ran).length;
  const rendered = commits.filter((c) => c.rendered).length;
  const lines = [`${id}: ${probe.commits} commits; NodeCanvas ran ${ran}, rendered ${rendered}`];
  for (const c of commits) {
    const what = c.rendered ? 'NodeCanvas' : c.ran ? 'NC bailout' : '          ';
    const kids = c.children.length
      ? `  | ${c.children.slice(0, maxChildren).join(', ')}${c.children.length > maxChildren ? ', …' : ''}`
      : '';
    lines.push(`${String(c.t).padStart(6)} ms  ${what}  ${c.hooks.join('; ')}${kids}`);
  }
  return `${lines.join('\n')}\n`;
}
