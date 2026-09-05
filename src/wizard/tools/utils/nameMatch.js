/**
 * Deciding whether a name the model wrote means a Thing that exists.
 *
 * ONE definition, imported by both halves of every by-name mutation: the tool
 * that resolves against predictive state, and the applier that resolves against
 * the real store. When those two disagreed, the tool matched "Miller 1956" to
 * "Miller (1956) Working Memory" and reported a success while the applier found
 * no exact match and dropped the write — a study silently ungrounded in a run
 * that announced itself as complete. A shared rule makes that class of
 * disagreement impossible rather than unlikely.
 *
 * Tiers, strongest first, so a caller can prefer a better match over a nearer
 * one in iteration order:
 *
 *   3  the same name
 *   2  one name contains the other ("Fitts" in "Fitts 1954")
 *   1  every word of the shorter name appears in the longer one
 *   0  unrelated
 *
 * Tier 1 is what containment cannot do. "Bliss & Lomo 1973" and "Bliss & Lomo
 * (1973) Long-Term Potentiation" are the same paper, and neither string
 * contains the other — the parentheses alone break it. Comparing words after
 * dropping punctuation is what a person does reading the two side by side.
 */

const words = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

/**
 * How strongly `candidate` answers to `query`.
 *
 * @param {string} candidate - a Thing's actual name
 * @param {string} query - the name the model used
 * @returns {number} 3, 2, 1 or 0
 */
export function nameMatchScore(candidate, query) {
  const name = String(candidate ?? '').toLowerCase().trim();
  const wanted = String(query ?? '').toLowerCase().trim();
  if (!name || !wanted) return 0;

  if (name === wanted) return 3;
  if (name.includes(wanted) || wanted.includes(name)) return 2;

  const nameWords = words(name);
  const wantedWords = words(wanted);
  if (nameWords.length === 0 || wantedWords.length === 0) return 0;

  // Whichever is shorter has to be fully accounted for in the other. A single
  // shared word is a coincidence — "1973" and "Theory" would match half a
  // universe — so two is the floor for calling it the same Thing.
  const [shorter, longer] = wantedWords.length <= nameWords.length
    ? [wantedWords, nameWords]
    : [nameWords, wantedWords];
  if (shorter.length < 2) return 0;

  const have = new Set(longer);
  return shorter.every(word => have.has(word)) ? 1 : 0;
}

/**
 * The best match for `query` among `entries`.
 *
 * Ties go to the LAST one seen: prototypes accumulate in insertion order and
 * the oldest same-named Thing is the stale one (see MEMORY.md).
 *
 * @param {string} query
 * @param {Iterable<T>} entries
 * @param {(entry: T) => string} getName
 * @returns {T|null}
 */
export function bestNameMatch(query, entries, getName) {
  let best = null;
  let bestScore = 0;

  for (const entry of entries) {
    const score = nameMatchScore(getName(entry), query);
    if (score >= bestScore && score > 0) {
      best = entry;
      bestScore = score;
    }
  }

  return best;
}
