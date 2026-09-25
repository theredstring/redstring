import React, { Profiler, memo, useCallback, useRef, useSyncExternalStore } from 'react';
import Header from '../../../Header.jsx';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { runCanvasCommand } from '../../../utils/canvas/canvasCommands.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import { getAppViewportSize } from '../../../utils/appViewport.js';
import { EXCLUSIVE_PANEL_MODE_THRESHOLD, NODE_DEFAULT_COLOR } from '../../../constants';
import {
  newUniverse,
  openUniverse,
  saveUniverse,
  openRecentUniverse,
  exportActiveUniverse,
} from '../../../services/universeFileActions.js';

/**
 * Header, wired to the stores instead of to NodeCanvas (P2.08).
 *
 * Takes one prop, `hidden` (the fullscreen landscape shell drops the header), so
 * a NodeCanvas render never re-renders it. Everything else comes from
 * graphStore, canvasUIStore, the canvas command registry or a plain module.
 */

// One tab per open graph that has a defining node. Deduped defensively: tabs
// are keyed by graph.id, so a repeated entry would produce duplicate keys. The
// store heals duplicates on load; this keeps transient states correct.
function selectHeaderGraphs(state) {
  const seen = new Set();
  const tabs = [];
  for (const graphId of state.openGraphIds) {
    if (seen.has(graphId)) continue;
    seen.add(graphId);
    const graph = state.graphs.get(graphId);
    const definingNodeId = graph?.definingNodeIds?.[0];
    const definingNode = definingNodeId ? state.nodePrototypes.get(definingNodeId) : null;
    if (!definingNode) continue;
    let color = NODE_DEFAULT_COLOR || '#800000';
    const c = definingNode.color;
    if (typeof c === 'string' && c) color = c;
    else if (c && typeof c === 'object') color = c.hex || (c.toString ? c.toString() : color);
    tabs.push({
      id: graph.id,
      name: graph.name || 'New Thing',
      color,
      isActive: graph.id === state.activeGraphId,
      definingNodeId,
    });
  }
  return tabs;
}

const sameHeaderGraphs = (a, b) => a.length === b.length && a.every((tab, i) => {
  const other = b[i];
  return tab.id === other.id && tab.name === other.name && tab.color === other.color
    && tab.isActive === other.isActive && tab.definingNodeId === other.definingNodeId;
});

// The tabs, as a value that only changes when a tab does. `graphs` is a new Map
// on every node move, so selecting straight from it would re-render the header
// on every drag frame.
function useHeaderGraphs() {
  const lastRef = useRef(null);
  return useGraphStore(useCallback((state) => {
    const next = selectHeaderGraphs(state);
    if (lastRef.current && sameHeaderGraphs(lastRef.current, next)) return lastRef.current;
    lastRef.current = next;
    return next;
  }, []));
}

const selectBookmarkActive = (state) => {
  const definingNodeId = state.graphs.get(state.activeGraphId)?.definingNodeIds?.[0];
  return definingNodeId ? state.savedNodeIds.has(definingNodeId) : false;
};

const subscribeResize = (onChange) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const getExclusivePanelMode = () => getAppViewportSize().width <= EXCLUSIVE_PANEL_MODE_THRESHOLD;

const subscribeFullscreen = (onChange) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};
const getIsFullscreen = () => Boolean(document.fullscreenElement);
const toggleFullscreen = async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.error('Fullscreen toggle failed:', error);
  }
};

const handleTitleChange = (newTitle) => {
  const { activeGraphId, updateGraph } = useGraphStore.getState();
  if (activeGraphId && newTitle && newTitle.trim()) {
    updateGraph(activeGraphId, draft => { draft.name = newTitle; });
  }
};
const handleBookmarkToggle = () => {
  const { activeGraphId, toggleSavedGraph } = useGraphStore.getState();
  if (activeGraphId) toggleSavedGraph(activeGraphId);
};

const ui = () => useCanvasUIStore.getState();
const graph = () => useGraphStore.getState();
const handleCreateNewThing = () => ui().setNewWebPrompt({ visible: true });
const handleOpenComponentSearch = () => ui().setHeaderSearchVisible(true);
const handleOpenAllThingsSearch = () => ui().setHeaderAllThingsSearchVisible(true);
const handleToggleTrackpadZoom = () => ui().setTrackpadZoomEnabled(prev => !prev);
const handleOpenForceSim = () => ui().setForceSimModalVisible(true);
// Interim: a command until the hover slice lands (P2.13).
const handleActionHoverChange = (button) => runCanvasCommand('actionHover', button);
const handleAutoLayout = () => runCanvasCommand('autoLayout');
const handleSnapToGrid = () => runCanvasCommand('snapToGrid');
const handleCondenseNodes = () => runCanvasCommand('condense');
const handleLoadFromExternalLink = () => window.dispatchEvent(new CustomEvent('redstring:open-external-link'));
const handleSetGridMode = (mode) => graph().setGridMode(mode);
const handleSetGridSize = (size) => graph().setGridSize(size);
const handleSetGridAppearance = (appearance) => graph().setGridAppearance(appearance);
const handleToggleDragZoom = () => graph().toggleDragZoomEnabled();
const handleSetDragZoomAmount = (amount) => graph().setDragZoomAmount(amount);
const exportAs = (formatId) => () => exportActiveUniverse(formatId);
const handleExportRdf = exportAs('nquads');
const handleExportTrig = exportAs('trig');
const handleExportRedstring = exportAs('redstring');
const handleExportJson = exportAs('json');
const handleExportTxt = exportAs('txt');
const handleExportTtl = exportAs('ttl');

