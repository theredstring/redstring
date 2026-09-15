/**
 * Read the colour Redstring is painting at a point on screen.
 *
 * A web page is not allowed to look at the screen. The one API that lets it —
 * `window.EyeDropper` — is Chromium-desktop only: not Safari, not Firefox, and
 * not the WKWebView the iOS app runs in. It is also modal, taking the pointer
 * away for as long as it is up, which would cost the eyedropper both its own
 * cursor and any chance of being driven by a controller. So rather than a
 * picker that behaves differently on every platform, this asks the document
 * what it is painting and works out the answer itself.
 *
 * WHAT "THE COLOUR AT A POINT" MEANS HERE. Not the topmost declared paint — the
 * COMPOSITE. Every layer that covers the point is collected top-down with the
 * alpha it actually lands with, and they are blended back-to-front the way the
 * compositor blends them. That distinction is the whole difference between a
 * reading and a guess, and it is not academic: the unified selector lays an
 * `rgba(0,0,0,0.3)` scrim over the entire canvas, so a sampler that took the
 * top layer's rgb and dropped its alpha answered `#000000` for every Thing on
 * screen — and the selector's palette button is the most common way into the
 * picker there is.
 *
 * Alpha is only one of the ways declared paint differs from painted pixels.
 * Also handled, for the same reason:
 *   - gradients are EVALUATED at the point, in both CSS and SVG, rather than
 *     answered with their first stop — a scroll fade is a different colour at
 *     each end, and the whole content of a fade is which end you are at;
 *   - a translucent stroke composites over its own shape's fill, because that
 *     is what you are looking at when you point at the edge of a filled shape;
 *   - element and group `opacity` accumulate down the tree, so a faded layer
 *     contributes what it contributes and not what it would contribute at
 *     full strength;
 *   - `mix-blend-mode: multiply` multiplies;
 *   - TEXT has a colour, and it is the text's, not its background's. Most of
 *     the text here is HTML in a foreignObject — a Thing's name is a <div> —
 *     and an HTML box's paint used to mean its background alone, so a name
 *     sampled as the rect behind the letters;
 *   - IMAGES are read as pixels, which took two fixes. A node thumbnail is a
 *     remote URL and tainted the canvas it had to be drawn into, so every one
 *     of them was unreadable; and a connection LABEL is an image — a sprite
 *     baked on an offscreen canvas and drawn rotated along the edge (see
 *     labelSpriteCache) — so reading a label at all means reading the right
 *     pixel of that sprite, through its rotation and its fit. See samplePixel.
 *
 * The one layer deliberately NOT composited is a scrim (see isScrim), because a
 * scrim is not something you can see so much as something you are seeing
 * through, and it is usually on screen because the picker itself is. Reading a
 * Thing's colour through 30% black would be faithful to the screen and wrong
 * for the job.
 *
 * WHAT IT STILL CANNOT SEE, stated plainly because a picker that quietly
 * approximates is worse than one whose limits are known:
 *   - `filter` and `backdrop-filter`. A blur mixes neighbouring pixels, which
 *     is a rasteriser's job and not a reader's; the answer here is the
 *     unblurred colour underneath;
 *   - blend modes other than multiply;
 *   - GLYPH COVERAGE. Text is answered per LINE, not per letter: the document
 *     can be asked where a line of text is, and cannot be asked whether a point
 *     is on the stem of an `l`. Inside a line of text you get the text's colour
 *     rather than the background showing between the letters. For choosing a
 *     colour that is the better answer — having to land on a stem would make
 *     the mode unusable — but it is not the pixel;
 *   - `clip-path`. A clipped-away corner of a thumbnail still reads as the
 *     thumbnail rather than as what shows through it;
 *   - the exact paint order of two elements that do not hit-test, where one
 *     paints over the other from a different branch of the tree (see the note
 *     in sampleColorAt).
 *
 * The other hard part is that the browser's own hit test is not enough.
 * Redstring marks most of what you can see as pointer-events: none — node
 * labels, thumbnails, inner-network previews, the node-group box, every clipped
 * group — so elementsFromPoint walks straight past them and reports a
 * container. What makes this work is descending into the hit element's subtree
 * by geometry instead (see collect), which pointer-events cannot hide anything
 * from.
 */

// SVG shapes that carry paint. A <g> is excluded on purpose: `fill` computes to
// black on any element that doesn't set it, so trusting computed style on a
// container hands back black for everything.
const PAINTED_SVG_TAGS = new Set([
  'rect', 'circle', 'ellipse', 'path', 'line', 'polygon', 'polyline', 'text', 'tspan'
]);

// Sources a single pixel can be read out of.
const RASTER_TAGS = new Set(['image', 'img', 'canvas', 'video']);

// Subtrees that define things rather than draw them. Pruned rather than walked:
// their boxes are zero-size, so nothing else would prune them, and a <defs>
// holding the very gradient we are about to evaluate is not a layer over the
// point.
const NON_RENDERED_TAGS = new Set([
  'defs', 'clippath', 'mask', 'filter', 'marker', 'symbol', 'pattern',
  'lineargradient', 'radialgradient', 'title', 'desc', 'metadata',
  'script', 'style', 'head'
]);

