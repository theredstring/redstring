/**
 * LABEL-AWARE LAYOUT REPAIR
 *
 * The last pass every straight-routed layout goes through: a deterministic
 * local search that moves individual nodes, a little, until the DRAWN scene
 * stops colliding with itself.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every solver upstream reserves room for a connection's label ALONG its own
 * line (requiredEdgeLength), and separates node boxes. None of them ever look
 * at the label as the thing it is on screen: a box one line of text tall,
 * rotated to its connection, sitting at the midpoint of the part of the line
 * that is visible between the two node borders, and cut to 85% of that run
 * with an ellipsis. So nothing stops a label from being drawn on top of a
 * neighbouring node, across another label, or with a third connection running
 * straight through its text — and on the layout bench (test/layout-bench)
 * those three were the three worst scores the default layout had.
 *
 * A force can't fix this reliably: the conflicts are between derived objects
 * (labels depend on BOTH endpoints), they only exist once the layout has
 * settled, and a force fades out with the temperature exactly when they
 * appear. So this is a projection-style finisher, like pathClearance, but its
 * objective is the drawing: it scores the scene, and accepts a move only if
 * the score goes down.
 *
 * THE OBJECTIVE
 * ─────────────
 * A weighted sum of conflicts, each scored as (1 + depth/em) so a partial
 * improvement is still an improvement and the search has a slope to follow:
 *
 *   node on node · line through a node · label on label · label on a node ·
 *   line through a label · member leaving its group's shell · foreign node in
 *   a group's shell · connections crossing · text lost to truncation
 *
 * plus a displacement cost, so the solver's structure — a tidy tree's rows, a
 * cycle's ring — survives: a node moves only when the move buys more clarity
 * than it costs in disturbance. Weights are ordered by the readability
 * literature the bench grades against (occlusion and label overlap first,
 * Dunne & Shneiderman 2009, Kakoulis & Tollis 2003; crossings next, Purchase
 * 2002).
 *
 * THE SEARCH
 * ──────────
 * Greedy, first-improvement-per-node hill climbing over a fixed candidate set
 * (8 compass directions × 4 step lengths, plus the exact escape vector of each
 * conflict the node is in). A move's cost is evaluated incrementally — only
 * the node's own box and its incident connections and labels change — so a
 * round is O(conflicted nodes × candidates × (n + m)). Deterministic: node
 * order is by conflict cost then id, and ties keep the first candidate.
 *
 * ALL POSITIONS HERE ARE CENTRES. `repairLayout` converts at the boundary.
 */

import { computeGroupLayout, buildGroupsByMemberIdIndex, buildChildGroupIdsIndex, groupIdFromPlaceholderId } from './groupLayout.js';
import { estimateEdgeLabelWidth, EDGE_LABEL_BASE_FONT_SIZE } from './layoutGeometry.js';

// Must track src/utils/canvas/edgeLabelPlacement.js LABEL_TRUNCATE_FILL.
const LABEL_FILL = 0.85;
// Label box height the renderer registers (connectionFontSize * 1.1).
const LABEL_HEIGHT_EM = 1.1;
// Parallel connections bow apart by this much per lane; the label rides the
// quadratic's apex, which is half the control offset (parallelEdgeUtils).
const PARALLEL_SPACING = 200;

export const REPAIR_DEFAULTS = {
  // Conflict weights. Node-on-node and group intrusions are the two things a
  // layout must never do, so they are priced above any bundle of label
  // conflicts a single move could clear — otherwise the search happily buys
  // three clean labels with one node parked inside a foreign group.
  wNodeNode: 200,
  // Inside the breathing-room margin but not touching: a preference, not a rule.
  wNodeNear: 4,
  // A line drawn through a node it doesn't connect is a hard fault (the force
  // tests hold every layout to zero of them); merely passing close is not.
  wEdgeNode: 60,
  wEdgeNear: 4,
  wLabelLabel: 8,
  wLabelNode: 8,
  wLabelEdge: 6,
  wGroup: 200,
  // A member stepping past its group's current member box grows the shell.
  // Mild in itself; the grown rim landing on something is priced at wGroup.
  wFence: 8,
  // A connection between two things outside a group, drawn across it. Capped
  // at one em of depth: a shell is big, and how deep a line cuts through it
  // matters much less than whether it does.
  wGroupEdge: 4,
  wCrossing: 1.5,
  wTruncation: 6,
  // Every solver upstream guarantees a labelled connection is at least as long
  // (centre to centre) as its label. Where that held when the repair started,
  // it must still hold when it ends; where it didn't, shortening further is
  // merely discouraged.
  wLabelFit: 60,
  wLabelFitSoft: 6,
  // Cost per em of distance moved from where the solver put a node.
  wDisplacement: 0.35,
  // Breathing room, in em of the connection-label font.
  labelPadEm: 0.3,
  nodePadEm: 0.4,
  edgePadEm: 0.25,
  maxRounds: 24,
  // Work cap, in element-pair tests. The search is anytime: stopping early
  // keeps every move made so far, each of which strictly improved the scene.
  // A count, not a clock, so a layout comes out the same on every machine —
  // ~0.4s here, and small graphs finish long before it binds.
  maxWork: 1.5e7
};

