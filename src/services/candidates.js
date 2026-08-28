// Candidate schema utilities and scoring
import { PALETTES } from '../ai/palettes.js';
import { canonicalizeLink, setLinkState, LINK_STATES } from '../formats/linkState.js';
import { isValidURL } from '../utils/externalIdentifiers.js';

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
  category: { tier: 'C', weight: 0.2 },
  // Infrastructure noise — deprioritize if any slip through SPARQL filters
  wikiPageWikiLink: { tier: 'C', weight: 0.1 },
  wikiPageExternalLink: { tier: 'C', weight: 0.05 },
  wikiPageRedirects: { tier: 'C', weight: 0.05 },
  wikiPageDisambiguates: { tier: 'C', weight: 0.05 },
  wikiPageID: { tier: 'C', weight: 0.05 },
  wikiPageRevisionID: { tier: 'C', weight: 0.05 },
  wikiPageLength: { tier: 'C', weight: 0.05 },
  abstract: { tier: 'C', weight: 0.05 },
  thumbnail: { tier: 'C', weight: 0.05 },
  depiction: { tier: 'C', weight: 0.05 },
  broader: { tier: 'C', weight: 0.1 },
  narrower: { tier: 'C', weight: 0.1 },
  seeAlso: { tier: 'C', weight: 0.1 },
  isPrimaryTopicOf: { tier: 'C', weight: 0.05 }
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
  // The authority's own one-line gloss, when the provider gave us one. It is
  // what tells two same-named concepts apart on a card, so it has to survive
  // the trip through Candidate rather than being re-fetched later.
  const description = result.description || result.comment || '';
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
    retrievedAt,
    description
  };
}

// Convert Candidate to the concept object our panel/canvas drop already understands
export function candidateToConcept(candidate) {
  return {
    id: candidate.uri || `concept-${candidate.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: candidate.name,
    color: candidate.color,
    description: candidate.description || '',
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

/**
 * The prototype fields a concept becomes when it lands in a universe.
 *
 * Every path that materializes a discovered concept — the canvas drop, the
 * orbit click, the panel's Add — built these inline and identically, and all
 * three left out the one that matters: a top-level `externalLinks`. The
 * concept's URI only ever reached `semanticMetadata`, which the format layer
 * carries verbatim but never reads for the sameness ladder. So dragging in a
 * Wikipedia concept produced a Thing that LOOKED linked in the panel (About
 * unions semanticMetadata when it reads) and exported with no rdfs:seeAlso and
 * no skos rung at all. Invisible to every other tool.
 *
 * Links land as EXACT: this Thing is a local copy of that entry, made from its
 * name and its description. If that isn't an exact match, nothing is. It is
 * still one click to lower in About.
 *
 * @param {object} concept - a concept from candidateToConcept, plus source/searchQuery
 * @returns {{externalLinks: string[], semanticMetadata: object, originalDescription: string}}
 */
export function conceptToPrototypeFields(concept) {
  const originInfo = {
    source: concept.source,
    discoveredAt: concept.discoveredAt,
    searchQuery: concept.searchQuery || '',
    confidence: concept.semanticMetadata?.confidence || 0.8,
    originalUri: concept.semanticMetadata?.originalUri,
    relationships: concept.relationships || []
  };

  const links = [];
  const add = (url) => {
    // Absolute only. Some providers hand back relative paths ('/c/en/dog'),
    // which are useless as identifiers and render as a broken row in About.
    if (typeof url !== 'string' || !url.trim() || !isValidURL(url)) return;
    if (links.some(existing => canonicalizeLink(existing) === canonicalizeLink(url))) return;
    links.push(url);
  };
  add(concept.semanticMetadata?.originalUri);
  (concept.semanticMetadata?.externalLinks || []).forEach(add);

  let semanticMetadata = {
    ...concept.semanticMetadata,
    externalLinks: links,
    relationships: concept.relationships,
    originMetadata: originInfo,
    isSemanticNode: true
  };
  // The dedicated fields About uses to pair a lookup's halves and to fill its
  // standing slots, so a dragged-in concept starts out grounded rather than
  // showing three empty rows next to a link it plainly has.
  for (const url of links) {
    if (url.includes('wikidata.org')) semanticMetadata.wikidataUrl = semanticMetadata.wikidataUrl || url;
    if (url.includes('wikipedia.org')) semanticMetadata.wikipediaUrl = semanticMetadata.wikipediaUrl || url;
    semanticMetadata = setLinkState(semanticMetadata, url, LINK_STATES.EXACT, 'user');
  }

  return {
    externalLinks: links,
    semanticMetadata,
    originalDescription: concept.description
  };
}

/**
 * Put a concept's links onto a prototype that already exists.
 *
 * Every materialization path deduplicates first and returns the existing id
 * untouched, which is right — dragging the same concept twice shouldn't make
 * two Things. But it also meant a Thing created before its path started
 * recording links could never acquire them: the only code that sets them runs
 * exclusively on first creation. That covers every semantic node made before
 * this change, and it is why re-dragging a concept appeared to do nothing.
 *
 * Returns null when there is nothing to add, so callers can skip the write
 * rather than push a no-op into undo history.
 *
 * @param {object} prototype - the existing prototype from the store
 * @param {object} concept
 * @returns {{externalLinks: string[], semanticMetadata: object}|null}
 */
export function backfillConceptLinks(prototype, concept) {
  const fields = conceptToPrototypeFields(concept);
  if (fields.externalLinks.length === 0) return null;

  const existing = Array.isArray(prototype?.externalLinks) ? prototype.externalLinks : [];
  const known = new Set(existing.map(canonicalizeLink));
  const missing = fields.externalLinks.filter(url => !known.has(canonicalizeLink(url)));
  if (missing.length === 0) return null;

  let semanticMetadata = { ...(prototype?.semanticMetadata || {}) };
  for (const url of missing) {
    if (url.includes('wikidata.org')) semanticMetadata.wikidataUrl = semanticMetadata.wikidataUrl || url;
    if (url.includes('wikipedia.org')) semanticMetadata.wikipediaUrl = semanticMetadata.wikipediaUrl || url;
    semanticMetadata = setLinkState(semanticMetadata, url, LINK_STATES.EXACT, 'user');
  }
  semanticMetadata.externalLinks = [...existing, ...missing];

  return { externalLinks: [...existing, ...missing], semanticMetadata };
}


