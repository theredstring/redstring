import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Merge, Plus, Search } from 'lucide-react';
import GraphListItem from '../../../GraphListItem.jsx';
import { showContextMenu } from '../../GlobalContextMenu.jsx';
import { getOpenWebContextMenuOptions } from '../../openWebContextMenu.jsx';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import { useTheme } from '../../../hooks/useTheme.js';
import useGraphStore from '../../../store/graphStore.js';
import { NODE_DEFAULT_COLOR } from '../../../constants';
import { projectGraphView, viewEdges } from '../../../core/openDefinitions.js';
import { DROP_AT_END, describeDropGhost, useOpenWebsDrop } from './useOpenWebsDrop.js';
import '../../../BackToCivilization.css';

// Each open web with its nodes and edges, for the list and its cards.
// Subscribed here rather than in Panel (P2.09): the cards need positions,
// so this follows every node move, but only while the Open Webs tab is open.
// Each web is read as viewed, like the canvas: a Thing opened in place shows its
// definition's nodes inside its box, not a single node.
function useOpenGraphsForList() {
  const openGraphIds = useGraphStore(state => state.openGraphIds);
  const graphsMap = useGraphStore(state => state.graphs);
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgesMap = useGraphStore(state => state.edges);
  // id -> the inputs and entry it was last built from. projectGraphView and
  // viewEdges hand back the same objects for a web that hasn't changed, so an
  // unchanged web keeps its entry and its memoized row skips the render: a
  // node dragged on the canvas redraws its own web's card, not every card.
  const lastRef = useRef(new Map());
  return useMemo(() => {
    const state = { graphs: graphsMap, nodePrototypes: nodePrototypesMap, edges: edgesMap };
    const last = lastRef.current;
    const next = new Map();
    // Dedupe: list entries are keyed by graph id, so a repeated entry would
    // produce two children with the same React key.
    const list = [...new Set(openGraphIds)].map(id => {
      const graphData = projectGraphView(state, id);
      if (!graphData) return null;
      const edgesInView = viewEdges(state, id);
      const prev = last.get(id);
      if (prev && prev.graphData === graphData && prev.edgesInView === edgesInView && prev.nodePrototypes === nodePrototypesMap) {
        next.set(id, prev);
        return prev.entry;
      }

      // Derive color from the defining node
      const definingNodeId = graphData.definingNodeIds?.[0];
      const definingNode = definingNodeId ? nodePrototypesMap.get(definingNodeId) : null;
      const graphColor = definingNode?.color || graphData.color || NODE_DEFAULT_COLOR;

      const instances = graphData.instances ? Array.from(graphData.instances.values()) : [];
      const edgeIds = graphData.edgeIds || [];

      const nodes = instances.map(instance => {
        const prototype = nodePrototypesMap.get(instance.prototypeId);
        return {
          ...prototype,
          ...instance,
          // Always use prototype name, with fallback
          name: prototype?.name || 'Unnamed'
        };
      }).filter(Boolean);

      const edges = edgeIds.map(edgeId => edgesInView.get(edgeId)).filter(Boolean);
      const entry = { ...graphData, color: graphColor, nodes, edges };
      next.set(id, { graphData, edgesInView, nodePrototypes: nodePrototypesMap, entry });
      return entry;
    }).filter(Boolean);
    lastRef.current = next;
    return list;
  }, [openGraphIds, graphsMap, nodePrototypesMap, edgesMap]);
}

// How far outside the list's view a card still draws its web, so a scroll
// finds it already drawn.
const NEAR_VIEW_MARGIN_PX = 400;

// How much of a card has to show before it counts as in view.
const IN_VIEW_MIN_PX = 40;

const sameIds = (a, b) => a.size === b.size && [...b].every(id => a.has(id));

/**
 * The ids of the rows within NEAR_VIEW_MARGIN_PX of the list's scroll view
 * (`nearIds`), of those actually showing (`inViewIds`) and of those below the
 * view (`belowIds`), measured on scroll and resize. Vertical only, against the scroller itself: the panel slides in
 * sideways and is clipped while it does, and a card mid-slide must not blank
 * out.
 */