// ============================================================================
// GEOMETRY
// ============================================================================

/** Clip parameter range of P0→P1 inside an axis-aligned box, or null. */
function clipRange(x0, y0, x1, y1, minX, minY, maxX, maxY) {
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
}

/**
 * Penetration of a segment into an oriented box (inflated by pad), measured
 * along the segment's normal — the box's support minus its distance from the
 * line. 0 when clear.
 */
function segBoxDepth(ax, ay, bx, by, box, pad) {
  let ux = bx - ax, uy = by - ay;
  const len = Math.hypot(ux, uy);
  if (len < 1e-9) return 0;
  ux /= len; uy /= len;
  const nx = -uy, ny = ux;
  const cx = box.cx - ax, cy = box.cy - ay;
  // Box support along n and u, in world axes, for a box with axis (bux, buy).
  const bnx = -box.uy, bny = box.ux;
  const hw = box.hw + pad, hh = box.hh + pad;
  const supN = hw * Math.abs(box.ux * nx + box.uy * ny) + hh * Math.abs(bnx * nx + bny * ny);
  const s = nx * cx + ny * cy;
  const depth = supN - Math.abs(s);
  if (depth <= 0) return 0;
  const supU = hw * Math.abs(box.ux * ux + box.uy * uy) + hh * Math.abs(bnx * ux + bny * uy);
  const t = ux * cx + uy * cy;
  if (t + supU <= 0 || t - supU >= len) return 0;
  return depth;
}

/** SAT penetration depth of two oriented boxes (inflated by pad), 0 if clear. */
function boxBoxDepth(A, B, pad) {
  const dx = B.cx - A.cx, dy = B.cy - A.cy;
  let best = Infinity;
  const axes = [A.ux, A.uy, -A.uy, A.ux, B.ux, B.uy, -B.uy, B.ux];
  for (let i = 0; i < 8; i += 2) {
    const ax = axes[i], ay = axes[i + 1];
    const rA = A.hw * Math.abs(A.ux * ax + A.uy * ay) + A.hh * Math.abs(-A.uy * ax + A.ux * ay);
    const rB = B.hw * Math.abs(B.ux * ax + B.uy * ay) + B.hh * Math.abs(-B.uy * ax + B.ux * ay);
    const o = rA + rB + pad - Math.abs(dx * ax + dy * ay);
    if (o <= 0) return 0;
    if (o < best) best = o;
  }
  return best;
}

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function segsCross(a, b) {
  const d1 = orient(b.x0, b.y0, b.x1, b.y1, a.x0, a.y0);
  const d2 = orient(b.x0, b.y0, b.x1, b.y1, a.x1, a.y1);
  const d3 = orient(a.x0, a.y0, a.x1, a.y1, b.x0, b.y0);
  const d4 = orient(a.x0, a.y0, a.x1, a.y1, b.x1, b.y1);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4;
}

const aabbHit = (a, b, m) =>
  a.minX - m < b.maxX && b.minX - m < a.maxX && a.minY - m < b.maxY && b.minY - m < a.maxY;

// ============================================================================
// THE SCENE
// ============================================================================

/**
 * Everything the search needs, built once. Geometry that depends on node
 * positions (segments, labels) is recomputed per edge on demand.
 */
