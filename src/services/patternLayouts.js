/**
 * Pattern layouts — deterministic layouts for graphs with a recognizable shape.
 *
 * WHY THESE EXIST
 * Force-directed layout is the general solver and stays the default. But it is
 * a physics simulation: it converges to *a* good arrangement, not *the* good
 * arrangement, and small changes move everything. When a graph has an obvious
 * shape, a dedicated layout is predictable — the same graph lands the same way
 * every time, and the arrangement itself carries meaning (depth = generality in
 * a tree, ring order = sequence in a cycle).
 *
 * THE ONE GEOMETRY FACT THAT DRIVES EVERYTHING
 * NodeCanvas draws connection labels ROTATED ALONG the edge, centered at the
 * edge midpoint. So a label does not consume horizontal space — it consumes
 * EDGE LENGTH. Every constraint in this file is therefore the same constraint:
 *
 *     |edge| >= halfExtent(a, dir) + halfExtent(b, dir) + labelWidth + padding
 *
 * That single inequality is what makes these layouts label-aware. "influenced
 * the development of" between two nodes forces those nodes apart; "is a"
 * doesn't. Tree levels, ring radii, chain spacing and star spokes are all just
 * different ways of solving it.
 *
 * COORDINATE CONVENTION
 * Everything in this file works in NODE CENTERS. The exported entry points
 * convert to top-left at the very end, because that is what instance positions
 * are. (The force solver conflates the two; these layouts don't, which is why
 * wide nodes stop overlapping.)
 */

import { forceDirectedLayout } from './graphLayoutService.js';
import {
  EDGE_LABEL_BASE_FONT_SIZE,
  MIN_BOX,
  boxOf,
  halfExtentTowards,
  circumRadius,
  estimateEdgeLabelWidth,
  labelSpanOf,
  requiredEdgeLength,
  clusterGapFor,
  condenseBlocks
} from './layoutGeometry.js';
import {
  TOPOLOGY,
  TOPOLOGY_LAYOUT,
  detectTopology,
  buildSimpleGraph,
  chooseTreeRoot
} from './topologyDetection.js';
import {
  lombardiRefine,
  clearArcsOfNodes,
  lombardiResidual,
  circularOrder,
  isRegular
} from './lombardiLayout.js';
import {
  serpentineCentered,
  rectRingCentered,
  compassCentered,
  alignToLattice,
  axisRestrictionFor,
  separateBoxes
} from './orthogonalLayout.js';
import { clearPathsOfNodes, orthogonalPaths } from './pathClearance.js';

export const PATTERN_LAYOUT_DEFAULTS = {
  width: 2000,
  height: 1500,

  // Minimum clear space between two node boxes that aren't connected.
  nodeGap: 140,
  // Extra clearance around an edge label, along the edge. At ideal spacing this
  // IS the visible gap between the end of the label and the node box, so it is
  // the knob for how much the text breathes. Left here as the value for the
  // base font; resolveConfig scales it to whatever size labels are actually
  // drawn at, so shrinking the connection-label setting tightens the diagram
  // instead of leaving 90px holes around 30px text. See LABEL_PADDING_EM.
  labelPadding: 90,
  // No edge is ever shorter than this, even between two tiny unlabeled nodes.
  minEdgeLength: 260,
  // Must track NodeCanvas: base × textSettings.fontSize × connectionLabelSize.
  edgeLabelFontSize: EDGE_LABEL_BASE_FONT_SIZE,

  // Ceiling on how much a level gap may grow to separate colliding sibling
  // labels. A pathological fan (one parent, twenty verbosely-labelled
  // children) would otherwise stretch the diagram without bound.
  maxSiblingLabelGap: 1200,

  // 'auto' scores vertical vs horizontal and keeps whichever fits the canvas
  // aspect better. Long labels stretch the level axis, so this matters.
  treeDirection: 'auto',

  // 'top' | 'flow' — where the root of an inward-pointing hierarchy goes.
  // See the note in treeLayoutCentered; 'top' keeps the general term above.
  rootPlacement: 'top',

  // Clear space between independently laid-out connected components, node box
  // to node box. Like labelPadding above this is the value for the base font;
  // resolveConfig re-derives it from the size labels are actually drawn at, via
  // the same clusterGapFor the force solver quotes — the two pipelines have to
  // agree on this one or the same graph reads as cramped under straight routing
  // and scattered under Lombardi.
  componentGap: clusterGapFor(EDGE_LABEL_BASE_FONT_SIZE),

  // Fallback for components with no clean structure.
  fallbackAlgorithm: 'force',

  // Which edge routing the result will be drawn with. Only 'lombardi' changes
  // anything — see the LOMBARDI section below for why arcs need a different
  // shape of layout AND more room than chords.
  routingStyle: 'straight',
  lombardiCurvature: 1.0
};

// The box geometry that used to live here now lives in layoutGeometry.js, so
// the force solver can be held to the same model. Imported above.

/**
 * Smallest radius R at which a ring of nodes can be spaced so that every
 * adjacent pair is at least `chords[i]` apart.
 *
 * A chord of length c subtends 2·asin(c / 2R). The ring closes only when those
 * angles sum to at most 2π, and that sum shrinks monotonically as R grows — so
 * binary search finds the tightest R that fits. This is what lets a ring of
 * short labels stay compact while one long label on one edge opens the whole
 * circle just enough to fit it.
 */
export function solveRingRadius(chords) {
  if (chords.length === 0) return 0;
  const maxChord = Math.max(...chords);
  const totalChord = chords.reduce((sum, c) => sum + c, 0);
  if (chords.length === 1) return maxChord / 2;
  if (chords.length === 2) return maxChord / 2;

  const angleSum = (R) => chords.reduce(
    (sum, c) => sum + 2 * Math.asin(Math.min(1, c / (2 * R))), 0
  );

  let lo = maxChord / 2;
  let hi = Math.max(maxChord, totalChord / 2);
  let guard = 0;
  while (angleSum(hi) > 2 * Math.PI && guard++ < 80) hi *= 1.5;

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (angleSum(mid) > 2 * Math.PI) lo = mid; else hi = mid;
  }
  return hi;
}

/** Distribute 2π across the ring, giving each gap angle in proportion to need. */
function ringAngles(chords, radius) {
  const needed = chords.map(c => 2 * Math.asin(Math.min(1, c / (2 * radius))));
  const total = needed.reduce((sum, a) => sum + a, 0);
  const slack = Math.max(0, 2 * Math.PI - total);
  const angles = [];
  let theta = -Math.PI / 2; // start at 12 o'clock
  for (let i = 0; i < chords.length; i++) {
    angles.push(theta);
    const share = total > 0 ? needed[i] / total : 1 / chords.length;
    theta += needed[i] + slack * share;
  }
  return angles;
}

/** Longest-label edge for each unordered node pair, keyed "a|b". */
function buildEdgeIndex(edges, fontSize) {
  const index = new Map();
  (edges || []).forEach(edge => {
    if (!edge || edge.sourceId === edge.destinationId) return;
    const key = edge.sourceId < edge.destinationId
      ? `${edge.sourceId}|${edge.destinationId}`
      : `${edge.destinationId}|${edge.sourceId}`;
    const existing = index.get(key);
    if (!existing || labelSpanOf(edge, fontSize) > labelSpanOf(existing, fontSize)) {
      index.set(key, edge);
    }
  });
  return index;
}

const lookupEdge = (index, a, b) => index.get(a < b ? `${a}|${b}` : `${b}|${a}`) || null;

function bboxOfCenters(positions, nodeById) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  positions.forEach((pos, id) => {
    const { w, h } = boxOf(nodeById.get(id));
    minX = Math.min(minX, pos.x - w / 2);
    maxX = Math.max(maxX, pos.x + w / 2);
    minY = Math.min(minY, pos.y - h / 2);
    maxY = Math.max(maxY, pos.y + h / 2);
  });
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Center positions → instance (top-left) positions. */
function centersToTopLeft(positions, nodeById) {
  const out = new Map();
  positions.forEach((pos, id) => {
    const { w, h } = boxOf(nodeById.get(id));
    out.set(id, { x: pos.x - w / 2, y: pos.y - h / 2 });
  });
  return out;
}

// ============================================================================
// LEVEL GAP SOLVER (shared by tree + layered)
// ============================================================================

/**
 * Main-axis gap ONE edge needs, given how far sideways it already runs.
 *
 * The constraint is the file header's inequality projected onto the two axes:
 * an edge spanning `gap` along the level axis and `crossDelta` across it is
 * `hypot(gap, crossDelta)` long, and that has to cover the two nodes' extents
 * plus the label.
 *
 * WHY THIS IS A SOLVE AND NOT A FORMULA
 * The required length depends on the DIRECTION the edge runs, because a node's
 * extent along the edge does — that is the whole point of `halfExtentTowards`.
 * But the direction depends on the gap, which is what we are solving for. This
 * used to be written as a formula by passing direction `(crossDelta, 1)` for a
 * vertical tree, with the `1` standing in for the unknown gap. `crossDelta` is
 * in pixels, so that vector is not "mostly vertical" — it is very nearly
 * horizontal, and the measured extent was the wrong one by a factor of ~4:
 *
 *     440x100 node, crossDelta 60   vertical tree reserved 220, needed 50
 *                                   horizontal tree reserved 50, needed 221
 *
 * So a vertical tree spread every level out over four times as far as it
 * needed, and a horizontal one packed levels closer than the labels fit.
 *
 * Bisection rather than fixed-point iteration: `required` FALLS as the gap
 * grows (the edge straightens onto the main axis, and for a wide node that
 * shrinks its extent), so iterating `gap = f(gap)` on a decreasing map can sit
 * in a two-cycle forever. `fits` is what we actually care about, `hi` always
 * satisfies it, and returning `hi` is therefore always a legal answer — the
 * same shape as solveRingRadius above.
 */
