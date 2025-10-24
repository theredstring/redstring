/**
 * Entity Matching Service
 *
 * Multi-factor confidence scoring for entity deduplication across knowledge sources.
 * Handles sameAs links, external identifiers, and fuzzy matching.
 */

/**
 * Source reliability weights
 */
const SOURCE_CONFIDENCE = {
  wikipedia: 0.95,
  wikidata: 0.90,
  dbpedia: 0.80,
  external: 0.60
};

/**
 * Normalize label for comparison
 */
function normalizeLabel(label) {
  if (!label) return '';
  return label
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ');   // Normalize whitespace
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate text similarity (0.0 to 1.0)
 */
function calculateTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0.0;

  const normalized1 = normalizeLabel(text1);
  const normalized2 = normalizeLabel(text2);

  if (normalized1 === normalized2) return 1.0;

  const maxLen = Math.max(normalized1.length, normalized2.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(normalized1, normalized2);
  return 1.0 - (distance / maxLen);
}

/**
 * Extract Wikidata QID from URI
 */
function extractWikidataId(uri) {
  if (!uri) return null;

  // Match Q followed by digits
  const match = uri.match(/Q\d+/);
  return match ? match[0] : null;
}

/**
 * Extract external identifiers from entity
 */
function extractExternalIds(entity) {
  const ids = {
    wikidataId: null,
    dbpediaUri: null,
    wikipediaUrl: null
  };

  // Check direct properties
  if (entity.wikidataId) {
    ids.wikidataId = entity.wikidataId;
  }

  // Check in URIs and links
  const uris = [
    entity.uri,
    entity.url,
    ...(entity.externalLinks || []),
    ...(entity.sameAsLinks || [])
  ].filter(Boolean);

  for (const uri of uris) {
    if (uri.includes('wikidata.org')) {
      ids.wikidataId = extractWikidataId(uri);
    } else if (uri.includes('dbpedia.org')) {
      ids.dbpediaUri = uri;
    } else if (uri.includes('wikipedia.org')) {
      ids.wikipediaUrl = uri;
    }
  }

  return ids;
}

/**
 * Calculate entity match confidence using multiple factors
 * @param {Object} entity1 - First entity
 * @param {Object} entity2 - Second entity
 * @returns {number} Confidence score (0.0 to 1.0)
 */
export function calculateEntityMatchConfidence(entity1, entity2) {
  let score = 0.0;
  const factors = [];

  // Extract external IDs
  const ids1 = extractExternalIds(entity1);
  const ids2 = extractExternalIds(entity2);

  // Factor 1: Wikidata QID match (highest confidence)
  if (ids1.wikidataId && ids2.wikidataId) {
    if (ids1.wikidataId === ids2.wikidataId) {
      score += 0.95;
      factors.push({ factor: 'wikidata_id_match', score: 0.95 });
    } else {
      // Different Wikidata IDs = definitely different entities
      return 0.0;
    }
  }

  // Factor 2: DBpedia URI match
  if (ids1.dbpediaUri && ids2.dbpediaUri) {
    if (ids1.dbpediaUri === ids2.dbpediaUri) {
      score += 0.90;
      factors.push({ factor: 'dbpedia_uri_match', score: 0.90 });
    }
  }

  // Factor 3: Wikipedia URL match
  if (ids1.wikipediaUrl && ids2.wikipediaUrl) {
    if (ids1.wikipediaUrl === ids2.wikipediaUrl) {
      score += 0.90;
      factors.push({ factor: 'wikipedia_url_match', score: 0.90 });
    }
  }

  // Factor 4: Explicit sameAs links (bidirectional is stronger)
  const sameAsLinks1 = new Set(entity1.sameAsLinks || []);
  const sameAsLinks2 = new Set(entity2.sameAsLinks || []);

  const uri1 = entity1.uri || entity1.url;
  const uri2 = entity2.uri || entity2.url;

  if (uri1 && uri2) {
    const has1to2 = sameAsLinks1.has(uri2);
    const has2to1 = sameAsLinks2.has(uri1);

    if (has1to2 && has2to1) {
      // Bidirectional sameAs = high confidence
      score += 0.85;
      factors.push({ factor: 'bidirectional_sameas', score: 0.85 });
    } else if (has1to2 || has2to1) {
      // Unidirectional sameAs = moderate confidence
      score += 0.65;
      factors.push({ factor: 'unidirectional_sameas', score: 0.65 });
    }
  }

  // Factor 5: Label exact match (after normalization)
  const label1 = normalizeLabel(entity1.label || entity1.name);
  const label2 = normalizeLabel(entity2.label || entity2.name);

  if (label1 && label2) {
    if (label1 === label2) {
      score += 0.80;
      factors.push({ factor: 'label_exact_match', score: 0.80 });
    } else {
      // Fuzzy label match
      const labelSimilarity = calculateTextSimilarity(label1, label2);
      if (labelSimilarity > 0.85) {
        const fuzzyScore = labelSimilarity * 0.70;
        score += fuzzyScore;
        factors.push({ factor: 'label_fuzzy_match', score: fuzzyScore, similarity: labelSimilarity });
      }
    }
  }

  // Factor 6: Description similarity
  const desc1 = entity1.description || entity1.comment;
  const desc2 = entity2.description || entity2.comment;

  if (desc1 && desc2 && desc1.length > 20 && desc2.length > 20) {
    const descSimilarity = calculateTextSimilarity(desc1, desc2);
    if (descSimilarity > 0.70) {
      const descScore = descSimilarity * 0.60;
      score += descScore;
      factors.push({ factor: 'description_similarity', score: descScore, similarity: descSimilarity });
    }
  }

  // Normalize score to [0, 1]
  const normalizedScore = Math.min(score, 1.0);

  return {
    confidence: normalizedScore,
    factors,
    shouldMerge: normalizedScore >= 0.85, // Auto-merge threshold
    needsReview: normalizedScore >= 0.65 && normalizedScore < 0.85
  };
}

/**
 * Merge entity data from multiple sources
 * @param {Array} entities - Array of entities representing the same thing
 * @returns {Object} Merged entity
 */
export function mergeEntities(entities) {
  if (!entities || entities.length === 0) return null;
  if (entities.length === 1) return entities[0];

  const merged = {
    name: null,
    label: null,
    description: null,
    uri: null,
    externalLinks: [],
    sameAsLinks: [],
    sources: [],
    properties: new Map(),
    types: [],
    confidence: 0
  };

  // Collect all external IDs
  const allIds = entities.map(extractExternalIds);
  const wikidataIds = allIds.map(ids => ids.wikidataId).filter(Boolean);
  const dbpediaUris = allIds.map(ids => ids.dbpediaUri).filter(Boolean);
  const wikipediaUrls = allIds.map(ids => ids.wikipediaUrl).filter(Boolean);

  // Use most common IDs (or first if all unique)
  merged.wikidataId = wikidataIds[0];
  merged.dbpediaUri = dbpediaUris[0];
  merged.wikipediaUrl = wikipediaUrls[0];

  // Pick best name/label (prioritize by source)
  const sourceOrder = ['wikipedia', 'wikidata', 'dbpedia', 'external'];
  for (const sourceName of sourceOrder) {
    const fromSource = entities.find(e =>
      (e.source || '').toLowerCase() === sourceName
    );
    if (fromSource && (fromSource.name || fromSource.label)) {
      merged.name = fromSource.name || fromSource.label;
      merged.label = fromSource.label || fromSource.name;
      break;
    }
  }

  // If still no name, use first available
  if (!merged.name) {
    merged.name = entities[0].name || entities[0].label || 'Unknown';
  }

  // Pick best description (prioritize Wikipedia > DBpedia > Wikidata)
  for (const sourceName of sourceOrder) {
    const fromSource = entities.find(e =>
      (e.source || '').toLowerCase() === sourceName
    );
    if (fromSource && (fromSource.description || fromSource.comment)) {
      merged.description = fromSource.description || fromSource.comment;
      break;
    }
  }

  // Collect all URIs and links
  for (const entity of entities) {
    if (entity.uri) merged.externalLinks.push(entity.uri);
    if (entity.url) merged.externalLinks.push(entity.url);
    if (entity.externalLinks) {
      merged.externalLinks.push(...entity.externalLinks);
    }
    if (entity.sameAsLinks) {
      merged.sameAsLinks.push(...entity.sameAsLinks);
    }
    if (entity.source) {
      merged.sources.push(entity.source);
    }
  }

  // Deduplicate links
  merged.externalLinks = [...new Set(merged.externalLinks)];
  merged.sameAsLinks = [...new Set(merged.sameAsLinks)];
  merged.sources = [...new Set(merged.sources)];

  // Use primary URI (prefer Wikidata > DBpedia > Wikipedia > first available)
  merged.uri = merged.wikidataId
    ? `http://www.wikidata.org/entity/${merged.wikidataId}`
    : (merged.dbpediaUri || merged.wikipediaUrl || merged.externalLinks[0]);

  // Merge properties
  for (const entity of entities) {
    if (entity.properties) {
      const props = entity.properties instanceof Map
        ? entity.properties
        : new Map(Object.entries(entity.properties));

      for (const [key, value] of props) {
        if (!merged.properties.has(key)) {
          merged.properties.set(key, []);
        }
        if (Array.isArray(value)) {
          merged.properties.get(key).push(...value);
        } else {
          merged.properties.get(key).push(value);
        }
      }
    }
  }

  // Merge types
  for (const entity of entities) {
    if (entity.types && Array.isArray(entity.types)) {
      merged.types.push(...entity.types);
    }
  }
  merged.types = [...new Set(merged.types)];

  // Calculate average confidence
  const confidences = entities.map(e => e.confidence || 0.75).filter(c => c > 0);
  merged.confidence = confidences.length > 0
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
    : 0.75;

  return merged;
}

/**
 * Deduplicate entities across sources using confident matching
 * @param {Array} entities - Array of entities from various sources
 * @param {Object} options - Deduplication options
 * @returns {Array} Deduplicated entities
 */
export function deduplicateEntities(entities, options = {}) {
  const {
    autoMergeThreshold = 0.85,
    returnDuplicates = false
  } = options;

  if (!entities || entities.length === 0) return [];

  const groups = []; // Groups of matching entities
  const processed = new Set();

  for (let i = 0; i < entities.length; i++) {
    if (processed.has(i)) continue;

    const group = [entities[i]];
    processed.add(i);

    // Find all entities that match this one
    for (let j = i + 1; j < entities.length; j++) {
      if (processed.has(j)) continue;

      const matchResult = calculateEntityMatchConfidence(entities[i], entities[j]);

      if (matchResult.confidence >= autoMergeThreshold) {
        group.push(entities[j]);
        processed.add(j);
      }
    }

    groups.push(group);
  }

  // Merge each group
  const deduplicated = groups.map(group => {
    if (group.length === 1) {
      return group[0];
    }
    return mergeEntities(group);
  });

  if (returnDuplicates) {
    return {
      deduplicated,
      duplicateGroups: groups.filter(g => g.length > 1)
    };
  }

  return deduplicated;
}

/**
 * Find potential duplicates that need manual review
 * @param {Array} entities - Array of entities
 * @returns {Array} Pairs of potentially duplicate entities
 */
export function findPotentialDuplicates(entities) {
  const potentialDuplicates = [];

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const matchResult = calculateEntityMatchConfidence(entities[i], entities[j]);

      if (matchResult.needsReview) {
        potentialDuplicates.push({
          entity1: entities[i],
          entity2: entities[j],
          matchConfidence: matchResult.confidence,
          factors: matchResult.factors
        });
      }
    }
  }

  // Sort by confidence (highest first - most likely duplicates)
  potentialDuplicates.sort((a, b) => b.matchConfidence - a.matchConfidence);

  return potentialDuplicates;
}