function buildModel(nodes, edges, centers, groups, cfg) {
  const em = cfg.edgeLabelFontSize || EDGE_LABEL_BASE_FONT_SIZE;
  const byId = new Map(nodes.map(n => [n.id, n]));

  // ── Groups → fences ───────────────────────────────────────────────────────
  // Shells are measured once, with the renderer's own rule, and then held
  // fixed: members may move only inside their innermost group's member box
  // (so no shell ever grows), and nothing else may enter a shell.
  const groupsById = new Map((groups || []).map(g => [g.id, g]));
  const anchorOf = new Map();
  (groups || []).forEach(g => { if (g.linkedNodePrototypeId && g.anchorInstanceId) anchorOf.set(g.anchorInstanceId, g.id); });
  const shells = new Map();
  const contentBox = new Map();
  let measureLive = null;
  if (groupsById.size) {
    const groupsByMemberId = buildGroupsByMemberIdIndex(groupsById);
    const childIdx = buildChildGroupIdsIndex(groupsById, groupsByMemberId);
    // The renderer draws a node-group's anchor AS its title tab, and parents
    // measure their shells around that tab — so sync each anchor to its tab
    // and re-measure until nesting settles, exactly as the canvas does. Fences
    // measured with the anchor where the solver left it disagree with the
    // drawn shells by up to a tab's height.
    const measure = () => {
      const nodesById = new Map();
      const dimsById = new Map();
      centers.forEach((c, id) => {
        const n = byId.get(id);
        if (!n) return;
        nodesById.set(id, { id, x: c.x - n.width / 2, y: c.y - n.height / 2 });
        dimsById.set(id, { currentWidth: n.width, currentHeight: n.height });
      });
      const ctx = {
        nodesById, dimsById, groupsById, groupsByMemberId, childGroupIdsByGroupId: childIdx,
        gridSize: cfg.gridSize ?? 200,
        measureLabelWidth: (t) => estimateEdgeLabelWidth(t || 'Group', cfg.groupLabelFontSize ?? 45),
        labelFontSize: cfg.groupLabelFontSize ?? 45, labelScale: cfg.groupLabelScale ?? 1,
        _cache: new Map(), _visiting: new Set()
      };
      const out = new Map();
      groupsById.forEach(g => { const r = computeGroupLayout(g, ctx); if (r?.ok) out.set(g.id, r); });
      return out;
    };
    measureLive = measure;
    let layouts = measure();
    for (let round = 0; round < 3 && anchorOf.size; round++) {
      anchorOf.forEach((gid, aid) => {
        const r = layouts.get(gid);
        if (r && centers.has(aid)) centers.set(aid, { x: r.label.x + r.label.w / 2, y: r.label.y + r.label.h / 2 });
      });
      layouts = measure();
    }
    layouts.forEach((r, gid) => {
      const vb = r.visualBounds;
      shells.set(gid, { minX: vb.x, minY: vb.y, maxX: vb.x + vb.w, maxY: vb.y + vb.h });
      contentBox.set(gid, r.bbox);
    });
  }
  const hidden = (id) => anchorOf.has(id) && shells.has(anchorOf.get(id));

  // Innermost group per node (smallest member set), and every group it sits
  // inside (including via a descendant group's anchor).
  const memberOf = new Map();
  const join = (id, gid) => {
    if (!memberOf.has(id)) memberOf.set(id, new Set());
    memberOf.get(id).add(gid);
  };
  (groups || []).forEach(g => (g.memberInstanceIds || []).forEach(id => join(id, g.id)));
  // An empty node-group's held-open body (withEmptyGroupPlaceholders) is that
  // group's content, even though no member list names it.
  centers.forEach((_, id) => {
    const gid = groupIdFromPlaceholderId(id);
    if (gid && groupsById.has(gid)) join(id, gid);
  });
  // Where each member may go: inside the member box of EVERY group it belongs
  // to. Fencing only to the smallest one lets a node that sits in two peer
  // groups walk out of the other one and grow its shell over a neighbour.
  const fence = new Map();
  memberOf.forEach((gids, id) => {
    let f = null;
    gids.forEach(gid => {
      const cb = contentBox.get(gid);
      if (!cb) return;
      f = f ? { minX: Math.max(f.minX, cb.minX), minY: Math.max(f.minY, cb.minY), maxX: Math.min(f.maxX, cb.maxX), maxY: Math.min(f.maxY, cb.maxY) } : { ...cb };
    });
    if (f) fence.set(id, f);
  });
  const belongsIn = (id, gid) => memberOf.get(id)?.has(gid) || anchorOf.get(id) === gid;

  // ── Nodes that move and collide ───────────────────────────────────────────
  const visible = nodes.filter(n => centers.has(n.id) && !hidden(n.id));
  const idx = new Map(visible.map((n, i) => [n.id, i]));

  // ── Connections ───────────────────────────────────────────────────────────
  const pairKey = (e) => (e.sourceId < e.destinationId ? `${e.sourceId}|${e.destinationId}` : `${e.destinationId}|${e.sourceId}`);
  const pairTotals = new Map();
  edges.forEach(e => pairTotals.set(pairKey(e), (pairTotals.get(pairKey(e)) || 0) + 1));
  const seen = new Map();
  const conns = [];
  edges.forEach(e => {
    if (e.sourceId === e.destinationId || !centers.has(e.sourceId) || !centers.has(e.destinationId)) return;
    const k = pairKey(e);
    const lane = seen.get(k) || 0;
    seen.set(k, lane + 1);
    const total = pairTotals.get(k);
    conns.push({
      e,
      s: e.sourceId, d: e.destinationId,
      name: e.name || '',
      fullW: e.name ? estimateEdgeLabelWidth(e.name, em) : 0,
      laneOffset: total > 1 ? (lane - (total - 1) / 2) * PARALLEL_SPACING / 2 * (e.sourceId < e.destinationId ? 1 : -1) : 0
    });
  });
  const incident = new Map();
  conns.forEach((c, i) => {
    [c.s, c.d].forEach(id => { if (!incident.has(id)) incident.set(id, []); incident.get(id).push(i); });
  });

  // Two groups where one sits inside the other (by shell) may touch.
  const nested = (a, b) => {
    const A = shells.get(a), B = shells.get(b);
    if (!A || !B) return false;
    const inside = (x, y) => x.minX >= y.minX && x.maxX <= y.maxX && x.minY >= y.minY && x.maxY <= y.maxY;
    return inside(A, B) || inside(B, A);
  };
  // The drawn shell of each group, re-measured at the CURRENT positions with
  // the renderer's own rule — for when a member has stepped past its box and
  // the shells it sits in (and, through nesting, their parents) have grown.
  const liveShells = () => {
    const out = new Map();
    if (!measureLive) return out;
    measureLive().forEach((r, gid) => {
      const vb = r.visualBounds;
      out.set(gid, { minX: vb.x, minY: vb.y, maxX: vb.x + vb.w, maxY: vb.y + vb.h });
    });
    return out;
  };
  return { em, byId, visible, idx, conns, incident, shells, contentBox, fence, belongsIn, hidden, anchorOf, memberOf, nested, liveShells };
}

