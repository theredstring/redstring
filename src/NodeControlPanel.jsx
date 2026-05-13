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
  onOrbit,
  onGroup,
  onLeftNav,
  onRightNav,
  hasLeftNav = false,
  hasRightNav = false,
  onActionHoverChange,
  onAskWizardDefineNode,
  wizardEnabled = false,
  onDismiss,
}) => {
  const openRightPanelNodeTab = useGraphStore((s) => s.openRightPanelNodeTab);
  const graphsMap = useGraphStore((s) => s.graphs);

  const nodes = selectedNodePrototypes.map(p => ({ id: p.id, name: p.name, color: p.color }));

  // Eligible when: exactly one node selected AND it has no definition graphs OR all
  // its definition graphs are empty (no instances). Multi-select is intentionally not eligible.
  const askWizardDefineNodeEligible = (() => {
    if (!Array.isArray(selectedNodePrototypes) || selectedNodePrototypes.length !== 1) return false;
    const proto = selectedNodePrototypes[0];
    if (!proto) return false;
    const defIds = Array.isArray(proto.definitionGraphIds) ? proto.definitionGraphIds : [];
    if (defIds.length === 0) return true;
    // Check whether ALL referenced definition graphs are empty (no instances)
    for (const gid of defIds) {
      const g = graphsMap?.get?.(gid);
      if (!g) continue; // missing graph reference — treat as effectively empty
      const instCount = g.instances instanceof Map
        ? g.instances.size
        : (g.instances ? Object.keys(g.instances).length : 0);
      if (instCount > 0) return false;
    }
    return true;
  })();

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
      onOrbit={onOrbit}
      onGroup={onGroup}
      onLeftNav={onLeftNav}
      onRightNav={onRightNav}
      hasLeftNav={hasLeftNav}
      hasRightNav={hasRightNav}
      onActionHoverChange={onActionHoverChange}
      wizardEnabled={wizardEnabled}
      askWizardDefineNodeEligible={askWizardDefineNodeEligible}
      onDismiss={onDismiss}
      onAskWizardDefineNode={() => {
        if (selectedNodePrototypes.length === 1 && onAskWizardDefineNode) {
          onAskWizardDefineNode(selectedNodePrototypes[0]);
        }
      }}
    />
  );
};

export default NodeControlPanel;

