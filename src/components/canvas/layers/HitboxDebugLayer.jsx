/**
 * Debug view: every node's hitbox (moved verbatim from NodeCanvas).
 */
import { Profiler } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import { getNodeHitbox } from '../../../utils/canvas/nodeHitbox.js';

export default function HitboxDebugLayer({ ctx }) {
  const {
    showNodeHitboxes, hydratedNodes, baseDimsById, selectedInstanceIds,
  } = ctx;

  return (
    <Profiler id="HitboxDebugLayer" onRender={onRenderProbe}>
      {/* Debug: Node Hitbox Visualization */}
      {showNodeHitboxes && hydratedNodes.map(node => {
        const dims = baseDimsById.get(node.id);
        if (!dims) return null;

        const isSelected = selectedInstanceIds.has(node.id);
        const hitbox = getNodeHitbox(node, dims, isSelected);

        return (
          <rect
            key={`hitbox-${node.id}`}
            x={hitbox.minX}
            y={hitbox.minY}
            width={hitbox.maxX - hitbox.minX}
            height={hitbox.maxY - hitbox.minY}
            fill="cyan"
            fillOpacity={0.15}
            stroke="cyan"
            strokeWidth={2}
            strokeDasharray="4 4"
            pointerEvents="none"
            style={{ mixBlendMode: 'multiply' }}
          />
        );
      })}

    </Profiler>
  );
}
