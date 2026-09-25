/**
 * The abstraction carousel's callbacks and its axes (P5.04, moved from
 * NodeCanvas). The callbacks only report to the pie machine, so they are plain
 * functions; the axes live in canvasUIStore, where the carousel, its control
 * panel, the pie builders and the Add Above/Below prompt read them.
 */
import useCanvasUIStore from '../../../store/canvasUIStore.js';

const dispatchPie = (event) => useCanvasUIStore.getState().dispatchPie(event);

// The carousel's own timers report through the pie machine (P5.02b step 4). The
// callbacks are stable, so a web change doesn't restart the carousel's 200 ms
// exit timer (P5.02a NEW-3, the one intended timing change).
export function onCarouselAnimationStateChange() {
  dispatchPie({ type: 'CAROUSEL_ENTERED' });
}

export function onCarouselClose() {
  // Behave EXACTLY like the Stage-1 "Back" button: run the normal pie-menu
  // shrink → onExitAnimationComplete → carousel-exit chain, and let the pie
  // menu reopen on the node afterward (CAROUSEL_CLOSE in the pie machine).
  //
  // Do NOT null selectedNodeIdForPieMenu or flag a click-away dismissal here.
  // Nulling the selection unmounts the pie menu before its exit animation can
  // fire, so onExitAnimationComplete never runs and isTransitioningPieMenu gets
  // stuck true — which permanently disables the pie menu until refresh.
  dispatchPie({ type: 'CAROUSEL_CLOSE' });
}

// Touch's way in to the same exit, handed to the carousel as onRequestClose.
//
// The carousel dismisses itself on a click outside — but it listens for
// `mousedown`, and its own touchstart calls preventDefault(), which suppresses
// the compatibility mouse events entirely. So on a touch device that listener
// never fires; the carousel's touch state machine resolves the tap itself and
// calls this instead.
//
// It can't simply call onCarouselClose. That routes the exit through the pie
// menu's shrink animation, and when no pie menu is up there is nothing to
// animate — so the exit chain hanging off it never runs and the carousel stays
// up for good, over a node the canvas is already hiding, with the pie menu
// permanently disabled. That is the frozen node. The mouse is covered by
// handleCanvasClick's own defensive branch; touch has no equivalent, which is
// what the no-pie-menu teardown is for: with no pie menu up there is nothing to
// animate out, and the exit chain hangs off that animation, so the machine tears
// the carousel down directly (CAROUSEL_TOUCH_CLOSE → CAROUSEL_TEARDOWN), as
// handleCanvasClick's defensive branch does for the mouse.
//
// Idempotent (carouselCloseRequested) because a second request part-way through
// the exit would restart the transition.
export function requestCarouselClose() {
  if (!useCanvasUIStore.getState().abstractionCarouselVisible) return false;
  dispatchPie({ type: 'CAROUSEL_TOUCH_CLOSE' });
  return true;
}

export function onCarouselReplaceNode() {
  // TODO: Implement node replacement functionality
}

// ─── Abstraction axes (the carousel's control panel) ─────────────────────────

export function changeAbstractionDimension(newDimension) {
  useCanvasUIStore.setState({ currentAbstractionDimension: newDimension });
}

export function addAbstractionDimension(newDimensionName) {
  useCanvasUIStore.setState((st) => ({
    abstractionDimensions: [...st.abstractionDimensions, newDimensionName],
    currentAbstractionDimension: newDimensionName,
  }));
}

export function deleteAbstractionDimension(dimensionToDelete) {
  useCanvasUIStore.setState((st) => {
    const newDimensions = st.abstractionDimensions.filter(dim => dim !== dimensionToDelete);
    // If we're deleting the current dimension, switch to the first remaining one
    const switchTo = dimensionToDelete === st.currentAbstractionDimension && newDimensions.length > 0;
    return {
      abstractionDimensions: newDimensions,
      ...(switchTo ? { currentAbstractionDimension: newDimensions[0] } : {}),
    };
  });
}

export function expandAbstractionDimension() {
  // For now, just open the node in a new tab
  // In the future, this could create/open a graph definition for the abstraction chain

  // Could implement hurtle animation here similar to other expand buttons
}
