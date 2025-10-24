import React, { useState, useEffect } from 'react';
import { AlertCircle, Info, HelpCircle } from 'lucide-react';

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
  inputField = null // { placeholder: string, defaultValue: string, label: string }
}) => {
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
    danger: '#7A0000',
    warning: '#ef6c00',
    info: '#1565c0',
    default: '#260000'
  };

  const buttonStyle = (isPrimary) => ({
    padding: '10px 20px',
    borderRadius: 6,
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'EmOne', sans-serif",
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    border: isPrimary && variant === 'danger' 
      ? '2px solid #7A0000' 
      : '2px solid #260000',
    backgroundColor: isPrimary 
      ? (variant === 'danger' ? '#7A0000' : '#260000')
      : 'transparent',
    color: isPrimary 
      ? '#bdb5b5'
      : '#260000'
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
          backgroundColor: '#bdb5b5',
          border: '3px solid #260000',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          fontFamily: "'EmOne', sans-serif"
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
            borderBottom: '2px solid #260000',
            backgroundColor: '#979090'
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
              color: '#260000'
            }}
          >
            {title}
          </h2>
        </div>

              {/* Content */}
              <div style={{ padding: '24px' }}>
                <p
                  style={{
                    margin: '0 0 16px 0',
                    fontSize: '0.95rem',
                    lineHeight: 1.6,
                    color: '#260000',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {message}
                </p>

                {inputField && (
                  <div style={{ marginTop: 16, marginBottom: 16 }}>
                    {inputField.label && (
                      <label
                        style={{
                          display: 'block',
                          marginBottom: 8,
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: '#260000'
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
                        padding: '10px 12px',
                        fontSize: '0.9rem',
                        fontFamily: "'EmOne', sans-serif",
                        border: '2px solid #260000',
                        borderRadius: 6,
                        backgroundColor: '#ffffff',
                        color: '#260000',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                )}

                {details && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 12,
                      backgroundColor: '#979090',
                      border: '1px solid #260000',
                      borderRadius: 6,
                      fontSize: '0.85rem',
                      color: '#260000',
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
            gap: 12,
            padding: '16px 24px',
            borderTop: '2px solid #260000',
            backgroundColor: '#979090',
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
                    e.currentTarget.style.backgroundColor = 'rgba(38, 0, 0, 0.1)';
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
                    if (variant === 'danger') {
                      e.currentTarget.style.backgroundColor = '#5A0000';
                    } else {
                      e.currentTarget.style.backgroundColor = '#1a0000';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (inputField && !inputValue.trim()) return;
                    e.currentTarget.style.backgroundColor = variant === 'danger' ? '#7A0000' : '#260000';
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
