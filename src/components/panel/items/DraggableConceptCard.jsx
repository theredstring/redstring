import React, { useEffect, useMemo, useState } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Search, Bookmark, ArrowRight, Link2, Cable } from 'lucide-react';
import useGraphStore from '../../../store/graphStore.js';
import { getTextColor, getLightHueText, getDarkHueText } from '../../../utils/colorUtils';
import { useTheme } from '../../../hooks/useTheme.js';
import { sanitizeColor } from '../../../utils/safeColor.js';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import { findPrototypeForConcept, conceptUris } from '../../../services/semanticPlacement.js';
import { conceptIsPrototype, linkActionTitle, linkConceptToPrototype, unlinkConceptFromPrototype } from '../../../services/conceptLinking.js';

const ItemTypes = {
  SPAWNABLE_NODE: 'spawnable_node'
};

const SOURCE_LABELS = { wikidata: 'Wikidata', wikipedia: 'Wikipedia', dbpedia: 'DBpedia' };

// Round hit areas of this size: big enough to hit on touch, and the same
// shape the pie bubbles and the panel's other icon buttons have.
const HIT = 36;

/**
 * Who says so. A consolidated result names every authority folded into it,
 * because that IS the card's claim: one subject with an entry in each, and
 * dragging it in links the new Thing to all of them at once.
 */
const sourceLabel = (concept) => (
  concept.sources?.length
    ? concept.sources.join(' · ')
    : (SOURCE_LABELS[concept.source] || concept.source)
);

/**
 * A search result. With `origin` (the Thing the search was for) it can be
 * linked to that Thing, and once it is, it stands as that Thing: its colour,
 * its Library state, and a drag places that Thing rather than a copy.
 */
