/**
 * findWork - Look up the real DOIs for papers, by describing them.
 *
 * The companion to `linkIdentifier`, and the reason that tool can afford to
 * reject everything it cannot verify. A DOI is not recallable — asked for
 * Laibson 1997 a model will assemble `10.1093/qje/112.2.443` from the journal,
 * volume and page, which looks exactly like a DOI and is a 404. Searching
 * returns the real one.
 *
 * READ-ONLY: it proposes candidates and links nothing. It also never picks a
 * winner, because picking is the part that needs judgement — that same search
 * returns the 1997 QJE article third, behind two book-chapter reprints carrying
 * the identical title. Every candidate therefore states its journal and year,
 * which is what tells those three apart, and the caller decides.
 *
 * Batched on purpose. One call covers a whole framework of studies: the
 * searches run together, so thirteen papers cost about one search's wait rather
 * than thirteen round trips through the model.
 */

import { searchWorks } from '../../services/identifierSearch.js';
import { rememberVerified } from './utils/verifiedWorks.js';
import { withSafeConsole } from './withSafeConsole.js';

// Enough to be quick on a whole reading list, gentle enough to stay out of
// Crossref's rate limiter. The wall clock is one wave, not one call each.
const CONCURRENCY = 5;

// A registry that has not answered in this long is not going to save the run.
// Failing here costs a candidate list; hanging costs the whole ask.
const SEARCH_TIMEOUT_MS = 8000;

const MAX_QUERIES = 25;

/**
 * How much of what was asked for actually appears in a candidate's title.
 *
 * A search index ranks; it does not decline. Ask DataCite for "Kahneman
 * Tversky 1979 prospect theory" and it will hand back its best guess even when
 * that is an unrelated upload — presented with the same confidence as a real
 * hit, which is the shape of wrongness this whole path exists to prevent.
 *
 * Word overlap, not edit distance: the query is a citation ("Fitts 1954
 * information capacity of the human motor system") and the title is a sentence
 * ("The information capacity of the human motor system in controlling the
 * amplitude of movement"), so character-level distance scores a perfect match
 * as a poor one. Author surnames and the year usually appear in neither, which
 * is why the bar sits well below half.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or',
  'the', 'to', 'with', 'under', 'its', 'their', 'this', 'that'
]);

const contentWords = (text) => String(text ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(word => word.length > 1 && !STOPWORDS.has(word) && !/^(1[6-9]|20)\d{2}$/.test(word));

const TITLE_OVERLAP_FLOOR = 0.4;

const titleOverlap = (query, title) => {
  const wanted = contentWords(query);
  if (wanted.length === 0) return 1;
  const have = new Set(contentWords(title));
  return wanted.filter(word => have.has(word)).length / wanted.length;
};

/** Run `fn` over `items` a few at a time, preserving order. */
async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Accept a bare string or a {query, nodeName} pair. */
const readQuery = (entry) => {
  if (typeof entry === 'string') return { query: entry.trim(), nodeName: null };
  return {
    query: String(entry?.query ?? entry?.title ?? '').trim(),
    // Echoed straight back so the follow-up link call already has the pairing
    // and the model does not have to hold it in its head.
    nodeName: entry?.nodeName || null
  };
};

/**
 * @param {Object} args - { queries: (string|{query, nodeName})[], rows? }
 * @returns {Promise<Object>} candidates per query — no mutation
 */
export async function findWork(args) {
  const { queries, rows = 4 } = args;

  const list = (Array.isArray(queries) ? queries : [queries])
    .map(readQuery)
    .filter(entry => entry.query);

  if (list.length === 0) {
    throw new Error('queries is required: a title, ideally with the author and year ("Golden Eggs and Hyperbolic Discounting Laibson 1997").');
  }
  if (list.length > MAX_QUERIES) {
    throw new Error(`Too many queries (${list.length}). Look up at most ${MAX_QUERIES} works per call.`);
  }

  const results = await withSafeConsole(() => mapWithConcurrency(list, CONCURRENCY, async ({ query, nodeName }) => {
    try {
      const returned = await searchWorks(query, {
        rows: Math.min(Math.max(Number(rows) || 4, 1), 8),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      });

      // Drop what the index offered but the query never asked for. Showing a
      // near-miss to a model told to pick the best candidate is how the wrong
      // paper gets attached; an empty list is a fine answer.
      const candidates = returned.filter(row => titleOverlap(query, row.label) >= TITLE_OVERLAP_FLOOR);

      // Every remaining candidate came from a registry answering about that
      // exact DOI, so linking one of them needs no second lookup.
      for (const candidate of candidates) rememberVerified(candidate.url, candidate);

      const discarded = returned.length - candidates.length;
      if (discarded > 0) console.error(`[findWork] dropped ${discarded} off-topic hit(s) for:`, query);

      return { query, nodeName, candidates };
    } catch (error) {
      // Reported per query rather than thrown: one throttled or timed-out
      // lookup must not take the other twelve down with it, and "could not
      // search" has to stay distinguishable from "found nothing".
      console.error('[findWork] search failed:', query, error?.message || error);
      return { query, nodeName, candidates: [], error: error?.message || 'search failed' };
    }
  }));

  const found = results.filter(r => r.candidates.length > 0).length;
  console.error(`[findWork] ${found}/${results.length} queries returned candidates`);

  return {
    results,
    queriesSearched: results.length,
    queriesWithCandidates: found,
    // Said in the result rather than only in the schema, because this is the
    // moment the mistake would be made.
    note: 'Candidates only — nothing is linked yet. Match on journal AND year, not title alone: reprints and book chapters share the title of the article they reproduce. Pass the ones you are sure of to linkIdentifier.'
  };
}
