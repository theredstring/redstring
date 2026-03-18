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
 *   "works_at" → "Works At"
 *   "http://dbpedia.org/ontology/occupation" → "Occupation"
 *   "Occupation" → "Occupation" (already formatted from Wikidata)
 *   "relatedTo" → "Related To"
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

  // Replace underscores and hyphens with spaces
  str = str.replace(/[_-]+/g, ' ');

  // Title case: capitalize first letter of each word
  str = str
    .split(' ')
    .map(word => {
      if (word.length === 0) return '';
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
