import React, { useState, useEffect, useRef } from 'react';
import MaroonSlider from './components/MaroonSlider.jsx';
import { ChevronRight, FileText, FolderOpen, Save, Clock, Globe, Bug, BookOpen, Home, LayoutGrid, Activity, RefreshCw } from 'lucide-react';
import './RedstringMenu.css';
import DebugOverlay from './DebugOverlay';
import * as fileStorage from './store/fileStorage.js';
import { debugConfig } from './utils/debugConfig.js';

const RedstringMenu = ({ 
  isOpen, 
  onHoverView, 
  debugMode, 
  setDebugMode,
  trackpadZoomEnabled,
  onToggleTrackpadZoom,
  isFullscreen,
  onToggleFullscreen,
  showConnectionNames,
  onToggleShowConnectionNames,
  // Connections visualization controls
  enableAutoRouting,
  routingStyle,
  manhattanBends,
  onToggleEnableAutoRouting,
  onSetRoutingStyle,
  onSetManhattanBends,
  // Optional: expose clean lane spacing adjuster
  onSetCleanLaneSpacing,
  cleanLaneSpacing,
  // Grid controls
  gridMode,
  onSetGridMode,
  gridSize,
  onSetGridSize,
  // Universe management actions
  onNewUniverse,
  onOpenUniverse,
  onSaveUniverse,
  onExportRdf,
  onOpenRecentFile,
  onLoadWikidataCatalog,
  // Auto-graph generation
  onGenerateTestGraph,
  onOpenForceSim,
  onAutoLayoutGraph,
  onCondenseNodes
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [activeTopLevelMenu, setActiveTopLevelMenu] = useState(null); // Only ONE top-level menu open at a time
  const [activeNestedSubmenu, setActiveNestedSubmenu] = useState(null); // Nested submenu within the top-level
  const [isInteracting, setIsInteracting] = useState(false); // Guard to keep submenu open during slider drag
  const [recentFiles, setRecentFiles] = useState([]);
  // Track timeout for nested submenu closing only
  const nestedCloseTimeoutRef = useRef(null);
  const [debugSettings, setDebugSettings] = useState(debugConfig.getConfig());
  const menuItems = ['File', 'Edit', 'View', 'Connections', 'Debug', 'Help'];
  const menuRef = useRef(null);

  const topLevelMenus = ['File', 'Edit', 'View', 'Connections', 'Debug', 'Help'];

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

  // Listen for debug configuration changes
  useEffect(() => {
    const unsubscribe = debugConfig.addListener((newConfig) => {
      setDebugSettings(newConfig);
    });
    return unsubscribe;
  }, []);

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
              if (item === 'File') {
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
                                {/* Universe operations removed - UniverseManager eliminated */}
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
                                  onClick={() => {
                                    // console.log('[RedstringMenu] Export as RDF/Turtle clicked');
                                    onExportRdf?.();
                                  }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <FileText size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                                  Export as RDF/Turtle
                                </div>
                                <div
                                  className="submenu-item"
                                  onMouseEnter={handleRegularSubmenuItemHover}
                                  onClick={() => {
                                    onLoadWikidataCatalog?.();
                                  }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <Globe size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                                  Load from Wikidata...
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
              } else if(item === 'Edit'){
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
                                  onClick={() => {
                                    onAutoLayoutGraph?.();
                                    onHoverView?.(false);
                                  }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <LayoutGrid size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                                  Auto-Layout Active Graph
                                </div>
                                <div
                                  className="submenu-item"
                                  onClick={() => {
                                    onCondenseNodes?.();
                                    onHoverView?.(false);
                                  }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <Activity size={16} style={{ marginRight: '8px', minWidth: '16px', flexShrink: 0 }} />
                                  Condense Nodes to Center
                                </div>
                                <div
                                  className="submenu-item"
                                  onClick={() => {
                                    // Dispatch global event used by Panel to open DuplicateManager
                                    window.dispatchEvent(new Event('openMergeModal'));
                                  }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  Merge Duplicates
                                </div>
                            </div>
                          )}
                      </div>
                  );
              } else if(item === 'View'){
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
                                  onClick={() => onToggleFullscreen?.()}
                                  style={{ cursor: 'pointer' }}
                                >
                                  {isFullscreen ? 'Fullscreen: On' : 'Fullscreen: Off'}
                                </div>
                                <div
                                  className="submenu-item"
                                  onMouseEnter={handleRegularSubmenuItemHover}
                                  onClick={() => onToggleTrackpadZoom?.()}
                                  style={{ cursor: 'pointer' }}
                                >
                                  {trackpadZoomEnabled ? 'Disable Trackpad Zoom (Browser)' : 'Enable Trackpad Zoom (Browser)'}
                                </div>
                                <div
                                  className="submenu-item"
                                  onMouseEnter={handleRegularSubmenuItemHover}
                                  onClick={() => onToggleShowConnectionNames?.()}
                                  style={{ cursor: 'pointer' }}
                                >
                                  {showConnectionNames ? 'Hide Connection Names' : 'Show Connection Names'}
                                </div>
                                <div
                                  className={`submenu-item has-submenu ${isNestedSubmenuOpen('Grid') ? 'active-submenu-parent' : ''}`}
                                  onMouseEnter={() => handleNestedSubmenuItemHover('Grid')}
                                  onMouseLeave={handleNestedSubmenuItemLeave}
                                  style={{ cursor: 'pointer' }}
                                >
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
                                        onClick={() => onSetGridMode?.('hover')}
                                        style={{ opacity: gridMode === 'hover' ? 1 : 0.8, cursor: 'pointer' }}
                                      >
                                        On Move {gridMode === 'hover' ? '✓' : ''}
                                      </div>
                                      <div
                                        className="submenu-item"
                                        onClick={() => onSetGridMode?.('always')}
                                        style={{ opacity: gridMode === 'always' ? 1 : 0.8, cursor: 'pointer' }}
                                      >
                                        Always {gridMode === 'always' ? '✓' : ''}
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
                            </div>
                          )}
                      </div>
                  );
              } else if(item === 'Connections'){
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
                                Routing: Straight {routingStyle === 'straight' ? '✓' : ''}
                              </div>
                              <div
                                className="submenu-item"
                                onClick={() => onSetRoutingStyle?.('manhattan')}
                                style={{ opacity: routingStyle === 'manhattan' ? 1 : 0.8, cursor: 'pointer' }}
                              >
                                Routing: Manhattan {routingStyle === 'manhattan' ? '✓' : ''}
                              </div>
                              <div
                                className="submenu-item"
                                onClick={() => onSetRoutingStyle?.('clean')}
                                style={{ opacity: routingStyle === 'clean' ? 1 : 0.8, cursor: 'pointer' }}
                              >
                                Routing: Clean {routingStyle === 'clean' ? '✓' : ''}
                              </div>
                              {routingStyle === 'clean' && (
                                <div style={{ padding: '6px 6px 0 6px', width: '100%' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ fontSize: '12px', color: '#BDB6B5', opacity: 0.9 }}>Connection spacing</div>
                                    <div style={{ fontSize: '12px', color: '#BDB6B5', opacity: 0.8 }}>{cleanLaneSpacing || 200}px</div>
                                  </div>
                                  <div
                                    style={{ width: 'calc(100% - 16px)', margin: '6px 8px 0 8px' }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onMouseUp={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onPointerUp={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      className="submenu-slider"
                                      type="range"
                                      min={100}
                                      max={400}
                                      step={10}
                                      value={cleanLaneSpacing || 200}
                                      onChange={(e) => onSetCleanLaneSpacing?.(Number(e.target.value))}
                                      onInput={(e) => onSetCleanLaneSpacing?.(Number(e.target.value))}
                                      draggable={false}
                                      onMouseDown={(e) => { setIsInteracting(true); e.stopPropagation(); }}
                                      onMouseUp={(e) => { setIsInteracting(false); e.stopPropagation(); }}
                                      onClick={(e) => e.stopPropagation()}
                                      onPointerDown={(e) => { setIsInteracting(true); e.stopPropagation(); }}
                                      onPointerUp={(e) => { setIsInteracting(false); e.stopPropagation(); }}
                                      onTouchStart={(e) => { setIsInteracting(true); e.stopPropagation(); }}
                                      onTouchEnd={(e) => { setIsInteracting(false); e.stopPropagation(); }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                  );
              } else if(item === 'Debug'){
                  return (
                      <div
                        key={index}
                        onMouseEnter={() => handleTopLevelMenuHover('Debug')}
                        onMouseLeave={handleTopLevelMenuLeave}
                        style={{ position: 'relative', width: '100%' }}
                      >
                          <button className="menu-item">
                              <span>{item}</span>
                              <ChevronRight size={16} className="menu-item-chevron" />
                          </button>
                          {isTopLevelMenuOpen('Debug') && (
                            <div
                              className="submenu-container"
                              onMouseEnter={handleTopLevelSubmenuEnter}
                              onMouseLeave={handleTopLevelMenuLeave}
                            >
                                <div
                                  className="submenu-item"
                                  onClick={() => {
                                    console.log('[DEBUG] Generate Test Graph clicked', { onGenerateTestGraph });
                                    closeAllMenus();
                                    if (onGenerateTestGraph) onGenerateTestGraph();
                                  }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <LayoutGrid size={14} style={{ marginRight: '8px' }} />
                                  Generate Test Graph
                                </div>
                                
                                <div
                                  className="submenu-item"
                                  onClick={() => {
                                    console.log('[DEBUG] Force Simulation Tuner clicked');
                                    closeAllMenus();
                                    if (onOpenForceSim) onOpenForceSim();
                                  }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <Activity size={14} style={{ marginRight: '8px' }} />
                                  Force Simulation Tuner
                                </div>
                                
                                <div className="submenu-divider" style={{ margin: '8px 0', borderTop: '1px solid #444', opacity: 0.3 }} />
                                
                                <div
                                  className="submenu-item"
                                  onClick={() => setDebugMode(!debugMode)}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <Bug size={14} style={{ marginRight: '8px' }} />
                                  {debugMode ? 'Hide Debug Overlay' : 'Show Debug Overlay'}
                                </div>
                                
                                <div className="submenu-divider" style={{ margin: '8px 0', borderTop: '1px solid #444', opacity: 0.3 }} />
                                
                                <div
                                  className="submenu-item"
                                  onClick={() => debugConfig.setLocalStorageDisabled(!debugSettings.disableLocalStorage)}
                                  style={{ cursor: 'pointer', opacity: debugSettings.disableLocalStorage ? 1 : 0.8 }}
                                >
                                  {debugSettings.disableLocalStorage ? '✓' : ''} Disable Local Storage
                                </div>
                                
                                <div
                                  className="submenu-item"
                                  onClick={() => debugConfig.setForceGitOnly(!debugSettings.forceGitOnly)}
                                  style={{ cursor: 'pointer', opacity: debugSettings.forceGitOnly ? 1 : 0.8 }}
                                >
                                  {debugSettings.forceGitOnly ? '✓' : ''} Force Git-Only Mode
                                </div>
                                
                                <div
                                  className="submenu-item"
                                  onClick={() => debugConfig.setDebugMode(!debugSettings.debugMode)}
                                  style={{ cursor: 'pointer', opacity: debugSettings.debugMode ? 1 : 0.8 }}
                                >
                                  {debugSettings.debugMode ? '✓' : ''} Enable Debug Logging
                                </div>
                                
                                <div className="submenu-divider" style={{ margin: '8px 0', borderTop: '1px solid #444', opacity: 0.3 }} />
                                
                                <div
                                  className="submenu-item"
                                  onClick={() => {
                                    debugConfig.reset();
                                    setDebugMode(false);
                                  }}
                                  style={{ cursor: 'pointer', color: '#ff6b6b' }}
                                >
                                  Reset All Debug Settings
                                </div>
                                
                                <div
                                  className="submenu-item"
                                  onClick={() => {
                                    debugConfig.logToConsole();
                                  }}
                                  style={{ cursor: 'pointer', color: '#4ecdc4' }}
                                >
                                  Show Debug Info in Console
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
        </div>
      )}
    </>
  );
};

export default RedstringMenu;
