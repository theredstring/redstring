/**
 * The canvas's three colour pickers (P5.06b, moved from NodeCanvas): the dialog
 * picker (a group's colour, from the group control panel), the Thing picker
 * (Palette on the pie, the control panel and the context menu) and the
 * connection picker (Palette on the connection pie). Their state is a small
 * store, so the menus that open them call plain functions here instead of
 * NodeCanvas callbacks; `ColorPickersHost` renders them and applies the colour.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import useCanvasUIStore from '../../../store/canvasUIStore.js';

export const useColorPickerStore = create(() => ({
  // Dialog color picker state
  dialogColorPickerVisible: false,
  dialogColorPickerPosition: { x: 0, y: 0 },
  colorPickerTarget: null, // { type: 'node_prompt' | 'connection_prompt' | 'group', id: string }
  // Pie menu color picker state
  pieMenuColorPickerVisible: false,
  pieMenuColorPickerPosition: { x: 0, y: 0 },
  activePieMenuColorNodeId: null,
  // Connection color picker. Kept separate from the node one above because it
  // targets a prototype directly: a connection has no instance to look a
  // prototypeId up from, it just points at the Thing that defines it.
  edgeColorPickerVisible: false,
  edgeColorPickerPosition: { x: 0, y: 0 },
  activeEdgeColorPrototypeId: null,
}));

const set = (patch) => useColorPickerStore.setState(patch);
const get = () => useColorPickerStore.getState();

export const setDialogColorPickerVisible = (visible) => set({ dialogColorPickerVisible: visible });

/** The group control panel's colour button (was handleGroupPanelColor). */
export function openGroupColorPicker(groupId, e) {
  // Stop propagation if event exists
  if (e && e.stopPropagation) e.stopPropagation();

  // Position the color picker near the clicked element if possible
  let position;
  if (e && e.currentTarget) {
    const rect = e.currentTarget.getBoundingClientRect();
    position = { x: rect.right, y: rect.bottom };
  } else {
    // Fallback center position or mouse position if we tracked it
    position = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  set({ dialogColorPickerPosition: position, colorPickerTarget: { type: 'group', id: groupId }, dialogColorPickerVisible: true });
}

export function closeDialogColorPicker() {
  set({ dialogColorPickerVisible: false, colorPickerTarget: null });
}

/** Palette for a Thing: opens the picker on an instance, or closes it when it is already open on that instance. */
export function togglePieMenuColorPicker(nodeId, position) {
  const { pieMenuColorPickerVisible, activePieMenuColorNodeId } = get();
  // If already open for the same node, close it (toggle behavior)
  if (pieMenuColorPickerVisible && activePieMenuColorNodeId === nodeId) {
    closePieMenuColorPicker();
    return;
  }
  set({ pieMenuColorPickerPosition: position, pieMenuColorPickerVisible: true, activePieMenuColorNodeId: nodeId });
}

export function closePieMenuColorPicker() {
  set({ pieMenuColorPickerVisible: false, activePieMenuColorNodeId: null });
}

// Connection color picker. Recolours the Thing that defines the connection, so
// every connection of that kind changes together — the same relationship a
// node's Palette has with its prototype, and the reason a connection with no
// definition yet has no Palette button to press (see edgePieMenuButtons).
export function toggleEdgeColorPicker(prototypeId, position) {
  if (!prototypeId) return;
  const { edgeColorPickerVisible, activeEdgeColorPrototypeId } = get();
  if (edgeColorPickerVisible && activeEdgeColorPrototypeId === prototypeId) {
    closeEdgeColorPicker();
    return;
  }
  // The picker belongs to a selected connection (see useColorPickerAutoClose);
  // with none selected it would be closed again straight away.
  const { selectedEdgeId, selectedEdgeIds } = useCanvasUIStore.getState();
  if (!selectedEdgeId && !(selectedEdgeIds?.size > 0)) return;
  set({
    edgeColorPickerPosition: position || { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    edgeColorPickerVisible: true,
    activeEdgeColorPrototypeId: prototypeId,
  });
}

export function closeEdgeColorPicker() {
  set({ edgeColorPickerVisible: false, activeEdgeColorPrototypeId: null });
}

/** Closes each picker when the thing it belongs to goes away. */
export function useColorPickerAutoClose({ nodeNamePromptVisible, hasPieMenuData, selectedNodeIdForPieMenu, selectedEdgeId, selectedEdgeIds }) {
  // Close dialog color picker when node name prompt closes
  useEffect(() => {
    if (!nodeNamePromptVisible) {
      setDialogColorPickerVisible(false);
    }
  }, [nodeNamePromptVisible]);

  // Close pie menu color picker when pie menu disappears
  useEffect(() => {
    if (!hasPieMenuData || !selectedNodeIdForPieMenu) {
      closePieMenuColorPicker();
    }
  }, [hasPieMenuData, selectedNodeIdForPieMenu]);

  // Deselecting the connection takes its picker with it — both menus that can
  // open it are gone by then, so it would otherwise be left floating with
  // nothing on screen explaining what it's colouring.
  useEffect(() => {
    if (!get().edgeColorPickerVisible) return;
    if (selectedEdgeId || selectedEdgeIds.size > 0) return;
    closeEdgeColorPicker();
  }, [selectedEdgeId, selectedEdgeIds]);
}
