/**
 * Layout quality metrics — what the bench grades.
 *
 * Every number here is measured on the DRAWN scene, not on the solver's model
 * of it: node boxes at rendered size, connections clipped to the node borders
 * they visibly leave from, labels at the visible midpoint, rotated along the
 * connection and cut to 85% of it with an ellipsis (the renderer's default),
 * group shells from the renderer's own `computeGroupLayout`, and node-group
 * anchors drawn as their group's title tab rather than as a node.
 *
 * The geometry is hand-rolled and independent of services/layoutGeometry.js,
 * for the same reason as layoutHelpers.js: a bug in the solver's primitives
 * must not be able to agree with itself. Only DATA is shared — glyph widths,
 * the truncation rule and the group-shell rule are the renderer's, because the
 * question is "how does it look", and those functions ARE how it looks.
 *
 * Sources for each criterion (see README.md for the full rationale):
 *   node overlap / edge-through-node .... Dunne & Shneiderman 2009 ("occlusion",
 *                                         "tunneling"); Dwyer et al. 2006
 *   edge crossings ...................... Purchase 1997, 2002 (strongest single
 *                                         predictor of reading errors)
 *   crossing angle ...................... Huang, Eades & Hong 2008, 2014
 *   angular resolution .................. Formann et al. 1993; Purchase 2002
 *   edge-length uniformity .............. Hachul & Jünger 2007 (CV of length)
 *   stress .............................. Kamada & Kawai 1989; Gansner, Koren
 *                                         & North 2004 (scale-normalised)
 *   label overlap / label-edge .......... Kakoulis & Tollis 2003 (edge label
 *                                         placement); Christensen et al. 1995
 *   cluster separation .................. Rousseeuw 1987 (silhouette); Gestalt
 *                                         proximity (Wertheimer; Palmer 1992)
 *   compactness ......................... Purchase 2002; Kieffer et al. 2016
 */
import { computeGroupLayout, buildGroupsByMemberIdIndex, buildChildGroupIdsIndex, groupIdFromPlaceholderId } from '../../src/services/groupLayout.js';
import { estimateEdgeLabelWidth } from '../../src/services/layoutGeometry.js';
import { truncateEdgeLabel } from '../../src/services/textMeasurement.js';

export const LABEL_TRUNCATE_FILL = 0.85; // src/utils/canvas/edgeLabelPlacement.js
export const PARALLEL_CURVE_SPACING = 200; // 1.0 baseline, see graphStore multiConnectionCurve
const EPS = 0.5; // px of penetration below which two things count as touching, not overlapping

// ============================================================================
// PRIMITIVES — oriented boxes and segments
// ============================================================================

/** Oriented box: centre, unit axis u, half-extents along u and its normal. */
const obb = (cx, cy, ux, uy, hw, hh) => ({ cx, cy, ux, uy, hw, hh });
const aabbToObb = (r) => obb((r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2, 1, 0, (r.maxX - r.minX) / 2, (r.maxY - r.minY) / 2);
const inflate = (b, m) => ({ ...b, hw: b.hw + m, hh: b.hh + m });

const obbCorners = (b) => {
  const nx = -b.uy, ny = b.ux;
  const out = [];
  for (const [s, t] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    out.push([b.cx + b.ux * b.hw * s + nx * b.hh * t, b.cy + b.uy * b.hw * s + ny * b.hh * t]);
  }
  return out;
};

const obbAabb = (b) => {
  const ex = Math.abs(b.ux) * b.hw + Math.abs(b.uy) * b.hh;
  const ey = Math.abs(b.uy) * b.hw + Math.abs(b.ux) * b.hh;
  return { minX: b.cx - ex, maxX: b.cx + ex, minY: b.cy - ey, maxY: b.cy + ey };
};

/** Separating-axis test; true when the boxes interpenetrate by more than EPS. */
const obbOverlap = (A, B) => {
  const axes = [[A.ux, A.uy], [-A.uy, A.ux], [B.ux, B.uy], [-B.uy, B.ux]];
  const dx = B.cx - A.cx, dy = B.cy - A.cy;
  for (const [ax, ay] of axes) {
    const rA = A.hw * Math.abs(A.ux * ax + A.uy * ay) + A.hh * Math.abs(-A.uy * ax + A.ux * ay);
    const rB = B.hw * Math.abs(B.ux * ax + B.uy * ay) + B.hh * Math.abs(-B.uy * ax + B.ux * ay);
    if (Math.abs(dx * ax + dy * ay) >= rA + rB - EPS) return false;
  }
  return true;
};

/** Liang–Barsky clip of P0→P1 against an axis-aligned box: [tIn, tOut] or null. */
const clipAabb = (x0, y0, x1, y1, minX, minY, maxX, maxY) => {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
};

/** Does segment AB pass through the box's interior (deeper than EPS)? */
const segHitsObb = (ax, ay, bx, by, b) => {
  const nx = -b.uy, ny = b.ux;
  const lx0 = (ax - b.cx) * b.ux + (ay - b.cy) * b.uy;
  const ly0 = (ax - b.cx) * nx + (ay - b.cy) * ny;
  const lx1 = (bx - b.cx) * b.ux + (by - b.cy) * b.uy;
  const ly1 = (bx - b.cx) * nx + (by - b.cy) * ny;
  const hw = b.hw - EPS, hh = b.hh - EPS;
  if (hw <= 0 || hh <= 0) return false;
  const c = clipAabb(lx0, ly0, lx1, ly1, -hw, -hh, hw, hh);
  return !!c && c[1] - c[0] > 1e-9;
};

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Proper crossing of two segments; returns |sin| of the crossing angle, or 0. */
const segCross = (a, b, c, d) => {
  const d1 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
  const d2 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
  const d3 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
  const d4 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) {
    const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y;
    const s = Math.abs(ux * vy - uy * vx) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    return Math.max(s, 1e-6);
  }
  return 0;
};

