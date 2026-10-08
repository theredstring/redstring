import { forwardRef } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { getTextColor } from '../../utils/colorUtils';
import { useTheme } from '../../hooks/useTheme.js';
import { sanitizeColor } from '../../utils/safeColor.js';

/**
 * Below this list width a connection row drops the triplet for this compact
 * form. Every right-panel connection list switches at the same width.
 */
export const COMPACT_CONNECTIONS_BELOW = 340;

/** A Thing at one end, whole: wraps between words, never inside one. */
const Pill = forwardRef(({ name, color, style, ...handlers }, ref) => {
  const theme = useTheme();
  return (
    <span ref={ref} {...handlers} style={{
      alignSelf: 'flex-start',
      maxWidth: '100%',
      background: sanitizeColor(color, '#8B0000'),
      color: getTextColor(color, theme.darkMode),
      borderRadius: '10px',
      padding: '5px 10px 4px',
      fontSize: '13px',
      fontWeight: 'bold',
      fontFamily: "'EmOne', sans-serif",
      lineHeight: 1.2,
      overflowWrap: 'normal',
      wordBreak: 'normal',
      hyphens: 'none',
      overflow: 'hidden',
      ...style
    }}>
      {name}
    </span>
  );
});
Pill.displayName = 'CompactConnectionPill';

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
 * @param {string} [props.subjectName] - where no Thing is implied (a Wizard
 *   card's connection), the near end, drawn as a pill above the connection;
 *   `direction` is then relative to it
 * @param {string} [props.subjectColor]
 * @param {{ref?:Function, style?:Object}} [props.subjectPill] - for a caller
 *   that makes an end draggable or openable (wizard/EntityRows.jsx); any other
 *   keys are handlers for the pill; `otherPill` likewise
 * @param {{ref?:Function, style?:Object}} [props.otherPill]
 * @param {{color:string, ref?:Function, style?:Object}} [props.predicatePill] -
 *   draw the connection as a Thing too (its defining Thing's colour), the
 *   arrow after its name, between the two ends: three Things down the row
 */
const CompactConnectionRow = ({
  predicate, direction = 'out', otherName, otherColor, note, subjectName, subjectColor, subjectPill, otherPill, predicatePill
}) => {
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
      {subjectName != null && <Pill name={subjectName} color={subjectColor} {...subjectPill} />}
      {predicatePill ? (
        <Pill
          {...predicatePill}
          name={(
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              {points && <ArrowLeft size={12} style={{ flexShrink: 0 }} />}
              {predicate}
              {leads && <ArrowRight size={12} style={{ flexShrink: 0 }} />}
            </span>
          )}
        />
      ) : (
        <span style={{ ...small, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {points && <ArrowLeft size={11} style={{ flexShrink: 0 }} />}
          {predicate}
          {leads && <ArrowRight size={11} style={{ flexShrink: 0 }} />}
        </span>
      )}
      <Pill name={otherName} color={otherColor} {...otherPill} />
      {note && <span style={small}>{note}</span>}
    </div>
  );
};

export default CompactConnectionRow;