function solveMainGap(a, b, edge, cfg, crossDelta, vertical, span = 1) {
  const floor = vertical
    ? (boxOf(a).h + boxOf(b).h) / 2 + cfg.nodeGap
    : (boxOf(a).w + boxOf(b).w) / 2 + cfg.nodeGap;

  const fits = (gap) => {
    const dirX = vertical ? crossDelta : gap;
    const dirY = vertical ? gap : crossDelta;
    const required = requiredEdgeLength(a, b, edge, cfg, dirX, dirY) / Math.max(1, span);
    return Math.hypot(gap, crossDelta) >= required;
  };

  const lo0 = Math.max(cfg.minEdgeLength, floor);
  if (fits(lo0)) return lo0;

  let hi = lo0;
  for (let i = 0; i < 60 && !fits(hi); i++) hi = hi * 1.5 + 1;

  let lo = lo0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * Turn per-level edge lists into main-axis gaps — the aligned-rows form, where
 * every edge crossing a depth is stretched to the longest one's requirement.
 *
 * Still used by the layered DAG layout, where a node can have several
 * predecessors and so has no single parent to hang a ragged offset off.
 * `treeLayoutCentered` uses the per-edge solver directly instead.
 */
function resolveLevelGaps(levelEdges, levelSiblings, cfg, vertical) {
  return levelEdges.map((edgesAtLevel, depth) => {
    let gap = cfg.minEdgeLength;

    edgesAtLevel.forEach(({ a, b, edge, crossDelta, span = 1 }) => {
      gap = Math.max(gap, solveMainGap(a, b, edge, cfg, crossDelta, vertical, span));
    });

    return Math.max(gap, solveSiblingLabelGap(levelSiblings?.[depth], cfg, gap));
  });
}

/**
 * Centre-to-centre cross separation each adjacent sibling pair needs so their
 * two labels don't overlap, given the main-axis gaps already solved.
 *
 * Labels sit at edge midpoints and every edge in a fan leaves the same parent,
 * so two adjacent labels are only half as far apart as their children are —
 * hence the factor of 2 when converting the requirement back to child spacing.
 *
 * `gapOf` takes a CHILD id rather than a depth, because the tree now gives each
 * edge its own main-axis run. That is also strictly more accurate than the old
 * per-level lookup: a label's cross-axis sweep depends on the angle of the edge
 * it rides, and with ragged levels two siblings' edges can have different ones.
 *
 * @param {(childId: string) => number} gapOf main-axis run of that child's edge
 * @returns {Map<string, number>} "childA|childB" → required separation
 */
function computeSiblingSeparations(levelSiblings, gapOf, cfg) {
  const required = new Map();
  const lineHeight = cfg.edgeLabelFontSize * 1.2;

  levelSiblings.forEach((groups) => {
    groups.forEach(({ parentCross, kids }) => {
      for (let i = 1; i < kids.length; i++) {
        const a = kids[i - 1];
        const b = kids[i];
        const sweep = (kid) => {
          const gap = gapOf(kid.id);
          if (!gap) return 0;
          const delta = kid.cross - parentCross;
          const length = Math.hypot(delta, gap) || 1;
          return (kid.labelWidth * Math.abs(delta) / length + lineHeight * gap / length) / 2;
        };
        // Midpoints are half as far apart as the children, so the children
        // need twice the label clearance.
        const need = 2 * (sweep(a) + sweep(b)) + cfg.nodeGap;
        if (Math.abs(b.cross - a.cross) < need) {
          required.set(`${a.id}|${b.id}`, need);
        }
      }
    });
  });

  return required;
}

/**
 * The gap needed to stop adjacent siblings' labels from colliding.
 *
 * Fitting a label ALONG its edge is not enough. The label is drawn as a
 * rotated rectangle, so a tilted one sweeps across the cross axis far beyond
 * its own line: a label 820 wide tilted 10° occupies
 *
 *     820·sin(10°) + lineHeight ≈ 212px
 *
 * of cross-axis space. Two siblings only 120px apart therefore overlap even
 * though each edge is individually long enough for its own text.
 *
 * Widening the level gap fixes it, because it steepens the fan: as the gap
 * grows, each edge tilts less relative to the level axis and its label's
 * cross-axis sweep shrinks monotonically toward the bare line height. So we
 * binary search for the smallest gap at which every adjacent pair clears.
 *
 * (This replaces a `steepnessFactor × levelSpread` fudge that measured the
 * wrong quantity — on a horizontal tree levelSpread is node *heights*, so it
 * never bound, and collision counts were identical from 0.0 to 0.5.)
 */
function solveSiblingLabelGap(groups, cfg, minGap) {
  if (!groups || groups.length === 0) return 0;

  const lineHeight = cfg.edgeLabelFontSize * 1.2;

  // Cross-axis half-extent of a label on an edge that spans `delta` across and
  // `gap` along the level axis.
  const halfSweep = (labelWidth, delta, gap) => {
    const length = Math.hypot(delta, gap) || 1;
    return (labelWidth * Math.abs(delta) / length + lineHeight * gap / length) / 2;
  };

  const clears = (gap) => groups.every(({ parentCross, kids }) => {
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1];
      const b = kids[i];
      const need = halfSweep(a.labelWidth, a.cross - parentCross, gap)
        + halfSweep(b.labelWidth, b.cross - parentCross, gap);
      // Labels sit at edge MIDPOINTS, and every edge in a fan starts at the
      // same parent — so two labels are only half as far apart as the two
      // children they belong to.
      const available = Math.abs(b.cross - a.cross) / 2;
      if (available < need) return false;
    }
    return true;
  });

  if (clears(minGap)) return 0;

  // Monotone in gap (labels tilt less as the fan steepens), so bisect. The
  // ceiling stops a pathological fan from stretching the diagram without
  // limit — past it, the remaining overlap is left to the renderer.
  const ceiling = minGap + cfg.maxSiblingLabelGap;
  if (!clears(ceiling)) return ceiling;

  let lo = minGap;
  let hi = ceiling;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (clears(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

// ============================================================================
// TREE
// ============================================================================

/**
 * Tidy tree layout with variable node sizes and label-aware level gaps.
 *
 * Cross-axis placement is the classic bottom-up pass: a leaf claims its own
 * width, an internal node claims the sum of its children's claims and centers
 * itself over them. Main-axis placement is the label solver above.
 */
function treeLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);
  const rootId = meta.rootId && nodeById.has(meta.rootId)
    ? meta.rootId
    : chooseTreeRoot(nodes, edges, adjacency, cfg.rootId);

  if (!rootId) return new Map();

  // Spanning tree by BFS. In a true tree this IS the tree; if a caller forces
  // 'tree' on a graph with extra edges, the spanning tree is a sane skeleton
  // and the surplus edges just get drawn over it.
  const children = new Map(nodes.map(n => [n.id, []]));
  const depth = new Map([[rootId, 0]]);
  const order = [rootId];
  for (let head = 0; head < order.length; head++) {
    const id = order[head];
    Array.from(adjacency.get(id) || []).forEach(neighborId => {
      if (depth.has(neighborId)) return;
      depth.set(neighborId, depth.get(id) + 1);
      children.get(id).push(neighborId);
      order.push(neighborId);
    });
  }
  // Anything unreachable (disconnected input) hangs off the root.
  nodes.forEach(node => {
    if (!depth.has(node.id)) {
      depth.set(node.id, 1);
      children.get(rootId).push(node.id);
      order.push(node.id);
    }
  });

  const maxDepth = Math.max(...Array.from(depth.values()));

  const attempt = (vertical) => {
    const crossExtent = (id) => {
      const { w, h } = boxOf(nodeById.get(id));
      return vertical ? w : h;
    };
    const siblingGap = Math.max(cfg.nodeGap, cfg.edgeLabelFontSize * 1.4);

    const cross = new Map();

    // ── Contour-based subtree packing (Reingold–Tilford) ─────────────────
    // Reserving each subtree's full bounding box is the obvious approach and
    // it is badly wasteful on real trees: a deep narrow subtree beside a
    // shallow wide one leaves a void the height of the deeper one. Instead
    // each subtree carries its silhouette — the leftmost and rightmost edge
    // at every depth below it — and adjacent siblings are slid together until
    // they touch at their closest depth, not their widest.
    //
    // This is what makes a sentence-diagram-shaped tree (one flow, dozens of
    // subtrees of wildly uneven depth) pack tightly instead of exploding.
    const childOffset = new Map();  // id → cross offset from its parent
    const contours = new Map();     // id → { L, R } silhouette, depth-relative

    // `pairGap` supplies an extra separation requirement for one specific
    // adjacent-sibling pair, at their own row only (depth 0 of the merge).
    // Pass 1 has none; pass 2 fills it in from measured label sweeps.
    const buildContour = (id, pairGap) => {
      const kids = children.get(id) || [];
      const half = crossExtent(id) / 2;

      if (kids.length === 0) {
        contours.set(id, { L: [-half], R: [half] });
        return;
      }

      kids.forEach(kid => buildContour(kid, pairGap));

      const offsets = [];
      let accL = null;
      let accR = null;

      kids.forEach((kid, index) => {
        const kc = contours.get(kid);
        let offset = 0;

        if (index > 0) {
          // Slide this subtree right until it clears everything placed so far
          // at EVERY depth they share — the binding depth is usually not the
          // widest one. Only the siblings' own row (d = 0) carries the label
          // requirement; deeper rows are handled at their own level.
          const ownRowGap = Math.max(siblingGap, pairGap(kids[index - 1], kid));
          const shared = Math.min(accR.length, kc.L.length);
          for (let d = 0; d < shared; d++) {
            const need = d === 0 ? ownRowGap : siblingGap;
            offset = Math.max(offset, accR[d] + need - kc.L[d]);
          }
        }
        offsets.push(offset);

        // Merge this subtree's silhouette into the accumulated one.
        if (index === 0) {
          accL = kc.L.map(v => v + offset);
          accR = kc.R.map(v => v + offset);
        } else {
          for (let d = 0; d < kc.L.length; d++) {
            const l = kc.L[d] + offset;
            const r = kc.R[d] + offset;
            if (d < accL.length) {
              accL[d] = Math.min(accL[d], l);
              accR[d] = Math.max(accR[d], r);
            } else {
              accL[d] = l;
              accR[d] = r;
            }
          }
        }
      });

      // Centre the parent over its outermost children, then rebase everything
      // so this node sits at 0 in its own frame.
      const centre = (offsets[0] + offsets[offsets.length - 1]) / 2;
      kids.forEach((kid, index) => childOffset.set(kid, offsets[index] - centre));

      // The node's own box joins the silhouette at depth 0; if it is wider
      // than the children beneath it, that shows up here and pushes siblings
      // away without any special case.
      contours.set(id, {
        L: [-half, ...accL.map(v => v - centre)],
        R: [half, ...accR.map(v => v - centre)]
      });
    };

    const pack = (pairGap) => {
      childOffset.clear();
      contours.clear();
      buildContour(rootId, pairGap);

      // Walk down accumulating offsets into absolute cross positions.
      cross.clear();
      cross.set(rootId, 0);
      const queue = [rootId];
      for (let head = 0; head < queue.length; head++) {
        const parentId = queue[head];
        (children.get(parentId) || []).forEach(kidId => {
          cross.set(kidId, cross.get(parentId) + (childOffset.get(kidId) || 0));
          queue.push(kidId);
        });
      }
    };

    const noPairGap = () => 0;
    pack(noPairGap);

    // Each parent's fan of children (cross position + label width), so the
    // sibling solver can check adjacent labels for collision.
    const collect = () => {
      const levelSiblings = Array.from({ length: Math.max(1, maxDepth) }, () => []);
      children.forEach((kids, parentId) => {
        if (kids.length === 0) return;
        const d = depth.get(parentId);
        if (d >= maxDepth) return;
        const fan = kids.map(kidId => ({
          id: kidId,
          cross: cross.get(kidId),
          labelWidth: labelSpanOf(lookupEdge(edgeIndex, parentId, kidId), cfg.edgeLabelFontSize)
        }));
        fan.sort((a, b) => a.cross - b.cross);
        levelSiblings[d].push({ parentId, parentCross: cross.get(parentId), kids: fan });
      });
      return levelSiblings;
    };

    // ── Main-axis placement, per EDGE rather than per level ───────────────
    // Levels used to share one gap per depth, so the longest label at a depth
    // set the distance for every sibling. On a taxonomy where one child of
    // "Mammal" is reached by "has been domesticated as" and the others by
    // "is a", that stretched the short edges to 2.4x the length they needed —
    // one edge sitting at its true minimum and the rest visibly adrift, which
    // is the shape of the complaint this pass exists to answer.
    //
    // A child now sits exactly as far from its parent as its OWN edge needs.
    // Rows no longer line up, and that is the trade: depth still increases
    // monotonically (every gap clears the two boxes plus nodeGap), so the
    // hierarchy still reads, but no edge is padded out on a sibling's behalf.
    const solveEdgeGaps = () => {
      const perChild = new Map();
      children.forEach((kids, parentId) => {
        const parent = nodeById.get(parentId);
        kids.forEach(kidId => {
          perChild.set(kidId, solveMainGap(
            parent,
            nodeById.get(kidId),
            lookupEdge(edgeIndex, parentId, kidId),
            cfg,
            Math.abs(cross.get(kidId) - cross.get(parentId)),
            vertical
          ));
        });
      });
      return perChild;
    };

    let levelSiblings = collect();
    let edgeGap = solveEdgeGaps();

    // ── Pass 2: buy label clearance on the cheap axis ────────────────────
    // A fan whose labels collide can be fixed two ways: steepen the fan (push
    // the children further out) or spread them sideways. Spreading is the
    // cheaper axis — pushing a child out lengthens its edge past what its own
    // label needs, which is the very thing this layout is trying to stop. So
    // compute what separation each colliding pair actually needs and repack.
    //
    // Twice, because the ragged solve has no level-wide fallback behind it:
    // repacking moves the children, which changes their edges' angles, which
    // changes how far each label sweeps across its neighbours.
    for (let round = 0; round < 2; round++) {
      const required = computeSiblingSeparations(levelSiblings, id => edgeGap.get(id), cfg);
      if (required.size === 0) break;
      pack((aId, bId) => {
        const need = required.get(`${aId}|${bId}`) || required.get(`${bId}|${aId}`);
        if (!need) return 0;
        // `need` is centre-to-centre; the packer wants box-edge separation.
        return need - (crossExtent(aId) + crossExtent(bId)) / 2;
      });
      levelSiblings = collect();
      edgeGap = solveEdgeGaps();
    }

    // Walk the gaps down the tree into absolute main-axis coordinates.
    const mainOf = new Map([[rootId, 0]]);
    const mainQueue = [rootId];
    for (let head = 0; head < mainQueue.length; head++) {
      const parentId = mainQueue[head];
      (children.get(parentId) || []).forEach(kidId => {
        mainOf.set(kidId, mainOf.get(parentId) + (edgeGap.get(kidId) ?? cfg.minEdgeLength));
        mainQueue.push(kidId);
      });
    }

    // Where the root goes when the hierarchy points inward — "Dog is a kind of
    // Mammal", arrows running from specific to general. Structure alone can't
    // settle this, because the same shape means opposite things:
    //
    //   'top'  — the root is always at depth 0, whichever way arrows point.
    //            Matches the Tree of Porphyry, UML inheritance and cladograms:
    //            the general term sits above, arrows read upward toward it.
    //   'flow' — arrows always run down the page, so an inward hierarchy puts
    //            its root at the bottom. Matches the layered DAG layout and
    //            suits convergence ("five causes → one effect").
    const sign = (cfg.rootPlacement === 'flow' && meta.inverted) ? -1 : 1;

    const positions = new Map();
    nodes.forEach(node => {
      const main = (mainOf.get(node.id) ?? 0) * sign;
      const c = cross.get(node.id) ?? 0;
      positions.set(node.id, vertical ? { x: c, y: main } : { x: main, y: c });
    });
    return positions;
  };

  const direction = cfg.treeDirection || 'auto';
  if (direction === 'horizontal') return attempt(false);

  // 'auto' and 'vertical' both mean TOP-DOWN for a tree, deliberately.
  //
  // 'auto' used to lay the tree out both ways and keep whichever fitted the
  // canvas better — but `cfg.width`/`cfg.height` come from the live viewport,
  // so the same graph ran top-to-bottom in a tall window and right-to-left in a
  // wide one, and resizing the window rotated the hierarchy. Depth is the one
  // thing a tree is FOR; which way it points should be a fixed convention the
  // reader can learn, not a function of the panel widths.
  //
  // Down is the direction that matches `rootPlacement: 'top'` and the Tree of
  // Porphyry note in that comment: the general term above, the specific below.
  // `treeDirection: 'horizontal'` still forces the other axis for callers that
  // want it, and layeredLayoutCentered keeps its own canvas-aware choice — a
  // DAG's flow axis is genuinely a fitting question, a taxonomy's is not.
  return attempt(true);
}

