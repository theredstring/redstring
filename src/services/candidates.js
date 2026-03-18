// Candidate schema utilities and scoring
import { PALETTES } from '../ai/palettes.js';

// Get a consistent color from existing palettes based on a string
// Dynamically uses all palette colors, so updates when palettes change
function getColorFromPalettes(str) {
  // Flatten all palette colors into a single array
  const allColors = Object.values(PALETTES).flatMap(palette =>
    Object.values(palette.colors)
  );

  if (allColors.length === 0) return '#8B0000'; // Fallback if no palettes

  // Simple hash function for consistent color selection
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Use hash to pick a color consistently
  const index = Math.abs(hash) % allColors.length;
  return allColors[index];
}

// Predicate tiers and weights
export const PREDICATE_TIERS = {
  // Tier A (core identity and attributes)
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
  // Biographical predicates
  birthPlace: { tier: 'A', weight: 0.9 },
  birthDate: { tier: 'A', weight: 0.85 },
  deathPlace: { tier: 'A', weight: 0.85 },
  deathDate: { tier: 'A', weight: 0.8 },
  placeOfBirth: { tier: 'A', weight: 0.9 },
  dateOfBirth: { tier: 'A', weight: 0.85 },
  placeOfDeath: { tier: 'A', weight: 0.85 },
  dateOfDeath: { tier: 'A', weight: 0.8 },
  // Professional/identity predicates
  occupation: { tier: 'A', weight: 0.9 },
  country: { tier: 'A', weight: 0.85 },
  nationality: { tier: 'A', weight: 0.85 },
  position: { tier: 'A', weight: 0.85 },
  field: { tier: 'A', weight: 0.8 },
  knownFor: { tier: 'A', weight: 0.85 },

  // Tier B (relationships and context)
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
  // Organizational relationships
  founder: { tier: 'B', weight: 0.75 },
  foundedBy: { tier: 'B', weight: 0.75 },
  employer: { tier: 'B', weight: 0.7 },
  worksAt: { tier: 'B', weight: 0.7 },
  employee: { tier: 'B', weight: 0.65 },
  member: { tier: 'B', weight: 0.65 },
  memberOfSportsTeam: { tier: 'B', weight: 0.65 },
  team: { tier: 'B', weight: 0.65 },
  affiliation: { tier: 'B', weight: 0.6 },
  // Time-based relationships
  inception: { tier: 'B', weight: 0.7 },
  dissolved: { tier: 'B', weight: 0.65 },
  founded: { tier: 'B', weight: 0.7 },
  established: { tier: 'B', weight: 0.7 },
  // Family relationships
  spouse: { tier: 'B', weight: 0.7 },
  child: { tier: 'B', weight: 0.65 },
  parent: { tier: 'B', weight: 0.7 },
  sibling: { tier: 'B', weight: 0.65 },
  family: { tier: 'B', weight: 0.65 },
  // Geographic relationships
  citizenship: { tier: 'B', weight: 0.6 },
  residence: { tier: 'B', weight: 0.6 },
  location: { tier: 'B', weight: 0.65 },
  locatedIn: { tier: 'B', weight: 0.65 },
  capital: { tier: 'B', weight: 0.7 },

  // Tier C (metadata and identifiers)
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

// Title-case a name if it's all lowercase; preserve all-caps words and mixed-case names
function tidyName(raw) {
  if (!raw || raw === 'Untitled') return raw;
  // If every character is already lowercase (or non-letter), title-case each word
  // But if the name has any uppercase letters, assume it's intentionally cased — leave it
  if (raw !== raw.toLowerCase()) return raw;
  return raw
    .split(' ')
    .map(w => w.length === 0 ? '' : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Normalize any provider result into a canonical Candidate object
// Candidate: { id, name, uri, source, predicate, tier, score, color, claims, externalLinks, equivalentClasses, retrievedAt }
export function normalizeToCandidate(result, context = {}) {
  const name = tidyName(result.name || result.label || result.title || 'Untitled');
  const uri = result.uri || result.id || null;
  const predicate = result.predicate || result.relation || null;
  const { tier, weight } = getPredicateInfo(predicate);
  const source = result.source || 'external';
  const claims = Array.isArray(result.claims) ? result.claims : [];
  const externalLinks = Array.isArray(result.externalLinks) ? result.externalLinks : (uri ? [uri] : []);
  const equivalentClasses = Array.isArray(result.equivalentClasses) ? result.equivalentClasses : (Array.isArray(result.types) ? result.types.map(t => ({ '@id': t })) : []);
  const retrievedAt = result.retrievedAt || new Date().toISOString();
  const color = result.color || getColorFromPalettes(name);

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
    id: candidate.uri || `concept-${candidate.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
      confidence: Math.max(0.5, Math.min(1.0, candidate.score || 0.8)),
      connectionInfo: {
        predicate: candidate.predicate,
        source: candidate.source
      }
    },
    // Attach predicate for auto-edge creation on promote
    defaultPredicate: candidate.predicate || null
  };
}


