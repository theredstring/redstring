import React, { useState } from 'react';
import { Merge, Plus, Search } from 'lucide-react';
import GraphListItem from '../../../GraphListItem.jsx';
import { showContextMenu } from '../../GlobalContextMenu.jsx';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import useGraphStore from '../../../store/graphStore.jsx';

// Internal Left Grid View (Open Things)
const LeftGridView = ({
  openGraphsForList,
  panelWidth,
  listContainerRef,
  activeGraphId,
  expandedGraphIds,
  handleGridItemClick,
  closeGraph,
  toggleGraphExpanded,
  createNewGraph,
  leftPanelExpanded,
  rightPanelExpanded,
  storeActions,
  onOpenSearch,
}) => {
  // Context menu options for open things tab
  const getTabContextMenuOptions = () => [
    {
      label: 'Merge Duplicates',
      icon: <Merge size={14} />,
      action: () => {
        // For Open Things, we need to trigger the merge modal through the main Panel component
        // Since Open Things doesn't have its own duplicate manager, we'll dispatch the event
        window.dispatchEvent(new CustomEvent('openMergeModal'));
      }
    }
  ];

  return (
    <div
      className="panel-content-inner"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, getTabContextMenuOptions());
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
        <h2 style={{ margin: 0, color: '#260000', userSelect: 'none', fontSize: '1.1rem', fontWeight: 'bold', fontFamily: "'EmOne', sans-serif" }}>
          Open Things
        </h2>
        <div style={{ display: 'flex', gap: '4px' }}>
          <PanelIconButton
            icon={Search}
            size={20}
            onClick={onOpenSearch}
            title="Search Open Things"
          />
          <PanelIconButton
            icon={Plus}
            size={20}
            onClick={() => createNewGraph({ name: 'New Thing' })}
            title="Create New Thing with Graph Definition"
          />

        </div>
      </div>

      {/* Bridge Status Display - Disabled */}

      <div
        ref={listContainerRef}
        className="hide-scrollbar"
        style={{ flexGrow: 1, overflowY: 'auto', paddingLeft: '5px', paddingRight: '5px', paddingBottom: '70px', minHeight: 0 }}
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

          />
        ))}
        {openGraphsForList.length === 0 && (
          <div style={{ color: '#666', textAlign: 'center', marginTop: '20px', fontFamily: "'EmOne', sans-serif" }}>No Things currently open.</div>
        )}
      </div>
    </div>
  );
};

export default LeftGridView;
