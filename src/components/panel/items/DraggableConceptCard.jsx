import React, { useEffect, useMemo } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Search, Bookmark, ArrowRight, Link2 } from 'lucide-react';
import useGraphStore from '../../../store/graphStore.js';
import { getTextColor } from '../../../utils/colorUtils';
import { useTheme } from '../../../hooks/useTheme.js';
import useElementWidth from '../../../hooks/useElementWidth.js';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import { findPrototypeForConcept } from '../../../services/semanticPlacement.js';

const ItemTypes = {
  SPAWNABLE_NODE: 'spawnable_node'
};

const SOURCE_LABELS = { wikidata: 'Wikidata', wikipedia: 'Wikipedia', dbpedia: 'DBpedia' };

// Below this card width the actions leave their column on the right and sit
// in a row under the text, so the name and description keep the full width.
const NARROW_CARD = 260;
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

const DraggableConceptCard = ({ concept, index = 0, onMaterialize, onUnsave, onSelect, onFocus }) => {
  const theme = useTheme();
  const [cardRef, width] = useElementWidth(320);
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
  const proto = useMemo(() => findPrototypeForConcept(concept, nodePrototypes), [concept, nodePrototypes]);
  const isBookmarked = !!(proto && savedNodeIds.has(proto.id));

  const handleSaveToggle = () => {
    if (isBookmarked) onUnsave(concept);
    else if (proto) useGraphStore.getState().toggleSavedNode(proto.id);
    else onMaterialize(concept);
    onSelect?.(null);
  };

  const ink = getTextColor(concept.color, theme.darkMode);
  const narrow = width > 0 && width < NARROW_CARD;
  const predicate = concept.semanticMetadata?.connectionInfo?.predicate || concept.defaultPredicate;
  const originalEntity = concept.semanticMetadata?.connectionInfo?.originalEntity;

  const buttonStyle = { width: HIT, height: HIT, padding: 0 };
  const actions = (
    <div style={{
      display: 'flex',
      flexDirection: narrow ? 'row' : 'column',
      gap: '4px',
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
      ref={(el) => { drag(el); cardRef.current = el; }}
      style={{
        display: 'flex',
        flexDirection: narrow ? 'column' : 'row',
        alignItems: narrow ? 'stretch' : 'center',
        gap: narrow ? '6px' : '8px',
        padding: narrow ? '10px 10px 6px' : '10px 6px 10px 12px',
        background: concept.color,
        borderRadius: '12px',
        border: `1px solid ${theme.darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
        cursor: 'grab',
        opacity: isDragging ? 0.5 : 1,
        transition: 'opacity 0.2s ease, box-shadow 0.2s ease',
        boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.3)' : '0 2px 4px rgba(0,0,0,0.15)',
        userSelect: 'none',
        animation: `conceptSlideIn 0.3s ease ${index * 50}ms both`
      }}
      title="Click to see its page, drag onto the canvas"
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
            marginBottom: narrow ? 0 : '8px',
            overflowWrap: 'anywhere',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical'
          }}>
            {concept.description}
          </div>
        )}

        {!narrow && info}
      </div>

      {narrow ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          {info}
          {actions}
        </div>
      ) : actions}
    </div>
  );
};

export default DraggableConceptCard;
