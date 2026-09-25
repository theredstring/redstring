import React, { Profiler, memo, useMemo } from 'react';
import Panel from '../../../Panel.jsx';
import useGraphStore from '../../../store/graphStore.js';
import { runCanvasCommand } from '../../../utils/canvas/canvasCommands.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

/**
 * One side Panel, wired to the stores instead of to NodeCanvas (P2.09).
 *
 * Takes only `side`, so a NodeCanvas render never re-renders it. Every prop it
 * passes is a store value or a stable function, so Panel's plain memo holds.
 */

const toggleLeft = () => useGraphStore.getState().toggleLeftPanel();
const toggleRight = () => useGraphStore.getState().toggleRightPanel();
const startHurtleFromPanel = (...args) => runCanvasCommand('startHurtleFromPanel', ...args);

function PanelHost({ side }) {
  const activeGraphId = useGraphStore(s => s.activeGraphId);
  const graphName = useGraphStore(s => s.graphs.get(s.activeGraphId)?.name ?? 'Loading...');
  const graphDescription = useGraphStore(s => s.graphs.get(s.activeGraphId)?.description ?? '');
  const leftPanelExpanded = useGraphStore(s => s.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(s => s.rightPanelExpanded);
  const isLeft = side === 'left';
  // A snapshot taken once per mount, as NodeCanvas's `storeActions` was: its
  // action functions never change, and Panel reads only actions from it.
  const storeActions = useMemo(() => useGraphStore.getState(), []);

  return (
    <Profiler id={isLeft ? 'LeftPanel' : 'RightPanel'} onRender={onRenderProbe}>
      <Panel
        side={side}
        isExpanded={isLeft ? leftPanelExpanded : rightPanelExpanded}
        onToggleExpand={isLeft ? toggleLeft : toggleRight}
        activeGraphId={activeGraphId}
        storeActions={storeActions}
        graphName={graphName}
        graphDescription={graphDescription}
        onStartHurtleAnimationFromPanel={startHurtleFromPanel}
        leftPanelExpanded={leftPanelExpanded}
        rightPanelExpanded={rightPanelExpanded}
      />
    </Profiler>
  );
}

export default memo(PanelHost);
