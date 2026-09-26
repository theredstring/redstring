/**
 * The canvas's confirmations (P5.06b, moved from NodeCanvas state): "add these
 * nodes to this group?" after a drop onto a group, "make a self-loop?" after a
 * connection drawn back onto its own node, and "delete this definition?" from
 * the decompose pie, the bottom panel and the right panel's Web Definitions.
 * The callers open them; CanvasOverlaysHost renders them from this store.
 */
import { create } from 'zustand';

export const useCanvasDialogStore = create(() => ({
  addToGroupDialog: null, // { nodeIds, groupId, groupName, isNodeGroup, position }
  selfLoopDialog: null, // { sourceInstanceId, position }
  deleteDefinitionDialog: null, // { prototypeId, graphId } — see deleteDefinition.js
}));

export const setAddToGroupDialog = (addToGroupDialog) => useCanvasDialogStore.setState({ addToGroupDialog });
export const setSelfLoopDialog = (selfLoopDialog) => useCanvasDialogStore.setState({ selfLoopDialog });
export const setDeleteDefinitionDialog = (deleteDefinitionDialog) => useCanvasDialogStore.setState({ deleteDefinitionDialog });
