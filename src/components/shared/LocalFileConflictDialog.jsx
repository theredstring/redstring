import React from 'react';
import { AlertTriangle, HardDrive, FileCode } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

const formatCount = (value) => {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value.toLocaleString();
  }
  return '?';
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'Unknown';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
};

const OptionCard = ({ option, actionLabel, onSelect, tone = 'neutral' }) => {
  const theme = useTheme();
  const accentColor = tone === 'accent' ? theme.accent.secondary : theme.canvas.textPrimary;
  const baseBorder = tone === 'accent' ? theme.accent.secondary : theme.canvas.textPrimary;
  const headerIcon = tone === 'accent' ? <FileCode size={14} /> : <HardDrive size={14} />;
  const displayValue = option.displayPath || option.fileName || 'Unknown';

  const stats = [
    `${formatCount(option.nodeCount)} nodes`,
    `${formatCount(option.edgeCount)} edges`
  ].join(' · ');

  const timestamp = option.lastSaved
    ? formatTimestamp(option.lastSaved)
    : option.fileModified
      ? formatTimestamp(option.fileModified)
      : null;

  return (
    <div
      style={{
        border: `2px solid ${baseBorder}`,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ color: accentColor, display: 'flex', alignItems: 'center' }}>{headerIcon}</div>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: accentColor, letterSpacing: '0.04em' }}>{option.role}</span>
      </div>

      <div style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayValue}
      </div>

      <div style={{ fontSize: '0.78rem', color: theme.canvas.textPrimary, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>{stats}</span>
        {timestamp && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ opacity: 0.7 }}>{timestamp}</span>
          </>
        )}
      </div>

      <button
        onClick={onSelect}
        style={{
          marginTop: 2,
          padding: '6px 12px',
          borderRadius: 7,
          border: `2px solid ${accentColor}`,
          backgroundColor: tone === 'accent' ? accentColor : 'transparent',
          color: tone === 'accent' ? (theme.darkMode ? theme.canvas.textPrimary : theme.canvas.bg) : theme.canvas.textPrimary,
          fontWeight: 700,
          fontSize: '0.8rem',
          cursor: 'pointer',
          fontFamily: "'EmOne', sans-serif",
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = tone === 'accent' ? '#5A0000' : theme.canvas.hover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = tone === 'accent' ? accentColor : 'transparent';
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
};

const LocalFileConflictDialog = ({
  isOpen,
  universeName,
  existingOption,
  incomingOption,
  onChooseExisting,
  onOverwrite,
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
          margin: '40px 0',
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
          <div style={{ color: theme.accent.secondary, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={22} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: theme.canvas.textPrimary }}>
              Resolve Local File Conflict
            </h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: theme.canvas.textPrimary, lineHeight: 1.4 }}>
              We found multiple local files associated with "{universeName}". Choose which file should act as the source of truth going forward.
            </p>
          </div>
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            <OptionCard
              option={existingOption}
              actionLabel="Keep Existing File"
              onSelect={onChooseExisting}
              tone="neutral"
            />
            <OptionCard
              option={incomingOption}
              actionLabel="Use Linked File"
              onSelect={onOverwrite}
              tone="accent"
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '10px 16px',
            borderTop: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: `2px solid ${theme.canvas.textPrimary}`,
              backgroundColor: 'transparent',
              color: theme.canvas.textPrimary,
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontFamily: "'EmOne', sans-serif",
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.canvas.hover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default LocalFileConflictDialog;
