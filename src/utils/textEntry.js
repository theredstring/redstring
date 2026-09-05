/**
 * Text-entry focus detection.
 *
 * Canvas shortcuts are registered on `window`, so they also fire while the user
 * is typing in a panel field, the wizard chat, or any inline editor. Destructive
 * shortcuts — Delete/Backspace above all — must never reach the canvas in that
 * case: a Backspace meant to erase a character would delete the selected nodes.
 *
 * The panels report focus through `onFocusChange` props, but that only covers
 * fields that were wired up to do so. Asking the DOM instead covers every text
 * field, including ones added later.
 */

/**
 * True when the element accepts typed text.
 *
 * `isContentEditable` is used rather than the `contentEditable` attribute
 * because it is inherited: it is true for elements *inside* an editable region,
 * which is where the event target usually lands. It also covers
 * `contenteditable="plaintext-only"`.
 *
 * Non-text inputs (checkbox, radio, button, range, color) are excluded — those
 * are focusable but do not consume Backspace.
 *
 * @param {EventTarget | null | undefined} target
 * @returns {boolean}
 */
export const isTextEntryTarget = (target) => {
  if (!target || typeof target !== 'object') return false;

  const { tagName, isContentEditable, type } = /** @type {HTMLElement & { type?: string }} */ (target);

  if (isContentEditable === true) return true;
  if (tagName === 'TEXTAREA') return true;
  if (tagName === 'INPUT') {
    const inputType = (type || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }
  return false;
};

const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden',
  'image', 'radio', 'range', 'reset', 'submit'
]);

/**
 * True when a keyboard event originated from — or landed while focus sat in —
 * a text field. Both the event target and the focused element are checked: a
 * handler on `window` sees the target, but a key pressed with focus in a field
 * that does not itself receive the event (portals, overlays) only shows up in
 * `document.activeElement`.
 *
 * @param {KeyboardEvent} [event]
 * @returns {boolean}
 */
export const isTextEntryActive = (event) => {
  if (event && isTextEntryTarget(event.target)) return true;
  return isTextEntryTarget(typeof document !== 'undefined' ? document.activeElement : null);
};
