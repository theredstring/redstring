/**
 * The camera controller (P4.02): the pan and zoom momentum, view-motion
 * sampling, trackpad zoom smoothing and glide, the wheel handler and the Safari
 * gesture listeners, moved out of NodeCanvas verbatim. It owns the camera's own
 * refs (trackpad zoom, zoom momentum, view motion, the wheel-burst rect cache)
 * and its functions are stable, so NodeCanvas creates it once.
 *
 * Everything it reads from the canvas (the transform setters, sizes, settings,
 * the zoom bounds) comes from `ctxRef.current`, which NodeCanvas assigns on
 * every render, so each call sees what the old per-render closures saw.
 */
import { clientToCanvas } from '../../../utils/canvas/viewportMath.js';
import { recordTrackpadZoom, runPanMomentum, runZoomMomentum } from './momentum.js';
import { calculateZoom } from '../../../utils/canvas/zoomMath.js';
import { SMOOTH_MOUSE_WHEEL_ZOOM_SENSITIVITY } from '../../../constants';
import {
  isMac,
  isIOS,
  VIEW_MOTION_MIN_SPEED,
  VIEW_MOTION_STALE_MS,
  VIEW_MOTION_SAMPLE_MAX_GAP_MS,
  VIEW_MOTION_MIN_SAMPLES,
  PAN_MOMENTUM_FRAME,
  TRACKPAD_ZOOM_MAX_STEP_DELTA,
  TRACKPAD_ZOOM_SENSITIVITY_SLIDER_SCALE,
  TRACKPAD_ZOOM_SMOOTHING,
  TRACKPAD_ZOOM_SETTLE_EPSILON,
  TRACKPAD_ZOOM_GLIDE_FRICTION,
  TRACKPAD_ZOOM_GLIDE_STOP_SPEED,
} from '../../../utils/canvas/input/inputTuning.js';

// How long a mouse-wheel burst's container rect stays reusable. Comfortably
// longer than the gap between notches in a continuous scroll, far shorter than
// the gap between two deliberate bursts. See detentRectRef.
const WHEEL_RECT_CACHE_MS = 400;

