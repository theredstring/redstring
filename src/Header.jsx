import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { HEADER_HEIGHT } from './constants';
import RedstringMenu from './RedstringMenu';
import { Bookmark, Plus, ScanSearch, HelpCircle, Bug, Settings, Search, Menu, CircleX } from 'lucide-react';
import { useTheme } from './hooks/useTheme.js';
import HeaderGraphTab from './HeaderGraphTab';
import { showContextMenu } from './components/GlobalContextMenu';
import { getTextColor, hexToHsl, hslToHex } from './utils/colorUtils.js';

// Import all logo states
import logo1 from './assets/redstring_button/header_logo_1.svg';
import logo2 from './assets/redstring_button/header_logo_2.svg';
import logo3 from './assets/redstring_button/header_logo_3.svg';
import logo4 from './assets/redstring_button/header_logo_4.svg';
import logo5 from './assets/redstring_button/header_logo_5.svg';
import logo6 from './assets/redstring_button/header_logo_6.svg';
import logo7 from './assets/redstring_button/header_logo_7.svg';

const Header = ({
  onTitleChange,
  onEditingStateChange,
  headerGraphs,
  onSetActiveGraph,
  // New action props
  onCreateNewThing,
  onOpenComponentSearch,
  onOpenAllThingsSearch,
  // Responsive layout
  isExclusivePanelMode = false,
  // Receive debug props
  debugMode,
  setDebugMode,
  // View option: trackpad zoom
  trackpadZoomEnabled,
  onToggleTrackpadZoom,
  // View option: fullscreen
  isFullscreen,
  onToggleFullscreen,
  bookmarkActive = false,
  onBookmarkToggle,
  // Connection names props
  showConnectionNames,
  onToggleShowConnectionNames,
  // Dark mode props
  darkMode,
  onToggleDarkMode,
  // Connections menu props
  enableAutoRouting,
  routingStyle,
  manhattanBends,
  onToggleEnableAutoRouting,
  onSetRoutingStyle,
  onSetManhattanBends,
  // Clean routing controls
  onSetCleanLaneSpacing,
  cleanLaneSpacing,
  // Group layout
  groupLayoutAlgorithm,
  onSetGroupLayoutAlgorithm,
  showClusterHulls,
  onToggleShowClusterHulls,
  // Grid controls
  gridMode,
  onSetGridMode,
  gridSize,
  onSetGridSize,
  // Drag zoom controls
  dragZoomEnabled,
  dragZoomAmount,
  onToggleDragZoom,
  onSetDragZoomAmount,
  // File management actions
  onNewUniverse,
  onOpenUniverse,
  onSaveUniverse,
  onExportRdf,
  onOpenRecentFile,
  onLoadFromExternalLink,
  onGenerateTestGraph,
  onOpenForceSim,
  onAutoLayoutGraph,
  onCondenseNodes,
}) => {
  const theme = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHamburgerOpen, setIsHamburgerOpen] = useState(false);
  const hamburgerWrapperRef = useRef(null);
  const [currentLogoIndex, setCurrentLogoIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  // Show/Hide Debug Menu state
  const [showDebugMenu, setShowDebugMenu] = useState(() => {
    try {
      return localStorage.getItem('redstring_show_debug_menu') === 'true';
    } catch {
      return false;
    }
  });

  const headerRef = useRef(null);
  const tabsScrollContainerRef = useRef(null);
  const activeTabRef = useRef(null);
  const recenterTimeoutRef = useRef(null);
  const isProgrammaticScroll = useRef(false);
  const [activeTabMaxWidth, setActiveTabMaxWidth] = useState('220px');

  // Layout reservations on either side of the scrollable tabs container.
  // Only the logo (always) and hamburger (exclusive mode only) actually
  // *block* the tabs — the inline action buttons in wide mode float on top
  // with z-index, so tabs scroll underneath them. Centering is computed
  // against the viewport center (see scrollToCenter), not the container's
  // geometric center, so the container doesn't need to be symmetric.
  const tabsLeftReserve = HEADER_HEIGHT;
  const tabsRightReserve = isExclusivePanelMode ? HEADER_HEIGHT : 0;

  // Calculate dynamic max width for active tab based on header width
  useEffect(() => {
    const updateActiveTabMaxWidth = () => {
      if (!headerRef.current) return;

      const headerWidth = headerRef.current.offsetWidth;

      // Reserve space for whichever set of fixed buttons is rendered for the
      // current mode (logo + 3 left buttons + 3 right buttons in wide mode;
      // logo + hamburger in exclusive mode).
      const fixedButtonsWidth = tabsLeftReserve + tabsRightReserve;

      // Generous padding for inactive tabs and breathing room (300px on each side)
      const generousPadding = 600;

      // Calculate available width for the active tab
      const availableWidth = headerWidth - fixedButtonsWidth - generousPadding;

      // Set a minimum of 150px and maximum based on available space
      const calculatedMaxWidth = Math.max(150, Math.min(availableWidth, 800));

      setActiveTabMaxWidth(calculatedMaxWidth + 'px');
    };

    updateActiveTabMaxWidth();

    // Use ResizeObserver to track header width changes
    const resizeObserver = new ResizeObserver(updateActiveTabMaxWidth);
    if (headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [tabsLeftReserve, tabsRightReserve]);

  // Scroll-to-center function. The container can be asymmetric (e.g. in wide
  // mode it extends behind the right action buttons), so we center the active
  // tab against the *viewport* center rather than the container's geometric
  // center. The result is that the active tab sits dead-center in the
  // browser window regardless of which side has more reserved chrome.
  const scrollToCenter = useCallback((immediate = false) => {
    if (!tabsScrollContainerRef.current || !activeTabRef.current) return;

    const container = tabsScrollContainerRef.current;
    const activeTab = activeTabRef.current;

    // offsetLeft/offsetWidth are layout-relative (independent of scrollLeft).
    // containerRect.left is the container's viewport-x and doesn't depend on
    // its own scrollLeft either, so the resulting target is fully absolute.
    const containerRect = container.getBoundingClientRect();
    const tabCenterInContent = activeTab.offsetLeft + activeTab.offsetWidth / 2;
    const targetScrollLeft = Math.max(
      0,
      containerRect.left + tabCenterInContent - window.innerWidth / 2
    );

    isProgrammaticScroll.current = true;

    if (immediate) {
      container.scrollLeft = targetScrollLeft;
      setTimeout(() => { isProgrammaticScroll.current = false; }, 50);
    } else {
      // Custom smooth scroll with slower duration (1200ms, ease-out)
      const duration = 1200;
      const startScrollLeft = container.scrollLeft;
      const delta = targetScrollLeft - startScrollLeft;
      const startTime = performance.now();

      const animateScroll = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic: decelerates nicely
        const eased = 1 - Math.pow(1 - progress, 3);

        container.scrollLeft = startScrollLeft + delta * eased;

        if (progress < 1) {
          requestAnimationFrame(animateScroll);
        } else {
          isProgrammaticScroll.current = false;
        }
      };

      requestAnimationFrame(animateScroll);
    }
  }, []);

  // Scroll event handler with 3-second timeout to recenter
  const handleTabsScroll = useCallback(() => {
    // Ignore programmatic scrolls
    if (isProgrammaticScroll.current) return;

    // Clear existing timeout
    if (recenterTimeoutRef.current) {
      clearTimeout(recenterTimeoutRef.current);
    }

    // Set 3-second timeout to recenter
    recenterTimeoutRef.current = setTimeout(() => {
      scrollToCenter(false); // Smooth scroll back to center
    }, 3000);
  }, [scrollToCenter]);

  // Wheel scrolling handler (needs non-passive for preventDefault)
  const handleTabsWheel = useCallback((e) => {
    if (!tabsScrollContainerRef.current) return;

    const container = tabsScrollContainerRef.current;

    // Only scroll if there's overflow
    if (container.scrollWidth <= container.clientWidth) return;

    e.preventDefault();
    e.stopPropagation();

    // Convert vertical/horizontal wheel to horizontal scroll
    let scrollAmount = e.deltaY;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      scrollAmount = e.deltaX;
    }

    container.scrollLeft += scrollAmount;
  }, []);

  // Ref callback to attach wheel listener when container mounts (avoids imagesLoaded timing bug)
  const tabsContainerRefCallback = useCallback((node) => {
    // Detach from old node
    if (tabsScrollContainerRef.current) {
      tabsScrollContainerRef.current.removeEventListener('wheel', handleTabsWheel);
    }
    tabsScrollContainerRef.current = node;
    // Attach to new node
    if (node) {
      node.addEventListener('wheel', handleTabsWheel, { passive: false });
    }
  }, [handleTabsWheel]);

  // Cleanup recenter timeout on unmount
  useEffect(() => {
    return () => {
      if (recenterTimeoutRef.current) {
        clearTimeout(recenterTimeoutRef.current);
      }
    };
  }, []);

  // Hamburger menu: close on outside click or Escape
  useEffect(() => {
    if (!isHamburgerOpen) return;
    const handleOutside = (e) => {
      if (hamburgerWrapperRef.current && !hamburgerWrapperRef.current.contains(e.target)) {
        setIsHamburgerOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setIsHamburgerOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [isHamburgerOpen]);

  const handleLogoContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    showContextMenu(e.clientX, e.clientY, [
      {
        label: showDebugMenu ? 'Hide Debug Menu' : 'Show Debug Menu',
        icon: <Bug size={14} />,
        action: () => {
          const newState = !showDebugMenu;
          setShowDebugMenu(newState);
          localStorage.setItem('redstring_show_debug_menu', newState);
        }
      }
    ]);
  };

  // Keep local editing state, but text state is now props
  const [isEditing, setIsEditing] = useState(false);

  const activeGraph = headerGraphs.find(g => g.isActive);

  // Derive header colors from active graph's node color
  const { headerBg, headerAccent } = useMemo(() => {
    const fallbackBg = '#260000';
    const fallbackAccent = '#7A0000';
    if (!activeGraph?.color) return { headerBg: fallbackBg, headerAccent: fallbackAccent };
    const { h, s } = hexToHsl(activeGraph.color);
    return {
      headerBg: hslToHex(h, Math.min(s, 100), 7.5),
      headerAccent: hslToHex(h, Math.min(s, 100), 24),
    };
  }, [activeGraph?.color]);

  // Keep consistent order - split the original array around the active graph
  const activeIndex = headerGraphs.findIndex(g => g.isActive);
  const leftGraphs = activeIndex > 0 ? headerGraphs.slice(0, activeIndex) : [];
  const rightGraphs = activeIndex < headerGraphs.length - 1 ? headerGraphs.slice(activeIndex + 1) : [];

  const [tempTitle, setTempTitle] = useState(activeGraph ? activeGraph.name : '');
  const inputRef = useRef(null);

  // Center on active graph change OR when images finish preloading. The
  // imagesLoaded dependency is critical: on the initial render Header
  // early-returns a stripped-down version with no tabs container, so the
  // first run of this effect bails out with null refs. Once images load and
  // the full header re-renders, we need to re-run to actually center.
  useEffect(() => {
    if (!activeGraph || !imagesLoaded) return;

    if (recenterTimeoutRef.current) {
      clearTimeout(recenterTimeoutRef.current);
    }

    // Center immediately on graph change. Run on the next frame so the active
    // tab is laid out, then re-observe its size: on narrow viewports the tab's
    // max-width (and therefore its measured width) settles after the
    // activeTabMaxWidth resize-observer commits, and we need to re-center then.
    let frameId = requestAnimationFrame(() => {
      scrollToCenter(true);
    });

    const tabEl = activeTabRef.current;
    let resizeObserver;
    if (tabEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scrollToCenter(true);
      });
      resizeObserver.observe(tabEl);
    }

    return () => {
      cancelAnimationFrame(frameId);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [activeGraph?.id, scrollToCenter, imagesLoaded]);

  const logos = [logo1, logo2, logo3, logo4, logo5, logo6, logo7];

  // Preload images
  useEffect(() => {
    const preloadImages = async () => {
      const imagePromises = logos.map(src => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.src = src;
          img.onload = resolve;
          img.onerror = reject;
        });
      });

      try {
        await Promise.all(imagePromises);
        setImagesLoaded(true);
      } catch (error) {
        console.error('Error preloading images:', error);
      }
    };

    preloadImages();
  }, []);

  // Update temp title if prop changes while not editing
  useEffect(() => {
    if (!isEditing && activeGraph) {
      setTempTitle(activeGraph.name);
    }
  }, [activeGraph, isEditing]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      const inputElement = inputRef.current;

      const updateInputWidth = () => {
        const text = inputElement.value;
        const style = window.getComputedStyle(inputElement);
        const tempSpan = document.createElement('span');
        tempSpan.style.font = style.font;
        tempSpan.style.letterSpacing = style.letterSpacing;
        tempSpan.style.visibility = 'hidden';
        tempSpan.style.position = 'absolute';
        tempSpan.style.whiteSpace = 'pre';
        tempSpan.innerText = text || ' ';
        document.body.appendChild(tempSpan);
        const textWidth = tempSpan.offsetWidth;
        document.body.removeChild(tempSpan);

        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const paddingRight = parseFloat(style.paddingRight) || 0;
        const borderLeft = parseFloat(style.borderLeftWidth) || 0;
        const borderRight = parseFloat(style.borderRightWidth) || 0;
        let newWidth = textWidth + paddingLeft + paddingRight + borderLeft + borderRight;

        // Min width specific to header input, can be adjusted
        const minWidth = 50;
        if (newWidth < minWidth) {
          newWidth = minWidth;
        }
        // Max width consideration if needed, though input has maxWidth style already
        // const maxWidth = parseFloat(style.maxWidth) || Infinity;
        // if (newWidth > maxWidth) newWidth = maxWidth;

        inputElement.style.width = `${newWidth}px`;
      };

      inputElement.focus();

      if (inputElement.value === '') {
        const originalSelectionStart = inputElement.selectionStart;
        const originalSelectionEnd = inputElement.selectionEnd;
        inputElement.value = '\u200B'; // Insert zero-width space
        inputElement.setSelectionRange(0, 0); // Move caret to start
        // Schedule to remove the zero-width space and restore selection or select all
        setTimeout(() => {
          if (inputElement.value === '\u200B') { // Only if it's still our ZWS
            inputElement.value = '';
            inputElement.focus(); // Re-focus after clearing
            inputElement.setSelectionRange(0, 0); // Caret at start for empty
          } else {
            // If user typed something super fast, try to restore original selection
            // or just select all if that seems more appropriate.
            // For now, if modified, we assume the user typed and don't interfere.
            // Or, simply re-select all if that's the desired empty-field behavior.
            // inputElement.select();
          }
          // Ensure caret is visible after this manipulation by focusing again if needed
          // although it should already be focused.
        }, 0);
      } else {
        inputElement.select(); // Select all if not empty
      }

      updateInputWidth(); // Initial width set

      inputElement.addEventListener('input', updateInputWidth);

      return () => {
        inputElement.removeEventListener('input', updateInputWidth);
        if (inputElement) {
          inputElement.style.width = 'auto'; // Reset width
        }
      };
    } else if (inputRef.current) {
      inputRef.current.style.width = 'auto'; // Reset if editing becomes false
    }
  }, [isEditing]);

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const animateFrames = async (opening) => {
    if (isAnimating || !imagesLoaded) return;
    setIsAnimating(true);

    const frames = opening ? [0, 1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1, 0];

    for (const frame of frames) {
      setCurrentLogoIndex(frame);
      await sleep(30); // 30ms per frame as you preferred
    }

    setIsAnimating(false);
    setIsMenuOpen(opening);
  };

  const toggleMenu = async () => {
    if (isAnimating) return;

    const opening = !isMenuOpen;
    setIsMenuOpen(opening);
    await animateFrames(opening);
  };

  const closeMenu = async () => {
    if (isAnimating || !isMenuOpen) return;
    await animateFrames(false);
  };

  const handleTitleDoubleClick = () => {
    if (activeGraph) {
      setTempTitle(activeGraph.name); // Start editing with current prop value
      setIsEditing(true);
      onEditingStateChange?.(true);
    }
  };

  const handleTitleChange = (event) => {
    setTempTitle(event.target.value); // Update local temp title
  };

  // Commit changes using the callback prop
  const commitChange = () => {
    setIsEditing(false);
    onEditingStateChange?.(false);
    onTitleChange(tempTitle); // Call the callback passed from NodeCanvas
  };

  const handleTitleBlur = () => {
    commitChange();
  };

  const handleTitleKeyDown = (event) => {
    if (event.key === 'Enter') {
      commitChange();
      event.target.blur();
    }
    if (event.key === 'Escape') {
      setIsEditing(false); // Discard changes on Escape
      if (activeGraph) {
        setTempTitle(activeGraph.name); // Reset temp title
      }
      onEditingStateChange?.(false);
      event.target.blur();
    }
  };

  // Don't render until images are loaded
  if (!imagesLoaded) {
    return (
      <header
        ref={headerRef}
        style={{
          height: `${HEADER_HEIGHT}px`,
          backgroundColor: headerBg,
          color: theme.canvas.bg,

          fontFamily: "'EmOne', sans-serif",
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          position: 'relative',
          zIndex: 1000,
        }}
      >
        {/* The button stays in the header */}
        <img
          src={logos[currentLogoIndex]}
          alt=""
          style={{
            height: `${HEADER_HEIGHT}px`,
            width: `${HEADER_HEIGHT}px`,
            objectFit: 'contain',
            cursor: isAnimating ? 'default' : 'pointer',
          }}
          onClick={toggleMenu}
          onContextMenu={handleLogoContextMenu}
        />

        {/* Pass debug props to RedstringMenu here */}
        <RedstringMenu
          isOpen={isMenuOpen}
          onHoverView={(open) => {
            if (!open) {
              closeMenu();
            } else {
              setIsMenuOpen(true);
            }
          }}
          showDebugMenu={showDebugMenu}
          debugMode={debugMode}
          setDebugMode={setDebugMode}
          trackpadZoomEnabled={trackpadZoomEnabled}
          onToggleTrackpadZoom={onToggleTrackpadZoom}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          showConnectionNames={showConnectionNames}
          onToggleShowConnectionNames={onToggleShowConnectionNames}
          darkMode={darkMode}
          onToggleDarkMode={onToggleDarkMode}
          enableAutoRouting={enableAutoRouting}
          routingStyle={routingStyle}
          manhattanBends={manhattanBends}
          onToggleEnableAutoRouting={onToggleEnableAutoRouting}
          onSetRoutingStyle={onSetRoutingStyle}
          onSetManhattanBends={onSetManhattanBends}
          onSetCleanLaneSpacing={onSetCleanLaneSpacing}
          cleanLaneSpacing={cleanLaneSpacing}
          groupLayoutAlgorithm={groupLayoutAlgorithm}
          onSetGroupLayoutAlgorithm={onSetGroupLayoutAlgorithm}
          showClusterHulls={showClusterHulls}
          onToggleShowClusterHulls={onToggleShowClusterHulls}
          gridMode={gridMode}
          onSetGridMode={onSetGridMode}
          gridSize={gridSize}
          onSetGridSize={onSetGridSize}
          dragZoomEnabled={dragZoomEnabled}
          dragZoomAmount={dragZoomAmount}
          onToggleDragZoom={onToggleDragZoom}
          onSetDragZoomAmount={onSetDragZoomAmount}
          onNewUniverse={onNewUniverse}
          onOpenUniverse={onOpenUniverse}
          onSaveUniverse={onSaveUniverse}
          onExportRdf={onExportRdf}
          onOpenRecentFile={onOpenRecentFile}
          onLoadFromExternalLink={onLoadFromExternalLink}
          onGenerateTestGraph={onGenerateTestGraph}
          onOpenForceSim={onOpenForceSim}
          onAutoLayoutGraph={onAutoLayoutGraph}
          onCondenseNodes={onCondenseNodes}
        />
      </header>
    );
  }

  return (
    <header
      ref={headerRef}
      style={{
        height: `${HEADER_HEIGHT}px`,
        backgroundColor: headerBg,
        color: theme.canvas.bg,

        fontFamily: "'EmOne', sans-serif",
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        position: 'relative',
        zIndex: 11000,
        touchAction: 'manipulation',
      }}
    >
      {/* Menu button container with explicit height */}
      <div style={{
        position: 'relative',
        height: `${HEADER_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center'
      }}>
        <img
          src={logos[currentLogoIndex]}
          alt=""
          style={{
            height: `${HEADER_HEIGHT}px`,
            width: `${HEADER_HEIGHT}px`,
            objectFit: 'contain',
            cursor: isAnimating ? 'default' : 'pointer',
            display: 'block' // Prevent any inline spacing issues
          }}
          onClick={toggleMenu}
          onPointerDown={(e) => { if (e.pointerType !== 'mouse') { e.stopPropagation(); toggleMenu(); } }}
          onTouchStart={(e) => { e.stopPropagation(); toggleMenu(); }}
          onContextMenu={handleLogoContextMenu}
        />
        {/* Pass debug props to RedstringMenu here */}
        <RedstringMenu
          isOpen={isMenuOpen}
          onHoverView={(open) => {
            if (!open) {
              closeMenu();
            } else {
              setIsMenuOpen(true);
            }
          }}
          showDebugMenu={showDebugMenu}
          debugMode={debugMode}
          setDebugMode={setDebugMode}
          trackpadZoomEnabled={trackpadZoomEnabled}
          onToggleTrackpadZoom={onToggleTrackpadZoom}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          showConnectionNames={showConnectionNames}
          onToggleShowConnectionNames={onToggleShowConnectionNames}
          darkMode={darkMode}
          onToggleDarkMode={onToggleDarkMode}
          enableAutoRouting={enableAutoRouting}
          routingStyle={routingStyle}
          manhattanBends={manhattanBends}
          onToggleEnableAutoRouting={onToggleEnableAutoRouting}
          onSetRoutingStyle={onSetRoutingStyle}
          onSetManhattanBends={onSetManhattanBends}
          onSetCleanLaneSpacing={onSetCleanLaneSpacing}
          cleanLaneSpacing={cleanLaneSpacing}
          groupLayoutAlgorithm={groupLayoutAlgorithm}
          onSetGroupLayoutAlgorithm={onSetGroupLayoutAlgorithm}
          showClusterHulls={showClusterHulls}
          onToggleShowClusterHulls={onToggleShowClusterHulls}
          gridMode={gridMode}
          onSetGridMode={onSetGridMode}
          gridSize={gridSize}
          onSetGridSize={onSetGridSize}
          dragZoomEnabled={dragZoomEnabled}
          dragZoomAmount={dragZoomAmount}
          onToggleDragZoom={onToggleDragZoom}
          onSetDragZoomAmount={onSetDragZoomAmount}
          onNewUniverse={onNewUniverse}
          onOpenUniverse={onOpenUniverse}
          onSaveUniverse={onSaveUniverse}
          onExportRdf={onExportRdf}
          onOpenRecentFile={onOpenRecentFile}
          onLoadFromExternalLink={onLoadFromExternalLink}
          onGenerateTestGraph={onGenerateTestGraph}
          onOpenForceSim={onOpenForceSim}
          onAutoLayoutGraph={onAutoLayoutGraph}
          onCondenseNodes={onCondenseNodes}
        />
      </div>

      {/* Inline left-side action buttons (wide layout only). Mirrors the
          right-side wrapper: a flex row anchored next to the logo, floating
          over the tabs container on the shared header background. In
          exclusive mode these collapse into the hamburger menu. */}
      {!isExclusivePanelMode && (
        <div
          style={{
            position: 'absolute',
            left: `${HEADER_HEIGHT}px`,
            top: 0,
            height: `${HEADER_HEIGHT}px`,
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            zIndex: 10002,
          }}
        >
          {[
            { key: 'help', Icon: HelpCircle, iconSize: 22, strokeWidth: 3, title: 'Help & Guide', onClick: () => window.dispatchEvent(new Event('openHelpModal')) },
            { key: 'settings', Icon: Settings, iconSize: 20, strokeWidth: 2.5, title: 'Settings', onClick: () => window.dispatchEvent(new Event('openSettingsModal')) },
            { key: 'all-search', Icon: Search, iconSize: 20, strokeWidth: 2.5, title: 'Search All Things', onClick: () => onOpenAllThingsSearch?.() },
          ].map((action) => (
            <div
              key={action.key}
              title={action.title}
              style={{
                height: `${HEADER_HEIGHT}px`,
                width: `${HEADER_HEIGHT}px`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                backgroundColor: 'transparent',
              }}
              onClick={(e) => {
                e.stopPropagation();
                action.onClick?.();
              }}
              onMouseEnter={(e) => {
                const circle = e.currentTarget.querySelector('.header-btn-circle');
                if (circle) {
                  circle.style.transform = 'scale(1.06)';
                  circle.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
                }
              }}
              onMouseLeave={(e) => {
                const circle = e.currentTarget.querySelector('.header-btn-circle');
                if (circle) {
                  circle.style.transform = 'scale(1)';
                  circle.style.boxShadow = 'none';
                }
              }}
            >
              <div
                className="header-btn-circle"
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: '#ffffff',
                  border: '3px solid #7A0000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'transform 120ms ease, box-shadow 120ms ease',
                }}
              >
                <action.Icon size={action.iconSize} color="#7A0000" strokeWidth={action.strokeWidth} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Scrollable tabs container. The 50vw "padding" is split: left side is
          real CSS padding, right side is an explicit flex spacer (see below).
          iOS WebKit excludes right padding from scrollWidth on flex
          containers, which clamped scrollLeft and produced a right-of-center
          offset when only one tab was present. An actual sibling element
          (spacer) is honored by every engine. */}
      <div
        ref={tabsContainerRefCallback}
        onScroll={handleTabsScroll}
        className="hide-scrollbar"
        style={{
          position: 'absolute',
          left: `${tabsLeftReserve}px`,
          right: `${tabsRightReserve}px`,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingLeft: '50vw',
        }}
      >
        {headerGraphs.map((graph) => {
          const isGraphActive = graph.isActive;

          if (isGraphActive) {
            return (
              <div key={graph.id} ref={activeTabRef} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
                <HeaderGraphTab
                  graph={{
                    ...graph,
                    name: isEditing ? tempTitle : graph.name
                  }}
                  onSelect={() => { }}
                  onDoubleClick={handleTitleDoubleClick}
                  isActive={true}
                  hideText={isEditing}
                  dynamicMaxWidth={activeTabMaxWidth}
                />
                {isEditing && (
                  <input
                    ref={inputRef}
                    type="text"
                    className="editable-title-input"
                    value={tempTitle}
                    onChange={handleTitleChange}
                    onBlur={handleTitleBlur}
                    onKeyDown={handleTitleKeyDown}
                    spellCheck="false"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: '5px',
                      width: 'calc(100% - 10px)',
                      height: '100%',
                      backgroundColor: 'transparent',
                      color: getTextColor(graph.color),
                      textAlign: 'center',
                      boxSizing: 'border-box',
                      padding: '7px 17px',
                      borderRadius: '12px',
                      border: 'none',
                      fontWeight: 'bold',
                      fontSize: '18px',
                      margin: '0',
                      outline: 'none',
                      textShadow: 'none',
                      cursor: 'text',
                    }}
                    autoFocus
                  />
                )}
              </div>
            );
          }

          return (
            <HeaderGraphTab
              key={graph.id}
              graph={graph}
              onSelect={onSetActiveGraph}
              isActive={false}
            />
          );
        })}
        {/* Right-side spacer (functions as paddingRight: 50vw, but as real
            content so iOS WebKit includes it in scrollWidth even with a
            single tab — otherwise scrollLeft gets clamped below the target). */}
        <div aria-hidden="true" style={{ flexShrink: 0, width: '50vw', height: 1 }} />
      </div>

      {/* Inline right-side action buttons (wide layout only). Pre-refactor
          ordering: Component Search, Plus, Bookmark, rendered in a flex row
          anchored to the right edge. */}
      {!isExclusivePanelMode && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            height: `${HEADER_HEIGHT}px`,
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            zIndex: 10002,
          }}
        >
          {[
            { key: 'comp-search', Icon: ScanSearch, iconSize: 22, strokeWidth: 3, title: activeGraph ? `Search ${activeGraph.name}` : 'Search Components', onClick: () => onOpenComponentSearch?.() },
            { key: 'plus', Icon: Plus, iconSize: 22, strokeWidth: 3, title: 'Create New Thing', onClick: () => onCreateNewThing?.() },
            { key: 'bookmark', Icon: Bookmark, iconSize: 22, strokeWidth: 3, title: bookmarkActive ? 'Remove Bookmark' : 'Add Bookmark', onClick: () => onBookmarkToggle?.(), iconExtra: { fill: bookmarkActive ? '#7A0000' : 'none' } },
          ].map((action) => (
            <div
              key={action.key}
              title={action.title}
              style={{
                height: `${HEADER_HEIGHT}px`,
                width: `${HEADER_HEIGHT}px`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                backgroundColor: 'transparent',
              }}
              onClick={(e) => {
                e.stopPropagation();
                action.onClick?.();
              }}
              onMouseEnter={(e) => {
                const circle = e.currentTarget.querySelector('.header-btn-circle');
                if (circle) {
                  circle.style.transform = 'scale(1.06)';
                  circle.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
                }
              }}
              onMouseLeave={(e) => {
                const circle = e.currentTarget.querySelector('.header-btn-circle');
                if (circle) {
                  circle.style.transform = 'scale(1)';
                  circle.style.boxShadow = 'none';
                }
              }}
            >
              <div
                className="header-btn-circle"
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: '#ffffff',
                  border: '3px solid #7A0000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'transform 120ms ease, box-shadow 120ms ease',
                }}
              >
                <action.Icon size={action.iconSize} color="#7A0000" strokeWidth={action.strokeWidth} {...(action.iconExtra || {})} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hamburger menu (right side, exclusive panel mode only): consolidates
          header actions into a vertical dropdown. In wide mode the same
          actions live as inline buttons rendered above. */}
      {isExclusivePanelMode && (
      <div
        ref={hamburgerWrapperRef}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          height: `${HEADER_HEIGHT}px`,
          width: `${HEADER_HEIGHT}px`,
          zIndex: 10003,
        }}
      >
        {/* Hamburger trigger */}
        <div
          title={isHamburgerOpen ? 'Close menu' : 'Open menu'}
          style={{
            height: `${HEADER_HEIGHT}px`,
            width: `${HEADER_HEIGHT}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            backgroundColor: 'transparent',
            pointerEvents: 'auto',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setIsHamburgerOpen(prev => !prev);
          }}
          onMouseEnter={(e) => {
            const circle = e.currentTarget.querySelector('.header-btn-circle');
            if (circle) {
              circle.style.transform = 'scale(1.06)';
              circle.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
            }
          }}
          onMouseLeave={(e) => {
            const circle = e.currentTarget.querySelector('.header-btn-circle');
            if (circle) {
              circle.style.transform = 'scale(1)';
              circle.style.boxShadow = 'none';
            }
          }}
        >
          <div
            className="header-btn-circle"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              border: '3px solid #7A0000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              transition: 'transform 120ms ease, box-shadow 120ms ease',
            }}
          >
            <Menu
              size={22}
              color="#7A0000"
              strokeWidth={3}
              style={{
                position: 'absolute',
                opacity: isHamburgerOpen ? 0 : 1,
                transform: isHamburgerOpen ? 'rotate(90deg) scale(0.6)' : 'rotate(0deg) scale(1)',
                transition: 'opacity 120ms ease, transform 160ms cubic-bezier(0.4, 0.0, 0.2, 1)',
              }}
            />
            <CircleX
              size={22}
              color="#7A0000"
              strokeWidth={3}
              style={{
                position: 'absolute',
                opacity: isHamburgerOpen ? 1 : 0,
                transform: isHamburgerOpen ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0.6)',
                transition: 'opacity 120ms ease, transform 160ms cubic-bezier(0.4, 0.0, 0.2, 1)',
              }}
            />
          </div>
        </div>

        {/* Vertical dropdown */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: `${HEADER_HEIGHT}px`,
            width: `${HEADER_HEIGHT}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: isHamburgerOpen ? 'auto' : 'none',
            zIndex: 10003,
          }}
        >
          {[
            { key: 'plus', Icon: Plus, iconSize: 22, strokeWidth: 3, title: 'Create New Thing', onClick: () => onCreateNewThing?.() },
            { key: 'bookmark', Icon: Bookmark, iconSize: 22, strokeWidth: 3, title: bookmarkActive ? 'Remove Bookmark' : 'Add Bookmark', onClick: () => onBookmarkToggle?.(), iconExtra: { fill: bookmarkActive ? '#7A0000' : 'none' } },
            { key: 'all-search', Icon: Search, iconSize: 20, strokeWidth: 2.5, title: 'Search All Things', onClick: () => onOpenAllThingsSearch?.() },
            { key: 'comp-search', Icon: ScanSearch, iconSize: 22, strokeWidth: 3, title: activeGraph ? `Search ${activeGraph.name}` : 'Search Components', onClick: () => onOpenComponentSearch?.() },
            { key: 'settings', Icon: Settings, iconSize: 20, strokeWidth: 2.5, title: 'Settings', onClick: () => window.dispatchEvent(new Event('openSettingsModal')) },
            { key: 'help', Icon: HelpCircle, iconSize: 22, strokeWidth: 3, title: 'Help & Guide', onClick: () => window.dispatchEvent(new Event('openHelpModal')) },
          ].map((action, idx, arr) => {
            const delay = isHamburgerOpen ? `${idx * 25}ms` : `${(arr.length - 1 - idx) * 25}ms`;
            return (
              <div
                key={action.key}
                title={action.title}
                style={{
                  height: `${HEADER_HEIGHT}px`,
                  width: `${HEADER_HEIGHT}px`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  backgroundColor: 'transparent',
                  opacity: isHamburgerOpen ? 1 : 0,
                  transform: isHamburgerOpen ? 'translateY(0) scale(1)' : 'translateY(-12px) scale(0.85)',
                  transition: 'opacity 140ms ease, transform 140ms ease',
                  transitionDelay: delay,
                  pointerEvents: isHamburgerOpen ? 'auto' : 'none',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick?.();
                  setIsHamburgerOpen(false);
                }}
                onMouseEnter={(e) => {
                  const circle = e.currentTarget.querySelector('.header-btn-circle');
                  if (circle) {
                    circle.style.transform = 'scale(1.06)';
                    circle.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
                  }
                }}
                onMouseLeave={(e) => {
                  const circle = e.currentTarget.querySelector('.header-btn-circle');
                  if (circle) {
                    circle.style.transform = 'scale(1)';
                    circle.style.boxShadow = 'none';
                  }
                }}
              >
                <div
                  className="header-btn-circle"
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    backgroundColor: '#ffffff',
                    border: '3px solid #7A0000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'transform 120ms ease, box-shadow 120ms ease',
                  }}
                >
                  <action.Icon
                    size={action.iconSize}
                    color="#7A0000"
                    strokeWidth={action.strokeWidth}
                    {...(action.iconExtra || {})}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </header>
  );
};

export default Header;