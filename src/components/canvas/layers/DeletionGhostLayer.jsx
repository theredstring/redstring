import React, { memo } from 'react';
import useCanvasUIStore from '../../../store/canvasUIStore.js';

const removeGhost = (id) => useCanvasUIStore.getState().removeDeletionGhost(id);

/**
 * Shrink ghosts for just-deleted nodes (P2.07): plain <rect>s, safe for the
 * CSS transform animation, decoupled from the nodes they replace. Each removes
 * itself from canvasUIStore on animationend, which re-renders only this layer.
 * Rendered inside the canvas content group, above the group titles.
 */
function DeletionGhostLayer() {
  const ghosts = useCanvasUIStore(s => s.deletionGhosts);
  return ghosts.map(ghost => (
    <rect
      key={ghost.id}
      className="node-delete-ghost"
      x={ghost.x}
      y={ghost.y}
      width={ghost.width}
      height={ghost.height}
      rx={ghost.rx}
      ry={ghost.rx}
      fill={ghost.color}
      style={{ pointerEvents: 'none', animationDelay: `${ghost.delay}ms` }}
      onAnimationEnd={() => removeGhost(ghost.id)}
    />
  ));
}

export default memo(DeletionGhostLayer);