/**
 * The box a connection visibly leaves from: the node, or — for a node-group's
 * anchor — the group's whole shell, but only toward something OUTSIDE the
 * group. A connection from the title to one of the group's own members
 * starts inside that shell, so it leaves from the title tab.
 */
function exitBox(model, centers, id, otherId) {
  if (model.hidden(id)) {
    const gid = model.anchorOf.get(id);
    if (!model.belongsIn(otherId, gid)) return model.shells.get(gid);
  }
  const n = model.byId.get(id);
  const c = centers.get(id);
  return { minX: c.x - n.width / 2, minY: c.y - n.height / 2, maxX: c.x + n.width / 2, maxY: c.y + n.height / 2 };
}

/** Drawn segment + label of one connection at the current centres. */
function connGeometry(model, centers, conn) {
  const a = centers.get(conn.s), b = centers.get(conn.d);
  const ba = exitBox(model, centers, conn.s, conn.d), bb = exitBox(model, centers, conn.d, conn.s);
  const ca = clipRange(a.x, a.y, b.x, b.y, ba.minX, ba.minY, ba.maxX, ba.maxY);
  const cb = clipRange(a.x, a.y, b.x, b.y, bb.minX, bb.minY, bb.maxX, bb.maxY);
  const t0 = ca ? ca[1] : 0, t1 = cb ? cb[0] : 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const run = Math.max(0, (t1 - t0) * len);
  const seg = { x0: a.x + dx * t0, y0: a.y + dy * t0, x1: a.x + dx * t1, y1: a.y + dy * t1, run };
  seg.minX = Math.min(seg.x0, seg.x1); seg.maxX = Math.max(seg.x0, seg.x1);
  seg.minY = Math.min(seg.y0, seg.y1); seg.maxY = Math.max(seg.y0, seg.y1);
  let label = null;
  let lost = 0;
  if (conn.fullW > 0) {
    if (run <= 0) {
      lost = 1;
    } else {
      const w = Math.min(conn.fullW, run * LABEL_FILL);
      lost = conn.fullW > 0 ? Math.max(0, 1 - w / conn.fullW) : 0;
      const mx = (seg.x0 + seg.x1) / 2 - uy * conn.laneOffset;
      const my = (seg.y0 + seg.y1) / 2 + ux * conn.laneOffset;
      const hw = w / 2, hh = model.em * LABEL_HEIGHT_EM / 2;
      const ex = Math.abs(ux) * hw + Math.abs(uy) * hh, ey = Math.abs(uy) * hw + Math.abs(ux) * hh;
      label = { cx: mx, cy: my, ux, uy, hw, hh, minX: mx - ex, maxX: mx + ex, minY: my - ey, maxY: my + ey };
    }
  }
  return { seg, label, lost, span: len };
}

function nodeBoxAt(model, centers, id) {
  const n = model.byId.get(id);
  const c = centers.get(id);
  const hw = n.width / 2, hh = n.height / 2;
  return { cx: c.x, cy: c.y, ux: 1, uy: 0, hw, hh, minX: c.x - hw, maxX: c.x + hw, minY: c.y - hh, maxY: c.y + hh, id };
}

// ============================================================================
// COST
// ============================================================================

/**
 * Cost of every conflict involving a set of "dirty" elements, each pair
 * counted once. Elements: node boxes (by id) and connections (by index).
 */