// Safety valve. The geometric descent prunes hard, so a real pointer move visits
// a few dozen elements; this only exists so a pathological tree can't stall a
// pointermove.
const MAX_VISITS = 4000;

// Nothing behind a layer this opaque can change the answer by as much as one
// step of an 8-bit channel, so collection stops there.
const OPAQUE_ENOUGH = 0.999;

// And a hard stop on depth of stack, for the same reason MAX_VISITS exists.
const MAX_LAYERS = 64;

// How far off a shape the pointer may be and still count as on it, in screen px,
// and the directions tried. Sized against the gap between a connection's visible
// stroke and its transparent hit path — see svgHitKind.
const TOLERANCE_PX = 8;
const TOLERANCE_RING = [
  [TOLERANCE_PX, 0], [-TOLERANCE_PX, 0], [0, TOLERANCE_PX], [0, -TOLERANCE_PX],
  [TOLERANCE_PX, TOLERANCE_PX], [-TOLERANCE_PX, TOLERANCE_PX],
  [TOLERANCE_PX, -TOLERANCE_PX], [-TOLERANCE_PX, -TOLERANCE_PX],
];

// ---------------------------------------------------------------------------
// Colour values
//
// Everything below works in straight (un-premultiplied) RGBA, 0-255 per channel
// and 0-1 alpha, and only turns back into a hex string at the very end. Parsing
// to hex on the way in — which is what this module used to do — is what threw
// the alpha away.
// ---------------------------------------------------------------------------

/** Parse a CSS colour string to {r, g, b, a}, or null if it isn't a paint. */
function parseColor(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v || v === 'none' || v === 'currentColor') return null;
  // A paint server is resolved elsewhere (see svgPaintAt); it is not a colour.
  if (v.startsWith('url(')) return null;
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  // Computed style always hands back one of these two, in either the legacy
  // comma form or the space-and-slash one.
  const rgb = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map(n => parseFloat(n));
    if (![r, g, b].every(Number.isFinite)) return null;
    // A percentage alpha is legal and parseFloat leaves the % behind.
    const rawA = parts.length > 3 ? parts[3] : '1';
    const a = rawA.endsWith('%') ? parseFloat(rawA) / 100 : parseFloat(rawA);
    return { r, g, b, a: Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1 };
  }

  // Hex only turns up on values read straight off an attribute, which the
  // gradient stops below do.
  const hex = v.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4 || hex.length === 6 || hex.length === 8)) {
    const wide = hex.length > 4;
    const pair = (i) => (wide
      ? parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      : parseInt(hex[i] + hex[i], 16));
    const alpha = (hex.length === 4 || hex.length === 8) ? pair(3) / 255 : 1;
    return { r: pair(0), g: pair(1), b: pair(2), a: alpha };
  }
  return null;
}

const toHex = ({ r, g, b }) => {
  const channel = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
};

/**
 * Blend two colours a fraction of the way along, in PREMULTIPLIED space.
 *
 * Which is the difference between a fade to `transparent` keeping its hue and
 * going grey through the middle. `transparent` is rgba(0,0,0,0), so blending it
 * straight drags every channel toward black on the way out; premultiplied, its
 * zero alpha means it contributes nothing but its own disappearance. CSS
 * specifies the premultiplied one, and it is also simply the one that looks
 * like what it says.
 */
function mixColors(from, to, t) {
  const fa = from.a;
  const ta = to.a;
  const a = fa + (ta - fa) * t;
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (f, s) => ((f * fa) + ((s * ta) - (f * fa)) * t) / a;
  return { r: channel(from.r, to.r), g: channel(from.g, to.g), b: channel(from.b, to.b), a };
}

/**
 * Split on top-level separators only, so the commas inside `rgba(...)` do not
 * tear a colour in half. Needed twice over: background-image can hold several
 * layers, and each gradient holds several stops.
 */
function splitTop(value, separator = ',') {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === separator && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

/**
 * Colour stops, as written, resolved onto the 0-1 line.
 *
 * The defaulting rules are the ones CSS and SVG share: the first is 0 and the
 * last is 1 unless they say otherwise, a run of unpositioned stops spreads
 * evenly between its positioned neighbours, and positions never go backwards.
 *
 * @param {{color: object, pos: number|null}[]} stops
 */
function resolveStopPositions(stops) {
  if (!stops.length) return stops;
  if (stops[0].pos == null) stops[0].pos = 0;
  if (stops[stops.length - 1].pos == null) stops[stops.length - 1].pos = 1;
  let lastKnown = 0;
  for (let i = 1; i < stops.length; i += 1) {
    if (stops[i].pos == null) {
      // Find the next one that does say, and spread the gap.
      let next = i;
      while (next < stops.length && stops[next].pos == null) next += 1;
      const span = stops[next].pos - stops[lastKnown].pos;
      const steps = next - lastKnown;
      for (let j = i; j < next; j += 1) {
        stops[j].pos = stops[lastKnown].pos + (span * (j - lastKnown)) / steps;
      }
      i = next;
    }
    lastKnown = i;
  }
  // A stop that sits behind the one before it is clamped forward, which is what
  // makes a hard edge (`... 50%, ... 50%`) legal and sharp.
  for (let i = 1; i < stops.length; i += 1) {
    if (stops[i].pos < stops[i - 1].pos) stops[i].pos = stops[i - 1].pos;
  }
  return stops;
}

/** The colour a resolved stop list shows at `t`. */
function colorAtStop(stops, t) {
  if (!stops.length) return null;
  if (t <= stops[0].pos) return stops[0].color;
  const last = stops[stops.length - 1];
  if (t >= last.pos) return last.color;
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1];
    const b = stops[i];
    if (t <= b.pos) {
      const span = b.pos - a.pos;
      // A zero-width span is a hard edge; the later stop wins, as it is drawn on
      // top of the earlier one.
      return span <= 0 ? b.color : mixColors(a.color, b.color, (t - a.pos) / span);
    }
  }
  return last.color;
}

