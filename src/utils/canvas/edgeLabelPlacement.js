
/**
 * Edge label placement strategies and utilities
 * Extracted from NodeCanvas.jsx to improve maintainability
 */

import { getNodeHitbox } from './nodeHitbox.js';
import { arcPointAt } from './edgeRouting.js';

// Inflate a rectangle by padding
export const inflateRect = (rect, pad) => ({
    minX: rect.minX - pad,
    minY: rect.minY - pad,
    maxX: rect.maxX + pad,
    maxY: rect.maxY + pad,
});

// Calculate minimum distance from point to rectangle (using minX/maxX format)
export const pointToRectDistance = (x, y, rect) => {
    const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
    const dy = Math.max(rect.minY - y, 0, y - rect.maxY);
    return Math.sqrt(dx * dx + dy * dy);
};

// Check if axis-aligned label rect intersects any obstacle rect (using minX/maxX format)
export const rectIntersectsAny = (rect, obstacles) => {
    for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        const sep = rect.maxX < o.minX || rect.minX > o.maxX || rect.maxY < o.minY || rect.minY > o.maxY;
        if (!sep) return true;
    }
    return false;
};

// Deterministic tiny lane offset to reduce parallel overlaps for clean routing
export const hashString = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
};

// Build a rounded SVG path from ordered polyline points
export const buildRoundedPathFromPoints = (pts, r = 8) => {
    if (!pts || pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        // For first and last segments, just draw straight line; corners handled via quadratic joins
        if (i < pts.length - 1) {
            const next = pts[i + 1];
            // Determine the approach point before the corner and the exit point after the corner
            // Move back from curr by radius along prev->curr, and forward from curr by radius along curr->next
            const dx1 = curr.x - prev.x;
            const dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x;
            const dy2 = next.y - curr.y;
            const backX = curr.x - Math.sign(dx1) * r;
            const backY = curr.y - Math.sign(dy1) * r;
            const fwdX = curr.x + Math.sign(dx2) * r;
            const fwdY = curr.y + Math.sign(dy2) * r;
            d += ` L ${backX},${backY} Q ${curr.x},${curr.y} ${fwdX},${fwdY}`;
        } else {
            d += ` L ${curr.x},${curr.y}`;
        }
    }
    return d;
};

// Estimate text width heuristically for label fit checks
/**
 * Snap a label's rotation into a bucket.
 *
 * Purely a rendering-cost measure, and a large one: the browser keys its glyph
 * atlas on the rotation matrix, so N labels at N distinct angles means N cache
 * misses on every paint, while N labels sharing a handful of angles is nearly
 * free. Collapsing the angles is what makes a few hundred labels affordable.
 * See CONNECTION LABEL RENDERING BUDGETS in NodeCanvas.jsx for the numbers.
 *
 * A quantum of 0 (or anything non-positive) means "leave the angle alone",
 * which is what the caller should pass when there are too few labels on screen
 * to trouble the atlas.
 *
 * @param {number} degrees
 * @param {number} quantum bucket size in degrees
 * @returns {number}
 */
export const quantizeAngle = (degrees, quantum) => (
  quantum > 0 ? Math.round(degrees / quantum) * quantum : degrees
);

export const estimateTextWidth = (text, fontSize = 24) => {
    // Rough average width per character ~0.55 * fontSize for typical sans fonts
    const avgCharWidth = fontSize * 0.55;
    return Math.max(16, text.length * avgCharWidth);
};

// Build inflated obstacle rects from visible nodes to avoid placing labels over nodes
// Refactored to accept state as arguments rather than closure
export const getVisibleObstacleRects = (nodes, visibleNodeIds, baseDimsById, pad = 18, selectedNodeIds = new Set()) => {
    const rects = [];
    // Handle case where nodes might be null/undefined
    if (!nodes) return rects;

    for (const node of nodes) {
        if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;

        // For baseDimsById, it might be a Map or object depending on implementation
        const dims = baseDimsById.get ? baseDimsById.get(node.id) : baseDimsById[node.id];
        if (!dims) continue;

        // Use accurate hitbox calculation (includes selection stroke)
        const isSelected = selectedNodeIds.has(node.id);
        const hitbox = getNodeHitbox(node, dims, isSelected);

        rects.push(inflateRect(hitbox, pad));
    }
    return rects;
};

// Try to place label directly on the path (horizontal segments preferred)
const tryPathPlacement = (pathPoints, textWidth, textHeight, obstacles) => {
    const candidates = [];
    const minSegmentLength = Math.max(64, textWidth + 24);

    for (let i = 0; i < pathPoints.length - 1; i++) {
        const a = pathPoints[i];
        const b = pathPoints[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.hypot(dx, dy);

        if (segLen < minSegmentLength) continue;

        const isHorizontal = Math.abs(dy) < 0.5;
        const isVertical = Math.abs(dx) < 0.5;

        // Prefer horizontal, then vertical, then diagonal
        let priority = 0;
        let angle = 0;
        if (isHorizontal) {
            priority = 3;
            angle = 0;
        } else if (isVertical) {
            priority = 2;
            angle = 90;
        } else {
            priority = 1;
            angle = Math.atan2(dy, dx) * (180 / Math.PI);
        }

        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;

        // Try small offsets perpendicular to the segment
        const perpX = -dy / segLen; // perpendicular unit vector
        const perpY = dx / segLen;

        const offsets = [0, 12, -12, 24, -24];
        for (const offset of offsets) {
            const testX = cx + perpX * offset;
            const testY = cy + perpY * offset;

            const rect = {
                minX: testX - textWidth / 2,
                maxX: testX + textWidth / 2,
                minY: testY - textHeight / 2,
                maxY: testY + textHeight / 2,
            };

            if (!rectIntersectsAny(rect, obstacles)) {
                const score = priority * 100 + segLen - Math.abs(offset);
                candidates.push({ x: testX, y: testY, angle, score });
            }
        }
    }

    if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0];
    }

    return null;
};