const rectGap = (a, b) => Math.hypot(
  Math.max(0, a.minX - b.maxX, b.minX - a.maxX),
  Math.max(0, a.minY - b.maxY, b.minY - a.maxY)
);
const rectsOverlap = (a, b) =>
  a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minY < b.maxY - EPS && b.minY < a.maxY - EPS;
const aabbOfPts = (pts) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

// ============================================================================
// THE DRAWN SCENE
// ============================================================================

/**
 * Rebuild what the canvas paints from a layout result.
 *
 * @param {object} c
 * @param {Array<{id,width,height}>} c.nodes
 * @param {Array<{id,sourceId,destinationId,name}>} c.edges
 * @param {Array} c.groups store-shaped groups
 * @param {Map<string,{x,y}>} positions top-left positions, as the store holds them
 */
export function buildScene(c, positions, opts = {}) {
  const fontSize = opts.fontSize ?? 71.28;
  const truncate = opts.truncate ?? true;
  const groupLabelFontSize = opts.groupLabelFontSize ?? 45;
  const gridSize = opts.gridSize ?? 200;
  const nodes = c.nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const pos = new Map(positions);
  const groups = c.groups || [];

  // ── Groups, with node-group anchors synced to their title tab ─────────────
  const groupsById = new Map(groups.map(g => [g.id, g]));
  const groupsByMemberId = buildGroupsByMemberIdIndex(groupsById);
  const childIdx = buildChildGroupIdsIndex(groupsById, groupsByMemberId);
  const anchorOf = new Map(); // anchorId -> groupId (node-groups only)
  groups.forEach(g => { if (g.linkedNodePrototypeId && g.anchorInstanceId) anchorOf.set(g.anchorInstanceId, g.id); });

  let groupLayouts = new Map();
  const layoutGroups = () => {
    const nodesById = new Map();
    const dimsById = new Map();
    pos.forEach((p, id) => {
      const n = byId.get(id);
      nodesById.set(id, { id, x: p.x, y: p.y });
      dimsById.set(id, { currentWidth: n?.width ?? 200, currentHeight: n?.height ?? 150 });
    });
    const ctx = {
      nodesById, dimsById, groupsById, groupsByMemberId, childGroupIdsByGroupId: childIdx, gridSize,
      measureLabelWidth: (t) => estimateEdgeLabelWidth(t || 'Group', groupLabelFontSize),
      labelFontSize: groupLabelFontSize, labelScale: 1, _cache: new Map(), _visiting: new Set()
    };
    const out = new Map();
    groups.forEach(g => { const r = computeGroupLayout(g, ctx); if (r?.ok) out.set(g.id, r); });
    return out;
  };
  // The renderer re-syncs each anchor to its tab; two rounds settle nesting.
  for (let round = 0; round < 3; round++) {
    groupLayouts = layoutGroups();
    anchorOf.forEach((gid, aid) => {
      const gl = groupLayouts.get(gid);
      const n = byId.get(aid);
      if (!gl || !n) return;
      pos.set(aid, { x: gl.label.x + gl.label.w / 2 - n.width / 2, y: gl.label.y + gl.label.h / 2 - n.height / 2 });
    });
  }
  const groupRect = new Map();
  groupLayouts.forEach((gl, gid) => {
    const vb = gl.visualBounds;
    groupRect.set(gid, { minX: vb.x, minY: vb.y, maxX: vb.x + vb.w, maxY: vb.y + vb.h });
  });
  const hiddenAnchor = (id) => anchorOf.has(id) && groupRect.has(anchorOf.get(id));

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const nodeRect = new Map();
  const center = new Map();
  nodes.forEach(n => {
    const p = pos.get(n.id);
    if (!p) return;
    center.set(n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 });
    if (!hiddenAnchor(n.id)) nodeRect.set(n.id, { minX: p.x, minY: p.y, maxX: p.x + n.width, maxY: p.y + n.height });
  });
  // The box a connection visibly leaves from: the node, or a node-group's
  // shell — toward the outside. Toward one of its own members the connection
  // starts inside the shell, at the title tab.
  const memberOfGroup = (id, gid) => (groupsById.get(gid)?.memberInstanceIds || []).includes(id);
  const tabRect = (id) => {
    const gl = groupLayouts.get(anchorOf.get(id));
    return { minX: gl.label.x, minY: gl.label.y, maxX: gl.label.x + gl.label.w, maxY: gl.label.y + gl.label.h };
  };
  const exitBox = (id, other) => {
    if (!hiddenAnchor(id)) return nodeRect.get(id);
    return memberOfGroup(other, anchorOf.get(id)) ? tabRect(id) : groupRect.get(anchorOf.get(id));
  };

  // ── Connections ───────────────────────────────────────────────────────────
  const pairCount = new Map();
  const pairKey = (e) => (e.sourceId < e.destinationId ? `${e.sourceId}|${e.destinationId}` : `${e.destinationId}|${e.sourceId}`);
  c.edges.forEach(e => pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) || 0) + 1));
  const pairSeen = new Map();

  const drawn = [];
  c.edges.forEach(e => {
    if (e.sourceId === e.destinationId) return;
    const a = center.get(e.sourceId), b = center.get(e.destinationId);
    const ba = exitBox(e.sourceId, e.destinationId), bb = exitBox(e.destinationId, e.sourceId);
    if (!a || !b || !ba || !bb) return;
    const ca = clipAabb(a.x, a.y, b.x, b.y, ba.minX, ba.minY, ba.maxX, ba.maxY);
    const cb = clipAabb(a.x, a.y, b.x, b.y, bb.minX, bb.minY, bb.maxX, bb.maxY);
    const t0 = ca ? ca[1] : 0;
    const t1 = cb ? cb[0] : 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const visible = Math.max(0, (t1 - t0) * len);
    const p0 = { x: a.x + dx * t0, y: a.y + dy * t0 };
    const p1 = { x: a.x + dx * t1, y: a.y + dy * t1 };

    // Parallel connections bow into quadratic curves; the label rides the apex.
    const k = pairKey(e);
    const total = pairCount.get(k);
    const idx = pairSeen.get(k) || 0;
    pairSeen.set(k, idx + 1);
    let pts = [p0, p1];
    let mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    if (total > 1 && visible > 0) {
      const sign = (e.sourceId < e.destinationId) ? 1 : -1;
      const off = (idx - (total - 1) / 2) * PARALLEL_CURVE_SPACING / 2 * sign;
      mid = { x: mid.x - uy * off, y: mid.y + ux * off };
      pts = [p0, mid, p1];
    }

    let label = null;
    const name = e.name || '';
    if (name && visible > 0) {
      const shown = truncate ? truncateEdgeLabel(name, fontSize, visible * LABEL_TRUNCATE_FILL) : name;
      const w = estimateEdgeLabelWidth(shown, fontSize);
      const fullChars = Array.from(name).length;
      const shownChars = shown === name ? fullChars : Math.max(0, Array.from(shown).length - 1);
      label = {
        box: obb(mid.x, mid.y, ux, uy, w / 2, fontSize * 1.1 / 2),
        shownChars, fullChars, truncated: shown !== name,
        fullWidth: estimateEdgeLabelWidth(name, fontSize)
      };
    } else if (name) {
      label = { box: null, shownChars: 0, fullChars: Array.from(name).length, truncated: true, fullWidth: estimateEdgeLabelWidth(name, fontSize) };
    }
    drawn.push({
      edge: e, pts, visible, centerLen: len, label,
      bbox: aabbOfPts(pts), labelAabb: label?.box ? obbAabb(label.box) : null
    });
  });

  return { nodes, byId, pos, center, nodeRect, groupRect, groupLayouts, anchorOf, hiddenAnchor, drawn, fontSize, groupsById, childIdx };
}

