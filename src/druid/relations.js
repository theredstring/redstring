/**
 * Relations from sentences. A small model asked for "the relation" between two
 * Things writes a fragment ("support", "Relation: Attach", the other Thing's
 * name again), and a fragment is hard to check. Asked for a short sentence
 * that begins with one Thing and ends with the other ("Bones support the
 * feet"), it writes a sentence; the relation is what lies between the names,
 * and the sentence itself is what gets checked.
 */

import { normalizeName } from './names.js';

const strip = (s) => String(s || '').replace(/[.!?"'“”]+$/g, '').replace(/^["'“”]+/, '').trim();
const ARTICLE = /^(the|a|an|its|their|some)\s+/i;

/** Where a name starts in a sentence (case and a final plural ignored), as [start, end] word indexes. */
function findName(words, name) {
  const want = normalizeName(name).split(' ');
  for (let i = 0; i + want.length <= words.length; i++) {
    const got = normalizeName(words.slice(i, i + want.length).join(' ')).split(' ');
    if (got.join(' ') === want.join(' ')) return [i, i + want.length];
  }
  return null;
}

/**
 * The relation in "A … B": the words between the two names, without an
 * article before B. Null when the sentence does not hold both names in order,
 * or holds nothing between them.
 */
export function relationFromSentence(sentence, a, b) {
  const words = strip(sentence).replace(ARTICLE, '').split(/\s+/).filter(Boolean);
  const at = findName(words, a);
  if (!at) return null;
  const rest = words.slice(at[1]);
  const bt = findName(rest, b);
  if (!bt) return null;
  let middle = rest.slice(0, bt[0]).join(' ').trim();
  middle = middle.replace(/\s+(the|a|an|its|their|some)$/i, '').trim();
  // Not a relation but two clauses: "is underfoot, so", "is a mammal,".
  if (!middle || middle.split(' ').length > 5 || /[,;:]|\b(so|and|but|because|while|which)\b/i.test(middle)) return null;
  return middle.toLowerCase();
}
