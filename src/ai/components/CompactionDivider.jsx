import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * Where a conversation was compacted: a rule across the transcript. Everything
 * above it is still here; The Wizard reads it as the summary, which opens
 * under the rule. See wizard/compactConversation.js.
 */
export default function CompactionDivider({ message }) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const body = String(message?.content || '').replace(/^\[Earlier conversation[^\]]*\]\n/, '');
  const rule = { flex: 1, height: 1, background: theme.canvas.border };

  return (
    <div style={{ alignSelf: 'stretch', margin: '16px 0 8px' }}>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        title={isOpen ? 'Hide the summary' : 'Show what The Wizard reads instead of the messages above'}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
          color: theme.canvas.textSecondary, fontFamily: 'inherit', fontSize: 11
        }}
      >
        <span style={rule} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          Summarized for The Wizard
          <ChevronDown
            size={12}
            style={{ transition: 'transform 0.15s ease', transform: isOpen ? 'rotate(180deg)' : 'none' }}
          />
        </span>
        <span style={rule} />
      </button>
      {isOpen && (
        <div style={{
          marginTop: 6, padding: '6px 10px',
          borderLeft: `2px solid ${theme.canvas.border}`,
          color: theme.canvas.textSecondary, fontSize: 11, lineHeight: 1.5,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word'
        }}>
          {body}
        </div>
      )}
    </div>
  );
}