/** An angle in any of CSS's units, in degrees. */
function parseAngle(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  if (value.endsWith('turn')) return n * 360;
  if (value.endsWith('rad')) return (n * 180) / Math.PI;
  if (value.endsWith('grad')) return n * 0.9;
  return n; // deg, or a bare number
}

/**
 * The angle a `to <side>` keyword means, in CSS's convention: 0deg points UP and
 * degrees run clockwise.
 *
 * The corners are not 45s. `to top right` has to put the corner itself on the
 * far end of the gradient, which means the line is perpendicular to the OTHER
 * diagonal — so the angle depends on the box's proportions.
 */
function sideAngle(keywords, width, height) {
  const has = (k) => keywords.includes(k);
  const corner = (Math.atan2(width, height) * 180) / Math.PI;
  if (has('top') && has('right')) return corner;
  if (has('bottom') && has('right')) return 180 - corner;
  if (has('bottom') && has('left')) return 180 + corner;
  if (has('top') && has('left')) return 360 - corner;
  if (has('top')) return 0;
  if (has('right')) return 90;
  if (has('bottom')) return 180;
  if (has('left')) return 270;
  return null;
}

/**
 * Evaluate one CSS `linear-gradient()` at a point inside an element's box.
 *
 * Radial and conic gradients fall through to null and are then answered by
 * whatever is behind them, which is the honest reading: nothing in Redstring
 * paints one, and a wrong colour would be worse than a colour from underneath.
 *
 * @returns {{r,g,b,a}|null}
 */
function cssGradientAt(image, rect, x, y) {
  const fn = image.match(/^(repeating-)?linear-gradient\((.*)\)$/is);
  if (!fn) return null;
  const repeating = Boolean(fn[1]);
  const args = splitTop(fn[2]);
  if (args.length < 2) return null;

  // The first argument is the direction, if it is not already a colour.
  let angle = 180; // `to bottom`, the CSS default
  let first = 0;
  const head = args[0];
  if (/^to\s/i.test(head)) {
    angle = sideAngle(head.toLowerCase().split(/\s+/).slice(1), rect.width, rect.height) ?? 180;
    first = 1;
  } else if (/^-?[\d.]+(deg|rad|turn|grad)?$/i.test(head)) {
    angle = parseAngle(head) ?? 180;
    first = 1;
  }

  // The gradient line: through the centre of the box, at `angle`, long enough
  // that the two corners it passes sit exactly at its ends.
  const rad = (angle * Math.PI) / 180;
  // Snapped, because `Math.sin(Math.PI)` is 1.2e-16 rather than 0 and almost
  // every gradient in the app is a cardinal one. Left alone, that dirt lands in
  // the line's LENGTH — 100.00000000000001px for a 100px box — and the last
  // ulp of the fraction is enough to send an exact midpoint down a rounding
  // step, which is a visible channel value.
  const snap = (n) => (Math.abs(n) < 1e-12 ? 0 : n);
  const dx = snap(Math.sin(rad));
  const dy = snap(-Math.cos(rad)); // screen y grows downward
  const length = Math.abs(rect.width * dx) + Math.abs(rect.height * dy);
  if (length <= 0) return null;

  const stops = [];
  for (let i = first; i < args.length; i += 1) {
    // `<color> [<position>]`, where the colour may itself hold spaces.
    const parts = splitTop(args[i], ' ');
    if (!parts.length) continue;
    const color = parseColor(parts[0]);
    if (!color) continue;
    let pos = null;
    if (parts.length > 1) {
      const raw = parts[1];
      const n = parseFloat(raw);
      if (Number.isFinite(n)) pos = raw.endsWith('%') ? n / 100 : n / length;
    }
    stops.push({ color, pos });
    // A stop may carry TWO positions, which is shorthand for the same colour
    // repeated at both — the second one starts a new stop.
    if (parts.length > 2) {
      const n = parseFloat(parts[2]);
      if (Number.isFinite(n)) {
        stops.push({ color, pos: parts[2].endsWith('%') ? n / 100 : n / length });
      }
    }
  }
  if (!stops.length) return null;
  resolveStopPositions(stops);

  // Where the point falls along that line, as a fraction of it.
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const startX = cx - (dx * length) / 2;
  const startY = cy - (dy * length) / 2;
  let t = ((x - startX) * dx + (y - startY) * dy) / length;

  if (repeating) {
    const from = stops[0].pos;
    const span = stops[stops.length - 1].pos - from;
    if (span > 0) t = from + (((t - from) % span) + span) % span;
  }
  return colorAtStop(stops, t);
}