function localCost(model, cfg, state, dirtyNodes, dirtyConns, sink = null, split = null) {
  const { em } = model;
  model.work += (dirtyNodes.size + dirtyConns.size) * (model.conns.length + model.visible.length);
  const labelPad = cfg.labelPadEm * em, nodePad = cfg.nodePadEm * em, edgePad = cfg.edgePadEm * em;
  const reach = Math.max(labelPad, nodePad, edgePad);
  const depthCost = (w, depth) => w * (1 + depth / em);
  // With a sink, every term is also recorded — see explainScene.
  // Hard terms are also totalled on their own: the search never accepts a
  // move that makes them worse, whatever it buys elsewhere (see HARD).
  let hard = 0;
  const note = (v, what) => {
    if (HARD.has(what)) hard += v;
    if (sink && v > 0) sink.push({ what, cost: +v.toFixed(2) });
    return v;
  };
  // depth includes the margin; past it the line is inside the box.
  const edgeNodeCost = (dp) => (dp > edgePad
    ? note(depthCost(cfg.wEdgeNode, dp - edgePad), 'line through node')
    : note(depthCost(cfg.wEdgeNear, dp), 'line near node'));
  let cost = 0;

  const dirtyNodeSet = dirtyNodes;
  const dirtyConnSet = dirtyConns;

  // Node boxes.
  dirtyNodeSet.forEach(id => {
    const A = state.boxes.get(id);
    if (!A) return;
    model.visible.forEach(n => {
      if (n.id === id) return;
      if (dirtyNodeSet.has(n.id) && n.id < id) return;
      const B = state.boxes.get(n.id);
      if (!aabbHit(A, B, nodePad)) return;
      const ox = A.hw + B.hw + nodePad - Math.abs(A.cx - B.cx);
      const oy = A.hh + B.hh + nodePad - Math.abs(A.cy - B.cy);
      if (ox > 0 && oy > 0) {
        const touching = ox > nodePad && oy > nodePad;
        cost += touching
          ? note(depthCost(cfg.wNodeNode, Math.min(ox, oy) - nodePad), 'node on node')
          : note(depthCost(cfg.wNodeNear, Math.min(ox, oy)), 'node near node');
      }
    });
    // Groups: stay inside your innermost group's member box; stay out of
    // every shell you don't belong to.
    // Past a group's member box, a member drags that group's rim with it — and
    // through nesting, its parents' rims too. Stepping out is only a mild cost
    // in itself; what is hard is a grown shell landing on anything that isn't
    // in it. So when it happens, re-measure the shells exactly.
    let grew = false;
    (model.memberOf.get(id) || []).forEach(gid => {
      const cb = model.contentBox.get(gid);
      if (!cb) return;
      const out = Math.max(0, cb.minX - A.minX, A.maxX - cb.maxX, cb.minY - A.minY, A.maxY - cb.maxY);
      if (out <= 0.5) return;
      cost += note(depthCost(cfg.wFence, out), 'member outside its group box');
      grew = true;
    });
    if (grew) {
      const live = model.liveShells();
      (model.memberOf.get(id) || []).forEach(gid => {
        const now = live.get(gid), was = model.shells.get(gid);
        if (!now || !was) return;
        if (now.minX >= was.minX && now.minY >= was.minY && now.maxX <= was.maxX && now.maxY <= was.maxY) return;
        model.visible.forEach(n => {
          if (model.belongsIn(n.id, gid)) return;
          const B = state.boxes.get(n.id);
          const ox = Math.min(now.maxX, B.maxX) - Math.max(now.minX, B.minX);
          const oy = Math.min(now.maxY, B.maxY) - Math.max(now.minY, B.minY);
          if (ox > 0 && oy > 0) cost += note(depthCost(cfg.wGroup, Math.min(ox, oy)), 'group intrusion');
        });
        live.forEach((sh, other) => {
          if (other === gid || model.nested(other, gid)) return;
          const ox = Math.min(now.maxX, sh.maxX) - Math.max(now.minX, sh.minX);
          const oy = Math.min(now.maxY, sh.maxY) - Math.max(now.minY, sh.minY);
          if (ox > 0 && oy > 0) cost += note(depthCost(cfg.wGroup, Math.min(ox, oy)), 'group intrusion');
        });
      });
    }
    // And the node itself stays out of every shell it doesn't belong to.
    model.shells.forEach((sh, gid) => {
      if (model.belongsIn(id, gid) || !aabbHit(A, sh, 0)) return;
      const ox = Math.min(A.maxX, sh.maxX) - Math.max(A.minX, sh.minX);
      const oy = Math.min(A.maxY, sh.maxY) - Math.max(A.minY, sh.minY);
      if (ox > 0 && oy > 0) cost += note(depthCost(cfg.wGroup, Math.min(ox, oy)), 'group intrusion');
    });
  });

  // Connections: their line and their label against everything.
  const touchesConn = (ci, conn) => conn.s === model.conns[ci].s || conn.s === model.conns[ci].d ||
    conn.d === model.conns[ci].s || conn.d === model.conns[ci].d;

  dirtyConnSet.forEach(ci => {
    const conn = model.conns[ci];
    const g = state.geo[ci];
    const seg = g.seg;
    cost += note(cfg.wTruncation * g.lost, 'label truncated');
    if (conn.fullW > 0 && g.span < conn.fullW) {
      cost += conn.fitAtStart
        ? note(depthCost(cfg.wLabelFit, conn.fullW - g.span), 'label no longer fits its line')
        : note(depthCost(cfg.wLabelFitSoft, conn.fullW - g.span), 'label longer than its line');
    }

    // Line across a group shell neither end belongs to.
    if (seg.run > 0) {
      model.shells.forEach((sh, gid) => {
        if (model.belongsIn(conn.s, gid) || model.belongsIn(conn.d, gid) || !aabbHit(seg, sh, 0)) return;
        const box = { cx: (sh.minX + sh.maxX) / 2, cy: (sh.minY + sh.maxY) / 2, ux: 1, uy: 0, hw: (sh.maxX - sh.minX) / 2, hh: (sh.maxY - sh.minY) / 2 };
        const dp = segBoxDepth(seg.x0, seg.y0, seg.x1, seg.y1, box, 0);
        if (dp > 0) cost += note(depthCost(cfg.wGroupEdge, Math.min(dp, em)), 'line across a foreign group');
      });
    }

    // Line through a node it doesn't connect (dirty nodes vs clean lines are
    // picked up below, from the node's side).
    if (seg.run > 0) {
      model.visible.forEach(n => {
        if (n.id === conn.s || n.id === conn.d) return;
        const B = state.boxes.get(n.id);
        if (!aabbHit(seg, B, edgePad)) return;
        const dp = segBoxDepth(seg.x0, seg.y0, seg.x1, seg.y1, B, edgePad);
        if (dp > 0) cost += edgeNodeCost(dp);
      });
    }

    for (let cj = 0; cj < model.conns.length; cj++) {
      if (cj === ci) continue;
      const dirtyJ = dirtyConnSet.has(cj);
      if (dirtyJ && cj < ci) continue; // each dirty pair once
      const other = model.conns[cj];
      const h = state.geo[cj];
      const shared = touchesConn(ci, other);
      // Crossings (lines that share an endpoint meet at it, not across).
      if (!shared && seg.run > 0 && h.seg.run > 0 && aabbHit(seg, h.seg, 0) && segsCross(seg, h.seg)) cost += note(cfg.wCrossing, 'crossing');
      // Label on label.
      if (g.label && h.label && aabbHit(g.label, h.label, labelPad)) {
        const dp = boxBoxDepth(g.label, h.label, labelPad);
        if (dp > 0) cost += note(depthCost(cfg.wLabelLabel, dp), 'label on label');
      }
      // This line through that label, and that line through this label.
      if (h.label && seg.run > 0 && aabbHit(seg, h.label, labelPad)) {
        const dp = segBoxDepth(seg.x0, seg.y0, seg.x1, seg.y1, h.label, labelPad);
        if (dp > 0) cost += note(depthCost(cfg.wLabelEdge, dp), 'line through label');
      }
      if (g.label && h.seg.run > 0 && aabbHit(h.seg, g.label, labelPad)) {
        const dp = segBoxDepth(h.seg.x0, h.seg.y0, h.seg.x1, h.seg.y1, g.label, labelPad);
        if (dp > 0) cost += note(depthCost(cfg.wLabelEdge, dp), 'line through label');
      }
    }

    // Label on a node (its own endpoints included: text on a node is text on
    // a node, whichever connection it names).
    if (g.label) {
      model.visible.forEach(n => {
        const B = state.boxes.get(n.id);
        const own = n.id === conn.s || n.id === conn.d;
        const pad = own ? 0 : labelPad;
        if (!aabbHit(g.label, B, pad)) return;
        const dp = boxBoxDepth(g.label, B, pad);
        if (dp > 0) cost += note(depthCost(cfg.wLabelNode, dp), 'label on node');
      });
    }
  });

  // Dirty node boxes vs CLEAN connections: lines through them, labels on them.
  dirtyNodeSet.forEach(id => {
    const B = state.boxes.get(id);
    if (!B) return;
    for (let cj = 0; cj < model.conns.length; cj++) {
      if (dirtyConnSet.has(cj)) continue;
      const conn = model.conns[cj];
      const h = state.geo[cj];
      if (conn.s !== id && conn.d !== id && h.seg.run > 0 && aabbHit(h.seg, B, edgePad)) {
        const dp = segBoxDepth(h.seg.x0, h.seg.y0, h.seg.x1, h.seg.y1, B, edgePad);
        if (dp > 0) cost += edgeNodeCost(dp);
      }
      if (h.label) {
        const own = conn.s === id || conn.d === id;
        const pad = own ? 0 : labelPad;
        if (aabbHit(h.label, B, pad)) {
          const dp = boxBoxDepth(h.label, B, pad);
          if (dp > 0) cost += note(depthCost(cfg.wLabelNode, dp), 'label on node');
        }
      }
    }
  });

  if (split) split.hard = hard;
  return cost;
}

