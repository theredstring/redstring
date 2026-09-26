/**
 * Deleting one of a Thing's definitions, from anywhere that offers it: the
 * decompose pie, the bottom control panel in decompose mode, and the right
 * panel's Web Definitions section. Every one of them asks first
 * (`requestDeleteDefinition`); the dialog in CanvasOverlaysHost calls
 * `deleteDefinition` on confirm.
 */
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { setDeleteDefinitionDialog } from './canvasDialogs.js';

/** Open the confirmation for deleting `graphId` from `prototypeId`'s definitions. */
export function requestDeleteDefinition(prototypeId, graphId) {
  if (!prototypeId || !graphId) return;
  setDeleteDefinitionDialog({ prototypeId, graphId });
}

/**
 * What the dialog says: which Thing, which definition of how many, and whether
 * the Web goes with it (it stays when another Thing also uses it as a definition).
 * Null when the definition is already gone.
 */
export function describeDefinitionDeletion(prototypeId, graphId) {
  const { nodePrototypes, graphs } = useGraphStore.getState();
  const proto = nodePrototypes.get(prototypeId);
  const defIds = Array.isArray(proto?.definitionGraphIds) ? proto.definitionGraphIds : [];
  const position = defIds.indexOf(graphId);
  if (position < 0) return null;
  let sharedWith = 0;
  for (const other of nodePrototypes.values()) {
    if (other.id !== prototypeId && other.definitionGraphIds?.includes(graphId)) sharedWith += 1;
  }
  const graph = graphs.get(graphId);
  return {
    nodeName: proto.name || 'this Thing',
    webName: graph?.name?.trim() || null,
    number: position + 1,
    total: defIds.length,
    componentCount: graph?.instances?.size || 0,
    sharedWith,
  };
}

/**
 * Remove the definition, then keep every context's definition index pointing at
 * the same definition it showed (or the nearest one, when it was the deleted one).
 */
export function deleteDefinition(prototypeId, graphId) {
  const proto = useGraphStore.getState().nodePrototypes.get(prototypeId);
  const defIds = Array.isArray(proto?.definitionGraphIds) ? proto.definitionGraphIds : [];
  const removedAt = defIds.indexOf(graphId);
  if (removedAt < 0) return;
  const lastIndex = Math.max(0, defIds.length - 2);

  const ui = useCanvasUIStore.getState();
  const prefix = `${prototypeId}-`;
  let next = null;
  ui.nodeDefinitionIndices.forEach((index, key) => {
    if (!key.startsWith(prefix)) return;
    const shifted = Math.min(index > removedAt ? index - 1 : index, lastIndex);
    if (shifted !== index) (next ??= new Map(ui.nodeDefinitionIndices)).set(key, shifted);
  });
  if (next) ui.setNodeDefinitionIndices(next);

  useGraphStore.getState().removeDefinitionFromNode(prototypeId, graphId);

  // A Web that went with its definition takes its panel tab with it.
  const after = useGraphStore.getState();
  if (!after.graphs.has(graphId) && after.rightPanelTabs?.some((tab) => tab.type === 'graph' && tab.graphId === graphId)) {
    after.closeRightPanelTab(graphId);
  }
}
