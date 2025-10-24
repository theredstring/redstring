import React, { useState } from 'react';
import StandardDivider from './StandardDivider.jsx';

const CollapsibleSection = ({ 
  title, 
  children, 
  defaultExpanded = true, 
  icon: Icon,
  count,
  rightAdornment
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div>
      {/* Section Header */}
              <div 
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
            cursor: 'pointer',
            userSelect: 'none',
            marginBottom: isExpanded ? '15px' : '0'
          }}
        >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          color: '#333',
          fontSize: '1.1rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          {Icon && <Icon size={18} />}
          {title}
          {count !== undefined && (
            <span style={{ 
              color: '#666', 
              fontSize: '0.9rem',
              fontWeight: 'normal'
            }}>
              ({count})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', color: '#333' }}>
          {rightAdornment}
          <span style={{
            display: 'inline-block',
            transition: 'transform 0.2s ease',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            fontSize: '14px',
            color: '#666'
          }}>
            ▶
          </span>
        </div>
      </div>
      {/* Section Content */}
      {isExpanded && (
        <div style={{
          marginBottom: '20px'
        }}>
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleSection;