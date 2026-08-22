/**
 * resolveNodeSmart — one shared name→node resolver for the wizard tools.
 *
 * Replaces the hand-rolled "exact match → substring match → arbitrary first/last
 * pick" logic duplicated across createEdge / updateNode / deleteNode / setNodeType
 * / selectNode / edgeValidator, which silently mis-wired or dropped edges.
 *
 * Resolution order:
 *   1. Exact case-insensitive match → deterministic, NO model call. When several
 *      candidates share a name, the LAST one wins (Maps iterate oldest-first and
 *      stale prototypes accumulate — project convention).
 *   2. No exact match + a model is configured → one constrained oneShotChoice
 *      picking among the candidates (with an explicit "None of these").
 *   3. No model / model returned nothing → substring-eligible candidates ranked
 *      by edit distance, best score wins. When the top candidates are within
 *      AMBIGUITY_MARGIN of each other the result is 'ambiguous' with no match,
 *      because guessing between equally plausible nodes silently rewires the
 *      user's graph.
 *
 * MCP stdio rule: imported (transitively) by redstring-mcp-server.js — use
 * console.error only, never console.log. In that Node context there is no model,
 * so this always takes the deterministic exact/substring path.
 *
 * @param {string} query - the mentioned name to resolve
 * @param {Array<Object>} candidates - each MUST have a `.name`; may carry any
 *        extra fields (id/instanceId/prototypeId/description) which are returned
 *        untouched on the matched candidate.
 * @param {Object} [opts]
 * @param {boolean} [opts.useModel=true] - set false to force pure-heuristic.
 * @param {string} [opts.callSite='resolveNodeSmart']
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxOptions=20] - cap candidates shown to the model.
 * @returns {Promise<{ match: Object|null, method: string, exact: boolean, callId: string|null, candidates?: Array<Object> }>}
 *   method ∈ 'empty' | 'exact' | 'model' | 'model-none' | 'substring' | 'ambiguous' | 'not-found'
 *   - 'exact'      : deterministic exact match (safe for destructive ops)
 *   - 'model'      : the model chose this candidate (NOT exact — confirm for destructive ops)
 *   - 'model-none' : the model explicitly said none of the candidates match → unresolvable
 *   - 'substring'  : best-scoring heuristic fallback match (NOT exact)
 *   - 'ambiguous'  : several candidates were equally plausible; `match` is null and
 *                    `candidates` lists them so the caller can ask which was meant
 *   - 'not-found'  : nothing matched
 */

import { calculateStringSimilarity } from './stringSimilarity.js';
import { oneShotChoice, isOneShotAvailable } from '../../../services/oneShot.js';
import { proposeMissingNode } from './suggestionCalls.js';

const nameOf = (c) => (c && c.name != null ? String(c.name) : '');
const norm = (s) => String(s || '').toLowerCase().trim();

