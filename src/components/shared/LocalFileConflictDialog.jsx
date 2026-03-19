import React from 'react';
import { AlertTriangle, HardDrive, FileCode } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import Modal from './Modal.jsx';

const formatCount = (value) => {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value.toLocaleString();
  }
  return 'Unknown';
};

const formatSize = (bytes) => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
    return 'Unknown';
  }
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
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
  const metadataRows = [];
  const headerIcon = tone === 'accent' ? <FileCode size={16} /> : <HardDrive size={16} />;

  const displayValue = option.displayPath || option.fileName || 'Unknown';
  metadataRows.push({ label: 'File', value: displayValue });
  metadataRows.push({ label: 'Nodes', value: formatCount(option.nodeCount) });
  metadataRows.push({ label: 'Edges', value: formatCount(option.edgeCount) });
  metadataRows.push({ label: 'File size', value: formatSize(option.fileSize) });

  if (option.lastSaved) {
    metadataRows.push({ label: 'Last autosave', value: formatTimestamp(option.lastSaved) });
  }

  if (option.fileModified && option.fileModified !== option.lastSaved) {
    metadataRows.push({ label: 'File modified', value: formatTimestamp(option.fileModified) });
  }

  return (
    <div
      style={{
        flex: '1 1 280px',
        border: `2px solid ${baseBorder}`,
        borderRadius: 12,
        backgroundColor: theme.canvas.bg,
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 0
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: accentColor, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em' }}>
          {headerIcon}
          <span>{option.role}</span>
        </div>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: theme.canvas.textPrimary }}>
          {option.label}
        </div>
        <div style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary, wordBreak: 'break-word' }}>
          {displayValue}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(120px, 140px) 1fr',
          gap: '6px 10px',
          fontSize: '0.8rem',
          color: theme.canvas.textPrimary
        }}
      >
        {metadataRows.map((row) => (
          <React.Fragment key={`${row.label}-${row.value}`}>
            <div style={{ fontWeight: 600, opacity: 0.8 }}>{row.label}</div>
            <div>{row.value}</div>
          </React.Fragment>
        ))}
      </div>

      <button
        onClick={onSelect}
        style={{
          marginTop: 'auto',
          padding: '8px 14px',
          borderRadius: 8,
          border: `2px solid ${accentColor}`,
          backgroundColor: tone === 'accent' ? accentColor : 'transparent',
          color: tone === 'accent' ? (theme.darkMode ? theme.canvas.textPrimary : theme.canvas.bg) : theme.canvas.textPrimary,
          fontWeight: 700,
          fontSize: '0.85rem',
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
          width: 'min(95vw, 760px)',
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
            padding: '16px 20px',
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
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            overflowY: 'auto'
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16
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
            padding: '12px 18px',
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
