// The tab a middle press started on, until its release.
let pressedElement = null;

/**
 * Middle-click handlers for a tab: the browser convention for "close this tab".
 *
 * Built from mousedown + mouseup rather than `auxclick`, which WebKit only
 * recently grew. The press is remembered by element so a middle button pressed
 * on one tab and released over another closes neither. The mousedown's
 * preventDefault keeps Windows from entering autoscroll and Linux from pasting
 * the primary selection on release.
 *
 * @param {(e: MouseEvent) => void} onMiddleClick
 * @returns {{ onMouseDown: Function, onMouseUp: Function }} Spread onto the tab.
 */
export const middleClickHandlers = (onMiddleClick) => ({
  onMouseDown: (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    pressedElement = e.currentTarget;
  },
  onMouseUp: (e) => {
    if (e.button !== 1) return;
    const pressed = pressedElement;
    pressedElement = null;
    if (pressed !== e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    onMiddleClick(e);
  }
});
