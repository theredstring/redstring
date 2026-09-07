import React, { useState, useEffect, useRef, useMemo } from 'react';
import MaroonSlider from './components/MaroonSlider.jsx';
import { ChevronRight, FileText, FolderOpen, Save, Clock, Globe, BookOpen, Home, LayoutGrid, Activity, RefreshCw, Undo2, Redo2, Settings, GitMerge, Move, Moon, Maximize, ZoomIn, Tag, Grid3x3, Keyboard, Type, Minus, CornerDownRight, Spline, Circle, MonitorDown, Link as LinkIcon } from 'lucide-react';
import './RedstringMenu.css';
import { canOfferDesktopDownload, openDesktopDownload } from './utils/desktopDownload.js';
import * as fileStorage from './store/fileStorage.js';
import useHistoryStore from './store/historyStore.js';
import { performUndo, performRedo } from './store/historyActions.js';
import useGraphStore from './store/graphStore.js';

const RedstringMenu = ({
  isOpen,
  onHoverView,
  trackpadZoomEnabled,
  onToggleTrackpadZoom,
  isFullscreen,
  onToggleFullscreen,
  showConnectionNames,
  onToggleShowConnectionNames,
  darkMode,
  onToggleDarkMode,
  // Connections visualization controls
  enableAutoRouting,
  routingStyle,
  manhattanBends,
  onToggleEnableAutoRouting,
  onSetRoutingStyle,
  onSetManhattanBends,
  // Grid controls
  gridMode,
  onSetGridMode,
  gridSize,
  onSetGridSize,
  gridAppearance,
  onSetGridAppearance,
  // Drag zoom controls
  dragZoomEnabled,
  dragZoomAmount,
  onToggleDragZoom,
  onSetDragZoomAmount,
  // Universe management actions
  onNewUniverse,
  onOpenUniverse,
  onSaveUniverse,
  onExportRedstring,
  onExportJson,
  onExportRdf,
  onExportTrig,
  onExportTtl,
  onExportTxt,
  onOpenRecentFile,
  onLoadWikidataCatalog,
  onLoadFromExternalLink,
  onOpenForceSim,
  onAutoLayoutGraph,
  onSnapToGrid,
  onCondenseNodes
}) => {
  // Subscribed, not read via getState() during render — otherwise the greyed-out
  // state of Undo/Redo never refreshes as history changes.
  const canUndo = useHistoryStore(s => s.history.length + s.currentIndex >= 0);
  const canRedo = useHistoryStore(s => s.currentIndex < -1);

  const [isExiting, setIsExiting] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [activeTopLevelMenu, setActiveTopLevelMenu] = useState(null); // Only ONE top-level menu open at a time
  const [activeNestedSubmenu, setActiveNestedSubmenu] = useState(null); // Nested submenu within the top-level
  const [isInteracting, setIsInteracting] = useState(false); // Guard to keep submenu open during slider drag
  const [recentFiles, setRecentFiles] = useState([]);
  // Track timeout for nested submenu closing only
  const nestedCloseTimeoutRef = useRef(null);
  // Same gate the canvas pill uses: a plain desktop browser only.
  const showDownload = useMemo(() => canOfferDesktopDownload(), []);
  // Debug used to be a top-level menu here. It is a Settings page now — one
  // surface for the switches, and one that works on a phone.
  const menuItems = [...(showDownload ? ['Download'] : []), 'File', 'Edit', 'View', 'Connections', 'Help'];
  const menuRef = useRef(null);

  const topLevelMenus = ['File', 'Edit', 'View', 'Connections', 'Help'];

  // Helper functions for menu management
  const openTopLevelMenu = (name) => {
    // Immediately switch to new top-level menu (no delay)
    setActiveTopLevelMenu(name);
    // Close any nested submenus when switching top-level
    setActiveNestedSubmenu(null);
    cancelNestedCloseTimeout();
  };

  const openNestedSubmenu = (name) => {
    // Cancel any pending close
    cancelNestedCloseTimeout();
    setActiveNestedSubmenu(name);
  };

  const closeNestedSubmenu = () => {
    setActiveNestedSubmenu(null);
  };

  const closeAllMenus = () => {
    cancelNestedCloseTimeout();
    setActiveTopLevelMenu(null);
    setActiveNestedSubmenu(null);
  };

  const scheduleNestedClose = (delay = 600) => {
    // Clear any existing timeout
    cancelNestedCloseTimeout();

    console.log('[RedstringMenu] Scheduling nested close in', delay, 'ms');
    // Schedule the close for nested submenu
    nestedCloseTimeoutRef.current = setTimeout(() => {
      console.log('[RedstringMenu] Executing nested close');
      closeNestedSubmenu();
      nestedCloseTimeoutRef.current = null;
    }, delay);
  };

  const cancelNestedCloseTimeout = () => {
    if (nestedCloseTimeoutRef.current) {
      console.log('[RedstringMenu] Canceling nested close timeout');
      clearTimeout(nestedCloseTimeoutRef.current);
      nestedCloseTimeoutRef.current = null;
    }
  };

  const isTopLevelMenuOpen = (name) => activeTopLevelMenu === name;
  const isNestedSubmenuOpen = (name) => activeNestedSubmenu === name;

  useEffect(() => {
    if (isOpen) {
      setIsExiting(false);
      setShouldRender(true);

      // Load recent files when menu opens
      loadRecentFiles();
    } else {
      setIsExiting(true);
      closeAllMenus(); // Close all menus and clear all timeouts

      // Wait for animation to complete before removing from DOM
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 150); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle clicks outside the menu
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpen && menuRef.current && !menuRef.current.contains(event.target)) {
        // Check if the click is not on any submenu or its children
        const isSubmenuClick = event.target.closest('.submenu-container') ||
          event.target.closest('.recent-files-submenu');

        // Check if the click is on the Universe Operations Dialog
        const isUniverseDialogClick = event.target.closest('.universe-operations-overlay') ||
          event.target.closest('.universe-operations-dialog');

        if (!isSubmenuClick && !isUniverseDialogClick) {
          onHoverView?.(false); // Close the menu
        }
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, onHoverView]);

  // Debug effect to log submenu state changes
  useEffect(() => {
    // console.log('[RedstringMenu Frontend] Active top-level:', activeTopLevelMenu, 'Nested:', activeNestedSubmenu);
  }, [activeTopLevelMenu, activeNestedSubmenu]);

  const loadRecentFiles = async () => {
    try {
      const { getRecentFiles } = fileStorage;
      const files = await getRecentFiles();
      // console.log('[RedstringMenu Frontend] Recent files loaded, count:', files.length);
      setRecentFiles(files);
    } catch (error) {
      console.error('[RedstringMenu Frontend] Error loading recent files:', error);
      setRecentFiles([]);
    }
  };

  // shouldRender is now handled in JSX to keep Universe Dialog independent

  const handleTopLevelMenuHover = (menuName) => {
    // Immediately switch to this top-level menu (no delay)
    // console.log('[RedstringMenu Frontend] Opening top-level menu:', menuName);
    openTopLevelMenu(menuName);
  };

  const handleTopLevelMenuLeave = () => {
    // Top-level menus don't close on leave - they switch immediately on hover of another item
    // Only close if interacting with slider
    if (isInteracting) {
      return;
    }
  };

  const handleTopLevelSubmenuEnter = () => {
    // Keep the top-level submenu open, no action needed
  };

  const handleRegularSubmenuItemHover = () => {
    // When hovering a regular (non-nested) submenu item, immediately close any nested submenus
    // This prevents delay when switching between items at the same level
    if (activeNestedSubmenu) {
      cancelNestedCloseTimeout();
      closeNestedSubmenu();
    }
  };

  const handleNestedSubmenuItemHover = (nestedName) => {
    // When switching to a different nested submenu at same level, immediately switch
    if (activeNestedSubmenu && activeNestedSubmenu !== nestedName) {
      cancelNestedCloseTimeout();
    }
    // Open the nested submenu and cancel any pending close
    // console.log('[RedstringMenu Frontend] Opening nested submenu:', nestedName);
    openNestedSubmenu(nestedName);
  };

  const handleNestedSubmenuItemLeave = () => {
    if (isInteracting) {
      return;
    }
    // Schedule close for nested submenu with 600ms delay
    console.log('[RedstringMenu Frontend] Scheduling nested submenu close');
    scheduleNestedClose(600);
  };

  const handleNestedSubmenuEnter = () => {
    // Cancel any pending close when entering the nested submenu container
    console.log('[RedstringMenu Frontend] Entering nested submenu, canceling close timer');
    cancelNestedCloseTimeout();
  };

  return (
    <>
      {shouldRender && (
        <div ref={menuRef} className={`menu-container ${isExiting ? 'exiting' : 'entering'}`}>
          <div className="menu-items">
            {menuItems.map((item, index) => {
              if (item === 'Download') {
                // Leaf action, not a menu: no submenu, and hovering it dismisses
                // whichever top-level submenu is currently open so it doesn't
                // hang open alongside an item that has none.
                return (
                  <button
                    key={index}
                    className="menu-item"
                    onMouseEnter={closeAllMenus}
                    onClick={() => {
                      openDesktopDownload();
                      onHoverView?.(false);
                    }}
                  >
                    <span>{item}</span>
                    <MonitorDown size={16} className="menu-item-chevron" />
                  </button>
                );
              } else if (item === 'File') {
                return (
                  <div
                    key={index}
                    onMouseEnter={() => handleTopLevelMenuHover('File')}
                    onMouseLeave={handleTopLevelMenuLeave}
                    style={{ position: 'relative', width: '100%' }}
                  >
                    <button className="menu-item">
                      <span>{item}</span>
                      <ChevronRight size={16} className="menu-item-chevron" />
                    </button>
                    {isTopLevelMenuOpen('File') && (
                      <div
                        className="submenu-container"
                        onMouseEnter={handleTopLevelSubmenuEnter}
                        onMouseLeave={handleTopLevelMenuLeave}
                      >
                        {/* Workspace operations */}
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={async () => {
                            try {
                              const { pickFolder } = await import('./utils/fileAccessAdapter.js');
                              const { storeFolderHandle } = await import('./services/folderPersistence.js');

                              const folderHandle = await pickFolder();
                              if (folderHandle) {
                                await storeFolderHandle(folderHandle);
                                console.log('[RedstringMenu] Workspace folder changed');
                                window.location.reload();
                              }
                            } catch (error) {
                              console.error('[RedstringMenu] Failed to change workspace folder:', error);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <FolderOpen size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Change Workspace Folder...
                        </div>
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={() => {
                            window.location.reload();
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <RefreshCw size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Refresh
                        </div>
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={() => onLoadFromExternalLink?.()}
                          style={{ cursor: 'pointer' }}
                        >
                          <LinkIcon size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Load from External Link...
                        </div>
                        <div
                          className={`submenu-item has-submenu ${isNestedSubmenuOpen('Export') ? 'active-submenu-parent' : ''}`}
                          onMouseEnter={() => handleNestedSubmenuItemHover('Export')}
                          onMouseLeave={handleNestedSubmenuItemLeave}
                          style={{ cursor: 'pointer' }}
                        >
                          <FileText size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Export...
                          <ChevronRight size={14} style={{ marginLeft: 'auto', opacity: 0.7 }} />

                          {isNestedSubmenuOpen('Export') && (
                            <div
                              className="recent-files-submenu"
                              onMouseEnter={handleNestedSubmenuEnter}
                              onMouseLeave={handleNestedSubmenuItemLeave}
                            >
                              <button className="recent-file-item" onClick={(e) => { e.stopPropagation(); onExportRedstring?.(); }}>
                                <span className="recent-file-name">Redstring (.redstring)</span>
                                <span className="recent-file-time">Native</span>
                              </button>
                              <button className="recent-file-item" onClick={(e) => { e.stopPropagation(); onExportJson?.(); }}>
                                <span className="recent-file-name">JSON (.json)</span>
                                <span className="recent-file-time">Native</span>
                              </button>
                              <button className="recent-file-item" onClick={(e) => { e.stopPropagation(); onExportTxt?.(); }}>
                                <span className="recent-file-name">Plain Text (.txt)</span>
                                <span className="recent-file-time">Readable</span>
                              </button>
                              <button className="recent-file-item" onClick={(e) => { e.stopPropagation(); onExportTtl?.(); }}>
                                <span className="recent-file-name">Turtle (.ttl)</span>
                                <span className="recent-file-time">RDF</span>
                              </button>
                              <button className="recent-file-item" onClick={(e) => { e.stopPropagation(); onExportTrig?.(); }}>
                                <span className="recent-file-name">TriG (.trig)</span>
                                <span className="recent-file-time">RDF</span>
                              </button>
                              <button className="recent-file-item" onClick={(e) => { e.stopPropagation(); onExportRdf?.(); }}>
                                <span className="recent-file-name">N-Quads (.nq)</span>
                                <span className="recent-file-time">RDF</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <div
                          className={`submenu-item has-submenu ${isNestedSubmenuOpen('RecentFiles') ? 'active-submenu-parent' : ''}`}
                          onClick={() => onOpenUniverse?.()}
                          onMouseEnter={() => handleNestedSubmenuItemHover('RecentFiles')}
                          onMouseLeave={handleNestedSubmenuItemLeave}
                          style={{ cursor: 'pointer' }}
                        >
                          <FolderOpen size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Open...
                          <ChevronRight size={14} style={{ marginLeft: 'auto', opacity: 0.7 }} />

                          {isNestedSubmenuOpen('RecentFiles') && (
                            <div
                              className="recent-files-submenu"
                              onMouseEnter={handleNestedSubmenuEnter}
                              onMouseLeave={handleNestedSubmenuItemLeave}
                            >
                              {recentFiles.length === 0 ? (
                                <div className="no-recent-files">No recent files</div>
                              ) : (
                                recentFiles.map((file, index) => (
                                  <button
                                    key={file.handleId || index}
                                    className="recent-file-item"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenRecentFile?.(file);
                                    }}
                                    title={`${file.fileName}\nLast opened: ${new Date(file.lastOpened).toLocaleString()}`}
                                  >
                                    <span className="recent-file-name">{file.fileName}</span>
                                    <span className="recent-file-time">
                                      {new Date(file.lastOpened).toLocaleDateString()}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              } else if (item === 'Edit') {
                return (
                  <div
                    key={index}
                    onMouseEnter={() => handleTopLevelMenuHover('Edit')}
                    onMouseLeave={handleTopLevelMenuLeave}
                    style={{ position: 'relative', width: '100%' }}
                  >
                    <button className="menu-item">
                      <span>{item}</span>
                      <ChevronRight size={16} className="menu-item-chevron" />
                    </button>
                    {isTopLevelMenuOpen('Edit') && (
                      <div
                        className="submenu-container"
                        onMouseEnter={handleTopLevelSubmenuEnter}
                        onMouseLeave={handleTopLevelMenuLeave}
                      >
                        <div
                          className="submenu-item"
                          onClick={() => performUndo()}
                          style={{ cursor: 'pointer', opacity: canUndo ? 1 : 0.5 }}
                        >
                          <Undo2 size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                            <span>Undo</span>
                            <span style={{ opacity: 0.5, fontSize: '11px' }}>Ctrl+Z</span>
                          </div>
                        </div>
                        <div
                          className="submenu-item"
                          onClick={() => performRedo()}
                          style={{ cursor: 'pointer', opacity: canRedo ? 1 : 0.5 }}
                        >
                          <Redo2 size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                            <span>Redo</span>
                            <span style={{ opacity: 0.5, fontSize: '11px' }}>Ctrl+Shift+Z</span>
                          </div>
                        </div>
                        <div className="submenu-divider" style={{ margin: '8px 0', borderTop: '1px solid #444', opacity: 0.3 }} />
                        <div
                          className="submenu-item"
                          onClick={() => {
                            // Dispatch global event; the merge modal is mounted in NodeCanvas
                            window.dispatchEvent(new Event('openMergeModal'));
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <GitMerge size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Merge Duplicates
                        </div>
                        <div className="submenu-divider" style={{ margin: '8px 0', borderTop: '1px solid #444', opacity: 0.3 }} />
                        <div
                          className={`submenu-item has-submenu ${isNestedSubmenuOpen('DragZoom') ? 'active-submenu-parent' : ''}`}
                          onMouseEnter={() => handleNestedSubmenuItemHover('DragZoom')}
                          onMouseLeave={handleNestedSubmenuItemLeave}
                          style={{ cursor: 'pointer' }}
                        >
                          <Move size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Zoom on Drag
                          <ChevronRight size={14} style={{ marginLeft: 'auto', opacity: 0.7 }} />

                          {isNestedSubmenuOpen('DragZoom') && (
                            <div
                              className="submenu-container"
                              onMouseEnter={handleNestedSubmenuEnter}
                              onMouseLeave={handleNestedSubmenuItemLeave}
                              style={{ left: '100%', top: 0 }}
                            >
                              <div
                                className="submenu-item"
                                onClick={() => onToggleDragZoom?.()}
                                style={{ cursor: 'pointer', opacity: dragZoomEnabled ? 1 : 0.8 }}
                              >
                                {dragZoomEnabled ? 'Enabled ✓' : 'Disabled'}
                              </div>
                              <div
                                style={{ padding: '6px 6px 0 6px', width: '100%' }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onMouseUp={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                onPointerUp={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()}
                              >
                                <MaroonSlider
                                  label="Zoom Amount"
                                  value={dragZoomAmount}
                                  min={0.0}
                                  max={0.9}
                                  step={0.05}
                                  suffix=""
                                  onChange={(v) => onSetDragZoomAmount?.(v)}
                                  disabled={!dragZoomEnabled}
                                />
                              </div>
                              <div style={{ padding: '4px 12px', fontSize: '10px', opacity: 0.6, lineHeight: '1.3' }}>
                                {dragZoomAmount < 0.2 ? 'Minimal zoom' : dragZoomAmount < 0.5 ? 'Moderate zoom' : 'Strong zoom out'}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              } else if (item === 'View') {
                return (
                  <div
                    key={index}
                    onMouseEnter={() => handleTopLevelMenuHover('View')}
                    onMouseLeave={handleTopLevelMenuLeave}
                    style={{ position: 'relative', width: '100%' }}
                  >
                    <button className="menu-item">
                      <span>{item}</span>
                      <ChevronRight size={16} className="menu-item-chevron" />
                    </button>
                    {isTopLevelMenuOpen('View') && (
                      <div
                        className="submenu-container"
                        onMouseEnter={handleTopLevelSubmenuEnter}
                        onMouseLeave={handleTopLevelMenuLeave}
                      >
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={() => onToggleDarkMode?.()}
                          style={{ cursor: 'pointer' }}
                        >
                          <Moon size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          {darkMode ? 'Dark Mode: On' : 'Dark Mode: Off'}
                        </div>
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={() => onToggleFullscreen?.()}
                          style={{ cursor: 'pointer' }}
                        >
                          <Maximize size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          {isFullscreen ? 'Fullscreen: On' : 'Fullscreen: Off'}
                        </div>
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={() => onToggleTrackpadZoom?.()}
                          style={{ cursor: 'pointer' }}
                        >
                          <ZoomIn size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          {trackpadZoomEnabled ? 'Disable Trackpad Zoom (Browser)' : 'Enable Trackpad Zoom (Browser)'}
                        </div>
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={() => onToggleShowConnectionNames?.()}
                          style={{ cursor: 'pointer' }}
                        >
                          <Tag size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          {showConnectionNames ? 'Hide Connection Names' : 'Show Connection Names'}
                        </div>
                        <div
                          className={`submenu-item has-submenu ${isNestedSubmenuOpen('Grid') ? 'active-submenu-parent' : ''}`}
                          onMouseEnter={() => handleNestedSubmenuItemHover('Grid')}
                          onMouseLeave={handleNestedSubmenuItemLeave}
                          style={{ cursor: 'pointer' }}
                        >
                          <Grid3x3 size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          Grid
                          <ChevronRight size={14} style={{ marginLeft: 'auto', opacity: 0.7 }} />

                          {isNestedSubmenuOpen('Grid') && (
                            <div
                              className="submenu-container"
                              onMouseEnter={handleNestedSubmenuEnter}
                              onMouseLeave={handleNestedSubmenuItemLeave}
                              style={{ left: '100%', top: 0 }}
                            >
                              <div
                                className="submenu-item"
                                onClick={() => onSetGridMode?.('off')}
                                style={{ opacity: gridMode === 'off' ? 1 : 0.8, cursor: 'pointer' }}
                              >
                                Off {gridMode === 'off' ? '✓' : ''}
                              </div>
                              <div
                                className="submenu-item"
                                onClick={() => onSetGridMode?.('move')}
                                style={{ opacity: gridMode === 'move' ? 1 : 0.8, cursor: 'pointer' }}
                              >
                                On Move {gridMode === 'move' ? '✓' : ''}
                              </div>
                              <div
                                className="submenu-item"
                                onClick={() => onSetGridMode?.('always')}
                                style={{ opacity: gridMode === 'always' ? 1 : 0.8, cursor: 'pointer' }}
                              >
                                Always {gridMode === 'always' ? '✓' : ''}
                              </div>
                              <div className="submenu-divider" style={{ margin: '6px 0', borderTop: '1px solid #444', opacity: 0.3 }} />
                              <div
                                className="submenu-item"
                                onClick={() => onSetGridAppearance?.('lattice')}
                                style={{ opacity: (gridAppearance || 'lattice') === 'lattice' ? 1 : 0.8, cursor: 'pointer' }}
                              >
                                Lattice {(gridAppearance || 'lattice') === 'lattice' ? '✓' : ''}
                              </div>
                              <div
                                className="submenu-item"
                                onClick={() => onSetGridAppearance?.('dot')}
                                style={{ opacity: gridAppearance === 'dot' ? 1 : 0.8, cursor: 'pointer' }}
                              >
                                Dot {gridAppearance === 'dot' ? '✓' : ''}
                              </div>
                              <div style={{ padding: '6px 6px 0 6px', width: '100%' }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onMouseUp={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                onPointerUp={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()}
                              >
                                <MaroonSlider
                                  label="Grid Size"
                                  value={gridSize || 200}
                                  min={20}
                                  max={400}
                                  step={5}
                                  suffix="px"
                                  onChange={(v) => onSetGridSize?.(v)}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="submenu-divider" style={{ margin: '8px 0', borderTop: '1px solid #444', opacity: 0.3 }} />

                        <div
                          className="submenu-item"
                          onClick={() => {
                            console.log('[View] Force Simulation Tuner clicked');
                            closeAllMenus();
                            if (onOpenForceSim) onOpenForceSim();
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <Activity size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          Force Simulation Tuner
                        </div>

                        <div
                          className="submenu-item"
                          onClick={() => {
                            console.log('[View] Auto Layout clicked');
                            closeAllMenus();
                            if (onAutoLayoutGraph) onAutoLayoutGraph();
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <LayoutGrid size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          Auto Layout Web
                        </div>

                        <div
                          className="submenu-item"
                          onClick={() => {
                            console.log('[View] Snap to Grid clicked');
                            closeAllMenus();
                            if (onSnapToGrid) onSnapToGrid();
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <Grid3x3 size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          Snap to Grid
                        </div>

                        <div
                          className="submenu-item"
                          onClick={() => {
                            console.log('[View] Condense Things clicked');
                            closeAllMenus();
                            if (onCondenseNodes) onCondenseNodes();
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <RefreshCw size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          Condense Things
                        </div>

                        {/* Keyboard Submenu */}
                        <div
                          className={`submenu-item has-submenu ${isNestedSubmenuOpen('keyboard') ? 'active-submenu-parent' : ''}`}
                          onMouseEnter={() => handleNestedSubmenuItemHover('keyboard')}
                          onMouseLeave={handleNestedSubmenuItemLeave}
                          style={{ position: 'relative' }}
                        >
                          <Keyboard size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          <span>Keyboard</span>
                          <ChevronRight size={14} className="nested-chevron" />
                          {isNestedSubmenuOpen('keyboard') && (
                            <div
                              className="submenu-container"
                              onMouseEnter={handleNestedSubmenuEnter}
                              onMouseLeave={handleNestedSubmenuItemLeave}
                              style={{ left: '100%', top: 0 }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                setIsInteracting(true);
                              }}
                              onMouseUp={(e) => {
                                e.stopPropagation();
                                setIsInteracting(false);
                              }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                setIsInteracting(true);
                              }}
                              onPointerUp={(e) => {
                                e.stopPropagation();
                                setIsInteracting(false);
                              }}
                              onTouchStart={(e) => {
                                e.stopPropagation();
                                setIsInteracting(true);
                              }}
                              onTouchEnd={(e) => {
                                e.stopPropagation();
                                setIsInteracting(false);
                              }}
                            >
                              <MaroonSlider
                                label="Zoom Sensitivity"
                                value={useGraphStore.getState().keyboardSettings.zoomSensitivity}
                                min={0.1}
                                max={1.0}
                                step={0.05}
                                onChange={(v) => useGraphStore.getState().setKeyboardZoomSensitivity(v)}
                                suffix=""
                              />
                              <MaroonSlider
                                label="Pan Sensitivity"
                                value={useGraphStore.getState().keyboardSettings.panSensitivity}
                                min={0.1}
                                max={1.0}
                                step={0.05}
                                onChange={(v) => useGraphStore.getState().setKeyboardPanSensitivity(v)}
                                suffix=""
                              />
                            </div>
                          )}
                        </div>

                        {/* Text Size Submenu */}
                        <div
                          className={`submenu-item has-submenu ${isNestedSubmenuOpen('textSize') ? 'active-submenu-parent' : ''}`}
                          onMouseEnter={() => handleNestedSubmenuItemHover('textSize')}
                          onMouseLeave={handleNestedSubmenuItemLeave}
                          style={{ position: 'relative' }}
                        >
                          <Type size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          <span>Text Size</span>
                          <ChevronRight size={14} className="nested-chevron" />
                          {isNestedSubmenuOpen('textSize') && (
                            <div
                              className="submenu-container"
                              onMouseEnter={handleNestedSubmenuEnter}
                              onMouseLeave={handleNestedSubmenuItemLeave}
                              style={{ left: '100%', top: 0 }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                setIsInteracting(true);
                              }}
                              onMouseUp={(e) => {
                                e.stopPropagation();
                                setIsInteracting(false);
                              }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                setIsInteracting(true);
                              }}
                              onPointerUp={(e) => {
                                e.stopPropagation();
                                setIsInteracting(false);
                              }}
                              onTouchStart={(e) => {
                                e.stopPropagation();
                                setIsInteracting(true);
                              }}
                              onTouchEnd={(e) => {
                                e.stopPropagation();
                                setIsInteracting(false);
                              }}
                            >
                              <MaroonSlider
                                label="Font Size"
                                value={useGraphStore.getState().textSettings.fontSize}
                                min={0.7}
                                max={1.4}
                                step={0.05}
                                onChange={(v) => useGraphStore.getState().setTextFontSize(v)}
                                suffix="x"
                              />
                              <MaroonSlider
                                label="Line Spacing"
                                value={useGraphStore.getState().textSettings.lineSpacing}
                                min={0.7}
                                max={1.0}
                                step={0.05}
                                onChange={(v) => useGraphStore.getState().setTextLineSpacing(v)}
                                suffix="x"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                    }
                  </div>
                );
              } else if (item === 'Connections') {
                return (
                  <div
                    key={index}
                    onMouseEnter={() => handleTopLevelMenuHover('Connections')}
                    onMouseLeave={handleTopLevelMenuLeave}
                    style={{ position: 'relative', width: '100%' }}
                  >
                    <button className="menu-item">
                      <span>{item}</span>
                      <ChevronRight size={16} className="menu-item-chevron" />
                    </button>
                    {isTopLevelMenuOpen('Connections') && (
                      <div
                        className="submenu-container"
                        onMouseEnter={handleTopLevelSubmenuEnter}
                        onMouseLeave={handleTopLevelMenuLeave}
                      >

                        <div
                          className="submenu-item"
                          onClick={() => onSetRoutingStyle?.('straight')}
                          style={{ opacity: routingStyle === 'straight' ? 1 : 0.8, cursor: 'pointer' }}
                        >
                          <Minus size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          Routing: Straight {routingStyle === 'straight' ? '✓' : ''}
                        </div>
                        <div
                          className="submenu-item"
                          onClick={() => onSetRoutingStyle?.('manhattan')}
                          style={{ opacity: routingStyle === 'manhattan' ? 1 : 0.8, cursor: 'pointer' }}
                        >
                          <CornerDownRight size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          Routing: Manhattan {routingStyle === 'manhattan' ? '✓' : ''}
                        </div>
                        <div
                          className="submenu-item"
                          onClick={() => onSetRoutingStyle?.('clean')}
                          style={{ opacity: routingStyle === 'clean' ? 1 : 0.8, cursor: 'pointer' }}
                        >
                          <Spline size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          Routing: Clean {routingStyle === 'clean' ? '✓' : ''}
                        </div>
                        <div
                          className="submenu-item"
                          onClick={() => onSetRoutingStyle?.('lombardi')}
                          style={{ opacity: routingStyle === 'lombardi' ? 1 : 0.8, cursor: 'pointer' }}
                        >
                          <Circle size={14} style={{ marginRight: '8px', minWidth: '14px', flexShrink: 0 }} />
                          Routing: Lombardi {routingStyle === 'lombardi' ? '✓' : ''}
                        </div>
                      </div>
                    )}
                  </div>
                );
              } else if (item === 'Help') {
                return (
                  <div
                    key={index}
                    onMouseEnter={() => handleTopLevelMenuHover('Help')}
                    onMouseLeave={handleTopLevelMenuLeave}
                    style={{ position: 'relative', width: '100%' }}
                  >
                    <button className="menu-item">
                      <span>{item}</span>
                      <ChevronRight size={16} className="menu-item-chevron" />
                    </button>
                    {isTopLevelMenuOpen('Help') && (
                      <div
                        className="submenu-container"
                        onMouseEnter={handleTopLevelSubmenuEnter}
                        onMouseLeave={handleTopLevelMenuLeave}
                      >
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={() => {
                            // Dispatch event to open help modal
                            window.dispatchEvent(new Event('openHelpModal'));
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <BookOpen size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Redstring Guide
                        </div>
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={() => {
                            // Dispatch event to open onboarding modal
                            window.dispatchEvent(new Event('openOnboardingModal'));
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <Home size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Show Welcome Screen
                        </div>
                        <div
                          className="submenu-item"
                          onMouseEnter={handleRegularSubmenuItemHover}
                          onClick={() => {
                            // Dispatch event to open settings modal
                            window.dispatchEvent(new Event('openSettingsModal'));
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <Settings size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                          Settings
                        </div>
                      </div>
                    )}
                  </div>
                );
              } else {
                return (
                  <button
                    key={index}
                    className="menu-item"
                  >
                    <span>{item}</span>
                    <ChevronRight
                      size={16}
                      className="menu-item-chevron"
                    />
                  </button>
                );
              }
            })}
          </div>
        </div >
      )}
    </>
  );
};

export default RedstringMenu;