// Try to place label parallel to the overall path direction, offset to the side
const tryParallelPlacement = (pathPoints, textWidth, textHeight, obstacles) => {
    if (pathPoints.length < 2) return null;

    const start = pathPoints[0];
    const end = pathPoints[pathPoints.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    if (length < 10) return null;

    const dirX = dx / length;
    const dirY = dy / length;
    const perpX = -dirY; // perpendicular
    const perpY = dirX;

    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    // Try different parallel offsets
    const offsets = [40, -40, 60, -60, 80, -80];
    for (const offset of offsets) {
        const testX = midX + perpX * offset;
        const testY = midY + perpY * offset;

        const rect = {
            minX: testX - textWidth / 2,
            maxX: testX + textWidth / 2,
            minY: testY - textHeight / 2,
            maxY: testY + textHeight / 2,
        };

        if (!rectIntersectsAny(rect, obstacles)) {
            return { x: testX, y: testY, angle, score: 50 - Math.abs(offset) * 0.1 };
        }
    }

    return null;
};

// Try perpendicular placement (good for short connections)
const tryPerpendicularPlacement = (pathPoints, textWidth, textHeight, obstacles) => {
    if (pathPoints.length < 2) return null;

    const start = pathPoints[0];
    const end = pathPoints[pathPoints.length - 1];
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    // Try horizontal placement above/below the midpoint
    const offsets = [30, -30, 50, -50, 70, -70];
    for (const offset of offsets) {
        const testX = midX;
        const testY = midY + offset;

        const rect = {
            minX: testX - textWidth / 2,
            maxX: testX + textWidth / 2,
            minY: testY - textHeight / 2,
            maxY: testY + textHeight / 2,
        };

        if (!rectIntersectsAny(rect, obstacles)) {
            return { x: testX, y: testY, angle: 0, score: 30 - Math.abs(offset) * 0.1 };
        }
    }

    return null;
};

// Try stacking with labels that have similar direction/axis
const tryStackedPlacement = (pathPoints, textWidth, textHeight, obstacles, edgeId, placedLabels) => {
    if (pathPoints.length < 2 || !placedLabels || placedLabels.size === 0) return null;

    const start = pathPoints[0];
    const end = pathPoints[pathPoints.length - 1];
    const pathAngle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
    const normalizedAngle = ((pathAngle % 180) + 180) % 180; // 0-180 range

    // Find labels with similar direction (within 15 degrees)
    const similarLabels = [];
    placedLabels.forEach((labelData, id) => {
        if (id === edgeId) return;
        const labelAngle = labelData.position.angle || 0;
        const normalizedLabelAngle = ((labelAngle % 180) + 180) % 180;
        const angleDiff = Math.min(
            Math.abs(normalizedAngle - normalizedLabelAngle),
            180 - Math.abs(normalizedAngle - normalizedLabelAngle)
        );

        if (angleDiff < 15) { // Similar direction
            similarLabels.push(labelData);
        }
    });

    if (similarLabels.length === 0) return null;

    // Try stacking near similar labels
    for (const similarLabel of similarLabels) {
        const stackOffsets = [
            { x: 0, y: textHeight + 8 },    // Stack below
            { x: 0, y: -(textHeight + 8) }, // Stack above
            { x: textWidth + 12, y: 0 },    // Stack right
            { x: -(textWidth + 12), y: 0 }  // Stack left
        ];

        for (const offset of stackOffsets) {
            const testX = similarLabel.position.x + offset.x;
            const testY = similarLabel.position.y + offset.y;

            const rect = {
                minX: testX - textWidth / 2,
                maxX: testX + textWidth / 2,
                minY: testY - textHeight / 2,
                maxY: testY + textHeight / 2,
            };

            if (!rectIntersectsAny(rect, obstacles)) {
                return {
                    x: testX,
                    y: testY,
                    angle: similarLabel.position.angle || 0,
                    score: 40 - Math.abs(offset.x) * 0.05 - Math.abs(offset.y) * 0.05
                };
            }
        }
    }

    return null;
};

// Fallback placement at path midpoint with best available offset
const getFallbackPlacement = (pathPoints, textWidth, textHeight, obstacles) => {
    let totalLen = 0;
    const lens = [];
    for (let i = 0; i < pathPoints.length - 1; i++) {
        const a = pathPoints[i];
        const b = pathPoints[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        lens.push(len);
        totalLen += len;
    }

    let t = totalLen / 2;
    let x = pathPoints[0]?.x || 0;
    let y = pathPoints[0]?.y || 0;
    for (let i = 0; i < pathPoints.length - 1; i++) {
        if (t <= lens[i]) {
            const a = pathPoints[i];
            const b = pathPoints[i + 1];
            const u = lens[i] === 0 ? 0 : t / lens[i];
            x = a.x + (b.x - a.x) * u;
            y = a.y + (b.y - a.y) * u;
            break;
        } else {
            t -= lens[i];
        }
    }

    // Try various offsets to find the least problematic placement
    const offsets = [
        { x: 0, y: 0 }, { x: 0, y: -20 }, { x: 0, y: 20 },
        { x: -30, y: 0 }, { x: 30, y: 0 },
        { x: -25, y: -15 }, { x: 25, y: -15 },
        { x: -25, y: 15 }, { x: 25, y: 15 }
    ];

    for (const offset of offsets) {
        const testX = x + offset.x;
        const testY = y + offset.y;
        const rect = {
            minX: testX - textWidth / 2,
            maxX: testX + textWidth / 2,
            minY: testY - textHeight / 2,
            maxY: testY + textHeight / 2,
        };

        if (!rectIntersectsAny(rect, obstacles)) {
            return { x: testX, y: testY, angle: 0, score: 0 };
        }
    }

    // Ultimate fallback - just place it at midpoint
    return { x, y, angle: 0, score: 0 };
};

// ---------------------------------------------------------------------------
// Orthogonal (Manhattan / Clean) label placement
//
// The generic strategy stack below was written for straight center-to-center
// edges and is actively wrong for routed polylines: its on-path strategy
// requires a segment longer than the whole label, so at real connection font
// sizes (~59px → ~330px of text) almost every orthogonal segment is rejected
// and placement falls through to the *chord*-based strategies. Those measure
// direction from endpoint to endpoint — a diagonal — and shove the label 40-80px
// off to the side. That is why labels in these modes end up tilted and floating
// away from the line they belong to.
//
// The functions here instead keep the label ON the polyline, always axis-aligned
// with the segment it sits on, and only ever nudge it by a fraction of a line
// height when it has to dodge something.
// ---------------------------------------------------------------------------

const MIN_ANCHOR_SEGMENT = 24; // px — shorter than this reads as a stub, not a run

/**
 * How much of `rect` is buried under the obstacles, in square pixels.
 *
 * A COUNT of collisions would be nearly as discontinuous as the boolean it
 * replaces: a label sliding off the corner of a node drops from 1 to 0 in one
 * step. Area goes to zero smoothly as the label clears, which is the whole
 * point — it makes "least bad" a continuous function of position, so a label
 * with nowhere good to go drifts rather than teleports.
 */
const overlapArea = (rect, obstacles) => {
    let area = 0;
    for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        const w = Math.min(rect.maxX, o.maxX) - Math.max(rect.minX, o.minX);
        if (w <= 0) continue;
        const h = Math.min(rect.maxY, o.maxY) - Math.max(rect.minY, o.minY);
        if (h <= 0) continue;
        area += w * h;
    }
    return area;
};

/**
 * Rank one candidate placement against the best so far.
 *
 * OVERLAP first, then crossings, then score.
 *
 * Overlap leads because covering a node or another label is worse than having a
 * line drawn across you. It also has to lead for compatibility: every candidate
 * that used to survive the old hard reject has overlap 0, so among those this
 * degrades exactly to the previous (crossings, score) ordering and places them
 * identically. The ordering only decides anything new in the case that used to
 * have no answer at all.
 *
 * That case is why this changed. Candidates that collided were previously
 * discarded outright, and a label with no free spot fell through to the bare
 * midpoint of its arc — discarding every dodge and landing hundreds of pixels
 * from wherever it had been. As geometry moved under a drag, a label would cross
 * that threshold and teleport, then teleport back. Ranking the bad candidates
 * instead of dropping them means the worst that happens now is the label slides
 * to the least-buried spot on its own connection and stays there.
 *
 * Crossings keep their place ahead of the score for the original reason: the
 * score mixes quantities with no common unit — a segment's length in pixels, a
 * flat bonus for being horizontal, a penalty for drifting off centre — so any
 * weight chosen for "a connection runs through this label" would be arbitrary at
 * one graph scale and wrong at another.
 */
const betterPlacement = (overlap, crossings, score, best) => (
    overlap !== best.overlap ? overlap < best.overlap
        : crossings !== best.crossings ? crossings < best.crossings
            : score > best.score
);

// Break a polyline into scored, orientation-tagged segments (longest first).
const describeSegments = (pathPoints) => {
    const segments = [];
    if (!pathPoints || pathPoints.length < 2) return segments;

    // Distance from the start of the whole polyline, so a chosen spot can be
    // expressed as one fraction of the whole route rather than as an index into
    // this list — the list is about to be sorted by length, and the route it
    // came from can change shape (an L becomes a two-bend, a segment collapses)
    // while the label is expected to stay put. See ANCHORS below.
    let walked = 0;

    for (let i = 0; i < pathPoints.length - 1; i++) {
        const a = pathPoints[i];
        const b = pathPoints[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) continue;

        const isHorizontal = Math.abs(dy) < 0.5;
        const isVertical = Math.abs(dx) < 0.5;
        // Axis-aligned segments get an exact axis angle — never the measured
        // atan2, which can carry a fraction of a degree of float noise and make
        // an otherwise level label look subtly crooked.
        const angle = isHorizontal ? 0
            : isVertical ? 90
                : Math.atan2(dy, dx) * (180 / Math.PI);

        segments.push({
            a, b, length, angle, startLength: walked,
            // Horizontal runs read best, then vertical; diagonals are a last resort.
            orientationBonus: isHorizontal ? 400 : isVertical ? 200 : 0,
        });
        walked += length;
    }
    const totalLength = walked;
    segments.forEach(s => { s.totalLength = totalLength; });
    return segments.sort((p, q) => q.length - p.length);
};

// ---------------------------------------------------------------------------
// ANCHORS
//
// Solving a label's position is far too expensive to redo per frame, so a drag
// uses the cheap placer instead — which knows nothing about what the expensive
// one decided and puts the label back on the midpoint of its line. A label that
// had been moved aside to clear a node, another label or a connection therefore
// snapped back to the covered spot the instant you picked a node up, and
// snapped forward again when you let go.
//
// An anchor is the ANSWER to that solve, in coordinates that survive the line
// moving: how far along the route, and how far off it. Re-evaluating one is a
// couple of multiplications, so the drag can carry the chosen placement for the
// whole gesture at no meaningful cost, and nothing jumps at either end.
// ---------------------------------------------------------------------------

/** Evaluate a `{t, offset}` anchor against a polyline. */
export const anchorOnPolyline = (pathPoints, t, offset) => {
    const segments = describeSegments(pathPoints);
    if (segments.length === 0) {
        const p = pathPoints?.[0] || { x: 0, y: 0 };
        return { x: p.x, y: p.y, angle: 0 };
    }
    // describeSegments sorts by length; walk in route order instead.
    const inOrder = segments.slice().sort((p, q) => p.startLength - q.startLength);
    const total = inOrder[inOrder.length - 1].startLength + inOrder[inOrder.length - 1].length;
    const target = Math.max(0, Math.min(1, t)) * total;

    let seg = inOrder[inOrder.length - 1];
    for (const candidate of inOrder) {
        if (target <= candidate.startLength + candidate.length) { seg = candidate; break; }
    }

    const local = seg.length > 0
        ? Math.max(0, Math.min(1, (target - seg.startLength) / seg.length))
        : 0;
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    return {
        x: seg.a.x + dx * local + (-dy / seg.length) * offset,
        y: seg.a.y + dy * local + (dx / seg.length) * offset,
        angle: seg.angle,
    };
};

/**
 * Label bounding box in canvas space: the true axis-aligned bounds of a
 * textWidth x textHeight rectangle rotated to `angle` about (x, y).
 *
 * This used to snap the angle to "horizontal or vertical" and reserve one of two
 * boxes. On the axes that is exact, which is why manhattan never showed the
 * problem — but a Lombardi label follows its arc's tangent and is almost never
 * on an axis, and there the approximation understates the box badly in the
 * direction that matters. A 392x59 label tilted 12 degrees is really 139px tall;
 * the old box claimed 59. Every consumer of this rect then believed a label
 * three times thinner than the one being drawn.
 *
 * The visible consequence was on parallel connections. Their arcs are fanned a
 * fixed lane apart (100px at the default spacing), so with the true height the
 * placer can see they collide and will slide them apart along their arcs; with
 * the understated one it saw 41px of clearance, left every label at its arc
 * midpoint, and drew them overlapping.
 *
 * Reduces exactly to the old result at 0 and 90 degrees, so nothing that was
 * already axis-aligned moves.
 */
const labelRectFor = (x, y, textWidth, textHeight, angle) => {
    const rad = (angle * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    const halfW = (textWidth * c + textHeight * s) / 2;
    const halfH = (textWidth * s + textHeight * c) / 2;
    return { minX: x - halfW, maxX: x + halfW, minY: y - halfH, maxY: y + halfH };
};

/**
 * The same box, for callers outside this module that have to register the space
 * a label they just drew now occupies (NodeCanvas does, per edge, per render).
 * Exported so there is one definition of "how much room does this label take"
 * rather than a second hand-rolled copy that can drift from this one — which is
 * exactly how the render came to register an always-horizontal box for labels
 * this module had already placed at a tilt.
 */
export const labelBoundsFor = labelRectFor;

/**
 * Label box height as a multiple of the font size.
 *
 * The renderer registers each placed label at 1.1x, so the placers have to
 * reserve 1.1x too. They used to reserve a flat 1x, which sounds harmless and
 * is not: a placer that believes labels are 10% shorter than the boxes they
 * later occupy will happily call two of them clear of each other and then watch
 * them touch. Same failure as labelBoundsFor's, one dimension down — two
 * definitions of how big a label is, drifting apart.
 */
export const LABEL_BOX_LINE_HEIGHT = 1.1;

// ---------------------------------------------------------------------------
// CONNECTIONS AS OBSTACLES
//
// A label sitting under another connection's line is the one collision the
// placer could not see. Nodes and other labels are rectangles and were already
// dodged; a connection is a polyline, and nothing tested against it — so a label
// could be struck through by a line belonging to a different relation entirely,
// and the only cue that anything was wrong was that it had become unreadable.
//
// The placer already knows how to move — it walks a ladder of positions along
// its own line. All it was missing was a reason to reject the one it was
// landing on. That is what this section supplies.
//
// COST. Every candidate position must be tested against every OTHER connection
// on screen, and the ladder is ~35 candidates per label. Done naively that is
// O(E²) per pass with a large constant, which at a few hundred connections is
// well past the frame budget. So segments go into a uniform grid once per pass
// and each candidate only ever looks at the cells its own box covers, which
// makes the test proportional to what is genuinely nearby.
// ---------------------------------------------------------------------------

/**
 * Grid cell size, in canvas pixels.
 *
 * Sized against a label, not a connection: cells much smaller than a label mean
 * every query touches many of them, and cells much larger mean every query
 * pulls in segments nowhere near it. A connection label is a couple of hundred
 * pixels wide at the default font, so this lands a typical query on a 2×2 or
 * 3×2 block.
 */
const SEGMENT_CELL_SIZE = 220;

const cellKey = (cx, cy) => `${cx},${cy}`;

/**
 * Index a graph's drawn connections for label-crossing queries.
 *
 * @param {Map<string, Array<{x:number,y:number}>>} polylinesByEdgeId - the
 *   geometry actually drawn, per edge. For arcs, pass a sampling.
 * @returns {{cells: Map, cellSize: number}|null} null when there is nothing to
 *   index, which callers treat as "skip the crossing test entirely".
 */
export const buildEdgeSegmentIndex = (polylinesByEdgeId, cellSize = SEGMENT_CELL_SIZE) => {
    if (!polylinesByEdgeId || polylinesByEdgeId.size === 0) return null;
    const cells = new Map();

    const add = (cx, cy, segment) => {
        const key = cellKey(cx, cy);
        const bucket = cells.get(key);
        if (bucket) bucket.push(segment); else cells.set(key, [segment]);
    };

    polylinesByEdgeId.forEach((points, edgeId) => {
        if (!points || points.length < 2) return;
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            const segment = { edgeId, ax: a.x, ay: a.y, bx: b.x, by: b.y };

            // Walk only the cells the segment actually passes through. Using the
            // segment's bounding box instead would be far simpler and quite
            // wrong for the long diagonals Lombardi produces: a corner-to-corner
            // line would claim every cell in the rectangle it spans, and each of
            // those cells would then hand the segment back to queries it comes
            // nowhere near.
            let cx = Math.floor(a.x / cellSize);
            let cy = Math.floor(a.y / cellSize);
            const lastCx = Math.floor(b.x / cellSize);
            const lastCy = Math.floor(b.y / cellSize);
            add(cx, cy, segment);
            if (cx === lastCx && cy === lastCy) continue;

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const stepX = Math.sign(dx);
            const stepY = Math.sign(dy);
            // Parametric distance to the next cell boundary on each axis, and
            // how much of the parameter one whole cell costs. Standard grid
            // traversal: advance whichever boundary comes first.
            let tMaxX = dx === 0 ? Infinity
                : ((cx + (stepX > 0 ? 1 : 0)) * cellSize - a.x) / dx;
            let tMaxY = dy === 0 ? Infinity
                : ((cy + (stepY > 0 ? 1 : 0)) * cellSize - a.y) / dy;
            const tDeltaX = dx === 0 ? Infinity : Math.abs(cellSize / dx);
            const tDeltaY = dy === 0 ? Infinity : Math.abs(cellSize / dy);

            // Bounded by the cells the segment spans; the guard is only there so
            // a NaN coordinate can't spin forever.
            let guard = 4096;
            while ((cx !== lastCx || cy !== lastCy) && guard-- > 0) {
                if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDeltaX; }
                else { cy += stepY; tMaxY += tDeltaY; }
                add(cx, cy, segment);
            }
        }
    });

    return cells.size > 0 ? { cells, cellSize } : null;
};

