import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_ORBIT } from './orbitConstants.js';
import { fetchOrbitCandidates, hoverOrbitCandidate, sizeOrbitDimRect } from './orbitData.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { placeOrbitCandidate } from './orbitActions.js';
import OrbitOverlay from '../../OrbitOverlay.jsx';

/** The semantic orbit: its candidates and loading state, the dim rect, the fetch, leaving orbit on deselect or exit, placing a clicked candidate, and the overlay NodeLayer places around the active node (moved verbatim from NodeCanvas, P5.08). */
export function useSemanticOrbit({
  ENABLE_ORBIT_DIM, ORBIT_DIM_MARGIN, activeGraphId, baseDimsById, canvasSize, clearHoverImmediate,
  commitHoverTarget, gridMode, nodePrototypesMap, nodes, orbitControlRef, overlayGroupEl,
  panOffsetRef, selectedInstanceIds, semanticOrbitActive, semanticOrbitActiveRef,
  setNodeControlPanelShouldShow, setNodeControlPanelVisible, setOrbitFrame, snapToGridAnimated,
  storeActions, transform, viewportSizeRef, zoomLevelRef,
}) {
  const [orbitData, setOrbitDataState] = useState(EMPTY_ORBIT);
  const [orbitLoading, setOrbitLoadingState] = useState(false);
  // What each was last set to, pending updates included, so the search
  // effect's reset can skip a same-value set (render sweep).
  const orbitSetRef = useRef({ data: EMPTY_ORBIT, loading: false });
  const setOrbitData = useCallback((v) => { orbitSetRef.current.data = v; setOrbitDataState(v); }, []);
  const setOrbitLoading = useCallback((v) => { orbitSetRef.current.loading = v; setOrbitLoadingState(v); }, []);

  // Sync semanticOrbitActive ref for RAF callbacks
  useEffect(() => {
    semanticOrbitActiveRef.current = semanticOrbitActive;
    // Crossing the boundary in either direction retires whatever was hovered on
    // the other side of it. The RAF hover check no longer clears per-frame
    // during orbit (an orbit item's hover bubbles through it), so this is the
    // one place the canvas's own hover is dropped on the way in — and on the
    // way out it drops the candidate, which no longer exists.
    clearHoverImmediate();
  }, [semanticOrbitActive, clearHoverImmediate]);

  // Keep the orbit dim rect sized to the visible viewport (plus a full viewport
  // of margin per side) instead of the whole 100000px canvas plane. A full-plane
  // rect's transformed bounds at high zoom are enormous, which thrashes the SVG
  // renderer's tile cache during the per-frame repaints orbit mode causes.
  // Sized imperatively on every pan/zoom tick (canvas-transform-change fires
  // synchronously from the transform mutators) so it never lags a gesture the
  // way settled-state (150ms debounce) sizing did.
  const orbitDimRectRef = useRef(null);
  const updateOrbitDimRect = useCallback((...args) => sizeOrbitDimRect({
    orbitDimRectRef, ENABLE_ORBIT_DIM, panOffsetRef, zoomLevelRef, viewportSizeRef, canvasSize,
    ORBIT_DIM_MARGIN,
  }, ...args), [canvasSize]);

  // Seed the orbit layer with the current transform the moment it mounts. Pan
  // and zoom write to it from then on, but nothing fires between mount and the
  // next interaction, so without this the layer would start at identity and the
  // focus node would appear at raw canvas coords until the user moved.
  useEffect(() => {
    if (overlayGroupEl) transform.applyTransform();
  }, [overlayGroupEl, transform.applyTransform]);

  useEffect(() => {
    if (!semanticOrbitActive || !ENABLE_ORBIT_DIM) return;
    updateOrbitDimRect();
    window.addEventListener('canvas-transform-change', updateOrbitDimRect);
    return () => window.removeEventListener('canvas-transform-change', updateOrbitDimRect);
  }, [semanticOrbitActive, updateOrbitDimRect, ENABLE_ORBIT_DIM]);

  // Fetch orbit candidates only when orbit mode is explicitly active
  useEffect(() => fetchOrbitCandidates({
    semanticOrbitActive, selectedInstanceIds, orbitSetRef, EMPTY_ORBIT, setOrbitData, setOrbitLoading,
    activeGraphId,
  }), [semanticOrbitActive, selectedInstanceIds, activeGraphId]);

  // Exit orbit mode when node is deselected
  useEffect(() => {
    if (selectedInstanceIds.size === 0 && semanticOrbitActive) {
      useCanvasUIStore.getState().dispatchPie({ type: 'ORBIT', active: false });
      setOrbitData(EMPTY_ORBIT);
    }
  }, [selectedInstanceIds, semanticOrbitActive]);

  /**
   * An orbit candidate took (or lost) focus — from the pointer crossing it, or
   * from the stick aiming at it. Goes through the same dwell timer every other
   * hover does, so the preview behaves identically whichever raised it.
   *
   * What gets previewed is the TRIPLET the candidate would become if it were
   * placed: focus node —predicate→ candidate, in the same payload shape the
   * edge hit test produces, so the aid draws it with the connection recipe and
   * knows nothing about orbit. A lone node box would only repeat what the orbit
   * already draws; the relationship is the thing that is actually on offer.
   */
  const handleOrbitCandidateHover = useCallback((...args) => hoverOrbitCandidate({
    selectedInstanceIds, nodes, commitHoverTarget, baseDimsById,
  }, ...args), [commitHoverTarget, selectedInstanceIds, nodes, baseDimsById]);

  // Exit orbit mode callback
  const exitOrbitMode = useCallback(() => {
    useCanvasUIStore.getState().dispatchPie({ type: 'ORBIT', active: false });
    setOrbitData(EMPTY_ORBIT);
    setOrbitLoading(false);
    // Re-show control panel if nodes still selected
    if (selectedInstanceIds.size > 0) {
      setNodeControlPanelVisible(true);
      setNodeControlPanelShouldShow(true);
    }
  }, [selectedInstanceIds]);

  // Click-to-materialize: clicking an orbit item creates a real node at its position
  /**
   * Place a clicked orbit item into the graph, where it was.
   *
   * `centerX` / `centerY` are the item's CENTRE in canvas coordinates, resolved
   * live by OrbitOverlay. Node positions are top-left, so the centring happens
   * here, once, against the dimensions the placed node will actually have —
   * which are not necessarily the orbit item's, since the prototype may carry a
   * type or definitions the orbit preview did not.
   */
  const handleOrbitItemClick = useCallback((candidate, centerX, centerY, dims) => placeOrbitCandidate(candidate, centerX, centerY, dims, {
    activeGraphId, exitOrbitMode, gridMode, nodePrototypesMap, selectedInstanceIds, snapToGridAnimated,
    storeActions,
  }), [activeGraphId, nodePrototypesMap, selectedInstanceIds, storeActions, gridMode, snapToGridAnimated, exitOrbitMode]);

  // The orbit overlay around the active node while orbiting (NodeLayer places it).
  const renderOrbitOverlay = useCallback((centerX, centerY, focusWidth, focusHeight) => (
    <OrbitOverlay
      centerX={centerX}
      centerY={centerY}
      focusWidth={focusWidth}
      focusHeight={focusHeight}
      ring1Candidates={orbitData.ring1 || []}
      ring2Candidates={orbitData.ring2 || []}
      ring3Candidates={orbitData.ring3 || []}
      ring4Candidates={orbitData.ring4 || []}
      onOrbitItemClick={handleOrbitItemClick}
      onExtentChange={setOrbitFrame}
      onCandidateHover={handleOrbitCandidateHover}
      controlRef={orbitControlRef}
      onExit={exitOrbitMode}
      isLoading={orbitLoading}
    />
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setOrbitFrame and orbitControlRef are stable
  ), [orbitData, orbitLoading, handleOrbitItemClick, handleOrbitCandidateHover, exitOrbitMode]);

  return { orbitDimRectRef, updateOrbitDimRect, exitOrbitMode, renderOrbitOverlay };
}