function truncate(str, n) {
  const s = String(str || '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Find the LAST exact case-insensitive name match (project convention). */
function findExact(q, candidates) {
  let match = null;
  for (const c of candidates) {
    if (norm(nameOf(c)) === q) match = c;
  }
  return match;
}

/**
 * Two candidates whose similarity to the query differs by less than this are
 * treated as indistinguishable. Asking "Cell" against {Cell Wall, Cell
 * Membrane, Stem Cell} scores the first and last identically — picking either
 * is a coin flip, and a wrong bind silently rewires the user's graph, so we
 * report ambiguity instead and let the caller ask.
 */
const AMBIGUITY_MARGIN = 0.05;

/**
 * Rank substring-eligible candidates and return the best one.
 *
 * Eligibility is unchanged from the legacy heuristic (same modes, same
 * containment tests). What changed is the SELECTION among eligible
 * candidates: this used to keep the last one encountered — Map insertion
 * order, not relevance — so "Cell" resolved to whichever cell-ish node
 * happened to be created most recently. Now the eligible set is scored by
 * edit distance and the best scoring candidate wins, with near-ties reported
 * as ambiguous rather than guessed.
 *
 * mode 'loose'  : match either direction (n⊇q or q⊇n) — createEdge/updateNode/deleteNode.
 * mode 'strict' : only when the query CONTAINS the candidate name (query is more
 *                 specific), never equal — mirrors setNodeType's strict type match
 *                 so "membrane" does NOT match "outer membrane".
 * mode 'none'   : no substring fallback.
 *
 * @returns {{ match: Object|null, score: number, ambiguous: boolean, tied: Array<Object> }}
 */
function findSubstring(q, candidates, mode) {
  if (mode === 'none') return { match: null, score: 0, ambiguous: false, tied: [] };

  const eligible = [];
  for (const c of candidates) {
    const n = norm(nameOf(c));
    if (!n) continue;
    const isEligible = mode === 'strict'
      ? (q.includes(n) && q !== n)
      : (n.includes(q) || q.includes(n));
    if (isEligible) eligible.push({ candidate: c, score: calculateStringSimilarity(q, n) });
  }

  if (eligible.length === 0) return { match: null, score: 0, ambiguous: false, tied: [] };

  // Highest score wins. Ties resolve to the LAST candidate, preserving the
  // project convention that newer prototypes supersede stale same-named ones.
  let best = eligible[0];
  for (const entry of eligible) {
    if (entry.score >= best.score) best = entry;
  }

  const tied = eligible.filter(
    (e) => e.candidate !== best.candidate && Math.abs(e.score - best.score) < AMBIGUITY_MARGIN
  );

  return {
    match: best.candidate,
    score: best.score,
    ambiguous: tied.length > 0,
    tied: tied.map((e) => e.candidate)
  };
}

export async function resolveNodeSmart(query, candidates, opts = {}) {
  const {
    useModel = true, callSite = 'resolveNodeSmart', timeoutMs, maxOptions = 20, substringMode = 'loose',
    // C2 — missing-node proposal: when resolution truly fails and a model is
    // available, ask whether the name is plausibly a distinct concept that
    // belongs here. Opt-in (off by default) so bulk callers aren't slowed.
    proposeMissing = false, graphName, existingNames, buildId
  } = opts;

  // Attach a proposedNode suggestion to an unresolvable result, if enabled.
  const withProposal = async (res) => {
    if (!proposeMissing) return res;
    try {
      const names = Array.isArray(existingNames) ? existingNames : list.map((c) => nameOf(c));
      const proposal = await proposeMissingNode({ name: query, graphName, existingNames: names, buildId });
      if (proposal && proposal.plausible) {
        res.proposedNode = { name: String(query), proposalCallId: proposal.callId };
      }
    } catch { /* never disrupt resolution */ }
    return res;
  };
  const list = Array.isArray(candidates) ? candidates.filter((c) => nameOf(c)) : [];
  const q = norm(query);

  if (!q || list.length === 0) {
    return { match: null, method: 'empty', exact: false, callId: null };
  }

  // 1. Exact — deterministic, no model.
  const exact = findExact(q, list);
  if (exact) return { match: exact, method: 'exact', exact: true, callId: null };

  // Heuristic fallback computed up front (used if the model is unavailable/unsure).
  const substringResult = findSubstring(q, list, substringMode);

  // 2. Ambiguous / fuzzy → one constrained model call, if a model is configured.
  if (useModel) {
    let available = false;
    try { available = await isOneShotAvailable(); } catch { available = false; }

    if (available) {
      // Keep the prompt small for local models: prefilter to the most similar
      // candidates when there are many.
      let pool = list;
      if (list.length > maxOptions) {
        pool = list
          .map((c) => {
            const n = norm(nameOf(c));
            const overlap = n && (n.includes(q) || q.includes(n)) ? 1 : 0;
            return { c, sim: Math.max(overlap, calculateStringSimilarity(query, nameOf(c))) };
          })
          .sort((a, b) => b.sim - a.sim)
          .slice(0, maxOptions)
          .map((x) => x.c);
      }

      const options = pool.map((c) => ({
        label: c.description ? `${nameOf(c)} — ${truncate(c.description, 80)}` : nameOf(c)
      }));

      const result = await oneShotChoice({
        instruction:
          `A user or agent referred to a node named "${query}". ` +
          `Which existing node does it mean? Pick the number of the matching node, ` +
          `or "None of these" if none refer to the same thing.`,
        options,
        allowNone: true,
        callSite,
        timeoutMs
      });

      if (result) {
        if (result.none) {
          return withProposal({ match: null, method: 'model-none', exact: false, callId: result.callId });
        }
        return { match: pool[result.index], method: 'model', exact: false, callId: result.callId };
      }
      // result === null → model unavailable at call time / malformed → fall through.
    }
  }

  // 3. Heuristic fallback — best-scoring substring match, or an explicit
  //    refusal when several candidates are equally plausible.
  if (substringResult.ambiguous) {
    const names = [substringResult.match, ...substringResult.tied].map(nameOf);
    console.error(
      `[resolveNodeSmart] "${query}" is ambiguous between ${names.map((n) => `"${n}"`).join(', ')} — refusing to guess.`
    );
    return {
      match: null,
      method: 'ambiguous',
      exact: false,
      callId: null,
      candidates: [substringResult.match, ...substringResult.tied]
    };
  }

  if (substringResult.match) {
    console.error(
      `[resolveNodeSmart] Substring fallback for "${query}" → "${nameOf(substringResult.match)}" ` +
      `(score ${substringResult.score.toFixed(2)}, not exact).`
    );
    return { match: substringResult.match, method: 'substring', exact: false, callId: null };
  }

  return withProposal({ match: null, method: 'not-found', exact: false, callId: null });
}

export default resolveNodeSmart;