/**
 * The point in an SVG element's own user space.
 *
 * The inverse transform is applied by hand and the result handed back as a
 * plain point, which is all both callers need. Going through
 * `new DOMPoint(...).matrixTransform(...)` would drag in two more APIs for no
 * gain, and both are missing in enough environments to matter.
 */
function toLocalPoint(el, x, y) {
  const ctm = el.getScreenCTM?.();
  if (!ctm) return null;
  try {
    const inv = ctm.inverse();
    return { x: inv.a * x + inv.c * y + inv.e, y: inv.b * x + inv.d * y + inv.f };
  } catch {
    return null;
  }
}

/** An SVG gradient's `offset`, `x1`-style length, or similar, as a fraction. */
function svgFraction(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return String(raw).trim().endsWith('%') ? n / 100 : n;
}

/** A gradient element's stops, already resolved onto the 0-1 line. */
function svgStops(grad) {
  const stops = [];
  grad.querySelectorAll('stop').forEach((stop) => {
    // Read through computed style rather than off the attributes: it resolves
    // `stop-color` set in CSS, in a presentation attribute or in a style
    // attribute all the same way, and normalises named colours on the way.
    const cs = window.getComputedStyle(stop);
    const color = parseColor(cs.stopColor || stop.getAttribute('stop-color'));
    if (!color) return;
    const opacity = parseFloat(cs.stopOpacity ?? stop.getAttribute('stop-opacity'));
    stops.push({
      color: { ...color, a: color.a * (Number.isFinite(opacity) ? opacity : 1) },
      pos: svgFraction(stop.getAttribute('offset'), null),
    });
  });
  return resolveStopPositions(stops);
}

/**
 * Evaluate the SVG paint server a `url(#id)` fill or stroke points at.
 *
 * @returns {{r,g,b,a}|null} null for anything but a linear or radial gradient,
 *   which leaves the answer to whatever is painted behind it.
 */
function svgGradientAt(value, el, x, y) {
  const id = value.match(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/)?.[1];
  const grad = id && document.getElementById(id);
  if (!grad) return null;
  const tag = grad.tagName?.toLowerCase();
  if (tag !== 'lineargradient' && tag !== 'radialgradient') return null;

  const stops = svgStops(grad);
  if (!stops.length) return null;

  let point = toLocalPoint(el, x, y);
  if (!point) return null;

  // objectBoundingBox is the default, and in it every coordinate is a fraction
  // of the shape's own box — so the point has to become one too.
  const units = grad.getAttribute('gradientUnits') || 'objectBoundingBox';
  if (units !== 'userSpaceOnUse') {
    const box = el.getBBox?.();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    point = { x: (point.x - box.x) / box.width, y: (point.y - box.y) / box.height };
  }

  // The gradient's own transform, undone: the coordinates below are stated in
  // the space BEFORE it.
  const matrix = grad.gradientTransform?.baseVal?.consolidate?.()?.matrix;
  if (matrix) {
    try {
      const inv = matrix.inverse();
      point = {
        x: inv.a * point.x + inv.c * point.y + inv.e,
        y: inv.b * point.x + inv.d * point.y + inv.f,
      };
    } catch { /* an un-invertible transform collapses the gradient; ignore it */ }
  }

  let t;
  if (tag === 'lineargradient') {
    const x1 = svgFraction(grad.getAttribute('x1'), 0);
    const y1 = svgFraction(grad.getAttribute('y1'), 0);
    const x2 = svgFraction(grad.getAttribute('x2'), 1);
    const y2 = svgFraction(grad.getAttribute('y2'), 0);
    const vx = x2 - x1;
    const vy = y2 - y1;
    const lenSq = vx * vx + vy * vy;
    if (lenSq <= 0) return stops[stops.length - 1].color; // a zero-length line is its last stop
    t = ((point.x - x1) * vx + (point.y - y1) * vy) / lenSq;
  } else {
    const cx = svgFraction(grad.getAttribute('cx'), 0.5);
    const cy = svgFraction(grad.getAttribute('cy'), 0.5);
    const r = svgFraction(grad.getAttribute('r'), 0.5);
    if (r <= 0) return stops[stops.length - 1].color;
    t = Math.hypot(point.x - cx, point.y - cy) / r;
  }

  const spread = grad.getAttribute('spreadMethod');
  if (spread === 'repeat') t = ((t % 1) + 1) % 1;
  else if (spread === 'reflect') {
    const cycle = ((t % 2) + 2) % 2;
    t = cycle > 1 ? 2 - cycle : cycle;
  }
  return colorAtStop(stops, t);
}

// ---------------------------------------------------------------------------
// One element's contribution
// ---------------------------------------------------------------------------

let pixelCanvas = null;

/**
 * Untainted copies of the images on screen, by URL.
 *
 * Two problems, one answer. A node's thumbnail is a direct
 * upload.wikimedia.org URL — the store holds URLs and never image data, which
 * is what keeps saves out of V8's out-of-memory — and an <image> with no
 * `crossorigin` attribute taints any canvas it is drawn into, so reading a
 * pixel back THROWS. Every auto-enriched image was unreadable, and the sample
 * fell through to the node's fill behind it. Separately, an SVG <image> exposes
 * no intrinsic size at all — no naturalWidth — so even an untainted one could
 * not be mapped from its box onto its bitmap.
 *
 * A mirror loaded with CORS answers both: it comes back untainted, and being an
 * HTMLImageElement it knows its own size. Wikimedia serves
 * `Access-Control-Allow-Origin: *`, so the fetch is a cache hit in practice.
 * Nothing on screen is touched by any of this — the canvas keeps rendering the
 * plain <image> it always did, so a host that refuses CORS costs a reading and
 * never a picture.
 */
