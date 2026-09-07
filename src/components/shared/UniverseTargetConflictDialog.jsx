import React from 'react';
import { AlertTriangle, FolderTree } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * Two or more universes are configured to write the SAME file.
 *
 * Distinct from SlotConflictDialog, which asks "local or git?" about one
 * universe's two copies. This one asks "which universe owns this path?" —
 * the failure where slug dedup produced `ii` and `ii-2` while both wrote
 * `universes/ii/ii.redstring`, so each one's guard state described only its own
 * history and an empty universe overwrote a populated one.
 *
 * Saves are blocked for every universe involved until this is answered, so the
 * dialog is a stop sign, not a notice. It deliberately does not preselect a
 * winner: the app cannot know which universe the user thinks of as the real
 * one, and guessing is how the wrong one keeps the data.
 */

const formatCount = (value) =>
  (typeof value === 'number' && !Number.isNaN(value)) ? value.toLocaleString() : '?';

const ClaimantCard = ({ universe, onKeep, isOnly }) => {
  const theme = useTheme();
  const accentColor = theme.canvas.textPrimary;

  return (
    <div
      style={{
        border: `2px solid ${accentColor}`,
        borderRadius: 10,
        backgroundColor: theme.canvas.bg,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        overflow: 'hidden'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: '0.9rem', fontWeight: 700, color: accentColor,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>
          {universe.name || universe.slug}
        </span>
        <span style={{ fontSize: '0.72rem', color: theme.canvas.textSecondary, flexShrink: 0 }}>
          {universe.slug}
        </span>
      </div>

      <div style={{ fontSize: '0.78rem', color: theme.canvas.textPrimary, fontWeight: 600 }}>
        {formatCount(universe.nodeCount)} things · {formatCount(universe.graphCount)} webs
      </div>

      <button
        onClick={() => onKeep(universe.slug)}
        disabled={isOnly}
        style={{
          marginTop: 2,
          padding: '6px 12px',
          borderRadius: 7,
          border: `2px solid ${accentColor}`,
          backgroundColor: 'transparent',
          color: accentColor,
          fontWeight: 700,
          fontSize: '0.8rem',
          cursor: isOnly ? 'default' : 'pointer',
          opacity: isOnly ? 0.5 : 1,
          fontFamily: "'EmOne', sans-serif",
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => { if (!isOnly) e.currentTarget.style.backgroundColor = theme.canvas.hover; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        This one keeps the file
      </button>
    </div>
  );
};

const UniverseTargetConflictDialog = ({
  isOpen,
  targetPath,
  claimants = [],
  onKeep,
  onCancel
}) => {
  const theme = useTheme();
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: 20
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: 'min(95vw, 520px)',
          backgroundColor: theme.canvas.bg,
          border: `3px solid ${theme.canvas.textPrimary}`,
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'EmOne', sans-serif",
          boxShadow: '0 22px 60px rgba(0,0,0,0.55)',
          maxHeight: 'min(650px, 85vh)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderBottom: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border
          }}
        >
          <div style={{ color: theme.accent.secondary, display: 'flex', alignItems: 'center' }}>
            <AlertTriangle size={22} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: theme.accent.secondary }}>
              Two universes, one file
            </h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: theme.canvas.textPrimary, lineHeight: 1.4 }}>
              These universes all save to the same file, so each one overwrites the
              others. Saving is paused for all of them until you pick which keeps it —
              the rest move to their own file.
            </p>
          </div>
        </div>

        <div style={{
          padding: '10px 16px 0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: theme.canvas.textSecondary,
          fontSize: '0.78rem',
          minWidth: 0
        }}>
          <FolderTree size={14} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {targetPath}
          </span>
        </div>

        <div
          style={{
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflowY: 'auto'
          }}
        >
          {claimants.map((universe) => (
            <ClaimantCard
              key={universe.slug}
              universe={universe}
              onKeep={onKeep}
              isOnly={claimants.length < 2}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default UniverseTargetConflictDialog;
