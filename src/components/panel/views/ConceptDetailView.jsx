import React, { useEffect, useState } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { ArrowLeft, ExternalLink, Plus, Bookmark, Search, LocateFixed } from 'lucide-react';
import { getTextColor } from '../../../utils/colorUtils';
import { useTheme } from '../../../hooks/useTheme.js';
import useActiveGraphStructureKey from '../../../hooks/useActiveGraphStructureKey.js';
import { identifierFromUrl } from '../../../utils/externalIdentifiers.js';
import useGraphStore from '../../../store/graphStore.js';
import CollapsibleSection from '../../CollapsibleSection.jsx';
import StandardDivider from '../../StandardDivider.jsx';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import { PanelImageShimmer } from '../../shared/PanelImage.jsx';
import SemanticConnectionList from '../../connections/SemanticConnectionList.jsx';
import { wikipediaTitleFromLinks } from '../../../services/conceptEnrichment.js';
import { fetchWikipediaPage } from '../../../wizard/services/wikipediaEnrichment.js';
import {
  conceptUris, ensureConceptPrototype, findPrototypeForConcept, instancesOfPrototype, placeConcept, revealInstances
} from '../../../services/semanticPlacement.js';
import { haptic } from '../../../services/haptics.js';

const SPAWNABLE_NODE = 'spawnable_node';
// Room for a PanelIconButton's hover (3px ring + scale) inside a clipping box.
const HOVER_ROOM = 6;

// Held back in height so a tall picture doesn't push the page away.
const IMAGE_MAX_HEIGHT = 380;
// The picture's shape before the article says what it is: most lead images
// are landscape, so the held space rarely has to change much.
const DEFAULT_IMAGE_RATIO = 4 / 3;

/**
 * The article behind a concept — its fuller extract and its picture — fetched
 * from the link the concept already carries, never by searching its name.
 * Null while it's on its way; the picture's shape comes with the article, so
 * its space can be held before the bytes arrive.
 */
function useConceptSummary(concept) {
  const [summary, setSummary] = useState(null);
  const key = concept?.id;
  useEffect(() => {
    setSummary(null);
    if (!concept) return undefined;
    let live = true;
    (async () => {
      const title = await wikipediaTitleFromLinks([...conceptUris(concept)]).catch(() => null);
      // A found article comes back as 'direct' (or 'page'); a disambiguation has none.
      const page = title ? (await fetchWikipediaPage(title).catch(() => null))?.page || null : null;
      if (!live) return;
      if (!page) { setSummary({ key, extract: null, url: null, image: null }); return; }
      let image = null;
      if (page.thumbnail) {
        // The summary's thumbnail is ~330px; a wider rendition of the same
        // file fills the panel without going soft. Wikimedia won't scale a
        // picture past its original, so a small one falls back to the thumbnail.
        const wide = page.thumbnail.replace(/\/(\d+)px-/, (m, w) => (Number(w) < 800 ? '/800px-' : m));
        const ratio = page.thumbnailWidth && page.thumbnailHeight
          ? page.thumbnailWidth / page.thumbnailHeight
          : DEFAULT_IMAGE_RATIO;
        image = { srcs: [...new Set([wide, page.thumbnail])], ratio };
      }
      setSummary({ key, extract: page.description, url: page.url, image });
    })();
    return () => { live = false; };
    // Keyed on which concept this is, not on the object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The render between a new concept and the effect's reset still holds the
  // last one's article; it must never paint the new page.
  return summary?.key === key ? summary : null;
}

/**
 * The concept's picture, in the right panel's loading box: grey and
 * shimmering at the picture's own shape until it has decoded, then faded in —
 * so the page doesn't jump when it lands. With `image` unset it's the box
 * alone, held while the article is still on its way.
 */
const ConceptImage = ({ image, alt }) => {
  const ratio = image?.ratio || DEFAULT_IMAGE_RATIO;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = image?.srcs[attempt];

  const reveal = (img) => {
    // Decoded first, so it fades in whole rather than painting in mid-fade.
    (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => setLoaded(true));
  };
  // Already in the browser cache: complete before React attaches onLoad.
  const measureRef = (node) => {
    if (node?.complete && node.naturalWidth > 0 && !loaded) reveal(node);
  };
  const next = () => {
    if (attempt + 1 < (image?.srcs.length || 0)) setAttempt(attempt + 1);
    else setFailed(true);
  };

  // Nothing to show after all: no box, rather than an empty grey one.
  if (failed) return null;

  return (
    <div style={{
      // At its own shape, from the column's left edge: whole (these are
      // often diagrams), as wide as the column allows up to the height cap.
      position: 'relative',
      width: `min(100%, ${Math.round(IMAGE_MAX_HEIGHT * ratio)}px)`,
      aspectRatio: `${ratio}`,
      borderRadius: '10px',
      overflow: 'hidden',
      marginBottom: '12px',
      background: loaded ? 'transparent' : '#cfcfcf',
      transition: 'background-color 0.18s ease'
    }}>
      {src && (
        <img
          key={src}
          ref={measureRef}
          src={src}
          alt={alt}
          decoding="async"
          onLoad={(e) => reveal(e.currentTarget)}
          onError={next}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.18s ease'
          }}
        />
      )}
      {!loaded && <PanelImageShimmer />}
    </div>
  );
};

