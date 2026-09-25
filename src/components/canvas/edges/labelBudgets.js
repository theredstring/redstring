/**
 * Connection-label rendering budgets (moved from NodeCanvas's module scope with
 * their measurements): the angle buckets, the curved-label and crossing
 * ceilings, and the notes on what was tried and removed.
 */

// ---------------------------------------------------------------------------
// CONNECTION LABEL RENDERING BUDGETS
//
// Connection labels dominate canvas paint cost, and the reason is narrower than
// it looks. Measured in Chromium on 500 labels at zoom 0.15, animating a pan so
// every frame genuinely repaints (median frame time):
//
//     500 labels, every one rotated to the SAME angle ......    0.9 ms
//     500 labels, angles snapped to 8° buckets ............     1.6 ms
//     500 labels, angles snapped to 3° buckets ............     4.7 ms
//     500 labels, angles snapped to 1° buckets ............    18.6 ms
//     500 labels, each at its own exact angle .............    50.0 ms
//     500 labels drawn on <textPath> ......................  1145.1 ms  [1]
//
// [1] HISTORICAL. Curved labels no longer use <textPath> — the glyphs are
//     positioned individually from the arc instead (see labelArcGlyphFrames in
//     edgeRouting.js), which puts them in the rows above rather than this one.
//     The number is kept because it is the reason that changed.
//
// Rotation is free. DISTINCT rotations are not. Each distinct rotation matrix
// is its own glyph-atlas key, so a few hundred labels at a few hundred angles
// blow the atlas and every glyph is re-rasterised from its outline on every
// single paint. (The stroked halo roughly doubles the per-glyph cost, but it is
// not the mechanism.) This is also the whole reason manhattan routing felt
// instant next to straight despite doing more routing work: manhattan labels
// only ever sit at 0° or 90° — two buckets, permanently cached.
//
// Three fixes follow, and all apply to every routing style:
//   1. Snap label angles into buckets (see `labelAngleQuantum`).
//   2. Curve a label only where the viewer can see the bend (see
//      `labelArcMinBow`), with a hard count budget behind it — a curved label
//      spends a matrix per glyph where a straight one spends one for the run.
//   3. Place curved glyphs ourselves rather than handing the browser a
//      <textPath>, whose per-paint re-parameterisation is the row below that
//      dwarfs every other (see labelArcGlyphFrames in edgeRouting.js).
// ---------------------------------------------------------------------------

// A second sweep, on the label counts that actually occur rather than 500.
// Chromium/Electron 39, animated pan, 120Hz display so 8.3ms is the floor (a
// frame at 8.3 had headroom left; one above it did not). Median frame time:
//
//   labels   textPath   exact    1.5°     3°      4°      6°      9°     15°
//       40        8.4     8.4     8.3    8.3     8.4     8.3     8.3    8.3
//       80       16.7    17.0    16.7   16.4    16.6     8.8     8.4    8.3
//      120       24.5    26.0    24.1   16.7    16.7     9.0     8.7    8.3
//      200       83.2    41.7    33.6   24.4    16.7    16.6     8.4    8.3
//
// Two things to read off it. First, the bucket size has to reach 6-9° before it
// buys anything at all on a real label count — at 4° a 200-label graph still
// costs two full frames. Second, the textPath column is not linear in count, as
// the 500 row above already hinted: 40→8.4ms but 200→83ms. Any budget derived
// from a fixed per-label cost is therefore wrong in the direction that hurts.
// (That column is now historical — curved labels are placed glyph by glyph and
// land in the angle columns instead. The rest of the table still governs.)

// The one rotation bucket connection labels snap into, in degrees, once enough
// of them are on screen to be worth bucketing at all.
//
// Deliberately a CONSTANT. This used to be derived from the zoom, via a budget
// on how far snapping may displace the far END of a label (3 CSS px, "a
// displacement nobody can see"), inverted through w·sin(q/2) to get the
// coarsest bucket that stayed inside it. That was wrong twice over.
//
// The visible failure: the bucket changed on every zoom, so every label
// re-rounded to a different angle while the line underneath it did not move.
// Labels rotated a degree or two against a static line, purely from zooming —
// and the sign flipped as often as not, so it read as wobble rather than as
// drift. Sweeping the same angles through the zoom-derived buckets from 0.4 to
// 2.0 swings a typical label by 2.3-3.8°. A fixed bucket cannot do this:
// whatever tilt a label has, it keeps.
//
// The quieter failure: the displacement budget measured the wrong quantity. A
// connection label sits ON its own line, so what the eye judges is not where
// the text ended up but whether two adjacent lines are PARALLEL — a far finer
// discrimination than position, and one the 3px budget says nothing about.
// Meanwhile the buckets it produced (2.25° at zoom 1, finer above) are ones the
// table above shows buying nothing at any real label count: 80 labels cost
// 16.4ms at 3° against 17.0ms exact. It reached a bucket that actually helps
// only below zoom ~0.26, where the labels are ~18px and unreadable. Visible
// tilt at every zoom that could read a label, and frame-time win at none.
//
// 4.5°, which tilts a label at most 2.25°. Sized off the 4° column of that
// table — 16.6ms at 80 labels, 16.7ms at 120, 16.7ms at 200 — so it holds a
// 60Hz frame at every count measured, including the 200-label case that costs
// 41.7ms at exact angles. It also divides 90 exactly, so manhattan's 0°/90°
// survive the snap untouched, and it collapses a full sweep of angles into 41
// atlas slots instead of hundreds, which is the entire mechanism.
//
// Not 9°, which was the first draft here. 9° is the only column that reaches
// the 8.3ms/120Hz floor at 200 labels, and it is tempting for exactly that
// reason — but it tilts a label 4.5° off the line it is lying on, and a label
// that visibly disagrees with its own connection is a worse artifact than a
// second frame on the densest view a graph ever shows. 60Hz is the bar this
// picks; the extra headroom is not worth what it costs to look at.
//
// `window.__labelAngleQuantum` overrides live; 0 means never snap.
export const LABEL_ANGLE_QUANTUM = 4.5;

