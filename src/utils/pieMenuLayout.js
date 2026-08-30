/**
 * Layout for PieMenu's "line mode" — the row of bubbles a connection's menu lays
 * along the edge, offset perpendicular to it.
 *
 * Line mode used to be one row, and one row was enough while a connection had
 * four actions. It now has up to eight (Delete, Define, Palette, Open Definition,
 * Open in Panel, Copy, Paste, Ask The Wizard), several of which come and go with
 * the connection's own state and the clipboard's — so the row's length is not
 * something we can write down, it's something we have to lay out.
 *
 * Past `maxPerRow` the buttons wrap into further rows stacked away from the edge.
 * Every row is centred on the anchor, so the block reads as one menu rather than
 * as ragged lines; rows that would otherwise stack into perfect columns are
 * nudged a quarter step apart (see rowShifts) so the grid reads as rows.
 *
 * Shared by PieMenu (which draws it) and NodeCanvas's focusEdgePieMenuInView
 * (which frames it). They used to each carry their own copy of the geometry,
 * which is exactly the kind of thing that drifts the moment one of them changes.
 */

// Above this, the row wraps. Five bubbles is about as wide as the row can get
// before framing it forces the view to zoom out further than the connection
// itself is legible at.
export const LINE_MODE_MAX_PER_ROW = 5;

// How far adjacent rows are offset along the edge when they'd otherwise align,
// as a fraction of the bubble step. Enough to read as staggered, not enough to
// look like the rows are fanning apart.
export const LINE_MODE_STAGGER_FRACTION = 0.25;

/**
 * Split `count` buttons across as few rows as `maxPerRow` allows, balanced, with
 * the fuller rows first. Row 0 is the row nearest the connection, so a partial
 * row ends up at the top of the stack and the block sits on a full base.
 *
 * @returns {number[]} button count per row, nearest-the-edge first
 */
export function splitIntoRows(count, maxPerRow = LINE_MODE_MAX_PER_ROW) {
  if (!Number.isFinite(count) || count <= 0) return [];
  if (count <= maxPerRow) return [count];

  const rowCount = Math.ceil(count / maxPerRow);
  const base = Math.floor(count / rowCount);
  let remainder = count % rowCount;

  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    rows.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return rows;
}

/**
 * Along-edge offset per row.
 *
 * A row of `c` bubbles centred on the anchor puts its bubbles at (i - (c-1)/2)
 * steps, so odd rows land on whole steps and even rows on half steps: two rows
 * whose counts differ in parity already interleave perfectly and want no help.
 * Two rows of the same parity would stack into columns, so those get pushed a
 * quarter step apart. The whole set is then re-centred on its mean, so nudging
 * rows never slides the block off the anchor.
 */
function rowShifts(rows, step, staggerFraction) {
  if (rows.length < 2) return rows.map(() => 0);

  const raw = [0];
  for (let r = 1; r < rows.length; r += 1) {
    const wouldAlign = (rows[r] % 2) === (rows[r - 1] % 2);
    const nudge = wouldAlign ? (r % 2 === 1 ? 1 : -1) * step * staggerFraction : 0;
    raw.push(raw[r - 1] + nudge);
  }

  const mean = raw.reduce((sum, v) => sum + v, 0) / raw.length;
  return raw.map(v => v - mean);
}

/**
 * Positions for a line-mode menu, relative to the anchor (the edge midpoint).
 *
 * @param {object}  opts
 * @param {number}  opts.count            how many buttons to place
 * @param {number}  opts.angle            edge slope in radians (PieMenu's anchorAngle)
 * @param {number}  opts.step             centre-to-centre spacing along a row
 * @param {number}  opts.perpOffset       distance from the edge to row 0
 * @param {number}  opts.rowGap           centre-to-centre spacing between rows
 * @param {number} [opts.maxPerRow]
 * @param {number} [opts.staggerFraction]
 * @returns {Array<{x:number, y:number, row:number, col:number, rowCount:number}>}
 *          offsets in canvas units, in button order
 */
export function lineModeLayout({
  count,
  angle = 0,
  step,
  perpOffset,
  rowGap,
  maxPerRow = LINE_MODE_MAX_PER_ROW,
  staggerFraction = LINE_MODE_STAGGER_FRACTION,
}) {
  const rows = splitIntoRows(count, maxPerRow);
  if (rows.length === 0) return [];

  const shifts = rowShifts(rows, step, staggerFraction);

  // Along-edge unit vector, and the perpendicular pointing to the upward side.
  // anchorAngle is always in [-π/2, π/2], so this is guaranteed to be "up".
  const alongX = Math.cos(angle);
  const alongY = Math.sin(angle);
  const perpX = Math.sin(angle);
  const perpY = -Math.cos(angle);

  const positions = [];
  rows.forEach((rowSize, row) => {
    const perp = perpOffset + row * rowGap;
    for (let col = 0; col < rowSize; col += 1) {
      const along = (col - (rowSize - 1) / 2) * step + shifts[row];
      positions.push({
        x: along * alongX + perp * perpX,
        y: along * alongY + perp * perpY,
        row,
        col,
        rowCount: rowSize,
      });
    }
  });
  return positions;
}

/**
 * Canvas-space bounds of a line-mode menu anchored at (anchorX, anchorY),
 * including the anchor itself so the connection stays framed with its buttons.
 * `radius` is the bubble radius padded around each centre.
 */
export function lineModeBounds(anchorX, anchorY, radius, opts) {
  const positions = lineModeLayout(opts);
  let minX = anchorX;
  let maxX = anchorX;
  let minY = anchorY;
  let maxY = anchorY;

  for (const p of positions) {
    minX = Math.min(minX, anchorX + p.x - radius);
    maxX = Math.max(maxX, anchorX + p.x + radius);
    minY = Math.min(minY, anchorY + p.y - radius);
    maxY = Math.max(maxY, anchorY + p.y + radius);
  }
  return { minX, maxX, minY, maxY };
}
