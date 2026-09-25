/**
 * The canvas's two confirmations (P5.06b, moved from NodeCanvas state): "add
 * these nodes to this group?" after a drop onto a group, and "make a self-loop?"
 * after a connection drawn back onto its own node. The pointer handlers open
 * them; CanvasOverlaysHost renders them from this store.
 */
import { create } from 'zustand';

export const useCanvasDialogStore = create(() => ({
  addToGroupDialog: null, // { nodeIds, groupId, groupName, isNodeGroup, position }
  selfLoopDialog: null, // { sourceInstanceId, position }
}));

export const setAddToGroupDialog = (addToGroupDialog) => useCanvasDialogStore.setState({ addToGroupDialog });
export const setSelfLoopDialog = (selfLoopDialog) => useCanvasDialogStore.setState({ selfLoopDialog });
