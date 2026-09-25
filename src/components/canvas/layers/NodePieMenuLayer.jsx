import { Profiler, memo } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import PieMenu from '../../../PieMenu.jsx';
import useCanvasUIStore from '../../../store/canvasUIStore.js';

/**
 * The node pie menu, reading its target, buttons and dimensions from
 * canvasUIStore itself (P5.04a). In the carousel those are rebuilt on every
 * physics frame so the bubbles track the growing node; read here, that
 * re-renders the menu only, not NodeCanvas. Every other PieMenu prop comes from
 * NodeCanvas. Memoized (P5.03): every prop is a primitive, a store setter, a
 * stable callback or a value that only changes with the menu, so an unrelated
 * NodeCanvas render skips the menu.
 */
function NodePieMenuLayer(props) {
  const data = useCanvasUIStore(s => s.currentPieMenuData);
  if (!data) return null;
  return (
    <Profiler id="NodePieMenu" onRender={onRenderProbe}>
      <PieMenu node={data.node} buttons={data.buttons} nodeDimensions={data.nodeDimensions} {...props} />
    </Profiler>
  );
}

export default memo(NodePieMenuLayer);
