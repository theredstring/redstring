import React from 'react';
import UnifiedBottomControlPanel from './UnifiedBottomControlPanel';
import useGraphStore from './store/graphStore.jsx';

const NodeControlPanel = ({
  selectedNodePrototypes = [],
  isVisible = true,
  typeListOpen = false,
  onAnimationComplete,
  onDelete,
  onAdd,
  onUp,
  onOpenInPanel,
  onDecompose,
  onAbstraction,
  onEdit,
  onSave,
  onPalette,
  onMore,
  onGroup,
  onLeftNav,
  onRightNav,
  hasLeftNav = false,
  hasRightNav = false,
  onActionHoverChange,
}) => {
  const openRightPanelNodeTab = useGraphStore((s) => s.openRightPanelNodeTab);

  const nodes = selectedNodePrototypes.map(p => ({ id: p.id, name: p.name, color: p.color }));

  return (
    <UnifiedBottomControlPanel
      mode="nodes"
      isVisible={isVisible}
      typeListOpen={typeListOpen}
      onAnimationComplete={onAnimationComplete}
      selectedNodes={nodes}
      onNodeClick={(node) => openRightPanelNodeTab?.(node.id, node.name)}
      onDelete={onDelete}
      onAdd={onAdd}
      onUp={onUp}
      onOpenInPanel={onOpenInPanel}
      onDecompose={onDecompose}
      onAbstraction={onAbstraction}
      onEdit={onEdit}
      onSave={onSave}
      onPalette={onPalette}
      onMore={onMore}
      onGroup={onGroup}
      onLeftNav={onLeftNav}
      onRightNav={onRightNav}
      hasLeftNav={hasLeftNav}
      hasRightNav={hasRightNav}
      onActionHoverChange={onActionHoverChange}
    />
  );
};

export default NodeControlPanel;

