/**
 * Canvas chrome over the graph (moved verbatim from NodeCanvas): the off-screen
 * edge glows, Back to Civilization, the desktop-app pill, the zoom bar and the
 * panel resizers.
 */
import { Profiler } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import EdgeGlowIndicator from '../../EdgeGlowIndicator.jsx';
import BackToCivilization from '../../../BackToCivilization.jsx';
import DownloadAppPill from '../../../DownloadAppPill.jsx';
import PanelResizers from '../PanelResizers.jsx';
import ZoomBar from './ZoomBar.jsx';
import useGraphStore from '../../../store/graphStore.js';

export default function CanvasChrome({ ctx }) {
  const {
    edgeGlowMode, hydratedNodes, baseDimsById, panOffset, zoomLevel, panOffsetRef, zoomLevelRef,
    glowUpdateRef, leftPanelExpanded, rightPanelExpanded, previewingNodeId, containerRef,
    shouldShowBackToCivilization, backToCivilizationDelayComplete, handleBackToCivilizationClick, canvasSize,
    viewportSize, enableClustering, clusterAnalysis, showStorageSetupModal, nodeControlPanelShouldShow,
    nodeControlPanelVisible, connectionControlPanelShouldShow, connectionControlPanelVisible,
    abstractionControlPanelShouldShow, abstractionControlPanelVisible, panelResizeControlRef, isViewReady,
  } = ctx;

  // Chrome that is placed against the web (the off-screen glows, the zoom bar)
  // waits for one: a universe loaded, a web open, and its view restored, which
  // is also when the canvas has its real size. Mounting earlier placed them
  // against a layout that was still settling (no universe, panels not yet
  // where they will be) and showed them there.
  const showingWeb = useGraphStore(state =>
    !!state.activeGraphId && state.isUniverseLoaded && !state.isUniverseLoading && state.hasUniverseFile);
  const webReady = showingWeb && !!isViewReady;

  // A bottom control panel centres on the same strip above the TypeList.
  const bottomPanelUp =
    nodeControlPanelShouldShow || nodeControlPanelVisible ||
    connectionControlPanelShouldShow || connectionControlPanelVisible ||
    abstractionControlPanelShouldShow || abstractionControlPanelVisible;

  return (
    <Profiler id="CanvasChrome" onRender={onRenderProbe}>
      {/* Edge glow indicators for off-screen nodes */}
      {edgeGlowMode !== 'off' && webReady && (
        <EdgeGlowIndicator
          nodes={hydratedNodes}
          baseDimensionsById={baseDimsById}
          panOffset={panOffset}
          zoomLevel={zoomLevel}
          panOffsetRef={panOffsetRef}
          zoomLevelRef={zoomLevelRef}
          glowUpdateRef={glowUpdateRef}
          leftPanelExpanded={leftPanelExpanded}
          rightPanelExpanded={rightPanelExpanded}
          previewingNodeId={previewingNodeId}
          containerRef={containerRef}
          showViewportDebug={false}
          showDirectionLines={false}
        />
      )}

      {/* Back to Civilization component - shown when no nodes are visible */}
      <BackToCivilization
        isVisible={shouldShowBackToCivilization && backToCivilizationDelayComplete}
        onClick={handleBackToCivilizationClick}
        panOffset={panOffset}
        zoomLevel={zoomLevel}
        containerRef={containerRef}
        canvasSize={canvasSize}
        viewportSize={viewportSize}
        clusteringEnabled={enableClustering}
        clusterInfo={clusterAnalysis.statistics}
      />

      {/* One-time desktop-app nudge (web only). Held back while first-run
          setup is up — nobody needs a download offer before they have a
          universe — and while a bottom control panel is showing, since both
          center on the same strip of canvas above the TypeList. The pill is
          in no hurry: it waits and pops once the way is clear. */}
      <DownloadAppPill
        suppressed={showStorageSetupModal || bottomPanelUp}
      />

      {/* Zoom bar (Settings › Display). At the bottom it steps aside while a
          bottom control panel holds that strip. */}
      <ZoomBar ctx={ctx} ready={webReady} bottomStripTaken={bottomPanelUp} />

      {/* Overlay panel resizers (outside panels) */}
      <PanelResizers controlRef={panelResizeControlRef} />

    </Profiler>
  );
}
