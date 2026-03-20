/**
 * discoverOrbit - Discover semantic web connections for an entity
 *
 * Agent version of the Semantic Orbit feature. Queries Wikidata and DBpedia
 * to find ranked relationships, partitioned into 4 orbit rings by quality.
 *
 * READ-ONLY tool: returns data directly, no store mutation.
 */

import { discoverConnections } from '../../services/semanticDiscovery.js';
import { dedupeAndPartitionOrbit } from '../../services/orbitResolver.js';
import { normalizeToCandidate } from '../../services/candidates.js';

/**
 * @param {Object} args - { entityName, sources?, minConfidence?, limit? }
 * @param {Object} graphState - Current graph state (unused for this read-only tool)
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

  // Use the same discovery service that powers the Connection Browser's "Semantic Web" tab
  const discovery = await discoverConnections(sanitized, {
    timeout: 20000,
    limit,
    sources,
    minConfidence
  });

  // Convert discovery results into orbit candidates using the same scoring system
  const context = { contextFit: 0.85 };
  const candidates = discovery.connections.map(conn =>
    normalizeToCandidate({
      name: conn.target,
      uri: conn.targetUri,
      predicate: conn.relation,
      source: conn.provider,
      sourceTrust: conn.confidence,
      externalLinks: conn.targetUri ? [conn.targetUri] : []
    }, context)
  );

  // Partition into 4 orbit rings using the same algorithm as the UI orbit
  const orbits = dedupeAndPartitionOrbit(candidates);

  // Format for LLM consumption — strip internal scoring fields, keep what's useful
  const formatCandidate = (c) => ({
    name: c.name,
    relation: c.predicate || 'related',
    confidence: Math.round((c.score || 0) * 100) / 100,
    tier: c.tier,
    source: c.source,
    uri: c.uri
  });

  const result = {
    entity: sanitized,
    ring1: orbits.ring1.map(formatCandidate),
    ring2: orbits.ring2.map(formatCandidate),
    ring3: orbits.ring3.map(formatCandidate),
    ring4: orbits.ring4.map(formatCandidate),
    total: orbits.all.length,
    sources: discovery.metadata.sources,
    message: `Discovered ${orbits.all.length} semantic connections for "${sanitized}". ` +
      `Ring 1 (highest quality): ${orbits.ring1.length}, Ring 2: ${orbits.ring2.length}, ` +
      `Ring 3: ${orbits.ring3.length}, Ring 4 (exploratory): ${orbits.ring4.length}.`
  };

  console.error(`[discoverOrbit] Found ${result.total} connections: R1=${orbits.ring1.length} R2=${orbits.ring2.length} R3=${orbits.ring3.length} R4=${orbits.ring4.length}`);
  return result;
}