/** Does a segment touch an axis-aligned box? Liang-Barsky slab clipping. */
const segmentHitsRect = (segment, rect) => {
    let t0 = 0;
    let t1 = 1;
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;

    const clip = (p, q) => {
        if (p === 0) return q >= 0;          // parallel to this slab
        const r = q / p;
        if (p < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
        }
        return true;
    };

    return clip(-dx, segment.ax - rect.minX)
        && clip(dx, rect.maxX - segment.ax)
        && clip(-dy, segment.ay - rect.minY)
        && clip(dy, rect.maxY - segment.ay);
};

/**
 * How many DISTINCT other connections would strike through a label placed here.
 *
 * A count rather than a boolean because the placer often has no clean spot at
 * all, and one connection across a label is meaningfully better than three.
 */
export const countCrossingEdges = (rect, index, excludeEdgeId) => {
    if (!index) return 0;
    const { cells, cellSize } = index;
    const minCx = Math.floor(rect.minX / cellSize);
    const maxCx = Math.floor(rect.maxX / cellSize);
    const minCy = Math.floor(rect.minY / cellSize);
    const maxCy = Math.floor(rect.maxY / cellSize);

    const crossing = new Set();
    for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
            const bucket = cells.get(cellKey(cx, cy));
            if (!bucket) continue;
            for (let i = 0; i < bucket.length; i++) {
                const segment = bucket[i];
                // A label lies on its OWN connection by design.
                if (segment.edgeId === excludeEdgeId) continue;
                if (crossing.has(segment.edgeId)) continue;
                if (segmentHitsRect(segment, rect)) crossing.add(segment.edgeId);
            }
        }
    }
    return crossing.size;
};

