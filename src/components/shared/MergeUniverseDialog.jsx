import React from 'react';
import { Merge, Globe, Check } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * The universe-merge flow, as one component with three phases.
 *
 * Deliberately not built on ConfirmDialog: its `onCancel` runs BEFORE `onClose`,
 * so a handler that opens a follow-up dialog gets clobbered by the close that
 * follows it. This flow needs exactly that (result → "disconnect the source?"),
 * so it owns its own phases instead of fighting those semantics. The scrim,
 * border, header and footer language is copied from LocalFileConflictDialog so
 * it still reads as the same family of dialog.
 */

const formatCount = (value) => (
  typeof value === 'number' && !Number.isNaN(value) ? value.toLocaleString() : '?'
);

const countsLine = (universe) => {
  if (!universe) return '';
  const webs = universe.graphCount ?? universe.raw?.metadata?.graphCount;
  const things = universe.nodeCount ?? universe.raw?.metadata?.nodeCount;
  const connections = universe.connectionCount ?? universe.raw?.metadata?.connectionCount;
  return `${formatCount(webs)} webs · ${formatCount(things)} things · ${formatCount(connections)} connections`;
};

const DialogButton = ({ onClick, children, tone = 'neutral', disabled = false }) => {
  const theme = useTheme();
  const accent = theme.accent.secondary;
  const isAccent = tone === 'accent';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 16px',
        borderRadius: 8,
        border: `2px solid ${isAccent ? accent : theme.canvas.textPrimary}`,
        backgroundColor: isAccent ? accent : 'transparent',
        color: isAccent ? (theme.darkMode ? theme.canvas.textPrimary : '#EFE8E5') : theme.canvas.textPrimary,
        fontWeight: 700,
        fontSize: '0.85rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: "'EmOne', sans-serif",
        transition: 'background-color 0.2s'
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.backgroundColor = isAccent ? '#5A0000' : theme.canvas.hover;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.backgroundColor = isAccent ? accent : 'transparent';
      }}
    >
      {children}
    </button>
  );
};

/** One side of the "which one survives" choice. */
const SideCard = ({ universe, role, recommended, selected, onSelect }) => {
  const theme = useTheme();
  const accent = theme.accent.secondary;
  const borderColor = selected ? accent : theme.canvas.textPrimary;

  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
      style={{
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        backgroundColor: theme.canvas.bg,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ color: selected ? accent : theme.canvas.textPrimary, display: 'flex', alignItems: 'center' }}>
          {selected ? <Check size={14} /> : <Globe size={14} />}
        </div>
        <span style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          color: selected ? accent : theme.canvas.textPrimary,
          letterSpacing: '0.04em'
        }}>
          {role}
        </span>
        {recommended && (
          <span style={{ fontSize: '0.65rem', color: theme.canvas.textSecondary, letterSpacing: '0.04em' }}>
            RECOMMENDED
          </span>
        )}
      </div>

      <div style={{
        fontSize: '0.85rem',
        fontWeight: 600,
        color: theme.canvas.textPrimary,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {universe?.name}
      </div>

      <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary }}>
        {countsLine(universe)}
      </div>
    </div>
  );
};

const ReportRow = ({ label, value }) => {
  const theme = useTheme();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.85rem' }}>
      <span style={{ color: theme.canvas.textSecondary }}>{label}</span>
      <span style={{ color: theme.canvas.textPrimary, fontWeight: 700 }}>{value.toLocaleString()}</span>
    </div>
  );
};

