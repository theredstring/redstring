/**
 * The connection being drawn, the self-loop preview and the drop-target glow, at
 * edge level below the nodes. The endpoint is written imperatively.
 */
import { Profiler, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import { getNodeDimensions } from '../../../utils.js';
import { NODE_CORNER_RADIUS, NODE_DEFAULT_COLOR } from '../../../constants';
import { isValidColor } from '../../../ai/palettes.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import useGraphStore from '../../../store/graphStore.js';

// The drop-target halo is a stack of rounded rects, each offset outward from the
// node's outline with its corner radius grown faster than the offset, so the
// halo softens into rounder corners than the node's as it spreads. Overlap makes it densest at the
// node's edge; a light blur smooths the steps. (Blurring one filled rect
// instead squares the corners off.)
const NODE_BG_INSET = 6;
const GLOW_RINGS = [2, 4, 6, 8, 10, 12, 14, 16];
const GLOW_RING_OPACITY = 0.085;
const GLOW_CORNER_GROWTH = 2.5;
import { countSelfLoopsForNode, calculateSelfLoopPath } from '../../../utils/canvas/selfLoopUtils.js';

export default function ConnectionDrawOverlay({ ctx }) {
  const {
    drawingConnectionFrom, draggingNodeInfo, drawingConnectionLineRef, drawingConnectionEndRef,
    connectionWidth, selfLoopPreviewActive, nodes, baseDimsById, visibleEdges,
  } = ctx;

  const dropTargetId = useCanvasUIStore(s => s.connectionDropTargetId);
  const nodeScale = useGraphStore(s => s.textSettings?.nodeScale ?? 1);
  const isDrawing = !!drawingConnectionFrom && !draggingNodeInfo;
  useEffect(() => {
    if (!isDrawing) useCanvasUIStore.getState().setConnectionDropTargetId(null);
  }, [isDrawing]);

  // The node the release would attach to glows in its own color, drawn under
  // it so only the halo shows. On the source node it follows the dotted
  // self-loop preview, so the two always appear together.
  const sourceId = drawingConnectionFrom?.sourceInstanceId;
  const glowNodeId = !isDrawing ? null
    : selfLoopPreviewActive ? sourceId
    : dropTargetId !== sourceId ? dropTargetId : null;
  const glowNode = glowNodeId ? nodes.find(n => n.id === glowNodeId && !n.isGroupAnchor) : null;
  const glowDims = glowNode ? (baseDimsById.get(glowNode.id) || getNodeDimensions(glowNode, false, null)) : null;
  const glowColor = glowNode && isValidColor(glowNode.color) ? glowNode.color : NODE_DEFAULT_COLOR;
  // The node's visible background rect: inset from its box, with the corner
  // radius Node.jsx gives it.
  const glowRadius = Math.max(0, NODE_CORNER_RADIUS * nodeScale * (glowNode?.sizeMul ?? 1) - NODE_BG_INSET);

  return (
    <Profiler id="ConnectionDrawOverlay" onRender={onRenderProbe}>
      <defs>
        <filter id="connection-drop-target-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <AnimatePresence>
        {glowNode && (
          <motion.g
            key={glowNode.id}
            filter="url(#connection-drop-target-glow)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ pointerEvents: 'none' }}
          >
            {GLOW_RINGS.map(d => (
              <rect
                key={d}
                x={glowNode.x + NODE_BG_INSET - d}
                y={glowNode.y + NODE_BG_INSET - d}
                width={glowDims.currentWidth - 2 * NODE_BG_INSET + 2 * d}
                height={glowDims.currentHeight - 2 * NODE_BG_INSET + 2 * d}
                rx={glowRadius + d * GLOW_CORNER_GROWTH}
                fill={glowColor}
                opacity={GLOW_RING_OPACITY}
              />
            ))}
          </motion.g>
        )}
      </AnimatePresence>
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
