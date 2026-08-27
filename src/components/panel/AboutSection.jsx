import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, X, ChevronDown, Plus, Link2, History } from 'lucide-react';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import PanelCard, { usePanelCardTokens } from '../shared/PanelCard.jsx';
import InfoPopover from '../shared/InfoPopover.jsx';
import AnchoredPopoverBox from '../shared/AnchoredPopoverBox.jsx';
import {
  identifierFromUrl,
  collectIdentifiers,
  groupIdentifiers,
  extractDOI,
  isValidURL
} from '../../utils/externalIdentifiers.js';
import {
  LINK_STATES,
  canonicalizeLink,
  resolveLinkState,
  setLinkState,
  clearLinkState
} from '../../formats/linkState.js';
import {
  IDENTIFIERS_INTRO,
  MATCH_STATES,
  MATCH_STATES_INTRO,
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
 * render time by `identifierFromUrl`.
 */

/** Fetch a Wikidata item's label so a row can read "Q144 · dog", not just "Q144". */
const useWikidataLabel = (url) => {
  const [label, setLabel] = useState(null);

  useEffect(() => {
    const qid = (() => {
      if (!url) return null;
      if (url.startsWith('wd:')) return url.replace('wd:', '').trim();
      try {
        const u = new URL(url);
        if (!u.hostname.includes('wikidata.org')) return null;
        const last = u.pathname.split('/').filter(Boolean).pop() || '';
        return /^Q\d+$/i.test(last) ? last : null;
      } catch {
        return null;
      }
    })();

    if (!qid) { setLabel(null); return; }

    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&format=json&origin=*`
        );
        if (!resp.ok) return;
        const data = await resp.json();
        const labels = data?.entities?.[qid]?.labels || {};
        const value = labels.en?.value || Object.values(labels)[0]?.value || null;
        if (!cancelled) setLabel(value);
      } catch { /* a missing label is cosmetic; the identifier still reads fine */ }
    })();
    return () => { cancelled = true; };
  }, [url]);

  return label;
};

/**
 * One rung, as a button that looks like one.
 *
 * Outlined in the same maroon as its text, because the popover's fill is the
 * PieMenu's flat #DEDADA and an unoutlined row on it reads as a paragraph, not
 * a choice. The current rung is filled rather than outlined-differently, so the
 * three still scan as one set of equal options.
 */
const ChooserOption = ({ option, isCurrent, onPick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const raised = isHovered || isCurrent;

  return (
    <button
      onClick={() => onPick(option.state)}
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
      <span style={{ fontWeight: 'bold' }}>
        {isCurrent ? '• ' : ''}{option.label}
      </span>
      <span style={{ display: 'block', opacity: 0.8, marginTop: 1 }}>{option.blurb}</span>
    </button>
  );
};

/** The three rungs of the sameness ladder, as a small anchored menu. */
const StateChooser = ({ anchor, current, onPick, onDismiss }) => (
  <AnchoredPopoverBox
    position={anchor}
    direction="down-left"
    width={260}
    estimatedHeight={240}
    onDismiss={onDismiss}
    ariaLabel="How sure are you about this match?"
  >
    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>How sure is this?</div>
    <div style={{ marginBottom: 8, opacity: 0.85 }}>{MATCH_STATES_INTRO}</div>
    {MATCH_STATES.map(option => (
      <ChooserOption
        key={option.state}
        option={option}
        isCurrent={option.state === current}
        onPick={onPick}
      />
    ))}
  </AnchoredPopoverBox>
);

/** One identifier: authority, what it identifies, and how strongly it's claimed. */
const IdentifierRow = ({ url, page, state, onSetState, onRemove, isLast, tokens }) => {
  const { authority, identifier, href } = identifierFromUrl(url);
  const wikidataLabel = useWikidataLabel(url);
  const [chooserAnchor, setChooserAnchor] = useState(null);

  const stateLabel = MATCH_STATES.find(s => s.state === state)?.label || '';
  const pageInfo = page ? identifierFromUrl(page) : null;

  const openChooser = (event) => {
    const rect = event.currentTarget?.getBoundingClientRect?.();
    if (rect) setChooserAnchor({ x: rect.right, y: rect.bottom });
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 0',
        borderBottom: isLast ? 'none' : `1px solid ${tokens.hairline}`
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontFamily: FONT,
          fontSize: '10px',
          fontWeight: 'bold',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: tokens.brand,
          marginBottom: 1
        }}>
          {authority}
        </div>
        <div style={{
          fontFamily: FONT,
          fontSize: '13px',
          color: tokens.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {identifier}
          {wikidataLabel && (
            <span style={{ color: tokens.muted }}> · {wikidataLabel}</span>
          )}
        </div>
        <div style={{
          fontFamily: FONT,
          fontSize: '11px',
          color: tokens.muted,
          marginTop: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap'
        }}>
          <span>{stateLabel}</span>
          {/* The Wikipedia article isn't its own row — it's the readable face of
              the entity above it, and only shown when one lookup produced both. */}
          {pageInfo && (
            <a
              href={pageInfo.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: tokens.brand }}
            >
              ↗ wikipedia
            </a>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <PanelIconButton
          icon={ExternalLink}
          size={14}
          onClick={() => window.open(href, '_blank')}
          title={`Open in ${authority}`}
        />
        <PanelIconButton
          icon={ChevronDown}
          size={14}
          active={!!chooserAnchor}
          onClick={openChooser}
          title="How sure is this?"
          ariaExpanded={!!chooserAnchor}
          ariaHasPopup="dialog"
        />
        {/* Plain ghost variant, like every other remove button in the panel.
            `danger` swaps the hover ring to #F44336, which is a colour this
            panel uses nowhere else. */}
        <PanelIconButton
          icon={X}
          size={14}
          onClick={() => onRemove(url)}
          title="Remove this identifier"
        />
      </div>

      {chooserAnchor && (
        <StateChooser
          anchor={chooserAnchor}
          current={state}
          onPick={(next) => { onSetState(url, next); setChooserAnchor(null); }}
          onDismiss={() => setChooserAnchor(null)}
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
      {row('Created', nodeData?.createdAt ? new Date(nodeData.createdAt).toLocaleDateString() : null)}
      {row('Found by', foundBy, origin?.confidence != null ? `${Math.round(origin.confidence * 100)}% confidence` : undefined)}
      {row('Source', origin?.source ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {String(origin.source)}
          {origin.originalUri && (
            <a href={origin.originalUri} target="_blank" rel="noopener noreferrer" style={{ color: tokens.brand }}>
              ↗
            </a>
          )}
        </span>
      ) : null)}
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

  const rows = useMemo(() => {
    const urls = collectIdentifiers(nodeData);
    return groupIdentifiers(urls, nodeData).map(({ url, page }) => ({
      url,
      page,
      state: resolveLinkState(url, nodeData?.semanticMetadata)
    }));
  }, [nodeData]);

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
      // claim — the user escalates to that explicitly.
      semanticMetadata: setLinkState(nodeData?.semanticMetadata, url, LINK_STATES.CONFIRMED, 'user')
    });
  }, [nodeData, onNodeUpdate]);

  /**
   * Removal has to reach every place a link can live, or a link removed from
   * one store reappears from another on the next render.
   *
   * Replaces the old `unlinkSource(domain)` and keeps its Wikipedia side
   * effects verbatim — the image section's delete path is coupled to those
   * fields being cleared together.
   */
  const handleRemove = useCallback((url) => {
    const canonical = canonicalizeLink(url);
    const matches = (candidate) => typeof candidate === 'string' && canonicalizeLink(candidate) === canonical;

    const sm = { ...(nodeData?.semanticMetadata || {}) };

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

    onNodeUpdate?.({
      ...nodeData,
      externalLinks: (nodeData?.externalLinks || []).filter(link => !matches(link)),
      semanticMetadata: clearLinkState(sm, url)
    });
  }, [nodeData, onNodeUpdate]);

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
        {rows.length > 0 ? (
          rows.map((row, index) => (
            <IdentifierRow
              key={row.url}
              url={row.url}
              page={row.page}
              state={row.state}
              tokens={tokens}
              isLast={index === rows.length - 1}
              onSetState={handleSetState}
              onRemove={handleRemove}
            />
          ))
        ) : (
          <div style={{ fontSize: '12px', color: tokens.muted, padding: '2px 0' }}>
            No other system names this yet.
          </div>
        )}

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