// ============================================================================
// CYCLE
// ============================================================================

/**
 * Ring layout for circuits. Node order follows the actual cycle, so the loop is
 * drawn as a loop with no crossings, and the radius is solved from the chord
 * each edge needs — one long relation name opens the ring exactly enough to fit
 * it rather than forcing a uniformly huge circle.
 */
function cycleLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  let ring = (meta.ringIds || []).filter(id => nodeById.has(id));
  if (ring.length !== nodes.length) ring = nodes.map(n => n.id);
  if (ring.length === 0) return new Map();
  if (ring.length === 1) return new Map([[ring[0], { x: 0, y: 0 }]]);

  const chordFor = (idA, idB, radiusFn) => {
    const a = nodeById.get(idA);
    const b = nodeById.get(idB);
    const edge = lookupEdge(edgeIndex, idA, idB);
    const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
    const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
    return Math.max(cfg.minEdgeLength, radiusFn(a) + radiusFn(b) + label + gap);
  };

  // Pass 1 — worst-case radii, no directions known yet.
  let chords = ring.map((id, i) => chordFor(id, ring[(i + 1) % ring.length], circumRadius));
  let radius = solveRingRadius(chords);
  let angles = ringAngles(chords, radius);
  let positions = new Map(ring.map((id, i) => [id, {
    x: Math.cos(angles[i]) * radius,
    y: Math.sin(angles[i]) * radius
  }]));

  // Pass 2 — now that directions exist, re-measure with real directional
  // extents. Wide-but-short nodes on a ring reclaim a lot of space here.
  chords = ring.map((id, i) => {
    const nextId = ring[(i + 1) % ring.length];
    const from = positions.get(id);
    const to = positions.get(nextId);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const a = nodeById.get(id);
    const b = nodeById.get(nextId);
    const edge = lookupEdge(edgeIndex, id, nextId);
    const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
    const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
    return Math.max(
      cfg.minEdgeLength,
      halfExtentTowards(a, dx, dy) + halfExtentTowards(b, dx, dy) + label + gap
    );
  });
  radius = solveRingRadius(chords);
  angles = ringAngles(chords, radius);
  positions = new Map(ring.map((id, i) => [id, {
    x: Math.cos(angles[i]) * radius,
    y: Math.sin(angles[i]) * radius
  }]));

  return positions;
}

// ============================================================================
// CHAIN
// ============================================================================

/**
 * Serpentine layout for paths. Spacing is per-edge rather than uniform, so a
 * chain reads as a sentence: tightly-linked steps sit close, verbose relations
 * get the room their label needs. Rows alternate direction so the sequence
 * stays continuous when it wraps.
 */
function chainLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  // Walk the path from an endpoint.
  let startId = meta.startId && nodeById.has(meta.startId) ? meta.startId : null;
  if (!startId) {
    startId = nodes.find(n => (adjacency.get(n.id) || new Set()).size <= 1)?.id || nodes[0].id;
  }
  const order = [startId];
  const seen = new Set([startId]);
  let current = startId;
  for (;;) {
    const next = Array.from(adjacency.get(current) || []).find(id => !seen.has(id));
    if (!next) break;
    order.push(next);
    seen.add(next);
    current = next;
  }
  nodes.forEach(node => { if (!seen.has(node.id)) order.push(node.id); });

  const maxRowWidth = Math.max(cfg.width, cfg.minEdgeLength * 3);
  const positions = new Map();

  let x = 0;
  let y = 0;
  let rowStartX = 0;
  let direction = 1;
  let rowMaxHeight = boxOf(nodeById.get(order[0])).h;
  positions.set(order[0], { x, y });

  for (let i = 1; i < order.length; i++) {
    const prevId = order[i - 1];
    const id = order[i];
    const prev = nodeById.get(prevId);
    const node = nodeById.get(id);
    const edge = lookupEdge(edgeIndex, prevId, id);

    const step = requiredEdgeLength(prev, node, edge, cfg, 1, 0);
    const nextX = x + direction * step;
    const rowExtent = Math.abs(nextX - rowStartX) + boxOf(node).w / 2;

    if (rowExtent > maxRowWidth) {
      // Wrap. The wrapping edge runs vertically, so IT has to fit the label.
      const drop = requiredEdgeLength(prev, node, edge, cfg, 0, 1);
      y += Math.max(drop, rowMaxHeight / 2 + boxOf(node).h / 2 + cfg.nodeGap);
      direction *= -1;
      rowStartX = x;
      rowMaxHeight = boxOf(node).h;
      positions.set(id, { x, y });
    } else {
      x = nextX;
      rowMaxHeight = Math.max(rowMaxHeight, boxOf(node).h);
      positions.set(id, { x, y });
    }
  }

  return positions;
}

// ============================================================================
// STAR
// ============================================================================

/**
 * Hub and spokes. Spoke length satisfies each label individually; the ring
 * radius also has to keep neighbouring satellites from colliding, so the final
 * radius is the larger of the two constraints.
 */
function starLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  let hubId = meta.hubId && nodeById.has(meta.hubId) ? meta.hubId : null;
  if (!hubId) {
    hubId = nodes.reduce((best, node) => (
      (adjacency.get(node.id) || new Set()).size > (adjacency.get(best.id) || new Set()).size ? node : best
    ), nodes[0]).id;
  }

  const hub = nodeById.get(hubId);
  const satellites = nodes.filter(node => node.id !== hubId).map(node => node.id);
  if (satellites.length === 0) return new Map([[hubId, { x: 0, y: 0 }]]);

  // Solve the two constraints, then re-solve once the spoke directions are
  // known: a wide, short node on a vertical spoke needs far less room than its
  // worst-case (circumscribed) radius suggests.
  const solve = (priorAngles) => {
    // A spoke runs radially, so the label competes with the RADIAL extent of
    // the two nodes; two neighbouring satellites sit side by side, so they
    // compete with each other's TANGENTIAL extent. For a wide, short node
    // those two numbers differ by a factor of three.
    const radial = (node, i) => (priorAngles
      ? halfExtentTowards(node, Math.cos(priorAngles[i]), Math.sin(priorAngles[i]))
      : circumRadius(node));
    const tangential = (node, i) => (priorAngles
      ? halfExtentTowards(node, -Math.sin(priorAngles[i]), Math.cos(priorAngles[i]))
      : circumRadius(node));

    // Each spoke gets its OWN length. A single radius taken as the max over
    // every satellite means one verbose relation name drags the entire ring
    // outward — the hub ends up with one spoke at its true minimum and all the
    // rest visibly adrift, which is the same complaint the tree's shared level
    // gap produced. The ring-collision solve below is still a floor, so the
    // satellites cannot crowd each other however short their labels are.
    const spoke = satellites.map((id, i) => {
      const edge = lookupEdge(edgeIndex, hubId, id);
      const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
      const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
      return Math.max(
        cfg.minEdgeLength,
        radial(hub, i) + radial(nodeById.get(id), i) + label + gap
      );
    });

    const chords = satellites.map((id, i) => {
      const nextIndex = (i + 1) % satellites.length;
      return tangential(nodeById.get(id), i)
        + tangential(nodeById.get(satellites[nextIndex]), nextIndex)
        + cfg.nodeGap;
    });
    // Angles are shared, so they have to come from one radius — use the ring's
    // own requirement, which is what the angular spacing actually depends on.
    const ringRadius = Math.max(solveRingRadius(chords), Math.min(...spoke));
    return {
      radii: spoke.map(s => Math.max(s, ringRadius)),
      angles: ringAngles(chords, ringRadius)
    };
  };

  const coarse = solve(null);
  const directional = solve(coarse.angles);

  const positions = new Map([[hubId, { x: 0, y: 0 }]]);
  satellites.forEach((id, i) => {
    positions.set(id, {
      x: Math.cos(directional.angles[i]) * directional.radii[i],
      y: Math.sin(directional.angles[i]) * directional.radii[i]
    });
  });
  return positions;
}

// ============================================================================
// LOMBARDI
// ============================================================================
//
// Lombardi routing draws every edge as a circular arc and gives every node
// PERFECT ANGULAR RESOLUTION — its incident edges leave evenly spaced around
// the full 2π. That changes what a good layout is, in two ways:
//
// 1. RADIAL BEATS ROWS. In a row-based layout (tree levels, layered DAG
//    ranks) a node's neighbours are all clustered in roughly one direction.
//    Perfect angular resolution then has to fan those edges out across
//    directions the geometry doesn't support, and the arcs bow hard to
//    compensate — the drawing curdles. Radial layouts put a node's neighbours
//    genuinely around it, so the even fan is close to the natural bearings and
//    the arcs stay gentle. This is why the paper's own constructions are
//    circular and k-circular; the Spirograph in §5 is exactly concentric rings.
//
// 2. ARCS NEED MORE ROOM THAN CHORDS. Every spacing constraint in this file is
//    measured along the straight line between two nodes. An arc is longer than
//    that chord (the label rides the arc) and bulges sideways off it (the bow
//    needs clearance). See arcAwareConfig.
//
// Only the layouts that were row-based get replaced. CYCLE and STAR are
// already radial — they are the paper's circular drawing and its degree-1 case
// — and MESH still belongs to the force solver.
// ---------------------------------------------------------------------------

