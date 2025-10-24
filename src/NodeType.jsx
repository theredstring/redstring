import React from 'react';
import './NodeType.css';

const NodeType = ({ name, color = '#800000', onClick }) => {
  return (
    <div 
      className="node-type-item"
      style={{ 
        backgroundColor: color, 
        color: '#bdb5b5', // Canvas color for text
        borderRadius: '4px',
        minWidth: '60px', // Changed to minWidth for better scaling
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
        fontSize: '14px',
        fontFamily: "'EmOne', sans-serif",
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        border: '2px solid transparent',
        userSelect: 'none',
        padding: '0 8px', // Add horizontal padding
        overflow: 'hidden'
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#260000';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.transform = 'translateY(0px)';
      }}
    >
      <span
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%'
        }}
      >
        {name}
      </span>
    </div>
  );
};

export default NodeType;