// ============================================================================
// METRICS
// ============================================================================

const bboxHit = (a, b, m = 0) =>
  a.minX - m < b.maxX && b.minX - m < a.maxX && a.minY - m < b.maxY && b.minY - m < a.maxY;

/** Ancestor sets from the renderer's containment index. */
function groupAncestry(groups, childIdx) {
  const parents = new Map();
  childIdx.forEach((kids, pid) => kids.forEach(k => {
    if (!parents.has(k)) parents.set(k, new Set());
    parents.get(k).add(pid);
  }));
  const anc = new Map();
  const walk = (gid, seen = new Set()) => {
    if (anc.has(gid)) return anc.get(gid);
    const out = new Set();
    (parents.get(gid) || []).forEach(p => {
      if (seen.has(p)) return;
      seen.add(p);
      out.add(p);
      walk(p, seen).forEach(x => out.add(x));
    });
    anc.set(gid, out);
    return out;
  };
  groups.forEach(g => walk(g.id));
  return anc;
}

/** Connected components over the given node ids. */
function components(ids, edges) {
  const parent = new Map(ids.map(id => [id, id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  edges.forEach(e => {
    if (!parent.has(e.sourceId) || !parent.has(e.destinationId)) return;
    const a = find(e.sourceId), b = find(e.destinationId);
    if (a !== b) parent.set(a, b);
  });
  const out = new Map();
  ids.forEach(id => out.set(id, find(id)));
  return out;
}

/**
 * Cluster labels for the separation metrics. A case can declare its own (a
 * planted partition); otherwise a node's cluster is its outermost group, and
 * an ungrouped node's is its connected component among ungrouped nodes.
 */
export function deriveClusters(c, scene) {
  if (c.clusters) return new Map(c.clusters);
  const groups = c.groups || [];
  const anc = groupAncestry(groups, scene.childIdx);
  const top = groups.filter(g => (anc.get(g.id)?.size || 0) === 0);
  const label = new Map();
  top.forEach(g => (g.memberInstanceIds || []).forEach(id => { if (!label.has(id)) label.set(id, `g:${g.id}`); }));
  top.forEach(g => { if (g.anchorInstanceId && !label.has(g.anchorInstanceId)) label.set(g.anchorInstanceId, `g:${g.id}`); });
  const loose = c.nodes.map(n => n.id).filter(id => !label.has(id));
  const comp = components(loose, c.edges);
  loose.forEach(id => label.set(id, `c:${comp.get(id)}`));
  return label;
}

/** BFS hop distances, per source, capped to the component. */
function normalizedStress(c, scene) {
  const ids = c.nodes.map(n => n.id).filter(id => scene.center.has(id));
  const idx = new Map(ids.map((id, i) => [id, i]));
  const adj = ids.map(() => []);
  c.edges.forEach(e => {
    const a = idx.get(e.sourceId), b = idx.get(e.destinationId);
    if (a === undefined || b === undefined || a === b) return;
    adj[a].push(b); adj[b].push(a);
  });
  const pts = ids.map(id => scene.center.get(id));
  let sWxd = 0, sWxx = 0, sWdd = 0;
  const dist = new Int32Array(ids.length);
  for (let s = 0; s < ids.length; s++) {
    dist.fill(-1); dist[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const v of adj[u]) if (dist[v] < 0) { dist[v] = dist[u] + 1; q.push(v); }
    }
    for (let t = s + 1; t < ids.length; t++) {
      const d = dist[t];
      if (d <= 0) continue;
      const x = Math.hypot(pts[s].x - pts[t].x, pts[s].y - pts[t].y);
      const w = 1 / (d * d);
      sWxd += w * x * d; sWxx += w * x * x; sWdd += w * d * d;
    }
  }
  if (sWxx === 0 || sWdd === 0) return null;
  // Optimal uniform scale removes the (arbitrary) drawing scale:
  // min_a Σw(a·x − d)² / Σw·d² = 1 − (Σwxd)² / (Σwxx·Σwdd)
  return Math.max(0, 1 - (sWxd * sWxd) / (sWxx * sWdd));
}

export function measureLayout(c, positions, opts = {}) {
  const scene = buildScene(c, positions, opts);
  const { nodeRect, groupRect, drawn, fontSize, center } = scene;
  const rects = [...nodeRect.entries()];
  const nNodes = rects.length;
  const m = drawn.length;
  const labels = drawn.filter(d => d.label?.box);
  const nLabels = drawn.filter(d => d.label).length;
  const em = fontSize;

  // ── Node–node occlusion ──────────────────────────────────────────────────
  let nodeOverlaps = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(rects[i][1], rects[j][1])) nodeOverlaps++;
  }

  // ── Connection through an unrelated node ("tunneling") ───────────────────
  let edgeThroughNode = 0;
  const nodeObbs = rects.map(([id, r]) => [id, r, aabbToObb(r)]);
  drawn.forEach(d => {
    if (d.visible <= 0) return;
    nodeObbs.forEach(([id, r, b]) => {
      if (id === d.edge.sourceId || id === d.edge.destinationId) return;
      if (!bboxHit(d.bbox, r)) return;
      for (let s = 0; s < d.pts.length - 1; s++) {
        if (segHitsObb(d.pts[s].x, d.pts[s].y, d.pts[s + 1].x, d.pts[s + 1].y, b)) { edgeThroughNode++; break; }
      }
    });
  });

  // ── Crossings and their angles ───────────────────────────────────────────
  let crossings = 0, sinSum = 0;
  for (let i = 0; i < drawn.length; i++) {
    const A = drawn[i];
    if (A.visible <= 0) continue;
    for (let j = i + 1; j < drawn.length; j++) {
      const B = drawn[j];
      if (B.visible <= 0 || !bboxHit(A.bbox, B.bbox)) continue;
      const ea = A.edge, eb = B.edge;
      if (ea.sourceId === eb.sourceId || ea.sourceId === eb.destinationId ||
          ea.destinationId === eb.sourceId || ea.destinationId === eb.destinationId) continue;
      for (let s = 0; s < A.pts.length - 1; s++) {
        for (let t = 0; t < B.pts.length - 1; t++) {
          const sn = segCross(A.pts[s], A.pts[s + 1], B.pts[t], B.pts[t + 1]);
          if (sn > 0) { crossings++; sinSum += sn; }
        }
      }
    }
  }

  // ── Labels ───────────────────────────────────────────────────────────────
  // Hard: text on text, text on a node box, a connection line through text.
  // Soft ("crowded"): anything within CROWD_EM of the text — the breathing room
  // a label needs to read as belonging to its own line.
  const CROWD = 0.3 * em;
  let labelLabel = 0, labelNode = 0, labelOwnNode = 0, labelEdge = 0;
  const crowded = new Set();
  for (let i = 0; i < labels.length; i++) {
    const L = labels[i];
    for (let j = i + 1; j < labels.length; j++) {
      const K = labels[j];
      if (!bboxHit(L.labelAabb, K.labelAabb, CROWD)) continue;
      if (obbOverlap(L.label.box, K.label.box)) labelLabel++;
      if (obbOverlap(inflate(L.label.box, CROWD / 2), inflate(K.label.box, CROWD / 2))) { crowded.add(i); crowded.add(j); }
    }
    nodeObbs.forEach(([id, r, b]) => {
      if (!bboxHit(L.labelAabb, r, CROWD)) return;
      const own = id === L.edge.sourceId || id === L.edge.destinationId;
      if (obbOverlap(L.label.box, b)) { labelNode++; if (own) labelOwnNode++; }
      else if (!own && obbOverlap(inflate(L.label.box, CROWD), b)) crowded.add(i);
    });
    drawn.forEach(D => {
      if (D === L || D.visible <= 0 || !bboxHit(L.labelAabb, D.bbox, CROWD)) return;
      const infl = inflate(L.label.box, CROWD);
      for (let s = 0; s < D.pts.length - 1; s++) {
        const p = D.pts[s], q = D.pts[s + 1];
        if (segHitsObb(p.x, p.y, q.x, q.y, L.label.box)) { labelEdge++; crowded.add(i); break; }
        if (segHitsObb(p.x, p.y, q.x, q.y, infl)) { crowded.add(i); break; }
      }
    });
  }

  // Legibility: how much of each name survives truncation.
  let fullChars = 0, shownChars = 0, truncated = 0;
  drawn.forEach(d => {
    if (!d.label) return;
    fullChars += d.label.fullChars;
    shownChars += d.label.shownChars;
    if (d.label.truncated) truncated++;
  });

  // ── Groups ───────────────────────────────────────────────────────────────
  const groups = c.groups || [];
  const anc = groupAncestry(groups, scene.childIdx);
  const memberSet = new Map(groups.map(g => [g.id, new Set(g.memberInstanceIds || [])]));
  const insideGroup = (gid, nodeId) => {
    if (memberSet.get(gid)?.has(nodeId)) return true;
    // An empty node-group's placeholder body is its own content.
    const ph = groupIdFromPlaceholderId(nodeId);
    if (ph && (ph === gid || anc.get(ph)?.has(gid))) return true;
    if (scene.anchorOf.get(nodeId) === gid) return true;
    // A descendant group's anchor belongs inside its ancestors too.
    const ownG = scene.anchorOf.get(nodeId);
    return !!(ownG && anc.get(ownG)?.has(gid));
  };
  let groupOverlaps = 0;
  let minGroupGap = Infinity;
  const gids = [...groupRect.keys()];
  for (let i = 0; i < gids.length; i++) {
    for (let j = i + 1; j < gids.length; j++) {
      const a = gids[i], b = gids[j];
      if (anc.get(a)?.has(b) || anc.get(b)?.has(a)) continue;
      const ra = groupRect.get(a), rb = groupRect.get(b);
      if (rectsOverlap(ra, rb)) groupOverlaps++;
      else minGroupGap = Math.min(minGroupGap, rectGap(ra, rb));
    }
  }
  let foreignInGroup = 0;
  let foreignLabelInGroup = 0;
  let edgeThroughGroup = 0;
  groupRect.forEach((gr, gid) => {
    const gb = aabbToObb(gr);
    nodeRect.forEach((r, id) => { if (!insideGroup(gid, id) && rectsOverlap(r, gr)) foreignInGroup++; });
    drawn.forEach(d => {
      const inS = insideGroup(gid, d.edge.sourceId), inD = insideGroup(gid, d.edge.destinationId);
      if (inS || inD) return; // a connection into or out of the group may cross its rim
      if (d.label?.box && bboxHit(d.labelAabb, gr) && obbOverlap(d.label.box, gb)) foreignLabelInGroup++;
      if (d.visible > 0 && bboxHit(d.bbox, gr)) {
        for (let s = 0; s < d.pts.length - 1; s++) {
          if (segHitsObb(d.pts[s].x, d.pts[s].y, d.pts[s + 1].x, d.pts[s + 1].y, gb)) { edgeThroughGroup++; break; }
        }
      }
    });
  });

  // ── Angular resolution ───────────────────────────────────────────────────
  const dirs = new Map();
  drawn.forEach(d => {
    const a = center.get(d.edge.sourceId), b = center.get(d.edge.destinationId);
    const push = (id, from, to) => { if (!dirs.has(id)) dirs.set(id, []); dirs.get(id).push(Math.atan2(to.y - from.y, to.x - from.x)); };
    push(d.edge.sourceId, a, b); push(d.edge.destinationId, b, a);
  });
  let angRes = 0, angN = 0;
  dirs.forEach(list => {
    if (list.length < 2) return;
    list.sort((x, y) => x - y);
    let minGap = Infinity;
    for (let i = 0; i < list.length; i++) {
      const next = i + 1 < list.length ? list[i + 1] : list[0] + 2 * Math.PI;
      minGap = Math.min(minGap, next - list[i]);
    }
    angRes += Math.min(1, minGap / (2 * Math.PI / list.length));
    angN++;
  });

  // ── Edge-length uniformity (visible run, relative to what its label needs) ─
  const runs = drawn.filter(d => d.visible > 0).map(d => d.centerLen);
  const meanRun = runs.reduce((s, x) => s + x, 0) / Math.max(1, runs.length);
  const cv = runs.length > 1 ? Math.sqrt(runs.reduce((s, x) => s + (x - meanRun) ** 2, 0) / runs.length) / meanRun : 0;

  // ── Clusters: silhouette + Gestalt proximity ─────────────────────────────
  const clusters = deriveClusters(c, scene);
  const clusterIds = [...nodeRect.keys()].filter(id => clusters.has(id));
  const distinct = new Set(clusterIds.map(id => clusters.get(id)));
  let silhouette = null, proximityViolations = null, minClusterGapEm = null;
  if (distinct.size > 1 && clusterIds.length <= 1500) {
    const R = clusterIds.map(id => nodeRect.get(id));
    const L = clusterIds.map(id => clusters.get(id));
    const size = new Map();
    L.forEach(l => size.set(l, (size.get(l) || 0) + 1));
    let sSum = 0, sN = 0;
    proximityViolations = 0;
    let minGap = Infinity;
    for (let i = 0; i < R.length; i++) {
      const sums = new Map();
      let nearOwn = Infinity, nearForeign = Infinity;
      for (let j = 0; j < R.length; j++) {
        if (i === j) continue;
        const g = rectGap(R[i], R[j]);
        sums.set(L[j], (sums.get(L[j]) || 0) + g);
        if (L[j] === L[i]) nearOwn = Math.min(nearOwn, g); else nearForeign = Math.min(nearForeign, g);
      }
      minGap = Math.min(minGap, nearForeign);
      // A singleton has no own cluster to be nearer to; it can't violate proximity.
      if ((size.get(L[i]) || 0) >= 2 && nearForeign < nearOwn) proximityViolations++;
      if ((size.get(L[i]) || 0) < 2) continue; // silhouette undefined for singletons
      const a = sums.get(L[i]) / (size.get(L[i]) - 1);
      let b = Infinity;
      sums.forEach((v, l) => { if (l !== L[i]) b = Math.min(b, v / size.get(l)); });
      const s = (b - a) / Math.max(a, b, 1e-9);
      sSum += s; sN++;
    }
    silhouette = sN ? sSum / sN : null;
    minClusterGapEm = minGap / em;
  }

  // ── Compactness ──────────────────────────────────────────────────────────
  const all = [...nodeRect.values(), ...groupRect.values(), ...labels.map(l => l.labelAabb)];
  const bb = all.length ? all.reduce((acc, r) => ({
    minX: Math.min(acc.minX, r.minX), minY: Math.min(acc.minY, r.minY),
    maxX: Math.max(acc.maxX, r.maxX), maxY: Math.max(acc.maxY, r.maxY)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }) : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const inkArea = [...nodeRect.values()].reduce((s, r) => s + (r.maxX - r.minX) * (r.maxY - r.minY), 0)
    + labels.reduce((s, l) => s + 4 * l.label.box.hw * l.label.box.hh, 0);
  const drawingArea = Math.max(1, (bb.maxX - bb.minX) * (bb.maxY - bb.minY));
  const aspect = (bb.maxX - bb.minX) / Math.max(1, bb.maxY - bb.minY);

  return {
    n: nNodes, m, labels: nLabels, groups: groupRect.size,
    nodeOverlaps, edgeThroughNode, crossings,
    crossingSin: crossings ? sinSum / crossings : null,
    labelLabel, labelNode, labelOwnNode, labelEdge, labelCrowded: crowded.size,
    labelCharsShown: fullChars ? shownChars / fullChars : null, labelsTruncated: truncated,
    groupOverlaps, minGroupGapEm: Number.isFinite(minGroupGap) ? minGroupGap / em : null,
    foreignInGroup, foreignLabelInGroup, edgeThroughGroup,
    angularResolution: angN ? angRes / angN : null,
    edgeLengthCV: cv,
    stress: normalizedStress(c, scene),
    silhouette, proximityViolations, minClusterGapEm,
    inkDensity: inkArea / drawingArea, aspect
  };
}

// ============================================================================
// THE GRADE
// ============================================================================

/**
 * Weights, fixed BEFORE any tuning (pre-registered — changing them to make a
 * change look better is not allowed; add a new criterion instead). Hard
 * violations are what the user asked the layout never to do; they carry the
 * most weight and are scored as a rate so a graph's size doesn't decide it.
 */
export const SCORER_VERSION = 2; // v2: anchor→own-member connections leave from the title tab, not the shell

export const WEIGHTS = {
  // hard — "never"
  nodeOverlap: 3, labelLabel: 3, labelNode: 3, labelEdge: 3,
  groupOverlap: 3, foreignInGroup: 3, edgeThroughNode: 2,
  // soft — readability
  labelLegibility: 2, labelCrowding: 2, crossings: 2, clusterSeparation: 2,
  // Compactness is 3, not 1: labels are a fixed world size, so a layout that
  // clears every conflict by inflating itself only moves the problem to zoom —
  // v0 let a 92,000px circle outscore every real layout (see README, calibration).
  compactness: 3,
  edgeThroughGroup: 1, stress: 1,
  crossingAngle: 0.5, angularResolution: 0.5, edgeUniformity: 0.5
};

/** Rate → score: 0 violations = 1; one violation per 10 opportunities ≈ 0.5. */
const rateScore = (count, opportunities) => 1 / (1 + 10 * count / Math.max(1, opportunities));
const FLOOR = 0.02; // keeps the geometric mean finite; a zero would erase every other signal

/** Every sub-score in [0, 1]; null = not applicable to this graph. */
export function subScores(r) {
  const s = {
    nodeOverlap: rateScore(r.nodeOverlaps, r.n),
    edgeThroughNode: r.m ? rateScore(r.edgeThroughNode, r.m) : null,
    labelLabel: r.labels ? rateScore(r.labelLabel, r.labels) : null,
    labelNode: r.labels ? rateScore(r.labelNode, r.labels) : null,
    labelEdge: r.labels ? rateScore(r.labelEdge, r.labels) : null,
    groupOverlap: r.groups > 1 ? rateScore(r.groupOverlaps, r.groups) : null,
    foreignInGroup: r.groups ? rateScore(r.foreignInGroup, r.n) : null,
    labelLegibility: r.labelCharsShown,
    labelCrowding: r.labels ? 1 - r.labelCrowded / r.labels : null,
    // Crossings per connection, not Purchase's c/c_max: c_max grows as m², so on
    // any real-sized graph the ratio sits at 0.99+ and can't tell layouts apart.
    crossings: r.m > 1 ? 1 / (1 + r.crossings / r.m) : null,
    crossingAngle: r.crossingSin,
    angularResolution: r.angularResolution,
    edgeUniformity: r.m > 1 ? 1 / (1 + r.edgeLengthCV) : null,
    stress: r.stress === null ? null : 1 - r.stress,
    clusterSeparation: r.silhouette === null ? null
      : 0.5 * ((r.silhouette + 1) / 2) + 0.5 * (1 - r.proximityViolations / Math.max(1, r.n)),
    edgeThroughGroup: r.groups ? rateScore(r.edgeThroughGroup, Math.max(1, r.m)) : null,
    // Ink density of ~0.10 is a well-filled node-link diagram; below it the
    // drawing is mostly empty canvas the reader has to zoom out across.
    compactness: Math.min(1, r.inkDensity / 0.10)
  };
  return s;
}

export function grade(r) {
  const s = subScores(r);
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    const v = s[k];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    num += w * Math.log(Math.max(FLOOR, Math.min(1, v)));
    den += w;
  }
  return { grade: den ? 100 * Math.exp(num / den) : 100, sub: s };
}

