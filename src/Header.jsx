import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useDrop } from 'react-dnd';
import { HEADER_HEIGHT } from './constants';
import RedstringMenu from './RedstringMenu';
import { Bookmark, Plus, ScanSearch, HelpCircle, Bug, Settings, Search, Menu, CircleX } from 'lucide-react';
import { useTheme } from './hooks/useTheme.js';
import useGraphStore from './store/graphStore.js';
import HeaderGraphTab from './HeaderGraphTab';
import { showContextMenu } from './components/GlobalContextMenu';
import { getTextColor, hexToHsl, hslToHex } from './utils/colorUtils.js';
import { haptic, createDetentTrack } from './services/haptics.js';
import { isDebugSettingsUnlocked, setDebugSettingsUnlocked } from './utils/debugUnlock.js';

// Import all logo states
import logo1 from './assets/redstring_button/header_logo_1.svg';
import logo2 from './assets/redstring_button/header_logo_2.svg';
import logo3 from './assets/redstring_button/header_logo_3.svg';
import logo4 from './assets/redstring_button/header_logo_4.svg';
import logo5 from './assets/redstring_button/header_logo_5.svg';
import logo6 from './assets/redstring_button/header_logo_6.svg';
import logo7 from './assets/redstring_button/header_logo_7.svg';

// The one drag type in the app. A header tab's drag is the SAME gesture that
// spawns a Thing on the canvas — the tab carries a prototype, and where you let
// go decides what that means: over the strip it reorders, over the canvas it
// spawns. Only tab drags carry a `graphId`, which is how the strip tells the two
// apart from the panel's saved-node and semantic-concept drags.
const SPAWNABLE_NODE = 'spawnable_node';

// Sentinel for the slot past the last tab. Slots are identified by the tab they
// land IN FRONT OF, because the strip renders a filtered view of openGraphIds —
// an index here is not an index there. See moveGraphTabBefore.
const DROP_AT_END = '__end__';

// How close to an edge of the strip a drag has to get before the strip scrolls
// itself, and how fast it goes at the very edge. Without this a web parked
// off-screen is unreachable by drag: the strip is 50vw-padded on both sides, and
// on touch there is no second pointer to scroll it with.
const TAB_AUTOSCROLL_EDGE_PX = 72;
const TAB_AUTOSCROLL_MAX_PX_PER_FRAME = 14;

// How long the strip keeps re-centring after something changes the tabs' widths.
// HeaderGraphTab transitions `all` over 200ms and an active tab's max-width is
// activeTabMaxWidth against an inactive one's 220px, so a switch between two
// long-named webs moves the geometry for that whole window. Plus margin.
const TAB_TRANSITION_SETTLE_MS = 260;

