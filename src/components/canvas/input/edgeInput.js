/**
 * Connection input (moved verbatim from NodeCanvas): the nearest-edge hit test
 * against the live camera, click selection that prefers the hovered connection,
 * and the touch and hitbox handler sets each connection's hit stroke spreads.
 * NodeCanvas wraps each in a useCallback with its original dependencies.
 */
import { haptic } from '../../../services/haptics.js';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { clientToCanvas } from '../../../utils/canvas/viewportMath.js';

/** The mouse handlers a connection's hit stroke spreads. */
export function edgeHitboxHandlersFor(ctx, edgeId) {
  const { edgeTouchHandlers, ignoreCanvasClick, selectedEdgeIds, storeActions } = ctx;
  return ({
    ...edgeTouchHandlers(edgeId),
    onClick: (e) => {
      e.stopPropagation();
      ignoreCanvasClick.current = true;
      haptic('edgeSelect');
      if (e.ctrlKey || e.metaKey) {
        if (selectedEdgeIds.has(edgeId)) {
          storeActions.removeSelectedEdgeId(edgeId);
        } else {
          storeActions.addSelectedEdgeId(edgeId);
        }
      } else {
        storeActions.clearSelectedEdgeIds();
        storeActions.setSelectedEdgeId(edgeId);
      }
    },
    onDoubleClick: (e) => {
      e.stopPropagation();
      const state = useGraphStore.getState();
      const edge = state.edges?.get?.(edgeId);
      let definingNodeId = null;
      if (edge?.definitionNodeIds && edge.definitionNodeIds.length > 0) {
        definingNodeId = edge.definitionNodeIds[0];
      } else if (edge?.typeNodeId) {
        definingNodeId = edge.typeNodeId;
      }
      if (definingNodeId) {
        storeActions.openRightPanelNodeTab(definingNodeId);
      }
    },
  });
}

/** The touch handlers a connection's hit stroke spreads. */
export function edgeTouchHandlersFor(ctx, edgeId) {
  const {
    ignoreCanvasClick, setLongPressingInstanceId, setDrawingConnectionFrom, beginEdgeTouch, moveEdgeTouch,
    commitEdgeTouch, cancelEdgeTouch,
  } = ctx;
  return ({
    onPointerDown: (e) => {
      if (!e.pointerType || e.pointerType === 'mouse') return false;
      e.preventDefault?.();
      e.stopPropagation?.();
      ignoreCanvasClick.current = true; // suppress canvas click -> plus sign
      setLongPressingInstanceId(null);  // prevent connection drawing intent
      setDrawingConnectionFrom(null);
      beginEdgeTouch(edgeId, e);
      return true;
    },
    onPointerMove: moveEdgeTouch,
    onPointerUp: commitEdgeTouch,
    onPointerCancel: cancelEdgeTouch,
    // Deliberately NOT stopping propagation here: the canvas's own touch pipeline
    // (handleTouchStartCanvas) has to see this touch, or a gesture that begins on a
    // connection can't pan at all. It owns preventDefault and ignoreCanvasClick; we
    // only record the selection candidate and let the pan machinery run.
    onTouchStart: (e) => {
      setLongPressingInstanceId(null);
      setDrawingConnectionFrom(null);
      beginEdgeTouch(edgeId, e);
    },
    onTouchMove: moveEdgeTouch,
    onTouchEnd: commitEdgeTouch,
    onTouchCancel: cancelEdgeTouch,
  });
}