// Representative tangent-chord angle, used only to size the spacing allowance.
// Perfect angular resolution puts adjacent edges 2π/k apart at a degree-k node,
// so a typical edge gets pulled off its chord by something on that order; 30°
// is the figure for the mid-degree nodes that dominate a real graph and errs
// generously for the sparse ones. It is NOT the angle any particular arc gets —
// that comes out of the per-node solve at render time.
const REPRESENTATIVE_DELTA = Math.PI / 6;

// Mirror of MAX_TANGENT_CHORD in utils/canvas/edgeRouting.js. Duplicated rather
// than imported to keep this layout service free of canvas-render imports; it
// only bounds a spacing allowance, so drift here costs padding, not geometry.
const MAX_LAYOUT_DELTA = 1.32;

/**
 * Adjust the spacing constraints for arcs rather than chords.
 *
 * An arc subtending 2δ is δ/sin δ times as long as its chord, and bulges
 * (L/2)·tan(δ/2) away from it.
 *
 * The length factor used to INFLATE the label terms — "the edge has to be
 * longer to fit the same text" — which was right when labels sat on the chord.
 * They don't any more: connection labels ride the arc glyph by glyph (see
 * labelArcGlyphFrames in utils/canvas/edgeRouting.js), so a chord of length L
 * offers L·(δ/sin δ) of text room, and the label terms DIVIDE by the factor
 * instead. Same geometry, opposite sign, because the drawing changed.
 *
 * On top of that, label breathing gets a Lombardi-specific trim. The 5.5em in
 * LABEL_PADDING_EM was priced against straight rows, where padding is paid
 * linearly ("trees pay for it in height only"); the Lombardi constructions are
 * rings and radial wedges, which pay every unit of padding in RADIUS — area
 * grows with its square, and the whole drawing reads as inflated. An
 * arc-riding label is also visually tied to its curve in a way a chord label
 * isn't, so it needs less empty runway around it to read as attached.
 *
 * The bow term stays but at half strength: the bulge is real, yet dedicating
 * full clearance to it everywhere double-pays — clearArcsOfNodes runs as the
 * pipeline's own stage 3 and clears the actual drawn arcs off nodes.
 */
const LOMBARDI_LABEL_BREATHING = 0.65;

function arcAwareConfig(cfg) {
  if (cfg.routingStyle !== 'lombardi') return cfg;
  const delta = Math.min(MAX_LAYOUT_DELTA, REPRESENTATIVE_DELTA * (cfg.lombardiCurvature ?? 1));
  if (delta < 1e-3) return cfg;
  const alongFactor = delta / Math.sin(delta);
  const bowFactor = 1 + Math.tan(delta / 2) / 2;
  return {
    ...cfg,
    minEdgeLength: cfg.minEdgeLength / alongFactor,
    labelPadding: (cfg.labelPadding * LOMBARDI_LABEL_BREATHING) / alongFactor,
    nodeGap: cfg.nodeGap * bowFactor
  };
}

/**
 * Concentric-ring layout for hierarchies — the Euclidean form of the paper's
 * k-circular drawing, and what its Halin-graph construction (Theorem 3) reduces
 * to once you drop the hyperbolic model.
 *
 * The root sits at the centre and each BFS level occupies a ring. A node's
 * children get a WEDGE of its parent's wedge, sized by how many leaves the
 * subtree carries, so a bushy branch takes the room it needs and a thin one
 * doesn't hoard any. Ring radii are solved from the same label constraint the
 * row-based tree uses, plus a circumference check so a wide ring doesn't
 * self-collide.
 *
 * Works for DAGs too — the BFS tree of a DAG is a perfectly good skeleton, and
 * the extra (non-tree) edges just become additional arcs between rings.
 */
function radialLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) return new Map([[nodes[0].id, { x: 0, y: 0 }]]);

  const rootId = chooseTreeRoot(nodes, edges, adjacency, meta.rootId);
  if (!rootId) return new Map();

  // BFS skeleton.
  const parent = new Map([[rootId, null]]);
  const children = new Map(nodes.map(n => [n.id, []]));
  const depth = new Map([[rootId, 0]]);
  const order = [rootId];
  for (let head = 0; head < order.length; head++) {
    const id = order[head];
    (adjacency.get(id) || new Set()).forEach(neighborId => {
      if (parent.has(neighborId)) return;
      parent.set(neighborId, id);
      depth.set(neighborId, depth.get(id) + 1);
      children.get(id).push(neighborId);
      order.push(neighborId);
    });
  }
  // Unreachable strays (shouldn't happen inside one component) hang off the root
  // rather than landing on top of it at the origin.
  nodes.forEach(node => {
    if (parent.has(node.id)) return;
    parent.set(node.id, rootId);
    depth.set(node.id, 1);
    children.get(rootId).push(node.id);
    order.push(node.id);
  });

  // Leaf weight per subtree, bottom-up (order is BFS, so reverse it).
  const weight = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const kids = children.get(id);
    weight.set(id, kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + weight.get(k), 0));
  }

  const byDepth = [];
  order.forEach(id => {
    const d = depth.get(id);
    if (!byDepth[d]) byDepth[d] = [];
    byDepth[d].push(id);
  });

  // Two passes, the same shape the cycle and star layouts use. The first has no
  // bearings to measure against and has to fall back to each node's
  // circumscribed radius; the second re-measures against the directions pass 1
  // produced. That matters more here than anywhere else in this file, because
  // the ring step is a MAX over a whole depth: with the circumscribed radius, a
  // single 660x100 node reserves 333 where its spoke actually needs ~50, and
  // every other node on its ring pays for it.
  const solve = (prior) => {
    // How far the node's box reaches along the edge running `from` → `to`.
    const extentToward = (node, from, to) => {
      if (!from || !to) return circumRadius(node);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return circumRadius(node);
      return halfExtentTowards(node, dx, dy);
    };
    // How far it reaches ACROSS its own spoke — what its ring neighbours see.
    const tangential = (node, id) => {
      const p = prior?.get(id);
      if (!p || (Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6)) return circumRadius(node);
      return halfExtentTowards(node, -p.y, p.x);
    };

    // Ring radii: each ring clears both the parent→child label constraint
    // (radial) and the room every node on it needs side by side
    // (circumferential).
    const radii = [0];
    for (let d = 1; d < byDepth.length; d++) {
      let step = cfg.minEdgeLength;
      byDepth[d].forEach(id => {
        const parentId = parent.get(id);
        const parentNode = nodeById.get(parentId);
        const node = nodeById.get(id);
        const edge = lookupEdge(edgeIndex, parentId, id);
        const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
        const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
        const from = prior?.get(parentId);
        const to = prior?.get(id);
        step = Math.max(
          step,
          extentToward(parentNode, from, to) + extentToward(node, from, to) + label + gap
        );
      });
      const chords = byDepth[d].map(id => 2 * tangential(nodeById.get(id), id) + cfg.nodeGap);
      radii[d] = Math.max(radii[d - 1] + step, solveRingRadius(chords));
    }

    // Wedge subdivision, top-down.
    const positions = new Map([[rootId, { x: 0, y: 0 }]]);
    const wedges = new Map([[rootId, { start: -Math.PI / 2, span: 2 * Math.PI }]]);
    order.forEach(id => {
      const kids = children.get(id);
      if (kids.length === 0) return;
      const wedge = wedges.get(id);
      const total = kids.reduce((sum, k) => sum + weight.get(k), 0) || kids.length;
      let cursor = wedge.start;
      kids.forEach(kidId => {
        const span = wedge.span * (weight.get(kidId) / total);
        wedges.set(kidId, { start: cursor, span });
        const angle = cursor + span / 2;
        const radius = radii[depth.get(kidId)];
        positions.set(kidId, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
        cursor += span;
      });
    });

    return positions;
  };

  return solve(solve(null));
}

/**
 * How wide an opening to leave in the ring, as a multiple of its longest chord.
 * Only reached under `arcChainCurl: 'ring'` — a spiral needs no opening, since
 * its ends are on different windings to begin with.
 *
 * A chain is a sequence, not a loop, so the ring must not close — the first and
 * last node have to be visibly further apart than any linked pair, or the eye
 * reads a circuit. Scaling the opening off the longest chord rather than fixing
 * an angle is what makes the shape adapt to length on its own: at three or four
 * nodes this opening is a large share of the circle and the result is a broad
 * open arc, and as nodes are added its share shrinks and the drawing closes up
 * toward a near-complete circuit.
 */
const ARC_CHAIN_OPENING = 1.25;

/**
 * How wide a sequence may run before it is worth curling up, in graph units.
 *
 * A circle is the compact way to draw a LONG sequence and the wrong way to draw
 * a short one — five nodes bent round a ring is a circle nobody asked for, and
 * reads far worse than the same five nodes in a line. So the curl is not a
 * property of the shape, it is what the drawing does when staying flat gets
 * expensive: lay the chain as flat as it can be laid, and curl only as far as
 * it takes to stay inside this width.
 *
 * Roughly ten node-widths — about as much as is legible at one glance. Short
 * chains never reach it and come out as gentle horizontal arcs; long ones curl
 * until they close into the near-complete circuit a long sequence wants.
 *
 * Deliberately NOT the component's own width allowance, though every other
 * threshold in this file is. Tying it to the allowance makes a short chain in a
 * small slot curl, and a chain with only three or four chords cannot reach a
 * full winding — so it lands in the open C this function exists to avoid, which
 * is wider than the coil and taller than the bow at once. A short sequence drawn
 * wide is the better of the two bad options.
 */
const ARC_CHAIN_TARGET_WIDTH = 4000;

/**
 * What a chain curls INTO once it is too long to stay flat: `'spiral'` or
 * `'ring'`. A path has two free ends, so it can coil past itself; only a real
 * cycle has to come back to where it started. See the spiral walk below for
 * why that is worth taking advantage of.
 */
const ARC_CHAIN_CURL = 'spiral';

/**
 * A path laid along a curve of constant turning — the paper's *circular
 * Lombardi drawing* of a chain, every edge an arc meeting the curve at the same
 * angle. Short chains get a shallow bow; long ones coil into a spiral.
 *
 * WHY IT CURVES AT ALL
 * Curling is the COMPACT way to draw a long sequence, and dramatically so. A
 * 20-node sequence laid out in a gentle bow is ~13000px wide and runs off across
 * the canvas; coiled, the same sequence is ~2100px across.
 *
 * WHY A SPIRAL AND NOT A CIRCLE
 * A circle can only be drawn so tightly: it has one turn to spend, so a longer
 * chain has to buy room by growing its radius, and its area goes up with the
 * square of the chain's length. A path has two loose ends and can therefore
 * coil PAST itself — spend another turn instead of another radius — so its area
 * tracks the length instead. At 50 nodes the spiral is a quarter of the ring's
 * area. It also settles openness for free: a ring of a path has to be held open
 * by a deliberate gap or the eye reads a circuit, whereas a spiral's two ends
 * are on different windings and can never meet.
 *
 * The cost is real and worth stating: on a coil the edges take every angle, so
 * the labels down the left and right sides are close to vertical. That is
 * inherent to the shape rather than a defect in the placement — no rotation of
 * a coil levels all of its tangents. What the rotation DOES control is where
 * the sequence begins, so it begins at the top of the outermost winding, where
 * the tangent is horizontal and there is most room, and winds inward: the
 * reader meets the first few connections at their most readable.
 */
function arcChainLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  if (nodes.length <= 2) return chainLayoutCentered(nodes, edges, cfg, meta);

  // Same walk chainLayoutCentered does — start from an endpoint and follow.
  let startId = meta.startId && nodeById.has(meta.startId) ? meta.startId : null;
  if (!startId) {
    startId = nodes.find(n => (adjacency.get(n.id) || new Set()).size <= 1)?.id || nodes[0].id;
  }
  const order = [startId];
  const seen = new Set([startId]);
  let current = startId;
  for (;;) {
    const next = Array.from(adjacency.get(current) || []).find(id => !seen.has(id));
    if (!next) break;
    order.push(next);
    seen.add(next);
    current = next;
  }
  nodes.forEach(node => { if (!seen.has(node.id)) order.push(node.id); });

  // One chord per real edge, given a way of measuring how far the two nodes
  // reach along it. How much a node reaches depends on the direction the chord
  // runs, which is the whole reason there is more than one measure below.
  const chordsWith = (extentsOf) => order.slice(0, -1).map((_, i) => {
    const a = nodeById.get(order[i]);
    const b = nodeById.get(order[i + 1]);
    const edge = lookupEdge(edgeIndex, order[i], order[i + 1]);
    const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
    const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
    return Math.max(cfg.minEdgeLength, extentsOf(a, b, i) + label + gap);
  });

  // No directions known yet — the circumscribed radius is the only safe answer,
  // and a generous one: for a 300x100 node it reserves 158 where a tangential
  // chord needs about 110.
  const worstCase = (a, b) => circumRadius(a) + circumRadius(b);
  // A bow's edges all run within ~20° of level, so measure them as level.
  const level = (a, b) => halfExtentTowards(a, 1, 0) + halfExtentTowards(b, 1, 0);
  // Measured against a placement that already exists.
  const along = (prior) => (a, b, i) => {
    const pa = prior.get(order[i]);
    const pb = prior.get(order[i + 1]);
    return halfExtentTowards(a, pb.x - pa.x, pb.y - pa.y)
      + halfExtentTowards(b, pb.x - pa.x, pb.y - pa.y);
  };

  // Walk the chain round a circle of the given radius, starting at the top.
  // In screen coordinates that is -π/2, the one point on a circle where the
  // tangent is horizontal; increasing the angle runs clockwise, so a sequence
  // always opens with its flattest, most readable connections whether it ends
  // up a gentle bow or a full ring.
  //
  // Each edge gets exactly the angle its own chord needs, and every bit of
  // leftover goes into the opening. Sharing the leftover out around the ring
  // instead (what ringAngles does for a true cycle) would pad every edge
  // equally and quietly narrow the one thing holding the sequence open.
  const walk = (chords, radius) => {
    const steps = chords.map(c => 2 * Math.asin(Math.min(1, c / (2 * radius))));
    let theta = -Math.PI / 2;
    const out = new Map();
    order.forEach((id, i) => {
      out.set(id, { x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
      theta += steps[i] ?? 0;
    });
    return out;
  };

  const spanOf = (placed) => {
    const xs = [...placed.entries()].map(([id, p]) => {
      const { w } = boxOf(nodeById.get(id));
      return [p.x - w / 2, p.x + w / 2];
    });
    return Math.max(...xs.map(x => x[1])) - Math.min(...xs.map(x => x[0]));
  };

  // Radius that leaves a gentle bow rather than a dead straight line: enough
  // curve to still read as a Lombardi drawing, shallow enough that nothing
  // tilts more than about 20° and the whole thing reads left to right.
  const bowRadius = (chords) => chords.reduce((sum, c) => sum + c, 0) * 3;

  const ring = (chords) => walk(chords, solveRingRadius([
    ...chords,
    Math.max(...chords) * (cfg.arcChainOpening ?? ARC_CHAIN_OPENING)
  ]));

  // Walk the chain round an Archimedean spiral, r = r0 + b·θ.
  //
  // WHY A SPIRAL AND NOT A RING, FOR A PATH
  // A ring has one turn to spend, so a long sequence has to buy room by growing
  // its radius, and the drawing gets big in both directions at once. A spiral
  // has as many turns as it likes: it buys room by winding again, at a fixed
  // radial cost per turn. Its area therefore grows with the chain's LENGTH
  // rather than with the square of it, and a long sequence comes out markedly
  // smaller than the same sequence bent round a circle.
  //
  // It also settles the openness problem outright. A ring of a path has to be
  // held open by an explicit gap, or the eye reads a circuit; a spiral's two
  // ends sit at different radii and can never meet, so the shape says
  // "sequence" on its own.
  //
  // `pitch` is the radial distance between successive windings — one node deep
  // plus the gap that keeps a winding clear of the one outside it. It is the
  // only knob: a tighter pitch is more compact and more coiled.
  const spiral = (chords) => {
    // Two boxes offset purely radially clear each other only if the offset
    // beats their width OR their height, and there is an angle — the box's own
    // diagonal — where it has to beat both at once. That diagonal is the
    // circumscribed diameter, so that is the honest floor for the pitch.
    // Using the height alone looked right on the top and bottom of the coil and
    // let the windings run straight through each other down the sides.
    const pitch = 2 * Math.max(...nodes.map(n => circumRadius(n))) + cfg.nodeGap;
    const b = pitch / (2 * Math.PI);
    // Start wide enough that half a turn always spans the longest chord — that
    // is what makes the step search below always terminate inside half a turn.
    const r0 = Math.max(pitch, Math.max(...chords) / 2);
    const at = (theta) => {
      const r = r0 + b * theta;
      return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
    };

    let theta = 0;
    const pts = [at(0)];
    // Walked from the inside out, but READ from the outside in (see below), so
    // the chords have to be consumed back to front. Laying them out forwards
    // and then reversing the points hands every edge its mirror's length — the
    // one long label in a chain lands two-thirds of the way along it instead,
    // which is invisible in any fixture where the labels are all the same.
    [...chords].reverse().forEach(chord => {
      const from = at(theta);
      const reach = (d) => Math.hypot(at(theta + d).x - from.x, at(theta + d).y - from.y);
      // Over half a turn the chord length grows monotonically with the angle,
      // and half a turn spans at least 2·r0 ≥ this chord, so this bisection is
      // always bracketed. Capping the step at half a turn also stops one long
      // label from flinging its edge right round the coil.
      let lo = 0;
      let hi = Math.PI;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (reach(mid) >= chord) hi = mid; else lo = mid;
      }
      theta += hi;
      pts.push(at(theta));
    });

    // Read from the rim inward. The spiral is built from the middle out because
    // that is the end whose radius is known in advance, but it is READ the other
    // way: the sequence should open where the curve is flattest and the room is
    // greatest, and tighten as it goes. Negating x flips the handedness back, so
    // the reversed order still runs clockwise.
    const path = pts.map(p => ({ x: -p.x, y: p.y })).reverse();

    // Rotate the FIRST CONNECTION level, not the first node to 12 o'clock.
    // Putting a node at the top levels the tangent AT that node, but the edge
    // leaving it is a chord, and a chord sits half its own arc off the tangent —
    // 17° at the rim of a twenty-node coil, which is plainly tilted. Aiming at
    // the chord instead costs nothing and lands the opening connection dead
    // level; c0 and c1 straddle the top rather than one of them sitting on it.
    const lead = Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x);
    // Two rotations level it; take the one that puts the coil BELOW its opening,
    // so the sequence still starts at the top and winds down into the drawing.
    // The coil's centre is the origin, so that is just the sign of the first
    // node's y once rotated.
    const heightAfter = (r) => path[0].x * Math.sin(r) + path[0].y * Math.cos(r);
    const rot = heightAfter(-lead) <= 0 ? -lead : -lead + Math.PI;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const out = new Map();
    order.forEach((id, i) => {
      const p = path[i] || path[path.length - 1];
      out.set(id, { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
    });
    return out;
  };

  // ── Bow, or coil? ────────────────────────────────────────────────────────
  // Only those two are worth drawing. Curled all the way the chain is a compact
  // coil; flat, it is a horizontal bow. Everything in between is a big open C,
  // WIDER than the coil and TALLER than the bow at once, because opening a coil
  // up pushes its ends apart faster than it flattens them.
  //
  // The choice is made ONCE, and from the bow's own geometry — a candidate flat
  // shape measured as a flat thing. Deciding it separately inside each
  // refinement pass let the two passes disagree, and the size stopped being
  // monotone in the length of the chain: a nine-node sequence came out narrower
  // than an eight-node one.
  const bowChords = chordsWith(level);
  const bow = walk(bowChords, bowRadius(bowChords));

  if (spanOf(bow) <= (cfg.arcChainTargetWidth ?? ARC_CHAIN_TARGET_WIDTH)) {
    return bow;
  }

  // Committed to curling, refine it the way cycleLayoutCentered and
  // starLayoutCentered do: solve once blind to get bearings, then re-solve
  // measuring each node along the direction its chord actually runs.
  const curl = (cfg.arcChainCurl ?? ARC_CHAIN_CURL) === 'ring' ? ring : spiral;
  const coarse = curl(chordsWith(worstCase));
  return curl(chordsWith(along(coarse)));
}

// ============================================================================
// LAYERED (DAG)
// ============================================================================

/**
 * Sugiyama-style layered layout for directed acyclic graphs — pipelines,
 * dependency chains, derivations. Flow direction is consistent (all edges point
 * the same way), crossings are reduced by barycenter sweeps, and layer gaps use
 * the same label solver as trees.
 */
function layeredLayoutCentered(nodes, edges, cfg) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  const directed = (edges || []).filter(e => e && e.sourceId !== e.destinationId);

  // Break any residual cycles by reversing back edges found in DFS.
  const outgoing = new Map(nodes.map(n => [n.id, []]));
  directed.forEach(e => {
    if (outgoing.has(e.sourceId) && nodeById.has(e.destinationId)) {
      outgoing.get(e.sourceId).push(e.destinationId);
    }
  });
  const state = new Map(); // 0 unvisited, 1 in-stack, 2 done
  const backEdges = new Set();
  const dfs = (id) => {
    state.set(id, 1);
    (outgoing.get(id) || []).forEach(next => {
      const s = state.get(next) || 0;
      if (s === 1) backEdges.add(`${id}|${next}`);
      else if (s === 0) dfs(next);
    });
    state.set(id, 2);
  };
  nodes.forEach(node => { if (!(state.get(node.id) || 0)) dfs(node.id); });

  const arcs = directed.map(e => (
    backEdges.has(`${e.sourceId}|${e.destinationId}`)
      ? { ...e, sourceId: e.destinationId, destinationId: e.sourceId, _reversed: true }
      : e
  ));

  // Longest-path layering: every node sits one below its deepest predecessor.
  const incoming = new Map(nodes.map(n => [n.id, []]));
  const outArcs = new Map(nodes.map(n => [n.id, []]));
  arcs.forEach(arc => {
    if (!incoming.has(arc.destinationId) || !outArcs.has(arc.sourceId)) return;
    incoming.get(arc.destinationId).push(arc.sourceId);
    outArcs.get(arc.sourceId).push(arc.destinationId);
  });

  const layer = new Map();
  const resolveLayer = (id, guard = 0) => {
    if (layer.has(id)) return layer.get(id);
    if (guard > nodes.length) return 0;
    const preds = incoming.get(id) || [];
    const value = preds.length === 0
      ? 0
      : Math.max(...preds.map(p => resolveLayer(p, guard + 1) + 1));
    layer.set(id, value);
    return value;
  };
  nodes.forEach(node => resolveLayer(node.id));

  const layerCount = Math.max(...Array.from(layer.values())) + 1;
  const layers = Array.from({ length: layerCount }, () => []);
  nodes.forEach(node => layers[layer.get(node.id)].push(node.id));

  // Barycenter sweeps to cut crossings.
  const positionInLayer = new Map();
  const reindex = () => layers.forEach(ids => ids.forEach((id, i) => positionInLayer.set(id, i)));
  reindex();

  for (let sweep = 0; sweep < 4; sweep++) {
    const downward = sweep % 2 === 0;
    const range = downward
      ? Array.from({ length: layerCount }, (_, i) => i)
      : Array.from({ length: layerCount }, (_, i) => layerCount - 1 - i);

    range.forEach(index => {
      const neighborsOf = downward ? incoming : outArcs;
      layers[index].sort((a, b) => {
        const bary = (id) => {
          const list = (neighborsOf.get(id) || []).map(x => positionInLayer.get(x)).filter(v => v !== undefined);
          return list.length ? list.reduce((s, v) => s + v, 0) / list.length : positionInLayer.get(id);
        };
        return bary(a) - bary(b);
      });
    });
    reindex();
  }

  const attempt = (vertical) => {
    // Cross-axis placement: pack each layer, then slide it so its center of
    // mass sits under the center of mass of the layer above.
    const crossExtent = (id) => {
      const { w, h } = boxOf(nodeById.get(id));
      return vertical ? w : h;
    };
    const siblingGap = Math.max(cfg.nodeGap, cfg.edgeLabelFontSize * 1.4);

    const cross = new Map();

    // `pairGap` supplies an extra centre-to-centre separation for one specific
    // adjacent pair within a layer. Pass 1 has none; pass 2 fills it in from
    // measured label sweeps. Same contract as the tree's packer.
    const packLayers = (pairGap) => {
      cross.clear();
      layers.forEach((ids, index) => {
        let cursor = 0;
        ids.forEach((id, i) => {
          if (i > 0) {
            const prevId = ids[i - 1];
            // pairGap is centre-to-centre; the cursor walks box edges.
            const wanted = pairGap(prevId, id) - (crossExtent(prevId) + crossExtent(id)) / 2;
            cursor += Math.max(siblingGap, wanted);
          }
          cross.set(id, cursor + crossExtent(id) / 2);
          cursor += crossExtent(id);
        });

        if (index === 0) return;
        // Align to predecessors' average position.
        let want = 0;
        let counted = 0;
        ids.forEach(id => {
          const preds = (incoming.get(id) || []).filter(p => cross.has(p));
          if (preds.length === 0) return;
          want += preds.reduce((s, p) => s + cross.get(p), 0) / preds.length - cross.get(id);
          counted += 1;
        });
        if (counted > 0) {
          const shift = want / counted;
          ids.forEach(id => cross.set(id, cross.get(id) + shift));
        }
      });
    };

    // Layer gaps: an edge spanning k layers divides its requirement across
    // them, so long-range dependencies don't blow the whole diagram apart.
    const collect = () => {
      const levelEdges = Array.from({ length: Math.max(0, layerCount - 1) }, () => []);
      // Successors of one node in the next layer are siblings for the purposes
      // of label collision, exactly as in a tree.
      const fanOf = Array.from({ length: Math.max(0, layerCount - 1) }, () => new Map());
      arcs.forEach(arc => {
        const from = layer.get(arc.sourceId);
        const to = layer.get(arc.destinationId);
        if (from === undefined || to === undefined || to <= from) return;
        const span = to - from;
        const crossDelta = Math.abs((cross.get(arc.destinationId) ?? 0) - (cross.get(arc.sourceId) ?? 0)) / span;
        const edge = lookupEdge(edgeIndex, arc.sourceId, arc.destinationId);
        for (let d = from; d < to; d++) {
          levelEdges[d].push({
            a: nodeById.get(arc.sourceId),
            b: nodeById.get(arc.destinationId),
            edge,
            crossDelta,
            span
          });
        }
        if (span === 1) {
          if (!fanOf[from].has(arc.sourceId)) fanOf[from].set(arc.sourceId, []);
          fanOf[from].get(arc.sourceId).push({
            id: arc.destinationId,
            cross: cross.get(arc.destinationId) ?? 0,
            labelWidth: labelSpanOf(edge, cfg.edgeLabelFontSize)
          });
        }
      });

      const levelSiblings = fanOf.map(byParent => Array.from(byParent.entries())
        .map(([parentId, kids]) => ({
          parentId,
          parentCross: cross.get(parentId) ?? 0,
          kids: kids.sort((a, b) => a.cross - b.cross)
        })));
      return { levelEdges, levelSiblings };
    };

    packLayers(() => 0);
    let { levelEdges, levelSiblings } = collect();
    let gaps = resolveLevelGaps(levelEdges, levelSiblings, cfg, vertical);

    // ── Pass 2: buy label clearance on the cheap axis ────────────────────
    // Without this, a fan whose labels collide could only be fixed by widening
    // the LAYER gap — which every node at that depth pays for. Measured on a
    // six-way fan of short labels, that put every edge at 2.5x the length its
    // own label needed. Spreading the siblings instead costs only that fan.
    // This is the same two-pass structure treeLayoutCentered uses; layered was
    // simply never given it.
    // Layers stay aligned (a DAG node can have several predecessors, so it has
    // no single parent to hang a ragged offset off), so every child's edge runs
    // the gap of the layer above it.
    const required = computeSiblingSeparations(
      levelSiblings,
      id => gaps[(layer.get(id) ?? 0) - 1],
      cfg
    );
    if (required.size > 0) {
      packLayers((aId, bId) => required.get(`${aId}|${bId}`) || required.get(`${bId}|${aId}`) || 0);
      ({ levelEdges, levelSiblings } = collect());
      gaps = resolveLevelGaps(levelEdges, levelSiblings, cfg, vertical);
    }

    const mainAt = [0];
    for (let d = 0; d < layerCount - 1; d++) mainAt.push(mainAt[d] + gaps[d]);

    const positions = new Map();
    nodes.forEach(node => {
      const main = mainAt[layer.get(node.id)] ?? 0;
      const c = cross.get(node.id) ?? 0;
      positions.set(node.id, vertical ? { x: c, y: main } : { x: main, y: c });
    });
    return positions;
  };

  const direction = cfg.treeDirection || 'auto';
  if (direction === 'vertical') return attempt(true);
  if (direction === 'horizontal') return attempt(false);
  return pickBetterFit(attempt(true), attempt(false), nodeById, cfg);
}

