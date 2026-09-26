/**
 * The graphStore action bag NodeCanvas and its hosts call (moved verbatim): the
 * store's own state object when it is ready, else inert fallbacks.
 */
import useGraphStore from '../../../store/graphStore.js';

/** The action bag (see the header). */
export function resolveStoreActions(ctx) {
  try {
    return useGraphStore.getState();
  } catch (error) {
    console.warn('[NodeCanvas] Store not ready, using fallback actions:', error);
    return {
      updateNodePrototype: () => { },
      updateNodeInstance: () => { },
      updateEdge: () => { },
      addEdge: () => { },
      addNodePrototype: () => { },
      addNodeInstance: () => { },
      removeNodeInstance: () => { },
      forceDeleteNodeInstance: () => { },
      removeEdge: () => { },
      updateGraph: () => { },
      createNewGraph: () => { },
      setActiveGraph: () => { },
      setActiveDefinitionNode: () => { },
      setSelectedEdgeId: () => { },
      setSelectedEdgeIds: () => { },
      addSelectedEdgeId: () => { },
      removeSelectedEdgeId: () => { },
      clearSelectedEdgeIds: () => { },
      setNodeType: () => { },
      openRightPanelNodeTab: () => { },
      openRightPanelGraphTab: () => { },
      createAndAssignGraphDefinition: () => { },
      createAndAssignGraphDefinitionWithoutActivation: () => { },
      closeRightPanelTab: () => { },
      activateRightPanelTab: () => { },
      openGraphTab: () => { },
      moveRightPanelTab: () => { },
      closeGraph: () => { },
      toggleGraphExpanded: () => { },
      toggleSavedNode: () => { },
      toggleSavedGraph: () => { },
      toggleShowConnectionNames: () => { },
      updateMultipleNodeInstancePositions: () => { },
      createGroup: () => { },
      updateGroup: () => { },
      deleteGroup: () => { },
      cleanupOrphanedGroupAnchors: () => { },
      removeDefinitionFromNode: () => { },
      openGraphTabAndBringToTop: () => { },
      cleanupOrphanedData: () => { },
      restoreFromSession: () => { },
      loadUniverseFromFile: () => { },
      setUniverseError: () => { },
      clearUniverse: () => { },
      setUniverseConnected: () => { },
      addToAbstractionChain: () => { },
      removeFromAbstractionChain: () => { },
      updateGraphView: () => { },
      setTypeListMode: () => { },
      toggleEnableAutoRouting: () => { },
      setRoutingStyle: () => { },
      setCleanLaneSpacing: () => { },
      setLayoutScalePreset: () => { },
      setLayoutScaleMultiplier: () => { },
      setLayoutIterationPreset: () => { },
      deleteNodePrototype: () => { },
      deleteGraph: () => { },
      setGroupLayoutAlgorithm: () => { },
      toggleShowClusterHulls: () => { }
    };
  }
}
