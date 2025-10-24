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
  NODE_DEFAULT_COLOR
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
    storeActions.openRightPanelNodeTab(first.id, first.name);
  }, [selectedNodePrototypes, storeActions]);

  const handleNodePanelOpenInPanel = useCallback(() => {
    const first = selectedNodePrototypes[0];
    if (!first) return;
    storeActions.openRightPanelNodeTab(first.id, first.name);
  }, [selectedNodePrototypes, storeActions]);

  const handleNodePanelDecompose = useCallback(() => {
    const first = selectedNodePrototypes[0];
    if (!first) return;
    // Trigger decompose action similar to pie menu
    setPreviewingNodeId(first.id);
    setSelectedInstanceIds(new Set([first.id]));
  }, [selectedNodePrototypes, setPreviewingNodeId, setSelectedInstanceIds]);

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
    handleNodePanelGroup
  };
}