/**
 * Cheap deterministic on-path placement: midpoint of the best segment, no
 * obstacle avoidance. Used per-frame during drags, where running the full
 * avoidance pass for every edge would blow the frame budget — and where the
 * result must still agree with the settled render closely enough that dropping
 * the node doesn't visibly teleport the label.
 */
export const placeLabelOnPath = (pathPoints) => {
    const segments = describeSegments(pathPoints);
    if (segments.length === 0) {
        const p = pathPoints?.[0] || { x: 0, y: 0 };
        return { x: p.x, y: p.y, angle: 0 };
    }
    // Prefer the longest usable run, breaking ties toward better orientation.
    const usable = segments.filter(s => s.length >= MIN_ANCHOR_SEGMENT);
    const pool = usable.length > 0 ? usable : segments;
    let best = pool[0];
    let bestScore = -Infinity;
    for (const seg of pool) {
        const score = seg.length + seg.orientationBonus;
        if (score > bestScore) { bestScore = score; best = seg; }
    }
    return {
        x: (best.a.x + best.b.x) / 2,
        y: (best.a.y + best.b.y) / 2,
        angle: best.angle,
        anchor: {
            t: best.totalLength > 0
                ? (best.startLength + best.length / 2) / best.totalLength
                : 0.5,
            offset: 0,
        },
    };
};

