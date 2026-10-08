/**
 * Bringing a semantic-web Thing into a Web.
 *
 * Every surface that turns a discovered concept into a node — the orbit, the
 * canvas drop, the discovery page, the right panel's Semantic Web connections —
 * goes through here, so a concept becomes the same prototype (found again by
 * its URI, enriched from the article it names) and a connection becomes the
 * same edge (named after its predicate, defined by a predicate Thing, arrowed
 * the way the statement reads, carrying where it came from) wherever it's added.
 *
 * Placement has two answers to "where does it go":
 *  - 'cluster': beside the node it hangs off, inside that node's cluster (the
 *    Things connected to it, and the group it sits in).
 *  - 'open': out in open canvas, clear of every existing cluster.
 */
import useGraphStore from '../store/graphStore.js';
import { projectGraphView } from '../core/openDefinitions.js';
import { backfillConceptLinks, conceptToPrototypeFields } from './candidates.js';
import { enrichPrototypeFromLinks } from './conceptEnrichment.js';
import { formatPredicate } from '../utils/predicateFormatter.js';
import { estimateEdgeLabelWidth, resolveEdgeLabelFontSize, getPointSegmentDistSq } from './layoutGeometry.js';
import { getNodeDimensions } from '../utils.js';
import useImageCache from './imageCache.js';
import { navigateToCoordinates } from './canvasNavigationService.js';

// How far past the nearest clean distance a spot beside an anchor may be.
const STRETCHES = [1, 1.3, 1.7, 2.2];
// A bulk add fills the ring around the anchor, so it keeps looking further out.
const BULK_STRETCHES = [1, 1.3, 1.7, 2.2, 2.8, 3.5, 4.4, 5.5, 7, 9];

// Room left between a placed node and anything already there.
const NODE_GAP = 48;
// Room left between a node placed in open space and any cluster.
const CLUSTER_CLEARANCE = 220;

const lower = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