const Header = ({
  onTitleChange,
  onEditingStateChange,
  headerGraphs,
  onSetActiveGraph,
  // New action props
  onCreateNewThing,
  onOpenComponentSearch,
  onOpenAllThingsSearch,
  // Hover-chip preview (mirrors the pie-menu hover chip in NodeCanvas): fired
  // with { id, label } while hovering a circular header button, null on leave.
  onActionHoverChange,
  // Responsive layout
  isExclusivePanelMode = false,
  // Receive debug props
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
  // Lombardi routing controls
  // Group layout
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
  onExportRedstring,
  onExportJson,
  onExportRdf,
  onExportTrig,
  onExportTtl,
  onExportTxt,
  onOpenRecentFile,
  onLoadFromExternalLink,
  onOpenForceSim,
  onAutoLayoutGraph,
  onCondenseNodes,
  // Open-web tab the game controller's header mode is outlining, or null.
  // Only ever non-null while that mode is active, so the tabs draw no outline
  // during ordinary mouse use.
  gamepadFocusedGraphId = null,
}) => {
  const theme = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHamburgerOpen, setIsHamburgerOpen] = useState(false);
  const hamburgerWrapperRef = useRef(null);
  const [currentLogoIndex, setCurrentLogoIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(false);

  // Detent spacing (px of scrollLeft) for the header tab strip. Tabs run
  // ~150-220px wide, so this is roughly two or three clicks per tab: enough to
  // feel the strip moving without turning into a motor. Sized against the 40ms
  // haptic rate limit — a brisk ~1800px/s flick lands right at the ceiling, and
  // anything denser would just be clipped there anyway.
  const TABS_DETENT_PX = 72;

  const headerRef = useRef(null);
  const tabsScrollContainerRef = useRef(null);
  const tabsScrollTrack = useRef(createDetentTrack('headerScroll', TABS_DETENT_PX));
  // True only while the smooth recenter is animating. Distinguishes it from the
  // instant scrollLeft jumps (initial centering, tab changes), which move the
  // strip without anyone scrolling it and must not click.
  const animatingRecenterRef = useRef(false);
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
      animatingRecenterRef.current = true;

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
          animatingRecenterRef.current = false;
        }
      };

      requestAnimationFrame(animateScroll);
    }
  }, []);

  /**
   * Hold the active tab centred through a layout that is still moving.
   *
   * Tabs animate their width — HeaderGraphTab carries `transition: all 0.2s`,
   * and an active tab's max-width is `activeTabMaxWidth` (up to 800px) against
   * an inactive one's 220px. So on a graph switch the outgoing tab SHRINKS back
   * to 220px over 200ms while the incoming one grows, and the strip's geometry
   * keeps changing long after the commit. A single rAF centres against the
   * pre-transition layout and the tab then slides out from under it.
   *
   * This only started mattering when webs began opening NEXT TO the active one.
   * A newly opened tab used to be unshifted to index 0, where its offsetLeft is
   * just the leading padding and nothing to its left could move it — so one
   * measurement was always right. It now lands immediately right of the tab
   * that is shrinking, which drags it left by the whole width delta. Only long
   * names show it, because only they are wide enough for the max-width to clamp.
   *
   * The tab's own growth is separately caught by the ResizeObserver below; what
   * that observer cannot see is a NEIGHBOUR resizing, which is this.
   */
  const centerSettleRef = useRef(null);
  // Which run owns `isProgrammaticScroll`. A run that is cancelled and
  // immediately replaced (switch graphs twice in a row) must not have its
  // trailing release clear the flag out from under its successor.
  const centerSettleGenRef = useRef(0);

  const releaseProgrammaticScroll = useCallback((gen) => {
    // Delayed: scroll events for a scrollLeft write arrive a tick later, and
    // they have to still see the flag to stay silent.
    setTimeout(() => {
      if (centerSettleGenRef.current !== gen) return;
      isProgrammaticScroll.current = false;
    }, 50);
  }, []);

  const cancelHoldCenter = useCallback(() => {
    if (!centerSettleRef.current) return;
    cancelAnimationFrame(centerSettleRef.current);
    centerSettleRef.current = null;
    releaseProgrammaticScroll(centerSettleGenRef.current);
  }, [releaseProgrammaticScroll]);

  const holdCenter = useCallback(() => {
    if (centerSettleRef.current) cancelAnimationFrame(centerSettleRef.current);
    const gen = ++centerSettleGenRef.current;
    const start = performance.now();
    // Held for the whole run rather than re-armed per frame, so the strip's
    // detent track stays silent and the three-second idle recentre stays unarmed.
    isProgrammaticScroll.current = true;

    const step = () => {
      const container = tabsScrollContainerRef.current;
      const activeTab = activeTabRef.current;
      if (container && activeTab) {
        const containerRect = container.getBoundingClientRect();
        const tabCenterInContent = activeTab.offsetLeft + activeTab.offsetWidth / 2;
        container.scrollLeft = Math.max(
          0,
          containerRect.left + tabCenterInContent - window.innerWidth / 2
        );
      }
      if (performance.now() - start < TAB_TRANSITION_SETTLE_MS) {
        centerSettleRef.current = requestAnimationFrame(step);
      } else {
        centerSettleRef.current = null;
        releaseProgrammaticScroll(gen);
      }
    };

    centerSettleRef.current = requestAnimationFrame(step);
  }, [releaseProgrammaticScroll]);

  useEffect(() => () => {
    if (centerSettleRef.current) cancelAnimationFrame(centerSettleRef.current);
  }, []);

  // Scroll event handler with 3-second timeout to recenter
  const handleTabsScroll = useCallback(() => {
    // Detents first, and deliberately ahead of the programmatic-scroll guard:
    // the recenter animation writes scrollLeft frame by frame, so its scroll
    // events are exactly what makes the strip tick as it spins back.
    const el = tabsScrollContainerRef.current;
    if (el) {
      if (isProgrammaticScroll.current && !animatingRecenterRef.current) {
        // An instant jump — reseed the lattice at the new position so the jump
        // itself doesn't fire, and so the next real scroll ticks from here.
        tabsScrollTrack.current.reset(el.scrollLeft);
      } else {
        tabsScrollTrack.current.update(el.scrollLeft);
      }
    }

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

    // Read at click time: Settings can have unlocked or relocked this since the
    // last render, and this menu is built fresh on every right-click anyway.
    const unlocked = isDebugSettingsUnlocked();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: unlocked ? 'Hide Debug Settings' : 'Show Debug Settings',
        icon: <Bug size={14} />,
        action: () => {
          setDebugSettingsUnlocked(!unlocked);
          if (!unlocked) {
            window.dispatchEvent(new CustomEvent('openSettingsModal', { detail: { section: 'debug' } }));
          }
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

  // Publish the header colour so chrome outside the React tree can match it —
  // notably the iOS safe-area gaps above and below the web view, which paint
  // the <body> background. This is dynamic in two ways: it follows dark mode
  // AND the active graph's colour, so it has to be pushed on every change
  // rather than read once.
  useEffect(() => {
    document.documentElement.style.setProperty('--rs-header-bg', headerBg);
  }, [headerBg]);

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

    // Center on graph change, and KEEP centering for the length of the tabs'
    // width transition — the outgoing tab is shrinking out of the incoming
    // one's offsetLeft the whole time. See holdCenter.
    holdCenter();

    // Still observe the active tab's own size on top of that: it catches the
    // slower settles the transition doesn't cover (a viewport resize changing
    // activeTabMaxWidth, a font landing late).
    const tabEl = activeTabRef.current;
    let resizeObserver;
    if (tabEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        // Silent while holdCenter owns the scroll, or the two fight for it.
        if (centerSettleRef.current) return;
        scrollToCenter(true);
      });
      resizeObserver.observe(tabEl);
    }

    return () => {
      cancelHoldCenter();
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [activeGraph?.id, scrollToCenter, holdCenter, cancelHoldCenter, imagesLoaded]);

  // Identity of the strip's ORDER, so effects can watch reordering specifically
  // rather than re-running on every unrelated change to headerGraphs.
  const headerOrderKey = useMemo(() => headerGraphs.map(g => g.id).join('|'), [headerGraphs]);

  // Keep the controller's outlined tab on screen. The strip only ever centred
  // the ACTIVE tab, which is not where the pad is standing once it steps away
  // from it — and the shoulders can now carry a tab clean off the edge. Nudged
  // just inside the edge rather than centred, so stepping along the strip reads
  // as walking it instead of as the strip spinning under you.
  useEffect(() => {
    if (!gamepadFocusedGraphId || !imagesLoaded) return;
    const container = tabsScrollContainerRef.current;
    if (!container) return;
    const el = Array.from(container.querySelectorAll('[data-header-tab-id]'))
      .find(n => n.getAttribute('data-header-tab-id') === gamepadFocusedGraphId);
    if (!el) return;

    const margin = 24;
    const rect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    let delta = 0;
    if (rect.left < containerRect.left + margin) delta = rect.left - (containerRect.left + margin);
    else if (rect.right > containerRect.right - margin) delta = rect.right - (containerRect.right - margin);
    if (!delta) return;

    isProgrammaticScroll.current = true;
    container.scrollLeft += delta;
    const timer = setTimeout(() => { isProgrammaticScroll.current = false; }, 50);
    return () => clearTimeout(timer);
  }, [gamepadFocusedGraphId, headerOrderKey, imagesLoaded]);

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

  // Re-centre the strip on the RENAMING FIELD, not on the tab behind it.
  //
  // The field grows out of the tab to the right: it is absolutely positioned
  // inside the tab, so the tab keeps whatever truncated width it had and the
  // strip's layout never changes — which means the existing centring, which
  // measures the tab and its ResizeObserver, never fires. On a long name that
  // had already been cut short with an ellipsis, the field opened well right of
  // centre before a single character was typed. Centre on the field the moment
  // it opens, and keep centring as it grows under the keystrokes, so the name
  // expands symmetrically out of the middle of the header.
  useEffect(() => {
    if (!isEditing || !imagesLoaded) return;
    const container = tabsScrollContainerRef.current;
    const input = inputRef.current;
    if (!container || !input) return;

    // Next frame: the sibling effect above sizes the field in this same commit,
    // and there is nothing to centre until it has its width.
    const frame = requestAnimationFrame(() => {
      const rect = input.getBoundingClientRect();
      if (!rect.width) return;
      // Client-rect maths rather than offsetLeft: the field's offsetParent is
      // the tab wrapper, so its offsetLeft is a constant 5px and says nothing
      // about where it sits in the strip.
      const delta = (rect.left + rect.width / 2) - window.innerWidth / 2;
      if (Math.abs(delta) < 1) return;
      isProgrammaticScroll.current = true;
      container.scrollLeft = Math.max(0, container.scrollLeft + delta);
    });
    const timer = setTimeout(() => { isProgrammaticScroll.current = false; }, 80);

    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [isEditing, tempTitle, imagesLoaded]);

  // ...and put the strip back on the TAB when the rename ends.
  //
  // The symmetric half of the effect above, and it has to be explicit for the
  // same reason that one does: the field was what the strip was centred on, and
  // the tab it collapses back to is a different width. On a name long enough to
  // be ellipsized it is the SAME width it was before, so the graph never
  // changed and the tab never resized — neither of the two existing recentring
  // paths fires, and the strip was left sitting wherever the field had pushed
  // it. Clicking away from a long name therefore committed it off-centre.
  //
  // Fires on Escape as well as on commit: both end in isEditing going false,
  // which is the only thing this watches.
  const wasEditingRef = useRef(false);
  useEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = isEditing;
    if (!imagesLoaded || isEditing || !wasEditing) return;

    // holdCenter rather than a single measurement: committing a rename changes
    // the name, so the tab's clamped width transitions to its new value over
    // the same 200ms, and one frame would centre against the old one.
    holdCenter();
    return () => cancelHoldCenter();
  }, [isEditing, imagesLoaded, holdCenter, cancelHoldCenter]);

  // ─── Reordering the strip by drag ──────────────────────────────────────────
  //
  // The strip IS the order: both this header and the left panel's "Open Things"
  // list render `openGraphIds` straight through, so one write restructures both.
  // The drop is committed once, on release, rather than shuffling live on every
  // hover tick — partly so a tab dragged out to the canvas to spawn a Thing
  // doesn't silently reorder the strip on its way past the other tabs, and
  // partly so one gesture is one store write.

  const moveGraphTabBefore = useGraphStore(state => state.moveGraphTabBefore);

  // The tab the drop caret currently sits in front of, DROP_AT_END for the far
  // right slot, or null when no reorderable drag is over the strip. Mirrored in
  // a ref so the slot-crossing haptic fires from the event rather than from a
  // state updater — StrictMode runs updaters twice, and a double tick is audible.
  const [dropTargetId, setDropTargetId] = useState(null);
  const dropTargetRef = useRef(null);
  const autoScrollRef = useRef({ raf: null, x: null });

  const setDropTarget = useCallback((next) => {
    if (dropTargetRef.current === next) return;
    // A detent per slot crossed — the same feedback flicking the strip gives,
    // which is what makes the reorder legible with no cursor on a touch device.
    if (dropTargetRef.current !== null && next !== null) haptic('headerScroll');
    dropTargetRef.current = next;
    setDropTargetId(next);
  }, []);

  /** Which slot a pointer x lands in: the first tab whose midpoint it hasn't passed. */
  const computeDropTargetId = useCallback((clientX) => {
    const container = tabsScrollContainerRef.current;
    if (!container) return DROP_AT_END;
    for (const el of container.querySelectorAll('[data-header-tab-id]')) {
      const rect = el.getBoundingClientRect();
      if (clientX < (rect.left + rect.right) / 2) return el.getAttribute('data-header-tab-id');
    }
    return DROP_AT_END;
  }, []);

  const stopTabAutoScroll = useCallback(() => {
    const raf = autoScrollRef.current.raf;
    autoScrollRef.current.raf = null;
    autoScrollRef.current.x = null;
    if (!raf) return; // never started — don't touch a guard we didn't set
    cancelAnimationFrame(raf);
    // Release the programmatic-scroll guard a beat later, once the scroll events
    // this loop generated have drained — otherwise the next real scroll is eaten.
    setTimeout(() => { isProgrammaticScroll.current = false; }, 50);
  }, []);

  const runTabAutoScroll = useCallback(() => {
    const el = tabsScrollContainerRef.current;
    const x = autoScrollRef.current.x;
    if (!el || x == null) { autoScrollRef.current.raf = null; return; }

    const rect = el.getBoundingClientRect();
    let dx = 0;
    if (x < rect.left + TAB_AUTOSCROLL_EDGE_PX) {
      dx = -((rect.left + TAB_AUTOSCROLL_EDGE_PX - x) / TAB_AUTOSCROLL_EDGE_PX);
    } else if (x > rect.right - TAB_AUTOSCROLL_EDGE_PX) {
      dx = (x - (rect.right - TAB_AUTOSCROLL_EDGE_PX)) / TAB_AUTOSCROLL_EDGE_PX;
    }
    if (dx) {
      // Flagged programmatic so it neither ticks the scroll detents nor arms the
      // three-second recenter, which would yank the strip out from under the drag.
      isProgrammaticScroll.current = true;
      el.scrollLeft += Math.max(-1, Math.min(1, dx)) * TAB_AUTOSCROLL_MAX_PX_PER_FRAME;
    }
    autoScrollRef.current.raf = requestAnimationFrame(runTabAutoScroll);
  }, []);

  // A drag is a reorder only if it started on a tab of a web that is still open.
  // Everything else riding this drag type (saved Things, semantic concepts) falls
  // through to the canvas, which is the only place it means anything.
  const isReorderDrag = useCallback((item) => {
    const id = item?.graphId;
    return !!id && headerGraphs.some(g => g.id === id);
  }, [headerGraphs]);

  const [{ isReorderOver }, tabStripDrop] = useDrop(() => ({
    accept: SPAWNABLE_NODE,
    canDrop: (item) => isReorderDrag(item),
    hover: (item, monitor) => {
      if (!isReorderDrag(item)) return;
      const offset = monitor.getClientOffset();
      if (!offset) return;
      autoScrollRef.current.x = offset.x;
      if (!autoScrollRef.current.raf) {
        autoScrollRef.current.raf = requestAnimationFrame(runTabAutoScroll);
      }
      setDropTarget(computeDropTargetId(offset.x));
    },
    drop: (item) => {
      stopTabAutoScroll();
      // The slot the caret was last showing — what the user actually saw when
      // they let go, rather than a fresh measurement of a strip that is about
      // to lose the caret's 14px of gap.
      const target = dropTargetRef.current;
      setDropTarget(null);
      if (!isReorderDrag(item) || target === null) return undefined;
      haptic('nodeDrop', { force: true });
      moveGraphTabBefore(item.graphId, target === DROP_AT_END ? null : target);
      // Claimed, so nothing downstream treats this as a spawn.
      return { reordered: true };
    },
    collect: (monitor) => ({
      isReorderOver: monitor.isOver() && isReorderDrag(monitor.getItem()),
    }),
  }), [isReorderDrag, computeDropTargetId, setDropTarget, runTabAutoScroll, stopTabAutoScroll, moveGraphTabBefore]);

  // Dragging back out of the strip (or dropping elsewhere) takes the caret and
  // the auto-scroll with it — react-dnd fires no "leave" of its own.
  useEffect(() => {
    if (isReorderOver) return;
    setDropTarget(null);
    stopTabAutoScroll();
  }, [isReorderOver, setDropTarget, stopTabAutoScroll]);

  useEffect(() => () => stopTabAutoScroll(), [stopTabAutoScroll]);

  /** Attaches the wheel listener and the reorder drop target to the same node. */
  const attachTabsContainer = useCallback((node) => {
    tabsContainerRefCallback(node);
    tabStripDrop(node);
  }, [tabsContainerRefCallback, tabStripDrop]);

  /** The insertion caret: a bar that opens a gap where the tab would land. */
  const renderDropCaret = (key) => (
    <div
      key={key}
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: '4px',
        height: '32px',
        borderRadius: '2px',
        backgroundColor: '#bdb5b5',
        boxShadow: '0 0 8px rgba(0,0,0,0.35)',
      }}
    />
  );

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
        {/* The button stays in the header. The class is a handle for the game
            controller, which opens this menu by clicking it rather than by
            reaching into Header's local isMenuOpen state. */}
        <img
          className="header-logo-button"
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

        <RedstringMenu
          isOpen={isMenuOpen}
          onHoverView={(open) => {
            if (!open) {
              closeMenu();
            } else {
              setIsMenuOpen(true);
            }
          }}
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
          onExportRedstring={onExportRedstring}
          onExportJson={onExportJson}
          onExportRdf={onExportRdf}
          onExportTrig={onExportTrig}
          onExportTtl={onExportTtl}
          onExportTxt={onExportTxt}
          onOpenRecentFile={onOpenRecentFile}
          onLoadFromExternalLink={onLoadFromExternalLink}
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
        <RedstringMenu
          isOpen={isMenuOpen}
          onHoverView={(open) => {
            if (!open) {
              closeMenu();
            } else {
              setIsMenuOpen(true);
            }
          }}
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
          onExportRedstring={onExportRedstring}
          onExportJson={onExportJson}
          onExportRdf={onExportRdf}
          onExportTrig={onExportTrig}
          onExportTtl={onExportTtl}
          onExportTxt={onExportTxt}
          onOpenRecentFile={onOpenRecentFile}
          onLoadFromExternalLink={onLoadFromExternalLink}
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
              className="header-action-btn"
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
                haptic('menuSelect');
                // Also raise the label chip here, not just on mouseenter. Touch
                // only reaches mouseenter via a synthetic event, which is not
                // something to depend on — and on a no-hover device this is the
                // signal that gives the button a name before it retracts.
                onActionHoverChange?.({ id: `header-${action.key}`, label: action.title });
                action.onClick?.();
              }}
              onMouseEnter={(e) => {
                const circle = e.currentTarget.querySelector('.header-btn-circle');
                if (circle) {
                  circle.style.transform = 'scale(1.06)';
                  circle.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
                }
                onActionHoverChange?.({ id: `header-${action.key}`, label: action.title });
              }}
              onMouseLeave={(e) => {
                const circle = e.currentTarget.querySelector('.header-btn-circle');
                if (circle) {
                  circle.style.transform = 'scale(1)';
                  circle.style.boxShadow = 'none';
                }
                onActionHoverChange?.(null);
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
        ref={attachTabsContainer}
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
          // The caret renders as a real flex child rather than an overlay, so
          // the tabs actually part to make room for the one being dropped.
          const caret = dropTargetId === graph.id ? renderDropCaret(`caret-${graph.id}`) : null;

          if (isGraphActive) {
            return (
              <React.Fragment key={graph.id}>
                {caret}
                <div
                  ref={activeTabRef}
                  data-header-tab-id={graph.id}
                  style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}
                >
                  <HeaderGraphTab
                    graph={{
                      ...graph,
                      name: isEditing ? tempTitle : graph.name
                    }}
                    onSelect={() => { }}
                    onDoubleClick={handleTitleDoubleClick}
                    isActive={true}
                    isGamepadFocused={gamepadFocusedGraphId === graph.id}
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
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={graph.id}>
              {caret}
              <div data-header-tab-id={graph.id} style={{ display: 'inline-block', flexShrink: 0 }}>
                <HeaderGraphTab
                  graph={graph}
                  onSelect={onSetActiveGraph}
                  isActive={false}
                  isGamepadFocused={gamepadFocusedGraphId === graph.id}
                />
              </div>
            </React.Fragment>
          );
        })}
        {dropTargetId === DROP_AT_END && renderDropCaret('caret-end')}
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
              className="header-action-btn"
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
                haptic('menuSelect');
                // Also raise the label chip here, not just on mouseenter. Touch
                // only reaches mouseenter via a synthetic event, which is not
                // something to depend on — and on a no-hover device this is the
                // signal that gives the button a name before it retracts.
                onActionHoverChange?.({ id: `header-${action.key}`, label: action.title });
                action.onClick?.();
              }}
              onMouseEnter={(e) => {
                const circle = e.currentTarget.querySelector('.header-btn-circle');
                if (circle) {
                  circle.style.transform = 'scale(1.06)';
                  circle.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
                }
                onActionHoverChange?.({ id: `header-${action.key}`, label: action.title });
              }}
              onMouseLeave={(e) => {
                const circle = e.currentTarget.querySelector('.header-btn-circle');
                if (circle) {
                  circle.style.transform = 'scale(1)';
                  circle.style.boxShadow = 'none';
                }
                onActionHoverChange?.(null);
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
        {/* Hamburger trigger. Classed so the game controller can open the
            collapsed action column the same way a tap does — see
            utils/gamepadMenuNav.js. */}
        <div
          className="header-hamburger-button"
          title={isHamburgerOpen ? 'Close Menu' : 'Open Menu'}
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
            haptic('menuSelect');
            // Label describes the state the tap produces, matching mouseenter's
            // "what will this do" phrasing.
            onActionHoverChange?.({ id: 'header-hamburger', label: !isHamburgerOpen ? 'Close Menu' : 'Open Menu' });
            setIsHamburgerOpen(prev => !prev);
          }}
          onMouseEnter={(e) => {
            const circle = e.currentTarget.querySelector('.header-btn-circle');
            if (circle) {
              circle.style.transform = 'scale(1.06)';
              circle.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
            }
            onActionHoverChange?.({ id: 'header-hamburger', label: isHamburgerOpen ? 'Close Menu' : 'Open Menu' });
          }}
          onMouseLeave={(e) => {
            const circle = e.currentTarget.querySelector('.header-btn-circle');
            if (circle) {
              circle.style.transform = 'scale(1)';
              circle.style.boxShadow = 'none';
            }
            onActionHoverChange?.(null);
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
                className="header-action-btn"
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
                  haptic('menuSelect');
                  // The hamburger is the primary surface on mobile, so these are
                  // exactly the buttons that need to say what they are. The chip
                  // outlives the menu closing beneath it.
                  onActionHoverChange?.({ id: `header-${action.key}`, label: action.title });
                  action.onClick?.();
                  setIsHamburgerOpen(false);
                }}
                onMouseEnter={(e) => {
                  const circle = e.currentTarget.querySelector('.header-btn-circle');
                  if (circle) {
                    circle.style.transform = 'scale(1.06)';
                    circle.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
                  }
                  onActionHoverChange?.({ id: `header-${action.key}`, label: action.title });
                }}
                onMouseLeave={(e) => {
                  const circle = e.currentTarget.querySelector('.header-btn-circle');
                  if (circle) {
                    circle.style.transform = 'scale(1)';
                    circle.style.boxShadow = 'none';
                  }
                  onActionHoverChange?.(null);
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