const mirrors = new Map();
const MAX_MIRRORS = 64;

/** The mirror for a URL, once it is loaded. Null while loading, or if it failed. */
function mirrorFor(href) {
  if (!href) return null;
  const existing = mirrors.get(href);
  if (existing) {
    // `complete` with a zero natural width is a load that FAILED — a host with
    // no CORS headers, most likely. It stays in the map so the failure is
    // remembered rather than retried on every frame of a pointer move.
    return existing.complete && existing.naturalWidth ? existing : null;
  }
  if (mirrors.size >= MAX_MIRRORS) mirrors.clear();
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = href;
  mirrors.set(href, img);
  // Same-origin sources — the label sprites are data: URLs — are ready within a
  // frame or two, and the eyedropper samples on every frame it moves.
  return img.complete && img.naturalWidth ? img : null;
}

/** The URL an image element is showing, whichever way it says it. */
function hrefOf(el, tag) {
  return tag === 'img'
    ? (el.currentSrc || el.src)
    : (el.href?.baseVal ?? el.getAttribute('href') ?? el.getAttribute('xlink:href'));
}

/**
 * Start loading untainted copies of every image on screen, before anyone asks
 * for a pixel out of one.
 *
 * A mirror is fetched asynchronously, so the first sample over an image comes
 * back without it and reads whatever is behind instead. With a pointer that is
 * a frame's worth of wrong colour while you are still moving. With a
 * CONTROLLER, whose sight only moves when the stick does, it is the answer you
 * get for as long as you hold still — you aim at a picture, you are told the
 * colour of the node behind it, and pressing A takes that. Hence priming: the
 * eyedropper calls this when it arms, and by the time a sight settles anywhere
 * the copies are in.
 */
export function primeRasterSources() {
  if (typeof document === 'undefined') return;
  const images = document.querySelectorAll('img, image');
  for (let i = 0; i < images.length && mirrors.size < MAX_MIRRORS; i += 1) {
    const el = images[i];
    // Only what is actually on screen: an off-screen or collapsed image is not
    // something the sight can be pointed at, and fetching it would be work done
    // for nothing.
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    if (rect.right < 0 || rect.left > window.innerWidth) continue;
    mirrorFor(hrefOf(el, el.tagName?.toLowerCase()));
  }
}

/** Where a raster element's bitmap actually lives, and how big it is. */
function rasterSource(el, tag) {
  if (tag === 'canvas') {
    return el.width > 0 && el.height > 0 ? { source: el, width: el.width, height: el.height } : null;
  }
  if (tag === 'video') {
    return el.videoWidth > 0 ? { source: el, width: el.videoWidth, height: el.videoHeight } : null;
  }
  const mirror = mirrorFor(hrefOf(el, tag));
  return mirror ? { source: mirror, width: mirror.naturalWidth, height: mirror.naturalHeight } : null;
}

