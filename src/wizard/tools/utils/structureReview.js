/**
 * structureReview — end-of-build pass that looks for regions of a graph that
 * could become more compositional, but is strongly biased toward doing nothing.
 *
 * Layered so most runs cost ZERO model calls:
 *   1. detectCandidateClusters(): pure code (community detection + size check).
 *      No candidates → review ends, no model calls.
 *   2. reviewGraphStructure(): per candidate, one coherence yes/no (biased no),
 *      then one weakest-sufficient-structure choice (biased leave), then a name.
 *
 * Nothing here mutates the graph. It returns SUGGESTIONS the caller surfaces for
 * user approval; execution (group / condenseToNode) happens on approval only.
 *
 * MCP stdio rule: reachable from redstring-mcp-server.js — console.error only
 * (this file logs nothing to stdout).
 */

import { oneShotBoolean, oneShotChoice, oneShotLabel } from '../../../services/oneShot.js';

/**
 * Louvain first-level community detection (deterministic: sorted iteration).
 * Undirected, unweighted. Returns Map<nodeId, communityLabel>. Good at separating
 * internally-dense clusters (a triangle) from sparse chains, unlike label
 * propagation which collapses connected graphs.
 */
function louvainFirstPass(nodeIds, adj) {
  let m = 0;
  for (const s of adj.values()) m += s.size;
  m /= 2;
  if (m === 0) return new Map(nodeIds.map((id) => [id, id]));

  const degree = new Map(nodeIds.map((id) => [id, adj.get(id).size]));
  const comm = new Map(nodeIds.map((id) => [id, id]));
  const sigmaTot = new Map(nodeIds.map((id) => [id, degree.get(id)]));
  const order = [...nodeIds].sort();

  let improved = true;
  let iterations = 0;
  while (improved && iterations < 20) {
    improved = false;
    iterations += 1;
    for (const i of order) {
      const ci = comm.get(i);
      const ki = degree.get(i);

      const kiIn = new Map();
      for (const nb of adj.get(i)) {
        if (nb === i) continue;
        const c = comm.get(nb);
        kiIn.set(c, (kiIn.get(c) || 0) + 1);
      }

      // Tentatively remove i from its community.
      sigmaTot.set(ci, sigmaTot.get(ci) - ki);

      let bestComm = ci;
      let bestGain = 0;
      const candidates = new Set([ci, ...kiIn.keys()]);
      for (const c of [...candidates].sort()) {
        const kin = kiIn.get(c) || 0;
        const gain = kin - (sigmaTot.get(c) * ki) / (2 * m);
        if (gain > bestGain) { bestGain = gain; bestComm = c; }
      }

      sigmaTot.set(bestComm, sigmaTot.get(bestComm) + ki);
      if (bestComm !== ci) { comm.set(i, bestComm); improved = true; }
    }
  }
  return comm;
}

/**
 * Find candidate clusters with pure code: subsets densely connected internally
 * and sparsely connected outward. Returns [] when nothing qualifies (the common
 * case) so the review can end without any model calls.
 *
 * @param {Array<{id:string,name?:string}>} nodes
 * @param {Array<{sourceId?:string,destinationId?:string,targetId?:string,source?:string,target?:string}>} edges
 * @param {Object} [opts]
 * @param {number} [opts.minClusterSize=3]
 * @param {number} [opts.densityRatio=2] internal edges must exceed external by this factor
 * @param {number} [opts.oversizeThreshold=30] node count that alone relaxes the density bar
 * @param {number} [opts.maxCandidates=5]
 * @returns {Array<{nodeIds:string[], nodeNames:string[], internalEdges:number, externalEdges:number, reason:string}>}
 */
