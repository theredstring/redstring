/**
 * conformNames — C7 batch naming-style conformance.
 *
 * When model-generated node names land in a graph that already has an evident
 * naming style (≥5 existing nodes), restyle each NEW name to match. Returns a
 * map of only the names that actually changed. Skips entirely without enough
 * examples or with too many new names (cost guard). Never touches user-typed
 * names — callers pass model-generated names only.
 *
 * MCP stdio rule: reachable from redstring-mcp-server.js — console.error only.
 */

import { conformNamingStyle } from './suggestionCalls.js';

/** Need at least this many existing names to infer a style. */
export const MIN_EXAMPLES = 5;
/** Never restyle more than this many new names in one build (cost guard). */
export const MAX_NEW_NAMES = 10;

/**
 * @param {Object} p
 * @param {string[]} p.names - the NEW model-generated names to (maybe) restyle
 * @param {string[]} p.exampleNames - existing node names that show the style
 * @param {string} [p.buildId]
 * @returns {Promise<Record<string,string>>} { originalName: restyledName } for
 *   changed names only (empty object when nothing changes / guards trip).
 */
export async function conformNames({ names = [], exampleNames = [], buildId } = {}) {
  const examples = (exampleNames || []).filter(Boolean);
  const fresh = (names || []).filter(Boolean);
  if (examples.length < MIN_EXAMPLES) return {};
  if (fresh.length === 0 || fresh.length > MAX_NEW_NAMES) return {};

  const changes = {};
  for (const name of fresh) {
    try {
      const res = await conformNamingStyle({ name, exampleNames: examples, buildId });
      if (res && res.changed && res.name && res.name !== name) {
        changes[name] = res.name;
      }
    } catch { /* keep the original name */ }
  }
  return changes;
}
