/**
 * Wikipedia Enrichment Service — runs server-side (Node.js / wizard-server).
 *
 * Handles all Wikipedia API calls so the Electron renderer doesn't need to.
 * Returns lightweight metadata (URLs as strings, never image binaries).
 *
 * IMPORTANT: This file is imported by wizard-server.js.
 * NEVER use console.log() — use console.error() for logging (MCP stdio rule).
 */

/**
 * Normalize a label for comparison (lowercase, strip punctuation, collapse whitespace).
 */
function normalizeLabel(label) {
  if (!label) return '';
  return label
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Levenshtein distance between two strings.
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = [];
  for (let i = 0; i <= len1; i++) matrix[i] = [i];
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[len1][len2];
}

/**
 * Text similarity (0.0 to 1.0) using Levenshtein distance.
 */
function calculateTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0.0;
  const n1 = normalizeLabel(text1);
  const n2 = normalizeLabel(text2);
  if (n1 === n2) return 1.0;
  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - (levenshteinDistance(n1, n2) / maxLen);
}

/**
 * Calculate confidence score for a Wikipedia match (0.0 to 1.0).
 */
function calculateWikipediaConfidence(nodeName, wikipediaResult) {
  let confidence = 0;

  if (wikipediaResult.type === 'direct') {
    confidence += 0.40;
  } else {
    return 0.0;
  }

  const norm1 = normalizeLabel(nodeName);
  const norm2 = normalizeLabel(wikipediaResult.page.title);
  const compact1 = norm1.replace(/\s+/g, '');
  const compact2 = norm2.replace(/\s+/g, '');

  if (norm1 === norm2 || compact1 === compact2) {
    confidence += 0.50;
  } else if (norm2.includes(norm1) || norm1.includes(norm2)) {
    confidence += 0.45;
  } else {
    const similarity = Math.max(
      calculateTextSimilarity(norm1, norm2),
      calculateTextSimilarity(compact1, compact2)
    );
    confidence += similarity * 0.50;
  }

  return confidence;
}

/**
 * Lightweight Wikipedia summary fetch — 1 API call.
 * Returns { type, page? { title, description, url, thumbnail, originalImage }, options? }
 */
async function fetchWikipediaSummary(query) {
  try {
    const response = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
      { headers: { 'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai)' } }
    );

    if (!response.ok) return { type: 'not_found' };

    const data = await response.json();

    const isDisambiguation = data.type === 'disambiguation' ||
      data.title?.includes('(disambiguation)') ||
      data.description?.toLowerCase().includes('disambiguation');

    if (isDisambiguation) {
      try {
        const searchResp = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=5`,
          { headers: { 'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai)' } }
        );
        if (searchResp.ok) {
          const searchData = await searchResp.json();
          const options = (searchData.query?.search || []).map(r => ({ title: r.title }));
          return { type: 'disambiguation', options };
        }
      } catch { /* fall through */ }
      return { type: 'disambiguation', options: [] };
    }

    return {
      type: 'direct',
      page: {
        title: data.title,
        description: data.extract || data.description || '',
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
        thumbnail: data.thumbnail?.source || null,
        thumbnailWidth: data.thumbnail?.width || null,
        thumbnailHeight: data.thumbnail?.height || null,
        originalImage: data.originalimage?.source || null
      }
    };
  } catch {
    return { type: 'not_found' };
  }
}

/**
 * Resolve a Wikipedia match with disambiguation + plural fallbacks.
 * Returns { searchResult, confidence } or null.
 */
async function resolveWikipediaMatch(nodeName, minConfidence = 0.40) {
  // Try 1: Direct lookup
  let result = await fetchWikipediaSummary(nodeName);

  // Try 2: If disambiguation, use first search result
  if (result.type === 'disambiguation' && result.options?.length > 0) {
    console.error(`[Enrich Server] "${nodeName}" is disambiguation, trying "${result.options[0].title}"`);
    result = await fetchWikipediaSummary(result.options[0].title);
  }

  // Try 3: Singular form — "Lungs" → "Lung", "Bones" → "Bone"
  if (result.type !== 'direct') {
    const trimmed = nodeName.trim();
    let altName = null;
    if (trimmed.endsWith('es') && trimmed.length > 3) altName = trimmed.slice(0, -2);
    else if (trimmed.endsWith('s') && !trimmed.endsWith('ss') && trimmed.length > 2) altName = trimmed.slice(0, -1);

    if (altName) {
      console.error(`[Enrich Server] "${nodeName}" not found, trying singular: "${altName}"`);
      result = await fetchWikipediaSummary(altName);
      if (result.type === 'disambiguation' && result.options?.length > 0) {
        result = await fetchWikipediaSummary(result.options[0].title);
      }
    }
  }

  if (result.type !== 'direct') return null;

  const confidence = calculateWikipediaConfidence(nodeName, result);
  if (confidence < minConfidence) {
    console.error(`[Enrich Server] "${nodeName}" → low confidence (${confidence.toFixed(2)})`);
    return null;
  }

  return { searchResult: result, confidence };
}

/**
 * Enrich a batch of node names with Wikipedia metadata.
 * Returns an array of { nodeName, searchResult, confidence } for matches.
 *
 * Runs all lookups with concurrency limit to avoid hammering Wikipedia.
 */
export async function enrichBatch(nodeNames, { minConfidence = 0.40, concurrency = 4 } = {}) {
  console.error(`[Enrich Server] 🚀 Batch enrichment for ${nodeNames.length} nodes`);

  const results = new Array(nodeNames.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < nodeNames.length) {
      const i = nextIndex++;
      const nodeName = nodeNames[i];
      try {
        const match = await resolveWikipediaMatch(nodeName, minConfidence);
        if (match) {
          results[i] = { nodeName, ...match };
          console.error(`[Enrich Server] ✅ "${nodeName}" → "${match.searchResult.page.title}" (${match.confidence.toFixed(2)})`);
        } else {
          results[i] = null;
        }
      } catch (err) {
        console.error(`[Enrich Server] ❌ "${nodeName}" failed:`, err.message);
        results[i] = null;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, nodeNames.length) }, () => worker())
  );

  const matches = results.filter(Boolean);
  console.error(`[Enrich Server] 📊 ${matches.length}/${nodeNames.length} matches found`);
  return matches;
}

/**
 * Enrich a single node name.
 * Returns { nodeName, searchResult, confidence } or null.
 */
export async function enrichSingle(nodeName, { minConfidence = 0.40 } = {}) {
  const match = await resolveWikipediaMatch(nodeName, minConfidence);
  if (match) {
    console.error(`[Enrich Server] ✅ "${nodeName}" → "${match.searchResult.page.title}" (${match.confidence.toFixed(2)})`);
    return { nodeName, ...match };
  }
  return null;
}
