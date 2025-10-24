import React, { useState, useEffect } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Copy, XCircle } from 'lucide-react';
import { NODE_DEFAULT_COLOR, PANEL_CLOSE_ICON_SIZE } from '../../../constants';
import { showContextMenu } from '../../GlobalContextMenu.jsx';

const ItemTypes = {
  SPAWNABLE_NODE: 'spawnable_node'
};

// Generate consistent color based on node name
const generateConceptColor = (name) => {
  // Hue values that create pleasant, readable colors with maroon's saturation/brightness
  const hues = [0, 25, 90, 140, 200, 260, 300]; // Red, Orange-Red, Green, Cyan-Green, Blue, Purple, Magenta

  // Convert HSV to hex (same logic as ColorPicker)
  const hsvToHex = (h, s, v) => {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r, g, b;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Use maroon's saturation (1.0) and brightness (~0.545) for consistency
  const targetSaturation = 1.0;
  const targetBrightness = 0.545;

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) & 0xffffffff;
  }

  const selectedHue = hues[Math.abs(hash) % hues.length];
  return hsvToHex(selectedHue, targetSaturation, targetBrightness);
};

// Ensure semantic node uses consistent color across all views
const getSemanticNodeColor = (nodeData) => {
  // If node has stored generated color from semantic metadata, use it
  if (nodeData.semanticMetadata?.generatedColor) {
    return nodeData.semanticMetadata.generatedColor;
  }
  // Otherwise use the node's current color or generate one
  return nodeData.color || generateConceptColor(nodeData.name || 'Unknown');
};

const AllThingsNodeItem = ({ node, onClick, onDoubleClick, isActive, hasSemanticData, onDelete, duplicateNodePrototype }) => {
  const [isHovered, setIsHovered] = useState(false);

  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: ItemTypes.SPAWNABLE_NODE,
    item: {
      prototypeId: node.id,
      nodeName: node.name // Include node name for fallback matching
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [node.id, node.name]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    showContextMenu(e.clientX, e.clientY, [
      {
        label: 'Duplicate Node',
        icon: <Copy size={14} />,
        action: () => duplicateNodePrototype(node.id)
      }
    ]);
  };

  return (
    <>
      <div
        ref={drag}
        key={node.id}
        data-has-context-menu="true"
        title={`${node.name}${hasSemanticData ? ' • Connected to semantic web' : ''}`}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        backgroundColor: node.semanticMetadata?.isSemanticNode ? getSemanticNodeColor(node) : (node.color || NODE_DEFAULT_COLOR),
        color: '#bdb5b5',
        borderRadius: '10px',
        padding: '4px 6px',
        fontSize: '0.8rem',
        fontWeight: 'bold',
        textAlign: 'center',
        cursor: 'pointer',
        overflow: 'visible',
        userSelect: 'none',
        borderWidth: '4px',
        borderStyle: 'solid',
        borderColor: isActive ? 'black' : 'transparent',
        boxSizing: 'border-box',
        transition: 'opacity 0.3s ease, border-color 0.2s ease',
        margin: '4px',
        minWidth: '100px',
        opacity: isDragging ? 0.5 : 1,
        fontFamily: "'EmOne', sans-serif",
        // Add semantic web glow effect
        boxShadow: hasSemanticData ? `0 0 8px ${node.semanticMetadata?.isSemanticNode ? getSemanticNodeColor(node) : (node.color || NODE_DEFAULT_COLOR)}` : 'none',
      }}
    >
      <span style={{
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {node.name || 'Unnamed'}
      </span>
      <div
        style={{
          position: 'absolute',
          top: '-6px',
          right: '-6px',
          cursor: 'pointer',
          zIndex: 10,
          backgroundColor: '#000000',
          borderRadius: '50%',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.2s ease',
          pointerEvents: isHovered ? 'auto' : 'none',
        }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete?.(node.id);
        }}
        title="Delete this item"
      >
        <XCircle
          size={PANEL_CLOSE_ICON_SIZE}
          style={{
            color: '#999999',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#EFE8E5'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#999999'}
        />
      </div>
      </div>
    </>
  );
};

export default AllThingsNodeItem;
