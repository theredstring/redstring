import useCanvasUIStore from '../../store/canvasUIStore.js';
import { hasNoHover } from '../inputDeviceAnalysis.js';

/**
 * The vision-aid chip for buttons (P2.13): pie, header, panels and control
 * panels all report hover here, a stable function that writes canvasUIStore.
 * It used to be NodeCanvas's handlePieMenuHoverChange, so every button hover
 * re-rendered the canvas.
 */

// How long a tapped button's label stays up on a no-hover device before it
// starts retracting.
export const VISION_AID_TOUCH_HOLD_MS = 1000;

let autoClearTimer = null;
const setItem = (item) => useCanvasUIStore.getState().setActivePieMenuItemForVision(item);

/**
 * Show `button`'s label ({ id, label }), or clear it with null.
 *
 * On a device that can't hover there is no pointer-leave to take the chip back
 * down, so a label raised by a tap would sit there until something else
 * happened to replace it. Instead, show it and retract it on a timer: the tap
 * reveals what the button was, then it gets out of the way. HoverVisionAid's
 * own hold-then-fade turns the clear into a graceful exit rather than a pop.
 * Hover devices are untouched: the pointer governs.
 */
export function setActionHover(button) {
  clearTimeout(autoClearTimer);
  autoClearTimer = null;
  if (button?.label) {
    setItem({ id: button.id, label: button.label });
    if (hasNoHover()) {
      autoClearTimer = setTimeout(() => {
        autoClearTimer = null;
        setItem(null);
      }, VISION_AID_TOUCH_HOLD_MS);
    }
  } else {
    setItem(null);
  }
}

/** The button currently shown, or null. */
export const getActionHoverItem = () => useCanvasUIStore.getState().activePieMenuItemForVision;
