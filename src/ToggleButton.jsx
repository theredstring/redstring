import React from 'react';
import { ArrowLeftFromLine, ArrowRightFromLine } from 'lucide-react';
import { HEADER_HEIGHT } from './constants'; // Assuming constants file is accessible

const ToggleButton = ({ isExpanded, onClick, side = 'right' }) => {
  const buttonTop = HEADER_HEIGHT; // Position directly below header (remove +10 gap)
  const buttonPosition = 0; // Position flush with the edge

  const positionStyle = side === 'left' 
    ? { left: `${buttonPosition}px` } 
    : { right: `${buttonPosition}px` };

  // Choose icon and rotation based on side and state
  const Icon = side === 'left' ? ArrowRightFromLine : ArrowLeftFromLine;
  const rotation = isExpanded ? 'rotate(180deg)' : 'none';

  return (
    <div
      style={{
        position: 'fixed',
        top: `${buttonTop}px`,
        ...positionStyle, // Apply left or right style
        width: 40,
        height: 40,
        backgroundColor: 'maroon', // Always maroon
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: 'none', // Ensure no border
        padding: 0, // Ensure no padding
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)', // Optional: subtle shadow
        zIndex: 10001,
        transition: 'background-color 0.2s ease', // Smooth background transition
        // Remove border-radius if you want sharp corners
        // borderRadius: '5px', 
      }}
      onClick={onClick}
      title={isExpanded ? 'Collapse Panel' : 'Expand Panel'} // Tooltip
    >
      <Icon 
        size={20} 
        color="#bdb5b5" 
        style={{ 
          transform: rotation,
          transition: 'transform 0.2s ease' 
        }} 
      />
    </div>
  );
};

export default ToggleButton; 