/**
 * Full orthogonal placement: stays on the routed polyline, axis-aligned, and
 * slides ALONG the line before it will step off it. Guaranteed to return a
 * placement (falls back to the plain on-path midpoint).
 */
export const chooseOrthogonalLabelPlacement = (
    pathPoints, connectionName, nodes, visibleNodeIds, baseDimsById,
    placedLabels, fontSize = 24, edgeId = null, selectedNodeIds = new Set(), options = {}
) => {
    const segments = describeSegments(pathPoints);
    if (segments.length === 0) return placeLabelOnPath(pathPoints);

    const textWidth = estimateTextWidth(connectionName, fontSize);
    // One line height for the offset ladder; the slightly taller box the
    // renderer will actually register for collision tests.
    const textHeight = fontSize;
    const boxHeight = fontSize * LABEL_BOX_LINE_HEIGHT;

    // The node obstacle set is identical for every edge in a pass, so a caller
    // placing many labels should build it once and hand it in — rebuilding it
    // per edge was about half the cost of a full label re-solve.
    const obstacles = (options.obstacles || getVisibleObstacleRects(nodes, visibleNodeIds, baseDimsById, 18, selectedNodeIds)).slice();
    if (placedLabels && placedLabels.size > 0) {
        placedLabels.forEach((labelData, id) => {
            if (id !== edgeId && labelData?.rect) obstacles.push(labelData.rect);
        });
    }

    // Slide along the segment first; only then step off it, and never by more
    // than a line height — the label has to stay visually attached to its line.
    const alongFractions = [0.5, 0.42, 0.58, 0.34, 0.66, 0.25, 0.75];
    const perpOffsets = [0, textHeight * 0.6, -textHeight * 0.6, textHeight, -textHeight];

    const usable = segments.filter(s => s.length >= MIN_ANCHOR_SEGMENT);
    const pool = usable.length > 0 ? usable : segments;

    let best = null;
    for (const seg of pool) {
        const dx = seg.b.x - seg.a.x;
        const dy = seg.b.y - seg.a.y;
        const perpX = -dy / seg.length;
        const perpY = dx / seg.length;

        for (const t of alongFractions) {
            const baseX = seg.a.x + dx * t;
            const baseY = seg.a.y + dy * t;

            for (const offset of perpOffsets) {
                const x = baseX + perpX * offset;
                const y = baseY + perpY * offset;
                const rect = labelRectFor(x, y, textWidth, boxHeight, seg.angle);

                // See betterPlacement: least-buried wins rather than
                // free-or-nothing, so a label with no clear spot slides instead
                // of dropping to the midpoint. Early-out skips the crossing
                // query for candidates that already cannot win.
                const overlap = overlapArea(rect, obstacles);
                if (best && overlap > best.overlap) continue;

                const crossings = countCrossingEdges(rect, options.segmentIndex, edgeId);
                const score = seg.length
                    + seg.orientationBonus
                    - Math.abs(t - 0.5) * 300   // hug the middle of the run
                    - Math.abs(offset) * 6;      // and hug the line itself
                if (!best || betterPlacement(overlap, crossings, score, best)) {
                    best = {
                        x, y, angle: seg.angle, score, crossings, overlap, rect,
                        anchor: {
                            t: seg.totalLength > 0
                                ? (seg.startLength + seg.length * t) / seg.totalLength
                                : 0.5,
                            offset,
                        },
                    };
                }
            }
        }
    }

    if (best) return best;

    // Only reachable when there were no usable segments to build candidates
    // from. "Everything collided" is no longer a route to here — that case now
    // takes the least-buried rung of the ladder, which is both on the line and
    // near where the label already was.
    const fallback = placeLabelOnPath(pathPoints);
    const fallbackRect = labelRectFor(fallback.x, fallback.y, textWidth, boxHeight, fallback.angle);
    return {
        ...fallback,
        score: 0,
        overlap: overlapArea(fallbackRect, obstacles),
        crossings: countCrossingEdges(fallbackRect, options.segmentIndex, edgeId),
        rect: fallbackRect,
        anchor: fallback.anchor,
    };
};

