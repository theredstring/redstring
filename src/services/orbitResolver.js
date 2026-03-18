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
                predicate: r.predicate || 'relatedTo',
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
              predicate: r.connectionType || r.predicate || 'relatedTo',
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

    let aggregated = [];
    console.log(`⏳ Waiting for ${providers.length} providers to complete...`);
    const batches = await Promise.allSettled(providers);

    batches.forEach((b, idx) => {
      if (b.status === 'fulfilled' && Array.isArray(b.value)) {
        console.log(`✅ Provider ${idx + 1} returned ${b.value.length} candidates`);
        aggregated.push(...b.value);
      } else {
        console.warn(`❌ Provider ${idx + 1} failed:`, b.reason?.message || 'unknown error');
      }
    });

    console.log(`📈 Total raw candidates before dedup: ${aggregated.length}`);

    // Dedupe by id to prevent React key collisions and redundant visual nodes
    const seen = new Set();
    aggregated = aggregated.filter((c) => {
      // Use id as the primary uniqueness constraint for React keys
      // If two candidates have same source+uri but different names, they collide.
      // We keep the first one encountered.
      const key = c.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`🔄 After deduplication: ${aggregated.length} candidates`);

    // Sort by score desc
    aggregated.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Partition candidates into 4 rings with semantic grouping
    const tierA = aggregated.filter((c) => c.tier === 'A');
    const tierB = aggregated.filter((c) => c.tier === 'B');
    const tierC = aggregated.filter((c) => c.tier === 'C');

    // Ring 1: Tier A top concepts (closest to node)
    const ring1 = tierA.slice(0, 10);

    // Ring 2: Tier A overflow + Tier B top
    const ring2 = tierA.slice(10).concat(tierB).slice(0, 10);

    // Ring 3: Tier B/C mid-importance
    const tierBCRemaining = aggregated.filter(c => !ring1.includes(c) && !ring2.includes(c));
    const ring3 = tierBCRemaining.slice(0, 10);

    // Ring 4: Lower-priority items (outermost)
    const ring4 = tierBCRemaining.slice(10, 20);

    console.log(`🎯 Final orbit rings: R1=${ring1.length}, R2=${ring2.length}, R3=${ring3.length}, R4=${ring4.length}`);

    const result = { ring1, ring2, ring3, ring4, all: aggregated };
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
