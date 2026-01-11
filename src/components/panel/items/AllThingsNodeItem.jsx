import React, { useState, useEffect } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Copy, XCircle } from 'lucide-react';
import { NODE_DEFAULT_COLOR, PANEL_CLOSE_ICON_SIZE } from '../../../constants';
import { getTextColor, generateConceptColor } from '../../../utils/colorUtils';
import { showContextMenu } from '../../GlobalContextMenu.jsx';

const ItemTypes = {
  SPAWNABLE_NODE: 'spawnable_node'
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
          color: getTextColor(node.semanticMetadata?.isSemanticNode ? getSemanticNodeColor(node) : (node.color || NODE_DEFAULT_COLOR)),
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
