/**
 * semanticSearch - Search the semantic web for entities
 *
 * Two modes:
 * - 'enrich': Look up a single entity across Wikidata/DBpedia/Wikipedia (descriptions, links, confidence)
 * - 'related': The entity's statements on Wikidata/DBpedia, both directions, via the semantic search engine
 *
 * READ-ONLY tool: returns data directly, no store mutation.
 */

import { fastEnrichFromSemanticWeb } from '../../services/semanticWebQuery.js';
import { getSemanticConnections } from '../../services/semanticSearchEngine.js';
import { withSafeConsole } from './withSafeConsole.js';

/**
 * @param {Object} args - { query, mode?, limit? }
 * @param {Object} graphState - Current graph state (unused)
 * @returns {Promise<Object>} Search results
 */
export async function semanticSearch(args, graphState) {
  const {
    query,
    mode = 'enrich',
    limit = 15
  } = args;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new Error('query is required and must be a non-empty string');
  }

  const sanitized = query.trim();
  console.error(`[semanticSearch] Searching for "${sanitized}" (mode: ${mode})`);

  if (mode === 'related') {
    // The semantic search engine: which subject this is first, then its
    // statements both ways (wrapped for MCP stdio safety).
    const { identity, connections } = await withSafeConsole(() => getSemanticConnections(sanitized));

    const concepts = (connections || []).slice(0, limit).map((c) => ({
      name: c.other.name,
      uri: c.other.semanticMetadata?.originalUri || null,
      relation: c.predicate,
      // 'out': query → relation → name. 'in': name → relation → query.
      direction: c.direction,
      statement: `${c.subject} → ${c.predicate} → ${c.object}`,
      description: c.other.description || undefined,
      source: c.provider
    }));

    console.error(`[semanticSearch] Found ${concepts.length} related concepts for "${sanitized}"`);
    const unresolved = !identity?.qid && !identity?.dbpediaUri;
    return {
      query: sanitized,
      mode: 'related',
      wikidataId: identity?.qid || null,
      concepts,
      total: concepts.length,
      message: unresolved
        ? `Couldn't tell which "${sanitized}" this is on the semantic web; try the exact name of the subject.`
        : `Found ${concepts.length} concept(s) related to "${sanitized}"${identity?.qid ? ` (${identity.qid})` : ''}.`
    };
  }

  // Default: enrich mode (wrapped for MCP stdio safety)
  const enrichment = await withSafeConsole(() =>
    fastEnrichFromSemanticWeb(sanitized, { timeout: 15000 })
  );

  const result = {
    query: sanitized,
    mode: 'enrich',
    description: enrichment.suggestions?.description || null,
    externalLinks: enrichment.suggestions?.externalLinks || [],
    confidence: enrichment.suggestions?.confidence || 0,
    sourcesFound: Object.entries(enrichment.sources || {})
      .filter(([, v]) => v.found)
      .map(([k]) => k),
    message: enrichment.suggestions?.description
      ? `Found "${sanitized}" on ${Object.entries(enrichment.sources || {}).filter(([, v]) => v.found).map(([k]) => k).join(', ')}.`
      : `No semantic web data found for "${sanitized}".`
  };

  console.error(`[semanticSearch] Enrich result for "${sanitized}": confidence=${result.confidence}, sources=${result.sourcesFound.join(',')}`);
  return result;
}
