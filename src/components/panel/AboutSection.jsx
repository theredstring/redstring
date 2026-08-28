import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, X, ChevronDown, Plus, Link2, History, Check, Binoculars } from 'lucide-react';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import PanelCard, { usePanelCardTokens } from '../shared/PanelCard.jsx';
import InfoPopover from '../shared/InfoPopover.jsx';
import AnchoredPopoverBox from '../shared/AnchoredPopoverBox.jsx';
import {
  identifierFromUrl,
  partitionIdentifiers,
  extractDOI,
  isValidURL,
  STANDARD_KINDS
} from '../../utils/externalIdentifiers.js';
import { resolveOrigin } from '../../utils/nodeOrigin.js';
import { searchIdentifiers, describeIdentifier } from '../../services/identifierSearch.js';
import {
  LINK_STATES,
  canonicalizeLink,
  resolveLinkState,
  setLinkState,
  clearLinkState
} from '../../formats/linkState.js';
import {
  IDENTIFIERS_INTRO,
  PICKER_INTRO,
  EMPTY_SLOT_TEXT,
  MATCH_STATES,
  PROVENANCE_INTRO,
  ID_INTRO,
  confidenceWord
} from './aboutCopy.js';

const FONT = "'EmOne', sans-serif";

/**
 * What other systems call this subject, and where those names came from.
 *
 * Replaces the old Origin section and the "External References (owl:sameAs)"
 * card that used to live under Semantic Web. Both rendered the same
 * `externalLinks` array, so unlinking in one silently changed the other; and
 * Origin's two branches were mutually exclusive, so a semantic node never saw
 * its links and an ordinary node never saw its provenance. One section, both
 * halves, always.
 *
 * Nothing here is stored beyond the URLs themselves and a per-link record of
 * how strongly the user means each one. Authority and identifier are derived at
 * render time by `identifierFromUrl`; the description under each row is fetched
 * live and never written down.
 */

/**
 * What the authority says the thing at this URL actually is.
 *
 * This is the whole answer to "Wikidata's Symptoms is an artwork": the row says
 * so, in Wikidata's own words, without anyone having to follow the link. Fetched
 * per row rather than stored, because it is the authority's current statement
 * and a cached copy would be the thing we are trying to catch being stale.
 */
const useIdentifierDescription = (url) => {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!url) { setInfo(null); return; }
    const controller = new AbortController();
    let cancelled = false;
    setInfo(null);
    describeIdentifier(url, { signal: controller.signal }).then(result => {
      if (!cancelled) setInfo(result);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [url]);

  return info;
};

/**
 * One choice inside a popover, as a button that looks like one.
 *
 * Outlined in the same maroon as its text, because the popover's fill is the
 * PieMenu's flat #DEDADA and an unoutlined row on it reads as a paragraph, not
 * a choice. The current one is filled rather than outlined differently, so a
 * set still scans as a set of equal options.
 */
const PopoverOption = ({ label, blurb, isCurrent, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const raised = isHovered || isCurrent;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onBlur={() => setIsHovered(false)}
      aria-pressed={isCurrent}
      type="button"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: raised ? 'rgba(128,0,0,0.12)' : 'transparent',
        border: '1.5px solid maroon',
        borderRadius: 8,
        padding: '6px 9px',
        marginBottom: 6,
        cursor: 'pointer',
        color: 'maroon',
        fontFamily: FONT,
        fontSize: '0.8rem',
        transition: 'background-color 0.15s ease'
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 'bold' }}>
        {isCurrent && <Check size={14} strokeWidth={2.5} style={{ flexShrink: 0 }} />}
        {label}
      </span>
      {blurb && <span style={{ display: 'block', opacity: 0.8, marginTop: 1 }}>{blurb}</span>}
    </button>
  );
};