/** @param {{ current: object }} ctxRef */
export function createCameraController(ctxRef) {
  const panMomentumRef = { current: { animationId: null, vx: 0, vy: 0, lastTime: 0, source: null, active: false } };
  const zoomMomentumRef = { current: { animationId: null, vel: 0, lastTime: 0, anchorClient: null, anchorWorld: null, active: false } };

  const stopPanMomentum = () => {
    const { isPanningOrZooming, panVelocityHistoryRef } = ctxRef.current;
    const { animationId } = panMomentumRef.current;
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    panMomentumRef.current.animationId = null;
    panMomentumRef.current.vx = 0;
    panMomentumRef.current.vy = 0;
    panMomentumRef.current.lastTime = 0;
    panMomentumRef.current.source = null;
    panMomentumRef.current.active = false;
    // Deliberately does NOT stop the pinch-zoom glide. handleMouseUp's
    // pan-finalize path calls stopPanMomentum on the same touchend that just
    // launched the zoom glide (the duplicated React + document touchend run),
    // so coupling the two here killed the glide in the same tick it started.
    // Fresh touchstarts stop the zoom glide explicitly via stopZoomMomentum.
    isPanningOrZooming.current = false;
    panVelocityHistoryRef.current = [];
  };

  const startPanMomentum = (a0, a1, a2, a3) => {
    const { canvasSizeRef, isPanningOrZooming, setPanOffset, viewportSizeRef, zoomLevelRef } = ctxRef.current;
    return runPanMomentum(a0, a1, a2, a3, {
      canvasSizeRef, isPanningOrZooming, panMomentumRef, setPanOffset, stopPanMomentum, viewportSizeRef,
      zoomLevelRef,
    });
  };

  // Live view-motion sample, fed by every transform write (see the
  // onTransformChangeRef effect). Speed is screen px/ms of pan travel.
  const viewMotionRef = { current: { x: 0, y: 0, t: 0, movingSamples: 0 } };
  const sampleViewMotion = () => {
    const { panOffsetRef } = ctxRef.current;
    const p = panOffsetRef.current;
    const m = viewMotionRef.current;
    const now = performance.now();
    const dt = now - m.t;
    // A gap longer than the sample window means the view was parked and has
    // just started moving again — measure from here rather than dividing this
    // frame's travel by the length of the pause.
    const speed = (dt > 0 && dt <= VIEW_MOTION_SAMPLE_MAX_GAP_MS)
      ? Math.hypot(p.x - m.x, p.y - m.y) / dt
      : 0;
    m.movingSamples = speed > VIEW_MOTION_MIN_SPEED ? m.movingSamples + 1 : 0;
    m.x = p.x;
    m.y = p.y;
    m.t = now;
  };

  // True while the view is moving — the touch layer routes touches that land
  // during it to the canvas pan pipeline even when they land on a node, so a
  // traversal isn't killed by whatever large node the finger comes down on.
  // Stale-checked, so a parked view (no transform writes) always reads false.
  const isViewMoving = () => {
    const m = viewMotionRef.current;
    if (performance.now() - m.t > VIEW_MOTION_STALE_MS) return false;
    return m.movingSamples >= VIEW_MOTION_MIN_SAMPLES;
  };
  const stopZoomMomentum = () => {
    if (zoomMomentumRef.current.animationId) {
      cancelAnimationFrame(zoomMomentumRef.current.animationId);
    }
    zoomMomentumRef.current.animationId = null;
    zoomMomentumRef.current.vel = 0;
    zoomMomentumRef.current.active = false;
  };

  // Launch a brief zoom coast after a pinch releases (touch only). `initialVel`
  // is the release velocity in log-zoom space (per ms); the anchor pins the last
  // pinch midpoint so the coasting zoom stays centered on the same world point.
  // Trackpad zoom does not come through here — it coasts by extending the
  // smoothing target instead (see the trackpad zoom smoothing block).
  const startZoomMomentum = (initialVel, anchorClient, anchorWorld, minZoomBound, maxZoomBound) => {
    const { MIN_ZOOM, canvasSizeRef, containerRef, isPanningOrZooming, setPanAndZoom, zoomLevelRef } = ctxRef.current;
    return runZoomMomentum(initialVel, anchorClient, anchorWorld, minZoomBound, maxZoomBound, {
      MIN_ZOOM, canvasSizeRef, containerRef, isPanningOrZooming, setPanAndZoom, stopPanMomentum,
      stopZoomMomentum, zoomLevelRef, zoomMomentumRef,
    });
  };

  // --- Trackpad zoom smoothing + glide ---
  // `targetZoom` is where the accumulated wheel/gesture input wants the view;
  // the rAF loop eases the live zoom toward it. `anchorClient`/`anchorWorld` pin
  // the point under the cursor so easing never slides the view. `hist` holds
  // recent {t, lz} target samples for measuring release velocity, and doubles as
  // the "gesture in flight" flag handleWheel routes continuation events on.
  // `sensitivity` latches the zoom rate the gesture started with so continuation
  // events (modifier released mid-stream) don't change speed. `endTimerId` is
  // the idle timer standing in for the missing "fingers lifted" event. `rect` is
  // the container's bounding rect, read ONCE per gesture: reading it per event or
  // per frame forces a synchronous layout of a content group the transform write
  // just dirtied, which on a Lombardi graph with labels is the single most
  // expensive thing this path can do. `easeZoom` is the ease's own continuous
  // position, kept separate because the APPLIED zoom is snapped during motion
  // (see ZOOM SCALE QUANTUM) and easing from a snapped value would stall.
  const trackpadZoomRef = { current: {
    animationId: null,
    targetZoom: null,
    anchorClient: null,
    anchorWorld: null,
    lastTime: 0,
    hist: [],
    endTimerId: null,
    sensitivity: null,
    rect: null,
    easeZoom: null,
    // Momentum. `glideVel` is d(ln zoom)/dt applied to the TARGET each frame and
    // decayed by `glideFriction`; it runs during the gesture as well as after
    // it, refreshed by every event. `predictLn` is how far that has carried the
    // target past the last event, so the next event can rewind it before adding
    // its own step and the lead never accumulates. `glideEnabled`/`glideFriction`
    // are latched at gesture start, like `sensitivity` — moving the slider
    // mid-pinch shouldn't change the feel mid-pinch. The zoom bounds are latched
    // per gesture too, because MIN_ZOOM is dynamic (fit-to-canvas) and the coast
    // must clamp exactly where the gesture would.
    glideVel: 0,
    glideFriction: TRACKPAD_ZOOM_GLIDE_FRICTION,
    glideEnabled: true,
    predictLn: 0,
    minZoom: null,
    maxZoom: null,
  } };

  // Container rect held across the events of one MOUSE-WHEEL burst.
  //
  // The trackpad path caches its rect on trackpadZoomRef for the duration of a
  // gesture, but the detent path cannot use that: it calls stopTrackpadZoom() on
  // every event, which nulls that field by design, so `getRect` in handleWheel
  // was a guaranteed cache miss on every notch. That read forces style+layout on
  // an SVG whose SCALE the previous notch's transform write just dirtied, which
  // is the expensive kind — the repo's own measurement puts the same read at
  // 0.1ms during a pan against 4.9ms during a zoom, because a translate leaves
  // glyph layout valid and a scale does not.
  //
  // Unlike a trackpad gesture, wheel bursts can be seconds apart, so "a panel
  // can't resize mid-zoom" is not a safe assumption here. Hence both an explicit
  // invalidation (the effect below, on panel and viewport changes) and a time
  // bound, so a rect can never outlive the burst that measured it.
  const detentRectRef = { current: { rect: null, at: 0 } };

  // Diagnostic accumulator for `window.__zoomPerf`. Off by default and never
  // read unless the flag is set; exists to answer "is the frame time going into
  // our JS or into the browser's repaint?" without a profiler session.
  const zoomPerfRef = { current: { frames: 0, totalMs: 0, worstMs: 0, longFrames: 0, cullingRuns: 0, cullingMs: 0, cullingWorstMs: 0 } };

  // Halts the ease wherever it currently is, abandoning the remaining target.
  // For foreign input taking over the view (a press, a touch, an animated zoom)
  // — not for the next event of the gesture already in progress.
  const stopTrackpadZoom = () => {
    const ref = trackpadZoomRef.current;
    if (ref.animationId) cancelAnimationFrame(ref.animationId);
    if (ref.endTimerId) clearTimeout(ref.endTimerId);
    ref.animationId = null;
    ref.endTimerId = null;
    ref.targetZoom = null;
    ref.anchorClient = null;
    ref.anchorWorld = null;
    ref.hist = [];
    ref.sensitivity = null;
    ref.rect = null;
    ref.easeZoom = null;
    ref.glideVel = 0;
    ref.predictLn = 0;
  };

  // Points the ease at `targetZoom`, anchored on the world point under the
  // cursor, and starts the rAF loop if it isn't already running. Every trackpad
  // zoom step — wheel or Safari GestureEvent — goes through here rather than
  // writing zoom directly, so the view moves on the compositor's clock instead
  // of the input device's.
  const setTrackpadZoomTarget = (targetZoom, clientX, clientY, minZoomBound, maxZoomBound, knownRect = null) => {
    const { containerRef, canvasSizeRef, MIN_ZOOM, MAX_ZOOM, panOffsetRef, zoomLevelRef, isPanningOrZooming, isAnimatingZoomRef, viewportSizeRef, setPanAndZoom, visibleNodeIdsRef, visibleEdgesRef } = ctxRef.current;
    const container = containerRef.current;
    const canvas = canvasSizeRef.current;
    if (!container || !canvas || !Number.isFinite(targetZoom) || targetZoom <= 0) return;

    const ref = trackpadZoomRef.current;
    const effMinZoom = Number.isFinite(minZoomBound) ? minZoomBound : MIN_ZOOM;
    const effMaxZoom = Number.isFinite(maxZoomBound) ? maxZoomBound : MAX_ZOOM;
    ref.minZoom = effMinZoom;
    ref.maxZoom = effMaxZoom;
    ref.targetZoom = Math.max(effMinZoom, Math.min(effMaxZoom, targetZoom));
    // Every caller of this is real input: the target it passes is the truth, so
    // whatever momentum had carried the target past the last event is now spent.
    // The wheel path rewinds `predictLn` out of its own accumulation base before
    // calling (see handleWheel); Safari's passes an absolute finger-derived zoom
    // and needs no rewind. Either way the prediction restarts from zero here, so
    // it can never accumulate. recordTrackpadZoomSample re-measures the velocity
    // immediately after, which is what keeps momentum alive across the gesture.
    ref.glideVel = 0;
    ref.predictLn = 0;

    // One layout read per gesture — the caller usually has the rect already, and
    // it's held for the gesture's duration (a panel can't resize mid-zoom).
    if (!ref.rect) ref.rect = knownRect || container.getBoundingClientRect();
    const rect = ref.rect;

    // Re-derive the anchor from the LIVE transform every step. Mid-ease the
    // anchoring invariant holds the same world point under the cursor, so this
    // is stable while the cursor is still and correctly follows it when it moves.
    const pan = panOffsetRef.current;
    const zoom = zoomLevelRef.current;
    ref.anchorClient = { x: clientX, y: clientY };
    ref.anchorWorld = clientToCanvas(clientX, clientY, rect, pan, zoom, canvas);

    if (ref.animationId) return;
    ref.lastTime = performance.now();
    // Seed the continuous position from what is on screen — a fresh gesture
    // starts from the live zoom, a resumed one from where the last ease left off.
    ref.easeZoom = zoomLevelRef.current;
    isPanningOrZooming.current = true;

    const step = (time) => {
      const s = trackpadZoomRef.current;
      if (s.targetZoom == null) { s.animationId = null; return; }

      const cont = containerRef.current;
      const cvs = canvasSizeRef.current;
      // An animated zoom (double-click to fit, drag zoom-out) owns the view
      // outright; yield rather than fighting it frame by frame.
      if (!cont || !cvs || isAnimatingZoomRef.current) {
        s.animationId = null;
        s.targetZoom = null;
        isPanningOrZooming.current = false;
        return;
      }

      const rawDt = time - (s.lastTime || time);
      const dt = Math.min(32, Math.max(1, rawDt));
      s.lastTime = time;
      isPanningOrZooming.current = true;

      // Frame-time probe. `window.__zoomPerf = true` in the console, zoom, and
      // read the summary logged when the gesture settles. rawDt is the achieved
      // frame interval: if it is far above 16ms while the work this loop does
      // itself is trivial, the cost is downstream (culling, React commit, or the
      // browser repainting the label-bearing SVG), not in the easing.
      if (typeof window !== 'undefined' && window.__zoomPerf) {
        const p = zoomPerfRef.current;
        p.frames++;
        p.totalMs += rawDt;
        if (rawDt > p.worstMs) p.worstMs = rawDt;
        if (rawDt > 24) p.longFrames++;
      }

      // Momentum: carry the target forward at its current velocity, then let the
      // ease below chase it exactly as it chases a gesture. This runs every
      // frame, during the gesture as well as after it — while events keep
      // arriving they overwrite the velocity faster than friction can eat it, so
      // this is prediction; once they stop, the same line is the coast. That
      // identity is the whole point: there is no frame on which the view
      // switches from being driven to coasting.
      if (s.glideVel) {
        const minZ = Number.isFinite(s.minZoom) ? s.minZoom : MIN_ZOOM;
        const maxZ = Number.isFinite(s.maxZoom) ? s.maxZoom : MAX_ZOOM;
        const rawTarget = s.targetZoom * Math.exp(s.glideVel * dt);
        const clampedTarget = Math.max(minZ, Math.min(maxZ, rawTarget));
        // Bank what was ACTUALLY applied, not what was asked for, so a rewind at
        // a zoom bound stays exact.
        s.predictLn += Math.log(clampedTarget / s.targetZoom);
        s.targetZoom = clampedTarget;
        if (clampedTarget !== rawTarget) {
          // Pinned at a zoom bound. Grinding the remaining velocity against the
          // clamp for another ten frames only delays the settle.
          s.glideVel = 0;
        } else {
          s.glideVel *= Math.pow(s.glideFriction, dt / PAN_MOMENTUM_FRAME);
          if (Math.abs(s.glideVel) < TRACKPAD_ZOOM_GLIDE_STOP_SPEED) s.glideVel = 0;
        }
      }

      // Ease in log space so a step feels the same at any magnification, and
      // compensate for frame time so a dropped frame closes proportionally more
      // of the gap instead of stretching the ease.
      // `window.__trackpadZoomSmoothing = 1` disables smoothing entirely (target
      // applied on the frame it arrives) — the A/B for whether this loop is
      // responsible for a perf complaint at all.
      const smoothing = (typeof window !== 'undefined' && Number(window.__trackpadZoomSmoothing) > 0)
        ? Math.min(1, Number(window.__trackpadZoomSmoothing))
        : TRACKPAD_ZOOM_SMOOTHING;
      // The ease tracks its own CONTINUOUS zoom rather than reading back what
      // was applied: the applied value is snapped (see below), and easing from a
      // snapped value would either stall on the step it is sitting on or chase
      // its own rounding.
      const curZoom = s.easeZoom ?? zoomLevelRef.current;
      const lnCur = Math.log(curZoom);
      const lnTarget = Math.log(s.targetZoom);
      const gap = lnTarget - lnCur;
      const t = 1 - Math.pow(1 - smoothing, dt / PAN_MOMENTUM_FRAME);
      // A coast still carrying velocity is not settled even when the view has
      // caught up to the target — the target is about to move again.
      const settled = Math.abs(gap) < TRACKPAD_ZOOM_SETTLE_EPSILON && !s.glideVel;
      // Applied exactly as eased — the scale is NOT snapped. See ZOOM SCALE
      // QUANTUM for the measurements that took the snap back out.
      const nextZoom = settled ? s.targetZoom : Math.exp(lnCur + gap * t);
      s.easeZoom = nextZoom;

      // Cached rect — never read layout inside the loop. See trackpadZoomRef.
      const rect2 = s.rect;
      const world = s.anchorWorld;
      const client = s.anchorClient;
      if (!rect2 || !world || !client) {
        s.animationId = null;
        s.targetZoom = null;
        isPanningOrZooming.current = false;
        return;
      }
      const nextPan = {
        x: client.x - rect2.left - (world.x - cvs.offsetX) * nextZoom,
        y: client.y - rect2.top - (world.y - cvs.offsetY) * nextZoom,
      };
      // Clamp to the canvas edges exactly as the direct zoom path does, so a
      // zoom-out near an edge can't ease into the void.
      const viewport = viewportSizeRef.current;
      nextPan.x = Math.min(Math.max(nextPan.x, viewport.width - cvs.width * nextZoom), 0);
      nextPan.y = Math.min(Math.max(nextPan.y, viewport.height - cvs.height * nextZoom), 0);
      setPanAndZoom(nextPan, nextZoom);

      if (settled) {
        s.animationId = null;
        s.targetZoom = null;
        s.rect = null;
        s.easeZoom = null;
        isPanningOrZooming.current = false;
        if (typeof window !== 'undefined' && window.__zoomPerf) {
          const p = zoomPerfRef.current;
          console.log('[zoomPerf]', {
            frames: p.frames,
            avgFrameMs: +(p.totalMs / Math.max(1, p.frames)).toFixed(1),
            worstFrameMs: +p.worstMs.toFixed(1),
            framesOver24ms: p.longFrames,
            cullingRuns: p.cullingRuns,
            cullingAvgMs: +(p.cullingMs / Math.max(1, p.cullingRuns)).toFixed(2),
            cullingWorstMs: +p.cullingWorstMs.toFixed(2),
            visibleNodes: visibleNodeIdsRef.current?.size ?? 0,
            visibleEdges: visibleEdgesRef.current?.length ?? 0,
          });
          zoomPerfRef.current = { frames: 0, totalMs: 0, worstMs: 0, longFrames: 0, cullingRuns: 0, cullingMs: 0, cullingWorstMs: 0 };
        }
        return;
      }
      s.animationId = requestAnimationFrame(step);
    };

    ref.animationId = requestAnimationFrame(step);
  };

  // Called when the trackpad gesture's event stream stops (idle gap on the wheel
  // path, or a real `gestureend` in Safari).
  //
  // It deliberately does NOT start the coast — the coast has been running since
  // the gesture's second event, and this is simply the last correction failing
  // to arrive. All that ends here is the bookkeeping the STREAM owns: the
  // velocity samples, the latched sensitivity, and the timer itself. The
  // momentum in `glideVel` is untouched and decays on its own.
  const endTrackpadZoomGesture = () => {
    const ref = trackpadZoomRef.current;
    if (ref.endTimerId) clearTimeout(ref.endTimerId);
    ref.endTimerId = null;
    ref.hist = [];
    ref.sensitivity = null;
  };

  // Record one step of a trackpad zoom gesture: re-measure the momentum the
  // target carries between events, and (re)arm the idle end timer.
  //
  // `zoom` is the TARGET the step asked for, not the eased on-screen value —
  // sampling the target keeps the measured velocity true to the input.
  //
  // `eventTime` is the event's own timestamp, and it matters more than it looks:
  // stamping samples with the time the HANDLER ran means a stalled main thread
  // records a frame's worth of queued events as simultaneous, which both inflates
  // the measured velocity and collapses the median gap the idle timer is scaled
  // to (making it false-end constantly, on exactly the heavy graphs where it
  // hurts). Event timestamps are unaffected by when we got around to reading
  // them. Sanity-checked against the clock in case a browser hands back an
  // epoch-based value rather than a DOMHighResTimeStamp.
  const recordTrackpadZoomSample = (a0, a1, a2) => recordTrackpadZoom(a0, a1, a2, {
    endTrackpadZoomGesture, trackpadZoomRef,
  });

  /**
   * Handles wheel events for zoom and pan, with cross-platform input discrimination.
   *
   * Zoom path: Cmd+scroll (Mac) or Ctrl+scroll, delegates to the canvas worker for
   * the new viewport. Distinguishes trackpad pinch (`ctrlKey` + small delta <20px)
   * from a real modifier+wheel (large delta) and applies the appropriate sensitivity.
   * Pinch steps also feed the trackpad zoom glide tracker, which coasts the zoom
   * once the event stream goes idle (see `recordTrackpadZoomSample`).
   *
   * Pan path: unmodified scroll is passed through as canvas pan. Fractional deltas
   * from a precision trackpad cause smooth glide; integer multiples indicate a
   * detent mouse wheel and are handled with higher per-step sensitivity.
   *
   * @param {WheelEvent} e - Native wheel event. `deltaMode` normalization converts
   *   line-based and page-based values to pixels before any math.
   */
  const handleWheel = async (e) => {
    const { pinchRef, trackpadZoomEnabled, containerRef, abstractionCarouselVisible, draggingNodeInfo, isAnimatingZoomRef, isPanningOrZooming, trackpadZoomSensitivityRef, zoomOpIdRef, zoomLevelRef, panOffsetRef, viewportSize, canvasSize, MIN_ZOOM, MAX_ZOOM, panSourceRef, setPanAndZoom, trackpadPanSensitivityRef, setPanOffset } = ctxRef.current;
    if (pinchRef.current.active) return;
    if (trackpadZoomEnabled && (e.ctrlKey || e.metaKey)) return;

    // Any fresh wheel input supersedes a coast in flight: the touch pinch's own
    // momentum here, and the trackpad coast either where the zoom path corrects
    // the target (setTrackpadZoomTarget rewinds the prediction and clears its
    // velocity, and the sample that follows re-measures it) or where the pan
    // path calls stopTrackpadZoom.
    stopZoomMomentum();

    // getBoundingClientRect forces a synchronous layout, and the transform write
    // from the previous event has already dirtied the content group — so on a
    // heavy graph (Lombardi routing with labels) each call reflows the whole SVG
    // subtree. Read it lazily, and prefer the rect the running zoom gesture
    // already cached, so a gesture costs one reflow instead of one per event.
    let rectCache = trackpadZoomRef.current.rect || null;
    if (!rectCache) {
      // Fall back to the rect measured by an earlier event of this same wheel
      // burst — see detentRectRef. Bounded in time so it can never survive into
      // a later burst, and cleared outright when a panel or the viewport moves.
      const d = detentRectRef.current;
      if (d.rect && (performance.now() - d.at) < WHEEL_RECT_CACHE_MS) rectCache = d.rect;
    }
    const getRect = () => {
      if (!rectCache) rectCache = containerRef.current.getBoundingClientRect();
      // Write through on every use, not just on a miss: the detent branch calls
      // stopTrackpadZoom() (which nulls trackpadZoomRef.rect) between this
      // function being defined and being called, so a miss-only write would
      // leave the cache empty for every other notch.
      detentRectRef.current.rect = rectCache;
      detentRectRef.current.at = performance.now();
      return rectCache;
    };

    let deltaY = e.deltaY;
    if (e.deltaMode === 1) deltaY *= 33;
    else if (e.deltaMode === 2) deltaY *= window.innerHeight;
    let deltaX = e.deltaX;
    if (e.deltaMode === 1) deltaX *= 33;
    else if (e.deltaMode === 2) deltaX *= window.innerWidth;

    // Modifier check: Cmd on Mac, Ctrl elsewhere. Mac's synthesized ctrlKey
    // (from trackpad pinch) also counts — it's how pinch-to-zoom works.
    const isZoom = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
    // Pinch vs. modifier+wheel is discriminated by delta magnitude, not by
    // ctrlKey alone — real Ctrl+mouse-wheel on any platform also sets ctrlKey but
    // emits large deltas. Pinch gestures (Mac and Windows precision touchpads)
    // emit |deltaY| ~1-10 per event, so small-delta Ctrl+scroll = trackpad pinch.
    const isPinch = e.ctrlKey && !e.metaKey && Math.abs(deltaY) < 20;
    // Trackpad vs. mouse wheel, for glide eligibility: a wheel detent lands as
    // one large step (~100px, or line-mode), a trackpad streams small pixel
    // deltas at frame rate. Cmd+two-finger-scroll zooming is a trackpad gesture
    // and deserves the coast just as much as a pinch does.
    const isTrackpadDelta = e.deltaMode === 0 && Math.abs(deltaY) < TRACKPAD_ZOOM_MAX_STEP_DELTA;

    if (abstractionCarouselVisible) return;

    // A zoom gesture already in flight keeps every following wheel event, held
    // modifier or not, until the stream itself stops (the tracker's idle timer
    // clears `hist`). macOS keeps delivering the gesture's momentum tail after
    // the fingers lift, and releasing Cmd mid-tail used to drop those events
    // into the pan path — the view would stop zooming and start sliding.
    const zoomGesture = trackpadZoomRef.current;
    const isZoomContinuation = !isZoom && zoomGesture.hist.length > 0;

    if (isZoom || isZoomContinuation) {
      if (draggingNodeInfo || isAnimatingZoomRef.current) return;
      e.stopPropagation();
      isPanningOrZooming.current = true;
      const trackpadSensitivity = (trackpadZoomSensitivityRef.current ?? 0.5) * TRACKPAD_ZOOM_SENSITIVITY_SLIDER_SCALE;
      // Continuation events reuse the sensitivity the gesture started with —
      // re-deriving it once the modifier is gone would change the zoom rate
      // mid-gesture, which is exactly the seam this latch exists to remove.
      const sensitivity = (isZoomContinuation && zoomGesture.sensitivity != null)
        ? zoomGesture.sensitivity
        : (isPinch ? trackpadSensitivity : SMOOTH_MOUSE_WHEEL_ZOOM_SENSITIVITY);
      const zoomDelta = deltaY * sensitivity;
      const opId = ++zoomOpIdRef.current;

      // Trackpad input is smoothed: the step moves a TARGET and a rAF loop eases
      // the view toward it. Applying deltas raw here is what made the gesture
      // choppy — wheel events don't arrive on the compositor's clock, so two can
      // land in one frame and none in the next. Accumulating onto the existing
      // target (not the live zoom) is what makes the steps add up correctly
      // while the ease is still catching up.
      if (isPinch || isTrackpadDelta || isZoomContinuation) {
        if (deltaY === 0) {
          // Chromium punctuates a finished gesture with a zero-delta wheel
          // event. Recording it would append a zero-motion sample and drag the
          // measured velocity down — the release reads as a stumble. It's the
          // closest thing this path has to a real "fingers lifted" signal, so
          // close the stream's bookkeeping on it instead of waiting out the idle
          // gap. The momentum already in flight is untouched and coasts on.
          endTrackpadZoomGesture();
          return;
        }
        // What this step accumulates onto. Three cases, and what separates them
        // is what the momentum already in flight MEANS:
        //
        //   live stream — it is a prediction of where the fingers have got to
        //     since the last event, and delivering that is this event's job.
        //     Rewind it or the same motion is counted twice and the lead
        //     compounds over the gesture instead of staying at about a frame.
        //   coasting — the stream has ended, so it is not a prediction any
        //     more: it is motion the view has already travelled and the user
        //     has already watched. Rewinding it would yank the view backwards.
        //     Take the eased position instead — grabbing a coasting view stops
        //     it where it looks like it is, which is also what makes a step in
        //     the OPPOSITE direction read immediately rather than first having
        //     to pay off a lead the user never asked for.
        //   idle — nothing in flight, the live zoom is the truth.
        const predicted = zoomGesture.predictLn || 0;
        const streamLive = zoomGesture.hist.length > 0;
        let base;
        if (zoomGesture.targetZoom == null) base = zoomLevelRef.current;
        else if (streamLive) base = zoomGesture.targetZoom * Math.exp(-predicted);
        else base = zoomGesture.easeZoom ?? zoomLevelRef.current;

        const r = getRect();
        // calculateZoom owns the delta→factor curve; only its zoom is wanted
        // here, since the ease derives pan from its own anchor.
        let target = calculateZoom({
          deltaY: zoomDelta,
          currentZoom: base,
          mousePos: { x: e.clientX - r.left, y: e.clientY - r.top },
          panOffset: panOffsetRef.current,
          viewportSize, canvasSize, MIN_ZOOM, MAX_ZOOM,
        }).zoomLevel;
        // A hard deceleration can rewind more than this event's own step puts
        // back, leaving the target behind the view — a frame of motion the
        // wrong way. Hold it at the view instead. Only when the step CONTINUES
        // the predicted direction, though: a step that opposes it is the user
        // genuinely reversing, and that has to pass through untouched.
        if (streamLive && predicted !== 0 && Number.isFinite(zoomGesture.easeZoom)) {
          const stepLn = Math.log(target / base);
          if (stepLn * predicted > 0) {
            target = predicted > 0
              ? Math.max(target, zoomGesture.easeZoom)
              : Math.min(target, zoomGesture.easeZoom);
          }
        }
        setTrackpadZoomTarget(target, e.clientX, e.clientY, MIN_ZOOM, MAX_ZOOM, r);
        recordTrackpadZoomSample(target, sensitivity, e.timeStamp);
        setTimeout(() => {
          if (opId !== zoomOpIdRef.current) return;
          panSourceRef.current = null;
          // The ease owns this flag while it runs and clears it on settle; only
          // release it here if no loop started (target refused, no container).
          if (!trackpadZoomRef.current.animationId) isPanningOrZooming.current = false;
        }, 100);
        return;
      }

      // Mouse wheel detents keep the direct path — discrete input, one step per
      // click, nothing to smooth between events.
      stopTrackpadZoom();

      // Applied synchronously, straight off the live refs.
      //
      // This used to await canvasWorker.calculateZoom. Two things went wrong
      // with that, both only visible on a trackpad, which emits wheel events
      // faster than a worker round-trip completes:
      //
      //   1. The worker client matched responses to requests by message type
      //      alone, so with several requests in flight each caller resolved on
      //      whichever response landed first. A zoom step could then pair its
      //      own `baseZoom` with another step's output zoom, and `result /
      //      baseZoom` came out ABOVE 1 while the user was zooming out — the
      //      view lurching back in mid-gesture. (Fixed in useCanvasWorker too.)
      //   2. Even correlated, every step still paid a frame of latency for
      //      arithmetic, and had to reconcile a pre-await snapshot against refs
      //      the keyboard loop may have moved in the meantime.
      //
      // Computing inline removes both by construction: no snapshot to go
      // stale, no responses to mismatch, and it composes with the keyboard loop
      // for free because both now read and write the same refs in the same tick.
      const detentRect = getRect();
      const result = calculateZoom({
        deltaY: zoomDelta,
        currentZoom: zoomLevelRef.current,
        mousePos: { x: e.clientX - detentRect.left, y: e.clientY - detentRect.top },
        panOffset: panOffsetRef.current,
        viewportSize, canvasSize, MIN_ZOOM, MAX_ZOOM,
      });
      setPanAndZoom(result.panOffset, result.zoomLevel);

      setTimeout(() => {
        if (opId === zoomOpIdRef.current) {
          isPanningOrZooming.current = false;
          panSourceRef.current = null;
        }
      }, 100);
      return;
    }

    // Reached only when no zoom gesture is in flight (the latch above keeps a
    // live one on the zoom path). A deliberate scroll takes the view over, so
    // abandon any ease still settling rather than easing and panning at once.
    stopTrackpadZoom();

    // Shift is reserved for keyboard zoom (see useCanvasKeyboard.js).
    // Swallow shift+wheel so the browser's default shift→horizontal-pan
    // behavior doesn't leak in via deltaX.
    if (e.shiftKey) {
      e.stopPropagation();
      return;
    }

    // PAN path — every non-modifier wheel event pans.
    // Alt/Option held: translate vertical wheel motion into horizontal pan.
    // Useful for mouse users whose wheel only scrolls vertically.
    e.stopPropagation();
    isPanningOrZooming.current = true;
    panSourceRef.current = 'wheel';
    const wheelPanSensitivity = (trackpadPanSensitivityRef.current ?? 0.5) * 2.4;
    const dx = e.altKey ? -deltaY * wheelPanSensitivity : -deltaX * wheelPanSensitivity;
    const dy = e.altKey ? 0 : -deltaY * wheelPanSensitivity;
    const currentCanvasWidth = canvasSize.width * zoomLevelRef.current;
    const currentCanvasHeight = canvasSize.height * zoomLevelRef.current;
    const minX = viewportSize.width - currentCanvasWidth;
    const minY = viewportSize.height - currentCanvasHeight;
    setPanOffset(prev => ({
      x: Math.min(Math.max(prev.x + dx, minX), 0),
      y: Math.min(Math.max(prev.y + dy, minY), 0),
    }));
    setTimeout(() => {
      isPanningOrZooming.current = false;
      panSourceRef.current = null;
    }, 100);
  };

  // Blocks the browser's own wheel scrolling over the canvas (NodeCanvas attaches
  // this on mount and whenever trackpadZoomEnabled changes).
  const attachWheelGuard = () => {
    const { containerRef, trackpadZoomEnabled } = ctxRef.current;
    const container = containerRef.current;
    if (container) {
      const preventDefaultWheel = (e) => {
        // Allow wheel events over panel tab bars
        const isOverPanelTabBar = e.target.closest('[data-panel-tabs="true"]');
        if (trackpadZoomEnabled) {
          return; // don't block wheel; let browser handle pinch-zoom if applicable
        }
        if (!isOverPanelTabBar) {
          e.preventDefault();
        }
      };
      container.addEventListener('wheel', preventDefaultWheel, { passive: false });
      return () => container.removeEventListener('wheel', preventDefaultWheel);
    }
  };

  // Handles Safari gesture events (macOS trackpad pinch) for canvas zoom
  // Attached by NodeCanvas on mount and when the zoom bounds or the trackpad
  // setting change; returns the cleanup.
  const attachGestures = () => {
    const { containerRef, zoomLevelRef, trackpadZoomEnabled, isTouchDeviceRef, lastMousePosRef, pinchRef, isPanningOrZooming, armGestureBlock, abstractionCarouselVisibleRef, draggingNodeInfoRef, isAnimatingZoomRef, MIN_ZOOM, MAX_ZOOM, ignoreCanvasClick, scheduleGestureBlockClear } = ctxRef.current;
    const container = containerRef.current;
    if (!container) return;
    let gestureAnchor = { x: 0, y: 0 };
    let gestureStartZoom = zoomLevelRef.current;

    const onGestureStart = (e) => {
      if (trackpadZoomEnabled) return; // allow browser zoom if explicitly enabled
      // iOS WebKit (Safari AND Chrome) fires GestureEvents ALONGSIDE touch
      // events for two-finger pinches. The touch path in useCanvasTouch owns
      // finger pinches — including the release glide — and shares pinchRef
      // with this handler. Letting this run on iOS stomps that state:
      // gestureend fires when the first finger lifts and clears
      // pinchRef.active BEFORE the touchend that computes release velocity,
      // so the glide can never launch. This handler is for macOS Safari
      // trackpad pinch only; on touch devices just block native page zoom.
      if (isIOS || isTouchDeviceRef.current) {
        try { e?.preventDefault?.(); } catch { }
        return;
      }
      if (!e || typeof e.scale !== 'number') return;
      try { e.preventDefault(); e.stopPropagation(); } catch { }
      const rect = container.getBoundingClientRect();
      const fallbackX = rect.left + rect.width / 2;
      const fallbackY = rect.top + rect.height / 2;
      const clientX = (typeof e.clientX === 'number') ? e.clientX : (lastMousePosRef.current?.x ?? fallbackX);
      const clientY = (typeof e.clientY === 'number') ? e.clientY : (lastMousePosRef.current?.y ?? fallbackY);
      // A new pinch supersedes any coast still running from the previous one.
      stopZoomMomentum();
      stopTrackpadZoom();
      gestureAnchor = { x: clientX, y: clientY };
      gestureStartZoom = zoomLevelRef.current;
      pinchRef.current.active = true;
      pinchRef.current.centerClient = { x: clientX, y: clientY };
      isPanningOrZooming.current = true;
      armGestureBlock();
    };

    const onGestureChange = (e) => {
      if (abstractionCarouselVisibleRef.current) return; // pan/zoom locked while carousel is open
      if (trackpadZoomEnabled) return; // allow browser zoom if explicitly enabled
      // Finger pinches are owned by the touch path — see onGestureStart.
      if (isIOS || isTouchDeviceRef.current) {
        try { e?.preventDefault?.(); } catch { }
        return;
      }
      if (!e || typeof e.scale !== 'number') return;
      // Skip gesture zoom during drag to prevent interference with drag zoom animation
      if (draggingNodeInfoRef.current || isAnimatingZoomRef.current) return;
      try { e.preventDefault(); e.stopPropagation(); } catch { }
      const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gestureStartZoom * e.scale));
      // Same smoother as the wheel path — it eases toward the target on the
      // compositor's clock and owns the anchoring. This handler used to apply
      // its own 0.35 lerp inline; sharing one loop means the release coast
      // (target extension in endTrackpadZoomGesture) works identically here.
      setTrackpadZoomTarget(targetZoom, gestureAnchor.x, gestureAnchor.y, MIN_ZOOM, MAX_ZOOM);
      // Sample the raw finger-driven target, not the eased on-screen zoom, so
      // the measured release velocity is true to the fingers.
      recordTrackpadZoomSample(targetZoom, null, e.timeStamp);
    };

    const onGestureEnd = (e) => {
      // Finger pinches are owned by the touch path — see onGestureStart.
      // Clearing pinchRef.active here on iOS races the touchend handler and
      // permanently suppresses the pinch-release glide.
      if (isIOS || isTouchDeviceRef.current) {
        try { e?.preventDefault?.(); } catch { }
        return;
      }
      if (pinchRef.current.active) {
        pinchRef.current.active = false;
      }
      isPanningOrZooming.current = false;
      ignoreCanvasClick.current = true;
      armGestureBlock();
      scheduleGestureBlockClear();
      // Safari gives a real end event, so the coast launches immediately here
      // rather than waiting out the ctrl+wheel path's idle timer.
      endTrackpadZoomGesture();
    };

    container.addEventListener('gesturestart', onGestureStart, { passive: false });
    container.addEventListener('gesturechange', onGestureChange, { passive: false });
    container.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      container.removeEventListener('gesturestart', onGestureStart);
      container.removeEventListener('gesturechange', onGestureChange);
      container.removeEventListener('gestureend', onGestureEnd);
    };
  };

  return {
    panMomentumRef,
    zoomMomentumRef,
    stopPanMomentum,
    startPanMomentum,
    viewMotionRef,
    sampleViewMotion,
    isViewMoving,
    stopZoomMomentum,
    startZoomMomentum,
    trackpadZoomRef,
    detentRectRef,
    zoomPerfRef,
    stopTrackpadZoom,
    setTrackpadZoomTarget,
    endTrackpadZoomGesture,
    recordTrackpadZoomSample,
    handleWheel,
    attachWheelGuard,
    attachGestures,
  };
}
