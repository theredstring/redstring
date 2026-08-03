/**
 * Worker lifecycle for auto-layout.
 *
 * Owns a single layout worker and guarantees at most one run at a time — a new
 * run supersedes the one in flight. Falls back to running the solver inline if
 * workers are unavailable (SSR, tests, locked-down embeddings), so callers
 * never have to branch on it.
 */
import { applyLayout } from './graphLayoutService.js';

let worker = null;
/** Monotonic id so late messages from a superseded run are ignored. */
let runId = 0;
let activeRun = null;

const createWorker = () => {
  try {
    return new Worker(new URL('./layout.worker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    console.warn('[layoutRunner] Worker unavailable, falling back to inline layout:', error);
    return null;
  }
};

/** Drop the worker entirely — the only way to stop a synchronous solver loop. */
const destroyWorker = () => {
  if (worker) {
    worker.terminate();
    worker = null;
  }
};

/**
 * Is a layout currently running?
 */
export const isLayoutRunning = () => activeRun !== null;

/**
 * Abort the in-flight layout, if any. The pending onDone never fires.
 */
export function cancelLayout() {
  if (!activeRun) return;
  activeRun = null;
  runId += 1;
  // Terminate rather than reuse: the worker is stuck inside the solver loop and
  // won't read another message until it finishes. A fresh one starts on demand.
  destroyWorker();
}

/**
 * Run a layout off the main thread.
 *
 * @returns {() => void} cancel handle for this specific run
 */
export function runLayout(nodes, edges, algorithm, options, { onProgress, onDone, onError } = {}) {
  cancelLayout();

  const id = ++runId;
  activeRun = id;

  const settle = (fn, arg) => {
    if (activeRun !== id) return; // superseded or cancelled
    activeRun = null;
    fn?.(arg);
  };

  if (!worker) worker = createWorker();

  if (!worker) {
    // No worker: run inline. This blocks, but a missing worker shouldn't mean
    // a missing feature — and the iteration budget bounds how long it blocks.
    try {
      settle(onDone, applyLayout(nodes, edges, algorithm, options));
    } catch (error) {
      settle(onError, error?.message || String(error));
    }
    return () => {};
  }

  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === 'progress') {
      if (activeRun === id) onProgress?.(message.progress);
      return;
    }
    if (message.type === 'done') settle(onDone, message.updates);
    else if (message.type === 'error') settle(onError, message.message);
  };

  worker.onerror = (event) => {
    // A worker-level failure poisons the instance — replace it next run.
    destroyWorker();
    settle(onError, event?.message || 'Layout worker failed');
  };

  worker.postMessage({ nodes, edges, algorithm, options });

  return () => {
    if (activeRun === id) cancelLayout();
  };
}
