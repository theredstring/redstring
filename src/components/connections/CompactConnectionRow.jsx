import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { getTextColor } from '../../utils/colorUtils';
import { useTheme } from '../../hooks/useTheme.js';
import { sanitizeColor } from '../../utils/safeColor.js';

/**
 * Below this list width a connection row drops the triplet for this compact
 * form. Every right-panel connection list switches at the same width.
 */
export const COMPACT_CONNECTIONS_BELOW = 340;

/**
 * A connection too narrow for a readable triplet: the Thing the list is about
 * is implied, so the row is the connection — its name, and an arrow saying
 * which way it points — over the other end, whole.
 *
 * @param {Object} props
 * @param {string} props.predicate
 * @param {'out'|'in'|'both'|'none'} props.direction - relative to the list's
 *   own Thing: 'out' points at the other end, 'in' points back from it
 * @param {string} props.otherName
 * @param {string} props.otherColor
 * @param {string} [props.note] - a quiet line after the name (e.g. which Web)
 */
const CompactConnectionRow = ({ predicate, direction = 'out', otherName, otherColor, note }) => {
  const theme = useTheme();
  const small = {
    fontSize: '11px',
    fontFamily: "'EmOne', sans-serif",
    color: theme.canvas.textSecondary,
    lineHeight: 1.4
  };
  const points = direction === 'in' || direction === 'both';
  const leads = direction === 'out' || direction === 'both';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
      <span style={{ ...small, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {points && <ArrowLeft size={11} style={{ flexShrink: 0 }} />}
        {predicate}
        {leads && <ArrowRight size={11} style={{ flexShrink: 0 }} />}
      </span>
      <span style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        background: sanitizeColor(otherColor, '#8B0000'),
        color: getTextColor(otherColor, theme.darkMode),
        borderRadius: '10px',
        padding: '5px 10px 4px',
        fontSize: '13px',
        fontWeight: 'bold',
        fontFamily: "'EmOne', sans-serif",
        lineHeight: 1.2,
        // Wraps between words only; never inside one.
        overflowWrap: 'normal',
        wordBreak: 'normal',
        hyphens: 'none',
        overflow: 'hidden'
      }}>
        {otherName}
      </span>
      {note && <span style={small}>{note}</span>}
    </div>
  );
};

export default CompactConnectionRow;
