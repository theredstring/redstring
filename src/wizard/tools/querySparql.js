/**
 * querySparql - Execute a raw SPARQL query against a named endpoint
 *
 * Power tool for agents that know SPARQL. Provides direct access to
 * Wikidata, DBpedia, and Schema.org SPARQL endpoints.
 *
 * READ-ONLY tool: returns query results directly, no store mutation.
 */

import { sparqlClient } from '../../services/sparqlClient.js';
import { withSafeConsole } from './withSafeConsole.js';

const VALID_ENDPOINTS = ['wikidata', 'dbpedia', 'schema'];

/**
 * @param {Object} args - { endpoint, query, limit? }
 * @param {Object} graphState - Current graph state (unused)
 * @returns {Promise<Object>} SPARQL query results
 */
export async function querySparql(args, graphState) {
  const { endpoint, query, limit } = args;

  if (!endpoint || !VALID_ENDPOINTS.includes(endpoint)) {
    throw new Error(`endpoint must be one of: ${VALID_ENDPOINTS.join(', ')}. Got: "${endpoint}"`);
  }

  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new Error('query is required and must be a valid SPARQL SELECT string');
  }

  // Apply limit if specified and not already in query
  let finalQuery = query.trim();
  if (limit && typeof limit === 'number' && !finalQuery.toLowerCase().includes('limit')) {
    finalQuery += ` LIMIT ${Math.min(limit, 100)}`;
  }

  console.error(`[querySparql] Executing SPARQL on ${endpoint} (${finalQuery.length} chars)`);

  const results = await withSafeConsole(() =>
    sparqlClient.executeQuery(endpoint, finalQuery, { timeout: 30000 })
  );

  // Flatten SPARQL bindings for easier LLM consumption
  const rows = (results || []).map(binding => {
    const row = {};
    for (const [key, val] of Object.entries(binding)) {
      row[key] = val?.value ?? null;
    }
    return row;
  });

  console.error(`[querySparql] Got ${rows.length} results from ${endpoint}`);

  return {
    endpoint,
    resultCount: rows.length,
    results: rows,
    message: rows.length > 0
      ? `Query returned ${rows.length} result(s) from ${endpoint}.`
      : `No results from ${endpoint}. Check your query syntax and entity names.`
  };
}
