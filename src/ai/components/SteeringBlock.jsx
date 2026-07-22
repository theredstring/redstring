import React, { useState } from 'react';
import { ChevronDown, CornerDownRight } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

// Human-readable label for each steering `kind` emitted by the agent loop. These are the
// synthetic "user" messages the loop injects to keep the model on track — a hidden second
// voice in the conversation. Surfacing them makes the loop↔model negotiation visible.
const KIND_LABELS = {
  empty_response: 'Loop nudged the model — empty reply',
  plan_incomplete: 'Loop nudged the model — plan not done yet',
  first_iteration: 'Loop nudged the model — follow through with tools?',
  sparse_definition: 'Loop nudged the model — definition graph too thin',
  plan_complete: 'Loop told the model — plan done, wrap up',
  plan_locked: 'Loop told the model — stop re-planning, act',
  nudge: 'Loop nudged the model',
};

export default function SteeringBlock({ kind, content }) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const label = KIND_LABELS[kind] || KIND_LABELS.nudge;

  return (
    <div style={{
      margin: '4px 0 6px',
      borderLeft: `2px dashed ${theme.canvas.border}`,
      paddingLeft: '10px',
    }}>
      <button
        onClick={() => setIsOpen(o => !o)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: theme.canvas.textSecondary,
          padding: '2px 0',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          fontStyle: 'italic',
          fontFamily: 'inherit',
          opacity: 0.75,
          textAlign: 'left',
        }}
        title="A message the loop sent to the model automatically"
      >
        <ChevronDown
          size={12}
          style={{
            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.15s ease',
            flexShrink: 0,
          }}
        />
        <CornerDownRight size={11} style={{ flexShrink: 0 }} />
        <span>{label}</span>
      </button>
      {isOpen && (
        <div style={{
          fontSize: '11px',
          lineHeight: '1.5',
          color: theme.canvas.textSecondary,
          maxHeight: '200px',
          overflowY: 'auto',
          marginTop: '2px',
          whiteSpace: 'pre-wrap',
          userSelect: 'text',
          cursor: 'text',
          opacity: 0.85,
        }}>
          {content}
        </div>
      )}
    </div>
  );
}
