import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import useScrollFade from '../../hooks/useScrollFade.js';
import StandardDivider from '../StandardDivider.jsx';
import { intentsForSurface, defaultIntentForSurface, intentLabel } from '../../wizard/prompts/intents.js';

/**
 * Pick what to ask The Wizard about an element.
 *
 * Replaces four near-identical CanvasConfirmDialog blocks that all asked the same
 * narrow question — new conversation, or add to the current one? That question
 * survives as a single sticky checkbox in the header, because the interesting
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
  const all = useMemo(() => (isOpen ? intentsForSurface(surface, facts) : []), [isOpen, surface, facts]);
  // Free text is not a row in the list — it is the box at the bottom.
  const rows = all.filter(i => i.tier !== 'freetext');
  const freeIntent = all.find(i => i.tier === 'freetext') || null;

  const [selectedId, setSelectedId] = useState(null);
  const [freeText, setFreeText] = useState('');
  const textareaRef = useRef(null);
  const listScroll = useScrollFade();

  // Reset to the default whenever the modal opens on a new element.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedId(defaultIntentForSurface(surface, facts)?.id || null);
    setFreeText('');
  }, [isOpen, surface, facts]);

  if (!isOpen) return null;

  const selected = all.find(i => i.id === selectedId) || null;
  const isFreeText = !!selected && selected.tier === 'freetext';
  // A free-text ask with an empty box has no question in it.
  const canSubmit = !!selected && (!isFreeText || freeText.trim().length > 0);

  const submit = () => {
    if (!canSubmit) return;
    onConfirm({ intent: selected, freeText: freeText.trim(), destination });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    // Enter submits, except inside the box where it should type a newline —
    // Cmd/Ctrl+Enter is the escape hatch there.
    if (e.key === 'Enter' && (!isFreeText || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const selectedTint = theme.darkMode ? 'rgba(122, 0, 0, 0.22)' : 'rgba(122, 0, 0, 0.08)';

  const rowStyle = (isSelected) => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
    // box-sizing is NOT global in this app — App.css sets it on `body` alone — so
    // width:100% plus this padding and border made every row 28px wider than the
    // list that holds it. The list sets overflow-y, which computes overflow-x from
    // `visible` to `auto`, so that overhang showed up as a horizontal scrollbar.
    boxSizing: 'border-box',
    // Rows are the scrolling column's flex items: without this the column
    // squeezes them all to fit instead of letting the list scroll.
    flexShrink: 0,
    padding: '9px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: "'EmOne', sans-serif",
    border: `2px solid ${isSelected ? theme.canvas.textPrimary : 'transparent'}`,
    backgroundColor: isSelected ? selectedTint : 'transparent',
    transition: 'background-color 0.12s, border-color 0.12s'
  });

  const radioStyle = (isSelected) => ({
    marginTop: 3,
    width: 12,
    height: 12,
    flexShrink: 0,
    borderRadius: '50%',
    border: `2px solid ${theme.canvas.textPrimary}`,
    backgroundColor: isSelected ? '#7A0000' : 'transparent'
  });

  const addToCurrent = destination === 'current';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        // #root carries a transform (App.css), so a fixed overlay measures from
        // the app box — already inside the safe-area insets. Padding the BACKDROP
        // and letting the dialog cap at 100% of it therefore beats any vh sum:
        // it needs no notch arithmetic and no guess at a mobile URL bar's height.
        padding: 20,
        boxSizing: 'border-box',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Above the TypeList bar (19999) and its toggle (20000). At 10000 the bar
        // sat on top of the dialog and covered its footer — Ask and Cancel both —
        // whenever the TypeList was open.
        zIndex: 20001
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
          boxSizing: 'border-box',
          maxWidth: '100%',
          maxHeight: '100%',
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
        {/* Header. The destination checkbox rides at its foot as an addendum —
            it is a modifier on the ask, not one of the things being chosen. */}
        <div
          style={{
            flexShrink: 0,
            padding: '14px 18px 10px',
            borderBottom: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

          <StandardDivider margin="10px 0 8px" />

          {/* `display: flex`, not inline-flex. An inline-flex box takes its
              baseline from its first flex item, and the checkbox's baseline moves
              when the tick appears inside it — so the whole row used to jump by a
              pixel or two on every check and uncheck, reading as the padding
              changing. A block-level flex box does not sit on a baseline at all. */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              lineHeight: 1,
              fontSize: '0.78rem',
              color: theme.canvas.textPrimary,
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <span
              style={{
                position: 'relative',
                width: 16,
                height: 16,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 3,
                border: `1.5px solid ${theme.canvas.textPrimary}`,
                backgroundColor: addToCurrent ? '#7A0000' : 'transparent',
                transition: 'background-color 0.15s'
              }}
            >
              <input
                type="checkbox"
                checked={addToCurrent}
                onChange={(e) => onDestinationChange(e.target.checked ? 'current' : 'new')}
                style={{ position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'pointer' }}
              />
              {addToCurrent && (
                <svg
                  width="11" height="11" viewBox="0 0 12 12" fill="none"
                  stroke="#DEDADA" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ pointerEvents: 'none' }}
                >
                  <polyline points="2.5,6.5 5,9 9.5,3.5" />
                </svg>
              )}
            </span>
            Add to current conversation
          </label>
        </div>

        {/* The intents. `flex: 1 1 auto` with min-height 0 (from .scroll-fade) is
            what makes the overflow scroll at all: a flex item's automatic minimum
            size is its content, so this list used to hold itself at full height
            and push the footer out through the dialog's hidden overflow — worst
            on a short window and on mobile, where the header and the checkbox
            have already taken their cut. The scrollbar is hidden and the
            overflowing edge fades instead, so a list that fits looks untouched. */}
        <div
          ref={listScroll.ref}
          className={listScroll.className}
          style={{ flex: '1 1 auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          {rows.map((intent) => {
            const isSelected = intent.id === selectedId;
            return (
              <button
                key={intent.id}
                type="button"
                onClick={() => setSelectedId(intent.id)}
                onDoubleClick={submit}
                style={rowStyle(isSelected)}
              >
                <span aria-hidden style={radioStyle(isSelected)} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.88rem', fontWeight: 600, color: theme.canvas.textPrimary }}>
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
            );
          })}

          {/* "Other" is a box that is always there, not a row you have to find and
              expand. Typing in it is what picks it — nobody types into a field and
              means "but not this one". */}
          {freeIntent && (
            <div
              onClick={() => { setSelectedId(freeIntent.id); textareaRef.current?.focus(); }}
              style={{ ...rowStyle(isFreeText), flexDirection: 'column', gap: 6, cursor: 'text' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden style={{ ...radioStyle(isFreeText), marginTop: 0 }} />
                <span style={{ fontSize: '0.88rem', fontWeight: 600, color: theme.canvas.textPrimary }}>
                  Other
                </span>
              </span>
              <textarea
                ref={textareaRef}
                value={freeText}
                onChange={(e) => { setFreeText(e.target.value); setSelectedId(freeIntent.id); }}
                onFocus={() => setSelectedId(freeIntent.id)}
                placeholder="Ask something specific…"
                rows={2}
                style={{
                  alignSelf: 'stretch',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  padding: '7px 9px',
                  resize: 'vertical',
                  borderRadius: 6,
                  border: `1.5px solid ${theme.canvas.textPrimary}`,
                  backgroundColor: theme.canvas.bg,
                  color: theme.canvas.textPrimary,
                  fontFamily: "'EmOne', sans-serif",
                  fontSize: '0.85rem',
                  outline: 'none'
                }}
              />
            </div>
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '10px 18px',
            borderTop: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border
          }}
        >
          {/* The outline variant's default border is a 30%-alpha maroon, which all
              but disappears against this footer. Matching it to the label colour
              gives Cancel an edge you can actually see next to the solid Ask.
              Hover styles are spread after this, so the pie-hover ring still wins. */}
          <PanelIconButton
            label="Cancel"
            variant="outline"
            labelFontSize={12}
            onClick={onClose}
            style={{ borderColor: theme.canvas.textPrimary }}
          />
          <PanelIconButton
            icon={Sparkles}
            label="Ask"
            variant="solid"
            labelFontSize={12}
            disabled={!canSubmit}
            onClick={submit}
          />
        </div>
      </div>
    </div>
  );
};

export default WizardIntentModal;
