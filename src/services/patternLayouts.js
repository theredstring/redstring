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
  MIN_BOX,
  boxOf,
  halfExtentTowards,
  circumRadius,
  estimateEdgeLabelWidth,
  labelSpanOf,
  requiredEdgeLength
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
  // Extra clearance added around an edge label, along the edge.
  labelPadding: 90,
  // No edge is ever shorter than this, even between two tiny unlabeled nodes.
  minEdgeLength: 260,
  // Must track NodeCanvas: 59.4 × textSettings.fontSize × connectionLabelSize.
  edgeLabelFontSize: 59.4,

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

  // Gap between independently laid-out connected components.
  componentGap: 460,

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
 * Turn per-level edge lists into main-axis gaps.
 *
 * For each edge we already know its cross-axis offset (the horizontal shift
 * between parent and child in a vertical tree). The required straight-line
 * length L and that offset give the main-axis component by Pythagoras:
 *
 *     gap >= sqrt(L² - Δcross²)
 *
 * An edge that already runs far sideways needs less vertical room; a straight
 * parent-above-child edge needs the whole label length. Taking the max over
 * every edge crossing a level yields the tightest gap that still fits every
 * label at that depth.
 */
function resolveLevelGaps(levelEdges, levelSiblings, cfg, vertical) {
  return levelEdges.map((edgesAtLevel, depth) => {
    let gap = cfg.minEdgeLength;

    edgesAtLevel.forEach(({ a, b, edge, crossDelta, span = 1 }) => {
      const dirX = vertical ? crossDelta : 1;
      const dirY = vertical ? 1 : crossDelta;
      const required = requiredEdgeLength(a, b, edge, cfg, dirX, dirY) / Math.max(1, span);
      const mainComponent = Math.sqrt(Math.max(0, required * required - crossDelta * crossDelta));
      const floor = vertical
        ? (boxOf(a).h + boxOf(b).h) / 2 + cfg.nodeGap
        : (boxOf(a).w + boxOf(b).w) / 2 + cfg.nodeGap;
      gap = Math.max(gap, mainComponent, floor);
    });

    return Math.max(gap, solveSiblingLabelGap(levelSiblings?.[depth], cfg, gap));
  });
}

/**
 * Centre-to-centre cross separation each adjacent sibling pair needs so their
 * two labels don't overlap, given the level gaps already solved.
 *
 * Labels sit at edge midpoints and every edge in a fan leaves the same parent,
 * so two adjacent labels are only half as far apart as their children are —
 * hence the factor of 2 when converting the requirement back to child spacing.
 *
 * @returns {Map<string, number>} "childA|childB" → required separation
 */
