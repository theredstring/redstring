import { useEffect } from 'react';
import { useDragDropManager } from 'react-dnd';

// While a drag is in progress <html> carries this class (index.css): no text
// selection along the way, and a grabbing cursor wherever the pointer goes.
export const DRAGGING_CLASS = 'rs-dragging';

const isEditable = (el) => !!el && (
  el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
);

/**
 * What the browser's native drag and drop did for free, kept now that drags run
 * on pointer events (bootApp.jsx explains why):
 *
 * - A file or link dragged in from outside and let go anywhere that isn't a
 *   text field would replace the whole page with it. Refused, as the native
 *   backend refused it.
 * - Letting go of a drag over the element it started on also lands as a click
 *   on it — a web's row or tab would switch to that web. The native drag ate
 *   that click; this eats it too, once, right after a drag ends.
 * - Moving with the button held selects text along the way. Not while dragging.
 *
 * Renders nothing; mount once inside the DndProvider.
 */
export default function DragSessionGuards() {
  const monitor = useDragDropManager().getMonitor();

  useEffect(() => {
    const refuseNativeDrop = (e) => {
      if (!isEditable(e.target)) e.preventDefault();
    };
    window.addEventListener('dragover', refuseNativeDrop);
    window.addEventListener('drop', refuseNativeDrop);

    let wasDragging = false;
    let swallowClick = false;
    let releaseTimer = null;
    const onClickCapture = (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('click', onClickCapture, true);

    const unsubscribe = monitor.subscribeToStateChange(() => {
      const dragging = monitor.isDragging();
      if (dragging === wasDragging) return;
      wasDragging = dragging;
      document.documentElement.classList.toggle(DRAGGING_CLASS, dragging);
      if (dragging) {
        window.getSelection?.()?.removeAllRanges();
        return;
      }
      // The click a release produces is dispatched in the same task as the
      // release itself, so it is caught before this timer clears the flag.
      swallowClick = true;
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => { swallowClick = false; }, 0);
    });

    return () => {
      unsubscribe();
      clearTimeout(releaseTimer);
      window.removeEventListener('dragover', refuseNativeDrop);
      window.removeEventListener('drop', refuseNativeDrop);
      window.removeEventListener('click', onClickCapture, true);
      document.documentElement.classList.remove(DRAGGING_CLASS);
    };
  }, [monitor]);

  return null;
}
