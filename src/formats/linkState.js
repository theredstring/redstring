/**
 * How strongly a node claims an external identifier — the "sameness ladder"
 * (D8/P2.5 in FORMAT_REFACTOR_PLAN.md), in one place.
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
 * The three rungs, in ascending strength. Plain-language names, because these
 * strings surface directly in the panel — the user should never have to read
 * "skos:exactMatch" to say what they mean.
 */
export const LINK_STATES = {
  /** Redstring found it; nobody has checked. → skos:closeMatch */
  MATCHED: 'matched',
  /** A person looked and said yes. → skos:exactMatch */
  CONFIRMED: 'confirmed',
  /** Asserted identity, with the entailment that implies. → owl:sameAs */
  SAME: 'same'
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
 * The fallback is the compatibility contract: a file with no
 * `linkConfirmations` resolves to exactly what the old whole-array branch
 * produced, so re-exporting an untouched universe is byte-identical.
 *
 * @param {string} url
 * @param {object} [semanticMetadata] - the prototype's semanticMetadata blob
 * @returns {string} one of LINK_STATES
 */
export const resolveLinkState = (url, semanticMetadata) => {
  const record = semanticMetadata?.linkConfirmations?.[canonicalizeLink(url)];
  if (record?.state && Object.values(LINK_STATES).includes(record.state)) {
    return record.state;
  }
  return semanticMetadata?.autoEnriched ? LINK_STATES.MATCHED : LINK_STATES.SAME;
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
 * @returns {{same: string[], confirmed: string[], matched: string[]}}
 */
export const partitionLinksByState = (links, semanticMetadata) => {
  const out = { same: [], confirmed: [], matched: [] };
  for (const url of links) {
    const state = resolveLinkState(url, semanticMetadata);
    if (state === LINK_STATES.MATCHED) out.matched.push(url);
    else if (state === LINK_STATES.CONFIRMED) out.confirmed.push(url);
    else out.same.push(url);
  }
  return out;
};
