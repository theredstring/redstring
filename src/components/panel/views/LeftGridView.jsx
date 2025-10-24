import React from 'react';
import { Merge, Plus } from 'lucide-react';
import GraphListItem from '../../../GraphListItem.jsx';
import { showContextMenu } from '../../GlobalContextMenu.jsx';

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
        <button
          onClick={() => createNewGraph({ name: 'New Thing' })}
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: '#260000',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            outline: 'none',
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(38, 0, 0, 0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          title="Create New Thing with Graph Definition"
        >
          <Plus size={20} />
        </button>
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
