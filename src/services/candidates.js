// Candidate schema utilities and scoring

// Predicate tiers and weights
export const PREDICATE_TIERS = {
  // Tier A (core)
  instanceOf: { tier: 'A', weight: 1.0 },
  subclassOf: { tier: 'A', weight: 0.95 },
  memberOf: { tier: 'A', weight: 0.9 },
  partOf: { tier: 'A', weight: 0.9 },
  hasPart: { tier: 'A', weight: 0.9 },
  creator: { tier: 'A', weight: 0.95 },
  author: { tier: 'A', weight: 0.95 },
  performer: { tier: 'A', weight: 0.9 },
  genre: { tier: 'A', weight: 0.85 },
  subject: { tier: 'A', weight: 0.85 },
  organization: { tier: 'A', weight: 0.9 },
  label: { tier: 'A', weight: 0.85 },
  place: { tier: 'A', weight: 0.85 },
  date: { tier: 'A', weight: 0.8 },

  // Tier B (context)
  influencedBy: { tier: 'B', weight: 0.7 },
  collaborator: { tier: 'B', weight: 0.7 },
  associatedAct: { tier: 'B', weight: 0.65 },
  publication: { tier: 'B', weight: 0.65 },
  award: { tier: 'B', weight: 0.6 },
  instrument: { tier: 'B', weight: 0.6 },
  movement: { tier: 'B', weight: 0.6 },
  language: { tier: 'B', weight: 0.55 },
  relatedTo: { tier: 'B', weight: 0.6 },
  related: { tier: 'B', weight: 0.6 },
  related_via: { tier: 'B', weight: 0.6 },

  // Tier C (metadata)
  authorityId: { tier: 'C', weight: 0.3 },
  externalUrl: { tier: 'C', weight: 0.25 },
  category: { tier: 'C', weight: 0.2 }
};

export function getPredicateInfo(predicate) {
  if (!predicate) return { tier: 'C', weight: 0.2 };
  const key = String(predicate).trim();
  return PREDICATE_TIERS[key] || { tier: 'C', weight: 0.2 };
}

// Score = sourceTrust × predicateWeight × valueSalience × recency × contextFit
export function scoreCandidate({ sourceTrust = 0.8, predicate, valueSalience = 0.8, recency = 1.0, contextFit = 0.8 }) {
  const { weight } = getPredicateInfo(predicate);
  const factors = [sourceTrust, weight, valueSalience, recency, contextFit]
    .map(v => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.0));
  return factors.reduce((acc, v) => acc * v, 1.0);
}

// Normalize any provider result into a canonical Candidate object
// Candidate: { id, name, uri, source, predicate, tier, score, color, claims, externalLinks, equivalentClasses, retrievedAt }
export function normalizeToCandidate(result, context = {}) {
  const name = result.name || result.label || result.title || 'Untitled';
  const uri = result.uri || result.id || null;
  const predicate = result.predicate || result.relation || null;
  const { tier, weight } = getPredicateInfo(predicate);
  const source = result.source || 'external';
  const claims = Array.isArray(result.claims) ? result.claims : [];
  const externalLinks = Array.isArray(result.externalLinks) ? result.externalLinks : (uri ? [uri] : []);
  const equivalentClasses = Array.isArray(result.equivalentClasses) ? result.equivalentClasses : (Array.isArray(result.types) ? result.types.map(t => ({ '@id': t })) : []);
  const retrievedAt = result.retrievedAt || new Date().toISOString();
  const color = result.color || '#8B0000';

  const score = scoreCandidate({
    sourceTrust: result.sourceTrust ?? 0.8,
    predicate,
    valueSalience: result.valueSalience ?? 0.8,
    recency: result.recency ?? 1.0,
    contextFit: result.contextFit ?? context.contextFit ?? 0.8
  });

  return {
    id: result.id || `${source}:${uri || name}`,
    name,
    uri,
    source,
    predicate,
    tier,
    weight,
    score,
    color,
    claims,
    externalLinks,
    equivalentClasses,
    retrievedAt
  };
}

// Convert Candidate to the concept object our panel/canvas drop already understands
export function candidateToConcept(candidate) {
  return {
    name: candidate.name,
    color: candidate.color,
    description: '',
    source: candidate.source,
    discoveredAt: candidate.retrievedAt,
    relationships: [],
    semanticMetadata: {
      originalUri: candidate.uri,
      equivalentClasses: candidate.equivalentClasses,
      externalLinks: candidate.externalLinks,
      confidence: Math.max(0.5, Math.min(1.0, candidate.score || 0.8))
    },
    // Attach predicate for auto-edge creation on promote
    defaultPredicate: candidate.predicate || null
  };
}


