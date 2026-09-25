/**
 * The canvas with no web open: the "Open a New Thing" button (moved verbatim
 * from NodeCanvas).
 */
import { haptic } from '../../../services/haptics.js';
import { Plus } from 'lucide-react';

export default function EmptyWebPrompt({ ctx }) {
  const {
    theme, openNewWebPrompt,
  } = ctx;

  return (
    <>
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
        fontFamily: "'EmOne', sans-serif"
      }}>
        <div style={{ fontSize: '16px', color: theme.canvas.textPrimary, opacity: 0.7 }}>
          Open a New Thing
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            // Same act as the header's + (Create New Thing), so it gets the
            // same feedback — see Header.jsx's action row — and opens the
            // same selector rather than minting an unnamed Web.
            haptic('menuSelect');
            openNewWebPrompt();
          }}
          onTouchEnd={(e) => {
            // The canvas container uses touchAction:'none' and intercepts touch events,
            // which prevents synthetic clicks from firing on this button on mobile.
            // Handle the tap explicitly here.
            e.stopPropagation();
            haptic('menuSelect');
            openNewWebPrompt();
          }}
          style={{
            width: '120px',
            height: '120px',
            backgroundColor: 'transparent',
            border: `3px dotted ${theme.canvas.textPrimary}`,
            borderRadius: '16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            outline: 'none',
            touchAction: 'manipulation'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(38, 0, 0, 0.05)';
            e.currentTarget.style.borderWidth = '4px';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderWidth = '3px';
          }}
          title="Create New Thing"
        >
          <Plus size={48} strokeWidth={2} color={theme.canvas.textPrimary} />
        </button>
      </div>
    </>
  );
}