/** The concept's name as a node: the same pill the right panel titles a Thing with, and draggable onto the canvas the same way. */
const ConceptTitle = ({ concept, onDropped }) => {
  const theme = useTheme();
  const color = concept.color || theme.accent.primary;
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: SPAWNABLE_NODE,
    item: {
      prototypeId: null,
      nodeId: null,
      nodeName: concept.name,
      nodeColor: color,
      fromSemanticDiscovery: true,
      conceptData: concept,
      needsMaterialization: true
    },
    end: (item, monitor) => { if (monitor.didDrop()) onDropped?.(concept); },
    collect: (monitor) => ({ isDragging: !!monitor.isDragging() })
  }), [concept, color, onDropped]);

  useEffect(() => { preview(getEmptyImage(), { captureDraggingState: true }); }, [preview]);

  return (
    <div
      ref={drag}
      title={`${concept.name}. Drag onto the canvas`}
      style={{
        backgroundColor: color,
        color: getTextColor(color, theme.darkMode),
        borderRadius: '12px',
        padding: '10px 12px 8px',
        fontSize: '1.1rem',
        fontWeight: 'bold',
        fontFamily: "'EmOne', sans-serif",
        lineHeight: 1.1,
        textAlign: 'center',
        // Centred in its min height, as the right panel's title is: without
        // it the min height sat entirely under the text.
        minHeight: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        maxWidth: '220px',
        width: 'fit-content',
        overflowWrap: 'anywhere',
        cursor: 'grab',
        userSelect: 'none',
        opacity: isDragging ? 0.5 : 1
      }}
    >
      {concept.name}
    </div>
  );
};

/**
 * A discovered concept, shown the way the right panel shows a Thing — before
 * it is one. Title, what it is, where it comes from, and its connections on
 * the semantic web, each of which can be followed or brought into the open Web.
 */