/** `preserveAspectRatio` / `object-fit`, reduced to the numbers that matter. */
function fitOf(el, cs, isSvg) {
  if (isSvg) {
    const par = (el.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim();
    const [align, meetOrSlice] = par.split(/\s+/);
    if (align === 'none') return { stretch: true, alignX: 0, alignY: 0, slice: false };
    const frac = (token) => (token === 'Min' ? 0 : token === 'Max' ? 1 : 0.5);
    return {
      stretch: false,
      alignX: frac(align.slice(1, 4)),
      alignY: frac(align.slice(5, 8)),
      slice: meetOrSlice === 'slice',
    };
  }
  // `fill` stretches and is the HTML default; the rest are the SVG cases under
  // other names. object-position is not read — nothing in the app moves it.
  const objectFit = cs.objectFit || 'fill';
  if (objectFit === 'fill') return { stretch: true, alignX: 0, alignY: 0, slice: false };
  return { stretch: false, alignX: 0.5, alignY: 0.5, slice: objectFit === 'cover' };
}

/**
 * Map a point in an element's box onto the bitmap drawn in it, honouring how
 * that bitmap was fitted.
 *
 * Not a formality: node thumbnails are drawn `preserveAspectRatio="xMidYMid
 * slice"`, which is object-fit: cover — the bitmap is scaled up until it fills
 * the box and the overflow is cropped off both ends. A straight box-to-bitmap
 * map reads a pixel the crop threw away, which for a portrait photo in a
 * landscape slot is most of the picture.
 *
 * Exported for its own tests: it is pure geometry, it is where a wrong pixel
 * would hide silently, and reaching it through a real <image> would mean faking
 * an image decoder and a 2D context to get at four lines of arithmetic.
 *
 * @returns {{x, y}|null} null where the point lands outside the drawn bitmap,
 *   which is a place the element paints nothing.
 */
export function bitmapPoint(u, v, boxW, boxH, natW, natH, fit) {
  if (boxW <= 0 || boxH <= 0 || natW <= 0 || natH <= 0) return null;

  const uniform = fit.slice
    ? Math.max(boxW / natW, boxH / natH)
    : Math.min(boxW / natW, boxH / natH);
  const scaleX = fit.stretch ? boxW / natW : uniform;
  const scaleY = fit.stretch ? boxH / natH : uniform;

  const x = (u - (boxW - natW * scaleX) * fit.alignX) / scaleX;
  const y = (v - (boxH - natH * scaleY) * fit.alignY) / scaleY;
  if (x < 0 || y < 0 || x >= natW || y >= natH) return null;
  return { x, y };
}

/**
 * One pixel out of a raster source — a node thumbnail, a connection label's
 * baked sprite, a <canvas>, a video frame.
 *
 * The label sprites are why this has to be exact rather than close. A
 * connection label is not text on the canvas: it is rendered to an offscreen
 * canvas once, ring and halo and fill baked in, then drawn as an <image>
 * rotated along its edge (see services/labelSpriteCache). So the only way to
 * read a label's colour is to read the sprite's pixels, at the right pixel,
 * through the rotation — which is what the local-space mapping below is for.
 */
function samplePixel(el, cs, clientX, clientY) {
  const tag = el.tagName?.toLowerCase();
  try {
    const raster = rasterSource(el, tag);
    if (!raster) return null;

    const isSvg = Boolean(el.ownerSVGElement);
    let u;
    let v;
    let boxW;
    let boxH;
    if (isSvg) {
      // Through the element's own CTM, so a label rotated along its connection
      // is read where it actually is rather than somewhere in the axis-aligned
      // box drawn around it.
      const local = toLocalPoint(el, clientX, clientY);
      if (!local) return null;
      boxW = el.width?.baseVal?.value ?? 0;
      boxH = el.height?.baseVal?.value ?? 0;
      u = local.x - (el.x?.baseVal?.value ?? 0);
      v = local.y - (el.y?.baseVal?.value ?? 0);
    } else {
      const rect = el.getBoundingClientRect();
      boxW = rect.width;
      boxH = rect.height;
      u = clientX - rect.left;
      v = clientY - rect.top;
    }

    const point = bitmapPoint(u, v, boxW, boxH, raster.width, raster.height, fitOf(el, cs, isSvg));
    if (!point) return null;

    if (!pixelCanvas) pixelCanvas = document.createElement('canvas');
    pixelCanvas.width = 1;
    pixelCanvas.height = 1;
    const ctx = pixelCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(raster.source, Math.floor(point.x), Math.floor(point.y), 1, 1, 0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    // The alpha is kept rather than used as a yes/no: a sprite is mostly
    // transparent padding around its glyphs, and a thumbnail with a soft edge
    // composites over the node behind it. Both are what you can see.
    return { r, g, b, a: a / 255 };
  } catch {
    return null; // undecoded image, unsupported source, revoked blob
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
  const exact = toLocalPoint(el, x, y);
  if (!exact) return 'unknown';
  try {
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
      const p = toLocalPoint(el, x + dx, y + dy);
      if (!p) break;
      if (el.isPointInStroke(p)) return 'stroke';
      if (el.isPointInFill(p)) return 'fill';
    }
    return 'none';
  } catch {
    return 'unknown';
  }
}

/**
 * The colour of this element's own text, if the point is on a line of it.
 *
 * A text node has no box of its own to measure, so the boxes come from a Range
 * over it — one rect per line, which is what a wrapped Thing name produces.
 * Only the element's DIRECT text is considered; a child element's text belongs
 * to the child, and the walk reaches it there.
 *
 * LINE boxes, not glyph coverage. There is no API that answers "is this point
 * on a letter" — glyph coverage lives inside the rasteriser — so the point
 * being on the line of text is the closest thing to it the document can be
 * asked. For choosing a colour that is the better answer anyway: pointing at a
 * label and being told the label's colour is the whole intent, and having to
 * land on the stem of a letter to get it would make the mode unusable.
 */
function textColorAt(el, cs, x, y) {
  let range = null;
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const node = el.childNodes[i];
    if (node.nodeType !== 3 || !node.nodeValue?.trim()) continue;
    if (!range) range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects?.() || [];
    for (let r = 0; r < rects.length; r += 1) {
      if (!outsideBox(rects[r], x, y)) return parseColor(cs.color);
    }
  }
  return null;
}

/** One SVG paint — a colour, or the gradient a `url(#id)` resolves to. */
function svgPaintAt(el, value, opacityValue, x, y) {
  if (!value) return null;
  const color = String(value).trim().startsWith('url(')
    ? svgGradientAt(value, el, x, y)
    : parseColor(value);
  if (!color) return null;
  const opacity = parseFloat(opacityValue);
  return { ...color, a: color.a * (Number.isFinite(opacity) ? opacity : 1) };
}

/**
 * Every layer one element puts at the point, front to back.
 *
 * Front to back within a single element is not a formality. An element's own
 * background sits BEHIND its background images, and an SVG shape's stroke sits
 * over its fill — so a translucent stroke on a filled shape shows that fill
 * through itself, and a scroll fade shows the panel underneath it.
 */
function layersFor(el, cs, rect, x, y, alpha) {
  const tag = el.tagName?.toLowerCase();
  const blend = cs.mixBlendMode === 'multiply' ? 'multiply' : 'normal';
  const out = [];
  const add = (color) => {
    if (color && color.a > 0) out.push({ ...color, a: color.a * alpha, blend });
  };

  if (RASTER_TAGS.has(tag)) {
    add(samplePixel(el, cs, x, y));
    return out;
  }

  if (el.ownerSVGElement) {
    if (!PAINTED_SVG_TAGS.has(tag)) return out;
    const kind = svgHitKind(el, x, y);
    if (kind === 'none') return out;

    // `fill` computes to black on anything that never set it, so a black fill is
    // only believed when the element actually asked for it. Without this a
    // <line> — all stroke, no fill — reports black, which is the failure mode
    // this whole module exists to avoid. A non-black computed fill was set
    // somewhere by definition, so it needs no such proof.
    const rawFill = svgPaintAt(el, cs.fill, cs.fillOpacity, x, y);
    const declaresFill = el.hasAttribute('fill') || !!el.style?.fill;
    const isPlainBlack = rawFill && rawFill.r === 0 && rawFill.g === 0 && rawFill.b === 0;
    const fill = (rawFill && (declaresFill || !isPlainBlack)) ? rawFill : null;
    const stroke = svgPaintAt(el, cs.stroke, cs.strokeOpacity, x, y);

    if (kind === 'stroke') {
      // On the stroke, with the shape's own fill behind it.
      add(stroke);
      add(fill);
    } else {
      // Inside the shape, where the stroke is not. A shape that is all stroke
      // and no fill still answers with its stroke.
      add(fill || stroke);
    }
    return out;
  }

  // An HTML box: its background images, topmost first, then its colour.
  //
  // Unless it is a scrim, in which case it contributes nothing. A scrim is
  // chrome — it is on screen BECAUSE something is open, and the picker is
  // usually that something: the unified selector lays one over the whole canvas,
  // and the palette button that opens the picker lives on the selector. Tinting
  // every reading by 30% black would be faithful to the screen and useless for
  // the job, which is to take the colour a Thing IS so it can be given to
  // another one. The picker already looks through its own panel and overlay for
  // exactly this reason; this is the same rule applied to the layer those two
  // are sitting on. Recognised by shape rather than by class name, so the next
  // dialog written gets it without being added to a list.
  // HTML text, which is most of the text in the app: a Thing's name is a <div>
  // inside a foreignObject, not an SVG <text>, and a box's `color` is the only
  // place its colour is written down. Without this the name of a Thing sampled
  // as the Thing's fill — the rect behind the letters — which is a different
  // colour from the one you were pointing at.
  add(textColorAt(el, cs, x, y));

  if (isScrim(el, cs, rect)) return out;
  if (rect && cs.backgroundImage && cs.backgroundImage !== 'none') {
    for (const image of splitTop(cs.backgroundImage)) add(cssGradientAt(image, rect, x, y));
  }
  add(parseColor(cs.backgroundColor));
  return out;
}

// How far a layer's edges may sit outside the viewport and still count as
// covering it. A scrim is usually `inset: 0` on a fixed box, which is exact;
// the slack is for the ones that overshoot.
const SCRIM_SLACK_PX = 1;

/**
 * Is this element a scrim — a translucent sheet laid over everything?
 *
 * Three things together, none of which is true of content: it covers the whole
 * viewport, it is positioned out of the flow to do so, and it is see-through.
 * An OPAQUE full-screen layer is deliberately not one — that is a page, like the
 * loading screen, and its colour is a real answer.
 */
function isScrim(el, cs, rect) {
  if (!rect || el.ownerSVGElement) return false;
  if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
  if (rect.left > SCRIM_SLACK_PX || rect.top > SCRIM_SLACK_PX) return false;
  if (rect.right < window.innerWidth - SCRIM_SLACK_PX) return false;
  if (rect.bottom < window.innerHeight - SCRIM_SLACK_PX) return false;
  const bg = parseColor(cs.backgroundColor);
  return Boolean(bg) && bg.a > 0 && bg.a < 1;
}

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

/**
 * A collector for the layers over a point, and the compositor that folds them.
 *
 * Layers arrive front to back — which is the order that lets collection STOP as
 * soon as something opaque arrives, since nothing behind it can be seen — and
 * are folded back to front, which is the order the compositor itself works in
 * and the only one a blend mode can be evaluated in, a blend mode being a
 * function of what is already behind it.
 */
function createStack() {
  const layers = [];
  return {
    /** @returns {boolean} true once nothing further back can matter. */
    push(layer) {
      layers.push(layer);
      if (layers.length >= MAX_LAYERS) return true;
      return layer.a >= OPAQUE_ENOUGH && layer.blend === 'normal';
    },
    /** @returns {string|null} #rrggbb, or null if nothing painted here at all. */
    resolve() {
      // Premultiplied while folding, un-premultiplied at the end: alpha is the
      // whole point of the exercise, and premultiplied is the space in which
      // "over" is one multiply and one add rather than a special case.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const layer = layers[i];
        let { r: sr, g: sg, b: sb } = layer;
        if (layer.blend === 'multiply' && a > 0) {
          sr = (sr * (r / a)) / 255;
          sg = (sg * (g / a)) / 255;
          sb = (sb * (b / a)) / 255;
        }
        const inverse = 1 - layer.a;
        r = sr * layer.a + r * inverse;
        g = sg * layer.a + g * inverse;
        b = sb * layer.a + b * inverse;
        a = layer.a + a * inverse;
      }
      if (a <= 0) return null;
      return toHex({ r: r / a, g: g / a, b: b / a });
    },
  };
}

