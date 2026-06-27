import React, { useState } from 'react';

export default function ThinkingBlock({ content, collapsed: initialCollapsed = false }) {
  const [expanded, setExpanded] = useState(false);

  // While streaming (not yet collapsed), always show live content
  // Once collapsed (response started), default to hidden
  const isVisible = initialCollapsed ? expanded : true;

  return (
    <div style={{
      margin: '4px 0',
      borderLeft: '2px solid rgba(255,255,255,0.15)',
      paddingLeft: '8px',
      opacity: 0.6,
      fontSize: '11px',
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'inherit',
          opacity: 0.7,
          padding: '0',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ transform: isVisible ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
        {initialCollapsed ? 'Thought' : 'Thinking…'}
      </button>
      {isVisible && (
        <div style={{
          marginTop: '4px',
          whiteSpace: 'pre-wrap',
          lineHeight: '1.5',
          maxHeight: '200px',
          overflowY: 'auto',
          color: 'inherit',
        }}>
          {content}
        </div>
      )}
    </div>
  );
}
