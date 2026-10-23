/**
 * A Thing's name with its vectors' arrows drawn (derivative(r⃗, t)): as HTML
 * (a node's title) and as SVG text (a Thing-group's tab). See vectorArrow.js.
 */
import { VECTOR_MARK, vectorRuns, vectorArrow, unmarked, textWidthEm, centralDrop } from '../utils/vectorArrow.js';

/** A vector's arrow: its shaft from x1 to x2 at y, its head at x2, `h` long. */
const arrowPath = (x1, x2, y, h) => `M${x1},${y} L${x2},${y} M${x2 - h},${y - h * 0.7} L${x2},${y} L${x2 - h},${y + h * 0.7}`;

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
          d={arrowPath(x0, x1, pad * s, h)}
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
 * The arrows over a name drawn as SVG text centred on (0, 0) (textAnchor
 * middle, dominantBaseline central), its lines `lineHeight` apart: paths to
 * lay over the text, which is drawn unmarked. Null when it has none.
 */
export function vectorArrowsOver(lines, fontSize, lineHeight) {
  if (!lines.some((l) => String(l).includes(VECTOR_MARK))) return null;
  const paths = [];
  lines.forEach((line, i) => {
    const runs = vectorRuns(line);
    const baseline = (i - (lines.length - 1) / 2) * lineHeight + centralDrop() * fontSize;
    const start = (-textWidthEm(unmarked(line)) * fontSize) / 2;
    let before = '';
    runs.forEach((r, j) => {
      if (r.vector) {
        const a = vectorArrow(r.text);
        const x1 = start + (textWidthEm(before) + a.x1) * fontSize;
        paths.push(
          <path key={`${i}.${j}`} d={arrowPath(x1, x1 + a.len * fontSize, baseline - a.y * fontSize, a.head * fontSize)}
            strokeWidth={a.stroke * fontSize} />,
        );
      }
      before += r.text;
    });
  });
  return paths;
}
