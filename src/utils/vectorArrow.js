/**
 * A vector's arrow over its letter (r⃗, U+20D7), measured for drawing rather
 * than left to the font: EmOne has no glyph for the mark and shows a boxed ?
 * in its place. The equations (formulaObjects arrowOver), a node's title and
 * a Thing-group's tab (VectorText.jsx) all draw this one arrow.
 */

/** A vector's arrow, written after its letter (F⃗). */
export const VECTOR_MARK = '⃗';

// The arrow, in the letter's em.
export const ARROW_RISE = 0.14;     // above the letter's top
export const ARROW_INSET = 0.08;    // in from either side of the letter
export const ARROW_HEAD = 0.13;
export const ARROW_STROKE = 0.065;

const REF = 100;
const FONT = `bold ${REF}px EmOne, sans-serif`;

let ctx = null;
function measureCtx() {
  if (ctx === null) {
    try {
      // undefined, not null, when there's no 2D context: null means "not tried yet".
      ctx = (typeof document !== 'undefined' && document.createElement('canvas').getContext('2d')) || undefined;
    } catch { ctx = undefined; }
  }
  return ctx;
}

/** A name with its vector marks taken out, as it is measured. */
export const unmarked = (text) => String(text).split(VECTOR_MARK).join('');

/**
 * A name in runs of plain text and arrowed letters:
 * 'derivative(r⃗, t)' -> [{ text: 'derivative(' }, { text: 'r', vector: true }, { text: ', t)' }].
 * A mark with no letter before it is dropped.
 */
export function vectorRuns(text) {
  const s = String(text ?? '');
  if (!s.includes(VECTOR_MARK)) return [{ text: s }];
  const runs = [];
  let plain = '';
  const chars = Array.from(s);
  chars.forEach((ch, i) => {
    if (ch === VECTOR_MARK) return;
    if (chars[i + 1] === VECTOR_MARK) {
      if (plain) runs.push({ text: plain });
      plain = '';
      runs.push({ text: ch, vector: true });
    } else plain += ch;
  });
  if (plain) runs.push({ text: plain });
  return runs;
}

/**
 * Where the arrow over a letter goes, in the letter's em (EmOne, bold), from
 * where the letter starts and from its baseline: the shaft from `x1` for
 * `len`, `y` above the baseline; the letter `w` wide; the font reaching
 * `descent` below the baseline (an inline box's bottom).
 */
export function vectorArrow(letter) {
  let w = 0.62, above = 0.72, descent = 0.25;
  const c = measureCtx();
  if (c) {
    c.font = FONT;
    const m = c.measureText(letter);
    w = m.width / REF;
    if (Number.isFinite(m.actualBoundingBoxAscent)) above = m.actualBoundingBoxAscent / REF;
    if (Number.isFinite(m.fontBoundingBoxDescent)) descent = m.fontBoundingBoxDescent / REF;
  }
  const x1 = ARROW_INSET;
  const x2 = Math.max(w - ARROW_INSET, ARROW_INSET + 0.3);
  return { x1, len: x2 - x1, y: above + ARROW_RISE, w, descent, head: ARROW_HEAD, stroke: ARROW_STROKE };
}

/** How wide a run of text is, in its em (EmOne, bold). */
export function textWidthEm(text) {
  if (!text) return 0;
  const c = measureCtx();
  if (!c) return text.length * 0.62;
  c.font = FONT;
  return c.measureText(text).width / REF;
}

/**
 * How far below a line's middle its baseline is, in its em: where SVG text
 * set on its central baseline puts the letters' feet.
 */
export function centralDrop() {
  const c = measureCtx();
  if (!c) return 0.35;
  c.font = FONT;
  const m = c.measureText('x');
  if (!Number.isFinite(m.fontBoundingBoxAscent)) return 0.35;
  return (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 / REF;
}
