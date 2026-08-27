import { useEffect, useRef } from 'react';
import { fastEnrichFromSemanticWeb } from '../services/semanticWebQuery.js';
import { canonicalizeLink, setLinkState, LINK_STATES } from '../formats/linkState.js';

/**
 * Look up what the wider world calls this thing, and record the matches.
 *
 * This replaces two effects that ran side by side on the same panel and both
 * wrote `externalLinks`: one in SemanticEditor keyed on the node's name
 * (canonicalized, kept out of undo history) and one in SharedPanelContent keyed
 * on its id (raw string dedupe, recorded in undo history). They disagreed about
 * gating, dedupe, and undo semantics; whichever fired last won. This takes the
 * better half of each.
 *
 * Every link it adds is stamped `matched` — Redstring found it, nobody has
 * checked. That is what makes the export honest without the user doing
 * anything, and it means a later image upload can no longer promote these to an
 * identity claim (the old exporter read the rung off `autoEnriched`, an
 * image-related flag).
 *
 * Call this from the panel body, NOT from inside the About section:
 * CollapsibleSection renders children only while expanded, so mounting it there
 * would silently gate enrichment on the section being open.
 *
 * @param {object} nodeData
 * @param {(updates: object, contextOptions?: object) => void} onNodeUpdate
 */
export function useAutoEnrichIdentifiers(nodeData, onNodeUpdate) {
  // Keyed per node id: a single shared timestamp meant switching tabs could
  // suppress a lookup for a node that had never been looked up at all.
  const lastRunRef = useRef({});
  const nodeRef = useRef(nodeData);
  nodeRef.current = nodeData;

  const id = nodeData?.id;
  const name = nodeData?.name;

  useEffect(() => {
    const trimmed = (name || '').trim();
    if (!id) return;
    // "New Thing" is the placeholder every fresh node carries; looking it up
    // returns confident nonsense.
    if (!trimmed || trimmed.toLowerCase() === 'new thing' || trimmed.length < 3) return;

    // Already grounded — don't re-query on every rename.
    const sm = nodeData?.semanticMetadata;
    const known = [
      ...(nodeData?.externalLinks || []),
      ...(Array.isArray(sm?.externalLinks) ? sm.externalLinks : []),
      sm?.wikipediaUrl,
      sm?.wikidataUrl
    ].filter(Boolean);
    const alreadyGrounded = known.some(link => {
      const s = String(link);
      return s.includes('wikipedia.org') || s.includes('wikidata.org') || s.includes('dbpedia.org');
    });
    if (alreadyGrounded) return;

    const lastRun = lastRunRef.current[id] || 0;
    if (Date.now() - lastRun < 2000) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      lastRunRef.current[id] = Date.now();
      try {
        const results = await fastEnrichFromSemanticWeb(trimmed, { timeout: 15000 });
        if (cancelled) return;

        const confidence = Number(results?.suggestions?.confidence || 0);
        const sources = results?.sources || {};
        const sourcesFound = ['wikidata', 'dbpedia', 'wikipedia']
          .reduce((n, key) => n + (sources[key]?.found ? 1 : 0), 0);
        const links = Array.isArray(results?.suggestions?.externalLinks)
          ? results.suggestions.externalLinks
          : [];
        if (links.length === 0) return;

        // Two agreeing sources, or one strong one. Below that the match is a
        // guess, and a wrong identifier is worse than none.
        const oneStrongSource = (sources.wikipedia?.found || sources.wikidata?.found) && confidence >= 0.9;
        if (!((sourcesFound >= 2 && confidence >= 0.8) || oneStrongSource)) return;

        // Re-read: the node may have been edited while the request was open.
        const current = nodeRef.current;
        if (!current || current.id !== id) return;

        const existing = Array.isArray(current.externalLinks) ? current.externalLinks : [];
        const seen = new Set(existing.map(canonicalizeLink));
        const added = links.filter(link => !seen.has(canonicalizeLink(link)));
        if (added.length === 0) return;

        let semanticMetadata = current.semanticMetadata;
        for (const link of added) {
          semanticMetadata = setLinkState(semanticMetadata, link, LINK_STATES.MATCHED, 'auto');
        }

        // { ignore: true }: this is a background lookup, not a user edit. Without
        // it, Cmd-Z during a rename undoes a network result instead of the typing.
        onNodeUpdate?.(
          { ...current, externalLinks: [...existing, ...added], semanticMetadata },
          { ignore: true }
        );
      } catch {
        // Best-effort. A failed lookup just means no identifiers yet.
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // nodeData is intentionally not a dependency — it changes on every edit, and
    // the effect reads the live value through nodeRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, name]);
}

export default useAutoEnrichIdentifiers;