const MergeUniverseDialog = ({
  isOpen,
  phase = 'choose',           // 'choose' | 'working' | 'result'
  activeUniverse,
  sourceUniverse,
  activeWins = true,
  onActiveWinsChange,
  report = null,
  error = null,
  onConfirm,
  onDisconnectSource,
  onClose
}) => {
  const theme = useTheme();
  if (!isOpen) return null;

  const sourceName = sourceUniverse?.name || 'that universe';
  const activeName = activeUniverse?.name || 'this universe';

  const heading = phase === 'result'
    ? (error ? 'Merge failed' : 'Merge complete')
    : `Merge into ${activeName}`;

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
      onClick={phase === 'working' ? undefined : onClose}
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
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: `2px solid ${theme.canvas.textPrimary}`,
          backgroundColor: theme.canvas.border
        }}>
          <div style={{ color: theme.accent.secondary, display: 'flex', alignItems: 'center' }}>
            <Merge size={22} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: theme.canvas.textPrimary }}>
              {heading}
            </h2>
            {phase === 'choose' && (
              <p style={{ margin: 0, fontSize: '0.85rem', color: theme.canvas.textPrimary, lineHeight: 1.4 }}>
                Everything in "{sourceName}" is copied into "{activeName}". "{sourceName}" is left as it is.
              </p>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          {phase === 'choose' && (
            <>
              <div style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary }}>
                If both universes describe the same thing differently, which name and
                description should win?
              </div>
              <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SideCard
                  universe={activeUniverse}
                  role="KEEP THIS ONE'S WORDING"
                  recommended
                  selected={activeWins}
                  onSelect={() => onActiveWinsChange?.(true)}
                />
                <SideCard
                  universe={sourceUniverse}
                  role="KEEP THE OTHER ONE'S WORDING"
                  selected={!activeWins}
                  onSelect={() => onActiveWinsChange?.(false)}
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary, lineHeight: 1.5 }}>
                The losing wording is never thrown away — it is kept on the thing it
                belonged to. Things that only share a <em>name</em> stay separate, and are
                listed afterwards. This cannot be undone with Cmd+Z.
              </div>
            </>
          )}

          {phase === 'working' && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 12, padding: '30px 0', color: theme.canvas.textSecondary
            }}>
              <div style={{
                width: 16,
                height: 16,
                border: `2px solid ${theme.canvas.brand}`,
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <span style={{ fontSize: '0.9rem' }}>Reading "{sourceName}" and merging…</span>
              <style>{'@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }'}</style>
            </div>
          )}

          {phase === 'result' && error && (
            <div style={{ fontSize: '0.85rem', color: theme.canvas.textPrimary, lineHeight: 1.5 }}>
              {error}
              <div style={{ marginTop: 8, color: theme.canvas.textSecondary, fontSize: '0.8rem' }}>
                "{activeName}" was not changed.
              </div>
            </div>
          )}

          {phase === 'result' && !error && report && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <ReportRow label="Things added" value={report.addedPrototypeIds?.length ?? 0} />
                <ReportRow label="Things already shared" value={report.dedupedIds?.length ?? 0} />
                <ReportRow label="Things matched by link" value={report.mergedIds?.length ?? 0} />
                <ReportRow label="Webs added" value={report.addedGraphIds?.length ?? 0} />
                <ReportRow label="Webs combined" value={report.mergedGraphIds?.length ?? 0} />
                <ReportRow label="Connections added" value={report.addedEdgeIds?.length ?? 0} />
              </div>
              {report.closeMatchCandidates?.length > 0 && (
                <div style={{
                  marginTop: 4,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${theme.canvas.border}`,
                  fontSize: '0.8rem',
                  color: theme.canvas.textSecondary,
                  lineHeight: 1.5
                }}>
                  <strong style={{ color: theme.canvas.textPrimary }}>
                    {report.closeMatchCandidates.length} name {report.closeMatchCandidates.length === 1 ? 'match' : 'matches'} left separate.
                  </strong>{' '}
                  Sharing a name isn't proof of being the same thing, so these were kept
                  apart rather than merged on a guess. Reviewing them comes later.
                </div>
              )}
              <div style={{ marginTop: 4, fontSize: '0.75rem', color: theme.canvas.textSecondary, lineHeight: 1.5 }}>
                "{sourceName}" was not changed and is still in your list.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {phase !== 'working' && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderTop: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border
          }}>
            {phase === 'choose' && (
              <>
                <DialogButton onClick={onClose}>Cancel</DialogButton>
                <DialogButton tone="accent" onClick={onConfirm}>Merge</DialogButton>
              </>
            )}
            {phase === 'result' && (
              <>
                {/* Deliberately the quiet button: disconnecting is a separate,
                    destructive decision, not the natural end of a merge. */}
                {!error && (
                  <DialogButton onClick={onDisconnectSource}>
                    Disconnect {sourceName}…
                  </DialogButton>
                )}
                <DialogButton tone="accent" onClick={onClose}>Done</DialogButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MergeUniverseDialog;
