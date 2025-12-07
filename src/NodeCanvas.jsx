import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { Lethargy } from 'lethargy';
import './NodeCanvas.css';
import { X } from 'lucide-react';
import Header from './Header.jsx';
// DebugOverlay import removed - debug mode disabled
import { useCanvasWorker } from './useCanvasWorker.js';
import Node from './Node.jsx';
import PlusSign from './PlusSign.jsx'; // Import the new PlusSign component
import VideoNodeAnimation from './VideoNodeAnimation.jsx'; // Import the video animation component
import PieMenu from './PieMenu.jsx'; // Import the PieMenu component
import AbstractionCarousel from './AbstractionCarousel.jsx'; // Import the AbstractionCarousel component
import AbstractionControlPanel from './AbstractionControlPanel.jsx'; // Import the AbstractionControlPanel component
import NodeControlPanel from './NodeControlPanel.jsx';
import ConnectionControlPanel from './ConnectionControlPanel.jsx';
import UnifiedBottomControlPanel from './UnifiedBottomControlPanel.jsx';
import EdgeGlowIndicator from './components/EdgeGlowIndicator.jsx'; // Import the EdgeGlowIndicator component
import BackToCivilization from './BackToCivilization.jsx'; // Import the BackToCivilization component
import HoverVisionAid from './components/HoverVisionAid.jsx'; // Import the HoverVisionAid component
import { getNodeDimensions } from './utils.js';
import { getPrototypeIdFromItem } from './utils/abstraction.js';
import { analyzeNodeDistribution, getClusterBoundingBox } from './utils/clusterAnalysis.js';
import { v4 as uuidv4 } from 'uuid'; // Import UUID generator
import { Edit3, Trash2, Link, Package, PackageOpen, Expand, ArrowUpFromDot, Triangle, Layers, ArrowLeft, SendToBack, ArrowBigRightDash, Palette, MoreHorizontal, Bookmark, Plus, CornerUpLeft, CornerDownLeft, Merge, Undo2, Clock } from 'lucide-react'; // Icons for PieMenu
import ColorPicker from './ColorPicker';
import { useDrop } from 'react-dnd';
import { fetchOrbitCandidatesForPrototype } from './services/orbitResolver.js';
import { showContextMenu } from './components/GlobalContextMenu';
import * as fileStorage from './store/fileStorage.js';
import AutoGraphModal from './components/AutoGraphModal';
import ForceSimulationModal from './components/ForceSimulationModal';
import { parseInputData, generateGraph } from './services/autoGraphGenerator';
import { applyLayout, FORCE_LAYOUT_DEFAULTS } from './services/graphLayoutService.js';
import { NavigationMode, calculateNavigationParams } from './services/canvasNavigationService.js';

// Import Zustand store and selectors/actions
import useGraphStore, {
  getActiveGraphId,
  getHydratedNodesForGraph, // New selector
  getEdgesForGraph,
  getNodePrototypeById, // New selector for prototypes
} from "./store/graphStore.jsx";
import { shallow } from 'zustand/shallow';

import {
  NODE_WIDTH,
  NODE_HEIGHT,
  LONG_PRESS_DURATION,
  LERP_SPEED,
  HEADER_HEIGHT,
  MAX_ZOOM,
  MOVEMENT_THRESHOLD,
  SCROLL_SENSITIVITY,
  PLUS_SIGN_SIZE,
  PLUS_SIGN_ANIMATION_DURATION,
  NODE_PADDING,
  NODE_CORNER_RADIUS,
  NAME_AREA_FACTOR,
  EXPANDED_NODE_WIDTH,
  AVERAGE_CHAR_WIDTH,
  WRAPPED_NODE_HEIGHT,
  LINE_HEIGHT_ESTIMATE,
  EDGE_MARGIN,
  TRACKPAD_ZOOM_SENSITIVITY,
  PAN_DRAG_SENSITIVITY,
  SMOOTH_MOUSE_WHEEL_ZOOM_SENSITIVITY,
  NODE_DEFAULT_COLOR,
  CONNECTION_DEFAULT_COLOR,
  MODAL_CLOSE_ICON_SIZE
} from './constants';

import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useViewportBounds } from './hooks/useViewportBounds';
import { useNodeActions } from './hooks/useNodeActions';
import { useControlPanelActions } from './hooks/useControlPanelActions';
import { interpolateColor } from './utils/canvas/colorUtils.js';
import { getPortPosition, calculateStaggeredPosition } from './utils/canvas/portPositioning.js';
import { computeCleanPolylineFromPorts, generateManhattanRoutingPath, generateCleanRoutingPath } from './utils/canvas/edgeRouting.js';
import * as GeometryUtils from './utils/canvas/geometryUtils.js';
import Panel from './Panel'; // This is now used for both sides
import TypeList from './TypeList'; // Re-add TypeList component
import SaveStatusDisplay from './SaveStatusDisplay'; // Import the save status display
import NodeSelectionGrid from './NodeSelectionGrid'; // Import the new node selection grid
import UnifiedSelector from './UnifiedSelector'; // Import the new unified selector
import OrbitOverlay from './components/OrbitOverlay.jsx';
import AlphaOnboardingModal from './components/AlphaOnboardingModal.jsx';
import HelpModal from './components/HelpModal.jsx';
import CanvasConfirmDialog from './components/shared/CanvasConfirmDialog.jsx';


const SPAWNABLE_NODE = 'spawnable_node';

// Platform detection (guarded for SSR)
const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0;
const isMac = /Mac/i.test(userAgent);
const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (isMac && maxTouchPoints > 1);
const isAndroid = /Android/i.test(userAgent);

// Sensitivity constants
const MOUSE_WHEEL_ZOOM_SENSITIVITY = 1;        // Sensitivity for standard mouse wheel zooming
const KEYBOARD_PAN_SPEED = 12;                  // for keyboard panning (much faster)
const KEYBOARD_ZOOM_SPEED = 0.01;               // for keyboard zooming (extra smooth)
const TOUCH_PINCH_SENSITIVITY = isIOS ? 0.11 : 0.24;           // approach factor toward target zoom per frame
const TOUCH_PINCH_MAX_RATIO_STEP = isIOS ? 0.28 : 0.6;         // overall clamp when deriving target zoom from initial distance
const TOUCH_PINCH_CENTER_SMOOTHING = isIOS ? 0.05 : 0.03;      // low-pass filter for pinch midpoint movement
const TOUCH_PAN_DRAG_SENSITIVITY = isIOS ? 0.75 : 1.05;        // per-move multiplier for single-finger touch panning
const PAN_MOMENTUM_MIN_SPEED = 0.01;            // px/ms threshold before momentum stops (lowered for touch)
const TOUCH_PAN_FRICTION = 0.92;                // per-frame retention for touch glide (higher = longer glide)
const TRACKPAD_PAN_FRICTION = 0.94;             // per-frame retention for trackpad glide
const PAN_MOMENTUM_FRAME = 16.67;               // baseline frame duration (ms) for damping scaling
const TOUCH_PAN_MOMENTUM_BOOST = 1.5;           // minimal boost for natural touch momentum feel
const TRACKPAD_PAN_MOMENTUM_BOOST = 1.1;        // marginally higher boost for precision trackpads

