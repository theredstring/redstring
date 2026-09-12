import React, { useState, useEffect } from 'react';
import { AlertTriangle, Info, HelpCircle } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import Dialog, { DialogButton, DialogNote, DialogInput } from './Dialog.jsx';

/**
 * The ordinary yes/no, and the naming prompt that shares its shape.
 *
 * The frame, the pills and the field all come from Dialog.jsx now; what is left
 * here is the question itself and the one rule that makes the input variant
 * work — Confirm stays unavailable until the field has something in it.
 *
 * The icon set lost its stock Material orange and blue. Severity in this app is
 * carried by which icon it is and by whether the confirm pill is filled, not by
 * a hue borrowed from another design system.
 */
const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  onCancel = null, // Optional: custom cancel handler (if not provided, just closes)
  title,
  message,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default', // 'default', 'danger', 'warning', 'info'
  showIcon = true,
  inputField = null, // { placeholder: string, defaultValue: string, label: string }
  // Kept for callers that were passing theme.accent.secondary to mark a
  // destructive ask. Any colour given now means the same thing as tone="alert".
  titleColor = null
}) => {
  const theme = useTheme();
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (isOpen && inputField) {
      setInputValue(inputField.defaultValue || '');
    }
  }, [isOpen, inputField]);

  if (!isOpen) return null;

  const icons = {
    danger: AlertTriangle,
    warning: AlertTriangle,
    error: AlertTriangle,
    info: Info,
    default: HelpCircle
  };

  const isSevere = variant === 'danger' || variant === 'warning' || variant === 'error';
  const blocked = !!inputField && !inputValue.trim();

  const cancel = () => {
    if (onCancel) onCancel();
    onClose();
  };

  const confirm = () => {
    if (blocked) return;
    onConfirm(inputField ? inputValue.trim() : true);
    onClose();
  };

  return (
    <Dialog
      onScrimClick={onClose}
      icon={showIcon ? (icons[variant] || icons.default) : undefined}
      tone={(titleColor || isSevere) ? 'alert' : 'neutral'}
      title={title}
      // The field owns the focus when there is one, so typing can start
      // immediately rather than after a click.
      autoFocus={!inputField}
      footer={
        <>
          <DialogButton label={cancelLabel} onClick={cancel} />
          <DialogButton
            label={confirmLabel}
            tone={isSevere ? 'accent' : 'primary'}
            disabled={blocked}
            onClick={confirm}
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

      {inputField && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {inputField.label && (
            <label
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: theme.canvas.textPrimary
              }}
            >
              {inputField.label}
            </label>
          )}
          <DialogInput
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={inputField.placeholder || ''}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
              }
            }}
          />
        </div>
      )}

      {details && <DialogNote>{details}</DialogNote>}
    </Dialog>
  );
};

export default ConfirmDialog;
