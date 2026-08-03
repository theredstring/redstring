/**
 * Layout worker — runs the force solver off the main thread.
 *
 * The solver is brute-force (O(n²) node-node plus O(n·e) node-edge repulsion
 * per iteration), so on the main thread it blocks the canvas for hundreds of
 * milliseconds to tens of seconds depending on graph size. Everything it
 * touches is pure data — no DOM, no React, no Zustand — so it ports here
 * unchanged, and the canvas stays interactive while it runs.
 *
 * Protocol:
 *   in   { nodes, edges, algorithm, options }
 *   out  { type: 'progress', progress }   0..1, ~50 per run
 *        { type: 'done', updates }        [{ instanceId, x, y }]
 *        { type: 'error', message }
 *
 * Cancellation is terminate-from-the-caller (see layoutRunner.js); there is no
 * cancel message, because a synchronous solver loop can't observe one.
 */
import { applyLayout } from './graphLayoutService.js';

self.onmessage = (event) => {
  const { nodes, edges, algorithm, options } = event.data || {};

  try {
    // onProgress is attached here rather than passed in — functions don't
    // survive the structured clone that carries `options` across the boundary.
    const updates = applyLayout(nodes, edges, algorithm, {
      ...options,
      onProgress: (progress) => self.postMessage({ type: 'progress', progress })
    });

    self.postMessage({ type: 'done', updates });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
