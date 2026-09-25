/**
 * Semantic orbit (moved verbatim from NodeCanvas): fetching candidates while orbit
 * mode is on, hovering a candidate, and sizing the dim rect behind it. P5.08
 * moves the orbit into its own host.
 */
import useGraphStore from '../../../store/graphStore.js';
import { fetchOrbitCandidatesForPrototype, dedupeAndPartitionOrbit } from '../../../services/orbitResolver.js';
import { formatPredicate } from '../../../utils/predicateFormatter.js';
import { NODE_DEFAULT_COLOR, NODE_WIDTH, NODE_HEIGHT } from '../../../constants';
import { ORBIT_FIT_PADDING, ORBIT_FIT_MIN_ZOOM } from './orbitConstants.js';
import { MAX_ZOOM } from '../../../constants';

/** Fetch the focused node's orbit candidates while orbit mode is on. */
export function fetchOrbitCandidates(ctx) {
  const {
    semanticOrbitActive, selectedInstanceIds, orbitSetRef, EMPTY_ORBIT, setOrbitData, setOrbitLoading,
    activeGraphId,
  } = ctx;
  let cancelled = false;
  (async () => {
    try {
      if (!semanticOrbitActive || selectedInstanceIds.size !== 1) {
        // Reset only what isn't reset already. This runs on every selection
        // change, and a same-value set from an effect still costs a
        // NodeCanvas run that React throws away.
        if (orbitSetRef.current.data !== EMPTY_ORBIT) setOrbitData(EMPTY_ORBIT);
        if (orbitSetRef.current.loading) setOrbitLoading(false);
        return;
      }

      const instanceId = [...selectedInstanceIds][0];
      const graph = useGraphStore.getState().graphs.get(activeGraphId);
      const inst = graph?.instances?.get(instanceId);
      const proto = inst ? useGraphStore.getState().nodePrototypes.get(inst.prototypeId) : null;

      if (!proto) {
        setOrbitData(EMPTY_ORBIT);
        setOrbitLoading(false);
        return;
      }

      setOrbitLoading(true);

      // streamedCount tracks how many items onProgress has already shown
      let streamedCount = 0;
      const candidates = await fetchOrbitCandidatesForPrototype(proto, {
        onProgress: (data) => {
          if (!cancelled) {
            streamedCount = (data.all || []).length;
            setOrbitData(data);
            setOrbitLoading(false);
          }
        },
      });

      if (cancelled) return;

      // Trickle any remaining items not yet shown by onProgress (covers cached results
      // where onProgress never fires, or fills in the final batch)
      const all = candidates.all || [];
      if (streamedCount < all.length) {
        for (let i = Math.max(streamedCount, 2); i <= all.length; i += 2) {
          if (cancelled) return;
          const partial = all.slice(0, i);
          const snapshot = dedupeAndPartitionOrbit(partial);
          setOrbitData(snapshot);
          if (i < all.length) {
            await new Promise(r => setTimeout(r, 120));
          }
        }
      }

      if (!cancelled) {
        setOrbitData(candidates);
        setOrbitLoading(false);
      }
    } catch (error) {
      console.error('Orbit search failed:', error);
      if (!cancelled) {
        setOrbitData(EMPTY_ORBIT);
        setOrbitLoading(false);
      }
    }
  })();
  return () => { cancelled = true; };
}

/** Preview an orbit candidate as the triplet it would become. */
export function hoverOrbitCandidate(ctx, candidate) {
  const { selectedInstanceIds, nodes, commitHoverTarget, baseDimsById } = ctx;
  const focusInstanceId = selectedInstanceIds.size > 0 ? [...selectedInstanceIds][0] : null;
  const focus = focusInstanceId ? nodes.find(n => n.id === focusInstanceId) : null;
  if (!candidate || !focus) {
    commitHoverTarget({ kind: 'none' });
    return;
  }

  const focusDims = baseDimsById.get(focus.id);
  const predicateLabel = formatPredicate(candidate.predicate || 'relatedTo');
  commitHoverTarget({
    kind: 'orbitItem',
    id: candidate.id,
    connection: {
      id: `orbit-${candidate.id}`,
      name: predicateLabel,
      color: candidate.color || NODE_DEFAULT_COLOR,
      source: {
        id: focus.id,
        name: focus.name,
        color: focus.color,
        width: focusDims?.currentWidth ?? NODE_WIDTH,
        height: focusDims?.currentHeight ?? NODE_HEIGHT,
        prototypeId: focus.prototypeId
      },
      target: {
        id: candidate.id,
        name: candidate.name,
        color: candidate.color || NODE_DEFAULT_COLOR,
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      },
      // The arrow the edge would carry if this were placed — see the
      // directionality on the edge handleOrbitItemClick creates.
      directionality: { arrowsToward: new Set([candidate.id]) }
    }
  });
}

