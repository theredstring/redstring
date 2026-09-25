/**
 * Diving from a node-group into its definition graph (moved verbatim from
 * NodeCanvas's handleNodeGroupDiveIntoDefinition).
 */
import useGraphStore from '../../../store/graphStore.js';

export function diveIntoNodeGroupDefinition(startRect = null, ctx) {
  const {
    activeGraphId, nodePrototypesMap, selectedGroup, setGroupControlPanelVisible, setSelectedGroup, startHurtleAnimationFromPanel,
    storeActions,
  } = ctx;
  if (!activeGraphId || !selectedGroup?.linkedNodePrototypeId) return;

  const prototypeId = selectedGroup.linkedNodePrototypeId;
  const linkedPrototype = nodePrototypesMap.get(prototypeId);

  const openDefinitionGraph = (graphId) => {
    if (!graphId) return;

    if (startRect && typeof startHurtleAnimationFromPanel === 'function') {
      startHurtleAnimationFromPanel(prototypeId, graphId, prototypeId, startRect);
    } else if (typeof storeActions.openGraphTabAndBringToTop === 'function') {
      storeActions.openGraphTabAndBringToTop(graphId, prototypeId);
    } else if (typeof storeActions.openGraphTab === 'function') {
      storeActions.openGraphTab(graphId, prototypeId);
    } else if (typeof storeActions.setActiveGraph === 'function') {
      storeActions.setActiveGraph(graphId);
    } else {
      console.warn('No store action available to activate definition graph for node-group');
    }
  };

  if (linkedPrototype?.definitionGraphIds?.length) {
    openDefinitionGraph(linkedPrototype.definitionGraphIds[0]);
  } else if (typeof storeActions.createAndAssignGraphDefinitionWithoutActivation === 'function') {
    storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);

    setTimeout(() => {
      const refreshedPrototype = useGraphStore.getState().nodePrototypes.get(prototypeId);
      const newGraphId = refreshedPrototype?.definitionGraphIds?.[refreshedPrototype.definitionGraphIds.length - 1];

      if (newGraphId) {
        openDefinitionGraph(newGraphId);
      } else {
        console.warn('Node-group has no definition graph after creation attempt');
      }
    }, 50);
  } else {
    console.warn('Node-group has no definition graph and cannot create one');
  }

  setGroupControlPanelVisible(false);
  setSelectedGroup(null);
}