// Below this many labels ON SCREEN, don't snap at all — exact angles, so each
// label lies precisely along the line it names. Applies to the styles that draw
// their labels as ONE rotated text run; lombardi is gated by style instead, see
// LABEL_ANGLE_QUANTUM_ALWAYS_STYLES.
//
// Kept as a backstop rather than as the main mechanism. Straight labels mint one
// rotation each, which is mild — a straight graph does not generate the rotation
// diversity this was built for, and at ordinary counts it is better served by
// lying exactly on its lines. But the table above still holds at the top end:
// exact angles cost 26ms at 120 labels and 41.7ms at 200, both of which drop a
// frame while panning. So the gate stays, set where exact stops being free
// rather than where snapping stops being visible.
//
// `window.__labelAngleMinCount` overrides live.
export const LABEL_ANGLE_QUANTUM_MIN_COUNT = 80;

// Routing styles whose labels snap at EVERY count, with no gate.
//
// Lombardi only. It is the style that actually generates rotation diversity, and
// it generates it two different ways: a curved label rotates every character
// separately, and one whose bow the zoom has flattened under
// LABEL_CURVE_MIN_SCREEN_PX falls back to a straight chord at whatever arbitrary
// angle that chord sits at. On a zoomed-out lombardi graph almost every label is
// in that second category at once.
//
// Ungating it costs nothing visually, which is the part worth seeing: the two
// populations are disjoint by zoom. While a label is CURVED it is placed glyph
// by glyph and buckets on CURVED_GLYPH_ANGLE_QUANTUM, which this number does not
// touch at all — so zoomed in, where a tilt would show, this changes nothing. It
// only reaches labels that have already flattened to chords, which happens
// zoomed out, where 2.25° of tilt on small text is invisible. Lombardi therefore
// snaps exactly when it is needed and never when it would be seen.
//
// Manhattan is absent because it does not need to be here: its labels sit at 0°
// and 90°, the quantum divides 90, and snapping is a no-op on both.
export const LABEL_ANGLE_QUANTUM_ALWAYS_STYLES = new Set(['lombardi']);

// ---------------------------------------------------------------------------
// ZOOM SCALE QUANTUM — tried, measured, removed. Don't re-add it without
// re-measuring on the real canvas.
//
// The reasoning was that a glyph raster is keyed on its device-space matrix,
// scale included, so sweeping the scale hands every glyph a new key each frame
// and the angle buckets stop helping. In an isolated harness that reproduced
// hard — 200 labels cost 8.4ms panning and 41.7ms zooming, and snapping the
// applied scale to 6% steps recovered all of it.
//
// It does not reproduce in the app. Sweeping the scale on the real content
// group, 260 labels and 3300 SVG elements, costs 8.4ms/frame — the same as
// panning it and the same as leaving it alone. The harness packed every label
// into one screen; a real graph does not, and the labels that would thrash the
// atlas are off-viewport and never painted.
//
// So the snap bought nothing here and cost something visible: zoom advancing in
// 6% jumps, which reads as exactly the choppiness it was meant to cure. What
// actually made zooming stutter was the edge-glow overlay repainting a blurred
// box-shadow per off-screen node per frame — see getFlareCss in
// EdgeGlowIndicator, where that appearance is now the 'fancy' branch of the
// edgeGlowMode setting rather than what everyone gets at every size.
// ---------------------------------------------------------------------------

// A hard ceiling on how many labels may curve at once.
//
// What it bounds has changed. It used to cap <textPath> instances, whose cost
// climbs with count (40→8.4ms, 200→83ms) — that cliff is gone, and this is no
// longer what stands between the canvas and a stall. What it bounds now is
// distinct glyph matrices: a curved label rotates every character separately,
// so N curved labels cost roughly N×(characters) atlas keys where N straight
// ones cost N. That is a gentler curve, and 40 is now a conservative number on
// it rather than a cliff-edge one.
//
// Raised from 40. At 40 it was the thing deciding that NOTHING curves on any
// real graph: with culling off it was fed the WHOLE graph's edge count, so a
// 41-edge Lombardi graph rendered every label as a straight chord — and a
// straight chord additionally angle-snapped by the canvas-wide quantum, which is
// the "quantized and never bent" look. (Culling is back on, so this and the
// other count budgets are once again counting what is on screen — see
// ENABLE_CULLING.)
//
// The cost model that justified 40 is gone. Curved glyphs snap into
// CURVED_GLYPH_ANGLE_QUANTUM buckets, so the atlas keys they can mint are
// bounded by (distinct characters × buckets) REGARDLESS of how many labels
// curve — N labels re-use the same keys, they don't multiply them. What scales
// with N is the closed-form per-glyph placement, and that is arithmetic, not
// rasterisation. This bound is kept only as a backstop against pathological
// counts; it should not be the reason an ordinary graph's labels stop bending.
export const CURVED_LABEL_BUDGET = 250;

// Shared empty obstacle list, so the memo below can skip the work without
// handing out a fresh array identity on every pan tick.
export const EMPTY_OBSTACLES = Object.freeze([]);

// Above this many visible connections, labels stop trying to dodge the ones
// they land under. The dodge needs every connection's routed geometry plus a
// spatial index over it, and at this density there is no uncrossed spot left to
// move to — so it would be paid for in full and return nothing.
export const LABEL_CROSSING_BUDGET = 220;
