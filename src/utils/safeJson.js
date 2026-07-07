/**
 * Prototype-pollution-safe JSON parsing for untrusted input.
 *
 * Files loaded from disk / imports (.redstring, JSON-LD, Cytoscape, Obsidian,
 * etc.) are untrusted: a crafted file could carry `__proto__` / `constructor`
 * / `prototype` keys that pollute the Object prototype chain once the parsed
 * data flows through spreads, Object.assign, or deep merges. JSON.parse's
 * reviver runs bottom-up and deleting these keys (by returning undefined)
 * strips them before the object is assembled.
 *
 * These keys never appear legitimately in Redstring's data model (node/edge
 * fields are ids, names, colors, positions, descriptions), so stripping them
 * is safe.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parse JSON text, dropping any prototype-pollution keys.
 * @param {string} text - Raw JSON string from an untrusted source.
 * @returns {*} The parsed value with dangerous keys removed.
 * @throws {SyntaxError} If the text is not valid JSON (same as JSON.parse).
 */
export function safeJsonParse(text) {
  return JSON.parse(text, (key, value) => (DANGEROUS_KEYS.has(key) ? undefined : value));
}

/**
 * Recursively strip prototype-pollution keys from an already-parsed value.
 * Use when the object did not come through safeJsonParse (e.g. produced by a
 * DOM/XML parser or received over a message channel).
 * @param {*} value
 * @returns {*} The same value, mutated in place, with dangerous keys removed.
 */
export function stripDangerousKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(stripDangerousKeys);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) {
        delete value[key];
      } else {
        stripDangerousKeys(value[key]);
      }
    }
  }
  return value;
}