/** Keep whichever of two candidate layouts fits the target canvas better. */
function pickBetterFit(a, b, nodeById, cfg) {
  const score = (positions) => {
    const box = bboxOfCenters(positions, nodeById);
    return Math.max(box.width / Math.max(1, cfg.width), box.height / Math.max(1, cfg.height));
  };
  return score(a) <= score(b) ? a : b;
}

// ============================================================================
// FLOATERS + COMPONENT PACKING
// ============================================================================

/** Unconnected nodes: a plain grid, sized to the widest of them. */
function gridBlockCentered(nodes, cfg) {
  const positions = new Map();
  if (nodes.length === 0) return positions;

  const cellW = Math.max(...nodes.map(n => boxOf(n).w)) + cfg.nodeGap;
  const cellH = Math.max(...nodes.map(n => boxOf(n).h)) + cfg.nodeGap;
  const columns = Math.max(1, Math.min(nodes.length, Math.round(Math.sqrt(nodes.length * (cfg.width / Math.max(1, cfg.height))))));

  nodes.forEach((node, index) => {
    positions.set(node.id, {
      x: (index % columns) * cellW,
      y: Math.floor(index / columns) * cellH
    });
  });
  return positions;
}

/** Shelf-pack blocks into rows that wrap at `rowLimit`. */
function shelfPack(blocks, rowLimit, cfg) {
  const placements = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let width = 0;

  blocks.forEach(block => {
    if (cursorX > 0 && cursorX + block.bbox.width > rowLimit) {
      cursorX = 0;
      cursorY += rowHeight + cfg.componentGap;
      rowHeight = 0;
    }
    placements.push({ block, x: cursorX, y: cursorY });
    cursorX += block.bbox.width + cfg.componentGap;
    rowHeight = Math.max(rowHeight, block.bbox.height);
    width = Math.max(width, cursorX - cfg.componentGap);
  });

  return { placements, width, height: cursorY + rowHeight };
}

/**
 * Place independently laid-out components relative to each other.
 *
 * Wrapping strictly at the canvas width is the wrong rule on an infinite pan
 * surface: a row that overshoots by 15% gets broken, and three modest
 * components stack into a tall ribbon nobody can see at once. So instead of
 * one fixed limit, try every break point the block widths actually allow and
 * keep the arrangement that needs the least zooming out to see whole.
 */
function packComponents(blocks, cfg, nodeById) {
  const widest = Math.max(0, ...blocks.map(b => b.bbox.width));

  // Candidate limits: the prefix sums are the only widths at which the
  // wrapping behaviour changes, plus the canvas width itself.
  const candidates = new Set([Math.max(cfg.width, widest)]);
  let running = 0;
  blocks.forEach(block => {
    running += block.bbox.width + cfg.componentGap;
    candidates.add(Math.max(widest, running - cfg.componentGap));
  });

  let best = null;
  let bestScore = Infinity;
  candidates.forEach(limit => {
    const packed = shelfPack(blocks, limit, cfg);
    // "How far would you have to zoom out to see all of it?"
    const score = Math.max(
      packed.width / Math.max(1, cfg.width),
      packed.height / Math.max(1, cfg.height)
    );
    if (score < bestScore) { bestScore = score; best = packed; }
  });

  const placements = best?.placements || [];

  // Shelf-packing leaves `componentGap` between BOUNDING BOXES, which is the
  // right amount of space only for components that fill theirs. A Lombardi
  // component doesn't: rings and radial fans occupy an annulus inside a square,
  // so two of them placed a gap apart present each other with their empty
  // corners and read as a canyon — the gap the eye sees is several times the
  // one that was asked for. Draw them back together until `componentGap` of
  // real, node-to-node space is all that's left. Rectangular components (trees,
  // serpentines) already fill their boxes, so this barely moves them.
  const shifts = condenseBlocks(
    placements.map(({ block, x, y }) => ({
      rects: [...block.positions].map(([id, pos]) => {
        const { w, h } = boxOf(nodeById?.get(id));
        const cx = pos.x + (x - block.bbox.minX);
        const cy = pos.y + (y - block.bbox.minY);
        return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
      })
    })),
    cfg.componentGap
  );

  const merged = new Map();
  placements.forEach(({ block, x, y }, index) => {
    const offsetX = x - block.bbox.minX + shifts[index].dx;
    const offsetY = y - block.bbox.minY + shifts[index].dy;
    block.positions.forEach((pos, id) => {
      merged.set(id, { x: pos.x + offsetX, y: pos.y + offsetY });
    });
  });
  return merged;
}

// ============================================================================
// ENTRY POINTS
// ============================================================================

/**
 * Label breathing room, as a multiple of the label's own font size.
 *
 * A flat pixel value cannot be right at two text sizes at once: 90px is
 * reasonable either side of 70px text and absurd either side of 30px text,
 * and the connection-label size is a user setting. Expressing it in ems makes
 * "comfortable" mean the same thing at every setting.
 *
 * This is the TOTAL along the edge, so the visible gap either side of the text
 * is half of it. Read at that scale it is generous rather than extravagant, and
 * it is deliberately so: an edge whose label runs nearly wall to wall between
 * two nodes is legible in isolation and a smear once the diagram is busy.
 *
 * It is affordable because of the coil. Under the old ring, room bought here was
 * paid for with radius squared; on a spiral it is paid for linearly, so more
 * than doubling this — 40px a side to 88px at a 32px label — grows a twenty-node
 * chain by 11%, and the result is still a fifth smaller than the ring was at the
 * OLD padding. Trees pay for it in height only, stars barely at all.
 */
const LABEL_PADDING_EM = 5.5;

/**
 * Defaults merged with a caller's options, plus the values that are DERIVED
 * from other values rather than fixed.
 *
 * Exported because `PATTERN_LAYOUT_DEFAULTS.labelPadding` on its own is no
 * longer the number the layouts use — anything that wants to reason about the
 * spacing a layout actually applied has to resolve it the same way.
 */
