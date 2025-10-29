import React from 'react';

/**
 * Reusable section card container
 * Provides consistent styling for all git federation sections
 */
const SectionCard = ({
  title,
  icon,
  subtitle,
  children,
  actions,
  backgroundColor = '#979090',
  padding = 16,
  isSlim = false
}) => {
  return (
    <div
      style={{
        backgroundColor,
        borderRadius: 8,
        padding,
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}
    >
      {(title || icon || actions) && (
        <div style={{
          display: 'flex',
          flexDirection: isSlim ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isSlim ? 'stretch' : 'center',
          gap: isSlim ? 10 : 0
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {icon}
              {title && <div style={{ fontWeight: 700, fontSize: '1rem' }}>{title}</div>}
            </div>
            {subtitle && <div style={{ fontSize: '0.75rem', color: '#444', marginTop: 4 }}>{subtitle}</div>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
};

export default SectionCard;
