/**
 * Viewport culling (moved verbatim from NodeCanvas's runCulling): decides which
 * nodes and connections are mounted, rAF-coalesced, with a motion-aware commit
 * policy (grow while moving, prune on settle). NodeCanvas calls it from the
 * transform hook and on data changes; P3.11 moves its output to a viewport
 * store so the layers subscribe to it instead of NodeCanvas.
 */
import * as GeometryUtils from '../../../utils/canvas/geometryUtils.js';

/** One culling pass (see the header). `ctx` carries NodeCanvas's refs and setters. */
export function runCullingPass(ctx) {
  const {
    cullingRafIdRef, zoomPerfRef, glowUpdateRef, ENABLE_CULLING, nodesRef, edgesRef, visibleNodeIdsRef,
    setVisibleNodeIds, visibleEdgesRef, setVisibleEdges, viewportSizeRef, canvasSizeRef, draggingNodeInfoRef,
    isAnimatingZoomRef, panOffsetRef, zoomLevelRef, cullPruneRef, isViewMovingRef, cullGuardRectRef,
    baseDimsByIdRef, nodeByIdRef,
  } = ctx;
  if (cullingRafIdRef.current != null) return;

  cullingRafIdRef.current = requestAnimationFrame(() => {
    cullingRafIdRef.current = null;
    const perfOn = typeof window !== 'undefined' && window.__zoomPerf;
    const perfStart = perfOn ? performance.now() : 0;
    const perfDone = () => {
      if (!perfOn) return;
      const ms = performance.now() - perfStart;
      const p = zoomPerfRef.current;
      p.cullingRuns++;
      p.cullingMs += ms;
      if (ms > p.cullingWorstMs) p.cullingWorstMs = ms;
    };

    // Notify EdgeGlowIndicator (and any other transform-driven subscribers)
    // BEFORE the culling guards, so the glow still tracks transform updates
    // during node drag / pinch animation where culling itself is skipped.
    glowUpdateRef.current?.();

    try {
    if (!ENABLE_CULLING) {
      // CULLING DISABLED - Show all nodes and edges.
      //
      // This branch runs on EVERY pan/zoom mutation (via onTransformChangeRef),
      // so it must not hand React fresh state identities each frame — doing so
      // forces a full NodeCanvas commit at ~60Hz and tanks framerate on large
      // graphs. The visible set here is a pure function of nodes/edges, so bail
      // out unless membership actually changed.
      const all = nodesRef.current;
      const allEdges = edgesRef.current;

      const prevIds = visibleNodeIdsRef.current;
      let nodesUnchanged = prevIds.size === all.length;
      if (nodesUnchanged) {
        for (let i = 0; i < all.length; i++) {
          if (!prevIds.has(all[i].id)) { nodesUnchanged = false; break; }
        }
      }
      if (!nodesUnchanged) {
        const allIds = new Set();
        for (let i = 0; i < all.length; i++) allIds.add(all[i].id);
        visibleNodeIdsRef.current = allIds;
        setVisibleNodeIds(allIds);
      }

      if (visibleEdgesRef.current !== allEdges) {
        visibleEdgesRef.current = allEdges;
        setVisibleEdges(allEdges);
      }
      return;
    }

    const viewport = viewportSizeRef.current;
    const canvas = canvasSizeRef.current;
    if (!viewport || !canvas) return;

    // An interaction that may not lose mounted content mid-flight: a node drag
    // (whose edge auto-pan reveals new canvas while the dragged node's own
    // position is DOM-bypassed and must not be re-culled from under it). It
    // used to skip culling outright, which under a moving viewport means
    // staring at blank canvas until the finger lifts. Under the grow-only
    // policy below there is nothing left for it to jitter, so it only forbids
    // the prune half — and when the viewport ISN'T moving the containment gate
    // below costs one rect test and returns. (A pinch-smoothing lerp loop used
    // to hold removals here too; it was never started and has been removed.)
    //
    // Drag-zoom-out (`isAnimatingZoomRef`) is deliberately not included, so it
    // still gets full culling exactly as before.
    const holdRemovals = !!draggingNodeInfoRef.current && !isAnimatingZoomRef.current;

    // Read live pan/zoom directly from refs — this is the whole point of the fix.
    const pan = panOffsetRef.current;
    const zoom = zoomLevelRef.current;

    // Derive canvas-space viewport
    const minX = (-pan.x) / zoom + canvas.offsetX;
    const minY = (-pan.y) / zoom + canvas.offsetY;
    const maxX = minX + viewport.width / zoom;
    const maxY = minY + viewport.height / zoom;

    // COMMIT POLICY — this is what makes culling survivable during a zoom.
    //
    // Every membership change is a synchronous setState, i.e. a full canvas
    // render mid-gesture. Pan barely produces any (the viewport translates
    // rigidly and the hysteresis band absorbs the rest), but zoom scales
    // screen space about the cursor, so distant content crosses the whole band
    // between two frames and membership oscillates. That churn is what got
    // culling switched off.
    //
    // So while the view is in motion the set may only GROW. Additions have to
    // be prompt — a node that entered the viewport but isn't mounted IS the
    // flicker — while removals are by definition invisible and can wait for
    // the settle prune. In-motion commits are therefore bounded by how much
    // content the gesture reveals, not by how often membership oscillates.
    // A pending prune request survives until a tick can actually honour it —
    // clearing it on a tick that isn't allowed to prune (mid-drag, mid-pinch)
    // would silently drop the recompute a deletion or resize asked for.
    const prune = !holdRemovals && (cullPruneRef.current || !isViewMovingRef.current);
    if (prune) cullPruneRef.current = false;

    // Containment gate. The last computed cull mounted everything inside its
    // inner rect, and content is only actually on screen once it enters the
    // true viewport rect — so there is a whole padding band of slack between
    // "covered" and "visible". While the view is moving, spend it: skip the
    // O(nodes + edges) pass entirely until the viewport has eaten half of it.
    // Zooming IN never leaves the guard at all (the viewport only shrinks), so
    // an in-zoom costs zero culling work and zero commits.
    if (!prune) {
      const guard = cullGuardRectRef.current;
      if (guard
        && minX >= guard.minX && minY >= guard.minY
        && maxX <= guard.maxX && maxY <= guard.maxY) {
        return;
      }
    }

    // Two-zone hysteresis: `inner` is the threshold to ADD a node/edge to
    // the visible set; `outer` (= inner + HYSTERESIS_BAND) is the threshold
    // to REMOVE one that's already visible.
    //
    // Band is specified in SCREEN pixels, then converted to canvas units via
    // zoom. A canvas-unit band collapses visually at low zoom (e.g. 100
    // canvas units = 50 screen px at zoom 0.5), making it easy for a single
    // wheel tick or pinch delta to cross the entire deadband in one frame
    // and defeat hysteresis. Screen-space keeps the visual "sticky zone"
    // constant at every zoom level so per-frame deltas never cross it.
    const HYSTERESIS_BAND_SCREEN_PX = 400;
    const HYSTERESIS_BAND = HYSTERESIS_BAND_SCREEN_PX / zoom;
    const innerPadding = Math.max(200, Math.min(2000, 500 / zoom));
    const outerPadding = innerPadding + HYSTERESIS_BAND;
    const innerRect = {
      minX: minX - innerPadding,
      minY: minY - innerPadding,
      maxX: maxX + innerPadding,
      maxY: maxY + innerPadding,
    };
    const outerRect = {
      minX: minX - outerPadding,
      minY: minY - outerPadding,
      maxX: maxX + outerPadding,
      maxY: maxY + outerPadding,
    };

    // Half the padding is the roaming allowance for the gate above: from here
    // the viewport can grow or slide by innerPadding/2 (250 screen px at the
    // unclamped default, at any zoom, since innerPadding is 500/zoom) before
    // anything it might reveal could reach the screen unmounted.
    const guardMargin = innerPadding / 2;
    cullGuardRectRef.current = {
      minX: innerRect.minX + guardMargin,
      minY: innerRect.minY + guardMargin,
      maxX: innerRect.maxX - guardMargin,
      maxY: innerRect.maxY - guardMargin,
    };

    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const dimsMap = baseDimsByIdRef.current;
    const nodeMap = nodeByIdRef.current;
    const prevVisibleNodeIds = visibleNodeIdsRef.current;
    // Build Set<edgeId> for O(1) prev-visibility lookup (visibleEdgesRef is an array).
    const prevVisibleEdgesArr = visibleEdgesRef.current;
    const prevVisibleEdgeIds = new Set();
    for (let i = 0; i < prevVisibleEdgesArr.length; i++) {
      prevVisibleEdgeIds.add(prevVisibleEdgesArr[i].id);
    }

    // Visible nodes with hysteresis
    const nextVisibleNodeIds = new Set();
    for (const n of currentNodes) {
      const dims = dimsMap.get(n.id);
      if (!dims) continue;

      const nx1 = n.x;
      const ny1 = n.y;
      const nx2 = n.x + dims.currentWidth;
      const ny2 = n.y + dims.currentHeight;

      // Previously visible → use outer rect (stays visible until clearly outside)
      // Not previously visible → use inner rect (must come clearly inside to appear)
      const wasVisible = prevVisibleNodeIds.has(n.id);
      const rect = wasVisible ? outerRect : innerRect;
      const isVisible = !(nx2 < rect.minX || nx1 > rect.maxX || ny2 < rect.minY || ny1 > rect.maxY);

      if (isVisible) {
        nextVisibleNodeIds.add(n.id);
      }
    }

    // Visible edges — include if either endpoint node is visible, OR if the
    // straight line between node centers crosses the viewport area (handles
    // long edges where both endpoints are off-screen but the edge itself is visible).
    // Hysteresis applied to the slow-path line intersection test as well.
    const nextVisibleEdges = [];
    for (const edge of currentEdges) {
      const s = nodeMap.get(edge.sourceId);
      const d = nodeMap.get(edge.destinationId);
      if (!s || !d) continue;

      // Fast path: if either node is visible, the edge is visible
      // (node hysteresis already prevents endpoint flicker, so this is stable).
      if (nextVisibleNodeIds.has(edge.sourceId) || nextVisibleNodeIds.has(edge.destinationId)) {
        nextVisibleEdges.push(edge);
        continue;
      }

      // Slow path: both nodes off-screen, check if edge line crosses viewport.
      // Apply hysteresis: previously-visible edges test against outer rect.
      const sDims = dimsMap.get(s.id);
      const dDims = dimsMap.get(d.id);
      if (!sDims || !dDims) continue;
      const sx = s.x + sDims.currentWidth / 2;
      const sy = s.y + sDims.currentHeight / 2;
      const dx = d.x + dDims.currentWidth / 2;
      const dy = d.y + dDims.currentHeight / 2;
      const edgeRect = prevVisibleEdgeIds.has(edge.id) ? outerRect : innerRect;
      if (GeometryUtils.lineIntersectsRect(sx, sy, dx, dy, edgeRect)) {
        nextVisibleEdges.push(edge);
      }
    }

    // Grow-only merge (see COMMIT POLICY). Anything the previous tick had
    // stays for this one; only a prune tick is allowed to drop it. Entities
    // deleted from the graph can't be resurrected by this: nodes are re-checked
    // against nodeMap, and the edge list is rebuilt by filtering the CURRENT
    // edges array, which also keeps edge order stable for the identity-compare
    // bail-out below.
    let commitNodeIds = nextVisibleNodeIds;
    let commitEdges = nextVisibleEdges;
    if (!prune) {
      let grewNodes = false;
      for (const id of prevVisibleNodeIds) {
        if (!nextVisibleNodeIds.has(id) && nodeMap.has(id)) {
          if (!grewNodes) { commitNodeIds = new Set(nextVisibleNodeIds); grewNodes = true; }
          commitNodeIds.add(id);
        }
      }

      const nextEdgeIds = new Set();
      for (let i = 0; i < nextVisibleEdges.length; i++) nextEdgeIds.add(nextVisibleEdges[i].id);
      let grewEdges = false;
      for (let i = 0; i < prevVisibleEdgesArr.length; i++) {
        if (!nextEdgeIds.has(prevVisibleEdgesArr[i].id)) {
          nextEdgeIds.add(prevVisibleEdgesArr[i].id);
          grewEdges = true;
        }
      }
      if (grewEdges) {
        commitEdges = [];
        for (const edge of currentEdges) {
          if (nextEdgeIds.has(edge.id)) commitEdges.push(edge);
        }
      }
    }

    // Update refs synchronously — these are the hysteresis "previous visible
    // set" for the NEXT runCulling tick. The useEffect sync at the bottom of
    // the component is too late because passive effects can lag behind
    // consecutive RAF ticks under zoom pressure (worse in large graphs where
    // commits are expensive), causing hysteresis to evaluate against a stale
    // prev and flicker edges at viewport edges. These refs are read only
    // inside runCulling itself, so owning them here is safe.
    visibleNodeIdsRef.current = commitNodeIds;
    visibleEdgesRef.current = commitEdges;

    // Synchronous visibility commit (no startTransition) so the visible set
    // always lands in lockstep with the SVG DOM transform — using transitions
    // here causes edges to flicker during zoom because the transform updates
    // immediately but the deferred visibility commit lags by a frame or two.
    // The updaters return prev when membership is unchanged, and useTrackedState
    // then skips the set, so a steady-state pan costs no render (F-79).
    setVisibleNodeIds(prev => {
      if (prev.size === commitNodeIds.size) {
        let same = true;
        for (const id of commitNodeIds) {
          if (!prev.has(id)) { same = false; break; }
        }
        if (same) return prev;
      }
      return commitNodeIds;
    });
    setVisibleEdges(prev => {
      if (prev.length === commitEdges.length) {
        let same = true;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] !== commitEdges[i]) { same = false; break; }
        }
        if (same) return prev;
      }
      return commitEdges;
    });
    } finally { perfDone(); }
  });
}