export function detectCandidateClusters(nodes, edges, opts = {}) {
  const {
    minClusterSize = 3,
    densityRatio = 2,
    oversizeThreshold = 30,
    maxCandidates = 5
  } = opts;

  const nodeList = (nodes || []).filter((n) => n && n.id);
  if (nodeList.length < minClusterSize) return [];

  const idSet = new Set(nodeList.map((n) => n.id));
  const adj = new Map();
  for (const n of nodeList) adj.set(n.id, new Set());
  for (const e of (edges || [])) {
    const a = e.sourceId ?? e.source;
    const b = e.destinationId ?? e.targetId ?? e.target;
    if (idSet.has(a) && idSet.has(b) && a !== b) {
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
  }

  const labels = louvainFirstPass(nodeList.map((n) => n.id), adj);

  const communities = new Map();
  for (const [id, l] of labels) {
    if (!communities.has(l)) communities.set(l, []);
    communities.get(l).push(id);
  }

  const oversized = nodeList.length >= oversizeThreshold;
  const ratio = oversized ? 1 : densityRatio;
  const nameById = new Map(nodeList.map((n) => [n.id, n.name]));

  const candidates = [];
  for (const [, ids] of communities) {
    if (ids.length < minClusterSize || ids.length >= nodeList.length) continue;
    const inner = new Set(ids);
    let internal = 0;
    let external = 0;
    for (const id of ids) {
      for (const nb of adj.get(id)) {
        if (inner.has(nb)) internal += 1; else external += 1;
      }
    }
    internal /= 2; // each internal edge counted from both ends
    if (internal > 0 && internal >= external * ratio) {
      candidates.push({
        nodeIds: [...ids].sort(),
        nodeNames: [...ids].sort().map((id) => nameById.get(id)).filter(Boolean),
        internalEdges: internal,
        externalEdges: external,
        reason: oversized ? 'dense-cluster-in-large-graph' : 'dense-cluster'
      });
    }
  }

  candidates.sort((a, b) => (b.internalEdges - b.externalEdges) - (a.internalEdges - a.externalEdges));
  return candidates.slice(0, maxCandidates);
}

/**
 * Review candidate clusters with the model. For each: coherence (yes/no, biased
 * no) → weakest-sufficient-structure (leave/group/fold, biased leave) → name.
 * Returns only actionable ('group' | 'fold') suggestions, each carrying the
 * callIds so the caller can attach the user's accept/dismiss outcome.
 *
 * @returns {Promise<Array<{nodeIds:string[], nodeNames:string[], action:'group'|'fold', name:string|null, coherenceCallId:string, structureCallId:string, nameCallId:string|null}>>}
 */
export async function reviewGraphStructure({ clusters, request, shape, buildId } = {}) {
  const suggestions = [];
  for (const c of (clusters || [])) {
    const names = (c.nodeNames || []).join(', ');
    if (!names) continue;

    const coherence = await oneShotBoolean({
      callSite: 'reviewCoherence',
      buildId,
      meta: { nodeIds: c.nodeIds, shape: shape || null },
      instruction:
        'Do these items form ONE nameable concept — a single thing the rest of the graph could refer to as a unit? ' +
        'Answer yes ONLY if clearly so; otherwise no.',
      input: names
    });
    if (!coherence || coherence.value !== true) continue;

    const choice = await oneShotChoice({
      callSite: 'reviewStructure',
      buildId,
      meta: { nodeIds: c.nodeIds },
      instruction:
        'These items form one concept. Choose the WEAKEST sufficient structure. ' +
        'Strongly prefer leaving as is. Only "group" if visual containment clearly helps. ' +
        'Only "fold" (into a node with a definition graph) if the rest of the graph should reference this cluster as a single thing.',
      input: names,
      options: ['leave as is', 'group them', 'fold into a node with a definition graph']
    });
    if (!choice || choice.none) continue;

    const action = choice.index === 1 ? 'group' : choice.index === 2 ? 'fold' : 'leave';
    if (action === 'leave') continue;

    const nameRes = await oneShotLabel({
      callSite: 'reviewName',
      buildId,
      meta: { nodeIds: c.nodeIds },
      instruction: 'Give a short collective name (at most 3 words) for these items as one concept.',
      input: names,
      maxWords: 3
    });

    suggestions.push({
      nodeIds: c.nodeIds,
      nodeNames: c.nodeNames,
      action,
      name: nameRes?.value || null,
      coherenceCallId: coherence.callId,
      structureCallId: choice.callId,
      nameCallId: nameRes?.callId || null
    });
  }
  return suggestions;
}

/**
 * Convenience: detect then review. Returns { candidates, suggestions }.
 * With no candidates (the common case) this makes ZERO model calls.
 */
export async function runStructureReview(nodes, edges, { request, shape, buildId, detectOpts } = {}) {
  const candidates = detectCandidateClusters(nodes, edges, detectOpts);
  if (candidates.length === 0) return { candidates: [], suggestions: [] };
  const suggestions = await reviewGraphStructure({ clusters: candidates, request, shape, buildId });
  return { candidates, suggestions };
}
