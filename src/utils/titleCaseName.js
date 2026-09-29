// Short function words that stay lower case inside a name.
const MINOR = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'of', 'in', 'on', 'at', 'to', 'by', 'up', 'as', 'via', 'vs', 'vs.', 'per', 'from', 'with', 'into', 'onto', 'over'
]);

// Lift the first letter of a lower-case word part.
const lift = (part) => {
  const i = part.search(/\p{L}/u);
  return i === -1 ? part : part.slice(0, i) + part[i].toUpperCase() + part.slice(i + 1);
};

/**
 * A Thing's name in title case, the way Redstring names Things.
 *
 * The semantic web mostly hands back sentence case or lower case — Wikidata
 * labels common nouns as "biological process", Wikipedia titles read
 * "Artificial photosynthesis" — which sits oddly beside the Things a person
 * names on the canvas. This lifts the first letter of each word and leaves the
 * rest alone:
 *  - a word already carrying a capital anywhere keeps its own shape ("DNA",
 *    "iPhone", "McDonald's", "Île-de-France");
 *  - short function words stay lower case inside a name ("Plato's Five
 *    Regimes of Government", "War and Peace"), never first or last;
 *  - each part of a hyphenated word is lifted ("Light-Dependent Reactions").
 *
 * "Largely" title case: it never lowers a capital that was there.
 *
 * @param {string} name
 * @returns {string}
 */
export default function titleCaseName(name) {
  if (typeof name !== 'string' || !name.trim()) return name;
  const words = name.split(/(\s+)/);
  const indices = words.map((w, i) => (/\S/.test(w) ? i : -1)).filter((i) => i >= 0);
  const first = indices[0];
  const last = indices[indices.length - 1];
  return words.map((word, i) => {
    if (!/\S/.test(word)) return word;
    // A word with a capital anywhere already has its shape: "DNA", "iPhone",
    // "Île-de-France", "McDonald's", "Paris".
    if (/\p{Lu}/u.test(word)) return word;
    const bare = word.replace(/[^\p{L}.]/gu, '');
    if (i !== first && i !== last && MINOR.has(bare)) return word;
    return word.split('-').map(lift).join('-');
  }).join('');
}
