/**
 * decodeEntities — undo HTML entity escaping the model wrote into tool args.
 *
 * Models sometimes HTML-escape their own tool arguments, so a connection named
 * "Reduces Separation Rates & Vacancy Duration" arrives as "…Rates &amp; Vacancy…".
 * Nothing downstream renders names as HTML, so the entity would be stored and
 * shown literally. Decoding once at the dispatch boundary fixes every tool.
 *
 * Only the XML entities, &nbsp; and numeric references are decoded; any other
 * "&word;" is left alone. One pass, so "&amp;lt;" becomes "&lt;", not "<".
 *
 * ⚠️ Imported (transitively) by redstring-mcp-server.js — never console.log here.
 */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const ENTITY_RE = /&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g;

function fromCodePoint(code) {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

export function decodeEntities(str) {
  if (typeof str !== 'string' || !str.includes('&')) return str;
  return str.replace(ENTITY_RE, (match, name, dec, hex) => {
    if (name) return NAMED[name];
    return fromCodePoint(dec ? parseInt(dec, 10) : parseInt(hex, 16)) ?? match;
  });
}

/** Decode every string in a tool-args value (objects and arrays walked). */
export function decodeArgEntities(value) {
  if (typeof value === 'string') return decodeEntities(value);
  if (Array.isArray(value)) return value.map(decodeArgEntities);
  if (value && typeof value === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeArgEntities(v);
    return out;
  }
  return value;
}
