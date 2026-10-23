/**
 * A Thing's name with its vectors' arrows drawn (derivative(r⃗, t)): as HTML
 * (a node's title) and as SVG text (a Thing-group's tab). See vectorArrow.js.
 */
import { vectorRuns, vectorArrow, arrowGlyphAxis } from '../utils/vectorArrow.js';

/** A letter with its arrow over it, in a line of HTML. */
function VectorLetter({ letter }) {
  const a = vectorArrow(letter);
  // The arrow's box, in em: its shaft through the middle, its head's spread above and below.
  const pad = a.head * 0.7 + a.stroke;
  const width = a.len + a.stroke;
  const s = 100; // viewBox units per em
  const x0 = (a.stroke / 2) * s;
  const x1 = x0 + a.len * s;
  const h = a.head * s;
  return (
    <span style={{ position: 'relative' }}>
      {letter}
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${width * s} ${pad * 2 * s}`}
        style={{
          position: 'absolute', overflow: 'visible', pointerEvents: 'none',
          left: `${a.x1 - a.stroke / 2}em`,
          // The span's box ends `descent` below the baseline; the shaft sits `y` above it.
          bottom: `${a.descent + a.y - pad}em`,
          width: `${width}em`, height: `${pad * 2}em`,
        }}
      >
        <path
          d={`M${x0},${pad * s} L${x1},${pad * s} M${x1 - h},${pad * s - h * 0.7} L${x1},${pad * s} L${x1 - h},${pad * s + h * 0.7}`}
          fill="none" stroke="currentColor" strokeWidth={a.stroke * s} strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** A name as HTML, each vector's arrow drawn over its letter. */
export function VectorText({ text }) {
  const runs = vectorRuns(text);
  if (!runs.some((r) => r.vector)) return text;
  return runs.map((r, i) => (r.vector ? <VectorLetter key={i} letter={r.text} /> : r.text));
}

/**
 * A name as the inside of an SVG <text>, each vector's arrow a → drawn first,
 * stretched over where its letter goes and raised above it, then the pen sent
 * back for the letter. Text rather than a path, so the arrow rides along when
 * a drag moves the text by its attributes (useNodeDrag).
 */
export function vectorTspans(text, fontSize) {
  const runs = vectorRuns(text);
  if (!runs.some((r) => r.vector)) return text;
  const glyph = 0.6; // the →, in the letter's em
  const axis = arrowGlyphAxis() * glyph;
  return runs.map((r, i) => {
    if (!r.vector) return r.text;
    const a = vectorArrow(r.text);
    return [
      <tspan key={`${i}a`} data-vector-arrow="" dx={a.x1 * fontSize} fontSize={glyph * fontSize}
        baselineShift={(a.y - axis) * fontSize} textLength={a.len * fontSize} lengthAdjust="spacingAndGlyphs"
      >{'→'}</tspan>,
      <tspan key={i} dx={-(a.x1 + a.len) * fontSize}>{r.text}</tspan>,
    ];
  });
}