const DraggableConceptCard = ({ concept, origin = null, index = 0, onMaterialize, onSelect, onFocus }) => {
  const theme = useTheme();
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: ItemTypes.SPAWNABLE_NODE,
    item: {
      // Don't use the concept ID since it doesn't exist in nodePrototypesMap yet
      prototypeId: null, // Will trigger materialization during drop
      nodeId: null,
      nodeName: concept.name,
      nodeColor: concept.color,
      fromSemanticDiscovery: true,
      conceptData: concept, // Full concept data for materialization
      needsMaterialization: true // Flag to indicate this needs to be created
    },
    end: (item, monitor) => {
      if (monitor.didDrop()) onMaterialize(concept);
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [concept, onMaterialize]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  // Saved means in the Library — not merely that a prototype exists, which it
  // can after being unsaved.
  // Found once per change to the prototypes, not on every store update — the
  // store updates every frame of a drag.
  const nodePrototypes = useGraphStore((state) => state.nodePrototypes);
  const savedNodeIds = useGraphStore((state) => state.savedNodeIds);
  // Read back from the store, so a link made here shows the moment it lands.
  const originProto = origin ? nodePrototypes.get(origin.id) || null : null;
  const linked = useMemo(() => conceptIsPrototype(concept, originProto), [concept, originProto]);
  const proto = useMemo(
    () => (linked ? originProto : findPrototypeForConcept(concept, nodePrototypes)),
    [linked, originProto, concept, nodePrototypes]
  );
  const isBookmarked = !!(proto && savedNodeIds.has(proto.id));
  const linkable = conceptUris(concept).size > 0;

  const handleSaveToggle = () => {
    if (proto) useGraphStore.getState().toggleSavedNode(proto.id);
    else onMaterialize(concept);
    onSelect?.(null);
  };

  const handleLinkToggle = () => {
    if (!origin) return;
    if (linked) unlinkConceptFromPrototype(origin.id, concept);
    else linkConceptToPrototype(origin.id, concept);
  };

  const color = sanitizeColor(linked ? originProto.color : concept.color, '#8B0000');
  const ink = getTextColor(color, theme.darkMode);
  // The hover ring: the card's own hue, lighter on a dark panel and darker on
  // a light one, so it stands off the background either way.
  const ring = theme.darkMode ? getLightHueText(color) : getDarkHueText(color);
  const [hovered, setHovered] = useState(false);
  const lifted = hovered && !isDragging;
  const predicate = concept.semanticMetadata?.connectionInfo?.predicate || concept.defaultPredicate;
  const originalEntity = concept.semanticMetadata?.connectionInfo?.originalEntity;

  const buttonStyle = { width: HIT, height: HIT, padding: 0 };
  // One segment under the text, so the name and description keep the card's
  // full width however many actions there are.
  const actions = (
    <div style={{
      display: 'flex',
      gap: '2px',
      padding: '2px',
      borderRadius: `${HIT / 2 + 2}px`,
      background: `color-mix(in srgb, ${ink} 12%, transparent)`,
      flexShrink: 0,
      alignItems: 'center'
    }}>
      <PanelIconButton
        icon={Search}
        size={18}
        color={ink}
        style={buttonStyle}
        onClick={() => window.triggerSemanticSearch?.(concept.name)}
        title={`Search for more about "${concept.name}"`}
      />
      <PanelIconButton
        icon={Bookmark}
        size={18}
        color={ink}
        filled={isBookmarked}
        fillColor={ink}
        style={buttonStyle}
        onClick={handleSaveToggle}
        title={isBookmarked ? `Saved to your Library. Unsave "${concept.name}"` : `Save "${concept.name}" to your Library`}
      />
      {originProto && (
        <PanelIconButton
          icon={Cable}
          size={18}
          color={ink}
          active={linked}
          disabled={!linked && !linkable}
          style={buttonStyle}
          onClick={handleLinkToggle}
          title={linked
            ? `Linked: this is ${originProto.name}. Unlink`
            : linkable ? linkActionTitle(concept, originProto) : 'Nothing to link: no identifier on the semantic web'}
        />
      )}
    </div>
  );

  const info = (
    <div style={{
      color: ink,
      fontFamily: "'EmOne', sans-serif",
      fontSize: '10px',
      opacity: 0.8,
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '4px 6px',
      minWidth: 0
    }}>
      {concept.relationships?.length > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          <Link2 size={11} /> {concept.relationships.length}
        </span>
      )}
      <span>{sourceLabel(concept)}</span>
    </div>
  );

  return (
    <div
      ref={drag}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '6px',
        padding: '10px 8px 8px 12px',
        background: color,
        borderRadius: '12px',
        border: `1px solid ${theme.darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
        cursor: 'pointer',
        opacity: isDragging ? 0.5 : 1,
        // Hover: a ring in the card's own hue and a slight grow,
        // easing back out when the pointer leaves. `scale` rather than
        // `transform`, which the entrance animation holds.
        scale: lifted ? '1.02' : '1',
        transition: 'opacity 0.2s ease, box-shadow 0.15s ease, scale 0.15s ease',
        boxShadow: isDragging
          ? '0 4px 12px rgba(0,0,0,0.3)'
          : lifted
            ? `0 0 0 3px ${ring}, 0 4px 10px rgba(0,0,0,0.2)`
            : '0 2px 4px rgba(0,0,0,0.15)',
        userSelect: 'none',
        animation: `conceptSlideIn 0.3s ease ${index * 50}ms both`
      }}
      title="Click to see its page, drag onto the canvas"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (!isDragging && onFocus) onFocus(concept);
      }}
    >
      <div style={{ flex: 1, minWidth: 0, color: ink, fontFamily: "'EmOne', sans-serif" }}>
        <div style={{
          fontSize: '16px',
          fontWeight: 'bold',
          lineHeight: 1.3,
          marginBottom: '4px',
          overflowWrap: 'anywhere',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical'
        }}>
          {concept.name}
        </div>

        {predicate && (
          <div style={{
            fontSize: '10px',
            opacity: 0.8,
            marginBottom: '6px',
            fontStyle: 'italic',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            minWidth: 0
          }}>
            {originalEntity ? (
              <>
                <span style={{ maxWidth: '40%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {originalEntity}
                </span>
                <ArrowRight size={10} style={{ flexShrink: 0 }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{predicate}</span>
                <ArrowRight size={10} style={{ flexShrink: 0 }} />
              </>
            ) : (
              <span>via {predicate}</span>
            )}
          </div>
        )}

        {concept.description && (
          <div style={{
            fontSize: '11px',
            lineHeight: 1.4,
            opacity: 0.9,
            marginBottom: 0,
            overflowWrap: 'anywhere',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical'
          }}>
            {concept.description}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        {info}
        {actions}
      </div>
    </div>
  );
};

export default DraggableConceptCard;