export const resolvePatternConfig = (options = {}) => {
  const cfg = { ...PATTERN_LAYOUT_DEFAULTS, ...options };
  // Only derive it when the caller hasn't asked for a specific value — the
  // force solver passes its own `edgeLabelGap` through as an explicit one.
  if (options.labelPadding === undefined) {
    cfg.labelPadding = Math.round(cfg.edgeLabelFontSize * LABEL_PADDING_EM);
  }
  if (options.componentGap === undefined) {
    cfg.componentGap = Math.round(clusterGapFor(cfg.edgeLabelFontSize));
  }

  // The user's spacing controls. The force solver reads layoutScale through
  // LAYOUT_SCALE_PRESETS (compact 280 / balanced 400 / spacious 550 link
  // distance → ratios below) and the slider through layoutScaleMultiplier;
  // pattern layouts measure distance with their own knobs, so before this
  // NEITHER control did anything once a pattern (or Lombardi / orthogonal)
  // pipeline handled the graph — Compact on a Lombardi tree changed nothing,
  // which read as "the tree is still too spread out no matter what I set".
  // Node boxes and label text keep their real sizes; only the breathing room
  // between them scales, so Compact can never make labels overlap.
  const presetRatio = ({ compact: 0.7, balanced: 1.0, spacious: 1.375 })[cfg.layoutScale] ?? 1.0;
  const multiplier = Math.min(1.6, Math.max(0.5, cfg.layoutScaleMultiplier ?? 1));
  const scale = presetRatio * multiplier;
  if (scale !== 1) {
    cfg.nodeGap = cfg.nodeGap * scale;
    cfg.minEdgeLength = cfg.minEdgeLength * scale;
    cfg.labelPadding = cfg.labelPadding * scale;
    cfg.componentGap = cfg.componentGap * scale;
  }
  return cfg;
};

const resolveConfig = resolvePatternConfig;

/** Wrap a centered layout function as an applyLayout-compatible layout. */
function asTopLeftLayout(fn) {
  return (nodes, edges, options = {}) => {
    if (!nodes || nodes.length === 0) return new Map();
    const cfg = resolveConfig(options);
    const centers = fn(nodes, edges || [], cfg, options.topologyMeta || {});
    return centersToTopLeft(centers, new Map(nodes.map(n => [n.id, n])));
  };
}

export const treeLayout = asTopLeftLayout(treeLayoutCentered);
export const cycleLayout = asTopLeftLayout(cycleLayoutCentered);
export const chainLayout = asTopLeftLayout(chainLayoutCentered);
export const starLayout = asTopLeftLayout(starLayoutCentered);
export const layeredLayout = asTopLeftLayout(layeredLayoutCentered);
export const radialTreeLayout = asTopLeftLayout(radialLayoutCentered);
export const arcChainLayout = asTopLeftLayout(arcChainLayoutCentered);

/**
 * Which layout a topology gets, given how its edges will be DRAWN.
 *
 * Under straight and orthogonal routing this is just TOPOLOGY_LAYOUT — the
 * shape of the graph is the only input.
 *
 * Under Lombardi it is not, and this is only the FIRST of three stages. See
 * lombardiPatternLayout below and the header of services/lombardiLayout.js:
 * Lombardi mode runs its own auto-layout end to end, and what this function
 * returns is the seed that pipeline starts from, not the finished layout.
 */
export function layoutPlanFor(kind, routingStyle) {
  if (routingStyle === 'manhattan' || routingStyle === 'clean') {
    // The mirror image of the Lombardi branch below. Orthogonal routing is paid
    // in BENDS, and a bend is what you get whenever two nodes fail to share a
    // coordinate — so every choice here is made to produce shared rows and
    // columns. See the header of services/orthogonalLayout.js.
    switch (kind) {
      // Ranks give every parent/child pair a shared axis for free. This is why
      // Sugiyama-style layered drawing and orthogonal routing have always gone
      // together.
      case TOPOLOGY.TREE: return 'tree';
      case TOPOLOGY.DAG: return 'layered';
      // One long line is zero-bend but unreadable past a dozen nodes; rows keep
      // the zero bends and cost one per wrap.
      case TOPOLOGY.CHAIN: return 'ortho-serpentine';
      // A circle is Lombardi's best seed and orthogonal's worst — no two
      // vertices on it share anything. A rectangle makes all but four of the
      // ring's edges straight.
      case TOPOLOGY.CYCLE: return 'ortho-ring';
      // Neighbours on four axis-aligned rays: every spoke zero-bend.
      case TOPOLOGY.STAR: return 'ortho-compass';
      // No usable structure — the force solver seeds it and ALIGN does the work.
      default: return TOPOLOGY_LAYOUT[kind];
    }
  }
  if (routingStyle !== 'lombardi') return TOPOLOGY_LAYOUT[kind];
  switch (kind) {
    // §5 of the paper — the Lombardi Spirograph draws hierarchies on concentric
    // circles. Rows are the wrong seed: they cluster a node's neighbours in one
    // direction, and perfect angular resolution then has to fan the edges out
    // against the geometry rather than with it.
    case TOPOLOGY.TREE: return 'radial';
    case TOPOLOGY.DAG: return 'radial';
    // §2 — a path drawn on one circle is a circular Lombardi drawing.
    case TOPOLOGY.CHAIN: return 'arc-chain';
    // CYCLE and STAR already ARE the paper's circular drawings. MESH keeps the
    // force solver as its seed; the refinement stage is what makes it Lombardi.
    default: return TOPOLOGY_LAYOUT[kind];
  }
}

/**
 * Seed a component onto ONE circle, in a given vertex order.
 *
 * This is the geometry of §2's circular Lombardi drawings. The radius is solved
 * from the same label constraint every other layout here uses, so a long
 * relation name opens the circle exactly enough to fit rather than forcing a
 * uniformly huge one.
 */
function circleSeedCentered(nodes, edges, cfg, order) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);
  const ring = order.filter(id => nodeById.has(id));
  if (ring.length === 0) return new Map();
  if (ring.length === 1) return new Map([[ring[0], { x: 0, y: 0 }]]);

  const chords = ring.map((id, i) => {
    const nextId = ring[(i + 1) % ring.length];
    const edge = lookupEdge(edgeIndex, id, nextId);
    const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
    const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
    return Math.max(
      cfg.minEdgeLength,
      circumRadius(nodeById.get(id)) + circumRadius(nodeById.get(nextId)) + label + gap
    );
  });

  const radius = solveRingRadius(chords);
  const angles = ringAngles(chords, radius);
  return new Map(ring.map((id, i) => [id, {
    x: Math.cos(angles[i]) * radius,
    y: Math.sin(angles[i]) * radius
  }]));
}

/**
 * LOMBARDI'S AUTO-LAYOUT. A separate pipeline, not a variant of patternLayout.
 *
 * Reached only when routingStyle === 'lombardi'. Three stages, in order, per
 * connected component:
 *
 *   1. SEED — place the component using the construction the paper uses for its
 *      shape (layoutPlanFor above). This stage solves DISTANCE: nodes far
 *      enough apart that edges and their labels fit, with the extra allowance
 *      arcAwareConfig adds for the bow.
 *
 *   2. REFINE — lombardiRefine. This stage solves ANGLE: it rotates each edge
 *      toward the chord direction that lets a single arc honour BOTH endpoints'
 *      assigned tangents at once. Rotation preserves edge length, so it cannot
 *      undo stage 1. This is the stage that makes the layout Lombardi rather
 *      than merely round.
 *
 *   3. CLEAR — clearArcsOfNodes. The paper requires that an arc touch no vertex
 *      but its own endpoints. Only reachable here, because it is the first
 *      point at which the actual arcs exist to be tested.
 *
 * Components are packed exactly as patternLayout packs them.
 */
/**
 * The narrowest clear space between any two node boxes in a seed.
 *
 * Read as: how much room does this drawing have to give away before something
 * that was separate stops being separate. On a coil it comes out as the gap
 * between windings; on a tree, the gap between neighbouring subtrees. It is a
 * property of the seed rather than of any config value, which is the point —
 * whatever the seed was careful about, this measures.
 *
 * Falls back to the largest node's own size when there is only one box, so a
 * trivial component doesn't end up leashed to zero.
 */
function seedClearance(positions, nodes) {
  const boxes = nodes
    .map(n => ({ p: positions.get(n.id), box: boxOf(n) }))
    .filter(entry => entry.p);
  const fallback = Math.max(...nodes.map(n => circumRadius(n)), 1) * 2;
  if (boxes.length < 2) return fallback;

  let min = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const dx = Math.max(0, Math.abs(a.p.x - b.p.x) - (a.box.w + b.box.w) / 2);
      const dy = Math.max(0, Math.abs(a.p.y - b.p.y) - (a.box.h + b.box.h) / 2);
      min = Math.min(min, Math.hypot(dx, dy));
    }
  }
  // Adjacent nodes on a tight edge can sit almost touching, which would leash
  // the whole component to nothing. The floor keeps the pass useful.
  return Math.max(min, cfgFloorClearance);
}

// Smallest leash worth applying — below this the refinement may as well not run.
const cfgFloorClearance = 60;

/**
 * How much bigger than a tidy tree a radial drawing may be and still be worth
 * having.
 *
 * Concentric rings are the Lombardi-native way to draw a hierarchy, but they
 * are not free, and what they cost depends on the tree. A ring pays the
 * parent-to-child label constraint in RADIUS, and a radius is spent in every
 * direction at once — so a drawing that is d levels deep spans 2·d steps across
 * AND 2·d steps down, where the same tree in rows spends d steps down and packs
 * its leaves across. Deep and bushy, the rings win: later rings have far more
 * circumference to share out than a row has width. Shallow, they lose badly,
 * and measured on ordinary hierarchies with real relation names on the edges
 * they lose by a factor of four or so — which is most of what "Lombardi is too
 * spread out" turns out to mean.
 *
 * So decide it the way the arc chain decides bow-versus-coil: build both and
 * measure, rather than declaring by topology kind. The tolerance is the
 * thumb on the scale for the native shape — radial keeps the seed whenever it
 * is anywhere close, and only loses when it is plainly extravagant.
 */
const LOMBARDI_RADIAL_TOLERANCE = 1.25;

function radialOrTreeSeed(nodes, edges, cfg, meta) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const score = (positions) => {
    const box = bboxOfCenters(positions, nodeById);
    return Math.max(box.width / Math.max(1, cfg.width), box.height / Math.max(1, cfg.height));
  };
  const radial = radialLayoutCentered(nodes, edges, cfg, meta);
  const tidy = treeLayoutCentered(nodes, edges, cfg, meta);
  return score(radial) <= score(tidy) * LOMBARDI_RADIAL_TOLERANCE ? radial : tidy;
}

export function lombardiPatternLayout(nodes, edges, cfg, options = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { components } = detectTopology(nodes, edges || [], options);
  const runFallback = options.fallbackLayout || forceDirectedLayout;
  const blocks = [];
  const floaters = [];

  // One tick per finished component. The nested solver's own ramp is silenced
  // (see the runFallback calls below), so this is the only progress the pattern
  // path emits — monotonic, and actually proportional to work done.
  let componentsDone = 0;
  const reportComponent = () => {
    componentsDone += 1;
    cfg.onProgress?.(Math.min(1, componentsDone / Math.max(1, components.length)));
  };

  components.forEach(component => {
    const kind = component.topology.kind;
    if (kind === TOPOLOGY.SINGLE) {
      floaters.push(component.nodes[0]);
      return;
    }

    const componentCfg = arcAwareConfig({
      ...cfg,
      width: Math.max(cfg.minEdgeLength * 4, cfg.width * Math.sqrt(component.nodes.length / nodes.length)),
      height: Math.max(cfg.minEdgeLength * 4, cfg.height * Math.sqrt(component.nodes.length / nodes.length))
    });

    // ---- 1. SEED ----------------------------------------------------------
    const { adjacency } = buildSimpleGraph(component.nodes, component.simpleEdges || component.edges);
    let positions;

    if (isRegular(component.nodes, adjacency)) {
      // §2, Theorem 1: a regular graph is the case the paper can put on a
      // single circle with perfect angular resolution outright. We take the
      // geometry and skip the existence test — see circularOrder.
      positions = circleSeedCentered(
        component.nodes, component.edges, componentCfg,
        circularOrder(component.nodes, adjacency)
      );
    } else {
      switch (layoutPlanFor(kind, 'lombardi')) {
        case 'radial':
          positions = radialOrTreeSeed(component.nodes, component.edges, componentCfg, component.topology.meta);
          break;
        case 'arc-chain':
          positions = arcChainLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
          break;
        case 'cycle':
          positions = cycleLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
          break;
        case 'star':
          positions = starLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
          break;
        default:
          positions = runFallback(component.nodes, component.edges, {
            ...componentCfg,
            onProgress: null, // see the note on the other runFallback call
            groups: [],
            useExistingPositions: false
          });
      }
    }

    // ---- 2. REFINE (angle) ------------------------------------------------
    // Leashed to the room the seed actually left. Rotation preserves each edge's
    // length but not the drawing's shape, and the corrections COMPOUND along a
    // path, so on a sparse component the far end swings by a large multiple of
    // any single one. Half the seed's tightest non-adjacent clearance is the
    // most a node can move before it starts eating a gap the seed solved for.
    positions = lombardiRefine(positions, component.nodes, component.edges, {
      ...componentCfg,
      maxDrift: seedClearance(positions, component.nodes) / 2,
      ...(options.lombardiRefine || {})
    });

    // ---- 3. CLEAR (arcs vs nodes) -----------------------------------------
    positions = clearArcsOfNodes(positions, component.nodes, component.edges, {
      lombardiCurvature: componentCfg.lombardiCurvature,
      clearancePadding: componentCfg.nodeGap / 4
    });

    reportComponent();

    blocks.push({
      positions,
      bbox: bboxOfCenters(positions, nodeById),
      kind,
      size: component.nodes.length
    });
  });

  if (floaters.length > 0) {
    const positions = gridBlockCentered(floaters, cfg);
    reportComponent();

    blocks.push({
      positions,
      bbox: bboxOfCenters(positions, nodeById),
      kind: TOPOLOGY.SINGLE,
      size: floaters.length
    });
  }

  return centersToTopLeft(packComponents(blocks, cfg, nodeById), nodeById);
}