// ---------------------------------------------------------------------------
// LOMBARDI (arc) LABEL PLACEMENT
//
// An arc sampled into a polyline is useless to describeSegments: every segment
// is a short diagonal of near-identical length, so the "longest run" score is
// noise and the orientation bonus is always zero. Arcs get their own placer,
// which works in arc PARAMETER space instead — slide along the curve, and step
// off it only radially.
//
// Unlike the orthogonal placer, the angle here follows the tangent rather than
// snapping to an axis. On an arc that IS the readable choice: text set along
// the curve is what makes a Lombardi drawing legible, and a horizontal label on
// a steeply curving arc reads as belonging to nothing.
// ---------------------------------------------------------------------------

// Where along the visible run to try, nearest the middle first.
//
// Longer than the orthogonal placer's ladder because sliding now has to carry
// the work the radial rungs used to (see RADIAL OFFSETS below): these span
// 0.14-0.86 of the run, where the old seven only reached 0.28-0.72 and leant on
// stepping off the curve for anything further.
const ARC_ALONG = [
  0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8, 0.14, 0.86,
];

// RADIAL OFFSETS — a last resort, not a rung. In line heights.
//
// Stepping a label off its curve is qualitatively worse than sliding it along
// one. On a polyline, offsetting reads fine: the label sits parallel to a
// straight run, a line height away, obviously belonging to it. On an ARC it
// lands on a concentric circle of a DIFFERENT radius — a curve the drawing does
// not contain — visibly detached from the connection it names. And a label's
// first job is to say which connection it names.
//
// This placer used to interleave the two, offering all five offsets at every
// position along the arc and letting the ranking sort it out. But the ranking
// sorts by overlap first, so any off-curve candidate that shaved a few square
// pixels off the overlap beat every on-curve one — and overlap fires early,
// since the obstacle set inflates every node by 18px and includes every label
// already placed. Labels ended up off their arcs constantly, including in plenty
// of cases where sliding a little further along would have been clean.
//
// So the arc is searched first, on its own. Only if nothing ON the curve comes
// out clear does this ladder open at all, and its candidates then compete
// against the best on-curve one rather than replacing it.
//
// The trigger is OVERLAP alone, deliberately — not crossings. Overlap means
// something solid is on top of the label: a node, or another label. That is the
// case this tier exists for, and it is the one that has no other answer —
// parallel connections between the same two nodes fan their arcs a lane apart
// and stack their labels, and no amount of sliding separates them. A CROSSING is
// different: it only means a line passes through the label, which in a Lombardi
// drawing is routine and stays readable, and is not worth detaching a label from
// its own connection over. Crossings still rank candidates within each phase, so
// a clean slide that also dodges a line still wins on its own merits.
const ARC_RADIAL_LADDER = [0.6, -0.6, 1, -1];

/** Point, tangent angle and outward radial normal at a parameter on the arc. */
const arcAnchor = (arc, s) => {
    const pt = arcPointAt(arc, s);
    // Radial direction from the circle's centre — the only sensible "off the
    // line" direction on an arc, and it keeps the offset perpendicular to the
    // text baseline the way the orthogonal placer's perpendicular does.
    const nx = (pt.x - arc.cx) / arc.radius;
    const ny = (pt.y - arc.cy) / arc.radius;
    return { ...pt, nx, ny };
};

/**
 * Map a position along the VISIBLE run onto the underlying arc parameter.
 *
 * ARC_ALONG is expressed as "how far along the connection the reader sees", which
 * is only the same as the arc parameter when the whole arc is drawn. See
 * `visibleRange` on the Lombardi descriptor for why they diverge — most sharply
 * against a thing-group anchor, where the group's outer box hides much of the arc.
 */
const arcRangeParam = (range, s) => {
    const t0 = Number.isFinite(range?.t0) ? range.t0 : 0;
    const t1 = Number.isFinite(range?.t1) ? range.t1 : 1;
    return t0 + s * (t1 - t0);
};

export const placeLabelOnArc = (arc, range = null) => {
    if (!arc) return { x: 0, y: 0, angle: 0, anchor: { t: 0.5, offset: 0 } };
    const t = arcRangeParam(range, 0.5);
    const mid = arcPointAt(arc, t);
    return { x: mid.x, y: mid.y, angle: mid.angle, anchor: { t, offset: 0 } };
};

