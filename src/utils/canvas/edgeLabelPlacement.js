
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
 * Rank one candidate placement against the best so far.
 *
 * Crossings come FIRST, and not as a weighted term in the score. The score
 * mixes quantities with no common unit — a segment's length in pixels, a flat
 * bonus for being horizontal, a penalty for drifting off centre — so any weight
 * chosen for "a connection runs through this label" would be arbitrary at one
 * graph scale and wrong at another. Ordering on the count instead says the only
 * thing that is actually true at every scale: a spot nothing runs through beats
 * a spot something does, and everything else is a tiebreak.
 */
const betterPlacement = (crossings, score, best) => (
    crossings !== best.crossings ? crossings < best.crossings : score > best.score
);

// Break a polyline into scored, orientation-tagged segments (longest first).
const describeSegments = (pathPoints) => {
    const segments = [];
    if (!pathPoints || pathPoints.length < 2) return segments;

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
            a, b, length, angle,
            // Horizontal runs read best, then vertical; diagonals are a last resort.
            orientationBonus: isHorizontal ? 400 : isVertical ? 200 : 0,
        });
    }
    return segments.sort((p, q) => q.length - p.length);
};

// Label bounding box in canvas space. A vertical label occupies the transpose of
// a horizontal one — the old code always reserved a horizontal box, which both
// over-claimed space sideways and under-claimed it vertically.
const labelRectFor = (x, y, textWidth, textHeight, angle) => {
    const vertical = Math.abs(((angle % 180) + 180) % 180 - 90) < 45;
    const halfW = (vertical ? textHeight : textWidth) / 2;
    const halfH = (vertical ? textWidth : textHeight) / 2;
    return { minX: x - halfW, maxX: x + halfW, minY: y - halfH, maxY: y + halfH };
};

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
    const textHeight = fontSize;

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
                const rect = labelRectFor(x, y, textWidth, textHeight, seg.angle);
                if (rectIntersectsAny(rect, obstacles)) continue;

                const crossings = countCrossingEdges(rect, options.segmentIndex, edgeId);
                const score = seg.length
                    + seg.orientationBonus
                    - Math.abs(t - 0.5) * 300   // hug the middle of the run
                    - Math.abs(offset) * 6;      // and hug the line itself
                if (!best || betterPlacement(crossings, score, best)) {
                    best = { x, y, angle: seg.angle, score, crossings, rect };
                }
            }
        }
    }

    if (best) return best;

    // Everything collided — staying on the line beats drifting into open space,
    // because a label nobody can trace back to its connection is worse than one
    // that overlaps a node.
    const fallback = placeLabelOnPath(pathPoints);
    const fallbackRect = labelRectFor(fallback.x, fallback.y, textWidth, textHeight, fallback.angle);
    return {
        ...fallback,
        score: 0,
        crossings: countCrossingEdges(fallbackRect, options.segmentIndex, edgeId),
        rect: fallbackRect,
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

// Same ladder as the orthogonal placer: hug the middle of the run, then slide.
const ARC_ALONG = [0.5, 0.44, 0.56, 0.36, 0.64, 0.28, 0.72];

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

export const placeLabelOnArc = (arc) => {
    if (!arc) return { x: 0, y: 0, angle: 0 };
    const mid = arcPointAt(arc, 0.5);
    return { x: mid.x, y: mid.y, angle: mid.angle };
};

export const chooseArcLabelPlacement = (
    arc, connectionName, nodes, visibleNodeIds, baseDimsById,
    placedLabels, fontSize = 24, edgeId = null, selectedNodeIds = new Set(), options = {}
) => {
    if (!arc) return { x: 0, y: 0, angle: 0 };

    const textWidth = estimateTextWidth(connectionName, fontSize);
    const textHeight = fontSize;

    // See chooseOrthogonalLabelPlacement — prebuilt obstacles when the caller
    // is placing a whole graph's worth of labels.
    const obstacles = (options.obstacles || getVisibleObstacleRects(nodes, visibleNodeIds, baseDimsById, 18, selectedNodeIds)).slice();
    if (placedLabels && placedLabels.size > 0) {
        placedLabels.forEach((labelData, id) => {
            if (id !== edgeId && labelData?.rect) obstacles.push(labelData.rect);
        });
    }

    const radialOffsets = [0, textHeight * 0.6, -textHeight * 0.6, textHeight, -textHeight];

    let best = null;
    for (const s of ARC_ALONG) {
        const anchor = arcAnchor(arc, s);
        for (const offset of radialOffsets) {
            const x = anchor.x + anchor.nx * offset;
            const y = anchor.y + anchor.ny * offset;
            const rect = labelRectFor(x, y, textWidth, textHeight, anchor.angle);
            if (rectIntersectsAny(rect, obstacles)) continue;

            const crossings = countCrossingEdges(rect, options.segmentIndex, edgeId);
            const score = -Math.abs(s - 0.5) * 300 - Math.abs(offset) * 6;
            if (!best || betterPlacement(crossings, score, best)) {
                best = { x, y, angle: anchor.angle, score, crossings, rect };
            }
        }
    }

    if (best) return best;

    const fallback = placeLabelOnArc(arc);
    const fallbackRect = labelRectFor(fallback.x, fallback.y, textWidth, textHeight, fallback.angle);
    return {
        ...fallback,
        score: 0,
        crossings: countCrossingEdges(fallbackRect, options.segmentIndex, edgeId),
        rect: fallbackRect,
    };
};

// ---------------------------------------------------------------------------
// ROUTING-AGNOSTIC ENTRY POINTS
//
// Callers hold a routing descriptor, not a shape. Dispatching here — rather than
// at each of NodeCanvas's two duplicated edge blocks plus the drag updater —
// is what keeps a new routing style from needing another branch in all three.
// ---------------------------------------------------------------------------

/** Cheap deterministic anchor. Used per-frame during drags and by the pie menu. */
export const placeLabelOnRoute = (routing) => (
    routing?.arc ? placeLabelOnArc(routing.arc) : placeLabelOnPath(routing?.points)
);

/** Full placement with obstacle avoidance. Used by the settled render. */
export const chooseRoutedLabelPlacement = (
    routing, connectionName, nodes, visibleNodeIds, baseDimsById,
    placedLabels, fontSize = 24, edgeId = null, selectedNodeIds = new Set(), options = {}
) => (
    routing?.arc
        ? chooseArcLabelPlacement(routing.arc, connectionName, nodes, visibleNodeIds,
            baseDimsById, placedLabels, fontSize, edgeId, selectedNodeIds, options)
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

// NOTE: connection labels are now centered on the visible segment directly by
// clipping each endpoint against its real occluder inside getVisualConnectionEndpoints
// (node hitbox, or a thing-group's full outer box). The old slideLabelOffGroupBox
// nudge-off-box hack was removed in favor of that.
