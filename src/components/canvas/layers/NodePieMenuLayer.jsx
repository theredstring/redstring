import React from 'react';
import PieMenu from '../../../PieMenu.jsx';
import useCanvasUIStore from '../../../store/canvasUIStore.js';

/**
 * The node pie menu, reading its target, buttons and dimensions from
 * canvasUIStore itself (P5.04a). In the carousel those are rebuilt on every
 * physics frame so the bubbles track the growing node; read here, that
 * re-renders the menu only, not NodeCanvas. Every other PieMenu prop comes from
 * NodeCanvas as before. P5.03 memoizes this with stable callbacks.
 */
export default function NodePieMenuLayer(props) {
  const data = useCanvasUIStore(s => s.currentPieMenuData);
  if (!data) return null;
  return <PieMenu node={data.node} buttons={data.buttons} nodeDimensions={data.nodeDimensions} {...props} />;
}