/** The three rungs of the sameness ladder, as a small anchored menu. */
const StateChooser = ({ anchor, current, onPick, onDismiss }) => (
  <AnchoredPopoverBox
    position={anchor}
    direction="down-left"
    width={240}
    estimatedHeight={190}
    onDismiss={onDismiss}
    ariaLabel="Confidence"
  >
    {/* Title only. Three labelled options are self-explaining, and a paragraph
        above them just pushes the choice further from the cursor. */}
    <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Confidence</div>
    {MATCH_STATES.map(option => (
      <PopoverOption
        key={option.state}
        label={option.label}
        blurb={option.blurb}
        isCurrent={option.state === current}
        onClick={() => onPick(option.state)}
      />
    ))}
  </AnchoredPopoverBox>
);

/**
 * Search one authority and take an entry from it.
 *
 * Fills an empty slot and replaces a wrong match with the same gesture, because
 * they are the same act: deciding which entry over there is this thing. Opens
 * pre-searched on the Thing's own name, which is right often enough that the
 * common case is one click.
 */
const IdentifierPicker = ({ anchor, kind, authority, initialTerm, currentUrl, onPick, onDismiss }) => {
  const [term, setTerm] = useState(initialTerm || '');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    const query = term.trim();
    if (!query) { setResults([]); setStatus('idle'); return; }

    const controller = new AbortController();
    let cancelled = false;
    setStatus('loading');

    const timer = setTimeout(() => {
      searchIdentifiers(kind, query, { signal: controller.signal })
        .then(rows => {
          if (cancelled) return;
          setResults(rows);
          setStatus('done');
        })
        .catch(error => {
          if (cancelled || error?.name === 'AbortError') return;
          setResults([]);
          setStatus('error');
        });
    }, 350);

    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [term, kind]);

  const currentCanonical = currentUrl ? canonicalizeLink(currentUrl) : null;

  return (
    <AnchoredPopoverBox
      position={anchor}
      direction="down-left"
      width={330}
      estimatedHeight={340}
      onDismiss={onDismiss}
      ariaLabel={`Find this on ${authority}`}
      scrollable={false}
    >
      {/* Header and field are pinned; only the results scroll. How many results
          come back isn't knowable in advance, and a box that scrolls as a whole
          takes the search field away with it the moment you look past the
          third one. */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Find on {authority}</div>
        <div style={{ marginBottom: 8, opacity: 0.85 }}>{PICKER_INTRO}</div>

        <input
          type="text"
          value={term}
          autoFocus
          onChange={(e) => setTerm(e.target.value)}
          placeholder={`Search ${authority}`}
          style={{
            width: '100%',
            padding: '5px 8px',
            marginBottom: 8,
            border: '1.5px solid maroon',
            borderRadius: 8,
            background: 'transparent',
            color: 'maroon',
            fontFamily: FONT,
            fontSize: '0.8rem',
            boxSizing: 'border-box',
            outline: 'none'
          }}
        />
      </div>

      <div className="anchored-popover-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {status === 'loading' && <div style={{ opacity: 0.8 }}>Searching {authority}…</div>}
        {status === 'error' && <div style={{ opacity: 0.8 }}>Could not reach {authority}.</div>}
        {status === 'done' && results.length === 0 && (
          <div style={{ opacity: 0.8 }}>Nothing on {authority} matches “{term.trim()}”.</div>
        )}

        {results.map(result => (
          <PopoverOption
            key={result.url}
            label={`${result.label} · ${result.identifier}`}
            blurb={result.description}
            isCurrent={currentCanonical === canonicalizeLink(result.url)}
            onClick={() => onPick(result.url)}
          />
        ))}
      </div>
    </AnchoredPopoverBox>
  );
};

/**
 * How strongly this match is claimed, as the control that changes it.
 *
 * The state used to be static text with a separate chevron button beside the
 * other actions. Making the text itself the trigger says what the control does
 * without a legend, and gives the row's action group back the slot the search
 * button needed.
 */
