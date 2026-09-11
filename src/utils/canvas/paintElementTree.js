/**
 * paintElementTree — apply a React element tree to real SVG DOM, imperatively.
 *
 * WHY THIS EXISTS
 *
 * Connection edges are the last high-compute subtree still rendered through
 * React's reconciler on the canvas. Node drag and pan/zoom were taken off it
 * long ago (see useNodeDrag and useCanvasTransform) because React cannot be in
 * the loop at 60-120Hz. Edges are not a per-frame path — they are a commit-path
 * cost — but they are by far the largest one, and the reconciler's element
 * allocation and diff is pure overhead for a subtree whose shape almost never
 * changes.
 *
 * The trick here is that nothing needed rewriting to make that possible. A React
 * element is already a plain-data description of a DOM node: `{ type, key,
 * props }`. `renderConnectionEdge` returns a tree of them, and every tag it
 * emits is an intrinsic SVG element (g, path, line, text, image, circle,
 * polygon, rect, clipPath, defs). So this walks that tree and writes it to the
 * DOM directly, diffing against what it wrote last time, and React never sees
 * the subtree at all.
 *
 * WHAT THIS IS NOT
 *
 * Not a general React renderer. It handles intrinsic elements, fragments,
 * arrays, and text — which is everything the edge renderer produces. A component
 * element (a function or class type) throws, deliberately: silently skipping one
 * would drop part of an edge and be very hard to trace. Self-loops render
 * <SelfLoopEdge> and are excluded upstream for exactly this reason.
 *
 * INVARIANT — the emitted DOM must stay byte-identical to what React produced.
 * useNodeDrag caches element references at drag start by querying for
 * `[data-edge-id]`, `[data-edge-hit]`, `[data-arrow]`, `[data-endpoint-dot]`,
 * `[data-label-sprite]`, `[data-glyph-layer]` and `text[data-connection-label]`,
 * then writes them every drag frame. `connection-label` and
 * `connection-label-ring` are a CSS contract driven by `.canvas-moving`. A
 * mismatch here breaks node drag silently at runtime.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// SVG attributes that are genuinely camelCase in the spec and must NOT be
// converted to kebab-case. Everything else camelCase (strokeWidth, textAnchor,
// dominantBaseline, paintOrder, ...) is hyphenated, which is what React does.
const CAMEL_ATTRS = new Set([
  'preserveAspectRatio', 'clipPathUnits', 'patternUnits', 'patternContentUnits',
  'patternTransform', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'maskUnits', 'maskContentUnits', 'markerUnits', 'markerWidth', 'markerHeight',
  'refX', 'refY', 'viewBox', 'textLength', 'lengthAdjust', 'startOffset',
  'pathLength', 'baseFrequency', 'numOctaves', 'stitchTiles', 'primitiveUnits',
  'filterUnits', 'systemLanguage', 'requiredFeatures', 'requiredExtensions',
]);

// Props that are React bookkeeping, not DOM.
const SKIP_PROPS = new Set(['children', 'key', 'ref', 'dangerouslySetInnerHTML', 'suppressHydrationWarning']);

// React event prop -> DOM event type. Only the ones the edge renderer uses;
// anything else falls through the generic on* rule below.
const EVENT_NAME_OVERRIDES = { onDoubleClick: 'dblclick' };

const attrCache = new Map();
function attrNameFor(prop) {
  if (prop === 'className') return 'class';
  if (prop === 'htmlFor') return 'for';
  if (CAMEL_ATTRS.has(prop)) return prop;
  // Already hyphenated (data-*, aria-*) or all lowercase: leave alone.
  if (!/[A-Z]/.test(prop)) return prop;
  let cached = attrCache.get(prop);
  if (cached === undefined) {
    cached = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
    attrCache.set(prop, cached);
  }
  return cached;
}

const isDataOrAria = (name) => name.charCodeAt(0) === 100 /* d */
  ? name.startsWith('data-')
  : name.startsWith('aria-');

const isEventProp = (p) => p.length > 2 && p.charCodeAt(0) === 111 /* o */ && p.charCodeAt(1) === 110 /* n */ && p[2] >= 'A' && p[2] <= 'Z';
const domEventName = (p) => EVENT_NAME_OVERRIDES[p] || p.slice(2).toLowerCase();