/**
 * Collect every layer `el`'s subtree puts at the point, front to back.
 *
 * Paint order is document order — a parent's background first, then each child
 * in turn — so walking children in REVERSE and taking them before the parent's
 * own paint lists them topmost first. Subtrees whose box misses the point are
 * pruned, which is what keeps this cheap enough to run on every pointer move
 * over a full canvas.
 *
 * @param {number} alpha the opacity of every ancestor, multiplied together
 * @returns {boolean} true when the stack is finished and the walk should unwind
 */
function collect(el, x, y, alpha, ctx) {
  if (ctx.budget.n++ > MAX_VISITS) return true;
  if (!(el instanceof Element) || ctx.ignored(el) || ctx.seen.has(el)) return false;
  if (NON_RENDERED_TAGS.has(el.tagName?.toLowerCase())) return false;

  const rect = el.getBoundingClientRect?.();
  // A zero-size box is not evidence of absence (an SVG <g> of nothing, a
  // wrapper whose children are absolutely positioned), so only prune on a real
  // box that misses. Pruning allows the same slack svgHitKind does, or a thin
  // shape the pointer is beside would be discarded before its geometry ever got
  // a say — which is precisely the connection case.
  if (rect && (rect.width > 0 || rect.height > 0) && outsideBox(rect, x, y, TOLERANCE_PX)) {
    return false;
  }

  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return false;
  const own = parseFloat(cs.opacity);
  const next = alpha * (Number.isFinite(own) ? own : 1);
  // A fully faded subtree paints nothing, and saying so here saves walking it.
  if (next <= 0) return false;

  ctx.seen.add(el);

  const kids = el.children;
  for (let i = kids.length - 1; i >= 0; i -= 1) {
    if (collect(kids[i], x, y, next, ctx)) return true;
  }

  // `visibility` is inherited but overridable, so a hidden element can hold a
  // visible child — which is why this sits after the descent rather than with
  // `display` above.
  if (cs.visibility === 'hidden') return false;

  // The slack above is for descending, not for painting. SVG shapes settle it
  // exactly in svgHitKind; an HTML box has no such test, so it has to actually
  // contain the point — otherwise a panel would colour the air beside it.
  if (rect && !el.ownerSVGElement && outsideBox(rect, x, y)) return false;

  for (const layer of layersFor(el, cs, rect, x, y, next)) {
    if (ctx.out.push(layer)) return true;
  }
  return false;
}

