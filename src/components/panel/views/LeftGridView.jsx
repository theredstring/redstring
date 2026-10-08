import React, { useCallback, useMemo } from 'react';
import { Merge, Plus, Search } from 'lucide-react';
import GraphListItem from '../../../GraphListItem.jsx';
import { showContextMenu } from '../../GlobalContextMenu.jsx';
import { getOpenWebContextMenuOptions } from '../../openWebContextMenu.jsx';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import { useTheme } from '../../../hooks/useTheme.js';
import useGraphStore from '../../../store/graphStore.js';
import { NODE_DEFAULT_COLOR, NODE_HEIGHT } from '../../../constants';
import { projectGraphView, viewEdges } from '../../../core/openDefinitions.js';
import { getTextColor } from '../../../utils/colorUtils';
import { DROP_AT_END, describeDropGhost, useOpenWebsDrop } from './useOpenWebsDrop.js';

// Each open web with its nodes and edges, for the list and its previews.
// Subscribed here rather than in Panel (P2.09): the previews need positions,
// so this follows every node move, but only while the Open Webs tab is open.
// Each web is read as viewed, like the canvas: a Thing opened in place shows its
// definition's nodes inside its box, not a single node.
function useOpenGraphsForList() {
  const openGraphIds = useGraphStore(state => state.openGraphIds);
  const graphsMap = useGraphStore(state => state.graphs);
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgesMap = useGraphStore(state => state.edges);
  return useMemo(() => {
    // Dedupe: list entries are keyed by graph id, so a repeated entry would
    // produce two children with the same React key.
    return [...new Set(openGraphIds)].map(id => {
      const state = { graphs: graphsMap, nodePrototypes: nodePrototypesMap, edges: edgesMap };
      const graphData = projectGraphView(state, id);
      if (!graphData) return null;
      const edgesInView = viewEdges(state, id);

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
      return { ...graphData, color: graphColor, nodes, edges };
    }).filter(Boolean);
  }, [openGraphIds, graphsMap, nodePrototypesMap, edgesMap]);
}

/**
 * Where a drop on the list will land: a collapsed row of the web it becomes,
 * half-faded with a dashed edge like the Wizard's pin ghost. Not a
 * `data-graph-id` row, so slot measuring skips it.
 */
const DropGhostRow = ({ name, color }) => (
  <div
    aria-hidden="true"
    style={{
      width: '100%',
      height: NODE_HEIGHT,
      margin: '5px 0',
      borderRadius: '12px',
      boxSizing: 'border-box',
      backgroundColor: color,
      color: getTextColor(color),
      opacity: 0.5,
      outline: `1.5px dashed ${color}`,
      outlineOffset: '2px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      userSelect: 'none',
      pointerEvents: 'none',
    }}
  >
    {/* The collapsed row's title, style for style (GraphListItem), so a long
        name truncates the same way. Its own block: an ellipsis needs one,
        and text loose in a flex box only overflows. */}
    <div
      style={{
        fontWeight: 'bold',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        padding: '10px',
        textAlign: 'center',
        width: '100%',
        boxSizing: 'border-box',
        fontFamily: "'EmOne', sans-serif",
      }}
    >
      {name}
    </div>
  </div>
);

// Internal Left Grid View (Open Webs)
const LeftGridView = ({
  panelWidth,
  listContainerRef,
  activeGraphId,
  expandedGraphIds,
  handleGridItemClick,
  closeGraph,
  toggleGraphExpanded,
  leftPanelExpanded,
  rightPanelExpanded,
  storeActions,
  onOpenSearch,
}) => {
  const theme = useTheme();
  const openGraphsForList = useOpenGraphsForList();
  // Drop a Thing to open its web at that slot, or a web's row or header tab to
  // move it there. The ghost row previews the result.
  const { drop, dropItem, slot } = useOpenWebsDrop(listContainerRef);
  const ghost = slot !== null ? describeDropGhost(dropItem) : null;
  const ghostRow = ghost ? <DropGhostRow key="__drop-ghost__" name={ghost.name} color={ghost.color} /> : null;
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
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
        {/* One flat keyed list, so the ghost slides between rows without
            remounting them (an array per row would key them by index). */}
        {openGraphsForList.flatMap((graph) => [
          ...(slot === graph.id && ghostRow ? [ghostRow] : []),
          <GraphListItem
            key={graph.id}
            graphData={graph}
            panelWidth={panelWidth}
            isActive={graph.id === activeGraphId}
            isExpanded={expandedGraphIds.has(graph.id)}
            onClick={handleGridItemClick}
            onClose={closeGraph}
            onToggleExpand={toggleGraphExpanded}
            onContextMenu={handleItemContextMenu}
          />
        ]).concat(slot === DROP_AT_END && ghostRow ? [ghostRow] : [])}
        {openGraphsForList.length === 0 && !ghostRow && (
          <div style={{ color: theme.canvas.textSecondary, textAlign: 'center', marginTop: '20px', fontFamily: "'EmOne', sans-serif" }}>No webs currently open.</div>
        )}
      </div>
    </div>
  );
};

export default LeftGridView;
