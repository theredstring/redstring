/**
 * The connection layer (P3.06a): every visible connection, interleaved by z-slot
 * with nested plain-group outlines and node-group shells. This was the edges
 * pass of NodeCanvas's JSX, moved verbatim. It subscribes to the hovered
 * connection itself, so a hover change re-renders this layer and not NodeCanvas.
 *
 * The whole pass still runs together on every render: routed labels dodge the
 * labels placed before them (placedLabelsRef), so their order matters until
 * placement is computed up front (P3.05).
 */
import React, { Profiler } from 'react';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { edgeZSlotFor } from '../../../services/groupLayout.js';
import { renderConnectionEdge } from '../renderConnectionEdge.jsx';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

/**
 * @param {object} p
 * @param {object} p.ctx  renderConnectionEdge's inputs, without hover
 * @param {Array} p.visibleEdges
 * @param {Map} p.edgeZSlots  groupStructure.edgeZSlots
 * @param {Map} p.nodeGroupShellsByDepth  groupElements.backgroundsByDepth
 * @param {Map} p.nestedRegularGroupsByDepth  groupElements.nestedRegularByDepth
 * @param {{ current: object }} p.edgePerfRef  the window.__edgePerf accumulator
 */
export default function EdgeLayer({ ctx, visibleEdges, edgeZSlots, nodeGroupShellsByDepth, nestedRegularGroupsByDepth, edgePerfRef }) {
  const hoveredEdgeInfo = useCanvasUIStore((s) => s.hoveredEdgeInfo);
  // --- Connection z-order -------------------------------------------------
  // A connection paints at the level of its DEEPER endpoint — see
  // buildEdgeZSlotIndex / edgeZSlotFor in groupLayout.js for the rule and
  // why keying the layer off "is either end an anchor" hid a node-group
  // wired to a node inside a sibling node-group.
  const shellDepths = Array.from(nodeGroupShellsByDepth.keys());
  const topEdgeSlot = (shellDepths.length ? Math.max(...shellDepths) : 0) + 1;
  const edgesBySlot = new Map();
  visibleEdges.forEach(edge => {
    const slot = edgeZSlotFor(edge, edgeZSlots, topEdgeSlot);
    let bucket = edgesBySlot.get(slot);
    if (!bucket) { bucket = []; edgesBySlot.set(slot, bucket); }
    bucket.push(edge);
  });
  // Ascending, three emissions per slot: nested plain-group outlines,
  // then that slot's edges, then the shells at that depth.
  //
  // A plain group at depth D is contained by node-groups of depth
  // <= D-1, whose shells have already emitted, so it clears them.
  // It goes BEFORE the edges rather than after so connections keep
  // painting over the dashed outline, exactly as they do for a
  // top-level plain group down in the bottom layer.
  const edgeZSlotOrder = Array.from(
    new Set([...edgesBySlot.keys(), ...shellDepths, ...nestedRegularGroupsByDepth.keys()])
  ).sort((a, b) => a - b);

  const edgeRenderCtx = { ...ctx, hoveredEdgeInfo };

  return (
    <Profiler id="EdgeLayer" onRender={onRenderProbe}>
      <>
        {/* No per-pass reset any more — see connectionOrbHitsRef.
            Each edge now owns its own entry and sets or deletes
            it, because a memoized edge does not run and could not
            refill a cleared map. Entries for edges that have gone
            out of the visible set are pruned in an effect. */}
        {/* Connections, nested plain-group outlines and node-group shells
            interleaved by z-slot (Groups Phase 2): at each depth, the plain
            groups that live at that depth, then that slot's connections,
            then the shells allowed to cover them. A shell occludes a
            connection unless that connection has an endpoint inside it.
            See edgeZSlotFor. */}
        {edgeZSlotOrder.map(slot => (
          <React.Fragment key={`edge-z-slot-${slot}`}>
            {nestedRegularGroupsByDepth.get(slot)}
            {(() => {
              const bucket = edgesBySlot.get(slot) || [];
              const perfOn = typeof window !== 'undefined' && window.__edgePerf;
              const t0 = perfOn ? performance.now() : 0;
              const painted = bucket.map(edge => renderConnectionEdge(edge, edgeRenderCtx));
              if (perfOn) {
                edgePerfRef.current.ms += performance.now() - t0;
                edgePerfRef.current.edges += bucket.length;
              }
              return painted;
            })()}
            {nodeGroupShellsByDepth.get(slot)}
          </React.Fragment>
        ))}
      </>
    </Profiler>
  );
}
