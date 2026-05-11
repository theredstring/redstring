import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';
import { getStatusColor } from '../utils/statusColors.js';

const DEFAULT_ICONS = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle
};

const StatusBanner = ({
  tone = 'info',
  title,
  message,
  icon,
  action,
  onDismiss,
  style
}) => {
  const theme = useTheme();
  const toneColor = getStatusColor(tone, theme.darkMode);
  const Icon = icon || DEFAULT_ICONS[tone] || Info;
  const padding = title ? 14 : 12;

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${toneColor}`,
        backgroundColor: theme.canvas.bg,
        padding,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        ...style
      }}
    >
      <Icon
        size={16}
        color={toneColor}
        style={{ flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div
            style={{
              fontWeight: 700,
              color: theme.canvas.textPrimary,
              fontSize: '0.85rem',
              lineHeight: 1.3
            }}
          >
            {title}
          </div>
        )}
        {message && (
          <div
            style={{
              fontSize: '0.8rem',
              color: title ? theme.canvas.textSecondary : theme.canvas.textPrimary,
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              lineHeight: 1.4,
              marginTop: title ? 2 : 0
            }}
          >
            {message}
          </div>
        )}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            style={{
              marginTop: title || message ? 8 : 0,
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: toneColor,
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 2
            }}
          >
            {action.label}
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            marginLeft: 'auto',
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: toneColor,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
};

export default StatusBanner;
