# Zoom Performance Diagnosis — Lombardi + Connection Labels

*2026-08-07. Full trace of the zoom-only collapse with Lombardi routing + connection labels
enabled. Line numbers refer to the working tree as of this date (including the uncommitted
`isMoving` → ref change in `NodeCanvas.jsx` / `useCanvasTransform.js`).*

---

> **Status update (same day):** the `<textPath>` cost described throughout this
> document is **fixed** — curved Lombardi labels are now placed glyph by glyph
> from the analytic arc (`labelArcGlyphFrames` in `edgeRouting.js`), so nothing
> re-parameterises a path per paint and curved/straight labels are one element
> in two forms. That removes the amplifier under mechanisms 1 and 2 and the
> `getTotalLength()` flush at drag start. **Mechanisms 1–4 below are otherwise
> untouched and still live** — culling is still off, the detent-zoom forced
> layout is still there, and the glow update is still uncoalesced.

## TL;DR

The collapse is not one bug. It is **four live mechanisms layered on top of each other**, all
zoom-specific, all of which survived every fix shipped so far — because each fix removed a
*different* mechanism (correctly), and these four are what's left:

1. **The settle re-render is O(entire graph), and zoom — unlike pan — invalidates the whole
   label population when it fires.** Viewport culling has been off since April
   (`ENABLE_CULLING = false`, commit `6f25434`), so `visibleEdges` is *all* edges and the
   post-gesture render re-runs Lombardi routing and label JSX for every edge in the universe:
   measured **143ms with labels on vs 15ms worst-frame with labels off**. Discrete mouse-wheel
   zooming pays this **once per detent burst** (detents >150ms apart each get their own settle).
   A pan settle runs the same render but changes nothing downstream — every zoom settle
   re-derives `labelAngleQuantum` and `labelArcMinBow`, which can rewrite every label's
   rotation and flip labels between `<textPath>` and `<text>` structurally.

2. **Mouse-wheel detent zoom forces a synchronous layout on every single detent.** The detent
   branch calls `getBoundingClientRect()` per event with its rect cache permanently null
   (`stopTrackpadZoom()` nulls it; only the trackpad path ever repopulates it). Reading layout
   immediately after dirtying the *scale* re-resolves every glyph and textPath
   arc-length-parameterization first — the repo's own measured table shows this read at
   **0.1ms during pan vs 4.9ms during zoom** (600 textPath labels): a 49× asymmetry. Pan never
   reads layout at all.

3. **EdgeGlowIndicator (on by default) commits React state on every transform mutation,
   uncoalesced.** When culling was disabled, the transform callback swapped from the
   RAF-coalesced `runCulling` to a bare lambda — the RAF gate went with it. Every tick now
   runs two `setState`s plus an O(all nodes) memo. And trackpad zoom is a *worse* client of
   this than pan: it is rAF-driven with an ease tail plus a momentum glide, so it emits
   strictly more mutations, for longer, than the input itself.

4. **Zoom churns structure; pan only translates it.** During zoom the off-screen set grows or
   shrinks monotonically, so glow flares mount/unmount continuously (pan just slides them),
   and at settle `labelArcMinBow` can swap label DOM shape (3 elements ↔ 1).

**And one thing that is measured NOT to be the problem:** in-motion glyph rasterization.
Sweeping the scale on the real content group (260 labels, 3,300 SVG elements) costs
8.4ms/frame — identical to panning it (tombstone at `NodeCanvas.jsx:214-235`). Angle
quantization already won that battle; the zoom-scale quantization was correctly removed. Stop
looking there.

**Bonus finding (correctness, not perf):** with culling off, `curveLabels` compares the
**whole graph's** edge count against `CURVED_LABEL_BUDGET` (40) — so on any real universe,
**curved Lombardi labels are globally disabled** and every label renders as straight rotated
text. Same for the other count budgets: `labelAngleQuantum` engages off *total* edges (>48),
and the crossing-dodge cutoff (220) trips on totals. The budgets no longer mean what their
comments say.

---

## Why zoom falls apart and pan doesn't

