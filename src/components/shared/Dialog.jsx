import React, { forwardRef, useState } from 'react';
import { useTheme } from '../../hooks/useTheme.js';
import useScrollFade from '../../hooks/useScrollFade.js';
import PanelIconButton from './PanelIconButton.jsx';
import StandardDivider from '../StandardDivider.jsx';
import './Dialog.css';

/**
 * The shell every dialog in the app is built from.
 *
 * Before this, each dialog restated the same scrim, frame, header and footer by
 * hand — and drifted: three scrim opacities, three corner radii, buttons at
 * 0.75–0.85rem in four shapes, and a header icon palette that reached for stock
 * Material orange and blue (#ef6c00, #1565c0) on a surface with exactly one
 * accent in it. Worse, none of them read as the surface the Settings modal had
 * already settled: a canvas-coloured frame, panel-token text, and pills that
 * grow under the cursor the way a pie-menu bubble does.
 *
 * So the language is fixed in one place:
 *
 *   frame    canvas.bg, 3px canvas.textPrimary, 12px corners
 *   header   the band, a 2px rule under it, icon + title + subtitle in one ink
 *   body     a scroll-fade region that shrinks so the footer cannot be pushed out
 *   footer   the band, a 2px rule over it, pills right-aligned
 *
 * Sizing is the WizardIntentModal's, which is the one that had already been
 * worked over for a phone: the SCRIM carries the padding and the frame caps at
 * 100% of it, so there is no vh arithmetic and no guess at a mobile URL bar.
 * #root carries a transform (App.css), so a fixed overlay already measures from
 * inside the safe-area insets.
 */

/**
 * Above the TypeList bar (19999) and its toggle (20000). At the old 10000 the
 * bar sat on top of a dialog and covered its footer whenever it was open.
 */
export const DIALOG_Z_INDEX = 20001;

/** The frame's own corner, restated by the cards that sit inside it. */
const FRAME_RADIUS = 12;

/**
 * The header and footer band.
 *
 * It used to be canvas.border, which is a step DOWN from the canvas in light
 * mode (#979090 under #bdb5b5) and a step of sixty luminance points UP in dark
 * mode (#6a6464 over #2E2A2A) — so the dark dialog wore a pale grey bar top and
 * bottom while the light one wore a quiet recess.
 *
 * Stating the relationship instead of the colour fixes both at once: a band is
 * the surface with a little shadow in it. Over #bdb5b5 this lands on #938D8D,
 * within three points of the light band that was already there; over #2E2A2A it
 * lands just under the surface, which is what the light one does.
 */
const BAND = 'rgba(0, 0, 0, 0.22)';

/**
 * The title line's box, and the icon's, which must be the same number.
 *
 * A header icon aligns to the FIRST LINE of the title, not to the middle of the
 * whole text column — a two-line subtitle under it must not push the icon down
 * past the thing it belongs to. Aligning to a line means matching that line's
 * box, so the line-height is stated rather than left to `normal` (which varies
 * by font and platform) and the icon gets a box of exactly that height to centre
 * itself in.
 */
const TITLE_LINE_HEIGHT = 24;

/** The same arrangement one level down, for a card's role line and its icon. */
const ROLE_LINE_HEIGHT = 16;

/**
 * Brand maroon that has to be READ rather than filled with.
 *
 * accent.secondary (#7A0000) is a fill colour. As text or as an icon on the
 * canvas surface it is nearly invisible in dark mode — the "Newly Picked" label
 * on a dark local-file conflict was maroon-on-near-black. canvas.brandText is
 * the same maroon in light mode and lifts to a warm rose in dark, which is
 * exactly what themeColors.js keeps it for.
 */
const brandInk = (theme) => theme.canvas.brandText;