/** Every URI a concept is known by: its own, and every authority it was merged from. */
export function conceptUris(concept) {
  const out = new Set();
  const add = (u) => { if (typeof u === 'string' && /^https?:\/\//.test(u)) out.add(u); };
  add(concept?.uri);
  add(concept?.semanticMetadata?.originalUri);
  (concept?.externalLinks || []).forEach(add);
  (concept?.semanticMetadata?.externalLinks || []).forEach(add);
  return out;
}

/**
 * The prototype already standing for this concept, or null.
 *
 * A concept is the same Thing as a prototype when they share a URI — whoever
 * made the prototype, by hand or from a search. Only when the concept has no
 * URI at all does a name decide it. Takes the LAST match: Maps iterate oldest
 * first, and an old duplicate from a previous session must not win.
 */
export function findPrototypeForConcept(concept, nodePrototypes = useGraphStore.getState().nodePrototypes) {
  const uris = conceptUris(concept);
  let match = null;
  if (uris.size > 0) {
    for (const proto of nodePrototypes.values()) {
      const protoUris = conceptUris(proto);
      for (const u of protoUris) {
        if (uris.has(u)) { match = proto; break; }
      }
    }
    if (match) return match;
  }
  const name = lower(concept?.name);
  if (!name) return null;
  for (const proto of nodePrototypes.values()) {
    if (lower(proto.name) === name && (uris.size === 0 || proto.semanticMetadata?.isSemanticNode)) match = proto;
  }
  return match;
}

/**
 * The prototype for a concept: found again if it exists (topping up any links
 * it predates), otherwise made, saved to the Library, and sent off to fetch its
 * description and picture from the article it names.
 */
export function ensureConceptPrototype(concept) {
  const st = useGraphStore.getState();
  const existing = findPrototypeForConcept(concept, st.nodePrototypes);
  if (existing) {
    topUpLinks(existing, concept);
    return existing.id;
  }

  const id = `semantic-node-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const fields = conceptToPrototypeFields(concept);
  st.addNodePrototype({
    id,
    name: concept.name,
    description: '',
    color: concept.color,
    typeNodeId: 'base-thing-prototype',
    definitionGraphIds: [],
    externalLinks: fields.externalLinks,
    semanticMetadata: { ...fields.semanticMetadata, generatedColor: concept.color },
    originalDescription: fields.originalDescription
  });
  // addNodePrototype already saves a new prototype; toggling unconditionally unsaved it (B-16).
  if (!useGraphStore.getState().savedNodeIds.has(id)) useGraphStore.getState().toggleSavedNode(id);
  enrichLater(id, fields.externalLinks);
  return id;
}

// A bulk add makes a hundred Things at once; each one's article is fetched a
// few at a time rather than all together, which Wikipedia would refuse.
const ENRICH_CONCURRENCY = 4;
const enrichQueue = [];
let enriching = 0;
function enrichLater(prototypeId, links) {
  enrichQueue.push([prototypeId, links]);
  pumpEnrichment();
}
function pumpEnrichment() {
  while (enriching < ENRICH_CONCURRENCY && enrichQueue.length > 0) {
    const [prototypeId, links] = enrichQueue.shift();
    enriching += 1;
    Promise.resolve(enrichPrototypeFromLinks(prototypeId, links))
      .catch(() => null)
      .finally(() => { enriching -= 1; pumpEnrichment(); });
  }
}

/**
 * Give a prototype any links a concept has that it lacks. The semantic web
 * names one Thing in several places (Wikidata, DBpedia), and not every
 * statement carries all of them; without this, a later statement reaching the
 * same Thing only by its DBpedia link wouldn't find it, and made a copy.
 */
function topUpLinks(proto, concept) {
  const patch = backfillConceptLinks(proto, concept);
  if (!patch) return;
  useGraphStore.getState().updateNodePrototype(proto.id, (draft) => {
    draft.externalLinks = patch.externalLinks;
    draft.semanticMetadata = patch.semanticMetadata;
  });
}

/** The Thing that defines a connection named `label`, made (and saved) if there isn't one. */
export function ensurePredicatePrototype(label, color = '#666666') {
  const st = useGraphStore.getState();
  let found = null;
  st.nodePrototypes.forEach((proto, pid) => {
    if (lower(proto.name) === lower(label)) found = pid;
  });
  if (found) return found;
  const id = `proto-conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  st.addNodePrototype({
    id,
    name: label,
    description: '',
    color,
    typeNodeId: null,
    definitionGraphIds: []
  });
  if (!useGraphStore.getState().savedNodeIds.has(id)) useGraphStore.getState().toggleSavedNode(id); // B-16
  return id;
}

// ---------------------------------------------------------------------------
// Reading the Web

/** Instances of a prototype in a Web's own instances (not ones inside open boxes). */
export function instancesOfPrototype(graphId, prototypeId, state = useGraphStore.getState()) {
  const graph = state.graphs.get(graphId);
  if (!graph?.instances || !prototypeId) return [];
  return [...graph.instances.values()].filter((inst) => inst.prototypeId === prototypeId);
}

/**
 * The instance a connection hangs off: the selected one if the subject is
 * selected, otherwise its first instance in the Web. Null when the subject
 * isn't in this Web — then there's nothing to attach to.
 */
export function anchorInstanceFor(graphId, prototypeId, selectedInstanceIds = null, state = useGraphStore.getState()) {
  const found = instancesOfPrototype(graphId, prototypeId, state);
  if (found.length === 0) return null;
  const selected = selectedInstanceIds ? found.find((inst) => selectedInstanceIds.has(inst.id)) : null;
  return selected || found[0];
}

/**
 * Whether this Web already says it: an edge between the anchor and an instance
 * of a Thing with this name (or URI), named after this predicate, either way round.
 */
export function hasConnection(graphId, anchorInstanceId, otherConcept, predicate, state = useGraphStore.getState()) {
  const graph = state.graphs.get(graphId);
  if (!graph || !anchorInstanceId) return false;
  const label = lower(formatPredicate(predicate || 'relatedTo'));
  const otherProto = findPrototypeForConcept(otherConcept, state.nodePrototypes);
  const otherName = lower(otherConcept?.name);
  const isOther = (instanceId) => {
    const inst = graph.instances?.get(instanceId);
    if (!inst) return false;
    if (otherProto && inst.prototypeId === otherProto.id) return true;
    return lower(state.nodePrototypes.get(inst.prototypeId)?.name) === otherName;
  };
  return (graph.edgeIds || []).some((eid) => {
    const e = state.edges.get(eid);
    if (!e) return false;
    const touches = (e.sourceId === anchorInstanceId && isOther(e.destinationId))
      || (e.destinationId === anchorInstanceId && isOther(e.sourceId));
    return touches && lower(e.name || e.label || e.type) === label;
  });
}

/**
 * A node's size as the canvas will draw it once it settles.
 *
 * Wikipedia pictures arrive through the image cache, not the prototype, and a
 * Thing just brought in from the semantic web gets its picture a moment AFTER
 * it's placed — at several times the size of a text node. Measuring the bare
 * prototype placed things with room that the picture then ate. So a cached
 * picture is measured in, and a semantic Thing whose picture may still be on
 * its way reserves the slot for one (the same square the canvas holds while an
 * image loads). Over-reserving only leaves a little more room.
 */
export function settledNodeDimensions(proto, inst = null) {
  const node = { ...(proto || {}), ...(inst || {}) };
  if (!node.thumbnailSrc && proto?.id) {
    const images = useImageCache.getState();
    const cached = images.images?.[proto.id];
    if (cached?.thumbnailSrc) {
      node.thumbnailSrc = cached.thumbnailSrc;
      node.imageAspectRatio = cached.imageAspectRatio;
    } else if (!images.failed?.[proto.id] && expectsPicture(proto)) {
      node.imageLoading = true;
    }
  }
  return getNodeDimensions(node, false, null);
}

/** Whether a Thing is one the semantic web will likely picture: brought in from it, with a link to follow. */
function expectsPicture(proto) {
  if (proto?.semanticMetadata?.wikipediaThumbnail) return true;
  if (!proto?.semanticMetadata?.isSemanticNode) return false;
  return conceptUris(proto).size > 0;
}

function nodeBoxes(view, state) {
  const boxes = new Map();
  view?.instances?.forEach((inst, id) => {
    if (inst.isGroupAnchor) return;
    const proto = state.nodePrototypes.get(inst.prototypeId);
    const dims = settledNodeDimensions(proto, inst);
    boxes.set(id, { x: inst.x, y: inst.y, w: dims.currentWidth, h: dims.currentHeight });
  });
  return boxes;
}

/**
 * The Web's clusters: Things joined by connections, or sharing a group, are one
 * cluster. A lone node is a cluster of one.
 */
export function clustersOf(graphId, state = useGraphStore.getState()) {
  const view = projectGraphView(state, graphId);
  const boxes = nodeBoxes(view, state);
  const parent = new Map([...boxes.keys()].map((id) => [id, id]));
  const find = (id) => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r);
    parent.set(id, r);
    return r;
  };
  const union = (a, b) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  (view?.edgeIds || []).forEach((eid) => {
    const e = state.edges.get(eid);
    if (e) union(e.sourceId, e.destinationId);
  });
  view?.groups?.forEach((group) => {
    const members = (group.memberInstanceIds || []).filter((id) => parent.has(id));
    for (let i = 1; i < members.length; i++) union(members[0], members[i]);
  });

  const byRoot = new Map();
  boxes.forEach((box, id) => {
    const root = find(id);
    if (!byRoot.has(root)) byRoot.set(root, { ids: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const c = byRoot.get(root);
    c.ids.push(id);
    c.minX = Math.min(c.minX, box.x); c.minY = Math.min(c.minY, box.y);
    c.maxX = Math.max(c.maxX, box.x + box.w); c.maxY = Math.max(c.maxY, box.y + box.h);
  });
  return { clusters: [...byRoot.values()], boxes };
}

const overlaps = (a, b, pad) => (
  a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y
);

/** Whether segment AB passes through box (padded). */
function segmentHitsBox(ax, ay, bx, by, box, pad) {
  const x0 = box.x - pad; const y0 = box.y - pad; const x1 = box.x + box.w + pad; const y1 = box.y + box.h + pad;
  // Liang–Barsky clip of the segment against the box.
  let t0 = 0; let t1 = 1;
  const dx = bx - ax; const dy = by - ay;
  const edges = [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}

/** Whether segments AB and CD cross (properly, not at a shared end). */
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const cross = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = cross(cx, cy, dx, dy, ax, ay); const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy); const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Distance from box centre along (dx, dy) to the box's edge. */
function extentTowards(box, dx, dy) {
  const ax = Math.abs(dx); const ay = Math.abs(dy);
  if (ax < 1e-6) return box.h / 2;
  if (ay < 1e-6) return box.w / 2;
  return Math.min(box.w / 2 / ax, box.h / 2 / ay);
}

/** The size connection labels are drawn at on the canvas, from the viewer's settings. */
function edgeLabelFontSize(state) {
  return resolveEdgeLabelFontSize(state.textSettings, state.connectionLabelSize);
}

/**
 * Where a node of `size` goes. Returns a top-left.
 *
 * Beside an anchor ('cluster'), every direction around it is tried at the
 * distance that direction needs — the two boxes' extents along it, plus the
 * whole connection label as the canvas will draw it, plus air — and a little
 * further out. Each spot is scored and the best kept, so there's always an
 * answer even when nothing is clean. In order of what it costs:
 *  - the new node landing on another node;
 *  - the new connection (and its label) running through another node;
 *  - the new node without room of its own: crowded by a neighbour;
 *  - the new node sitting on an existing connection;
 *  - the new connection crossing existing ones;
 *  - facing into the anchor's neighbours rather than away from them;
 *  - being further out than it needs to be.
 *
 * 'open' searches outward from `origin` for the nearest spot clear of every
 * cluster by a generous margin.
 */
export function findPlacement({ graphId, mode, anchorInstanceId = null, origin = null, size, predicateLabel = '', stretches = STRETCHES }, state = useGraphStore.getState()) {
  const { clusters, boxes } = clustersOf(graphId, state);
  const anchorBox = anchorInstanceId ? boxes.get(anchorInstanceId) : null;
  const w = size.w; const h = size.h;
  const at = (cx, cy) => ({ x: cx - w / 2, y: cy - h / 2, w, h });

  if (mode === 'cluster' && anchorBox) {
    const ax = anchorBox.x + anchorBox.w / 2;
    const ay = anchorBox.y + anchorBox.h / 2;
    const fontSize = edgeLabelFontSize(state);
    const labelLength = predicateLabel ? estimateEdgeLabelWidth(predicateLabel, fontSize) : 0;
    // Air at each end of the label, and around the line it's drawn on.
    const labelAir = fontSize * 0.75;
    const labelHalfHeight = fontSize * 0.7;
    // Room of its own: clear of neighbours by about a node's height.
    const ownRoom = Math.max(NODE_GAP, Math.min(w, h) * 0.9);

    const others = [...boxes.entries()].filter(([id]) => id !== anchorInstanceId);
    const otherBoxes = others.map(([, b]) => b);
    const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

    const view = projectGraphView(state, graphId);
    const segments = [];
    let nx = 0; let ny = 0; let n = 0;
    (view?.edgeIds || []).forEach((eid) => {
      const e = state.edges.get(eid);
      const sb = e && boxes.get(e.sourceId); const db = e && boxes.get(e.destinationId);
      if (!sb || !db || e.sourceId === e.destinationId) return;
      const sc = center(sb); const dc = center(db);
      segments.push({ ax: sc.x, ay: sc.y, bx: dc.x, by: dc.y, touchesAnchor: e.sourceId === anchorInstanceId || e.destinationId === anchorInstanceId });
      const other = e.sourceId === anchorInstanceId ? dc : e.destinationId === anchorInstanceId ? sc : null;
      if (other) { nx += other.x - ax; ny += other.y - ay; n++; }
    });
    const hasNeighbours = n > 0 && (nx !== 0 || ny !== 0);
    const outward = hasNeighbours ? Math.atan2(-ny, -nx) : 0;

    let best = null;
    const DIRECTIONS = 36;
    for (let k = 0; k < DIRECTIONS; k++) {
      const angle = (k / DIRECTIONS) * 2 * Math.PI;
      const dx = Math.cos(angle); const dy = Math.sin(angle);
      const reach = extentTowards(anchorBox, dx, dy) + extentTowards({ w, h }, dx, dy) + labelLength + labelAir * 2 + NODE_GAP;
      for (const stretch of stretches) {
        const r = reach * stretch;
        const cx = ax + dx * r; const cy = ay + dy * r;
        const box = at(cx, cy);
        let score = 0;

        for (const b of otherBoxes) {
          if (overlaps(box, b, NODE_GAP / 2)) score += 1000;
          else if (overlaps(box, b, ownRoom)) score += 120;
          // The connection and its label, between the two nodes' edges.
          if (segmentHitsBox(ax, ay, cx, cy, b, labelHalfHeight)) score += 400;
        }
        if (overlaps(box, anchorBox, NODE_GAP)) score += 1000;

        for (const seg of segments) {
          const { distSq } = getPointSegmentDistSq(cx, cy, seg.ax, seg.ay, seg.bx, seg.by);
          if (distSq < (Math.max(w, h) / 2 + labelHalfHeight) ** 2) score += 150;
          if (!seg.touchesAnchor && segmentsCross(ax, ay, cx, cy, seg.ax, seg.ay, seg.bx, seg.by)) score += 40;
        }

        if (hasNeighbours) score += (1 - Math.cos(angle - outward)) * 25;
        score += (stretch - 1) * 30;

        if (!best || score < best.score) best = { score, x: box.x, y: box.y };
      }
    }
    return { x: best.x, y: best.y };
  }

  // Open space.
  let ox = origin?.x; let oy = origin?.y;
  if (typeof ox !== 'number' || typeof oy !== 'number') {
    if (anchorBox) { ox = anchorBox.x + anchorBox.w / 2; oy = anchorBox.y + anchorBox.h / 2; } else { ox = 0; oy = 0; }
  }
  const zones = clusters.map((c) => ({ x: c.minX, y: c.minY, w: c.maxX - c.minX, h: c.maxY - c.minY }));
  const clear = (box) => !zones.some((z) => overlaps(box, z, CLUSTER_CLEARANCE));
  const first = at(ox, oy);
  if (clear(first)) return { x: first.x, y: first.y };

  const step = Math.max(w, h, 120);
  for (let ring = 1; ring < 60; ring++) {
    const r = ring * step;
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / step));
    let best = null;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * 2 * Math.PI;
      const box = at(ox + Math.cos(a) * r, oy + Math.sin(a) * r);
      if (clear(box)) { best = box; break; }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return { x: first.x, y: first.y };
}

/**
 * The centre of what the canvas is showing, in canvas coordinates, from the
 * Web's saved view. Null when it can't be told (no canvas on screen, no view
 * saved yet).
 */
export function visibleCanvasCenter(graphId, state = useGraphStore.getState()) {
  const view = state.graphViews?.get?.(graphId);
  if (typeof document === 'undefined' || !view?.panOffset || !view.zoomLevel) return null;
  const el = document.querySelector('.canvas-area');
  const rect = el?.getBoundingClientRect?.();
  if (!rect || !rect.width) return null;
  // Matches clientToCanvasCoordinates over NodeCanvas's fixed 100k canvas.
  const offset = -50000;
  return {
    x: (rect.width / 2 - view.panOffset.x) / view.zoomLevel + offset,
    y: (rect.height / 2 - view.panOffset.y) / view.zoomLevel + offset,
    zoom: view.zoomLevel
  };
}

/** The innermost group holding an instance, or null. */
function groupOf(graphId, instanceId, state) {
  const groups = state.graphs.get(graphId)?.groups;
  if (!groups || !instanceId) return null;
  let best = null;
  groups.forEach((group) => {
    const members = group.memberInstanceIds || [];
    if (!members.includes(instanceId)) return;
    if (!best || members.length < best.memberInstanceIds.length) best = group;
  });
  return best;
}

/**
 * Put a concept into a Web — or, when it's already there and the statement
 * hangs off an anchor, just draw the connection to it.
 *
 * @param {Object} args
 * @param {string} args.graphId
 * @param {Object} args.concept        - the concept being brought in
 * @param {'cluster'|'open'} [args.mode]
 * @param {string} [args.anchorInstanceId] - the node it's connected to (triplets)
 * @param {string} [args.predicate]    - the statement's predicate (raw or formatted)
 * @param {'out'|'in'} [args.direction] - 'out': anchor → predicate → concept;
 *                                        'in': concept → predicate → anchor
 * @param {Object} [args.provenance]   - where the statement came from
 * @param {{x:number,y:number}} [args.origin] - where open-space search starts
 * @param {boolean} [args.reveal=true] - bring it into view if it landed off screen
 * @param {{x:number,y:number}} [args.position] - an exact top-left; skips the search
 * @param {{x:number,y:number}} [args.at] - a point to centre it on (a drop); skips the search
 * @param {string} [args.prototypeId] - place this existing prototype instead of
 *   finding or making one for `concept`
 * @param {boolean} [args.joinGroup] - join the anchor's group; defaults to
 *   placing in its cluster
 * @param {number[]} [args.stretches] - how far out beside the anchor to look
 * @returns {{ prototypeId, instanceId, edgeId, linked: boolean }} `linked` when the
 *   other end was already in this Web and only the connection was drawn
 */
export function placeConcept({
  graphId, concept, mode = 'cluster', anchorInstanceId = null, predicate = null, direction = 'out',
  provenance = null, origin = null, reveal = true, position = null, at = null, prototypeId: givenPrototypeId = null,
  joinGroup = mode === 'cluster', stretches = STRETCHES
}) {
  const predicateLabel = predicate ? formatPredicate(predicate) : '';
  const st0 = useGraphStore.getState();
  const anchored = !!(graphId && anchorInstanceId && st0.graphs.get(graphId)?.instances?.has(anchorInstanceId));

  // Both ends already here: the statement is a connection between them, not a
  // second copy of the other end.
  const existingEnd = anchored && predicateLabel
    ? existingInstanceFor(graphId, concept, anchorInstanceId, st0, givenPrototypeId)
    : null;
  if (existingEnd) {
    const edgeId = connect({
      graphId, concept, predicate, predicateLabel, direction, provenance,
      anchorInstanceId, otherInstanceId: existingEnd
    });
    if (reveal) setTimeout(() => revealInstances(graphId, [anchorInstanceId, existingEnd]), 0);
    const prototypeId = st0.graphs.get(graphId).instances.get(existingEnd).prototypeId;
    // The same Thing by a shared link: it learns the statement's other links.
    // One matched only by name (a hand-made "France") is left as it is.
    const endProto = st0.nodePrototypes.get(prototypeId);
    const uris = conceptUris(concept);
    if (endProto && [...conceptUris(endProto)].some((u) => uris.has(u))) topUpLinks(endProto, concept);
    return { prototypeId, instanceId: existingEnd, edgeId, linked: true };
  }

  const prototypeId = givenPrototypeId || ensureConceptPrototype(concept);
  const st = useGraphStore.getState();
  if (!graphId || !st.graphs.get(graphId)) return { prototypeId, instanceId: null, edgeId: null, linked: false };

  const proto = st.nodePrototypes.get(prototypeId) || { name: concept.name, color: concept.color };
  const dims = settledNodeDimensions(proto);
  const hasAnchor = anchored;
  const center = origin || (hasAnchor ? null : visibleCanvasCenter(graphId, st));

  const topLeft = position
    || (at && { x: at.x - dims.currentWidth / 2, y: at.y - dims.currentHeight / 2 })
    || findPlacement({
    graphId,
    mode: hasAnchor ? mode : 'open',
    anchorInstanceId: hasAnchor ? anchorInstanceId : null,
    origin: center,
    size: { w: dims.currentWidth, h: dims.currentHeight },
    predicateLabel,
    stretches
  }, st);

  const instanceId = `instance-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  st.addNodeInstance(graphId, prototypeId, topLeft, instanceId);

  if (hasAnchor && joinGroup) {
    const group = groupOf(graphId, anchorInstanceId, useGraphStore.getState());
    if (group) useGraphStore.getState().addInstancesToGroup(graphId, group.id, [instanceId]);
  }

  const edgeId = hasAnchor && predicateLabel
    ? connect({ graphId, concept, predicate, predicateLabel, direction, provenance, anchorInstanceId, otherInstanceId: instanceId })
    : null;

  // Deferred a frame so the new node is in the view the reveal measures.
  if (reveal && !position && !at) {
    const ids = [anchorInstanceId, instanceId].filter(Boolean);
    setTimeout(() => revealInstances(graphId, ids), 0);
  }
  return { prototypeId, instanceId, edgeId, linked: false };
}

/**
 * Bring many statements about one Thing into a Web at once: every other end
 * placed around the anchor (or linked to, when it's already here), each with
 * the room a single add would give it, as one step to undo.
 *
 * Ends are placed one after another, so each spot is chosen knowing where the
 * ones before it went; as the ring around the anchor fills, the search reaches
 * further out. Statements the Web already makes are left alone.
 *
 * @param {Object} args
 * @param {string} args.graphId
 * @param {string} args.anchorInstanceId
 * @param {Array<{concept, predicate, direction, provenance}>} args.statements
 * @param {string} [args.label] - the undo entry's name
 * @returns {{ added: number, linked: number, skipped: number, instanceIds: string[] }}
 */
export function placeConnections({ graphId, anchorInstanceId, statements, label = 'Added connections' }) {
  const result = { added: 0, linked: 0, skipped: 0, instanceIds: [] };
  const st = useGraphStore.getState();
  if (!st.graphs.get(graphId)?.instances?.has(anchorInstanceId)) return result;
  const run = () => {
    for (const { concept, predicate, direction, provenance } of statements) {
      if (hasConnection(graphId, anchorInstanceId, concept, predicate)) { result.skipped += 1; continue; }
      const placed = placeConcept({
        graphId, concept, anchorInstanceId, predicate, direction, provenance,
        reveal: false, stretches: BULK_STRETCHES
      });
      if (placed.linked) result.linked += 1;
      else if (placed.instanceId) result.added += 1;
      if (placed.instanceId) result.instanceIds.push(placed.instanceId);
    }
  };
  if (typeof st.withHistoryTransaction === 'function') st.withHistoryTransaction(label, run);
  else run();
  // Deferred a frame so the new nodes are in the view the reveal measures.
  if (result.instanceIds.length > 0) {
    setTimeout(() => revealInstances(graphId, [anchorInstanceId, ...result.instanceIds]), 0);
  }
  return result;
}

/**
 * The instance in this Web that already stands for a concept, nearest the
 * anchor and never the anchor itself; null when there isn't one.
 *
 * A Thing sharing the concept's URI counts wherever it came from. Failing
 * that, a Thing of the same name in THIS Web counts too: a hand-made "France"
 * sitting on the canvas is the France being connected to. It is only linked
 * to — nothing is written onto it.
 *
 * @param {string} [prototypeId] - the prototype already chosen for the concept, if any
 */
export function existingInstanceFor(graphId, concept, anchorInstanceId, state = useGraphStore.getState(), prototypeId = null) {
  const instances = state.graphs.get(graphId)?.instances;
  const anchor = instances?.get(anchorInstanceId);
  if (!anchor) return null;
  const byUri = (prototypeId && state.nodePrototypes.get(prototypeId)) || findPrototypeForConcept(concept, state.nodePrototypes);
  const name = lower(concept?.name);
  const nearest = (match) => {
    let best = null; let bestD = Infinity;
    instances.forEach((inst, id) => {
      if (id === anchorInstanceId || !match(inst)) return;
      const d = (inst.x - anchor.x) ** 2 + (inst.y - anchor.y) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  };
  return (byUri && nearest((inst) => inst.prototypeId === byUri.id))
    || (name && nearest((inst) => lower(state.nodePrototypes.get(inst.prototypeId)?.name) === name))
    || null;
}

/**
 * The edge for a statement between the anchor and the other end, arrowed the
 * way the statement reads. When this Web already draws it — same ends, same
 * way round, same name — that edge is returned instead of a second one.
 */
function connect({ graphId, concept, predicate, predicateLabel, direction, provenance, anchorInstanceId, otherInstanceId }) {
  const sourceId = direction === 'in' ? otherInstanceId : anchorInstanceId;
  const destinationId = direction === 'in' ? anchorInstanceId : otherInstanceId;
  const st = useGraphStore.getState();
  const already = (st.graphs.get(graphId)?.edgeIds || []).find((eid) => {
    const e = st.edges.get(eid);
    return e && e.sourceId === sourceId && e.destinationId === destinationId && lower(e.name || e.label || e.type) === lower(predicateLabel);
  });
  if (already) return already;

  const definitionId = ensurePredicatePrototype(predicateLabel, concept.color || '#666666');
  const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  useGraphStore.getState().addEdge(graphId, {
    id: edgeId,
    sourceId,
    destinationId,
    name: predicateLabel,
    type: predicateLabel,
    typeNodeId: 'base-connection-prototype',
    definitionNodeIds: [definitionId],
    directionality: { arrowsToward: new Set([destinationId]) },
    provenance: provenance || {
      source: concept.source || null,
      uri: concept.semanticMetadata?.originalUri || concept.uri || null,
      predicate,
      retrieved_at: concept.discoveredAt || new Date().toISOString()
    }
  });
  return edgeId;
}

const CANVAS_OFFSET = -50000; // NodeCanvas's fixed 100k canvas, centred on 0
const REVEAL_MARGIN = 24;
// The TypeList bar along the bottom sits over the canvas.
const BOTTOM_CHROME = 60;

/**
 * The part of the canvas a viewer can actually see, in px relative to the
 * canvas element: the canvas less whatever open panel sits over its edge.
 */
function visibleCanvasBox(rect) {
  let left = rect.left; let right = rect.right;
  for (const side of ['left', 'right']) {
    const el = document.querySelector(`.panel-container.${side}`);
    const r = el?.getBoundingClientRect?.();
    if (!r || r.width < 40 || r.right <= rect.left || r.left >= rect.right) continue;
    if (side === 'left') left = Math.max(left, r.right);
    else right = Math.min(right, r.left);
  }
  return { x0: left - rect.left, x1: right - rect.left, y0: 0, y1: Math.max(0, rect.height - BOTTOM_CHROME) };
}

/**
 * Bring instances into the part of the canvas that isn't under a panel —
 * leaving the camera alone when they're already there, keeping the zoom when
 * they fit at it, and zooming out only as far as needed when they don't.
 *
 * @param {string} graphId
 * @param {string[]} instanceIds
 * @param {{ force?: boolean }} [options] - move even if they're all visible
 */
export function revealInstances(graphId, instanceIds, { force = false } = {}) {
  const st = useGraphStore.getState();
  const view = st.graphViews?.get?.(graphId);
  if (typeof document === 'undefined' || !view?.panOffset || !view.zoomLevel || st.activeGraphId !== graphId) return;
  const rect = document.querySelector('.canvas-area')?.getBoundingClientRect?.();
  if (!rect?.width) return;
  const graph = projectGraphView(st, graphId);
  const boxes = nodeBoxes(graph, st);
  const targets = instanceIds.map((id) => boxes.get(id)).filter(Boolean);
  if (targets.length === 0) return;

  const zoom = view.zoomLevel;
  const vis = visibleCanvasBox(rect);
  const toScreen = (x, y) => ({ x: (x - CANVAS_OFFSET) * zoom + view.panOffset.x, y: (y - CANVAS_OFFSET) * zoom + view.panOffset.y });
  const allVisible = targets.every((b) => {
    const a = toScreen(b.x, b.y);
    const z = toScreen(b.x + b.w, b.y + b.h);
    return a.x >= vis.x0 + REVEAL_MARGIN && z.x <= vis.x1 - REVEAL_MARGIN && a.y >= vis.y0 + REVEAL_MARGIN && z.y <= vis.y1 - REVEAL_MARGIN;
  });
  if (allVisible && !force) return;

  const minX = Math.min(...targets.map((b) => b.x)); const maxX = Math.max(...targets.map((b) => b.x + b.w));
  const minY = Math.min(...targets.map((b) => b.y)); const maxY = Math.max(...targets.map((b) => b.y + b.h));
  const visW = Math.max(1, vis.x1 - vis.x0 - REVEAL_MARGIN * 4);
  const visH = Math.max(1, vis.y1 - vis.y0 - REVEAL_MARGIN * 4);
  const fitZoom = Math.min(zoom, visW / Math.max(1, maxX - minX), visH / Math.max(1, maxY - minY));

  // navigateToCoordinates centres its target in the whole canvas element;
  // shift the target so the group lands centred in the visible part instead.
  const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
  const visCx = (vis.x0 + vis.x1) / 2; const visCy = (vis.y0 + vis.y1) / 2;
  navigateToCoordinates(
    cx - (visCx - rect.width / 2) / fitZoom,
    cy - (visCy - rect.height / 2) / fitZoom,
    { graphId, zoom: fitZoom, minZoom: 0.05, maxZoom: zoom, courteous: false }
  );
}