function NodeCanvas() {
  // CULLING DISABLE FLAG - Set to true to enable culling, false to disable
  const ENABLE_CULLING = false;

  const svgRef = useRef(null);
  const wrapperRef = useRef(null);
  const [orbitData, setOrbitData] = useState({ inner: [], outer: [], all: [] });

  // <<< OPTIMIZED: Use direct getState() calls for stable action methods >>>
  // Zustand actions are stable - we can use direct references instead of subscriptions
  // Use a defensive approach to avoid initialization errors
  const storeActions = useMemo(() => {
    try {
      return useGraphStore.getState();
    } catch (error) {
      console.warn('[NodeCanvas] Store not ready, using fallback actions:', error);
      return {
        updateNodePrototype: () => { },
        updateNodeInstance: () => { },
        updateEdge: () => { },
        addEdge: () => { },
        addNodePrototype: () => { },
        addNodeInstance: () => { },
        removeNodeInstance: () => { },
        forceDeleteNodeInstance: () => { },
        removeEdge: () => { },
        updateGraph: () => { },
        createNewGraph: () => { },
        setActiveGraph: () => { },
        setActiveDefinitionNode: () => { },
        setSelectedEdgeId: () => { },
        setSelectedEdgeIds: () => { },
        addSelectedEdgeId: () => { },
        removeSelectedEdgeId: () => { },
        clearSelectedEdgeIds: () => { },
        setNodeType: () => { },
        openRightPanelNodeTab: () => { },
        createAndAssignGraphDefinition: () => { },
        createAndAssignGraphDefinitionWithoutActivation: () => { },
        closeRightPanelTab: () => { },
        activateRightPanelTab: () => { },
        openGraphTab: () => { },
        moveRightPanelTab: () => { },
        closeGraph: () => { },
        toggleGraphExpanded: () => { },
        toggleSavedNode: () => { },
        toggleSavedGraph: () => { },
        toggleShowConnectionNames: () => { },
        updateMultipleNodeInstancePositions: () => { },
        createGroup: () => { },
        updateGroup: () => { },
        deleteGroup: () => { },
        removeDefinitionFromNode: () => { },
        openGraphTabAndBringToTop: () => { },
        cleanupOrphanedData: () => { },
        restoreFromSession: () => { },
        loadUniverseFromFile: () => { },
        setUniverseError: () => { },
        clearUniverse: () => { },
        setUniverseConnected: () => { },
        addToAbstractionChain: () => { },
        removeFromAbstractionChain: () => { },
        updateGraphView: () => { },
        setTypeListMode: () => { },
        toggleEnableAutoRouting: () => { },
        setRoutingStyle: () => { },
        setCleanLaneSpacing: () => { },
        setLayoutScalePreset: () => { },
        setLayoutScaleMultiplier: () => { },
        setLayoutIterationPreset: () => { },
        deleteNodePrototype: () => { },
        deleteGraph: () => { }
      };
    }
  }, []);

  // Panel overlay resizers rendered in canvas (do not overlap panel DOM)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    try { return JSON.parse(localStorage.getItem('panelWidth_left') || '280'); } catch { return 280; }
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    try { return JSON.parse(localStorage.getItem('panelWidth_right') || '280'); } catch { return 280; }
  });
  // Track last touch coordinates for touchend where touches are empty
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const touchMultiPanRef = useRef(false);
  const isTouchDeviceRef = useRef(false);
  const suppressNextMouseDownRef = useRef(false);
  const suppressMouseDownResetTimeoutRef = useRef(null);
  const pinchRef = useRef({
    active: false,
    startDist: 0,
    startZoom: 1,
    centerClient: { x: 0, y: 0 },
    centerWorld: { x: 0, y: 0 },
    lastCenterClient: { x: 0, y: 0 }
  });

  // Pinch zoom smoothing system
  const pinchSmoothingRef = useRef({
    targetZoom: 1,
    targetPanX: 0,
    targetPanY: 0,
    currentZoom: 1,
    currentPanX: 0,
    currentPanY: 0,
    animationId: null,
    smoothing: 0.08, // Lower = smoother, higher = more responsive (reduced for less jitter)
    isAnimating: false, // Track if we're actively animating
    // Performance tracking
    lastFrameTime: 0,
    frameCount: 0,
    inputEventCount: 0,
    lastInputTime: 0,
    avgFrameDelta: 16.67, // Target 60fps
    lastLogTime: 0,
  });

  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);
  const dragStartXRef = useRef(0);
  const startWidthRef = useRef(0);
  const groupLongPressTimeout = useRef(null);

  // Enhanced touch state management separate from mouse events
  const touchState = useRef({
    isDragging: false,
    dragNodeId: null,
    startTime: 0,
    startPosition: { x: 0, y: 0 },
    currentPosition: { x: 0, y: 0 },
    hasMovedPastThreshold: false,
    longPressTimer: null,
    longPressReady: false,
    dragOffset: null
    // nodeData removed - use dragNodeId for fresh lookups to avoid stale closures
  });

  // Track long press state synchronously to avoid race conditions in event handlers
  const longPressingInstanceIdRef = useRef(null);

  // Touch interaction constants
  const TOUCH_MOVEMENT_THRESHOLD = 10; // pixels
  // Use imported LONG_PRESS_DURATION from './constants'
  const [isHoveringLeftResizer, setIsHoveringLeftResizer] = useState(false);
  const [isHoveringRightResizer, setIsHoveringRightResizer] = useState(false);
  const [resizersVisible, setResizersVisible] = useState(false);
  // Track last pan velocity (px/ms) to produce consistent glide on release
  const lastPanVelocityRef = useRef({ vx: 0, vy: 0 });
  const lastPanSampleRef = useRef({ time: 0 });
  const panMomentumRef = useRef({ animationId: null, vx: 0, vy: 0, lastTime: 0, source: null, active: false });
  // Track the source of current panning for momentum decisions
  const panSourceRef = useRef(null); // 'touch', 'trackpad', 'mouse', null
  const panVelocityHistoryRef = useRef([]); // History of recent pan positions for momentum calculation
  const actuallyPannedRef = useRef(false); // Track if we actually moved the canvas during panning
  const recentlyPannedRef = useRef(false); // Synchronous tracking of recent pans to prevent clicks
  // Track latest widths in refs to avoid stale closures in global listeners
  const leftWidthRef = useRef(leftPanelWidth);
  const rightWidthRef = useRef(rightPanelWidth);
  useEffect(() => { leftWidthRef.current = leftPanelWidth; }, [leftPanelWidth]);
  useEffect(() => { rightWidthRef.current = rightPanelWidth; }, [rightPanelWidth]);

  // Cleanup pinch zoom animation on unmount
  useEffect(() => {
    return () => {
      if (pinchSmoothingRef.current?.animationId) {
        cancelAnimationFrame(pinchSmoothingRef.current.animationId);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (suppressMouseDownResetTimeoutRef.current) {
        clearTimeout(suppressMouseDownResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onPanelChanged = (e) => {
      const { side, width } = e.detail || {};
      if (side === 'left' && typeof width === 'number') setLeftPanelWidth(width);
      if (side === 'right' && typeof width === 'number') setRightPanelWidth(width);
    };
    window.addEventListener('panelWidthChanged', onPanelChanged);
    return () => window.removeEventListener('panelWidthChanged', onPanelChanged);
  }, []);

  const MIN_WIDTH = 180;
  const MAX_WIDTH = Math.max(240, Math.round(window.innerWidth / 2));

  const beginDrag = (side, clientX) => {
    if (side === 'left') {
      isDraggingLeft.current = true;
      dragStartXRef.current = clientX;
      startWidthRef.current = leftPanelWidth;
    } else {
      isDraggingRight.current = true;
      dragStartXRef.current = clientX;
      startWidthRef.current = rightPanelWidth;
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    // Prevent page overscroll while resizing
    try { document.body.style.overscrollBehavior = 'none'; } catch { }
  };

  const onDragMove = (e) => {
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    if (isDraggingLeft.current) {
      const dx = clientX - dragStartXRef.current;
      const w = Math.max(MIN_WIDTH, Math.min(startWidthRef.current + dx, MAX_WIDTH));
      setLeftPanelWidth(w);
      try { window.dispatchEvent(new CustomEvent('panelWidthChanging', { detail: { side: 'left', width: w } })); } catch { }
    } else if (isDraggingRight.current) {
      const dx = clientX - dragStartXRef.current;
      const w = Math.max(MIN_WIDTH, Math.min(startWidthRef.current - dx, MAX_WIDTH));
      setRightPanelWidth(w);
      try { window.dispatchEvent(new CustomEvent('panelWidthChanging', { detail: { side: 'right', width: w } })); } catch { }
    }
  };

  const endDrag = () => {
    if (isDraggingLeft.current) {
      isDraggingLeft.current = false;
      try {
        // Persist and broadcast
        const finalLeftWidth = leftWidthRef.current;
        localStorage.setItem('panelWidth_left', JSON.stringify(finalLeftWidth));
        window.dispatchEvent(new CustomEvent('panelWidthChanged', { detail: { side: 'left', width: finalLeftWidth } }));
      } catch { }
    }
    if (isDraggingRight.current) {
      isDraggingRight.current = false;
      try {
        // Persist and broadcast
        const finalRightWidth = rightWidthRef.current;
        localStorage.setItem('panelWidth_right', JSON.stringify(finalRightWidth));
        window.dispatchEvent(new CustomEvent('panelWidthChanged', { detail: { side: 'right', width: finalRightWidth } }));
      } catch { }
    }
    // Clear any hover state at the end of a drag (helps on touch devices)
    setIsHoveringLeftResizer(false);
    setIsHoveringRightResizer(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    try { document.body.style.overscrollBehavior = ''; } catch { }
  };

  // Render overlay resizer bars that sit just outside panels
  const renderPanelResizers = () => {
    const barHeightPct = 0.25;
    const barHeight = `${Math.round(barHeightPct * 100)}%`;
    const HITBOX_WIDTH = 28; // wider invisible hitbox
    const VISIBLE_WIDTH = 6; // thin visible bar
    const extraHitboxPx = 24; // slightly taller than the visual bar
    const wrapperHeight = `calc(${barHeight} + ${extraHitboxPx}px)`;
    const wrapperMinHeight = 60 + extraHitboxPx;
    const wrapperMaxHeight = 280 + extraHitboxPx;
    const wrapperCommon = {
      position: 'fixed',
      top: '50%',
      transform: 'translateY(-50%)',
      height: wrapperHeight,
      minHeight: wrapperMinHeight,
      maxHeight: wrapperMaxHeight,
      width: HITBOX_WIDTH,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'col-resize',
      zIndex: 10002,
      touchAction: 'none',
      pointerEvents: 'auto',
      backgroundColor: 'transparent',
      transition: 'opacity 200ms ease'
    };
    const handleVisualCommon = {
      width: VISIBLE_WIDTH,
      height: barHeight,
      minHeight: 60,
      maxHeight: 280,
      borderRadius: 999,
      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      transition: 'background-color 120ms ease, opacity 160ms ease'
    };
    const inset = 14; // spacing inside from panel edges
    const leftActive = isDraggingLeft.current || isHoveringLeftResizer;
    const rightActive = isDraggingRight.current || isHoveringRightResizer;
    const baseColor = (active) => `rgba(38,0,0,${active ? 1 : 0.18})`;
    const fadeOpacity = resizersVisible ? 1 : 0;
    const leftWrapperLeft = Math.max(0, (leftPanelWidth + inset) - (HITBOX_WIDTH / 2));
    const rightWrapperRight = Math.max(0, (rightPanelWidth + inset) - (HITBOX_WIDTH / 2));
    // Use optional chaining with defaults so we don't depend on early state initialization
    const leftCollapsed = !(typeof leftPanelExpanded === 'boolean' ? leftPanelExpanded : true);
    const rightCollapsed = !(typeof rightPanelExpanded === 'boolean' ? rightPanelExpanded : true);
    return (
      <>
        {/* Left resizer wrapper (full-height hitbox) */}
        <div
          style={{
            ...wrapperCommon,
            left: leftWrapperLeft,
            pointerEvents: (!resizersVisible || leftCollapsed) ? 'none' : 'auto',
            opacity: fadeOpacity
          }}
          onMouseDown={(e) => {
            // prevent canvas panning on resizer mouse down
            e.stopPropagation();
            beginDrag('left', e.clientX);
          }}
          onTouchStart={(e) => {
            if (e && e.cancelable) { e.preventDefault(); }
            e.stopPropagation();
            if (e.touches?.[0]) beginDrag('left', e.touches[0].clientX);
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') {
              e.preventDefault();
              e.stopPropagation();
              beginDrag('left', e.clientX);
            }
          }}
          onWheel={(e) => {
            // Only block scroll when actively dragging to avoid interfering with canvas scrolling
            if ((isDraggingLeft.current || isDraggingRight.current) && e && e.cancelable) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onTouchMove={(e) => {
            if ((isDraggingLeft.current || isDraggingRight.current) && e && e.cancelable) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onMouseEnter={() => setIsHoveringLeftResizer(true)}
          onMouseLeave={() => setIsHoveringLeftResizer(false)}
        >
          <div style={{ ...handleVisualCommon, backgroundColor: baseColor(leftActive), opacity: leftCollapsed ? 0 : fadeOpacity }} />
        </div>
        {/* Right resizer wrapper (full-height hitbox) */}
        <div
          style={{
            ...wrapperCommon,
            right: rightWrapperRight,
            pointerEvents: (!resizersVisible || rightCollapsed) ? 'none' : 'auto',
            opacity: fadeOpacity
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            beginDrag('right', e.clientX);
          }}
          onTouchStart={(e) => {
            if (e && e.cancelable) { e.preventDefault(); }
            e.stopPropagation();
            if (e.touches?.[0]) beginDrag('right', e.touches[0].clientX);
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') {
              e.preventDefault();
              e.stopPropagation();
              beginDrag('right', e.clientX);
            }
          }}
          onWheel={(e) => {
            if ((isDraggingLeft.current || isDraggingRight.current) && e && e.cancelable) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onTouchMove={(e) => {
            if ((isDraggingLeft.current || isDraggingRight.current) && e && e.cancelable) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onMouseEnter={() => setIsHoveringRightResizer(true)}
          onMouseLeave={() => setIsHoveringRightResizer(false)}
        >
          <div style={{ ...handleVisualCommon, backgroundColor: baseColor(rightActive), opacity: rightCollapsed ? 0 : fadeOpacity }} />
        </div>
      </>
    );
  };

  // --- Touch helpers for canvas interactions (pan, node drag, connections) ---
  const normalizeTouchEvent = (e) => {
    // For touch end events, changedTouches has the final position where finger lifted
    const t = e.touches?.[0] || e.changedTouches?.[0];
    if (t) {
      return { clientX: t.clientX, clientY: t.clientY };
    }
    // Fallback to last known position
    return { clientX: lastTouchRef.current.x, clientY: lastTouchRef.current.y };
  };

  const handleTouchStartCanvas = (e) => {
    if (e && e.cancelable) {
      e.preventDefault();
      e.stopPropagation();
    }
    // Only stop momentum if we're starting a new gesture with actual touches
    // Don't clear momentum during cleanup/end events
    if (e.touches && e.touches.length > 0) {
      stopPanMomentum();
    }
    isTouchDeviceRef.current = true;

    if (e.touches && e.touches.length >= 2) {
      // Pinch-to-zoom setup
      // Stop any momentum first
      stopPanMomentum();

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const dist = Math.hypot(dx, dy) || 1;
      const centerX = (t1.clientX + t2.clientX) / 2;
      const centerY = (t1.clientY + t2.clientY) / 2;
      const rect = containerRef.current.getBoundingClientRect();
      const worldX = (centerX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
      const worldY = (centerY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
      pinchRef.current = {
        active: true,
        startDist: dist,
        startZoom: zoomLevel,
        centerClient: { x: centerX, y: centerY },
        centerWorld: { x: worldX, y: worldY },
        lastCenterClient: { x: centerX, y: centerY },
        lastDist: dist
      };
      pinchSmoothingRef.current.lastFrameTime = performance.now();
      // Cancel any in-progress one-finger pan when second finger is placed
      isMouseDown.current = false;
      setIsPanning(false);
      setPanStart(null);
      if (clickTimeoutIdRef.current) { clearTimeout(clickTimeoutIdRef.current); clickTimeoutIdRef.current = null; }
      potentialClickNodeRef.current = null;
      touchMultiPanRef.current = false;
      return;
    }

    // Handle single touch - synthesize mouse event only once
    if (e.touches && e.touches.length === 1) {
      const t = e.touches[0];
      lastTouchRef.current = { x: t.clientX, y: t.clientY };
      isMouseDown.current = true;
      startedOnNode.current = false;
      mouseMoved.current = false;
      setPanStart({ x: t.clientX, y: t.clientY });
      panSourceRef.current = 'touch';
      // Attach document-level listeners to keep pan active even if finger leaves canvas
      try {
        const moveListener = (ev) => handleTouchMoveCanvas(ev);
        const endListener = (ev) => {
          handleTouchEndCanvas(ev);
          try {
            document.removeEventListener('touchmove', moveListener, { passive: false });
            document.removeEventListener('touchend', endListener, { passive: false });
            document.removeEventListener('touchcancel', cancelListener, { passive: false });
          } catch { }
        };
        const cancelListener = (ev) => {
          handleTouchEndCanvas(ev);
          try {
            document.removeEventListener('touchmove', moveListener, { passive: false });
            document.removeEventListener('touchend', endListener, { passive: false });
            document.removeEventListener('touchcancel', cancelListener, { passive: false });
          } catch { }
        };
        document.addEventListener('touchmove', moveListener, { passive: false });
        document.addEventListener('touchend', endListener, { passive: false });
        document.addEventListener('touchcancel', cancelListener, { passive: false });
      } catch { }
      const synthetic = {
        clientX: t.clientX,
        clientY: t.clientY,
        detail: 1,
        preventDefault: () => { try { e.preventDefault(); } catch { } },
        stopPropagation: () => { try { e.stopPropagation(); } catch { } }
      };
      handleMouseDown(synthetic);
    } else {
      // Fallback for other touch events
      const { clientX, clientY } = normalizeTouchEvent(e);
      lastTouchRef.current = { x: clientX, y: clientY };
      const synthetic = {
        clientX,
        clientY,
        ctrlKey: false,
        metaKey: false,
        preventDefault: () => { try { e.preventDefault(); } catch { } },
        stopPropagation: () => { try { e.stopPropagation(); } catch { } }
      };
      handleMouseDown(synthetic);
    }
  };

  const handleTouchMoveCanvas = (e) => {
    // Avoid per-move preventDefault/stopPropagation; rely on CSS `touch-action: none`

    // CRITICAL: If a node drag is active, let the document listener handle it exclusively
    if (touchState.current.isDragging || draggingNodeInfo || touchState.current.dragNodeId) {
      return; // Don't interfere with node drag
    }

    if (e.touches && e.touches.length >= 2) {
      // Initialize pinch if not already active
      if (!pinchRef.current.active) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        const dist = Math.hypot(dx, dy) || 1;
        const centerX = (t1.clientX + t2.clientX) / 2;
        const centerY = (t1.clientY + t2.clientY) / 2;
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const worldX = (centerX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
          const worldY = (centerY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
          pinchRef.current = {
            active: true,
            startDist: dist,
            startZoom: zoomLevel,
            centerClient: { x: centerX, y: centerY },
            centerWorld: { x: worldX, y: worldY },
            lastCenterClient: { x: centerX, y: centerY },
            lastDist: dist
          };
          pinchSmoothingRef.current.lastFrameTime = performance.now();
          // Stop momentum and panning
          stopPanMomentum();
          isMouseDown.current = false;
          setIsPanning(false);
          setPanStart(null);
        }
      }

      // Touch-only pinch zoom (higher sensitivity), no two-finger pan on touch
      isPanningOrZooming.current = true;
      const now = performance.now();
      const smoothing = pinchSmoothingRef.current;
      const lastTime = smoothing.lastFrameTime || now;
      const dt = Math.max(1, now - lastTime);
      smoothing.lastFrameTime = now;

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const centerX = (t1.clientX + t2.clientX) / 2;
      const centerY = (t1.clientY + t2.clientY) / 2;
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1;
      pinchRef.current.centerClient = { x: centerX, y: centerY };
      const startDist = pinchRef.current.startDist || dist;
      const startZoom = pinchRef.current.startZoom || zoomLevel;
      const ratioFromStart = dist / (startDist || dist);
      const targetZoomRaw = startZoom * (ratioFromStart || 1);
      const easing = 1 - Math.pow(1 - TOUCH_PINCH_SENSITIVITY, Math.min(6, dt / 16));
      setZoomLevel(prevZoom => {
        const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoomRaw || prevZoom));
        const newZoom = prevZoom + (targetZoom - prevZoom) * easing;
        if (!containerRef.current) {
          pinchRef.current.lastDist = dist;
          pinchRef.current.lastCenterClient = { x: centerX, y: centerY };
          return prevZoom;
        }
        const rect = containerRef.current.getBoundingClientRect();
        setPanOffset(prevPan => {
          const rawWorldX = (centerX - rect.left - prevPan.x) / prevZoom + canvasSize.offsetX;
          const rawWorldY = (centerY - rect.top - prevPan.y) / prevZoom + canvasSize.offsetY;
          const prevWorld = pinchRef.current.centerWorld;
          const worldX = prevWorld ? prevWorld.x + (rawWorldX - prevWorld.x) * TOUCH_PINCH_CENTER_SMOOTHING : rawWorldX;
          const worldY = prevWorld ? prevWorld.y + (rawWorldY - prevWorld.y) * TOUCH_PINCH_CENTER_SMOOTHING : rawWorldY;
          pinchRef.current.centerWorld = { x: worldX, y: worldY };
          return {
            x: centerX - rect.left - (worldX - canvasSize.offsetX) * newZoom,
            y: centerY - rect.top - (worldY - canvasSize.offsetY) * newZoom
          };
        });
        pinchRef.current.lastDist = dist;
        pinchRef.current.lastCenterClient = { x: centerX, y: centerY };
        return newZoom;
      });
      return;
    }
    const { clientX, clientY } = normalizeTouchEvent(e);
    lastTouchRef.current = { x: clientX, y: clientY };

    // Record velocity for momentum calculation
    if (panSourceRef.current === 'touch') {
      const now = performance.now();
      panVelocityHistoryRef.current.push({ x: clientX, y: clientY, time: now });
      // Keep samples from last 100ms, but always keep at least the 10 most recent
      const cutoff = now - 100;
      const filtered = panVelocityHistoryRef.current.filter(s => s.time >= cutoff);
      // Ensure we keep at least 10 samples for momentum calculation
      if (filtered.length >= 10) {
        panVelocityHistoryRef.current = filtered;
      } else {
        // Keep the last 10 samples regardless of time
        panVelocityHistoryRef.current = panVelocityHistoryRef.current.slice(-10);
      }
    }

    // Update mouseInsideNode for touch events to maintain proper drag state
    if (longPressingInstanceIdRef.current) {
      const longPressNodeData = nodes.find(n => n.id === longPressingInstanceIdRef.current);
      if (longPressNodeData) {
        mouseInsideNode.current = isInsideNode(longPressNodeData, clientX, clientY);
      }
    }

    const synthetic = {
      clientX,
      clientY,
      preventDefault: () => { try { e.preventDefault(); } catch { } },
      stopPropagation: () => { try { e.stopPropagation(); } catch { } }
    };
    handleMouseMove(synthetic);
  };

  const handleTouchEndCanvas = (e) => {
    if (e && e.cancelable) {
      e.preventDefault();
      e.stopPropagation();
    }
    // End pinch if active – no glide for two-finger gesture on touch
    if (pinchRef.current.active) {
      pinchRef.current.active = false;
      isPanningOrZooming.current = false;
      // Clear velocity history so next pan starts fresh
      panVelocityHistoryRef.current = [];
      lastPanVelocityRef.current = { vx: 0, vy: 0 };

      // If there's still a touch remaining (2 fingers -> 1 finger), set up for single-finger pan
      if (e.touches && e.touches.length === 1) {
        const t = e.touches[0];
        setPanStart({ x: t.clientX, y: t.clientY });
        panSourceRef.current = 'touch';
        isMouseDown.current = true;
        mouseMoved.current = false;
      } else {
        // All fingers lifted - clear everything
        setPanStart(null);
        panSourceRef.current = null;
        setIsPanning(false);
        isMouseDown.current = false;
        mouseMoved.current = false;
      }
      return;
    }
    const { clientX, clientY } = normalizeTouchEvent(e);
    // Determine if this was a tap (minimal movement). Use a larger threshold for touch.
    const dxEnd = clientX - (mouseDownPosition.current?.x || clientX);
    const dyEnd = clientY - (mouseDownPosition.current?.y || clientY);
    const distEnd = Math.hypot(dxEnd, dyEnd);
    const tapThreshold = Math.max(MOVEMENT_THRESHOLD || 6, 16);
    const isTap = distEnd <= tapThreshold && !mouseMoved.current;
    const synthetic = {
      clientX,
      clientY,
      preventDefault: () => { try { e.preventDefault(); } catch { } },
      stopPropagation: () => { try { e.stopPropagation(); } catch { } }
    };
    // Route to mouseUp to reuse inertia/glide for single-finger pan
    handleMouseUp(synthetic);
    // Ensure touch tap behaves like click-off: close UI overlays if present
    if (isTap) {
      if (groupControlPanelShouldShow || groupControlPanelVisible) {
        setGroupControlPanelVisible(false);
      }
      if (selectedGroup) {
        setSelectedGroup(null);
      }
      if (selectedEdgeId || selectedEdgeIds.size > 0) {
        storeActions.setSelectedEdgeId(null);
        storeActions.clearSelectedEdgeIds();
      }
      if (selectedNodeIdForPieMenu) {
        setSelectedNodeIdForPieMenu(null);
      }
      if (plusSign && !nodeNamePrompt.visible) {
        setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
      }
    }
    // If it was a tap on empty canvas, mirror click-to-plus-sign behavior
    if (isTap) {
      if (!isPaused && !draggingNodeInfo && !drawingConnectionFrom && !recentlyPanned && !nodeNamePrompt.visible && activeGraphId) {
        if (selectedInstanceIds.size > 0) {
          // Mimic click-off behavior: clear selection on tap
          setSelectedInstanceIds(new Set());
        } else if (!plusSign) {
          const rect = containerRef.current.getBoundingClientRect();
          const mouseX = (clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
          const mouseY = (clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
          setPlusSign({ x: mouseX, y: mouseY, mode: 'appear', tempName: '' });
          setLastInteractionType('plus_sign_shown_touch');
        }
      }
    }
    touchMultiPanRef.current = false;
  };

  // Document-level touch listeners holder (must be declared before use)
  const docTouchListenersRef = useRef(null);

  // Dedicated touch handlers for nodes (no synthetic event conversion)
  const handleNodeTouchStart = (nodeData, e) => {
    console.log('[handleNodeTouchStart] START - docTouchListenersRef.current:', docTouchListenersRef.current);
    // Attach document-level listeners only once per touch session
    // Check if listeners are already attached to avoid duplicates
    if (!docTouchListenersRef.current) {
      try {
        console.log('[handleNodeTouchStart] Attaching document listeners for nodeId:', nodeData.id);
        // Create dedicated listeners with fresh node lookups to avoid stale closures
        const moveListener = (ev) => {
          console.log('[DOC LISTENER] touchmove fired, dragNodeId:', touchState.current.dragNodeId, 'isDragging:', touchState.current.isDragging);
          const freshNodeData = nodes.find(n => n.id === touchState.current.dragNodeId);
          if (!freshNodeData || !touchState.current.dragNodeId) {
            console.log('[DOC LISTENER] No fresh node data, returning');
            return;
          }
          handleNodeTouchMove(freshNodeData, ev);
        };
        const endListener = (ev) => {
          console.log('[DOC LISTENER] touchend fired, cleaning up');
          const freshNodeData = nodes.find(n => n.id === touchState.current.dragNodeId);
          if (freshNodeData) {
            handleNodeTouchEnd(freshNodeData, ev);
          }
          try {
            document.removeEventListener('touchmove', moveListener, { passive: false });
            document.removeEventListener('touchend', endListener, { passive: false });
            document.removeEventListener('touchcancel', cancelListener, { passive: false });
            console.log('[DOC LISTENER] Document listeners removed');
          } catch (err) {
            console.error('[DOC LISTENER] Error removing listeners:', err);
          }
          docTouchListenersRef.current = null;
        };
        const cancelListener = (ev) => {
          const freshNodeData = nodes.find(n => n.id === touchState.current.dragNodeId);
          if (freshNodeData) {
            handleNodeTouchEnd(freshNodeData, ev);
          }
          try {
            document.removeEventListener('touchmove', moveListener, { passive: false });
            document.removeEventListener('touchend', endListener, { passive: false });
            document.removeEventListener('touchcancel', cancelListener, { passive: false });
          } catch { }
          docTouchListenersRef.current = null;
        };
        document.addEventListener('touchmove', moveListener, { passive: false });
        document.addEventListener('touchend', endListener, { passive: false });
        document.addEventListener('touchcancel', cancelListener, { passive: false });
        docTouchListenersRef.current = { moveListener, endListener, cancelListener };
        console.log('[handleNodeTouchStart] Document listeners attached successfully');
      } catch (err) {
        console.error('[handleNodeTouchStart] Error attaching listeners:', err);
      }
    } else {
      console.log('[handleNodeTouchStart] Document listeners already attached, skipping');
    }
    e.stopPropagation();
    if (isPaused || !activeGraphId) return;

    // Do NOT call e.preventDefault() here - React's onTouchStart is passive by default.
    // We rely on CSS touch-action: none to prevent scrolling.
    stopPanMomentum();

    const touch = e.touches[0];
    if (!touch) return;

    if (suppressMouseDownResetTimeoutRef.current) {
      clearTimeout(suppressMouseDownResetTimeoutRef.current);
    }
    suppressNextMouseDownRef.current = true;
    suppressMouseDownResetTimeoutRef.current = setTimeout(() => {
      suppressNextMouseDownRef.current = false;
      suppressMouseDownResetTimeoutRef.current = null;
    }, 650);

    const instanceId = nodeData.id;
    const now = performance.now();

    const rect = containerRef.current?.getBoundingClientRect();
    let dragOffset = null;
    if (rect) {
      const mouseCanvasX = (touch.clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
      const mouseCanvasY = (touch.clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
      dragOffset = { x: mouseCanvasX - nodeData.x, y: mouseCanvasY - nodeData.y };
    }

    isMouseDown.current = true;
    mouseDownPosition.current = { x: touch.clientX, y: touch.clientY };
    mouseMoved.current = false;
    mouseInsideNode.current = true;
    startedOnNode.current = true;
    panSourceRef.current = 'touch';
    // Arm connection drawing by default (matches mouse behavior)
    setLongPressingInstanceId(instanceId);
    longPressingInstanceIdRef.current = instanceId;

    // Add touch feedback class
    const nodeElement = e.currentTarget;
    nodeElement.classList.add('touch-active');

    // Haptic feedback if available
    if (navigator.vibrate) {
      try {
        navigator.vibrate(10); // Short vibration for touch start
      } catch (e) {
        // Ignore vibration errors (e.g. user hasn't interacted yet)
      }
    }

    // Initialize touch state (drag can also start via long-press fallback)
    touchState.current = {
      isDragging: false,
      dragNodeId: instanceId,
      startTime: now,
      startPosition: { x: touch.clientX, y: touch.clientY },
      currentPosition: { x: touch.clientX, y: touch.clientY },
      hasMovedPastThreshold: false,
      longPressTimer: null,
      nodeElement: nodeElement,
      longPressReady: false,
      dragOffset
      // nodeData removed - use dragNodeId for fresh lookups to avoid stale closures
    };

    // Long-press fallback: begin NODE DRAG while finger is still down (mouse parity)
    if (touchState.current.longPressTimer) {
      clearTimeout(touchState.current.longPressTimer);
    }
    touchState.current.longPressTimer = setTimeout(() => {
      const ts = touchState.current;
      if (!ts) return;
      // Long press detected! Start node drag (matches mouse behavior)
      // Don't check hasMovedPastThreshold - we want to start drag even if already moving
      if (isMouseDown.current && ts.dragNodeId === instanceId && !ts.isDragging) {
        // Set flag BEFORE starting drag to enable early exit path immediately
        ts.isDragging = true;
        const started = startDragForNode(nodeData, ts.currentPosition.x, ts.currentPosition.y);
        if (started) {
          ts.longPressReady = false;
          setSelectedNodeIdForPieMenu(null);
          // Cancel connection intent once dragging node
          setLongPressingInstanceId(null);
          longPressingInstanceIdRef.current = null;
        } else {
          // Rollback if failed
          ts.isDragging = false;
        }

        // Visual/Haptic feedback
        if (ts.nodeElement) {
          ts.nodeElement.classList.add('long-press-active');
        }
        if (navigator.vibrate) {
          try {
            navigator.vibrate(50);
          } catch (e) {
            // Ignore vibration errors
          }
        }
      }
    }, LONG_PRESS_DURATION);
    // setMouseInsideNode(true); // Removed: undefined and unnecessary (handled by ref)
  };

  // Pointer → Touch compatibility helpers (function declarations to avoid TDZ)
  function toSyntheticTouchEventFromPointer(e) {
    return {
      touches: [{ clientX: e.clientX, clientY: e.clientY }],
      changedTouches: [{ clientX: e.clientX, clientY: e.clientY }],
      cancelable: true,
      stopPropagation: () => { try { e.stopPropagation(); } catch { } },
      preventDefault: () => { try { e.preventDefault(); } catch { } },
      currentTarget: e.currentTarget,
      __fromPointer: true
    };
  }

  function handleNodePointerDown(nodeData, e) {
    if (e && e.pointerType && e.pointerType !== 'mouse') {
      // Do NOT call e.preventDefault() - it blocks touch recognition
      // Let the touch event handlers manage the interaction
      try { e.stopPropagation(); } catch { }
      handleNodeTouchStart(nodeData, toSyntheticTouchEventFromPointer(e));
    }
  }

  function handleNodePointerMove(nodeData, e) {
    if (e && e.pointerType && e.pointerType !== 'mouse') {
      // Do NOT call e.preventDefault() - it blocks touch recognition
      try { e.stopPropagation(); } catch { }
      handleNodeTouchMove(nodeData, toSyntheticTouchEventFromPointer(e));
    }
  }

  function handleNodePointerUp(nodeData, e) {
    if (e && e.pointerType && e.pointerType !== 'mouse') {
      try { if (e.cancelable) e.preventDefault(); e.stopPropagation(); } catch { }
      const synthetic = toSyntheticTouchEventFromPointer(e);
      synthetic.touches = [];
      handleNodeTouchEnd(nodeData, synthetic);
    }
  }

  function handleNodePointerCancel(nodeData, e) {
    if (e && e.pointerType && e.pointerType !== 'mouse') {
      try { if (e.cancelable) e.preventDefault(); e.stopPropagation(); } catch { }
      const synthetic = toSyntheticTouchEventFromPointer(e);
      synthetic.touches = [];
      handleNodeTouchEnd(nodeData, synthetic);
    }
  }


  // Touch cancel mirroring: ensure cleanup if OS cancels
  const handleNodeTouchCancel = (nodeData, e) => {
    if (e) {
      try { if (e.cancelable) e.preventDefault(); e.stopPropagation(); } catch { }
    }
    // Mirror touch end cleanup
    isMouseDown.current = false;
    startedOnNode.current = false;
    setLongPressingInstanceId(null);
    longPressingInstanceIdRef.current = null;

    if (touchState.current.nodeElement) {
      touchState.current.nodeElement.classList.remove('touch-active', 'long-press-active');
    }

    if (touchState.current.longPressTimer) {
      clearTimeout(touchState.current.longPressTimer);
      touchState.current.longPressTimer = null;
    }

    if (touchState.current.isDragging || drawingConnectionFrom) {
      // Synthesize a mouse up to clear drag state
      const synthetic = {
        clientX: (e && e.changedTouches && e.changedTouches[0]?.clientX) || lastMousePosRef.current?.x || 0,
        clientY: (e && e.changedTouches && e.changedTouches[0]?.clientY) || lastMousePosRef.current?.y || 0,
        stopPropagation: () => { },
        preventDefault: () => { }
      };
      handleMouseUp(synthetic);
    }

    // Reset touch state
    touchState.current = {
      isDragging: false,
      dragNodeId: null,
      startTime: 0,
      startPosition: { x: 0, y: 0 },
      currentPosition: { x: 0, y: 0 },
      hasMovedPastThreshold: false,
      longPressTimer: null,
      nodeElement: null,
      longPressReady: false,
      dragOffset: null,
      nodeData: null
    };

    setDraggingNodeInfo(null);
    mouseInsideNode.current = false;
    // Detach any outstanding document listeners
    if (docTouchListenersRef.current) {
      const { moveListener, endListener, cancelListener } = docTouchListenersRef.current;
      try {
        document.removeEventListener('touchmove', moveListener, { passive: false });
        document.removeEventListener('touchend', endListener, { passive: false });
        document.removeEventListener('touchcancel', cancelListener, { passive: false });
      } catch { }
      docTouchListenersRef.current = null;
    }
  };

  const handleNodeTouchMove = (nodeData, e) => {
    console.log('[handleNodeTouchMove] Called with nodeData:', nodeData?.id, 'touchState.dragNodeId:', touchState.current.dragNodeId);
    if (isPaused || !activeGraphId || !touchState.current.dragNodeId) {
      console.log('[handleNodeTouchMove] Early return - isPaused:', isPaused, 'activeGraphId:', activeGraphId, 'dragNodeId:', touchState.current.dragNodeId);
      return;
    }

    // Do NOT call e.preventDefault() or e.stopPropagation() here
    // The document-level listener (attached in handleNodeTouchStart) handles everything

    const touch = e.touches[0];
    if (!touch) {
      console.log('[handleNodeTouchMove] No touch, returning');
      return;
    }

    const currentPos = { x: touch.clientX, y: touch.clientY };

    // Update current position
    touchState.current.currentPosition = currentPos;

    // PRIORITY 1: If drag is already active, just update position and return
    if (touchState.current.isDragging || draggingNodeInfo) {
      console.log('[handleNodeTouchMove] DRAGGING - calling handleMouseMove with:', touch.clientX, touch.clientY);
      const synthetic = {
        clientX: touch.clientX,
        clientY: touch.clientY,
        stopPropagation: () => e.stopPropagation(),
        preventDefault: () => e.preventDefault()
      };
      handleMouseMove(synthetic);
      return; // Skip all other logic
    }

    // PRIORITY 2: Check if we should start drag or connection based on movement
    const deltaX = currentPos.x - touchState.current.startPosition.x;
    const deltaY = currentPos.y - touchState.current.startPosition.y;
    const distance = Math.hypot(deltaX, deltaY);

    // Check if we've moved past threshold
    if (!touchState.current.hasMovedPastThreshold && distance > TOUCH_MOVEMENT_THRESHOLD) {
      touchState.current.hasMovedPastThreshold = true;

      // Clear any pending long-press timer
      if (touchState.current.longPressTimer) {
        clearTimeout(touchState.current.longPressTimer);
        touchState.current.longPressTimer = null;
      }

      // Match mouse behavior: if longPressingInstanceId is set → Connection Draw, else → Node Drag
      // BUT: If drag is already started (isDragging=true), skip connection logic entirely
      if (!touchState.current.isDragging && longPressingInstanceIdRef.current && !draggingNodeInfo && !drawingConnectionFrom && !pinchRef.current.active) {
        // Check if we've left the node area (matches mouse behavior)
        const armedNode = nodes.find(n => n.id === longPressingInstanceIdRef.current);
        if (armedNode) {
          const leftNodeArea = !isInsideNode(armedNode, touch.clientX, touch.clientY);
          // Allow both patterns (same as mouse):
          // 1) Move outside the node (original behavior)
          // 2) Quick drag while still inside the node (desktop-friendly)
          if (leftNodeArea || startedOnNode.current) {
            // longPressingInstanceId is armed AND we left the node → Start Connection Draw
            const startNodeDims = getNodeDimensions(armedNode, previewingNodeId === armedNode.id, null);
            const startPt = { x: armedNode.x + startNodeDims.currentWidth / 2, y: armedNode.y + startNodeDims.currentHeight / 2 };

            if (!containerRef.current || typeof touch.clientX !== 'number' || typeof touch.clientY !== 'number') {
              setLongPressingInstanceId(null);
              longPressingInstanceIdRef.current = null;
              return;
            }

            const rect = containerRef.current.getBoundingClientRect();
            const rawX = (touch.clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
            const rawY = (touch.clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;

            if (isNaN(rawX) || isNaN(rawY)) {
              // Only abort initialization if NOT already dragging
              if (!touchState.current.isDragging && !draggingNodeInfo) {
                setLongPressingInstanceId(null);
                longPressingInstanceIdRef.current = null;
              }
              return; // Skip this frame but don't clear drag state if already dragging
            }

            const { x: currentX, y: currentY } = clampCoordinates(rawX, rawY);
            setDrawingConnectionFrom({ sourceInstanceId: armedNode.id, startX: startPt.x, startY: startPt.y, currentX, currentY });
            setLongPressingInstanceId(null);
            longPressingInstanceIdRef.current = null;
          } else {
            // Still inside node, haven't left yet → Don't start connection, continue waiting
            // This allows quick drags inside the node to become node drags instead
          }
        }
      } else if (!touchState.current.isDragging && !longPressingInstanceIdRef.current) {
        // longPressingInstanceId NOT set (cleared by long press timeout) → Start Node Drag
        if (!touchState.current.isDragging) {
          // Set flag BEFORE to enable early exit path immediately
          touchState.current.isDragging = true;
          const dragStarted = startDragForNode(nodeData, touch.clientX, touch.clientY);
          if (!dragStarted) {
            // Rollback if start failed
            touchState.current.isDragging = false;
          } else {
            touchState.current.longPressReady = false;
            setSelectedNodeIdForPieMenu(null);
            setLongPressingInstanceId(null);
            longPressingInstanceIdRef.current = null;
          }
        }
      }
    }

    // Drive shared move logic for both node-drag and connection-draw
    const synthetic = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      stopPropagation: () => e.stopPropagation(),
      preventDefault: () => e.preventDefault()
    };
    handleMouseMove(synthetic);
  };

  const handleNodeTouchEnd = (nodeData, e) => {
    if (e) {
      e.stopPropagation();
      if (e.cancelable) {
        e.preventDefault();
      }
    }

    isMouseDown.current = false;
    startedOnNode.current = false;
    setLongPressingInstanceId(null);
    longPressingInstanceIdRef.current = null;

    // Clean up CSS classes
    if (touchState.current.nodeElement) {
      touchState.current.nodeElement.classList.remove('touch-active', 'long-press-active');
    }

    // Clear long press timer
    if (touchState.current.longPressTimer) {
      clearTimeout(touchState.current.longPressTimer);
      touchState.current.longPressTimer = null;
    }

    if (suppressMouseDownResetTimeoutRef.current) {
      clearTimeout(suppressMouseDownResetTimeoutRef.current);
    }
    suppressNextMouseDownRef.current = true;
    suppressMouseDownResetTimeoutRef.current = setTimeout(() => {
      suppressNextMouseDownRef.current = false;
      suppressMouseDownResetTimeoutRef.current = null;
    }, 400);

    const touch = e.changedTouches[0];
    if (!touch) return;
    const synthetic = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      stopPropagation: () => e.stopPropagation(),
      preventDefault: () => e.preventDefault()
    };

    // Handle tap vs drag
    if (!touchState.current.hasMovedPastThreshold && touchState.current.dragNodeId === nodeData.id) {
      // This was a tap, not a drag
      console.log('Touch tap detected on node:', nodeData.id);

      // Light haptic feedback for tap completion
      if (navigator.vibrate) {
        try {
          navigator.vibrate(5);
        } catch (e) { }
      }

      // Handle double-tap for definition navigation
      const now = performance.now();
      const timeSinceStart = now - touchState.current.startTime;

      if (timeSinceStart < 300) { // Quick tap
        // Placeholder for future double-tap behavior
      }

      const wasSelected = selectedInstanceIds.has(nodeData.id);
      setSelectedInstanceIds(prev => {
        const newSelected = new Set(prev);
        if (wasSelected) {
          if (nodeData.id !== previewingNodeId) {
            newSelected.delete(nodeData.id);
          }
        } else {
          newSelected.add(nodeData.id);
        }
        return newSelected;
      });
    } else if (touchState.current.isDragging) {
      // Drag completion feedback
      if (navigator.vibrate) {
        try {
          navigator.vibrate(15); // Slightly stronger feedback for drag completion
        } catch (e) { }
      }
    }

    // Clean up drag state using existing mouse up logic
    if (touchState.current.isDragging || drawingConnectionFrom) {
      handleMouseUp(synthetic);
    }

    // Reset touch state
    touchState.current = {
      isDragging: false,
      dragNodeId: null,
      startTime: 0,
      startPosition: { x: 0, y: 0 },
      currentPosition: { x: 0, y: 0 },
      hasMovedPastThreshold: false,
      longPressTimer: null,
      nodeElement: null,
      longPressReady: false,
      dragOffset: null,
      nodeData: null
    };

    // Ensure drag state is cleared
    setDraggingNodeInfo(null);
    mouseInsideNode.current = false;

    // Detach document listeners set on touchstart
    if (docTouchListenersRef.current) {
      const { moveListener, endListener, cancelListener } = docTouchListenersRef.current;
      try {
        document.removeEventListener('touchmove', moveListener, { passive: false });
        document.removeEventListener('touchend', endListener, { passive: false });
        document.removeEventListener('touchcancel', cancelListener, { passive: false });
      } catch { }
      docTouchListenersRef.current = null;
    }
  };

  // storeActions is now defined above with defensive initialization

  // <<< OPTIMIZED: Individual stable subscriptions - Zustand will optimize these automatically >>>
  const activeGraphId = useGraphStore(state => state.activeGraphId);
  const activeDefinitionNodeId = useGraphStore(state => state.activeDefinitionNodeId);
  const selectedEdgeId = useGraphStore(state => state.selectedEdgeId);
  const selectedEdgeIds = useGraphStore(state => state.selectedEdgeIds);
  const typeListMode = useGraphStore(state => state.typeListMode);
  const graphsMap = useGraphStore(state => state.graphs);
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgePrototypesMap = useGraphStore(state => state.edgePrototypes);
  const showConnectionNames = useGraphStore(state => state.showConnectionNames);
  const gridMode = useGraphStore(state => state.gridSettings?.mode || 'off');
  const gridSize = useGraphStore(state => state.gridSettings?.size || 200);
  const enableAutoRouting = useGraphStore(state => state.autoLayoutSettings?.enableAutoRouting);
  const routingStyle = useGraphStore(state => state.autoLayoutSettings?.routingStyle || 'straight');
  const manhattanBends = useGraphStore(state => state.autoLayoutSettings?.manhattanBends || 'auto');
  const cleanLaneSpacing = useGraphStore(state => state.autoLayoutSettings?.cleanLaneSpacing || 24);
  const layoutScalePreset = useGraphStore(state => state.autoLayoutSettings?.layoutScale || 'balanced');
  const layoutScaleMultiplier = useGraphStore(state => state.autoLayoutSettings?.layoutScaleMultiplier ?? 1);
  const layoutIterationPreset = useGraphStore(state => state.autoLayoutSettings?.layoutIterations || 'balanced');
  const DEFAULT_FORCE_TUNER_SETTINGS = { layoutScale: 'balanced', layoutScaleMultiplier: 1, layoutIterations: 'balanced' };
  const forceTunerSettings = useGraphStore(state => state.forceTunerSettings || DEFAULT_FORCE_TUNER_SETTINGS);
  const forceLayoutScalePreset = forceTunerSettings.layoutScale || 'balanced';
  const forceLayoutScaleMultiplier = forceTunerSettings.layoutScaleMultiplier ?? 1;
  const forceLayoutIterationPreset = forceTunerSettings.layoutIterations || 'balanced';
  const edgesMap = useGraphStore(state => state.edges);
  const savedNodeIds = useGraphStore(state => state.savedNodeIds);
  const savedGraphIds = useGraphStore(state => state.savedGraphIds);
  const openGraphIds = useGraphStore(state => state.openGraphIds);
  const isUniverseLoaded = useGraphStore(state => state.isUniverseLoaded);
  const isUniverseLoading = useGraphStore(state => state.isUniverseLoading);
  const universeLoadingError = useGraphStore(state => state.universeLoadingError);
  const hasUniverseFile = useGraphStore(state => state.hasUniverseFile);

  useEffect(() => {
    const timerApi = typeof window !== 'undefined' ? window : globalThis;
    const timeoutId = timerApi.setTimeout(() => setResizersVisible(true), 180);
    return () => {
      if (typeof timerApi.clearTimeout === 'function') {
        timerApi.clearTimeout(timeoutId);
      }
    };
  }, []);

  // Store actions
  const cleanupOrphanedGraphs = useGraphStore(state => state.cleanupOrphanedGraphs);

  // Get hydrated nodes for the active graph
  const hydratedNodes = useMemo(() => {
    if (!activeGraphId || !graphsMap || !nodePrototypesMap) return [];
    const graph = graphsMap.get(activeGraphId);
    if (!graph || !graph.instances) return [];

    return Array.from(graph.instances.values()).map(instance => {
      const prototype = nodePrototypesMap.get(instance.prototypeId);
      if (!prototype) return null;
      return {
        ...prototype,
        ...instance,
      };
    }).filter(Boolean);
  }, [activeGraphId, graphsMap, nodePrototypesMap]);

  // <<< Derive active graph data directly >>>
  const activeGraphData = useMemo(() => {
    return activeGraphId ? graphsMap.get(activeGraphId) : null;
  }, [activeGraphId, graphsMap]);
  const activeGraphName = activeGraphData?.name ?? 'Loading...';
  const activeGraphDescription = activeGraphData?.description ?? '';

  useEffect(() => {
    if (!activeGraphId || !graphsMap || typeof graphsMap?.has !== 'function') return;
    if (graphsMap.has(activeGraphId)) return;
    if (!storeActions || typeof storeActions.createGraphWithId !== 'function') return;

    let fallbackName = 'New Thing';
    let fallbackDescription = '';
    let fallbackColor = NODE_DEFAULT_COLOR;

    if (nodePrototypesMap && typeof nodePrototypesMap.values === 'function') {
      for (const prototype of nodePrototypesMap.values()) {
        if (!prototype) continue;
        const definitionGraphIds = Array.isArray(prototype.definitionGraphIds)
          ? prototype.definitionGraphIds
          : Array.isArray(prototype.definitionGraphs)
            ? prototype.definitionGraphs
            : [];
        if (definitionGraphIds.includes(activeGraphId)) {
          if (prototype.name) {
            fallbackName = prototype.name;
          }
          if (prototype.description) {
            fallbackDescription = prototype.description;
          }
          if (prototype.color) {
            if (typeof prototype.color === 'string') {
              fallbackColor = prototype.color;
            } else if (typeof prototype.color === 'object') {
              if (typeof prototype.color.hex === 'string' && prototype.color.hex.trim()) {
                fallbackColor = prototype.color.hex;
              } else if (typeof prototype.color.toString === 'function') {
                const colorString = prototype.color.toString();
                if (typeof colorString === 'string' && colorString.trim()) {
                  fallbackColor = colorString;
                }
              }
            }
          }
          break;
        }
      }
    }

    try {
      storeActions.createGraphWithId(activeGraphId, {
        name: fallbackName,
        description: fallbackDescription,
        color: fallbackColor,
      });
    } catch (error) {
      console.warn('[NodeCanvas] Failed to auto-create graph canvas for', activeGraphId, error);
    }
  }, [activeGraphId, graphsMap, nodePrototypesMap, storeActions]);

  const headerGraphs = useMemo(() => {
    return openGraphIds.map(graphId => {
      const graph = graphsMap.get(graphId);
      if (!graph) return null;

      const definingNodeId = graph.definingNodeIds?.[0];
      const definingNode = definingNodeId ? nodePrototypesMap.get(definingNodeId) : null;

      // Skip graphs that don't have a valid defining node prototype
      if (!definingNodeId || !definingNode) {

        return null;
      }

      // Ensure color is a string
      let nodeColor = NODE_DEFAULT_COLOR || '#800000'; // Default fallback
      if (definingNode?.color) {
        if (typeof definingNode.color === 'string') {
          nodeColor = definingNode.color;
        } else if (typeof definingNode.color === 'object' && definingNode.color.hex) {
          // Handle case where color is an object with hex property
          nodeColor = definingNode.color.hex;
        } else if (typeof definingNode.color === 'object' && definingNode.color.toString) {
          // Try to convert object to string
          nodeColor = definingNode.color.toString();
        }
      }

      return {
        id: graph.id,
        name: graph.name || 'Untitled Graph',
        color: nodeColor,
        isActive: graph.id === activeGraphId,
        definingNodeId,
      };
    }).filter(Boolean);
  }, [openGraphIds, activeGraphId, graphsMap, nodePrototypesMap]);

  // Debug logging for headerGraphs validation
  useEffect(() => {
    if (headerGraphs.length > 0) {
      const invalidGraphs = headerGraphs.filter(graph => {
        if (!graph.definingNodeId) return true;
        return !nodePrototypesMap.has(graph.definingNodeId);
      });

      if (invalidGraphs.length > 0) {



        // Clean up orphaned graphs
        cleanupOrphanedGraphs();
      }
    }
  }, [headerGraphs, nodePrototypesMap, cleanupOrphanedGraphs]);

  // 

  // <<< Universe File Loading >>>
  useEffect(() => {
    const tryUniverseRestore = async () => {
      try {
        // Wait for backend to finish loading if it's in progress
        // Check if backend has already loaded data
        const currentState = useGraphStore.getState();
        const hasBackendLoadedData = currentState.nodePrototypes &&
          (currentState.nodePrototypes instanceof Map ? currentState.nodePrototypes.size > 0 : Object.keys(currentState.nodePrototypes).length > 0);

        if (hasBackendLoadedData) {
          console.log('[NodeCanvas] Backend already loaded universe data, skipping old fileStorage restore');
          // Backend has loaded data, don't try old restore path
          return;
        }

        // Wait a moment for backend to load if universe-backend-ready event hasn't fired yet
        if (typeof window !== 'undefined' && !window._universeBackendReady) {
          console.log('[NodeCanvas] Waiting for universe backend to finish loading...');
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 2000); // Max wait 2 seconds
            const handler = () => {
              clearTimeout(timeout);
              window.removeEventListener('universe-backend-ready', handler);
              resolve();
            };
            window.addEventListener('universe-backend-ready', handler);
          });
        }

        // Check again after waiting
        const stateAfterWait = useGraphStore.getState();
        const hasDataAfterWait = stateAfterWait.nodePrototypes &&
          (stateAfterWait.nodePrototypes instanceof Map ? stateAfterWait.nodePrototypes.size > 0 : Object.keys(stateAfterWait.nodePrototypes).length > 0);

        if (hasDataAfterWait) {
          console.log('[NodeCanvas] Backend loaded universe data while waiting, skipping old restore');
          return;
        }

        // Do not run legacy restore fallback here; allow backend to finalize hydration.
        // Onboarding modal will appear if no universe is loaded.
      } catch (error) {

        storeActions.setUniverseError(`Universe restore failed: ${error.message}`);
      }
    };

    tryUniverseRestore();
  }, []); // Run once on mount

  // Clean up any invalid open graphs on mount and when store changes
  useEffect(() => {
    cleanupOrphanedGraphs();
  }, [cleanupOrphanedGraphs, nodePrototypesMap]);

  // View option: allow browser-level trackpad pinch zoom when enabled
  const [trackpadZoomEnabled, setTrackpadZoomEnabled] = useState(false);

  // View option: fullscreen mode
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fullscreen toggle function
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        // Enter fullscreen
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        // Exit fullscreen
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Fullscreen toggle failed:', error);
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // <<< Prevent Page Zoom >>>
  useEffect(() => {
    const preventPageZoom = (e) => {
      // Detect zoom keyboard shortcuts
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isZoomKey = e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0';
      const isNumpadZoom = e.key === 'Add' || e.key === 'Subtract';

      // Prevent keyboard zoom shortcuts
      if (isCtrlOrCmd && (isZoomKey || isNumpadZoom)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Prevent F11 fullscreen (can interfere with zoom perception)
      if (e.key === 'F11') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    const preventWheelZoom = (e) => {
      if (trackpadZoomEnabled) return;
      // Prevent Ctrl+wheel zoom (both Mac and Windows)
      if (e.ctrlKey || e.metaKey) {
        // Only prevent if this wheel event is NOT over our canvas or panel tab bar
        const isOverCanvas = e.target.closest('.canvas-area') || e.target.closest('.canvas');
        const isOverPanelTabBar = e.target.closest('[data-panel-tabs="true"]');
        if (!isOverCanvas && !isOverPanelTabBar) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
    };

    const preventGestureZoom = (e) => {
      if (trackpadZoomEnabled) return;
      // Allow gestures within our canvas so we can handle them ourselves
      const isOverCanvas = e.target && (e.target.closest && (e.target.closest('.canvas-area') || e.target.closest('.canvas')));
      if (isOverCanvas) return; // let container-level handlers process
      // Prevent page-level gesture zoom elsewhere
      if (e.scale && e.scale !== 1) {
        e.preventDefault();
        try { e.stopPropagation(); } catch { }
        return false;
      }
    };

    // Add global event listeners
    document.addEventListener('keydown', preventPageZoom, { passive: false, capture: true });
    document.addEventListener('wheel', preventWheelZoom, { passive: false, capture: true });
    document.addEventListener('gesturestart', preventGestureZoom, { passive: false, capture: true });
    document.addEventListener('gesturechange', preventGestureZoom, { passive: false, capture: true });
    document.addEventListener('gestureend', preventGestureZoom, { passive: false, capture: true });

    return () => {
      document.removeEventListener('keydown', preventPageZoom, { capture: true });
      document.removeEventListener('wheel', preventWheelZoom, { capture: true });
      document.removeEventListener('gesturestart', preventGestureZoom, { capture: true });
      document.removeEventListener('gesturechange', preventGestureZoom, { capture: true });
      document.removeEventListener('gestureend', preventGestureZoom, { capture: true });
    };
  }, [trackpadZoomEnabled]);

  // <<< Initial Graph Creation Logic (Revised) >>>
  useEffect(() => {
    // Only run after universe has been loaded and we have a universe file
    if (!isUniverseLoaded || !hasUniverseFile) return;
    // Intentionally do nothing here. We no longer auto-create a default graph.
  }, [graphsMap, activeGraphId, openGraphIds, isUniverseLoaded, hasUniverseFile]);

  // Get raw data from store for memoization - derive from existing state
  const instances = useMemo(() => {
    if (!activeGraphId || !graphsMap) return null;
    return graphsMap.get(activeGraphId)?.instances;
  }, [activeGraphId, graphsMap]);

  const graphEdgeIds = useMemo(() => {
    if (!activeGraphId || !graphsMap) return null;
    return graphsMap.get(activeGraphId)?.edgeIds;
  }, [activeGraphId, graphsMap]);
  // Derive nodes and edges using useMemo for stable references
  const nodes = useMemo(() => {
    if (!instances || !nodePrototypesMap) return [];
    return Array.from(instances.values()).map(instance => {
      const prototype = nodePrototypesMap.get(instance.prototypeId);
      if (!prototype) return null;
      return {
        ...prototype,
        ...instance,
        // Always use prototype name
        name: prototype.name,
      };
    }).filter(Boolean);
  }, [instances, nodePrototypesMap]);

  const edges = useMemo(() => {
    if (!graphEdgeIds || !edgesMap) return [];
    return graphEdgeIds.map(id => edgesMap.get(id)).filter(Boolean);
  }, [graphEdgeIds, edgesMap]);

  // --- Performance: Precompute reusable maps and viewport bounds ---
  const nodeById = useMemo(() => {
    const map = new Map();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  // PERFORMANCE OPTIMIZATION: Cache dimensions based on node content, not position
  // Use a ref to persist the cache across renders, only recalculating when dimensional properties change
  const dimensionCacheRef = useRef(new Map());

  // Base dimensions for nodes (non-preview) for fast edge math and visibility checks
  const baseDimsById = useMemo(() => {
    const map = new Map();
    const cache = dimensionCacheRef.current;

    for (const n of nodes) {
      // Create a stable key based only on properties that affect dimensions
      // (not position x/y or scale which change during drag)
      const cacheKey = `${n.prototypeId}-${n.name}-${n.thumbnailSrc || 'noimg'}`;

      // Check if we have cached dimensions for this node's dimensional properties
      let dims = cache.get(cacheKey);

      if (!dims) {
        // Only calculate if not in cache
        dims = getNodeDimensions(n, false, null);
        cache.set(cacheKey, dims);
      }

      map.set(n.id, dims);
    }

    // Clean up cache entries for nodes that no longer exist
    // Only keep entries for current nodes to prevent memory leaks
    const currentCacheKeys = new Set(nodes.map(n => `${n.prototypeId}-${n.name}-${n.thumbnailSrc || 'noimg'}`));
    for (const key of cache.keys()) {
      if (!currentCacheKeys.has(key)) {
        cache.delete(key);
      }
    }

    return map;
  }, [nodes]);
  // Defer viewport-dependent culling until pan/zoom state is initialized below
  const [visibleNodeIds, setVisibleNodeIds] = useState(() => new Set());
  const [visibleEdges, setVisibleEdges] = useState(() => []);



  // --- Local UI State (Keep these) ---
  const [selectedInstanceIds, setSelectedInstanceIds] = useState(new Set());

  // Onboarding modal state
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  // Help modal state
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Show onboarding modal when there's no universe file and universe isn't loaded
  useEffect(() => {
    // Check if user has already completed onboarding
    let hasCompletedOnboarding = false;
    try {
      if (typeof window !== 'undefined') {
        hasCompletedOnboarding = localStorage.getItem('redstring-alpha-welcome-seen') === 'true';
      }
    } catch { }

    // Suppress welcome modal if Git auth/app flow is pending or resuming
    let suppressForGitFlow = false;
    try {
      if (typeof window !== 'undefined') {
        suppressForGitFlow = (
          sessionStorage.getItem('github_oauth_pending') === 'true' ||
          sessionStorage.getItem('github_app_pending') === 'true' ||
          sessionStorage.getItem('redstring_onboarding_resume') === 'true'
        );
      }
    } catch { }

    const shouldShowOnboarding =
      !hasCompletedOnboarding &&
      !suppressForGitFlow &&
      !isUniverseLoading && (
        !hasUniverseFile ||
        !isUniverseLoaded ||
        !!universeLoadingError
      );

    if (shouldShowOnboarding && !showOnboardingModal) {
      setShowOnboardingModal(true);
    }
  }, [isUniverseLoading, hasUniverseFile, isUniverseLoaded, universeLoadingError, showOnboardingModal]);

  // Open Federation panel when global event is dispatched (from SaveStatusDisplay CTA)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handler = () => {
      try {
        setLeftPanelExpanded(true);
        setLeftPanelInitialView('federation');
      } catch { }
    };

    window.addEventListener('redstring:open-federation', handler);
    return () => window.removeEventListener('redstring:open-federation', handler);
  }, []);

  // Open Federation panel when event is dispatched from onboarding or help
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handler = () => {
      try {
        setLeftPanelExpanded(true);
        setLeftPanelInitialView('federation');
      } catch { }
    };

    window.addEventListener('openGitFederation', handler);
    return () => window.removeEventListener('openGitFederation', handler);
  }, []);

  // Open Help modal when event is dispatched
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handler = () => {
      try {
        setShowHelpModal(true);
      } catch { }
    };

    window.addEventListener('openHelpModal', handler);
    return () => window.removeEventListener('openHelpModal', handler);
  }, []);

  // Open Onboarding modal when event is dispatched from Help menu
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handler = () => {
      try {
        setShowOnboardingModal(true);
      } catch { }
    };

    window.addEventListener('openOnboardingModal', handler);
    return () => window.removeEventListener('openOnboardingModal', handler);
  }, []);

  // Resume Git onboarding after OAuth/App redirects by opening Federation panel and hiding modal
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const pendingOAuth = sessionStorage.getItem('github_oauth_pending') === 'true';
      const pendingApp = sessionStorage.getItem('github_app_pending') === 'true';
      const resumeOnboarding = sessionStorage.getItem('redstring_onboarding_resume') === 'true';
      if (pendingOAuth || pendingApp || resumeOnboarding) {
        setLeftPanelExpanded(true);
        setLeftPanelInitialView('federation');
        setShowOnboardingModal(false);
      }
    } catch (e) {
      // ignore sessionStorage errors
    }
  }, []);
  const [draggingNodeInfo, setDraggingNodeInfo] = useState(null); // Renamed, structure might change
  const [longPressingInstanceId, setLongPressingInstanceId] = useState(null); // Store ID
  const [drawingConnectionFrom, setDrawingConnectionFrom] = useState(null); // Structure might change (store source ID)

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [recentlyPanned, setRecentlyPanned] = useState(false);

  const [selectionRect, setSelectionRect] = useState(null);
  const [selectionStart, setSelectionStart] = useState(null);

  const labelCacheResetRef = useRef(null);
  const resetConnectionLabelCache = useCallback(() => {
    if (typeof labelCacheResetRef.current === 'function') {
      labelCacheResetRef.current();
    }
  }, []);

  // Panel expansion states - must be defined before viewport bounds hook
  const [leftPanelExpanded, setLeftPanelExpanded] = useState(true);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(true);
  const [leftPanelInitialView, setLeftPanelInitialView] = useState(null); // Control which view to open in left panel

  // Use proper viewport bounds hook for accurate, live viewport calculations
  const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, false);

  // Calculate viewport size - use fixed window dimensions for canvas coordinate system
  // This ensures canvas coordinates are independent of panel state
  const [windowSize, setWindowSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));

  const viewportSize = useMemo(() => ({
    width: windowSize.width,
    height: windowSize.height,
  }), [windowSize.width, windowSize.height]);

  const viewportSizeRef = useRef(viewportSize);
  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize.width, viewportSize.height]);

  // Listen for window resize to update viewport size
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Large fixed canvas - stable coordinate system
  const canvasSize = useMemo(() => {
    // Use a very large fixed canvas that can accommodate any reasonable usage
    const canvasWidth = 100000;  // 100k x 100k - huge but finite
    const canvasHeight = 100000;

    // Center the canvas so (0,0) is in the middle
    const offsetX = -canvasWidth / 2;   // -50000
    const offsetY = -canvasHeight / 2;  // -50000

    return {
      width: canvasWidth,
      height: canvasHeight,
      offsetX,
      offsetY
    };
  }, []); // Fixed - never changes

  const canvasSizeRef = useRef(canvasSize);
  useEffect(() => {
    canvasSizeRef.current = canvasSize;
  }, [canvasSize]);

  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomLevelRef = useRef(zoomLevel);
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  const stopPanMomentum = useCallback(() => {
    const { animationId } = panMomentumRef.current;
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    panMomentumRef.current.animationId = null;
    panMomentumRef.current.vx = 0;
    panMomentumRef.current.vy = 0;
    panMomentumRef.current.lastTime = 0;
    panMomentumRef.current.source = null;
    panMomentumRef.current.active = false;
    isPanningOrZooming.current = false;
    panVelocityHistoryRef.current = [];
  }, []);

  const startPanMomentum = useCallback((initialVx, initialVy, source = 'touch') => {
    if (!Number.isFinite(initialVx) || !Number.isFinite(initialVy)) {
      return false;
    }
    stopPanMomentum();
    const boost = source === 'trackpad' ? TRACKPAD_PAN_MOMENTUM_BOOST : TOUCH_PAN_MOMENTUM_BOOST;
    const frictionBase = source === 'trackpad' ? TRACKPAD_PAN_FRICTION : TOUCH_PAN_FRICTION;
    const vx = initialVx * boost;
    const vy = initialVy * boost;
    if (Math.hypot(vx, vy) < PAN_MOMENTUM_MIN_SPEED) {
      return false;
    }

    panMomentumRef.current.vx = vx;
    panMomentumRef.current.vy = vy;
    panMomentumRef.current.lastTime = performance.now();
    panMomentumRef.current.source = source;
    panMomentumRef.current.active = true;

    const step = (time) => {
      const ref = panMomentumRef.current;
      if (!ref.active) {
        return;
      }
      const lastTime = ref.lastTime || time;
      const dt = Math.min(32, Math.max(1, time - lastTime));
      ref.lastTime = time;

      const moveX = ref.vx * dt;
      const moveY = ref.vy * dt;

      // Calculate the new pan offset and track what actually got applied
      const viewport = viewportSizeRef.current;
      const canvas = canvasSizeRef.current;
      const z = zoomLevelRef.current;

      if (!viewport || !canvas || !z) {
        stopPanMomentum();
        return;
      }

      // Track if we hit bounds to stop momentum in that direction
      let hitBoundsX = false;
      let hitBoundsY = false;

      setPanOffset(prev => {
        const minX = viewport.width - canvas.width * z;
        const minY = viewport.height - canvas.height * z;
        const maxX = 0;
        const maxY = 0;
        const targetX = prev.x + moveX;
        const targetY = prev.y + moveY;
        const clampedX = Math.min(Math.max(targetX, minX), maxX);
        const clampedY = Math.min(Math.max(targetY, minY), maxY);

        // Check if we hit bounds
        hitBoundsX = Math.abs(clampedX - targetX) > 0.01;
        hitBoundsY = Math.abs(clampedY - targetY) > 0.01;

        return { x: clampedX, y: clampedY };
      });

      const damping = Math.pow(frictionBase, dt / PAN_MOMENTUM_FRAME);

      // If we hit bounds, stop momentum in that direction
      if (hitBoundsX) {
        ref.vx = 0;
      } else {
        ref.vx *= damping;
      }
      if (hitBoundsY) {
        ref.vy = 0;
      } else {
        ref.vy *= damping;
      }

      const speed = Math.hypot(ref.vx, ref.vy);
      if (speed < PAN_MOMENTUM_MIN_SPEED) {
        stopPanMomentum();
        isPanningOrZooming.current = false;
        return;
      }

      ref.animationId = requestAnimationFrame(step);
    };

    isPanningOrZooming.current = true;
    panMomentumRef.current.animationId = requestAnimationFrame(step);
    return true;
  }, [stopPanMomentum, setPanOffset]);

  useEffect(() => {
    return () => stopPanMomentum();
  }, [stopPanMomentum]);

  // Center view on instances of a prototype within the active graph
  const navigateToPrototypeInstances = useCallback((prototypeId) => {
    try {
      if (!activeGraphId || !nodes || nodes.length === 0 || !containerRef.current) return;
      const matching = nodes.filter(n => n.prototypeId === prototypeId);
      if (matching.length === 0) return;

      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      matching.forEach(node => {
        const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + dims.currentWidth);
        maxY = Math.max(maxY, node.y + dims.currentHeight);
      });

      const nodesCenterX = (minX + maxX) / 2;
      const nodesCenterY = (minY + maxY) / 2;
      const nodesWidth = Math.max(1, maxX - minX);
      const nodesHeight = Math.max(1, maxY - minY);

      const padding = 180; // slightly more padding for less aggressive zoom
      const targetZoomX = viewportSize.width / (nodesWidth + padding * 2);
      const targetZoomY = viewportSize.height / (nodesHeight + padding * 2);
      const rawZoom = Math.min(targetZoomX, targetZoomY);
      const maxSearchZoom = 0.6; // cap zoom-in for search navigation
      const targetZoom = Math.min(MAX_ZOOM, Math.max(0.05, Math.min(rawZoom, maxSearchZoom)));

      const targetPanX = viewportSize.width / 2 - nodesCenterX * targetZoom + canvasSize.offsetX * targetZoom;
      const targetPanY = viewportSize.height / 2 - nodesCenterY * targetZoom + canvasSize.offsetY * targetZoom;

      const maxPanX = 0;
      const maxPanY = 0;
      const minPanX = viewportSize.width - canvasSize.width * targetZoom;
      const minPanY = viewportSize.height - canvasSize.height * targetZoom;
      const finalPanX = Math.min(Math.max(targetPanX, minPanX), maxPanX);
      const finalPanY = Math.min(Math.max(targetPanY, minPanY), maxPanY);

      setZoomLevel(targetZoom);
      setPanOffset({ x: finalPanX, y: finalPanY });
    } catch { }
  }, [activeGraphId, nodes, baseDimsById, viewportSize, canvasSize, MAX_ZOOM]);

  // Function to move out-of-bounds nodes back into canvas while preserving relative positions
  const moveOutOfBoundsNodesInBounds = useCallback(() => {
    if (!nodes || nodes.length === 0) return;

    // Find nodes that are outside canvas bounds
    const outOfBoundsNodes = [];
    const canvasMinX = canvasSize.offsetX;
    const canvasMinY = canvasSize.offsetY;
    const canvasMaxX = canvasSize.offsetX + canvasSize.width;
    const canvasMaxY = canvasSize.offsetY + canvasSize.height;

    nodes.forEach(node => {
      const dims = baseDimsById.get(node.id);
      if (!dims) return;

      const nodeLeft = node.x;
      const nodeTop = node.y;
      const nodeRight = node.x + dims.currentWidth;
      const nodeBottom = node.y + dims.currentHeight;

      // Check if node is outside bounds
      if (nodeLeft < canvasMinX || nodeRight > canvasMaxX ||
        nodeTop < canvasMinY || nodeBottom > canvasMaxY) {
        outOfBoundsNodes.push({
          ...node,
          dims,
          left: nodeLeft,
          top: nodeTop,
          right: nodeRight,
          bottom: nodeBottom
        });
      }
    });

    if (outOfBoundsNodes.length === 0) {
      // console.log('No out-of-bounds nodes found');
      return;
    }

    // console.log(`Found ${outOfBoundsNodes.length} out-of-bounds nodes, moving them back...`);

    // Calculate bounding box of all out-of-bounds nodes
    let groupMinX = Infinity, groupMinY = Infinity;
    let groupMaxX = -Infinity, groupMaxY = -Infinity;

    outOfBoundsNodes.forEach(node => {
      groupMinX = Math.min(groupMinX, node.left);
      groupMinY = Math.min(groupMinY, node.top);
      groupMaxX = Math.max(groupMaxX, node.right);
      groupMaxY = Math.max(groupMaxY, node.bottom);
    });

    const groupWidth = groupMaxX - groupMinX;
    const groupHeight = groupMaxY - groupMinY;

    // Calculate safe area within canvas (with padding)
    const padding = 1000;
    const safeMinX = canvasMinX + padding;
    const safeMinY = canvasMinY + padding;
    const safeMaxX = canvasMaxX - padding;
    const safeMaxY = canvasMaxY - padding;
    const safeWidth = safeMaxX - safeMinX;
    const safeHeight = safeMaxY - safeMinY;

    // Calculate where to place the group (center it in safe area)
    const targetCenterX = safeMinX + safeWidth / 2;
    const targetCenterY = safeMinY + safeHeight / 2;
    const currentCenterX = groupMinX + groupWidth / 2;
    const currentCenterY = groupMinY + groupHeight / 2;

    // Calculate offset to move the group
    const offsetX = targetCenterX - currentCenterX;
    const offsetY = targetCenterY - currentCenterY;

    // Apply the offset to all out-of-bounds nodes
    const positionUpdates = outOfBoundsNodes.map(node => ({
      instanceId: node.id,
      x: node.x + offsetX,
      y: node.y + offsetY
    }));

    storeActions.updateMultipleNodeInstancePositions(activeGraphId, positionUpdates);
    resetConnectionLabelCache();
    // console.log(`Moved ${outOfBoundsNodes.length} nodes back into bounds`);
  }, [nodes, baseDimsById, canvasSize, storeActions, activeGraphId]);

  const applyAutoLayoutToActiveGraph = useCallback(() => {
    if (!activeGraphId) {
      alert('No active graph is selected for auto-layout.');
      return;
    }

    if (!nodes || nodes.length === 0) {
      alert('Active graph has no nodes to layout yet.');
      return;
    }

    const layoutNodes = nodes.map(node => {
      const cachedDims = baseDimsById.get(node.id);
      const realDims = cachedDims && cachedDims.currentWidth && cachedDims.currentHeight
        ? cachedDims
        : getNodeDimensions(node, false, null);
      const labelWidth = realDims?.currentWidth ?? FORCE_LAYOUT_DEFAULTS.nodeSpacing;
      const labelHeight = realDims?.currentHeight ?? FORCE_LAYOUT_DEFAULTS.nodeSpacing;

      return {
        id: node.id,
        prototypeId: node.prototypeId,
        x: typeof node.x === 'number' ? node.x : 0,
        y: typeof node.y === 'number' ? node.y : 0,
        width: labelWidth,
        height: labelHeight,
        labelWidth,
        labelHeight,
        imageHeight: realDims?.calculatedImageHeight ?? 0,
        nodeSize: Math.max(labelWidth, labelHeight, FORCE_LAYOUT_DEFAULTS.nodeSpacing)
      };
    });

    const layoutEdges = edges
      .filter(edge => edge && edge.sourceId && edge.destinationId)
      .map(edge => ({
        sourceId: edge.sourceId,
        destinationId: edge.destinationId
      }));

    const layoutWidth = Math.max(2000, canvasSize?.width || 2000);
    const layoutHeight = Math.max(2000, canvasSize?.height || 2000);
    const layoutPadding = Math.max(300, Math.min(layoutWidth, layoutHeight) * 0.08);

    const layoutOptions = {
      width: layoutWidth,
      height: layoutHeight,
      padding: layoutPadding,
      layoutScale: layoutScalePreset,
      layoutScaleMultiplier,
      iterationPreset: layoutIterationPreset,
      useExistingPositions: false
    };

    try {
      let updates = applyLayout(layoutNodes, layoutEdges, 'force-directed', layoutOptions);

      if (!updates || updates.length === 0) {
        console.warn('[AutoLayout] Layout produced no updates.');
        return;
      }

      // Recentering: shift layout output so it's centered within current canvas
      if (canvasSize && updates.length > 0) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        updates.forEach(update => {
          if (update.x < minX) minX = update.x;
          if (update.y < minY) minY = update.y;
          if (update.x > maxX) maxX = update.x;
          if (update.y > maxY) maxY = update.y;
        });
        if (Number.isFinite(minX) && Number.isFinite(maxX)) {
          const producedCenterX = (minX + maxX) / 2;
          const producedCenterY = (minY + maxY) / 2;
          const targetCenterX = canvasSize.offsetX + canvasSize.width / 2;
          const targetCenterY = canvasSize.offsetY + canvasSize.height / 2;
          const shiftX = targetCenterX - producedCenterX;
          const shiftY = targetCenterY - producedCenterY;
          updates = updates.map(update => ({
            ...update,
            x: Math.round(update.x + shiftX),
            y: Math.round(update.y + shiftY)
          }));
        }
      }

      resetConnectionLabelCache();
      storeActions.updateMultipleNodeInstancePositions(
        activeGraphId,
        updates,
        { finalize: true, source: 'auto-layout', algorithm: 'force-directed' }
      );
      resetConnectionLabelCache();

      console.log('[AutoLayout] Applied force-directed layout to graph', activeGraphId, 'for', updates.length, 'nodes.');

      setTimeout(() => {
        try {
          moveOutOfBoundsNodesInBounds();
        } catch (boundErr) {
          console.warn('[AutoLayout] Bound correction failed:', boundErr);
        }
        // Center view on newly laid out graph (back to civilization)
        // Dispatch event so the listener can handle it (avoids dependency issues)
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('rs-auto-layout-complete', {
            detail: { graphId: activeGraphId, nodeCount: updates.length }
          }));
        }, 100);
      }, 0);
    } catch (error) {
      console.error('[AutoLayout] Failed to apply layout:', error);
      alert(`Auto-layout failed: ${error.message}`);
    }
  }, [activeGraphId, baseDimsById, nodes, edges, storeActions, moveOutOfBoundsNodesInBounds, resetConnectionLabelCache, layoutScalePreset, layoutScaleMultiplier, layoutIterationPreset, canvasSize]);

  const condenseGraphNodes = useCallback(() => {
    if (!activeGraphId || !nodes?.length) return;
    const targetX = canvasSize.offsetX + canvasSize.width / 2;
    const targetY = canvasSize.offsetY + canvasSize.height / 2;
    const radius = Math.min(160, Math.max(60, 160 - nodes.length));
    const updates = nodes.map((node, index) => {
      const angle = (2 * Math.PI * index) / nodes.length;
      return {
        instanceId: node.id,
        x: targetX + Math.cos(angle) * radius * 0.3,
        y: targetY + Math.sin(angle) * radius * 0.3
      };
    });

    storeActions.updateMultipleNodeInstancePositions(
      activeGraphId,
      updates,
      { finalize: true, source: 'condense' }
    );
    resetConnectionLabelCache();
  }, [activeGraphId, nodes, canvasSize, storeActions, resetConnectionLabelCache]);

  // Auto-correct out-of-bounds nodes on graph load
  useEffect(() => {
    if (nodes && nodes.length > 0 && activeGraphId) {
      // Small delay to ensure dimensions are calculated
      const timer = setTimeout(() => {
        moveOutOfBoundsNodesInBounds();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [activeGraphId, moveOutOfBoundsNodesInBounds]);

  // Expose functions to window for manual use (for debugging/testing)
  useEffect(() => {
    window.moveOutOfBoundsNodesInBounds = moveOutOfBoundsNodesInBounds;

    return () => {
      delete window.moveOutOfBoundsNodesInBounds;
    };
  }, [moveOutOfBoundsNodesInBounds]);

  // Hover state for grid when mode is 'hover'

  /**
   * Transforms client/screen coordinates to canvas coordinates.
   * Wrapper around GeometryUtils.clientToCanvasCoordinates with current state.
   */
  const clientToCanvasCoordinates = useCallback((clientX, clientY) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return GeometryUtils.clientToCanvasCoordinates(clientX, clientY, rect, panOffset, zoomLevel, canvasSize);
  }, [panOffset, zoomLevel, canvasSize]);

  // --- Grid Snapping Helpers ---
  const snapToGrid = (mouseX, mouseY, nodeWidth, nodeHeight) => {
    return GeometryUtils.snapToGrid(mouseX, mouseY, nodeWidth, nodeHeight, gridMode, gridSize);
  };

  const snapToGridAnimated = (mouseX, mouseY, nodeWidth, nodeHeight, currentPos) => {
    return GeometryUtils.snapToGridAnimated(mouseX, mouseY, nodeWidth, nodeHeight, currentPos, gridMode, gridSize);
  };
  // Calculate proper minimum zoom to prevent zooming beyond canvas edges
  const MIN_ZOOM = Math.max(
    viewportSize.width / canvasSize.width,
    viewportSize.height / canvasSize.height,
    0.05  // Absolute minimum
  );

  // Compute and update culling sets when pan/zoom or graph state changes (batch to next frame)
  useEffect(() => {
    if (!ENABLE_CULLING) {
      // CULLING DISABLED - Show all nodes and edges
      setVisibleNodeIds(new Set(nodes.map(n => n.id)));
      setVisibleEdges(edges);
      return;
    }

    // Guard until basic view state is present
    if (!viewportSize || !canvasSize) return;

    // Skip expensive culling during pinch zoom animation to prevent jitter
    if (pinchSmoothingRef.current.isAnimating) {
      return;
    }

    let rafId = null;
    const compute = () => {
      // Derive canvas-space viewport
      const minX = (-panOffset.x) / zoomLevel + canvasSize.offsetX;
      const minY = (-panOffset.y) / zoomLevel + canvasSize.offsetY;
      const maxX = minX + viewportSize.width / zoomLevel;
      const maxY = minY + viewportSize.height / zoomLevel;

      const padding = 400;
      const expanded = {
        minX: minX - padding,
        minY: minY - padding,
        maxX: maxX + padding,
        maxY: maxY + padding,
      };

      // Visible nodes - Fixed viewport culling
      const nextVisibleNodeIds = new Set();
      for (const n of nodes) {
        const dims = baseDimsById.get(n.id);
        if (!dims) continue;

        // Node bounds in canvas space
        const nx1 = n.x;
        const ny1 = n.y;
        const nx2 = n.x + dims.currentWidth;
        const ny2 = n.y + dims.currentHeight;

        // Check if node intersects with expanded viewport area
        const isVisible = !(nx2 < expanded.minX || nx1 > expanded.maxX || ny2 < expanded.minY || ny1 > expanded.maxY);

        if (isVisible) {
          nextVisibleNodeIds.add(n.id);
        }
      }

      // Visible edges - Fixed viewport culling
      const nextVisibleEdges = [];
      for (const edge of edges) {
        const s = nodeById.get(edge.sourceId);
        const d = nodeById.get(edge.destinationId);
        if (!s || !d) continue;
        const sDims = baseDimsById.get(s.id);
        const dDims = baseDimsById.get(d.id);
        if (!sDims || !dDims) continue;

        // Simple edge visibility: if either node is visible, edge is visible
        if (nextVisibleNodeIds.has(edge.sourceId) || nextVisibleNodeIds.has(edge.destinationId)) {
          nextVisibleEdges.push(edge);
        }
      }

      setVisibleNodeIds(nextVisibleNodeIds);
      setVisibleEdges(nextVisibleEdges);
    };

    rafId = requestAnimationFrame(compute);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [panOffset, zoomLevel, viewportSize, canvasSize, nodes, edges, baseDimsById, nodeById]);





  // Port-based routing with intelligent edge distribution - inspired by circuit board routing
  const cleanLaneOffsets = useMemo(() => {
    const portAssignments = new Map(); // edgeId -> { sourcePort, destPort }
    if (!enableAutoRouting || routingStyle !== 'clean' || !visibleEdges?.length) return portAssignments;

    try {
      // Step 1: Group edges by node pairs and assign ports intelligently
      const nodePortUsage = new Map(); // nodeId -> { top: [], bottom: [], left: [], right: [] }

      // Initialize port usage tracking for all nodes
      for (const node of nodes) {
        nodePortUsage.set(node.id, { top: [], bottom: [], left: [], right: [] });
      }

      // Step 2: Assign ports for each edge based on direction and avoid clustering
      for (const edge of visibleEdges) {
        const s = nodeById.get(edge.sourceId);
        const d = nodeById.get(edge.destinationId);
        if (!s || !d) continue;

        const sDims = baseDimsById.get(s.id);
        const dDims = baseDimsById.get(d.id);
        if (!sDims || !dDims) continue;

        // Calculate node centers
        const sCenterX = s.x + sDims.currentWidth / 2;
        const sCenterY = s.y + sDims.currentHeight / 2;
        const dCenterX = d.x + dDims.currentWidth / 2;
        const dCenterY = d.y + dDims.currentHeight / 2;

        // Determine optimal ports based on relative position - favor left/right sides
        const deltaX = dCenterX - sCenterX;
        const deltaY = dCenterY - sCenterY;

        let sourceSide, destSide;

        // Bias toward left/right sides (where text is) unless the connection is strongly vertical
        const isStronglyVertical = Math.abs(deltaY) > Math.abs(deltaX) * 1.5; // 1.5x bias toward horizontal

        if (isStronglyVertical) {
          // Strong vertical connection - use top/bottom
          sourceSide = deltaY > 0 ? 'bottom' : 'top';
          destSide = deltaY > 0 ? 'top' : 'bottom';
        } else {
          // Horizontal or diagonal - prefer left/right sides
          sourceSide = deltaX > 0 ? 'right' : 'left';
          destSide = deltaX > 0 ? 'left' : 'right';
        }

        // Calculate port positions on the non-rounded edge segments
        const cornerRadius = NODE_CORNER_RADIUS || 8;
        const sourcePortPos = getPortPosition(s, sDims, sourceSide, cornerRadius);
        const destPortPos = getPortPosition(d, dDims, destSide, cornerRadius);

        // Distribute edges along the side to avoid clustering
        const sourceUsage = nodePortUsage.get(s.id)[sourceSide];
        const destUsage = nodePortUsage.get(d.id)[destSide];

        // Calculate staggered positions along the edge
        const sourceStagger = calculateStaggeredPosition(sourcePortPos, sourceSide, sourceUsage.length, sDims, cornerRadius, cleanLaneSpacing);
        const destStagger = calculateStaggeredPosition(destPortPos, destSide, destUsage.length, dDims, cornerRadius, cleanLaneSpacing);

        // Record port usage
        sourceUsage.push(edge.id);
        destUsage.push(edge.id);

        portAssignments.set(edge.id, {
          sourcePort: sourceStagger,
          destPort: destStagger,
          sourceSide,
          destSide
        });
      }

      return portAssignments;
    } catch (error) {

      return new Map();
    }
  }, [enableAutoRouting, routingStyle, visibleEdges, nodeById, baseDimsById, nodes]);

  const [debugMode, setDebugMode] = useState(false); // Debug mode disabled
  // Debug data state removed - debug mode disabled
  const [isPaused, setIsPaused] = useState(false);
  const [lastInteractionType, setLastInteractionType] = useState(null);
  const [isViewReady, setIsViewReady] = useState(false);

  const [plusSign, setPlusSign] = useState(null);
  const [videoAnimation, setVideoAnimation] = useState(null); // Y-key video animation state
  const [nodeNamePrompt, setNodeNamePrompt] = useState({ visible: false, name: '', color: null });
  const [connectionNamePrompt, setConnectionNamePrompt] = useState({ visible: false, name: '', color: null, edgeId: null });
  const [abstractionPrompt, setAbstractionPrompt] = useState({ visible: false, name: '', color: null, direction: 'above', nodeId: null, carouselLevel: null });
  const [nodeGroupPrompt, setNodeGroupPrompt] = useState({ visible: false, name: '', color: null, groupId: null });

  // Add logging for abstraction prompt state changes
  useEffect(() => {

  }, [abstractionPrompt]);

  // Dialog color picker state
  const [dialogColorPickerVisible, setDialogColorPickerVisible] = useState(false);
  const [dialogColorPickerPosition, setDialogColorPickerPosition] = useState({ x: 0, y: 0 });

  // Add to group dialog state
  const [addToGroupDialog, setAddToGroupDialog] = useState(null); // { nodeId, groupId, groupName, isNodeGroup, position }

  // Pie menu color picker state
  const [pieMenuColorPickerVisible, setPieMenuColorPickerVisible] = useState(false);
  const [pieMenuColorPickerPosition, setPieMenuColorPickerPosition] = useState({ x: 0, y: 0 });
  const [activePieMenuColorNodeId, setActivePieMenuColorNodeId] = useState(null);
  const [nodeSelectionGrid, setNodeSelectionGrid] = useState({ visible: false, position: { x: 0, y: 0 } });

  // Carousel PieMenu stage state
  const [carouselPieMenuStage, setCarouselPieMenuStage] = useState(1); // 1 = main stage, 2 = position selection stage
  const [isCarouselStageTransition, setIsCarouselStageTransition] = useState(false); // Flag to track internal stage transitions
  // Request for AbstractionCarousel to move focus relative to current (up/down)
  const [carouselRelativeMoveRequest, setCarouselRelativeMoveRequest] = useState(null); // 'up' | 'down' | null

  // Add logging for carousel stage changes
  useEffect(() => {

  }, [carouselPieMenuStage]);

  const [isHeaderEditing, setIsHeaderEditing] = useState(false);
  const [isRightPanelInputFocused, setIsRightPanelInputFocused] = useState(false);
  const [isLeftPanelInputFocused, setIsLeftPanelInputFocused] = useState(false);
  const [isPieMenuRendered, setIsPieMenuRendered] = useState(false); // Controls if PieMenu is in DOM for animation
  const [currentPieMenuData, setCurrentPieMenuData] = useState(null); // Holds { node, buttons, nodeDimensions }
  const [editingNodeIdOnCanvas, setEditingNodeIdOnCanvas] = useState(null); // For panel-less editing
  const [editingGroupId, setEditingGroupId] = useState(null); // For group inline editing
  const [tempGroupName, setTempGroupName] = useState(''); // Temporary name during editing
  const [hasMouseMovedSinceDown, setHasMouseMovedSinceDown] = useState(false);
  const [hoveredEdgeInfo, setHoveredEdgeInfo] = useState(null); // Track hovered edge and which end

  // Hover vision aid state
  const [hoveredNodeForVision, setHoveredNodeForVision] = useState(null);
  const [hoveredConnectionForVision, setHoveredConnectionForVision] = useState(null);
  const [activePieMenuItemForVision, setActivePieMenuItemForVision] = useState(null);

  const clearVisionAid = useCallback(() => {
    setHoveredNodeForVision(null);
    setHoveredConnectionForVision(null);
    setActivePieMenuItemForVision(null);
    setHoveredEdgeInfo(null);
  }, []);

  const handlePieMenuHoverChange = useCallback((button) => {
    if (button?.label) {
      setActivePieMenuItemForVision({ id: button.id, label: button.label });
    } else {
      setActivePieMenuItemForVision(null);
    }
  }, []);

  // Connection control panel animation state


  // New states for PieMenu transition
  const [selectedNodeIdForPieMenu, setSelectedNodeIdForPieMenu] = useState(null);
  const [isTransitioningPieMenu, setIsTransitioningPieMenu] = useState(false);

  // Abstraction Carousel states
  const [abstractionCarouselVisible, setAbstractionCarouselVisible] = useState(false);
  const [abstractionCarouselNode, setAbstractionCarouselNode] = useState(null);
  const [pendingAbstractionNodeId, setPendingAbstractionNodeId] = useState(null);
  const [pendingDecomposeNodeId, setPendingDecomposeNodeId] = useState(null);
  const [carouselFocusedNodeScale, setCarouselFocusedNodeScale] = useState(1.2);
  const [carouselFocusedNodeDimensions, setCarouselFocusedNodeDimensions] = useState(null);
  const [carouselFocusedNode, setCarouselFocusedNode] = useState(null); // Track which node is currently focused in carousel

  // Animation states for carousel
  const [carouselAnimationState, setCarouselAnimationState] = useState('hidden'); // 'hidden', 'entering', 'visible', 'exiting'
  const [justCompletedCarouselExit, setJustCompletedCarouselExit] = useState(false);

  // Abstraction dimension management
  const [abstractionDimensions, setAbstractionDimensions] = useState(['Generalization Axis']);
  const [currentAbstractionDimension, setCurrentAbstractionDimension] = useState('Generalization Axis');

  // Abstraction control panel states
  const [abstractionControlPanelVisible, setAbstractionControlPanelVisible] = useState(false);
  const [abstractionControlPanelShouldShow, setAbstractionControlPanelShouldShow] = useState(false);
  const [isPieMenuActionInProgress, setIsPieMenuActionInProgress] = useState(false);
  const [nodeControlPanelVisible, setNodeControlPanelVisible] = useState(false);
  const [nodeControlPanelShouldShow, setNodeControlPanelShouldShow] = useState(false);
  const [groupControlPanelShouldShow, setGroupControlPanelShouldShow] = useState(false);
  const [groupControlPanelVisible, setGroupControlPanelVisible] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  // Preserve last selections during exit animations
  const [lastSelectedNodePrototypes, setLastSelectedNodePrototypes] = useState([]);
  const [lastSelectedGroup, setLastSelectedGroup] = useState(null);
  const [connectionControlPanelVisible, setConnectionControlPanelVisible] = useState(false);
  const [connectionControlPanelShouldShow, setConnectionControlPanelShouldShow] = useState(false);

  // Pending swap operation state
  const [pendingSwapOperation, setPendingSwapOperation] = useState(null);

  // Header search state
  const [headerSearchVisible, setHeaderSearchVisible] = useState(false);
  const [autoGraphModalVisible, setAutoGraphModalVisible] = useState(false);
  const [forceSimModalVisible, setForceSimModalVisible] = useState(false);


  // Define carousel callbacks outside conditional rendering to avoid hook violations
  const onCarouselAnimationStateChange = useCallback((newState) => {
    setCarouselAnimationState(newState);
  }, []);

  const onCarouselClose = useCallback(() => {
    // Use the same logic as the back button for a smooth transition
    // Mark that this closure was initiated by a click-away so we can avoid reopening PieMenu
    carouselClosedByClickAwayRef.current = true;
    setSelectedNodeIdForPieMenu(null);
    setIsTransitioningPieMenu(true);
  }, []);

  const onCarouselReplaceNode = useCallback((oldNodeId, newNodeData) => {
    // TODO: Implement node replacement functionality

  }, []);

  // Prevent carousel stage resets while abstraction prompt is open
  useEffect(() => {
    if (abstractionPrompt.visible && carouselPieMenuStage !== 2) {



      setCarouselPieMenuStage(2);
      // Don't mark this as a stage transition to avoid hiding the pie menu
      // setIsCarouselStageTransition(true);

      // Ensure the pie menu remains visible during abstraction prompt
      if (!selectedNodeIdForPieMenu && abstractionCarouselNode) {

        setSelectedNodeIdForPieMenu(abstractionCarouselNode.id);
      }
    }
  }, [abstractionPrompt.visible, carouselPieMenuStage, selectedNodeIdForPieMenu, abstractionCarouselNode]);

  const onCarouselExitAnimationComplete = useCallback(() => {
    // Capture the node ID before cleaning up
    const nodeIdToShowPieMenu = abstractionCarouselNode?.id;

    // Execute pending swap operation if it exists
    if (pendingSwapOperation) {
      const { originalNodeId, originalInstance, focusedPrototypeId, newPrototype } = pendingSwapOperation;



      // Calculate original dimensions before the swap
      const originalDimensions = getNodeDimensions(originalInstance, false, null);

      // Create a temporary node with the new prototype to calculate new dimensions
      const tempNodeWithNewPrototype = {
        ...originalInstance,
        prototypeId: focusedPrototypeId,
        name: newPrototype?.name || originalInstance.name,
        color: newPrototype?.color || originalInstance.color,
        thumbnailSrc: newPrototype?.thumbnailSrc || originalInstance.thumbnailSrc,
        definitionGraphIds: newPrototype?.definitionGraphIds || []
      };
      const newDimensions = getNodeDimensions(tempNodeWithNewPrototype, false, null);

      // Calculate the center point of the original node
      const originalCenterX = originalInstance.x + (originalDimensions.currentWidth / 2);
      const originalCenterY = originalInstance.y + (originalDimensions.currentHeight / 2);

      // Calculate new position to keep the same center point
      const newX = originalCenterX - (newDimensions.currentWidth / 2);
      const newY = originalCenterY - (newDimensions.currentHeight / 2);

      console.log(`[NodeCanvas] Adjusting position for dimension change:`, {
        originalPos: { x: originalInstance.x, y: originalInstance.y },
        originalDims: { w: originalDimensions.currentWidth, h: originalDimensions.currentHeight },
        newDims: { w: newDimensions.currentWidth, h: newDimensions.currentHeight },
        newPos: { x: newX, y: newY }
      });

      // Update the instance to use the focused node's prototype and adjust position
      storeActions.updateNodeInstance(activeGraphId, originalNodeId, (instance) => {
        instance.prototypeId = focusedPrototypeId;
        instance.x = newX;
        instance.y = newY;
      }, { finalize: true });

      // Update the carousel node to be based on the new prototype
      // This preserves the carousel for future use but with the new starting point
      if (newPrototype) {
        setAbstractionCarouselNode({
          ...originalInstance,
          prototypeId: focusedPrototypeId,
          name: newPrototype.name,
          color: newPrototype.color,
          definitionGraphIds: newPrototype.definitionGraphIds || [],
          x: newX, // Update position here too for consistency
          y: newY
        });
      }



      // Clear the pending operation
      setPendingSwapOperation(null);
    }

    // Set exit in progress flag
    carouselExitInProgressRef.current = true;

    // Clean up after exit animation completes
    setAbstractionCarouselVisible(false);
    setAbstractionCarouselNode(null);
    setCarouselAnimationState('hidden');
    setIsTransitioningPieMenu(false); // Now safe to end transition

    // Restore the pie menu unless the carousel was closed by a click-away
    if (!carouselClosedByClickAwayRef.current) {
      if (nodeIdToShowPieMenu) {
        setSelectedInstanceIds(new Set([nodeIdToShowPieMenu])); // Restore selection
        setSelectedNodeIdForPieMenu(nodeIdToShowPieMenu);
      }
    } else {
      // Reset the flag so subsequent opens behave normally
      carouselClosedByClickAwayRef.current = false;
    }

    // Clear the protection flags after animations complete
    setTimeout(() => {
      setJustCompletedCarouselExit(false);
      carouselExitInProgressRef.current = false;
    }, 300); // Quick timeout - allows normal interaction almost immediately
  }, [abstractionCarouselNode?.id, pendingSwapOperation, activeGraphId, storeActions]);
  // Use the local state values populated by subscribe
  const projectTitle = activeGraphName ?? 'Loading...';
  const projectBio = activeGraphDescription ?? '';
  const [previewingNodeId, setPreviewingNodeId] = useState(null);

  // Track current definition index for each node per graph context (nodeId-graphId -> index)
  const [nodeDefinitionIndices, setNodeDefinitionIndices] = useState(new Map());

  // Ref to track carousel exit process to prevent cleanup interference
  const carouselExitInProgressRef = useRef(false);
  // Track whether the carousel was closed by click-away to suppress pie menu reopen
  const carouselClosedByClickAwayRef = useRef(false);
  // --- Graph Change Cleanup ---
  useEffect(() => {
    // This effect runs whenever the active graph changes.
    // We clear any graph-specific UI state to ensure a clean slate.

    console.log(`[NodeCanvas] Current state during cleanup:`, {
      abstractionCarouselVisible,
      abstractionPromptVisible: abstractionPrompt.visible,
      carouselPieMenuStage,
      selectedNodeIdForPieMenu
    });

    // DON'T clean up if the abstraction carousel is visible (regardless of prompt state)
    if (abstractionCarouselVisible) {

      return;
    }

    // DON'T clean up if we just completed a carousel exit (to prevent clearing restored state)
    if (justCompletedCarouselExit) {

      return;
    }

    // DON'T clean up if we're transitioning the pie menu (carousel exit in progress)
    if (isTransitioningPieMenu) {

      return;
    }

    // DON'T clean up if carousel exit is in progress (ref-based check)
    if (carouselExitInProgressRef.current) {

      return;
    }

    // DON'T clean up if we have a selected node and pie menu is active (indicates recent restoration)
    if (selectedInstanceIds.size === 1 && selectedNodeIdForPieMenu && !abstractionCarouselVisible) {

      return;
    }


    setSelectedInstanceIds(new Set());
    setPreviewingNodeId(null);
    setEditingNodeIdOnCanvas(null);
    setEditingGroupId(null); // Clear group editing state
    setTempGroupName('');
    setPlusSign(null);
    setNodeNamePrompt({ visible: false, name: '' });
    setNodeSelectionGrid({ visible: false, position: { x: 0, y: 0 } });
    setSelectionRect(null);
    setSelectionStart(null);
    setDrawingConnectionFrom(null);
    setHoveredEdgeInfo(null); // Clear edge hover state

    // --- Force-close the pie menu ---
    setSelectedNodeIdForPieMenu(null);
    setCurrentPieMenuData(null);
    setIsPieMenuRendered(false);
    setCarouselPieMenuStage(1); // Reset to main stage
    setIsCarouselStageTransition(false); // Reset stage transition flag
    setIsTransitioningPieMenu(false); // Reset any pending transition

    // Clear pie menu color picker state
    setPieMenuColorPickerVisible(false);
    setActivePieMenuColorNodeId(null);

    // Clear abstraction carousel

    setAbstractionCarouselVisible(false);
    setAbstractionCarouselNode(null);
    setPendingAbstractionNodeId(null);
    setCarouselFocusedNodeScale(1.2);
    setCarouselFocusedNodeDimensions(null);
    setCarouselFocusedNode(null);
    setCarouselAnimationState('hidden');

    // Clear pending swap operation
    setPendingSwapOperation(null);



    // Clear abstraction control panel
    setAbstractionControlPanelVisible(false);
    setAbstractionControlPanelShouldShow(false);
  }, [activeGraphId, abstractionCarouselVisible, justCompletedCarouselExit, isTransitioningPieMenu]); // Protect from cleanup during carousel transitions



  // --- Abstraction Control Panel Management ---
  useEffect(() => {
    const shouldShow = Boolean(abstractionCarouselVisible && abstractionCarouselNode);

    if (shouldShow) {
      // Show the panel immediately when carousel is visible and hide others
      setAbstractionControlPanelShouldShow(true);
      setAbstractionControlPanelVisible(true);
      // Hide other control panels
      setNodeControlPanelVisible(false);
      setNodeControlPanelShouldShow(false);
    } else if (!abstractionCarouselVisible && abstractionControlPanelVisible) {
      // Carousel was hidden - start exit animation but keep panel mounted
      setAbstractionControlPanelVisible(false);
      // Don't set abstractionControlPanelShouldShow to false yet - let the animation complete
    } else if (!shouldShow) {
      // Other cases where panel should be hidden
      setAbstractionControlPanelVisible(false);
    }
  }, [abstractionCarouselVisible, abstractionCarouselNode, abstractionControlPanelVisible]);

  // --- Node Control Panel Management ---
  useEffect(() => {
    const nodesSelected = selectedInstanceIds.size > 0;
    const edgeSelected = selectedEdgeId !== null || selectedEdgeIds.size > 0;
    const shouldShow = Boolean(nodesSelected && !edgeSelected && !abstractionCarouselVisible && !connectionNamePrompt.visible);
    if (shouldShow) {
      setNodeControlPanelShouldShow(true);
      setNodeControlPanelVisible(true);
      // Hide ALL other control panels
      setAbstractionControlPanelVisible(false);
      setAbstractionControlPanelShouldShow(false);
      setConnectionControlPanelVisible(false);
      setConnectionControlPanelShouldShow(false);
      setGroupControlPanelVisible(false);
      setSelectedGroup(null);
    } else if (!shouldShow && nodeControlPanelVisible) {
      setNodeControlPanelVisible(false);
    }
  }, [selectedInstanceIds, selectedEdgeId, selectedEdgeIds, abstractionCarouselVisible, connectionNamePrompt.visible, nodeControlPanelVisible]);

  // --- Connection Control Panel Management ---
  useEffect(() => {
    const nodesSelected = selectedInstanceIds.size > 0;
    const edgeSelected = selectedEdgeId !== null || selectedEdgeIds.size > 0;
    const shouldShow = Boolean(edgeSelected && !nodesSelected && !abstractionCarouselVisible && !connectionNamePrompt.visible);
    if (shouldShow) {
      setConnectionControlPanelShouldShow(true);
      setConnectionControlPanelVisible(true);
      // Hide ALL other control panels
      setNodeControlPanelVisible(false);
      setNodeControlPanelShouldShow(false);
      setAbstractionControlPanelVisible(false);
      setAbstractionControlPanelShouldShow(false);
      setGroupControlPanelVisible(false);
      setSelectedGroup(null);
    } else if (!shouldShow && connectionControlPanelVisible) {
      setConnectionControlPanelVisible(false);
    }
  }, [selectedInstanceIds, selectedEdgeId, selectedEdgeIds, abstractionCarouselVisible, connectionNamePrompt.visible, connectionControlPanelVisible]);

  // --- Group Control Panel Management ---
  useEffect(() => {
    const shouldShow = Boolean(selectedGroup && !abstractionCarouselVisible && !connectionNamePrompt.visible);
    if (shouldShow) {
      setGroupControlPanelShouldShow(true);
      setGroupControlPanelVisible(true);
      // Hide ALL other control panels
      setNodeControlPanelVisible(false);
      setNodeControlPanelShouldShow(false);
      setAbstractionControlPanelVisible(false);
      setAbstractionControlPanelShouldShow(false);
      setConnectionControlPanelVisible(false);
      setConnectionControlPanelShouldShow(false);
    } else if (!shouldShow && groupControlPanelVisible) {
      setGroupControlPanelVisible(false);
    }
  }, [selectedGroup, abstractionCarouselVisible, connectionNamePrompt.visible, groupControlPanelVisible]);

  // --- Close all control panels on page/graph change ---
  useEffect(() => {
    // When activeGraphId changes, close all control panels with exit animation
    setNodeControlPanelVisible(false);
    setConnectionControlPanelVisible(false);
    setAbstractionControlPanelVisible(false);
    setGroupControlPanelVisible(false);
    setSelectedGroup(null);
  }, [activeGraphId]);

  const handleNodeControlPanelAnimationComplete = useCallback(() => {
    setNodeControlPanelShouldShow(false);
    // Clear the last selected prototypes when animation completes
    setLastSelectedNodePrototypes([]);
  }, [setNodeControlPanelShouldShow]);

  const handleConnectionControlPanelAnimationComplete = useCallback(() => {
    setConnectionControlPanelShouldShow(false);
  }, [setConnectionControlPanelShouldShow]);

  const handleGroupControlPanelAnimationComplete = useCallback(() => {
    setGroupControlPanelShouldShow(false);
    setGroupControlPanelVisible(false);
    setLastSelectedGroup(null);
    setSelectedGroup(null);
  }, []);

  const selectedNodePrototypes = useMemo(() => {
    const list = [];
    if (!nodes || nodes.length === 0) return list;
    selectedInstanceIds.forEach((instanceId) => {
      const inst = nodes.find(n => n.id === instanceId);
      if (inst && inst.prototypeId) {
        const proto = nodePrototypesMap.get(inst.prototypeId);
        if (proto) list.push(proto);
      }
    });
    return list;
  }, [selectedInstanceIds, nodes, nodePrototypesMap]);

  // Update last selected prototypes when selection changes
  useEffect(() => {
    if (selectedNodePrototypes.length > 0) {
      setLastSelectedNodePrototypes(selectedNodePrototypes);
    }
  }, [selectedNodePrototypes]);

  useEffect(() => {
    if (selectedGroup) {
      setLastSelectedGroup(selectedGroup);
    }
  }, [selectedGroup]);

  // Use last selected prototypes if current ones are empty but panel is still visible
  const nodePrototypesForPanel = useMemo(() => {
    if (selectedNodePrototypes.length > 0) {
      return selectedNodePrototypes;
    }
    // If no current selection but panel is still visible (during exit animation), use last known selection
    if (nodeControlPanelVisible && lastSelectedNodePrototypes.length > 0) {
      return lastSelectedNodePrototypes;
    }
    return [];
  }, [selectedNodePrototypes, nodeControlPanelVisible, lastSelectedNodePrototypes]);

  const groupPanelTarget = selectedGroup || lastSelectedGroup;
  const groupPanelMode = groupPanelTarget?.linkedNodePrototypeId ? "nodegroup" : "group";

  // Group control panel action handlers
  const handleGroupPanelUngroup = useCallback(() => {
    if (!activeGraphId || !selectedGroup) return;
    try {
      storeActions.deleteGroup(activeGraphId, selectedGroup.id);
      setSelectedGroup(null);
      setGroupControlPanelVisible(false);
    } catch (e) {

    }
  }, [activeGraphId, selectedGroup, storeActions.deleteGroup, setGroupControlPanelVisible]);

  const handleGroupPanelEdit = useCallback(() => {
    if (!selectedGroup) return;
    // Start inline editing mode
    setEditingGroupId(selectedGroup.id);
    setTempGroupName(selectedGroup.name || 'Group');
  }, [selectedGroup]);

  const handleGroupPanelColor = useCallback(() => {
    if (!activeGraphId || !selectedGroup) return;
    // Open a simple color picker dialog
    const newColor = prompt('Enter new group color (hex):', selectedGroup.color || '#8B0000');
    if (newColor && newColor.trim()) {
      const colorToUse = newColor.startsWith('#') ? newColor : `#${newColor}`;
      storeActions.updateGroup(activeGraphId, selectedGroup.id, (draft) => {
        draft.color = colorToUse;
      });
      // Update the selected group state to reflect the change
      setSelectedGroup(prev => prev ? { ...prev, color: colorToUse } : null);
    }
  }, [activeGraphId, selectedGroup, storeActions.updateGroup]);

  const handleGroupPanelConvertToNodeGroup = useCallback(() => {
    if (!activeGraphId || !selectedGroup) return;
    // Open UnifiedSelector in node-group-creation mode
    setNodeGroupPrompt({
      visible: true,
      name: selectedGroup.name || 'Group',
      color: selectedGroup.color || '#8B0000',
      groupId: selectedGroup.id
    });
  }, [activeGraphId, selectedGroup]);

  // Handler to convert a node instance to a node group
  const handleNodeConvertToNodeGroup = useCallback((instanceId, prototypeId, definitionGraphId) => {
    if (!activeGraphId) return;

    // Get the node instance data
    const graphData = graphsMap.get(activeGraphId);
    if (!graphData) return;

    const instanceData = graphData.instances?.get(instanceId);
    if (!instanceData) return;

    // Get the node prototype data
    const prototypeData = nodePrototypesMap.get(prototypeId);
    if (!prototypeData) return;

    // Get the definition graph
    const defGraph = graphsMap.get(definitionGraphId);
    if (!defGraph) {
      console.error('[Convert Node to Node-Group] Definition graph not found:', definitionGraphId);
      return;
    }

    console.log(`[Convert Node to Node-Group] Converting node ${instanceId} (${prototypeData.name}) to node-group with definition ${definitionGraphId}`);

    // Copy all instances from the definition graph to the active graph
    const instanceIdMap = new Map(); // Maps old instance IDs to new instance IDs
    const newInstanceIds = [];

    // Calculate offset to position the copied network at the original node's position
    let offsetX = instanceData.x;
    let offsetY = instanceData.y;

    // Find the center or top-left of the definition graph to use as reference
    if (defGraph.instances && defGraph.instances.size > 0) {
      const defInstances = Array.from(defGraph.instances.values());
      const minX = Math.min(...defInstances.map(inst => inst.x));
      const minY = Math.min(...defInstances.map(inst => inst.y));
      offsetX = instanceData.x - minX;
      offsetY = instanceData.y - minY;
    }

    // Copy instances
    if (defGraph.instances) {
      defGraph.instances.forEach((defInstance, defInstanceId) => {
        const newInstanceId = uuidv4();
        instanceIdMap.set(defInstanceId, newInstanceId);
        newInstanceIds.push(newInstanceId);

        // Create the instance in the active graph
        storeActions.addNodeInstance(
          activeGraphId,
          defInstance.prototypeId,
          { x: defInstance.x + offsetX, y: defInstance.y + offsetY },
          newInstanceId
        );
      });
    }

    // Copy edges between instances
    if (defGraph.edgeIds) {
      defGraph.edgeIds.forEach(edgeId => {
        const edge = edgesMap.get(edgeId);
        if (!edge) return;

        const newSourceId = instanceIdMap.get(edge.sourceId);
        const newDestId = instanceIdMap.get(edge.destinationId);

        // Only copy edges where both endpoints were copied
        if (newSourceId && newDestId) {
          // Remap arrowsToward IDs
          const directionality = edge.directionality || {};
          const arrowsToward = directionality.arrowsToward || new Set();
          const newArrowsToward = new Set();
          arrowsToward.forEach(oldId => {
            const newId = instanceIdMap.get(oldId);
            if (newId) newArrowsToward.add(newId);
          });

          const clonedEdgeId = uuidv4();
          storeActions.addEdge(
            activeGraphId,
            {
              id: clonedEdgeId,
              sourceId: newSourceId,
              destinationId: newDestId,
              connectionName: edge.connectionName,
              graphId: activeGraphId,
              color: edge.color,
              typeNodeId: edge.typeNodeId,
              definitionNodeIds: edge.definitionNodeIds ? [...edge.definitionNodeIds] : [],
              directionality: {
                type: directionality.type || 'none',
                arrowsToward: newArrowsToward
              },
              metadata: edge.metadata ? { ...edge.metadata } : {}
            }
          );
        }
      });
    }

    // Create a new node-group with all the copied instances
    const createdGroupId = storeActions.createGroup(activeGraphId, {
      name: prototypeData.name,
      color: prototypeData.color || '#8B0000',
      memberInstanceIds: newInstanceIds
    });

    if (!createdGroupId) {
      console.error('[Convert Node to Node-Group] Failed to create group');
      return;
    }

    // Update the group with position and linked prototype
    storeActions.updateGroup(activeGraphId, createdGroupId, (group) => {
      group.x = instanceData.x;
      group.y = instanceData.y;
      group.linkedNodePrototypeId = prototypeId;
    });

    // Remove the original defining node instance
    storeActions.removeNodeInstance(activeGraphId, instanceId);

    // Get the updated group data from store
    const currentState = useGraphStore.getState();
    const graph = currentState.graphs?.get(activeGraphId);
    const newGroup = graph?.groups?.get(createdGroupId);

    if (newGroup) {
      // Select the new group
      setSelectedGroup(newGroup);

      // Clear node selection and show group control panel
      setSelectedInstanceIds(new Set());
      setPreviewingNodeId(null);
      setGroupControlPanelShouldShow(true);
      setNodeControlPanelShouldShow(false);
      setNodeControlPanelVisible(false);

      console.log(`[Convert Node to Node-Group] Created node-group ${createdGroupId} with ${newInstanceIds.length} instances at position (${instanceData.x}, ${instanceData.y})`);
    }
  }, [activeGraphId, graphsMap, edgesMap, nodePrototypesMap, storeActions, setSelectedGroup, setSelectedInstanceIds, setPreviewingNodeId, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow, setNodeControlPanelVisible]);

  // Handle abstraction control panel callbacks
  const handleAbstractionDimensionChange = useCallback((newDimension) => {
    setCurrentAbstractionDimension(newDimension);
  }, []);

  const handleAddAbstractionDimension = useCallback((newDimensionName) => {
    setAbstractionDimensions(prev => [...prev, newDimensionName]);
    setCurrentAbstractionDimension(newDimensionName);
  }, []);

  const handleDeleteAbstractionDimension = useCallback((dimensionToDelete) => {
    setAbstractionDimensions(prev => {
      const newDimensions = prev.filter(dim => dim !== dimensionToDelete);
      // If we're deleting the current dimension, switch to the first remaining one
      if (dimensionToDelete === currentAbstractionDimension && newDimensions.length > 0) {
        setCurrentAbstractionDimension(newDimensions[0]);
      }
      return newDimensions;
    });
  }, [currentAbstractionDimension]);

  const handleExpandAbstractionDimension = useCallback((node, dimension, iconRect) => {
    // For now, just open the node in a new tab
    // In the future, this could create/open a graph definition for the abstraction chain

    // Could implement hurtle animation here similar to other expand buttons
  }, []);

  const handleAbstractionControlPanelAnimationComplete = useCallback(() => {
    // This callback is only for the exit animation.
    // When it's called, we know it's safe to unmount the component.
    setAbstractionControlPanelShouldShow(false);
  }, []);

  // --- Saved Graphs Management ---
  const bookmarkActive = useMemo(() => {
    // Check if the current graph's defining node is saved
    if (!activeGraphId) return false;
    const activeGraph = graphsMap.get(activeGraphId);
    const definingNodeId = activeGraph?.definingNodeIds?.[0];
    const isActive = definingNodeId ? savedNodeIds.has(definingNodeId) : false;
    //
    return isActive;
  }, [activeGraphId, graphsMap, savedNodeIds]);

  const handleToggleBookmark = useCallback(() => {
    // Get current state for logging
    const currentState = useGraphStore.getState();


    if (currentState.activeGraphId) {
      // Toggle the current graph

      storeActions.toggleSavedGraph(currentState.activeGraphId);
    } else {

    }
  }, [storeActions]); // Dependency only on storeActions as we read fresh state inside
  // --- Refs (Keep these) ---
  const containerRef = useRef(null);
  const [, drop] = useDrop(() => ({
    accept: SPAWNABLE_NODE,
    drop: (item, monitor) => {
      if (!activeGraphId) return;

      const offset = monitor.getClientOffset();
      if (!offset || !containerRef.current) return;

      // Convert drop position to canvas coordinates
      const { x, y } = clientToCanvasCoordinates(offset.x, offset.y);

      // Handle semantic concepts that need materialization
      if (item.needsMaterialization && item.conceptData) {


        // Check if this semantic concept already exists as a prototype
        const existingPrototype = Array.from(nodePrototypesMap.values()).find(proto =>
          proto.semanticMetadata?.isSemanticNode &&
          proto.name === item.conceptData.name &&
          proto.semanticMetadata?.originMetadata?.source === item.conceptData.source &&
          proto.semanticMetadata?.originMetadata?.originalUri === item.conceptData.semanticMetadata?.originalUri
        );

        let prototypeId;

        if (existingPrototype) {
          // Use existing prototype
          prototypeId = existingPrototype.id;

        } else {
          // Create new prototype
          prototypeId = `semantic-node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Build origin metadata
          const originInfo = {
            source: item.conceptData.source,
            discoveredAt: item.conceptData.discoveredAt,
            searchQuery: item.conceptData.searchQuery || '',
            confidence: item.conceptData.semanticMetadata?.confidence || 0.8,
            originalUri: item.conceptData.semanticMetadata?.originalUri,
            relationships: item.conceptData.relationships || []
          };

          // Add the prototype to the store
          storeActions.addNodePrototype({
            id: prototypeId,
            name: item.conceptData.name,
            description: '', // No custom bio - will show origin info instead
            color: item.conceptData.color,
            typeNodeId: 'base-thing-prototype',
            definitionGraphIds: [],
            semanticMetadata: {
              ...item.conceptData.semanticMetadata,
              relationships: item.conceptData.relationships,
              originMetadata: originInfo,
              isSemanticNode: true
            },
            originalDescription: item.conceptData.description
          });

          // Auto-save semantic nodes to Library
          storeActions.toggleSavedNode(prototypeId);


        }

        // Now use the prototype ID for positioning
        const prototype = {
          ...item.conceptData,
          id: prototypeId,
          name: item.conceptData.name,
          color: item.conceptData.color
        };
        const dimensions = getNodeDimensions(prototype, false, null);

        // Create position
        let position = {
          x: x - (dimensions.currentWidth / 2),
          y: y - (dimensions.currentHeight / 2)
        };

        // Apply grid snapping if enabled
        if (gridMode !== 'off') {
          const snapped = snapToGridAnimated(x, y, dimensions.currentWidth, dimensions.currentHeight, null);
          position = { x: snapped.x, y: snapped.y };
        }

        // Add instance to the canvas
        storeActions.addNodeInstance(activeGraphId, prototypeId, position);

        // If there is exactly one node selected (focus), and the dragged concept carried a predicate,
        // create an edge from the focused node to this new instance with provenance
        try {
          if (selectedInstanceIds.size === 1) {
            const focusedInstanceId = [...selectedInstanceIds][0];
            const newInstanceId = (() => {
              // Find the just-created instance id at that position (closest by distance)
              const g = useGraphStore.getState().graphs.get(activeGraphId);
              let closestId = null, best = Infinity;
              if (g?.instances) {
                g.instances.forEach(inst => {
                  if (inst.prototypeId === prototypeId) {
                    const dx = inst.x - position.x; const dy = inst.y - position.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < best) { best = d2; closestId = inst.id; }
                  }
                });
              }
              return closestId;
            })();

            if (newInstanceId) {
              const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              const predicate = item.conceptData.defaultPredicate || 'relatedTo';
              storeActions.addEdge(activeGraphId, {
                id: edgeId,
                sourceId: focusedInstanceId,
                destinationId: newInstanceId,
                label: predicate,
                color: '#666666',
                provenance: {
                  source: item.conceptData.source,
                  uri: item.conceptData.semanticMetadata?.originalUri || null,
                  predicate,
                  claims: item.conceptData.relationships || [],
                  retrieved_at: item.conceptData.discoveredAt || new Date().toISOString()
                }
              });
            }
          }
        } catch { }


        return;
      }

      // Handle regular nodes (existing logic)
      const { prototypeId } = item;
      if (!prototypeId) {

        return;
      }

      const prototype = nodePrototypesMap.get(prototypeId);
      if (!prototype) {


        // Try to find a prototype with the same name as a fallback
        const potentialMatches = Array.from(nodePrototypesMap.values()).filter(p =>
          item.nodeName && p.name.toLowerCase() === item.nodeName.toLowerCase()
        );

        if (potentialMatches.length > 0) {

          // Use the first match as a fallback
          const fallbackPrototype = potentialMatches[0];
          const dimensions = getNodeDimensions(fallbackPrototype, false, null);

          let position = {
            x: x - (dimensions.currentWidth / 2),
            y: y - (dimensions.currentHeight / 2)
          };

          if (gridMode !== 'off') {
            const snapped = snapToGridAnimated(x, y, dimensions.currentWidth, dimensions.currentHeight, null);
            position = { x: snapped.x, y: snapped.y };
          }

          storeActions.addNodeInstance(activeGraphId, fallbackPrototype.id, position);
          return;
        }

        return;
      }

      const dimensions = getNodeDimensions(prototype, false, null);

      // With the new model, we ALWAYS create a new instance.
      let position = {
        x: x - (dimensions.currentWidth / 2),
        y: y - (dimensions.currentHeight / 2)
      };

      // Apply smooth grid snapping when creating new nodes via drag and drop if grid is enabled
      if (gridMode !== 'off') {
        const snapped = snapToGridAnimated(x, y, dimensions.currentWidth, dimensions.currentHeight, null);
        position = { x: snapped.x, y: snapped.y };
      }

      storeActions.addNodeInstance(activeGraphId, prototypeId, position);
    },
  }), [activeGraphId, clientToCanvasCoordinates, nodePrototypesMap, storeActions, gridMode, snapToGridAnimated]);

  const setCanvasAreaRef = useCallback(node => {
    containerRef.current = node;
    drop(node);
  }, [drop]);

  const isMouseDown = useRef(false);
  const ignoreCanvasClick = useRef(false);
  const mouseDownPosition = useRef({ x: 0, y: 0 });
  const mouseMoved = useRef(false);
  const startedOnNode = useRef(false);
  const longPressTimeout = useRef(null);
  const mouseInsideNode = useRef(true);
  const panelRef = useRef(null); // Ref for Right Panel (if needed for openNodeTab)
  const leftPanelRef = useRef(null); // Ref for Left Panel

  const canvasWorker = useCanvasWorker();
  const isKeyboardZooming = useRef(false);
  const resizeTimeoutRef = useRef(null);
  // Ensure async zoom results apply in order to avoid ghost frames
  const zoomOpIdRef = useRef(0);
  const selectionBaseRef = useRef(new Set());
  const wasSelectionBox = useRef(false);
  const wasDrawingConnection = useRef(false);
  // Add refs for click vs double-click detection
  const clickTimeoutIdRef = useRef(null);
  const potentialClickNodeRef = useRef(null);
  const CLICK_DELAY = 180; // Reduced milliseconds to wait for a potential double-click

  // Ref to track initial mount completion
  const isMountedRef = useRef(false);

  // Pie menu color picker handlers
  const handlePieMenuColorPickerOpen = useCallback((nodeId, position) => {
    // If already open for the same node, close it (toggle behavior)
    if (pieMenuColorPickerVisible && activePieMenuColorNodeId === nodeId) {
      setPieMenuColorPickerVisible(false);
      setActivePieMenuColorNodeId(null);
      return;
    }

    setPieMenuColorPickerPosition(position);
    setPieMenuColorPickerVisible(true);
    setActivePieMenuColorNodeId(nodeId);
  }, [pieMenuColorPickerVisible, activePieMenuColorNodeId]);

  const handlePieMenuColorPickerClose = useCallback(() => {
    setPieMenuColorPickerVisible(false);
    setActivePieMenuColorNodeId(null);
  }, []);

  const handlePieMenuColorChange = useCallback((color) => {
    if (activePieMenuColorNodeId) {
      const node = nodes.find(n => n.id === activePieMenuColorNodeId);
      if (node) {
        storeActions.updateNodePrototype(node.prototypeId, draft => {
          draft.color = color;
        });
      }
    }
  }, [activePieMenuColorNodeId, nodes, storeActions]);

  // Pie Menu Button Configuration - now targetPieMenuButtons and dynamic
  const targetPieMenuButtons = useMemo(() => {
    const selectedNode = selectedNodeIdForPieMenu ? nodes.find(n => n.id === selectedNodeIdForPieMenu) : null;

    // Check if we're in AbstractionCarousel mode
    // In stage 2, we might be using a focused node different from the original carousel node
    const isInCarouselMode = selectedNode && abstractionCarouselVisible && abstractionCarouselNode && selectedNode.id === abstractionCarouselNode.id;
    if (isInCarouselMode) {
      // AbstractionCarousel mode: different layouts based on stage
      if (carouselPieMenuStage === 1) {
        // Stage 1: Main carousel menu with 4 buttons from left to right: Back, Swap, Plus, ArrowUpFromDot
        return [
          {
            id: 'carousel-back',
            label: 'Back',
            icon: ArrowLeft,
            position: 'left-inner',
            action: (nodeId) => {
              // Set protection flag BEFORE starting exit to prevent graph cleanup interference
              setJustCompletedCarouselExit(true);
              setIsPieMenuActionInProgress(true);
              setTimeout(() => setIsPieMenuActionInProgress(false), 100);

              // This will trigger the pie menu to shrink, and its onExitAnimationComplete will trigger the carousel to close.
              setIsTransitioningPieMenu(true);
            }
          },
          {
            id: 'carousel-swap',
            label: 'Swap',
            icon: SendToBack,
            position: 'right-inner',
            action: (originalNodeId) => {
              setIsPieMenuActionInProgress(true);
              setTimeout(() => setIsPieMenuActionInProgress(false), 100);

              // Get the focused carousel node's prototype ID
              const focusedPrototypeId = carouselFocusedNode ? carouselFocusedNode.prototypeId : null;
              const originalInstance = nodes.find(n => n.id === originalNodeId);

              if (!originalInstance) {

                return;
              }

              if (!focusedPrototypeId) {

                return;
              }



              // Store the swap operation to be executed after animations complete
              const currentState = useGraphStore.getState();
              const newPrototype = currentState.nodePrototypes.get(focusedPrototypeId);

              setPendingSwapOperation({
                originalNodeId,
                originalInstance,
                focusedPrototypeId,
                newPrototype
              });



              // Start the exit animation sequence
              setSelectedNodeIdForPieMenu(null);
              setIsTransitioningPieMenu(true);
            }
          },
          {
            id: 'carousel-plus',
            label: 'Create Definition',
            icon: Plus,
            position: 'right-second',
            action: (nodeId) => {


              console.log(`[PieMenu Action] State before transition:`, {
                carouselPieMenuStage,
                isCarouselStageTransition: false,
                selectedNodeIdForPieMenu
              });

              // Start the stage transition by triggering the pie menu to shrink first
              setIsCarouselStageTransition(true); // Mark this as an internal stage transition
              setIsTransitioningPieMenu(true); // This will trigger the pie menu to shrink

              // The stage will be changed in onExitAnimationComplete after the shrink animation completes

            }
          },
          {
            id: 'carousel-delete',
            label: 'Delete',
            icon: Trash2,
            position: 'right-third',
            action: (nodeId) => {
              setIsPieMenuActionInProgress(true);
              setTimeout(() => setIsPieMenuActionInProgress(false), 100);



              const selectedNode = carouselFocusedNode || nodes.find(n => n.id === nodeId);
              if (!selectedNode) {

                return;
              }

              // Get the current abstraction carousel data to find the original node
              const carouselNode = abstractionCarouselNode;
              if (!carouselNode) {

                return;
              }

              // Prevent deletion of the original node that the carousel is built around
              if (selectedNode.prototypeId === carouselNode.prototypeId) {

                return;
              }

              // Remove the node from the abstraction chain
              removeFromAbstractionChain(
                carouselNode.prototypeId,     // the node whose chain we're modifying
                currentAbstractionDimension,  // dimension (Physical, Conceptual, etc.)
                selectedNode.prototypeId      // the node to remove
              );



              // Don't close the pie menu after deletion - stay in the carousel to see the updated chain
              // setSelectedNodeIdForPieMenu(null);
              // setIsTransitioningPieMenu(true);
            }
          },
          {
            id: 'carousel-expand',
            label: 'Expand',
            icon: ArrowUpFromDot,
            position: 'right-outer',
            action: (originalNodeId) => {
              console.log('[Carousel Expand] Up-dot clicked.', {
                originalNodeId,
                focusedCarouselNode: carouselFocusedNode ? {
                  id: carouselFocusedNode.id,
                  name: carouselFocusedNode.name,
                  prototypeId: carouselFocusedNode.prototypeId
                } : null,
                activeGraphId,
                abstractionCarouselNode: abstractionCarouselNode ? {
                  id: abstractionCarouselNode.id,
                  name: abstractionCarouselNode.name,
                  prototypeId: abstractionCarouselNode.prototypeId
                } : null,
                dimension: currentAbstractionDimension
              });
              setIsPieMenuActionInProgress(true);
              setTimeout(() => setIsPieMenuActionInProgress(false), 100);

              // In carousel mode, use the focused node's prototype for expansion operations
              const focusedPrototypeId = carouselFocusedNode ? carouselFocusedNode.prototypeId : null;
              const originalNodeData = nodes.find(n => n.id === originalNodeId);

              if (!originalNodeData) {

                return;
              }

              // Use focused node's prototype if available, otherwise use original node's prototype
              const targetPrototypeId = focusedPrototypeId || originalNodeData.prototypeId;

              console.log('[Carousel Expand] Resolved target prototype.', {
                targetPrototypeId,
                fromFocused: Boolean(focusedPrototypeId && focusedPrototypeId === targetPrototypeId)
              });

              // Get the prototype data to check for definitions
              const currentState = useGraphStore.getState();
              const prototypeData = currentState.nodePrototypes.get(targetPrototypeId);

              if (prototypeData) {
                if (prototypeData.definitionGraphIds && prototypeData.definitionGraphIds.length > 0) {
                  // Node has definitions - use current definition index if available, otherwise first one
                  const contextKey = `${targetPrototypeId}-${activeGraphId}`;
                  const currentDefinitionIndex = nodeDefinitionIndices.get(contextKey) || 0;
                  const definitionIndex = Math.min(currentDefinitionIndex, prototypeData.definitionGraphIds.length - 1);
                  const graphIdToOpen = prototypeData.definitionGraphIds[definitionIndex];

                  console.log('[Carousel Expand] Opening existing definition.', {
                    targetPrototypeId,
                    totalDefinitions: prototypeData.definitionGraphIds.length,
                    definitionIndex,
                    graphIdToOpen
                  });

                  // Use original node ID for hurtle animation (visual effect), but target prototype for the definition
                  console.log('[Carousel Expand] Starting hurtle animation to existing definition.', {
                    fromInstanceId: originalNodeId,
                    toGraphId: graphIdToOpen,
                    definitionNodeId: targetPrototypeId
                  });
                  startHurtleAnimation(originalNodeId, graphIdToOpen, targetPrototypeId);
                  // Close carousel after animation starts
                  setSelectedNodeIdForPieMenu(null);
                  setIsTransitioningPieMenu(true);
                } else {
                  // No definitions recorded. Try to find any existing graph already defining this prototype
                  const sourceGraphId = activeGraphId; // Capture current graph before it changes
                  let orphanGraphId = null;
                  try {
                    for (const [gId, g] of currentState.graphs.entries()) {
                      if (Array.isArray(g.definingNodeIds) && g.definingNodeIds.includes(targetPrototypeId)) {
                        orphanGraphId = gId;
                        break;
                      }
                    }
                  } catch (_) { }

                  if (orphanGraphId) {
                    console.log('[Carousel Expand] Found existing definition graph not listed on prototype. Repairing and opening.', {
                      targetPrototypeId,
                      orphanGraphId
                    });
                    // Self-heal: add to prototype.definitionGraphIds if missing
                    storeActions.updateNodePrototype(targetPrototypeId, draft => {
                      draft.definitionGraphIds = Array.isArray(draft.definitionGraphIds) ? draft.definitionGraphIds : [];
                      if (!draft.definitionGraphIds.includes(orphanGraphId)) {
                        draft.definitionGraphIds.push(orphanGraphId);
                      }
                    });
                    console.log('[Carousel Expand] Starting hurtle animation to repaired definition.', {
                      fromInstanceId: originalNodeId,
                      toGraphId: orphanGraphId,
                      definitionNodeId: targetPrototypeId
                    });
                    startHurtleAnimation(originalNodeId, orphanGraphId, targetPrototypeId, sourceGraphId);
                    setSelectedNodeIdForPieMenu(null);
                    setIsTransitioningPieMenu(true);
                  } else {
                    // Create a new definition graph if none exists anywhere
                    console.log('[Carousel Expand] No definitions found. Creating a new definition graph for prototype.', {
                      targetPrototypeId,
                      sourceGraphId
                    });
                    storeActions.createAndAssignGraphDefinitionWithoutActivation(targetPrototypeId);
                    setTimeout(() => {
                      const updatedState = useGraphStore.getState();
                      const updatedNodeData = updatedState.nodePrototypes.get(targetPrototypeId);
                      if (updatedNodeData?.definitionGraphIds?.length > 0) {
                        const newGraphId = updatedNodeData.definitionGraphIds[updatedNodeData.definitionGraphIds.length - 1];
                        console.log('[Carousel Expand] New definition graph created. Launching animation.', {
                          targetPrototypeId,
                          newGraphId,
                          sourceGraphId
                        });
                        startHurtleAnimation(originalNodeId, newGraphId, targetPrototypeId, sourceGraphId);
                        setSelectedNodeIdForPieMenu(null);
                        setIsTransitioningPieMenu(true);
                      } else {

                      }
                    }, 50);
                  }
                }
              } else {

              }
            }
          }
        ];
      } else if (carouselPieMenuStage === 2) {
        // Stage 2: Position selection menu - Back on left-inner, vertical stack on right

        const stage2Buttons = [
          {
            id: 'carousel-back-stage2',
            label: 'Back',
            icon: ArrowLeft,
            position: 'left-inner',
            action: (nodeId) => {

              // Start the stage transition by triggering the pie menu to shrink first
              setIsCarouselStageTransition(true); // Mark this as an internal stage transition
              setIsTransitioningPieMenu(true); // This will trigger the pie menu to shrink

              // The stage will be changed in onExitAnimationComplete after the shrink animation completes

            }
          },
          {
            id: 'carousel-add-above',
            label: 'Add Above',
            icon: CornerUpLeft,
            position: 'right-top',
            action: (nodeId) => {




              // In stage 2, use the focused carousel node, otherwise use the clicked node
              const targetNode = carouselPieMenuStage === 2 && carouselFocusedNode
                ? carouselFocusedNode
                : nodes.find(n => n.id === nodeId);

              console.log(`[PieMenu Action] Using target node for Add Above:`, {
                id: targetNode?.id,
                name: targetNode?.name,
                prototypeId: targetNode?.prototypeId,
                usingFocusedNode: carouselPieMenuStage === 2 && carouselFocusedNode
              });

              if (!targetNode) {

                return;
              }

              // Normalize to prototypeId for abstraction prompt
              const targetPrototype = getPrototypeIdFromItem(targetNode);
              // Set abstraction prompt with the target node (focused node in stage 2)
              setAbstractionPrompt({
                visible: true,
                name: '',
                color: null,
                direction: 'above',
                nodeId: targetPrototype,
                carouselLevel: abstractionCarouselNode // Pass the carousel state
              });


            }
          },
          {
            id: 'carousel-add-below',
            label: 'Add Below',
            icon: CornerDownLeft,
            position: 'right-bottom',
            action: (nodeId) => {




              // In stage 2, use the focused carousel node, otherwise use the clicked node
              const targetNode = carouselPieMenuStage === 2 && carouselFocusedNode
                ? carouselFocusedNode
                : nodes.find(n => n.id === nodeId);

              console.log(`[PieMenu Action] Using target node for Add Below:`, {
                id: targetNode?.id,
                name: targetNode?.name,
                prototypeId: targetNode?.prototypeId,
                usingFocusedNode: carouselPieMenuStage === 2 && carouselFocusedNode
              });

              if (!targetNode) {

                return;
              }

              // Normalize to prototypeId for abstraction prompt
              const targetPrototypeBelow = getPrototypeIdFromItem(targetNode);
              // Set abstraction prompt with the target node (focused node in stage 2)
              setAbstractionPrompt({
                visible: true,
                name: '',
                color: null,
                direction: 'below',
                nodeId: targetPrototypeBelow,
                carouselLevel: abstractionCarouselNode // Pass the carousel state
              });


            }
          }
        ];

        return stage2Buttons;
      }
    }

    if (selectedNode && previewingNodeId === selectedNode.id) {
      // If the selected node for the pie menu is the one being previewed, show only Compose
      // But don't show it if the carousel is exiting (only for non-carousel mode)
      if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {
        return []; // Return empty array to hide all buttons during carousel exit
      }

      return [
        {
          id: 'compose-preview',
          label: 'Compose',
          icon: Package,
          action: (nodeId) => {
            // Prevent compose action during carousel transitions (only for non-carousel mode)
            if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {

              return;
            }

            // 
            setIsTransitioningPieMenu(true); // Start transition, current menu will hide
            // setPreviewingNodeId(null); // This will be set after animation
          }
        }
      ];
    } else {
      // Default buttons: Expand, Decompose, Connect, Delete, Edit (swapped edit and expand positions)
      // But don't show buttons if the carousel is exiting (only for non-carousel mode)
      if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {
        return []; // Return empty array to hide all buttons during carousel exit
      }

      return [
        {
          id: 'expand-tab',
          label: 'Expand',
          icon: ArrowUpFromDot,
          action: (instanceId) => {
            const nodeData = nodes.find(n => n.id === instanceId);
            if (nodeData) {
              const prototypeId = nodeData.prototypeId;
              if (nodeData.definitionGraphIds && nodeData.definitionGraphIds.length > 0) {
                // Node has definitions - start hurtle animation to first one
                const graphIdToOpen = nodeData.definitionGraphIds[0];
                startHurtleAnimation(instanceId, graphIdToOpen, prototypeId);
              } else {
                // Node has no definitions - create one first, then start hurtle animation
                const sourceGraphId = activeGraphId; // Capture current graph before it changes
                storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);

                setTimeout(() => {
                  const currentState = useGraphStore.getState();
                  const updatedNodeData = currentState.nodePrototypes.get(prototypeId);
                  if (updatedNodeData?.definitionGraphIds?.length > 0) {
                    const newGraphId = updatedNodeData.definitionGraphIds[updatedNodeData.definitionGraphIds.length - 1];
                    startHurtleAnimation(instanceId, newGraphId, prototypeId, sourceGraphId);
                  } else {

                  }
                }, 50);
              }
            }
          }
        },
        {
          id: 'decompose-preview',
          label: 'Decompose',
          icon: PackageOpen,
          action: (instanceId) => {
            // Prevent decompose action during carousel transitions (only for non-carousel mode)
            if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {

              return;
            }


            setPendingDecomposeNodeId(instanceId); // Store the instance ID for later
            setIsTransitioningPieMenu(true); // Start transition, current menu will hide
            // previewingNodeId (which is an instanceId) will be set in onExitAnimationComplete after animation
          }
        },
        {
          id: 'abstraction', label: 'Abstraction', icon: Layers, action: (instanceId) => {
            // Prevent abstraction action during carousel transitions (only for non-carousel mode)
            if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {

              return;
            }


            setPendingAbstractionNodeId(instanceId); // Store the instance ID for later
            setIsTransitioningPieMenu(true); // Start transition, current menu will hide
            // Abstraction carousel will be set up in onExitAnimationComplete after animation
          }
        },
        {
          id: 'delete', label: 'Delete', icon: Trash2, action: (instanceId) => {
            storeActions.removeNodeInstance(activeGraphId, instanceId);

            setSelectedInstanceIds(new Set()); // Deselect after deleting
            setSelectedNodeIdForPieMenu(null); // Ensure pie menu hides
          }
        },
        {
          id: 'edit', label: 'Edit', icon: Edit3, action: (instanceId) => {
            const instance = nodes.find(n => n.id === instanceId);
            if (instance) {
              // Open panel tab using the PROTOTYPE ID
              storeActions.openRightPanelNodeTab(instance.prototypeId, instance.name);
              // Ensure right panel is expanded
              if (!rightPanelExpanded) {
                setRightPanelExpanded(true);
              }
              // Enable inline editing on canvas using the INSTANCE ID
              setEditingNodeIdOnCanvas(instanceId);
            }
          }
        },
        {
          id: 'save',
          label: (() => {
            const node = nodes.find(n => n.id === selectedNodeIdForPieMenu);
            return node && savedNodeIds.has(node.prototypeId) ? 'Unsave' : 'Save';
          })(),
          icon: Bookmark,
          fill: (() => {
            const node = nodes.find(n => n.id === selectedNodeIdForPieMenu);
            return node && savedNodeIds.has(node.prototypeId) ? 'maroon' : 'none';
          })(),
          action: (instanceId) => {
            const node = nodes.find(n => n.id === instanceId);
            if (node) {
              storeActions.toggleSavedNode(node.prototypeId);
            }
          }
        },
        {
          id: 'palette', label: 'Palette', icon: Palette, action: (instanceId, buttonPosition) => {
            const node = nodes.find(n => n.id === instanceId);
            if (node && buttonPosition) {
              // Use the actual button position passed from PieMenu
              handlePieMenuColorPickerOpen(instanceId, buttonPosition);
            }
          }
        },
        {
          id: 'more', label: 'More', icon: MoreHorizontal, action: (instanceId) => {

            // TODO: Implement additional options menu/submenu
          }
        }
      ];
    }
  }, [storeActions, setSelectedInstanceIds, setPreviewingNodeId, selectedNodeIdForPieMenu, previewingNodeId, nodes, activeGraphId, abstractionCarouselVisible, abstractionCarouselNode, carouselPieMenuStage, carouselFocusedNode, carouselAnimationState, PackageOpen, Package, ArrowUpFromDot, Edit3, Trash2, Bookmark, ArrowLeft, SendToBack, Plus, CornerUpLeft, CornerDownLeft, Palette, MoreHorizontal, zoomLevel, panOffset, containerRef, handlePieMenuColorPickerOpen, savedNodeIds]);

  // Log button changes for debugging
  useEffect(() => {
    // console.log(`[PieMenu Buttons] targetPieMenuButtons changed:`, {
    //   buttonCount: targetPieMenuButtons.length,
    //   buttonIds: targetPieMenuButtons.map(b => b.id),
    //   carouselStage: carouselPieMenuStage,
    //   selectedNodeId: selectedNodeIdForPieMenu,
    //   carouselVisible: abstractionCarouselVisible
    // });
  }, [targetPieMenuButtons, carouselPieMenuStage, selectedNodeIdForPieMenu, abstractionCarouselVisible]);

  // Keep currentPieMenuData.buttons in sync with targetPieMenuButtons so UI reflects state changes (e.g., Save/Unsave) immediately
  useEffect(() => {
    if (!currentPieMenuData) return;
    setCurrentPieMenuData(prev => prev ? { ...prev, buttons: targetPieMenuButtons } : prev);
