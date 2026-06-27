import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

export default function ThinkingBlock({ content, contentHtml, collapsed }) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  // When thinking completes (collapsed becomes true), reset to closed
  useEffect(() => {
    if (collapsed) setIsOpen(false);
  }, [collapsed]);

  const showContent = collapsed ? isOpen : true;

  return (
    <div style={{
      margin: '4px 0 6px',
      borderLeft: `2px solid ${theme.canvas.border}`,
      paddingLeft: '10px',
    }}>
      <button
        onClick={() => { if (collapsed) setIsOpen(o => !o); }}
        style={{
          background: 'none',
          border: 'none',
          cursor: collapsed ? 'pointer' : 'default',
          color: theme.canvas.textSecondary,
          padding: '2px 0',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          fontFamily: 'inherit',
        }}
      >
        {collapsed && (
          <ChevronDown
            size={12}
            style={{
              transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.15s ease',
              flexShrink: 0,
            }}
          />
        )}
        <span>{collapsed ? 'Thought' : 'Thinking…'}</span>
      </button>
      {showContent && (
        <div style={{
          fontSize: '11px',
          lineHeight: '1.5',
          color: theme.canvas.textSecondary,
          maxHeight: '200px',
          overflowY: 'auto',
          marginTop: '2px',
        }}>
          {contentHtml
            ? <div dangerouslySetInnerHTML={{ __html: contentHtml }} />
            : <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>}
        </div>
      )}
    </div>
  );
}