function computeSiblingSeparations(levelSiblings, gaps, cfg) {
  const required = new Map();
  const lineHeight = cfg.edgeLabelFontSize * 1.2;

  levelSiblings.forEach((groups, depth) => {
    const gap = gaps[depth];
    if (!gap) return;

    groups.forEach(({ parentCross, kids }) => {
      for (let i = 1; i < kids.length; i++) {
        const a = kids[i - 1];
        const b = kids[i];
        const sweep = (kid) => {
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

    // Collect the edges crossing each level, plus each parent's fan of
    // children (cross position + label width) so the gap solver can check
    // adjacent siblings' labels for collision.
    const collect = () => {
      const levelEdges = Array.from({ length: maxDepth }, () => []);
      const levelSiblings = Array.from({ length: maxDepth }, () => []);
      children.forEach((kids, parentId) => {
        if (kids.length === 0) return;
        const d = depth.get(parentId);
        if (d >= maxDepth) return;
        const parent = nodeById.get(parentId);
        const fan = [];
        kids.forEach(kidId => {
          const edge = lookupEdge(edgeIndex, parentId, kidId);
          levelEdges[d].push({
            a: parent,
            b: nodeById.get(kidId),
            edge,
            crossDelta: Math.abs(cross.get(kidId) - cross.get(parentId))
          });
          fan.push({
            id: kidId,
            cross: cross.get(kidId),
            labelWidth: labelSpanOf(edge, cfg.edgeLabelFontSize)
          });
        });
        fan.sort((a, b) => a.cross - b.cross);
        levelSiblings[d].push({ parentId, parentCross: cross.get(parentId), kids: fan });
      });
      return { levelEdges, levelSiblings };
    };

    let { levelEdges, levelSiblings } = collect();
    let gaps = resolveLevelGaps(levelEdges, levelSiblings, cfg, vertical);

    // ── Pass 2: buy label clearance on the cheap axis ────────────────────
    // A fan whose labels collide can be fixed two ways: steepen the fan (widen
    // the LEVEL gap) or spread the siblings (widen the CROSS gap). The level
    // gap is shared by every node at that depth, so one bad fan pays across
    // the whole diagram — on a sentence diagram that measured +65% width.
    // Widening the siblings costs only that fan. So compute what separation
    // each colliding pair actually needs, repack with it, and let the level
    // solver mop up whatever remains.
    const required = computeSiblingSeparations(levelSiblings, gaps, cfg);
    if (required.size > 0) {
      pack((aId, bId) => {
        const need = required.get(`${aId}|${bId}`) || required.get(`${bId}|${aId}`);
        if (!need) return 0;
        // `need` is centre-to-centre; the packer wants box-edge separation.
        return need - (crossExtent(aId) + crossExtent(bId)) / 2;
      });
      ({ levelEdges, levelSiblings } = collect());
      gaps = resolveLevelGaps(levelEdges, levelSiblings, cfg, vertical);
    }

    const mainAt = [0];
    for (let d = 0; d < maxDepth; d++) mainAt.push(mainAt[d] + gaps[d]);

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
      const d = depth.get(node.id);
      const main = mainAt[d] * sign;
      const c = cross.get(node.id) ?? 0;
      positions.set(node.id, vertical ? { x: c, y: main } : { x: main, y: c });
    });
    return positions;
  };

  const direction = cfg.treeDirection || 'auto';
  if (direction === 'vertical') return attempt(true);
  if (direction === 'horizontal') return attempt(false);

  // 'auto': lay out both ways, keep whichever fits the canvas better. With
  // long labels the level axis stretches, so the better orientation is the one
  // that spends that stretch on the canvas's longer side.
  return pickBetterFit(attempt(true), attempt(false), nodeById, cfg);
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

    let radius = cfg.minEdgeLength;
    satellites.forEach((id, i) => {
      const edge = lookupEdge(edgeIndex, hubId, id);
      const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
      const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
      radius = Math.max(radius, radial(hub, i) + radial(nodeById.get(id), i) + label + gap);
    });

    const chords = satellites.map((id, i) => {
      const nextIndex = (i + 1) % satellites.length;
      return tangential(nodeById.get(id), i)
        + tangential(nodeById.get(satellites[nextIndex]), nextIndex)
        + cfg.nodeGap;
    });
    radius = Math.max(radius, solveRingRadius(chords));
    return { radius, angles: ringAngles(chords, radius) };
  };

  const coarse = solve(null);
  const directional = solve(coarse.angles);

  const positions = new Map([[hubId, { x: 0, y: 0 }]]);
  satellites.forEach((id, i) => {
    positions.set(id, {
      x: Math.cos(directional.angles[i]) * directional.radius,
      y: Math.sin(directional.angles[i]) * directional.radius
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
 * Inflate the spacing constraints to account for arcs rather than chords.
 *
 * An arc subtending 2δ is δ/sin δ times as long as its chord, and bulges
 * (L/2)·tan(δ/2) away from it. The first matters because labels are laid along
 * the edge, so the edge has to be longer to fit the same text; the second
 * because the bow can swing into a neighbour that a straight line would clear.
 */
function arcAwareConfig(cfg) {
  if (cfg.routingStyle !== 'lombardi') return cfg;
  const delta = Math.min(MAX_LAYOUT_DELTA, REPRESENTATIVE_DELTA * (cfg.lombardiCurvature ?? 1));
  if (delta < 1e-3) return cfg;
  const alongFactor = delta / Math.sin(delta);
  const bowFactor = 1 + Math.tan(delta / 2);
  return {
    ...cfg,
    minEdgeLength: cfg.minEdgeLength * alongFactor,
    labelPadding: cfg.labelPadding * alongFactor,
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
 * A path laid around a circle instead of serpentined across the canvas — the
 * paper's *circular Lombardi drawing* of a chain, with all vertices on one
 * circle and every edge an arc meeting it at a constant angle.
 *
 * One gap is left open so the sequence reads as a sequence and not a loop, and
 * so the first and last node don't end up as neighbours.
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

  // Chords for the real edges, then one deliberately wide chord to hold the
  // circle open between the last node and the first.
  const chords = [];
  for (let i = 0; i < order.length - 1; i++) {
    const a = nodeById.get(order[i]);
    const b = nodeById.get(order[i + 1]);
    const edge = lookupEdge(edgeIndex, order[i], order[i + 1]);
    const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
    const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
    chords.push(Math.max(cfg.minEdgeLength, circumRadius(a) + circumRadius(b) + label + gap));
  }
  chords.push(Math.max(...chords) * 1.5);

  const radius = solveRingRadius(chords);
  const angles = ringAngles(chords, radius);
  return new Map(order.map((id, i) => [id, {
    x: Math.cos(angles[i]) * radius,
    y: Math.sin(angles[i]) * radius
  }]));
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
    const required = computeSiblingSeparations(levelSiblings, gaps, cfg);
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
function packComponents(blocks, cfg) {
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

  const merged = new Map();
  (best?.placements || []).forEach(({ block, x, y }) => {
    const offsetX = x - block.bbox.minX;
    const offsetY = y - block.bbox.minY;
    block.positions.forEach((pos, id) => {
      merged.set(id, { x: pos.x + offsetX, y: pos.y + offsetY });
    });
  });
  return merged;
}

// ============================================================================
// ENTRY POINTS
// ============================================================================

const resolveConfig = (options) => ({ ...PATTERN_LAYOUT_DEFAULTS, ...options });

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
          positions = radialLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
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
    positions = lombardiRefine(positions, component.nodes, component.edges, {
      ...componentCfg,
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

  return centersToTopLeft(packComponents(blocks, cfg), nodeById);
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

  return centersToTopLeft(packComponents(blocks, cfg), nodeById);
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

  return centersToTopLeft(packComponents(blocks, cfg), nodeById);
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
