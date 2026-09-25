import React, { memo } from 'react';
import HoverVisionAid from '../../HoverVisionAid.jsx';
import useCanvasUIStore from '../../../store/canvasUIStore.js';

/**
 * The hover vision aid, subscribed to canvasUIStore itself (P2.13): the hovered
 * node, hovered connection and hovered button. NodeCanvas no longer holds that
 * state, so hovering a button renders only this.
 */
function HoverVisionAidLayer({ headerHeight, zoomLevel }) {
  const hoveredNode = useCanvasUIStore(s => s.hoveredNodeForVision);
  const hoveredConnection = useCanvasUIStore(s => s.hoveredConnectionForVision);
  const activePieMenuItem = useCanvasUIStore(s => s.activePieMenuItemForVision);
  return (
    <HoverVisionAid
      headerHeight={headerHeight}
      hoveredNode={hoveredNode}
      hoveredConnection={hoveredConnection}
      activePieMenuItem={activePieMenuItem}
      zoomLevel={zoomLevel}
    />
  );
}

export default memo(HoverVisionAidLayer);
