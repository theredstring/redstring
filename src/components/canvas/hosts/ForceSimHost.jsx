import React, { Profiler, memo, useMemo } from 'react';
import ForceSimulationModal from '../../ForceSimulationModal';
import LayoutProgressIndicator from '../../LayoutProgressIndicator.jsx';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { runCanvasCommand } from '../../../utils/canvas/canvasCommands.js';
import { navigateAfterLayout } from '../../../services/canvasNavigationService.js';
import { resolveEdgeLabelFontSize } from '../../../services/layoutGeometry.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

/**
 * The force-simulation tuner and the auto-layout progress indicator, outside
 * NodeCanvas (P2.06f). The tuner reads the canvas's live nodes, edges and drag
 * state only while it runs, so those are canvas commands; everything else is
 * store state. Progress lives in canvasUIStore, written by useGraphLayout.
 */

const EMPTY_SET = new Set();
const getNodes = () => runCanvasCommand('layoutNodes') || [];
const getEdges = () => runCanvasCommand('layoutEdges') || [];
const getDraggedNodeIds = () => runCanvasCommand('draggedNodeIds') || EMPTY_SET;
const getGroups = () => {
  const { activeGraphId, graphs } = useGraphStore.getState();
  const graphData = activeGraphId ? graphs.get(activeGraphId) : null;
  return graphData?.groups ? Array.from(graphData.groups.values()) : [];
};
const resetConnectionLabelCache = () => runCanvasCommand('resetConnectionLabelCache');
const cancelAutoLayout = () => runCanvasCommand('cancelAutoLayout');
const closeForceSim = () => useCanvasUIStore.getState().setForceSimModalVisible(false);
const onSimulationComplete = () => {
  navigateAfterLayout(useGraphStore.getState().activeGraphId, getNodes().length);
};

const DEFAULT_FORCE_TUNER_SETTINGS = { layoutScale: 'balanced', layoutScaleMultiplier: 1, layoutIterations: 'balanced' };

function ForceSimHost() {
  const forceSimModalVisible = useCanvasUIStore(s => s.forceSimModalVisible);
  const layoutProgress = useCanvasUIStore(s => s.layoutProgress);
  const activeGraphId = useGraphStore(s => s.activeGraphId);
  const textSettings = useGraphStore(s => s.textSettings);
  const connectionLabelSize = useGraphStore(s => s.connectionLabelSize ?? 1.0);
  const forceTunerSettings = useGraphStore(s => s.forceTunerSettings || DEFAULT_FORCE_TUNER_SETTINGS);
  // A snapshot taken once per mount, as NodeCanvas's `storeActions` was: its
  // action functions never change.
  const storeActions = useMemo(() => useGraphStore.getState(), []);

  return (
    <Profiler id="ForceSimHost" onRender={onRenderProbe}>
      <ForceSimulationModal
        isOpen={forceSimModalVisible}
        onClose={closeForceSim}
        onSimulationComplete={onSimulationComplete}
        // Safety ceiling only — the sim stops itself on alpha convergence
        // (usually ~1-1.5s with substepped auto-layout speed)
        autoLayoutDuration={6000}
        // Resolved label font so labeled edges reserve real rendered width
        connectionFontSize={resolveEdgeLabelFontSize(textSettings, connectionLabelSize)}
        graphId={activeGraphId}
        storeActions={storeActions}
        layoutScalePreset={forceTunerSettings.layoutScale || 'balanced'}
        layoutScaleMultiplier={forceTunerSettings.layoutScaleMultiplier ?? 1}
        onLayoutScalePresetChange={storeActions.setForceTunerScalePreset}
        onLayoutScaleMultiplierChange={storeActions.setForceTunerScaleMultiplier}
        layoutIterationPreset={forceTunerSettings.layoutIterations || 'balanced'}
        onLayoutIterationPresetChange={storeActions.setForceTunerIterationPreset}
        onCopyToAutoLayout={storeActions.copyForceTunerSettingsToAutoLayout}
        getNodes={getNodes}
        getEdges={getEdges}
        getGroups={getGroups}
        getDraggedNodeIds={getDraggedNodeIds}
        onNodePositionsUpdated={resetConnectionLabelCache}
      />
      {/* Auto-layout progress. Non-modal — the solve runs in a worker, so the
          canvas stays interactive while this counts up. */}
      <LayoutProgressIndicator state={layoutProgress} onCancel={cancelAutoLayout} />
    </Profiler>
  );
}

export default memo(ForceSimHost);