function useRowsNearView(listRef, rowCount) {
  const [nearIds, setNearIds] = useState(() => new Set());
  const [inViewIds, setInViewIds] = useState(() => new Set());
  const [belowIds, setBelowIds] = useState(() => new Set());
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const scroller = list.closest('.panel-content') || list.parentElement;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const view = scroller.getBoundingClientRect();
      const near = new Set();
      const inView = new Set();
      const below = new Set();
      for (const row of list.querySelectorAll('[data-graph-id]')) {
        const r = row.getBoundingClientRect();
        const id = row.dataset.graphId;
        if (r.bottom > view.top - NEAR_VIEW_MARGIN_PX && r.top < view.bottom + NEAR_VIEW_MARGIN_PX) near.add(id);
        if (r.bottom > view.top + IN_VIEW_MIN_PX && r.top < view.bottom - IN_VIEW_MIN_PX) inView.add(id);
        else if (r.top >= view.bottom - IN_VIEW_MIN_PX) below.add(id);
      }
      setNearIds(prev => (sameIds(prev, near) ? prev : near));
      setInViewIds(prev => (sameIds(prev, inView) ? prev : inView));
      setBelowIds(prev => (sameIds(prev, below) ? prev : below));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(scroller);
    observer?.observe(list);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      observer?.disconnect();
    };
  }, [listRef, rowCount]);
  return { nearIds, inViewIds, belowIds };
}

/**
 * Where a layer over the list goes: the panel container (the scroller's
 * parent, which doesn't scroll), and how far up from its bottom the visible
 * list ends, above the room the panel keeps for the Connections bar.
 */