/**
 * Where to start the walk for a given hit.
 *
 * An element inside an SVG hands back the outermost <svg> around it, because
 * that is the element whose document order is the canvas's paint order — see
 * the note in sampleColorAt. Nested <svg>s are walked out of: only the root of
 * them all is one uninterrupted paint order. Anything else is its own start.
 */
function paintRoot(el) {
  let root = el.ownerSVGElement;
  if (!root) return el;
  while (root.ownerSVGElement) root = root.ownerSVGElement;
  return root;
}

/**
 * The colour visible at a viewport point.
 *
 * Starts from the browser's hit stack — correct paint order, cheap, and it
 * handles ordinary HTML — then descends into each hit geometrically to reach
 * everything pointer-events hid, compositing as it goes and stopping at the
 * first layer nothing can be seen through.
 *
 * The hit stack runs deepest-first, so each entry after the first is usually an
 * ancestor of the one before; `seen` is what stops a subtree already collected
 * from being collected again through its parent.
 *
 * INSIDE AN SVG THE HIT STACK IS NOT USED FOR ORDER AT ALL, and that is the
 * important part. A hit is only ever the topmost element that ACCEPTS a
 * pointer, and on this canvas the thing that accepts the pointer is usually
 * underneath the thing you are looking at: a Thing's body rect takes the
 * pointer, and its thumbnail — pointer-events: none, later in document order,
 * painted over the rect — does not. Walking down from the rect finds the rect's
 * own opaque fill and stops there, so an image in a node was unreadable no
 * matter how exactly its pixels could be sampled. The image is reachable only
 * through their shared parent, which the hit stack reports AFTER the rect, so
 * it would land behind the thing it is painted on top of.
 *
 * SVG has no z-index: paint order IS document order, with no exceptions. So the
 * correct root to walk for anything inside an SVG is the SVG itself, and a
 * reverse-document-order descent from there is exact — the hit that led us in
 * is used only to find it. HTML keeps the hit stack, where positioning and
 * z-index mean document order is not paint order and the browser's own answer
 * is the only reliable one.
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
  const ctx = {
    ignored: (el) => roots.some(root => root.contains(el)),
    budget: { n: 0 },
    seen: new Set(),
    out: createStack(),
  };

  const stack = document.elementsFromPoint?.(clientX, clientY) || [];
  for (const hit of stack) {
    if (ctx.ignored(hit)) continue;
    if (collect(paintRoot(hit), clientX, clientY, 1, ctx)) break;
  }
  return ctx.out.resolve();
}
