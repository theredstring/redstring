/**
 * Client-side Wikidata slice fetcher for the Semantic Discovery catalog.
 * Queries the Wikidata SPARQL endpoint directly from the browser using the
 * existing sparqlClient infrastructure (rate limiting, caching, timeout).
 */
import { sparqlClient } from './sparqlClient.js';

const DEFAULT_SEEDS = ['Person', 'Organization', 'Product', 'Project', 'Technology', 'Place'];

// Curated predicate allowlist for readable relationships
const PREDICATE_ALLOWLIST = [
  'wdt:P31',  // instance of
  'wdt:P279', // subclass of
  'wdt:P361', // part of
  'wdt:P527', // has part
  'wdt:P131', // located in admin territory
  'wdt:P176', // manufacturer
  'wdt:P178', // developer
  'wdt:P50',  // author
  'wdt:P17',  // country
  'wdt:P495', // country of origin
  'wdt:P36',  // capital
];

/**
 * Fetch a slice of Wikidata entities seeded by label matching.
 * @param {string[]} seedLabels - Entity labels to seed the query (e.g. node prototype names)
 * @param {Object} options
 * @param {number} [options.perSeed=5] - Max related entities per seed
 * @param {number} [options.maxTotal=200] - Max total entities returned
 * @returns {Promise<Array<{uri, id, label, description, types, source, related}>>}
 */
export async function fetchWikidataSlice(seedLabels = [], options = {}) {
  const { perSeed = 5, maxTotal = 200 } = options;
  const seeds = seedLabels.length > 0 ? seedLabels : DEFAULT_SEEDS;

  const seedsEscaped = seeds
    .map((label) => `"${label.replace(/"/g, '\\"')}"@en`)
    .join(' ');

  const predicateValues = PREDICATE_ALLOWLIST.join(' ');

  const query = `
    PREFIX wd: <http://www.wikidata.org/entity/>
    PREFIX wdt: <http://www.wikidata.org/prop/direct/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX schema: <http://schema.org/>
    PREFIX wikibase: <http://wikiba.se/ontology#>
    PREFIX bd: <http://www.bigdata.com/rdf#>

    SELECT ?item ?itemLabel ?itemDescription ?related ?relatedLabel ?pred ?predLabel WHERE {
      VALUES ?seedLabel { ${seedsEscaped} }
      VALUES ?pred { ${predicateValues} }
      ?item rdfs:label ?seedLabel .
      FILTER(LANG(?seedLabel) = "en")
      OPTIONAL { ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en") }
      OPTIONAL { ?item schema:description ?itemDescription . FILTER(LANG(?itemDescription) = "en") }
      OPTIONAL {
        ?item ?pred ?related .
        FILTER(isIRI(?related))
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
    }
    LIMIT ${Math.min(maxTotal * 6, 1800)}
  `;

  // sparqlClient.executeQuery handles POST, rate limiting, caching, and timeout
  const bindings = await sparqlClient.executeQuery('wikidata', query);

  // Parse bindings into catalog entries (grouped by item URI)
  const items = new Map();
  for (const b of bindings) {
    const itemUri = b.item?.value;
    if (!itemUri) continue;

    const entry = items.get(itemUri) || {
      uri: itemUri,
      id: itemUri,
      label: b.itemLabel?.value || itemUri.split('/').pop(),
      description: b.itemDescription?.value || '',
      types: [],
      source: 'wikidata',
      related: [],
    };

    const relLabel = b.relatedLabel?.value;
    if (b.related?.value && relLabel && entry.related.length < perSeed) {
      entry.related.push({
        uri: b.related.value,
        label: relLabel,
        predicate: b.predLabel?.value || b.pred?.value?.split('/').pop() || 'relatedTo',
        source: 'wikidata',
      });
    }

    items.set(itemUri, entry);
    if (items.size >= maxTotal) break;
  }

  return Array.from(items.values()).slice(0, maxTotal);
}
