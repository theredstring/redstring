import React, { useState, useCallback, useMemo, useEffect, forwardRef } from 'react';
import { NODE_HEIGHT } from './constants'; // Assuming we use this height
import GraphPreview from './GraphPreview'; // <<< Import GraphPreview
import { XCircle } from 'lucide-react'; // <<< Import XCircle
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import useGraphStore from './store/graphStore.jsx';
// import './GraphListItem.css'; // We'll create this later

const SPAWNABLE_NODE = 'spawnable_node';

const GraphListItem = forwardRef(({
  graphData,
  panelWidth,
  isActive,
  onClick,
  onDoubleClick,
  onClose, // <<< Add onClose prop
  isExpanded, // <<< Receive isExpanded prop
  onToggleExpand // <<< Receive onToggleExpand prop
}, ref) => {
  const [isHovered, setIsHovered] = useState(false);
  const nodePrototypes = useGraphStore(state => state.nodePrototypes);
  
  // Get the defining node's name for fallback matching
  const definingNodeName = useMemo(() => {
    const definingNodeId = graphData.definingNodeIds?.[0];
    if (definingNodeId) {
      const definingNode = nodePrototypes.get(definingNodeId);
      return definingNode?.name;
    }
    return null;
  }, [graphData.definingNodeIds, nodePrototypes]);
  
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: SPAWNABLE_NODE,
    item: { 
      prototypeId: graphData.definingNodeIds?.[0],
      nodeName: definingNodeName // Include node name for fallback matching
    },
    canDrag: () => {
      const canDrag = !!graphData.definingNodeIds?.[0];
      console.log('[GraphListItem] canDrag check for', graphData.name, 'definingNodeId:', graphData.definingNodeIds?.[0], 'canDrag:', canDrag);
      return canDrag;
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [graphData.id, graphData.definingNodeIds, definingNodeName]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  // <<< Remove Log for isActive/isExpanded prop >>>
  // useEffect(() => {
  //   console.log(`[GraphListItem ${graphData.id}] Received isActive: ${isActive}, isExpanded: ${isExpanded}`);
  // }, [isActive, isExpanded, graphData.id]);

  const handleDoubleClick = useCallback(() => {
    // <<< Remove Log for double click >>>
    // console.log(`[GraphListItem ${graphData.id}] handleDoubleClick called, calling onToggleExpand.`);
    onToggleExpand?.(graphData.id); 
    // Potentially call onDoubleClick prop if needed for other actions
    // onDoubleClick?.(graphData.id); 
  }, [graphData.id, onToggleExpand]); // <<< Add dependencies

  const handleClick = useCallback(() => {
    onClick?.(graphData.id);
  }, [onClick, graphData.id]);

  // Calculate actual item width (needed for height animation)
  const currentItemWidth = useMemo(() => {
    // Subtracting 5px for the parent container's right padding
    return panelWidth ? panelWidth - 5 : NODE_HEIGHT; // Fallback to NODE_HEIGHT if panelWidth undefined?
  }, [panelWidth]);

  const itemStyle = {
    width: '100%',
    // FIX: Set height explicitly for smooth animation
    height: isExpanded ? currentItemWidth : NODE_HEIGHT,
    // aspectRatio: isExpanded ? '1 / 1' : undefined, // REMOVE aspect-ratio
    // FIX: Set static background/color, only border changes
    backgroundColor: graphData.color || 'maroon', // Always maroon
    color: '#bdb5b5', // Always light text
    // FIX: Use margin for spacing, remove marginBottom
    // marginBottom: '10px',
    margin: '5px 0', // Equal top/bottom margin
    // FIX: Increase border radius
    borderRadius: '12px', 
    boxSizing: 'border-box',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    // FIX: Apply border always - thicker when active, no border when inactive
    border: isActive ? '12px solid black' : 'none', // Active: thicker black, Inactive: no border
    // FIX: Update transition (remove background-color, color)
    transition: 'height 0.2s ease, border 0.2s ease',
    // FIX: Add alignment for when expanded
    alignItems: 'center', // Center preview horizontally
    justifyContent: isExpanded ? 'flex-start' : 'center', // Center name vertically when collapsed
    // FIX: Adjust padding based on expansion (add bottom padding when expanded)
    paddingTop: isExpanded ? '10px' : '0',
    paddingLeft: isExpanded ? '10px' : '0',
    paddingRight: isExpanded ? '10px' : '0',
    paddingBottom: isExpanded ? '15px' : '0', // Add more bottom padding for "chin"
    position: 'relative', // <<< Add relative position for absolute close button
    opacity: isDragging ? 0.5 : 1,
  };

  // Style for the preview container - Apply animation directly here
  const previewContainerStyle = {
    width: '85%',
    // height: '80%', // REMOVE fixed height
    // FIX: Animate maxHeight and opacity directly
    maxHeight: isExpanded ? '80%' : '0px', 
    opacity: isExpanded ? 1 : 0,
    marginTop: '0',
    marginBottom: '0',
    backgroundColor: '#bdb5b5',
    borderRadius: '4px',
    overflow: 'hidden', 
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // FIX: Add transition here
    transition: 'max-height 0.2s ease, opacity 0.2s ease',
  };

  return (
    <div
      ref={(node) => {
        drag(node);
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      style={itemStyle}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={graphData.name} // Tooltip with full name
    >
      {/* Graph Name - Add padding here */}
      <div 
        style={{
           fontWeight: 'bold',
           whiteSpace: 'nowrap',
           overflow: 'hidden',
           textOverflow: 'ellipsis',
           padding: isExpanded ? '5px 10px' : '10px',
           textAlign: 'center',
           width: '100%',
           boxSizing: 'border-box',
           // FIX: Remove auto margins when expanded
           marginTop: isExpanded ? '0' : 'auto',
           marginBottom: isExpanded ? '10px' : 'auto',
           userSelect: 'none',
           fontFamily: "'EmOne', sans-serif",
        }}
      >
        {graphData.name}
      </div>

      {/* Conditional Preview Area - Animate container directly */}
      <div style={previewContainerStyle}>
        {/* <div style={previewWrapperStyle}> REMOVE Wrapper */}
          {/* Render the actual preview only when expanded to avoid rendering cost? */}
          {isExpanded && (
            <GraphPreview 
              nodes={graphData.nodes}
              edges={graphData.edges}
              width={itemStyle.width === '100%' ? 100 : (currentItemWidth) * 0.85} 
              height={itemStyle.width === '100%' ? 100 : (currentItemWidth) * 0.80} 
            />
          )}
        {/* </div> */}
      </div>

      {/* Add Close Button Conditionally */}
      {isActive && (
        <XCircle
          size={24}
          style={{
            position: 'absolute',
            top: '0px',
            right: '0px',
            transform: 'translate(40%, -40%)',
            cursor: 'pointer',
            color: '#bdb5b5',
            backgroundColor: 'black',
            borderRadius: '50%',
            padding: '6px',
            zIndex: 2
          }}
          onClick={(e) => {
            e.stopPropagation(); // Prevent triggering item onClick
            onClose?.(graphData.id); // Call onClose prop with graph ID
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#EFE8E5'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#bdb5b5'}
          title="Close Tab"
        />
      )}


    </div>
  );
});

export default GraphListItem; 