/**
 * Every conflict the repair still sees in a laid-out scene, largest first —
 * for debugging the layout, and for checking the repair's model of the drawing
 * against an independent one (test/layout-bench).
 */
export function explainScene(positions, nodes, edges, options = {}) {
  const cfg = { ...REPAIR_DEFAULTS, ...(options.repair || {}), edgeLabelFontSize: options.edgeLabelFontSize,
    groupLabelFontSize: options.groupLabelFontSize, groupLabelScale: options.groupLabelScale, gridSize: options.gridSize };
  const sized = nodes.filter(n => positions.has(n.id)).map(n => ({ id: n.id, width: Math.max(1, n.width || 0), height: Math.max(1, n.height || 0) }));
  const centers = new Map(sized.map(n => { const p = positions.get(n.id); return [n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 }]; }));
  const model = buildModel(sized, edges, centers, options.groups || [], cfg);
  model.work = 0;
  const state = makeState(model, centers);
  const sink = [];
  localCost(model, cfg, state, new Set(model.visible.map(n => n.id)), new Set(model.conns.map((_, i) => i)), sink);
  return sink.sort((a, b) => b.cost - a.cost);
}

/** What moving one node dirties: itself, its connections, and any label on those. */
function dirtyFor(model, id) {
  const nodes = new Set();
  if (!model.hidden(id)) nodes.add(id);
  return { nodes, conns: new Set(model.incident.get(id) || []) };
}