const StateChip = ({ label, isOpen, onOpen, tokens }) => {
  const [isHovered, setIsHovered] = useState(false);
  const lit = isHovered || isOpen;

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onBlur={() => setIsHovered(false)}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      title="Confidence"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        marginTop: 5,
        padding: '2px 9px',
        borderRadius: 20,
        border: `1px solid ${lit ? tokens.brand : tokens.hairline}`,
        background: 'transparent',
        color: lit ? tokens.brand : tokens.muted,
        fontFamily: FONT,
        fontSize: '11px',
        cursor: 'pointer',
        transition: 'color 0.15s ease, border-color 0.15s ease'
      }}
    >
      {label}
      <ChevronDown size={11} strokeWidth={2.5} />
    </button>
  );
};

/**
 * One identifier, filled or not.
 *
 * A standing slot and a filled row are the same component on purpose: an empty
 * Wikidata row has to sit in the same place, at the same weight, as a full one,
 * or "nothing has grounded this yet" reads as an absence rather than a fact.
 */
const IdentifierRow = ({
  kind,
  authority,
  url,
  state,
  nodeName,
  isLast,
  tokens,
  onSetState,
  onRemove,
  onPick
}) => {
  const info = useIdentifierDescription(url);
  const [chooserAnchor, setChooserAnchor] = useState(null);
  const [pickerAnchor, setPickerAnchor] = useState(null);

  const { authority: derivedAuthority, identifier, href } = url
    ? identifierFromUrl(url)
    : { authority, identifier: null, href: null };

  const stateLabel = MATCH_STATES.find(s => s.state === state)?.label || '';

  const anchorFrom = (event) => {
    const rect = event.currentTarget?.getBoundingClientRect?.();
    return rect ? { x: rect.right, y: rect.bottom } : null;
  };

  return (
    <div
      style={{
        padding: '9px 0',
        borderBottom: isLast ? 'none' : `1px solid ${tokens.hairline}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontFamily: FONT,
            fontSize: '10px',
            fontWeight: 'bold',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: tokens.brand,
            marginBottom: 2
          }}>
            {derivedAuthority}
          </div>

          <div style={{
            fontFamily: FONT,
            fontSize: '13px',
            color: url ? tokens.text : tokens.muted,
            fontStyle: url ? 'normal' : 'italic',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {url ? identifier : EMPTY_SLOT_TEXT}
            {info?.label && info.label !== identifier && (
              <span style={{ color: tokens.muted }}> · {info.label}</span>
            )}
          </div>

          {/* The authority's own words about what it is holding. Two lines is
              enough to catch a wrong match and short enough not to turn a list
              of four identifiers into a page of prose. */}
          {info?.description && (
            <div style={{
              fontFamily: FONT,
              fontSize: '11px',
              color: tokens.muted,
              marginTop: 2,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden'
            }}>
              {info.description}
            </div>
          )}

          {url && (
            <StateChip
              label={stateLabel}
              tokens={tokens}
              isOpen={!!chooserAnchor}
              onOpen={(e) => setChooserAnchor(anchorFrom(e))}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {/* Only the three standing authorities can be searched. A DOI or a
              bare URL has no directory to look it up in, so that row keeps the
              two buttons that do mean something. */}
          {STANDARD_KINDS.includes(kind) && (
            <PanelIconButton
              icon={Binoculars}
              size={14}
              active={!!pickerAnchor}
              onClick={(e) => setPickerAnchor(anchorFrom(e))}
              title={url ? `Find a different ${authority} match` : `Find this on ${authority}`}
              ariaExpanded={!!pickerAnchor}
              ariaHasPopup="dialog"
            />
          )}
          {url && (
            <PanelIconButton
              icon={ExternalLink}
              size={14}
              onClick={() => window.open(href, '_blank')}
              title={`Open in ${derivedAuthority}`}
            />
          )}
          {/* Plain ghost variant, like every other remove button in the panel.
              `danger` swaps the hover ring to #F44336, a colour this panel uses
              nowhere else. */}
          {url && (
            <PanelIconButton
              icon={X}
              size={14}
              onClick={() => onRemove(url)}
              title="Remove this identifier"
            />
          )}
        </div>
      </div>

      {chooserAnchor && (
        <StateChooser
          anchor={chooserAnchor}
          current={state}
          onPick={(next) => { onSetState(url, next); setChooserAnchor(null); }}
          onDismiss={() => setChooserAnchor(null)}
        />
      )}

      {pickerAnchor && (
        <IdentifierPicker
          anchor={pickerAnchor}
          kind={kind}
          authority={authority}
          initialTerm={nodeName}
          currentUrl={url}
          onPick={(next) => { onPick(kind, url, next); setPickerAnchor(null); }}
          onDismiss={() => setPickerAnchor(null)}
        />
      )}
    </div>
  );
};

/**
 * One field, no type dropdown. What was pasted decides what it is, and a live
 * preview shows the reading back before anything is committed.
 */
const AddIdentifier = ({ onAdd, tokens }) => {
  const [value, setValue] = useState('');

  const parsed = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const doi = extractDOI(trimmed);
    if (doi) return { url: doi.startsWith('10.') ? `doi:${doi}` : doi };
    if (isValidURL(trimmed)) return { url: trimmed };
    return null;
  }, [value]);

  const preview = parsed ? identifierFromUrl(parsed.url) : null;

  const commit = () => {
    if (!parsed) return;
    onAdd(parsed.url);
    setValue('');
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && parsed) commit(); }}
          placeholder="Paste a link, or a DOI"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '6px 8px',
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
            fontSize: '13px',
            fontFamily: FONT,
            color: tokens.text,
            background: 'transparent',
            boxSizing: 'border-box'
          }}
        />
        <PanelIconButton
          icon={Plus}
          size={14}
          onClick={commit}
          disabled={!parsed}
          title="Add this identifier"
        />
      </div>
      {value.trim() && (
        <div style={{
          fontFamily: FONT,
          fontSize: '11px',
          color: preview ? tokens.muted : tokens.danger,
          marginTop: 4
        }}>
          {preview ? `${preview.authority} · ${preview.identifier}` : 'Not a link or a DOI'}
        </div>
      )}
    </div>
  );
};

/** Where the thing came from: the evidence for the identifiers above. */
const ProvenanceRows = ({ nodeData, isHomeTab, graphData, tokens }) => {
  const sm = nodeData?.semanticMetadata;
  const origin = sm?.originMetadata;
  const from = resolveOrigin(nodeData);

  const row = (label, value, title) => value ? (
    <div style={{ display: 'flex', gap: 10, marginBottom: 4 }} title={title}>
      <div style={{
        flexShrink: 0,
        width: 74,
        fontFamily: FONT,
        fontSize: '11px',
        color: tokens.brand,
        fontWeight: 'bold'
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: FONT,
        fontSize: '12px',
        color: tokens.muted,
        minWidth: 0,
        overflowWrap: 'anywhere'
      }}>
        {value}
      </div>
    </div>
  ) : null;

  const foundBy = (() => {
    if (!origin) return null;
    const parts = [];
    if (origin.searchQuery) parts.push(`searching "${origin.searchQuery}"`);
    const word = confidenceWord(origin.confidence);
    if (word) parts.push(word);
    return parts.length ? parts.join(' · ') : null;
  })();

  return (
    <PanelCard
      title="Where This Came From"
      icon={History}
      rightEl={
        <InfoPopover title="Where this came from" label="About provenance" size={13}>
          {PROVENANCE_INTRO}
        </InfoPopover>
      }
    >
      {/* Always answered. A Thing made here says so rather than showing a
          heading with nothing under it. */}
      {row('From', (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {from.label}
          {from.href && (
            <a href={from.href} target="_blank" rel="noopener noreferrer" style={{ color: tokens.brand }}>
              ↗
            </a>
          )}
        </span>
      ))}
      {row('Created', nodeData?.createdAt ? new Date(nodeData.createdAt).toLocaleDateString() : null)}
      {row('Found by', foundBy, origin?.confidence != null ? `${Math.round(origin.confidence * 100)}% confidence` : undefined)}
      {/* Written by the semantic-concept materialization paths, but never
          exported. Display it, don't build on it. */}
      {row('As found', nodeData?.originalDescription)}
      {sm?.autoEnriched && row(
        'Enriched',
        `from Wikipedia${sm.autoEnrichConfidence != null ? ` · ${confidenceWord(sm.autoEnrichConfidence)}` : ''}`,
        sm.autoEnrichConfidence != null ? `${Math.round(sm.autoEnrichConfidence * 100)}% match` : undefined
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10 }}>
        {row('ID', nodeData?.id)}
        <InfoPopover title="Internal ID" label="About this ID" size={13}>{ID_INTRO}</InfoPopover>
      </div>
      {isHomeTab && graphData?.id && row('Graph ID', graphData.id)}
    </PanelCard>
  );
};

const AboutSection = ({ nodeData, onNodeUpdate, isHomeTab = false, graphData = null }) => {
  const tokens = usePanelCardTokens();

  const { slots, extras } = useMemo(() => partitionIdentifiers(nodeData), [nodeData]);

  const stateOf = useCallback(
    (url) => (url ? resolveLinkState(url, nodeData?.semanticMetadata) : null),
    [nodeData]
  );

  const handleSetState = useCallback((url, state) => {
    onNodeUpdate?.({
      ...nodeData,
      semanticMetadata: setLinkState(nodeData?.semanticMetadata, url, state, 'user')
    });
  }, [nodeData, onNodeUpdate]);

  const handleAdd = useCallback((url) => {
    const canonical = canonicalizeLink(url);
    const existing = Array.isArray(nodeData?.externalLinks) ? nodeData.externalLinks : [];
    if (existing.some(link => canonicalizeLink(link) === canonical)) return;
    onNodeUpdate?.({
      ...nodeData,
      externalLinks: [...existing, url],
      // Typing a link is a deliberate assertion, but not yet the strong identity
      // claim. The user escalates to that explicitly.
      semanticMetadata: setLinkState(nodeData?.semanticMetadata, url, LINK_STATES.CONFIRMED, 'user')
    });
  }, [nodeData, onNodeUpdate]);

  /**
   * Strip a URL out of every place a link can live.
   *
   * Shared by removal and replacement, and it has to reach all of them or a
   * link taken out of one store reappears from another on the next render.
   * `originMetadata.originalUri` included: it is read back by
   * `collectIdentifiers`, so leaving it behind resurrects the row.
   *
   * Keeps the old `unlinkSource(domain)` Wikipedia side effects verbatim. The
   * image section's delete path is coupled to those fields being cleared
   * together, and a swapped article's cached thumbnail belongs to the article
   * that is no longer linked.
   */
  const detachUrl = useCallback((semanticMetadata, url) => {
    const canonical = canonicalizeLink(url);
    const matches = (candidate) => typeof candidate === 'string' && canonicalizeLink(candidate) === canonical;

    const sm = { ...(semanticMetadata || {}) };

    if (Array.isArray(sm.externalLinks)) {
      sm.externalLinks = sm.externalLinks.filter(link => !matches(link));
    }
    if (matches(sm.wikidataUrl)) sm.wikidataUrl = undefined;
    if (matches(sm.wikipediaUrl)) {
      sm.wikipediaUrl = undefined;
      sm.wikipediaTitle = undefined;
      sm.wikipediaEnriched = undefined;
      sm.wikipediaEnrichedAt = undefined;
      sm.wikipediaThumbnail = undefined;
      sm.wikipediaOriginalImage = undefined;
      sm.wikipediaAdditionalImages = undefined;
    }
    if (matches(sm.originMetadata?.originalUri)) {
      sm.originMetadata = { ...sm.originMetadata, originalUri: undefined };
    }

    return clearLinkState(sm, url);
  }, []);

  const handleRemove = useCallback((url) => {
    const canonical = canonicalizeLink(url);
    onNodeUpdate?.({
      ...nodeData,
      externalLinks: (nodeData?.externalLinks || []).filter(
        link => canonicalizeLink(link) !== canonical
      ),
      semanticMetadata: detachUrl(nodeData?.semanticMetadata, url)
    });
  }, [nodeData, onNodeUpdate, detachUrl]);

  /**
   * Take an entry from an authority, replacing whatever was in that slot.
   *
   * The new link lands in the old one's position rather than at the end, so
   * correcting a match doesn't reorder the list, and it lands as `confirmed`:
   * choosing it out of a list of descriptions is exactly the act of checking.
   */
  const handlePick = useCallback((kind, previousUrl, nextUrl) => {
    if (!nextUrl) return;

    let sm = previousUrl ? detachUrl(nodeData?.semanticMetadata, previousUrl) : { ...(nodeData?.semanticMetadata || {}) };

    const existing = Array.isArray(nodeData?.externalLinks) ? nodeData.externalLinks : [];
    const previousCanonical = previousUrl ? canonicalizeLink(previousUrl) : null;
    const nextCanonical = canonicalizeLink(nextUrl);

    let links = existing.filter(link => canonicalizeLink(link) !== nextCanonical);
    const slotIndex = previousCanonical
      ? links.findIndex(link => canonicalizeLink(link) === previousCanonical)
      : -1;
    if (slotIndex >= 0) links.splice(slotIndex, 1, nextUrl);
    else links = [...links, nextUrl];

    // The dedicated fields are what pairs a lookup's halves together and what
    // the enrichment paths read, so they have to follow the swap.
    if (kind === 'wikidata') sm.wikidataUrl = nextUrl;
    if (kind === 'wikipedia') {
      sm.wikipediaUrl = nextUrl;
      sm.wikipediaTitle = decodeURIComponent(nextUrl.split('/').filter(Boolean).pop() || '').replace(/_/g, ' ');
    }

    onNodeUpdate?.({
      ...nodeData,
      externalLinks: links,
      semanticMetadata: setLinkState(sm, nextUrl, LINK_STATES.CONFIRMED, 'user')
    });
  }, [nodeData, onNodeUpdate, detachUrl]);

  // The three standing slots first, then anything else the Thing carries.
  const rows = useMemo(() => [
    ...slots,
    ...extras.map(url => {
      const { kind, authority } = identifierFromUrl(url);
      return { kind, authority, url };
    })
  ], [slots, extras]);

  return (
    // Two cards, the same container language Semantic Web is built from, so the
    // panel reads as one system rather than as two sections that happen to sit
    // near each other.
    <div style={{ marginRight: 15, fontFamily: FONT }}>
      <PanelCard
        title="Known Elsewhere As"
        icon={Link2}
        rightEl={
          <InfoPopover title="Known elsewhere as" label="About identifiers" size={13}>
            {IDENTIFIERS_INTRO}
          </InfoPopover>
        }
      >
        {rows.map((row, index) => (
          <IdentifierRow
            key={row.url || `slot-${row.kind}`}
            kind={row.kind}
            authority={row.authority}
            url={row.url}
            state={stateOf(row.url)}
            nodeName={nodeData?.name || ''}
            tokens={tokens}
            isLast={index === rows.length - 1}
            onSetState={handleSetState}
            onRemove={handleRemove}
            onPick={handlePick}
          />
        ))}

        <AddIdentifier onAdd={handleAdd} tokens={tokens} />
      </PanelCard>

      <ProvenanceRows
        nodeData={nodeData}
        isHomeTab={isHomeTab}
        graphData={graphData}
        tokens={tokens}
      />
    </div>
  );
};

export default AboutSection;
