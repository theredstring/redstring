import React, { useState } from 'react';
import { NODE_CORNER_RADIUS } from './constants';

const NodeGridItem = ({ 
  nodePrototype, 
  onClick, 
  width = 120, 
  height = 80 
}) => {
  const nodeColor = nodePrototype.color || '#800000';
  const nodeName = nodePrototype.name || 'Untitled';
  const [isSelecting, setIsSelecting] = useState(false);

  const handleClick = () => {
    setIsSelecting(true);
    onClick(nodePrototype);
    // Reset the animation state after animation completes
    setTimeout(() => setIsSelecting(false), 300);
  };

  return (
    <div
      className={`node-grid-item ${isSelecting ? 'selecting' : ''}`}
      title={`Create instance of: ${nodeName}`} // Tooltip for clarity
      onClick={handleClick}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: nodeColor,
        borderRadius: `${NODE_CORNER_RADIUS}px`,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px',
        boxSizing: 'border-box',
        transition: 'all 0.2s ease',
        border: '2px solid rgba(189, 181, 181, 0.3)',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.05)';
        e.currentTarget.style.borderColor = '#260000';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
        e.currentTarget.style.filter = 'brightness(1.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.filter = 'none';
      }}
    >
      {/* Node image if available */}
      {nodePrototype.thumbnailSrc && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `url(${nodePrototype.thumbnailSrc})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            borderRadius: `${NODE_CORNER_RADIUS - 2}px`,
            opacity: 0.3
          }}
        />
      )}
      
      {/* Node name */}
      <span
        style={{
          color: '#bdb5b5',
          fontSize: '12px',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif",
          textAlign: 'center',
          wordWrap: 'break-word',
          whiteSpace: 'normal',
          lineHeight: '1.2',
          userSelect: 'none',
          position: 'relative',
          zIndex: 1,
          textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
          maxWidth: '100%',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical'
        }}
      >
        {nodeName}
      </span>
    </div>
  );
};

export default NodeGridItem; 