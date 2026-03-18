import { normalizeToCandidate } from './candidates.js';
import { KnowledgeFederation } from './knowledgeFederation.js';
import { findRelatedConcepts } from './semanticWebQuery.js';
import { findLocalOrbitCandidates } from './orbitLocalIndex.js';

// Lazy import helper to avoid circular dependency
let _useGraphStore = null;
const getGraphStore = async () => {
  if (!_useGraphStore) {
    const module = await import('../store/graphStore.jsx');
    _useGraphStore = module.default;
  }
  return _useGraphStore;
};

// Simple in-memory cache keyed by prototypeId
const orbitCache = new Map(); // prototypeId -> { timestamp, candidates }

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours for UI orbit suggestions
const TRICKLE_BATCH = 2;
const TRICKLE_DELAY_MS = 120;

// Deduplicate, sort, and partition candidates into 4 rings
export function dedupeAndPartitionOrbit(candidates) {
  const seen = new Set();
  const unique = candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  unique.sort((a, b) => (b.score || 0) - (a.score || 0));

  const tierA = unique.filter((c) => c.tier === 'A');
  const tierB = unique.filter((c) => c.tier === 'B');
  const ring1 = tierA.slice(0, 10);
  const ring2 = tierA.slice(10).concat(tierB).slice(0, 10);
  const tierBCRemaining = unique.filter(c => !ring1.includes(c) && !ring2.includes(c));
  const ring3 = tierBCRemaining.slice(0, 10);
  const ring4 = tierBCRemaining.slice(10, 20);

  return { ring1, ring2, ring3, ring4, all: unique };
}

// Map provider/source to nominal trust
const SOURCE_TRUST = {
  wikidata: 0.95,
  dbpedia: 0.85,
  schemaorg: 0.8,
  crossref: 0.8,
  musicbrainz: 0.85,
  external: 0.7,
};

function getSourceTrust(source) {
  return SOURCE_TRUST[String(source).toLowerCase()] ?? 0.75;
}