/**
 * ORTHOGONAL AUTO-LAYOUT. The mirror of lombardiPatternLayout above.
 *
 * Reached only when routingStyle is 'manhattan' or 'clean'. Three stages, in
 * order, per connected component:
 *
 *   1. SEED — the construction whose COORDINATES the routing can exploit
 *      (layoutPlanFor above). Two nodes sharing an x or a y route with zero
 *      bends; two in general position never do.
 *
 *   2. ALIGN — snap near-shared coordinates to exactly-shared ones, under
 *      ordering constraints so nothing overtakes anything else. This is what
 *      turns "roughly a row" into "a row", and it is the only stage that helps
 *      a MESH component, whose force-solver seed is in general position by
 *      construction.
 *
 *   3. CLEAR — against the ROUTED POLYLINE, not the chord. A Manhattan route
 *      turns a corner somewhere the chord never went, so clearing the chord
 *      says nothing about the drawing. Aligned nodes are restricted to their
 *      free axis so this cannot undo stage 2.
 */
export function orthogonalPatternLayout(nodes, edges, cfg, options = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { components } = detectTopology(nodes, edges || [], options);
  const runFallback = options.fallbackLayout || forceDirectedLayout;
  const style = cfg.routingStyle === 'clean' ? 'clean' : 'manhattan';
  const blocks = [];
  const floaters = [];

  let componentsDone = 0;
  const reportComponent = () => {
    componentsDone += 1;
    cfg.onProgress?.(Math.min(1, componentsDone / Math.max(1, components.length)));
  };

  components.forEach(component => {
    const kind = component.topology.kind;
    if (kind === TOPOLOGY.SINGLE) {
      floaters.push(component.nodes[0]);
      return;
    }

    const componentCfg = {
      ...cfg,
      width: Math.max(cfg.minEdgeLength * 4, cfg.width * Math.sqrt(component.nodes.length / nodes.length)),
      height: Math.max(cfg.minEdgeLength * 4, cfg.height * Math.sqrt(component.nodes.length / nodes.length))
    };
    const meta = component.topology.meta || {};

    // ---- 1. SEED ----------------------------------------------------------
    let positions;
    switch (layoutPlanFor(kind, style)) {
      case 'ortho-serpentine':
        positions = serpentineCentered(component.nodes, component.edges, componentCfg, meta);
        break;
      case 'ortho-ring':
        positions = rectRingCentered(component.nodes, component.edges, componentCfg, meta);
        break;
      case 'ortho-compass':
        positions = compassCentered(component.nodes, component.edges, componentCfg, meta);
        break;
      case 'tree':
        positions = treeLayoutCentered(component.nodes, component.edges, componentCfg, meta);
        break;
      case 'layered':
        positions = layeredLayoutCentered(component.nodes, component.edges, componentCfg, meta);
        break;
      default:
        positions = runFallback(component.nodes, component.edges, {
          ...componentCfg,
          onProgress: null,
          groups: [],
          useExistingPositions: false,
          // The solver's own terminal clearance would fight the ALIGN stage
          // below; clearance happens once, at the end, against the real routes.
          clearanceRounds: 0
        });
    }

    // ---- 2. ALIGN ---------------------------------------------------------
    const aligned = alignToLattice(positions, component.nodes, component.edges, componentCfg);
    positions = aligned.centers;

    // ---- 3. CLEAR (routed polylines vs nodes) -----------------------------
    // Alternating, and clearance last. Sliding a node out of one edge's lane
    // can put it inside a neighbour; separating that pair can put it back in
    // the lane. Nothing after the final clearance call may move a node.
    const pathsFor = orthogonalPaths(style, { cleanLaneSpacing: componentCfg.cleanLaneSpacing });
    const clearOpts = {
      padding: componentCfg.nodeGap / 4,
      axisFor: axisRestrictionFor(aligned.alignedX, aligned.alignedY)
    };
    for (let round = 0; round < 3; round++) {
      const step = clearPathsOfNodes(positions, component.nodes, component.edges, pathsFor, clearOpts);
      positions = step.centers;
      if (!step.moved) break;
      positions = separateBoxes(positions, component.nodes, componentCfg, 2);
    }
    positions = clearPathsOfNodes(positions, component.nodes, component.edges, pathsFor, {
      ...clearOpts,
      passes: 8
    }).centers;

    // ---- 4. RE-ALIGN (light) ----------------------------------------------
    // CLEAR and separateBoxes both move nodes by arbitrary amounts, which
    // destroys the EXACT coordinate equality stage 2 established — and exact is
    // the whole point, since a route is only zero-bend when two coordinates
    // match precisely. So tighten once more, with a tolerance small enough
    // (a quarter of the clearance padding's own scale) that the correction
    // cannot push anything back onto an edge.
    const tightened = alignToLattice(positions, component.nodes, component.edges, {
      ...componentCfg,
      snapTolerance: componentCfg.nodeGap / 8,
      edgeSnapTolerance: componentCfg.nodeGap / 8
    });
    positions = tightened.centers;

    reportComponent();

    blocks.push({
      positions,
      bbox: bboxOfCenters(positions, nodeById),
      kind,
      size: component.nodes.length
    });
  });

  if (floaters.length > 0) {
    const positions = gridBlockCentered(floaters, cfg);
    reportComponent();

    blocks.push({
      positions,
      bbox: bboxOfCenters(positions, nodeById),
      kind: TOPOLOGY.SINGLE,
      size: floaters.length
    });
  }

  return centersToTopLeft(packComponents(blocks, cfg, nodeById), nodeById);
}

/**
 * Conditional auto-layout: detect each connected component's shape, lay it out
 * with the layout that fits, and pack the results.
 *
 * A graph that is a taxonomy next to a feedback loop next to twelve floaters
 * gets a tree, a ring, and a grid — not one compromise blob.
 *
 * Anything with no clean structure falls through to the force solver, which is
 * still the right tool for genuinely tangled graphs.
 */
export function patternLayout(nodes, edges, options = {}) {
  if (!nodes || nodes.length === 0) return new Map();
  const cfg = resolveConfig(options);

  // LOMBARDI MODE HAS ITS OWN AUTO-LAYOUT — it does not run the dispatch below.
  //
  // The dispatch below answers one question: "what shape is this, and which
  // layout draws that shape well?" That is the whole job when edges are
  // straight lines. It is not the whole job when they are circular arcs with
  // perfect angular resolution, because that adds an ANGULAR constraint that no
  // amount of picking-the-right-shape satisfies. See lombardiPatternLayout, and
  // the header of services/lombardiLayout.js for the geometry.
  if (cfg.routingStyle === 'lombardi') {
    return lombardiPatternLayout(nodes, edges, cfg, options);
  }
  if (cfg.routingStyle === 'manhattan' || cfg.routingStyle === 'clean') {
    return orthogonalPatternLayout(nodes, edges, cfg, options);
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { components } = detectTopology(nodes, edges || [], options);

  const runFallback = options.fallbackLayout || forceDirectedLayout;
  const blocks = [];
  const floaters = [];

  // One tick per finished component. The nested solver's own ramp is silenced
  // (see the runFallback calls below), so this is the only progress the pattern
  // path emits — monotonic, and actually proportional to work done.
  let componentsDone = 0;
  const reportComponent = () => {
    componentsDone += 1;
    cfg.onProgress?.(Math.min(1, componentsDone / Math.max(1, components.length)));
  };

  components.forEach(component => {
    const kind = component.topology.kind;
    if (kind === TOPOLOGY.SINGLE) {
      floaters.push(component.nodes[0]);
      return;
    }

    const componentCfg = {
      ...cfg,
      // Give each component room proportional to its size rather than the
      // whole canvas, so orientation choices and wrapping stay sensible.
      width: Math.max(cfg.minEdgeLength * 4, cfg.width * Math.sqrt(component.nodes.length / nodes.length)),
      height: Math.max(cfg.minEdgeLength * 4, cfg.height * Math.sqrt(component.nodes.length / nodes.length))
    };

    let positions;
    switch (TOPOLOGY_LAYOUT[kind]) {
      case 'tree':
        positions = treeLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'cycle':
        positions = cycleLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'chain':
        positions = chainLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'star':
        positions = starLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'layered':
        positions = layeredLayoutCentered(component.nodes, component.edges, componentCfg);
        break;
      default:
        positions = runFallback(component.nodes, component.edges, {
          ...componentCfg,
          // The fallback solver reports its own 0 → 1 ramp. Left inherited,
          // every MESH component would drive the bar from 0 to full and back.
          // Components report as a whole, below.
          onProgress: null,
          groups: [],
          useExistingPositions: false
        });
    }

    reportComponent();

    blocks.push({
      positions,
      bbox: bboxOfCenters(positions, nodeById),
      kind,
      size: component.nodes.length
    });
  });

  if (floaters.length > 0) {
    const positions = gridBlockCentered(floaters, cfg);
    reportComponent();

    blocks.push({
      positions,
      bbox: bboxOfCenters(positions, nodeById),
      kind: TOPOLOGY.SINGLE,
      size: floaters.length
    });
  }

  return centersToTopLeft(packComponents(blocks, cfg, nodeById), nodeById);
}

/**
 * Report what patternLayout would do, without moving anything. Useful for UI
 * ("this graph is a tree — lay it out as one?") and for debugging.
 */
export function describeLayoutPlan(nodes, edges, options = {}) {
  const { components, summary } = detectTopology(nodes || [], edges || [], options);
  const routingStyle = options.routingStyle ?? PATTERN_LAYOUT_DEFAULTS.routingStyle;
  return {
    summary,
    routingStyle,
    components: components.map(component => ({
      kind: component.topology.kind,
      confidence: component.topology.confidence,
      layout: layoutPlanFor(component.topology.kind, routingStyle),
      nodeCount: component.nodes.length,
      edgeCount: component.edges.length
    }))
  };
}

export default {
  patternLayout,
  orthogonalPatternLayout,
  lombardiPatternLayout,
  describeLayoutPlan,
  layoutPlanFor,
  radialTreeLayout,
  arcChainLayout,
  treeLayout,
  cycleLayout,
  chainLayout,
  starLayout,
  layeredLayout,
  solveRingRadius,
  PATTERN_LAYOUT_DEFAULTS
};