| Mechanism | Pan | Zoom |
|---|---|---|
| Layout read per wheel event | never (`handleWheel` pan branch reads no layout) | **every mouse detent** (`NodeCanvas.jsx:8676` via `getRect`, rect cache null on this path) |
| Cost of that layout read | 0.1ms — translate keeps SVG text layout valid | **4.9ms @ 600 textPath labels** — scale invalidates all glyph/textPath layout (`EdgeGlowIndicator.jsx:123-140`) |
| Transform mutations per gesture | 1 per wheel event, ends with input (+momentum tail) | **1 per rAF frame** for the whole gesture **plus ease tail plus glide extension** (`NodeCanvas.jsx:2745-2884`, `2890-2933`) |
| `labelAngleQuantum` at settle | referentially stable → zero label churn | re-derived from `zoomLevel` (`NodeCanvas.jsx:3611-3628`) → when the bucket crosses a threshold, **every** label + hit-rect gets a new `rotate()` → bulk DOM diff → full glyph re-raster |
| `labelArcMinBow` at settle | unchanged | `LABEL_CURVE_MIN_SCREEN_PX / zoomLevel` (`NodeCanvas.jsx:3653-3656`) → labels flip `<textPath>` ↔ `<text>` **structurally** |
| Settles per gesture | one, after the gesture | **one per detent burst** for mouse-wheel zoom (detents >150ms apart each reset the 150ms timer independently) |
| Off-screen/glow set | translates rigidly — flares just move | grows/shrinks monotonically — **flares mount/unmount every frame** (`EdgeGlowIndicator.jsx:174-364`) |

The per-frame paint itself (the thing most of the fixes targeted) is symmetric *now*: after
angle quantization, a scale sweep and a translate both cost ~8.4ms/frame on the real
universe. The asymmetry lives entirely in the **event path** (2), the **settle path** (1),
and the **side-channel React commits** (3, 4).

---

## History: what was tried, and what each attempt actually bought

Worth recording because every one of these was rational, most of them *worked*, and the
symptom persisting anyway is what made this feel unfixable.

| Fix | Status | What it actually bought |
|---|---|---|
| DOM-bypass transform (refs + settled state, SVG attr transform on content `<g>`) | ✅ in place | Zero NodeCanvas commits during a gesture. Working as designed. |
| Label **angle** quantization (`labelAngleQuantum`, buckets to 9°) | ✅ in place | Killed the glyph-atlas thrash from hundreds of distinct rotation matrices — the 200-label 41.7ms→8.4ms win. This is why in-motion paint is now symmetric. |
| `<textPath>` count budget (`CURVED_LABEL_BUDGET = 40`) | ✅ in place, **misfiring** | Right idea; but fed *total* edge count with culling off, so it currently disables curved labels everywhere instead of budgeting them. |
| Crossing-dodge budget (`LABEL_CROSSING_BUDGET = 220`) | ✅ in place, same misfire | Fed total counts. |
| **Zoom-scale** quantization (6% steps during motion, commit `9b5c383`) | ❌ reverted next commit (`a5636e7`) | Correctly removed — the harness result didn't reproduce on the real canvas (8.4ms either way). Tombstone at `NodeCanvas.jsx:214-235`. |
| Edge-glow flare de-blur + intensity bucketing (`a5636e7`) | ✅ in place | Removed the blurred box-shadow repaint that *was* the measured in-motion stutter at the time. But the *commit frequency* problem (mechanism 3) remained. |
| Glow container-rect hoisted out of the frame loop | ✅ in place | Removed a forced layout per glow update (the 49× read). The detent-zoom branch still has its own copy of this bug (mechanism 2). |
| `isMoving` React state → ref (uncommitted) | ✅ in working tree | Removed 2×143ms renders per gesture. Correct — but the *settle* render itself is still 143ms and still fires per detent burst. |
| Viewport culling | ❌ **disabled** (`6f25434`, April, bundled into a self-loop refactor; `DIAGNOSE_ZOOM_FLICKER = true` still set, its plan file since deleted) | This is the silent multiplier under mechanism 1: every settle render is O(total graph), and every count budget reads totals. |

Pattern across the whole history: each fix targeted the **in-motion paint path**, and that
path is now genuinely healthy. What was never on the suspect list is the **settle path**
(fires per detent for wheel users) and the **per-tick React side channel** (glow). Those are
where the remaining time is.

---

## Mechanism detail

### 1. The settle render: O(total graph), zoom-invalidated

- `ENABLE_CULLING = false` — `NodeCanvas.jsx:384`. The disabled branch of `runCulling` sets
  `visibleNodeIds` = all nodes, `visibleEdges` = the full edges array
  (`NodeCanvas.jsx:3001-3031`). Nothing recomputes visibility during gestures at all
  (the transform callback at `3224` skips `runCulling` entirely when the flag is off).