const Dialog = ({
  isOpen = true,
  /** Click on the scrim. Omit to make the dialog undismissable (a working phase). */
  onScrimClick,
  /** Escape. Defaults to the scrim's handler; pass `null` to refuse Escape too. */
  onEscape,
  ariaLabel,
  icon: IconComponent,
  title,
  /**
   * 'alert' paints the header maroon — for the dialogs that announce a fault.
   *
   * ONE tone for the icon and the title together. They were separate, and
   * defaulted differently, which is how the local-file conflict ended up with a
   * red warning triangle beside a white heading: two colours for one statement.
   */
  tone = 'neutral',
  subtitle,
  /** For a subtitle that names one thing rather than explaining the situation. */
  subtitleTruncate = false,
  /** Sits under a divider at the foot of the header: a modifier on the whole ask. */
  headerExtra,
  /** 'tight' for a body whose children are full-width rows with their own padding. */
  bodyPad = 'normal',
  width = 480,
  children,
  footer,
  /** Extra key handling (WizardIntentModal's Enter-to-submit). Runs after Escape. */
  onKeyDown,
  /**
   * 'light' drops the blur and most of the dim, for the dialogs that ask about
   * something on the canvas — "you dropped this inside that" is unanswerable if
   * answering means remembering what the canvas looked like.
   */
  scrim = 'normal',
  /** Off when something inside the body wants the focus instead (a text field). */
  autoFocus = true,
  bodyStyle,
  className = ''
}) => {
  const theme = useTheme();
  const bodyScroll = useScrollFade();

  if (!isOpen) return null;

  const escapeHandler = onEscape === undefined ? onScrimClick : onEscape;

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && escapeHandler) {
      // Stopped so a dialog's Escape does not also reach the canvas underneath,
      // which reads it as "deselect everything".
      e.stopPropagation();
      escapeHandler(e);
      return;
    }
    onKeyDown?.(e);
  };

  const headerInk = tone === 'alert' ? brandInk(theme) : theme.canvas.textPrimary;

  return (
    <div
      // `modal-dark` is the app's existing signal for "this subtree is on the
      // dark surface" (SettingsModal, HelpModal). There is no global dark class
      // to read, so a dialog declares it the same way, and the .modal-* tokens
      // and the row hover below resolve for anything rendered inside.
      className={`rs-dialog-scrim${theme.darkMode ? ' modal-dark' : ''}`}
      style={{
        position: 'fixed',
        inset: 0,
        boxSizing: 'border-box',
        backgroundColor: scrim === 'light' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.5)',
        ...(scrim === 'light' ? {} : {
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)'
        }),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: DIALOG_Z_INDEX
      }}
      onClick={onScrimClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title}
        tabIndex={-1}
        autoFocus={autoFocus}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={className}
        style={{
          width,
          boxSizing: 'border-box',
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.canvas.bg,
          border: `3px solid ${theme.canvas.textPrimary}`,
          borderRadius: FRAME_RADIUS,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
          fontFamily: "'EmOne', sans-serif",
          overflow: 'hidden',
          outline: 'none'
        }}
      >
        {(title || IconComponent || subtitle || headerExtra) && (
          <div
            className="rs-dialog-header"
            style={{
              flexShrink: 0,
              borderBottom: `2px solid ${theme.canvas.textPrimary}`,
              backgroundColor: BAND
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              {IconComponent && (
                // A box the height of the title's line, with the icon centred in
                // it. `align-items: flex-start` plus a nudge margin was a guess
                // at where that line's middle is, and it sat a pixel or two high.
                <span className="rs-dialog-header-icon" style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: TITLE_LINE_HEIGHT,
                  flexShrink: 0,
                  color: headerInk
                }}>
                  <IconComponent size={18} />
                </span>
              )}
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {title && (
                  <h2 style={{
                    margin: 0,
                    fontSize: '1.05rem',
                    lineHeight: `${TITLE_LINE_HEIGHT}px`,
                    fontWeight: 700,
                    color: headerInk
                  }}>
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <div style={{
                    fontSize: '0.82rem',
                    lineHeight: 1.4,
                    color: theme.canvas.textPrimary,
                    opacity: 0.8,
                    ...(subtitleTruncate ? {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    } : {})
                  }}>
                    {subtitle}
                  </div>
                )}
              </div>
            </div>

            {headerExtra && (
              <>
                <StandardDivider margin="10px 0 8px" />
                {headerExtra}
              </>
            )}
          </div>
        )}

        {/* `flex: 1 1 auto` with the min-height: 0 that .scroll-fade carries is
            what makes the overflow scroll at all — a flex item's automatic
            minimum size is its content, so without it the body holds itself at
            full height and pushes the footer out through the frame's hidden
            overflow. The scrollbar is hidden and the cut edge fades instead, so
            a body that fits looks untouched. */}
        <div
          ref={bodyScroll.ref}
          className={`rs-dialog-body${bodyPad === 'tight' ? ' rs-dialog-body--tight' : ''} ${bodyScroll.className}`}
          style={{
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            ...bodyStyle
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            className="rs-dialog-footer"
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 8,
              borderTop: `2px solid ${theme.canvas.textPrimary}`,
              backgroundColor: BAND
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * A dialog's action pill.
 *
 * Three tones, all of them house colours — there is no second hue in this app to
 * spend on severity, and a destructive action is not colour-coded here anyway.
 * What separates them is weight:
 *
 *   neutral   outlined, for the way out and for the quiet third option
 *   primary   filled in canvas.textPrimary, for "this is the one" (Ask, Done)
 *   accent    filled in the brand maroon, for the choice that commits data
 *
 * The outline tone states its border explicitly rather than taking
 * PanelIconButton's default: that default is a 30%-alpha maroon, which all but
 * disappears against the footer's canvas.border ground. Every pill here carries
 * a visible stroke at rest, and the hover ring is spread after it, so the pie
 * hover still wins under the cursor.
 */
export const DialogButton = forwardRef(({
  label,
  icon,
  tone = 'neutral',
  disabled = false,
  onClick,
  title,
  style,
  className = '',
  ...rest
}, ref) => {
  const theme = useTheme();

  const toneStyle = {
    neutral: { borderColor: theme.canvas.textPrimary },
    primary: {},
    accent: {
      background: theme.canvas.brand,
      backgroundColor: theme.canvas.brand,
      borderColor: theme.canvas.brand
    }
  }[tone] || {};

  return (
    <PanelIconButton
      ref={ref}
      icon={icon}
      label={label}
      labelFontSize={12}
      variant={tone === 'neutral' ? 'outline' : 'solid'}
      // The brand maroon is dark in both themes, so its label is the light one
      // either way rather than canvas.bg, which is #bdb5b5 in light mode.
      color={tone === 'accent' ? '#EFE8E5' : undefined}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={className}
      style={{
        // A phone's minimum comfortable target, which the pill's own 6px of
        // padding does not reach on its own.
        minHeight: 36,
        padding: '7px 16px',
        touchAction: 'manipulation',
        ...toneStyle,
        ...style
      }}
      {...rest}
    />
  );
});

DialogButton.displayName = 'DialogButton';

/**
 * A destination: one full-width option with a line explaining what taking it
 * does. Where a DialogButton is a verb, this is a door.
 *
 * It takes the pie hover's fill and ring but NOT its grow. The grow is a gesture
 * for a shape whose size you can take in at a glance — a bubble, a pill; on a
 * box that already spans the dialog, 1.04 is 20 horizontal pixels of lurch and
 * it collides with whatever is above and below.
 */
export const DialogOption = forwardRef(({
  icon: IconComponent,
  label,
  description,
  /**
   * 'primary' fills it — the ways forward. 'neutral' outlines it in the brand,
   * for a door that is still a door but not the expected one. 'quiet' drops to
   * the plain border and muted text, for the way OUT of the choice.
   */
  tone = 'primary',
  disabled = false,
  onClick,
  title,
  style
}, ref) => {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);

  const active = hovered && !disabled;

  const resting = {
    primary: { background: theme.canvas.brand, borderColor: theme.canvas.brand, color: '#EFE8E5' },
    neutral: { background: 'transparent', borderColor: theme.canvas.brand, color: theme.canvas.brandText },
    quiet: { background: 'transparent', borderColor: theme.canvas.border, color: theme.canvas.textSecondary }
  }[tone] || {};

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onBlur={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        boxSizing: 'border-box',
        padding: '12px 14px',
        border: '1px solid',
        borderRadius: 8,
        textAlign: 'left',
        fontFamily: "'EmOne', sans-serif",
        fontSize: '0.85rem',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        touchAction: 'manipulation',
        transition: 'background-color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, color 0.15s ease',
        ...resting,
        ...(active ? {
          background: '#DEDADA',
          backgroundColor: '#DEDADA',
          borderColor: 'transparent',
          boxShadow: `0 0 0 3px ${theme.accent.primary}`,
          color: theme.accent.primary
        } : {}),
        ...style
      }}
    >
      {IconComponent && <IconComponent size={16} style={{ flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block' }}>{label}</span>
        {description && (
          <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, opacity: 0.9, marginTop: 2 }}>
            {description}
          </span>
        )}
      </span>
    </button>
  );
});