function makeState(model, centers) {
  const boxes = new Map();
  model.visible.forEach(n => boxes.set(n.id, nodeBoxAt(model, centers, n.id)));
  const geo = model.conns.map(c => connGeometry(model, centers, c));
  return { centers, boxes, geo };
}

/** Whole-scene cost (for reporting and for comparing candidate layouts). */
export function sceneCost(model, cfg, state) {
  const allNodes = new Set(model.visible.map(n => n.id));
  const allConns = new Set(model.conns.map((_, i) => i));
  return localCost(model, cfg, state, allNodes, allConns);
}

// ============================================================================
// SEARCH
// ============================================================================

/**
 * The terms a move may never make worse. Weights order everything else, but
 * no weight makes a rule hard: priced at 60, one node pushed into a line still
 * "pays for" three labels cleared. So the search is lexicographic — a move
 * that raises the hard total is rejected before its total cost is looked at.
 */
const HARD = new Set([
  'node on node', 'group intrusion', 'line through node', 'label no longer fits its line'
]);

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];

/**
 * Repair a laid-out graph in place of its positions.
 *
 * @param {Map<string,{x,y}>} positions TOP-LEFT positions (the store's frame)
 * @param {Array} nodes layout nodes ({id, width, height})
 * @param {Array} edges layout edges ({id, sourceId, destinationId, name})
 * @param {object} options layout options (edgeLabelFontSize, groups, gridSize, ...)
 * @returns {{ positions: Map, before: number, after: number, moves: number }}
 */
