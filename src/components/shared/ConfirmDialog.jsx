import React, { useState, useEffect } from 'react';
import { AlertCircle, Info, HelpCircle } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

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
  titleColor = null // Optional: override title text color (e.g. theme.accent.secondary)
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
    danger: <AlertCircle size={24} />,
    warning: <AlertCircle size={24} />,
    info: <Info size={24} />,
    default: <HelpCircle size={24} />
  };

  const iconColors = {
    danger: theme.accent.secondary,
    warning: '#ef6c00',
    info: '#1565c0',
    default: theme.canvas.textPrimary
  };

  const buttonStyle = (isPrimary) => ({
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'EmOne', sans-serif",
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    border: `2px solid ${theme.accent.secondary}`,
    backgroundColor: isPrimary
      ? theme.accent.secondary
      : 'transparent',
    color: isPrimary
      ? (theme.darkMode ? theme.canvas.textPrimary : '#EFE8E5')
      : theme.accent.secondary
  });

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
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(95vw, 480px)',
          maxHeight: '85vh',
          backgroundColor: theme.canvas.bg,
          border: `3px solid ${theme.canvas.textPrimary}`,
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          fontFamily: "'EmOne', sans-serif",
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
            padding: '20px 24px',
            borderBottom: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border
          }}
        >
          {showIcon && (
            <div style={{ color: iconColors[variant], flexShrink: 0 }}>
              {icons[variant]}
            </div>
          )}
          <h2
            style={{
              margin: 0,
              fontSize: '1.2rem',
              fontWeight: 700,
              color: titleColor || theme.canvas.textPrimary
            }}
          >
            {title}
          </h2>
        </div>

              {/* Content */}
              <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
                <p
                  style={{
                    margin: '0 0 12px 0',
                    fontSize: '0.9rem',
                    lineHeight: 1.5,
                    color: theme.canvas.textPrimary,
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {message}
                </p>

                {inputField && (
                  <div style={{ marginTop: 12, marginBottom: 12 }}>
                    {inputField.label && (
                      <label
                        style={{
                          display: 'block',
                          marginBottom: 6,
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          color: theme.canvas.textPrimary
                        }}
                      >
                        {inputField.label}
                      </label>
                    )}
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder={inputField.placeholder || ''}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && inputValue.trim()) {
                          onConfirm(inputValue.trim());
                          onClose();
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: '0.85rem',
                        fontFamily: "'EmOne', sans-serif",
                        border: `2px solid ${theme.canvas.textPrimary}`,
                        borderRadius: 6,
                        backgroundColor: theme.darkMode ? theme.canvas.hover : '#ffffff',
                        color: theme.canvas.textPrimary,
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                )}

                {details && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 10,
                      backgroundColor: theme.canvas.border,
                      border: `1px solid ${theme.canvas.textPrimary}`,
                      borderRadius: 6,
                      fontSize: '0.8rem',
                      lineHeight: 1.4,
                      color: theme.canvas.textPrimary,
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {details}
                  </div>
                )}
              </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '12px 20px',
            borderTop: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border,
            justifyContent: 'flex-end'
          }}
        >
                <button
                  onClick={() => {
                    if (onCancel) {
                      onCancel();
                    }
                    onClose();
                  }}
                  style={buttonStyle(false)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(122, 0, 0, 0.2)' : 'rgba(122, 0, 0, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={() => {
                    const result = inputField ? inputValue.trim() : true;
                    if (inputField && !result) return; // Require input if field is present
                    onConfirm(result);
                    onClose();
                  }}
                  disabled={inputField && !inputValue.trim()}
                  style={{
                    ...buttonStyle(true),
                    opacity: (inputField && !inputValue.trim()) ? 0.5 : 1,
                    cursor: (inputField && !inputValue.trim()) ? 'not-allowed' : 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    if (inputField && !inputValue.trim()) return;
                    e.currentTarget.style.backgroundColor = '#5A0000';
                  }}
                  onMouseLeave={(e) => {
                    if (inputField && !inputValue.trim()) return;
                    e.currentTarget.style.backgroundColor = theme.accent.secondary;
                  }}
                >
                  {confirmLabel}
                </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