DialogOption.displayName = 'DialogOption';

/**
 * The dialog family's checkbox: a maroon-filling square with a drawn tick.
 *
 * A native checkbox cannot be coloured to match this surface — `accent-color`
 * gets the fill and nothing else — and three dialogs had each drawn their own.
 *
 * `display: flex`, not inline-flex. An inline-flex box takes its baseline from
 * its first flex item, and the box's baseline moves when the tick appears inside
 * it, so the whole row shifted a pixel on every check and uncheck.
 */
export const DialogCheckbox = ({
  checked,
  onChange,
  label,
  description,
  align = 'center',
  disabled = false,
  style
}) => {
  const theme = useTheme();

  return (
    <label
      style={{
        display: 'flex',
        alignItems: align === 'start' ? 'flex-start' : 'center',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        gap: 8,
        lineHeight: align === 'start' ? 1.4 : 1,
        fontSize: '0.78rem',
        color: theme.canvas.textPrimary,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
        ...style
      }}
    >
      <span
        style={{
          position: 'relative',
          width: 16,
          height: 16,
          flexShrink: 0,
          marginTop: align === 'start' ? 1 : 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 3,
          border: `1.5px solid ${theme.canvas.textPrimary}`,
          backgroundColor: checked ? theme.canvas.brand : 'transparent',
          transition: 'background-color 0.15s'
        }}
      >
        <input
          type="checkbox"
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.checked)}
          style={{ position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'inherit' }}
        />
        {checked && (
          <svg
            width="11" height="11" viewBox="0 0 12 12" fill="none"
            stroke="#DEDADA" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
          >
            <polyline points="2.5,6.5 5,9 9.5,3.5" />
          </svg>
        )}
      </span>
      {description ? (
        <span>
          {label}
          <span style={{ display: 'block', fontSize: '0.75rem', color: theme.canvas.textSecondary }}>
            {description}
          </span>
        </span>
      ) : label}
    </label>
  );
};

