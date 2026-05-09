import React, { useState, useEffect } from 'react';
import ContextMenu from './ContextMenu';
import { likelyTouch } from '../utils/inputDeviceAnalysis';

// Global context menu manager
let globalContextMenuManager = null;

export const showContextMenu = (x, y, options = []) => {
  // On touch devices the long-press gesture fires `contextmenu`, but users expect
  // long-press-and-drag to move things — not pop up a menu. Suppress the custom
  // menu entirely on touch; right-click on desktop still works.
  if (likelyTouch()) return;
  if (globalContextMenuManager) {
    globalContextMenuManager.showMenu(x, y, options);
  }
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
      showMenu: (x, y, options) => {
        setContextMenu({ x, y, options });
      },
      hideMenu: () => {
        setContextMenu(null);
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
        setContextMenu(null);
      }
    };

    document.addEventListener('contextmenu', handleGlobalRightClick);

    return () => {
      document.removeEventListener('contextmenu', handleGlobalRightClick);
      globalContextMenuManager = null;
    };
  }, []);

  const handleClose = () => {
    setContextMenu(null);
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