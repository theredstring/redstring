import { useEffect, useRef } from 'react';
import { ENABLE_CULLING } from '../data/culling.js';
import { CONNECTION_LABEL_MOVE_FADE_MIN_COUNT } from '../../../utils/colorUtils.js';
import { setBakingPaused } from '../../../services/labelSpriteCache.js';

// How long to keep connection labels down after a node drag ends, covering the
// drag-zoom restore animation. useNodeDrag's DRAG_ZOOM_ANIMATION_DURATION is
// 250ms; the margin absorbs the frame the animation finishes on. Releasing at
// the drop instead would fade the labels back in over a running zoom, which is
// the one moment with no budget for it.
const DRAG_ZOOM_RESTORE_HOLD_MS = 300;

/** What the transform layer calls back into: culling and the live-transform event on every pan/zoom write, when connection labels stay up during a move, the sprite bakery pause, and the labels held down across a node drag (moved verbatim from NodeCanvas, wave 6). */
export function useTransformWiring({
  connectionLabelMoveFade, dragZoomSettings, draggingNodeInfo,
  gamepadDriftingRef, glowUpdateRef, isAnimatingZoomRef, runCulling, sampleViewMotion, transform,
  visibleEdgesRef, zoomLevelRef,
}) {
  // Wire runCulling into the transform hook so pan/zoom mutations trigger culling
  // synchronously (without waiting for settled-state debounce).
  // Depend on the underlying ref object (stable across renders), NOT `transform`
  // itself (which is a fresh object literal each render).
  //
  // When culling is disabled the visible set is static w.r.t. pan/zoom, so we
  // skip runCulling on transform changes and fire only the glow update. The
  // reactive effect below still invokes runCulling on data changes.
  const onTransformChangeRef = transform.onTransformChangeRef;
  useEffect(() => {
    const base = ENABLE_CULLING ? runCulling : () => { glowUpdateRef.current?.(); };
    onTransformChangeRef.current = () => {
      // Every pan/zoom write funnels through here, whatever drove it — the one
      // place that can answer "is the view moving right now?" for touch.
      sampleViewMotion();
      base();
      // Notify fixed-position overlays that anchor to live on-screen node
      // coordinates (e.g. AbstractionCarousel). Pan/zoom write the DOM transform
      // directly and only update settledPan/settledZoom ~150ms after the
      // interaction stops, so these overlays must re-anchor off this signal to
      // track the canvas live instead of jumping once panning settles.
      if (typeof window !== 'undefined') {
        // Carries the live zoom so listeners can tell a zoom from a pan — the
        // orbit overlay holds its animation longer for zooms, since zoom
        // arrives in discrete steps and it should stay still across the whole
        // interaction rather than waking up between them. Plain Event
        // listeners are unaffected; they simply ignore the detail.
        window.dispatchEvent(new CustomEvent('canvas-transform-change', {
          detail: { zoom: zoomLevelRef.current },
        }));
      }
    };
    return () => { onTransformChangeRef.current = null; };
  }, [onTransformChangeRef, runCulling, sampleViewMotion]);

  // Tell the transform layer when NOT to drop the connection labels for a move.
  //
  // Two independent reasons to leave them up, both funnelled through the one
  // predicate the transform layer reads.
  //
  // The camera is being ANIMATED rather than driven by hand. `isAnimatingZoomRef`
  // is already exactly this signal: the drag lift's zoom-out, its restore on
  // release, and animateCanvasView (orbit fit, decompose framing) all raise it,
  // and every one of those is a short move to a target that was known before it
  // started — nothing accumulates, so there is nothing to protect against.
  //
  // Or the user has said not to, via `connectionLabelMoveFade`. 'large' reads
  // the same visible-edge count every other label budget reads, so it tracks
  // what is ON SCREEN rather than how big the universe is.
  //
  // Read through refs rather than closed over: this predicate runs on the
  // per-frame transform path, and re-assigning it on every settings change or
  // culling commit would re-run the effect far more often than the signal
  // actually changes. The count comes from `visibleEdgesRef`, which runCulling
  // writes synchronously, rather than from the settled React state — a gesture
  // that pulls a crowd of edges into view should be gated on what is on screen
  // NOW. See LABEL SUPPRESSION in useCanvasTransform.
  const moveFadeModeRef = useRef(connectionLabelMoveFade);
  moveFadeModeRef.current = connectionLabelMoveFade;

  // Does the setting want the labels faded at all right now? Shared by both
  // paths — the view-gesture predicate below and the node-drag hold after it —
  // so a drag can never fade labels the settings say to leave alone.
  const shouldFadeLabelsRef = useRef(null);
  shouldFadeLabelsRef.current = () => {
    const mode = moveFadeModeRef.current;
    if (mode === 'off') return false;
    if (mode === 'large') {
      return (visibleEdgesRef.current?.length ?? 0) >= CONNECTION_LABEL_MOVE_FADE_MIN_COUNT;
    }
    return true;
  };

  const isProgrammaticMoveRef = transform.isProgrammaticMoveRef;
  useEffect(() => {
    isProgrammaticMoveRef.current = () => {
      if (!shouldFadeLabelsRef.current()) return true;
      // The controller's aim drift is a short, bounded camera move like the
      // others here, so it gets the same exemption — but through its own flag,
      // never by borrowing isAnimatingZoomRef.
      return isAnimatingZoomRef.current === true || gamepadDriftingRef.current === true;
    };
    return () => { isProgrammaticMoveRef.current = null; };
  }, [isProgrammaticMoveRef, isAnimatingZoomRef]);

  // The label sprite bakery follows the labels themselves.
  //
  // While they are down, every millisecond it spends is spent on something that
  // is not on screen — and spent against the frame budget of the gesture that
  // put them down, since a PNG encode cannot be interrupted once begun and a
  // landed batch costs a full canvas render. When they are up it runs, which is
  // the right answer even for the exempt cases: a label visible during a move is
  // a label being drawn as <text>, which is the expensive form this replaces.
  //
  // Wired here rather than inside labelSpriteCache because that module has no
  // business knowing what a gesture is — see setBakingPaused.
  const onLabelsHiddenRef = transform.onLabelsHiddenRef;
  useEffect(() => {
    onLabelsHiddenRef.current = (hidden) => setBakingPaused(hidden);
    return () => {
      onLabelsHiddenRef.current = null;
      // Never leave the bakery paused behind an unmounting canvas.
      setBakingPaused(false);
    };
  }, [onLabelsHiddenRef]);

  // Hold the labels down for the WHOLE of a node drag, lift through restore.
  //
  // The camera-animation exemption above is right for an orbit fit or a
  // decompose framing — short moves that neither accumulate cost nor benefit
  // from shedding anything. It is wrong for the drag lift, and the reason is
  // that the lift is not the move: it is the opening of a much longer span in
  // which the user drags a node around a web whose edges all re-route under it.
  // Exempting the lift left the labels painting through that entire span, which
  // is exactly where a big web hurts.
  //
  // Held as one continuous span rather than re-derived at each end, so the
  // labels fade once on lift and return once after the drop, instead of
  // blinking at both ends of the drag.
  //
  // The release waits out the restore. `draggingNodeInfo` clears at the drop,
  // but the camera then animates back over DRAG_ZOOM_ANIMATION_DURATION — and
  // fading labels back IN over a running zoom animation is the last place there
  // is budget for it.
  //
  // Keyed on the SETTING rather than on `isAnimatingZoomRef`, which looks like
  // the more precise signal and is actually a race: the restore is kicked off
  // by the drop handler, so this effect can run in the window before the
  // animation has raised that flag, read false, and release into exactly the
  // frames it was meant to protect. Whether drag-zoom is on is knowable without
  // that timing. A timer rather than a poll — if the animation is interrupted
  // the labels return a little later, which is harmless.
  const setDragLabelsHidden = transform.setDragLabelsHidden;
  const dragZoomEnabled = dragZoomSettings.enabled;
  useEffect(() => {
    if (draggingNodeInfo) {
      setDragLabelsHidden(shouldFadeLabelsRef.current());
      return undefined;
    }
    if (!dragZoomEnabled) {
      setDragLabelsHidden(false);
      return undefined;
    }
    const id = setTimeout(() => setDragLabelsHidden(false), DRAG_ZOOM_RESTORE_HOLD_MS);
    return () => clearTimeout(id);
  }, [draggingNodeInfo, setDragLabelsHidden, dragZoomEnabled]);


}