/** Size the orbit dim rect to the viewport (an imperative write every pan/zoom tick). */
export function sizeOrbitDimRect(ctx) {
  const {
    orbitDimRectRef, ENABLE_ORBIT_DIM, panOffsetRef, zoomLevelRef, viewportSizeRef, canvasSize,
    ORBIT_DIM_MARGIN,
  } = ctx;
  const el = orbitDimRectRef.current;
  if (!el) return;
  // With dimming off the rect is transparent and statically sized to the whole
  // canvas plane, so it never needs repositioning — and skipping this removes
  // a write into the content group on every pan tick.
  if (!ENABLE_ORBIT_DIM) return;
  const pan = panOffsetRef.current;
  const z = zoomLevelRef.current || 1;
  const vp = viewportSizeRef.current;
  const vw = vp.width / z;
  const vh = vp.height / z;
  const x0 = (0 - pan.x) / z + (canvasSize?.offsetX || 0);
  const y0 = (0 - pan.y) / z + (canvasSize?.offsetY || 0);
  // Cover the viewport plus a small margin — NOT the 3x-per-side box this
  // used to use, which was ~9 viewports of blending.
  //
  // Sizing it down was not enough to make this affordable, which is why the
  // flag above is off: a translucent element inside the content group makes
  // the SVG's own tiles non-opaque at ANY size, so the whole graph beneath
  // gets blended instead of discarded. The scrim has to become a separate
  // compositor layer above the <svg> — one flat blend on the GPU — rather
  // than an element competing inside the canvas's own raster.
  const m = ORBIT_DIM_MARGIN;
  el.setAttribute('x', x0 - vw * m);
  el.setAttribute('y', y0 - vh * m);
  el.setAttribute('width', vw * (1 + 2 * m));
  el.setAttribute('height', vh * (1 + 2 * m));
}

/** While orbiting, pull the view back so the rings fit, continuously rather than in jumps. */
export function fitOrbitInView(ctx) {
  const {
    semanticOrbitActive, orbitFitRef, orbitFrame, getFramingRegion, MIN_ZOOM, zoomLevelRef, canvasSize,
    viewportSize, animateCanvasView,
  } = ctx;
  if (!semanticOrbitActive) {
    orbitFitRef.current = { fitted: false, zoom: 0 };
    return;
  }
  if (!orbitFrame || !(orbitFrame.radius > 0)) return;

  const vb = getFramingRegion();
  const usable = Math.min(
    vb.width * (1 - 2 * ORBIT_FIT_PADDING),
    vb.height * (1 - 2 * ORBIT_FIT_PADDING)
  );
  const diameter = orbitFrame.radius * 2;
  const floor = typeof window !== 'undefined' && window.__orbitZoom != null
    ? Number(window.__orbitZoom)
    : ORBIT_FIT_MIN_ZOOM;
  const tz = Math.max(MIN_ZOOM, floor, Math.min(MAX_ZOOM, usable / diameter));

  const state = orbitFitRef.current;
  if (state.fitted) {
    // Already pulled back as far as this is willing to go — growing past that
    // asks for the same zoom, so there is nothing left to do.
    if (tz === state.zoom) return;
    // It grew and wants a different zoom, but still fits at whatever zoom we
    // are actually at (the user may have moved since) — leave the view alone.
    if (diameter * (zoomLevelRef.current || 1) <= usable) return;
  }

  const targetPanX = (vb.x + vb.width / 2) - (orbitFrame.centerX - canvasSize.offsetX) * tz;
  const targetPanY = (vb.y + vb.height / 2) - (orbitFrame.centerY - canvasSize.offsetY) * tz;
  const minPanX = viewportSize.width - canvasSize.width * tz;
  const minPanY = viewportSize.height - canvasSize.height * tz;
  animateCanvasView({
    x: Math.min(Math.max(targetPanX, minPanX), 0),
    y: Math.min(Math.max(targetPanY, minPanY), 0),
  }, tz);

  orbitFitRef.current = { fitted: true, zoom: tz };
}
