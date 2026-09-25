/**
 * The connection being drawn and the self-loop preview, at edge level below the
 * nodes (moved verbatim from NodeCanvas). The endpoint is written imperatively.
 */
import { Profiler } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import { getNodeDimensions } from '../../../utils.js';
import { countSelfLoopsForNode, calculateSelfLoopPath } from '../../../utils/canvas/selfLoopUtils.js';

export default function ConnectionDrawOverlay({ ctx }) {
  const {
    drawingConnectionFrom, draggingNodeInfo, drawingConnectionLineRef, drawingConnectionEndRef,
    connectionWidth, selfLoopPreviewActive, nodes, baseDimsById, visibleEdges,
  } = ctx;

  return (
    <Profiler id="ConnectionDrawOverlay" onRender={onRenderProbe}>
      {/* Drawing connection line (same z-level as existing edges, below nodes).
        Hidden while dragging — a race can leak `drawingConnectionFrom` state
        into a drag, which would otherwise leave a frozen black stub behind. */}
      {drawingConnectionFrom && !draggingNodeInfo && (
        <line
          ref={drawingConnectionLineRef}
          x1={drawingConnectionFrom.startX}
          y1={drawingConnectionFrom.startY}
          /* Endpoint is ref-owned (see drawingConnectionEndRef) and re-asserted
             imperatively after every commit — rendered here only so a fresh
             mount paints in the right place. */
          x2={drawingConnectionEndRef.current.x}
          y2={drawingConnectionEndRef.current.y}
          stroke="black"
          strokeWidth={27 * connectionWidth}
        />
      )}
      {/* Self-loop preview. Gated on the state flag rather than on the live
        endpoint: the flag is what re-renders this at all, since endpoint
        movement no longer goes through React. */}
      {drawingConnectionFrom && !draggingNodeInfo && selfLoopPreviewActive && (() => {
        const srcNode = nodes.find(n => n.id === drawingConnectionFrom.sourceInstanceId);
        if (!srcNode) return null;
        const srcDims = baseDimsById.get(srcNode.id) || getNodeDimensions(srcNode, false, null);
        const sx = srcNode.x;
        const sy = srcNode.y;
        const existing = countSelfLoopsForNode(visibleEdges, srcNode.id);
        const loop = calculateSelfLoopPath(sx, sy, srcDims.currentWidth, srcDims.currentHeight, { pairIndex: existing, totalInPair: existing + 1 });
        return (
          <path
            d={loop.path}
            fill="none"
            stroke="black"
            strokeWidth={10 * connectionWidth}
            strokeDasharray="6 6"
            strokeLinecap="round"
            opacity="0.7"
            style={{ pointerEvents: 'none' }}
          />
        );
      })()}

    </Profiler>
  );
}
