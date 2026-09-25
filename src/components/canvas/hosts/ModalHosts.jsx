import React, { Profiler, memo, useEffect } from 'react';
import AutoGraphModal from '../../AutoGraphModal';
import HelpModal from '../../HelpModal.jsx';
import SettingsModal from '../../SettingsModal.jsx';
import MergeThingsModal from '../../merge/MergeThingsModal.jsx';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { parseInputData, generateGraph } from '../../../services/autoGraphGenerator';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

/**
 * Help, Settings, Merge and Auto Graph, outside NodeCanvas (P2.06b).
 *
 * Their open flags live in canvasUIStore (P2.04); this host owns the window
 * events that open them and renders them after the canvas overlays. Each sits
 * above those overlays by z-index (CanvasModal 20100+, Auto Graph 20000), so
 * the order doesn't change what paints on top, except Auto Graph over the
 * debug HUD (also 20000) when both are open.
 */

const ui = () => useCanvasUIStore.getState();

// Window events that open a modal. Settings may carry a section in `detail`;
// the modal doesn't take one, as before.
const OPENERS = [
  ['openHelpModal', () => ui().setShowHelpModal(true)],
  ['openSettingsModal', () => ui().setShowSettingsModal(true)],
  // One listener and one mount: it used to be rendered from three panel views,
  // each with its own copy of the overlay and its own open state.
  ['openMergeModal', () => ui().setShowMergeThingsModal(true)],
  // From the Debug settings page.
  ['redstring:open-auto-graph-modal', () => ui().setAutoGraphModalVisible(true)],
];

const closeHelp = () => ui().setShowHelpModal(false);
const closeSettings = () => ui().setShowSettingsModal(false);
const closeMerge = () => ui().setShowMergeThingsModal(false);
const closeAutoGraph = () => ui().setAutoGraphModalVisible(false);

const generateAutoGraph = (inputData, inputFormat, options) => {
  try {
    const storeState = useGraphStore.getState();
    const parsedData = parseInputData(inputData, inputFormat);
    const targetGraphId = options.createNewGraph ? null : storeState.activeGraphId;
    const settings = storeState.autoLayoutSettings;
    const patchedOptions = {
      ...options,
      layoutOptions: {
        ...options.layoutOptions,
        layoutScale: settings?.layoutScale || 'balanced',
        layoutScaleMultiplier: settings?.layoutScaleMultiplier ?? 1,
        iterationPreset: settings?.layoutIterations || 'balanced',
      },
    };

    const results = generateGraph(
      parsedData,
      targetGraphId,
      storeState,
      storeState, // the actions (a state snapshot's actions never change)
      patchedOptions,
      () => useGraphStore.getState() // Function to get fresh state
    );

    closeAutoGraph();

    const message = `Generated ${results.instancesCreated.length} nodes and ${results.edgesCreated.length} edges.\n` +
      `Prototypes: ${results.prototypesCreated.length} new, ${results.prototypesReused.length} reused.` +
      (results.errors.length > 0 ? `\n\nWarnings: ${results.errors.length}` : '');
    alert(message);
    console.log('[AutoGraph] Generation results:', results);
  } catch (error) {
    console.error('[AutoGraph] Generation failed:', error);
    alert(`Failed to generate graph: ${error.message}`);
  }
};

function ModalHosts() {
  const showHelpModal = useCanvasUIStore(s => s.showHelpModal);
  const showSettingsModal = useCanvasUIStore(s => s.showSettingsModal);
  const showMergeThingsModal = useCanvasUIStore(s => s.showMergeThingsModal);
  const autoGraphModalVisible = useCanvasUIStore(s => s.autoGraphModalVisible);
  const activeGraphId = useGraphStore(s => s.activeGraphId);

  useEffect(() => {
    for (const [type, open] of OPENERS) window.addEventListener(type, open);
    return () => {
      for (const [type, open] of OPENERS) window.removeEventListener(type, open);
    };
  }, []);

  return (
    <Profiler id="ModalHosts" onRender={onRenderProbe}>
      <AutoGraphModal
        isOpen={autoGraphModalVisible}
        onClose={closeAutoGraph}
        onGenerate={generateAutoGraph}
        activeGraphId={activeGraphId}
      />
      <HelpModal isVisible={showHelpModal} onClose={closeHelp} />
      <SettingsModal isVisible={showSettingsModal} onClose={closeSettings} />
      <MergeThingsModal isVisible={showMergeThingsModal} onClose={closeMerge} />
    </Profiler>
  );
}

export default memo(ModalHosts);
