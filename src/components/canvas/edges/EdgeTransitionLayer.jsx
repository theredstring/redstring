/**
 * Mounts the connection create/delete animations (edges/edgeTransitions.js) and
 * owns the group they draw into. The group renders no React children, so React
 * never touches what is put in it. Rendered last in EdgeLayer, beside the
 * connections it looks up.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import useGraphStore from '../../../store/graphStore.js';
import {
  pendingHandoffs, expireHandoffs, handoffEdge, retractEdge, findEdgeWrapper,
  prefersReducedMotion, MAX_RETRACTS,
} from './edgeTransitions.js';

export default function EdgeTransitionLayer() {
  const hostRef = useRef(null);

  // Handoffs: runs after every EdgeLayer commit, before paint. Free when idle.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || pendingHandoffs.size === 0) return;
    for (const [edgeId, handoff] of pendingHandoffs) {
      const wrapper = findEdgeWrapper(host, edgeId);
      if (!wrapper) continue;
      pendingHandoffs.delete(edgeId);
      if (!prefersReducedMotion()) handoffEdge(host, wrapper, handoff);
    }
    expireHandoffs(performance.now());
  });

  // Retracts: catch deletions while the connection is still in the DOM.
  useEffect(() => useGraphStore.subscribe((state, prev) => {
    if (state.edges === prev.edges || state.edges.size >= prev.edges.size) return;
    if (state.activeGraphId !== prev.activeGraphId) return;
    const host = hostRef.current;
    if (!host || prefersReducedMotion()) return;
    const removed = [];
    for (const id of prev.edges.keys()) {
      if (state.edges.has(id)) continue;
      removed.push(id);
      if (removed.length > MAX_RETRACTS) return;
    }
    for (const id of removed) {
      pendingHandoffs.delete(id);
      const wrapper = findEdgeWrapper(host, id);
      if (wrapper) retractEdge(host, wrapper);
    }
  }), []);

  return <g ref={hostRef} data-edge-transitions style={{ pointerEvents: 'none' }} />;
}
