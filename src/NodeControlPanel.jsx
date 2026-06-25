import React from 'react';
import UnifiedBottomControlPanel from './UnifiedBottomControlPanel';
import useGraphStore from './store/graphStore.jsx';

const NodeControlPanel = ({
  mode = 'nodes',
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
  onOrbit,
  onGroup,
  onCompose,
  decompHasDefinitions = false,
  onLeftNav,
  onRightNav,
  hasLeftNav = false,
  hasRightNav = false,
  onActionHoverChange,
  wizardEnabled = false,
  onDismiss,
}) => {
  const openRightPanelNodeTab = useGraphStore((s) => s.openRightPanelNodeTab);

  const nodes = selectedNodePrototypes.map(p => ({ id: p.id, name: p.name, color: p.color }));

  return (
    <UnifiedBottomControlPanel
      mode={mode}
      isVisible={isVisible}
      typeListOpen={typeListOpen}
      onAnimationComplete={onAnimationComplete}
      selectedNodes={nodes}
      onNodeClick={(node) => openRightPanelNodeTab?.(node.id, node.name)}
      onDelete={onDelete}
      onAdd={onAdd}
      onUp={onUp}
      onOpenInPanel={onOpenInPanel}
      onCompose={onCompose}
      decompHasDefinitions={decompHasDefinitions}
      onDecompose={onDecompose}
      onAbstraction={onAbstraction}
      onEdit={onEdit}
      onSave={onSave}
      onPalette={onPalette}
      onOrbit={onOrbit}
      onGroup={onGroup}
      onLeftNav={onLeftNav}
      onRightNav={onRightNav}
      hasLeftNav={hasLeftNav}
      hasRightNav={hasRightNav}
      onActionHoverChange={onActionHoverChange}
      wizardEnabled={wizardEnabled}
      onDismiss={onDismiss}
    />
  );
};

export default NodeControlPanel;