export async function fetchOrbitCandidatesForPrototype(prototype, options = {}) {
  const { onProgress } = options;
  if (!prototype || !prototype.name) return { inner: [], outer: [], all: [] };
  const key = prototype.id;
  const now = Date.now();
  const cached = orbitCache.get(key);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.candidates;
  }

  try {
    console.log(`🔍 Fetching real orbit data for "${prototype.name}"`);

    // Real data fetching - comment out for mock mode
    const useGraphStore = await getGraphStore();
    const graphStore = useGraphStore.getState();
    const federation = new KnowledgeFederation(graphStore);

    const seed = prototype.name;
    const context = { contextFit: 0.85 };

    const providers = [];

    // 0) Local catalog-first: Orbit index entries persisted in the store
    providers.push(
      findLocalOrbitCandidates(prototype, { limit: 48 })
        .then((results) => {
          console.log(`🏠 Local orbit index returned ${results?.length || 0} candidates for "${seed}"`);
          if (!Array.isArray(results)) return [];
          return results.map((r) =>
            normalizeToCandidate(
              {
                name: r.name,
                uri: r.uri,
                predicate: r.predicate ?? null,
                source: r.source || 'orbit-local',
                sourceTrust: r.sourceTrust ?? getSourceTrust(r.source || 'orbit-local'),
                externalLinks: r.externalLinks || (r.uri ? [r.uri] : []),
                equivalentClasses: r.types || [],
              },
              context
            )
          );
        })
        .catch((error) => {
          console.warn(`❌ Local orbit index failed for "${seed}":`, error.message);
          return [];
        })
    );

    console.log(`🌐 Querying semantic web for "${seed}"`);

    // 1) Semantic web query utility (most reliable)
    providers.push(
      findRelatedConcepts(seed, { limit: 32, timeout: 10000 }).then((results) => {
        console.log(`📊 findRelatedConcepts returned ${results?.length || 0} results for "${seed}"`);
        if (!Array.isArray(results)) return [];
        return results.map((r) => {
          const candidate = normalizeToCandidate(
            {
              name: r.itemLabel?.value || r.label?.value || r.name || 'Unknown',
              uri: r.item?.value || r.resource?.value || r.uri,
              predicate: r.connectionType ?? r.predicate ?? null,
              source: r.source || 'external',
              sourceTrust: getSourceTrust(r.source || 'external'),
              externalLinks: r.externalLinks || (r.uri ? [r.uri] : []),
              equivalentClasses: r.types || [],
              claims: r.claims || [],
            },
            context
          );
          console.log(`  ↳ Candidate: ${candidate.name} (${candidate.source}, tier: ${candidate.tier}, score: ${candidate.score?.toFixed(2)})`);
          return candidate;
        });
      }).catch(error => {
        console.warn(`❌ findRelatedConcepts failed for "${seed}":`, error.message);
        return [];
      })
    );

    // 2) KnowledgeFederation: importSingleEntity then findEntitiesRelated if available
    try {
      providers.push(
        federation.importSingleEntity(seed, ['wikidata', 'dbpedia']).then((entity) => {
          console.log(`🏛️ KnowledgeFederation returned entity:`, entity ? 'found' : 'none');
          if (!entity) return [];
          const asCandidate = [];
          // Convert properties to pairs resembling predicate -> value
          if (entity.properties instanceof Map) {
            entity.properties.forEach((arr, predicate) => {
              arr.forEach((p) => {
                asCandidate.push(
                  normalizeToCandidate(
                    {
                      name: String(p.value?.label || p.value || ''),
                      uri: p.value?.uri || null,
                      predicate,
                      source: p.source,
                      sourceTrust: getSourceTrust(p.source),
                      externalLinks: p.value?.uri ? [p.value.uri] : [],
                      types: entity.types?.map?.(t => t.type) || [],
                    },
                    context
                  )
                );
              });
            });
          }
          console.log(`  ↳ Extracted ${asCandidate.length} candidates from federation`);
          return asCandidate;
        }).catch(error => {
          console.warn(`❌ KnowledgeFederation failed for "${seed}":`, error.message);
          return [];
        })
      );
    } catch (error) {
      console.warn(`❌ KnowledgeFederation setup failed:`, error.message);
    }

    // 3) Fallback: use simple heuristics from prototype.externalLinks (sameAs)
    const externalLinks = prototype.externalLinks || [];
    if (Array.isArray(externalLinks) && externalLinks.length > 0) {
      console.log(`🔗 Using ${externalLinks.length} external links as fallback candidates`);
      const linkCandidates = externalLinks.slice(0, 16).map((uri) =>
        normalizeToCandidate(
          {
            name: uri.split('/').pop() || uri,
            uri,
            predicate: 'externalUrl',
            source: 'external',
            sourceTrust: getSourceTrust('external'),
            externalLinks: [uri],
          },
          context
        )
      );
      providers.push(Promise.resolve(linkCandidates));
    }

    // Stream results incrementally — trickle each provider's results in small batches
    const aggregated = [];
    console.log(`⏳ Streaming ${providers.length} providers as they resolve...`);

    const emitProgress = () => {
      if (!onProgress) return;
      const snapshot = dedupeAndPartitionOrbit([...aggregated]);
      // Only emit if we have at least some tier A/B results (skip externalUrl-only flashes)
      if (snapshot.ring1.length > 0 || snapshot.ring2.length > 0) {
        console.log(`📡 Streaming update: R1=${snapshot.ring1.length}, R2=${snapshot.ring2.length}, R3=${snapshot.ring3.length}, R4=${snapshot.ring4.length}`);
        onProgress(snapshot);
      }
    };

    const tracked = providers.map((p, idx) =>
      p.then(async (results) => {
        if (!Array.isArray(results) || results.length === 0) {
          console.log(`✅ Provider ${idx + 1} returned 0 candidates`);
          return results;
        }
        console.log(`✅ Provider ${idx + 1} returned ${results.length} candidates`);

        if (onProgress) {
          // Trickle results in small batches with delays for streaming effect
          for (let i = 0; i < results.length; i += TRICKLE_BATCH) {
            const batch = results.slice(i, i + TRICKLE_BATCH);
            aggregated.push(...batch);
            emitProgress();
            if (i + TRICKLE_BATCH < results.length) {
              await new Promise(r => setTimeout(r, TRICKLE_DELAY_MS));
            }
          }
        } else {
          aggregated.push(...results);
        }
        return results;
      }).catch((error) => {
        console.warn(`❌ Provider ${idx + 1} failed:`, error?.message || 'unknown error');
        return [];
      })
    );

    await Promise.allSettled(tracked);

    const result = dedupeAndPartitionOrbit(aggregated);
    console.log(`🎯 Final orbit rings: R1=${result.ring1.length}, R2=${result.ring2.length}, R3=${result.ring3.length}, R4=${result.ring4.length}`);

    orbitCache.set(key, { timestamp: now, candidates: result });
    return result;
  } catch (error) {
    console.error(`❌ Orbit resolver error for "${prototype.name}":`, error);
    return { ring1: [], ring2: [], ring3: [], ring4: [], all: [] };
  }
}

export function invalidateOrbitCacheForPrototype(prototypeId) {
  orbitCache.delete(prototypeId);
}