/**
 * One option inside a dialog whose whole content is a choice between two or
 * three of them: a local file against a git remote, two universes claiming one
 * path, the two sides of a merge.
 *
 * Its action pill spans the card (see Dialog.css) because the card IS the
 * choice. When `onSelect` is given without an `actionLabel` the card itself is
 * the control — a radio — and takes the accent border while chosen.
 */
export const DialogCard = ({
  icon,
  role,
  title,
  meta,
  children,
  /** Fires on the pill, or on the whole card when there is no `actionLabel`. */
  onSelect,
  actionLabel,
  actionTone = 'neutral',
  actionDisabled = false,
  selected = false,
  tone = 'neutral',
  style
}) => {
  const theme = useTheme();
  const accented = tone === 'accent' || selected;
  // One colour for the card's edge, its icon and its role label, so the three
  // read as one mark. It is the brand INK, not accent.secondary: this colour has
  // to be legible as 12px text on the canvas, and the fill maroon is not.
  const edgeColor = accented ? brandInk(theme) : theme.canvas.textPrimary;
  const isRadio = !!onSelect && !actionLabel;

  return (
    <div
      role={isRadio ? 'radio' : undefined}
      aria-checked={isRadio ? selected : undefined}
      tabIndex={isRadio ? 0 : undefined}
      onClick={isRadio ? onSelect : undefined}
      onKeyDown={isRadio ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      } : undefined}
      style={{
        border: `2px solid ${edgeColor}`,
        // One step inside the frame's 12px, so a card never reads as a second
        // frame sitting in the first.
        borderRadius: FRAME_RADIUS - 2,
        backgroundColor: theme.canvas.bg,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        // Deliberately NOT `overflow: hidden`. The pill at the foot of the card
        // spans it, and its hover grows 2% a side plus a 3px ring — on a 520px
        // dialog that is a whisker past the card's 12px of padding, and a hidden
        // overflow clips the ring off the ends. Nothing here needs the clip:
        // every line that truncates carries its own overflow and ellipsis.
        cursor: isRadio ? 'pointer' : 'default',
        transition: 'border-color 0.15s ease',
        ...style
      }}
    >
      {/* Same treatment as the header: the icon gets a box the height of the
          label's line and centres itself in it, rather than relying on the flex
          row's `center` against two differently-sized inline boxes. */}
      {(icon || role) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {icon && (
            <span style={{
              color: edgeColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: ROLE_LINE_HEIGHT,
              flexShrink: 0
            }}>
              {icon}
            </span>
          )}
          {role && (
            <span style={{
              fontSize: '0.75rem',
              lineHeight: `${ROLE_LINE_HEIGHT}px`,
              fontWeight: 700,
              color: edgeColor,
              letterSpacing: '0.04em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {role}
            </span>
          )}
        </div>
      )}

      {title && (
        <div style={{
          fontSize: '0.85rem',
          fontWeight: 600,
          color: theme.canvas.textPrimary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {title}
        </div>
      )}

      {meta && (
        <div style={{ fontSize: '0.78rem', color: theme.canvas.textSecondary, lineHeight: 1.4 }}>
          {meta}
        </div>
      )}

      {children}

      {actionLabel && (
        <DialogButton
          label={actionLabel}
          tone={actionTone}
          disabled={actionDisabled}
          onClick={onSelect}
          className="rs-dialog-card-action"
          style={{ marginTop: 2 }}
        />
      )}
    </div>
  );
};

/**
 * The quiet block a dialog puts its specifics in — what exactly gets deleted,
 * what came through a merge. Outlined rather than filled, so it does not compete
 * with the cards that are actual choices.
 */
export const DialogNote = ({ children, style }) => {
  const theme = useTheme();
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${theme.canvas.border}`,
        fontSize: '0.8rem',
        lineHeight: 1.5,
        color: theme.canvas.textSecondary,
        whiteSpace: 'pre-wrap',
        ...style
      }}
    >
      {children}
    </div>
  );
};

/** The dialog family's text field — the panel's outlined pill, as in Settings. */
export const DialogInput = forwardRef(({ style, ...rest }, ref) => {
  const theme = useTheme();
  return (
    <input
      ref={ref}
      {...rest}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '9px 14px',
        borderRadius: 20,
        border: `1.5px solid ${theme.canvas.textPrimary}`,
        backgroundColor: 'transparent',
        color: theme.canvas.textPrimary,
        fontFamily: "'EmOne', sans-serif",
        fontSize: '0.85rem',
        outline: 'none',
        ...style
      }}
    />
  );
});

DialogInput.displayName = 'DialogInput';

export default Dialog;
