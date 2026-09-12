import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import Dialog, { DialogButton, DialogCheckbox } from '../shared/Dialog.jsx';
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
 *
 * The frame, the pills, the checkbox and the scrolling body are Dialog.jsx's —
 * this modal was where that language was worked out, and it now reads it back
 * from the shared shell instead of keeping its own copy.
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

  // Escape is the shell's. Enter submits, except inside the box where it should
  // type a newline — Cmd/Ctrl+Enter is the escape hatch there.
  const onKeyDown = (e) => {
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
    backgroundColor: isSelected ? theme.canvas.brand : 'transparent'
  });

  /** Pairs with .rs-dialog-row in Dialog.css, which owns the hover tint. */
  const rowClass = (isSelected) => `rs-dialog-row${isSelected ? ' is-selected' : ''}`;

  const addToCurrent = destination === 'current';

  return (
    <Dialog
      width={420}
      ariaLabel="Ask The Wizard"
      onScrimClick={onClose}
      onKeyDown={onKeyDown}
      icon={Sparkles}
      title="Ask The Wizard"
      subtitle={subjectLabel}
      subtitleTruncate
      // The destination checkbox rides at the foot of the header as an
      // addendum — it is a modifier on the ask, not one of the things chosen.
      headerExtra={
        <DialogCheckbox
          checked={addToCurrent}
          onChange={(next) => onDestinationChange(next ? 'current' : 'new')}
          label="Add to current conversation"
        />
      }
      bodyPad="tight"
      bodyStyle={{ gap: 2 }}
      footer={
        <>
          <DialogButton label="Cancel" onClick={onClose} />
          <DialogButton icon={Sparkles} label="Ask" tone="primary" disabled={!canSubmit} onClick={submit} />
        </>
      }
    >
      {rows.map((intent) => {
        const isSelected = intent.id === selectedId;
        return (
          <button
            key={intent.id}
            type="button"
            onClick={() => setSelectedId(intent.id)}
            onDoubleClick={submit}
            className={rowClass(isSelected)}
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
          className={rowClass(isFreeText)}
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
    </Dialog>
  );
};

export default WizardIntentModal;