/**
 * Flatten fragments / arrays / null / false into a list of renderable children,
 * preserving order. React treats null, undefined, false and true as empty.
 */
function flattenChildren(children, out) {
  if (children == null || children === false || children === true) return out;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) flattenChildren(children[i], out);
    return out;
  }
  if (typeof children === 'object' && children.type === Symbol.for('react.fragment')) {
    return flattenChildren(children.props ? children.props.children : null, out);
  }
  out.push(children);
  return out;
}

function applyStyle(el, next, prev) {
  const style = el.style;
  if (prev) {
    for (const k in prev) {
      if (!next || next[k] === undefined) style[k] = '';
    }
  }
  if (next) {
    for (const k in next) {
      const v = next[k];
      if (prev && prev[k] === v) continue;
      style[k] = v == null ? '' : v;
    }
  }
}

/**
 * Write `nextProps` onto `el`, removing anything present in `prevProps` that is
 * gone. `listeners` carries the currently-attached DOM handlers for this element
 * so they can be swapped without re-adding on every paint.
 */
function applyProps(el, nextProps, prevProps, listeners) {
  // Remove props that disappeared.
  if (prevProps) {
    for (const p in prevProps) {
      if (SKIP_PROPS.has(p)) continue;
      if (nextProps && p in nextProps) continue;
      if (isEventProp(p)) {
        const type = domEventName(p);
        const bound = listeners.get(type);
        if (bound) { el.removeEventListener(type, bound); listeners.delete(type); }
      } else if (p === 'style') {
        applyStyle(el, null, prevProps.style);
      } else {
        el.removeAttribute(attrNameFor(p));
      }
    }
  }

  for (const p in nextProps) {
    if (SKIP_PROPS.has(p)) continue;
    const v = nextProps[p];
    const prevV = prevProps ? prevProps[p] : undefined;

    if (isEventProp(p)) {
      const type = domEventName(p);
      const bound = listeners.get(type);
      if (bound && bound.__fn === v) continue;
      if (bound) el.removeEventListener(type, bound);
      if (typeof v === 'function') {
        // Wrapper so the handler can be swapped without touching the listener
        // list, and so the identity check above is cheap.
        const wrapper = (e) => wrapper.__fn(e);
        wrapper.__fn = v;
        el.addEventListener(type, wrapper);
        listeners.set(type, wrapper);
      } else {
        listeners.delete(type);
      }
      continue;
    }

    if (p === 'style') {
      if (v !== prevV) applyStyle(el, v, prevV);
      continue;
    }

    if (v === prevV) continue;

    const name = attrNameFor(p);
    if (v == null) {
      el.removeAttribute(name);
    } else if (typeof v === 'boolean') {
      // React splits here, and the edge renderer depends on it:
      // `data-edge-hit={true}` must serialise as "true", because that is what
      // React emitted and useNodeDrag selects on `[data-edge-hit]`. But a plain
      // SVG attribute given a boolean is dropped entirely. Verified against
      // React's own output rather than assumed.
      if (isDataOrAria(name)) el.setAttribute(name, v ? 'true' : 'false');
      else el.removeAttribute(name);
    } else {
      el.setAttribute(name, String(v));
    }
  }
}

/**
 * A painted node: the DOM element plus the props and children we last wrote, so
 * the next paint is a diff rather than a rebuild.
 */
function createRecord(el, type, key) {
  return { el, type, key, props: null, listeners: new Map(), children: [], text: null };
}

function isTextNode(child) {
  const t = typeof child;
  return t === 'string' || t === 'number';
}

