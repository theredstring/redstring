/**
 * Predicate Formatting Utilities
 *
 * Converts raw semantic web predicates/relationship types into readable labels.
 * Used across OrbitOverlay and LeftSemanticDiscoveryView for consistent formatting.
 */

/**
 * Format a predicate/relationship type for display
 *
 * Examples:
 *   "birthPlace" → "Birth Place"
 *   "wikiPageWikiLink" → "Wiki Page Wiki Link"
 *   "works_at" → "Works At"
 *   "http://dbpedia.org/ontology/occupation" → "Occupation"
 *   "Occupation" → "Occupation" (already formatted from Wikidata)
 *   "relatedTo" → "Related To"
 *   "URLParser" → "URL Parser" (preserves all-caps words)
 *   null/undefined → "Related To"
 *
 * @param {string|null|undefined} predicate - The raw predicate string
 * @returns {string} Formatted, human-readable label
 */
export function formatPredicate(predicate) {
  if (!predicate) return 'Related To';

  let str = String(predicate).trim();

  // Extract last segment from URI (e.g., "http://.../.../occupation" → "occupation")
  if (str.includes('/')) {
    str = decodeURIComponent(str.split('/').pop() || str);
  }

  // If it looks like it's already been formatted by Wikidata (title case, multiple words),
  // just return it as-is
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(str)) {
    return str;
  }

  // Split camelCase/PascalCase into separate words (e.g., "wikiPageWikiLink" → "wiki Page Wiki Link")
  str = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  str = str.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Replace underscores and hyphens with spaces
  str = str.replace(/[_-]+/g, ' ');

  // Title case: capitalize first letter of each word, but preserve all-caps words (e.g., "URL", "ID")
  str = str
    .split(' ')
    .map(word => {
      if (word.length === 0) return '';
      // If the word is all uppercase, leave it as-is
      if (word === word.toUpperCase() && word.length > 1) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  return str || 'Related To';
}

/**
 * Get a short version of the predicate for compact display
 *
 * Examples:
 *   "Birth Place" → "Birth Place" (keep as-is if short)
 *   "Member Of Sports Team" → "Sports Team" (use last N words if long)
 *   "Date Of Birth" → "Of Birth" (2 words)
 *
 * @param {string|null|undefined} predicate - The raw predicate string
 * @param {number} maxWords - Maximum number of words to return (default: 2)
 * @returns {string} Shortened, formatted label
 */
export function formatPredicateShort(predicate, maxWords = 2) {
  const formatted = formatPredicate(predicate);
  const words = formatted.split(' ');

  if (words.length <= maxWords) return formatted;

  // Take last N words for compact version
  return words.slice(-maxWords).join(' ');
}
