/**
 * suggestionCalls — small, independent one-off calls that add capability without
 * replacing a heuristic. Every one is a suggestion or pre-fill the user can
 * override; nothing here auto-commits. All degrade to null with no model.
 *
 * These are the reusable cores for Part C of the phase-2 handoff. Each returns a
 * plain value (+ callId for outcome logging) or null. Callers do the wiring and
 * attach the accept/edit/ignore outcome.
 *
 * MCP stdio rule: reachable from redstring-mcp-server.js — console.error only
 * (this file logs nothing to stdout).
 */

import { oneShotChoice, oneShotBoolean, oneShotLabel } from '../../../services/oneShot.js';

/**
 * C3 — Relation-kind classification. When a connection A→B is made, is it a KIND
 * of, a PART of, or just RELATED to? `kind of` should route to the abstraction
 * axis instead of (or in addition to) a canvas edge.
 * @returns {Promise<{ kind:'kind-of'|'part-of'|'related', callId:string } | null>}
 */
export async function suggestRelationKind({ sourceName, targetName, buildId, timeoutMs } = {}) {
  if (!sourceName || !targetName) return null;
  const result = await oneShotChoice({
    callSite: 'suggestRelationKind',
    buildId,
    timeoutMs,
    meta: { sourceName, targetName },
    instruction:
      `How does "${sourceName}" relate to "${targetName}"? ` +
      `Pick "a kind of" only for is-a / subtype relations (a poodle is a kind of dog). ` +
      `Pick "a part of" for composition/membership. Otherwise pick "related to".`,
    input: `${sourceName} → ${targetName}`,
    options: ['a kind of', 'a part of', 'related to']
  });
  if (!result || result.none) return null;
  const kind = ['kind-of', 'part-of', 'related'][result.index];
  return { kind, callId: result.callId };
}

/**
 * C4 — Arrow direction. Given a verb-phrase edge label, which way does it point?
 * @returns {Promise<{ arrowsToward:'target'|'source', callId:string } | null>}
 */
export async function suggestArrowDirection({ sourceName, targetName, label, buildId, timeoutMs } = {}) {
  if (!sourceName || !targetName || !label) return null;
  const result = await oneShotChoice({
    callSite: 'suggestArrowDirection',
    buildId,
    timeoutMs,
    meta: { sourceName, targetName, label },
    instruction:
      `The connection "${label}" links two nodes. Which reading is correct?`,
    input: `A = "${sourceName}", B = "${targetName}", label = "${label}"`,
    options: [`A ${label} B (arrow points to B)`, `B ${label} A (arrow points to A)`]
  });
  if (!result || result.none) return null;
  const arrowsToward = result.index === 0 ? 'target' : 'source';
  return { arrowsToward, callId: result.callId };
}

/**
 * C5 — Group auto-naming. Suggest a ≤3-word collective name from member names.
 * @returns {Promise<{ name:string, callId:string } | null>}
 */
export async function suggestGroupName({ memberNames, buildId, timeoutMs } = {}) {
  const names = (memberNames || []).filter(Boolean);
  if (names.length < 2) return null;
  const result = await oneShotLabel({
    callSite: 'suggestGroupName',
    buildId,
    timeoutMs,
    meta: { memberNames: names.slice(0, 12) },
    instruction:
      'Give a short collective name (at most 3 words) for this group of things. ' +
      'Example: {Mercury, Venus, Earth} → "Inner Planets".',
    input: names.slice(0, 12).join(', '),
    maxWords: 3
  });
  return result ? { name: result.value, callId: result.callId } : null;
}

/**
 * C6 — Abstraction suggestion. Pre-fill one name when adding a rung on the
 * abstraction (is-a / kind-of) axis. Callers pass `moreGeneral` explicitly since
 * "above"/"below" conventions differ across UIs.
 * @param {Object} p
 * @param {string} p.nodeName
 * @param {boolean} p.moreGeneral  true = suggest a broader kind, false = a narrower kind
 * @param {string[]} [p.chainNames] existing chain names for context
 * @returns {Promise<{ name:string, callId:string } | null>}
 */
export async function suggestAbstractionName({ nodeName, moreGeneral, chainNames = [], buildId, timeoutMs } = {}) {
  if (!nodeName || typeof moreGeneral !== 'boolean') return null;
  const result = await oneShotLabel({
    callSite: 'suggestAbstractionName',
    buildId,
    timeoutMs,
    meta: { nodeName, moreGeneral, chainNames: chainNames.slice(0, 12) },
    instruction:
      `On an is-a (kind-of) ladder, suggest the name one rung ${moreGeneral ? 'MORE GENERAL (a broader kind)' : 'MORE SPECIFIC (a narrower kind)'} than "${nodeName}". ` +
      (moreGeneral ? 'Example: "Dog" → "Mammal".' : 'Example: "Dog" → "Poodle".') +
      (chainNames.length ? ` Existing rungs: ${chainNames.slice(0, 12).join(', ')}.` : ''),
    input: `${nodeName} (${moreGeneral ? 'more general' : 'more specific'})`,
    maxWords: 3
  });
  return result ? { name: result.value, callId: result.callId } : null;
}

/**
 * C7 — Naming-style conformance. Restyle a model-generated name to match the
 * evident style of a graph, or keep it.
 * @returns {Promise<{ name:string, changed:boolean, callId:string } | null>}
 *   Returns null (keep as-is) when the model answers "keep" or can't decide.
 */
export async function conformNamingStyle({ name, exampleNames = [], buildId, timeoutMs } = {}) {
  const examples = (exampleNames || []).filter(Boolean).slice(0, 8);
  if (!name || examples.length < 2) return null;
  const result = await oneShotLabel({
    callSite: 'conformNamingStyle',
    buildId,
    timeoutMs,
    meta: { name, exampleNames: examples },
    instruction:
      `The existing nodes here are named like: ${examples.join(', ')}. ` +
      `Restyle "${name}" to match that naming style, or answer "keep" if it already fits.`,
    input: name,
    maxWords: 6
  });
  if (!result) return null;
  const restyled = result.value;
  // "keep" (case-insensitive) or an exact echo means no change. A capitalization
  // difference IS a meaningful restyle, so compare case-sensitively otherwise.
  if (!restyled || restyled.toLowerCase() === 'keep' || restyled === name) {
    return null;
  }
  return { name: restyled, changed: true, callId: result.callId };
}

/**
 * C2 core — Missing-node proposal. When resolution truly fails, is the mentioned
 * name plausibly a distinct concept that belongs in this graph?
 * @returns {Promise<{ plausible:boolean, callId:string } | null>}
 */
export async function proposeMissingNode({ name, graphName, existingNames = [], buildId, timeoutMs } = {}) {
  if (!name) return null;
  const context = existingNames.slice(0, 15).join(', ');
  const result = await oneShotBoolean({
    callSite: 'proposeMissingNode',
    buildId,
    timeoutMs,
    meta: { name, graphName: graphName || null },
    instruction:
      `Is "${name}" plausibly a distinct concept that belongs in ` +
      `${graphName ? `the graph "${graphName}"` : 'this graph'}? ` +
      `Answer yes only if it is a real, nameable thing that fits here.`,
    input: context ? `Existing nodes: ${context}` : undefined
  });
  return result ? { plausible: result.value, callId: result.callId } : null;
}
