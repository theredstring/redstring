/**
 * What the registries have already told us, this run.
 *
 * The hallucination guard and the clock pull against each other: every DOI is
 * checked before it attaches, and every check is a round trip. The way out is
 * not to check less — it is to never check the same thing twice.
 *
 * `findWork` searches Crossref and gets full records back. If the model then
 * links one of the DOIs it was just shown, re-fetching it proves nothing that
 * the search did not already prove a second earlier. So the search files what
 * it learned here, and the link reads it. A whole framework of studies costs
 * one wave of searches and zero verification calls.
 *
 * Nothing is trusted into this store from outside. Only a registry response
 * puts an entry in, which is what keeps the guard absolute while making it
 * nearly free: a hit means Crossref/DataCite answered for that exact DOI, just
 * not on this call.
 *
 * Deliberately in-memory and short-lived. Registrations do change — a DOI can
 * be withdrawn, its metadata corrected — so this is a within-run memo, not a
 * cache anyone should reach for across sessions.
 */

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 300;

/** url → { at, info: {label, description} } */
const memo = new Map();

const fresh = (entry) => entry && (Date.now() - entry.at) < TTL_MS;

/**
 * File a registry answer for a URL.
 * @param {string} url - the stored form, e.g. `doi:10.1162/003355397555253`
 * @param {{label: string, description?: string}} info - what the registry said
 */
export function rememberVerified(url, info) {
  if (!url || !info?.label) return;

  // Oldest-first eviction. Map iterates in insertion order and entries are
  // never re-inserted on read, so the first key is the oldest.
  if (memo.size >= MAX_ENTRIES) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(url, { at: Date.now(), info: { label: info.label, description: info.description || '' } });
}

/**
 * What a registry said about this URL, if it said it recently enough.
 * @returns {{label: string, description: string}|null}
 */
export function recallVerified(url) {
  const entry = memo.get(url);
  if (!entry) return null;
  if (!fresh(entry)) { memo.delete(url); return null; }
  return entry.info;
}

/** Test seam. */
export function clearVerified() {
  memo.clear();
}
