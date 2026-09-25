/**
 * Semantic orbit constants (moved from NodeCanvas's module scope).
 */

// Single identity for "no orbit data", so resetting an already-empty orbit
// bails out of the render instead of handing OrbitOverlay fresh arrays.
export const EMPTY_ORBIT = Object.freeze({ ring1: [], ring2: [], ring3: [], ring4: [], all: [] });

// The scrim drawn behind the orbit overlay. Lives on an HTML layer above the
// <svg>, never as a rect inside it — see the orbit scrim in the render tree.
export const ORBIT_SCRIM_COLOR = 'rgba(0, 0, 0, 0.8)';
// Backdrop blur behind the scrim, in px. 0 disables it.
//
// OFF, because it brought the tile-memory flicker back — and specifically when
// zoomed deep into a crowded orbit, which is the signature of the thing it does
// wrong. The reasoning for turning it on was that a compositor effect on an HTML
// layer samples the already-composited texture beneath, so its cost is bounded
// by the viewport. That is true of the BLUR. It is not true of the render
// surface the blur forces: asking for the backdrop makes the compositor
// materialise the layer beneath as a surface rather than drawing it straight
// through, and the layer beneath is the 100k x 100k canvas, whose transformed
// bounds grow with zoom. At normal zoom the clip keeps that near viewport size;
// zoomed deep it does not, and the budget goes.
//
// Kept behind the dial rather than deleted, since the look was worth wanting:
// `window.__orbitBlur = 3` (or 6, 12) in the console turns it on, taking effect
// on the next render, so it A/Bs live against `window.__diag.record(3000)`.
// Anything reinstating it by default needs that measurement at deep zoom on a
// full orbit, not just at rest.
export const ORBIT_SCRIM_BLUR_PX = 0;

// Breathing room around the orbit when the canvas frames it, as a fraction of
// the usable region on each side.
export const ORBIT_FIT_PADDING = 0.06;
// How far out the framing is allowed to go.
//
// The framing itself fits the orbit's extent — that is what gets the whole
// thing, vertical axis included, into the usable region. Left unbounded it went
// out near 0.15, which is further than anything is readable at, and since
// candidates keep arriving it kept pulling further as the rings grew.
//
// This floor stops it short: a small orbit is still framed exactly, a big one
// stops here and its outer rings run off screen, to be reached by panning like
// anywhere else on the canvas. It doubles as the settling rule — once the fit
// is pinned at the floor, more arrivals ask for the same zoom, so the camera
// stops moving on its own rather than needing a separate rule to stop it.
// `window.__orbitZoom = 0.18` overrides it live.
export const ORBIT_FIT_MIN_ZOOM = 0.22;

// (Moved from NodeCanvas, wave 6.)
// ORBIT DIM — the scrim behind the orbit overlay. Set false to drop it
// entirely (the rect stays, transparent and static at full canvas size, so
// orbit's click-anywhere-to-exit keeps working at no paint cost).
//
// This was the cause of the orbit-mode tile-memory flicker, but the culprit
// was its SIZE, not its existence: it used to span 3x the viewport per side,
// i.e. ~9 viewport areas of 70% black painting above the whole graph. A
// translucent rect makes every tile it covers non-opaque, forcing the
// compositor to blend everything beneath rather than discard what is hidden.
// At viewport size plus a small margin the same effect costs a fraction of
// that. See updateOrbitDimRect.
// OFF: shrinking it to viewport-size was not enough. A translucent element
// INSIDE the content group makes the SVG's own tiles non-opaque at any size,
// so the whole graph beneath has to be blended rather than discarded. The
// scrim has to leave the SVG raster entirely to be affordable — see the note
// on updateOrbitDimRect.
export const ENABLE_ORBIT_DIM = false;
// Extra coverage on each side as a fraction of the viewport. Only has to
// survive between transform ticks, and the rect is repositioned on every one.
export const ORBIT_DIM_MARGIN = 0.1;
