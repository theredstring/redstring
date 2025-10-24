/**
 * Unified node actions hook
 * Single source of truth for node operations used by both PieMenu and ControlPanels
 */

import { useCallback } from 'react';

/**
 * Hook providing unified node action handlers
 * @param {Object} params - Hook parameters
 * @param {Object} params.storeActions - Zustand store actions
 * @param {string} params.activeGraphId - Current active graph ID
 * @param {Set} params.selectedInstanceIds - Set of currently selected instance IDs
 * @param {Function} params.setSelectedInstanceIds - Setter for selected instances
 * @param {Function} params.setRightPanelExpanded - Setter for right panel expanded state
 * @param {Function} params.setEditingNodeIdOnCanvas - Setter for editing node ID
 * @param {boolean} params.rightPanelExpanded - Current right panel expanded state
 * @param {Array} params.nodes - Array of hydrated node objects
 * @param {Set} params.savedNodeIds - Set of saved node IDs
 * @returns {Object} Object containing all node action handlers
 */
export function useNodeActions({
  storeActions,
  activeGraphId,
  selectedInstanceIds,
  setSelectedInstanceIds,
  setRightPanelExpanded,
  setEditingNodeIdOnCanvas,
  rightPanelExpanded,
  nodes,
  savedNodeIds
}) {

  const deleteNode = useCallback((instanceId = null) => {
    const targetId = instanceId || (selectedInstanceIds.size === 1 ? Array.from(selectedInstanceIds)[0] : null);
    if (!targetId) return;

    storeActions.removeNodeInstance(activeGraphId, targetId);
    setSelectedInstanceIds(new Set()); // Deselect after deleting
  }, [activeGraphId, selectedInstanceIds, storeActions, setSelectedInstanceIds]);

  const addNode = useCallback(() => {
    // Add node logic
    // This would be implemented based on your specific requirements
    console.log('[useNodeActions] Add node action called');
  }, []);

  const navigateUp = useCallback(() => {
    // Navigate up logic
    console.log('[useNodeActions] Navigate up action called');
  }, []);

  const openInPanel = useCallback((instanceId = null) => {
    const targetId = instanceId || (selectedInstanceIds.size === 1 ? Array.from(selectedInstanceIds)[0] : null);
    if (!targetId) return;

    const instance = nodes.find(n => n.id === targetId);
    if (instance) {
      // Open panel tab using the PROTOTYPE ID
      storeActions.openRightPanelNodeTab(instance.prototypeId, instance.name);
      // Ensure right panel is expanded
      if (!rightPanelExpanded) {
        setRightPanelExpanded(true);
      }
    }
  }, [selectedInstanceIds, nodes, storeActions, rightPanelExpanded, setRightPanelExpanded]);

  const decompose = useCallback((instanceId = null) => {
    const targetId = instanceId || (selectedInstanceIds.size === 1 ? Array.from(selectedInstanceIds)[0] : null);
    if (!targetId) return;

    // Decompose logic - this would trigger the decompose action
    console.log('[useNodeActions] Decompose node:', targetId);
  }, [selectedInstanceIds]);

  const showAbstraction = useCallback((instanceId = null) => {
    const targetId = instanceId || (selectedInstanceIds.size === 1 ? Array.from(selectedInstanceIds)[0] : null);
    if (!targetId) return;

    // Abstraction logic
    console.log('[useNodeActions] Show abstraction for node:', targetId);
  }, [selectedInstanceIds]);

  const editNode = useCallback((instanceId = null) => {
    const targetId = instanceId || (selectedInstanceIds.size === 1 ? Array.from(selectedInstanceIds)[0] : null);
    if (!targetId) return;

    const instance = nodes.find(n => n.id === targetId);
    if (instance) {
      // Open panel tab using the PROTOTYPE ID
      storeActions.openRightPanelNodeTab(instance.prototypeId, instance.name);
      // Ensure right panel is expanded
      if (!rightPanelExpanded) {
        setRightPanelExpanded(true);
      }
      // Enable inline editing on canvas using the INSTANCE ID
      setEditingNodeIdOnCanvas(targetId);
    }
  }, [selectedInstanceIds, nodes, storeActions, rightPanelExpanded, setRightPanelExpanded, setEditingNodeIdOnCanvas]);

  const toggleSave = useCallback((instanceId = null) => {
    const targetId = instanceId || (selectedInstanceIds.size === 1 ? Array.from(selectedInstanceIds)[0] : null);
    if (!targetId) return;

    const node = nodes.find(n => n.id === targetId);
    if (node) {
      storeActions.toggleSavedNode(node.prototypeId);
    }
  }, [selectedInstanceIds, nodes, storeActions]);

  const showPalette = useCallback((instanceId = null) => {
    const targetId = instanceId || (selectedInstanceIds.size === 1 ? Array.from(selectedInstanceIds)[0] : null);
    if (!targetId) return;

    // Palette logic - would open color picker
    console.log('[useNodeActions] Show palette for node:', targetId);
  }, [selectedInstanceIds]);

  const showMore = useCallback((instanceId = null) => {
    const targetId = instanceId || (selectedInstanceIds.size === 1 ? Array.from(selectedInstanceIds)[0] : null);
    if (!targetId) return;

    // More options logic
    console.log('[useNodeActions] Show more options for node:', targetId);
  }, [selectedInstanceIds]);

  const createGroup = useCallback((instanceId = null) => {
    const targetId = instanceId || (selectedInstanceIds.size === 1 ? Array.from(selectedInstanceIds)[0] : null);
    if (!targetId) return;

    // Group creation logic
    console.log('[useNodeActions] Create group for node:', targetId);
  }, [selectedInstanceIds]);

  // Helper to check if a node is saved
  const isNodeSaved = useCallback((instanceId) => {
    const node = nodes.find(n => n.id === instanceId);
    return node && savedNodeIds.has(node.prototypeId);
  }, [nodes, savedNodeIds]);

  return {
    deleteNode,
    addNode,
    navigateUp,
    openInPanel,
    decompose,
    showAbstraction,
    editNode,
    toggleSave,
    showPalette,
    showMore,
    createGroup,
    isNodeSaved
  };
}
