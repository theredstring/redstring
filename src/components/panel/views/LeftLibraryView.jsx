import React, { useState } from 'react';
import { Merge } from 'lucide-react';
import DuplicateManager from '../../DuplicateManager.jsx';
import SavedNodeItem from '../items/SavedNodeItem.jsx';
import StandardDivider from '../../StandardDivider.jsx';
import { showContextMenu } from '../../GlobalContextMenu.jsx';

// Internal Left Library View (Saved Things)
const LeftLibraryView = ({
  savedNodesByType,
  sectionCollapsed,
  sectionMaxHeights,
  toggleSection,
  panelWidth,
  sectionContentRefs,
  activeDefinitionNodeId,
  openGraphTab,
  createAndAssignGraphDefinition,
  toggleSavedNode,
  openRightPanelNodeTab,
}) => {
  const [showDuplicateManager, setShowDuplicateManager] = useState(false);

  // Context menu options for saved things tab
  const getTabContextMenuOptions = () => [
    {
      label: 'Merge Duplicates',
      icon: <Merge size={14} />,
      action: () => setShowDuplicateManager(true)
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, color: '#260000', userSelect: 'none', fontSize: '1.1rem', fontWeight: 'bold', fontFamily: "'EmOne', sans-serif" }}>
          Saved Things
        </h2>
      </div>

      {showDuplicateManager && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <DuplicateManager onClose={() => setShowDuplicateManager(false)} />
        </div>
      )}

      {savedNodesByType.size === 0 ? (
        <div style={{ color: '#666', fontSize: '0.9rem', fontFamily: "'EmOne', sans-serif", textAlign: 'center', marginTop: '20px' }}>
          Bookmark Things to add them here.
        </div>
      ) : (
        Array.from(savedNodesByType.entries()).map(([typeId, group], index, array) => {
          const { typeInfo, nodes } = group;
          const isCollapsed = sectionCollapsed[typeId] ?? false;
          const maxHeight = sectionMaxHeights[typeId] || '0px';
          const isLastSection = index === array.length - 1;
          return (
            <div key={typeId}>
              <div style={{ marginBottom: '10px' }}>
                <div
                  onClick={() => toggleSection(typeId)}
                  style={{
                    backgroundColor: typeInfo.color,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    color: '#bdb5b5',
                    fontWeight: 'bold',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderRadius: '12px',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                    fontFamily: "'EmOne', sans-serif"
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; e.currentTarget.style.transform = 'translateY(0px)'; }}
                >
                  <span>{typeInfo.name} ({nodes.length})</span>
                  <span style={{ display: 'inline-block', transition: 'transform 0.2s ease', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', fontSize: '14px', fontFamily: "'EmOne', sans-serif" }}>▶</span>
                </div>

                {!isCollapsed && (
                  <div style={{ overflow: 'hidden', transition: 'max-height 0.2s ease-out', maxHeight }}>
                    <div
                      ref={(el) => {
                        if (el) { sectionContentRefs.current.set(typeId, el); } else { sectionContentRefs.current.delete(typeId); }
                      }}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: panelWidth > 250 ? '1fr 1fr' : '1fr',
                        gap: panelWidth > 250 ? '8px' : '0px',
                        marginTop: '8px',
                        paddingBottom: '8px',
                      }}
                    >
                      {nodes.map(node => {
                        const handleSingleClick = () => {
                          if (node.definitionGraphIds && node.definitionGraphIds.length > 0) {
                            const graphIdToOpen = node.definitionGraphIds[0];
                            openGraphTab?.(graphIdToOpen, node.id);
                          } else if (createAndAssignGraphDefinition) {
                            createAndAssignGraphDefinition(node.id);
                          } else {
                            console.error('[Panel Saved Node Click] Missing required actions');
                          }
                        };
                        const handleDoubleClick = () => { openRightPanelNodeTab?.(node.id); };
                        const handleUnsave = () => { toggleSavedNode?.(node.id); };
                        return (
                          <SavedNodeItem
                            key={node.id}
                            node={node}
                            onClick={handleSingleClick}
                            onDoubleClick={handleDoubleClick}
                            onUnsave={handleUnsave}
                            isActive={node.id === activeDefinitionNodeId}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              {!isLastSection && <StandardDivider />}
            </div>
          );
        })
      )}
    </div>
  );
};

export default LeftLibraryView;
