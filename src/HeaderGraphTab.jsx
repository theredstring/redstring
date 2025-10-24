import React, { useEffect, useMemo } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import useGraphStore from './store/graphStore.jsx';

const SPAWNABLE_NODE = 'spawnable_node';

// Helper to convert any color (hex or CSS name) to RGBA
const colorToRgba = (color, alpha) => {
    if (typeof color !== 'string' || !color) {
        return `rgba(255, 0, 255, ${alpha})`; // Bright magenta fallback
    }
    
    // If it's already a hex color, parse it
    if (color.startsWith('#')) {
        let r = 0, g = 0, b = 0;
        if (color.length === 4) { // #RGB
            r = parseInt(color[1] + color[1], 16);
            g = parseInt(color[2] + color[2], 16);
            b = parseInt(color[3] + color[3], 16);
        } else if (color.length === 7) { // #RRGGBB
            r = parseInt(color.slice(1, 3), 16);
            g = parseInt(color.slice(3, 5), 16);
            b = parseInt(color.slice(5, 7), 16);
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    
    // For CSS color names like "maroon", "red", etc., use a canvas to convert to RGB
    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        const computedColor = ctx.fillStyle;
        
        // If the browser converted it to hex, parse that
        if (computedColor.startsWith('#')) {
            const r = parseInt(computedColor.slice(1, 3), 16);
            const g = parseInt(computedColor.slice(3, 5), 16);
            const b = parseInt(computedColor.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        
        // If it's already in rgb() format, extract the values
        const rgbMatch = computedColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
        }
    }
    
    // Fallback: return the original color with alpha (for CSS named colors)
    return color;
};

const HeaderGraphTab = ({ graph, onSelect, onDoubleClick, isActive, hideText = false }) => {
  const nodePrototypes = useGraphStore(state => state.nodePrototypes);
  
  // Get the defining node's name for fallback matching
  const definingNodeName = useMemo(() => {
    if (graph.definingNodeId) {
      const definingNode = nodePrototypes.get(graph.definingNodeId);
      return definingNode?.name;
    }
    return null;
  }, [graph.definingNodeId, nodePrototypes]);
  
  const canDrag = !!graph.definingNodeId && !!nodePrototypes.get(graph.definingNodeId);
  
  // Log when a graph tab has an invalid definingNodeId
  useEffect(() => {
    if (graph.definingNodeId && !nodePrototypes.get(graph.definingNodeId)) {
      console.warn(`[HeaderGraphTab] Graph ${graph.id} has invalid definingNodeId: ${graph.definingNodeId}. Available prototypes:`, Array.from(nodePrototypes.keys()));
    }
  }, [graph.id, graph.definingNodeId, nodePrototypes]);
  
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: SPAWNABLE_NODE,
    item: () => ({ 
      prototypeId: graph.definingNodeId,
      nodeName: definingNodeName // Include node name for fallback matching
    }),
    canDrag: () => canDrag,
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [graph, definingNodeName, nodePrototypes, canDrag]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);
  
  const tabStyle = {
    padding: '7px 17px',
    backgroundColor: isActive ? graph.color : colorToRgba(graph.color, 0.333),
    borderRadius: '12px',
    color: isActive ? '#bdb5b5' : 'rgba(240, 240, 240, 0.5)',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
    cursor: canDrag ? 'pointer' : 'not-allowed',
    margin: '0 5px',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',
    fontWeight: 'bold',
    fontSize: '18px',
    fontFamily: "'EmOne', sans-serif",
    boxShadow: isActive ? '0 0 8px rgba(0,0,0,0.0)' : 'none',
    border: 'none',
    userSelect: 'none',
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flexShrink: 0,
    opacity: isDragging ? 0.5 : (canDrag ? 1 : 0.6),
  };

  const handleClick = (e) => {
    if (!isActive && onSelect && canDrag) {
      onSelect(graph.id);
    }
  };

  const handleDoubleClick = (e) => {
    if (onDoubleClick && isActive && canDrag) {
      onDoubleClick(e);
    }
  };

  return (
    <div
      ref={canDrag ? drag : null}
      style={tabStyle}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={canDrag ? graph.name : `${graph.name} (prototype not available)`}
    >
      <span style={{ 
        opacity: hideText ? 0 : 1,
        display: 'inline-block',
        verticalAlign: 'middle', // Better vertical alignment
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        fontFamily: "'EmOne', sans-serif"
      }}>
        {graph.name}
      </span>
    </div>
  );
};

export default HeaderGraphTab; 