- `renderConnectionEdge` (`NodeCanvas.jsx:13991`) is a plain function in the JSX — no
  component boundary, no memo. Every NodeCanvas commit re-runs it for **every** edge:
  `computeLombardiRouting` per edge (uncached, `14349`), `labelArcPath` per curved edge,
  `estimateTextWidth` ×3 per label.
- Label *placement* is well-insulated: `placedLabelsRef` signature
  (`pathD|name|fontSize|crossingGeneration`, `15381`) contains no zoom — a pure zoom settle
  cache-hits every placement. The placement solver is not the problem.
- What zoom uniquely does at settle:
  - `labelAngleQuantum` deps `[visibleEdges.length, zoomLevel]` (`3611-3628`). When the
    quantum crosses a threshold, `quantizeLabelAngle` changes identity and every label's
    `adjustedAngle` (`15465`) changes → new `rotate()` on every `<text>` **and** every hit
    `<rect>` → ~2N attribute writes → N fresh rotation matrices → full glyph re-raster on
    next paint.
  - `labelArcMinBow` (`3653-3656`) is recomputed from `zoomLevel` in bare render scope and
    flips labels across the textPath/straight threshold in bulk (`15480-15487`) — structural
    unmount/mount, not attribute diff. (Currently masked on big graphs by the `curveLabels`
    misfire, but it re-arms the moment culling returns.)
- Measured: 143ms full render with labels on; 15ms worst-frame with labels off
  (comment at `NodeCanvas.jsx:3601-3607`).
- Mouse-wheel cadence interacts viciously with `SETTLE_DELAY = 150`: casual detent zooming
  is a series of bursts spaced >150ms apart, so **each burst pays its own 143ms render**.
  This alone is "completely falls apart" for a wheel user.
- 300ms after each settle, `updateGraphViewInStore` (`7960-8000`) writes pan/zoom to Zustand
  — one more render pass. Correctly debounced, listed for completeness.

### 2. The detent-zoom forced layout

- Detent branch: `stopTrackpadZoom()` (`8655`) nulls `trackpadZoomRef.current.rect`, then
  `getRect()` (`8676` → `getBoundingClientRect` at `8564`) runs on **every detent**, always a
  cache miss. The read forces style+layout of the SVG whose scale the *previous* detent's
  transform write just dirtied.
- The identical bug was already found and fixed twice elsewhere — the trackpad path caches
  the rect per gesture (`2757`), and EdgeGlowIndicator hoisted its rect read
  (`EdgeGlowIndicator.jsx:146-163`, with the 0.1 vs 4.9ms measurement table). The detent
  branch is the last copy.

### 3. EdgeGlowIndicator per-tick commits, uncoalesced

- `NodeCanvas.jsx:3224`: `const base = ENABLE_CULLING ? runCulling : () => { glowUpdateRef.current?.(); }`.
  The RAF coalescer lives *inside* `runCulling` (`2979-2983`) — so disabling culling silently
  removed coalescing from the glow update. `EdgeGlowIndicator.jsx:77-79` still documents it
  as RAF-coalesced; that comment is now false.
- Per transform mutation (per rAF frame for the entire trackpad gesture + ease tail + glide):
  `setLivePan` + `setLiveZoom` (`EdgeGlowIndicator.jsx:85-102`) → `allNodeData` memo over
  **all** nodes (`174-250`, deps include `livePan, liveZoom`) → `offScreenGlows` → render.
  On a 120Hz trackpad that is up to 120 commits/sec of O(N) work, on top of paint.
- Zoom-specific extra: the off-screen set changes monotonically during zoom, so flare
  elements mount/unmount per frame; during pan they only translate.
- Gated on `showEdgeGlowIndicators`, which **defaults to true** (`graphStore.js:1167-1174`).

### 4. What re-enabling culling naively would do (why it's off, presumably)

The existing hysteresis is a **screen-space** 400px band (`HYSTERESIS_BAND_SCREEN_PX`,
`3064-3065`) — explicitly designed to make pan sticky, and it works: a pan translates the
viewport rect rigidly, per-frame deltas never cross the band. But a zoom *scales* screen
space about the cursor: content at radius r moves `r·(Δz/z)` screen px per frame, so far
content crosses the whole band in one frame, membership churns, and every churn is a
synchronous `setVisibleEdges` → full O(visible) render mid-gesture. `innerPadding` is also
zoom-dependent (`500/zoom`, `3066`), so the add threshold itself slides during a sweep. That
churn is almost certainly the "zoom flicker" the still-live `DIAGNOSE_ZOOM_FLICKER` flag
(`388`) was investigating when culling got switched off — the flag's plan file no longer
exists, and the disable shipped bundled into a self-loop refactor (`6f25434`), which is how
it escaped the suspect list.

