import React, { useState } from 'react';
import StandardDivider from './StandardDivider.jsx';
import { ChevronRight } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';

const CollapsibleSection = ({
  title,
  children,
  defaultExpanded = true,
  icon: Icon,
  count,
  rightAdornment
}) => {
  const theme = useTheme();
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
          color: theme.canvas.textPrimary,
          fontSize: '1.1rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          {Icon && <Icon size={18} />}
          {title}
          {count !== undefined && (
            <span style={{
              color: theme.canvas.textSecondary,
              fontSize: '0.9rem',
              fontWeight: 'normal'
            }}>
              ({count})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', color: theme.canvas.textPrimary }}>
          {rightAdornment && (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '4px',
                marginRight: '4px'
              }}
            >
              {rightAdornment}
            </div>
          )}
          <span style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            color: theme.canvas.textSecondary
          }}>
            <ChevronRight size={16} />
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