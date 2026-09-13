/**
 * Is this object a Redstring document at all?
 *
 * The version gate used to default anything without a `format` field to
 * v1.0.0 and "migrate" it. That turned a GitHub contents-API envelope
 * (`{ name, path, sha, size, content: "", encoding: "none", ... }`) into a
 * valid, empty, freshly-migrated universe on 2026-09-12 — the migration
 * write-back then pushed that empty universe over the real one.
 *
 * A document is recognizable when it declares a version OR carries at least
 * one known data section as an object. Every format this app has ever
 * written satisfies that: v4 (`format` + `prototypeSpace`/`spatialGraphs`),
 * v3 (`format` + `legacy`), v2 (`format`), v1 flat files (`nodePrototypes` /
 * `nodes` / `graphs`, no format field).
 *
 * No imports: migrations.js must stay self-contained (it cannot import from
 * redstringFormat.js) and both need this.
 */

export const REDSTRING_SECTION_KEYS = Object.freeze([
  'prototypeSpace',
  'spatialGraphs',
  'nodePrototypes',
  'legacy',
  'graphs',
  'nodes'
]);

export const NOT_A_REDSTRING_DOCUMENT = 'NOT_A_REDSTRING_DOCUMENT';

export function hasRedstringMarkers(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  if (typeof doc.format === 'string' || typeof doc.metadata?.version === 'string') return true;
  return REDSTRING_SECTION_KEYS.some((key) => doc[key] && typeof doc[key] === 'object');
}

export function notARedstringDocument(doc) {
  const keys = doc && typeof doc === 'object' && !Array.isArray(doc)
    ? Object.keys(doc).slice(0, 12).join(', ')
    : (Array.isArray(doc) ? 'array' : typeof doc);
  const error = new Error(
    `Not a Redstring document: no format/version field and no known data section (keys: ${keys || 'none'})`
  );
  error.code = NOT_A_REDSTRING_DOCUMENT;
  return error;
}
