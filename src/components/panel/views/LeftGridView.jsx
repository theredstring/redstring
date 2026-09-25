import React, { useCallback, useMemo } from 'react';
import { Merge, Plus, Search } from 'lucide-react';
import GraphListItem from '../../../GraphListItem.jsx';
import { showContextMenu } from '../../GlobalContextMenu.jsx';
import { getOpenWebContextMenuOptions } from '../../openWebContextMenu.jsx';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import { useTheme } from '../../../hooks/useTheme.js';
import useGraphStore from '../../../store/graphStore.js';
import { NODE_DEFAULT_COLOR } from '../../../constants';

// Each open web with its nodes and edges, for the list and its previews.
// Subscribed here rather than in Panel (P2.09): the previews need positions,
// so this follows every node move, but only while the Open Webs tab is open.
function useOpenGraphsForList() {
  const openGraphIds = useGraphStore(state => state.openGraphIds);
  const graphsMap = useGraphStore(state => state.graphs);
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgesMap = useGraphStore(state => state.edges);
  return useMemo(() => {
    // Dedupe: list entries are keyed by graph id, so a repeated entry would
    // produce two children with the same React key.
    return [...new Set(openGraphIds)].map(id => {
      const graphData = graphsMap.get(id);
      if (!graphData) return null;

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

      const edges = edgeIds.map(edgeId => edgesMap.get(edgeId)).filter(Boolean);
      return { ...graphData, color: graphColor, nodes, edges };
    }).filter(Boolean);
  }, [openGraphIds, graphsMap, nodePrototypesMap, edgesMap]);
}

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
      className="panel-content-inner"
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
        {openGraphsForList.map((graph) => (
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
        ))}
        {openGraphsForList.length === 0 && (
          <div style={{ color: theme.canvas.textSecondary, textAlign: 'center', marginTop: '20px', fontFamily: "'EmOne', sans-serif" }}>No webs currently open.</div>
        )}
      </div>
    </div>
  );
};

export default LeftGridView;
