/**
 * discoverOrbit - Discover semantic web connections for an entity
 *
 * Agent version of the Semantic Orbit feature, reading from the same semantic
 * search engine as the orbit, the discovery panel and the right panel's
 * Semantic Web connections: the entity's identity is settled first (from the
 * Thing's own links when it's in the universe, else an exact-name concept
 * search), then its Wikidata and DBpedia statements come back in both
 * directions, ranked and partitioned into 4 orbit rings by quality.
 *
 * READ-ONLY tool: returns data directly, no store mutation.
 */

import { getSemanticConnections } from '../../services/semanticSearchEngine.js';
import { dedupeAndPartitionOrbit } from '../../services/orbitResolver.js';
import { normalizeToCandidate } from '../../services/candidates.js';
import { formatPredicate } from '../../utils/predicateFormatter.js';
import { withSafeConsole } from './withSafeConsole.js';

/**
 * The Thing this name refers to in the universe, if there is one — its links
 * settle which subject it is. The LAST match, so a stale duplicate from an
 * earlier session never wins.
 */
function seedFor(name, graphState) {
  const wanted = name.toLowerCase();
  let match = null;
  for (const proto of graphState?.nodePrototypes || []) {
    if ((proto?.name || '').trim().toLowerCase() === wanted) match = proto;
  }
  return match?.externalLinks?.length ? { name, externalLinks: match.externalLinks } : name;
}

/**
 * @param {Object} args - { entityName, sources?, minConfidence?, limit? }
 * @param {Object} graphState - Current graph state (read for the entity's own links)
 * @returns {Promise<Object>} Orbit candidates partitioned into 4 rings
 */
export async function discoverOrbit(args, graphState) {
  const {
    entityName,
    sources = ['dbpedia', 'wikidata'],
    minConfidence = 0.3,
    limit = 30
  } = args;

  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    throw new Error('entityName is required and must be a non-empty string');
  }

  const sanitized = entityName.trim();
  console.error(`[discoverOrbit] Discovering connections for "${sanitized}"`);

  // Wrap service calls to redirect console.log → console.error (MCP stdio safety)
  const { identity, byId, orbits } = await withSafeConsole(async () => {
    const found = await getSemanticConnections(seedFor(sanitized, graphState));
    const kept = found.connections
      .filter((c) => sources.includes(c.provider) && c.confidence >= minConfidence)
      .slice(0, Math.max(1, limit));

    // Scored with the orbit's own predicate tiers; the engine's id keeps the
    // same Thing reached in both directions as two statements, not one.
    const context = { contextFit: 0.85 };
    const candidates = kept.map((c) => normalizeToCandidate({
      id: c.id,
      name: c.other.name,
      uri: c.other.semanticMetadata?.originalUri,
      predicate: c.predicateKey || c.predicate,
      source: c.provider,
      sourceTrust: c.confidence,
      description: c.other.description,
      externalLinks: c.other.semanticMetadata?.externalLinks || []
    }, context));

    return {
      identity: found.identity,
      byId: new Map(kept.map((c) => [c.id, c])),
      orbits: dedupeAndPartitionOrbit(candidates)
    };
  });

  // Format for LLM consumption — strip internal scoring fields, keep what's useful
  const formatCandidate = (candidate) => {
    const c = byId.get(candidate.id);
    const relation = c?.predicate || formatPredicate(candidate.predicate);
    return {
      name: candidate.name,
      relation,
      // 'out': entity → relation → name. 'in': name → relation → entity.
      direction: c?.direction || 'out',
      statement: c?.direction === 'in'
        ? `${candidate.name} → ${relation} → ${sanitized}`
        : `${sanitized} → ${relation} → ${candidate.name}`,
      description: candidate.description || undefined,
      confidence: Math.round((candidate.score || 0) * 100) / 100,
      tier: candidate.tier,
      source: candidate.source,
      uri: candidate.uri
    };
  };

  const unresolved = !identity?.qid && !identity?.dbpediaUri;
  const result = {
    entity: sanitized,
    wikidataId: identity?.qid || null,
    ring1: orbits.ring1.map(formatCandidate),
    ring2: orbits.ring2.map(formatCandidate),
    ring3: orbits.ring3.map(formatCandidate),
    ring4: orbits.ring4.map(formatCandidate),
    total: orbits.all.length,
    sources,
    message: unresolved
      ? `Couldn't tell which "${sanitized}" this is on the semantic web; no connections returned. ` +
        'Linking the Thing to its Wikipedia or Wikidata entry settles it.'
      : `Discovered ${orbits.all.length} semantic connections for "${sanitized}"${identity?.qid ? ` (${identity.qid})` : ''}. ` +
        `Ring 1 (highest quality): ${orbits.ring1.length}, Ring 2: ${orbits.ring2.length}, ` +
        `Ring 3: ${orbits.ring3.length}, Ring 4 (exploratory): ${orbits.ring4.length}. ` +
        'Each carries a direction: "in" means the other Thing points at this one.'
  };

  console.error(`[discoverOrbit] Found ${result.total} connections: R1=${orbits.ring1.length} R2=${orbits.ring2.length} R3=${orbits.ring3.length} R4=${orbits.ring4.length}`);
  return result;
}