/** Finish a touch on a connection: select it (or toggle an orb) if it was a tap. */
export function commitEdgeTouchWith(ctx, e) {
  const {
    pendingEdgeTouchRef, EDGE_TAP_SLOP_PX, handleEdgePointerDownTouch, selectedEdgeIds, storeActions,
  } = ctx;
  const pending = pendingEdgeTouchRef.current;
  pendingEdgeTouchRef.current = null;
  if (!pending) return;
  // Release position, when we have one — a gesture can outrun moveEdgeTouch
  // (coalesced moves, a fast flick) and still land far from where it began.
  const x = e?.clientX ?? e?.changedTouches?.[0]?.clientX;
  const y = e?.clientY ?? e?.changedTouches?.[0]?.clientY;
  if (typeof x === 'number' && typeof y === 'number'
    && Math.hypot(x - pending.x, y - pending.y) > EDGE_TAP_SLOP_PX) return;

  haptic('edgeSelect');
  // Double-tap → open definition. Counted on release for the same reason
  // selection is: a pan is not a tap and must not accumulate toward one.
  handleEdgePointerDownTouch(pending.edgeId, { pointerType: 'touch', preventDefault: () => { }, stopPropagation: () => { } });
  if (pending.additive) {
    if (selectedEdgeIds.has(pending.edgeId)) {
      storeActions.removeSelectedEdgeId(pending.edgeId);
    } else {
      storeActions.addSelectedEdgeId(pending.edgeId);
    }
  } else {
    storeActions.clearSelectedEdgeIds();
    storeActions.setSelectedEdgeId(pending.edgeId);
  }
}

/** Which connection a touch meant: the nearest one to the finger, else the one it landed on. */
export function resolveTouchEdgeTargetWith(ctx, fallbackEdgeId, e) {
  const { findEdgeAtClientPoint } = ctx;
  const x = e?.clientX ?? e?.touches?.[0]?.clientX;
  const y = e?.clientY ?? e?.touches?.[0]?.clientY;
  if (typeof x !== 'number' || typeof y !== 'number') return fallbackEdgeId;
  return findEdgeAtClientPoint(x, y, 'touch')?.edgeId || fallbackEdgeId;
}

/** A touch pointer went down on a connection's hit stroke. */
export function edgePointerDownTouchWith(ctx, edgeId, e) {
  const { lastEdgeTapRef, EDGE_DOUBLE_TAP_MS } = ctx;
  if (e && e.pointerType === 'mouse') return; // only handle touch/pencil here
  const now = performance.now();
  const last = lastEdgeTapRef.current;
  if (last.id === edgeId && (now - last.ts) < EDGE_DOUBLE_TAP_MS) {
    // Double tap → open definition in right panel
    e.preventDefault?.();
    e.stopPropagation?.();
    const state = useGraphStore.getState();
    const edge = state.edges?.get?.(edgeId);
    let definingNodeId = null;
    if (edge?.definitionNodeIds && edge.definitionNodeIds.length > 0) {
      definingNodeId = edge.definitionNodeIds[0];
    } else if (edge?.typeNodeId) {
      definingNodeId = edge.typeNodeId;
    }
    if (definingNodeId) {
      state.openRightPanelNodeTab?.(definingNodeId);
    }
    lastEdgeTapRef.current = { id: null, ts: 0 };
    return;
  }
  lastEdgeTapRef.current = { id: edgeId, ts: now };
}

/** Select a connection from a click, preferring the nearest (hovered) one over the hitbox on top. */
export function selectEdgeFromClickWith(ctx, clickedEdgeId, e) {
  const { findEdgeAtClientPoint, selectedEdgeIds, storeActions } = ctx;
  const targetEdgeId = useCanvasUIStore.getState().hoveredEdgeInfo?.edgeId
    || findEdgeAtClientPoint(e.clientX, e.clientY, 'mouse')?.edgeId
    || clickedEdgeId;
  haptic('edgeSelect');
  if (e.ctrlKey || e.metaKey) {
    if (selectedEdgeIds.has(targetEdgeId)) {
      storeActions.removeSelectedEdgeId(targetEdgeId);
    } else {
      storeActions.addSelectedEdgeId(targetEdgeId);
    }
  } else {
    storeActions.clearSelectedEdgeIds();
    storeActions.setSelectedEdgeId(targetEdgeId);
  }
}

/** The nearest connection to a client point, within the pointer kind's threshold. */
export function findEdgeAtClientPointWith(ctx, clientX, clientY, pointerKind = 'mouse') {
  const {
    containerRef, panOffsetRef, zoomLevelRef, canvasSize, findNearestEdgeAtCanvasPoint, getEdgeHitThreshold,
  } = ctx;
  if (!containerRef.current) return null;
  const rect = containerRef.current.getBoundingClientRect();
  const { x: cx, y: cy } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
  return findNearestEdgeAtCanvasPoint(cx, cy, getEdgeHitThreshold(pointerKind));
}