---

## Treatment plan (ranked)

Each item is independent; expected wins are per the repo's own measurements.

1. **Kill the per-detent forced layout** (smallest change, immediate wheel-zoom win).
   Cache the container rect per gesture on the detent path exactly as the trackpad path does
   (populate `trackpadZoomRef.current.rect` on first detent, invalidate on resize/scroll/
   gesture-end), or compute from the already-tracked `viewportSize`/container offset without
   touching layout. Expected: removes a ~5ms+ synchronous stall per detent that lands at the
   worst possible moment (right before the frame's paint).

2. **Restore RAF coalescing for the glow update, independent of `ENABLE_CULLING`**
   (one-line-shaped fix, big trackpad win). Wrap the disabled-branch lambda in the same
   `requestAnimationFrame` gate `runCulling` uses — or better, feed EdgeGlowIndicator through
   the same DOM-bypass discipline as everything else (settled state + imperative per-frame
   positioning), or suspend it while `isMovingRef` is true. Also fix the stale comment at
   `EdgeGlowIndicator.jsx:77-79`. Cheap A/B available today: toggle edge glow off and compare.

3. **Bring back viewport culling with a zoom-aware membership policy** (the structural fix —
   it shrinks the 143ms settle to O(visible) *and* un-breaks every count budget, which
   restores curved Lombardi labels on real graphs). The pan-side hysteresis can stay; zoom
   needs its own damping, e.g.:
   - recompute membership only when zoom has moved ±N% since the last cull (log-zoom bucket,
     same shape as the angle quantum), and always once at settle; and/or
   - commit *removals* lazily (an off-screen element that stays mounted one extra beat is
     invisible) and *additions* on the rAF tick they appear — additions are what flicker.
   Re-derive the flicker diagnosis first: `DIAGNOSE_ZOOM_FLICKER` is still wired
   (`3158-3182`) and can confirm whether membership churn was the flicker.

4. **Make the settle render reconcile instead of re-solve.** Memoize per-edge routing
   (`computeLombardiRouting` keyed on endpoint geometry + curvature + bundle — the same
   signature discipline `placedLabelsRef` already uses), so a settle render is a cache sweep,
   not a re-route of the universe. This also softens whatever residual settle cost remains
   after culling returns.

5. **Hygiene** (prevents the next false trail):
   - Remove `DIAGNOSE_ZOOM_FLICKER` or gate it behind a `window.__` switch like `__zoomPerf`.
   - Fix the contradictory comment at `NodeCanvas.jsx:3640-3644` ("~0.14ms per label, linear
     in count") — the corrected table at `179-190` explicitly disproves both halves.
   - Decide what `visibleEdges` *means* while culling is off, or stop feeding it to the
     budgets (`curveLabels`, `labelAngleQuantum`, crossing cutoff) — today all three are
     silently keyed to universe size.

**Suggested order:** 1 and 2 first (small, independently verifiable, together they address
the wheel-user and trackpad-user collapse respectively), then 3 as the structural fix, then 4.

---

## How to verify each mechanism on the real universe

- **Mechanism 3 (glow):** Settings → toggle edge glow indicators off (or
  `localStorage.setItem('redstring_show_edge_glow','false')` + reload). If trackpad zoom
  recovers substantially, confirmed.
- **Mechanism 1 (settle):** temporarily set `SETTLE_DELAY` to 2000ms in
  `useCanvasTransform.js`. If wheel zoom becomes smooth *during* motion with one big hitch
  2s after stopping, confirmed — the collapse is settle renders, not frames.
- **Mechanism 2 (detent reflow):** DevTools Performance trace of mouse-wheel zoom; look for
  purple "Recalculate style / Layout" slices inside the wheel event, attributed to
  `getBoundingClientRect`. Compare against a trackpad gesture (should be absent after the
  first event).
- **Frame-level accounting:** `window.__zoomPerf = true` in console, zoom, read the
  accumulator (probe at `NodeCanvas.jsx:2798-2805`) — this was built for exactly this and is
  still wired.
- **Culling counterfactual:** flip `ENABLE_CULLING = true` on a branch and zoom — expect
  *mid-gesture* commits (the flicker) but a fast settle; that pair of observations confirms
  both halves of mechanism 1/4.
