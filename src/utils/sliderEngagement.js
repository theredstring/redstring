/**
 * "This slider is being used RIGHT NOW."
 *
 * Focus says which slider the next input will reach; this says which one is
 * actually moving. On a mouse those two collapse into one thing — the thumb is
 * under your cursor — but nowhere else do they: a controller sits focused on a
 * slider indefinitely without touching it, and a finger covers the thumb it is
 * dragging. Both need the control itself to say it is live.
 *
 * Marked as an ATTRIBUTE set imperatively rather than a React class, because
 * the gamepad walker (utils/gamepadMenuNav.js) drives these inputs from outside
 * React entirely. Routing the state through a `className` prop would mean React
 * rewriting the class attribute mid-drag and wiping the walker's own focus
 * class off the element it is driving. One imperative path serves every input
 * mode and touches nothing React owns.
 *
 * Every mode engages the same way; they differ only in how the release arrives:
 *   - pointer   explicit, on pointerup/pointercancel
 *   - keyboard  explicit, on keyup/blur
 *   - gamepad   implied, since a stick has no "released this control" event —
 *               `pulse` re-arms a short hold on each frame of drive instead.
 */

export const ENGAGED_ATTR = 'data-slider-engaged';

// Pending auto-release per element. WeakMap so a picker that unmounts mid-drag
// takes its entry with it.
const holds = new WeakMap();

const clearHold = (el) => {
  const timer = holds.get(el);
  if (timer) {
    clearTimeout(timer);
    holds.delete(el);
  }
};

/** Mark a slider as in use until `releaseSlider` says otherwise. */
export const engageSlider = (el) => {
  if (!el) return;
  clearHold(el);
  el.setAttribute(ENGAGED_ATTR, '');
};

/** Mark a slider as no longer in use. Safe to call on one that never was. */
export const releaseSlider = (el) => {
  if (!el) return;
  clearHold(el);
  el.removeAttribute(ENGAGED_ATTR);
};

/**
 * Mark a slider as in use, releasing itself shortly after the drive stops.
 *
 * For continuous sources with no release event — the analog stick, which simply
 * stops arriving at the deadzone. Each call pushes the release back out, so a
 * held stick stays lit and a single d-pad notch lights up long enough to read.
 *
 * @param {number} holdMs how long after the last call the mark lingers
 */
export const pulseSlider = (el, holdMs = 200) => {
  if (!el) return;
  engageSlider(el);
  holds.set(el, setTimeout(() => {
    holds.delete(el);
    el.removeAttribute(ENGAGED_ATTR);
  }, holdMs));
};
