import React from 'react';
import { AlertTriangle, Save, Github } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

const formatCount = (value) => {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value.toLocaleString();
  }
  return '?';
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return null;
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
};

const SlotCard = ({ icon, role, path, nodeCount, graphCount, timestamp, actionLabel, onSelect, tone = 'neutral' }) => {
  const theme = useTheme();
  const accentColor = tone === 'accent' ? theme.accent.secondary : theme.canvas.textPrimary;

  const stats = [
    `${formatCount(nodeCount)} nodes`,
    `${formatCount(graphCount)} graphs`
  ].join(' · ');

  const ts = formatTimestamp(timestamp);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ color: accentColor, display: 'flex', alignItems: 'center' }}>{icon}</div>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: accentColor, letterSpacing: '0.04em' }}>{role}</span>
      </div>

      {path && (
        <div style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {path}
        </div>
      )}

      <div style={{ fontSize: '0.78rem', color: theme.canvas.textPrimary, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>{stats}</span>
        {ts && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ opacity: 0.7 }}>{ts}</span>
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

const SlotConflictDialog = ({
  isOpen,
  universeName,
  localSlot,
  gitSlot,
  onChooseLocal,
  onChooseGit,
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
        {/* Header */}
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
              Data Conflict Detected
            </h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: theme.canvas.textPrimary, lineHeight: 1.4 }}>
              The local file and Git repository for "{universeName}" have different data. Choose which version to keep.
            </p>
          </div>
        </div>

        {/* Slot cards */}
        <div
          style={{
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflowY: 'auto'
          }}
        >
          <SlotCard
            icon={<Save size={14} />}
            role="Local File"
            path={localSlot?.path}
            nodeCount={localSlot?.nodeCount}
            graphCount={localSlot?.graphCount}
            timestamp={localSlot?.timestamp}
            actionLabel="Use Local File"
            onSelect={onChooseLocal}
            tone="neutral"
          />
          <SlotCard
            icon={<Github size={14} />}
            role={gitSlot?.repoLabel || 'Git Repository'}
            path={gitSlot?.path}
            nodeCount={gitSlot?.nodeCount}
            graphCount={gitSlot?.graphCount}
            timestamp={gitSlot?.timestamp}
            actionLabel="Use Git Version"
            onSelect={onChooseGit}
            tone="accent"
          />
        </div>
      </div>
    </div>
  );
};

export default SlotConflictDialog;
