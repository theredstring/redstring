import React, { useState } from 'react';
import { Merge } from 'lucide-react';
import DuplicateManager from '../../DuplicateManager.jsx';
import AllThingsNodeItem from '../items/AllThingsNodeItem.jsx';
import StandardDivider from '../../StandardDivider.jsx';
import { getTextColor } from '../../../utils/colorUtils';
import { showContextMenu } from '../../GlobalContextMenu.jsx';

// Internal Left All Things View (All Nodes)
const LeftAllThingsView = ({
  allNodesByType,
  sectionCollapsed,
  sectionMaxHeights,
  toggleSection,
  panelWidth,
  sectionContentRefs,
  activeDefinitionNodeId,
  openGraphTab,
  createAndAssignGraphDefinition,
  openRightPanelNodeTab,
  storeActions,
}) => {
  const [showDuplicateManager, setShowDuplicateManager] = useState(false);

  // Context menu options for all things tab
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
          All Things
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
      {allNodesByType.size === 0 ? (
        <div style={{ color: '#666', fontSize: '0.9rem', fontFamily: "'EmOne', sans-serif", textAlign: 'center', marginTop: '20px' }}>
          No nodes found.
        </div>
      ) : (
        Array.from(allNodesByType.entries()).map(([typeId, group], index, array) => {
          const { typeInfo, nodes } = group;
          const isCollapsed = sectionCollapsed[typeId] ?? false;
          const maxHeight = sectionMaxHeights[typeId] || '0px';
          const isLastSection = index === array.length - 1;

          // Debug logging
          console.log(`[AllThingsView] Rendering type ${typeId}:`, {
            typeName: typeInfo.name,
            nodeCount: nodes.length,
            isCollapsed,
            maxHeight,
            nodes: nodes.map(n => ({ id: n.id, name: n.name }))
          });
          return (
            <div key={typeId}>
              <div style={{ marginBottom: '10px' }}>
                <div
                  onClick={() => toggleSection(typeId)}
                  style={{
                    backgroundColor: typeInfo.color,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    color: getTextColor(typeInfo.color),
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
                            console.error('[Panel All Node Click] Missing required actions');
                          }
                        };
                        const handleDoubleClick = () => { openRightPanelNodeTab?.(node.id); };

                        // Check if node has semantic web data (for glow effect)
                        const hasSemanticData = node.equivalentClasses?.length > 0 || node.externalLinks?.length > 0;

                        return (
                          <AllThingsNodeItem
                            key={node.id}
                            node={node}
                            onClick={handleSingleClick}
                            onDoubleClick={handleDoubleClick}
                            isActive={node.id === activeDefinitionNodeId}
                            hasSemanticData={hasSemanticData}
                            onDelete={(nodeId) => {
                              // Delete the node prototype
                              if (storeActions?.deleteNodePrototype) {
                                storeActions.deleteNodePrototype(nodeId);
                              }
                            }}
                            duplicateNodePrototype={storeActions?.duplicateNodePrototype}
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

export default LeftAllThingsView;
