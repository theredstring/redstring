import { useEffect, useRef } from 'react';
import { clearLabelStabilization } from '../../../utils/canvas/labelStabilization.js';
import useGraphStore from '../../../store/graphStore.js';
import { applyOffscreenLayout } from '../../../services/offscreenLayout.js';

/** The rs-trigger-auto-layout listener (moved verbatim from NodeCanvas, wave 6). */
export function useAutoLayoutListener({
  draggingNodeInfoRef, isMouseDown, startedOnNode, triggerAutoLayout,
}) {
  // Listen for auto-layout trigger events from AI operations (mutations).
  //
  // The pending debounce lives in a ref, and the listener is registered ONCE,
  // because `triggerAutoLayout` changes identity on essentially every store
  // mutation (it closes over `nodes`/`edges`/`baseDimsById`/`graphsMap`). When
  // the timer was an effect-local `let` with the effect keyed on
  // [triggerAutoLayout, activeGraphId], the cleanup cancelled the pending
  // layout every time anything in the active graph changed — and nothing ever
  // rescheduled it. The wizard's first createPopulatedGraph is exactly that
  // case: it flips activeGraphId to the new graph and then keeps churning the
  // store (bulk update → cleanupOrphanedData → composition/unfold → Wikipedia
  // enrichment → thumbnail cache) straight through the 500ms window, so the
  // graph rendered with its random seed positions and layout never ran.
  const autoLayoutDebounceRef = useRef(null);
  const triggerAutoLayoutRef = useRef(triggerAutoLayout);
  useEffect(() => { triggerAutoLayoutRef.current = triggerAutoLayout; }, [triggerAutoLayout]);

  useEffect(() => {
    // Bound the "user is holding a node" retry so a held pointer can't re-arm
    // the timer forever.
    const MAX_HELD_RETRIES = 20; // 20 × 500ms = 10s
    let heldRetries = 0;

    // Tell the requester the canvas took responsibility for this graph. Wizard
    // mutations arm an offscreen-layout fallback on every dispatch and cancel it
    // on this ack — without it, a request that reached no live canvas would
    // leave the graph at its seed-random positions forever.
    const ack = (graphId) => {
      window.dispatchEvent(new CustomEvent('rs-auto-layout-ack', { detail: { graphId } }));
    };

    const runWhenFree = (graphId) => {
      autoLayoutDebounceRef.current = null;
      // Don't yank a node the user is currently grabbing/holding/dragging.
      // applyAutoLayoutToActiveGraph also guards the drag case, but the
      // pre-lift hold (mouse down on a node, not yet lifted) isn't a drag yet.
      if (draggingNodeInfoRef.current || (isMouseDown.current && startedOnNode.current)) {
        // Deferred, not dropped — ack so the fallback doesn't snap the graph out
        // from under the hand that's holding it, and retry.
        ack(graphId);
        if (heldRetries++ < MAX_HELD_RETRIES) {
          autoLayoutDebounceRef.current = setTimeout(() => runWhenFree(graphId), 500);
        }
        return;
      }
      heldRetries = 0;
      clearLabelStabilization();
      triggerAutoLayoutRef.current?.();
      ack(graphId);
    };

    const handleTriggerAutoLayout = (event) => {
      const { graphId } = event.detail || {};
      // Read the store rather than the render closure — the listener is
      // registered once, and the active graph may have changed since.
      const currentActiveGraphId = useGraphStore.getState().activeGraphId;

      if (!graphId || graphId === currentActiveGraphId) {
        // Active graph: use DOM-aware layout with debounce to batch rapid mutations
        if (autoLayoutDebounceRef.current) {
          clearTimeout(autoLayoutDebounceRef.current);
        }
        heldRetries = 0;
        autoLayoutDebounceRef.current = setTimeout(() => runWhenFree(graphId), 500);
      } else {
        // Non-active graph: apply offscreen layout so wizard-created graphs are
        // laid out even when the user isn't watching
        try { applyOffscreenLayout(graphId); } catch (e) {
          console.error('[NodeCanvas] Offscreen layout failed for non-active graph', graphId, e);
        }
        ack(graphId);
      }
    };

    window.addEventListener('rs-trigger-auto-layout', handleTriggerAutoLayout);

    return () => {
      if (autoLayoutDebounceRef.current) {
        clearTimeout(autoLayoutDebounceRef.current);
        autoLayoutDebounceRef.current = null;
      }
      window.removeEventListener('rs-trigger-auto-layout', handleTriggerAutoLayout);
    };
  }, []);

}
