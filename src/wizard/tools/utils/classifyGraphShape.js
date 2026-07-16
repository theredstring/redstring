/**
 * classifyGraphShape — one constrained call that picks which of the nine
 * structural shapes a build request wants, plus the recursive "unfold" decision.
 *
 * These are pure one-off calls: request in → shape key / boolean out → validated
 * by code. Null on no-model / timeout / malformed, so callers fall back to their
 * current behavior (no shape guidance).
 *
 * MCP stdio rule: reachable from redstring-mcp-server.js — console.error only
 * (this file logs nothing).
 */

import { oneShotChoice, oneShotBoolean } from '../../../services/oneShot.js';
import { GRAPH_SHAPES } from './graphShapes.js';

/**
 * Classify the top-level (or a sub-level) structural shape of a build request.
 * @param {Object} p
 * @param {string} p.request - the natural-language request for this graph level
 * @param {string} [p.buildId] - shared id to correlate all calls in this build
 * @param {number} [p.timeoutMs]
 * @returns {Promise<string|null>} a shape key from graphShapes, or null.
 */
export async function classifyGraphShape({ request, buildId, timeoutMs } = {}) {
  if (!request || !String(request).trim()) return null;

  const options = GRAPH_SHAPES.map((s) => ({
    label: `${s.key} — ${s.description} (e.g. "${s.examples[0]}")`
  }));

  const result = await oneShotChoice({
    callSite: 'classifyGraphShape',
    buildId,
    timeoutMs,
    instruction:
      'Pick the structural shape that best fits this request for building a graph. ' +
      'Prefer "set" (no relationships) when the items do not clearly relate — do not invent edges. ' +
      'Pick "ladder" only for is-a / kind-of hierarchies (poodle→dog→animal). ' +
      'When unsure between relational shapes, pick "web".',
    input: String(request).trim(),
    options
  });

  if (!result || result.none) return null;
  const shape = GRAPH_SHAPES[result.index];
  return shape ? shape.key : null;
}

/**
 * The unfold decision: should each member of the current level open into its own
 * definition graph of its contents? (e.g. albums → yes, each contains songs.)
 * One yes/no call. Null → no unfold (caller keeps a flat structure).
 * @param {Object} p
 * @param {string} p.memberKind - what the members are (e.g. "album", "step")
 * @param {string} [p.request] - the originating request, for context
 * @param {string} [p.shape] - the shape key of the current level
 * @param {string} [p.buildId]
 * @param {number} [p.timeoutMs]
 * @returns {Promise<boolean|null>}
 */
export async function shouldUnfoldMembers({ memberKind, request, shape, buildId, timeoutMs } = {}) {
  if (!memberKind || !String(memberKind).trim()) return null;

  const result = await oneShotBoolean({
    callSite: 'shouldUnfoldMembers',
    buildId,
    timeoutMs,
    meta: { memberKind, shape: shape || null },
    instruction:
      `Each item in this graph is a "${memberKind}". Should each one open into its own ` +
      `nested graph of its own contents (its parts, steps, or members)? ` +
      `Answer yes only if a ${memberKind} clearly contains further structure worth expanding.`,
    input: request ? `Original request: ${String(request).trim()}` : undefined
  });

  return result ? result.value : null;
}