export const chooseArcLabelPlacement = (
    arc, connectionName, nodes, visibleNodeIds, baseDimsById,
    placedLabels, fontSize = 24, edgeId = null, selectedNodeIds = new Set(), options = {}
) => {
    if (!arc) return { x: 0, y: 0, angle: 0 };

    const textWidth = estimateTextWidth(connectionName, fontSize);
    // One line height for the offset ladder; the slightly taller box the
    // renderer will actually register for collision tests.
    const textHeight = fontSize;
    const boxHeight = fontSize * LABEL_BOX_LINE_HEIGHT;

    // See chooseOrthogonalLabelPlacement — prebuilt obstacles when the caller
    // is placing a whole graph's worth of labels.
    const obstacles = (options.obstacles || getVisibleObstacleRects(nodes, visibleNodeIds, baseDimsById, 18, selectedNodeIds)).slice();
    if (placedLabels && placedLabels.size > 0) {
        placedLabels.forEach((labelData, id) => {
            if (id !== edgeId && labelData?.rect) obstacles.push(labelData.rect);
        });
    }

    // Slide along the VISIBLE run, not the whole arc — `s` is a fraction of what
    // the reader can see, and arcRangeParam converts it to an arc parameter.
    const range = options.range;

    let best = null;
    const consider = (s, offset) => {
        const t = arcRangeParam(range, s);
        const anchor = arcAnchor(arc, t);
        const x = anchor.x + anchor.nx * offset;
        const y = anchor.y + anchor.ny * offset;
        const rect = labelRectFor(x, y, textWidth, boxHeight, anchor.angle);

        // Overlap decides first, so a candidate already more buried than the
        // incumbent cannot win however it scores — and skipping it here also
        // skips the crossing query, which is the expensive half. In the
        // common case (a free spot exists early) this runs the query for
        // fewer candidates than the old hard reject did.
        const overlap = overlapArea(rect, obstacles);
        if (best && overlap > best.overlap) return;

        const crossings = countCrossingEdges(rect, options.segmentIndex, edgeId);
        const score = -Math.abs(s - 0.5) * 300 - Math.abs(offset) * 6;
        if (!best || betterPlacement(overlap, crossings, score, best)) {
            best = {
                x, y, angle: anchor.angle, score, crossings, overlap, rect,
                // bowSign: which side of the p→q chord this arc bowed to when
                // the offset was measured, so a later reuse (placeLabelOnRoute,
                // every drag frame) can tell whether the bow has since flipped
                // to the other side — see the sign check there. This has to be
                // chord-relative (arc.delta, not the world-frame radial vector):
                // an ordinary drag continuously rotates the whole chord, which
                // rotates the radial direction right along with it without the
                // bow ever actually changing sides — comparing absolute radial
                // vectors mistook that rotation for a flip and negated the
                // offset on every sufficiently-large sweep.
                // Stored as an ARC parameter, not a visible-run fraction, so
                // placeLabelOnRoute can reuse it every drag frame without
                // needing the range re-derived.
                anchor: { t, offset, bowSign: Math.sign(arc.delta) },
            };
        }
    };

    // ON THE CURVE FIRST — the whole arc, before any thought of leaving it.
    for (const s of ARC_ALONG) consider(s, 0);

    // Off it only when something solid is on top of the label wherever it slides
    // to. See RADIAL OFFSETS for why overlap opens this and crossings do not.
    // The on-curve winner stays in `best`, so an off-curve candidate has to
    // actually beat it, and the score penalty keeps the smallest step that works.
    if (best && best.overlap > 0) {
        for (const s of ARC_ALONG) {
            for (const lineHeights of ARC_RADIAL_LADDER) consider(s, textHeight * lineHeights);
        }
    }

    if (best) return best;

    // Only reachable if the ladder produced no candidates at all (no arc to
    // anchor on). A label that merely had nowhere GOOD to go was handled above,
    // by taking the least-buried rung rather than dropping to here.
    const fallback = placeLabelOnArc(arc, range);
    const fallbackRect = labelRectFor(fallback.x, fallback.y, textWidth, boxHeight, fallback.angle);
    return {
        ...fallback,
        score: 0,
        overlap: overlapArea(fallbackRect, obstacles),
        crossings: countCrossingEdges(fallbackRect, options.segmentIndex, edgeId),
        rect: fallbackRect,
        anchor: fallback.anchor,
    };
};

// ---------------------------------------------------------------------------
// ROUTING-AGNOSTIC ENTRY POINTS
//
// Callers hold a routing descriptor, not a shape. Dispatching here — rather than
// at each of NodeCanvas's two duplicated edge blocks plus the drag updater —
// is what keeps a new routing style from needing another branch in all three.
// ---------------------------------------------------------------------------

/**
 * Cheap deterministic placement. Used per-frame during drags and by the pie menu.
 *
 * Pass the `anchor` from a previous full solve to KEEP that solve's answer as
 * the geometry moves — see ANCHORS above. Without one this falls back to the
 * midpoint of the best run, which is the right default for something that has
 * never been solved but wrong for anything that has: it discards every dodge
 * the expensive placer made.
 */
export const placeLabelOnRoute = (routing, anchor = null) => {
    if (anchor && Number.isFinite(anchor.t)) {
        // Deliberately tolerant about which shape the routing is now. An arc can
        // flatten to a line mid-drag (and a line can bow into an arc), and in
        // both directions the parameter means the same thing — a fraction of the
        // way along — so the anchor survives the transition instead of the label
        // snapping back to the middle at the moment of the change.
        if (routing?.arc) {
            const at = arcPointAt(routing.arc, Math.max(0, Math.min(1, anchor.t)));
            const nx = (at.x - routing.arc.cx) / routing.arc.radius;
            const ny = (at.y - routing.arc.cy) / routing.arc.radius;
            // A Lombardi arc's bow can flip to the other side of the chord
            // between frames — a two-hop edge's tangent fan re-solves live off
            // whichever node is actually being dragged, and at a crowded fan
            // (lots of connections at that node) small bearing changes routinely
            // push a neighbour's demanded curvature through zero and out the
            // other side. When that happens the offset's sign needs negating so
            // the label stays on the same side of the curve (what "dodging that
            // other label/connection" meant) instead of jumping to mirror the
            // flip. The comparison HAS to be chord-relative (arc.delta's sign,
            // matching what the anchor was solved against) rather than the
            // world-frame radial vector: an ordinary drag continuously rotates
            // the whole chord, which rotates the radial direction right along
            // with it with the bow never actually changing sides, so a
            // world-frame comparison flags a flip on every wide sweep.
            const currentSign = Math.sign(routing.arc.delta ?? 0);
            const stillSameSide = !Number.isFinite(anchor.bowSign) || anchor.bowSign === 0
                || currentSign === 0 || currentSign === anchor.bowSign;
            const offset = stillSameSide ? anchor.offset : -anchor.offset;
            return {
                x: at.x + nx * offset,
                y: at.y + ny * offset,
                angle: at.angle,
                anchor,
            };
        }
        if (routing?.points?.length >= 2) {
            return { ...anchorOnPolyline(routing.points, anchor.t, anchor.offset), anchor };
        }
    }
    return routing?.arc
        ? placeLabelOnArc(routing.arc, routing.visibleRange)
        : placeLabelOnPath(routing?.points);
};

