import { useCallback, useEffect, useRef } from 'react';
import useCanvasUIStore from '../store/canvasUIStore.js';

/**
 * Canvas hover intent (P2.13, moved from NodeCanvas): the dwell timer that
 * decides which node, connection or orbit item counts as hovered, and writes
 * it to the vision aid (canvasUIStore) and the edge renderer's hoveredEdgeInfo.
 *
 * @param {object} p
 * @param {(info: object|null) => void} p.setHoveredEdgeInfo  NodeCanvas state
 *   the edge renderer reads (until the edge layer, P3.06).
 * @param {{ current: boolean }} p.semanticOrbitActiveRef
 * @returns {{ commitHoverTarget: Function, clearHoverImmediate: Function, hoverStickyEdgeId: Function }}
 */
export function useHoverIntent({ setHoveredEdgeInfo, semanticOrbitActiveRef }) {
  const { setHoveredNodeForVision, setHoveredConnectionForVision } = useCanvasUIStore.getState();

  // Hover intent delay: require the pointer to dwell on a target for a short
  // beat before we treat it as "hovered". Prevents the vision aid / edge glow
  // from flickering on as the pointer merely sweeps across nodes and edges.
  const HOVER_ENTER_DELAY_MS = 180;
  const hoverCommitTimerRef = useRef(null);
  const committedHoverKeyRef = useRef('none');
  const pendingHoverKeyRef = useRef('none');

  const applyHoverCandidate = useCallback((candidate) => {
    if (candidate.kind === 'node') {
      setHoveredNodeForVision(candidate.node);
      setHoveredConnectionForVision(null);
      setHoveredEdgeInfo(null);
    } else if (candidate.kind === 'connection' || candidate.kind === 'orbitItem') {
      // An orbit item previews as the triplet it would become — focus node,
      // predicate, candidate — not as a lone box. The box on its own says
      // nothing the orbit isn't already showing; the relationship is the whole
      // reason the thing is out there. It carries no edgeInfo because there is
      // no edge on the canvas to glow yet.
      setHoveredNodeForVision(null);
      setHoveredConnectionForVision(candidate.connection);
      setHoveredEdgeInfo(candidate.edgeInfo ?? null);
    } else {
      setHoveredNodeForVision(null);
      setHoveredConnectionForVision(null);
      setHoveredEdgeInfo(null);
    }
  }, []);

  // Cancel any pending dwell timer and clear all hover state immediately.
  const clearHoverImmediate = useCallback(() => {
    if (hoverCommitTimerRef.current) {
      clearTimeout(hoverCommitTimerRef.current);
      hoverCommitTimerRef.current = null;
    }
    pendingHoverKeyRef.current = 'none';
    committedHoverKeyRef.current = 'none';
    setHoveredNodeForVision(null);
    setHoveredConnectionForVision(null);
    setHoveredEdgeInfo(null);
  }, []);

  // The connection the hover hit-test should favour on the next frame: the one
  // on screen, or the one counting down toward being on screen. A target that
  // is mid-dwell gets the same protection as a committed one — otherwise a
  // rival that ties it for a frame resets the countdown and hover never
  // arrives. See EDGE_HOVER_STICKY_FRACTION.
  const hoverStickyEdgeId = useCallback(() => {
    const PREFIX = 'connection:';
    for (const key of [committedHoverKeyRef.current, pendingHoverKeyRef.current]) {
      if (key.startsWith(PREFIX)) return key.slice(PREFIX.length);
    }
    return null;
  }, []);

  // Route a detected hover candidate through the dwell timer. Entering a target
  // waits HOVER_ENTER_DELAY_MS; leaving a target (or landing on empty canvas)
  // clears instantly so nothing gets "stuck" behind the pointer.
  const commitHoverTarget = useCallback((candidate) => {
    // While the orbit is open the graph is behind a scrim and is not what the
    // user is looking at — so the canvas has nothing to preview, focus node
    // included. Enforced HERE rather than at each caller because there are
    // several (the mouse's RAF hover check, the controller's per-frame
    // resolve), and one of them missing it is how the focus node came to raise
    // a preview under the pad. Orbit's own items are the exception: they are
    // the only thing on screen worth previewing while it is open.
    if (semanticOrbitActiveRef.current
      && (candidate.kind === 'node' || candidate.kind === 'connection')) {
      candidate = { kind: 'none' };
    }
    const key = candidate.kind === 'none' ? 'none' : `${candidate.kind}:${candidate.id}`;

    if (key === 'none') {
      if (committedHoverKeyRef.current !== 'none' || pendingHoverKeyRef.current !== 'none') {
        clearHoverImmediate();
      }
      return;
    }

    // Already showing this exact target — nothing to do.
    if (key === committedHoverKeyRef.current) {
      if (hoverCommitTimerRef.current) {
        clearTimeout(hoverCommitTimerRef.current);
        hoverCommitTimerRef.current = null;
      }
      pendingHoverKeyRef.current = key;
      return;
    }

    // This target is already counting down — let its timer keep running.
    if (key === pendingHoverKeyRef.current && hoverCommitTimerRef.current) return;

    // New target: start its dwell timer, and leave whatever is currently shown
    // ALONE until that timer fires.
    //
    // Blanking here instead meant every rival that got within the grab radius
    // — for a frame, for a pixel of jitter — tore down a preview that was
    // correct, and the user paid HOVER_ENTER_DELAY_MS of empty canvas whether
    // or not the rival went on to win. applyHoverCandidate replaces all three
    // pieces of hover state at once, so the swap at commit time is clean and
    // there is nothing this early teardown was buying. Leaving a target
    // entirely still clears instantly, above.
    if (hoverCommitTimerRef.current) clearTimeout(hoverCommitTimerRef.current);
    pendingHoverKeyRef.current = key;
    hoverCommitTimerRef.current = setTimeout(() => {
      hoverCommitTimerRef.current = null;
      committedHoverKeyRef.current = key;
      applyHoverCandidate(candidate);
    }, HOVER_ENTER_DELAY_MS);
  }, [applyHoverCandidate, clearHoverImmediate]);

  useEffect(() => () => {
    if (hoverCommitTimerRef.current) clearTimeout(hoverCommitTimerRef.current);
  }, []);

  return { commitHoverTarget, clearHoverImmediate, hoverStickyEdgeId };
}