const ConceptDetailView = ({ concept, onBack, onOpenConcept, onSearch, canGoBack = false, bottomClearance = 24 }) => {
  const theme = useTheme();
  const summary = useConceptSummary(concept);
  const [expanded, setExpanded] = useState(false);
  // A new concept opens with its description folded again.
  useEffect(() => { setExpanded(false); }, [concept?.id]);

  const activeGraphId = useGraphStore((s) => s.activeGraphId);
  const nodePrototypes = useGraphStore((s) => s.nodePrototypes);
  const savedNodeIds = useGraphStore((s) => s.savedNodeIds);
  // What's in the Web, not where it sits: a drag must not re-render this page.
  const structureKey = useActiveGraphStructureKey();

  if (!concept) return null;

  const proto = findPrototypeForConcept(concept, nodePrototypes);
  const inWeb = proto && activeGraphId && structureKey ? instancesOfPrototype(activeGraphId, proto.id)[0] : null;
  const isSaved = !!(proto && savedNodeIds.has(proto.id));
  const links = concept.semanticMetadata?.externalLinks || [];
  const description = summary?.extract || concept.description;

  const addToWeb = () => {
    if (!activeGraphId) return;
    haptic('nodeSpawn', { force: true });
    placeConcept({ graphId: activeGraphId, concept, mode: 'open' });
  };
  const showInWeb = () => inWeb && revealInstances(activeGraphId, [inWeb.id], { force: true });
  const toggleSaved = () => {
    if (proto) useGraphStore.getState().toggleSavedNode(proto.id);
    else ensureConceptPrototype(concept);
  };

  const actions = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {inWeb ? (
        <PanelIconButton icon={LocateFixed} size={20} onClick={showInWeb} title="In this web. Show it" />
      ) : (
        <PanelIconButton
          icon={Plus}
          size={20}
          onClick={addToWeb}
          disabled={!activeGraphId}
          title={activeGraphId ? `Add ${concept.name} to this web, in open space` : 'Open a web to add it'}
        />
      )}
      <PanelIconButton
        icon={Bookmark}
        size={20}
        filled={isSaved}
        // Filled in its own stroke colour, as the right panel's is — the
        // button's default fill is the accent.
        fillColor={theme.canvas.textPrimary}
        onClick={toggleSaved}
        title={isSaved ? 'Saved to your Library. Unsave' : 'Save to your Library'}
      />
      {onSearch && (
        <PanelIconButton icon={Search} size={20} onClick={() => onSearch(concept.name)} title={`Search for more like "${concept.name}"`} />
      )}
    </div>
  );

  const small = { fontSize: '12px', color: theme.canvas.textSecondary, fontFamily: "'EmOne', sans-serif" };

  return (
    <div className="concept-detail-view" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* The scroll box clips at its edges, and the icon buttons' hover grows
          past theirs (a 3px ring, a pie-bubble scale). HOVER_ROOM of padding
          gives them that room; the matching negative margin keeps the content
          lined up with the rest of the panel. */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        margin: `0 -${HOVER_ROOM}px`,
        padding: `${HOVER_ROOM}px ${HOVER_ROOM}px ${bottomClearance}px`
      }}>
        {/* Back, to the list or to the concept this one was reached from. */}
        <div style={{ marginBottom: '14px' }}>
          <PanelIconButton
            icon={ArrowLeft}
            size={14}
            label={canGoBack ? 'Back' : 'Results'}
            labelFontSize={12}
            variant="outline"
            onClick={onBack}
            title={canGoBack ? 'Back to the previous concept' : 'Back to the results'}
          />
        </div>

        {/* Header: the concept as a node, its actions in a row beneath it. */}
        <div style={{ marginBottom: '10px' }}>
          <ConceptTitle concept={proto ? { ...concept, color: proto.color || concept.color } : concept} onDropped={ensureConceptPrototype} />
        </div>
        <div style={{ marginBottom: '12px' }}>{actions}</div>

        {/* Where this concept comes from. Every authority it was merged from is worth opening. */}
        {links.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: '12px' }}>
            {links.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...small, display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
              >
                <ExternalLink size={11} />
                {identifierFromUrl(url).authority}
              </a>
            ))}
          </div>
        )}

        {/* The picture's space is held from the start (the right panel's
            loading box), so it doesn't shove the description down on arrival. */}
        {!summary ? (
          <ConceptImage key={concept.id} alt={concept.name} />
        ) : summary.image && (
          <ConceptImage key={concept.id} image={summary.image} alt={concept.name} />
        )}

        {description ? (
          <>
            <div style={{
              fontSize: '14px',
              lineHeight: 1.5,
              color: theme.canvas.textPrimary,
              fontFamily: "'EmOne', sans-serif",
              whiteSpace: 'pre-wrap',
              // The article's opening can run long; the connections are what
              // this page is for, so it stays a few lines until asked.
              ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' })
            }}>
              {description}
            </div>
            {description.length > 280 && (
              // The same outlined pill Web Definitions uses under a clamped description.
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '10px' }}>
                <PanelIconButton
                  label={expanded ? 'Show Less' : 'Show More'}
                  labelFontSize={11}
                  variant="outline"
                  onClick={() => setExpanded((v) => !v)}
                />
              </div>
            )}
          </>
        ) : (
          <div style={small}>No description on the semantic web.</div>
        )}

        <StandardDivider margin="20px 0" />

        <CollapsibleSection title="Connections" defaultExpanded>
          <SemanticConnectionList
            seed={concept}
            seedPrototypeId={proto?.id || null}
            seedColor={proto?.color || concept.color}
            onOpen={onOpenConcept}
          />
        </CollapsibleSection>
      </div>
    </div>
  );
};

export default ConceptDetailView;
