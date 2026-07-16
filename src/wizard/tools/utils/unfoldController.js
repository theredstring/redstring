/**
 * unfoldController — A3 recursive-unfold PLANNING (the tool-layer half).
 *
 * When a graph's members each clearly contain further structure (albums → songs,
 * a process → its steps), the build should open each member into its own
 * definition graph. This module makes the DECISIONS (all via one-off constrained
 * calls) and returns a plain PLAN. It does NOT touch the store — a graph has no
 * store at the tool layer. The applier (toolResultApplier.js) executes the plan
 * against the real store, resolving members by name.
 *
 * Split rationale: model calls only reach a model where oneShot is configured;
 * store mutation only exists in the applier. So decisions live here, execution
 * lives there, and the plan is the wire between them (it also rides in the tool
 * result so the agent can narrate what was unfolded).
 *
 * Depth is a CONSTANT, not a model decision: at most one level of unfold (the
 * top graph plus each member's contents = 2 levels total). We never recurse into
 * a member's contents.
 *
 * MCP stdio rule: reachable from redstring-mcp-server.js — console.error only
 * (this file logs nothing to stdout).
 */

import { classifyGraphShape, shouldUnfoldMembers } from './classifyGraphShape.js';
import { isAbstractionShape } from './graphShapes.js';
import { oneShotLabel, oneShotList } from '../../../services/oneShot.js';

/** Never unfold more members than this in one build (cost guard). */
export const MAX_MEMBERS_TO_UNFOLD = 12;
/** Cap on the number of inner items generated per member. */
export const MAX_INSIDE_ITEMS = 15;
/** Levels of unfold. 1 = top graph + one level of member contents (2 total). */
export const MAX_UNFOLD_DEPTH = 1;

/**
 * Ask the model, in a couple words, what KIND of thing the members are (singular).
 * Used to frame the unfold decision ("each item is a <kind> — unfold it?").
 * @returns {Promise<string|null>}
 */
async function deriveMemberKind({ nodeNames, request, buildId }) {
  const res = await oneShotLabel({
    callSite: 'unfoldMemberKind',
    buildId,
    meta: { sample: nodeNames.slice(0, 6) },
    instruction:
      'In one or two words, what KIND of thing is each of these items? ' +
      'Answer with a singular noun (e.g. "album", "step", "country"). ' +
      (request ? `Context: ${String(request).trim()}.` : ''),
    input: nodeNames.slice(0, 12).join(', '),
    maxWords: 2
  });
  return res ? res.value : null;
}

/**
 * Build a directed edge chain over an ordered list of node names.
 * A→B→C…, closing back to the start for a cycle.
 */
function chainEdges(nodes, { closeLoop = false } = {}) {
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ source: nodes[i].name, target: nodes[i + 1].name, type: 'Next', directionality: 'unidirectional' });
  }
  if (closeLoop && nodes.length > 2) {
    edges.push({ source: nodes[nodes.length - 1].name, target: nodes[0].name, type: 'Next', directionality: 'unidirectional' });
  }
  return edges;
}

/**
 * Decide whether/how to unfold the members of a just-built graph, and return a
 * plan the applier can execute. Returns null when nothing should unfold (no
 * model, model says no, or no member content) — caller keeps the flat build.
 *
 * @param {Object} p
 * @param {Array<{name:string}>} p.nodeSpecs - the member nodes of the top graph
 * @param {string} [p.request] - the originating natural-language request
 * @param {string} [p.shape] - the top graph's classified shape key
 * @param {string} [p.memberKind] - explicit override for the member kind
 * @param {string} [p.buildId] - shared id correlating every call in this build
 * @param {number} [p.depth=0] - current unfold depth (internal guard)
 * @returns {Promise<{ memberKind:string, members:Array<{
 *   memberName:string, memberKind:string, insideShape:string|null,
 *   nodes:Array<{name:string}>, edges:Array<Object>, listCallId:string
 * }> } | null>}
 */
export async function planUnfold({ nodeSpecs = [], request, shape, memberKind, buildId, depth = 0 } = {}) {
  // Constant depth cap — no recursion into a member's contents.
  if (depth >= MAX_UNFOLD_DEPTH) return null;
  // Ladders route to the abstraction axis, not to nested definition graphs.
  if (shape && isAbstractionShape(shape)) return null;

  const nodeNames = nodeSpecs.map((n) => n && n.name).filter(Boolean);
  if (nodeNames.length === 0) return null;

  let kind = (memberKind && String(memberKind).trim()) || null;
  if (!kind) kind = await deriveMemberKind({ nodeNames, request, buildId });
  if (!kind) return null;

  const decision = await shouldUnfoldMembers({ memberKind: kind, request, shape, buildId });
  if (decision !== true) return null;

  const members = [];
  for (const memberName of nodeNames.slice(0, MAX_MEMBERS_TO_UNFOLD)) {
    const insideRequest = `the parts that make up the ${kind} "${memberName}"`;

    let insideShape = null;
    try { insideShape = await classifyGraphShape({ request: insideRequest, buildId }); } catch { insideShape = null; }

    const listRes = await oneShotList({
      callSite: 'unfoldMemberContents',
      buildId,
      meta: { memberName, memberKind: kind, insideShape: insideShape || null },
      instruction:
        `List the parts, members, or steps that make up the ${kind} "${memberName}". ` +
        `If it is an ordered thing, list them in order.`,
      input: request ? `Original request: ${String(request).trim()}` : undefined,
      maxItems: MAX_INSIDE_ITEMS,
      maxWordsPerItem: 10
    });
    if (!listRes || !listRes.items || listRes.items.length === 0) continue;

    const nodes = listRes.items.map((name) => ({ name }));
    // Same shape handling as the top level: an ordered inside becomes a directed
    // chain; a cycle closes the loop; everything else stays edgeless.
    let edges = [];
    if (insideShape === 'sequence') edges = chainEdges(nodes);
    else if (insideShape === 'cycle') edges = chainEdges(nodes, { closeLoop: true });

    members.push({
      memberName,
      memberKind: kind,
      insideShape: insideShape || null,
      nodes,
      edges,
      listCallId: listRes.callId
    });
  }

  if (members.length === 0) return null;
  return { memberKind: kind, members };
}
