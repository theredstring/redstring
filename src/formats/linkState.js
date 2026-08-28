/**
 * How strongly a node claims an external identifier — the "sameness ladder"
 * (D8/P2.5 in documentation/data-format/FORMAT_REFACTOR_PLAN.md), in one place.
 *
 * Both the exporter and the panel UI import this. They must not each decide a
 * link's rung independently, or the picture on screen and the triples in the
 * file will disagree about what the user asserted.
 *
 * The rung used to be chosen for the WHOLE array from
 * `semanticMetadata.autoEnriched` (redstringFormat.js). That flag is really
 * about images — it gates thumbnail stripping and is cleared when a user
 * uploads their own picture — so uploading a photo silently promoted every
 * auto-matched link from skos:closeMatch to owl:sameAs. Rungs are per-link and
 * recorded deliberately now.
 */

/**
 * Three rungs, in ascending strength.
 *
 * Two of the three are named after the predicate they export to, because those
 * names go straight onto the panel and the real terms turned out to be clearer
 * than the plain-language ones invented to replace them ("matched
 * automatically", "confirmed", "same thing"). A parallel vocabulary also meant
 * the panel, the file and this module said the same thing three ways.
 *
 * AUTO is the exception, named for how the row got filled rather than for its
 * predicate, because that is what a reader needs from it: not how near the
 * match is, but that nobody has vouched for it. It shares skos:closeMatch with
 * CLOSE — they are the same strength of claim, and who made it is recorded in
 * the record's `by` field, not by picking a weaker predicate. (relatedMatch
 * would be the weaker one, but it asserts "associated, NOT equivalent", which
 * is a positive claim the matcher never made.)
 *
 * CLOSE is a real destination, not a way station: "Signs and symptoms" on
 * Wikipedia genuinely IS a close match for a Thing called Symptoms and never an
 * exact one. Being able to say so is the point of having the rung.
 *
 * There is no rung above EXACT. owl:sameAs used to sit there. The distinction
 * is real in OWL — exactMatch aligns two records about one subject; sameAs
 * fuses them, so a reasoner pools every claim on both sides and the other
 * record's mistakes become claims about your Thing — but it is not one anyone
 * can act on from a panel row, and getting it wrong asserts MORE than the user
 * meant. Redstring no longer authors it. It still READS it on import; other
 * tools write it, and older files carry it.
 */
export const LINK_STATES = {
  /** Redstring found it; nobody has checked. → skos:closeMatch */
  AUTO: 'auto',
  /** A person looked: related, but not the same subject. → skos:closeMatch */
  CLOSE: 'close',
  /** A person looked: the same subject. → skos:exactMatch */
  EXACT: 'exact'
};

/**
 * States written under earlier names, and what they resolve to now. `same` was
 * the retired owl:sameAs rung; it folds down into EXACT rather than resolving
 * to nothing.
 */
const LEGACY_STATES = {
  matched: LINK_STATES.AUTO,
  confirmed: LINK_STATES.EXACT,
  same: LINK_STATES.EXACT
};

/**
 * Normalize a URL so the same resource written two ways compares equal.
 *
 * FROZEN once shipped: `linkConfirmations` is keyed by the output of this
 * function, so changing it orphans every record already saved to disk. If it
 * ever must change, `resolveLinkState` has to fall back to the raw key on miss.
 */
export const canonicalizeLink = (uri) => {
  try {
    const u = new URL(uri);
    u.hash = '';
    // strip common tracking params
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(p => u.searchParams.delete(p));
    const pathname = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
    u.pathname = pathname;
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return String(uri ?? '').trim();
  }
};

/**
 * The rung this link sits on.
 *
 * A link with no record resolves by the old whole-array signal: auto-enriched
 * prototypes matched, everything else confirmed. That fallback used to answer
 * `same`, which is how untouched files came to export owl:sameAs — off a flag
 * that is really about images. Nobody chose that claim, so folding it down to
 * CONFIRMED weakens an assertion the user never made rather than losing one
 * they did.
 *
 * @param {string} url
 * @param {object} [semanticMetadata] - the prototype's semanticMetadata blob
 * @returns {string} one of LINK_STATES
 */
export const resolveLinkState = (url, semanticMetadata) => {
  const record = semanticMetadata?.linkConfirmations?.[canonicalizeLink(url)];
  if (record?.state) {
    if (Object.values(LINK_STATES).includes(record.state)) return record.state;
    if (LEGACY_STATES[record.state]) return LEGACY_STATES[record.state];
  }
  return semanticMetadata?.autoEnriched ? LINK_STATES.AUTO : LINK_STATES.EXACT;
};

/**
 * Record a rung for one link. Returns a NEW semanticMetadata — callers hand the
 * result to onUpdate rather than mutating the store's object.
 *
 * Lives inside semanticMetadata because that blob is persisted verbatim
 * (redstringFormat.js export/import), so adding to it needs no format migration
 * and no KNOWN_PROTOTYPE_KEYS entry.
 *
 * @param {object} [semanticMetadata]
 * @param {string} url
 * @param {string} state - one of LINK_STATES
 * @param {'user'|'auto'} [by] - who decided
 */
export const setLinkState = (semanticMetadata, url, state, by = 'user') => ({
  ...(semanticMetadata || {}),
  linkConfirmations: {
    ...(semanticMetadata?.linkConfirmations || {}),
    [canonicalizeLink(url)]: { state, by, at: new Date().toISOString() }
  }
});

/** Drop a link's record — call when the link itself is removed. */
export const clearLinkState = (semanticMetadata, url) => {
  const existing = semanticMetadata?.linkConfirmations;
  if (!existing) return semanticMetadata || {};
  const { [canonicalizeLink(url)]: _removed, ...rest } = existing;
  return { ...semanticMetadata, linkConfirmations: rest };
};

/**
 * Split links into their export rungs. Used by the exporter; kept here so the
 * partition and the state resolution can never drift apart.
 *
 * @param {string[]} links
 * @param {object} [semanticMetadata]
 * Two rungs out, three states in: AUTO and CLOSE both land on skos:closeMatch.
 * Who made the claim lives in the record's `by` field, which is the honest
 * place for it — a weaker predicate would say something weaker about the
 * subjects, not about the checking.
 *
 * @returns {{close: string[], exact: string[]}}
 */
export const partitionLinksByState = (links, semanticMetadata) => {
  const out = { close: [], exact: [] };
  for (const url of links) {
    if (resolveLinkState(url, semanticMetadata) === LINK_STATES.EXACT) out.exact.push(url);
    else out.close.push(url);
  }
  return out;
};
