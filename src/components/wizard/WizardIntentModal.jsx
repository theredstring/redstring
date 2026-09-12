import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import { intentsForSurface, defaultIntentForSurface, intentLabel } from '../../wizard/prompts/intents.js';

/**
 * Pick what to ask The Wizard about an element.
 *
 * Replaces four near-identical CanvasConfirmDialog blocks that all asked the same
 * narrow question — new conversation, or add to the current one? That question is
 * still here, but demoted to a sticky control at the foot, because the interesting
 * choice is WHICH ask, not where its answer lands.
 *
 * The default intent is pre-selected and is always the ask that button already
 * performed, so the familiar path is Enter or one click.
 */
const WizardIntentModal = ({
  isOpen,
  surface,
  facts,
  subjectLabel,
  destination,
  onDestinationChange,
  onConfirm,
  onClose
}) => {
  const theme = useTheme();
  const intents = useMemo(() => (isOpen ? intentsForSurface(surface, facts) : []), [isOpen, surface, facts]);
  const [selectedId, setSelectedId] = useState(null);
  const [freeText, setFreeText] = useState('');
  const textareaRef = useRef(null);

  // Reset to the default whenever the modal opens on a new element.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedId(defaultIntentForSurface(surface, facts)?.id || null);
    setFreeText('');
  }, [isOpen, surface, facts]);

  const selected = intents.find(i => i.id === selectedId) || null;
  const isFreeText = selected?.tier === 'freetext';

  useEffect(() => {
    if (isFreeText) textareaRef.current?.focus();
  }, [isFreeText]);

  if (!isOpen) return null;

  // A free-text row with nothing typed in it has no ask to send.
  const canSubmit = !!selected && (!isFreeText || freeText.trim().length > 0);
  const submit = () => {
    if (!canSubmit) return;
    onConfirm({ intent: selected, freeText: freeText.trim(), destination });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    // Enter submits, except inside the textarea where it should type a newline —
    // Cmd/Ctrl+Enter is the escape hatch there.
    if (e.key === 'Enter' && (!isFreeText || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const rowStyle = (isSelected) => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
    padding: '9px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: "'EmOne', sans-serif",
    border: `2px solid ${isSelected ? theme.canvas.textPrimary : 'transparent'}`,
    backgroundColor: isSelected
      ? (theme.darkMode ? 'rgba(122, 0, 0, 0.22)' : 'rgba(122, 0, 0, 0.08)')
      : 'transparent',
    transition: 'background-color 0.12s, border-color 0.12s'
  });

  const buttonStyle = (isPrimary, disabled = false) => ({
    padding: '4px 14px',
    lineHeight: 1.2,
    borderRadius: 6,
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    fontFamily: "'EmOne', sans-serif",
    transition: 'all 0.2s',
    border: `2px solid ${theme.canvas.textPrimary}`,
    backgroundColor: isPrimary ? theme.canvas.textPrimary : 'transparent',
    color: isPrimary ? theme.canvas.bg : theme.canvas.textPrimary
  });

  const segmentStyle = (isActive) => ({
    flex: 1,
    padding: '5px 10px',
    fontSize: '0.78rem',
    fontWeight: 600,
    fontFamily: "'EmOne', sans-serif",
    cursor: 'pointer',
    border: 'none',
    borderRadius: 5,
    backgroundColor: isActive ? theme.canvas.textPrimary : 'transparent',
    color: isActive ? theme.canvas.bg : theme.canvas.textPrimary,
    transition: 'background-color 0.15s, color 0.15s'
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Ask The Wizard"
        tabIndex={-1}
        autoFocus
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: 'calc(100vh - 40px)',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.canvas.bg,
          border: `3px solid ${theme.canvas.textPrimary}`,
          borderRadius: 12,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
          fontFamily: "'EmOne', sans-serif",
          overflow: 'hidden',
          outline: 'none'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderBottom: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border
          }}
        >
          <Sparkles size={18} style={{ color: theme.canvas.textPrimary, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: theme.canvas.textPrimary }}>
              Ask The Wizard
            </h2>
            {subjectLabel && (
              <div
                style={{
                  fontSize: '0.78rem',
                  color: theme.canvas.textPrimary,
                  opacity: 0.7,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {subjectLabel}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '10px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {intents.map((intent) => {
            const isSelected = intent.id === selectedId;
            return (
              <React.Fragment key={intent.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(intent.id)}
                  onDoubleClick={submit}
                  style={rowStyle(isSelected)}
                >
                  <span
                    aria-hidden
                    style={{
                      marginTop: 3,
                      width: 12,
                      height: 12,
                      flexShrink: 0,
                      borderRadius: '50%',
                      border: `2px solid ${theme.canvas.textPrimary}`,
                      backgroundColor: isSelected ? '#7A0000' : 'transparent'
                    }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.88rem',
                        fontWeight: 600,
                        color: theme.canvas.textPrimary
                      }}
                    >
                      {intentLabel(intent, facts)}
                    </span>
                    {intent.sublabel && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: '0.76rem',
                          lineHeight: 1.35,
                          marginTop: 1,
                          color: theme.canvas.textPrimary,
                          opacity: 0.65
                        }}
                      >
                        {intent.sublabel}
                      </span>
                    )}
                  </span>
                </button>

                {isSelected && intent.tier === 'freetext' && (
                  <textarea
                    ref={textareaRef}
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder="What do you want to know about it?"
                    rows={3}
                    style={{
                      margin: '2px 12px 8px 34px',
                      padding: '8px 10px',
                      resize: 'vertical',
                      borderRadius: 6,
                      border: `2px solid ${theme.canvas.textPrimary}`,
                      backgroundColor: theme.canvas.bg,
                      color: theme.canvas.textPrimary,
                      fontFamily: "'EmOne', sans-serif",
                      fontSize: '0.85rem',
                      outline: 'none'
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 18px',
            borderTop: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border
          }}
        >
          <div
            role="group"
            aria-label="Where the answer goes"
            style={{
              display: 'flex',
              flex: 1,
              padding: 2,
              gap: 2,
              borderRadius: 7,
              border: `2px solid ${theme.canvas.textPrimary}`
            }}
          >
            <button type="button" style={segmentStyle(destination === 'new')} onClick={() => onDestinationChange('new')}>
              New conversation
            </button>
            <button type="button" style={segmentStyle(destination === 'current')} onClick={() => onDestinationChange('current')}>
              Add to current
            </button>
          </div>
          <button type="button" onClick={onClose} style={buttonStyle(false)}>Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit} style={buttonStyle(true, !canSubmit)}>Ask</button>
        </div>
      </div>
    </div>
  );
};

export default WizardIntentModal;
