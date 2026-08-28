import React, { useMemo } from 'react';
import { useTheme } from '../../hooks/useTheme.js';

const FONT = "'EmOne', sans-serif";

/**
 * Theme-derived tokens for the panel's inner cards.
 *
 * Everything here used to be hardcoded to the light palette (#260000 text on a
 * rgba(38,0,0,0.03) card, #8B0000 labels), which left whole sections unreadable
 * in dark mode. `canvas.brandText` is the one to reach for on labels: it *is*
 * the brand maroon in light mode and lifts to a warm rose on dark, where the
 * maroon disappears into the background.
 */
export const usePanelCardTokens = () => {
  const theme = useTheme();
  return useMemo(() => ({
    theme,
    text: theme.canvas.textPrimary,
    muted: theme.canvas.textSecondary,
    brand: theme.canvas.brandText,
    border: theme.canvas.border,
    // Card fill and hairline: a tint of the text colour, so it reads as a
    // recessed surface in either mode rather than a fixed grey.
    surface: theme.darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(38,0,0,0.03)',
    hairline: theme.darkMode ? 'rgba(255,255,255,0.10)' : 'rgba(38,0,0,0.10)',
    danger: theme.alert.error.text
  }), [theme]);
};

/**
 * A sub-section of a right-panel section: a card that groups one kind of
 * statement about the node.
 *
 * The card is what separates these from each other, so no dividers between
 * them. StandardDivider is the panel's rule for splitting top-level sections
 * and is drawn in full text colour; using it here put a heavy black line
 * between things that sit *inside* one section, flattening the hierarchy it was
 * meant to express.
 *
 * Two things an earlier version of this card got wrong and this doesn't: the
 * 3px maroon rule down the left edge, a container style used nowhere else in
 * Redstring; and `overflow: hidden`, which clipped a dropdown's menu at the
 * card's bottom edge. The title is also a step smaller than the enclosing
 * section heading, so the nesting is legible.
 *
 * Lives in shared/ because both Semantic Web and About are built from it, and
 * the two sections sitting in the same container language is the point.
 */
/**
 * `compact` is the low-width form: the same card with less of itself.
 *
 * Only the padding changes, which is the part that costs content width rather
 * than the part that says what the card is. 12px a side is 24px of the ~40px a
 * panel dragged to its minimum has left over; giving 6 of them back is the
 * difference between an identifier row that can show its id and one that can't.
 */
const PanelCard = ({ title, icon: Icon, rightEl = null, compact = false, children, style = {} }) => {
  const tokens = usePanelCardTokens();
  return (
    <div
      style={{
        border: `1px solid ${tokens.hairline}`,
        background: tokens.surface,
        borderRadius: '8px',
        padding: compact ? '9px' : '12px',
        marginBottom: '10px',
        ...style
      }}
    >
      {(title || rightEl) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 10 }}>
          {/* The title gives way before the info button does. The button is the
              only way to find out what the card is for, so it survives every
              width; the heading it explains can afford to be clipped. */}
          {title ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, color: tokens.text }}>
              {Icon && <Icon size={15} style={{ flexShrink: 0 }} />}
              <div style={{
                fontFamily: FONT,
                fontSize: '0.9rem',
                fontWeight: 'bold',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {title}
              </div>
            </div>
          ) : <span />}
          {rightEl && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{rightEl}</span>}
        </div>
      )}
      {children}
    </div>
  );
};

export default PanelCard;