export function repairLayout(positions, nodes, edges, options = {}) {
  const cfg = { ...REPAIR_DEFAULTS, ...(options.repair || {}), edgeLabelFontSize: options.edgeLabelFontSize,
    groupLabelFontSize: options.groupLabelFontSize, groupLabelScale: options.groupLabelScale, gridSize: options.gridSize };
  const sized = nodes.filter(n => positions.has(n.id)).map(n => ({
    id: n.id, width: Math.max(1, n.width || 0), height: Math.max(1, n.height || 0)
  }));
  const centers = new Map();
  sized.forEach(n => {
    const p = positions.get(n.id);
    centers.set(n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 });
  });
  const origin = new Map([...centers].map(([id, c]) => [id, { ...c }]));

  const model = buildModel(sized, edges, centers, options.groups || [], cfg);
  model.work = 0;
  const state = makeState(model, centers);
  model.conns.forEach((c, i) => { c.fitAtStart = state.geo[i].span >= c.fullW; });
  const em = model.em;
  const before = sceneCost(model, cfg, state);
  let moves = 0;

  const displacement = (id, c) => {
    const o = origin.get(id);
    return cfg.wDisplacement * Math.hypot(c.x - o.x, c.y - o.y) / em;
  };

  const apply = (id, c) => {
    centers.set(id, c);
    if (state.boxes.has(id)) state.boxes.set(id, nodeBoxAt(model, centers, id));
    (model.incident.get(id) || []).forEach(ci => { state.geo[ci] = connGeometry(model, centers, model.conns[ci]); });
  };

  const steps = [0.35, 0.75, 1.5, 3].map(k => k * em);
  const movable = model.visible.map(n => n.id);

  for (let round = 0; round < cfg.maxRounds; round++) {
    // Visit the most conflicted nodes first; ids break ties so order is stable.
    const scored = movable.map(id => {
      const d = dirtyFor(model, id);
      return { id, c: localCost(model, cfg, state, d.nodes, d.conns) };
    }).filter(x => x.c > cfg.wTruncation * 0.05)
      .sort((a, b) => (b.c - a.c) || (a.id < b.id ? -1 : 1));
    if (scored.length === 0) break;

    let improved = 0;
    for (const { id } of scored) {
      if (model.work > cfg.maxWork) break;
      const d = dirtyFor(model, id);
      const cur = centers.get(id);
      const split = {};
      const base = localCost(model, cfg, state, d.nodes, d.conns, null, split) + displacement(id, cur);
      const hardBase = split.hard;
      let best = null, bestCost = base - 1e-6;
      for (const s of steps) {
        for (const [dx, dy] of DIRS) {
          const cand = { x: cur.x + dx * s, y: cur.y + dy * s };
          apply(id, cand);
          const c = localCost(model, cfg, state, d.nodes, d.conns, null, split) + displacement(id, cand);
          if (split.hard > hardBase + 1e-6) continue;
          if (c < bestCost) { bestCost = c; best = cand; }
        }
      }
      apply(id, best || cur);
      if (best) { improved++; moves++; }
    }
    if (improved === 0 || model.work > cfg.maxWork) break;
  }

  const out = new Map(positions);
  sized.forEach(n => {
    // Anchors were only synced to their tab to measure the scene; the
    // renderer re-syncs them itself, so hand back what the solver chose.
    if (model.anchorOf.has(n.id)) return;
    const c = centers.get(n.id);
    out.set(n.id, { x: c.x - n.width / 2, y: c.y - n.height / 2 });
  });
  // Score the FINISHED scene from scratch. The search's own model holds the
  // group shells as they were before any member moved, so its running total
  // is stale on grouped graphs — and this number is what candidate layouts
  // are compared by.
  const finalCenters = new Map(sized.map(n => {
    const p = out.get(n.id);
    return [n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 }];
  }));
  const finalModel = buildModel(sized, edges, finalCenters, options.groups || [], cfg);
  finalModel.work = 0;
  const finalState = makeState(finalModel, finalCenters);
  const after = sceneCost(finalModel, cfg, finalState);
  const quality = sceneQuality(finalModel, finalState, after, options.qualityClusters || null);
  return { positions: out, before, after, moves, quality };
}

/**
 * One number for "how readable is this drawing", lower is better — what the
 * portfolio in graphLayoutService compares candidate layouts by.
 *
 * Conflicts are priced per drawn element, so a graph's size doesn't decide it.
 * Sparseness is priced separately, because a conflict-free drawing is trivial
 * to buy by blowing the layout up, and labels are a fixed world size: a
 * drawing twice as sparse has to be read at half the zoom. Ink density — node
 * and label area over the area the drawing spans — below ~0.10 costs log2 of
 * the shortfall, i.e. one unit per halving.
 */
export function sceneQuality(model, state, cost, clusters = null) {
  const elements = Math.max(1, model.visible.length + model.conns.length);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let ink = 0;
  const grow = (r) => {
    if (r.minX < minX) minX = r.minX; if (r.minY < minY) minY = r.minY;
    if (r.maxX > maxX) maxX = r.maxX; if (r.maxY > maxY) maxY = r.maxY;
  };
  state.boxes.forEach(b => { grow(b); ink += 4 * b.hw * b.hh; });
  model.shells.forEach(grow);
  state.geo.forEach(g => { if (g.label) { grow(g.label); ink += 4 * g.label.hw * g.label.hh; } });
  const area = Number.isFinite(minX) ? Math.max(1, (maxX - minX) * (maxY - minY)) : 1;
  const density = ink / area;
  const sparse = density < 0.10 ? Math.log2(0.10 / Math.max(density, 1e-6)) : 0;
  return cost / elements + 2 * sparse + proximityViolationRate(model, state, clusters);
}

/**
 * Gestalt proximity: the share of clustered nodes whose nearest neighbour
 * (box to box) belongs to a different cluster. A reader groups by proximity
 * before anything else, so a node that sits closer to a foreign cluster than
 * to its own reads as belonging to the wrong one. 0 when no clusters apply.
 */
function proximityViolationRate(model, state, clusters) {
  if (!clusters || clusters.size === 0) return 0;
  const boxes = [...state.boxes.values()].filter(b => clusters.has(b.id));
  if (boxes.length < 2) return 0;
  let violations = 0, counted = 0;
  for (const a of boxes) {
    let own = Infinity, foreign = Infinity;
    for (const b of boxes) {
      if (a === b) continue;
      const g = Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY));
      if (clusters.get(a.id) === clusters.get(b.id)) own = Math.min(own, g); else foreign = Math.min(foreign, g);
    }
    if (own === Infinity) continue;
    counted++;
    if (foreign < own) violations++;
  }
  return counted ? violations / counted : 0;
}
