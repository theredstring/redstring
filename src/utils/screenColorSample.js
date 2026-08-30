/**
 * Read the colour Redstring is painting at a point on screen.
 *
 * A web page is not allowed to look at the screen. The one API that lets it —
 * `window.EyeDropper` — is Chromium-desktop only: not Safari, not Firefox, and
 * not the WKWebView the iOS app runs in. So rather than a picker that behaves
 * differently on every platform, this asks the document what it is painting.
 *
 * Two consequences worth knowing. It reads declared paint, so what comes back is
 * the colour a Thing IS rather than the colour it happens to look like through a
 * selection glow or a half-faded layer — picking a connection off its
 * 0.2-opacity hover glow gives you the connection's colour, which is what was
 * meant. And it can only see what the document says; a cross-origin image is a
 * closed box (see samplePixel).
 *
 * The hard part is that the browser's own hit test is not enough. Redstring
 * marks most of what you can see as pointer-events: none — node labels,
 * thumbnails, inner-network previews, the node-group box, every clipped group —
 * so elementsFromPoint walks straight past them and reports a container. What
 * makes this work is descending into the hit element's subtree by geometry
 * instead (see topmostPaintAt), which pointer-events cannot hide anything from.
 */

// SVG shapes that carry paint. A <g> is excluded on purpose: `fill` computes to
// black on any element that doesn't set it, so trusting computed style on a
// container hands back black for everything.
const PAINTED_SVG_TAGS = new Set([
  'rect', 'circle', 'ellipse', 'path', 'line', 'polygon', 'polyline', 'text', 'tspan'
]);

// Sources a single pixel can be read out of.
const RASTER_TAGS = new Set(['image', 'img', 'canvas', 'video']);

// Safety valve. The geometric descent prunes hard, so a real pointer move visits
// a few dozen elements; this only exists so a pathological tree can't stall a
// pointermove.
const MAX_VISITS = 4000;

// How far off a shape the pointer may be and still count as on it, in screen px,
// and the directions tried. Sized against the gap between a connection's visible
// stroke and its transparent hit path — see svgHitKind.
const TOLERANCE_PX = 8;
const TOLERANCE_RING = [
  [TOLERANCE_PX, 0], [-TOLERANCE_PX, 0], [0, TOLERANCE_PX], [0, -TOLERANCE_PX],
  [TOLERANCE_PX, TOLERANCE_PX], [-TOLERANCE_PX, TOLERANCE_PX],
  [TOLERANCE_PX, -TOLERANCE_PX], [-TOLERANCE_PX, -TOLERANCE_PX],
];

/** Parse a CSS colour string to #rrggbb, or null if it isn't a usable paint. */
function paintToHex(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v || v === 'none' || v === 'transparent' || v === 'currentColor') return null;
  // url(#gradient) and friends — a paint server has no single colour.
  if (v.startsWith('url(')) return null;

  const rgb = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map(n => parseFloat(n));
    const a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    if (![r, g, b].every(Number.isFinite) || a === 0) return null;
    const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return null;
}

/**
 * First colour out of a CSS gradient. Not the colour at that exact spot — that
 * would mean re-implementing gradient interpolation — but a gradient chip is
 * still better answered by its first stop than by nothing at all.
 */
function gradientToHex(backgroundImage) {
  if (!backgroundImage || !backgroundImage.includes('gradient')) return null;
  const stop = backgroundImage.match(/rgba?\([^)]+\)|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i);
  return stop ? paintToHex(stop[0]) : null;
}

let pixelCanvas = null;

/**
 * One pixel out of a raster source — a node thumbnail, a <canvas>, a video
 * frame. Best effort: a cross-origin image taints the canvas and the read
 * throws, which is a null here.
 */
