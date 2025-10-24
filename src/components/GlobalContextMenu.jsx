import React, { useState, useEffect } from 'react';
import ContextMenu from './ContextMenu';

// Global context menu manager
let globalContextMenuManager = null;

export const showContextMenu = (x, y, options = []) => {
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

    // Global right-click handler
    const handleGlobalRightClick = (e) => {
      // Check if the right-click happened on an element with context menu handling
      const hasLocalContextMenu = e.target.closest('[data-has-context-menu]');
      
      if (!hasLocalContextMenu) {
        e.preventDefault();
        // If there was already a menu open, just close it instead of showing "No Tools Here..."
        // This prevents the menu from sticking when right-clicking elsewhere
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