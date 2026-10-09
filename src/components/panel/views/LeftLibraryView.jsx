import React, { useState, useMemo, useCallback } from 'react';
import { Merge, ChevronRight, ChevronDown, Search, Bookmark, LayoutGrid } from 'lucide-react';
import { VirtuosoGrid } from 'react-virtuoso';
import SavedNodeItem from '../items/SavedNodeItem.jsx';
import LazySection from '../LazySection.jsx';
import StandardDivider from '../../StandardDivider.jsx';
import { getTextColor } from '../../../utils/colorUtils';
import { showContextMenu, showContextMenuForElement } from '../../GlobalContextMenu.jsx';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import { useTheme } from '../../../hooks/useTheme.js';

const SCOPES = [
  { value: 'saved', label: 'Saved Things', Icon: Bookmark },
  { value: 'all', label: 'All Things', Icon: LayoutGrid },
];

// Internal Left Library View: Saved Things, or All Things, chosen from the title
const LeftLibraryView = ({
  scope = 'saved',
  onScopeChange,
  nodesByType,
  sectionCollapsed,
  sectionMaxHeights,
  toggleSection,
  isWideLayout,
  sectionContentRefs,
  activeDefinitionNodeId,
  openGraphTab,
  createAndAssignGraphDefinition,
  toggleSavedNode,
  openRightPanelNodeTab,
  leftPanelExpanded,
  rightPanelExpanded,
  onOpenSearch,
}) => {
  const theme = useTheme();
  const scopeLabel = scope === 'all' ? 'All Things' : 'Saved Things';

  // Kept only so the chevron can point at an open menu; the menu is the
  // global context menu, which owns its own dismissal.
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const openScopeMenu = useCallback((e) => {
    setScopeMenuOpen(true);
    showContextMenuForElement(e.currentTarget, SCOPES.map(({ value, label, Icon }) => ({
      label,
      icon: <Icon size={14} />,
      active: scope === value,
      action: () => onScopeChange?.(value),
    })), { onClose: () => setScopeMenuOpen(false) });
  }, [scope, onScopeChange]);

  // Context menu options for the Things tab
  const getTabContextMenuOptions = () => [
    {
      label: 'Merge Duplicates',
      icon: <Merge size={14} />,
      // The modal is mounted once in NodeCanvas; this only announces intent.
      action: () => window.dispatchEvent(new CustomEvent('openMergeModal'))
    }
  ];

  const gridComponents = useMemo(() => {
    return {
      List: React.forwardRef((props, ref) => (
        <div
          {...props}
          ref={ref}
          style={{
            ...props.style,
            display: 'grid',
            gridTemplateColumns: isWideLayout ? '1fr 1fr' : '1fr',
            gap: isWideLayout ? '8px' : '0px',
            width: '100%',
          }}
        />
      )),
      Item: React.forwardRef((props, ref) => (
        <div {...props} ref={ref} style={{ ...props.style, display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%' }} />
      ))
    };
  }, [isWideLayout]);

  // Stable callbacks for item interactions
  const handleItemClick = useCallback((node) => {
    if (node.definitionGraphIds && node.definitionGraphIds.length > 0) {
      const graphIdToOpen = node.definitionGraphIds[0];
      openGraphTab?.(graphIdToOpen, node.id);
    } else if (createAndAssignGraphDefinition) {
      createAndAssignGraphDefinition(node.id);
    } else {
      console.error('[Panel Saved Node Click] Missing required actions');
    }
  }, [openGraphTab, createAndAssignGraphDefinition]);

  const handleItemDoubleClick = useCallback((node) => {
    openRightPanelNodeTab?.(node.id);
  }, [openRightPanelNodeTab]);

  const handleItemUnsave = useCallback((node) => {
    toggleSavedNode?.(node.id);
  }, [toggleSavedNode]);

  return (
    <div
      className="panel-content-inner"
      // min-height, not height: a sticky header only sticks within its parent,
      // so the parent has to grow with the list.
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, getTabContextMenuOptions());
      }}
    >
      {/* Sticky: stays put while the list scrolls under it. Bleeds over the
          wrapper's padding so nothing shows above or beside it. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 20, margin: '-15px -15px 0', padding: '15px 15px 16px', backgroundColor: theme.canvas.bg }}>
        <button
          onClick={openScopeMenu}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'none',
            color: theme.canvas.textPrimary,
            border: 'none',
            borderRadius: 4,
            padding: '2px 4px 2px 0',
            margin: 0,
            fontFamily: "'EmOne', sans-serif",
            fontSize: '1.1rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            transition: 'opacity 0.15s ease'
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          {scopeLabel}
          <ChevronDown size={13} style={{ opacity: 0.8, transition: 'transform 0.15s ease', transform: scopeMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </button>
        <PanelIconButton
          icon={Search}
          size={20}
          onClick={onOpenSearch}
          title={`Search ${scopeLabel}`}
        />
      </div>

      {nodesByType.size === 0 ? (
        <div style={{ color: theme.canvas.textSecondary, fontSize: '0.9rem', fontFamily: "'EmOne', sans-serif", textAlign: 'center', marginTop: '20px' }}>
          {scope === 'all' ? 'No Things yet.' : 'Bookmark Things to add them here.'}
        </div>
      ) : (
        Array.from(nodesByType.entries()).map(([typeId, group], index, array) => {
          const { typeInfo, nodes } = group;
          const isCollapsed = sectionCollapsed[typeId] ?? false;
          const maxHeight = sectionMaxHeights[typeId] || '0px';
          const isLastSection = index === array.length - 1;
          return (
            <div key={typeId}>
              <div style={{ marginBottom: '10px' }}>
                <div
                  data-nav="section"
                  data-nav-expanded={!isCollapsed}
                  onClick={() => toggleSection(typeId)}
                  style={{
                    backgroundColor: typeInfo.color,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    color: getTextColor(typeInfo.color, theme.darkMode),
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
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'transform 0.2s ease',
                    transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                  }}>
                    <ChevronRight size={16} />
                  </span>
                </div>

                {!isCollapsed && (
                  <LazySection estimatedHeight={`${Math.min(Math.ceil(nodes.length / (isWideLayout ? 2 : 1)) * 42 + 16, 400) + 16}px`}>
                    <div style={{ overflow: 'hidden', transition: 'max-height 0.2s ease-out', maxHeight }}>
                      <div
                        ref={(el) => {
                          if (el) { sectionContentRefs.current.set(typeId, el); } else { sectionContentRefs.current.delete(typeId); }
                        }}
                        style={{
                          height: `${Math.min(Math.ceil(nodes.length / (isWideLayout ? 2 : 1)) * 42 + 16, 400)}px`,
                          marginTop: '8px',
                          paddingBottom: '8px',
                        }}
                      >
                        <VirtuosoGrid
                          style={{ height: '100%', width: '100%', overflowX: 'hidden' }}
                          totalCount={nodes.length}
                          components={gridComponents}
                          itemContent={(index) => {
                            const node = nodes[index];
                            return (
                              <SavedNodeItem
                                key={node.id}
                                node={node}
                                onClick={handleItemClick}
                                onDoubleClick={handleItemDoubleClick}
                                onUnsave={scope === 'all' ? undefined : handleItemUnsave}
                                isActive={node.id === activeDefinitionNodeId}
                              />
                            );
                          }}
                        />
                      </div>
                    </div>
                  </LazySection>
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

export default React.memo(LeftLibraryView);
