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
 * Two rungs, in ascending strength. Plain-language names, because these strings
 * surface directly in the panel — the user should never have to read
 * "skos:exactMatch" to say what they mean.
 *
 * There used to be a third, `same` → owl:sameAs, above CONFIRMED. It is gone.
 * The distinction it drew is real in OWL (exactMatch aligns two records about
 * one subject; sameAs fuses them, so a reasoner pools every claim on both sides
 * and the other record's mistakes become claims about your Thing) but it is not
 * a distinction anyone can act on from a panel row. Redstring's own author
 * couldn't tell the two options apart, which is the end of the argument: a
 * control nobody can use correctly is worse than no control, and the failure
 * lands on the side of asserting MORE than the user meant.
 *
 * So Redstring no longer authors owl:sameAs. It still READS it on import —
 * other tools write it, and older files carry it — but nothing here emits it.
 */
export const LINK_STATES = {
  /** Redstring found it; nobody has checked. → skos:closeMatch */
  MATCHED: 'matched',
  /** A person looked and said yes. → skos:exactMatch */
  CONFIRMED: 'confirmed'
};

/** Recognised in stored records, folded into CONFIRMED. See LINK_STATES. */
const RETIRED_SAME = 'same';

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
    if (record.state === RETIRED_SAME) return LINK_STATES.CONFIRMED;
  }
  return semanticMetadata?.autoEnriched ? LINK_STATES.MATCHED : LINK_STATES.CONFIRMED;
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
 * @returns {{confirmed: string[], matched: string[]}}
 */
export const partitionLinksByState = (links, semanticMetadata) => {
  const out = { confirmed: [], matched: [] };
  for (const url of links) {
    if (resolveLinkState(url, semanticMetadata) === LINK_STATES.MATCHED) out.matched.push(url);
    else out.confirmed.push(url);
  }
  return out;
};
