/**
 * nodeSize - Shared vocabulary for the wizard's node-size controls.
 *
 * The canvas stores per-instance size as `instance.sizeMul`, a continuous float
 * layered on top of the user's global node-size scope (see NODE_SIZE_STEPS in
 * constants.js and the 'change-size' pie-menu button in NodeCanvas.jsx). The
 * wizard exposes only the five named steps so the model never invents a
 * multiplier — it picks a word, we map it to the same value the pie menu writes.
 *
 * Medium (1.0) is the default and is deliberately NOT serialized: a spec with no
 * size, an unrecognized size, or an explicit "medium" all produce `undefined`,
 * which leaves the instance at its default and keeps the .redstring file clean
 * (redstringFormat only writes redstring:sizeMultiplier when it differs from 1).
 */

import { NODE_SIZE_STEPS, NODE_SIZE_DEFAULT_INDEX } from '../../../constants.js';

/** Canonical names, indexed to match NODE_SIZE_STEPS. */
export const NODE_SIZE_NAMES = ['extra-small', 'small', 'medium', 'large', 'extra-large'];

export const DEFAULT_NODE_SIZE_NAME = NODE_SIZE_NAMES[NODE_SIZE_DEFAULT_INDEX];

/**
 * Accepted spellings → index into NODE_SIZE_NAMES / NODE_SIZE_STEPS.
 * Keys are normalized (lowercased, whitespace/underscores → hyphens) before lookup,
 * so "Extra Large", "extra_large" and "extra-large" all land on the same entry.
 */
const SIZE_ALIASES = {
  'extra-small': 0, 'xs': 0, 'x-small': 0, 'tiny': 0, 'smallest': 0,
  'small': 1, 's': 1,
  'medium': 2, 'm': 2, 'default': 2, 'normal': 2, 'regular': 2,
  'large': 3, 'l': 3, 'big': 3,
  'extra-large': 4, 'xl': 4, 'x-large': 4, 'huge': 4, 'largest': 4
};

/** Shared description for the optional `size` field on node specs. */
export const NODE_SIZE_FIELD_DESC =
  'Optional visual size: "extra-small", "small", "medium", "large", or "extra-large". ' +
  'Defaults to "medium". Size is a regular part of composing a web, not a rare exception — ' +
  'reach for it in most graphs. Two frames, in order: size by REAL SCALE when the subject has ' +
  'one (a Galaxy is "extra-large", a Grain of Sand "extra-small"); otherwise size by IMPORTANCE ' +
  'within this web (the one or two anchor concepts "large", peripheral detail "small"). ' +
  'Leave the middle of the distribution at "medium" and omit the field there — a graph where ' +
  'every node is the same size says nothing, and one where every node differs is noise. ' +
  'A typical web of 8-12 nodes uses two or three of the steps.';

/**
 * Strip an inline `{size}` marker out of a shorthand string.
 *
 * sketchGraph's node shorthand is a bare string, so size rides along in braces the
 * same way a type rides along in brackets: "Sun {large}", "Ceres [Dwarf Planet] {small}".
 * Braces are used rather than another bracket pair so the two markers can coexist in
 * either order without the type regex swallowing the size.
 *
 * @param {string} str
 * @returns {{ text: string, size: string|null, unknown: string|null }}
 *   `size` is the canonical name; `unknown` carries an unrecognized token so the
 *   caller can warn rather than silently dropping what the model asked for.
 */
export function parseSizeShorthand(str) {
  const text = String(str ?? '');
  const match = text.match(/\{\s*([^{}]+?)\s*\}/);
  if (!match) return { text: text.trim(), size: null, unknown: null };

  const stripped = (text.slice(0, match.index) + text.slice(match.index + match[0].length))
    .replace(/\s+/g, ' ')
    .trim();
  const resolved = resolveNodeSize(match[1]);
  return resolved
    ? { text: stripped, size: resolved.name, unknown: null }
    : { text: stripped, size: null, unknown: match[1] };
}

/**
 * Resolve a user/model-supplied size word to its canonical name and multiplier.
 * @param {string} size - Any accepted spelling (case/spacing insensitive).
 * @returns {{ name: string, multiplier: number, index: number } | null} null if unrecognized.
 */
export function resolveNodeSize(size) {
  if (size === null || size === undefined) return null;
  if (typeof size === 'number') {
    // Tolerate a raw multiplier (e.g. from an older caller) by snapping to the nearest step.
    let best = NODE_SIZE_DEFAULT_INDEX;
    let bestDist = Infinity;
    for (let i = 0; i < NODE_SIZE_STEPS.length; i++) {
      const d = Math.abs(NODE_SIZE_STEPS[i] - size);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return { name: NODE_SIZE_NAMES[best], multiplier: NODE_SIZE_STEPS[best], index: best };
  }
  const key = String(size).toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (!key) return null;
  const idx = SIZE_ALIASES[key];
  if (idx === undefined) return null;
  return { name: NODE_SIZE_NAMES[idx], multiplier: NODE_SIZE_STEPS[idx], index: idx };
}

/**
 * Multiplier to attach to a node spec, or undefined when the node should stay
 * at its default. Unrecognized values fall back to the default rather than
 * throwing — a size typo must never fail a whole graph build.
 *
 * @param {string} size - Size word from a node spec.
 * @returns {number | undefined}
 */
export function nodeSizeMul(size) {
  const resolved = resolveNodeSize(size);
  if (!resolved || resolved.index === NODE_SIZE_DEFAULT_INDEX) return undefined;
  return resolved.multiplier;
}
