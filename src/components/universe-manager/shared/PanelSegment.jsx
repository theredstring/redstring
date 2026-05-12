import React from 'react';
import { useTheme } from '../../../hooks/useTheme';
import StandardDivider from '../../StandardDivider.jsx';

const PanelSegment = ({
  title,
  icon,
  subtitle,
  children,
  actions,
  isSlim = false
}) => {
  const theme = useTheme();

  const hasHeader = Boolean(title || icon || actions);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {hasHeader && (
        <div
          style={{
            display: 'flex',
            flexDirection: isSlim ? 'column' : 'row',
            justifyContent: 'space-between',
            alignItems: isSlim ? 'stretch' : 'center',
            gap: isSlim ? 8 : 0
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: subtitle ? 2 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.canvas.textPrimary }}>
              {icon}
              {title && (
                <div
                  style={{
                    fontFamily: "'EmOne', sans-serif",
                    fontWeight: 'bold',
                    fontSize: '1.1rem'
                  }}
                >
                  {title}
                </div>
              )}
            </div>
            {subtitle && (
              <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary }}>
                {subtitle}
              </div>
            )}
          </div>
          {actions && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {actions}
            </div>
          )}
        </div>
      )}
      {hasHeader && (
        <StandardDivider margin={isSlim ? '8px 0 10px 0' : '10px 0 12px 0'} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  );
};

export default PanelSegment;
