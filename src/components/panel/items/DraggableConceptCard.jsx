import React, { useEffect, useMemo } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Search, Bookmark } from 'lucide-react';
import useGraphStore from '../../../store/graphStore.jsx';
import { getTextColor } from '../../../utils/colorUtils';

const ItemTypes = {
  SPAWNABLE_NODE: 'spawnable_node'
};

const DraggableConceptCard = ({ concept, index = 0, onMaterialize, onUnsave, onSelect, isSelected }) => {
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
      // If the item was dropped successfully, materialize it
      if (monitor.didDrop()) {
        const materializedId = onMaterialize(concept);
        console.log(`[SemanticDiscovery] Auto-materialized ${concept.name} with ID: ${materializedId}`);
      }
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [concept, onMaterialize]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  const handleSaveToggle = () => {
    if (isBookmarked) {
      // If already bookmarked, unsave it
      onUnsave(concept);
    } else {
      // If not bookmarked, save it
      const nodeId = onMaterialize(concept);
    }
    onSelect(null); // Deselect after action
  };

  // Check if this concept is bookmarked (materialized)
  // Subscribe to store changes to check if this concept is already materialized
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const isBookmarked = useMemo(() => {
    if (!nodePrototypesMap || typeof nodePrototypesMap.get !== 'function') {
      return false;
    }

    return Array.from(nodePrototypesMap.values()).some(node =>
      node.semanticMetadata?.isSemanticNode &&
      node.name === concept.name
    );
  }, [nodePrototypesMap, concept.name]);

  return (
    <div
      ref={drag}
      style={{
        padding: '10px 70px 10px 10px', // More right padding for better icon spacing
        background: concept.color,
        borderRadius: '12px', // More rounded like actual nodes
        border: '1px solid rgba(189,181,181,0.3)',
        cursor: 'grab',
        opacity: isDragging ? 0.5 : 1,
        transition: 'all 0.2s ease',
        marginBottom: '6px',
        boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.3)' : '0 2px 4px rgba(0,0,0,0.1)',
        position: 'relative',
        userSelect: 'none',
        animation: `conceptSlideIn 0.3s ease ${index * 50}ms both`,
        pointerEvents: 'auto' // Ensure drag still works
      }}
      title="Drag to canvas"
    >
      {/* Search Button - Large, panel background colored icon with square hit box */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          right: '50px', // More spacing from edge
          transform: 'translateY(-50%)',
          width: '44px', // Square hit box
          height: '44px', // Square hit box
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: 0.8,
          transition: 'opacity 0.2s ease'
        }}
        onClick={(e) => {
          e.stopPropagation();
          // Trigger a new search with this concept's name
          if (typeof window !== 'undefined' && window.triggerSemanticSearch) {
            window.triggerSemanticSearch(concept.name);
          }
        }}
        title={`Search for more about "${concept.name}"`}
        onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
        onMouseLeave={(e) => e.currentTarget.style.opacity = 0.8}
      >
        <Search
          size={32}
          style={{
            color: getTextColor(concept.color), // Panel background color
            pointerEvents: 'none' // Allow clicks/hover to pass through to container
          }}
        />
      </div>

      {/* Save/Unsave Button - Toggles between bookmark and trash icons */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          right: '10px', // More spacing from edge
          transform: 'translateY(-50%)',
          width: '44px', // Square hit box
          height: '44px', // Square hit box
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: 0.8,
          transition: 'opacity 0.2s ease'
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleSaveToggle();
        }}
        title={isBookmarked ? `Remove "${concept.name}" from your graph` : `Save "${concept.name}" to your graph`}
        onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
        onMouseLeave={(e) => e.currentTarget.style.opacity = 0.8}
      >
        <Bookmark
          size={32}
          style={{
            color: getTextColor(concept.color), // Panel background color stroke
            fill: isBookmarked ? getTextColor(concept.color) : 'transparent', // Filled when saved, transparent when unsaved
            pointerEvents: 'none' // Allow clicks/hover to pass through to container
          }}
        />
      </div>

      {/* Node Name */}
      <div style={{
        color: getTextColor(concept.color),
        fontFamily: "'EmOne', sans-serif",
        fontSize: '16px', // Larger title
        fontWeight: 'bold',
        marginBottom: '8px',
        lineHeight: '1.3',
        paddingRight: '45px', // Adjusted for chip padding + icons
        wordWrap: 'break-word',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical'
      }}>
        {concept.name}
      </div>

      {/* Truncated Description */}
      <div style={{
        color: getTextColor(concept.color),
        fontFamily: "'EmOne', sans-serif",
        fontSize: '11px',
        lineHeight: '1.4',
        marginBottom: '8px',
        opacity: 0.9,
        paddingRight: '45px', // Adjusted for chip padding + icons
        wordWrap: 'break-word',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 3, // Allow 3 lines with better wrapping
        WebkitBoxOrient: 'vertical'
      }}>
        {concept.description}
      </div>

      {/* Bottom Info Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{
          color: getTextColor(concept.color),
          fontFamily: "'EmOne', sans-serif",
          fontSize: '10px', // Larger for better readability
          opacity: 0.8,
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span>🔗 {concept.relationships?.length || 0}</span>
          {concept.semanticMetadata?.confidence && (
            <span>• {Math.round(concept.semanticMetadata.confidence * 100)}%</span>
          )}
          <span>• {concept.source === 'wikidata' ? 'Wikidata' : concept.source === 'dbpedia' ? 'DBpedia' : concept.source}</span>
        </div>
      </div>
    </div>
  );
};

export default DraggableConceptCard;
