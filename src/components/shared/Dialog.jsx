import React, { forwardRef } from 'react';
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
 *   header   canvas.border ground, 2px rule under it, icon + title + subtitle
 *   body     a scroll-fade region that shrinks so the footer cannot be pushed out
 *   footer   canvas.border ground, 2px rule over it, pills right-aligned
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

const Dialog = ({
  isOpen = true,
  /** Click on the scrim. Omit to make the dialog undismissable (a working phase). */
  onScrimClick,
  /** Escape. Defaults to the scrim's handler; pass `null` to refuse Escape too. */
  onEscape,
  ariaLabel,
  icon: IconComponent,
  /** 'accent' paints the header icon maroon — for the dialogs that announce a fault. */
  iconTone = 'accent',
  title,
  /** 'accent' paints the title maroon. Reserve it for a genuine stop sign. */
  titleTone = 'neutral',
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

  const headerColor = titleTone === 'accent' ? theme.accent.secondary : theme.canvas.textPrimary;
  const iconColor = iconTone === 'accent' ? theme.accent.secondary : theme.canvas.textPrimary;

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
              backgroundColor: theme.canvas.border
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              {IconComponent && (
                <IconComponent
                  size={20}
                  style={{ color: iconColor, flexShrink: 0, marginTop: 1 }}
                />
              )}
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {title && (
                  <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: headerColor }}>
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
              backgroundColor: theme.canvas.border
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
  const edgeColor = accented ? theme.accent.secondary : theme.canvas.textPrimary;
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
        overflow: 'hidden',
        cursor: isRadio ? 'pointer' : 'default',
        transition: 'border-color 0.15s ease',
        ...style
      }}
    >
      {(icon || role) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {icon && (
            <span style={{ color: edgeColor, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {icon}
            </span>
          )}
          {role && (
            <span style={{
              fontSize: '0.75rem',
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