function samplePixel(el, clientX, clientY) {
  try {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const natW = el.naturalWidth || el.videoWidth || el.width?.baseVal?.value || el.width || rect.width;
    const natH = el.naturalHeight || el.videoHeight || el.height?.baseVal?.value || el.height || rect.height;
    if (!natW || !natH) return null;

    // objectFit / preserveAspectRatio are not modelled — for the flat,
    // box-filling thumbnails Redstring draws, the linear map is the right one.
    const sx = Math.floor(((clientX - rect.left) / rect.width) * natW);
    const sy = Math.floor(((clientY - rect.top) / rect.height) * natH);

    if (!pixelCanvas) pixelCanvas = document.createElement('canvas');
    pixelCanvas.width = 1;
    pixelCanvas.height = 1;
    const ctx = pixelCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(el, sx, sy, 1, 1, 0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null;
    const hex = (n) => n.toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null; // tainted canvas, undecoded image, unsupported source
  }
}

/** Cheap reject: is the point outside this element's box, allowing `pad` slack? */
function outsideBox(rect, x, y, pad = 0) {
  return rect.width <= 0 || rect.height <= 0
    || x < rect.left - pad || x > rect.right + pad
    || y < rect.top - pad || y > rect.bottom + pad;
}

/**
 * Where in an SVG shape the point falls: its fill, its stroke, or neither.
 *
 * isPointInFill / isPointInStroke answer exactly and — unlike the browser's hit
 * test — do not care about pointer-events. Two things follow. A connection is
 * pickable along the line rather than anywhere in its bounding box, which for a
 * diagonal edge is mostly empty space. And a group's title tag, which is a
 * canvas-coloured rect ringed in the GROUP's colour, gives you the group colour
 * when you're on the ring and the canvas colour when you're inside it — which is
 * what each of those places actually paints.
 */
function svgHitKind(el, x, y) {
  if (typeof el.isPointInFill !== 'function' || typeof el.getScreenCTM !== 'function') {
    return 'unknown';
  }
  try {
    const ctm = el.getScreenCTM();
    if (!ctm) return 'unknown';
    // The inverse transform is applied by hand and the result handed over as a
    // plain DOMPointInit, which is all isPointInFill asks for. Going through
    // `new DOMPoint(...).matrixTransform(...)` would drag in two more APIs for
    // no gain, and both are missing in enough environments to matter.
    const inv = ctm.inverse();
    const toLocal = (sx, sy) => ({
      x: inv.a * sx + inv.c * sy + inv.e,
      y: inv.b * sx + inv.d * sy + inv.f,
    });

    const exact = toLocal(x, y);
    if (el.isPointInStroke(exact)) return 'stroke';
    if (el.isPointInFill(exact)) return 'fill';

    // Nothing exactly under the pointer — try again a few pixels out.
    //
    // This is what makes connections pickable. A connection draws a 27-wide
    // stroke and then lays a TRANSPARENT hit path of at least 50 over it
    // (data-edge-hit in NodeCanvas), so the browser reports you as "on the
    // connection" across a 25px half-width while the visible stroke only
    // accepts 13.5. In the ~11px band between the two, the exact test failed
    // and sampling fell through to the canvas background — the connection was
    // reported as the colour of the space behind it. The ring closes most of
    // that gap, and being a fallback it cannot change any answer that the exact
    // test already had.
    for (const [dx, dy] of TOLERANCE_RING) {
      const p = toLocal(x + dx, y + dy);
      if (el.isPointInStroke(p)) return 'stroke';
      if (el.isPointInFill(p)) return 'fill';
    }
    return 'none';
  } catch {
    return 'unknown';
  }
}

/**
 * The colour this element paints at the point, or null.
 * Assumes the point is already known to be inside the element's box.
 */
function paintAt(el, x, y) {
  const tag = el.tagName?.toLowerCase();
  if (tag === 'html' || tag === 'body') return null; // page ground, not content

  const cs = window.getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) {
    return null;
  }

  if (RASTER_TAGS.has(tag)) return samplePixel(el, x, y);

  if (el.ownerSVGElement) {
    if (!PAINTED_SVG_TAGS.has(tag)) return null;
    const kind = svgHitKind(el, x, y);
    if (kind === 'none') return null;

    // `fill` computes to black on anything that never set it, so a black fill is
    // only believed when the element actually asked for it. Without this a
    // <line> — all stroke, no fill — reports black, which is the failure mode
    // this whole module exists to avoid. A non-black computed fill was set
    // somewhere by definition, so it needs no such proof.
    const rawFill = paintToHex(cs.fill);
    const declaresFill = el.hasAttribute('fill') || !!el.style?.fill;
    const fillHex = (rawFill && (declaresFill || rawFill !== '#000000')) ? rawFill : null;
    const strokeHex = paintToHex(cs.stroke);

    // On the stroke, the stroke is the answer; anywhere else the fill is, and a
    // shape that is all stroke and no fill answers with its stroke either way.
    return kind === 'stroke' ? (strokeHex || fillHex) : (fillHex || strokeHex);
  }

  return paintToHex(cs.backgroundColor) || gradientToHex(cs.backgroundImage);
}

/**
 * Topmost painted element at the point within `root`'s subtree.
 *
 * Paint order is document order — a parent's background first, then each child
 * in turn — so walking children in REVERSE and taking the first hit finds what
 * is on top. Subtrees whose box misses the point are pruned, which is what keeps
 * this cheap enough to run on every pointer move over a full canvas.
 */
function topmostPaintAt(root, x, y, ignored, budget) {
  if (budget.n++ > MAX_VISITS) return null;
  if (!(root instanceof Element) || ignored(root)) return null;

  const rect = root.getBoundingClientRect?.();
  // A zero-size box is not evidence of absence (an SVG <g> of nothing, a
  // wrapper whose children are absolutely positioned), so only prune on a real
  // box that misses. Pruning allows the same slack svgHitKind does, or a thin
  // shape the pointer is beside would be discarded before its geometry ever got
  // a say — which is precisely the connection case.
  if (rect && (rect.width > 0 || rect.height > 0) && outsideBox(rect, x, y, TOLERANCE_PX)) {
    return null;
  }

  const kids = root.children;
  for (let i = kids.length - 1; i >= 0; i -= 1) {
    const hex = topmostPaintAt(kids[i], x, y, ignored, budget);
    if (hex) return hex;
  }

  // The slack above is for descending, not for painting. SVG shapes settle it
  // exactly in svgHitKind; an HTML box has no such test, so it has to actually
  // contain the point — otherwise a panel would colour the air beside it.
  if (rect && !root.ownerSVGElement && outsideBox(rect, x, y)) return null;
  return paintAt(root, x, y);
}

/**
 * Topmost sampleable colour at a viewport point.
 *
 * Starts from the browser's hit stack — correct paint order, cheap, and it
 * handles ordinary HTML — then descends into each hit element geometrically to
 * reach everything pointer-events hid.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {Element[]} [ignoreRoots] subtrees to look straight through — the
 *        picking overlay and the picker panel itself, which are in the way by
 *        construction and are never what you meant to sample.
 * @returns {string|null} #rrggbb
 */
export function sampleColorAt(clientX, clientY, ignoreRoots = []) {
  if (typeof document === 'undefined') return null;
  const roots = ignoreRoots.filter(Boolean);
  const ignored = (el) => roots.some(root => root.contains(el));
  const budget = { n: 0 };

  const stack = document.elementsFromPoint?.(clientX, clientY) || [];
  for (const hit of stack) {
    if (ignored(hit)) continue;
    const hex = topmostPaintAt(hit, clientX, clientY, ignored, budget);
    if (hex) return hex;
  }
  return null;
}