/** Full placement with obstacle avoidance. Used by the settled render. */
export const chooseRoutedLabelPlacement = (
    routing, connectionName, nodes, visibleNodeIds, baseDimsById,
    placedLabels, fontSize = 24, edgeId = null, selectedNodeIds = new Set(), options = {}
) => (
    routing?.arc
        // The descriptor knows which stretch of its own arc is actually drawn;
        // the placer must not wander outside it. See `visibleRange`.
        ? chooseArcLabelPlacement(routing.arc, connectionName, nodes, visibleNodeIds,
            baseDimsById, placedLabels, fontSize, edgeId, selectedNodeIds,
            { ...options, range: routing.visibleRange })
        : chooseOrthogonalLabelPlacement(routing?.points, connectionName, nodes, visibleNodeIds,
            baseDimsById, placedLabels, fontSize, edgeId, selectedNodeIds, options)
);

// Main label placement orchestrator
export const chooseLabelPlacement = (pathPoints, connectionName, nodes, visibleNodeIds, baseDimsById, placedLabels, fontSize = 24, edgeId = null, selectedNodeIds = new Set()) => {
    const obstacles = getVisibleObstacleRects(nodes, visibleNodeIds, baseDimsById, 18, selectedNodeIds);
    const textWidth = estimateTextWidth(connectionName, fontSize);
    const textHeight = fontSize * 1;

    // Add existing labels as obstacles
    const allObstacles = [...obstacles];
    if (placedLabels && placedLabels.size > 0) {
        placedLabels.forEach((labelData, id) => {
            if (id !== edgeId) { // Don't avoid our own label
                allObstacles.push(labelData.rect);
            }
        });
    }

    // Strategy 1: Try to place on the path itself
    const pathPlacement = tryPathPlacement(pathPoints, textWidth, textHeight, allObstacles);
    if (pathPlacement) return pathPlacement;

    // Strategy 2: Try parallel placement alongside the path
    const parallelPlacement = tryParallelPlacement(pathPoints, textWidth, textHeight, allObstacles);
    if (parallelPlacement) return parallelPlacement;

    // Strategy 3: Try perpendicular placement at midpoint
    const perpendicularPlacement = tryPerpendicularPlacement(pathPoints, textWidth, textHeight, allObstacles);
    if (perpendicularPlacement) return perpendicularPlacement;

    // Strategy 4: Try stacking with similar direction labels
    const stackedPlacement = tryStackedPlacement(pathPoints, textWidth, textHeight, allObstacles, edgeId, placedLabels);
    if (stackedPlacement) return stackedPlacement;

    // Fallback: midpoint with best available offset
    return getFallbackPlacement(pathPoints, textWidth, textHeight, allObstacles);
};

// ---------------------------------------------------------------------------
// LABEL FRAMES
//
// A connection label is one <text> in one of two forms: CURVED (per-glyph x/y/
// rotate lists, textAnchor start, no transform) or STRAIGHT (single x/y, a
// rotate() transform, textAnchor middle, no rotate list). React owns those
// attributes. A drag rewrites them every frame, behind React's back.
//
// That is fine right up until the drag ends, because of how React updates the
// DOM: it writes only the attributes whose PROPS changed between its own two
// renders. It has no idea this hook has been mutating them. So if the settled
// render happens to produce the same value React last rendered for some
// attribute — which is common, since quantized rotations frequently land in the
// identical buckets after a modest move — React skips that write, and the
// attribute keeps whatever the last drag frame left there. Positions from the
// new geometry, rotations from the old: the label's characters end up at the
// right places pointing the wrong ways, overlapping and unreadable.
//
// The fix is to put the DOM back the way React believes it is before React
// diffs. That requires knowing what React last rendered, and the drag hook used
// to guess by snapshotting the attributes when the drag began. The guess is
// wrong whenever React re-renders DURING the drag — which it does, routinely:
// the drag-zoom-out ramp settles mid-gesture and re-renders every label.
//
// So React states it instead of us inferring it. `labelFrameToken` goes into a
// data attribute on the same element, rendered from the same values as the
// props, and `applyLabelFrame` reads it back. It cannot go stale: if React
// skipped writing the token, the values it encodes did not change either, so it
// still describes the committed props exactly.
// ---------------------------------------------------------------------------

/** The transform a straight label carries. Shared so the token round-trips exactly. */
export const straightLabelTransform = (angle, x, y) => `rotate(${angle}, ${x}, ${y})`;

/**
 * Encode a label's rendered form for `applyLabelFrame` to restore.
 *
 * Curved callers pass the already-joined attribute strings they are handing to
 * the props, so this adds one concatenation rather than a second pass over the
 * glyphs.
 *
 * @param {{x:string,y:string,rotate:string}|null} glyphs joined lists, or null for straight
 * @param {number} x straight-form x (ignored when curved)
 * @param {number} y straight-form y (ignored when curved)
 * @param {number} angle straight-form rotation in degrees (ignored when curved)
 */
export const labelFrameToken = (glyphs, x, y, angle) => (
    glyphs ? `g|${glyphs.x}|${glyphs.y}|${glyphs.rotate}` : `s|${x}|${y}|${angle}`
);

/**
 * Put a label <text> back into the form its token describes.
 *
 * Each form clears the other's attributes on the way in — a leftover `rotate`
 * list scatters a straight label's glyphs, and a leftover `transform` spins a
 * curved one about its first glyph.
 *
 * @returns {boolean} false if the token was missing or malformed, so a caller
 *   can tell "restored" from "nothing to restore".
 */
export const applyLabelFrame = (el, token) => {
    if (!el || typeof token !== 'string') return false;
    const parts = token.split('|');
    if (parts.length !== 4) return false;
    const [form, a, b, c] = parts;

    if (form === 'g') {
        el.setAttribute('x', a);
        el.setAttribute('y', b);
        el.setAttribute('rotate', c);
        el.removeAttribute('transform');
        el.setAttribute('text-anchor', 'start');
        return true;
    }
    if (form === 's') {
        el.setAttribute('x', a);
        el.setAttribute('y', b);
        el.removeAttribute('rotate');
        el.setAttribute('transform', straightLabelTransform(c, a, b));
        el.setAttribute('text-anchor', 'middle');
        return true;
    }
    return false;
};

// NOTE: connection labels are now centered on the visible segment directly by
// clipping each endpoint against its real occluder inside getVisualConnectionEndpoints
// (node hitbox, or a thing-group's full outer box). The old slideLabelOffGroupBox
// nudge-off-box hack was removed in favor of that.