function usePanelOverlayHost(listRef) {
  const [host, setHost] = useState(null);
  useLayoutEffect(() => {
    const scroller = listRef.current?.closest('.panel-content');
    const container = scroller?.parentElement;
    if (!container) return undefined;
    const measure = () => {
      const bottom = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      setHost(prev => (prev?.container === container && prev.bottom === bottom ? prev : { container, bottom }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [listRef]);
  return host;
}

/**
 * Where a drop on the list will land: the header strip's insertion caret,
 * laid across the list, opening a gap between the rows it falls between. Not a
 * `data-graph-id` row, so slot measuring skips it. In the panel's text colour:
 * the header's pale grey reads on its maroon, not on the panel.
 */
const DropCaret = ({ color }) => (
  <div
    aria-hidden="true"
    style={{
      width: '100%',
      height: '4px',
      // A clear gap either side, so the line reads between two cards.
      margin: '18px 0',
      borderRadius: '2px',
      backgroundColor: color,
      boxShadow: '0 0 8px rgba(0,0,0,0.35)',
      pointerEvents: 'none',
    }}
  />
);

// Internal Left Grid View (Open Webs)
const LeftGridView = ({
  panelWidth,
  listContainerRef,
  activeGraphId,
  handleGridItemClick,
  closeGraph,
  leftPanelExpanded,
  rightPanelExpanded,
  storeActions,
  onOpenSearch,
}) => {
  const theme = useTheme();
  const openGraphsForList = useOpenGraphsForList();
  const { nearIds, inViewIds, belowIds } = useRowsNearView(listContainerRef, openGraphsForList.length);
  const overlayHost = usePanelOverlayHost(listContainerRef);
  // "To Current Web" shows while the active web's card is scrolled out of view.
  const showToCurrent = !!activeGraphId && openGraphsForList.some(g => g.id === activeGraphId) && !inViewIds.has(activeGraphId);
  // Points the way the list will scroll to get there.
  const ToCurrentArrow = belowIds.has(activeGraphId) ? ArrowDown : ArrowUp;
  const scrollToCurrent = useCallback(() => {
    const list = listContainerRef.current;
    const row = list?.querySelector(`[data-graph-id="${CSS.escape(activeGraphId)}"]`);
    const scroller = list?.closest('.panel-content');
    if (!row || !scroller) return;
    const r = row.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    // Centred, or its top edge in view when it is taller than the panel.
    const offset = r.height < view.height ? (view.height - r.height) / 2 : 12;
    scroller.scrollTo({ top: scroller.scrollTop + (r.top - view.top) - offset, behavior: 'smooth' });
  }, [listContainerRef, activeGraphId]);
  // Double-click a web: the right panel's Info tab (index 0, always there),
  // opening the panel if it is closed. The first click of the pair has already
  // made the web active, so Info is about this web.
  const openWebInfo = useCallback((graphId) => {
    const st = useGraphStore.getState();
    if (st.activeGraphId !== graphId) st.setActiveGraph(graphId);
    st.activateRightPanelTab(0);
    st.setRightPanelExpanded(true);
  }, []);
  // Drop a Thing to open its web at that slot, or a web's row or header tab to
  // move it there. The caret marks where it lands.
  const { drop, dropItem, slot } = useOpenWebsDrop(listContainerRef);
  const caret = slot !== null && describeDropGhost(dropItem) ? <DropCaret key="__drop-caret__" color={theme.canvas.textPrimary} /> : null;
  // Context menu options for open webs tab
  const getTabContextMenuOptions = () => [
    {
      label: 'Merge Duplicates',
      icon: <Merge size={14} />,
      action: () => {
        // For Open Webs, we need to trigger the merge modal through the main Panel component
        // Since Open Webs doesn't have its own duplicate manager, we'll dispatch the event
        window.dispatchEvent(new CustomEvent('openMergeModal'));
      }
    }
  ];

  // Stable, so the memoized list items don't re-render on every panel render.
  const handleItemContextMenu = useCallback((e, graphId) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, getOpenWebContextMenuOptions(graphId, 'below'));
  }, []);

  return (
    <div
      ref={drop}
      className="panel-content-inner"
      // Fills the panel, so a drop below the last row still lands (at the end).
      style={{ minHeight: '100%' }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, getTabContextMenuOptions());
      }}
    >
      {/* Sticky: stays put while the list scrolls under it. Bleeds over the
          wrapper's padding so nothing shows above or beside it. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 20, margin: '-15px -15px 0', padding: '15px 15px 16px', backgroundColor: theme.canvas.bg }}>
        <h2 style={{ margin: 0, color: theme.canvas.textPrimary, userSelect: 'none', fontSize: '1.1rem', fontWeight: 'bold', fontFamily: "'EmOne', sans-serif" }}>
          Open Webs
        </h2>
        <div style={{ display: 'flex', gap: '4px' }}>
          <PanelIconButton
            icon={Search}
            size={20}
            onClick={onOpenSearch}
            title="Search Open Webs"
          />
          <PanelIconButton
            icon={Plus}
            size={20}
            // Same act as the header's + — open the selector that settles what
            // defines the new Web. Dispatched rather than called because the
            // selector is mounted by NodeCanvas, the same route Merge
            // Duplicates takes out of this panel (see above).
            onClick={() => window.dispatchEvent(new Event('redstring:new-web'))}
            title="Create New Thing with Graph Definition"
          />

        </div>
      </div>

      {/* Bridge Status Display - Disabled */}

      {/* No scroller of its own: the list flows into the panel's .panel-content,
          like the other left tabs, so it gets the same styled scrollbar. */}
      <div
        ref={listContainerRef}
        style={{ paddingLeft: '5px', paddingRight: '5px' }}
      >
        {/* One flat keyed list, so the caret slides between rows without
            remounting them (an array per row would key them by index). */}
        {openGraphsForList.flatMap((graph) => [
          ...(slot === graph.id && caret ? [caret] : []),
          <GraphListItem
            key={graph.id}
            graphData={graph}
            panelWidth={panelWidth}
            isActive={graph.id === activeGraphId}
            onClick={handleGridItemClick}
            onClose={closeGraph}
            onDoubleClick={openWebInfo}
            drawWeb={nearIds.has(graph.id)}
            onContextMenu={handleItemContextMenu}
          />
        ]).concat(slot === DROP_AT_END && caret ? [caret] : [])}
        {openGraphsForList.length === 0 && !caret && (
          <div style={{ color: theme.canvas.textSecondary, textAlign: 'center', marginTop: '20px', fontFamily: "'EmOne', sans-serif" }}>No webs currently open.</div>
        )}
      </div>

      {/* Its own layer over the panel, fixed to the panel's bottom: not in the
          scrolling list. Styled as Back to Civilization, the canvas's own way back. */}
      {overlayHost && createPortal(
        <div style={{
          position: 'absolute',
          left: '50%',
          bottom: overlayHost.bottom + 16,
          transform: 'translateX(-50%)',
          zIndex: 2,
          opacity: showToCurrent ? 1 : 0,
          pointerEvents: showToCurrent ? 'auto' : 'none',
          transition: 'opacity 0.15s ease',
        }}>
          <div
            className="back-to-civilization-pill"
            role="button"
            tabIndex={showToCurrent ? 0 : -1}
            title="Scroll to the current web"
            onClick={scrollToCurrent}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollToCurrent(); } }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
          >
            <ToCurrentArrow size={16} color="maroon" strokeWidth={2.5} />
            <span className="back-to-civilization-text">To Current Web</span>
          </div>
        </div>,
        overlayHost.container,
      )}
    </div>
  );
};

export default LeftGridView;