function HeaderHost({ hidden = false }) {
  const headerGraphs = useHeaderGraphs();
  const bookmarkActive = useGraphStore(selectBookmarkActive);
  const isExclusivePanelMode = useSyncExternalStore(subscribeResize, getExclusivePanelMode);
  const isFullscreen = useSyncExternalStore(subscribeFullscreen, getIsFullscreen);

  const setActiveGraph = useGraphStore(s => s.setActiveGraph);
  const showConnectionNames = useGraphStore(s => s.showConnectionNames);
  const toggleShowConnectionNames = useGraphStore(s => s.toggleShowConnectionNames);
  const darkMode = useGraphStore(s => s.darkMode);
  const toggleDarkMode = useGraphStore(s => s.toggleDarkMode);
  const enableAutoRouting = useGraphStore(s => s.autoLayoutSettings?.enableAutoRouting);
  const routingStyle = useGraphStore(s => s.autoLayoutSettings?.routingStyle || 'straight');
  const manhattanBends = useGraphStore(s => s.autoLayoutSettings?.manhattanBends || 'auto');
  const toggleEnableAutoRouting = useGraphStore(s => s.toggleEnableAutoRouting);
  const setRoutingStyle = useGraphStore(s => s.setRoutingStyle);
  const setManhattanBends = useGraphStore(s => s.setManhattanBends);
  const gridMode = useGraphStore(s => s.gridSettings?.mode || 'off');
  const gridSize = useGraphStore(s => s.gridSettings?.size || 200);
  const gridAppearance = useGraphStore(s => s.gridSettings?.appearance || 'lattice');
  const dragZoomEnabled = useGraphStore(s => (s.dragZoomSettings ? s.dragZoomSettings.enabled : true));
  const dragZoomAmount = useGraphStore(s => (s.dragZoomSettings ? s.dragZoomSettings.zoomAmount : 0.45));

  const setIsHeaderEditing = useCanvasUIStore(s => s.setIsHeaderEditing);
  const trackpadZoomEnabled = useCanvasUIStore(s => s.trackpadZoomEnabled);
  const gamepadFocusedGraphId = useCanvasUIStore(s => s.gamepadHeaderFocusedGraphId);

  if (hidden) return null;

  return (
    <Profiler id="Header" onRender={onRenderProbe}>
      <Header
        onTitleChange={handleTitleChange}
        onEditingStateChange={setIsHeaderEditing}
        headerGraphs={headerGraphs}
        onSetActiveGraph={setActiveGraph}
        gamepadFocusedGraphId={gamepadFocusedGraphId}
        onCreateNewThing={handleCreateNewThing}
        onOpenComponentSearch={handleOpenComponentSearch}
        onOpenAllThingsSearch={handleOpenAllThingsSearch}
        onActionHoverChange={handleActionHoverChange}
        isExclusivePanelMode={isExclusivePanelMode}
        trackpadZoomEnabled={trackpadZoomEnabled}
        onToggleTrackpadZoom={handleToggleTrackpadZoom}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        bookmarkActive={bookmarkActive}
        onBookmarkToggle={handleBookmarkToggle}
        showConnectionNames={showConnectionNames}
        onToggleShowConnectionNames={toggleShowConnectionNames}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        enableAutoRouting={enableAutoRouting}
        routingStyle={routingStyle}
        manhattanBends={manhattanBends}
        onToggleEnableAutoRouting={toggleEnableAutoRouting}
        onSetRoutingStyle={setRoutingStyle}
        onSetManhattanBends={setManhattanBends}
        gridMode={gridMode}
        onSetGridMode={handleSetGridMode}
        gridSize={gridSize}
        onSetGridSize={handleSetGridSize}
        gridAppearance={gridAppearance}
        onSetGridAppearance={handleSetGridAppearance}
        dragZoomEnabled={dragZoomEnabled}
        dragZoomAmount={dragZoomAmount}
        onToggleDragZoom={handleToggleDragZoom}
        onSetDragZoomAmount={handleSetDragZoomAmount}
        onOpenForceSim={handleOpenForceSim}
        onAutoLayoutGraph={handleAutoLayout}
        onSnapToGrid={handleSnapToGrid}
        onCondenseNodes={handleCondenseNodes}
        onLoadFromExternalLink={handleLoadFromExternalLink}
        onNewUniverse={newUniverse}
        onOpenUniverse={openUniverse}
        onSaveUniverse={saveUniverse}
        onExportRdf={handleExportRdf}
        onExportTrig={handleExportTrig}
        onExportRedstring={handleExportRedstring}
        onExportJson={handleExportJson}
        onExportTxt={handleExportTxt}
        onExportTtl={handleExportTtl}
        onOpenRecentFile={openRecentUniverse}
      />
    </Profiler>
  );
}

export default memo(HeaderHost);
