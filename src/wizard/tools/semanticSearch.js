/**
 * semanticSearch - Search the semantic web for entities
 *
 * Two modes:
 * - 'enrich': Look up a single entity across Wikidata/DBpedia/Wikipedia (descriptions, links, confidence)
 * - 'related': Find related concepts for an entity via SPARQL relationship queries
 *
 * READ-ONLY tool: returns data directly, no store mutation.
 */

import { fastEnrichFromSemanticWeb, findRelatedConcepts } from '../../services/semanticWebQuery.js';

// Redirect console.log → console.error during service calls (MCP stdio safety)
function withSafeConsole(fn) {
  const origLog = console.log;
  console.log = console.error;
  return fn().finally(() => { console.log = origLog; });
}

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
    // Find related concepts via SPARQL (wrapped for MCP stdio safety)
    const results = await withSafeConsole(() =>
      findRelatedConcepts(sanitized, { limit, timeout: 15000 })
    );

    const concepts = (results || []).slice(0, limit).map(r => ({
      name: r.itemLabel?.value || r.label?.value || r.name || 'Unknown',
      uri: r.item?.value || r.resource?.value || r.uri || null,
      relation: r.predicate || r.connectionType || 'related',
      source: r.source || 'semantic-web'
    }));

    console.error(`[semanticSearch] Found ${concepts.length} related concepts for "${sanitized}"`);
    return {
      query: sanitized,
      mode: 'related',
      concepts,
      total: concepts.length,
      message: `Found ${concepts.length} concept(s) related to "${sanitized}".`
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
