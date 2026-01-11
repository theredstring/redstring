import React, { useEffect } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Search } from 'lucide-react';
import { getTextColor } from '../../../utils/colorUtils';

const ItemTypes = {
  SPAWNABLE_NODE: 'spawnable_node'
};

// Ghost Semantic Node - Appears during semantic expansion with ghost-like effects
const GhostSemanticNode = ({ concept, index, onMaterialize, onSelect }) => {
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: ItemTypes.SPAWNABLE_NODE,
    item: {
      // Don't use the concept ID since it doesn't exist in nodePrototypesMap yet
      prototypeId: null, // Will trigger materialization during drop
      nodeId: null,
      nodeName: concept.name,
      nodeColor: concept.color,
      fromSemanticExpansion: true,
      conceptData: concept, // Full concept data for materialization
      needsMaterialization: true // Flag to indicate this needs to be created
    },
    end: (item, monitor) => {
      // If the item was dropped successfully, materialize it
      if (monitor.didDrop()) {
        const materializedId = onMaterialize(concept);
        console.log(`[SemanticExpansion] Auto-materialized ${concept.name} with ID: ${materializedId}`);
      }
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [concept, onMaterialize]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  // Staggered animation entrance effect
  const animationDelay = index * 100; // 100ms stagger between nodes
  const ghostOpacity = 0.7 + Math.random() * 0.2; // Slight opacity variation

  return (
    <div
      ref={drag}
      onClick={onSelect}
      style={{
        padding: '6px',
        background: concept.color,
        borderRadius: '8px',
        border: '1px dashed rgba(189,181,181,0.4)',
        cursor: 'grab',
        opacity: isDragging ? 0.3 : ghostOpacity,
        transform: `scale(${isDragging ? 0.95 : 1})`,
        transition: 'all 0.2s ease',
        position: 'relative',
        userSelect: 'none',
        minHeight: '60px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        // Ghost-like effects inspired by AbstractionCarousel
        animation: `ghostFadeIn 0.3s ease ${animationDelay}ms both, ghostFloat 2s ease-in-out infinite ${animationDelay + 500}ms`,
        boxShadow: `0 2px 8px rgba(34,139,34,0.3), inset 0 1px 0 rgba(255,255,255,0.1)`,
        backdropFilter: 'blur(1px)'
      }}
      title={`${concept.name} - Drag to canvas or click to add`}
    >
      {/* Ghost indicator */}
      <div style={{
        position: 'absolute',
        top: '2px',
        right: '3px',
        fontSize: '8px',
        opacity: 0.6,
        color: getTextColor(concept.color)
      }}>
        ✨
      </div>

      {/* Search Button - Canvas colored rounded square with icon in result's background color */}
      <div
        style={{
          position: 'absolute',
          top: '2px',
          right: '20px', // Position to the left of ghost indicator
          width: '16px',
          height: '16px',
          background: '#EFE8E5', // Canvas color
          borderRadius: '3px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: 0.8,
          transition: 'opacity 0.2s ease',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
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
          size={10}
          style={{
            color: getTextColor(concept.color) // Icon in result's background color
          }}
        />
      </div>

      {/* Compact node content */}
      <div style={{
        color: getTextColor(concept.color),
        fontFamily: "'EmOne', sans-serif",
        fontSize: '9px',
        fontWeight: 'bold',
        textAlign: 'center',
        lineHeight: '1.1',
        marginBottom: '2px',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {concept.name.length > 20 ? concept.name.substring(0, 20) + '...' : concept.name}
      </div>

      {/* Confidence indicator */}
      {concept.semanticMetadata?.confidence && (
        <div style={{
          fontSize: '6px',
          color: getTextColor(concept.color),
          opacity: 0.6,
          fontFamily: "'EmOne', sans-serif"
        }}>
          {Math.round(concept.semanticMetadata.confidence * 100)}%
        </div>
      )}

      {/* Connection count */}
      <div style={{
        position: 'absolute',
        bottom: '2px',
        left: '3px',
        fontSize: '6px',
        color: getTextColor(concept.color),
        opacity: 0.5,
        fontFamily: "'EmOne', sans-serif"
      }}>
        🔗{concept.relationships?.length || 0}
      </div>
    </div>
  );
};

export default GhostSemanticNode;