// ============================================================================
// DEBUG RENDER
// ============================================================================

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** An SVG of the scene as graded — for checking the scorer against the eye. */
export function renderSvg(c, positions, opts = {}) {
  const scene = buildScene(c, positions, opts);
  const all = [...scene.nodeRect.values(), ...scene.groupRect.values(), ...scene.drawn.filter(d => d.labelAabb).map(d => d.labelAabb)];
  const minX = Math.min(...all.map(r => r.minX)) - 100, minY = Math.min(...all.map(r => r.minY)) - 100;
  const maxX = Math.max(...all.map(r => r.maxX)) + 100, maxY = Math.max(...all.map(r => r.maxY)) + 100;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="1600" height="${Math.round(1600 * (maxY - minY) / (maxX - minX))}"><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#bdb5b5"/>`];
  scene.groupLayouts.forEach((gl, gid) => {
    const vb = gl.visualBounds;
    out.push(`<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" rx="24" fill="#8B000022" stroke="#8B0000" stroke-width="4"/>`);
    out.push(`<text x="${gl.label.x + 10}" y="${gl.label.y + gl.label.h * 0.7}" font-size="40" fill="#260000">${esc(scene.groupsById.get(gid)?.name || gid)}</text>`);
  });
  scene.drawn.forEach(d => {
    const pts = d.pts.map(p => `${p.x},${p.y}`).join(' ');
    out.push(`<polyline points="${pts}" fill="none" stroke="#000" stroke-width="6"/>`);
  });
  scene.nodeRect.forEach((r, id) => {
    const n = scene.byId.get(id);
    out.push(`<rect x="${r.minX}" y="${r.minY}" width="${r.maxX - r.minX}" height="${r.maxY - r.minY}" rx="30" fill="#800000"/>`);
    out.push(`<text x="${r.minX + 20}" y="${(r.minY + r.maxY) / 2 + 14}" font-size="40" fill="#fff">${esc((n?.name || id).slice(0, 30))}</text>`);
  });
  scene.drawn.forEach(d => {
    const L = d.label?.box;
    if (!L) return;
    let ang = Math.atan2(L.uy, L.ux) * 180 / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    out.push(`<g transform="translate(${L.cx} ${L.cy}) rotate(${ang})"><rect x="${-L.hw}" y="${-L.hh}" width="${2 * L.hw}" height="${2 * L.hh}" fill="#bdb5b5" stroke="#00f" stroke-width="2"/><text text-anchor="middle" y="${L.hh * 0.45}" font-size="${scene.fontSize * 0.8}" fill="#000">${esc(d.label.truncated ? d.edge.name.slice(0, d.label.shownChars) + '…' : d.edge.name)}</text></g>`);
  });
  out.push('</svg>');
  return out.join('\n');
}
