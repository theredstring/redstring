/**
 * The one gate for colours that come from graph data.
 *
 * A Thing's colour is written by whoever wrote the file (or the Wizard turn),
 * and it lands in CSS: inline styles, a `cssText` string, a gradient. A value
 * like `red;background:url(https://tracker)` or `url(...)` turns a colour field
 * into a network beacon or a layout takeover. So colour values are checked
 * against the shapes a colour can actually take, and anything else is refused.
 *
 * Pure string matching, no DOM: this runs at import, in Wizard tools (some of
 * which run in Node for the MCP server), and at render.
 */

const NAMED_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen', 'transparent', 'currentcolor'
]);

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// A number, optionally a percentage or an angle unit (hsl hue).
const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?(?:%|deg|rad|grad|turn)?';
// rgb()/rgba()/hsl()/hsla() with three numeric args and an optional alpha,
// in either the comma syntax or the space-and-slash syntax.
const FUNC = new RegExp(
  `^(?:rgba?|hsla?)\\(\\s*${NUM}\\s*(?:,\\s*${NUM}\\s*,\\s*${NUM}\\s*(?:,\\s*${NUM}\\s*)?` +
  `|\\s${NUM}\\s+${NUM}\\s*(?:\\/\\s*${NUM}\\s*)?)\\)$`,
  'i'
);

/** Longest colour string accepted. The longest legal form is well under this. */
const MAX_COLOR_LENGTH = 96;

/**
 * @param {unknown} value
 * @param {*} [fallback=null] returned when the value isn't a plain colour
 * @returns {string|*} the trimmed colour, or `fallback`
 */
export const sanitizeColor = (value, fallback = null) => {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (!v || v.length > MAX_COLOR_LENGTH) return fallback;
  // Belt and braces: none of these can appear in a legal colour of the shapes
  // below, but refusing them up front keeps the intent obvious.
  if (/url\(|expression|var\(|[;{}\\"'<>]/i.test(v)) return fallback;
  if (HEX.test(v)) return v;
  if (NAMED_COLORS.has(v.toLowerCase())) return v;
  if (FUNC.test(v)) return v;
  return fallback;
};

/**
 * A colour as a bare six-digit hex, for code that builds CSS by appending alpha
 * bytes to it (`${color}80`). Hex forms are expanded or trimmed; anything that
 * isn't a safe hex colour returns `fallback`.
 */
export const toHex6Color = (value, fallback = null) => {
  const safe = sanitizeColor(value);
  if (!safe || safe[0] !== '#') return fallback;
  if (safe.length === 7) return safe;
  if (safe.length === 4 || safe.length === 5) {
    return `#${safe[1]}${safe[1]}${safe[2]}${safe[2]}${safe[3]}${safe[3]}`;
  }
  return safe.slice(0, 7);
};

/** True when `value` is a colour sanitizeColor would keep. */
export const isSafeColor = (value) => sanitizeColor(value) !== null;
