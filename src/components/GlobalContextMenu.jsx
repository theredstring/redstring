import React, { useState, useEffect } from 'react';
import ContextMenu from './ContextMenu';
import { likelyTouch } from '../utils/inputDeviceAnalysis';

// Global context menu manager
let globalContextMenuManager = null;

export const showContextMenu = (x, y, options = [], { force = false, onClose } = {}) => {
  // On touch devices the long-press gesture fires `contextmenu`, but users expect
  // long-press-and-drag to move things — not pop up a menu. Suppress the custom
  // menu entirely on touch; right-click on desktop still works.
  //
  // `force` is for callers that are not a pointer at all — the controller's
  // trigger tap. The suppression is about a gesture CLASH, not about the device:
  // a touchscreen laptop is `likelyTouch()` and is also exactly where a gamepad
  // is plausible, and a trigger tap has nothing to be confused with.
  if (likelyTouch() && !force) return;
  if (globalContextMenuManager) {
    // `onClose` is for a trigger that shows its own open/closed state — a
    // chevron that flips, a button that stays lit. Dismissal is the backdrop's
    // job, so without this the trigger would have no way to learn about it.
    globalContextMenuManager.showMenu(x, y, options, onClose);
  }
};

/**
 * Open the menu anchored to an element — a chevron button, a kebab, a tab —
 * rather than to a cursor. This is how a dropdown becomes a context menu: the
 * card is a fixed overlay, so unlike the absolutely-positioned dropdowns it
 * replaces it is never clipped by the narrow panel that owns the trigger.
 *
 * `align: 'right'` lines the card's right edge up with the trigger's;
 * `prefer: 'above'` flips it over the trigger (for controls near the bottom).
 * Either way it is kept inside the viewport.
 *
 * Forced: a tap on a button is not the long-press gesture the touch
 * suppression in showContextMenu exists to avoid.
 */
/**
 * ContextMenu sizes itself to its content and does no clipping of its own, so
 * every caller that has to do viewport math works off an ESTIMATE of the card
 * (150px min width, ~37px rows). It only has to be good enough to keep the card
 * on screen — or, for the centred case, to look centred.
 */
const estimateCard = (options) => {
  const longest = options.reduce((n, o) => Math.max(n, String(o?.label ?? '').length), 0);
  return {
    width: Math.min(320, Math.max(150, longest * 7.5 + 56)),
    height: options.length * 37 + 8
  };
};

/**
 * Open the menu centred on a point, rather than hanging off it.
 *
 * `showContextMenu` puts the card's top-left CORNER where you point, which is
 * right for a cursor — the menu drops away from the arrow — and wrong for a
 * caller that has no cursor and means "the middle of the screen". Passing the
 * centre there lands the corner on the centre and the card down and to the
 * right of it.
 *
 * @param {number} cx centre point x
 * @param {number} cy centre point y
 */
export const showContextMenuCentered = (cx, cy, options = [], { onClose } = {}) => {
  const { width, height } = estimateCard(options);
  const margin = 8;
  const x = Math.max(margin, Math.min(cx - width / 2, Math.max(margin, window.innerWidth - width - margin)));
  const y = Math.max(margin, Math.min(cy - height / 2, Math.max(margin, window.innerHeight - height - margin)));
  showContextMenu(x, y, options, { force: true, onClose });
};

export const showContextMenuForElement = (el, options = [], { align = 'left', prefer = 'below', gap = 4, onClose } = {}) => {
  if (!el || typeof el.getBoundingClientRect !== 'function') return;
  const rect = el.getBoundingClientRect();
  const { width, height } = estimateCard(options);
  const margin = 8;

  const rawX = align === 'right' ? rect.right - width : rect.left;
  const x = Math.max(margin, Math.min(rawX, Math.max(margin, window.innerWidth - width - margin)));

  const below = rect.bottom + gap;
  const above = rect.top - gap - height;
  const fitsBelow = below + height <= window.innerHeight - margin;
  const fitsAbove = above >= margin;
  let y;
  if (prefer === 'above') {
    y = fitsAbove ? above : (fitsBelow ? below : margin);
  } else {
    y = fitsBelow ? below : (fitsAbove ? above : Math.max(margin, window.innerHeight - height - margin));
  }

  showContextMenu(x, y, options, { force: true, onClose });
};

export const hideContextMenu = () => {
  if (globalContextMenuManager) {
    globalContextMenuManager.hideMenu();
  }
};

const GlobalContextMenu = () => {
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    // Register the global manager
    globalContextMenuManager = {
      showMenu: (x, y, options, onClose) => {
        // One menu at a time: whatever was open is being replaced, so it is
        // closing — its trigger has to hear about that too.
        setContextMenu((prev) => {
          prev?.onClose?.();
          return { x, y, options, onClose };
        });
      },
      hideMenu: () => {
        setContextMenu((prev) => {
          prev?.onClose?.();
          return null;
        });
      }
    };

    // Global right-click / long-press handler
    const handleGlobalRightClick = (e) => {
      const target = e.target;

      // Preserve OS-level context menus on editable text (copy/paste, spellcheck, etc.)
      if (target && target.closest && target.closest('input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) {
        return;
      }

      // Suppress the browser's native context menu everywhere else, including touch
      // long-press. Elements marked data-has-context-menu still receive React's
      // onContextMenu and may open a custom menu via showContextMenu().
      e.preventDefault();

      const hasLocalContextMenu = target && target.closest && target.closest('[data-has-context-menu]');
      if (!hasLocalContextMenu) {
        // Close any open custom menu when right-clicking outside its trigger region
        setContextMenu((prev) => {
          prev?.onClose?.();
          return null;
        });
      }
    };

    document.addEventListener('contextmenu', handleGlobalRightClick);

    return () => {
      document.removeEventListener('contextmenu', handleGlobalRightClick);
      globalContextMenuManager = null;
    };
  }, []);

  const handleClose = () => {
    setContextMenu((prev) => {
      prev?.onClose?.();
      return null;
    });
  };

  const handleSelect = (option) => {
    if (option.action && typeof option.action === 'function') {
      option.action();
    }
  };

  return (
    <>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={contextMenu.options}
          onClose={handleClose}
          onSelect={handleSelect}
        />
      )}
    </>
  );
};

export default GlobalContextMenu;