function paintChild(child, prevRecord) {
  if (isTextNode(child)) {
    const text = String(child);
    if (prevRecord && prevRecord.type === '#text') {
      if (prevRecord.text !== text) { prevRecord.el.nodeValue = text; prevRecord.text = text; }
      return prevRecord;
    }
    const el = document.createTextNode(text);
    const rec = createRecord(el, '#text', null);
    rec.text = text;
    return rec;
  }

  const { type, key, props } = child;
  if (typeof type !== 'string') {
    throw new Error(
      `paintElementTree: component elements are not supported (got ${
        typeof type === 'function' ? (type.displayName || type.name || 'anonymous') : String(type)
      }). Render it through React instead.`
    );
  }

  // Same tag AND same key means the element survives and is updated in place.
  // Anything else is a fresh element — this is what keeps `d` off a <line>.
  const reusable = prevRecord && prevRecord.type === type && prevRecord.key === key;
  const rec = reusable ? prevRecord : createRecord(document.createElementNS(SVG_NS, type), type, key);

  applyProps(rec.el, props, reusable ? rec.props : null, rec.listeners);
  rec.props = props;

  paintChildren(rec, props ? props.children : null);
  return rec;
}

function paintChildren(parentRecord, children) {
  const flat = flattenChildren(children, []);
  const prev = parentRecord.children;
  const next = new Array(flat.length);
  const parentEl = parentRecord.el;

  // Match by key where present, else by position. The edge tree is static in
  // shape, so positional matching is the common path; keys appear on glyph
  // images and z-slot fragments.
  let byKey = null;
  for (let i = 0; i < prev.length; i++) {
    const k = prev[i].key;
    if (k != null) {
      if (!byKey) byKey = new Map();
      byKey.set(k, prev[i]);
    }
  }

  for (let i = 0; i < flat.length; i++) {
    const child = flat[i];
    const key = isTextNode(child) ? null : child.key;
    let prevRec = null;
    if (key != null && byKey) {
      prevRec = byKey.get(key) || null;
      if (prevRec) byKey.delete(key);
    } else if (key == null) {
      const candidate = prev[i];
      if (candidate && candidate.key == null) prevRec = candidate;
    }
    next[i] = paintChild(child, prevRec);
  }

  // Reconcile the DOM child list by ordered insertion. Append-only drifts as
  // soon as anything reorders.
  const used = new Set(next.map(r => r.el));
  for (let i = 0; i < prev.length; i++) {
    const rec = prev[i];
    if (!used.has(rec.el) && rec.el.parentNode === parentEl) parentEl.removeChild(rec.el);
  }
  for (let i = 0; i < next.length; i++) {
    const el = next[i].el;
    const atPosition = parentEl.childNodes[i];
    if (atPosition !== el) parentEl.insertBefore(el, atPosition || null);
  }

  parentRecord.children = next;
}

/**
 * Paint one edge's element tree into `container`.
 *
 * @param {Element} container    the slot <g> this edge belongs to
 * @param {object|null} element  the React element from renderConnectionEdge
 * @param {object|null} record   what was painted for this edge last time
 * @returns {object|null} the new record, to be passed back next paint
 */
export function paintEdge(container, element, record) {
  if (element == null || element === false) {
    if (record && record.el.parentNode === container) container.removeChild(record.el);
    return null;
  }
  const rec = paintChild(element, record);
  if (rec.el.parentNode !== container) container.appendChild(rec.el);
  return rec;
}

/**
 * Paint an ordered list of edge elements into `container`, reusing prior records
 * by edge id and pruning any that are gone.
 *
 * @param {Element} container
 * @param {Array<{id: string, element: object|null}>} entries in paint order
 * @param {Map<string, object>} records edge id -> record, mutated in place
 */
export function paintEdgeList(container, entries, records) {
  const seen = new Set();
  const ordered = [];

  for (let i = 0; i < entries.length; i++) {
    const { id, element } = entries[i];
    if (element == null || element === false) continue;
    const rec = paintChild(element, records.get(id) || null);
    records.set(id, rec);
    seen.add(id);
    ordered.push(rec.el);
  }

  for (const [id, rec] of records) {
    if (seen.has(id)) continue;
    if (rec.el.parentNode === container) container.removeChild(rec.el);
    records.delete(id);
  }

  for (let i = 0; i < ordered.length; i++) {
    const el = ordered[i];
    const atPosition = container.childNodes[i];
    if (atPosition !== el) container.insertBefore(el, atPosition || null);
  }
}

export const __testing = { attrNameFor, flattenChildren };
