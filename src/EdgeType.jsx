import React from 'react';

const EdgeType = ({ name, color = '#800000', onClick }) => {
  return (
    <div 
      className="edge-type-item"
      style={{ 
        backgroundColor: '#bdb5b5', // Canvas color background
        color: '#260000', // Dark text for contrast
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
        position: 'relative',
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
      {/* Vertical line to distinguish from nodes */}
      <div
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          bottom: '0',
          width: '12px',
          backgroundColor: color,
          opacity: 1
        }}
      />
      
      {/* Text with proper truncation */}
      <span
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
          paddingLeft: '14px' // Space for the wider vertical line
        }}
      >
        {name}
      </span>
    </div>
  );
};

export default EdgeType;