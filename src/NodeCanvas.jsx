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
import { getTextColor, hexToHsl } from './utils/colorUtils.js';
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
import { applyLayout, getClusterGeometries, FORCE_LAYOUT_DEFAULTS } from './services/graphLayoutService.js';
import { NavigationMode, calculateNavigationParams } from './services/canvasNavigationService.js';
import { debugLogSync } from './utils/debugLogger.js';

// Import Zustand store and selectors/actions
import useGraphStore, {
  getActiveGraphId,
  getHydratedNodesForGraph, // New selector
  getEdgesForGraph,
  getNodePrototypeById, // New selector for prototypes
} from "./store/graphStore.jsx";
import useHistoryStore from './store/historyStore.js';
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
import EdgeRenderer from './components/EdgeRenderer.jsx';
import { calculateParallelEdgePath } from './utils/canvas/parallelEdgeUtils.js';
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

// Movement Zoom-Out constants
const DRAG_ZOOM_OUT_FACTOR = 0.65;            // Zoom to 65% of current (35% reduction)
const DRAG_ZOOM_MIN = 0.3;                    // Don't zoom out beyond this
const DRAG_ZOOM_ANIMATION_DURATION = 250;     // ms (slightly increased for smoothness)

function NodeCanvas() {
  // CULLING DISABLE FLAG - Set to true to enable culling, false to disable
  const ENABLE_CULLING = false;

  const svgRef = useRef(null);
  const wrapperRef = useRef(null);
  const [orbitData, setOrbitData] = useState({ inner: [], outer: [], all: [] });
  const wasDraggingRef = useRef(false); // Track if a drag just occurred to prevent click events

  // Helper to measure text width accurately for the group labels
  // We use a cached canvas context to avoid creating it repeatedly
  const getTextWidth = (text, font) => {
    const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    const metrics = context.measureText(text);
    return metrics.width;
  };

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
        deleteGraph: () => { },
        setGroupLayoutAlgorithm: () => { },
        toggleShowClusterHulls: () => { }
      };
    }
  }, []);

  // Global Keyboard Shortcuts for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check for Ctrl+Z or Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const isRedo = e.shiftKey;

        // Prevent default browser undo/redo
        e.preventDefault();
        e.stopPropagation();

        const { undo, redo, canUndo, canRedo } = useHistoryStore.getState();
        const { applyPatches } = useGraphStore.getState();

        if (isRedo) {
          if (canRedo()) redo(applyPatches);
        } else {
          if (canUndo()) undo(applyPatches);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
      // Skip pinch zoom during drag to prevent interference with drag zoom animation
      if (draggingNodeInfoRef.current || isAnimatingZoomRef.current) return;
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

  // Refs to hold fresh handlers for event listeners to avoid stale closures
  const handleNodeTouchMoveRef = useRef(null);
  const handleNodeTouchEndRef = useRef(null);
  const handleNodeTouchCancelRef = useRef(null);

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
          // console.log('[DOC LISTENER] touchmove fired, dragNodeId:', touchState.current.dragNodeId, 'isDragging:', touchState.current.isDragging);
          const freshNodeData = nodes.find(n => n.id === touchState.current.dragNodeId);
          if (!freshNodeData || !touchState.current.dragNodeId) {
            // console.log('[DOC LISTENER] No fresh node data, returning');
            return;
          }
          if (handleNodeTouchMoveRef.current) {
            handleNodeTouchMoveRef.current(freshNodeData, ev);
          }
        };
        const endListener = (ev) => {
          console.log('[DOC LISTENER] touchend fired, cleaning up');
          const freshNodeData = nodes.find(n => n.id === touchState.current.dragNodeId);
          if (freshNodeData && handleNodeTouchEndRef.current) {
            handleNodeTouchEndRef.current(freshNodeData, ev);
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
          if (freshNodeData && handleNodeTouchCancelRef.current) {
            handleNodeTouchCancelRef.current(freshNodeData, ev);
          }
          else if (freshNodeData && handleNodeTouchEndRef.current) {
            handleNodeTouchEndRef.current(freshNodeData, ev);
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
  const groupLayoutAlgorithm = useGraphStore(state => state.autoLayoutSettings?.groupLayoutAlgorithm || 'node-driven');
  const showClusterHulls = useGraphStore(state => state.autoLayoutSettings?.showClusterHulls || false);
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
  const draggingNodeInfoRef = useRef(null); // Ref for synchronous access in event handlers
  useEffect(() => {
    draggingNodeInfoRef.current = draggingNodeInfo;
  }, [draggingNodeInfo]);
  const [preDragZoomLevel, setPreDragZoomLevel] = useState(null);
  const [isAnimatingZoom, setIsAnimatingZoom] = useState(false);
  const isAnimatingZoomRef = useRef(false); // Ref for synchronous access in event handlers
  useEffect(() => {
    isAnimatingZoomRef.current = isAnimatingZoom;
  }, [isAnimatingZoom]);
  const zoomOutInitiatedRef = useRef(false);
  const actualZoomedOutLevelRef = useRef(null); // Track the actual zoom level AFTER zoom-out animation completes
  const actualZoomedOutPanRef = useRef(null); // Track the actual pan offset AFTER zoom-out animation completes
  const preDragPanOffsetRef = useRef(null); // Track the ORIGINAL pan offset before zoom-out started
  const restoreInProgressRef = useRef(false); // Prevent double handleMouseUp calls
  const zoomAnimationRef = useRef({
    active: false,
    startTime: 0,
    startZoom: 1,
    targetZoom: 1,
    startPan: { x: 0, y: 0 },
    anchorWorld: { x: 0, y: 0 },
    anchorClient: { x: 0, y: 0 },
    animationId: null
  });
  const [longPressingInstanceId, setLongPressingInstanceId] = useState(null); // Store ID
  const [drawingConnectionFrom, setDrawingConnectionFrom] = useState(null); // Structure might change (store source ID)

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panOffsetRef = useRef(panOffset);
  useEffect(() => {
    panOffsetRef.current = panOffset;
  }, [panOffset]);

  const panRafRef = useRef(null);

  // Track if edge panning is actively modifying pan (to avoid conflicts with handleMouseMove RAF)
  const isEdgePanningRef = useRef(false);

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
  // We pass typeListMode !== 'closed' to ensure edge panning respects the TypeList visibility
  const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListMode !== 'closed');

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

  // Watchdog removed
  const prevZoomForWatchdog = useRef(zoomLevel);
  useEffect(() => {
    prevZoomForWatchdog.current = zoomLevel;
  }, [zoomLevel]);

  // Viewport bounds ref for edge panning effect
  const viewportBoundsRef = useRef(viewportBounds);
  useEffect(() => {
    viewportBoundsRef.current = viewportBounds;
  }, [viewportBounds]);

  const mousePositionRef = useRef({ x: 0, y: 0 });

  // Document-level mouse tracking during drag (captures events even over panels)
  useEffect(() => {
    if (!draggingNodeInfo) return;

    const handleDocumentMouseMove = (e) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
    };
  }, [draggingNodeInfo]);

  // --- Grid Snapping Helpers ---
  const snapToGrid = (mouseX, mouseY, nodeWidth, nodeHeight) => {
    return GeometryUtils.snapToGrid(mouseX, mouseY, nodeWidth, nodeHeight, gridMode, gridSize);
  };

  const snapToGridAnimated = (mouseX, mouseY, nodeWidth, nodeHeight, currentPos) => {
    return GeometryUtils.snapToGridAnimated(mouseX, mouseY, nodeWidth, nodeHeight, currentPos, gridMode, gridSize);
  };

  // Helper to update node position during drag (extracted for reuse in edge panning)
  // MOVED HERE: Must be defined AFTER snapToGridAnimated
  const performDragUpdate = useCallback((clientX, clientY, currentPan, currentZoom, draggingInfo) => {
    // Ensure labels recalc during drag
    placedLabelsRef.current = new Map();

    // Calculate mouse position in canvas coordinates
    const rect = containerRef.current.getBoundingClientRect();
    const mouseCanvasX = (clientX - rect.left - currentPan.x) / currentZoom + canvasSizeRef.current.offsetX;
    const mouseCanvasY = (clientY - rect.top - currentPan.y) / currentZoom + canvasSizeRef.current.offsetY;

    // Group drag via label
    if (draggingInfo.groupId && Array.isArray(draggingInfo.memberOffsets)) {
      const positionUpdates = draggingInfo.memberOffsets.map(({ id, dx, dy }) => {
        const node = nodeById.get(id);
        const xRaw = mouseCanvasX - dx;
        const yRaw = mouseCanvasY - dy;
        if (!node) return { instanceId: id, x: xRaw, y: yRaw };
        if (gridMode === 'off') {
          return { instanceId: id, x: xRaw, y: yRaw };
        }
        const dims = getNodeDimensions(node, false, null);
        const centerX = xRaw + dims.currentWidth / 2;
        const centerY = yRaw + dims.currentHeight / 2;
        const snappedCenterX = Math.floor(centerX / gridSize) * gridSize;
        const snappedCenterY = Math.floor(centerY / gridSize) * gridSize;
        const snappedX = snappedCenterX - (dims.currentWidth / 2);
        const snappedY = snappedCenterY - (dims.currentHeight / 2);
        return { instanceId: id, x: snappedX, y: snappedY };
      });
      storeActions.updateMultipleNodeInstancePositions(activeGraphId, positionUpdates, { isDragging: true, phase: 'move' });
      return;
    }

    // Multi-node drag
    if (draggingInfo.relativeOffsets) {
      const primaryInstanceId = draggingInfo.primaryId;
      // Calculate new primary position based on mouse position and initial offset
      // Note: We must use the current pan/zoom to reconstruct the initial canvas position relative to current view
      const initialMouseCanvasX = (draggingInfo.initialMouse.x - rect.left - currentPan.x) / currentZoom + canvasSizeRef.current.offsetX;
      const initialMouseCanvasY = (draggingInfo.initialMouse.y - rect.top - currentPan.y) / currentZoom + canvasSizeRef.current.offsetY;

      const dx = mouseCanvasX - initialMouseCanvasX;
      const dy = mouseCanvasY - initialMouseCanvasY;
      let newPrimaryX = draggingInfo.initialPrimaryPos.x + dx;
      let newPrimaryY = draggingInfo.initialPrimaryPos.y + dy;

      // Apply smooth grid snapping to primary node
      if (gridMode !== 'off') {
        const primaryNode = nodeById.get(primaryInstanceId);
        if (primaryNode) {
          const dims = getNodeDimensions(primaryNode, false, null);
          const snapped = snapToGridAnimated(mouseCanvasX, mouseCanvasY, dims.currentWidth, dims.currentHeight, { x: primaryNode.x, y: primaryNode.y });
          newPrimaryX = snapped.x;
          newPrimaryY = snapped.y;
        }
      }

      const positionUpdates = [];
      positionUpdates.push({ instanceId: primaryInstanceId, x: newPrimaryX, y: newPrimaryY });

      Object.keys(draggingInfo.relativeOffsets).forEach(instanceId => {
        const relativeOffset = draggingInfo.relativeOffsets[instanceId];
        positionUpdates.push({
          instanceId: instanceId,
          x: newPrimaryX + relativeOffset.offsetX,
          y: newPrimaryY + relativeOffset.offsetY
        });
      });

      storeActions.updateMultipleNodeInstancePositions(activeGraphId, positionUpdates, { isDragging: true, phase: 'move' });
      return;
    }

    // Single node drag
    const { instanceId, offset } = draggingInfo;
    const node = nodeById.get(instanceId);
    if (node) {
      const dims = getNodeDimensions(node, false, null);
      let newX, newY;

      if (gridMode !== 'off') {
        const snapped = snapToGridAnimated(mouseCanvasX, mouseCanvasY, dims.currentWidth, dims.currentHeight, { x: node.x, y: node.y });
        newX = snapped.x;
        newY = snapped.y;
      } else {
        newX = mouseCanvasX - offset.x;
        newY = mouseCanvasY - offset.y;
      }
      storeActions.updateNodeInstance(activeGraphId, instanceId, draft => {
        draft.x = newX;
        draft.y = newY;
      }, { isDragging: true, phase: 'move' });
    }
  }, [activeGraphId, nodeById, gridMode, gridSize, storeActions]);


  // Edge Panning Effect
  useEffect(() => {
    if (!draggingNodeInfo) return;

    let animationFrameId;

    const panLoop = () => {
      // If zooming (initial drag or restore), skip edge panning to prevent fighting/jitter
      if (isAnimatingZoomRef.current || restoreInProgressRef.current) {
        panRafRef.current = requestAnimationFrame(panLoop);
        return;
      }

      if (!draggingNodeInfoRef.current) return;

      const { x: mouseX, y: mouseY } = mousePositionRef.current;
      const bounds = viewportBoundsRef.current;
      const margin = 150; // Larger edge zone for better responsiveness
      const maxSpeed = 25; // Faster max speed

      let dx = 0;
      let dy = 0;

      // Left
      if (mouseX < bounds.x + margin) {
        const dist = (bounds.x + margin) - mouseX;
        const ratio = Math.min(1, dist / margin); // Cap at 1 (max speed)
        dx = -maxSpeed * Math.pow(ratio, 2);
      }
      // Right
      else if (mouseX > bounds.x + bounds.width - margin) {
        const dist = mouseX - (bounds.x + bounds.width - margin);
        const ratio = Math.min(1, dist / margin);
        dx = maxSpeed * Math.pow(ratio, 2);
      }

      // Top
      if (mouseY < bounds.y + margin) {
        const dist = (bounds.y + margin) - mouseY;
        const ratio = Math.min(1, dist / margin);
        dy = -maxSpeed * Math.pow(ratio, 2);
      }
      // Bottom
      else if (mouseY > bounds.y + bounds.height - margin) {
        const dist = mouseY - (bounds.y + bounds.height - margin);
        const ratio = Math.min(1, dist / margin);
        dy = maxSpeed * Math.pow(ratio, 2);
      }

      if (dx !== 0 || dy !== 0) {
        // Mark that edge panning is active (handleMouseMove RAF should skip)
        isEdgePanningRef.current = true;

        const currentPan = panOffsetRef.current;
        const currentZoom = zoomLevelRef.current;

        const currentCanvasWidth = canvasSizeRef.current.width * currentZoom;
        const currentCanvasHeight = canvasSizeRef.current.height * currentZoom;

        // Clamp to canvas bounds
        const minX = viewportSizeRef.current.width - currentCanvasWidth;
        const minY = viewportSizeRef.current.height - currentCanvasHeight;
        const maxX = 0;
        const maxY = 0;

        const newX = Math.min(Math.max(currentPan.x - dx, minX), maxX);
        const newY = Math.min(Math.max(currentPan.y - dy, minY), maxY);

        if (newX !== currentPan.x || newY !== currentPan.y) {
          const newPan = { x: newX, y: newY };

          // CRITICAL: Update ref synchronously BEFORE setPanOffset
          // This ensures handleMouseMove's RAF sees the new value immediately
          // (useEffect that syncs ref from state runs AFTER RAF callbacks)
          panOffsetRef.current = newPan;

          // Use setPanOffset directly to allow React to batch this update with the 
          // subsequent node position update in performDragUpdate. 
          // This reduces re-renders by 50% during edge panning.
          setPanOffset(newPan);

          // Force update node position with new pan to keep it under mouse
          performDragUpdate(mouseX, mouseY, newPan, currentZoom, draggingNodeInfoRef.current);
        }
      } else {
        // Not in edge zone - allow handleMouseMove RAF to update node position
        isEdgePanningRef.current = false;
      }

      animationFrameId = requestAnimationFrame(panLoop);
    };

    animationFrameId = requestAnimationFrame(panLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [draggingNodeInfo, performDragUpdate]);

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

  const animateZoomToTarget = useCallback((targetZoom, anchorPoint = null, currentZoom = null, currentPan = null) => {
    // anchorPoint: { clientX, clientY } - the screen point to keep stable
    // currentZoom: optional explicit current zoom level (to avoid stale ref issues)
    // currentPan: optional explicit current pan (to avoid stale ref issues)


    // Stop any existing drag zoom animation
    if (zoomAnimationRef.current.animationId) {
      cancelAnimationFrame(zoomAnimationRef.current.animationId);
    }

    // CRITICAL: Also stop pinch smoothing animation to prevent it from overwriting our zoom
    if (pinchSmoothingRef.current.animationId) {
      cancelAnimationFrame(pinchSmoothingRef.current.animationId);
      pinchSmoothingRef.current.animationId = null;
      pinchSmoothingRef.current.isAnimating = false;
    }

    // Use provided currentZoom if available, otherwise fall back to ref (but prefer state)
    const startZoom = currentZoom !== null ? currentZoom : zoomLevelRef.current;
    // Use provided currentPan if available, otherwise fall back to ref
    const startPan = currentPan ? { ...currentPan } : { ...panOffsetRef.current };

    // If no anchor point provided, use viewport center
    const clientX = anchorPoint ? anchorPoint.clientX : viewportSizeRef.current.width / 2;
    const clientY = anchorPoint ? anchorPoint.clientY : viewportSizeRef.current.height / 2;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // The world coordinates of the anchor point at the START of animation
    const anchorWorldX = (clientX - rect.left - startPan.x) / startZoom + canvasSizeRef.current.offsetX;
    const anchorWorldY = (clientY - rect.top - startPan.y) / startZoom + canvasSizeRef.current.offsetY;

    zoomAnimationRef.current = {
      active: true,
      startTime: performance.now(),
      startZoom,
      targetZoom,
      startPan,
      anchorWorld: { x: anchorWorldX, y: anchorWorldY },
      anchorClient: { x: clientX, y: clientY },
      animationId: null
    };

    setIsAnimatingZoom(true);

    const step = (now) => {
      const state = zoomAnimationRef.current;
      if (!state.active) {
        return;
      }

      const elapsed = now - state.startTime;
      const progress = Math.min(1, elapsed / DRAG_ZOOM_ANIMATION_DURATION);

      // Easing: easeOutCubic
      const t = 1 - Math.pow(1 - progress, 3);

      const currentZoom = state.startZoom + (state.targetZoom - state.startZoom) * t;

      // Calculate pan required to keep anchorWorld at anchorClient with currentZoom
      const newPanX = state.anchorClient.x - rect.left - (state.anchorWorld.x - canvasSizeRef.current.offsetX) * currentZoom;
      const newPanY = state.anchorClient.y - rect.top - (state.anchorWorld.y - canvasSizeRef.current.offsetY) * currentZoom;

      // Clamp pan to canvas bounds
      const minPanX = viewportSizeRef.current.width - canvasSizeRef.current.width * currentZoom;
      const minPanY = viewportSizeRef.current.height - canvasSizeRef.current.height * currentZoom;
      const clampedPanX = Math.min(0, Math.max(newPanX, minPanX));
      const clampedPanY = Math.min(0, Math.max(newPanY, minPanY));

      setZoomLevel(currentZoom);
      setPanOffset({ x: clampedPanX, y: clampedPanY });

      if (progress < 1) {
        state.animationId = requestAnimationFrame(step);
      } else {
        // Store the actual final zoom level AND pan offset for accurate restore later
        // (React state/ref updates are async, so we must capture the actual values here)
        if (zoomOutInitiatedRef.current && !restoreInProgressRef.current) {
          actualZoomedOutLevelRef.current = state.targetZoom;
          actualZoomedOutPanRef.current = { x: clampedPanX, y: clampedPanY };
        }
        state.active = false;
        state.animationId = null;
        setIsAnimatingZoom(false);
      }
    };

    zoomAnimationRef.current.animationId = requestAnimationFrame(step);
  }, [setZoomLevel, setPanOffset]);

  // Animate directly to target zoom AND pan values (used for restore to avoid anchor drift)
  const animateZoomAndPanToTarget = useCallback((targetZoom, targetPan, currentZoom, currentPan = null) => {
    // Stop any existing animations
    if (zoomAnimationRef.current.animationId) {
      cancelAnimationFrame(zoomAnimationRef.current.animationId);
    }
    if (pinchSmoothingRef.current.animationId) {
      cancelAnimationFrame(pinchSmoothingRef.current.animationId);
      pinchSmoothingRef.current.animationId = null;
      pinchSmoothingRef.current.isAnimating = false;
    }

    const startZoom = currentZoom !== null ? currentZoom : zoomLevelRef.current;
    // Use provided currentPan if available (avoids stale ref issue), otherwise fall back to ref
    const startPan = currentPan !== null ? { ...currentPan } : { ...panOffsetRef.current };

    zoomAnimationRef.current = {
      active: true,
      startTime: performance.now(),
      startZoom,
      targetZoom,
      startPan,
      targetPan,
      animationId: null
    };

    setIsAnimatingZoom(true);

    const step = (now) => {
      const state = zoomAnimationRef.current;
      if (!state.active) return;

      const elapsed = now - state.startTime;
      const progress = Math.min(1, elapsed / DRAG_ZOOM_ANIMATION_DURATION);
      const t = 1 - Math.pow(1 - progress, 3); // easeOutCubic

      const currentZoomVal = state.startZoom + (state.targetZoom - state.startZoom) * t;
      const currentPanX = state.startPan.x + (state.targetPan.x - state.startPan.x) * t;
      const currentPanY = state.startPan.y + (state.targetPan.y - state.startPan.y) * t;

      setZoomLevel(currentZoomVal);
      setPanOffset({ x: currentPanX, y: currentPanY });

      if (progress < 1) {
        state.animationId = requestAnimationFrame(step);
      } else {
        state.active = false;
        state.animationId = null;
        setIsAnimatingZoom(false);
      }
    };

    zoomAnimationRef.current.animationId = requestAnimationFrame(step);
  }, [setZoomLevel, setPanOffset]);

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

    // Skip auto-layout for very large graphs to prevent UI freeze
    // Force-directed layout is O(n²) and becomes prohibitively slow
    if (nodes.length > 50) {
      console.log(`[AutoLayout] Skipping auto-layout: graph too large (${nodes.length} nodes, threshold is 50)`);
      return;
    }

    // Show loading indicator for large graphs
    if (nodes.length > 20) {
      console.log(`[AutoLayout] Applying auto-layout to ${nodes.length} nodes...`);
    }

    const graphData = activeGraphId ? graphsMap.get(activeGraphId) : null;

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
      useExistingPositions: true,  // Preserve manually arranged nodes
      groups: Array.from(graphData?.groups?.values() || [])
    };

    try {
      let updates = applyLayout(layoutNodes, layoutEdges, groupLayoutAlgorithm, layoutOptions);

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

      console.log('[AutoLayout] Applied', groupLayoutAlgorithm, 'layout to graph', activeGraphId, 'for', updates.length, 'nodes.');

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
  }, [activeGraphId, baseDimsById, nodes, edges, storeActions, moveOutOfBoundsNodesInBounds, resetConnectionLabelCache, layoutScalePreset, layoutScaleMultiplier, layoutIterationPreset, canvasSize, groupLayoutAlgorithm, graphsMap]);

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
  // (Helpers moved up to satisfy dependency in performDragUpdate)

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
  const [colorPickerTarget, setColorPickerTarget] = useState(null); // { type: 'node_prompt' | 'connection_prompt' | 'group', id: string }


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

  const handleGroupPanelColor = useCallback((e) => {
    if (!activeGraphId || !selectedGroup) return;

    // Stop propagation if event exists
    if (e && e.stopPropagation) e.stopPropagation();

    // Position the color picker near the clicked element if possible
    if (e && e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      setDialogColorPickerPosition({ x: rect.right, y: rect.bottom });
    } else {
      // Fallback center position or mouse position if we tracked it
      setDialogColorPickerPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }

    setColorPickerTarget({ type: 'group', id: selectedGroup.id });
    setDialogColorPickerVisible(true);
  }, [activeGraphId, selectedGroup, setDialogColorPickerVisible, setDialogColorPickerPosition, setColorPickerTarget]);

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
  const connectionCreationInProgressRef = useRef(false); // Guard against double edge creation from event bubbling
  // Add refs for click vs double-click detection
  const clickTimeoutIdRef = useRef(null);
  const potentialClickNodeRef = useRef(null);
  const CLICK_DELAY = 180; // Reduced milliseconds to wait for a potential double-click

  // Ref to track initial mount completion
  const isMountedRef = useRef(false);

  // Ref for dialog container to prevent click-away closing
  const dialogContainerRef = useRef(null);

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
  }, [targetPieMenuButtons, currentPieMenuData]);

  // Effect to restore view state on graph change or center if no stored state
  useLayoutEffect(() => {
    // If we're dragging a node or animating zoom, DO NOT restore view from store
    // This prevents the "teleportation" where store state overrides our local interaction state
    if (draggingNodeInfoRef.current || isAnimatingZoomRef.current) {
      return;
    }

    setIsViewReady(false); // Set to not ready on graph change

    // Ensure we have valid sizes and an active graph
    if (activeGraphId && viewportSize.width > 0 && viewportSize.height > 0 && canvasSize.width > 0 && canvasSize.height > 0) {

      const graphData = graphsMap.get(activeGraphId);

      if (graphData && graphData.panOffset && typeof graphData.zoomLevel === 'number') {
        // Restore the stored view state immediately
        setPanOffset(graphData.panOffset);
        setZoomLevel(graphData.zoomLevel);
      } else {
        // No stored state, center the view as before
        // 

        // Target the center of the canvas
        const targetCanvasX = canvasSize.width / 2;
        const targetCanvasY = canvasSize.height / 2;

        // Use default zoom level
        const defaultZoom = 1;

        // Calculate pan needed to place targetCanvas coords at viewport center
        const initialPanX = viewportSize.width / 2 - targetCanvasX * defaultZoom;
        const initialPanY = viewportSize.height / 2 - targetCanvasY * defaultZoom;

        // Clamp the initial pan to valid bounds
        const maxX = 0;
        const maxY = 0;
        const minX = viewportSize.width - canvasSize.width * defaultZoom;
        const minY = viewportSize.height - canvasSize.height * defaultZoom;
        const clampedX = Math.min(Math.max(initialPanX, minX), maxX);
        const clampedY = Math.min(Math.max(initialPanY, minY), maxY);

        // Apply the calculated view state immediately
        setPanOffset({ x: clampedX, y: clampedY });
        setZoomLevel(defaultZoom);
      }

      // Set view to ready immediately - no delay
      setIsViewReady(true);

    } else if (!activeGraphId) {
      setIsViewReady(true); // No graph, so "ready" to show nothing
    }
  }, [activeGraphId, viewportSize, canvasSize, graphsMap]);

  // Track when panning/zooming operations are active
  const isPanningOrZooming = useRef(false);
  const saveViewStateTimeout = useRef(null);

  // Function to save view state when operations complete
  const updateGraphViewInStore = useCallback(() => {
    if (activeGraphId && panOffset && zoomLevel) {
      storeActions.updateGraphView(activeGraphId, panOffset, zoomLevel);
    }
  }, [activeGraphId, panOffset, zoomLevel, storeActions.updateGraphView]);

  // Effect to save view state after panning/zooming stops
  useEffect(() => {
    if (activeGraphId && panOffset && zoomLevel) {
      // Clear any existing timeout
      if (saveViewStateTimeout.current) {
        clearTimeout(saveViewStateTimeout.current);
      }

      // Set a timeout to save after operations stop
      // Completely prevent store updates during active pinch operations to eliminate Panel jitter
      if (pinchRef.current.active) {
        // Don't save to store during active pinch - this prevents Panel re-renders
        return;
      }

      // CRITICAL: Don't save during node drag or drag zoom animations
      if (draggingNodeInfo || isAnimatingZoom) {
        return;
      }

      const saveDelay = 300; // Standard delay for non-pinch operations
      saveViewStateTimeout.current = setTimeout(() => {
        if (!isPanningOrZooming.current && !draggingNodeInfoRef.current && !isAnimatingZoomRef.current) {
          updateGraphViewInStore();
        } else {
        }
      }, saveDelay);
    }

    return () => {
      if (saveViewStateTimeout.current) {
        clearTimeout(saveViewStateTimeout.current);
      }
    };
  }, [activeGraphId, panOffset, zoomLevel, updateGraphViewInStore, draggingNodeInfo, isAnimatingZoom]);

  // --- Utility Functions ---

  // Smooth pinch zoom animation
  const animatePinchSmoothing = useCallback(() => {
    const smoothing = pinchSmoothingRef.current;
    if (!smoothing || !smoothing.isAnimating) {
      return;
    }
    if (!smoothing.isAnimating) {
      // Animation should not be running
      if (smoothing?.animationId) {
        cancelAnimationFrame(smoothing.animationId);
        smoothing.animationId = null;
        smoothing.isAnimating = false;

      }
      return;
    }
    const now = performance.now();

    // Track animation frame timing
    const frameDelta = smoothing.lastFrameTime ? now - smoothing.lastFrameTime : 16.67;
    smoothing.lastFrameTime = now;
    smoothing.frameCount++;

    // Update rolling average frame delta
    smoothing.avgFrameDelta = smoothing.avgFrameDelta * 0.9 + frameDelta * 0.1;

    // Adjust smoothing based on frame timing to maintain consistency
    const frameTimeRatio = frameDelta / 16.67; // 16.67ms = 60fps target
    const adjustedSmoothing = Math.min(0.15, smoothing.smoothing * frameTimeRatio);

    // Store previous values for delta logging
    const prevZoom = smoothing.currentZoom;
    const prevPanX = smoothing.currentPanX;
    const prevPanY = smoothing.currentPanY;

    // Lerp towards target values with frame-time compensation
    smoothing.currentZoom = GeometryUtils.lerp(smoothing.currentZoom, smoothing.targetZoom, adjustedSmoothing);
    smoothing.currentPanX = GeometryUtils.lerp(smoothing.currentPanX, smoothing.targetPanX, adjustedSmoothing);
    smoothing.currentPanY = GeometryUtils.lerp(smoothing.currentPanY, smoothing.targetPanY, adjustedSmoothing);

    // Round to prevent subpixel jitter
    smoothing.currentZoom = Math.round(smoothing.currentZoom * 10000) / 10000;
    smoothing.currentPanX = Math.round(smoothing.currentPanX * 100) / 100;
    smoothing.currentPanY = Math.round(smoothing.currentPanY * 100) / 100;

    // Calculate deltas for logging
    const zoomDelta = smoothing.currentZoom - prevZoom;
    const panXDelta = smoothing.currentPanX - prevPanX;
    const panYDelta = smoothing.currentPanY - prevPanY;

    // Batch state updates to reduce renders and potential jitter
    if (React?.startTransition) {
      React.startTransition(() => {
        setZoomLevel(smoothing.currentZoom);
        setPanOffset({ x: smoothing.currentPanX, y: smoothing.currentPanY });
      });
    } else {
      // Fallback if startTransition not available
      setZoomLevel(smoothing.currentZoom);
      setPanOffset({ x: smoothing.currentPanX, y: smoothing.currentPanY });
    }

    // Check if we're close enough to the target to stop animating
    const zoomDiff = Math.abs(smoothing.currentZoom - smoothing.targetZoom);
    const panXDiff = Math.abs(smoothing.currentPanX - smoothing.targetPanX);
    const panYDiff = Math.abs(smoothing.currentPanY - smoothing.targetPanY);

    // Log performance metrics every 500ms
    if (now - smoothing.lastLogTime > 500) {
      // console.log('🎯 Pinch Animation Stats:', {
      //   fps: Math.round(1000 / smoothing.avgFrameDelta),
      //   avgFrameDelta: Math.round(smoothing.avgFrameDelta * 100) / 100,
      //   currentFrameDelta: Math.round(frameDelta * 100) / 100,
      //   frameTimeRatio: Math.round(frameTimeRatio * 100) / 100,
      //   adjustedSmoothing: Math.round(adjustedSmoothing * 1000) / 1000,
      //   frameCount: smoothing.frameCount,
      //   inputEvents: smoothing.inputEventCount,
      //   deltas: {
      //     zoom: Math.round(zoomDelta * 10000) / 10000,
      //     panX: Math.round(panXDelta * 100) / 100,
      //     panY: Math.round(panYDelta * 100) / 100
      //   },
      //   diffs: {
      //     zoom: Math.round(zoomDiff * 10000) / 10000,
      //     panX: Math.round(panXDiff * 100) / 100,
      //     panY: Math.round(panYDiff * 100) / 100
      //   }
      // });
      smoothing.lastLogTime = now;
    }

    // Continue animation if we're not close enough (threshold: 0.001 for zoom, 0.1 for pan)
    if (zoomDiff > 0.001 || panXDiff > 0.1 || panYDiff > 0.1) {
      smoothing.animationId = requestAnimationFrame(animatePinchSmoothing);
    } else {
      // Snap to final values and stop animation
      setZoomLevel(smoothing.targetZoom);
      setPanOffset({ x: smoothing.targetPanX, y: smoothing.targetPanY });
      smoothing.currentZoom = smoothing.targetZoom;
      smoothing.currentPanX = smoothing.targetPanX;
      smoothing.currentPanY = smoothing.targetPanY;
      smoothing.animationId = null;
      smoothing.isAnimating = false;

      // console.log('🏁 Pinch Animation Complete:', {
      //   totalFrames: smoothing.frameCount,
      //   totalInputs: smoothing.inputEventCount,
      //   avgFPS: Math.round(1000 / smoothing.avgFrameDelta)
      // });

      // Reset counters
      smoothing.frameCount = 0;
      smoothing.inputEventCount = 0;

      // Trigger culling update after animation completes
      // The culling useEffect will run on the next render cycle
    }
  }, []);
  // Start or update pinch zoom smoothing
  const startPinchSmoothing = useCallback((targetZoom, targetPanX, targetPanY) => {
    // console.log('🟢 startPinchSmoothing CALLED:', {
    //   targetZoom: Math.round(targetZoom * 1000) / 1000,
    //   targetPanX: Math.round(targetPanX * 10) / 10,
    //   targetPanY: Math.round(targetPanY * 10) / 10,
    //   refExists: !!pinchSmoothingRef.current
    // });

    const smoothing = pinchSmoothingRef.current;
    const now = performance.now();

    // Track input event timing
    const inputDelta = smoothing.lastInputTime ? now - smoothing.lastInputTime : 0;
    smoothing.lastInputTime = now;
    smoothing.inputEventCount++;

    // Throttle extremely frequent input events to prevent jitter
    if (inputDelta < 8 && smoothing.isAnimating) { // Throttle to max ~120Hz

      return;
    }

    // Emergency fallback - if smoothing isn't working, use direct updates
    if (!animatePinchSmoothing || typeof animatePinchSmoothing !== 'function') {

      setZoomLevel(targetZoom);
      setPanOffset({ x: targetPanX, y: targetPanY });
      return;
    }

    // Log input event details - disabled
    // if (smoothing.inputEventCount % 10 === 1) { // Log every 10th input
    //   console.log('📱 Input Event:', {
    //     eventCount: smoothing.inputEventCount,
    //     inputDelta: Math.round(inputDelta * 10) / 10,
    //     targetZoom: Math.round(targetZoom * 1000) / 1000,
    //     targetPan: {
    //       x: Math.round(targetPanX * 10) / 10,
    //       y: Math.round(targetPanY * 10) / 10
    //     },
    //     currentZoom: Math.round(smoothing.currentZoom * 1000) / 1000,
    //     isAnimating: smoothing.isAnimating
    //   });
    // }

    // Set new targets
    smoothing.targetZoom = targetZoom;
    smoothing.targetPanX = targetPanX;
    smoothing.targetPanY = targetPanY;

    // Initialize current values if not already animating
    if (!smoothing.animationId) {

      smoothing.currentZoom = zoomLevel;
      smoothing.currentPanX = panOffset.x;
      smoothing.currentPanY = panOffset.y;
      smoothing.isAnimating = true;
      smoothing.lastFrameTime = now;

      smoothing.animationId = requestAnimationFrame(animatePinchSmoothing);

    }
  }, [zoomLevel, panOffset.x, panOffset.y, animatePinchSmoothing]);

  // Stop pinch zoom smoothing
  const stopPinchSmoothing = useCallback(() => {
    const smoothing = pinchSmoothingRef.current;
    if (smoothing.animationId) {
      cancelAnimationFrame(smoothing.animationId);
      smoothing.animationId = null;
      smoothing.isAnimating = false;
    }
  }, []);

  const clampCoordinates = (x, y) => {
    return GeometryUtils.clampCoordinates(x, y, canvasSize);
  };

  const lineIntersectsRect = GeometryUtils.lineIntersectsRect;

  // Helper function to get description content for a node when previewing
  const getNodeDescriptionContent = (node, isNodePreviewing) => {
    if (!isNodePreviewing || !node.definitionGraphIds || node.definitionGraphIds.length === 0) {
      return null;
    }

    // Create context-specific key for this node in the current graph
    const contextKey = `${node.prototypeId}-${activeGraphId}`; // Use prototypeId for context
    const currentIndex = nodeDefinitionIndices.get(contextKey) || 0;
    const definitionGraphId = node.definitionGraphIds[currentIndex] || node.definitionGraphIds[0];
    if (!definitionGraphId) return null;

    const graphData = graphsMap.get(definitionGraphId);
    return graphData?.description || null;
  };

  const isInsideNode = (nodeData, clientX, clientY) => {
    if (!containerRef.current || !nodeData) return false;
    const rect = containerRef.current.getBoundingClientRect();
    return GeometryUtils.isInsideNode(nodeData, clientX, clientY, rect, panOffset, zoomLevel, canvasSize, previewingNodeId);
  };

  // Helper function to check if a point is near a line (for edge hover detection)
  const isNearEdge = (x1, y1, x2, y2, pointX, pointY, threshold = 20) => {
    // Calculate distance from point to line segment
    const A = pointX - x1;
    const B = pointY - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;

    if (lenSq === 0) return Math.sqrt(A * A + B * B) <= threshold; // Point-to-point distance

    let param = dot / lenSq;

    // Clamp to line segment
    if (param < 0) param = 0;
    else if (param > 1) param = 1;

    const xx = x1 + param * C;
    const yy = y1 + param * D;

    const dx = pointX - xx;
    const dy = pointY - yy;

    return Math.sqrt(dx * dx + dy * dy) <= threshold;
  };

  // Edge interaction handlers
  const handleEdgeClick = useCallback((edgeId, e) => {
    if (!activeGraphId) return;

    // Handle multi-selection with Ctrl/Cmd key
    if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) {
      if (selectedEdgeIds.has(edgeId)) {
        storeActions.removeSelectedEdgeId(edgeId);
      } else {
        storeActions.addSelectedEdgeId(edgeId);
      }
    } else {
      // Single selection - clear multiple selection and set single edge
      storeActions.clearSelectedEdgeIds();
      storeActions.setSelectedEdgeId(edgeId);
    }
  }, [activeGraphId, selectedEdgeIds, isMac, storeActions]);

  // Touch double-tap detection for edges → open definition
  const lastEdgeTapRef = useRef({ id: null, ts: 0 });
  const EDGE_DOUBLE_TAP_MS = 300;
  const handleEdgePointerDownTouch = useCallback((edgeId, e) => {
    if (e && e.pointerType === 'mouse') return; // only handle touch/pencil here
    const now = performance.now();
    const last = lastEdgeTapRef.current;
    if (last.id === edgeId && (now - last.ts) < EDGE_DOUBLE_TAP_MS) {
      // Double tap → open definition in right panel
      e.preventDefault?.();
      e.stopPropagation?.();
      const state = useGraphStore.getState();
      const edge = state.edges?.get?.(edgeId);
      let definingNodeId = null;
      if (edge?.definitionNodeIds && edge.definitionNodeIds.length > 0) {
        definingNodeId = edge.definitionNodeIds[0];
      } else if (edge?.typeNodeId) {
        definingNodeId = edge.typeNodeId;
      }
      if (definingNodeId) {
        state.openRightPanelNodeTab?.(definingNodeId);
      }
      lastEdgeTapRef.current = { id: null, ts: 0 };
      return;
    }
    lastEdgeTapRef.current = { id: edgeId, ts: now };
  }, []);

  const handleEdgeMouseEnter = useCallback((edgeId) => {
    setHoveredEdgeInfo({ edgeId });
  }, []);

  const handleEdgeMouseLeave = useCallback(() => {
    setHoveredEdgeInfo(null);
  }, []);

  const triggerDragZoomOut = useCallback((clientX, clientY) => {
    // Movement Zoom-Out: Trigger after a tiny delay to ensure state is settled
    // This prevents zoom reset during the movement threshold delay while still triggering reliably
    const currentZoom = zoomLevel;
    if (currentZoom > DRAG_ZOOM_MIN && !zoomOutInitiatedRef.current) {
      zoomOutInitiatedRef.current = true;
      setPreDragZoomLevel(currentZoom);
      // Store original pan offset for proper restore (avoids anchor drift)
      preDragPanOffsetRef.current = { ...panOffset };
      const targetZoom = Math.max(DRAG_ZOOM_MIN, currentZoom * DRAG_ZOOM_OUT_FACTOR);

      // Start animation immediately (synchronously) to avoid 1-frame delay/glitch
      // We pass the current panOffset explicitly to ensure the anchor calculation matches the current view
      animateZoomToTarget(targetZoom, { clientX, clientY }, currentZoom, { ...panOffset });
    }
  }, [zoomLevel, panOffset, animateZoomToTarget]);

  const startDragForNode = useCallback((nodeData, clientX, clientY) => {
    if (!nodeData || !activeGraphId) return false;
    const instanceId = nodeData.id;

    if (selectedInstanceIds.has(instanceId)) {
      const primaryNodeData = nodeById.get(instanceId);
      if (!primaryNodeData) return false;

      const initialPrimaryPos = { x: primaryNodeData.x, y: primaryNodeData.y };
      const initialPositions = {};
      nodes.forEach(n => {
        if (selectedInstanceIds.has(n.id) && n.id !== instanceId) {
          initialPositions[n.id] = { offsetX: n.x - initialPrimaryPos.x, offsetY: n.y - initialPrimaryPos.y };
        }
      });

      setDraggingNodeInfo({
        initialMouse: { x: clientX, y: clientY },
        initialPrimaryPos,
        relativeOffsets: initialPositions,
        primaryId: instanceId
      });

      triggerDragZoomOut(clientX, clientY);

      selectedInstanceIds.forEach(id => {
        storeActions.updateNodeInstance(activeGraphId, id, draft => { draft.scale = 1.15; }, { isDragging: true, phase: 'start' });
      });
      return true;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const mouseCanvasX = (clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
    const mouseCanvasY = (clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
    const offset = { x: mouseCanvasX - nodeData.x, y: mouseCanvasY - nodeData.y };
    setDraggingNodeInfo({ instanceId, offset });



    triggerDragZoomOut(clientX, clientY);

    storeActions.updateNodeInstance(activeGraphId, instanceId, draft => { draft.scale = 1.15; }, { isDragging: true, phase: 'start' });
    return true;
  }, [
    activeGraphId,
    selectedInstanceIds,
    nodes,
    panOffset.x,
    panOffset.y,
    zoomLevel,
    canvasSize.offsetX,
    canvasSize.offsetY,
    storeActions
  ]);

  const handleNodeMouseDown = (nodeData, e) => { // nodeData is now a hydrated node (instance + prototype)
    e.stopPropagation();
    if (suppressNextMouseDownRef.current) {
      suppressNextMouseDownRef.current = false;
      return;
    }
    // Ignore right-clicks (button === 2) so context menu can handle them without locking drag
    if (e && e.button === 2) {
      try { e.preventDefault(); } catch { }
      return;
    }
    stopPanMomentum();
    if (isPaused || !activeGraphId) return;

    const instanceId = nodeData.id; // This is the instance ID
    const prototypeId = nodeData.prototypeId;
    setHasMouseMovedSinceDown(false);

    // --- Double-click ---
    if (e.detail === 2) {
      e.preventDefault();
      if (clickTimeoutIdRef.current) { clearTimeout(clickTimeoutIdRef.current); clickTimeoutIdRef.current = null; }
      potentialClickNodeRef.current = null;
      // Open panel tab using the PROTOTYPE ID
      storeActions.openRightPanelNodeTab(prototypeId, nodeData.name);
      // Ensure right panel is expanded
      if (!rightPanelExpanded) {
        setRightPanelExpanded(true);
      }
      return;
    }

    // --- Single click initiation & Long press ---
    if (e.detail === 1) {
      isMouseDown.current = true;
      mouseDownPosition.current = { x: e.clientX, y: e.clientY };
      mouseMoved.current = false;
      mouseInsideNode.current = true;
      startedOnNode.current = true;

      // --- Handle Click vs Double Click Timing ---
      if (clickTimeoutIdRef.current) { clearTimeout(clickTimeoutIdRef.current); }
      potentialClickNodeRef.current = nodeData;

      clickTimeoutIdRef.current = setTimeout(() => {
        if (potentialClickNodeRef.current?.id === instanceId && !mouseMoved.current && !isMouseDown.current) {
          // --- Execute Selection Logic ---
          const wasSelected = selectedInstanceIds.has(instanceId);
          setSelectedInstanceIds(prev => {
            const newSelected = new Set(prev);
            if (wasSelected) {
              if (instanceId !== previewingNodeId) { // previewingNodeId also needs to be an instanceId
                newSelected.delete(instanceId);
              }
            } else {
              newSelected.add(instanceId);
            }
            return newSelected;
          });
        }
        clickTimeoutIdRef.current = null;
        potentialClickNodeRef.current = null;
      }, CLICK_DELAY);

      // --- Setup Long Press for Drag/Connection ---
      clearTimeout(longPressTimeout.current);
      setLongPressingInstanceId(instanceId);
      longPressTimeout.current = setTimeout(() => {
        console.log('Long press timeout fired:', {
          instanceId,
          mouseInsideNode: mouseInsideNode.current,
          mouseMoved: mouseMoved.current,
          isTouchDevice: isTouchDeviceRef.current,
          willProceed: mouseInsideNode.current && (!mouseMoved.current || isTouchDeviceRef.current)
        });
        if (clickTimeoutIdRef.current) { clearTimeout(clickTimeoutIdRef.current); clickTimeoutIdRef.current = null; }
        potentialClickNodeRef.current = null;

        if (mouseInsideNode.current && (!mouseMoved.current || isTouchDeviceRef.current)) {
          startDragForNode(nodeData, e.clientX, e.clientY);
        }
        setLongPressingInstanceId(null);
      }, LONG_PRESS_DURATION);
    }
  };

  const handleSaveNodeData = (prototypeId, newData) => { // Operates on prototype
    if (!activeGraphId) return;
    storeActions.updateNodePrototype(prototypeId, draft => {
      Object.assign(draft, newData);
    });
  };

  // Delta history for better trackpad/mouse detection
  const deltaHistoryRef = useRef([]);
  const DELTA_HISTORY_SIZE = 10;
  const DELTA_TIMEOUT = 500; // Clear history after 500ms of inactivity
  const deltaTimeoutRef = useRef(null);
  // Lock the detected device type within a continuous wheel stream
  const wheelStreamRef = useRef({ lockedType: null, lastTimestamp: 0 });
  const WHEEL_STREAM_GAP_MS = 140; // gap after which a new stream starts
  // Lethargy instance to classify intentful mouse wheel vs inertial trackpad
  const lethargyRef = useRef(null);
  if (!lethargyRef.current) {
    // stability, sensitivity, tolerance tuned lightly for our use-case
    lethargyRef.current = new Lethargy(7, 100, 0.05);
  }
  // Cooldown after zoom to avoid immediate misclassification of tiny trackpad pans
  const lastZoomTsRef = useRef(0);
  const POST_ZOOM_COOLDOWN_MS = 160;
  const SMALL_PIXEL_DELTA_Y = 1.6; // very small pixel scrolls likely pan noise

  // Improved trackpad vs mouse wheel detection based on industry patterns
  // Returns one of: 'trackpad', 'trackpad_inertia', 'mouse', 'mouse_wheel', 'undetermined'
  const analyzeInputDevice = (deltaX, deltaY, deltaMode = 0, wheelDeltaY = 0, rawDeltaY = 0) => {
    // Add current deltas to history
    deltaHistoryRef.current.unshift({ deltaX, deltaY, deltaMode, wheelDeltaY, rawDeltaY, timestamp: Date.now() });
    if (deltaHistoryRef.current.length > DELTA_HISTORY_SIZE) {
      deltaHistoryRef.current.pop();
    }

    // Clear history after timeout
    if (deltaTimeoutRef.current) clearTimeout(deltaTimeoutRef.current);
    deltaTimeoutRef.current = setTimeout(() => {
      deltaHistoryRef.current = [];
    }, DELTA_TIMEOUT);

    // Need at least 3 samples for reliable detection
    if (deltaHistoryRef.current.length < 3) {
      return 'undetermined';
    }

    const recentDeltas = deltaHistoryRef.current.slice(0, 6); // Use last 5-6 samples
    const deltaYValues = recentDeltas.map(d => Math.abs(d.deltaY)).filter(d => d > 0);

    if (deltaYValues.length === 0) return 'undetermined';

    // Trackpad indicators (based on research from GitHub issue):
    // 1. Fractional delta values (trackpads often produce non-integer deltas)
    const hasFractionalDeltas = deltaYValues.some(d => d % 1 !== 0);

    // 2. Horizontal movement (trackpads support 2D scrolling) - LOWERED threshold
    const hasHorizontalMovement = Math.abs(deltaX) > 0.05; // Reduced from 0.1

    // 3. Small, continuous values (trackpads produce smaller, more frequent events)
    const hasSmallDeltas = deltaYValues.every(d => d < 50);
    const hasVariedDeltas = deltaYValues.length > 1 &&
      Math.max(...deltaYValues) - Math.min(...deltaYValues) > deltaYValues[0] * 0.1;

    // 4. Mouse wheel indicators:
    // - Large, discrete values (often multiples of 120, 100, or other fixed amounts)
    // - Integer values
    // - Consistent patterns (same value repeated or simple multiples)
    const hasLargeDeltas = deltaYValues.some(d => d >= 50);
    const allIntegerDeltas = deltaYValues.every(d => d % 1 === 0);

    // Check for mouse wheel patterns (repeated values or simple ratios)
    let hasMouseWheelPattern = false;
    if (deltaYValues.length >= 2 && allIntegerDeltas) {
      const uniqueValues = [...new Set(deltaYValues)];
      if (uniqueValues.length <= 2) {
        hasMouseWheelPattern = true; // Repeated values
      } else {
        // Check for simple ratios (1.5x, 2x, 3x, etc.)
        const ratios = [];
        for (let i = 1; i < deltaYValues.length; i++) {
          if (deltaYValues[i - 1] > 0 && deltaYValues[i] > 0) {
            ratios.push(deltaYValues[i] / deltaYValues[i - 1]);
          }
        }
        const simpleRatios = [0.25, 0.5, 0.67, 1.0, 1.5, 2.0, 3.0, 4.0];
        hasMouseWheelPattern = ratios.some(ratio =>
          simpleRatios.some(simple => Math.abs(ratio - simple) < 0.1)
        );
      }
    }

    // 5. Event frequency and inertia profile
    const timestamps = recentDeltas.map(d => d.timestamp);
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(Math.max(0, timestamps[i - 1] - timestamps[i]));
    }
    const avgInterval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    const isHighFrequency = avgInterval > 0 && avgInterval <= 20; // ~50 Hz or faster → trackpad-like

    // Inertial decaying pattern: magnitudes generally decreasing over recent samples
    let isDecaying = false;
    if (deltaYValues.length >= 4) {
      let decays = 0;
      for (let i = 1; i < Math.min(deltaYValues.length, 5); i++) {
        if (deltaYValues[i] <= deltaYValues[i - 1] * 1.05) decays++;
      }
      isDecaying = decays >= 2;
    }

    // Strong early signals based on browser-level fields
    // 1) If deltamode is lines/pages, it's a mouse wheel
    if (deltaMode === 1 || deltaMode === 2) {
      return 'mouse_wheel';
    }
    // 2) Heuristic from StackOverflow: wheelDeltaY vs deltaY relationship and 120-step multiples
    // Use as a bias signal, not an absolute decision
    let biasMouseWheel = false;
    if (typeof wheelDeltaY === 'number' && wheelDeltaY !== 0) {
      const absWheel = Math.abs(wheelDeltaY);
      // Exact relation often seen on trackpads: wheelDeltaY === rawDeltaY * -3 (browser dependent)
      if (rawDeltaY && wheelDeltaY === rawDeltaY * -3) {
        // Strong bias toward trackpad
        biasMouseWheel = false;
      } else if (absWheel >= 120 && absWheel % 120 === 0) {
        // Typical mouse wheels report multiples of 120 per notch
        biasMouseWheel = true;
      }
    }

    // Decision logic (prioritized)
    if (hasHorizontalMovement && !hasLargeDeltas) {
      return 'trackpad'; // Strong indicator: 2D scrolling with small deltas
    }

    if (hasFractionalDeltas && hasSmallDeltas) {
      return 'trackpad'; // Strong indicator: fractional + small values
    }

    // On Mac, small or fractional deltas + high frequency or horizontal drift → trackpad
    if (isMac && (hasSmallDeltas || hasFractionalDeltas) && (isHighFrequency || hasHorizontalMovement) && !hasMouseWheelPattern) {
      return 'trackpad';
    }

    // Inertial flick: require large deltas, pixel mode, decaying series, AND either fractional deltas or horizontal drift
    if (isMac && hasLargeDeltas && isDecaying && !hasMouseWheelPattern && deltaMode === 0 && (hasFractionalDeltas || hasHorizontalMovement)) {
      return 'trackpad_inertia';
    }

    if ((hasMouseWheelPattern && hasLargeDeltas && allIntegerDeltas) || biasMouseWheel) {
      return 'mouse'; // Strong indicator or bias toward discrete wheel
    }

    // Additional bias: integer-only deltas with negligible horizontal drift → mouse
    if (allIntegerDeltas && !hasHorizontalMovement) {
      return 'mouse';
    }

    if (hasSmallDeltas && hasVariedDeltas && !allIntegerDeltas) {
      return 'trackpad'; // Moderate indicator: varied small fractional values
    }

    if (hasLargeDeltas && allIntegerDeltas) {
      return 'mouse'; // Moderate indicator: large integer values
    }

    return 'undetermined';
  };

  const handleWheel = async (e) => {
    // #region agent log
    debugLogSync('NodeCanvas.jsx:handleWheel', 'handleWheel START', { deltaY: e.deltaY?.toFixed?.(2), ctrlKey: e.ctrlKey }, 'debug-session', 'C');
    // #endregion
    // If a gesture/pinch is active, ignore wheel to prevent double-handling on Safari
    if (pinchRef.current.active) {
      return;
    }
    // Allow browser-level pinch zoom when enabled (e.g., Chrome trackpad magnifier)
    if (trackpadZoomEnabled && (e.ctrlKey || e.metaKey)) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Maintain a lock per continuous stream of wheel events
    const nowTs = performance.now();
    if (nowTs - (wheelStreamRef.current.lastTimestamp || 0) > WHEEL_STREAM_GAP_MS) {
      wheelStreamRef.current.lockedType = null;
      wheelStreamRef.current.mouseEvidence = 0;
      wheelStreamRef.current.trackpadEvidence = 0;
      wheelStreamRef.current.candidate = { type: null, count: 0 };
      // Reset history between streams to avoid cross-gesture contamination
      deltaHistoryRef.current = [];
    }
    wheelStreamRef.current.lastTimestamp = nowTs;

    let deltaY = e.deltaY;
    if (e.deltaMode === 1) { deltaY *= 33; }
    else if (e.deltaMode === 2) { deltaY *= window.innerHeight; }
    let deltaX = e.deltaX;
    if (e.deltaMode === 1) { deltaX *= 33; }
    else if (e.deltaMode === 2) { deltaX *= window.innerWidth; }

    // Analyze input device type
    const candidateType = analyzeInputDevice(deltaX, deltaY, e.deltaMode, e.wheelDeltaY ?? 0, e.deltaY ?? 0);
    // Lethargy check: returns 1/-1 for intentional wheel, false for inertial flick/nuance
    let lethargySense = null;
    try { lethargySense = lethargyRef.current?.check(e); } catch { }
    // Per-stream lock: only consider Lethargy for mouse wheel when there is negligible horizontal motion
    if (!wheelStreamRef.current.lockedType && (lethargySense === 1 || lethargySense === -1) && Math.abs(deltaX) < 0.15) {
      wheelStreamRef.current.lockedType = 'mouse_wheel';
    }

    // Evidence-based locking to stabilize fast wheel bursts
    const absWheel = Math.abs(e.wheelDeltaY || 0);
    if (absWheel >= 120 && absWheel % 120 === 0 && Math.abs(deltaX) < 0.05) {
      wheelStreamRef.current.mouseEvidence = (wheelStreamRef.current.mouseEvidence || 0) + 1;
    }
    if (Math.abs(deltaX) < 0.03) {
      wheelStreamRef.current.mouseEvidence = (wheelStreamRef.current.mouseEvidence || 0) + 1;
    }
    const fractionalPresent = ((Math.abs(e.deltaY) % 1) !== 0) || ((Math.abs(e.deltaX) % 1) !== 0);
    const hasHorizontalDriftStrong = Math.abs(deltaX) > 0.2;
    const hasHorizontalDriftMild = Math.abs(deltaX) > 0.08;
    if (!e.ctrlKey && e.deltaMode === 0 && (hasHorizontalDriftStrong || (fractionalPresent && hasHorizontalDriftMild))) {
      wheelStreamRef.current.trackpadEvidence = (wheelStreamRef.current.trackpadEvidence || 0) + 1;
    }
    if (!wheelStreamRef.current.lockedType) {
      if ((wheelStreamRef.current.mouseEvidence || 0) >= 2) {
        wheelStreamRef.current.lockedType = 'mouse_wheel';
      } else if ((wheelStreamRef.current.trackpadEvidence || 0) >= 2) {
        wheelStreamRef.current.lockedType = 'trackpad';
      }
    }
    // Otherwise, require two consistent samples before locking
    if (!wheelStreamRef.current.lockedType) {
      wheelStreamRef.current.candidate = wheelStreamRef.current.candidate || { type: null, count: 0 };
      const normType = (candidateType === 'mouse' || candidateType === 'mouse_wheel' || e.deltaMode === 1 || e.deltaMode === 2) ? 'mouse_wheel'
        : (candidateType === 'trackpad' || candidateType === 'trackpad_inertia') ? 'trackpad'
          : 'undetermined';
      if (normType !== 'undetermined') {
        if (wheelStreamRef.current.candidate.type === normType) {
          wheelStreamRef.current.candidate.count += 1;
        } else {
          wheelStreamRef.current.candidate.type = normType;
          wheelStreamRef.current.candidate.count = 1;
        }
        if (wheelStreamRef.current.candidate.count >= 2) {
          wheelStreamRef.current.lockedType = wheelStreamRef.current.candidate.type;
        }
      }
    }
    let deviceType = wheelStreamRef.current.lockedType || candidateType;
    // Strong pan override: pixel-mode, no ctrl/meta, require meaningful horizontal drift
    if (!e.ctrlKey && e.deltaMode === 0 && (hasHorizontalDriftStrong || (fractionalPresent && hasHorizontalDriftMild))) {
      deviceType = 'trackpad';
      if (!wheelStreamRef.current.lockedType) wheelStreamRef.current.lockedType = 'trackpad';
    }

    // Post-zoom cooldown bias: shortly after zoom, tiny pixel-mode deltas skew to pan unless strong mouse evidence
    const withinZoomCooldown = (nowTs - (lastZoomTsRef.current || 0)) < POST_ZOOM_COOLDOWN_MS;
    const strongMouseEvidence = (lethargySense === 1 || lethargySense === -1) || ((Math.abs(e.wheelDeltaY || 0) >= 120) && (Math.abs(e.wheelDeltaY || 0) % 120 === 0));
    if (!e.ctrlKey && e.deltaMode === 0 && withinZoomCooldown && Math.abs(deltaY) <= SMALL_PIXEL_DELTA_Y && Math.abs(deltaX) < 0.15 && !strongMouseEvidence) {
      deviceType = 'trackpad';
      wheelStreamRef.current.trackpadEvidence = (wheelStreamRef.current.trackpadEvidence || 0) + 1;
      if (!wheelStreamRef.current.lockedType && wheelStreamRef.current.trackpadEvidence >= 2) {
        wheelStreamRef.current.lockedType = 'trackpad';
      }
    }

    // setDebugData call removed - debug mode disabled

    // 1. Mac Pinch-to-Zoom (Ctrl key pressed) - always zoom regardless of device
    // Skip webworker zoom during drag to prevent interference with drag zoom-out animation
    if (isMac && e.ctrlKey && !trackpadZoomEnabled) {
      // Don't interfere with drag zoom-out animation
      if (draggingNodeInfo || isAnimatingZoom) {
        return;
      }
      e.stopPropagation();
      isPanningOrZooming.current = true;
      const zoomDelta = deltaY * TRACKPAD_ZOOM_SENSITIVITY;
      const currentZoomForWorker = zoomLevel;
      const currentPanOffsetForWorker = panOffset;
      const opId = ++zoomOpIdRef.current;
      try {
        const result = await canvasWorker.calculateZoom({
          deltaY: zoomDelta,
          currentZoom: currentZoomForWorker,
          mousePos: { x: mouseX, y: mouseY },
          panOffset: currentPanOffsetForWorker,
          viewportSize, canvasSize, MIN_ZOOM, MAX_ZOOM,
        });
        if (opId === zoomOpIdRef.current) {
          setPanOffset(result.panOffset);
          setZoomLevel(result.zoomLevel);
        }
        // setDebugData call removed - debug mode disabled
        // Clear the flag after a delay
        setTimeout(() => {
          if (opId === zoomOpIdRef.current) {
            isPanningOrZooming.current = false;
            panSourceRef.current = null;
          }
        }, 100);
      } catch (error) {

        // setDebugData call removed - debug mode disabled
        isPanningOrZooming.current = false;
        panSourceRef.current = null;
      }
      return; // Processed
    }

    // If the carousel is visible, block all other wheel events from this point on
    if (abstractionCarouselVisible) return;

    // 2. Trackpad Two-Finger Pan (based on device detection)
    if (deviceType === 'trackpad' || deviceType === 'trackpad_inertia' || (deviceType === 'undetermined' && isMac && (Math.abs(deltaX) > 0.05 || (Math.abs(deltaY) < 30 && Math.abs(deltaX) > 0)))) {
      e.stopPropagation();
      isPanningOrZooming.current = true;
      panSourceRef.current = deviceType === 'trackpad_inertia' ? 'trackpad' : 'trackpad';
      const dx = -deltaX * PAN_DRAG_SENSITIVITY;
      const dy = -deltaY * PAN_DRAG_SENSITIVITY;

      const currentCanvasWidth = canvasSize.width * zoomLevel;
      const currentCanvasHeight = canvasSize.height * zoomLevel;
      const minX = viewportSize.width - currentCanvasWidth;
      const minY = viewportSize.height - currentCanvasHeight;
      const maxX = 0;
      const maxY = 0;

      setPanOffset((prev) => {
        const newX = Math.min(Math.max(prev.x + dx, minX), maxX);
        const newY = Math.min(Math.max(prev.y + dy, minY), maxY);
        // setDebugData call removed - debug mode disabled
        return { x: newX, y: newY };
      });
      // Clear the flag after a delay
      setTimeout(() => {
        isPanningOrZooming.current = false;
        panSourceRef.current = null;
      }, 100);
      return; // Processed
    }

    // 3. Mouse Wheel Zoom (based on device detection or fallback)
    // Skip webworker zoom during drag to prevent interference with drag zoom-out animation
    if (deviceType === 'mouse' || deviceType === 'mouse_wheel' || (deviceType === 'undetermined' && deltaY !== 0 && Math.abs(deltaX) < 0.15)) {
      // Don't interfere with drag zoom-out animation
      if (draggingNodeInfo || isAnimatingZoom) {
        return;
      }
      e.stopPropagation();
      isPanningOrZooming.current = true;
      const zoomDelta = deltaY * SMOOTH_MOUSE_WHEEL_ZOOM_SENSITIVITY;
      const currentZoomForWorker = zoomLevel;
      const currentPanOffsetForWorker = panOffset;
      const opId = ++zoomOpIdRef.current;
      try {
        const result = await canvasWorker.calculateZoom({
          deltaY: zoomDelta,
          currentZoom: currentZoomForWorker,
          mousePos: { x: mouseX, y: mouseY },
          panOffset: currentPanOffsetForWorker,
          viewportSize, canvasSize, MIN_ZOOM, MAX_ZOOM,
        });
        // Drop stale results (older ops) to avoid "ghost frames"
        if (opId === zoomOpIdRef.current) {
          setPanOffset(result.panOffset);
          setZoomLevel(result.zoomLevel);
          lastZoomTsRef.current = nowTs;
        }
        // setDebugData call removed - debug mode disabled
        // Clear the flag after a delay
        setTimeout(() => {
          if (opId === zoomOpIdRef.current) {
            isPanningOrZooming.current = false;
            panSourceRef.current = null;
          }
        }, 100);
      } catch (error) {

        // setDebugData call removed - debug mode disabled
        isPanningOrZooming.current = false;
        panSourceRef.current = null;
      }
      return; // Processed
    }

    // 4. Fallback for truly unhandled events
    if (deltaY !== 0 || deltaX !== 0) {
      // setDebugData call removed - debug mode disabled
      // 
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      const preventDefaultWheel = (e) => {
        // Allow wheel events over panel tab bars
        const isOverPanelTabBar = e.target.closest('[data-panel-tabs="true"]');
        if (trackpadZoomEnabled) {
          return; // don't block wheel; let browser handle pinch-zoom if applicable
        }
        if (!isOverPanelTabBar) {
          e.preventDefault();
        }
      };
      container.addEventListener('wheel', preventDefaultWheel, { passive: false });
      return () => container.removeEventListener('wheel', preventDefaultWheel);
    }
  }, [trackpadZoomEnabled]);

  // Handle Safari gesture events (macOS trackpad pinch) for canvas zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let gestureAnchor = { x: 0, y: 0 };
    let gestureStartZoom = zoomLevel;
    let gestureActive = false;

    const onGestureStart = (e) => {
      if (trackpadZoomEnabled) return; // allow browser zoom if explicitly enabled
      if (!e || typeof e.scale !== 'number') return;
      try { e.preventDefault(); e.stopPropagation(); } catch { }
      const rect = container.getBoundingClientRect();
      const fallbackX = rect.left + rect.width / 2;
      const fallbackY = rect.top + rect.height / 2;
      const clientX = (typeof e.clientX === 'number') ? e.clientX : (lastMousePosRef.current?.x ?? fallbackX);
      const clientY = (typeof e.clientY === 'number') ? e.clientY : (lastMousePosRef.current?.y ?? fallbackY);
      gestureAnchor = { x: clientX, y: clientY };
      gestureStartZoom = zoomLevel;
      pinchRef.current.active = true;
      pinchRef.current.centerClient = { x: clientX, y: clientY };
      isPanningOrZooming.current = true;
      gestureActive = true;
    };

    const onGestureChange = (e) => {
      if (trackpadZoomEnabled) return; // allow browser zoom if explicitly enabled
      if (!e || typeof e.scale !== 'number') return;
      // Skip gesture zoom during drag to prevent interference with drag zoom animation
      if (draggingNodeInfoRef.current || isAnimatingZoomRef.current) return;
      try { e.preventDefault(); e.stopPropagation(); } catch { }
      const rect = container.getBoundingClientRect();
      const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gestureStartZoom * e.scale));
      const anchorX = gestureAnchor.x;
      const anchorY = gestureAnchor.y;
      setZoomLevel(prevZoom => {
        const easedZoom = prevZoom + (targetZoom - prevZoom) * 0.35;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, easedZoom));
        const zoomRatio = newZoom / prevZoom;
        setPanOffset(prevPan => ({
          x: anchorX - rect.left - (anchorX - rect.left - prevPan.x) * zoomRatio,
          y: anchorY - rect.top - (anchorY - rect.top - prevPan.y) * zoomRatio
        }));
        return newZoom;
      });
    };

    const onGestureEnd = () => {
      if (pinchRef.current.active) {
        pinchRef.current.active = false;
      }
      isPanningOrZooming.current = false;
      gestureActive = false;
    };

    container.addEventListener('gesturestart', onGestureStart, { passive: false });
    container.addEventListener('gesturechange', onGestureChange, { passive: false });
    container.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      container.removeEventListener('gesturestart', onGestureStart);
      container.removeEventListener('gesturechange', onGestureChange);
      container.removeEventListener('gestureend', onGestureEnd);
    };
  }, [zoomLevel, panOffset, MIN_ZOOM, MAX_ZOOM, trackpadZoomEnabled]);

  // Prevent native long-press context menu on touch devices (iOS/Android)
  useEffect(() => {
    const likelyTouch = () => (typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0))
      || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const preventContextMenu = (e) => {
      if (isTouchDeviceRef.current || likelyTouch()) {
        try { e.preventDefault(); } catch { }
      }
    };
    document.addEventListener('contextmenu', preventContextMenu, { passive: false });
    return () => document.removeEventListener('contextmenu', preventContextMenu);
  }, []);

  // --- Clean routing helpers (orthogonal, low-bend path with simple detours) ---
  // Inflate a rectangle by padding
  const inflateRect = (rect, pad) => ({
    minX: rect.minX - pad,
    minY: rect.minY - pad,
    maxX: rect.maxX + pad,
    maxY: rect.maxY + pad,
  });

  // Check if a single segment intersects any rect (using existing lineIntersectsRect)
  const segmentIntersectsAnyRect = (x1, y1, x2, y2, rects) => {
    for (let i = 0; i < rects.length; i++) {
      if (lineIntersectsRect(x1, y1, x2, y2, rects[i])) return true;
    }
    return false;
  };

  // Build a rounded SVG path from ordered polyline points
  const buildRoundedPathFromPoints = (pts, r = 8) => {
    if (!pts || pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      // For first and last segments, just draw straight line; corners handled via quadratic joins
      if (i < pts.length - 1) {
        const next = pts[i + 1];
        // Determine the approach point before the corner and the exit point after the corner
        // Move back from curr by radius along prev->curr, and forward from curr by radius along curr->next
        const dx1 = curr.x - prev.x;
        const dy1 = curr.y - prev.y;
        const dx2 = next.x - curr.x;
        const dy2 = next.y - curr.y;
        const backX = curr.x - Math.sign(dx1) * r;
        const backY = curr.y - Math.sign(dy1) * r;
        const fwdX = curr.x + Math.sign(dx2) * r;
        const fwdY = curr.y + Math.sign(dy2) * r;
        d += ` L ${backX},${backY} Q ${curr.x},${curr.y} ${fwdX},${fwdY}`;
      } else {
        d += ` L ${curr.x},${curr.y}`;
      }
    }
    return d;
  };

  // --- Edge label placement helpers ---
  // Estimate text width heuristically for label fit checks
  const estimateTextWidth = (text, fontSize = 24) => {
    // Rough average width per character ~0.55 * fontSize for typical sans fonts
    const avgCharWidth = fontSize * 0.55;
    return Math.max(16, text.length * avgCharWidth);
  };

  // Build inflated obstacle rects from visible nodes to avoid placing labels over nodes
  const getVisibleObstacleRects = (pad = 18) => {
    const rects = [];
    for (const node of nodes) {
      if (!visibleNodeIds.has(node.id)) continue;
      const dims = baseDimsById.get(node.id);
      if (!dims) continue;
      const rect = {
        minX: node.x,
        minY: node.y,
        maxX: node.x + dims.currentWidth,
        maxY: node.y + dims.currentHeight,
      };
      rects.push(inflateRect(rect, pad));
    }
    return rects;
  };

  // Compute distance from a point to a rect (outside-only, 0 if inside)
  const pointToRectDistance = (x, y, rect) => {
    const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
    const dy = Math.max(rect.minY - y, 0, y - rect.maxY);
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Check if axis-aligned label rect intersects any obstacle rect
  const rectIntersectsAny = (rect, obstacles) => {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const sep = rect.maxX < o.minX || rect.minX > o.maxX || rect.maxY < o.minY || rect.minY > o.maxY;
      if (!sep) return true;
    }
    return false;
  };

  // Global label registry to track placed labels and avoid overlaps
  const placedLabelsRef = useRef(new Map()); // edgeId -> { rect, position }
  labelCacheResetRef.current = () => {
    placedLabelsRef.current = new Map();
  };
  const clearLabelsTimeoutRef = useRef(null);
  const stabilizeLabelPosition = useCallback((edgeId, x, y, angle = 0) => {
    // Stabilize by quantizing to screen pixels and applying a deadband
    // Convert canvas coords to screen space, snap to integer, convert back
    const snappedX = Math.round(x * zoomLevel) / zoomLevel;
    const snappedY = Math.round(y * zoomLevel) / zoomLevel;
    const prev = placedLabelsRef.current.get(edgeId)?.position;
    if (prev) {
      const dx = Math.abs(snappedX - prev.x) * zoomLevel;
      const dy = Math.abs(snappedY - prev.y) * zoomLevel;

      // Disable deadband during node dragging for smooth updates
      // Use smaller deadband for grid mode to handle quantized movements
      let deadbandThreshold = 1; // Default 1px
      if (draggingNodeInfo) {
        deadbandThreshold = 0; // No deadband during dragging
      } else if (gridMode !== 'off') {
        deadbandThreshold = 0.5; // Smaller deadband for grid mode
      }

      if (dx <= deadbandThreshold && dy <= deadbandThreshold) {
        return { x: prev.x, y: prev.y, angle: prev.angle ?? angle };
      }
    }
    return { x: snappedX, y: snappedY, angle };
  }, [zoomLevel, draggingNodeInfo, gridMode]);
  // Clear placed labels when visible edges change (debounced during pan/zoom)
  useEffect(() => {
    if (clearLabelsTimeoutRef.current) {
      clearTimeout(clearLabelsTimeoutRef.current);
    }

    // Distinguish between canvas panning/zooming and node dragging
    const isCanvasPanningOrZooming = isPanningOrZooming.current && !draggingNodeInfo;

    if (isCanvasPanningOrZooming) {
      // Much longer debounce during canvas pan/zoom to prevent flicker
      clearLabelsTimeoutRef.current = setTimeout(() => {
        if (!isPanningOrZooming.current) {
          placedLabelsRef.current = new Map();
        }
      }, 750); // Increased to 750ms for even more stability
    } else {
      // Clear immediately if we're not in a canvas pan/zoom operation
      // This includes node dragging, where we want immediate label updates
      placedLabelsRef.current = new Map();
    }
    return () => {
      if (clearLabelsTimeoutRef.current) {
        clearTimeout(clearLabelsTimeoutRef.current);
      }
    };
  }, [visibleEdges, draggingNodeInfo]);

  // Clear labels immediately when nodes are being dragged to ensure labels move with connections
  useEffect(() => {
    if (draggingNodeInfo) {
      // Clear label cache when dragging starts to allow labels to recalculate
      placedLabelsRef.current = new Map();
    }
  }, [draggingNodeInfo]);

  // Additional effect to clear labels on every frame during dragging for grid mode
  useEffect(() => {
    if (draggingNodeInfo && gridMode !== 'off') {
      // For grid mode, clear labels more frequently to handle quantized movements
      const clearLabelsForGrid = () => {
        if (draggingNodeInfo) {
          placedLabelsRef.current = new Map();
          requestAnimationFrame(clearLabelsForGrid);
        }
      };
      requestAnimationFrame(clearLabelsForGrid);
    }
  }, [draggingNodeInfo, gridMode]);

  // Clear labels when mouse moves significantly to ensure labels follow connections
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const clearLabelsOnMouseMove = useCallback((e) => {
    const currentPos = { x: e.clientX, y: e.clientY };
    const lastPos = lastMousePosRef.current;
    const distance = Math.hypot(currentPos.x - lastPos.x, currentPos.y - lastPos.y);

    // Reduce threshold for grid mode to ensure smooth updates with quantized movements
    const threshold = gridMode !== 'off' ? 3 : 10;

    // If mouse moved more than threshold, clear label cache to allow recalculation
    if (distance > threshold) {
      placedLabelsRef.current = new Map();
      lastMousePosRef.current = currentPos;
    }
  }, [gridMode]);

  // Advanced label placement system with stacking and side placement
  const chooseLabelPlacement = (pathPoints, connectionName, fontSize = 24, edgeId = null) => {
    const obstacles = getVisibleObstacleRects(18);
    const textWidth = estimateTextWidth(connectionName, fontSize);
    const textHeight = fontSize * 1;

    // Add existing labels as obstacles
    const allObstacles = [...obstacles];
    if (placedLabelsRef.current.size > 0) {
      placedLabelsRef.current.forEach((labelData, id) => {
        if (id !== edgeId) { // Don't avoid our own label
          allObstacles.push(labelData.rect);
        }
      });
    }

    // Strategy 1: Try to place on the path itself
    const pathPlacement = tryPathPlacement(pathPoints, textWidth, textHeight, allObstacles);
    if (pathPlacement) return pathPlacement;

    // Strategy 2: Try parallel placement alongside the path
    const parallelPlacement = tryParallelPlacement(pathPoints, textWidth, textHeight, allObstacles);
    if (parallelPlacement) return parallelPlacement;

    // Strategy 3: Try perpendicular placement at midpoint
    const perpendicularPlacement = tryPerpendicularPlacement(pathPoints, textWidth, textHeight, allObstacles);
    if (perpendicularPlacement) return perpendicularPlacement;

    // Strategy 4: Try stacking with similar direction labels
    const stackedPlacement = tryStackedPlacement(pathPoints, textWidth, textHeight, allObstacles, edgeId);
    if (stackedPlacement) return stackedPlacement;

    // Fallback: midpoint with best available offset
    return getFallbackPlacement(pathPoints, textWidth, textHeight, allObstacles);
  };
  // Try to place label directly on the path (horizontal segments preferred)
  const tryPathPlacement = (pathPoints, textWidth, textHeight, obstacles) => {
    const candidates = [];
    const minSegmentLength = Math.max(64, textWidth + 24);

    for (let i = 0; i < pathPoints.length - 1; i++) {
      const a = pathPoints[i];
      const b = pathPoints[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy);

      if (segLen < minSegmentLength) continue;

      const isHorizontal = Math.abs(dy) < 0.5;
      const isVertical = Math.abs(dx) < 0.5;

      // Prefer horizontal, then vertical, then diagonal
      let priority = 0;
      let angle = 0;
      if (isHorizontal) {
        priority = 3;
        angle = 0;
      } else if (isVertical) {
        priority = 2;
        angle = 90;
      } else {
        priority = 1;
        angle = Math.atan2(dy, dx) * (180 / Math.PI);
      }

      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;

      // Try small offsets perpendicular to the segment
      const perpX = -dy / segLen; // perpendicular unit vector
      const perpY = dx / segLen;

      const offsets = [0, 12, -12, 24, -24];
      for (const offset of offsets) {
        const testX = cx + perpX * offset;
        const testY = cy + perpY * offset;

        const rect = {
          minX: testX - textWidth / 2,
          maxX: testX + textWidth / 2,
          minY: testY - textHeight / 2,
          maxY: testY + textHeight / 2,
        };

        if (!rectIntersectsAny(rect, obstacles)) {
          const score = priority * 100 + segLen - Math.abs(offset);
          candidates.push({ x: testX, y: testY, angle, score });
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0];
    }

    return null;
  };
  // Try to place label parallel to the overall path direction, offset to the side
  const tryParallelPlacement = (pathPoints, textWidth, textHeight, obstacles) => {
    if (pathPoints.length < 2) return null;

    const start = pathPoints[0];
    const end = pathPoints[pathPoints.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    if (length < 10) return null;

    const dirX = dx / length;
    const dirY = dy / length;
    const perpX = -dirY; // perpendicular
    const perpY = dirX;

    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    // Try different parallel offsets
    const offsets = [40, -40, 60, -60, 80, -80];
    for (const offset of offsets) {
      const testX = midX + perpX * offset;
      const testY = midY + perpY * offset;

      const rect = {
        minX: testX - textWidth / 2,
        maxX: testX + textWidth / 2,
        minY: testY - textHeight / 2,
        maxY: testY + textHeight / 2,
      };

      if (!rectIntersectsAny(rect, obstacles)) {
        return { x: testX, y: testY, angle, score: 50 - Math.abs(offset) * 0.1 };
      }
    }

    return null;
  };
  // Try perpendicular placement (good for short connections)
  const tryPerpendicularPlacement = (pathPoints, textWidth, textHeight, obstacles) => {
    if (pathPoints.length < 2) return null;

    const start = pathPoints[0];
    const end = pathPoints[pathPoints.length - 1];
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    // Try horizontal placement above/below the midpoint
    const offsets = [30, -30, 50, -50, 70, -70];
    for (const offset of offsets) {
      const testX = midX;
      const testY = midY + offset;

      const rect = {
        minX: testX - textWidth / 2,
        maxX: testX + textWidth / 2,
        minY: testY - textHeight / 2,
        maxY: testY + textHeight / 2,
      };

      if (!rectIntersectsAny(rect, obstacles)) {
        return { x: testX, y: testY, angle: 0, score: 30 - Math.abs(offset) * 0.1 };
      }
    }

    return null;
  };

  // Try stacking with labels that have similar direction/axis
  const tryStackedPlacement = (pathPoints, textWidth, textHeight, obstacles, edgeId) => {
    if (pathPoints.length < 2 || placedLabelsRef.current.size === 0) return null;

    const start = pathPoints[0];
    const end = pathPoints[pathPoints.length - 1];
    const pathAngle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
    const normalizedAngle = ((pathAngle % 180) + 180) % 180; // 0-180 range

    // Find labels with similar direction (within 15 degrees)
    const similarLabels = [];
    placedLabelsRef.current.forEach((labelData, id) => {
      if (id === edgeId) return;
      const labelAngle = labelData.position.angle || 0;
      const normalizedLabelAngle = ((labelAngle % 180) + 180) % 180;
      const angleDiff = Math.min(
        Math.abs(normalizedAngle - normalizedLabelAngle),
        180 - Math.abs(normalizedAngle - normalizedLabelAngle)
      );

      if (angleDiff < 15) { // Similar direction
        similarLabels.push(labelData);
      }
    });

    if (similarLabels.length === 0) return null;

    // Try stacking near similar labels
    for (const similarLabel of similarLabels) {
      const stackOffsets = [
        { x: 0, y: textHeight + 8 },    // Stack below
        { x: 0, y: -(textHeight + 8) }, // Stack above
        { x: textWidth + 12, y: 0 },    // Stack right
        { x: -(textWidth + 12), y: 0 }  // Stack left
      ];

      for (const offset of stackOffsets) {
        const testX = similarLabel.position.x + offset.x;
        const testY = similarLabel.position.y + offset.y;

        const rect = {
          minX: testX - textWidth / 2,
          maxX: testX + textWidth / 2,
          minY: testY - textHeight / 2,
          maxY: testY + textHeight / 2,
        };

        if (!rectIntersectsAny(rect, obstacles)) {
          return {
            x: testX,
            y: testY,
            angle: similarLabel.position.angle || 0,
            score: 40 - Math.abs(offset.x) * 0.05 - Math.abs(offset.y) * 0.05
          };
        }
      }
    }

    return null;
  };

  // Fallback placement at path midpoint with best available offset
  const getFallbackPlacement = (pathPoints, textWidth, textHeight, obstacles) => {
    let totalLen = 0;
    const lens = [];
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const a = pathPoints[i];
      const b = pathPoints[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      lens.push(len);
      totalLen += len;
    }

    let t = totalLen / 2;
    let x = pathPoints[0]?.x || 0;
    let y = pathPoints[0]?.y || 0;
    for (let i = 0; i < pathPoints.length - 1; i++) {
      if (t <= lens[i]) {
        const a = pathPoints[i];
        const b = pathPoints[i + 1];
        const u = lens[i] === 0 ? 0 : t / lens[i];
        x = a.x + (b.x - a.x) * u;
        y = a.y + (b.y - a.y) * u;
        break;
      } else {
        t -= lens[i];
      }
    }

    // Try various offsets to find the least problematic placement
    const offsets = [
      { x: 0, y: 0 }, { x: 0, y: -20 }, { x: 0, y: 20 },
      { x: -30, y: 0 }, { x: 30, y: 0 },
      { x: -25, y: -15 }, { x: 25, y: -15 },
      { x: -25, y: 15 }, { x: 25, y: 15 }
    ];

    for (const offset of offsets) {
      const testX = x + offset.x;
      const testY = y + offset.y;
      const rect = {
        minX: testX - textWidth / 2,
        maxX: testX + textWidth / 2,
        minY: testY - textHeight / 2,
        maxY: testY + textHeight / 2,
      };

      if (!rectIntersectsAny(rect, obstacles)) {
        return { x: testX, y: testY, angle: 0, score: 0 };
      }
    }

    // Ultimate fallback - just place it at midpoint
    return { x, y, angle: 0, score: 0 };
  };
  // Orthogonal routing with smart stem usage - use stems only when needed



  // Deterministic tiny lane offset to reduce parallel overlaps for clean routing
  const hashString = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  };
  // --- Mouse Drag Panning (unchanged) ---
  // Throttle edge-hover detection to reduce per-frame work
  const lastHoverCheckRef = useRef(0);
  const HOVER_CHECK_INTERVAL_MS = 24; // ~40 Hz

  // RAF-based drag position updates for smooth rendering at display refresh rate
  const pendingDragUpdate = useRef(null);
  const dragUpdateScheduled = useRef(false);

  // RAF-based connection drawing updates
  const pendingConnectionUpdate = useRef(null);
  const connectionUpdateScheduled = useRef(false);

  // RAF-based label clearing updates
  const pendingLabelClear = useRef(null);
  const labelClearScheduled = useRef(false);

  // RAF-based pan updates
  const pendingPanUpdate = useRef(null);
  const panUpdateScheduled = useRef(false);

  const handleMouseMove = async (e) => {
    // Update mouse position for edge panning
    mousePositionRef.current = { x: e.clientX, y: e.clientY };

    if (isPaused || !activeGraphId) return;

    // Avoid per-frame logging during drag; logs removed for performance

    // Schedule RAF-throttled label clearing only when not dragging or panning
    if (!draggingNodeInfo && !isPanning && !pinchRef.current.active) {
      pendingLabelClear.current = e;
      if (!labelClearScheduled.current) {
        labelClearScheduled.current = true;
        requestAnimationFrame(() => {
          labelClearScheduled.current = false;
          if (pendingLabelClear.current) {
            clearLabelsOnMouseMove(pendingLabelClear.current);
          }
        });
      }
    }

    // Validate container and coordinates before processing
    if (!containerRef.current || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    // Track last client pointer position for Safari gesture anchoring
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    const rawX = (e.clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
    const rawY = (e.clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
    const { x: currentX, y: currentY } = clampCoordinates(rawX, rawY);

    // Edge hover detection (only when not dragging/panning)
    // PERFORMANCE: Skip all hover updates during drag to reduce per-frame work
    if (!isMouseDown.current && !draggingNodeInfo && !isPanning) {
      const now = performance.now();
      if (now - lastHoverCheckRef.current >= HOVER_CHECK_INTERVAL_MS) {
        lastHoverCheckRef.current = now;

        const hoveredNode = nodes.find(
          (node) => visibleNodeIds.has(node.id) && isInsideNode(node, e.clientX, e.clientY)
        );

        if (hoveredNode) {
          const dims = baseDimsById.get(hoveredNode.id);
          setHoveredNodeForVision({
            id: hoveredNode.id,
            name: hoveredNode.name,
            color: hoveredNode.color,
            width: dims?.currentWidth ?? NODE_WIDTH,
            height: dims?.currentHeight ?? NODE_HEIGHT,
            prototypeId: hoveredNode.prototypeId
          });
          setHoveredConnectionForVision(null);
          setHoveredEdgeInfo(null);
        } else {
          setHoveredNodeForVision(null);

          let foundHoveredEdgeInfo = null;
          let closestDistance = Infinity;

          for (let i = visibleEdges.length - 1; i >= 0; i--) {
            const edge = visibleEdges[i];
            const sourceInstance = nodeById.get(edge.sourceId);
            const targetInstance = nodeById.get(edge.destinationId);
            if (!sourceInstance || !targetInstance) continue;

            const sourceDims = baseDimsById.get(sourceInstance.id);
            const targetDims = baseDimsById.get(targetInstance.id);
            if (!sourceDims || !targetDims) continue;

            const isSourcePreviewing = previewingNodeId === sourceInstance.id;
            const isTargetPreviewing = previewingNodeId === targetInstance.id;
            const x1 = sourceInstance.x + sourceDims.currentWidth / 2;
            const y1 = sourceInstance.y + (isSourcePreviewing ? NODE_HEIGHT / 2 : sourceDims.currentHeight / 2);
            const x2 = targetInstance.x + targetDims.currentWidth / 2;
            const y2 = targetInstance.y + (isTargetPreviewing ? NODE_HEIGHT / 2 : targetDims.currentHeight / 2);

            let distance = Infinity;

            if (enableAutoRouting && routingStyle === 'clean') {
              const pathPoints = generateCleanRoutingPath(
                edge,
                sourceInstance,
                targetInstance,
                sourceDims,
                targetDims,
                cleanLaneOffsets,
                cleanLaneSpacing
              );

              let minSegmentDistance = Infinity;
              for (let j = 0; j < pathPoints.length - 1; j++) {
                const segStart = pathPoints[j];
                const segEnd = pathPoints[j + 1];

                const A = currentX - segStart.x;
                const B = currentY - segStart.y;
                const C = segEnd.x - segStart.x;
                const D = segEnd.y - segStart.y;
                const dot = A * C + B * D;
                const lenSq = C * C + D * D;

                if (lenSq > 0) {
                  let param = dot / lenSq;
                  if (param < 0) param = 0;
                  else if (param > 1) param = 1;
                  const xx = segStart.x + param * C;
                  const yy = segStart.y + param * D;
                  const dx = currentX - xx;
                  const dy = currentY - yy;
                  const segDistance = Math.sqrt(dx * dx + dy * dy);
                  minSegmentDistance = Math.min(minSegmentDistance, segDistance);
                }
              }
              distance = minSegmentDistance;
            } else if (enableAutoRouting && routingStyle === 'manhattan') {
              const pathPoints = generateManhattanRoutingPath(
                edge,
                sourceInstance,
                targetInstance,
                sourceDims,
                targetDims,
                manhattanBends
              );

              let minSegmentDistance = Infinity;
              for (let j = 0; j < pathPoints.length - 1; j++) {
                const segStart = pathPoints[j];
                const segEnd = pathPoints[j + 1];

                const A = currentX - segStart.x;
                const B = currentY - segStart.y;
                const C = segEnd.x - segStart.x;
                const D = segEnd.y - segStart.y;
                const dot = A * C + B * D;
                const lenSq = C * C + D * D;

                if (lenSq > 0) {
                  let param = dot / lenSq;
                  if (param < 0) param = 0;
                  else if (param > 1) param = 1;
                  const xx = segStart.x + param * C;
                  const yy = segStart.y + param * D;
                  const dx = currentX - xx;
                  const dy = currentY - yy;
                  const segDistance = Math.sqrt(dx * dx + dy * dy);
                  minSegmentDistance = Math.min(minSegmentDistance, segDistance);
                }
              }
              distance = minSegmentDistance;
            } else {
              const A = currentX - x1;
              const B = currentY - y1;
              const C = x2 - x1;
              const D = y2 - y1;
              const dot = A * C + B * D;
              const lenSq = C * C + D * D;
              if (lenSq > 0) {
                let param = dot / lenSq;
                if (param < 0) param = 0;
                else if (param > 1) param = 1;
                const xx = x1 + param * C;
                const yy = y1 + param * D;
                const dx = currentX - xx;
                const dy = currentY - yy;
                distance = Math.sqrt(dx * dx + dy * dy);
              }
            }

            const hoverThreshold =
              enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean') ? 50 : 40;

            if (distance <= hoverThreshold && distance < closestDistance) {
              closestDistance = distance;
              foundHoveredEdgeInfo = { edgeId: edge.id };

              let connectionName = edge.connectionName || 'Connection';
              let connectionColor = edge.color || '#000000';

              if ((!connectionName || connectionName === 'Connection') && edge.definitionNodeIds?.length) {
                const defNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
                if (defNode) {
                  connectionName = defNode.name || connectionName;
                  connectionColor = defNode.color || connectionColor;
                }
              } else if ((!edge.definitionNodeIds || edge.definitionNodeIds.length === 0) && edge.typeNodeId) {
                const typeNode = nodePrototypesMap.get(edge.typeNodeId);
                if (typeNode) {
                  connectionName = typeNode.name || connectionName;
                  connectionColor = typeNode.color || connectionColor;
                }
              }

              setHoveredConnectionForVision({
                id: edge.id,
                name: connectionName,
                color: connectionColor,
                definitionNodeIds: edge.definitionNodeIds,
                typeNodeId: edge.typeNodeId,
                source: {
                  id: sourceInstance.id,
                  name: sourceInstance.name,
                  color: sourceInstance.color,
                  width: sourceDims.currentWidth,
                  height: isSourcePreviewing ? NODE_HEIGHT : sourceDims.currentHeight,
                  prototypeId: sourceInstance.prototypeId
                },
                target: {
                  id: targetInstance.id,
                  name: targetInstance.name,
                  color: targetInstance.color,
                  width: targetDims.currentWidth,
                  height: isTargetPreviewing ? NODE_HEIGHT : targetDims.currentHeight,
                  prototypeId: targetInstance.prototypeId
                },
                directionality: edge.directionality
              });

              if (enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean')) {
                break;
              }
            }
          }

          setHoveredEdgeInfo(foundHoveredEdgeInfo);

          if (!foundHoveredEdgeInfo) {
            setHoveredConnectionForVision(null);
          }
        }
      }
    }
    // PERFORMANCE: Don't clear hover states every frame during drag
    // They're already cleared at drag start in handleMouseDown

    // Selection Box Logic (skip during node drag for performance)
    if (selectionStart && isMouseDown.current && !draggingNodeInfo) {
      e.preventDefault();
      try {
        const selectionRes = await canvasWorker.calculateSelection({ selectionStart, currentX, currentY });
        setSelectionRect(selectionRes);
        const currentIds = new Set();
        nodes.forEach(nd => {
          if (!(selectionRes.x > nd.x + getNodeDimensions(nd, previewingNodeId === nd.id, null).currentWidth ||
            selectionRes.x + selectionRes.width < nd.x ||
            selectionRes.y > nd.y + getNodeDimensions(nd, previewingNodeId === nd.id, null).currentHeight ||
            selectionRes.y + selectionRes.height < nd.y)) {
            currentIds.add(nd.id);
          }
        });
        const finalSelection = new Set([...selectionBaseRef.current]);
        nodes.forEach(nd => {
          if (!selectionBaseRef.current.has(nd.id)) {
            if (currentIds.has(nd.id)) finalSelection.add(nd.id);
            else finalSelection.delete(nd.id);
          }
        });
        setSelectedInstanceIds(finalSelection);
      } catch (error) {

      }
      return;
    }

    if (isMouseDown.current) {
      const dx = e.clientX - mouseDownPosition.current.x;
      const dy = e.clientY - mouseDownPosition.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MOVEMENT_THRESHOLD) {
        mouseMoved.current = true;
        setHasMouseMovedSinceDown(true); // Set state for useEffect
        if (clickTimeoutIdRef.current) { clearTimeout(clickTimeoutIdRef.current); clickTimeoutIdRef.current = null; potentialClickNodeRef.current = null; }
        // REMOVED: setSelectedNodeIdForPieMenu(null); 

        // Start drawing connection when dragging from a node (desktop quick-drag or long-press)
        if (longPressingInstanceId && !draggingNodeInfo && !pinchRef.current.active) {
          const longPressNodeData = nodes.find(n => n.id === longPressingInstanceId); // Get data
          if (longPressNodeData) {
            const leftNodeArea = !isInsideNode(longPressNodeData, e.clientX, e.clientY);
            // Allow both patterns:
            // 1) Move outside the node (original behavior)
            // 2) Quick drag while still inside the node (desktop-friendly)
            if (leftNodeArea || startedOnNode.current) {
              clearTimeout(longPressTimeout.current);
              mouseInsideNode.current = false;
              const startNodeDims = getNodeDimensions(longPressNodeData, previewingNodeId === longPressNodeData.id, null);
              const startPt = { x: longPressNodeData.x + startNodeDims.currentWidth / 2, y: longPressNodeData.y + startNodeDims.currentHeight / 2 };

              // Validate mouse coordinates before calculating canvas position
              if (!containerRef.current || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') {
                // If coordinates are invalid, don't start drawing connection
                setLongPressingInstanceId(null);
                return;
              }

              const rect = containerRef.current.getBoundingClientRect();
              const rawX = (e.clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
              const rawY = (e.clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;

              // Validate calculated coordinates are not NaN
              if (isNaN(rawX) || isNaN(rawY)) {
                // Only clear if NOT already dragging
                if (!draggingNodeInfo) {
                  setLongPressingInstanceId(null);
                }
                return; // Skip this frame but don't abort active drag
              }

              const { x: currentX, y: currentY } = clampCoordinates(rawX, rawY);
              setDrawingConnectionFrom({ sourceInstanceId: longPressingInstanceId, startX: startPt.x, startY: startPt.y, currentX, currentY });
              setLongPressingInstanceId(null); // Clear ID
            }
          }
        } else if (!draggingNodeInfo && !drawingConnectionFrom && !isPanning && !startedOnNode.current && !pinchRef.current.active && !panStart) {
          // Start panning after threshold exceeded (check panStart ref to avoid race condition with setState)
          isPanningOrZooming.current = true;
          setIsPanning(true);
          lastPanVelocityRef.current = { vx: 0, vy: 0 };
          lastPanSampleRef.current = { time: performance.now() };
          setPanStart({ x: e.clientX, y: e.clientY });
          panSourceRef.current = isTouchDeviceRef.current ? 'touch' : 'mouse';
          panVelocityHistoryRef.current = [{ x: e.clientX, y: e.clientY, time: performance.now() }];
          console.log('[Mouse Move] Started panning, reset history');
        }
      }
    }

    // Dragging Node or Group Logic (only after long-press has set draggingNodeInfo)
    if (draggingNodeInfo) {
      // Movement Zoom-Out: Trigger when drag actually starts moving (not on mousedown)
      // This ensures zoom-out happens after movement threshold, preventing reset during delay
      if (!zoomOutInitiatedRef.current) {
        const currentZoom = zoomLevel;
        if (currentZoom > DRAG_ZOOM_MIN) {
          zoomOutInitiatedRef.current = true;
          setPreDragZoomLevel(currentZoom);
          const targetZoom = Math.max(DRAG_ZOOM_MIN, currentZoom * DRAG_ZOOM_OUT_FACTOR);
          animateZoomToTarget(targetZoom, { clientX: e.clientX, clientY: e.clientY }, currentZoom, { ...panOffset });
        }
      }

      // Per-frame console removed for performance

      // Store latest drag coordinates (not event object which can become stale)
      pendingDragUpdate.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        draggingNodeInfo
      };

      // Schedule RAF update if not already scheduled (throttles to display refresh rate)
      if (!dragUpdateScheduled.current) {
        dragUpdateScheduled.current = true;
        requestAnimationFrame(() => {
          dragUpdateScheduled.current = false;

          // Skip if edge panning is active - panLoop handles node positioning during edge pan
          if (isEdgePanningRef.current) {
            return;
          }

          const update = pendingDragUpdate.current;
          if (!update) return;

          const { clientX, clientY, draggingNodeInfo } = update;

          // Use refs for latest values to avoid stale closure (prevents jitter during edge panning)
          const currentPan = panOffsetRef.current;
          const currentZoom = zoomLevelRef.current;

          performDragUpdate(clientX, clientY, currentPan, currentZoom, draggingNodeInfo);
        }); // Close RAF callback
      } // Close if (!dragUpdateScheduled.current)
    } else if (drawingConnectionFrom) {
      // Update connection drawing coordinates with RAF throttling
      // Validate coordinates before updating
      if (typeof currentX === 'number' && typeof currentY === 'number' && !isNaN(currentX) && !isNaN(currentY)) {
        pendingConnectionUpdate.current = { currentX, currentY };
        if (!connectionUpdateScheduled.current) {
          connectionUpdateScheduled.current = true;
          requestAnimationFrame(() => {
            connectionUpdateScheduled.current = false;
            const update = pendingConnectionUpdate.current;
            if (update) {
              setDrawingConnectionFrom(prev => prev && ({ ...prev, currentX: update.currentX, currentY: update.currentY }));
            }
          });
        }
      }
    } else if (isPanning && !pinchRef.current.active) {
      if (abstractionCarouselVisible) {
        setIsPanning(false);
        return;
      }

      // Mark that mouse has moved for tap detection
      if (!mouseMoved.current) {
        mouseMoved.current = true;
      }

      // Update velocity history synchronously to avoid race conditions
      const now = performance.now();
      const history = panVelocityHistoryRef.current;
      history.push({ x: e.clientX, y: e.clientY, time: now });
      // Keep only last 100ms
      const cutoff = now - 100;
      while (history.length > 0 && history[0].time < cutoff) {
        history.shift();
      }

      pendingPanUpdate.current = e;
      if (!panUpdateScheduled.current) {
        panUpdateScheduled.current = true;
        requestAnimationFrame(() => {
          panUpdateScheduled.current = false;
          const e = pendingPanUpdate.current;
          if (!e || !panStart?.x || !panStart?.y) return;

          const now = performance.now();
          const dt = Math.max(1, now - (lastPanSampleRef.current.time || now));
          const dragSensitivity = panSourceRef.current === 'touch' ? TOUCH_PAN_DRAG_SENSITIVITY : PAN_DRAG_SENSITIVITY;
          const dxInput = (e.clientX - panStart.x) * dragSensitivity;
          const dyInput = (e.clientY - panStart.y) * dragSensitivity;
          const maxX = 0;
          const maxY = 0;
          const minX = viewportSize.width - canvasSize.width * zoomLevel;
          const minY = viewportSize.height - canvasSize.height * zoomLevel;
          let appliedDx = 0;
          let appliedDy = 0;
          setPanOffset(prev => {
            const targetX = prev.x + dxInput;
            const targetY = prev.y + dyInput;
            const clampedX = Math.min(Math.max(targetX, minX), maxX);
            const clampedY = Math.min(Math.max(targetY, minY), maxY);
            appliedDx = clampedX - prev.x;
            appliedDy = clampedY - prev.y;
            if (appliedDx !== 0 || appliedDy !== 0) {
              setPanStart({ x: e.clientX, y: e.clientY });
            }
            return { x: clampedX, y: clampedY };
          });

          if (Math.abs(appliedDx) > 0.01 || Math.abs(appliedDy) > 0.01) {
            // Calculate instantaneous velocity for reference
            lastPanVelocityRef.current = {
              vx: appliedDx / dt,
              vy: appliedDy / dt
            };
          } else {
            lastPanVelocityRef.current = { vx: 0, vy: 0 };
          }
          lastPanSampleRef.current = { time: now };
        });
      }
    }

    // (Removed per-move extra smoothing to avoid double updates)
  };

  const handleMouseDown = (e) => {
    // Ignore right-clicks (button === 2) so context menu can handle them without locking canvas panning
    if (e && e.button === 2) {
      try { e.preventDefault(); e.stopPropagation(); } catch { }
      return;
    }
    stopPanMomentum();
    if (isPaused || !activeGraphId || abstractionCarouselVisible) return;
    // On touch/mobile: allow two-finger pan to bypass resizer/canvas checks
    if (e.touches && e.touches.length >= 2) {
      return;
    }
    // If user started on a resizer, do not start canvas panning
    if (isDraggingLeft.current || isDraggingRight.current) return;
    // Clear any pending single click on a node
    if (clickTimeoutIdRef.current) {
      clearTimeout(clickTimeoutIdRef.current);
      clickTimeoutIdRef.current = null;
      potentialClickNodeRef.current = null;
    }

    // Explicitly close Connection Panel on any canvas interaction (click, pan start, etc.)
    // This ensures that even if you drag slightly (panning), the panel closes.
    if ((connectionControlPanelVisible || connectionControlPanelShouldShow) && !isPaused) {
      setConnectionControlPanelVisible(false);
      storeActions.setSelectedEdgeId(null);
      storeActions.clearSelectedEdgeIds();
    }

    isMouseDown.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    mouseDownPosition.current = { x: e.clientX, y: e.clientY };
    startedOnNode.current = false;
    mouseMoved.current = false;
    // PERFORMANCE: Clear all hover states once at interaction start instead of every frame during drag
    setHoveredEdgeInfo(null);
    setHoveredNodeForVision(null);
    setHoveredConnectionForVision(null);
    setLastInteractionType('mouse_down');

    if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      const rect = containerRef.current.getBoundingClientRect();
      const startX = (e.clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
      const startY = (e.clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
      setSelectionStart({ x: startX, y: startY });
      setSelectionRect({ x: startX, y: startY, width: 0, height: 0 });
      selectionBaseRef.current = new Set([...selectedInstanceIds]);
      return;
    }
    setPanStart({ x: e.clientX, y: e.clientY });
    setIsPanning(true);
    lastPanVelocityRef.current = { vx: 0, vy: 0 };
    lastPanSampleRef.current = { time: performance.now() };
    panSourceRef.current = isTouchDeviceRef.current ? 'touch' : 'mouse';
    panVelocityHistoryRef.current = [{ x: e.clientX, y: e.clientY, time: performance.now() }];
    console.log('[Mouse Down] History reset to 1 sample');
  };
  const handleMouseUp = (e) => {

    // console.log('[Mouse Up] Called, history length:', panVelocityHistoryRef.current.length, 'Stack:', new Error().stack.split('\n').slice(1, 4).join('\n'));

    if (isPaused || !activeGraphId) return;
    clearTimeout(longPressTimeout.current);
    setLongPressingInstanceId(null); // Clear ID
    mouseInsideNode.current = false;

    // Finalize drawing connection - with guard against double execution from event bubbling
    if (drawingConnectionFrom && !connectionCreationInProgressRef.current) {
      connectionCreationInProgressRef.current = true; // Guard against bubbled duplicate calls
      wasDrawingConnection.current = true; // Prevent PlusSign from appearing
      const targetNodeData = nodes.find(n => isInsideNode(n, e.clientX, e.clientY));
      console.log('Connection end:', {
        clientX: e.clientX,
        clientY: e.clientY,
        targetNodeData: targetNodeData?.id,
        sourceId: drawingConnectionFrom.sourceInstanceId
      });

      if (targetNodeData && targetNodeData.id !== drawingConnectionFrom.sourceInstanceId) {
        const sourceId = drawingConnectionFrom.sourceInstanceId;
        const destId = targetNodeData.id;

        // Allow multiple parallel edges between the same nodes
        // The curve offset rendering will display them properly
        const newEdgeId = uuidv4();
        const newEdgeData = { id: newEdgeId, sourceId, destinationId: destId };
        storeActions.addEdge(activeGraphId, newEdgeData);
      }
      setDrawingConnectionFrom(null);
      // Reset guard after a short delay to allow for the next connection drawing
      setTimeout(() => { connectionCreationInProgressRef.current = false; }, 50);
    }

    // Reset scale for dragged nodes
    if (draggingNodeInfo) {
      const instanceIdsToReset = new Set();
      if (draggingNodeInfo.relativeOffsets) {
        instanceIdsToReset.add(draggingNodeInfo.primaryId);
        Object.keys(draggingNodeInfo.relativeOffsets).forEach(id => instanceIdsToReset.add(id));
      } else if (draggingNodeInfo.instanceId) {
        instanceIdsToReset.add(draggingNodeInfo.instanceId);
      }
      if (instanceIdsToReset.size === 0 && Array.isArray(draggingNodeInfo.memberOffsets) && draggingNodeInfo.memberOffsets.length > 0) {
        instanceIdsToReset.add(draggingNodeInfo.memberOffsets[0].id);
      }
      const primaryFinalizeId = draggingNodeInfo.primaryId || draggingNodeInfo.instanceId || (Array.isArray(draggingNodeInfo.memberOffsets) ? draggingNodeInfo.memberOffsets[0]?.id : null);
      let finalizeSent = false;

      // Defer finalize to avoid blocking UI during file save
      // Use setTimeout instead of RAF to ensure it happens after mouse event completes
      setTimeout(() => {
        instanceIdsToReset.forEach(id => {
          const nodeExists = nodes.some(n => n.id === id);
          if (nodeExists) {
            const shouldFinalize = primaryFinalizeId ? id === primaryFinalizeId : !finalizeSent;
            storeActions.updateNodeInstance(
              activeGraphId,
              id,
              draft => { draft.scale = 1; },
              { phase: 'end', isDragging: false, finalize: shouldFinalize }
            );
            if (shouldFinalize) finalizeSent = true;
          }
        });
      }, 0);

      // Check if node(s) were dropped onto a group
      // Don't check if dragging a group label (memberOffsets)
      if (!draggingNodeInfo.groupId && !Array.isArray(draggingNodeInfo.memberOffsets)) {
        const draggedNodeIds = [];
        if (draggingNodeInfo.relativeOffsets) {
          // Multi-node drag
          draggedNodeIds.push(draggingNodeInfo.primaryId);
          Object.keys(draggingNodeInfo.relativeOffsets).forEach(id => draggedNodeIds.push(id));
        } else if (draggingNodeInfo.instanceId) {
          // Single node drag
          draggedNodeIds.push(draggingNodeInfo.instanceId);
        }

        // Get all groups in the active graph
        const graphData = activeGraphId ? graphsMap.get(activeGraphId) : null;
        const groups = graphData?.groups ? Array.from(graphData.groups.values()) : [];

        if (draggedNodeIds.length > 0 && groups.length > 0) {
          // Find which group the primary dragged node overlaps with (if any)
          const primaryNodeId = draggingNodeInfo.primaryId || draggingNodeInfo.instanceId;
          const primaryNode = nodes.find(n => n.id === primaryNodeId);

          if (primaryNode) {
            const primaryDims = getNodeDimensions(primaryNode, false, null);
            const primaryCenterX = primaryNode.x + primaryDims.currentWidth / 2;
            const primaryCenterY = primaryNode.y + primaryDims.currentHeight / 2;

            // Check each group (topmost first - reverse order since groups are rendered back-to-front)
            let targetGroup = null;
            for (let i = groups.length - 1; i >= 0; i--) {
              const group = groups[i];
              // Skip if node is already a member
              if (group.memberInstanceIds.includes(primaryNodeId)) continue;

              // Calculate group bounds
              const members = nodes.filter(n => group.memberInstanceIds.includes(n.id));
              if (!members.length) continue;

              const memberDims = members.map(n => getNodeDimensions(n, false, null));
              const xs = members.map((n, idx) => n.x);
              const ys = members.map((n, idx) => n.y);
              const rights = members.map((n, idx) => n.x + memberDims[idx].currentWidth);
              const bottoms = members.map((n, idx) => n.y + memberDims[idx].currentHeight);

              const margin = Math.max(24, Math.round(gridSize * 0.2));
              const groupMinX = Math.min(...xs) - margin;
              const groupMinY = Math.min(...ys) - margin;
              const groupMaxX = Math.max(...rights) + margin;
              const groupMaxY = Math.max(...bottoms) + margin;

              // Check if primary node center is inside group bounds
              if (primaryCenterX >= groupMinX && primaryCenterX <= groupMaxX &&
                primaryCenterY >= groupMinY && primaryCenterY <= groupMaxY) {
                targetGroup = group;
                break; // Found topmost overlapping group
              }
            }

            if (targetGroup) {
              // Show dialog to confirm adding to group
              const isNodeGroup = !!targetGroup.linkedNodePrototypeId;
              const groupName = targetGroup.name || 'Unnamed Group';
              const entityType = isNodeGroup ? 'Thing' : 'group';

              setAddToGroupDialog({
                nodeIds: draggedNodeIds,
                groupId: targetGroup.id,
                groupName: groupName,
                isNodeGroup: isNodeGroup,
                position: { x: e.clientX, y: e.clientY }
              });
            }
          }
        }
      }

      setDraggingNodeInfo(null);

      // Track that we just finished dragging a group/node to prevent immediate clicks
      wasDraggingRef.current = true;
      setTimeout(() => {
        wasDraggingRef.current = false;
      }, 50);

      // Reset edge panning flag when drag ends
      isEdgePanningRef.current = false;

      // Movement Zoom-Out: Restore zoom level if we were dragging
      // Prevent double calls - only process if not already restoring
      if (preDragZoomLevel !== null && !restoreInProgressRef.current) {
        restoreInProgressRef.current = true;

        // Target Zoom: Always go back to the original level
        const targetZoom = preDragZoomLevel;

        // Current State
        // CRITICAL: Always use the live refs for current state to account for any edge panning that happened
        // actualZoomedOutPanRef is stale if edge panning occurred after zoom-out finished
        const currentZoom = zoomLevelRef.current;
        const currentPan = panOffsetRef.current;

        // Calculate Target Pan: Center on where the node was DROPPED (mouse position)
        // This ensures the dropped node stays visible after zooming back in
        const rect = containerRef.current.getBoundingClientRect();
        const dropX = e.clientX - rect.left;
        const dropY = e.clientY - rect.top;

        // 1. Find world coordinates of the drop point using CURRENT zoom/pan
        // worldX = (screenX - panX) / zoom + offsetX
        const dropWorldX = (dropX - currentPan.x) / currentZoom + canvasSizeRef.current.offsetX;
        const dropWorldY = (dropY - currentPan.y) / currentZoom + canvasSizeRef.current.offsetY;

        // 2. Calculate NEW pan to keep that world point at the CENTER of the viewport using TARGET zoom
        // panX = screenX - (worldX - offsetX) * zoom
        const viewportCenterX = rect.width / 2;
        const viewportCenterY = rect.height / 2;
        const targetPanX = viewportCenterX - (dropWorldX - canvasSizeRef.current.offsetX) * targetZoom;
        const targetPanY = viewportCenterY - (dropWorldY - canvasSizeRef.current.offsetY) * targetZoom;

        // Clamp the new pan to bounds
        const minPanX = viewportSizeRef.current.width - canvasSizeRef.current.width * targetZoom;
        const minPanY = viewportSizeRef.current.height - canvasSizeRef.current.height * targetZoom;
        const clampedTargetPanX = Math.min(0, Math.max(targetPanX, minPanX));
        const clampedTargetPanY = Math.min(0, Math.max(targetPanY, minPanY));

        animateZoomAndPanToTarget(targetZoom, { x: clampedTargetPanX, y: clampedTargetPanY }, currentZoom, currentPan);

        setPreDragZoomLevel(null);
        zoomOutInitiatedRef.current = false; // Reset flag for next drag
        actualZoomedOutLevelRef.current = null; // Clear the tracked zoom level
        actualZoomedOutPanRef.current = null; // Clear the tracked pan offset
        preDragPanOffsetRef.current = null; // Clear the stored pan offset
        // Reset restoreInProgress after animation would have started
        requestAnimationFrame(() => {
          restoreInProgressRef.current = false;
        });
      }
    }

    // Finalize selection box
    if (selectionStart) {
      const rect = containerRef.current.getBoundingClientRect();
      const rawX = (e.clientX - rect.left - panOffset.x) / zoomLevel;
      const rawY = (e.clientY - rect.top - panOffset.y) / zoomLevel;
      const { x: currentX, y: currentY } = clampCoordinates(rawX, rawY);
      canvasWorker.calculateSelection({ selectionStart, currentX, currentY })
        .then(selectionRes => {
          // Build final selection relative to the selection base (for proper toggle behavior)
          const base = selectionBaseRef.current || new Set();
          const final = new Set([...base]);
          nodes.forEach(nd => {
            const ndDims = getNodeDimensions(nd, previewingNodeId === nd.id, null);
            const intersects = !(selectionRes.x > nd.x + ndDims.currentWidth ||
              selectionRes.x + selectionRes.width < nd.x ||
              selectionRes.y > nd.y + ndDims.currentHeight ||
              selectionRes.y + selectionRes.height < nd.y);
            if (!base.has(nd.id)) {
              if (intersects) final.add(nd.id);
              else final.delete(nd.id);
            }
          });
          setSelectedInstanceIds(final);
        })
        .catch(error => {
          ignoreCanvasClick.current = true;
        })
        .finally(() => {
          setSelectionStart(null);
          setSelectionRect(null);
        });
    }

    // Finalize panning state
    let momentumStarted = false;
    if (isPanning && panStart) {
      const source = panSourceRef.current;
      if (source === 'trackpad' || source === 'touch') {
        // Calculate velocity from RECENT samples only (last 80ms for responsive feel)
        const history = panVelocityHistoryRef.current;
        let vx = 0, vy = 0;
        let recentCount = 0;
        if (history.length >= 2) {
          const now = history[history.length - 1].time;
          const cutoff = now - 80; // Use samples from last 80ms only
          const recent = history.filter(s => s.time >= cutoff);
          recentCount = recent.length;
          if (recent.length >= 2) {
            const last = recent[recent.length - 1];
            const first = recent[0];
            const dt = last.time - first.time;
            if (dt > 1) { // Only avoid exact zero or extremely small dt
              vx = (last.x - first.x) / dt;
              vy = (last.y - first.y) / dt;
            }
          }
        }

        // Fallback to instantaneous if history is insufficient
        if (vx === 0 && vy === 0) {
          vx = lastPanVelocityRef.current.vx;
          vy = lastPanVelocityRef.current.vy;
        }

        const speed = Math.hypot(vx, vy);
        if (speed >= PAN_MOMENTUM_MIN_SPEED) {
          momentumStarted = startPanMomentum(vx, vy, source);
        }
      }
    }
    if (!momentumStarted) {
      stopPanMomentum();
      isPanningOrZooming.current = false; // Clear the flag when panning ends
    }
    setIsPanning(false);
    panSourceRef.current = null; // Reset pan source
    lastPanVelocityRef.current = { vx: 0, vy: 0 };
    panVelocityHistoryRef.current = [];
    lastPanSampleRef.current = { time: performance.now() };
    isMouseDown.current = false;
    // If mouse moved during a canvas pan (not on a node), suppress the canvas click
    // to prevent the plus sign from appearing after a drag
    if (mouseMoved.current && !startedOnNode.current) {
      ignoreCanvasClick.current = true;
    }
    // Reset mouseMoved.current immediately after mouse up logic is done
    // This prevents race condition with canvas click handler
    mouseMoved.current = false;
  };
  const handleMouseUpCanvas = (e) => {
    // Stop propagation to prevent duplicate handleMouseUp calls from parent container
    e.stopPropagation();
    // Delegate to the main handleMouseUp to ensure consistent cleanup
    handleMouseUp(e);
  };
  const handleCanvasClick = (e) => {
    // Priority: Check related control panels FIRST before any other checks (like ignoreCanvasClick)
    // This ensures clicking off always dismisses the panel even if a slight drag occurred
    if (connectionControlPanelShouldShow || connectionControlPanelVisible || selectedEdgeId || selectedEdgeIds.size > 0) {
      if (connectionControlPanelShouldShow || connectionControlPanelVisible) {
        setConnectionControlPanelVisible(false);
      }
      storeActions.setSelectedEdgeId(null);
      storeActions.clearSelectedEdgeIds();
      return;
    }

    if (wasDrawingConnection.current) {
      wasDrawingConnection.current = false;
      return;
    }
    if (isPieMenuActionInProgress) {
      return;
    }
    if (e.target.closest('g[data-plus-sign="true"]')) return;
    // Prevent canvas click when clicking on PieMenu elements
    if (e.target.closest('.pie-menu')) {
      return;
    }
    // Allow clicks on the canvas SVG or the canvas-area container div
    const isValidCanvasTarget = (
      (e.target.tagName === 'svg' && e.target.classList.contains('canvas')) ||
      (e.target.tagName === 'DIV' && e.target.classList.contains('canvas-area'))
    );
    if (!isValidCanvasTarget) return;

    // For canvas clicks, we don't need to wait for the CLICK_DELAY since we're not dealing with double-click detection
    // Only check if we're in a state that should block canvas interactions
    if (isPaused || draggingNodeInfo || drawingConnectionFrom || recentlyPanned || nodeNamePrompt.visible || !activeGraphId) {
      setLastInteractionType('blocked_click');
      return;
    }
    if (ignoreCanvasClick.current) { ignoreCanvasClick.current = false; return; }

    // Close Group panel on click-off like other panels
    if (groupControlPanelShouldShow || groupControlPanelVisible || selectedGroup) {
      if (groupControlPanelShouldShow || groupControlPanelVisible) {
        setGroupControlPanelVisible(false);
      }
      if (selectedGroup) {
        setSelectedGroup(null);
      }
      return;
    }

    // Explicitly close Connection Panel if visible
    // (Moved to top of function - removed from here)

    // DEFENSIVE: If carousel is visible but pie menu isn't, force close carousel
    if (abstractionCarouselVisible && !selectedNodeIdForPieMenu) {

      setAbstractionCarouselVisible(false);
      setAbstractionCarouselNode(null);
      setCarouselAnimationState('hidden');
      setCarouselPieMenuStage(1);
      setCarouselFocusedNode(null);
      setCarouselFocusedNodeDimensions(null);
      return;
    }

    // If carousel is visible and exiting, don't handle canvas clicks
    if (abstractionCarouselVisible && carouselAnimationState === 'exiting') {

      return;
    }

    if (selectedInstanceIds.size > 0) {
      // Don't clear selection if we just completed a carousel exit
      if (justCompletedCarouselExit) {

        return;
      }

      // Don't clear selection if carousel exit is in progress
      if (carouselExitInProgressRef.current) {

        return;
      }


      setSelectedInstanceIds(new Set());
      // Pie menu will be handled by useEffect on selectedInstanceIds, no direct setShowPieMenu here
      return;
    }

    // Clear selected edge when clicking on empty canvas
    if ((selectedEdgeId || selectedEdgeIds.size > 0) && !hoveredEdgeInfo) {
      storeActions.setSelectedEdgeId(null);
      storeActions.clearSelectedEdgeIds();
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
    const mouseY = (e.clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
    // Prevent plus sign if pie menu is active or about to become active or hovering an edge
    if (!plusSign && selectedInstanceIds.size === 0 && !hoveredEdgeInfo) {
      setPlusSign({ x: mouseX, y: mouseY, mode: 'appear', tempName: '' });
      setLastInteractionType('plus_sign_shown');
    } else {
      if (nodeNamePrompt.visible) return;
      setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
      setLastInteractionType('plus_sign_hidden');
    }
  };

  const handlePlusSignClick = () => {
    if (!plusSign) return;
    if (plusSign.mode === 'morph') return;

    // Special Y-key video animation mode (session-only)
    if (keysPressed.current['y']) {
      // Store position and trigger video animation
      setVideoAnimation({ x: plusSign.x, y: plusSign.y, active: true });
      setPlusSign(null); // Immediately remove plus sign
      return;
    }

    setNodeNamePrompt({ visible: true, name: '' });

    // Calculate position for the node selection grid (below the dialog)
    const dialogTop = HEADER_HEIGHT + 25;
    const dialogHeight = 120; // Approximate height of the dialog
    const gridTop = dialogTop + dialogHeight + 10; // 10px spacing below dialog
    const dialogWidth = 300; // Match dialog width
    const gridLeft = window.innerWidth / 2 - dialogWidth / 2; // Center to match dialog

    setNodeSelectionGrid({
      visible: true,
      position: { x: gridLeft, y: gridTop }
    });
  };

  const handleClosePrompt = () => {
    if (!nodeNamePrompt.name.trim()) {
      setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
    }
    setNodeNamePrompt({ visible: false, name: '', color: null });
    setNodeSelectionGrid({ visible: false, position: { x: 0, y: 0 } });
    setDialogColorPickerVisible(false); // Close color picker when closing prompt
  };

  const handleAbstractionSubmit = ({ name, color, existingPrototypeId }) => {




    if (name.trim() && abstractionPrompt.nodeId && abstractionCarouselNode) {
      // The nodeId could be either a canvas instance ID or a prototype ID (from focused carousel node)
      let currentlySelectedNode = nodes.find(n => n.id === abstractionPrompt.nodeId);
      let targetPrototypeId = null;

      if (currentlySelectedNode) {
        // Found canvas instance - use its prototype ID
        targetPrototypeId = currentlySelectedNode.prototypeId;
        console.log(`[Abstraction Submit] Found canvas instance node:`, {
          id: currentlySelectedNode.id,
          name: currentlySelectedNode.name,
          prototypeId: currentlySelectedNode.prototypeId
        });
      } else {
        // Not found as canvas instance - might be a prototype ID from focused carousel node
        const nodePrototype = nodePrototypesMap.get(abstractionPrompt.nodeId);
        if (nodePrototype) {
          targetPrototypeId = abstractionPrompt.nodeId;
          // Create a mock node object for the rest of the function
          currentlySelectedNode = {
            id: nodePrototype.id,
            name: nodePrototype.name,
            prototypeId: nodePrototype.id,
            color: nodePrototype.color
          };
          console.log(`[Abstraction Submit] Found prototype node:`, {
            id: nodePrototype.id,
            name: nodePrototype.name,
            prototypeId: nodePrototype.id
          });
        }
      }

      console.log(`[Abstraction Submit] RESOLVED NODE INFO:`, {
        promptNodeId: abstractionPrompt.nodeId,
        foundNodeId: currentlySelectedNode?.id,
        foundNodeName: currentlySelectedNode?.name,
        targetPrototypeId: targetPrototypeId,
        carouselNodeId: abstractionCarouselNode.id,
        carouselNodeProtoId: abstractionCarouselNode.prototypeId,
        direction: abstractionPrompt.direction
      });

      if (!currentlySelectedNode || !targetPrototypeId) {

        return;
      }

      // Resolve the correct chain owner: if selected node belongs to another node's chain for
      // this dimension, modify that owner's chain; otherwise, use the selected node as owner.
      const currentStateForChain = useGraphStore.getState();
      const allPrototypes = currentStateForChain.nodePrototypes;
      const targetProtoForMembership = targetPrototypeId; // the prototype relative to which we insert
      let chainOwnerPrototypeId = abstractionCarouselNode.prototypeId;
      try {
        // If the selected/target prototype appears inside some other prototype's chain
        // for the current dimension, that prototype is the chain owner we should modify
        for (const [protoId, proto] of allPrototypes.entries()) {
          const chain = proto?.abstractionChains?.[currentAbstractionDimension];
          if (chain && Array.isArray(chain) && chain.includes(targetProtoForMembership)) {
            chainOwnerPrototypeId = protoId;
            break;
          }
        }
      } catch (_) {
        // Fall back to the current carousel node as owner
      }

      // Determine the node to insert into the chain: existing or new
      let newNodeId = existingPrototypeId;
      if (!newNodeId) {
        // Create new node with color gradient
        let newNodeColor = color;
        if (!newNodeColor) {
          const isAbove = abstractionPrompt.direction === 'above';
          const abstractionLevel = isAbove ? 0.3 : -0.2;
          const targetColor = isAbove ? '#EFE8E5' : '#000000';
          newNodeColor = interpolateColor(currentlySelectedNode.color || '#8B0000', targetColor, Math.abs(abstractionLevel));
        }



        // Create the new node prototype
        storeActions.addNodePrototype({
          id: (newNodeId = uuidv4()),
          name: name.trim(),
          color: newNodeColor,
          typeNodeId: 'base-thing-prototype',
          definitionGraphIds: []
        });
      } else {

      }

      // Add to the abstraction chain relative to the currently selected/focused node
      // Use the resolved chain owner rather than always the carousel node
      console.log(`[Abstraction Submit] About to call addToAbstractionChain with:`, {
        chainOwnerNodeId: chainOwnerPrototypeId,
        dimension: currentAbstractionDimension,
        direction: abstractionPrompt.direction,
        newNodeId: newNodeId,
        insertRelativeToNodeId: currentlySelectedNode.prototypeId
      });

      storeActions.addToAbstractionChain(
        chainOwnerPrototypeId,                   // the node whose chain we're modifying (actual chain owner)
        currentAbstractionDimension,            // dimension (Physical, Conceptual, etc.)
        abstractionPrompt.direction,            // 'above' or 'below'
        newNodeId,                              // the node to add (existing or newly created)
        targetPrototypeId                       // insert relative to this node (focused node in carousel)
      );




      // Close the abstraction prompt but keep pie menu in stage 2
      // Ensure carousel stays visible by maintaining its state

      setAbstractionPrompt({ visible: false, name: '', color: null, direction: 'above', nodeId: null, carouselLevel: null });

      // Explicitly maintain carousel visibility and stay in stage 2 (don't go back to stage 1)
      setAbstractionCarouselVisible(true); // Ensure carousel stays visible
      // Keep carouselPieMenuStage at 2 so users can add more nodes without having to re-enter stage 2

      // Ensure pie menu stays selected for the carousel node
      if (abstractionCarouselNode && !selectedNodeIdForPieMenu) {

        setSelectedNodeIdForPieMenu(abstractionCarouselNode.id);
      }

      setIsCarouselStageTransition(true);

      // Ensure the carousel node is still selected for pie menu
      if (abstractionCarouselNode) {
        setSelectedNodeIdForPieMenu(abstractionCarouselNode.id);
      }
    }
  };

  const handlePromptSubmit = () => {
    const name = nodeNamePrompt.name.trim();
    if (name && plusSign) {
      setPlusSign(ps => ps && { ...ps, mode: 'morph', tempName: name, selectedColor: nodeNamePrompt.color });
    } else {
      setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
    }
    setNodeNamePrompt({ visible: false, name: '', color: null });
    setNodeSelectionGrid({ visible: false, position: { x: 0, y: 0 } });
    setDialogColorPickerVisible(false); // Close color picker when submitting
  };
  const handleNodeSelection = (nodePrototype) => {
    if (!plusSign || !activeGraphId) return;

    // Trigger the morph animation with the selected prototype
    setPlusSign(ps => ps && {
      ...ps,
      mode: 'morph',
      tempName: nodePrototype.name,
      selectedPrototype: nodePrototype, // Store the selected prototype for morphDone
      selectedColor: nodePrototype.color // Use the prototype's color for the animation
    });

    // Clean up UI state
    setNodeNamePrompt({ visible: false, name: '' });
    setNodeSelectionGrid({ visible: false, position: { x: 0, y: 0 } });
  };

  const handleNodeSelectionGridClose = () => {
    // Close the grid and trigger disappear animation like hitting X
    setNodeNamePrompt({ visible: false, name: '' });
    setNodeSelectionGrid({ visible: false, position: { x: 0, y: 0 } });
    setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
  };

  const handleMorphDone = () => {
    if (!plusSign || !activeGraphId) return;

    // Get the actual dimensions for the node
    const mockNode = { name: plusSign.tempName };
    const dims = getNodeDimensions(mockNode, false, null);

    let position = {
      x: plusSign.x - dims.currentWidth / 2,
      y: plusSign.y - dims.currentHeight / 2,
    };

    // Apply smooth grid snapping when creating new nodes if grid is enabled
    if (gridMode !== 'off') {
      const snapped = snapToGridAnimated(plusSign.x, plusSign.y, dims.currentWidth, dims.currentHeight, null);
      position = { x: snapped.x, y: snapped.y };
    }

    if (plusSign.selectedPrototype) {
      // A prototype was selected from the grid - create instance of existing prototype
      storeActions.addNodeInstance(activeGraphId, plusSign.selectedPrototype.id, position);
    } else if (plusSign.tempName) {
      // A custom name was entered - create new prototype
      const name = plusSign.tempName;
      const newPrototypeId = uuidv4();

      // 1. Create the new prototype
      const newPrototypeData = {
        id: newPrototypeId,
        name: name,
        description: '',
        color: plusSign.selectedColor || 'maroon', // Use selected color or default
        definitionGraphIds: [],
        typeNodeId: 'base-thing-prototype', // Type all new nodes as "Thing"
      };
      storeActions.addNodePrototype(newPrototypeData);

      // 2. Create the first instance of this prototype on the canvas
      storeActions.addNodeInstance(activeGraphId, newPrototypeId, position);
    }

    setPlusSign(null);
  };

  const handleVideoAnimationComplete = () => {
    if (!videoAnimation || !activeGraphId) return;

    // Calculate position (centered)
    const mockNode = { name: "Hello, World" };
    const dims = getNodeDimensions(mockNode, false, null);
    const position = {
      x: videoAnimation.x - dims.currentWidth / 2,
      y: videoAnimation.y - dims.currentHeight / 2
    };

    // Apply smooth grid snapping when creating new nodes if grid is enabled
    if (gridMode !== 'off') {
      const snapped = snapToGridAnimated(videoAnimation.x, videoAnimation.y, dims.currentWidth, dims.currentHeight, null);
      position.x = snapped.x;
      position.y = snapped.y;
    }

    // Create node prototype and instance
    const newPrototypeId = uuidv4();
    storeActions.addNodePrototype({
      id: newPrototypeId,
      name: "Hello, World",
      description: '',
      color: 'maroon',
      definitionGraphIds: [],
      typeNodeId: 'base-thing-prototype'
    });
    storeActions.addNodeInstance(activeGraphId, newPrototypeId, position);

    setVideoAnimation(null);
  };

  // Dialog color picker handlers
  const handleDialogColorPickerOpen = (iconElement, event) => {
    event.stopPropagation(); // Prevent event from bubbling to backdrop

    // If already open, close it (toggle behavior)
    if (dialogColorPickerVisible) {
      setDialogColorPickerVisible(false);
      return;
    }

    const rect = iconElement.getBoundingClientRect();
    setDialogColorPickerPosition({ x: rect.right, y: rect.bottom });
    setDialogColorPickerVisible(true);
  };

  const handleDialogColorPickerClose = () => {
    setDialogColorPickerVisible(false);
    setColorPickerTarget(null);
  };

  const handleDialogColorChange = (color) => {
    if (colorPickerTarget?.type === 'group') {
      if (activeGraphId && colorPickerTarget.id) {
        storeActions.updateGroup(activeGraphId, colorPickerTarget.id, (draft) => {
          draft.color = color;
        });
        // Update local state immediately for responsiveness
        setSelectedGroup(prev => prev && prev.id === colorPickerTarget.id ? { ...prev, color } : prev);
      }
    } else if (nodeNamePrompt.visible) {
      setNodeNamePrompt(prev => ({ ...prev, color }));
    } else if (connectionNamePrompt.visible) {
      setConnectionNamePrompt(prev => ({ ...prev, color }));
    }
  };

  const keysPressed = useKeyboardShortcuts();

  // Effect to mark component as mounted
  useEffect(() => {
    isMountedRef.current = true;
  }, []); // Runs once after initial mount

  // Effect to close color pickers when their parent contexts disappear
  useEffect(() => {
    // Close dialog color picker when node name prompt closes
    if (!nodeNamePrompt.visible) {
      setDialogColorPickerVisible(false);
    }
  }, [nodeNamePrompt.visible]);

  useEffect(() => {
    // Close pie menu color picker when pie menu disappears
    if (!currentPieMenuData || !selectedNodeIdForPieMenu) {
      setPieMenuColorPickerVisible(false);
      setActivePieMenuColorNodeId(null);
    }
  }, [currentPieMenuData, selectedNodeIdForPieMenu]);



  // Simple keyboard controls using requestAnimationFrame - synced to display refresh rate
  useEffect(() => {
    let lastFrameTime = 0;

    const handleKeyboardMovement = (currentTime = performance.now()) => {
      // Throttle to ensure consistent timing regardless of refresh rate
      if (currentTime - lastFrameTime < 8) { // ~120fps max to keep it smooth even on high refresh displays
        return;
      }
      lastFrameTime = currentTime;
      // Check for conditions that should disable keyboard controls
      const shouldDisableKeyboard =
        isPaused ||
        nodeNamePrompt.visible ||
        connectionNamePrompt.visible ||
        abstractionPrompt.visible ||
        isHeaderEditing ||
        isRightPanelInputFocused ||
        isLeftPanelInputFocused ||
        !activeGraphId;

      if (shouldDisableKeyboard) return;

      // Calculate movement (use lowercase only to avoid shift conflicts)
      let panDx = 0, panDy = 0;
      if (keysPressed.current['ArrowLeft'] || keysPressed.current['a']) panDx += KEYBOARD_PAN_SPEED;
      if (keysPressed.current['ArrowRight'] || keysPressed.current['d']) panDx -= KEYBOARD_PAN_SPEED;
      if (keysPressed.current['ArrowUp'] || keysPressed.current['w']) panDy += KEYBOARD_PAN_SPEED;
      if (keysPressed.current['ArrowDown'] || keysPressed.current['s']) panDy -= KEYBOARD_PAN_SPEED;

      // Apply movement
      if (panDx !== 0 || panDy !== 0) {
        setPanOffset(prevPan => {
          const newX = Math.max(viewportSize.width - canvasSize.width * zoomLevel, Math.min(0, prevPan.x + panDx));
          const newY = Math.max(viewportSize.height - canvasSize.height * zoomLevel, Math.min(0, prevPan.y + panDy));
          return { x: newX, y: newY };
        });
      }

      // Handle zoom (simple stable approach)
      // Skip keyboard zoom during drag to prevent interference with drag zoom animation
      if (draggingNodeInfo || isAnimatingZoom) return;

      let zoomDelta = 0;
      if (keysPressed.current[' ']) zoomDelta = -KEYBOARD_ZOOM_SPEED; // Space = zoom out
      if (keysPressed.current['Shift']) zoomDelta = KEYBOARD_ZOOM_SPEED; // Shift = zoom in

      if (zoomDelta !== 0) {
        setZoomLevel(prevZoom => {
          const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom + zoomDelta));

          // Only adjust pan if zoom actually changed
          if (newZoom !== prevZoom) {
            const zoomRatio = newZoom / prevZoom;
            // Use the actual visible viewport center, not the full window center
            const centerX = viewportBounds.width / 2;
            const centerY = viewportBounds.height / 2;

            // Update pan to keep view centered, with boundary constraints
            // Account for the viewport offset when calculating zoom center
            setPanOffset(prevPan => {
              // The zoom center should be relative to the viewport bounds
              const zoomCenterX = centerX + viewportBounds.x;
              const zoomCenterY = centerY + viewportBounds.y;

              const newPanX = zoomCenterX - (zoomCenterX - prevPan.x) * zoomRatio;
              const newPanY = zoomCenterY - (zoomCenterY - prevPan.y) * zoomRatio;

              // Apply zoom boundaries
              const maxPanX = 0;
              const minPanX = viewportSize.width - canvasSize.width * newZoom;
              const maxPanY = 0;
              const minPanY = viewportSize.height - canvasSize.height * newZoom;

              return {
                x: Math.max(minPanX, Math.min(maxPanX, newPanX)),
                y: Math.max(minPanY, Math.min(maxPanY, newPanY))
              };
            });
          }

          return newZoom;
        });
      }
    };

    // Use requestAnimationFrame to sync with display refresh rate
    let animationFrameId;
    const keyboardLoop = (timestamp) => {
      handleKeyboardMovement(timestamp);
      animationFrameId = requestAnimationFrame(keyboardLoop);
    };

    animationFrameId = requestAnimationFrame(keyboardLoop);
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isPaused, nodeNamePrompt.visible, connectionNamePrompt.visible, abstractionPrompt.visible, isHeaderEditing, isRightPanelInputFocused, isLeftPanelInputFocused, activeGraphId, viewportSize, canvasSize, zoomLevel]);



  // Deprecated - replaced by UnifiedSelector
  const renderConnectionNamePrompt = () => {
    if (!connectionNamePrompt.visible) return null;

    const handleConnectionPromptSubmit = () => {
      if (connectionNamePrompt.name.trim()) {
        // Create a new node prototype for this connection type
        const newConnectionNodeId = uuidv4();
        storeActions.addNodePrototype({
          id: newConnectionNodeId,
          name: connectionNamePrompt.name.trim(),
          description: '',
          picture: null,
          color: connectionNamePrompt.color || NODE_DEFAULT_COLOR,
          typeNodeId: null,
          definitionGraphIds: []
        });

        // Update the edge to use this new connection type
        if (connectionNamePrompt.edgeId) {
          storeActions.updateEdge(connectionNamePrompt.edgeId, (draft) => {
            draft.definitionNodeIds = [newConnectionNodeId];
          });
        }

        setConnectionNamePrompt({ visible: false, name: '', color: null, edgeId: null });
      }
    };

    const handleConnectionPromptClose = () => {
      setConnectionNamePrompt({ visible: false, name: '', color: null, edgeId: null });
    };

    return (
      <>
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 1000 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleConnectionPromptClose();
            }
          }}
        />
        <div
          style={{
            position: 'fixed',
            top: HEADER_HEIGHT + 25,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#bdb5b5',
            padding: '20px',
            borderRadius: '10px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
            zIndex: 1001,
            width: '300px',
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ position: 'absolute', top: '10px', right: '10px', cursor: 'pointer' }}>
            <X size={MODAL_CLOSE_ICON_SIZE} color="#999" onClick={handleConnectionPromptClose} />
          </div>
          <div style={{ textAlign: 'center', marginBottom: '15px', color: 'black' }}>
            <strong style={{ fontSize: '18px' }}>Name Your Connection</strong>
          </div>
          <div style={{ textAlign: 'center', marginBottom: '15px', color: '#666', fontSize: '14px' }}>
            The Thing that will define your Connection,<br />
            in verb form if available.
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Palette
              size={20}
              color="#260000"
              style={{ cursor: 'pointer', flexShrink: 0, marginRight: '8px' }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleDialogColorPickerOpen(e.currentTarget, e);
                // Update the connection prompt color when color picker changes
                setConnectionNamePrompt({ ...connectionNamePrompt, color: connectionNamePrompt.color || NODE_DEFAULT_COLOR });
              }}
              title="Change color"
            />
            <input
              type="text"
              id="connection-name-prompt-input"
              name="connectionNamePromptInput"
              value={connectionNamePrompt.name}
              onChange={(e) => setConnectionNamePrompt({ ...connectionNamePrompt, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConnectionPromptSubmit();
                if (e.key === 'Escape') handleConnectionPromptClose();
              }}
              style={{ flex: 1, padding: '10px', borderRadius: '5px', border: '1px solid #260000', marginRight: '10px' }}
              autoFocus
            />
            <button
              onClick={handleConnectionPromptSubmit}
              style={{
                padding: '10px',
                backgroundColor: connectionNamePrompt.color || NODE_DEFAULT_COLOR,
                color: '#bdb5b5',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '50px',
                minHeight: '44px'
              }}
              title="Create connection type"
            >
              <ArrowBigRightDash size={16} color="#bdb5b5" />
            </button>
          </div>
        </div>
      </>
    );
  };
  // Deprecated - replaced by UnifiedSelector
  const renderCustomPrompt = () => {
    if (!nodeNamePrompt.visible) return null;
    return (
      <>
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 1000 }}
          onClick={(e) => {
            // Only close if clicking directly on the backdrop, not on child elements
            if (e.target === e.currentTarget) {
              handleClosePrompt();
            }
          }}
        />
        <div
          ref={dialogContainerRef}
          style={{
            position: 'fixed',
            top: HEADER_HEIGHT + 25,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#bdb5b5',
            padding: '20px',
            borderRadius: '10px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
            zIndex: 1001, // Higher than node selection grid (998)
            width: '300px',
          }}
          onClick={(e) => e.stopPropagation()} // Prevent clicks within dialog from closing it
          onMouseDown={(e) => e.stopPropagation()} // Also stop mousedown to prevent grid from closing
        >
          <div style={{ position: 'absolute', top: '10px', right: '10px', cursor: 'pointer' }}>
            <X size={MODAL_CLOSE_ICON_SIZE} color="#999" onClick={handleClosePrompt} />
          </div>
          <div style={{ textAlign: 'center', marginBottom: '15px', color: 'black' }}>
            <strong style={{ fontSize: '18px' }}>Name Your Thing</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Palette
              size={20}
              color="#260000"
              style={{ cursor: 'pointer', flexShrink: 0, marginRight: '8px' }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleDialogColorPickerOpen(e.currentTarget, e);
              }}
              title="Change color"
            />
            <input
              type="text"
              id="node-name-prompt-input" // Add id
              name="nodeNamePromptInput" // Add name
              value={nodeNamePrompt.name}
              onChange={(e) => setNodeNamePrompt({ ...nodeNamePrompt, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePromptSubmit(); }}
              style={{ flex: 1, padding: '10px', borderRadius: '5px', border: '1px solid #260000', marginRight: '10px' }}
              autoFocus
            />
            <button
              onClick={handlePromptSubmit}
              style={{
                padding: '10px',
                backgroundColor: nodeNamePrompt.color || 'maroon',
                color: '#bdb5b5',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '50px',
                minHeight: '44px'
              }}
              title="Create node"
            >
              <ArrowBigRightDash size={16} color="#bdb5b5" />
            </button>
          </div>
        </div>
      </>
    );
  };

  const shouldPanelsBeExclusive = windowSize?.width ? windowSize.width <= 1100 : window.innerWidth <= 1100;

  const handleToggleRightPanel = useCallback(() => {
    setRightPanelExpanded(prev => {
      const next = !prev;
      if (next && shouldPanelsBeExclusive) {
        setLeftPanelExpanded(false);
      }
      return next;
    });
  }, [shouldPanelsBeExclusive]);

  const handleToggleLeftPanel = useCallback(() => {
    setLeftPanelExpanded(prev => {
      const next = !prev;
      if (next && shouldPanelsBeExclusive) {
        setRightPanelExpanded(false);
      }
      return next;
    });
  }, [shouldPanelsBeExclusive]);

  useEffect(() => {
    if (shouldPanelsBeExclusive && leftPanelExpanded && rightPanelExpanded) {
      setRightPanelExpanded(false);
    }
  }, [leftPanelExpanded, rightPanelExpanded, shouldPanelsBeExclusive]);

  // Panel toggle and TypeList keyboard shortcuts - work even when inputs are focused
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Check if focus is on a text input to prevent conflicts
      const activeElement = document.activeElement;
      const isTextInput = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.contentEditable === 'true' ||
        activeElement.type === 'text' ||
        activeElement.type === 'search' ||
        activeElement.type === 'password' ||
        activeElement.type === 'email' ||
        activeElement.type === 'number'
      );



      // Only handle these specific keys if NOT in a text input
      if (!isTextInput) {
        if (e.key === '1') {
          e.preventDefault();
          handleToggleLeftPanel();
        } else if (e.key === '2') {
          e.preventDefault();
          handleToggleRightPanel();
        } else if (e.key === '3') {
          e.preventDefault();

          // Cycle TypeList mode: connection -> node -> closed -> connection
          const currentMode = useGraphStore.getState().typeListMode;
          const newMode = currentMode === 'connection' ? 'node' :
            currentMode === 'node' ? 'closed' : 'connection';

          storeActions.setTypeListMode(newMode);

        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleToggleLeftPanel, handleToggleRightPanel, storeActions]);



  const handleLeftPanelFocusChange = useCallback((isFocused) => {
    //
    setIsLeftPanelInputFocused(isFocused);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInputActive = isHeaderEditing || isRightPanelInputFocused || isLeftPanelInputFocused || nodeNamePrompt.visible;
      if (isInputActive || !activeGraphId) { return; }

      // Block destructive keys when AbstractionCarousel is visible, except in editable fields
      if (abstractionCarouselVisible) {
        const isDeleteOrBackspace = e.key === 'Delete' || e.key === 'Backspace';
        if (isDeleteOrBackspace) {
          const target = e.target;
          const isEditableTarget = target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable === true
          );
          if (!isEditableTarget) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      const isDeleteKey = e.key === 'Delete' || e.key === 'Backspace';
      const nodesSelected = selectedInstanceIds.size > 0;
      const edgeSelected = selectedEdgeId !== null || selectedEdgeIds.size > 0;

      if (isDeleteKey && nodesSelected) {
        e.preventDefault();
        const idsToDelete = new Set(selectedInstanceIds); // Use local selection state

        // Call removeNodeInstance action for each selected ID
        idsToDelete.forEach(id => {
          storeActions.removeNodeInstance(activeGraphId, id);
        });

        // Clear local selection state AFTER dispatching actions

        setSelectedInstanceIds(new Set());
      } else if (isDeleteKey && edgeSelected) {
        console.log('[NodeCanvas] Delete key pressed with edge selected:', {
          selectedEdgeId,
          connectionNamePromptVisible: connectionNamePrompt.visible,
          shouldPreventDeletion: connectionNamePrompt.visible
        });

        if (!connectionNamePrompt.visible) {
          e.preventDefault();

          // Delete single selected edge
          if (selectedEdgeId) {
            storeActions.removeEdge(selectedEdgeId);
          }

          // Delete multiple selected edges
          if (selectedEdgeIds.size > 0) {
            selectedEdgeIds.forEach(edgeId => {
              storeActions.removeEdge(edgeId);
            });
            storeActions.clearSelectedEdgeIds();
          }
        } else {

        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedInstanceIds, selectedEdgeId, selectedEdgeIds, isHeaderEditing, isRightPanelInputFocused, isLeftPanelInputFocused, nodeNamePrompt.visible, connectionNamePrompt.visible, activeGraphId, storeActions.removeNodeInstance, storeActions.removeEdge, storeActions.clearSelectedEdgeIds]);

  const handleProjectTitleChange = (newTitle) => {
    // Get CURRENT activeGraphId directly from store
    const currentActiveId = useGraphStore.getState().activeGraphId;
    if (currentActiveId) {
      // Use localStoreActions
      storeActions.updateGraph(currentActiveId, draft => { draft.name = newTitle || 'Untitled'; });
    } else {
      // 
    }
  };

  const handleProjectBioChange = (newBio) => {
    // Get CURRENT activeGraphId directly from store
    const currentActiveId = useGraphStore.getState().activeGraphId;
    if (currentActiveId) {
      // Use localStoreActions
      storeActions.updateGraph(currentActiveId, draft => { draft.description = newBio; });
    }
  };
  // Global listeners for resizer drag to keep latency low
  useEffect(() => {
    const move = (e) => {
      if (!isDraggingLeft.current && !isDraggingRight.current) return;
      // Prevent page scroll/pinch on touchmove while dragging
      if (e && e.cancelable) {
        try { e.preventDefault(); } catch { }
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
      }
      onDragMove(e);
    };
    const up = () => {
      if (!isDraggingLeft.current && !isDraggingRight.current) return;
      endDrag();
    };
    const blockWheelWhileDragging = (e) => {
      // Only block global wheel when dragging to avoid interfering with normal scroll
      if (!isDraggingLeft.current && !isDraggingRight.current) return;
      if (e && e.cancelable) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    window.addEventListener('pointerup', up);
    window.addEventListener('wheel', blockWheelWhileDragging, { passive: false });
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('wheel', blockWheelWhileDragging);
    };
  }, []);

  // Effect to manage PieMenu visibility and data for animations
  useEffect(() => {
    console.log(`[NodeCanvas] selectedInstanceIds changed:`, {
      size: selectedInstanceIds.size,
      ids: [...selectedInstanceIds],
      isTransitioningPieMenu,
      abstractionCarouselVisible,
      selectedNodeIdForPieMenu,
      abstractionPromptVisible: abstractionPrompt.visible
    });

    // Add stack trace for unexpected clears to debug the issue
    if (selectedInstanceIds.size === 0 && selectedNodeIdForPieMenu && !justCompletedCarouselExit) {

    }

    if (selectedInstanceIds.size === 1) {
      const instanceId = [...selectedInstanceIds][0];

      if (!isTransitioningPieMenu) {
        setSelectedNodeIdForPieMenu(instanceId);
      } else {
        // If transitioning, PieMenu's onExitAnimationComplete will handle setting the next selectedNodeIdForPieMenu
      }
    } else {
      // Not a single selection (0 or multiple)

      // SPECIAL CASE: If abstraction prompt is visible, don't close pie menu yet
      if (abstractionPrompt.visible && abstractionCarouselVisible) {

        return;
      }

      // SPECIAL CASE: If carousel is exiting, don't clear the pie menu - let the exit complete first
      if (carouselAnimationState === 'exiting') {

        return;
      }

      // SPECIAL CASE: If we just completed carousel exit, don't clear the pie menu 
      if (justCompletedCarouselExit) {

        return;
      }

      // SPECIAL CASE: If carousel is visible and we're losing selection, start exit animation
      if (abstractionCarouselVisible && selectedNodeIdForPieMenu) {

        setCarouselAnimationState('exiting');
        return;
      }


      setSelectedNodeIdForPieMenu(null);
    }
  }, [selectedInstanceIds, isTransitioningPieMenu, abstractionPrompt.visible, abstractionCarouselVisible, selectedNodeIdForPieMenu, carouselAnimationState, justCompletedCarouselExit]); // Added carousel protection flags
  // Effect to prepare and render PieMenu when selectedNodeIdForPieMenu changes and not transitioning
  useEffect(() => {
    if (selectedNodeIdForPieMenu && !isTransitioningPieMenu) {
      const node = nodes.find(n => n.id === selectedNodeIdForPieMenu);
      if (node) {
        // Check if we're in carousel mode and have dynamic dimensions
        const isInCarouselMode = abstractionCarouselVisible && abstractionCarouselNode && node.id === abstractionCarouselNode.id;

        // Use dynamic carousel dimensions if available, otherwise calculate from the actual node
        const dimensions = isInCarouselMode && carouselFocusedNodeDimensions
          ? carouselFocusedNodeDimensions
          : getNodeDimensions(node, previewingNodeId === node.id, null);

        // In carousel mode, create a virtual node positioned at the carousel center
        // Keep the original node for PieMenu, but store focused node info for button actions
        let nodeForPieMenu = node;

        if (isInCarouselMode && abstractionCarouselNode) {
          // Calculate carousel center position in canvas coordinates
          const originalNodeDimensions = getNodeDimensions(abstractionCarouselNode, false, null);
          const carouselCenterX = abstractionCarouselNode.x + originalNodeDimensions.currentWidth / 2;
          const carouselCenterY = abstractionCarouselNode.y + originalNodeDimensions.currentHeight / 2; // Perfect center alignment

          // Create virtual node at carousel center
          nodeForPieMenu = {
            ...nodeForPieMenu,
            x: carouselCenterX - dimensions.currentWidth / 2,
            y: carouselCenterY - dimensions.currentHeight / 2
          };

          console.log(`[NodeCanvas] Final nodeForPieMenu for pie menu:`, {
            id: nodeForPieMenu.id,
            name: nodeForPieMenu.name,
            prototypeId: nodeForPieMenu.prototypeId,
            stage: carouselPieMenuStage,
            focusedNodeId: carouselFocusedNode?.id,
            focusedNodeName: carouselFocusedNode?.name
          });
        }



        setCurrentPieMenuData({
          node: nodeForPieMenu,
          buttons: targetPieMenuButtons,
          nodeDimensions: dimensions
        });
        setIsPieMenuRendered(true); // Ensure PieMenu is in DOM to animate in
      } else {
        //
        setCurrentPieMenuData(null); // Keep this for safety if node genuinely disappears
        // isPieMenuRendered will be set to false by onExitAnimationComplete if it was visible
      }
    } else if (!selectedNodeIdForPieMenu && !isTransitioningPieMenu) {
      // If no node is targeted for pie menu (e.g., deselected), AND we are not in a transition
      // (which implies the menu should just hide without further state changes from NodeCanvas side for now).
      // The PieMenu will become invisible due to the isVisible prop calculation.
      // currentPieMenuData should NOT be nulled here, as PieMenu needs it to animate out.
      // It will be nulled in onExitAnimationComplete.
      //
    }
    // If isTransitioningPieMenu is true, we don't change currentPieMenuData or isPieMenuRendered here.
    // The existing menu plays its exit animation, and onExitAnimationComplete handles the next steps.
  }, [selectedNodeIdForPieMenu, nodes, previewingNodeId, isTransitioningPieMenu, abstractionCarouselVisible, abstractionCarouselNode, carouselPieMenuStage, carouselFocusedNodeScale, carouselFocusedNodeDimensions, carouselFocusedNode]);

  useEffect(() => {
    if (!isPieMenuRendered) {
      setActivePieMenuItemForVision(null);
    }
  }, [isPieMenuRendered]);

  // Fetch orbit candidates when exactly one node is selected
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (selectedInstanceIds.size !== 1) {
          setOrbitData({ inner: [], outer: [], all: [] });
          return;
        }

        const instanceId = [...selectedInstanceIds][0];
        const graph = useGraphStore.getState().graphs.get(activeGraphId);
        const inst = graph?.instances?.get(instanceId);
        const proto = inst ? useGraphStore.getState().nodePrototypes.get(inst.prototypeId) : null;

        if (!proto) {
          setOrbitData({ inner: [], outer: [], all: [] });
          return;
        }

        console.log(`🌍 Starting orbit search for "${proto.name}"`);
        const startTime = performance.now();

        const candidates = await fetchOrbitCandidatesForPrototype(proto);

        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);

        console.log(`✨ Orbit search completed for "${proto.name}" in ${duration}ms:`, {
          innerRing: candidates.inner?.length || 0,
          outerRing: candidates.outer?.length || 0,
          total: candidates.all?.length || 0
        });

        if (candidates.inner?.length > 0 || candidates.outer?.length > 0) {
          console.log('🎯 Sample orbit candidates:', candidates.all?.slice(0, 5).map(c => `${c.name} (${c.source})`));
        }

        if (!cancelled) setOrbitData(candidates);
      } catch (error) {
        console.error('❌ Orbit search failed:', error);
        if (!cancelled) setOrbitData({ inner: [], outer: [], all: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedInstanceIds, activeGraphId]);
  // --- Hurtle Animation State & Logic ---
  const [hurtleAnimation, setHurtleAnimation] = useState(null);
  const hurtleAnimationRef = useRef(null);

  const runHurtleAnimation = useCallback((animationData) => {
    const animate = (currentTime) => {
      const elapsed = currentTime - animationData.startTime;
      const progress = Math.min(elapsed / animationData.duration, 1);

      // Subtle speed variation - gentle ease-in-out
      const easedProgress = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Calculate current position (screen coordinates)
      const currentX = Math.round(animationData.startPos.x + (animationData.targetPos.x - animationData.startPos.x) * easedProgress);
      const currentY = Math.round(animationData.startPos.y + (animationData.targetPos.y - animationData.startPos.y) * easedProgress);

      // Calculate ballooning and contracting size.
      // It starts at 1px, "balloons" to a peak size, and "contracts" back to 1px.
      const peakOrbSize = animationData.orbSize * 1.9; // Keep the dramatic peak size
      const sineProgress = Math.sin(progress * Math.PI); // This goes from 0 -> 1 -> 0 as progress goes 0 -> 1
      const currentOrbSize = Math.max(1, Math.round(1 + (peakOrbSize - 1) * sineProgress));

      // Z-index behavior: stay under node much longer, use positive z-index
      let currentZIndex;
      if (progress < 0.45) {
        currentZIndex = 500; // Positive z-index, will be covered by elevated selected node
      } else if (progress < 0.85) {
        currentZIndex = 15000; // Above header for shorter period
      } else {
        currentZIndex = 5000; // Below header only at the very end
      }

      // Update animation state with dynamic properties
      setHurtleAnimation(prev => prev ? {
        ...prev,
        currentPos: { x: currentX, y: currentY },
        currentOrbSize,
        currentZIndex,
        progress
      } : null);

      if (progress < 1) {
        hurtleAnimationRef.current = requestAnimationFrame(animate);
      } else {
        // Animation complete - clean up and switch graph
        storeActions.openGraphTabAndBringToTop(animationData.targetGraphId, animationData.definitionNodeId);
        setHurtleAnimation(null);
        if (hurtleAnimationRef.current) {
          cancelAnimationFrame(hurtleAnimationRef.current);
          hurtleAnimationRef.current = null;
        }
      }
    };

    hurtleAnimationRef.current = requestAnimationFrame(animate);
  }, [storeActions]);

  // Simple Particle Transfer Animation - always use fresh coordinates
  const startHurtleAnimation = useCallback((nodeId, targetGraphId, definitionNodeId, sourceGraphId = null) => {
    const currentState = useGraphStore.getState();

    // If a sourceGraphId is provided, look for the node there. Otherwise, use the current active graph.
    const graphIdToFindNodeIn = sourceGraphId || currentState.activeGraphId;

    const nodesInSourceGraph = getHydratedNodesForGraph(graphIdToFindNodeIn)(currentState);
    const nodeData = nodesInSourceGraph.find(n => n.id === nodeId);

    if (!nodeData) {

      return;
    }

    // Get fresh viewport state
    const containerElement = containerRef.current;
    if (!containerElement) return;

    // Get the current pan/zoom from the actual SVG element to ensure accuracy
    const svgElement = containerElement.querySelector('.canvas');
    if (!svgElement) return;

    const transform = svgElement.style.transform;
    const translateMatch = transform.match(/translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
    const scaleMatch = transform.match(/scale\((-?\d+(?:\.\d+)?)\)/);

    const currentPanX = translateMatch ? parseFloat(translateMatch[1]) : 0;
    const currentPanY = translateMatch ? parseFloat(translateMatch[2]) : 0;
    const currentZoom = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    // Get node dimensions 
    const nodeDimensions = getNodeDimensions(nodeData, false, null);

    // Calculate node center in canvas coordinates
    const nodeCenterCanvasX = nodeData.x + nodeDimensions.currentWidth / 2;
    const nodeCenterCanvasY = nodeData.y + nodeDimensions.currentHeight / 2;

    // Apply current transformation
    const nodeScreenX = nodeCenterCanvasX * currentZoom + currentPanX;
    const nodeScreenY = nodeCenterCanvasY * currentZoom + currentPanY + HEADER_HEIGHT;

    // Target is header center
    const screenWidth = containerElement.offsetWidth;
    const headerCenterX = Math.round(screenWidth / 2);
    const headerCenterY = Math.round(HEADER_HEIGHT / 2);

    // Calculate orb size proportional to current zoom
    const orbSize = Math.max(12, Math.round(30 * currentZoom));

    const animationData = {
      nodeId,
      targetGraphId,
      definitionNodeId,
      startTime: performance.now(),
      duration: 400, // slower, more satisfying arc
      startPos: { x: nodeScreenX, y: nodeScreenY - 15 },
      targetPos: { x: headerCenterX, y: headerCenterY },
      nodeColor: nodeData.color || NODE_DEFAULT_COLOR,
      orbSize,
    };

    setHurtleAnimation(animationData);
    runHurtleAnimation(animationData);
  }, [containerRef, runHurtleAnimation]);

  const startHurtleAnimationFromPanel = useCallback((nodeId, targetGraphId, definitionNodeId, startRect) => {
    const currentState = useGraphStore.getState();
    const nodeData = currentState.nodePrototypes.get(nodeId);
    if (!nodeData) {

      return;
    }

    const containerElement = containerRef.current;
    if (!containerElement) {

      return;
    }

    // Get the current pan/zoom from the actual SVG element to ensure accuracy
    const svgElement = containerElement.querySelector('.canvas');
    if (!svgElement) {

      return;
    }

    const transform = svgElement.style.transform;
    const scaleMatch = transform.match(/scale\((-?\d+(?:\.\d+)?)\)/);
    const currentZoom = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    // Start position is the center of the icon's rect
    const startX = startRect.left + startRect.width / 2;
    const startY = startRect.top + startRect.height / 2;

    // Target is header center
    const screenWidth = containerElement.offsetWidth;
    const headerCenterX = Math.round(screenWidth / 2);
    const headerCenterY = Math.round(HEADER_HEIGHT / 2);

    // Calculate orb size proportional to current zoom, same as pie menu animation
    const orbSize = Math.max(12, Math.round(30 * currentZoom));

    const animationData = {
      nodeId,
      targetGraphId,
      definitionNodeId,
      startTime: performance.now(),
      duration: 400, // Slower arc
      startPos: { x: startX, y: startY },
      targetPos: { x: headerCenterX, y: headerCenterY },
      nodeColor: nodeData.color || NODE_DEFAULT_COLOR,
      orbSize: orbSize, // Use calculated, zoom-dependent size
    };

    setHurtleAnimation(animationData);
    runHurtleAnimation(animationData);
  }, [containerRef, runHurtleAnimation]);

  // Use unified control panel actions hook (depends on startHurtleAnimationFromPanel above)
  const {
    handleNodePanelDelete,
    handleNodePanelAdd,
    handleNodePanelUp,
    handleNodePanelOpenInPanel,
    handleNodePanelDecompose,
    handleNodePanelAbstraction,
    handleNodePanelEdit,
    handleNodePanelSave,
    handleNodePanelMore,
    handleNodePanelPalette,
    handleNodePanelGroup
  } = useControlPanelActions({
    activeGraphId,
    selectedInstanceIds,
    selectedNodePrototypes,
    nodes,
    storeActions,
    setSelectedInstanceIds,
    setSelectedGroup,
    setGroupControlPanelShouldShow,
    setNodeControlPanelShouldShow,
    setNodeControlPanelVisible,
    setNodeNamePrompt,
    setPreviewingNodeId,
    setAbstractionCarouselNode,
    setCarouselAnimationState,
    setAbstractionCarouselVisible,
    setSelectedNodeIdForPieMenu,
    rightPanelExpanded,
    setRightPanelExpanded,
    setEditingNodeIdOnCanvas,
    NODE_DEFAULT_COLOR,
    onStartHurtleAnimationFromPanel: startHurtleAnimationFromPanel,
    onOpenColorPicker: handlePieMenuColorPickerOpen
  });

  // Node-group control panel action handlers
  const handleNodeGroupDiveIntoDefinition = useCallback((startRect = null) => {
    if (!activeGraphId || !selectedGroup?.linkedNodePrototypeId) return;

    const prototypeId = selectedGroup.linkedNodePrototypeId;
    const linkedPrototype = nodePrototypesMap.get(prototypeId);

    const openDefinitionGraph = (graphId) => {
      if (!graphId) return;

      if (startRect && typeof startHurtleAnimationFromPanel === 'function') {
        startHurtleAnimationFromPanel(prototypeId, graphId, prototypeId, startRect);
      } else if (typeof storeActions.openGraphTabAndBringToTop === 'function') {
        storeActions.openGraphTabAndBringToTop(graphId, prototypeId);
      } else if (typeof storeActions.openGraphTab === 'function') {
        storeActions.openGraphTab(graphId, prototypeId);
      } else if (typeof storeActions.setActiveGraph === 'function') {
        storeActions.setActiveGraph(graphId);
      } else {
        console.warn('No store action available to activate definition graph for node-group');
      }
    };

    if (linkedPrototype?.definitionGraphIds?.length) {
      openDefinitionGraph(linkedPrototype.definitionGraphIds[0]);
    } else if (typeof storeActions.createAndAssignGraphDefinitionWithoutActivation === 'function') {
      storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);

      setTimeout(() => {
        const refreshedPrototype = useGraphStore.getState().nodePrototypes.get(prototypeId);
        const newGraphId = refreshedPrototype?.definitionGraphIds?.[refreshedPrototype.definitionGraphIds.length - 1];

        if (newGraphId) {
          openDefinitionGraph(newGraphId);
        } else {
          console.warn('Node-group has no definition graph after creation attempt');
        }
      }, 50);
    } else {
      console.warn('Node-group has no definition graph and cannot create one');
    }

    setGroupControlPanelVisible(false);
    setSelectedGroup(null);
  }, [
    activeGraphId,
    selectedGroup,
    nodePrototypesMap,
    storeActions,
    startHurtleAnimationFromPanel,
    setGroupControlPanelVisible,
    setSelectedGroup
  ]);

  const handleNodeGroupOpenInPanel = useCallback(() => {
    if (!activeGraphId || !selectedGroup?.linkedNodePrototypeId) return;

    const linkedPrototype = nodePrototypesMap.get(selectedGroup.linkedNodePrototypeId);
    if (!linkedPrototype) {
      console.warn('Linked node prototype not found');
      return;
    }

    if (typeof storeActions.openRightPanelNodeTab === 'function') {
      storeActions.openRightPanelNodeTab(selectedGroup.linkedNodePrototypeId);
    } else {
      console.warn('openRightPanelNodeTab action is unavailable on storeActions');
    }
  }, [activeGraphId, selectedGroup, nodePrototypesMap, storeActions]);

  const handleNodeGroupCombine = useCallback(() => {
    if (!activeGraphId || !selectedGroup?.id) return;
    if (typeof storeActions.combineNodeGroup !== 'function') {
      console.warn('combineNodeGroup action is unavailable on storeActions');
      return;
    }

    const newInstanceId = storeActions.combineNodeGroup(activeGraphId, selectedGroup.id);

    setGroupControlPanelVisible(false);
    setSelectedGroup(null);

    if (newInstanceId) {
      setSelectedInstanceIds(new Set([newInstanceId]));
    }
  }, [activeGraphId, selectedGroup, storeActions, setSelectedInstanceIds, setGroupControlPanelVisible, setSelectedGroup]);

  // Context Menu options for canvas background
  const getCanvasContextMenuOptions = useCallback(() => {
    return [
      {
        label: 'Merge Duplicates',
        icon: <Merge size={14} />,
        action: () => {

          // Open saved things tab and then merge modal
          storeActions.setRightPanelExpanded(true);
          storeActions.setActiveTab('saved');
          // Add a small delay to ensure tab switch completes, then trigger merge modal
          setTimeout(() => {
            // The merge modal will be triggered from the saved things panel
            // We'll need to add this functionality to the Panel component
            window.dispatchEvent(new CustomEvent('openMergeModal'));
          }, 100);
        }
      }
    ];
  }, [storeActions]);

  // Context Menu options for nodes - core functionality without pie menu transition logic
  const getContextMenuOptions = useCallback((instanceId) => {
    const node = nodes.find(n => n.id === instanceId);
    if (!node) return [];

    // Clockwise order starting from top center: Open Web, Decompose, Generalize/Specify, Delete, Edit, Save, Color
    return [
      // Open Web (expand-tab) - core functionality from PieMenu expand action
      {
        label: 'Open Web',
        icon: <ArrowUpFromDot size={14} />,
        action: () => {
          const nodeData = nodes.find(n => n.id === instanceId);
          if (!nodeData) return;
          const prototypeId = nodeData.prototypeId;
          const currentState = useGraphStore.getState();
          const proto = currentState.nodePrototypes.get(prototypeId);
          if (proto?.definitionGraphIds && proto.definitionGraphIds.length > 0) {
            const targetGraphId = proto.definitionGraphIds[0];
            startHurtleAnimation(instanceId, targetGraphId, prototypeId);
          } else {
            const sourceGraphId = activeGraphId;
            storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);
            setTimeout(() => {
              const refreshed = useGraphStore.getState().nodePrototypes.get(prototypeId);
              if (refreshed?.definitionGraphIds?.length > 0) {
                const newGraphId = refreshed.definitionGraphIds[refreshed.definitionGraphIds.length - 1];
                startHurtleAnimation(instanceId, newGraphId, prototypeId, sourceGraphId);
              } else {

              }
            }, 50);
          }
        }
      },
      // Decompose - open pie menu and auto-trigger decompose
      {
        label: 'Decompose',
        icon: <PackageOpen size={14} />,
        action: () => {
          if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {

            return;
          }



          // Open the pie menu for this node
          setSelectedInstanceIds(new Set([instanceId]));
          setSelectedNodeIdForPieMenu(instanceId);

          // After pie menu appears, auto-trigger the decompose button
          setTimeout(() => {
            const decomposeButton = targetPieMenuButtons.find(btn => btn.id === 'decompose-preview');
            if (decomposeButton && decomposeButton.action) {

              decomposeButton.action(instanceId);
            }
          }, 100); // Small delay to let pie menu appear first
        }
      },
      // Generalize/Specify (abstraction) - directly open carousel without pie menu animation
      {
        label: 'Generalize / Specify',
        icon: <Layers size={14} />,
        action: () => {
          if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {

            return;
          }
          // Directly set up abstraction carousel like onExitAnimationComplete does

          const nodeData = nodes.find(n => n.id === instanceId);
          if (nodeData) {
            setAbstractionCarouselNode(nodeData);
            setCarouselAnimationState('entering');
            setAbstractionCarouselVisible(true);
            setSelectedNodeIdForPieMenu(instanceId);
            setSelectedInstanceIds(new Set([instanceId]));
          }
        }
      },
      // Delete - same as PieMenu
      {
        label: 'Delete',
        icon: <Trash2 size={14} />,
        action: () => {
          storeActions.removeNodeInstance(activeGraphId, instanceId);
          setSelectedInstanceIds(new Set());
          setSelectedNodeIdForPieMenu(null);
        }
      },
      // Edit - same as PieMenu  
      {
        label: 'Edit',
        icon: <Edit3 size={14} />,
        action: () => {
          const instance = nodes.find(n => n.id === instanceId);
          if (instance) {
            storeActions.openRightPanelNodeTab(instance.prototypeId, instance.name);
            if (!rightPanelExpanded) {
              setRightPanelExpanded(true);
            }
            setEditingNodeIdOnCanvas(instanceId);
          }
        }
      },
      // Save - same as PieMenu
      {
        label: (() => {
          const node = nodes.find(n => n.id === instanceId);
          return node && savedNodeIds.has(node.prototypeId) ? 'Unsave' : 'Save';
        })(),
        icon: <Bookmark size={14} fill={(() => {
          const node = nodes.find(n => n.id === instanceId);
          return node && savedNodeIds.has(node.prototypeId) ? 'maroon' : 'none';
        })()} />,
        action: () => {
          const node = nodes.find(n => n.id === instanceId);
          if (node) {
            storeActions.toggleSavedNode(node.prototypeId);
          }
        }
      },
      // Color - needs to ensure node is selected for color picker context
      {
        label: 'Color',
        icon: <Palette size={14} />,
        action: () => {
          const node = nodes.find(n => n.id === instanceId);
          if (node) {
            // Ensure node is selected for color picker context
            setSelectedNodeIdForPieMenu(instanceId);
            setSelectedInstanceIds(new Set([instanceId]));

            // Small delay to ensure selection is set, then open color picker
            setTimeout(() => {
              // Calculate screen coordinates like the PieMenu does
              const dimensions = getNodeDimensions(node, previewingNodeId === node.id, null);
              const nodeCenter = {
                x: node.x + dimensions.currentWidth / 2,
                y: node.y + dimensions.currentHeight / 2
              };
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                const screenX = nodeCenter.x * zoomLevel + panOffset.x + rect.left;
                const screenY = nodeCenter.y * zoomLevel + panOffset.y + rect.top;

                handlePieMenuColorPickerOpen(instanceId, { x: screenX, y: screenY });
              }
            }, 10);
          }
        }
      }
    ];
  }, [nodes, savedNodeIds, abstractionCarouselVisible, carouselAnimationState, previewingNodeId, setPreviewingNodeId, setAbstractionCarouselNode, setCarouselAnimationState, setAbstractionCarouselVisible, setSelectedNodeIdForPieMenu, storeActions, activeGraphId, setSelectedInstanceIds, rightPanelExpanded, setRightPanelExpanded, setEditingNodeIdOnCanvas, getNodeDimensions, containerRef, zoomLevel, panOffset, handlePieMenuColorPickerOpen, startHurtleAnimation, useGraphStore, setIsTransitioningPieMenu]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (hurtleAnimationRef.current) {
        cancelAnimationFrame(hurtleAnimationRef.current);
      }
    };
  }, []);

  // Track if the component has been mounted long enough to show BackToCivilization
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [backToCivilizationDelayComplete, setBackToCivilizationDelayComplete] = useState(false);

  // Add startup delay to prevent showing during initial load
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitialLoadComplete(true);
    }, 2000); // 2 second delay after mount

    return () => clearTimeout(timer);
  }, []);

  // Calculate if nodes are actually visible in the strict viewport (no padding)
  const nodesVisibleInStrictViewport = useMemo(() => {
    if (!nodes || nodes.length === 0 || !panOffset || !zoomLevel || !viewportSize || !canvasSize) {
      return false;
    }

    // Calculate strict viewport bounds in canvas coordinates (no padding like the culling system)
    const viewportMinX = (-panOffset.x) / zoomLevel + canvasSize.offsetX;
    const viewportMinY = (-panOffset.y) / zoomLevel + canvasSize.offsetY;
    const viewportMaxX = viewportMinX + viewportSize.width / zoomLevel;
    const viewportMaxY = viewportMinY + viewportSize.height / zoomLevel;

    // Check if any node intersects with the strict viewport
    for (const node of nodes) {
      const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
      const nodeLeft = node.x;
      const nodeTop = node.y;
      const nodeRight = node.x + dims.currentWidth;
      const nodeBottom = node.y + dims.currentHeight;

      // Check if node intersects with strict viewport (no padding)
      const intersects = !(nodeRight < viewportMinX || nodeLeft > viewportMaxX ||
        nodeBottom < viewportMinY || nodeTop > viewportMaxY);

      if (intersects) {
        return true; // At least one node is visible
      }
    }

    return false; // No nodes are visible in strict viewport
  }, [nodes, panOffset, zoomLevel, viewportSize, canvasSize, baseDimsById]);

  // Optional clustering feature - disabled by default to avoid computational overhead
  const [enableClustering, setEnableClustering] = useState(false);

  // Cluster analysis for the current graph (only when enabled)
  const clusterAnalysis = useMemo(() => {
    if (!enableClustering || !nodes || nodes.length === 0) {
      return { clusters: [], outliers: [], mainCluster: null, statistics: {}, civilizationCenter: null };
    }

    return analyzeNodeDistribution(
      nodes,
      (node) => baseDimsById.get(node.id) || getNodeDimensions(node, false, null),
      {
        adaptiveEpsilon: true,
        minPoints: 2
      }
    );
  }, [enableClustering, nodes, baseDimsById]);

  // Calculate if relevant nodes are visible in strict viewport
  // Uses main cluster if clustering is enabled, otherwise all nodes
  const relevantNodesVisibleInStrictViewport = useMemo(() => {
    const nodesToCheck = enableClustering && clusterAnalysis.mainCluster && clusterAnalysis.mainCluster.length > 0
      ? clusterAnalysis.mainCluster
      : nodes;

    if (!nodesToCheck || nodesToCheck.length === 0 || !panOffset || !zoomLevel || !viewportSize || !canvasSize) {
      return false;
    }

    // Calculate strict viewport bounds in canvas coordinates
    const viewportMinX = (-panOffset.x) / zoomLevel + canvasSize.offsetX;
    const viewportMinY = (-panOffset.y) / zoomLevel + canvasSize.offsetY;
    const viewportMaxX = viewportMinX + viewportSize.width / zoomLevel;
    const viewportMaxY = viewportMinY + viewportSize.height / zoomLevel;

    // Check if any relevant node intersects with the strict viewport
    for (const node of nodesToCheck) {
      const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
      const nodeLeft = node.x;
      const nodeTop = node.y;
      const nodeRight = node.x + dims.currentWidth;
      const nodeBottom = node.y + dims.currentHeight;

      // Check if node intersects with strict viewport
      const intersects = !(nodeRight < viewportMinX || nodeLeft > viewportMaxX ||
        nodeBottom < viewportMinY || nodeTop > viewportMaxY);

      if (intersects) {
        return true; // At least one relevant node is visible
      }
    }

    return false; // No relevant nodes are visible
  }, [enableClustering, clusterAnalysis.mainCluster, nodes, panOffset, zoomLevel, viewportSize, canvasSize, baseDimsById]);

  // Determine if BackToCivilization should be shown
  const shouldShowBackToCivilization = useMemo(() => {
    // Only show if:
    // 1. Initial load is complete (startup delay)
    // 2. Universe is loaded and has a file
    // 3. There's an active graph
    // 4. View is ready (pan/zoom initialized)
    // 5. No nodes are visible in strict viewport
    // 6. There are actually nodes in the graph (just not visible)
    // 7. No UI overlays are active (pie menu, carousels, prompts, etc.)

    if (!isInitialLoadComplete || !isUniverseLoaded || !hasUniverseFile || !activeGraphId || !isViewReady) {
      return false;
    }

    // Don't show if any prompts or overlays are visible
    if (nodeNamePrompt.visible || connectionNamePrompt.visible || abstractionPrompt.visible ||
      abstractionCarouselVisible || selectedNodeIdForPieMenu || plusSign) {
      return false;
    }

    // Don't show if dragging or other interactions are active
    if (draggingNodeInfo || drawingConnectionFrom || isPanning || selectionRect) {
      return false;
    }

    // Check if there are nodes in the graph but none are visible in strict viewport
    // Use cluster-aware visibility if clustering is enabled
    const hasNodesInGraph = nodes && nodes.length > 0;
    const hasNoVisibleNodesInViewport = !relevantNodesVisibleInStrictViewport;

    return hasNodesInGraph && hasNoVisibleNodesInViewport;
  }, [
    isInitialLoadComplete, isUniverseLoaded, hasUniverseFile, activeGraphId, isViewReady,
    nodes, relevantNodesVisibleInStrictViewport,
    nodeNamePrompt.visible, connectionNamePrompt.visible, abstractionPrompt.visible,
    abstractionCarouselVisible, selectedNodeIdForPieMenu, plusSign,
    draggingNodeInfo, drawingConnectionFrom, isPanning, selectionRect
  ]);



  // Expose clustering functions to window for manual use (for debugging/testing)
  useEffect(() => {
    // Expose clustering functions for other parts of the codebase
    window.enableNodeClustering = () => setEnableClustering(true);
    window.disableNodeClustering = () => setEnableClustering(false);
    window.getClusterAnalysis = () => clusterAnalysis;
    window.isClusteringEnabled = () => enableClustering;

    return () => {
      delete window.enableNodeClustering;
      delete window.disableNodeClustering;
      delete window.getClusterAnalysis;
      delete window.isClusteringEnabled;
    };
  }, [clusterAnalysis, enableClustering]);


  // Add appearance delay when conditions are met
  useEffect(() => {
    if (shouldShowBackToCivilization) {
      setBackToCivilizationDelayComplete(false);
      const timer = setTimeout(() => {
        setBackToCivilizationDelayComplete(true);
      }, 800); // 800ms delay before appearing

      return () => clearTimeout(timer);
    } else {
      setBackToCivilizationDelayComplete(false);
    }
  }, [shouldShowBackToCivilization]);

  // Handler for BackToCivilization click - center view on relevant nodes
  const handleBackToCivilizationClick = useCallback(() => {
    // Skip navigation during drag to prevent interference with drag zoom animation
    if (draggingNodeInfoRef.current || isAnimatingZoomRef.current) return;
    if (!nodes || nodes.length === 0 || !containerRef.current) return;

    // Determine which nodes to navigate to based on clustering settings
    const nodesToNavigateTo = enableClustering && clusterAnalysis.mainCluster && clusterAnalysis.mainCluster.length > 0
      ? clusterAnalysis.mainCluster
      : nodes;

    const navigationMode = enableClustering && clusterAnalysis.mainCluster
      ? 'main-cluster'
      : 'all-nodes';

    console.log('[BackToCivilization] Starting navigation...', {
      navigationMode,
      totalNodes: nodes.length,
      nodesToNavigate: nodesToNavigateTo.length,
      clusteringEnabled: enableClustering,
      outlierCount: clusterAnalysis.statistics?.outlierCount || 0
    });

    // Calculate bounding box of relevant nodes
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    nodesToNavigateTo.forEach(node => {
      const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + dims.currentWidth);
      maxY = Math.max(maxY, node.y + dims.currentHeight);
    });

    // Calculate the center of relevant nodes
    const nodesCenterX = (minX + maxX) / 2;
    const nodesCenterY = (minY + maxY) / 2;
    const nodesWidth = maxX - minX;
    const nodesHeight = maxY - minY;

    console.log('[BackToCivilization] Target area:', {
      center: { x: Math.round(nodesCenterX), y: Math.round(nodesCenterY) },
      size: { width: Math.round(nodesWidth), height: Math.round(nodesHeight) },
      bounds: { minX: Math.round(minX), minY: Math.round(minY), maxX: Math.round(maxX), maxY: Math.round(maxY) }
    });

    // Calculate appropriate zoom level with padding
    const padding = 150;
    const targetZoomX = viewportSize.width / (nodesWidth + padding * 2);
    const targetZoomY = viewportSize.height / (nodesHeight + padding * 2);
    let targetZoom = Math.min(targetZoomX, targetZoomY);

    // Clamp zoom to reasonable bounds
    targetZoom = Math.max(Math.min(targetZoom, MAX_ZOOM), 0.2);

    // Calculate pan to center the target area (accounting for canvas offset)
    const targetPanX = (viewportSize.width / 2) - (nodesCenterX - canvasSize.offsetX) * targetZoom;
    const targetPanY = (viewportSize.height / 2) - (nodesCenterY - canvasSize.offsetY) * targetZoom;

    // Apply bounds constraints
    const maxPanX = 0;
    const minPanX = viewportSize.width - canvasSize.width * targetZoom;
    const maxPanY = 0;
    const minPanY = viewportSize.height - canvasSize.height * targetZoom;

    const finalPanX = Math.min(Math.max(targetPanX, minPanX), maxPanX);
    const finalPanY = Math.min(Math.max(targetPanY, minPanY), maxPanY);

    console.log('[BackToCivilization] Applying navigation:', {
      targetZoom: Math.round(targetZoom * 1000) / 1000,
      finalPan: { x: Math.round(finalPanX), y: Math.round(finalPanY) }
    });

    // Apply the new view state
    setZoomLevel(targetZoom);
    setPanOffset({ x: finalPanX, y: finalPanY });
  }, [enableClustering, clusterAnalysis, nodes, baseDimsById, viewportSize, canvasSize, MAX_ZOOM]);

  // Listen for auto-layout trigger events from AI operations (mutations)
  useEffect(() => {
    let debounceTimer = null;

    const handleTriggerAutoLayout = (event) => {
      const { graphId } = event.detail || {};

      // Only trigger if this is the active graph
      if (!graphId || graphId === activeGraphId) {
        // Clear existing timer (debounce mechanism)
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        // Debounce for 500ms to batch rapid mutations
        // This prevents layout thrashing during quick wizard operations
        debounceTimer = setTimeout(() => {
          applyAutoLayoutToActiveGraph();
          debounceTimer = null;
        }, 500);
      }
    };

    window.addEventListener('rs-trigger-auto-layout', handleTriggerAutoLayout);

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      window.removeEventListener('rs-trigger-auto-layout', handleTriggerAutoLayout);
    };
  }, [applyAutoLayoutToActiveGraph, activeGraphId]);

  // Listen for auto-layout completion events from AI operations
  useEffect(() => {
    const handleAutoLayoutComplete = (event) => {
      const { graphId } = event.detail || {};
      // Only trigger if this is the active graph
      if (!graphId || graphId === activeGraphId) {
        // Small delay to ensure nodes are rendered before centering
        setTimeout(() => {
          handleBackToCivilizationClick();
        }, 100);
      }
    };

    window.addEventListener('rs-auto-layout-complete', handleAutoLayoutComplete);
    return () => {
      window.removeEventListener('rs-auto-layout-complete', handleAutoLayoutComplete);
    };
  }, [handleBackToCivilizationClick, activeGraphId]);

  // Listen for navigation events from the Wizard and other systems
  useEffect(() => {
    const handleNavigateTo = (event) => {
      // Skip navigation during drag to prevent interference with drag zoom animation
      if (draggingNodeInfoRef.current || isAnimatingZoomRef.current) return;

      const detail = event.detail || {};
      const { mode, graphId, nodeIds, targetX, targetY, targetZoom, padding = 100, minZoom = 0.3, maxZoom: navMaxZoom = 1.5 } = detail;

      // Only navigate if this is the active graph (or no graphId specified)
      if (graphId && graphId !== activeGraphId) return;

      // Handle different navigation modes
      switch (mode) {
        case NavigationMode.FIT_CONTENT: {
          // Use existing back-to-civilization logic to fit all content
          handleBackToCivilizationClick();
          break;
        }

        case NavigationMode.FOCUS_NODES: {
          // Navigate to focus on specific nodes
          if (!nodeIds || nodeIds.length === 0 || !nodes || nodes.length === 0) {
            handleBackToCivilizationClick();
            return;
          }

          // Find the specified nodes
          const targetNodes = nodes.filter(n => nodeIds.includes(n.id));
          if (targetNodes.length === 0) {
            console.warn('[CanvasNav] No matching nodes found for IDs:', nodeIds);
            handleBackToCivilizationClick();
            return;
          }

          // Calculate bounding box of target nodes
          let minX = Infinity, minY = Infinity;
          let maxX = -Infinity, maxY = -Infinity;

          targetNodes.forEach(node => {
            const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + dims.currentWidth);
            maxY = Math.max(maxY, node.y + dims.currentHeight);
          });

          // Calculate navigation parameters
          const navParams = calculateNavigationParams(
            { minX, minY, maxX, maxY },
            viewportSize,
            canvasSize,
            { padding, minZoom, maxZoom: Math.min(navMaxZoom, MAX_ZOOM) }
          );

          // Apply navigation
          setZoomLevel(navParams.zoom);
          setPanOffset({ x: navParams.panX, y: navParams.panY });
          console.log('[CanvasNav] Navigated to nodes:', { nodeIds, zoom: navParams.zoom });
          break;
        }

        case NavigationMode.COORDINATES: {
          // Navigate to specific coordinates
          if (typeof targetX !== 'number' || typeof targetY !== 'number') {
            console.warn('[CanvasNav] Invalid coordinates:', { targetX, targetY });
            return;
          }

          const effectiveZoom = Math.max(minZoom, Math.min(targetZoom || 1, navMaxZoom, MAX_ZOOM));

          // Calculate pan to center on target coordinates
          const targetPanX = (viewportSize.width / 2) - (targetX - canvasSize.offsetX) * effectiveZoom;
          const targetPanY = (viewportSize.height / 2) - (targetY - canvasSize.offsetY) * effectiveZoom;

          // Apply bounds constraints
          const maxPanX = 0;
          const minPanX = viewportSize.width - canvasSize.width * effectiveZoom;
          const maxPanY = 0;
          const minPanY = viewportSize.height - canvasSize.height * effectiveZoom;

          setZoomLevel(effectiveZoom);
          setPanOffset({
            x: Math.min(Math.max(targetPanX, minPanX), maxPanX),
            y: Math.min(Math.max(targetPanY, minPanY), maxPanY)
          });
          console.log('[CanvasNav] Navigated to coordinates:', { x: targetX, y: targetY, zoom: effectiveZoom });
          break;
        }

        case NavigationMode.CENTER: {
          // Navigate to canvas center
          const defaultZoom = 1;
          const centerPanX = viewportSize.width / 2 - (canvasSize.width / 2) * defaultZoom;
          const centerPanY = viewportSize.height / 2 - (canvasSize.height / 2) * defaultZoom;

          const maxPanX = 0;
          const minPanX = viewportSize.width - canvasSize.width * defaultZoom;
          const maxPanY = 0;
          const minPanY = viewportSize.height - canvasSize.height * defaultZoom;

          setZoomLevel(defaultZoom);
          setPanOffset({
            x: Math.min(Math.max(centerPanX, minPanX), maxPanX),
            y: Math.min(Math.max(centerPanY, minPanY), maxPanY)
          });
          console.log('[CanvasNav] Navigated to center');
          break;
        }

        default:
          console.warn('[CanvasNav] Unknown navigation mode:', mode);
      }
    };

    window.addEventListener('rs-navigate-to', handleNavigateTo);
    return () => {
      window.removeEventListener('rs-navigate-to', handleNavigateTo);
    };
  }, [activeGraphId, nodes, baseDimsById, viewportSize, canvasSize, handleBackToCivilizationClick, MAX_ZOOM]);

  return (
    <div
      className="node-canvas-container"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'transparent',
        transition: 'background-color 0.3s ease',
      }}
      tabIndex="0"
      onBlur={() => keysPressed.current = {}}
    >
      {/* Main content uncommented */}

      <Header
        onTitleChange={handleProjectTitleChange}
        onEditingStateChange={setIsHeaderEditing}
        headerGraphs={headerGraphs}
        onSetActiveGraph={storeActions.setActiveGraph}
        onCreateNewThing={() => storeActions.createNewGraph({ name: 'New Thing' })}
        onOpenComponentSearch={() => setHeaderSearchVisible(true)}
        // Receive debug props
        debugMode={debugMode}
        setDebugMode={setDebugMode}
        trackpadZoomEnabled={trackpadZoomEnabled}
        onToggleTrackpadZoom={() => setTrackpadZoomEnabled(prev => !prev)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        bookmarkActive={bookmarkActive}
        onBookmarkToggle={handleToggleBookmark}
        showConnectionNames={showConnectionNames}
        onToggleShowConnectionNames={storeActions.toggleShowConnectionNames}
        enableAutoRouting={enableAutoRouting}
        routingStyle={routingStyle}
        manhattanBends={manhattanBends}
        onToggleEnableAutoRouting={storeActions.toggleEnableAutoRouting}
        onSetRoutingStyle={storeActions.setRoutingStyle}
        onSetManhattanBends={storeActions.setManhattanBends}
        onSetCleanLaneSpacing={(v) => useGraphStore.getState().setCleanLaneSpacing(v)}
        cleanLaneSpacing={cleanLaneSpacing}
        groupLayoutAlgorithm={groupLayoutAlgorithm}
        onSetGroupLayoutAlgorithm={storeActions.setGroupLayoutAlgorithm}
        showClusterHulls={showClusterHulls}
        onToggleShowClusterHulls={storeActions.toggleShowClusterHulls}

        // Grid controls
        gridMode={gridMode}
        onSetGridMode={(m) => useGraphStore.getState().setGridMode(m)}
        gridSize={gridSize}
        onSetGridSize={(v) => useGraphStore.getState().setGridSize(v)}

        onGenerateTestGraph={() => {
          setAutoGraphModalVisible(true);
        }}
        onOpenForceSim={() => {
          setForceSimModalVisible(true);
        }}
        onAutoLayoutGraph={applyAutoLayoutToActiveGraph}
        onCondenseNodes={condenseGraphNodes}
        onNewUniverse={async () => {
          try {

            // storeActions.clearUniverse(); // This is redundant

            const { createUniverseFile, enableAutoSave } = fileStorage;
            const initialData = await createUniverseFile();

            if (initialData !== null) {
              storeActions.loadUniverseFromFile(initialData);

              // Enable auto-save for the new universe
              enableAutoSave(() => useGraphStore.getState());


              // Ensure universe connection is marked as established
              storeActions.setUniverseConnected(true);
            }
          } catch (error) {

            storeActions.setUniverseError(`Failed to create universe: ${error.message}`);
          }
        }}
        onOpenUniverse={async () => {
          try {
            // Check if user has unsaved work
            const currentState = useGraphStore.getState();
            const hasGraphs = currentState.graphs.size > 0;
            const hasNodes = currentState.nodePrototypes.size > 0;

            if (hasGraphs || hasNodes) {
              const confirmed = confirm(
                'Opening a different universe file will replace your current work.\n\n' +
                'Make sure your current work is saved first.\n\n' +
                'Continue with opening a different universe file?'
              );
              if (!confirmed) {

                return;
              }
            }


            // storeActions.clearUniverse(); // This is redundant

            const { openUniverseFile, enableAutoSave, getFileStatus } = fileStorage;
            const loadedData = await openUniverseFile();



            if (loadedData !== null) {

              storeActions.loadUniverseFromFile(loadedData);

              // Enable auto-save for the opened universe
              enableAutoSave(() => useGraphStore.getState());

              // Debug: check file status after load
              const fileStatus = getFileStatus();




              // Ensure universe connection is marked as established
              storeActions.setUniverseConnected(true);
            } else {

            }
          } catch (error) {

            storeActions.setUniverseError(`Failed to open universe: ${error.message}`);
          }
        }}
        onSaveUniverse={async () => {
          try {

            const { forceSave, canAutoSave, getFileStatus } = fileStorage;

            // Debug: check file status
            const fileStatus = getFileStatus();


            if (canAutoSave()) {
              const currentState = useGraphStore.getState();


              const saveResult = await forceSave(currentState);


              if (saveResult) {

                alert('Universe saved successfully!');
              } else {

                alert('Save failed for unknown reason.');
              }
            } else {

              alert('No universe file is currently open. Please create or open a universe first.');
            }
          } catch (error) {

            alert(`Failed to save universe: ${error.message}`);
          }
        }}
        onExportRdf={async () => {
          try {

            const { exportToRdfTurtle } = await import('./formats/rdfExport.js');

            const currentState = useGraphStore.getState();
            const rdfData = await exportToRdfTurtle(currentState);

            // Create a download link
            const blob = new Blob([rdfData], { type: 'application/n-quads' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'cognitive-space.nq';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);


          } catch (error) {

            alert(`Failed to export RDF: ${error.message}`);
          }
        }}
        onOpenRecentFile={async (recentFileEntry) => {
          try {
            // Check if user has unsaved work
            const currentState = useGraphStore.getState();
            const hasGraphs = currentState.graphs.size > 0;
            const hasNodes = currentState.nodePrototypes.size > 0;

            if (hasGraphs || hasNodes) {
              const confirmed = confirm(
                `Opening "${recentFileEntry.fileName}" will replace your current work.\n\n` +
                'Make sure your current work is saved first.\n\n' +
                'Continue?'
              );
              if (!confirmed) {

                return;
              }
            }


            // storeActions.clearUniverse(); // This is redundant

            const { openRecentFile, enableAutoSave, getFileStatus } = fileStorage;
            const loadedData = await openRecentFile(recentFileEntry);



            if (loadedData !== null) {

              storeActions.loadUniverseFromFile(loadedData);

              // Enable auto-save for the opened universe
              enableAutoSave(() => useGraphStore.getState());

              // Debug: check file status after load
              const fileStatus = getFileStatus();




              // Ensure universe connection is marked as established
              storeActions.setUniverseConnected(true);
            } else {

            }
          } catch (error) {

            storeActions.setUniverseError(`Failed to open recent file: ${error.message}`);
            alert(`Failed to open "${recentFileEntry.fileName}": ${error.message}`);
          }
        }}
      />
      <div style={{ display: 'flex', flexGrow: 1, position: 'relative', overflow: 'hidden' }}>
        <Panel
          key="left-panel"
          ref={leftPanelRef}
          side="left"
          isExpanded={leftPanelExpanded}
          onToggleExpand={handleToggleLeftPanel}
          onFocusChange={handleLeftPanelFocusChange}
          activeGraphId={activeGraphId}
          storeActions={storeActions}
          graphName={activeGraphName}
          graphDescription={activeGraphDescription}
          nodeDefinitionIndices={nodeDefinitionIndices}
          onStartHurtleAnimationFromPanel={startHurtleAnimationFromPanel}
          leftPanelExpanded={leftPanelExpanded}
          rightPanelExpanded={rightPanelExpanded}
          selectedInstanceIds={selectedInstanceIds}
          hydratedNodes={hydratedNodes}
          initialViewActive={leftPanelInitialView}
        />

        <div
          ref={setCanvasAreaRef}
          className="canvas-area"
          style={{
            flexGrow: 1,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#bdb5b5',
            touchAction: 'none',
          }}
          // Event handlers uncommented
          onWheel={handleWheel}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUpCanvas}
          onMouseLeave={clearVisionAid}
          onClick={handleCanvasClick}
          onTouchStart={handleTouchStartCanvas}
          onTouchMove={handleTouchMoveCanvas}
          onTouchEnd={handleTouchEndCanvas}
          onTouchCancel={handleTouchEndCanvas}
          onContextMenu={(e) => {
            // Prevent context menu on canvas (disable long-press right-click behavior)
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {isUniverseLoading ? (
            // Show loading state while checking for universe file
            <div
              style={{
                height: '100%',
                backgroundColor: '#bdb5b5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '16px',
                fontFamily: "'EmOne', sans-serif",
                color: '#260000',
                letterSpacing: '0.06em',
                fontSize: '18px',
                pointerEvents: 'none'
              }}
            >
              <div className="loading-spinner" style={{ borderColor: '#979090', borderTopColor: '#260000', width: 52, height: 52 }} />
              <div>Preparing your universe…</div>
            </div>
          ) : (!isUniverseLoaded || !hasUniverseFile) ? (
            // Show simplified universe loading screen
            <div style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#bdb5b5'
            }}>
              {/* Main content area - mostly empty, just branding */}
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#555'
              }}>
                <div style={{
                  fontSize: '32px',
                  fontFamily: "'EmOne', sans-serif",
                  color: '#260000',
                  opacity: 0.8,
                  textAlign: 'center'
                }}>
                  Redstring
                  <div style={{
                    fontSize: '12px',
                    color: '#666',
                    marginTop: '8px',
                    opacity: 0.6
                  }}>
                    Loading...
                  </div>
                </div>
              </div>

              {/* Error message at bottom with proper margins */}
              {universeLoadingError && (
                <div style={{
                  padding: '20px',
                  marginBottom: '100px', // Account for TypeList
                  textAlign: 'center',
                  color: '#d32f2f',
                  fontSize: '14px',
                  fontFamily: "'EmOne', sans-serif",
                  backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(211, 47, 47, 0.3)',
                  borderRadius: '8px',
                  maxWidth: '500px',
                  margin: '0 auto 100px auto'
                }}>
                  {universeLoadingError}
                </div>
              )}
            </div>
          ) : !activeGraphId ? ( // Check local state
            <div style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '24px',
              fontFamily: "'EmOne', sans-serif"
            }}>
              <div style={{ fontSize: '16px', color: '#260000', opacity: 0.7 }}>
                Open a New Thing
              </div>
              <button
                onClick={() => storeActions.createNewGraph({ name: 'New Thing' })}
                style={{
                  width: '120px',
                  height: '120px',
                  backgroundColor: 'transparent',
                  border: '3px dotted #260000',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  outline: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(38, 0, 0, 0.05)';
                  e.currentTarget.style.borderWidth = '4px';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.borderWidth = '3px';
                }}
                title="Create New Thing"
              >
                <Plus size={48} strokeWidth={2} color="#260000" />
              </button>
            </div>
          ) : (
            <>
              <svg
                className="canvas"
                width={canvasSize.width}
                height={canvasSize.height}
                style={{
                  transform: `translate(${panOffset.x - canvasSize.offsetX * zoomLevel}px, ${panOffset.y - canvasSize.offsetY * zoomLevel}px) scale(${zoomLevel})`,
                  transformOrigin: '0 0',
                  backgroundColor: '#bdb5b5',
                  opacity: 1,
                  pointerEvents: 'auto',
                  overflow: 'visible',
                  touchAction: 'none',
                }}
                onMouseUp={handleMouseUp} // Uncommented
                onMouseMove={handleMouseMove}
              // Remove pointerDown preventDefault to avoid interfering with gestures
              >
                {/* Cluster Hulls Layer (Debug) */}
                {showClusterHulls && (() => {
                  const geometries = getClusterGeometries(hydratedNodes, edges);
                  return (
                    <g className="cluster-hulls-layer">
                      {geometries.map((geo, idx) => {
                        if (geo.hull.length < 3) return null;
                        const pointsStr = geo.hull.map(p => `${p.x},${p.y}`).join(' ');
                        const colors = ['#4ecdc4', '#ff6b6b', '#ffe66d', '#1a535c', '#f7fff7'];
                        const color = colors[idx % colors.length];
                        return (
                          <polygon
                            key={idx}
                            points={pointsStr}
                            fill={color}
                            fillOpacity="0.1"
                            stroke={color}
                            strokeWidth="4"
                            strokeOpacity="0.3"
                            strokeDasharray="8,8"
                            style={{ pointerEvents: 'none' }}
                          />
                        );
                      })}
                    </g>
                  );
                })()}

                {/* Groups layer - render group rectangles behind nodes */}
                {(() => {
                  const graphData = activeGraphId ? graphsMap.get(activeGraphId) : null;
                  const groups = graphData?.groups ? Array.from(graphData.groups.values()) : [];
                  if (!groups.length) return null;
                  return (
                    <g className="groups-layer">
                      {groups.map(group => {
                        // Compute bounding box of member nodes with margin
                        const members = hydratedNodes.filter(n => group.memberInstanceIds.includes(n.id));
                        if (!members.length) return null;
                        const dims = members.map(n => getNodeDimensions(n, false, null));
                        const xs = members.map((n, i) => n.x);
                        const ys = members.map((n, i) => n.y);
                        const rights = members.map((n, i) => n.x + dims[i].currentWidth);
                        const bottoms = members.map((n, i) => n.y + dims[i].currentHeight);
                        const minX = Math.min(...xs);
                        const minY = Math.min(...ys);
                        const maxX = Math.max(...rights);
                        const maxY = Math.max(...bottoms);

                        // GROUP LAYOUT CONSTANTS - consolidated for easier adjustment
                        const GROUP_SPACING = {
                          memberBoundaryPadding: Math.max(24, Math.round(gridSize * 0.2)), // Space between members and member boundary
                          innerCanvasBorder: 32,        // Width of colored border around inner canvas (for node-groups)
                          titleToCanvasGap: 24,         // Vertical gap between title bottom and inner canvas top
                          titlePaddingVertical: 12,     // Top/bottom padding inside title bar
                          titlePaddingHorizontal: 32,   // Left/right padding inside title bar
                          titleTopMargin: 24,           // Space above title within colored background (for node-groups)
                          titleBottomMargin: 24,        // Space below title within colored background (for node-groups)
                          cornerRadius: 12,             // Corner radius for regular groups
                          nodeGroupCornerRadius: 24,    // Corner radius for node-groups (more rounded)
                          strokeWidth: 2,               // Stroke width for group borders
                          fontSize: 36,                 // Title text size
                        };

                        const margin = GROUP_SPACING.memberBoundaryPadding;
                        const rectX = minX - margin;
                        const rectY = minY - margin;
                        const rectW = (maxX - minX) + margin * 2;
                        const rectH = (maxY - minY) + margin * 2;
                        const cornerR = GROUP_SPACING.cornerRadius;
                        const nodeGroupCornerR = GROUP_SPACING.nodeGroupCornerRadius;
                        const strokeColor = group.color || '#8B0000';
                        const fontSize = GROUP_SPACING.fontSize;
                        const labelPaddingVertical = GROUP_SPACING.titlePaddingVertical;
                        const labelPaddingHorizontal = GROUP_SPACING.titlePaddingHorizontal;
                        const strokeWidth = GROUP_SPACING.strokeWidth;

                        // Calculate dynamic label size using accurate text measurement
                        const currentText = editingGroupId === group.id ? tempGroupName : (group.name || 'Group');
                        const measuredTextWidth = getTextWidth(currentText, `bold ${fontSize}px "EmOne", sans-serif`);
                        // Scale label width strictly by text content, not group width
                        const labelWidth = Math.min(1000, Math.max(100, measuredTextWidth + (labelPaddingHorizontal * 2) + (strokeWidth * 2)));
                        const labelHeight = Math.max(80, fontSize * 1.4 + (labelPaddingVertical * 2)); // Balanced vertical padding
                        const labelX = rectX + (rectW - labelWidth) / 2; // Center horizontally on group
                        const labelY = rectY - labelHeight - GROUP_SPACING.titleToCanvasGap; // Space above group for nametag effect
                        const labelText = group.name || 'Group';
                        const isGroupSelected = !!(selectedGroup && selectedGroup.id === group.id);
                        const isGroupDragging = draggingNodeInfo?.groupId === group.id;

                        // Check if this is a node-group
                        const isNodeGroup = !!group.linkedNodePrototypeId;
                        const nodeGroupPrototype = isNodeGroup ? nodePrototypesMap.get(group.linkedNodePrototypeId) : null;
                        const nodeGroupColor = nodeGroupPrototype?.color || strokeColor;

                        // For node-groups, extend rectangle to cover the name tag area
                        const nodeGroupTopMargin = GROUP_SPACING.titleTopMargin;
                        const nodeGroupBottomMargin = GROUP_SPACING.titleBottomMargin;
                        const nodeGroupRectY = isNodeGroup ? labelY - nodeGroupTopMargin : rectY;
                        const nodeGroupRectH = isNodeGroup ? (rectY + rectH) - (labelY - nodeGroupTopMargin) : rectH;

                        // Calculate inner canvas position for node-groups
                        // For node-groups: start titleBottomMargin below the label
                        // For regular groups: use normal innerCanvasBorder inset
                        const innerCanvasY = isNodeGroup ? (labelY + labelHeight + nodeGroupBottomMargin) : (rectY + GROUP_SPACING.innerCanvasBorder);

                        // Calculate scale and transform for dragging animation
                        const groupScale = isGroupDragging ? 1.05 : 1;
                        const centerX = rectX + rectW / 2;
                        const centerY = rectY + rectH / 2;
                        const groupTransform = isGroupDragging
                          ? `translate(${centerX}, ${centerY}) scale(${groupScale}) translate(${-centerX}, ${-centerY})`
                          : '';

                        return (
                          <g key={group.id} className={isNodeGroup ? "node-group" : "group"} data-group-id={group.id}
                            style={{
                              transform: groupTransform,
                              transformOrigin: `${centerX}px ${centerY}px`,
                              transition: isGroupDragging ? 'none' : 'transform 0.2s ease-out',
                              filter: isGroupDragging ? 'drop-shadow(0px 8px 16px rgba(0,0,0,0.3))' : 'none'
                            }}
                          >
                            {isNodeGroup ? (
                              <>
                                {/* NODE-GROUP RENDERING */}
                                {/* 1. Outer colored background rectangle (extends up to cover title) */}
                                <rect
                                  x={rectX}
                                  y={nodeGroupRectY}
                                  width={rectW}
                                  height={nodeGroupRectH}
                                  rx={nodeGroupCornerR}
                                  ry={nodeGroupCornerR}
                                  fill={nodeGroupColor}
                                  stroke="none"
                                />
                                {/* 2. Inner canvas-colored rectangle (the actual canvas area) */}
                                <rect
                                  x={rectX + GROUP_SPACING.innerCanvasBorder}
                                  y={innerCanvasY}
                                  width={rectW - (GROUP_SPACING.innerCanvasBorder * 2)}
                                  height={(rectY + rectH) - innerCanvasY - GROUP_SPACING.innerCanvasBorder}
                                  rx={12}
                                  ry={12}
                                  fill="#bdb5b5"
                                  stroke="none"
                                  style={{ cursor: 'default', pointerEvents: 'auto' }}
                                  onClick={(e) => {
                                    // Stop propagation to prevent group selection/drag
                                    e.stopPropagation();

                                    // Ignore if various conditions are active
                                    if (isPaused || draggingNodeInfo || drawingConnectionFrom || mouseMoved.current || recentlyPanned || nodeNamePrompt.visible || !activeGraphId) {
                                      return;
                                    }

                                    // Close Group panel on click-off like other panels
                                    if (groupControlPanelShouldShow || groupControlPanelVisible || selectedGroup) {
                                      if (groupControlPanelShouldShow || groupControlPanelVisible) {
                                        setGroupControlPanelVisible(false);
                                      }
                                      if (selectedGroup) {
                                        setSelectedGroup(null);
                                      }
                                      return;
                                    }

                                    // Close carousel if visible
                                    if (abstractionCarouselVisible && !selectedNodeIdForPieMenu) {
                                      setAbstractionCarouselVisible(false);
                                      setAbstractionCarouselNode(null);
                                      setCarouselAnimationState('hidden');
                                      setCarouselPieMenuStage(1);
                                      setCarouselFocusedNode(null);
                                      setCarouselFocusedNodeDimensions(null);
                                      return;
                                    }

                                    // If carousel is visible and exiting, don't handle clicks
                                    if (abstractionCarouselVisible && carouselAnimationState === 'exiting') {
                                      return;
                                    }

                                    // Deselect nodes if any are selected
                                    if (selectedInstanceIds.size > 0) {
                                      // Don't clear selection if we just completed a carousel exit
                                      if (justCompletedCarouselExit || carouselExitInProgressRef.current) {
                                        return;
                                      }
                                      setSelectedInstanceIds(new Set());
                                      return;
                                    }

                                    // Deselect edges if any are selected
                                    if ((selectedEdgeId || selectedEdgeIds.size > 0) && !hoveredEdgeInfo) {
                                      storeActions.setSelectedEdgeId(null);
                                      storeActions.clearSelectedEdgeIds();
                                      return;
                                    }
                                  }}
                                />
                              </>
                            ) : (
                              // REGULAR GROUP RENDERING - dashed outline only
                              <rect
                                x={rectX}
                                y={rectY}
                                width={rectW}
                                height={rectH}
                                rx={nodeGroupCornerR}
                                ry={nodeGroupCornerR}
                                fill="none"
                                stroke={strokeColor}
                                strokeWidth={12}
                                strokeDasharray="16 12"
                                vectorEffect="non-scaling-stroke"
                              />
                            )}
                            {/* Draggable label behaving like a node handle with inline editing */}
                            <g className="group-label" style={{ cursor: 'pointer' }}
                              onClick={(e) => {
                                e.stopPropagation();

                                // Prevent click if we were dragging (checked via ref set in mouseUp)
                                if (wasDraggingRef.current || mouseMoved.current) {
                                  return;
                                }

                                // Double-click to edit, single click to select
                                if (e.detail === 2) {
                                  setEditingGroupId(group.id);
                                  setTempGroupName(group.name || 'Group');
                                } else {
                                  // Select group and show control panel
                                  setSelectedGroup(group);
                                  setGroupControlPanelShouldShow(true);
                                  // Hide ALL other control panels
                                  setNodeControlPanelShouldShow(false);
                                  setAbstractionControlPanelVisible(false);
                                  setAbstractionControlPanelShouldShow(false);
                                  setConnectionControlPanelVisible(false);
                                  setConnectionControlPanelShouldShow(false);
                                }
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                // Skip drag setup if editing
                                if (editingGroupId === group.id) return;

                                // Long-press to start drag, just like nodes
                                clearTimeout(groupLongPressTimeout.current);
                                const downX = e.clientX; const downY = e.clientY;
                                groupLongPressTimeout.current = setTimeout(() => {
                                  const rect = containerRef.current.getBoundingClientRect();
                                  const mouseCanvasX = (downX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
                                  const mouseCanvasY = (downY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
                                  const offsets = members.map(m => ({ id: m.id, dx: mouseCanvasX - m.x, dy: mouseCanvasY - m.y }));
                                  setDraggingNodeInfo({ groupId: group.id, memberOffsets: offsets });
                                  triggerDragZoomOut(downX, downY);
                                }, LONG_PRESS_DURATION);
                              }}
                              onMouseUp={() => { clearTimeout(groupLongPressTimeout.current); }}
                              onMouseLeave={() => { clearTimeout(groupLongPressTimeout.current); }}
                            >
                              <rect x={labelX} y={labelY} width={labelWidth} height={labelHeight} rx={20} ry={20}
                                fill={isNodeGroup ? "none" : "#bdb5b5"}
                                stroke={isNodeGroup ? "none" : strokeColor}
                                strokeWidth={isNodeGroup ? 0 : 6}
                                vectorEffect="non-scaling-stroke"
                                style={{
                                  transform: draggingNodeInfo?.groupId === group.id ? `scale(1.08)` : 'scale(1)',
                                  transformOrigin: `${labelX + labelWidth / 2}px ${labelY + labelHeight / 2}px`,
                                  filter: draggingNodeInfo?.groupId === group.id ? 'drop-shadow(0px 5px 10px rgba(0,0,0,0.3))' : 'none'
                                }}
                              />

                              {editingGroupId === group.id ? (
                                <foreignObject x={labelX} y={labelY} width={labelWidth} height={labelHeight}
                                  style={{ pointerEvents: 'auto' }}>
                                  <div style={{
                                    width: '100%',
                                    height: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxSizing: 'border-box'
                                  }}>
                                    <input
                                      type="text"
                                      value={tempGroupName}
                                      onChange={(e) => {
                                        setTempGroupName(e.target.value);
                                        // Force re-render to update label dimensions
                                        // The component will re-calculate labelWidth based on tempGroupName
                                      }}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === 'Enter') {
                                          const newName = tempGroupName.trim();
                                          if (newName && activeGraphId) {
                                            storeActions.updateGroup(activeGraphId, group.id, (draft) => {
                                              draft.name = newName;
                                            });
                                            // Update selected group state if this group is selected
                                            if (selectedGroup?.id === group.id) {
                                              setSelectedGroup(prev => prev ? { ...prev, name: newName } : null);
                                            }
                                          }
                                          setEditingGroupId(null);
                                        } else if (e.key === 'Escape') {
                                          setEditingGroupId(null);
                                          setTempGroupName('');
                                        }
                                      }}
                                      onBlur={() => {
                                        const newName = tempGroupName.trim();
                                        if (newName && activeGraphId && newName !== group.name) {
                                          storeActions.updateGroup(activeGraphId, group.id, (draft) => {
                                            draft.name = newName;
                                          });
                                          // Update selected group state if this group is selected
                                          if (selectedGroup?.id === group.id) {
                                            setSelectedGroup(prev => prev ? { ...prev, name: newName } : null);
                                          }
                                        }
                                        setEditingGroupId(null);
                                      }}
                                      autoFocus
                                      style={{
                                        width: `calc(100% - ${labelPaddingHorizontal * 2}px)`,
                                        height: `calc(100% - ${labelPaddingVertical * 2}px)`,
                                        margin: `${labelPaddingVertical}px ${labelPaddingHorizontal}px`,
                                        fontSize: `${fontSize}px`,
                                        fontFamily: 'EmOne, sans-serif',
                                        fontWeight: 'bold',
                                        color: isNodeGroup
                                          ? getTextColor(nodeGroupColor)
                                          : (hexToHsl(strokeColor).l > 50 ? getTextColor(strokeColor) : strokeColor),
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        outline: 'none',
                                        textAlign: 'center',
                                        boxSizing: 'border-box'
                                      }}
                                    />
                                  </div>
                                </foreignObject>
                              ) : (
                                <text x={labelX + labelWidth / 2} y={labelY + labelHeight * 0.7 - 2} fontFamily="EmOne, sans-serif" fontSize={fontSize}
                                  fill={isNodeGroup
                                    ? getTextColor(nodeGroupColor)
                                    : (hexToHsl(strokeColor).l > 50 ? getTextColor(strokeColor) : strokeColor)
                                  } fontWeight="bold" stroke={isNodeGroup ? "none" : "#bdb5b5"} strokeWidth={isNodeGroup ? 0 : strokeWidth} paintOrder="stroke fill" textAnchor="middle">{labelText}</text>
                              )}
                            </g>
                          </g>
                        );
                      })}
                    </g>
                  );
                })()}
                {/* Grid overlay (optimized) */}
                {(gridMode === 'always' || (gridMode === 'hover' && !!draggingNodeInfo)) && (
                  <g className="grid-overlay" pointerEvents="none">
                    {/* Thin line grid for 'always' using individual lines for better zoom handling */}
                    {gridMode === 'always' && (() => {
                      const lines = [];
                      // Account for canvas offset in grid calculations
                      const viewMinX = (-panOffset.x / zoomLevel) + canvasSize.offsetX;
                      const viewMinY = (-panOffset.y / zoomLevel) + canvasSize.offsetY;
                      const startX = Math.floor(viewMinX / gridSize) * gridSize - gridSize * 5;
                      const startY = Math.floor(viewMinY / gridSize) * gridSize - gridSize * 5;
                      const endX = startX + (viewportSize.width / zoomLevel) + gridSize * 10;
                      const endY = startY + (viewportSize.height / zoomLevel) + gridSize * 10;

                      // Vertical lines
                      for (let x = startX; x <= endX; x += gridSize) {
                        lines.push(
                          <line
                            key={`grid-v-${x}`}
                            x1={x}
                            y1={startY}
                            x2={x}
                            y2={endY}
                            stroke="#716C6C"
                            strokeWidth="0.75"
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      }

                      // Horizontal lines
                      for (let y = startY; y <= endY; y += gridSize) {
                        lines.push(
                          <line
                            key={`grid-h-${y}`}
                            x1={startX}
                            y1={y}
                            x2={endX}
                            y2={y}
                            stroke="#716C6C"
                            strokeWidth="0.75"
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      }

                      return <g>{lines}</g>;
                    })()}

                    {/* Grid dots - only show when dragging nodes */}
                    {gridMode === 'hover' && !!draggingNodeInfo && (
                      <g>
                        {(() => {
                          const dots = [];
                          // Account for canvas offset in grid calculations
                          const viewMinX = (-panOffset.x / zoomLevel) + canvasSize.offsetX;
                          const viewMinY = (-panOffset.y / zoomLevel) + canvasSize.offsetY;
                          const startX = Math.floor(viewMinX / gridSize) * gridSize;
                          const startY = Math.floor(viewMinY / gridSize) * gridSize;
                          const endX = startX + (viewportSize.width / zoomLevel) + gridSize * 2;
                          const endY = startY + (viewportSize.height / zoomLevel) + gridSize * 2;

                          for (let x = startX; x <= endX; x += gridSize) {
                            for (let y = startY; y <= endY; y += gridSize) {
                              dots.push(
                                <circle
                                  key={`grid-dot-${x}-${y}`}
                                  cx={x}
                                  cy={y}
                                  r={Math.min(6, Math.max(3, gridSize * 0.06))}
                                  fill="#260000"
                                  pointerEvents="none"
                                />
                              );
                            }
                          }
                          return dots;
                        })()}
                      </g>
                    )}
                  </g>
                )}

                {/* Debug boundaries - disabled */}

                {isViewReady && (() => {
                  // Determine which node instances are members of node-groups
                  const nodeGroupMemberIds = new Set();
                  const graphData = activeGraphId ? graphsMap.get(activeGraphId) : null;
                  if (graphData?.groups) {
                    graphData.groups.forEach(group => {
                      if (group.linkedNodePrototypeId) {
                        group.memberInstanceIds.forEach(id => nodeGroupMemberIds.add(id));
                      }
                    });
                  }

                  // Split edges based on whether they connect to node-group members
                  const edgesBelowNodeGroups = visibleEdges.filter(e =>
                    !nodeGroupMemberIds.has(e.sourceId) && !nodeGroupMemberIds.has(e.destinationId)
                  );
                  const edgesAboveNodeGroups = visibleEdges.filter(e =>
                    nodeGroupMemberIds.has(e.sourceId) || nodeGroupMemberIds.has(e.destinationId)
                  );

                  // Group edges by node pairs to calculate curve offsets for multiple edges between same nodes
                  const edgePairGroups = new Map();
                  visibleEdges.forEach(e => {
                    const key = [e.sourceId, e.destinationId].sort().join('--');
                    if (!edgePairGroups.has(key)) edgePairGroups.set(key, []);
                    edgePairGroups.get(key).push(e.id);
                  });

                  // Build a map of edge ID -> { pairIndex, totalInPair } for curve offset calculation
                  const edgeCurveInfo = new Map();
                  edgePairGroups.forEach((edgeIds, key) => {
                    const total = edgeIds.length;
                    edgeIds.forEach((edgeId, idx) => {
                      edgeCurveInfo.set(edgeId, { pairIndex: idx, totalInPair: total });
                    });
                  });

                  // #region agent log
                  const multiEdgePairs = Array.from(edgePairGroups.entries()).filter(([k, v]) => v.length > 1);
                  if (multiEdgePairs.length > 0) {
                    debugLogSync('NodeCanvas.jsx:edgeRender', 'Edge rendering info', { totalEdges: visibleEdges.length, multiEdgePairs: multiEdgePairs.map(([k, v]) => ({ pair: k, edgeCount: v.length, edgeIds: v })), enableAutoRouting, routingStyle, willUseCurves: !(enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean')) }, 'debug-session', 'D-E');
                  }
                  // #endregion

                  return (
                    <>
                      {/* Edges below node-groups: don't connect to any node-group members */}
                      {edgesBelowNodeGroups.map((edge, idx) => {
                        const sourceNode = nodes.find(n => n.id === edge.sourceId);
                        const destNode = nodes.find(n => n.id === edge.destinationId);

                        if (!sourceNode || !destNode) {
                          return null;
                        }
                        const sNodeDims = baseDimsById.get(sourceNode.id) || getNodeDimensions(sourceNode, false, null);
                        const eNodeDims = baseDimsById.get(destNode.id) || getNodeDimensions(destNode, false, null);
                        const isSNodePreviewing = previewingNodeId === sourceNode.id;
                        const isENodePreviewing = previewingNodeId === destNode.id;
                        const x1 = sourceNode.x + sNodeDims.currentWidth / 2;
                        const y1 = sourceNode.y + (isSNodePreviewing ? NODE_HEIGHT / 2 : sNodeDims.currentHeight / 2);
                        const x2 = destNode.x + eNodeDims.currentWidth / 2;
                        const y2 = destNode.y + (isENodePreviewing ? NODE_HEIGHT / 2 : eNodeDims.currentHeight / 2);

                        const isHovered = hoveredEdgeInfo?.edgeId === edge.id;
                        const isSelected = selectedEdgeId === edge.id || selectedEdgeIds.has(edge.id);




                        // Get edge color - prioritize definitionNodeIds for custom types, then typeNodeId for base types
                        const getEdgeColor = () => {
                          // First check definitionNodeIds (for custom connection types set via control panel)
                          if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
                            const definitionNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
                            if (definitionNode) {
                              return definitionNode.color || NODE_DEFAULT_COLOR;
                            }
                          }

                          // Then check typeNodeId (for base connection type)
                          if (edge.typeNodeId) {
                            // Special handling for base connection prototype - ensure it's black
                            if (edge.typeNodeId === 'base-connection-prototype') {
                              return '#000000'; // Black color for base connection
                            }
                            const edgePrototype = edgePrototypesMap.get(edge.typeNodeId);
                            if (edgePrototype) {
                              return edgePrototype.color || NODE_DEFAULT_COLOR;
                            }
                          }

                          return destNode.color || NODE_DEFAULT_COLOR;
                        };
                        const edgeColor = getEdgeColor();

                        // Calculate arrow position and rotation
                        const dx = x2 - x1;
                        const dy = y2 - y1;
                        const length = Math.sqrt(dx * dx + dy * dy);

                        // Helper function to calculate edge intersection with rectangular nodes
                        const getNodeEdgeIntersection = (nodeX, nodeY, nodeWidth, nodeHeight, dirX, dirY) => {
                          const centerX = nodeX + nodeWidth / 2;
                          const centerY = nodeY + nodeHeight / 2;
                          const halfWidth = nodeWidth / 2;
                          const halfHeight = nodeHeight / 2;
                          const intersections = [];

                          if (dirX > 0) {
                            const t = halfWidth / dirX;
                            const y = dirY * t;
                            if (Math.abs(y) <= halfHeight) intersections.push({ x: centerX + halfWidth, y: centerY + y, distance: t });
                          }
                          if (dirX < 0) {
                            const t = -halfWidth / dirX;
                            const y = dirY * t;
                            if (Math.abs(y) <= halfHeight) intersections.push({ x: centerX - halfWidth, y: centerY + y, distance: t });
                          }
                          if (dirY > 0) {
                            const t = halfHeight / dirY;
                            const x = dirX * t;
                            if (Math.abs(x) <= halfWidth) intersections.push({ x: centerX + x, y: centerY + halfHeight, distance: t });
                          }
                          if (dirY < 0) {
                            const t = -halfHeight / dirY;
                            const x = dirX * t;
                            if (Math.abs(x) <= halfWidth) intersections.push({ x: centerX + x, y: centerY - halfHeight, distance: t });
                          }

                          return intersections.reduce((closest, current) =>
                            !closest || current.distance < closest.distance ? current : closest, null);
                        };

                        // Calculate edge intersections
                        const sourceIntersection = getNodeEdgeIntersection(
                          sourceNode.x, sourceNode.y, sNodeDims.currentWidth, sNodeDims.currentHeight,
                          dx / length, dy / length
                        );

                        const destIntersection = getNodeEdgeIntersection(
                          destNode.x, destNode.y, eNodeDims.currentWidth, eNodeDims.currentHeight,
                          -dx / length, -dy / length
                        );

                        // Determine if each end of the edge should be shortened for arrows
                        // Ensure arrowsToward is a Set (fix for loading from file)
                        const arrowsToward = edge.directionality?.arrowsToward instanceof Set
                          ? edge.directionality.arrowsToward
                          : new Set(Array.isArray(edge.directionality?.arrowsToward) ? edge.directionality.arrowsToward : []);

                        // Only shorten connections at ends with arrows or hover state
                        let shouldShortenSource = isHovered || arrowsToward.has(sourceNode.id);
                        let shouldShortenDest = isHovered || arrowsToward.has(destNode.id);
                        if (enableAutoRouting && routingStyle === 'manhattan') {
                          // In Manhattan mode, never shorten for hover—only for actual arrows
                          shouldShortenSource = arrowsToward.has(sourceNode.id);
                          shouldShortenDest = arrowsToward.has(destNode.id);
                        }

                        // Determine actual start/end points for rendering
                        let startX, startY, endX, endY;

                        // For clean routing, use assigned ports; otherwise use intersection-based positioning
                        if (enableAutoRouting && routingStyle === 'clean') {
                          const portAssignment = cleanLaneOffsets.get(edge.id);
                          if (portAssignment) {
                            const { sourcePort, destPort } = portAssignment;

                            // Check if this edge has directional arrows
                            const hasSourceArrow = arrowsToward.has(sourceNode.id);
                            const hasDestArrow = arrowsToward.has(destNode.id);

                            // Use ports for directional connections, centers for non-directional
                            startX = hasSourceArrow ? sourcePort.x : x1;
                            startY = hasSourceArrow ? sourcePort.y : y1;
                            endX = hasDestArrow ? destPort.x : x2;
                            endY = hasDestArrow ? destPort.y : y2;
                          } else {
                            // Fallback to node centers for clean routing
                            startX = x1;
                            startY = y1;
                            endX = x2;
                            endY = y2;
                          }
                        } else {
                          // Use intersection-based positioning for other routing modes
                          startX = shouldShortenSource ? (sourceIntersection?.x || x1) : x1;
                          startY = shouldShortenSource ? (sourceIntersection?.y || y1) : y1;
                          endX = shouldShortenDest ? (destIntersection?.x || x2) : x2;
                          endY = shouldShortenDest ? (destIntersection?.y || y2) : y2;
                        }

                        // Predeclare Manhattan path info for safe use below
                        let manhattanPathD = null;
                        let manhattanSourceSide = null;
                        let manhattanDestSide = null;

                        // When using Manhattan routing, snap to 4 node ports (midpoints of each side)
                        if (enableAutoRouting && routingStyle === 'manhattan') {
                          const sCenterX = sourceNode.x + sNodeDims.currentWidth / 2;
                          const sCenterY = sourceNode.y + sNodeDims.currentHeight / 2;
                          const dCenterX = destNode.x + eNodeDims.currentWidth / 2;
                          const dCenterY = destNode.y + eNodeDims.currentHeight / 2;

                          const sPorts = {
                            top: { x: sCenterX, y: sourceNode.y },
                            bottom: { x: sCenterX, y: sourceNode.y + sNodeDims.currentHeight },
                            left: { x: sourceNode.x, y: sCenterY },
                            right: { x: sourceNode.x + sNodeDims.currentWidth, y: sCenterY },
                          };
                          const dPorts = {
                            top: { x: dCenterX, y: destNode.y },
                            bottom: { x: dCenterX, y: destNode.y + eNodeDims.currentHeight },
                            left: { x: destNode.x, y: dCenterY },
                            right: { x: destNode.x + eNodeDims.currentWidth, y: dCenterY },
                          };

                          const relDx = dCenterX - sCenterX;
                          const relDy = dCenterY - sCenterY;
                          let sPort, dPort;
                          if (Math.abs(relDx) >= Math.abs(relDy)) {
                            // Prefer horizontal ports
                            sPort = relDx >= 0 ? sPorts.right : sPorts.left;
                            dPort = relDx >= 0 ? dPorts.left : dPorts.right;
                          } else {
                            // Prefer vertical ports
                            sPort = relDy >= 0 ? sPorts.bottom : sPorts.top;
                            dPort = relDy >= 0 ? dPorts.top : dPorts.bottom;
                          }
                          startX = sPort.x;
                          startY = sPort.y;
                          endX = dPort.x;
                          endY = dPort.y;

                          // Determine sides for perpendicular entry/exit
                          const sSide = (Math.abs(startY - sourceNode.y) < 0.5) ? 'top'
                            : (Math.abs(startY - (sourceNode.y + sNodeDims.currentHeight)) < 0.5) ? 'bottom'
                              : (Math.abs(startX - sourceNode.x) < 0.5) ? 'left' : 'right';
                          const dSide = (Math.abs(endY - destNode.y) < 0.5) ? 'top'
                            : (Math.abs(endY - (destNode.y + eNodeDims.currentHeight)) < 0.5) ? 'bottom'
                              : (Math.abs(endX - destNode.x) < 0.5) ? 'left' : 'right';
                          const initOrient = (sSide === 'left' || sSide === 'right') ? 'H' : 'V';
                          const finalOrient = (dSide === 'left' || dSide === 'right') ? 'H' : 'V';

                          const effectiveBends = (manhattanBends === 'auto')
                            ? (initOrient === finalOrient ? 'two' : 'one')
                            : manhattanBends;

                          // Local helpers declared before use to avoid hoisting issues
                          const cornerRadiusLocal = 8;
                          const buildRoundedLPathOriented = (sx, sy, ex, ey, r, firstOrientation /* 'H' | 'V' */) => {
                            if (firstOrientation === 'H') {
                              if (sx === ex || sy === ey) {
                                return `M ${sx},${sy} L ${ex},${ey}`;
                              }
                              const signX = ex > sx ? 1 : -1;
                              const signY = ey > sy ? 1 : -1;
                              const cornerX = ex;
                              const cornerY = sy;
                              const hx = cornerX - signX * r;
                              const hy = cornerY;
                              const vx = cornerX;
                              const vy = cornerY + signY * r;
                              return `M ${sx},${sy} L ${hx},${hy} Q ${cornerX},${cornerY} ${vx},${vy} L ${ex},${ey}`;
                            } else {
                              if (sx === ex || sy === ey) {
                                return `M ${sx},${sy} L ${ex},${ey}`;
                              }
                              const signX = ex > sx ? 1 : -1;
                              const signY = ey > sy ? 1 : -1;
                              const cornerX = sx;
                              const cornerY = ey;
                              const vx = cornerX;
                              const vy = cornerY - signY * r;
                              const hx = cornerX + signX * r;
                              const hy = cornerY;
                              return `M ${sx},${sy} L ${vx},${vy} Q ${cornerX},${cornerY} ${hx},${hy} L ${ex},${ey}`;
                            }
                          };
                          const buildRoundedZPathOriented = (sx, sy, ex, ey, r, pattern /* 'HVH' | 'VHV' */) => {
                            if (sx === ex || sy === ey) {
                              return `M ${sx},${sy} L ${ex},${ey}`;
                            }
                            if (pattern === 'HVH') {
                              // Horizontal → Vertical → Horizontal with rounded corners at both bends
                              const midX = (sx + ex) / 2;
                              const signX1 = midX >= sx ? 1 : -1; // initial horizontal direction
                              const signY = ey >= sy ? 1 : -1;     // vertical direction
                              const signX2 = ex >= midX ? 1 : -1;  // final horizontal direction
                              const hx1 = midX - signX1 * r;       // before first corner
                              const vy1 = sy + signY * r;          // after first corner
                              const vy2 = ey - signY * r;          // before second corner
                              const hx2 = midX + signX2 * r;       // after second corner
                              return `M ${sx},${sy} L ${hx1},${sy} Q ${midX},${sy} ${midX},${vy1} L ${midX},${vy2} Q ${midX},${ey} ${hx2},${ey} L ${ex},${ey}`;
                            } else {
                              // Vertical → Horizontal → Vertical with rounded corners at both bends
                              const midY = (sy + ey) / 2;
                              const signY1 = midY >= sy ? 1 : -1;  // initial vertical direction
                              const signX = ex >= sx ? 1 : -1;      // horizontal direction (same for both H segments)
                              const signY2 = ey >= midY ? 1 : -1;   // final vertical direction
                              const vy1 = midY - signY1 * r;        // before first corner
                              const hx1 = sx + signX * r;           // after first corner
                              const hx2 = ex - signX * r;           // before second corner
                              const vy2 = midY + signY2 * r;        // after second corner
                              return `M ${sx},${sy} L ${sx},${vy1} Q ${sx},${midY} ${hx1},${midY} L ${hx2},${midY} Q ${ex},${midY} ${ex},${vy2} L ${ex},${ey}`;
                            }
                          };
                          let pathD;
                          if (effectiveBends === 'two' && initOrient === finalOrient) {
                            pathD = (initOrient === 'H')
                              ? buildRoundedZPathOriented(startX, startY, endX, endY, cornerRadiusLocal, 'HVH')
                              : buildRoundedZPathOriented(startX, startY, endX, endY, cornerRadiusLocal, 'VHV');
                          } else {
                            pathD = buildRoundedLPathOriented(startX, startY, endX, endY, cornerRadiusLocal, initOrient);
                          }

                          // Assign for rendering and arrow logic
                          manhattanPathD = pathD;
                          manhattanSourceSide = sSide;
                          manhattanDestSide = dSide;
                        }
                        return (
                          <g key={`edge-above-${edge.id}-${idx}`}>
                            {/* Main edge line - always same thickness */}
                            {/* Glow effect for selected or hovered edge */}
                            {(isSelected || isHovered) && (
                              (enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean')) ? (
                                <path
                                  d={(routingStyle === 'manhattan') ? manhattanPathD : (() => {
                                    // Use consistent clean routing path helper
                                    const cleanPts = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
                                    return buildRoundedPathFromPoints(cleanPts, 8);
                                  })()}
                                  fill="none"
                                  stroke={edgeColor}
                                  strokeWidth="12"
                                  opacity={isSelected ? "0.3" : "0.2"}
                                  style={{
                                    filter: `blur(3px) drop-shadow(0 0 8px ${edgeColor})`
                                  }}
                                  strokeLinecap="round"
                                />
                              ) : (() => {
                                // Glow effect also needs curve for multi-edge pairs
                                const curveInfo = edgeCurveInfo.get(edge.id);
                                if (curveInfo && curveInfo.totalInPair > 1) {
                                  const { pairIndex, totalInPair } = curveInfo;
                                  const curveSpacing = 40;
                                  const offsetIndex = pairIndex - (totalInPair - 1) / 2;
                                  const perpOffset = offsetIndex * curveSpacing;
                                  const edgeDx = endX - startX;
                                  const edgeDy = endY - startY;
                                  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
                                  const perpX = edgeLen > 0 ? -edgeDy / edgeLen : 0;
                                  const perpY = edgeLen > 0 ? edgeDx / edgeLen : 0;
                                  const curveMidX = (startX + endX) / 2;
                                  const curveMidY = (startY + endY) / 2;
                                  const ctrlX = curveMidX + perpX * perpOffset;
                                  const ctrlY = curveMidY + perpY * perpOffset;
                                  return (
                                    <path
                                      d={`M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`}
                                      fill="none"
                                      stroke={edgeColor}
                                      strokeWidth="12"
                                      opacity={isSelected ? "0.3" : "0.2"}
                                      style={{
                                        filter: `blur(3px) drop-shadow(0 0 8px ${edgeColor})`
                                      }}
                                      strokeLinecap="round"
                                    />
                                  );
                                }
                                return (
                                  <line
                                    x1={startX}
                                    y1={startY}
                                    x2={endX}
                                    y2={endY}
                                    stroke={edgeColor}
                                    strokeWidth="12"
                                    opacity={isSelected ? "0.3" : "0.2"}
                                    style={{
                                      filter: `blur(3px) drop-shadow(0 0 8px ${edgeColor})`
                                    }}
                                  />
                                );
                              })()
                            )}

                            {(enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean')) ? (
                              <>
                                {routingStyle === 'manhattan' && !arrowsToward.has(sourceNode.id) && (
                                  <line x1={x1} y1={y1} x2={startX} y2={startY} stroke={edgeColor} strokeWidth={showConnectionNames ? "16" : "6"} strokeLinecap="round" />
                                )}
                                {routingStyle === 'manhattan' && !arrowsToward.has(destNode.id) && (
                                  <line x1={endX} y1={endY} x2={x2} y2={y2} stroke={edgeColor} strokeWidth={showConnectionNames ? "16" : "6"} strokeLinecap="round" />
                                )}
                                <path
                                  d={(routingStyle === 'manhattan') ? manhattanPathD : (() => {
                                    // Use consistent clean routing path helper
                                    const cleanPts = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
                                    return buildRoundedPathFromPoints(cleanPts, 8);
                                  })()}
                                  fill="none"
                                  stroke={edgeColor}
                                  strokeWidth={showConnectionNames ? "16" : "6"}
                                  style={{ transition: 'stroke 0.2s ease' }}
                                  strokeLinecap="round"
                                />
                              </>
                            ) : (() => {
                              // Check if this edge needs curve offset (multiple edges between same nodes)
                              const curveInfo = edgeCurveInfo.get(edge.id);
                              if (curveInfo && curveInfo.totalInPair > 1) {
                                // Calculate curve offset for parallel edges
                                const { pairIndex, totalInPair } = curveInfo;
                                const curveSpacing = 40; // Pixels between parallel edge curves
                                // Center the curves: offset from -half to +half of total spread
                                const offsetIndex = pairIndex - (totalInPair - 1) / 2;
                                const perpOffset = offsetIndex * curveSpacing;

                                // Calculate perpendicular direction
                                const edgeDx = endX - startX;
                                const edgeDy = endY - startY;
                                const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
                                const perpX = edgeLen > 0 ? -edgeDy / edgeLen : 0;
                                const perpY = edgeLen > 0 ? edgeDx / edgeLen : 0;

                                // Control point at midpoint, offset perpendicular to edge
                                const curveMidX = (startX + endX) / 2;
                                const curveMidY = (startY + endY) / 2;
                                const ctrlX = curveMidX + perpX * perpOffset;
                                const ctrlY = curveMidY + perpY * perpOffset;

                                return (
                                  <path
                                    d={`M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`}
                                    fill="none"
                                    stroke={edgeColor}
                                    strokeWidth={showConnectionNames ? "16" : "6"}
                                    style={{ transition: 'stroke 0.2s ease' }}
                                    strokeLinecap="round"
                                  />
                                );
                              }
                              // Single edge - render as straight line
                              return (
                                <line
                                  x1={startX}
                                  y1={startY}
                                  x2={endX}
                                  y2={endY}
                                  stroke={edgeColor}
                                  strokeWidth={showConnectionNames ? "16" : "6"}
                                  style={{ transition: 'stroke 0.2s ease' }}
                                />
                              );
                            })()}

                            {/* Connection name text - only show when enabled */}
                            {showConnectionNames && (() => {
                              let midX;
                              let midY;
                              let angle;
                              if (enableAutoRouting && routingStyle === 'manhattan') {
                                const horizontalLen = Math.abs(endX - startX);
                                const verticalLen = Math.abs(endY - startY);
                                if (horizontalLen >= verticalLen) {
                                  midX = (startX + endX) / 2;
                                  midY = startY;
                                  angle = 0;
                                } else {
                                  midX = endX;
                                  midY = (startY + endY) / 2;
                                  angle = 90;
                                }
                              } else {
                                midX = (x1 + x2) / 2;
                                midY = (y1 + y2) / 2;
                                angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
                              }

                              // Determine connection name to display
                              let connectionName = 'Connection';
                              if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
                                const definitionNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
                                if (definitionNode) {
                                  connectionName = definitionNode.name || 'Connection';
                                }
                              } else if (edge.typeNodeId) {
                                const edgePrototype = edgePrototypesMap.get(edge.typeNodeId);
                                if (edgePrototype) {
                                  connectionName = edgePrototype.name || 'Connection';
                                }
                              }

                              // Smart label placement based on routing style
                              if (enableAutoRouting && routingStyle === 'manhattan') {
                                // Always try cached placement first to prevent flicker (except during dragging)
                                const cached = placedLabelsRef.current.get(edge.id);
                                if (cached && cached.position && !draggingNodeInfo) {
                                  const stabilized = stabilizeLabelPosition(edge.id, cached.position.x, cached.position.y, cached.position.angle || 0);
                                  midX = stabilized.x;
                                  midY = stabilized.y;
                                  angle = stabilized.angle || 0;
                                } else {
                                  const pathPoints = generateManhattanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, manhattanBends);
                                  const placement = chooseLabelPlacement(pathPoints, connectionName, 24, edge.id);
                                  if (placement) {
                                    midX = placement.x;
                                    midY = placement.y;
                                    angle = placement.angle || 0;

                                    // Register this label placement
                                    const labelRect = {
                                      minX: midX - estimateTextWidth(connectionName, 24) / 2,
                                      maxX: midX + estimateTextWidth(connectionName, 24) / 2,
                                      minY: midY - 24 * 1.1 / 2,
                                      maxY: midY + 24 * 1.1 / 2,
                                    };
                                    const stabilized = stabilizeLabelPosition(edge.id, midX, midY, angle);
                                    placedLabelsRef.current.set(edge.id, {
                                      rect: labelRect,
                                      position: { x: stabilized.x, y: stabilized.y, angle: stabilized.angle }
                                    });
                                  } else {
                                    // Fallback to simple Manhattan logic
                                    const horizontalLen = Math.abs(endX - startX);
                                    const verticalLen = Math.abs(endY - startY);
                                    if (horizontalLen >= verticalLen) {
                                      midX = (startX + endX) / 2;
                                      midY = startY;
                                      angle = 0;
                                    } else {
                                      midX = endX;
                                      midY = (startY + endY) / 2;
                                      angle = 90;
                                    }
                                  }
                                }
                              } else if (enableAutoRouting && routingStyle === 'clean') {
                                // Always try cached placement first to prevent flicker (except during dragging)
                                const cached = placedLabelsRef.current.get(edge.id);
                                if (cached && cached.position && !draggingNodeInfo) {
                                  const stabilized = stabilizeLabelPosition(edge.id, cached.position.x, cached.position.y, cached.position.angle || 0);
                                  midX = stabilized.x;
                                  midY = stabilized.y;
                                  angle = stabilized.angle || 0;
                                } else {
                                  const pathPoints = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
                                  const placement = chooseLabelPlacement(pathPoints, connectionName, 24, edge.id);
                                  if (placement) {
                                    midX = placement.x;
                                    midY = placement.y;
                                    angle = placement.angle || 0;

                                    // Register this label placement
                                    const labelRect = {
                                      minX: midX - estimateTextWidth(connectionName, 24) / 2,
                                      maxX: midX + estimateTextWidth(connectionName, 24) / 2,
                                      minY: midY - 24 * 1.1 / 2,
                                      maxY: midY + 24 * 1.1 / 2,
                                    };
                                    const stabilized = stabilizeLabelPosition(edge.id, midX, midY, angle);
                                    placedLabelsRef.current.set(edge.id, {
                                      rect: labelRect,
                                      position: { x: stabilized.x, y: stabilized.y, angle: stabilized.angle }
                                    });
                                  } else {
                                    // Fallback to midpoint
                                    midX = (x1 + x2) / 2;
                                    midY = (y1 + y2) / 2;
                                    angle = 0;
                                  }
                                }
                              } else {
                                // Straight line: reuse cached placement when available to prevent flicker (except during dragging)
                                const cached = placedLabelsRef.current.get(edge.id);
                                if (cached && cached.position && !draggingNodeInfo) {
                                  const stabilized = stabilizeLabelPosition(edge.id, cached.position.x, cached.position.y, cached.position.angle || Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI));
                                  midX = stabilized.x;
                                  midY = stabilized.y;
                                  angle = stabilized.angle || Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
                                } else {
                                  // Fallback to original behavior
                                  midX = (x1 + x2) / 2;
                                  midY = (y1 + y2) / 2;
                                  angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);

                                  // Cache this position for future reuse
                                  const labelRect = {
                                    minX: midX - estimateTextWidth(connectionName, 24) / 2,
                                    maxX: midX + estimateTextWidth(connectionName, 24) / 2,
                                    minY: midY - 24 * 1.1 / 2,
                                    maxY: midY + 24 * 1.1 / 2,
                                  };
                                  const stabilized = stabilizeLabelPosition(edge.id, midX, midY, angle);
                                  placedLabelsRef.current.set(edge.id, {
                                    rect: labelRect,
                                    position: { x: stabilized.x, y: stabilized.y, angle: stabilized.angle }
                                  });
                                }
                              }

                              // Adjust angle to keep text readable (never upside down)
                              const adjustedAngle = (angle > 90 || angle < -90) ? angle + 180 : angle;

                              return (
                                <g>
                                  {/* Canvas-colored text creating a "hole" effect in the connection */}
                                  <text
                                    x={midX}
                                    y={midY}
                                    fill="#bdb5b5"
                                    fontSize="24"
                                    fontWeight="bold"
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    transform={`rotate(${adjustedAngle}, ${midX}, ${midY})`}
                                    stroke={hexToHsl(edgeColor).l > 42 ? getTextColor(edgeColor) : edgeColor}
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    paintOrder="stroke fill"
                                    style={{ pointerEvents: 'none', fontFamily: "'EmOne', sans-serif" }}
                                  >
                                    {connectionName}
                                  </text>
                                </g>
                              );
                            })()}

                            {/* Invisible click area for edge selection - matches hover detection */}
                            {(enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean')) ? (
                              <path
                                d={(routingStyle === 'manhattan') ? manhattanPathD : (() => {
                                  // Use consistent clean routing path helper
                                  const cleanPts = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
                                  return buildRoundedPathFromPoints(cleanPts, 8);
                                })()}
                                fill="none"
                                stroke="transparent"
                                strokeWidth="40"
                                style={{ cursor: 'pointer' }}
                                onPointerDown={(e) => {
                                  // Immediate tap support for touch/pencil
                                  if (e.pointerType && e.pointerType !== 'mouse') {
                                    e.preventDefault?.();
                                    e.stopPropagation?.();
                                    ignoreCanvasClick.current = true; // suppress canvas click -> plus sign
                                    setLongPressingInstanceId(null); // prevent connection drawing intent
                                    setDrawingConnectionFrom(null);
                                    if (e.ctrlKey || e.metaKey) {
                                      if (selectedEdgeIds.has(edge.id)) {
                                        storeActions.removeSelectedEdgeId(edge.id);
                                      } else {
                                        storeActions.addSelectedEdgeId(edge.id);
                                      }
                                    } else {
                                      storeActions.clearSelectedEdgeIds();
                                      storeActions.setSelectedEdgeId(edge.id);
                                    }
                                  }
                                  handleEdgePointerDownTouch(edge.id, e);
                                }}
                                onTouchStart={(e) => {
                                  e.preventDefault?.();
                                  e.stopPropagation?.();
                                  ignoreCanvasClick.current = true;
                                  setLongPressingInstanceId(null);
                                  setDrawingConnectionFrom(null);
                                  storeActions.clearSelectedEdgeIds();
                                  storeActions.setSelectedEdgeId(edge.id);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  ignoreCanvasClick.current = true;

                                  // Handle multiple selection with Ctrl/Cmd key
                                  if (e.ctrlKey || e.metaKey) {
                                    // Toggle this edge in the multiple selection
                                    if (selectedEdgeIds.has(edge.id)) {
                                      storeActions.removeSelectedEdgeId(edge.id);
                                    } else {
                                      storeActions.addSelectedEdgeId(edge.id);
                                    }
                                  } else {
                                    // Single selection - clear multiple selection and set single edge
                                    storeActions.clearSelectedEdgeIds();
                                    storeActions.setSelectedEdgeId(edge.id);
                                  }
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();

                                  // Find the defining node for this edge's connection type
                                  let definingNodeId = null;

                                  // Check definitionNodeIds first (for custom connection types)
                                  if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
                                    definingNodeId = edge.definitionNodeIds[0];
                                  } else if (edge.typeNodeId) {
                                    // Fallback to typeNodeId (for base connection type)
                                    definingNodeId = edge.typeNodeId;
                                  }

                                  // Open the panel tab for the defining node
                                  if (definingNodeId) {
                                    storeActions.openRightPanelNodeTab(definingNodeId);
                                  }
                                }}
                              />
                            ) : (
                              <line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="transparent"
                                strokeWidth="40"
                                style={{ cursor: 'pointer' }}
                                onPointerDown={(e) => {
                                  if (e.pointerType && e.pointerType !== 'mouse') {
                                    e.preventDefault?.();
                                    e.stopPropagation?.();
                                    ignoreCanvasClick.current = true;
                                    setLongPressingInstanceId(null);
                                    setDrawingConnectionFrom(null);
                                    if (e.ctrlKey || e.metaKey) {
                                      if (selectedEdgeIds.has(edge.id)) {
                                        storeActions.removeSelectedEdgeId(edge.id);
                                      } else {
                                        storeActions.addSelectedEdgeId(edge.id);
                                      }
                                    } else {
                                      storeActions.clearSelectedEdgeIds();
                                      storeActions.setSelectedEdgeId(edge.id);
                                    }
                                  }
                                  handleEdgePointerDownTouch(edge.id, e);
                                }}
                                onTouchStart={(e) => {
                                  e.preventDefault?.();
                                  e.stopPropagation?.();
                                  ignoreCanvasClick.current = true;
                                  setLongPressingInstanceId(null);
                                  setDrawingConnectionFrom(null);
                                  storeActions.clearSelectedEdgeIds();
                                  storeActions.setSelectedEdgeId(edge.id);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  ignoreCanvasClick.current = true;

                                  // Handle multiple selection with Ctrl/Cmd key
                                  if (e.ctrlKey || e.metaKey) {
                                    // Toggle this edge in the multiple selection
                                    if (selectedEdgeIds.has(edge.id)) {
                                      storeActions.removeSelectedEdgeId(edge.id);
                                    } else {
                                      storeActions.addSelectedEdgeId(edge.id);
                                    }
                                  } else {
                                    // Single selection - clear multiple selection and set single edge
                                    storeActions.clearSelectedEdgeIds();
                                    storeActions.setSelectedEdgeId(edge.id);
                                  }
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();

                                  // Find the defining node for this edge's connection type
                                  let definingNodeId = null;

                                  // Check definitionNodeIds first (for custom connection types)
                                  if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
                                    definingNodeId = edge.definitionNodeIds[0];
                                  } else if (edge.typeNodeId) {
                                    // Fallback to typeNodeId (for base connection type)
                                    definingNodeId = edge.typeNodeId;
                                  }

                                  // Open the panel tab for the defining node
                                  if (definingNodeId) {
                                    storeActions.openRightPanelNodeTab(definingNodeId);
                                  }
                                }}
                              />
                            )}

                            {/* Smart directional arrows with clickable toggle */}
                            {(() => {
                              // Calculate arrow positions (use fallback if intersections fail)
                              let sourceArrowX, sourceArrowY, destArrowX, destArrowY, sourceArrowAngle, destArrowAngle;

                              if (enableAutoRouting && routingStyle === 'clean') {
                                // Clean mode: use actual port assignments for proper arrow positioning
                                const offset = showConnectionNames ? 6 : (shouldShortenSource || shouldShortenDest ? 3 : 5);
                                const portAssignment = cleanLaneOffsets.get(edge.id);

                                if (portAssignment) {
                                  const { sourcePort, destPort, sourceSide, destSide } = portAssignment;

                                  // Position arrows pointing TOWARD the target node (into the edge)
                                  // Arrow tip points toward the node, positioned outside the edge
                                  switch (sourceSide) {
                                    case 'top':
                                      sourceArrowAngle = 90; // Arrow points down toward node
                                      sourceArrowX = sourcePort.x;
                                      sourceArrowY = sourcePort.y - offset;
                                      break;
                                    case 'bottom':
                                      sourceArrowAngle = -90; // Arrow points up toward node
                                      sourceArrowX = sourcePort.x;
                                      sourceArrowY = sourcePort.y + offset;
                                      break;
                                    case 'left':
                                      sourceArrowAngle = 0; // Arrow points right toward node
                                      sourceArrowX = sourcePort.x - offset;
                                      sourceArrowY = sourcePort.y;
                                      break;
                                    case 'right':
                                      sourceArrowAngle = 180; // Arrow points left toward node
                                      sourceArrowX = sourcePort.x + offset;
                                      sourceArrowY = sourcePort.y;
                                      break;
                                  }

                                  switch (destSide) {
                                    case 'top':
                                      destArrowAngle = 90; // Arrow points down toward node
                                      destArrowX = destPort.x;
                                      destArrowY = destPort.y - offset;
                                      break;
                                    case 'bottom':
                                      destArrowAngle = -90; // Arrow points up toward node
                                      destArrowX = destPort.x;
                                      destArrowY = destPort.y + offset;
                                      break;
                                    case 'left':
                                      destArrowAngle = 0; // Arrow points right toward node
                                      destArrowX = destPort.x - offset;
                                      destArrowY = destPort.y;
                                      break;
                                    case 'right':
                                      destArrowAngle = 180; // Arrow points left toward node
                                      destArrowX = destPort.x + offset;
                                      destArrowY = destPort.y;
                                      break;
                                  }
                                } else {
                                  // Fallback to center-based positioning
                                  const deltaX = endX - startX;
                                  const deltaY = endY - startY;
                                  const isMainlyVertical = Math.abs(deltaY) > Math.abs(deltaX);

                                  if (isMainlyVertical) {
                                    sourceArrowAngle = deltaY > 0 ? -90 : 90;
                                    sourceArrowX = startX;
                                    sourceArrowY = startY + (deltaY > 0 ? offset : -offset);
                                    destArrowAngle = deltaX > 0 ? 0 : 180;
                                    destArrowX = endX + (deltaX > 0 ? -offset : offset);
                                    destArrowY = endY;
                                  } else {
                                    sourceArrowAngle = deltaX > 0 ? 180 : 0;
                                    sourceArrowX = startX + (deltaX > 0 ? offset : -offset);
                                    sourceArrowY = startY;
                                    destArrowAngle = deltaY > 0 ? 90 : -90;
                                    destArrowX = endX;
                                    destArrowY = endY + (deltaY > 0 ? -offset : offset);
                                  }
                                }
                              } else if (!sourceIntersection || !destIntersection) {
                                // Fallback positioning - arrows/dots closer to connection center  
                                const fallbackOffset = showConnectionNames ? 20 :
                                  (shouldShortenSource || shouldShortenDest ? 12 : 15);
                                sourceArrowX = x1 + (dx / length) * fallbackOffset;
                                sourceArrowY = y1 + (dy / length) * fallbackOffset;
                                destArrowX = x2 - (dx / length) * fallbackOffset;
                                destArrowY = y2 - (dy / length) * fallbackOffset;
                                sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
                                destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
                              } else if (enableAutoRouting && routingStyle === 'clean') {
                                // Clean routing arrow placement - position close to nodes for better visibility
                                const offset = showConnectionNames ? 8 : 6; // Reduced offset for better visibility
                                const portAssignment = cleanLaneOffsets.get(edge.id);

                                if (portAssignment) {
                                  const { sourcePort, destPort, sourceSide, destSide } = portAssignment;

                                  // Position arrows close to the actual ports, pointing toward the nodes
                                  switch (sourceSide) {
                                    case 'top':
                                      sourceArrowAngle = 90; // Arrow points down toward node
                                      sourceArrowX = sourcePort.x;
                                      sourceArrowY = sourcePort.y - offset;
                                      break;
                                    case 'bottom':
                                      sourceArrowAngle = -90; // Arrow points up toward node
                                      sourceArrowX = sourcePort.x;
                                      sourceArrowY = sourcePort.y + offset;
                                      break;
                                    case 'left':
                                      sourceArrowAngle = 0; // Arrow points right toward node
                                      sourceArrowX = sourcePort.x - offset;
                                      sourceArrowY = sourcePort.y;
                                      break;
                                    case 'right':
                                      sourceArrowAngle = 180; // Arrow points left toward node
                                      sourceArrowX = sourcePort.x + offset;
                                      sourceArrowY = sourcePort.y;
                                      break;
                                  }

                                  switch (destSide) {
                                    case 'top':
                                      destArrowAngle = 90; // Arrow points down toward node
                                      destArrowX = destPort.x;
                                      destArrowY = destPort.y - offset;
                                      break;
                                    case 'bottom':
                                      destArrowAngle = -90; // Arrow points up toward node
                                      destArrowX = destPort.x;
                                      destArrowY = destPort.y + offset;
                                      break;
                                    case 'left':
                                      destArrowAngle = 0; // Arrow points right toward node
                                      destArrowX = destPort.x - offset;
                                      destArrowY = destPort.y;
                                      break;
                                    case 'right':
                                      destArrowAngle = 180; // Arrow points left toward node
                                      destArrowX = destPort.x + offset;
                                      destArrowY = destPort.y;
                                      break;
                                  }
                                } else {
                                  // Fallback: position arrows close to node centers
                                  sourceArrowX = startX;
                                  sourceArrowY = startY;
                                  sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
                                  destArrowX = endX;
                                  destArrowY = endY;
                                  destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
                                }
                              } else {
                                // Manhattan-aware arrow placement; falls back to straight orientation
                                const offset = showConnectionNames ? 6 : (shouldShortenSource || shouldShortenDest ? 3 : 5);
                                if (enableAutoRouting && routingStyle === 'manhattan') {
                                  // Destination arrow aligns to terminal segment into destination
                                  const horizontalTerminal = Math.abs(endX - startX) > Math.abs(endY - startY);
                                  if (horizontalTerminal) {
                                    destArrowAngle = (endX >= startX) ? 0 : 180;
                                    destArrowX = endX + ((endX >= startX) ? -offset : offset);
                                    destArrowY = endY;
                                  } else {
                                    destArrowAngle = (endY >= startY) ? 90 : -90;
                                    destArrowX = endX;
                                    destArrowY = endY + ((endY >= startY) ? -offset : offset);
                                  }
                                  // Source arrow aligns to initial segment out of source (pointing back toward source)
                                  const horizontalInitial = Math.abs(endX - startX) > Math.abs(endY - startY);
                                  if (horizontalInitial) {
                                    sourceArrowAngle = (endX - startX) >= 0 ? 180 : 0;
                                    sourceArrowX = startX + ((endX - startX) >= 0 ? offset : -offset);
                                    sourceArrowY = startY;
                                  } else {
                                    sourceArrowAngle = (endY - startY) >= 0 ? -90 : 90;
                                    sourceArrowX = startX;
                                    sourceArrowY = startY + ((endY - startY) >= 0 ? offset : -offset);
                                  }
                                } else {
                                  // Precise intersection positioning - adjust based on slope for visual consistency
                                  const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
                                  const normalizedAngle = angle > 90 ? 180 - angle : angle;
                                  // Shorter distance for quantized slopes (hitting node sides) vs diagonal (hitting corners)
                                  const isQuantizedSlope = normalizedAngle < 15 || normalizedAngle > 75;
                                  const arrowLength = isQuantizedSlope ? offset * 0.6 : offset;
                                  sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
                                  sourceArrowX = sourceIntersection.x + (dx / length) * arrowLength;
                                  sourceArrowY = sourceIntersection.y + (dy / length) * arrowLength;
                                  destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
                                  destArrowX = destIntersection.x - (dx / length) * arrowLength;
                                  destArrowY = destIntersection.y - (dy / length) * arrowLength;
                                }
                              }

                              // Override arrow orientation deterministically by Manhattan sides
                              if (enableAutoRouting && routingStyle === 'manhattan') {
                                const sideOffset = showConnectionNames ? 6 : (shouldShortenSource || shouldShortenDest ? 3 : 5);
                                // Destination arrow strictly based on destination side
                                if (manhattanDestSide === 'left') {
                                  destArrowAngle = 0; // rightwards
                                  destArrowX = endX - sideOffset;
                                  destArrowY = endY;
                                } else if (manhattanDestSide === 'right') {
                                  destArrowAngle = 180; // leftwards
                                  destArrowX = endX + sideOffset;
                                  destArrowY = endY;
                                } else if (manhattanDestSide === 'top') {
                                  destArrowAngle = 90; // downwards
                                  destArrowX = endX;
                                  destArrowY = endY - sideOffset;
                                } else if (manhattanDestSide === 'bottom') {
                                  destArrowAngle = -90; // upwards
                                  destArrowX = endX;
                                  destArrowY = endY + sideOffset;
                                }
                                // Source arrow strictly based on source side (points toward the source node)
                                if (manhattanSourceSide === 'left') {
                                  sourceArrowAngle = 0; // rightwards
                                  sourceArrowX = startX - sideOffset;
                                  sourceArrowY = startY;
                                } else if (manhattanSourceSide === 'right') {
                                  sourceArrowAngle = 180; // leftwards
                                  sourceArrowX = startX + sideOffset;
                                  sourceArrowY = startY;
                                } else if (manhattanSourceSide === 'top') {
                                  sourceArrowAngle = 90; // downwards
                                  sourceArrowX = startX;
                                  sourceArrowY = startY - sideOffset;
                                } else if (manhattanSourceSide === 'bottom') {
                                  sourceArrowAngle = -90; // upwards
                                  sourceArrowX = startX;
                                  sourceArrowY = startY + sideOffset;
                                }
                              }

                              const handleArrowClick = (nodeId, e) => {
                                e.stopPropagation();

                                // Toggle the arrow state for the specific node
                                storeActions.updateEdge(edge.id, (draft) => {
                                  // Ensure directionality object exists
                                  if (!draft.directionality) {
                                    draft.directionality = { arrowsToward: new Set() };
                                  }
                                  // Ensure arrowsToward is a Set
                                  if (!draft.directionality.arrowsToward) {
                                    draft.directionality.arrowsToward = new Set();
                                  }

                                  // Toggle arrow for this specific node
                                  if (draft.directionality.arrowsToward.has(nodeId)) {
                                    draft.directionality.arrowsToward.delete(nodeId);
                                  } else {
                                    draft.directionality.arrowsToward.add(nodeId);
                                  }
                                });
                              };

                              return (
                                <>
                                  {/* Source Arrow - visible if arrow points toward source node */}
                                  {arrowsToward.has(sourceNode.id) && (
                                    <g
                                      transform={`translate(${sourceArrowX}, ${sourceArrowY}) rotate(${sourceArrowAngle + 90})`}
                                      style={{ cursor: 'pointer' }}
                                      onClick={(e) => handleArrowClick(sourceNode.id, e)}
                                      onMouseDown={(e) => e.stopPropagation()}
                                    >
                                      {/* Glow effect for arrow - only when selected or hovered */}
                                      {(isSelected || isHovered) && (
                                        <polygon
                                          points="-12,15 12,15 0,-15"
                                          fill={edgeColor}
                                          stroke={edgeColor}
                                          strokeWidth="8"
                                          strokeLinejoin="round"
                                          strokeLinecap="round"
                                          opacity={isSelected ? "0.3" : "0.2"}
                                          style={{
                                            filter: `blur(2px) drop-shadow(0 0 6px ${edgeColor})`
                                          }}
                                        />
                                      )}
                                      <polygon
                                        points={showConnectionNames ? "-18,22 18,22 0,-22" : "-12,15 12,15 0,-15"}
                                        fill={edgeColor}
                                        stroke={edgeColor}
                                        strokeWidth="6"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        paintOrder="stroke fill"
                                      />
                                    </g>
                                  )}

                                  {/* Destination Arrow - visible if arrow points toward destination node */}
                                  {arrowsToward.has(destNode.id) && (
                                    <g
                                      transform={`translate(${destArrowX}, ${destArrowY}) rotate(${destArrowAngle + 90})`}
                                      style={{ cursor: 'pointer' }}
                                      onClick={(e) => handleArrowClick(destNode.id, e)}
                                      onMouseDown={(e) => e.stopPropagation()}
                                    >
                                      {/* Glow effect for arrow - only when selected or hovered */}
                                      {(isSelected || isHovered) && (
                                        <polygon
                                          points="-12,15 12,15 0,-15"
                                          fill={edgeColor}
                                          stroke={edgeColor}
                                          strokeWidth="8"
                                          strokeLinejoin="round"
                                          strokeLinecap="round"
                                          opacity={isSelected ? "0.3" : "0.2"}
                                          style={{
                                            filter: `blur(2px) drop-shadow(0 0 6px ${edgeColor})`
                                          }}
                                        />
                                      )}
                                      <polygon
                                        points={showConnectionNames ? "-18,22 18,22 0,-22" : "-12,15 12,15 0,-15"}
                                        fill={edgeColor}
                                        stroke={edgeColor}
                                        strokeWidth="6"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        paintOrder="stroke fill"
                                      />
                                    </g>
                                  )}

                                  {/* Hover Dots - only visible when hovering and using straight routing */}
                                  {isHovered && (!enableAutoRouting || routingStyle === 'straight') && (
                                    <>
                                      {/* Source Dot - only show if arrow not pointing toward source */}
                                      {!arrowsToward.has(sourceNode.id) && (
                                        <g>
                                          <circle
                                            cx={sourceArrowX}
                                            cy={sourceArrowY}
                                            r="20"
                                            fill="transparent"
                                            style={{ cursor: 'pointer' }}
                                            onClick={(e) => handleArrowClick(sourceNode.id, e)}
                                            onMouseDown={(e) => e.stopPropagation()}
                                          />
                                          <circle
                                            cx={sourceArrowX}
                                            cy={sourceArrowY}
                                            r={showConnectionNames ? "16" : "8"}
                                            fill={edgeColor}
                                            style={{ pointerEvents: 'none' }}
                                          />
                                        </g>
                                      )}

                                      {/* Destination Dot - only show if arrow not pointing toward destination */}
                                      {!arrowsToward.has(destNode.id) && (
                                        <g>
                                          <circle
                                            cx={destArrowX}
                                            cy={destArrowY}
                                            r="20"
                                            fill="transparent"
                                            style={{ cursor: 'pointer' }}
                                            onClick={(e) => handleArrowClick(destNode.id, e)}
                                            onMouseDown={(e) => e.stopPropagation()}
                                          />
                                          <circle
                                            cx={destArrowX}
                                            cy={destArrowY}
                                            r={showConnectionNames ? "16" : "8"}
                                            fill={edgeColor}
                                            style={{ pointerEvents: 'none' }}
                                          />
                                        </g>
                                      )}
                                    </>
                                  )}
                                </>
                              );
                            })()}
                          </g>
                        );
                      })}
                      {edgesAboveNodeGroups.map((edge, idx) => {
                        const sourceNode = nodes.find(n => n.id === edge.sourceId);
                        const destNode = nodes.find(n => n.id === edge.destinationId);

                        if (!sourceNode || !destNode) {
                          return null;
                        }
                        const sNodeDims = baseDimsById.get(sourceNode.id) || getNodeDimensions(sourceNode, false, null);
                        const eNodeDims = baseDimsById.get(destNode.id) || getNodeDimensions(destNode, false, null);
                        const isSNodePreviewing = previewingNodeId === sourceNode.id;
                        const isENodePreviewing = previewingNodeId === destNode.id;
                        const x1 = sourceNode.x + sNodeDims.currentWidth / 2;
                        const y1 = sourceNode.y + (isSNodePreviewing ? NODE_HEIGHT / 2 : sNodeDims.currentHeight / 2);
                        const x2 = destNode.x + eNodeDims.currentWidth / 2;
                        const y2 = destNode.y + (isENodePreviewing ? NODE_HEIGHT / 2 : eNodeDims.currentHeight / 2);

                        const isHovered = hoveredEdgeInfo?.edgeId === edge.id;
                        const isSelected = selectedEdgeId === edge.id || selectedEdgeIds.has(edge.id);




                        // Get edge color - prioritize definitionNodeIds for custom types, then typeNodeId for base types
                        const getEdgeColor = () => {
                          // First check definitionNodeIds (for custom connection types set via control panel)
                          if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
                            const definitionNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
                            if (definitionNode) {
                              return definitionNode.color || NODE_DEFAULT_COLOR;
                            }
                          }

                          // Then check typeNodeId (for base connection type)
                          if (edge.typeNodeId) {
                            // Special handling for base connection prototype - ensure it's black
                            if (edge.typeNodeId === 'base-connection-prototype') {
                              return '#000000'; // Black color for base connection
                            }
                            const edgePrototype = edgePrototypesMap.get(edge.typeNodeId);
                            if (edgePrototype) {
                              return edgePrototype.color || NODE_DEFAULT_COLOR;
                            }
                          }

                          return destNode.color || NODE_DEFAULT_COLOR;
                        };
                        const edgeColor = getEdgeColor();

                        // Calculate arrow position and rotation
                        const dx = x2 - x1;
                        const dy = y2 - y1;
                        const length = Math.sqrt(dx * dx + dy * dy);

                        // Helper function to calculate edge intersection with rectangular nodes
                        const getNodeEdgeIntersection = (nodeX, nodeY, nodeWidth, nodeHeight, dirX, dirY) => {
                          const centerX = nodeX + nodeWidth / 2;
                          const centerY = nodeY + nodeHeight / 2;
                          const halfWidth = nodeWidth / 2;
                          const halfHeight = nodeHeight / 2;
                          const intersections = [];

                          if (dirX > 0) {
                            const t = halfWidth / dirX;
                            const y = dirY * t;
                            if (Math.abs(y) <= halfHeight) intersections.push({ x: centerX + halfWidth, y: centerY + y, distance: t });
                          }
                          if (dirX < 0) {
                            const t = -halfWidth / dirX;
                            const y = dirY * t;
                            if (Math.abs(y) <= halfHeight) intersections.push({ x: centerX - halfWidth, y: centerY + y, distance: t });
                          }
                          if (dirY > 0) {
                            const t = halfHeight / dirY;
                            const x = dirX * t;
                            if (Math.abs(x) <= halfWidth) intersections.push({ x: centerX + x, y: centerY + halfHeight, distance: t });
                          }
                          if (dirY < 0) {
                            const t = -halfHeight / dirY;
                            const x = dirX * t;
                            if (Math.abs(x) <= halfWidth) intersections.push({ x: centerX + x, y: centerY - halfHeight, distance: t });
                          }

                          return intersections.reduce((closest, current) =>
                            !closest || current.distance < closest.distance ? current : closest, null);
                        };

                        // Calculate edge intersections
                        const sourceIntersection = getNodeEdgeIntersection(
                          sourceNode.x, sourceNode.y, sNodeDims.currentWidth, sNodeDims.currentHeight,
                          dx / length, dy / length
                        );

                        const destIntersection = getNodeEdgeIntersection(
                          destNode.x, destNode.y, eNodeDims.currentWidth, eNodeDims.currentHeight,
                          -dx / length, -dy / length
                        );

                        // Determine if each end of the edge should be shortened for arrows
                        // Ensure arrowsToward is a Set (fix for loading from file)
                        const arrowsToward = edge.directionality?.arrowsToward instanceof Set
                          ? edge.directionality.arrowsToward
                          : new Set(Array.isArray(edge.directionality?.arrowsToward) ? edge.directionality.arrowsToward : []);

                        // Only shorten connections at ends with arrows or hover state
                        let shouldShortenSource = isHovered || arrowsToward.has(sourceNode.id);
                        let shouldShortenDest = isHovered || arrowsToward.has(destNode.id);
                        if (enableAutoRouting && routingStyle === 'manhattan') {
                          // In Manhattan mode, never shorten for hover—only for actual arrows
                          shouldShortenSource = arrowsToward.has(sourceNode.id);
                          shouldShortenDest = arrowsToward.has(destNode.id);
                        }

                        // Determine actual start/end points for rendering
                        let startX, startY, endX, endY;

                        // For clean routing, use assigned ports; otherwise use intersection-based positioning
                        if (enableAutoRouting && routingStyle === 'clean') {
                          const portAssignment = cleanLaneOffsets.get(edge.id);
                          if (portAssignment) {
                            const { sourcePort, destPort } = portAssignment;

                            // Check if this edge has directional arrows
                            const hasSourceArrow = arrowsToward.has(sourceNode.id);
                            const hasDestArrow = arrowsToward.has(destNode.id);

                            // Use ports for directional connections, centers for non-directional
                            startX = hasSourceArrow ? sourcePort.x : x1;
                            startY = hasSourceArrow ? sourcePort.y : y1;
                            endX = hasDestArrow ? destPort.x : x2;
                            endY = hasDestArrow ? destPort.y : y2;
                          } else {
                            // Fallback to node centers for clean routing
                            startX = x1;
                            startY = y1;
                            endX = x2;
                            endY = y2;
                          }
                        } else {
                          // Use intersection-based positioning for other routing modes
                          startX = shouldShortenSource ? (sourceIntersection?.x || x1) : x1;
                          startY = shouldShortenSource ? (sourceIntersection?.y || y1) : y1;
                          endX = shouldShortenDest ? (destIntersection?.x || x2) : x2;
                          endY = shouldShortenDest ? (destIntersection?.y || y2) : y2;
                        }

                        // Predeclare Manhattan path info for safe use below
                        let manhattanPathD = null;
                        let manhattanSourceSide = null;
                        let manhattanDestSide = null;

                        // When using Manhattan routing, snap to 4 node ports (midpoints of each side)
                        if (enableAutoRouting && routingStyle === 'manhattan') {
                          const sCenterX = sourceNode.x + sNodeDims.currentWidth / 2;
                          const sCenterY = sourceNode.y + sNodeDims.currentHeight / 2;
                          const dCenterX = destNode.x + eNodeDims.currentWidth / 2;
                          const dCenterY = destNode.y + eNodeDims.currentHeight / 2;

                          const sPorts = {
                            top: { x: sCenterX, y: sourceNode.y },
                            bottom: { x: sCenterX, y: sourceNode.y + sNodeDims.currentHeight },
                            left: { x: sourceNode.x, y: sCenterY },
                            right: { x: sourceNode.x + sNodeDims.currentWidth, y: sCenterY },
                          };
                          const dPorts = {
                            top: { x: dCenterX, y: destNode.y },
                            bottom: { x: dCenterX, y: destNode.y + eNodeDims.currentHeight },
                            left: { x: destNode.x, y: dCenterY },
                            right: { x: destNode.x + eNodeDims.currentWidth, y: dCenterY },
                          };

                          const relDx = dCenterX - sCenterX;
                          const relDy = dCenterY - sCenterY;
                          let sPort, dPort;
                          if (Math.abs(relDx) >= Math.abs(relDy)) {
                            // Prefer horizontal ports
                            sPort = relDx >= 0 ? sPorts.right : sPorts.left;
                            dPort = relDx >= 0 ? dPorts.left : dPorts.right;
                          } else {
                            // Prefer vertical ports
                            sPort = relDy >= 0 ? sPorts.bottom : sPorts.top;
                            dPort = relDy >= 0 ? dPorts.top : dPorts.bottom;
                          }
                          startX = sPort.x;
                          startY = sPort.y;
                          endX = dPort.x;
                          endY = dPort.y;

                          // Determine sides for perpendicular entry/exit
                          const sSide = (Math.abs(startY - sourceNode.y) < 0.5) ? 'top'
                            : (Math.abs(startY - (sourceNode.y + sNodeDims.currentHeight)) < 0.5) ? 'bottom'
                              : (Math.abs(startX - sourceNode.x) < 0.5) ? 'left' : 'right';
                          const dSide = (Math.abs(endY - destNode.y) < 0.5) ? 'top'
                            : (Math.abs(endY - (destNode.y + eNodeDims.currentHeight)) < 0.5) ? 'bottom'
                              : (Math.abs(endX - destNode.x) < 0.5) ? 'left' : 'right';
                          const initOrient = (sSide === 'left' || sSide === 'right') ? 'H' : 'V';
                          const finalOrient = (dSide === 'left' || dSide === 'right') ? 'H' : 'V';

                          const effectiveBends = (manhattanBends === 'auto')
                            ? (initOrient === finalOrient ? 'two' : 'one')
                            : manhattanBends;

                          // Local helpers declared before use to avoid hoisting issues
                          const cornerRadiusLocal = 8;
                          const buildRoundedLPathOriented = (sx, sy, ex, ey, r, firstOrientation /* 'H' | 'V' */) => {
                            if (firstOrientation === 'H') {
                              if (sx === ex || sy === ey) {
                                return `M ${sx},${sy} L ${ex},${ey}`;
                              }
                              const signX = ex > sx ? 1 : -1;
                              const signY = ey > sy ? 1 : -1;
                              const cornerX = ex;
                              const cornerY = sy;
                              const hx = cornerX - signX * r;
                              const hy = cornerY;
                              const vx = cornerX;
                              const vy = cornerY + signY * r;
                              return `M ${sx},${sy} L ${hx},${hy} Q ${cornerX},${cornerY} ${vx},${vy} L ${ex},${ey}`;
                            } else {
                              if (sx === ex || sy === ey) {
                                return `M ${sx},${sy} L ${ex},${ey}`;
                              }
                              const signX = ex > sx ? 1 : -1;
                              const signY = ey > sy ? 1 : -1;
                              const cornerX = sx;
                              const cornerY = ey;
                              const vx = cornerX;
                              const vy = cornerY - signY * r;
                              const hx = cornerX + signX * r;
                              const hy = cornerY;
                              return `M ${sx},${sy} L ${vx},${vy} Q ${cornerX},${cornerY} ${hx},${hy} L ${ex},${ey}`;
                            }
                          };
                          const buildRoundedZPathOriented = (sx, sy, ex, ey, r, pattern /* 'HVH' | 'VHV' */) => {
                            if (sx === ex || sy === ey) {
                              return `M ${sx},${sy} L ${ex},${ey}`;
                            }
                            if (pattern === 'HVH') {
                              // Horizontal → Vertical → Horizontal with rounded corners at both bends
                              const midX = (sx + ex) / 2;
                              const signX1 = midX >= sx ? 1 : -1; // initial horizontal direction
                              const signY = ey >= sy ? 1 : -1;     // vertical direction
                              const signX2 = ex >= midX ? 1 : -1;  // final horizontal direction
                              const hx1 = midX - signX1 * r;       // before first corner
                              const vy1 = sy + signY * r;          // after first corner
                              const vy2 = ey - signY * r;          // before second corner
                              const hx2 = midX + signX2 * r;       // after second corner
                              return `M ${sx},${sy} L ${hx1},${sy} Q ${midX},${sy} ${midX},${vy1} L ${midX},${vy2} Q ${midX},${ey} ${hx2},${ey} L ${ex},${ey}`;
                            } else {
                              // Vertical → Horizontal → Vertical with rounded corners at both bends
                              const midY = (sy + ey) / 2;
                              const signY1 = midY >= sy ? 1 : -1;  // initial vertical direction
                              const signX = ex >= sx ? 1 : -1;      // horizontal direction (same for both H segments)
                              const signY2 = ey >= midY ? 1 : -1;   // final vertical direction
                              const vy1 = midY - signY1 * r;        // before first corner
                              const hx1 = sx + signX * r;           // after first corner
                              const hx2 = ex - signX * r;           // before second corner
                              const vy2 = midY + signY2 * r;        // after second corner
                              return `M ${sx},${sy} L ${sx},${vy1} Q ${sx},${midY} ${hx1},${midY} L ${hx2},${midY} Q ${ex},${midY} ${ex},${vy2} L ${ex},${ey}`;
                            }
                          };
                          let pathD;
                          if (effectiveBends === 'two' && initOrient === finalOrient) {
                            pathD = (initOrient === 'H')
                              ? buildRoundedZPathOriented(startX, startY, endX, endY, cornerRadiusLocal, 'HVH')
                              : buildRoundedZPathOriented(startX, startY, endX, endY, cornerRadiusLocal, 'VHV');
                          } else {
                            pathD = buildRoundedLPathOriented(startX, startY, endX, endY, cornerRadiusLocal, initOrient);
                          }

                          // Assign for rendering and arrow logic
                          manhattanPathD = pathD;
                          manhattanSourceSide = sSide;
                          manhattanDestSide = dSide;
                        }
                        return (
                          <g key={`edge-above-${edge.id}-${idx}`}>
                            {/* Main edge line - always same thickness */}
                            {/* Glow effect for selected or hovered edge */}
                            {(isSelected || isHovered) && (
                              (enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean')) ? (
                                <path
                                  d={(routingStyle === 'manhattan') ? manhattanPathD : (() => {
                                    // Use consistent clean routing path helper
                                    const cleanPts = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
                                    return buildRoundedPathFromPoints(cleanPts, 8);
                                  })()}
                                  fill="none"
                                  stroke={edgeColor}
                                  strokeWidth="12"
                                  opacity={isSelected ? "0.3" : "0.2"}
                                  style={{
                                    filter: `blur(3px) drop-shadow(0 0 8px ${edgeColor})`
                                  }}
                                  strokeLinecap="round"
                                />
                              ) : (() => {
                                // Glow effect also needs curve for multi-edge pairs
                                const curveInfo = edgeCurveInfo.get(edge.id);
                                if (curveInfo && curveInfo.totalInPair > 1) {
                                  const { pairIndex, totalInPair } = curveInfo;
                                  const curveSpacing = 40;
                                  const offsetIndex = pairIndex - (totalInPair - 1) / 2;
                                  const perpOffset = offsetIndex * curveSpacing;
                                  const edgeDx = endX - startX;
                                  const edgeDy = endY - startY;
                                  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
                                  const perpX = edgeLen > 0 ? -edgeDy / edgeLen : 0;
                                  const perpY = edgeLen > 0 ? edgeDx / edgeLen : 0;
                                  const curveMidX = (startX + endX) / 2;
                                  const curveMidY = (startY + endY) / 2;
                                  const ctrlX = curveMidX + perpX * perpOffset;
                                  const ctrlY = curveMidY + perpY * perpOffset;
                                  return (
                                    <path
                                      d={`M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`}
                                      fill="none"
                                      stroke={edgeColor}
                                      strokeWidth="12"
                                      opacity={isSelected ? "0.3" : "0.2"}
                                      style={{
                                        filter: `blur(3px) drop-shadow(0 0 8px ${edgeColor})`
                                      }}
                                      strokeLinecap="round"
                                    />
                                  );
                                }
                                return (
                                  <line
                                    x1={startX}
                                    y1={startY}
                                    x2={endX}
                                    y2={endY}
                                    stroke={edgeColor}
                                    strokeWidth="12"
                                    opacity={isSelected ? "0.3" : "0.2"}
                                    style={{
                                      filter: `blur(3px) drop-shadow(0 0 8px ${edgeColor})`
                                    }}
                                  />
                                );
                              })()
                            )}

                            {(enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean')) ? (
                              <>
                                {routingStyle === 'manhattan' && !arrowsToward.has(sourceNode.id) && (
                                  <line x1={x1} y1={y1} x2={startX} y2={startY} stroke={edgeColor} strokeWidth={showConnectionNames ? "16" : "6"} strokeLinecap="round" />
                                )}
                                {routingStyle === 'manhattan' && !arrowsToward.has(destNode.id) && (
                                  <line x1={endX} y1={endY} x2={x2} y2={y2} stroke={edgeColor} strokeWidth={showConnectionNames ? "16" : "6"} strokeLinecap="round" />
                                )}
                                <path
                                  d={(routingStyle === 'manhattan') ? manhattanPathD : (() => {
                                    // Use consistent clean routing path helper
                                    const cleanPts = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
                                    return buildRoundedPathFromPoints(cleanPts, 8);
                                  })()}
                                  fill="none"
                                  stroke={edgeColor}
                                  strokeWidth={showConnectionNames ? "16" : "6"}
                                  style={{ transition: 'stroke 0.2s ease' }}
                                  strokeLinecap="round"
                                />
                              </>
                            ) : (() => {
                              // Check if this edge needs curve offset (multiple edges between same nodes)
                              const curveInfo = edgeCurveInfo.get(edge.id);
                              if (curveInfo && curveInfo.totalInPair > 1) {
                                // Calculate curve offset for parallel edges
                                const { pairIndex, totalInPair } = curveInfo;
                                const curveSpacing = 40; // Pixels between parallel edge curves
                                // Center the curves: offset from -half to +half of total spread
                                const offsetIndex = pairIndex - (totalInPair - 1) / 2;
                                const perpOffset = offsetIndex * curveSpacing;

                                // Calculate perpendicular direction
                                const edgeDx = endX - startX;
                                const edgeDy = endY - startY;
                                const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
                                const perpX = edgeLen > 0 ? -edgeDy / edgeLen : 0;
                                const perpY = edgeLen > 0 ? edgeDx / edgeLen : 0;

                                // Control point at midpoint, offset perpendicular to edge
                                const curveMidX = (startX + endX) / 2;
                                const curveMidY = (startY + endY) / 2;
                                const ctrlX = curveMidX + perpX * perpOffset;
                                const ctrlY = curveMidY + perpY * perpOffset;

                                return (
                                  <path
                                    d={`M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`}
                                    fill="none"
                                    stroke={edgeColor}
                                    strokeWidth={showConnectionNames ? "16" : "6"}
                                    style={{ transition: 'stroke 0.2s ease' }}
                                    strokeLinecap="round"
                                  />
                                );
                              }
                              // Single edge - render as straight line
                              return (
                                <line
                                  x1={startX}
                                  y1={startY}
                                  x2={endX}
                                  y2={endY}
                                  stroke={edgeColor}
                                  strokeWidth={showConnectionNames ? "16" : "6"}
                                  style={{ transition: 'stroke 0.2s ease' }}
                                />
                              );
                            })()}

                            {/* Connection name text - only show when enabled */}
                            {showConnectionNames && (() => {
                              let midX;
                              let midY;
                              let angle;
                              if (enableAutoRouting && routingStyle === 'manhattan') {
                                const horizontalLen = Math.abs(endX - startX);
                                const verticalLen = Math.abs(endY - startY);
                                if (horizontalLen >= verticalLen) {
                                  midX = (startX + endX) / 2;
                                  midY = startY;
                                  angle = 0;
                                } else {
                                  midX = endX;
                                  midY = (startY + endY) / 2;
                                  angle = 90;
                                }
                              } else {
                                midX = (x1 + x2) / 2;
                                midY = (y1 + y2) / 2;
                                angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
                              }

                              // Determine connection name to display
                              let connectionName = 'Connection';
                              if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
                                const definitionNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
                                if (definitionNode) {
                                  connectionName = definitionNode.name || 'Connection';
                                }
                              } else if (edge.typeNodeId) {
                                const edgePrototype = edgePrototypesMap.get(edge.typeNodeId);
                                if (edgePrototype) {
                                  connectionName = edgePrototype.name || 'Connection';
                                }
                              }

                              // Smart label placement based on routing style
                              if (enableAutoRouting && routingStyle === 'manhattan') {
                                // Always try cached placement first to prevent flicker (except during dragging)
                                const cached = placedLabelsRef.current.get(edge.id);
                                if (cached && cached.position && !draggingNodeInfo) {
                                  const stabilized = stabilizeLabelPosition(edge.id, cached.position.x, cached.position.y, cached.position.angle || 0);
                                  midX = stabilized.x;
                                  midY = stabilized.y;
                                  angle = stabilized.angle || 0;
                                } else {
                                  const pathPoints = generateManhattanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, manhattanBends);
                                  const placement = chooseLabelPlacement(pathPoints, connectionName, 24, edge.id);
                                  if (placement) {
                                    midX = placement.x;
                                    midY = placement.y;
                                    angle = placement.angle || 0;

                                    // Register this label placement
                                    const labelRect = {
                                      minX: midX - estimateTextWidth(connectionName, 24) / 2,
                                      maxX: midX + estimateTextWidth(connectionName, 24) / 2,
                                      minY: midY - 24 * 1.1 / 2,
                                      maxY: midY + 24 * 1.1 / 2,
                                    };
                                    const stabilized = stabilizeLabelPosition(edge.id, midX, midY, angle);
                                    placedLabelsRef.current.set(edge.id, {
                                      rect: labelRect,
                                      position: { x: stabilized.x, y: stabilized.y, angle: stabilized.angle }
                                    });
                                  } else {
                                    // Fallback to simple Manhattan logic
                                    const horizontalLen = Math.abs(endX - startX);
                                    const verticalLen = Math.abs(endY - startY);
                                    if (horizontalLen >= verticalLen) {
                                      midX = (startX + endX) / 2;
                                      midY = startY;
                                      angle = 0;
                                    } else {
                                      midX = endX;
                                      midY = (startY + endY) / 2;
                                      angle = 90;
                                    }
                                  }
                                }
                              } else if (enableAutoRouting && routingStyle === 'clean') {
                                // Always try cached placement first to prevent flicker (except during dragging)
                                const cached = placedLabelsRef.current.get(edge.id);
                                if (cached && cached.position && !draggingNodeInfo) {
                                  const stabilized = stabilizeLabelPosition(edge.id, cached.position.x, cached.position.y, cached.position.angle || 0);
                                  midX = stabilized.x;
                                  midY = stabilized.y;
                                  angle = stabilized.angle || 0;
                                } else {
                                  const pathPoints = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
                                  const placement = chooseLabelPlacement(pathPoints, connectionName, 24, edge.id);
                                  if (placement) {
                                    midX = placement.x;
                                    midY = placement.y;
                                    angle = placement.angle || 0;

                                    // Register this label placement
                                    const labelRect = {
                                      minX: midX - estimateTextWidth(connectionName, 24) / 2,
                                      maxX: midX + estimateTextWidth(connectionName, 24) / 2,
                                      minY: midY - 24 * 1.1 / 2,
                                      maxY: midY + 24 * 1.1 / 2,
                                    };
                                    const stabilized = stabilizeLabelPosition(edge.id, midX, midY, angle);
                                    placedLabelsRef.current.set(edge.id, {
                                      rect: labelRect,
                                      position: { x: stabilized.x, y: stabilized.y, angle: stabilized.angle }
                                    });
                                  } else {
                                    // Fallback to midpoint
                                    midX = (x1 + x2) / 2;
                                    midY = (y1 + y2) / 2;
                                    angle = 0;
                                  }
                                }
                              } else {
                                // Straight line: reuse cached placement when available to prevent flicker (except during dragging)
                                const cached = placedLabelsRef.current.get(edge.id);
                                if (cached && cached.position && !draggingNodeInfo) {
                                  const stabilized = stabilizeLabelPosition(edge.id, cached.position.x, cached.position.y, cached.position.angle || Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI));
                                  midX = stabilized.x;
                                  midY = stabilized.y;
                                  angle = stabilized.angle || Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
                                } else {
                                  // Fallback to original behavior
                                  midX = (x1 + x2) / 2;
                                  midY = (y1 + y2) / 2;
                                  angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);

                                  // Cache this position for future reuse
                                  const labelRect = {
                                    minX: midX - estimateTextWidth(connectionName, 24) / 2,
                                    maxX: midX + estimateTextWidth(connectionName, 24) / 2,
                                    minY: midY - 24 * 1.1 / 2,
                                    maxY: midY + 24 * 1.1 / 2,
                                  };
                                  const stabilized = stabilizeLabelPosition(edge.id, midX, midY, angle);
                                  placedLabelsRef.current.set(edge.id, {
                                    rect: labelRect,
                                    position: { x: stabilized.x, y: stabilized.y, angle: stabilized.angle }
                                  });
                                }
                              }

                              // Adjust angle to keep text readable (never upside down)
                              const adjustedAngle = (angle > 90 || angle < -90) ? angle + 180 : angle;

                              return (
                                <g>
                                  {/* Canvas-colored text creating a "hole" effect in the connection */}
                                  <text
                                    x={midX}
                                    y={midY}
                                    fill="#bdb5b5"
                                    fontSize="24"
                                    fontWeight="bold"
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    transform={`rotate(${adjustedAngle}, ${midX}, ${midY})`}
                                    stroke={hexToHsl(edgeColor).l > 42 ? getTextColor(edgeColor) : edgeColor}
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    paintOrder="stroke fill"
                                    style={{ pointerEvents: 'none', fontFamily: "'EmOne', sans-serif" }}
                                  >
                                    {connectionName}
                                  </text>
                                </g>
                              );
                            })()}

                            {/* Invisible click area for edge selection - matches hover detection */}
                            {(enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean')) ? (
                              <path
                                d={(routingStyle === 'manhattan') ? manhattanPathD : (() => {
                                  // Use consistent clean routing path helper
                                  const cleanPts = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
                                  return buildRoundedPathFromPoints(cleanPts, 8);
                                })()}
                                fill="none"
                                stroke="transparent"
                                strokeWidth="40"
                                style={{ cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();

                                  // Handle multiple selection with Ctrl/Cmd key
                                  if (e.ctrlKey || e.metaKey) {
                                    // Toggle this edge in the multiple selection
                                    if (selectedEdgeIds.has(edge.id)) {
                                      storeActions.removeSelectedEdgeId(edge.id);
                                    } else {
                                      storeActions.addSelectedEdgeId(edge.id);
                                    }
                                  } else {
                                    // Single selection - clear multiple selection and set single edge
                                    storeActions.clearSelectedEdgeIds();
                                    storeActions.setSelectedEdgeId(edge.id);
                                  }
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();

                                  // Find the defining node for this edge's connection type
                                  let definingNodeId = null;

                                  // Check definitionNodeIds first (for custom connection types)
                                  if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
                                    definingNodeId = edge.definitionNodeIds[0];
                                  } else if (edge.typeNodeId) {
                                    // Fallback to typeNodeId (for base connection type)
                                    definingNodeId = edge.typeNodeId;
                                  }

                                  // Open the panel tab for the defining node
                                  if (definingNodeId) {
                                    storeActions.openRightPanelNodeTab(definingNodeId);
                                  }
                                }}
                              />
                            ) : (
                              <line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="transparent"
                                strokeWidth="40"
                                style={{ cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();

                                  // Handle multiple selection with Ctrl/Cmd key
                                  if (e.ctrlKey || e.metaKey) {
                                    // Toggle this edge in the multiple selection
                                    if (selectedEdgeIds.has(edge.id)) {
                                      storeActions.removeSelectedEdgeId(edge.id);
                                    } else {
                                      storeActions.addSelectedEdgeId(edge.id);
                                    }
                                  } else {
                                    // Single selection - clear multiple selection and set single edge
                                    storeActions.clearSelectedEdgeIds();
                                    storeActions.setSelectedEdgeId(edge.id);
                                  }
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();

                                  // Find the defining node for this edge's connection type
                                  let definingNodeId = null;

                                  // Check definitionNodeIds first (for custom connection types)
                                  if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
                                    definingNodeId = edge.definitionNodeIds[0];
                                  } else if (edge.typeNodeId) {
                                    // Fallback to typeNodeId (for base connection type)
                                    definingNodeId = edge.typeNodeId;
                                  }

                                  // Open the panel tab for the defining node
                                  if (definingNodeId) {
                                    storeActions.openRightPanelNodeTab(definingNodeId);
                                  }
                                }}
                              />
                            )}

                            {/* Smart directional arrows with clickable toggle */}
                            {(() => {
                              // Calculate arrow positions (use fallback if intersections fail)
                              let sourceArrowX, sourceArrowY, destArrowX, destArrowY, sourceArrowAngle, destArrowAngle;

                              if (enableAutoRouting && routingStyle === 'clean') {
                                // Clean mode: use actual port assignments for proper arrow positioning
                                const offset = showConnectionNames ? 6 : (shouldShortenSource || shouldShortenDest ? 3 : 5);
                                const portAssignment = cleanLaneOffsets.get(edge.id);

                                if (portAssignment) {
                                  const { sourcePort, destPort, sourceSide, destSide } = portAssignment;

                                  // Position arrows pointing TOWARD the target node (into the edge)
                                  // Arrow tip points toward the node, positioned outside the edge
                                  switch (sourceSide) {
                                    case 'top':
                                      sourceArrowAngle = 90; // Arrow points down toward node
                                      sourceArrowX = sourcePort.x;
                                      sourceArrowY = sourcePort.y - offset;
                                      break;
                                    case 'bottom':
                                      sourceArrowAngle = -90; // Arrow points up toward node
                                      sourceArrowX = sourcePort.x;
                                      sourceArrowY = sourcePort.y + offset;
                                      break;
                                    case 'left':
                                      sourceArrowAngle = 0; // Arrow points right toward node
                                      sourceArrowX = sourcePort.x - offset;
                                      sourceArrowY = sourcePort.y;
                                      break;
                                    case 'right':
                                      sourceArrowAngle = 180; // Arrow points left toward node
                                      sourceArrowX = sourcePort.x + offset;
                                      sourceArrowY = sourcePort.y;
                                      break;
                                  }

                                  switch (destSide) {
                                    case 'top':
                                      destArrowAngle = 90; // Arrow points down toward node
                                      destArrowX = destPort.x;
                                      destArrowY = destPort.y - offset;
                                      break;
                                    case 'bottom':
                                      destArrowAngle = -90; // Arrow points up toward node
                                      destArrowX = destPort.x;
                                      destArrowY = destPort.y + offset;
                                      break;
                                    case 'left':
                                      destArrowAngle = 0; // Arrow points right toward node
                                      destArrowX = destPort.x - offset;
                                      destArrowY = destPort.y;
                                      break;
                                    case 'right':
                                      destArrowAngle = 180; // Arrow points left toward node
                                      destArrowX = destPort.x + offset;
                                      destArrowY = destPort.y;
                                      break;
                                  }
                                } else {
                                  // Fallback to center-based positioning
                                  const deltaX = endX - startX;
                                  const deltaY = endY - startY;
                                  const isMainlyVertical = Math.abs(deltaY) > Math.abs(deltaX);

                                  if (isMainlyVertical) {
                                    sourceArrowAngle = deltaY > 0 ? -90 : 90;
                                    sourceArrowX = startX;
                                    sourceArrowY = startY + (deltaY > 0 ? offset : -offset);
                                    destArrowAngle = deltaX > 0 ? 0 : 180;
                                    destArrowX = endX + (deltaX > 0 ? -offset : offset);
                                    destArrowY = endY;
                                  } else {
                                    sourceArrowAngle = deltaX > 0 ? 180 : 0;
                                    sourceArrowX = startX + (deltaX > 0 ? offset : -offset);
                                    sourceArrowY = startY;
                                    destArrowAngle = deltaY > 0 ? 90 : -90;
                                    destArrowX = endX;
                                    destArrowY = endY + (deltaY > 0 ? -offset : offset);
                                  }
                                }
                              } else if (!sourceIntersection || !destIntersection) {
                                // Fallback positioning - arrows/dots closer to connection center  
                                const fallbackOffset = showConnectionNames ? 20 :
                                  (shouldShortenSource || shouldShortenDest ? 12 : 15);
                                sourceArrowX = x1 + (dx / length) * fallbackOffset;
                                sourceArrowY = y1 + (dy / length) * fallbackOffset;
                                destArrowX = x2 - (dx / length) * fallbackOffset;
                                destArrowY = y2 - (dy / length) * fallbackOffset;
                                sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
                                destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
                              } else if (enableAutoRouting && routingStyle === 'clean') {
                                // Clean routing arrow placement - position close to nodes for better visibility
                                const offset = showConnectionNames ? 8 : 6; // Reduced offset for better visibility
                                const portAssignment = cleanLaneOffsets.get(edge.id);

                                if (portAssignment) {
                                  const { sourcePort, destPort, sourceSide, destSide } = portAssignment;

                                  // Position arrows close to the actual ports, pointing toward the nodes
                                  switch (sourceSide) {
                                    case 'top':
                                      sourceArrowAngle = 90; // Arrow points down toward node
                                      sourceArrowX = sourcePort.x;
                                      sourceArrowY = sourcePort.y - offset;
                                      break;
                                    case 'bottom':
                                      sourceArrowAngle = -90; // Arrow points up toward node
                                      sourceArrowX = sourcePort.x;
                                      sourceArrowY = sourcePort.y + offset;
                                      break;
                                    case 'left':
                                      sourceArrowAngle = 0; // Arrow points right toward node
                                      sourceArrowX = sourcePort.x - offset;
                                      sourceArrowY = sourcePort.y;
                                      break;
                                    case 'right':
                                      sourceArrowAngle = 180; // Arrow points left toward node
                                      sourceArrowX = sourcePort.x + offset;
                                      sourceArrowY = sourcePort.y;
                                      break;
                                  }

                                  switch (destSide) {
                                    case 'top':
                                      destArrowAngle = 90; // Arrow points down toward node
                                      destArrowX = destPort.x;
                                      destArrowY = destPort.y - offset;
                                      break;
                                    case 'bottom':
                                      destArrowAngle = -90; // Arrow points up toward node
                                      destArrowX = destPort.x;
                                      destArrowY = destPort.y + offset;
                                      break;
                                    case 'left':
                                      destArrowAngle = 0; // Arrow points right toward node
                                      destArrowX = destPort.x - offset;
                                      destArrowY = destPort.y;
                                      break;
                                    case 'right':
                                      destArrowAngle = 180; // Arrow points left toward node
                                      destArrowX = destPort.x + offset;
                                      destArrowY = destPort.y;
                                      break;
                                  }
                                } else {
                                  // Fallback: position arrows close to node centers
                                  sourceArrowX = startX;
                                  sourceArrowY = startY;
                                  sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
                                  destArrowX = endX;
                                  destArrowY = endY;
                                  destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
                                }
                              } else {
                                // Manhattan-aware arrow placement; falls back to straight orientation
                                const offset = showConnectionNames ? 6 : (shouldShortenSource || shouldShortenDest ? 3 : 5);
                                if (enableAutoRouting && routingStyle === 'manhattan') {
                                  // Destination arrow aligns to terminal segment into destination
                                  const horizontalTerminal = Math.abs(endX - startX) > Math.abs(endY - startY);
                                  if (horizontalTerminal) {
                                    destArrowAngle = (endX >= startX) ? 0 : 180;
                                    destArrowX = endX + ((endX >= startX) ? -offset : offset);
                                    destArrowY = endY;
                                  } else {
                                    destArrowAngle = (endY >= startY) ? 90 : -90;
                                    destArrowX = endX;
                                    destArrowY = endY + ((endY >= startY) ? -offset : offset);
                                  }
                                  // Source arrow aligns to initial segment out of source (pointing back toward source)
                                  const horizontalInitial = Math.abs(endX - startX) > Math.abs(endY - startY);
                                  if (horizontalInitial) {
                                    sourceArrowAngle = (endX - startX) >= 0 ? 180 : 0;
                                    sourceArrowX = startX + ((endX - startX) >= 0 ? offset : -offset);
                                    sourceArrowY = startY;
                                  } else {
                                    sourceArrowAngle = (endY - startY) >= 0 ? -90 : 90;
                                    sourceArrowX = startX;
                                    sourceArrowY = startY + ((endY - startY) >= 0 ? offset : -offset);
                                  }
                                } else {
                                  // Precise intersection positioning - adjust based on slope for visual consistency
                                  const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
                                  const normalizedAngle = angle > 90 ? 180 - angle : angle;
                                  // Shorter distance for quantized slopes (hitting node sides) vs diagonal (hitting corners)
                                  const isQuantizedSlope = normalizedAngle < 15 || normalizedAngle > 75;
                                  const arrowLength = isQuantizedSlope ? offset * 0.6 : offset;
                                  sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
                                  sourceArrowX = sourceIntersection.x + (dx / length) * arrowLength;
                                  sourceArrowY = sourceIntersection.y + (dy / length) * arrowLength;
                                  destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
                                  destArrowX = destIntersection.x - (dx / length) * arrowLength;
                                  destArrowY = destIntersection.y - (dy / length) * arrowLength;
                                }
                              }

                              // Override arrow orientation deterministically by Manhattan sides
                              if (enableAutoRouting && routingStyle === 'manhattan') {
                                const sideOffset = showConnectionNames ? 6 : (shouldShortenSource || shouldShortenDest ? 3 : 5);
                                // Destination arrow strictly based on destination side
                                if (manhattanDestSide === 'left') {
                                  destArrowAngle = 0; // rightwards
                                  destArrowX = endX - sideOffset;
                                  destArrowY = endY;
                                } else if (manhattanDestSide === 'right') {
                                  destArrowAngle = 180; // leftwards
                                  destArrowX = endX + sideOffset;
                                  destArrowY = endY;
                                } else if (manhattanDestSide === 'top') {
                                  destArrowAngle = 90; // downwards
                                  destArrowX = endX;
                                  destArrowY = endY - sideOffset;
                                } else if (manhattanDestSide === 'bottom') {
                                  destArrowAngle = -90; // upwards
                                  destArrowX = endX;
                                  destArrowY = endY + sideOffset;
                                }
                                // Source arrow strictly based on source side (points toward the source node)
                                if (manhattanSourceSide === 'left') {
                                  sourceArrowAngle = 0; // rightwards
                                  sourceArrowX = startX - sideOffset;
                                  sourceArrowY = startY;
                                } else if (manhattanSourceSide === 'right') {
                                  sourceArrowAngle = 180; // leftwards
                                  sourceArrowX = startX + sideOffset;
                                  sourceArrowY = startY;
                                } else if (manhattanSourceSide === 'top') {
                                  sourceArrowAngle = 90; // downwards
                                  sourceArrowX = startX;
                                  sourceArrowY = startY - sideOffset;
                                } else if (manhattanSourceSide === 'bottom') {
                                  sourceArrowAngle = -90; // upwards
                                  sourceArrowX = startX;
                                  sourceArrowY = startY + sideOffset;
                                }
                              }

                              const handleArrowClick = (nodeId, e) => {
                                e.stopPropagation();

                                // Toggle the arrow state for the specific node
                                storeActions.updateEdge(edge.id, (draft) => {
                                  // Ensure directionality object exists
                                  if (!draft.directionality) {
                                    draft.directionality = { arrowsToward: new Set() };
                                  }
                                  // Ensure arrowsToward is a Set
                                  if (!draft.directionality.arrowsToward) {
                                    draft.directionality.arrowsToward = new Set();
                                  }

                                  // Toggle arrow for this specific node
                                  if (draft.directionality.arrowsToward.has(nodeId)) {
                                    draft.directionality.arrowsToward.delete(nodeId);
                                  } else {
                                    draft.directionality.arrowsToward.add(nodeId);
                                  }
                                });
                              };

                              return (
                                <>
                                  {/* Source Arrow - visible if arrow points toward source node */}
                                  {arrowsToward.has(sourceNode.id) && (
                                    <g
                                      transform={`translate(${sourceArrowX}, ${sourceArrowY}) rotate(${sourceArrowAngle + 90})`}
                                      style={{ cursor: 'pointer' }}
                                      onClick={(e) => handleArrowClick(sourceNode.id, e)}
                                      onMouseDown={(e) => e.stopPropagation()}
                                    >
                                      {/* Glow effect for arrow - only when selected or hovered */}
                                      {(isSelected || isHovered) && (
                                        <polygon
                                          points="-12,15 12,15 0,-15"
                                          fill={edgeColor}
                                          stroke={edgeColor}
                                          strokeWidth="8"
                                          strokeLinejoin="round"
                                          strokeLinecap="round"
                                          opacity={isSelected ? "0.3" : "0.2"}
                                          style={{
                                            filter: `blur(2px) drop-shadow(0 0 6px ${edgeColor})`
                                          }}
                                        />
                                      )}
                                      <polygon
                                        points={showConnectionNames ? "-18,22 18,22 0,-22" : "-12,15 12,15 0,-15"}
                                        fill={edgeColor}
                                        stroke={edgeColor}
                                        strokeWidth="6"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        paintOrder="stroke fill"
                                      />
                                    </g>
                                  )}

                                  {/* Destination Arrow - visible if arrow points toward destination node */}
                                  {arrowsToward.has(destNode.id) && (
                                    <g
                                      transform={`translate(${destArrowX}, ${destArrowY}) rotate(${destArrowAngle + 90})`}
                                      style={{ cursor: 'pointer' }}
                                      onClick={(e) => handleArrowClick(destNode.id, e)}
                                      onMouseDown={(e) => e.stopPropagation()}
                                    >
                                      {/* Glow effect for arrow - only when selected or hovered */}
                                      {(isSelected || isHovered) && (
                                        <polygon
                                          points="-12,15 12,15 0,-15"
                                          fill={edgeColor}
                                          stroke={edgeColor}
                                          strokeWidth="8"
                                          strokeLinejoin="round"
                                          strokeLinecap="round"
                                          opacity={isSelected ? "0.3" : "0.2"}
                                          style={{
                                            filter: `blur(2px) drop-shadow(0 0 6px ${edgeColor})`
                                          }}
                                        />
                                      )}
                                      <polygon
                                        points={showConnectionNames ? "-18,22 18,22 0,-22" : "-12,15 12,15 0,-15"}
                                        fill={edgeColor}
                                        stroke={edgeColor}
                                        strokeWidth="6"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        paintOrder="stroke fill"
                                      />
                                    </g>
                                  )}

                                  {/* Hover Dots - only visible when hovering and using straight routing */}
                                  {isHovered && (!enableAutoRouting || routingStyle === 'straight') && (
                                    <>
                                      {/* Source Dot - only show if arrow not pointing toward source */}
                                      {!arrowsToward.has(sourceNode.id) && (
                                        <g>
                                          <circle
                                            cx={sourceArrowX}
                                            cy={sourceArrowY}
                                            r="20"
                                            fill="transparent"
                                            style={{ cursor: 'pointer' }}
                                            onClick={(e) => handleArrowClick(sourceNode.id, e)}
                                            onMouseDown={(e) => e.stopPropagation()}
                                          />
                                          <circle
                                            cx={sourceArrowX}
                                            cy={sourceArrowY}
                                            r={showConnectionNames ? "16" : "8"}
                                            fill={edgeColor}
                                            style={{ pointerEvents: 'none' }}
                                          />
                                        </g>
                                      )}

                                      {/* Destination Dot - only show if arrow not pointing toward destination */}
                                      {!arrowsToward.has(destNode.id) && (
                                        <g>
                                          <circle
                                            cx={destArrowX}
                                            cy={destArrowY}
                                            r="20"
                                            fill="transparent"
                                            style={{ cursor: 'pointer' }}
                                            onClick={(e) => handleArrowClick(destNode.id, e)}
                                            onMouseDown={(e) => e.stopPropagation()}
                                          />
                                          <circle
                                            cx={destArrowX}
                                            cy={destArrowY}
                                            r={showConnectionNames ? "16" : "8"}
                                            fill={edgeColor}
                                            style={{ pointerEvents: 'none' }}
                                          />
                                        </g>
                                      )}
                                    </>
                                  )}
                                </>
                              );
                            })()}
                          </g>
                        );
                      })}
                    </>
                  );
                })()}

                {drawingConnectionFrom && (
                  <line
                    x1={drawingConnectionFrom.startX}
                    y1={drawingConnectionFrom.startY}
                    x2={drawingConnectionFrom.currentX}
                    y2={drawingConnectionFrom.currentY}
                    stroke="black"
                    strokeWidth="8"
                  />
                )}
                {(() => {
                  const draggingNodeId = draggingNodeInfo?.primaryId || draggingNodeInfo?.instanceId;

                  // Determine which node should be treated as "active" for stacking, 
                  // giving priority to previewing, then the node whose PieMenu is currently active/animating.
                  let nodeIdToKeepActiveForStacking = previewingNodeId || currentPieMenuData?.node?.id || selectedNodeIdForPieMenu;
                  if (nodeIdToKeepActiveForStacking === draggingNodeId) {
                    nodeIdToKeepActiveForStacking = null; // Dragging node is handled separately
                  }

                  const otherNodes = nodes.filter(node =>
                    node.id !== nodeIdToKeepActiveForStacking &&
                    node.id !== draggingNodeId &&
                    visibleNodeIds.has(node.id)
                  );

                  const activeNodeToRender = nodeIdToKeepActiveForStacking
                    ? nodes.find(n => n.id === nodeIdToKeepActiveForStacking)
                    : null;

                  const draggingNodeToRender = draggingNodeId
                    ? nodes.find(n => n.id === draggingNodeId)
                    : null;

                  return (
                    <>
                      {/* Render "Other" Nodes first */}
                      {otherNodes.map((node) => {
                        const isPreviewing = previewingNodeId === node.id; // Should be false or irrelevant for these nodes
                        const baseDimensions = baseDimsById.get(node.id);
                        const descriptionContent = isPreviewing ? getNodeDescriptionContent(node, true) : null;
                        const dimensions = isPreviewing
                          ? getNodeDimensions(node, true, descriptionContent)
                          : baseDimensions || getNodeDimensions(node, false, null);

                        // Do not render the node that the abstraction carousel is open for
                        if (abstractionCarouselVisible && abstractionCarouselNode?.id === node.id) {
                          return null;
                        }

                        return (
                          <Node
                            key={node.id}
                            node={node}
                            currentWidth={dimensions.currentWidth}
                            currentHeight={dimensions.currentHeight}
                            textAreaHeight={dimensions.textAreaHeight}
                            imageWidth={dimensions.imageWidth}
                            imageHeight={dimensions.calculatedImageHeight}
                            innerNetworkWidth={dimensions.innerNetworkWidth}
                            innerNetworkHeight={dimensions.innerNetworkHeight}
                            descriptionAreaHeight={dimensions.descriptionAreaHeight}
                            isSelected={selectedInstanceIds.has(node.id)}
                            isDragging={false} // These are explicitly not the dragging node
                            onMouseDown={(e) => handleNodeMouseDown(node, e)}
                            onPointerDown={(e) => handleNodePointerDown(node, e)}
                            onPointerMove={(e) => handleNodePointerMove(node, e)}
                            onPointerUp={(e) => handleNodePointerUp(node, e)}
                            onPointerCancel={(e) => handleNodePointerCancel(node, e)}
                            onTouchStart={(e) => handleNodeTouchStart(node, e)}
                            onTouchEnd={(e) => handleNodeTouchEnd(node, e)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              showContextMenu(e.clientX, e.clientY, getContextMenuOptions(node.id));
                            }}
                            isPreviewing={isPreviewing}
                            isEditingOnCanvas={node.id === editingNodeIdOnCanvas}
                            onCommitCanvasEdit={(instanceId, newName, isRealTime = false) => {
                              storeActions.updateNodePrototype(node.prototypeId, draft => { draft.name = newName; });
                              if (!isRealTime) setEditingNodeIdOnCanvas(null);
                            }}
                            onCancelCanvasEdit={() => setEditingNodeIdOnCanvas(null)}
                            onCreateDefinition={(prototypeId) => {
                              if (mouseMoved.current) return;
                              storeActions.createAndAssignGraphDefinition(prototypeId);
                            }}
                            onAddNodeToDefinition={(prototypeId) => {
                              // Create a new alternative definition for the node without activating/opening it
                              storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);
                            }}
                            onDeleteDefinition={(prototypeId, graphId) => {
                              // Delete the specific definition graph from the node
                              storeActions.removeDefinitionFromNode(prototypeId, graphId);
                            }}
                            onExpandDefinition={(instanceId, prototypeId, graphId) => {
                              if (graphId) {
                                // Node has an existing definition to expand
                                startHurtleAnimation(instanceId, graphId, prototypeId);
                              } else {
                                // Node has no definitions - create one, then animate
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
                            }}
                            onConvertToNodeGroup={handleNodeConvertToNodeGroup}
                            storeActions={storeActions}
                            currentDefinitionIndex={nodeDefinitionIndices.get(`${node.prototypeId}-${activeGraphId}`) || 0}
                            onNavigateDefinition={(prototypeId, newIndex) => {
                              const contextKey = `${prototypeId}-${activeGraphId}`;
                              setNodeDefinitionIndices(prev => new Map(prev.set(contextKey, newIndex)));
                            }}

                          />
                        );
                      })}

                      {/* Render The PieMenu next (it will be visually under the active node) */}
                      {isPieMenuRendered && currentPieMenuData && (
                        <PieMenu
                          node={currentPieMenuData.node}
                          buttons={currentPieMenuData.buttons}
                          nodeDimensions={currentPieMenuData.nodeDimensions}
                          focusedNode={carouselFocusedNode}
                          isVisible={(
                            currentPieMenuData?.node?.id === selectedNodeIdForPieMenu &&
                            (!isTransitioningPieMenu || abstractionPrompt.visible || carouselAnimationState === 'exiting') &&
                            !(draggingNodeInfo &&
                              (draggingNodeInfo.primaryId === selectedNodeIdForPieMenu || draggingNodeInfo.instanceId === selectedNodeIdForPieMenu)
                            )
                          )}
                          onHoverChange={handlePieMenuHoverChange}
                          onAutoClose={() => {
                            console.log('[NodeCanvas] PieMenu auto-close triggered after 5 seconds');
                            setSelectedNodeIdForPieMenu(null);
                          }}
                          onExitAnimationComplete={() => {
                            // 
                            setIsPieMenuRendered(false);
                            setCurrentPieMenuData(null);
                            const wasTransitioning = isTransitioningPieMenu;
                            const pendingAbstractionId = pendingAbstractionNodeId;
                            const pendingDecomposeId = pendingDecomposeNodeId;
                            const wasInCarousel = abstractionCarouselVisible; // Check if we were in carousel mode before transition

                            // The node that was just active before the pie menu disappeared
                            const lastActiveNodeId = selectedNodeIdForPieMenu;
                            setPendingAbstractionNodeId(null);
                            setPendingDecomposeNodeId(null);

                            if (wasTransitioning && pendingAbstractionId) {
                              // This was an abstraction transition - set up the carousel with entrance animation
                              setIsTransitioningPieMenu(false);
                              const nodeData = nodes.find(n => n.id === pendingAbstractionId);
                              if (nodeData) {
                                setAbstractionCarouselNode(nodeData);
                                setCarouselAnimationState('entering');
                                setAbstractionCarouselVisible(true);
                                // IMPORTANT: Re-select the node to show the new abstraction pie menu
                                setSelectedNodeIdForPieMenu(pendingAbstractionId);
                              }
                            } else if (wasTransitioning && pendingDecomposeId) {
                              // This was a decompose transition - toggle the preview state for the node
                              setIsTransitioningPieMenu(false);
                              const nodeData = nodes.find(n => n.id === pendingDecomposeId);
                              if (nodeData) {
                                // Toggle preview state: if already previewing this node, turn off preview; otherwise turn it on
                                const isCurrentlyPreviewing = previewingNodeId === pendingDecomposeId;
                                setPreviewingNodeId(isCurrentlyPreviewing ? null : pendingDecomposeId);
                                // Re-select the node to show the pie menu again
                                setSelectedNodeIdForPieMenu(pendingDecomposeId);
                              }
                            } else if (wasTransitioning && wasInCarousel) {
                              // Check if this was an internal stage transition vs carousel exit
                              if (isCarouselStageTransition) {
                                // This was an internal stage transition - stay in carousel, just update PieMenu
                                setIsCarouselStageTransition(false); // Reset the flag
                                setIsTransitioningPieMenu(false);

                                // Change the stage here after the shrink animation completes
                                if (carouselPieMenuStage === 1) {
                                  setCarouselPieMenuStage(2);

                                } else if (carouselPieMenuStage === 2) {
                                  setCarouselPieMenuStage(1);

                                }

                                // Re-select the node to show the new stage PieMenu
                                if (lastActiveNodeId) {
                                  setSelectedNodeIdForPieMenu(lastActiveNodeId);
                                }
                              } else {
                                // This was a "back" transition from the carousel - start exit animation now
                                setCarouselAnimationState('exiting');
                                // DON'T set isTransitioningPieMenu(false) yet - wait for carousel to finish
                                // The carousel's onExitAnimationComplete will show the regular pie menu
                              }
                            } else if (wasTransitioning) {
                              // Generic pie menu transition completion (non-carousel). If the carousel
                              // was closed via click-away, do not toggle decompose preview.
                              setIsTransitioningPieMenu(false);
                              if (carouselClosedByClickAwayRef.current) {
                                // Consume and reset the flag here too, since defensive closures may skip
                                // the carousel's own exit completion callback.
                                carouselClosedByClickAwayRef.current = false;
                              } else {
                                const currentlySelectedNodeId = [...selectedInstanceIds][0];
                                if (currentlySelectedNodeId) {
                                  const selectedNodeIsPreviewing = previewingNodeId === currentlySelectedNodeId;
                                  if (selectedNodeIsPreviewing) {
                                    setPreviewingNodeId(null);
                                  } else {
                                    setPreviewingNodeId(currentlySelectedNodeId);
                                  }
                                  setSelectedNodeIdForPieMenu(currentlySelectedNodeId);
                                } else {
                                  setPreviewingNodeId(null);
                                }
                              }
                            } else {
                              // Not transitioning, just clean exit
                              setIsTransitioningPieMenu(false);
                            }
                          }}
                        />
                      )}



                      {/* Render the "Active" Node (if it exists and not being dragged) */}
                      {activeNodeToRender && visibleNodeIds.has(activeNodeToRender.id) && (
                        (() => {
                          const isPreviewing = previewingNodeId === activeNodeToRender.id;
                          const baseDimensions = baseDimsById.get(activeNodeToRender.id);
                          const descriptionContent = isPreviewing ? getNodeDescriptionContent(activeNodeToRender, true) : null;
                          const dimensions = isPreviewing
                            ? getNodeDimensions(activeNodeToRender, true, descriptionContent)
                            : baseDimensions || getNodeDimensions(activeNodeToRender, false, null);

                          // Hide if its carousel is open
                          if (abstractionCarouselVisible && abstractionCarouselNode?.id === activeNodeToRender.id) {
                            return null;
                          }

                          const centerX = activeNodeToRender.x + dimensions.currentWidth / 2;
                          const centerY = activeNodeToRender.y + dimensions.currentHeight / 2;



                          return (
                            <>
                              <OrbitOverlay
                                centerX={centerX}
                                centerY={centerY}
                                focusWidth={dimensions.currentWidth}
                                focusHeight={dimensions.currentHeight}
                                innerCandidates={orbitData.inner}
                                outerCandidates={orbitData.outer}
                              />
                              <Node
                                key={activeNodeToRender.id}
                                node={activeNodeToRender}
                                currentWidth={dimensions.currentWidth}
                                currentHeight={dimensions.currentHeight}
                                textAreaHeight={dimensions.textAreaHeight}
                                imageWidth={dimensions.imageWidth}
                                imageHeight={dimensions.calculatedImageHeight}
                                innerNetworkWidth={dimensions.innerNetworkWidth}
                                innerNetworkHeight={dimensions.innerNetworkHeight}
                                descriptionAreaHeight={dimensions.descriptionAreaHeight}
                                isSelected={selectedInstanceIds.has(activeNodeToRender.id)}
                                isDragging={false} // Explicitly not the dragging node if rendered here
                                onMouseDown={(e) => handleNodeMouseDown(activeNodeToRender, e)}
                                onPointerDown={(e) => handleNodePointerDown(activeNodeToRender, e)}
                                onPointerMove={(e) => handleNodePointerMove(activeNodeToRender, e)}
                                onPointerUp={(e) => handleNodePointerUp(activeNodeToRender, e)}
                                onPointerCancel={(e) => handleNodePointerCancel(activeNodeToRender, e)}
                                onTouchStart={(e) => handleNodeTouchStart(activeNodeToRender, e)}
                                onTouchEnd={(e) => handleNodeTouchEnd(activeNodeToRender, e)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  showContextMenu(e.clientX, e.clientY, getContextMenuOptions(activeNodeToRender.id));
                                }}
                                isPreviewing={isPreviewing}
                                isEditingOnCanvas={activeNodeToRender.id === editingNodeIdOnCanvas}
                                onCommitCanvasEdit={(instanceId, newName, isRealTime = false) => {
                                  storeActions.updateNodePrototype(activeNodeToRender.prototypeId, draft => { draft.name = newName; });
                                  if (!isRealTime) setEditingNodeIdOnCanvas(null);
                                }}
                                onCancelCanvasEdit={() => setEditingNodeIdOnCanvas(null)}
                                onCreateDefinition={(prototypeId) => {
                                  if (mouseMoved.current) return;
                                  storeActions.createAndAssignGraphDefinition(prototypeId);
                                }}
                                onAddNodeToDefinition={(prototypeId) => {
                                  // Create a new alternative definition for the node without activating/opening it
                                  storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);
                                }}
                                onDeleteDefinition={(prototypeId, graphId) => {
                                  // Delete the specific definition graph from the node
                                  storeActions.removeDefinitionFromNode(prototypeId, graphId);
                                }}
                                onExpandDefinition={(instanceId, prototypeId, graphId) => {
                                  if (graphId) {
                                    // Node has an existing definition to expand
                                    startHurtleAnimation(instanceId, graphId, prototypeId);
                                  } else {
                                    // Node has no definitions - create one, then animate
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
                                }}
                                onConvertToNodeGroup={handleNodeConvertToNodeGroup}
                                storeActions={storeActions}
                                currentDefinitionIndex={nodeDefinitionIndices.get(`${activeNodeToRender.prototypeId}-${activeGraphId}`) || 0}
                                onNavigateDefinition={(prototypeId, newIndex) => {
                                  const contextKey = `${prototypeId}-${activeGraphId}`;
                                  setNodeDefinitionIndices(prev => new Map(prev.set(contextKey, newIndex)));
                                }}

                              />
                            </>
                          );
                        })()
                      )}

                      {/* Render the Dragging Node last (on top) */}
                      {draggingNodeToRender && visibleNodeIds.has(draggingNodeToRender.id) && (
                        (() => {
                          const isPreviewing = previewingNodeId === draggingNodeToRender.id;
                          const baseDimensions = baseDimsById.get(draggingNodeToRender.id);
                          const descriptionContent = isPreviewing ? getNodeDescriptionContent(draggingNodeToRender, true) : null;
                          const dimensions = isPreviewing
                            ? getNodeDimensions(draggingNodeToRender, true, descriptionContent)
                            : baseDimensions || getNodeDimensions(draggingNodeToRender, false, null);

                          // Hide if its carousel is open
                          if (abstractionCarouselVisible && abstractionCarouselNode?.id === draggingNodeToRender.id) {
                            return null;
                          }

                          return (
                            <Node
                              key={draggingNodeToRender.id}
                              node={draggingNodeToRender}
                              currentWidth={dimensions.currentWidth}
                              currentHeight={dimensions.currentHeight}
                              textAreaHeight={dimensions.textAreaHeight}
                              imageWidth={dimensions.imageWidth}
                              imageHeight={dimensions.calculatedImageHeight}
                              innerNetworkWidth={dimensions.innerNetworkWidth}
                              innerNetworkHeight={dimensions.innerNetworkHeight}
                              descriptionAreaHeight={dimensions.descriptionAreaHeight}
                              isSelected={selectedInstanceIds.has(draggingNodeToRender.id)}
                              isDragging={true} // This is the dragging node
                              onMouseDown={(e) => handleNodeMouseDown(draggingNodeToRender, e)}
                              onPointerDown={(e) => handleNodePointerDown(draggingNodeToRender, e)}
                              onPointerMove={(e) => handleNodePointerMove(draggingNodeToRender, e)}
                              onPointerUp={(e) => handleNodePointerUp(draggingNodeToRender, e)}
                              onPointerCancel={(e) => handleNodePointerCancel(draggingNodeToRender, e)}
                              onTouchStart={(e) => handleNodeTouchStart(draggingNodeToRender, e)}
                              onTouchEnd={(e) => handleNodeTouchEnd(draggingNodeToRender, e)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                showContextMenu(e.clientX, e.clientY, getContextMenuOptions(draggingNodeToRender.id));
                              }}
                              isPreviewing={isPreviewing}
                              isEditingOnCanvas={draggingNodeToRender.id === editingNodeIdOnCanvas}
                              onCommitCanvasEdit={(instanceId, newName, isRealTime = false) => {
                                storeActions.updateNodePrototype(draggingNodeToRender.prototypeId, draft => { draft.name = newName; });
                                if (!isRealTime) setEditingNodeIdOnCanvas(null);
                              }}
                              onCancelCanvasEdit={() => setEditingNodeIdOnCanvas(null)}
                              onCreateDefinition={(prototypeId) => {
                                if (mouseMoved.current) return;
                                storeActions.createAndAssignGraphDefinition(prototypeId);
                              }}
                              onAddNodeToDefinition={(prototypeId) => {
                                // Create a new alternative definition for the node without activating/opening it
                                storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);
                              }}
                              onDeleteDefinition={(prototypeId, graphId) => {
                                // Delete the specific definition graph from the node
                                storeActions.removeDefinitionFromNode(prototypeId, graphId);
                              }}
                              onExpandDefinition={(instanceId, prototypeId, graphId) => {
                                if (graphId) {
                                  // Node has an existing definition to expand
                                  startHurtleAnimation(instanceId, graphId, prototypeId);
                                } else {
                                  // Node has no definitions - create one, then animate
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
                              }}
                              onConvertToNodeGroup={handleNodeConvertToNodeGroup}
                              storeActions={storeActions}
                              currentDefinitionIndex={nodeDefinitionIndices.get(`${draggingNodeToRender.prototypeId}-${activeGraphId}`) || 0}
                              onNavigateDefinition={(prototypeId, newIndex) => {
                                const contextKey = `${prototypeId}-${activeGraphId}`;
                                setNodeDefinitionIndices(prev => new Map(prev.set(contextKey, newIndex)));
                              }}

                            />
                          );
                        })()
                      )}
                    </>
                  );
                })()}

                {selectionRect && (
                  <rect
                    x={selectionRect.x}
                    y={selectionRect.y}
                    width={selectionRect.width}
                    height={selectionRect.height}
                    fill="rgba(255, 0, 0, 0.1)"
                    stroke="red"
                    strokeWidth={1}
                  />
                )}

                {plusSign && (
                  <PlusSign
                    plusSign={plusSign}
                    onClick={handlePlusSignClick}
                    onMorphDone={handleMorphDone}
                    onDisappearDone={() => setPlusSign(null)}
                    targetWidth={plusSign.tempName ? (() => {
                      // Create a mock node object to get exact dimensions
                      const mockNode = { name: plusSign.tempName };
                      const dims = getNodeDimensions(mockNode, false, null);
                      // Make the PlusSign slightly smaller so the final node feels like an expansion
                      return dims.currentWidth * 0.9;
                    })() : NODE_WIDTH}
                    targetHeight={plusSign.tempName ? (() => {
                      // Create a mock node object to get exact dimensions
                      const mockNode = { name: plusSign.tempName };
                      const dims = getNodeDimensions(mockNode, false, null);
                      // Make the PlusSign slightly smaller so the final node feels like an expansion
                      return dims.currentHeight * 0.9;
                    })() : NODE_HEIGHT}
                  />
                )}

                {/* Y-key video animation (session-only special effect) */}
                {videoAnimation && videoAnimation.active && (
                  <VideoNodeAnimation
                    x={videoAnimation.x}
                    y={videoAnimation.y}
                    onComplete={handleVideoAnimationComplete}
                  />
                )}
              </svg>
              <HoverVisionAid
                headerHeight={HEADER_HEIGHT}
                hoveredNode={hoveredNodeForVision}
                hoveredConnection={hoveredConnectionForVision}
                activePieMenuItem={activePieMenuItemForVision}
              />
            </>
          )}

          {/* Edge glow indicators for off-screen nodes */}
          <EdgeGlowIndicator
            nodes={hydratedNodes}
            baseDimensionsById={baseDimsById}
            panOffset={panOffset}
            zoomLevel={zoomLevel}
            leftPanelExpanded={leftPanelExpanded}
            rightPanelExpanded={rightPanelExpanded}
            previewingNodeId={previewingNodeId}
            containerRef={containerRef}
            canvasViewportSize={viewportSize}
            showViewportDebug={false}
            showDirectionLines={false}
          />

          {/* Back to Civilization component - shown when no nodes are visible */}
          <BackToCivilization
            isVisible={shouldShowBackToCivilization && backToCivilizationDelayComplete}
            onClick={handleBackToCivilizationClick}
            panOffset={panOffset}
            zoomLevel={zoomLevel}
            containerRef={containerRef}
            canvasSize={canvasSize}
            viewportSize={viewportSize}
            clusteringEnabled={enableClustering}
            clusterInfo={clusterAnalysis.statistics}
          />

          {/* Overlay panel resizers (outside panels) */}
          {renderPanelResizers()}

          {/* Header-triggered component search */}
          {headerSearchVisible && (
            <UnifiedSelector
              mode="node-typing"
              isVisible={true}
              leftPanelExpanded={leftPanelExpanded}
              rightPanelExpanded={rightPanelExpanded}
              onClose={() => setHeaderSearchVisible(false)}
              onNodeSelect={(prototype) => {
                try {
                  if (prototype?.id) {
                    // Open panel tab
                    if (typeof storeActions.openRightPanelNodeTab === 'function') {
                      storeActions.openRightPanelNodeTab(prototype.id, prototype.name);
                    }
                    // Navigate to instances in active graph if present
                    navigateToPrototypeInstances(prototype.id);
                  }
                } finally {
                  setHeaderSearchVisible(false);
                }
              }}
              title={`Search ${activeGraphName || 'Components'}`}
              subtitle={null}
              gridTitle="Browse Components in This Thing"
              searchOnly={true}
              allowedPrototypeIds={(() => {
                try {
                  const ids = new Set();
                  if (Array.isArray(nodes)) {
                    for (const n of nodes) { if (n?.prototypeId) ids.add(n.prototypeId); }
                  }
                  return ids;
                } catch { return null; }
              })()}
            />
          )}

          {/* Single UnifiedSelector instance with dynamic props */}
          {(() => {
            const anyVisible = nodeNamePrompt.visible || connectionNamePrompt.visible || abstractionPrompt.visible || nodeGroupPrompt.visible;
            if (!anyVisible) return null;
            if (nodeNamePrompt.visible) {
              return (
                <UnifiedSelector
                  mode="node-creation"
                  isVisible={true}
                  leftPanelExpanded={leftPanelExpanded}
                  rightPanelExpanded={rightPanelExpanded}
                  onClose={() => { setDialogColorPickerVisible(false); handleClosePrompt(); }}
                  onSubmit={({ name, color }) => {
                    if (name && plusSign) {
                      setPlusSign(ps => ps && { ...ps, mode: 'morph', tempName: name, selectedColor: color });
                    } else {
                      setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
                    }
                    setNodeNamePrompt({ visible: false, name: '', color: null });
                    setDialogColorPickerVisible(false);
                  }}
                  onNodeSelect={handleNodeSelection}
                  initialName={nodeNamePrompt.name}
                  initialColor={nodeNamePrompt.color}
                  title="Name Your Thing"
                  subtitle="Add a new Thing to this Web."
                  searchTerm={nodeNamePrompt.name}
                />
              );
            }
            if (connectionNamePrompt.visible) {
              return (
                <UnifiedSelector
                  mode="connection-creation"
                  isVisible={true}
                  leftPanelExpanded={leftPanelExpanded}
                  rightPanelExpanded={rightPanelExpanded}
                  onClose={() => { setDialogColorPickerVisible(false); setConnectionNamePrompt({ visible: false, name: '', color: null, edgeId: null }); }}
                  onSubmit={({ name, color }) => {
                    if (name.trim()) {
                      const newConnectionNodeId = uuidv4();
                      storeActions.addNodePrototype({ id: newConnectionNodeId, name: name.trim(), description: '', picture: null, color: color || NODE_DEFAULT_COLOR, typeNodeId: null, definitionGraphIds: [] });
                      if (connectionNamePrompt.edgeId) {
                        storeActions.updateEdge(connectionNamePrompt.edgeId, (draft) => { draft.definitionNodeIds = [newConnectionNodeId]; });
                      }
                      setConnectionNamePrompt({ visible: false, name: '', color: null, edgeId: null });
                      setDialogColorPickerVisible(false);
                    }
                  }}
                  onNodeSelect={(node) => {
                    if (connectionNamePrompt.edgeId) {
                      storeActions.updateEdge(connectionNamePrompt.edgeId, (draft) => { draft.definitionNodeIds = [node.id]; });
                    }
                    setConnectionNamePrompt({ visible: false, name: '', color: null, edgeId: null });
                    setDialogColorPickerVisible(false);
                  }}
                  initialName={connectionNamePrompt.name}
                  initialColor={connectionNamePrompt.color}
                  title="Name Your Connection"
                  subtitle="The Thing that will define your Connection,<br />in verb form if available."
                  searchTerm={connectionNamePrompt.name}
                />
              );
            }
            // Node-group prompt
            if (nodeGroupPrompt.visible) {
              return (
                <UnifiedSelector
                  mode="node-group-creation"
                  isVisible={true}
                  leftPanelExpanded={leftPanelExpanded}
                  rightPanelExpanded={rightPanelExpanded}
                  onClose={() => setNodeGroupPrompt({ visible: false, name: '', color: null, groupId: null })}
                  onSubmit={({ name, color }) => {
                    if (name.trim() && activeGraphId && nodeGroupPrompt.groupId) {
                      storeActions.convertGroupToNodeGroup(
                        activeGraphId,
                        nodeGroupPrompt.groupId,
                        null, // nodePrototypeId (not used when creating new)
                        true, // createNewPrototype
                        name.trim(),
                        color
                      );
                      setNodeGroupPrompt({ visible: false, name: '', color: null, groupId: null });
                      const currentState = useGraphStore.getState();
                      const graph = currentState.graphs?.get(activeGraphId);
                      const updatedGroup = graph?.groups?.get(nodeGroupPrompt.groupId);
                      if (updatedGroup) {
                        setSelectedGroup(updatedGroup);
                        setGroupControlPanelShouldShow(true);
                        setNodeControlPanelShouldShow(false);
                        setNodeControlPanelVisible(false);
                      }
                    }
                  }}
                  onNodeSelect={(prototype) => {
                    if (activeGraphId && nodeGroupPrompt.groupId) {
                      storeActions.convertGroupToNodeGroup(
                        activeGraphId,
                        nodeGroupPrompt.groupId,
                        prototype.id, // Link to existing prototype
                        false // Don't create new
                      );
                      setNodeGroupPrompt({ visible: false, name: '', color: null, groupId: null });
                      const currentState = useGraphStore.getState();
                      const graph = currentState.graphs?.get(activeGraphId);
                      const updatedGroup = graph?.groups?.get(nodeGroupPrompt.groupId);
                      if (updatedGroup) {
                        setSelectedGroup(updatedGroup);
                        setGroupControlPanelShouldShow(true);
                        setNodeControlPanelShouldShow(false);
                        setNodeControlPanelVisible(false);
                      }
                    }
                  }}
                  initialName={nodeGroupPrompt.name}
                  initialColor={nodeGroupPrompt.color}
                  title="Name Your Thing"
                  subtitle="Add a new Thing that will be defined by this Group."
                  searchTerm={nodeGroupPrompt.name}
                />
              );
            }
            // Abstraction prompt
            return (
              <UnifiedSelector
                mode="abstraction-node-creation"
                isVisible={true}
                leftPanelExpanded={leftPanelExpanded}
                rightPanelExpanded={rightPanelExpanded}
                onClose={() => {


                  setAbstractionPrompt({ visible: false, name: '', color: null, direction: 'above', nodeId: null, carouselLevel: null });
                  setCarouselPieMenuStage(1);
                  setIsCarouselStageTransition(true);
                  if (abstractionCarouselNode && !selectedNodeIdForPieMenu) {

                    setSelectedNodeIdForPieMenu(abstractionCarouselNode.id);
                  }
                }}
                onSubmit={handleAbstractionSubmit}
                onNodeSelect={(prototype) => {
                  if (!prototype) return;
                  handleAbstractionSubmit({
                    name: prototype.name || '',
                    color: prototype.color,
                    existingPrototypeId: prototype.id
                  });
                }}
                initialName={abstractionPrompt.name}
                initialColor={abstractionPrompt.color}
                title={`Add ${abstractionPrompt.direction === 'above' ? 'Above' : 'Below'}`}
                subtitle={`Create a ${abstractionPrompt.direction === 'above' ? 'more abstract' : 'more specific'} node in the abstraction chain`}
                abstractionDirection={abstractionPrompt.direction}
              />
            );
          })()}

          {/* Debug overlay disabled */}
        </div>

        {/* Dynamic Particle Transfer - starts under node, grows during acceleration, perfect z-layering */}
        {hurtleAnimation && (
          <div
            style={{
              position: 'fixed',
              left: (hurtleAnimation.currentPos?.x || hurtleAnimation.startPos.x) - ((hurtleAnimation.currentOrbSize || hurtleAnimation.orbSize) / 2),
              top: (hurtleAnimation.currentPos?.y || hurtleAnimation.startPos.y) - ((hurtleAnimation.currentOrbSize || hurtleAnimation.orbSize) / 2),
              width: hurtleAnimation.currentOrbSize || hurtleAnimation.orbSize,
              height: hurtleAnimation.currentOrbSize || hurtleAnimation.orbSize,
              backgroundColor: hurtleAnimation.nodeColor,
              borderRadius: '50%', // Perfect circle
              zIndex: hurtleAnimation.currentZIndex || 1000, // Dynamic z-index based on animation progress
              pointerEvents: 'none',
              transition: 'none',
              opacity: hurtleAnimation.progress > 0.9 ? (1 - (hurtleAnimation.progress - 0.9) * 10) : 1, // Fade out at the very end
            }}
          />
        )}

        <Panel
          key="right-panel"
          side="right"
          ref={panelRef}
          isExpanded={rightPanelExpanded}
          onToggleExpand={handleToggleRightPanel}
          onFocusChange={(isFocused) => {
            //
            setIsRightPanelInputFocused(isFocused);
          }}
          activeGraphId={activeGraphId}
          storeActions={storeActions}
          graphName={activeGraphName}
          graphDescription={activeGraphDescription}
          nodeDefinitionIndices={nodeDefinitionIndices}
          onStartHurtleAnimationFromPanel={startHurtleAnimationFromPanel}
          leftPanelExpanded={leftPanelExpanded}
          rightPanelExpanded={rightPanelExpanded}
        />
      </div>

      {/* TypeList Component */}
      <TypeList
        nodes={nodes}
        setSelectedNodes={setSelectedInstanceIds}
        selectedNodes={selectedInstanceIds}
      />

      {/* SaveStatusDisplay Component */}
      <SaveStatusDisplay />

      {/* NodeControlPanel Component - with animation */}
      {(nodeControlPanelShouldShow || nodeControlPanelVisible) && (
        <NodeControlPanel
          selectedNodePrototypes={nodePrototypesForPanel}
          isVisible={nodeControlPanelVisible}
          typeListOpen={typeListMode !== 'closed'}
          onAnimationComplete={handleNodeControlPanelAnimationComplete}
          onDelete={handleNodePanelDelete}
          onAdd={handleNodePanelAdd}
          onUp={handleNodePanelUp}
          onOpenInPanel={handleNodePanelOpenInPanel}
          onDecompose={handleNodePanelDecompose}
          onAbstraction={handleNodePanelAbstraction}
          onEdit={handleNodePanelEdit}
          onSave={handleNodePanelSave}
          onPalette={handleNodePanelPalette}
          onMore={handleNodePanelMore}
          onGroup={handleNodePanelGroup}
          hasLeftNav={false}
          hasRightNav={false}
          onActionHoverChange={handlePieMenuHoverChange}
        />
      )}

      {/* GroupControlPanel Component - with animation */}
      {(groupControlPanelShouldShow || groupControlPanelVisible) && (
        <UnifiedBottomControlPanel
          mode={groupPanelMode}
          isVisible={groupControlPanelVisible}
          typeListOpen={typeListMode !== 'closed'}
          onAnimationComplete={handleGroupControlPanelAnimationComplete}
          selectedGroup={groupPanelTarget}
          onUngroup={handleGroupPanelUngroup}
          onGroupEdit={handleGroupPanelEdit}
          onGroupColor={handleGroupPanelColor}
          onConvertToNodeGroup={handleGroupPanelConvertToNodeGroup}
          onDiveIntoDefinition={handleNodeGroupDiveIntoDefinition}
          onOpenNodePrototypeInPanel={handleNodeGroupOpenInPanel}
          onCombineNodeGroup={handleNodeGroupCombine}
          onActionHoverChange={handlePieMenuHoverChange}
        />
      )}

      {/* ConnectionControlPanel Component - with animation */}
      {(connectionControlPanelShouldShow || connectionControlPanelVisible) && (
        <ConnectionControlPanel
          selectedEdge={edgesMap.get(selectedEdgeId)}
          selectedEdges={Array.from(selectedEdgeIds).map(id => edgesMap.get(id)).filter(Boolean)}
          isVisible={connectionControlPanelVisible}
          typeListOpen={typeListMode !== 'closed'}
          onAnimationComplete={handleConnectionControlPanelAnimationComplete}
          onClose={() => {
            storeActions.setSelectedEdgeId(null);
            storeActions.setSelectedEdgeIds(new Set());
          }}
          onOpenConnectionDialog={(edgeId) => {
            setConnectionNamePrompt({ visible: true, name: '', color: CONNECTION_DEFAULT_COLOR, edgeId });
          }}
          onStartHurtleAnimationFromPanel={startHurtleAnimationFromPanel}
          onActionHoverChange={handlePieMenuHoverChange}
        />
      )}

      {/* AbstractionControlPanel Component - with animation */}
      {(abstractionControlPanelShouldShow || abstractionControlPanelVisible) && (
        <AbstractionControlPanel
          selectedNode={abstractionCarouselNode}
          currentDimension={currentAbstractionDimension}
          availableDimensions={abstractionDimensions}
          onDimensionChange={handleAbstractionDimensionChange}
          onAddDimension={handleAddAbstractionDimension}
          onDeleteDimension={handleDeleteAbstractionDimension}
          onExpandDimension={handleExpandAbstractionDimension}
          typeListOpen={typeListMode !== 'closed'}
          isVisible={abstractionControlPanelVisible}
          onAnimationComplete={handleAbstractionControlPanelAnimationComplete}
          onActionHoverChange={handlePieMenuHoverChange}
        />
      )}

      {/* AbstractionCarousel Component */}
      {abstractionCarouselVisible && abstractionCarouselNode && (
        <AbstractionCarousel
          isVisible={abstractionCarouselVisible}
          selectedNode={abstractionCarouselNode}
          panOffset={panOffset}
          zoomLevel={zoomLevel}
          containerRef={containerRef}
          canvasSize={canvasSize}
          debugMode={debugMode}
          animationState={carouselAnimationState}
          onAnimationStateChange={onCarouselAnimationStateChange}
          onClose={onCarouselClose}
          onReplaceNode={onCarouselReplaceNode}
          onScaleChange={setCarouselFocusedNodeScale}
          onFocusedNodeDimensions={setCarouselFocusedNodeDimensions}
          onFocusedNodeChange={setCarouselFocusedNode}
          onExitAnimationComplete={onCarouselExitAnimationComplete}
          relativeMoveRequest={carouselRelativeMoveRequest}
          onRelativeMoveHandled={() => setCarouselRelativeMoveRequest(null)}
          currentDimension={currentAbstractionDimension}
          availableDimensions={abstractionDimensions}
          onDimensionChange={handleAbstractionDimensionChange}
          onAddDimension={handleAddAbstractionDimension}
          onDeleteDimension={handleDeleteAbstractionDimension}
          onExpandDimension={handleExpandAbstractionDimension}
          onOpenInPanel={() => {
            // Open the abstraction control panel when user wants to open in panel
            setAbstractionControlPanelVisible(true);
          }}
        />
      )}

      {/* Dialog Color Picker Component */}
      {dialogColorPickerVisible && (
        <ColorPicker
          isVisible={dialogColorPickerVisible}
          onClose={handleDialogColorPickerClose}
          onColorChange={handleDialogColorChange}
          currentColor={
            colorPickerTarget?.type === 'group'
              ? (selectedGroup?.color || 'maroon')
              : (nodeNamePrompt.visible
                ? (nodeNamePrompt.color || NODE_DEFAULT_COLOR)
                : (connectionNamePrompt.color || NODE_DEFAULT_COLOR))
          }
          position={dialogColorPickerPosition}
          direction="down-left"
          parentContainerRef={dialogContainerRef}
        />
      )}

      {/* Pie Menu Color Picker Component */}
      {pieMenuColorPickerVisible && activePieMenuColorNodeId && (
        <ColorPicker
          isVisible={pieMenuColorPickerVisible}
          onClose={handlePieMenuColorPickerClose}
          onColorChange={handlePieMenuColorChange}
          currentColor={(() => {
            const node = nodes.find(n => n.id === activePieMenuColorNodeId);
            return node?.color || 'maroon';
          })()}
          position={pieMenuColorPickerPosition}
          direction="down-left"
        />
      )}





      {/* Onboarding Modal */}
      <AlphaOnboardingModal
        isVisible={showOnboardingModal}
        onClose={() => {
          // Mark onboarding as complete when user closes the modal
          try {
            if (typeof window !== 'undefined') {
              localStorage.setItem('redstring-alpha-welcome-seen', 'true');
            }
          } catch { }
          setShowOnboardingModal(false);
        }}
        onCreateLocal={async () => {
          try {
            // Mark onboarding as complete
            if (typeof window !== 'undefined') {
              localStorage.setItem('redstring-alpha-welcome-seen', 'true');
            }

            // Set storage mode to local
            console.log('[NodeCanvas] Setting storage mode to local for file-based storage');
            storeActions.setStorageMode('local');

            // Import file storage functions
            const { createUniverseFile, enableAutoSave } = fileStorage;

            // Create universe file with file picker
            const initialData = await createUniverseFile();

            if (initialData !== null) {
              // Successfully created universe file, load the empty state
              storeActions.loadUniverseFromFile(initialData);

              // Enable auto-save
              enableAutoSave(() => useGraphStore.getState());

              // Ensure universe connection is marked as established
              storeActions.setUniverseConnected(true);
            } else {
              // User cancelled the file creation dialog
              storeActions.setUniverseError('File creation was cancelled. Please try again to set up your universe.');
            }
          } catch (error) {
            storeActions.setUniverseError(`Failed to create universe: ${error.message}. Please try again.`);
          }
        }}
        onOpenLocal={async () => {
          try {
            // Mark onboarding as complete
            if (typeof window !== 'undefined') {
              localStorage.setItem('redstring-alpha-welcome-seen', 'true');
            }

            // Set storage mode to local
            console.log('[NodeCanvas] Setting storage mode to local for file-based storage');
            storeActions.setStorageMode('local');

            // Import file storage functions
            const { openUniverseFile, enableAutoSave } = fileStorage;

            // Open universe file with file picker
            const loadedData = await openUniverseFile();

            if (loadedData !== null) {
              // Successfully loaded universe file
              storeActions.loadUniverseFromFile(loadedData);

              // Enable auto-save
              enableAutoSave(() => useGraphStore.getState());

              // Ensure universe connection is marked as established
              storeActions.setUniverseConnected(true);
            }
          } catch (error) {
            storeActions.setUniverseError(`Failed to open file: ${error.message}`);
          }
        }}
        onConnectGitHub={async (step) => {
          // Handle different GitHub setup steps
          console.log('[NodeCanvas] GitHub setup step:', step);

          // Mark onboarding as complete when GitHub setup is initiated
          if (typeof window !== 'undefined') {
            localStorage.setItem('redstring-alpha-welcome-seen', 'true');
          }

          // Set storage mode to git when GitHub is selected
          console.log('[NodeCanvas] Setting storage mode to git for GitHub sync');
          storeActions.setStorageMode('git');
          storeActions.updateGitSettings({
            autoSync: true,
            syncOnSave: true
          });

          // Expand left panel and open Git Federation view
          setLeftPanelExpanded(true);
          setLeftPanelInitialView('federation');

          if (step === 'oauth') {
            console.log('[NodeCanvas] Starting OAuth flow...');
            // Trigger OAuth flow directly
            try {
              const { oauthFetch } = await import('./services/bridgeConfig.js');

              // Clear previous OAuth state
              sessionStorage.removeItem('github_oauth_pending');
              sessionStorage.removeItem('github_oauth_state');
              sessionStorage.removeItem('github_oauth_result');

              // Get OAuth client ID
              const resp = await oauthFetch('/api/github/oauth/client-id');
              if (!resp.ok) throw new Error('Failed to load OAuth configuration');
              const { clientId } = await resp.json();
              if (!clientId) throw new Error('GitHub OAuth client ID not configured');

              // Generate state and redirect
              const stateValue = Math.random().toString(36).slice(2);
              const redirectUri = `${window.location.origin}/oauth/callback`;
              const scopes = 'repo';

              sessionStorage.setItem('github_oauth_state', stateValue);
              sessionStorage.setItem('github_oauth_pending', 'true');
              // Mark that we should resume onboarding state after redirect
              sessionStorage.setItem('redstring_onboarding_resume', 'true');
              sessionStorage.setItem('redstring_onboarding_step', 'oauth');
              sessionStorage.setItem('redstring_first_link_prompt', 'true');

              const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(stateValue)}`;

              // Close modal before redirect
              setShowOnboardingModal(false);

              // Redirect to GitHub
              window.location.href = authUrl;
            } catch (err) {
              console.error('[NodeCanvas] OAuth launch failed:', err);
            }
          } else if (step === 'app') {
            console.log('[NodeCanvas] Starting GitHub App installation...');
            // Trigger GitHub App installation
            try {
              const { oauthFetch } = await import('./services/bridgeConfig.js');

              let appName = 'redstring-semantic-sync';
              try {
                const resp = await oauthFetch('/api/github/app/info');
                if (resp.ok) {
                  const data = await resp.json();
                  appName = data.name || appName;
                }
              } catch {
                // Use default app name
              }

              sessionStorage.setItem('github_app_pending', 'true');
              const stateValue = Date.now().toString();
              const url = `https://github.com/apps/${appName}/installations/new?state=${stateValue}`;
              // Mark that we should resume onboarding state after redirect
              sessionStorage.setItem('redstring_onboarding_resume', 'true');
              sessionStorage.setItem('redstring_onboarding_step', 'app');
              sessionStorage.setItem('redstring_first_link_prompt', 'true');

              // Close modal before redirect
              setShowOnboardingModal(false);

              // Redirect to GitHub App installation
              window.location.href = url;
            } catch (err) {
              console.error('[NodeCanvas] GitHub App launch failed:', err);
            }
          } else if (step === 'complete') {
            console.log('[NodeCanvas] Complete setup - opening Git Federation panel');
            // Close modal and let user complete setup in Git Federation panel
            setShowOnboardingModal(false);
            try { sessionStorage.setItem('redstring_first_link_prompt', 'true'); } catch { }
          } else if (step === 'use-existing') {
            console.log('[NodeCanvas] Using existing GitHub connections for Git-based universe');

            try {
              // Import universe backend to try loading Git universe
              const { default: universeBackend } = await import('./services/universeBackend.js');

              // Try to load from the active universe
              const activeUniverse = universeBackend.getActiveUniverse();
              if (activeUniverse && activeUniverse.gitRepo && activeUniverse.gitRepo.enabled) {
                console.log('[NodeCanvas] Found existing Git universe, attempting to load:', activeUniverse.slug);
                const storeState = await universeBackend.loadUniverseData(activeUniverse);
                if (storeState) {
                  storeActions.loadUniverseFromFile(storeState);
                  console.log('[NodeCanvas] ✅ Successfully restored Git-based universe from:', activeUniverse.slug);
                } else {
                  console.log('[NodeCanvas] Git universe exists but no data found, using empty state');
                  storeActions.setUniverseLoaded(true, true);
                }
              } else {
                console.log('[NodeCanvas] No Git universe configured, creating empty state for Git-based storage');
                storeActions.setUniverseLoaded(true, true);
              }
            } catch (error) {
              console.warn('[NodeCanvas] Failed to restore Git universe, falling back to empty state:', error);
              // Still mark as loaded to prevent modal reopening
              storeActions.setUniverseLoaded(true, true);
            }

            // Close onboarding modal and open Git Federation panel
            setShowOnboardingModal(false);
            try { sessionStorage.setItem('redstring_first_link_prompt', 'true'); } catch { }

            console.log('[NodeCanvas] ✅ Git-based storage mode activated, opening Git Federation panel');
          }
        }}
      />

      {/* Add to Group Dialog */}
      {addToGroupDialog && (
        <CanvasConfirmDialog
          isOpen={true}
          onClose={() => setAddToGroupDialog(null)}
          onConfirm={() => {
            // Add all dragged nodes to the group
            if (activeGraphId && addToGroupDialog.groupId && addToGroupDialog.nodeIds) {
              storeActions.updateGroup(
                activeGraphId,
                addToGroupDialog.groupId,
                (draft) => {
                  // Add each node to the group if not already a member
                  addToGroupDialog.nodeIds.forEach(nodeId => {
                    if (!draft.memberInstanceIds.includes(nodeId)) {
                      draft.memberInstanceIds.push(nodeId);
                    }
                  });
                }
              );
              console.log(`Added ${addToGroupDialog.nodeIds.length} node(s) to ${addToGroupDialog.isNodeGroup ? 'Thing' : 'group'} "${addToGroupDialog.groupName}"`);
            }
            setAddToGroupDialog(null);
          }}
          title={`Add to ${addToGroupDialog.isNodeGroup ? 'Thing' : 'Group'}?`}
          message={`Add ${addToGroupDialog.nodeIds.length > 1 ? `${addToGroupDialog.nodeIds.length} nodes` : 'this node'} to ${addToGroupDialog.isNodeGroup ? 'the Thing' : 'the group'} "${addToGroupDialog.groupName}"?`}
          confirmLabel="Add"
          cancelLabel="Cancel"
          variant="default"
          position={addToGroupDialog.position}
          containerRect={containerRef.current?.getBoundingClientRect()}
          panOffset={panOffset}
          zoomLevel={zoomLevel}
        />
      )}

      {/* Auto Graph Generation Modal */}
      <AutoGraphModal
        isOpen={autoGraphModalVisible}
        onClose={() => setAutoGraphModalVisible(false)}
        onGenerate={(inputData, inputFormat, options) => {
          try {
            const parsedData = parseInputData(inputData, inputFormat);
            const targetGraphId = options.createNewGraph ? null : activeGraphId;

            // Get fresh state - will be updated after graph creation if needed
            let storeState = useGraphStore.getState();
            const mergedLayoutOptions = {
              ...options.layoutOptions,
              layoutScale: layoutScalePreset,
              layoutScaleMultiplier,
              iterationPreset: layoutIterationPreset
            };
            const patchedOptions = {
              ...options,
              layoutOptions: mergedLayoutOptions
            };

            const results = generateGraph(
              parsedData,
              targetGraphId,
              storeState,
              storeActions,
              patchedOptions,
              () => useGraphStore.getState() // Function to get fresh state
            );

            // Close modal
            setAutoGraphModalVisible(false);

            // Show results notification
            const message = `Generated ${results.instancesCreated.length} nodes and ${results.edgesCreated.length} edges.\n` +
              `Prototypes: ${results.prototypesCreated.length} new, ${results.prototypesReused.length} reused.` +
              (results.errors.length > 0 ? `\n\nWarnings: ${results.errors.length}` : '');

            alert(message);

            console.log('[AutoGraph] Generation results:', results);
          } catch (error) {
            console.error('[AutoGraph] Generation failed:', error);
            alert(`Failed to generate graph: ${error.message}`);
          }
        }}
        activeGraphId={activeGraphId}
      />

      {/* Force Simulation Modal */}
      <ForceSimulationModal
        isOpen={forceSimModalVisible}
        onClose={() => setForceSimModalVisible(false)}
        graphId={activeGraphId}
        storeActions={storeActions}
        layoutScalePreset={forceLayoutScalePreset}
        layoutScaleMultiplier={forceLayoutScaleMultiplier}
        onLayoutScalePresetChange={storeActions.setForceTunerScalePreset}
        onLayoutScaleMultiplierChange={storeActions.setForceTunerScaleMultiplier}
        layoutIterationPreset={forceLayoutIterationPreset}
        onLayoutIterationPresetChange={storeActions.setForceTunerIterationPreset}
        onCopyToAutoLayout={storeActions.copyForceTunerSettingsToAutoLayout}
        getNodes={() => hydratedNodes.map(n => {
          const dims = baseDimsById.get(n.id) || getNodeDimensions(n, false, null);
          return {
            id: n.id,
            x: n.x,
            y: n.y,
            name: n.name,
            width: dims?.currentWidth,
            height: dims?.currentHeight,
            imageHeight: dims?.calculatedImageHeight ?? 0
          };
        })}
        getEdges={() => edges.map(e => ({ sourceId: e.sourceId, destinationId: e.destinationId }))}
        getDraggedNodeIds={() => {
          if (!draggingNodeInfo) return new Set();
          // Single node drag
          if (draggingNodeInfo.instanceId) return new Set([draggingNodeInfo.instanceId]);
          // Multi-select drag (primaryId + all selected)
          if (draggingNodeInfo.primaryId) return new Set([draggingNodeInfo.primaryId, ...Object.keys(draggingNodeInfo.relativeOffsets || {})]);
          // Group drag
          if (draggingNodeInfo.groupId && draggingNodeInfo.memberOffsets) {
            return new Set(draggingNodeInfo.memberOffsets.map(m => m.id));
          }
          return new Set();
        }}
        onNodePositionsUpdated={resetConnectionLabelCache}
      />

      {/* Help Modal */}
      <HelpModal
        isVisible={showHelpModal}
        onClose={() => setShowHelpModal(false)}
      />

      {/* <div>NodeCanvas Simplified - Testing Loop</div> */}
    </div>
  );
}

export default NodeCanvas;

