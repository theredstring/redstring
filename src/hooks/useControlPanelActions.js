/**
 * Control Panel actions hook
 * Handles actions for NodeControlPanel (operates on prototypes + instances)
 */

import { useCallback } from 'react';
import useGraphStore from '../store/graphStore.jsx';

/**
 * Hook providing control panel action handlers
 * @param {Object} params - Hook parameters
 * @returns {Object} Object containing all control panel action handlers
 */
export function useControlPanelActions({
  activeGraphId,
  selectedInstanceIds,
  selectedNodePrototypes,
  nodes,
  storeActions,
  setSelectedInstanceIds,
  setSelectedGroup,
  setGroupControlPanelShouldShow,
  setNodeControlPanelShouldShow,
  setNodeControlPanelVisible,
  setNodeNamePrompt,
  setPreviewingNodeId,
  setAbstractionCarouselNode,
  setCarouselAnimationState,
  setAbstractionCarouselVisible,
  setSelectedNodeIdForPieMenu,
  rightPanelExpanded,
  setRightPanelExpanded,
  setEditingNodeIdOnCanvas,
  NODE_DEFAULT_COLOR,
  onStartHurtleAnimationFromPanel,
  onOpenColorPicker
}) {

  const handleNodePanelDelete = useCallback(() => {
    if (!activeGraphId || selectedInstanceIds.size === 0) return;
    const idsToDelete = Array.from(selectedInstanceIds);
    idsToDelete.forEach(id => storeActions.removeNodeInstance(activeGraphId, id));
    setSelectedInstanceIds(new Set());
  }, [activeGraphId, selectedInstanceIds, storeActions, setSelectedInstanceIds]);

  const handleNodePanelAdd = useCallback(() => {
    setNodeNamePrompt({ visible: true, name: '', color: NODE_DEFAULT_COLOR });
  }, [setNodeNamePrompt, NODE_DEFAULT_COLOR]);

  const handleNodePanelUp = useCallback(() => {
    const first = selectedNodePrototypes[0];
    if (!first) return;

    // If onStartHurtleAnimationFromPanel is available, use hurtle animation like PieMenu
    if (onStartHurtleAnimationFromPanel && first.definitionGraphIds && first.definitionGraphIds.length > 0) {
      const graphIdToOpen = first.definitionGraphIds[0];
      // Use a mock rect for the animation start point (center bottom of screen)
      const mockRect = {
        left: window.innerWidth / 2,
        top: window.innerHeight - 80,
        width: 40,
        height: 40
      };
      onStartHurtleAnimationFromPanel(first.id, graphIdToOpen, first.id, mockRect);
    } else if (onStartHurtleAnimationFromPanel) {
      // Node has no definition - create one first, then start hurtle animation
      storeActions.createAndAssignGraphDefinitionWithoutActivation(first.id);
      setTimeout(() => {
        const updatedPrototype = useGraphStore.getState().nodePrototypes.get(first.id);
        if (updatedPrototype?.definitionGraphIds?.length > 0) {
          const newGraphId = updatedPrototype.definitionGraphIds[updatedPrototype.definitionGraphIds.length - 1];
          const mockRect = {
            left: window.innerWidth / 2,
            top: window.innerHeight - 80,
            width: 40,
            height: 40
          };
          onStartHurtleAnimationFromPanel(first.id, newGraphId, first.id, mockRect);
        }
      }, 50);
    } else {
      // Fallback to opening in panel if hurtle animation not available
      storeActions.openRightPanelNodeTab(first.id, first.name);
    }
  }, [selectedNodePrototypes, storeActions, onStartHurtleAnimationFromPanel]);

  const handleNodePanelOpenInPanel = useCallback(() => {
    const first = selectedNodePrototypes[0];
    if (!first) return;
    storeActions.openRightPanelNodeTab(first.id, first.name);
  }, [selectedNodePrototypes, storeActions]);

  const handleNodePanelDecompose = useCallback(() => {
    const first = selectedNodePrototypes[0];
    if (!first) return;
    // Find the first instance of this prototype
    const nodeData = nodes.find(n => n.prototypeId === first.id);
    if (nodeData) {
      // Trigger decompose action similar to pie menu
      setPreviewingNodeId(nodeData.id);
      setSelectedInstanceIds(new Set([nodeData.id]));
    }
  }, [selectedNodePrototypes, nodes, setPreviewingNodeId, setSelectedInstanceIds]);

  const handleNodePanelAbstraction = useCallback(() => {
    const first = selectedNodePrototypes[0];
    if (!first) return;
    // Trigger abstraction carousel
    const nodeData = nodes.find(n => n.prototypeId === first.id);
    if (nodeData) {
      setAbstractionCarouselNode(nodeData);
      setCarouselAnimationState('entering');
      setAbstractionCarouselVisible(true);
      setSelectedNodeIdForPieMenu(nodeData.id);
      setSelectedInstanceIds(new Set([nodeData.id]));
    }
  }, [selectedNodePrototypes, nodes, setAbstractionCarouselNode, setCarouselAnimationState, setAbstractionCarouselVisible, setSelectedNodeIdForPieMenu, setSelectedInstanceIds]);

  const handleNodePanelEdit = useCallback(() => {
    const first = selectedNodePrototypes[0];
    if (!first) return;
    // Open right panel and enable editing
    storeActions.openRightPanelNodeTab(first.id, first.name);
    if (!rightPanelExpanded) {
      setRightPanelExpanded(true);
    }
    // Find the instance to edit
    const instance = nodes.find(n => n.prototypeId === first.id);
    if (instance) {
      setEditingNodeIdOnCanvas(instance.id);
    }
  }, [selectedNodePrototypes, storeActions, rightPanelExpanded, setRightPanelExpanded, nodes, setEditingNodeIdOnCanvas]);

  const handleNodePanelSave = useCallback(() => {
    const first = selectedNodePrototypes[0];
    if (!first) return;
    // Toggle saved state
    storeActions.toggleSavedNode(first.id);
  }, [selectedNodePrototypes, storeActions]);

  const handleNodePanelMore = useCallback(() => {
    // For now, just log - could implement additional menu
    console.log('[useControlPanelActions] More options requested');
  }, []);

  const handleNodePanelPalette = useCallback((buttonPosition) => {
    const first = selectedNodePrototypes[0];
    if (!first) return;
    // Find the first instance of this prototype
    const instance = nodes.find(n => n.prototypeId === first.id);
    if (instance && onOpenColorPicker) {
      // Use the button position passed from the control panel
      onOpenColorPicker(instance.id, buttonPosition);
    }
  }, [selectedNodePrototypes, nodes, onOpenColorPicker]);

  const handleNodePanelGroup = useCallback(() => {
    if (!activeGraphId) return;
    if (selectedInstanceIds.size < 2) return;
    const memberInstanceIds = Array.from(selectedInstanceIds);
    // Derive a default name and color from the first selected prototype
    const firstInstance = nodes.find(n => n.id === memberInstanceIds[0]);
    const defaultName = 'Group';
    const defaultColor = (firstInstance && firstInstance.color) || NODE_DEFAULT_COLOR;
    try {
      const createdGroupId = storeActions.createGroup(activeGraphId, { name: defaultName, color: defaultColor, memberInstanceIds });
      if (createdGroupId) {
        setSelectedInstanceIds(new Set());
        const currentState = useGraphStore.getState();
        const graph = currentState.graphs?.get(activeGraphId);
        const newGroup = graph?.groups?.get(createdGroupId);
        if (newGroup) {
          setSelectedGroup?.(newGroup);
          setGroupControlPanelShouldShow?.(true);
          setNodeControlPanelShouldShow?.(false);
          setNodeControlPanelVisible?.(false);
        }
      }
    } catch (e) {
      console.error('[useControlPanelActions] Error creating group:', e);
    }
  }, [
    activeGraphId,
    selectedInstanceIds,
    nodes,
    storeActions,
    NODE_DEFAULT_COLOR,
    setSelectedInstanceIds,
    setSelectedGroup,
    setGroupControlPanelShouldShow,
    setNodeControlPanelShouldShow,
    setNodeControlPanelVisible
  ]);

  return {
    handleNodePanelDelete,
    handleNodePanelAdd,
    handleNodePanelUp,
    handleNodePanelOpenInPanel,
    handleNodePanelDecompose,
    handleNodePanelAbstraction,
    handleNodePanelEdit,
    handleNodePanelSave,
    handleNodePanelMore,
    handleNodePanelPalette,
    handleNodePanelGroup
  };
}
