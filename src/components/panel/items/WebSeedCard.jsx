import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { getTextColor, getLightHueText, getDarkHueText } from '../../../utils/colorUtils';
import { useTheme } from '../../../hooks/useTheme.js';
import { sanitizeColor } from '../../../utils/safeColor.js';
import PanelIconButton from '../../shared/PanelIconButton.jsx';

// Same round hit area as the result cards' actions.
const HIT = 36;

/**
 * A Thing already on the active web, offered in Discover before there are any
 * results. It wears the result card's clothes (its own colour, name,
 * description) so the empty list reads as a list of starting points, and
 * clicking it searches the semantic web for it.
 */
const WebSeedCard = ({ prototype, index = 0, onSearch }) => {
  const theme = useTheme();
  const color = sanitizeColor(prototype.color, '#8B0000');
  const ink = getTextColor(color, theme.darkMode);
  const ring = theme.darkMode ? getLightHueText(color) : getDarkHueText(color);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 6px 10px 12px',
        background: color,
        borderRadius: '12px',
        border: `1px solid ${theme.darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
        cursor: 'pointer',
        scale: hovered ? '1.02' : '1',
        transition: 'box-shadow 0.15s ease, scale 0.15s ease',
        boxShadow: hovered
          ? `0 0 0 3px ${ring}, 0 4px 10px rgba(0,0,0,0.2)`
          : '0 2px 4px rgba(0,0,0,0.15)',
        userSelect: 'none',
        animation: `conceptSlideIn 0.3s ease ${index * 50}ms both`
      }}
      title={`Search the semantic web for "${prototype.name}"`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSearch(prototype.name, prototype.id)}
    >
      <div style={{ flex: 1, minWidth: 0, color: ink, fontFamily: "'EmOne', sans-serif" }}>
        <div style={{
          fontSize: '16px',
          fontWeight: 'bold',
          lineHeight: 1.3,
          overflowWrap: 'anywhere',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical'
        }}>
          {prototype.name}
        </div>

        {prototype.description && (
          <div style={{
            fontSize: '11px',
            lineHeight: 1.4,
            opacity: 0.9,
            marginTop: '4px',
            overflowWrap: 'anywhere',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical'
          }}>
            {prototype.description}
          </div>
        )}
      </div>

      <PanelIconButton
        icon={Search}
        size={18}
        color={ink}
        style={{ width: HIT, height: HIT, padding: 0, flexShrink: 0 }}
        onClick={(e) => { e.stopPropagation(); onSearch(prototype.name); }}
        title={`Search the semantic web for "${prototype.name}"`}
      />
    </div>
  );
};

export default WebSeedCard;
