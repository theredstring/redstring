import React from 'react';
import { AlertTriangle, Info, HelpCircle } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import Dialog, { DialogButton, DialogCheckbox } from './Dialog.jsx';

/**
 * The lighter ask that comes out of a canvas gesture — "you dropped this inside
 * a group, did you mean to?" — with room for a third option and for the
 * don't-ask-again that a gesture-triggered question earns.
 *
 * It is narrower than ConfirmDialog and carries no details block: it interrupts
 * a drag, so it has to be readable in the time it takes to let go of the mouse.
 * Everything else — frame, pills, checkbox — is the shared dialog language.
 *
 * `containerRect` is still required, and is still the caller's signal that the
 * canvas is actually mounted; the dialog centres on the viewport either way, as
 * it already did.
 */
const CanvasConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  onCancel = null,
  onSecondaryConfirm = null,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  secondaryConfirmLabel = null,
  variant = 'default', // 'default', 'danger', 'warning', 'info'
  showIcon = true,
  // Accepted and unused: callers hand over the canvas geometry they were
  // positioning against before this centred on the viewport.
  position = { x: 0, y: 0 },
  containerRect = null,
  panOffset = { x: 0, y: 0 },
  zoomLevel = 1,
  showDontAskAgain = false,
  dontAskAgainChecked = false,
  onDontAskAgainChange = null,
  dontAskAgainLabel = "Don't ask me again"
}) => {
  const theme = useTheme();
  if (!isOpen || !containerRect) return null;

  const icons = {
    danger: AlertTriangle,
    warning: AlertTriangle,
    info: Info,
    default: HelpCircle
  };

  const isSevere = variant === 'danger' || variant === 'warning';

  return (
    <Dialog
      width={400}
      scrim="light"
      onScrimClick={onClose}
      icon={showIcon ? (icons[variant] || icons.default) : undefined}
      tone={isSevere ? 'alert' : 'neutral'}
      title={title}
      footer={
        <>
          <DialogButton
            label={cancelLabel}
            onClick={() => {
              if (onCancel) onCancel();
              onClose();
            }}
          />
          {secondaryConfirmLabel && onSecondaryConfirm && (
            <DialogButton
              label={secondaryConfirmLabel}
              onClick={() => {
                onSecondaryConfirm();
                onClose();
              }}
            />
          )}
          <DialogButton
            label={confirmLabel}
            tone={isSevere ? 'accent' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          />
        </>
      }
    >
      <p
        style={{
          margin: 0,
          fontSize: '0.9rem',
          lineHeight: 1.5,
          color: theme.canvas.textPrimary,
          whiteSpace: 'pre-wrap'
        }}
      >
        {message}
      </p>

      {/* Ending the question rather than joining the buttons: it modifies
          whether this dialog comes back, not which way this one is answered. */}
      {showDontAskAgain && (
        <DialogCheckbox
          checked={dontAskAgainChecked}
          onChange={(next) => onDontAskAgainChange?.(next)}
          label={dontAskAgainLabel}
          align="start"
          style={{ marginTop: 2 }}
        />
      )}
    </Dialog>
  );
};

export default CanvasConfirmDialog;
