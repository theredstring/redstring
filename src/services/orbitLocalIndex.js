import { v4 as uuidv4 } from 'uuid';

// Lightweight local catalog for Orbit suggestions.
// Stores a URI-indexed set of prototype-like records plus explicit related links.
const indexByUri = new Map(); // uri -> entry
const labelIndex = new Map(); // lower(name) -> Set<uri>

const trust = 0.9; // Local index confidence; higher than remote fallback

const normalizeLabel = (label) => (label || '').trim().toLowerCase();

export function clearOrbitIndex() {
  indexByUri.clear();
  labelIndex.clear();
}

function addLabelIndex(label, uri) {
  if (!label || !uri) return;
  const key = normalizeLabel(label);
  if (!labelIndex.has(key)) labelIndex.set(key, new Set());
  labelIndex.get(key).add(uri);
}

/**
 * Ingests catalog entries and optionally upserts protected prototypes into the store.
 * Each entry shape:
 * {
 *   uri: 'http://example.org/entity',
 *   label: 'Example',
 *   description?: '...',
 *   types?: ['Q5'],
 *   source?: 'orbit-local',
 *   related?: [{ uri, label, predicate?, source?, types? }]
 * }
 */
export function ingestOrbitIndexEntries(entries = [], { graphStore } = {}) {
  const store = graphStore || null;
  entries.forEach((entry) => {
    if (!entry || !entry.uri || !entry.label) return;
    const uri = entry.uri;
    const record = {
      ...entry,
      uri,
      id: entry.id || uri,
      source: entry.source || 'orbit-local',
      related: Array.isArray(entry.related) ? entry.related : [],
    };

    indexByUri.set(uri, record);
    addLabelIndex(record.label, uri);

    if (Array.isArray(record.aliases)) {
      record.aliases.forEach((alias) => addLabelIndex(alias, uri));
    }

    // Optionally materialize into the store so it appears in All Things and resists cleanup.
    if (store?.getState()?.upsertProtectedPrototype) {
      const upsert = store.getState().upsertProtectedPrototype;
      upsert({
        id: record.id,
        name: record.label,
        description: record.description || '',
        typeNodeId: record.typeNodeId || 'base-thing-prototype',
        externalLinks: [uri],
        equivalentClasses: record.types || [],
        source: record.source,
        isOrbitCatalog: true,
      });
    }
  });
}

function getEntryForPrototype(prototype) {
  // Try URIs first
  const uris = new Set();
  (prototype.externalLinks || []).forEach((u) => uris.add(u));
  if (prototype.semanticMetadata?.externalLinks) {
    prototype.semanticMetadata.externalLinks.forEach((u) => uris.add(u));
  }

  for (const uri of uris) {
    if (indexByUri.has(uri)) return indexByUri.get(uri);
  }

  // Fallback to label match
  const labelKey = normalizeLabel(prototype.name);
  if (labelIndex.has(labelKey)) {
    const [firstUri] = Array.from(labelIndex.get(labelKey));
    return indexByUri.get(firstUri);
  }

  return null;
}

/**
 * Returns related candidates from the local index for the given prototype.
 * Shapes are compatible with normalizeToCandidate inputs in orbitResolver.
 */
export async function findLocalOrbitCandidates(prototype, options = {}) {
  const { limit = 48 } = options;
  if (!prototype) return [];
  const entry = getEntryForPrototype(prototype);
  if (!entry) return [];

  const related = entry.related || [];

  return related.slice(0, limit).map((rel) => ({
    name: rel.label || rel.name || rel.uri || 'Unknown',
    uri: rel.uri,
    predicate: rel.predicate || 'relatedTo',
    source: rel.source || entry.source || 'orbit-local',
    sourceTrust: trust,
    externalLinks: rel.uri ? [rel.uri] : [],
    types: rel.types || [],
  }));
}
