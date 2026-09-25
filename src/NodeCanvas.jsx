import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, useContext } from 'react';
import { createPortal } from 'react-dom';
import './NodeCanvas.css';
import { useCanvasTouch } from './hooks/useCanvasTouch';
import { useCanvasWorker } from './useCanvasWorker.js';
import PlusSign from './PlusSign.jsx'; // Import the new PlusSign component
import VideoNodeAnimation from './VideoNodeAnimation.jsx'; // Import the video animation component
import PieMenu from './PieMenu.jsx'; // Import the PieMenu component
import EdgeGlowIndicator from './components/EdgeGlowIndicator.jsx'; // Import the EdgeGlowIndicator component
import BackToCivilization from './BackToCivilization.jsx'; // Import the BackToCivilization component
import DownloadAppPill from './DownloadAppPill.jsx';
import HoverVisionAidLayer from './components/canvas/layers/HoverVisionAidLayer.jsx';
import { setActionHover } from './utils/canvas/actionHover.js';
import GamepadCrosshair from './components/GamepadCrosshair.jsx'; // Controller-mode reticle
import { getNodeDimensions } from './utils.js';
import { measureTextWidth as pretextMeasureTextWidth } from './services/textMeasurement.js';
import { onSpritesReady, hydrateLabelSprites, spriteScaleForZoom, setBakingPaused } from './services/labelSpriteCache.js';
import { DEFAULT_CONNECTION_LABEL_RING_WIDTH, DEFAULT_CONNECTION_LABEL_COLOR_MODE, DEFAULT_CONNECTION_LABEL_OUTER_RING, DEFAULT_CONNECTION_LABEL_MOVE_FADE, DEFAULT_CONNECTION_LABEL_TRUNCATE, DEFAULT_CONNECTION_LABEL_SPRITES, CONNECTION_LABEL_MOVE_FADE_MIN_COUNT } from './utils/colorUtils.js';
import { copySelection, pasteClipboard } from './utils/clipboard.js';
import { CAROUSEL_SLOT_FRACTION } from './utils/pieMenuLayout.js';
import { analyzeNodeDistribution } from './utils/clusterAnalysis.js';
import { v4 as uuidv4 } from 'uuid'; // Import UUID generator
import { Plus } from 'lucide-react'; // Icons for PieMenu
import { useDrop } from 'react-dnd';
import { showContextMenu, showContextMenuCentered, hideContextMenu } from './components/GlobalContextMenu';
import UniverseScreens from './components/canvas/UniverseScreens.jsx';
import { haptic, createDetentTrack } from './services/haptics.js';
import { resolveEdgeLabelFontSize } from './services/layoutGeometry.js';
import { applyOffscreenLayout } from './services/offscreenLayout.js';
import { attachOneShotOutcome } from './services/oneShot.js';
import {
  buildChildGroupIdsIndex,
  buildParentGroupIdsIndex,
  buildGroupsByMemberIdIndex,
  computeGroupDepths,
  buildEdgeZSlotIndex,
} from './services/groupLayout.js';
import { getNodeHitbox } from './utils/canvas/nodeHitbox.js';
import { clearLabelStabilization } from './utils/canvas/labelStabilization.js';
import debugConfig from './utils/debugConfig.js';
import apiKeyManager from './services/apiKeyManager.js';

// Import Zustand store and selectors/actions
import useGraphStore from "./store/graphStore.js";
import useCanvasUIStore, { setPieCommandHandler } from './store/canvasUIStore.js';
import { useCanvasCommands } from './utils/canvas/canvasCommands.js';
import { useHoverIntent } from './hooks/useHoverIntent.js';
import { useTrackedState } from './hooks/useTrackedState.js';
import NodePieMenuLayer from './components/canvas/layers/NodePieMenuLayer.jsx';
import { GridLayer, ClusterHullsLayer } from './components/canvas/layers/GridLayer.jsx';
import { computeGroupLayouts } from './components/canvas/groups/groupLayouts.js';
import { buildGroupElements } from './components/canvas/groups/groupElements.jsx';
import { createGroupInputHandlers } from './components/canvas/groups/groupInput.js';
import { computeCanvasNodes, computeBaseDims } from './components/canvas/data/canvasNodes.js';
import { storeFieldRef } from './utils/storeFieldRef.js';
import { createCameraController } from './components/canvas/camera/cameraController.js';
import { createPointerHandlers } from './components/canvas/input/pointerHandlers.js';
import { runCullingPass, ENABLE_CULLING } from './components/canvas/data/culling.js';
import { LABEL_ANGLE_QUANTUM, LABEL_ANGLE_QUANTUM_MIN_COUNT, LABEL_ANGLE_QUANTUM_ALWAYS_STYLES, CURVED_LABEL_BUDGET, EMPTY_OBSTACLES, LABEL_CROSSING_BUDGET } from './components/canvas/edges/labelBudgets.js';
import { EMPTY_ORBIT, ORBIT_SCRIM_COLOR, ORBIT_SCRIM_BLUR_PX, ORBIT_FIT_PADDING, ORBIT_FIT_MIN_ZOOM } from './components/canvas/orbit/orbitConstants.js';
import { handleCanvasDrop } from './components/canvas/actions/canvasDrop.js';
import { frameInstancesOfPrototype } from './components/canvas/camera/navigateToInstances.js';
import { dispatchWizardIntent } from './components/canvas/actions/wizardIntent.js';
import { diveIntoNodeGroupDefinition } from './components/canvas/actions/nodeGroupDive.js';
import { choosePlusSignNode } from './components/canvas/actions/plusSignSelection.js';
import { buildNodePieMenuPages, buildTargetPieMenuButtons, buildDecomposePanelInfo } from './components/canvas/pie/nodePieButtons.js';
import { buildEdgePieMenuButtons } from './components/canvas/pie/edgePieButtons.js';
import { buildCanvasContextMenuOptions, buildNodeContextMenuOptions } from './components/canvas/menus/contextMenus.jsx';
import { placeOrbitCandidate } from './components/canvas/orbit/orbitActions.js';
import { startHurtle } from './components/canvas/camera/hurtle.js';
import { backToCivilization } from './components/canvas/camera/backToCivilization.js';
import { convertNodeToNodeGroup } from './components/canvas/actions/nodeGroupConversion.js';
import { computeCleanLaneOffsets } from './utils/canvas/cleanLaneOffsets.js';
import { submitAbstraction } from './components/canvas/actions/abstractionSubmit.js';
import { useLatestRef } from './hooks/useLatestRef.js';
import { usePickedEntries } from './hooks/useStableSelector.js';
import { createLiveMapView } from './utils/liveMapView.js';
import { clampPan, clientToCanvas } from './utils/canvas/viewportMath.js';
import { findNearestEdgeAtCanvasPoint as findNearestEdge, edgeHitThreshold } from './utils/canvas/edgeHitTest.js';
import { selectionInRect, groupTitleAtCanvasPoint, groupDragOffsets } from './utils/canvas/canvasHitTest.js';
import DeletionGhostLayer from './components/canvas/layers/DeletionGhostLayer.jsx';
import PanelResizers from './components/canvas/PanelResizers.jsx';
import { CanvasOverlaySlot } from './components/canvas/hosts/canvasOverlaySlot.js';
import {
  buildWizardConnectionPrompt,
  buildWizardNodeDefinitionPrompt,
  buildWizardAbstractionPrompt,
  buildWizardGrowGraphPrompt,
  sendWizardAsk,
  resolveIncludeInstructions
} from './wizard/prompts/index.js';
import {
  SURFACES as WIZARD_SURFACES,
  shouldSkipPicker,
  defaultIntentForSurface,
} from './wizard/prompts/intents.js';
import {
} from './wizard/prompts/intentPrompts.js';
import { thingFacts, ladderFacts } from './wizard/prompts/facts.js';
import useImageCache, { queueThumbnailFetch, cancelThumbnailFetch } from './services/imageCache.js';

import { getAppViewportSize } from './utils/appViewport.js';
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  HEADER_HEIGHT,
  MAX_ZOOM,
  PLUS_SIGN_SIZE,
  NODE_CORNER_RADIUS,
  NODE_DEFAULT_COLOR,
  CONNECTION_WIDTH_BASE_SCALE,
  EXCLUSIVE_PANEL_MODE_THRESHOLD,
} from './constants';

import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useViewportBounds } from './hooks/useViewportBounds';
import { useControlPanelActions } from './hooks/useControlPanelActions';
import { useGraphLayout } from './hooks/useGraphLayout';
import { useCanvasKeyboard } from './hooks/useCanvasKeyboard';
import { useGamepad } from './hooks/useGamepad';
import { useCanvasTransform } from './hooks/useCanvasTransform';
import { useNodeDrag } from './hooks/useNodeDrag';
import { useTheme } from './hooks/useTheme.js';
import { useMobileLandscapeShell, setControllerPresent } from './hooks/useMobileLandscapeShell.js';
import { computeLombardiTangents, connectionCurveMinBow, labelCurveMinBow, curvedGlyphQuantum, ORTHOGONAL_LANE_FRACTION, LOMBARDI_LANE_FRACTION } from './utils/canvas/edgeRouting.js';
import * as GeometryUtils from './utils/canvas/geometryUtils.js';
import { calculateSelfLoopPath, countSelfLoopsForNode } from './utils/canvas/selfLoopUtils.js';
import EdgeLayer from './components/canvas/layers/EdgeLayer.jsx';
import NodeLayer from './components/canvas/layers/NodeLayer.jsx';
import ControlPanelsHost from './components/canvas/hosts/ControlPanelsHost.jsx';
import HurtleOrb from './components/canvas/layers/HurtleOrb.jsx';
import { nearestConnectionOrb, ORB_HIT_PADDING_TOUCH } from './utils/canvas/connectionOrbs.js';
import { quantizeAngle } from './utils/canvas/edgeLabelPlacement.js';
import { likelyTouch } from './utils/inputDeviceAnalysis';
import OrbitOverlay from './components/OrbitOverlay.jsx';
import { listenForNavigateTo, listenForSelectNode } from './components/canvas/actions/wizardCanvasEvents.js';
import { listenForShellShortcuts } from './components/canvas/actions/shellShortcuts.js';
import { focusEdgePieMenuInViewWith, focusNodeInViewWith, getFramingRegionWith, getBottomPanelReserveWith, FOCUS_ON_SELECT_ENABLED, frameDecomposedNode, frameEdgePieOnOpen } from './components/canvas/camera/framing.js';
import { computeSelectedEdgeMidpoint, computeLabelCrossingIndex, computeEdgeCurveInfo, computeLabelObstacleOptions } from './components/canvas/edges/edgeGeometry.js';
import { preventPageZoom } from './components/canvas/actions/pageZoomGuard.js';
import { restoreUniverseOnMount } from './components/canvas/actions/universeRestore.js';
import { restoreViewForGraph, saveViewWhenSettled } from './components/canvas/camera/viewPersistence.js';
import { runConnectionEdgePan, writeDrawingConnectionEnd } from './components/canvas/input/connectionDraw.js';
import { suggestConnectionName, fillAbstractionNameSuggestion, suggestEdgeArrowDirectionWith } from './components/canvas/actions/oneShotSuggestions.js';
import { fetchOrbitCandidates, hoverOrbitCandidate, sizeOrbitDimRect } from './components/canvas/orbit/orbitData.js';
import { computeShouldShowBackToCivilization, computeRelevantNodesVisible } from './components/canvas/data/backToCivilization.js';
import { flushAnchorPositions } from './components/canvas/groups/anchorFlush.js';
import { resolveStoreActions } from './components/canvas/data/storeActions.js';
import PromptsHost from './components/canvas/hosts/PromptsHost.jsx';
import CanvasOverlaysHost from './components/canvas/hosts/CanvasOverlaysHost.jsx';

const SPAWNABLE_NODE = 'spawnable_node';


// How long to keep connection labels down after a node drag ends, covering the
// drag-zoom restore animation. useNodeDrag's DRAG_ZOOM_ANIMATION_DURATION is
// 250ms; the margin absorbs the frame the animation finishes on. Releasing at
// the drop instead would fade the labels back in over a running zoom, which is
// the one moment with no budget for it.
const DRAG_ZOOM_RESTORE_HOLD_MS = 300;




// A multi-node delete fires its ghosts in shuffled order, one step apart, rather
// than all at once. Shuffling keeps it from reading as a mechanical sweep in
// whatever order the selection happened to be stored, and a fixed step reads as a
// deliberate cascade where a purely random offset just reads as jitter. The total
// spread is capped so a large selection tightens its step instead of trailing on
// long after the nodes are gone.
// The step is a sizeable fraction of the 280ms shrink on purpose: the ghost eases
// in, so it barely moves for the first stretch of its own animation, and a step
// much shorter than this lands entirely inside that motionless window — the
// offset is real but there is nothing on screen yet to read it against.
const DELETE_GHOST_STAGGER_STEP_MS = 50;
const DELETE_GHOST_STAGGER_MAX_MS = 150;

// EXCLUSIVE_PANEL_MODE_THRESHOLD is imported from ./constants (shared with Panel.jsx + Header.jsx)
// Ask the left panel to show a view. A store request with a nonce (P2.05), so
// asking again for the view it already showed still switches back to it.
const openLeftPanelView = (view) => useCanvasUIStore.getState().openLeftPanelView(view);

// Screen-pixel spacing between haptic detents along a connection line being
// drawn. At a typical drag speed (~500px/s) this yields ~11 ticks/sec — a
// texture rather than a rattle, and well under the ~25/sec ceiling the shared
// rate limit imposes. Larger = sparser clicks; smaller = denser.
const CONNECTION_DETENT_PX = 44;



/**
 * The canvas orchestrator: owns the graph-wide derived data (nodes, edges,
 * dimensions, group layouts), the input and camera controllers, and the
 * remaining pie/overlay wiring, and renders the canvas layers and hosts.
 * Mounted once by CanvasShell; takes no props. See
 * documentation/dev-ops/nodecanvas-refactor/ for where each part lives now.
 */

// Fallbacks for settings selectors, at module scope so their identity is fixed
// for the life of the process.
//
// These were object literals written inline in the selector
// (`state.touchSettings || { ... }`). A literal there is allocated afresh on
// EVERY store notification, so whenever the backing field is missing the
// selector returns a new object each time, Zustand's Object.is check never
// matches, and NodeCanvas re-renders on every action taken anywhere in the
// store. The store does define all of these today, so nothing is currently
// hitting the fallback path — this is to keep it that way if one ever goes
// undefined.

const DEFAULT_DRAG_ZOOM_SETTINGS = { enabled: true, zoomAmount: 0.45 };
const DEFAULT_KEYBOARD_SETTINGS = { zoomSensitivity: 0.5 };
const DEFAULT_TOUCH_SETTINGS = { zoomSensitivity: 0.7, panSensitivity: 0.5 };
const DEFAULT_FORCE_TUNER_SETTINGS = { layoutScale: 'balanced', layoutScaleMultiplier: 1, layoutIterations: 'balanced' };

// Resolves true once `src` is decoded and ready to paint without a stall, false on
// error or if it takes longer than `timeoutMs` (the caller proceeds either way).
const decodeThumbnail = (src, timeoutMs = 600) => {
  const img = new Image();
  img.src = src;
  const decoded = (img.decode
    ? img.decode()
    : new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; })
  ).then(() => true, () => false);
  return Promise.race([decoded, new Promise(resolve => setTimeout(() => resolve(false), timeoutMs))]);
};

// Resolves with a prototype's imageCache entry once its fetch lands, or null if the
// fetch fails or `timeoutMs` passes first.
const waitForCachedImage = (protoId, timeoutMs) => new Promise((resolve) => {
  const existing = useImageCache.getState().images[protoId];
  if (existing) { resolve(existing); return; }
  let timer = null;
  const unsubscribe = useImageCache.subscribe((state) => {
    const entry = state.images[protoId];
    if (!entry && !state.failed[protoId]) return;
    clearTimeout(timer);
    unsubscribe();
    resolve(entry || null);
  });
  timer = setTimeout(() => { unsubscribe(); resolve(null); }, timeoutMs);
});

function NodeCanvas() {
  // ORBIT DIM — the scrim behind the orbit overlay. Set false to drop it
  // entirely (the rect stays, transparent and static at full canvas size, so
  // orbit's click-anywhere-to-exit keeps working at no paint cost).
  //
  // This was the cause of the orbit-mode tile-memory flicker, but the culprit
  // was its SIZE, not its existence: it used to span 3x the viewport per side,
  // i.e. ~9 viewport areas of 70% black painting above the whole graph. A
  // translucent rect makes every tile it covers non-opaque, forcing the
  // compositor to blend everything beneath rather than discard what is hidden.
  // At viewport size plus a small margin the same effect costs a fraction of
  // that. See updateOrbitDimRect.
  // OFF: shrinking it to viewport-size was not enough. A translucent element
  // INSIDE the content group makes the SVG's own tiles non-opaque at any size,
  // so the whole graph beneath has to be blended rather than discarded. The
  // scrim has to leave the SVG raster entirely to be affordable — see the note
  // on updateOrbitDimRect.
  const ENABLE_ORBIT_DIM = false;
  // Extra coverage on each side as a fraction of the viewport. Only has to
  // survive between transform ticks, and the rect is repositioned on every one.
  const ORBIT_DIM_MARGIN = 0.1;

  // Get theme colors
  const theme = useTheme();

  const svgRef = useRef(null);
  // Per-frame pan/zoom transform is written to this <g> element via SVG's
  // transform attribute (NOT to the outer <svg>'s style.transform). Keeps the
  // outer <svg> off the GPU compositor path so a 100k SVG can't trigger
  // tile-raster-on-scale flicker.
  const contentGroupRef = useRef(null);
  // Content group of the orbit layer — a second <svg> above the scrim, carrying
  // the same pan/zoom transform as the main one. Held in state as well as a ref
  // because the focus node and orbit overlay are portalled into it, and a portal
  // target has to exist before React can render into it.
  const overlayGroupRef = useRef(null);
  const [overlayGroupEl, setOverlayGroupEl] = useState(null);
  const setOverlayGroup = useCallback((el) => {
    overlayGroupRef.current = el;
    setOverlayGroupEl(el);
  }, []);
  const containerRef = useRef(null);
  const suppressNextMouseDownRef = useRef(false);
  const suppressMouseDownResetTimeoutRef = useRef(null);
  /* Ref for label placement to avoid overlap */
  const placedLabelsRef = useRef(new Map());
  // edgeId → true when the label the renderer last drew for that connection was
  // cut short of its real name. Written by the edge renderers at the point they
  // settle on the drawn string, read by the hover hit-test below.
  //
  // A ref rather than state on purpose: this is a report of what the last paint
  // did, consumed only on hover, so it must never itself cause a render. Stale
  // entries for edges that have gone away are harmless — nothing can hover one.
  const labelTruncationRef = useRef(new Map());
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, centerClient: { x: 0, y: 0 }, centerWorld: null, lastCenterClient: { x: 0, y: 0 }, lastDist: 0 });
  // Only `lastFrameTime` is live: useCanvasTouch reads it for the pinch easing's
  // frame delta. (The lerp-follow loop that once animated from this ref was never
  // called and has been removed; useNodeDrag still clears its old fields, which
  // are now always unset.)
  const pinchSmoothingRef = useRef({ lastFrameTime: 0 });
  // Cross-platform multi-touch suppression. True from gesture start until ~350ms
  // after the last finger lifts — bridges the gap where pinchRef.active flips
  // false synchronously before the browser dispatches synthetic click/pointerup
  // to whatever element the lifting finger was over (e.g. PlusSign on Android Chrome).
  const gestureBlockRef = useRef(false);
  const gestureBlockClearTimerRef = useRef(null);
  const armGestureBlock = useCallback(() => {
    gestureBlockRef.current = true;
    if (gestureBlockClearTimerRef.current) {
      clearTimeout(gestureBlockClearTimerRef.current);
      gestureBlockClearTimerRef.current = null;
    }
  }, []);
  const scheduleGestureBlockClear = useCallback((delay = 350) => {
    if (gestureBlockClearTimerRef.current) {
      clearTimeout(gestureBlockClearTimerRef.current);
    }
    gestureBlockClearTimerRef.current = setTimeout(() => {
      gestureBlockRef.current = false;
      gestureBlockClearTimerRef.current = null;
    }, delay);
  }, []);
  const [orbitData, setOrbitDataState] = useState(EMPTY_ORBIT);
  const [orbitLoading, setOrbitLoadingState] = useState(false);
  // What each was last set to, pending updates included, so the search
  // effect's reset can skip a same-value set (render sweep).
  const orbitSetRef = useRef({ data: EMPTY_ORBIT, loading: false });
  const setOrbitData = useCallback((v) => { orbitSetRef.current.data = v; setOrbitDataState(v); }, []);
  const setOrbitLoading = useCallback((v) => { orbitSetRef.current.loading = v; setOrbitLoadingState(v); }, []);
  const semanticOrbitActive = useCanvasUIStore(s => s.semanticOrbitActive), setSemanticOrbitActive = useCanvasUIStore(s => s.setSemanticOrbitActive);
  const semanticOrbitActiveRef = useRef(false);
  // The orbit's imperative surface, written by OrbitOverlay while it is mounted
  // and read by the controller every frame — aiming, activating, exiting. See
  // orbitControl there. Declared up here with the rest of the orbit state
  // because useGamepad is called long before the JSX that hands this to the
  // overlay.
  const orbitControlRef = useRef(null);
  // The circle the live orbit occupies, reported by OrbitOverlay: { centerX,
  // centerY, radius }, or null when there is no orbit or nothing placed yet.
  // Drives the framing effect further down.
  const [orbitFrame, setOrbitFrame] = useState(null);
  const orbitFitRef = useRef({ fitted: false, zoom: 0 });
  // Mirrors store inputMode so RAF callbacks and pointer handlers can read the
  // current modality without re-binding when it flips.
  const inputModeRef = useRef('mouse');
  const anchorPositionUpdatesRef = useRef(new Map()); // Collects anchor position updates during render
  // Every group's title pill, keyed by group id — node-groups AND plain ones.
  //
  // anchorPositionUpdatesRef cannot serve this: it is keyed by ANCHOR INSTANCE
  // id and exists to sync that instance's stored position, so a plain group,
  // which has no anchor instance, is structurally absent from it. The mouse
  // never noticed, because a pill is a real SVG element with its own handlers —
  // but the controller has no elements to hit, only rects, and with plain
  // groups missing from the only rect map it could not see them at all.
  // Written by the groups render pass and kept fresh mid-drag by useNodeDrag.
  const groupTitleRectsRef = useRef(new Map());

  // Helper to measure text width accurately for the group labels (via Pretext — no DOM reflow)
  const getTextWidth = (text, font) => pretextMeasureTextWidth(text, font);

  // <<< OPTIMIZED: Use direct getState() calls for stable action methods >>>
  // Zustand actions are stable - we can use direct references instead of subscriptions
  // Use a defensive approach to avoid initialization errors
  const storeActions = useMemo(() => resolveStoreActions({}), []);


  // Filled by PanelResizers (P2.12): the gamepad resizes through it, and a canvas
  // press checks it so a resize drag never starts a pan.
  const panelResizeControlRef = useRef(null);

  const isTouchDeviceRef = useRef(false);

  const groupLongPressTimeout = useRef(null);
  // Split group rendering across z-layers: Phase 1 computes layouts and stores
  // JSX for later phases, so thing-group backgrounds/titles render at the right z-level
  // Shells are bucketed by nesting depth rather than kept in one flat list: the
  // edge layer interleaves anchor edges between depths so a nested group's
  // connections aren't buried under its parent's opaque band.
  const nodeGroupBackgroundsByDepthRef = useRef(new Map()); // depth → JSX[]
  const nodeGroupTitlesRef = useRef([]);
  // Plain groups nested inside a node-group (depth > 0), bucketed the same way.
  // Top-level plain groups stay in the flat bottom layer; these can't, because
  // an opaque shell is painted between that layer and the viewer.
  const nestedRegularGroupsByDepthRef = useRef(new Map()); // depth → JSX[]
  const thingGroupMemberIdsRef = useRef(new Set());
  const anchorInstanceIdsRef = useRef(new Set());

  // NOTE: touchState and docTouchListenersRef removed (moved to useCanvasTouch)

  // Track long press state synchronously to avoid race conditions in event handlers

  // Touch interaction constants
  const TOUCH_MOVEMENT_THRESHOLD = 10; // pixels
  // Track last pan velocity (px/ms) to produce consistent glide on release
  const lastPanVelocityRef = useRef({ vx: 0, vy: 0 });
  const lastPanSampleRef = useRef({ time: 0 });
  // The camera controller (P4.02: components/canvas/camera/cameraController.js)
  // owns pan and zoom momentum, trackpad zoom and the wheel. It is created once;
  // its context (cameraCtxRef) is assigned on every render, just before the JSX.
  const cameraCtxRef = useRef(null);
  const camera = useMemo(() => createCameraController(cameraCtxRef), []);
  const { panMomentumRef } = camera;
  // Track the source of current panning for momentum decisions
  const panSourceRef = useRef(null); // 'touch', 'trackpad', 'mouse', null
  const panVelocityHistoryRef = useRef([]); // History of recent pan positions for momentum calculation

  // Cleanup the gesture-block timer on unmount
  useEffect(() => {
    return () => {
      if (gestureBlockClearTimerRef.current) {
        clearTimeout(gestureBlockClearTimerRef.current);
        gestureBlockClearTimerRef.current = null;
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



  // Track active input modality via PointerEvent.pointerType so we never
  // mistake touch-synthesized mousedown for a real mouse click. We bind to
  // pointerdown only (not mousedown) — synthesized mouse events from touch
  // don't fire here with pointerType='mouse'. setInputMode no-ops when the
  // value is unchanged, so this stays cheap during normal interaction.
  useEffect(() => {
    const setInputMode = useGraphStore.getState().setInputMode;
    const handlePointerDown = (e) => {
      if (e.pointerType === 'mouse') {
        setInputMode('mouse');
        // A real mouse is the one input no handheld has, so it is the only
        // pointer that retires the controller hint. Touch and pen fall through
        // deliberately — a handheld's screen is still a touchscreen, and
        // tapping it says nothing about what kind of device this is. See
        // useMobileLandscapeShell.
        setControllerPresent(false);
      } else if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        setInputMode('touch');
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, []);

  // Subscribe to debug config changes for hitbox visualization
  useEffect(() => {
    const handleDebugConfigChange = (config) => {
      setShowNodeHitboxes(config.showNodeHitboxes || false);
    };

    const unsubscribe = debugConfig.addListener(handleDebugConfigChange);

    // Initialize with current config
    setShowNodeHitboxes(debugConfig.isNodeHitboxesEnabled());

    return unsubscribe;
  }, []);


  // storeActions is now defined above with defensive initialization

  // <<< OPTIMIZED: Individual stable subscriptions - Zustand auto-batches these >>>
  const activeGraphId = useGraphStore(state => state.activeGraphId);
  const selectedEdgeId = useCanvasUIStore(s => s.selectedEdgeId); // canvasUIStore since P2.03c (D-22)
  const selectedEdgeIds = useCanvasUIStore(s => s.selectedEdgeIds);
  const typeListMode = useGraphStore(state => state.typeListMode);

  // Fullscreen shell (phone in landscape, Capacitor): no header bar, no
  // Redstring menu, no TypeList — just the canvas and the two panel toggles.
  // See hooks/useMobileLandscapeShell.js.
  const mobileLandscapeShell = useMobileLandscapeShell();
  const overlaySlot = useContext(CanvasOverlaySlot);
  const headerHeight = mobileLandscapeShell ? 0 : HEADER_HEIGHT;
  const typeListVisible = typeListMode !== 'closed' && !mobileLandscapeShell;

  // Clear label stabilization cache when switching graphs
  useEffect(() => {
    clearLabelStabilization();
  }, [activeGraphId]);
  // P3.01: `graphs` as a live view (utils/liveMapView.js). It reads the store when
  // called, so callbacks and hooks never see a stale graph; its identity changes
  // only when the active web does (or any web, while a node previews its
  // definition, whose description renders), so an edit elsewhere doesn't render.
  const graphsViewKey = useGraphStore(state => (useCanvasUIStore.getState().previewingNodeId ? state.graphs : state.graphs.get(state.activeGraphId)));
  const graphsMap = useMemo(() => createLiveMapView(() => useGraphStore.getState().graphs), [graphsViewKey]);
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgePrototypesMap = useGraphStore(state => state.edgePrototypes);
  const showConnectionNames = useGraphStore(state => state.showConnectionNames);
  const connectionLabelColorMode = useGraphStore(state => state.connectionLabelColorMode ?? DEFAULT_CONNECTION_LABEL_COLOR_MODE);
  const connectionLabelOuterRing = useGraphStore(state => state.connectionLabelOuterRing ?? DEFAULT_CONNECTION_LABEL_OUTER_RING);
  const connectionLabelRingWidth = useGraphStore(state => state.connectionLabelRingWidth ?? DEFAULT_CONNECTION_LABEL_RING_WIDTH);
  const connectionLabelMoveFade = useGraphStore(state => state.connectionLabelMoveFade ?? DEFAULT_CONNECTION_LABEL_MOVE_FADE);
  const connectionLabelTruncate = useGraphStore(state => state.connectionLabelTruncate ?? DEFAULT_CONNECTION_LABEL_TRUNCATE);
  const connectionLabelSprites = useGraphStore(state => state.connectionLabelSprites ?? DEFAULT_CONNECTION_LABEL_SPRITES);
  const edgeGlowMode = useGraphStore(state => state.edgeGlowMode);
  const gamepadCrosshairScale = useGraphStore(state => state.gamepadSettings?.crosshairScale ?? 1.0);
  const darkMode = useGraphStore(state => state.darkMode);
  const inputMode = useGraphStore(state => state.inputMode);
  useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);
  const gridMode = useGraphStore(state => state.gridSettings?.mode || 'off');
  const gridSize = useGraphStore(state => state.gridSettings?.size || 200);
  const gridSnapMode = useGraphStore(state => state.gridSettings?.snapMode || 'if-enabled');
  const gridAppearance = useGraphStore(state => state.gridSettings?.appearance || 'lattice');
  const dragZoomSettings = useGraphStore(state => state.dragZoomSettings || DEFAULT_DRAG_ZOOM_SETTINGS);
  const focusOnSelectEnabled = useGraphStore(state => state.focusOnSelectEnabled !== false);
  const focusOnSelectZoomAmount = useGraphStore(state => state.focusOnSelectZoomAmount ?? 1.0);
  const enableAutoRouting = useGraphStore(state => state.autoLayoutSettings?.enableAutoRouting);
  const routingStyle = useGraphStore(state => state.autoLayoutSettings?.routingStyle || 'straight');
  const manhattanBends = useGraphStore(state => state.autoLayoutSettings?.manhattanBends || 'auto');
  const cleanLaneSpacing = useGraphStore(state => state.autoLayoutSettings?.cleanLaneSpacing || 24);
  const lombardiCurvature = useGraphStore(state => state.autoLayoutSettings?.lombardiCurvature ?? 1.0);
  // Styles that compute their own geometry instead of drawing a chord. Sites
  // downstream of the per-edge routing block should test `orthoRouting` (which
  // is non-null exactly when this is true and the edge isn't a self-loop);
  // this exists for the handful that run before it.
  const isRoutedStyle = enableAutoRouting
    && (routingStyle === 'manhattan' || routingStyle === 'clean' || routingStyle === 'lombardi');
  const multiConnectionCurve = useGraphStore(state => state.autoLayoutSettings?.multiConnectionCurve ?? 1.0);
  // Effective px spacing between adjacent parallel-edge curves. Base 200 bakes the
  // old "2x" look in as the 1.0 baseline; multiplier is the user's slider value.
  const curveSpacing = 200 * multiConnectionCurve;
  // Same slider, scaled for lanes that have to land on a node's side rather
  // than bow away from it. See ORTHOGONAL_LANE_FRACTION.
  const orthogonalLaneSpacing = curveSpacing * ORTHOGONAL_LANE_FRACTION;
  const lombardiLaneSpacing = curveSpacing * LOMBARDI_LANE_FRACTION;
  const textSettings = useGraphStore(state => state.textSettings);
  const connectionWidth = (textSettings?.connectionWidth ?? 1.0) * CONNECTION_WIDTH_BASE_SCALE;
  const connectionLabelSize = useGraphStore(state => state.connectionLabelSize ?? 1.0);
  const groupLayoutAlgorithm = useGraphStore(state => state.autoLayoutSettings?.groupLayoutAlgorithm || 'node-driven');
  const showClusterHulls = useGraphStore(state => state.autoLayoutSettings?.showClusterHulls || false);
  // Lets a curved/orthogonal routing style select the shape-aware layout that
  // suits it. Off keeps whatever algorithm is chosen regardless of routing.
  const routingDrivesAlgorithm = useGraphStore(state => state.autoLayoutSettings?.routingDrivesAlgorithm !== false);
  const layoutSolver = useGraphStore(state => state.autoLayoutSettings?.solver || 'force');
  const layoutScalePreset = useGraphStore(state => state.autoLayoutSettings?.layoutScale || 'balanced');
  const layoutScaleMultiplier = useGraphStore(state => state.autoLayoutSettings?.layoutScaleMultiplier ?? 1);
  const layoutIterationPreset = useGraphStore(state => state.autoLayoutSettings?.layoutIterations || 'balanced');
  const forceTunerSettings = useGraphStore(state => state.forceTunerSettings || DEFAULT_FORCE_TUNER_SETTINGS);
  const keyboardSettings = useGraphStore(state => state.keyboardSettings || DEFAULT_KEYBOARD_SETTINGS);
  const middleMouseZoomEnabled = useGraphStore(state => state.mouseSettings?.middleMouseZoomEnabled ?? false);
  const nodeLiftDelay = useGraphStore(state => state.mouseSettings?.nodeLiftDelay ?? 250);
  const touchSettings = useGraphStore(state => state.touchSettings || DEFAULT_TOUCH_SETTINGS);
  const trackpadZoomSensitivity = useGraphStore(state => state.touchSettings?.trackpadZoomSensitivity ?? 0.5);
  const trackpadZoomSensitivityRef = useRef(trackpadZoomSensitivity);
  useEffect(() => { trackpadZoomSensitivityRef.current = trackpadZoomSensitivity; }, [trackpadZoomSensitivity]);
  const trackpadPanSensitivity = useGraphStore(state => state.touchSettings?.trackpadPanSensitivity ?? 0.5);
  const trackpadPanSensitivityRef = useRef(trackpadPanSensitivity);
  useEffect(() => { trackpadPanSensitivityRef.current = trackpadPanSensitivity; }, [trackpadPanSensitivity]);
  const touchSettingsRef = useRef(touchSettings);
  useEffect(() => { touchSettingsRef.current = touchSettings; }, [touchSettings]);
  const edgesMap = useGraphStore(state => state.edges);
  const savedNodeIds = useGraphStore(state => state.savedNodeIds);
  const isUniverseLoaded = useGraphStore(state => state.isUniverseLoaded);
  const isUniverseLoading = useGraphStore(state => state.isUniverseLoading);
  const hasUniverseFile = useGraphStore(state => state.hasUniverseFile);


  // Store actions
  const cleanupOrphanedGraphs = useGraphStore(state => state.cleanupOrphanedGraphs);

  // Get the specific active graph to narrow memoization dependencies
  const activeGraph = graphsMap?.get(activeGraphId);
  const activeGraphInstances = activeGraph?.instances;

  // Image cache for auto-enriched thumbnails (separate store, never saved), and the
  // per-prototype upload/failure flags. Only the entries for prototypes on the
  // active web (P3.01): a thumbnail landing for another web doesn't render this.
  const activeProtoIds = useMemo(() => {
    const ids = new Set();
    activeGraphInstances?.forEach((instance) => ids.add(instance.prototypeId));
    return ids;
  }, [activeGraphInstances]);
  const imageCacheMap = usePickedEntries(useImageCache, 'images', activeProtoIds);
  const loadingImagesMap = usePickedEntries(useImageCache, 'loading', activeProtoIds);
  const failedImagesMap = usePickedEntries(useImageCache, 'failed', activeProtoIds);

  // Repair node-groups missing their anchor instance. Node-groups need an anchor (the
  // invisible instance edges connect to) to be a usable connection target. Legacy files,
  // and groups created via paths that set linkedNodePrototypeId without minting an anchor,
  // load without one — making them impossible to connect from/to. ensureGroupAnchor is
  // idempotent, so this settles after a single pass per graph.
  useEffect(() => {
    if (!activeGraphId || !activeGraph?.groups) return;
    const brokenGroupIds = [];
    activeGraph.groups.forEach((group, groupId) => {
      if (!group.linkedNodePrototypeId) return;
      if (!group.anchorInstanceId || !activeGraphInstances?.has(group.anchorInstanceId)) {
        brokenGroupIds.push(groupId);
        return;
      }
      // A memberless node-group with no frozen shell origin lays out to ok:false, so the
      // shell is skipped — and its anchor is hidden from the node layer for being an
      // anchor, leaving the Thing with nothing on canvas at all. ensureGroupAnchor seeds
      // the origin on its idempotent path; see seedEmptyPlaceholderOrigin.
      const hasMember = (group.memberInstanceIds || []).some(id => activeGraphInstances?.has(id));
      if (!hasMember && !group.emptyPlaceholderOrigin) {
        brokenGroupIds.push(groupId);
      }
    });
    if (brokenGroupIds.length === 0) return;
    brokenGroupIds.forEach(groupId => storeActions.ensureGroupAnchor(activeGraphId, groupId));
  }, [activeGraphId, activeGraph?.groups, activeGraphInstances, storeActions]);

  // Sweep the reverse case: anchor instances left holding the flag with no group that
  // names them back — the group is gone, it anchors a different instance now, or the
  // anchorForGroupId was lost. All three are hidden from rendering unconditionally, so
  // without this they stay invisible-but-connected indefinitely (visible only while
  // singly selected, which takes a render path that doesn't check the flag).
  useEffect(() => {
    if (!activeGraphId || !activeGraphInstances) return;
    let hasOrphan = false;
    for (const inst of activeGraphInstances.values()) {
      if (!inst.isGroupAnchor) continue;
      const group = inst.anchorForGroupId ? activeGraph?.groups?.get(inst.anchorForGroupId) : null;
      if (!group || group.anchorInstanceId !== inst.id) {
        hasOrphan = true;
        break;
      }
    }
    if (!hasOrphan) return;
    storeActions.cleanupOrphanedGroupAnchors(activeGraphId);
  }, [activeGraphId, activeGraph?.groups, activeGraphInstances, storeActions]);

  // Hydrated nodes for the active graph: prototype + cached image + instance, nothing
  // derived (unlike `nodes`) and never stale. An object is reused only when its
  // instance, prototype and cache entry are the same objects (Immer keeps untouched ones).
  const hydratedPrevRef = useRef({ byId: new Map(), list: [] });
  const hydratedNodes = useMemo(() => {
    if (!activeGraphId || !activeGraphInstances || !nodePrototypesMap) return [];
    const prev = hydratedPrevRef.current;
    const byId = new Map(), list = [];
    for (const [id, instance] of activeGraphInstances) {
      const prototype = nodePrototypesMap.get(instance.prototypeId);
      if (!prototype) continue;
      const cached = imageCacheMap[instance.prototypeId]; // auto-enriched thumbnails live outside the store
      const was = prev.byId.get(id);
      const node = (was && was.instance === instance && was.prototype === prototype && was.cached === cached)
        ? was.node
        : { ...prototype, ...((cached && !prototype.thumbnailSrc) ? { thumbnailSrc: cached.thumbnailSrc, imageAspectRatio: cached.imageAspectRatio } : {}), ...instance };
      byId.set(id, { instance, prototype, cached, node });
      list.push(node);
    }
    const same = prev.list.length === list.length && list.every((n, i) => n === prev.list[i]);
    hydratedPrevRef.current = { byId, list: same ? prev.list : list };
    return same ? prev.list : list;
  }, [activeGraphId, activeGraphInstances, nodePrototypesMap, imageCacheMap]);

  // Reconcile the image cache against the prototypes of the active graph.
  //
  // imageCache is never saved, so the Wikipedia URL in semanticMetadata is the
  // source of truth and the cache is derived from it. This keeps the two in
  // sync in BOTH directions:
  //   - URL present, nothing cached  → fetch it (file load, undo of a deletion)
  //   - URL gone, something cached   → drop it (redo of a deletion)
  // Running this only on activeGraphId meant undo restored the URL but nothing
  // re-fetched, so a deleted image stayed missing from the canvas until reload.
  // Driving it off nodePrototypesMap instead catches every path that changes an
  // image — undo, redo, jumpTo, wizard edits — rather than enumerating them.
  //
  // Depending on nodePrototypesMap does NOT loop the way depending on
  // imageCacheMap would: setImage changes only the cache, which this effect no
  // longer reads reactively, so the write cannot retrigger the effect.
  // OPTIMIZED: Only touch prototypes actually used in the active graph.
  useEffect(() => {
    if (!nodePrototypesMap || !activeGraphInstances) return;
    const cache = useImageCache.getState();
    // Build set of prototype IDs in the active graph
    const activeProtoIds = new Set();
    for (const instance of activeGraphInstances.values()) {
      activeProtoIds.add(instance.prototypeId);
    }
    for (const protoId of activeProtoIds) {
      const proto = nodePrototypesMap.get(protoId);
      if (!proto) continue;
      // A user-uploaded image lives in the main store and wins outright; the
      // cache is not involved, so leave whatever it holds alone.
      if (proto.thumbnailSrc) continue;

      const thumbUrl = proto.semanticMetadata?.wikipediaThumbnail;
      const cached = cache.getImage(protoId);

      if (thumbUrl && !cached) {
        const ratio = proto.semanticMetadata.imageAspectRatio || 1;
        queueThumbnailFetch(protoId, thumbUrl, ratio, proto.name || '');
      } else if (!thumbUrl && cached) {
        // The graph no longer references an image, but the canvas renders
        // whatever the cache holds — without this the image survives the redo.
        cancelThumbnailFetch(protoId);
      }
    }
  }, [nodePrototypesMap, activeGraphInstances]);

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

  // <<< Universe File Loading >>>
  useEffect(() => restoreUniverseOnMount({ storeActions }), []); // Run once on mount

  // Clean up any invalid open graphs on mount and when store changes
  useEffect(() => {
    cleanupOrphanedGraphs();
  }, [cleanupOrphanedGraphs, nodePrototypesMap]);

  // View option: allow browser-level trackpad pinch zoom (toggled from Header).
  const trackpadZoomEnabled = useCanvasUIStore(s => s.trackpadZoomEnabled);

  // <<< Prevent Page Zoom >>>
  useEffect(() => preventPageZoom({ trackpadZoomEnabled }), [trackpadZoomEnabled]);

  // Raw per-graph collections, read straight off the active graph rather than through
  // a memo over `graphsMap` (which Immer replaces on every write in the universe).
  // Immer keeps untouched siblings by reference, so `instances` and `edgeIds` keep
  // their identity across any write that didn't touch them.
  const instances = activeGraphInstances ?? null;
  const graphEdgeIds = activeGraph?.edgeIds ?? null;
  // Nodes reuse their previous objects when content and position are unchanged, so
  // with Node's memo comparator only the dragged node(s) re-render during a drag.
  const prevNodesRef = useRef(new Map()); // id → previous node object
  const prevNodesListRef = useRef([]);
  const nodes = useMemo(() => computeCanvasNodes({
    failedImagesMap, imageCacheMap, instances, loadingImagesMap, nodePrototypesMap, prevNodesListRef,
    prevNodesRef,
  }), [instances, nodePrototypesMap, imageCacheMap, loadingImagesMap, failedImagesMap]);

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
  const baseDimsById = useMemo(() => computeBaseDims({
    dimensionCacheRef, nodes, textSettings,
  }), [nodes, textSettings?.fontSize, textSettings?.lineSpacing, textSettings?.nodeScale]);
  // Defer viewport-dependent culling until pan/zoom state is initialized below
  const [visibleNodeIds, setVisibleNodeIds] = useTrackedState(() => new Set());
  const [visibleEdges, setVisibleEdges] = useTrackedState(() => []);

  // Debug visualization state
  const [showNodeHitboxes, setShowNodeHitboxes] = useState(false);

  // Selection lives in the canvas UI store (P2.02, D-04), under the old useState names.
  const selectedInstanceIds = useCanvasUIStore(s => s.selectedInstanceIds);
  const setSelectedInstanceIds = useCanvasUIStore(s => s.setSelectedInstanceIds);

  // Midpoint and angle of the selected edge in SVG canvas coordinates
  // NOTE: selectedEdgeMidpoint is defined further down, after edgeCurveInfo and
  // cleanLaneOffsets — it anchors the edge pie menu to the connection's LABEL
  // position, which needs both.

  // Refs for DOM-bypass drag (declared early so useNodeDrag can receive them)
  // Values sync'd via useEffect after the corresponding memos are computed
  const nodeByIdRef = useRef(nodeById);
  const baseDimsByIdRef = useRef(baseDimsById);
  const edgeCurveInfoRef = useRef(null);
  const edgesByNodeIdRef = useRef(null);
  const visibleEdgesRef = useRef(visibleEdges);
  // Previous-committed visible node set, read by runCulling for hysteresis (two-zone
  // culling: an already-visible node stays visible until it's outside the OUTER margin).
  const visibleNodeIdsRef = useRef(visibleNodeIds);
  // Refs to current nodes/edges arrays — read by runCulling (invoked imperatively
  // from onTransformChangeRef, so it can't rely on useEffect closures).
  const nodesRef = useRef(nodes);
  // What the pie machine needs from the canvas when an exit completes: the
  // hydrated node for an id, and the active web (P5.02b).
  const getPieEnv = useCallback(() => ({
    activeGraphId: useGraphStore.getState().activeGraphId,
    findNode: (id) => nodesRef.current.find((n) => n.id === id) ?? null,
  }), []);
  const pieCommandHandlerRef = useRef(null);
  useLayoutEffect(() => setPieCommandHandler((cmd) => pieCommandHandlerRef.current?.(cmd)), []);
  // The node pie has finished shrinking: the machine decides what comes next
  // (the carousel, a decompose preview, a stage swap, or nothing). Stable, so
  // PieMenu's animationend listeners stop re-subscribing (F-27).
  const handlePieExitComplete = useCallback(() => {
    useCanvasUIStore.getState().dispatchPie({ type: 'PIE_EXITED' }, getPieEnv());
  }, [getPieEnv]);
  const edgesRef = useRef(edges);
  const selectedInstanceIdsRef = useMemo(() => ({ get current() { return useCanvasUIStore.getState().selectedInstanceIds; } }), []);

  // Routing refs for DOM-bypass drag (arrow/label updates need to know routing mode)
  const enableAutoRoutingRef = useRef(enableAutoRouting);
  const routingStyleRef = useRef(routingStyle);
  const multiConnectionCurveRef = useRef(multiConnectionCurve);
  // Manhattan/Clean routing needs its own parameters mid-drag too, otherwise the
  // drag updater can only ever redraw straight edges (see useNodeDrag).
  const manhattanBendsRef = useRef(manhattanBends);
  const cleanLaneSpacingRef = useRef(cleanLaneSpacing);
  // Port assignments for 'clean' routing. Kept in a ref (synced from the memo
  // below) so the drag updater can reach them — the memo itself deliberately
  // freezes during a drag, and re-deriving lanes per frame would be far too slow.
  const cleanLaneOffsetsRef = useRef(new Map());
  // Same deal for Lombardi's per-node tangent fan: solving it is a whole-graph
  // pass, so the memo freezes during a drag and the drag updater reads the ref.
  const lombardiTangentsRef = useRef(new Map());
  const lombardiCurvatureRef = useRef(lombardiCurvature);
  // Label-angle bucket size for the DOM-bypass drag updater. Seeded to 0
  // ("don't snap") rather than the live value, because the memo that computes
  // it needs visibleEdges and zoomLevel and so can't run this early; the effect
  // beside that memo syncs it from the first commit onward. A first render at 0
  // matches what low label counts do anyway, so nothing visibly changes.
  const labelAngleQuantumRef = useRef(0);
  useEffect(() => { enableAutoRoutingRef.current = enableAutoRouting; }, [enableAutoRouting]);
  useEffect(() => { routingStyleRef.current = routingStyle; }, [routingStyle]);
  useEffect(() => { multiConnectionCurveRef.current = multiConnectionCurve; }, [multiConnectionCurve]);
  useEffect(() => { manhattanBendsRef.current = manhattanBends; }, [manhattanBends]);
  useEffect(() => { cleanLaneSpacingRef.current = cleanLaneSpacing; }, [cleanLaneSpacing]);
  useEffect(() => { lombardiCurvatureRef.current = lombardiCurvature; }, [lombardiCurvature]);

  // Groups-by-node mapping for DOM-bypass group drag
  const groupsByNodeIdRef = useRef(new Map());
  // Direct groupId -> group reference Map for the helper-driven drag-bounds path
  const groupsByIdRef = useRef(new Map());
  // Precomputed strict-subset child groups per group. Structural — only
  // depends on which groups exist and who their members are. Reused every
  // computeGroupLayout call (static render + drag) so the per-call O(M·K·L)
  // child-detection scan happens once per group-graph mutation, not per frame.
  const childGroupIdsByGroupIdRef = useRef(new Map());
  // Nesting depth per group (0 = outermost). SVG z-order is document order,
  // so Phase 1 sorts groups by this before emitting JSX — deeper shells and
  // their titles paint later (above their parents) within each z-layer.
  const groupDepthByGroupIdRef = useRef(new Map());
  // instanceId → the z-slot connections touching it paint at (buildEdgeZSlotIndex).
  const edgeZSlotByInstanceIdRef = useRef(new Map());

  // Derived during render, not in an effect: the group render pass reads the
  // depth and slot indexes, and a ref written by an effect would be one commit
  // stale — refs don't schedule a re-render, so a freshly nested group would
  // paint in the wrong z-order until something else happened to re-render.
  // Keyed on the active graph's `groups` Map, NOT on `graphsMap`.
  //
  // Immer replaces the whole `graphs` Map on every graph mutation, so depending
  // on it re-ran this O(groups x members) index build on things that cannot
  // change group structure — most often a pan/zoom viewport save, which fires
  // ~300ms after every settled gesture. `groups` keeps its reference across any
  // write that didn't touch it, so this now rebuilds only when it genuinely has
  // to.
  const groupStructure = useMemo(() => {
    const groupsById = activeGraph?.groups || new Map();
    const groupsByNodeId = buildGroupsByMemberIdIndex(groupsById);
    const childGroupIds = buildChildGroupIdsIndex(groupsById, groupsByNodeId);
    const groupDepths = computeGroupDepths(groupsById, groupsByNodeId, childGroupIds);
    return {
      groupsByNodeId,
      groupsById,
      childGroupIds,
      parentGroupIds: buildParentGroupIdsIndex(childGroupIds),
      groupDepths,
      edgeZSlots: buildEdgeZSlotIndex(groupsById, groupDepths),
    };
  }, [activeGraph?.groups]);

  // Mirrored into refs so the drag hook can read them per-frame without
  // re-subscribing. Pure assignment of already-memoized values.
  groupsByNodeIdRef.current = groupStructure.groupsByNodeId;
  groupsByIdRef.current = groupStructure.groupsById;
  childGroupIdsByGroupIdRef.current = groupStructure.childGroupIds;
  groupDepthByGroupIdRef.current = groupStructure.groupDepths;
  edgeZSlotByInstanceIdRef.current = groupStructure.edgeZSlots;

  // Clipboard ref for copy/paste operations
  const clipboardRef = useRef(null);
  // A ref write re-renders nothing, which was fine while the clipboard was only
  // ever read at the moment of a paste. The connection menu now offers Paste only
  // when the clipboard holds something a connection can use, so it has to know
  // when that changes — Copy on a connection is what makes Paste appear. Every
  // write to clipboardRef goes through markClipboardChanged.
  const clipboardVersion = useCanvasUIStore(s => s.clipboardVersion), setClipboardVersion = useCanvasUIStore(s => s.setClipboardVersion);
  const markClipboardChanged = useCallback(() => setClipboardVersion(v => v + 1), []);

  // Onboarding (StorageSetupModal) lives in UniverseHost since P2.06c; the
  // download pill still yields to it.
  const showStorageSetupModal = useCanvasUIStore(s => s.showStorageSetupModal);

  const [drawingConnectionFrom, _setDrawingConnectionFromState] = useState(null); // Structure might change (store source ID)
  // Set when a draw is abandoned rather than completed, so the release that
  // follows knows not to build anything out of it. One-way: only a genuinely new
  // draw clears it, which is why it can never suppress a legitimate edge.
  const connectionDrawAbandonedRef = useRef(false);
  // ---------------------------------------------------------------------------
  // In-flight connection endpoint — DOM-bypass path.
  //
  // The free end of the line moves every frame while a connection is being drawn,
  // and it has to keep moving when the canvas moves under a stationary pointer
  // (edge-pan, keyboard pan/zoom). Pushing that through `setDrawingConnectionFrom`
  // re-renders all of NodeCanvas once per frame, at exactly the moment the canvas
  // is already busy panning — so the live value lives in a ref and is written
  // straight to the <line> element instead, the same trade useCanvasTransform
  // makes for pan/zoom.
  //
  // `drawingConnectionFrom` still carries the source and the start point (both
  // fixed for the life of a draw); only the endpoint moved out of state.
  // ---------------------------------------------------------------------------
  const drawingConnectionEndRef = useRef({ x: 0, y: 0 });
  const drawingConnectionLineRef = useRef(null);
  const drawingConnectionWrittenRef = useRef(null);
  // Flips when the endpoint enters or leaves its own source node's box, which is
  // what gates the self-loop preview. This is the only endpoint-driven re-render
  // left in a draw: a couple per gesture instead of one per frame.
  const [selfLoopPreviewActive, setSelfLoopPreviewActive] = useState(false);

  // Wrapped so that beginning a draw synchronously clears the "abandoned" mark a
  // previous pinch may have left (see connectionDrawAbandonedRef). Doing it in an
  // effect instead would leave the mark standing for one commit, and a release
  // landing in that gap would silently drop a legitimate edge.
  // Starting a draw also seeds the DOM-bypass endpoint so the line's first frame
  // lands in the right place; ending one drops the write cache and the self-loop
  // preview. Endpoint movement does NOT come through here — see
  // setDrawingConnectionEnd.
  const setDrawingConnectionFrom = useCallback((next) => {
    if (next) {
      connectionDrawAbandonedRef.current = false;
      drawingConnectionEndRef.current = { x: next.currentX, y: next.currentY };
    }
    drawingConnectionWrittenRef.current = null;
    if (!next) setSelfLoopPreviewActive(false);
    _setDrawingConnectionFromState(next);
  }, []);
  // True once the pointer has moved >=10px (in canvas coords) outside the source node's
  // bounds during a connection draw. Used to gate the self-loop gesture: the user must
  // exit the source node and return to it before releasing.
  const connectionExitedSourceRef = useRef(false);
  // Detent track for the connection line's length. Measured in SCREEN pixels,
  // not canvas units, so the detent spacing is what the finger travels
  // regardless of zoom — at 0.2x zoom a canvas-unit lattice would tick five
  // times as often for the same hand movement.
  const connectionStretchTrack = useRef(createDetentTrack('connectionStretch', CONNECTION_DETENT_PX));
  // Instance id the in-flight connection is currently hovering as a valid drop
  // target, or null. Edge-triggering the target haptic off this is what keeps it
  // from repeating while the finger sits still on a node.
  const connectionHoverTargetRef = useRef(null);
  const [selfLoopDialog, setSelfLoopDialog] = useState(null);

  // Write the in-flight endpoint straight to the <line>. Mirrors
  // useCanvasTransform.applyTransform — same reason (per-frame updates must not
  // go through React) and the same skip-when-unchanged guard, since setAttribute
  // with an identical value still invalidates the raster.
  const applyDrawingConnection = useCallback(() => {
    const el = drawingConnectionLineRef.current;
    if (!el) return;
    const { x, y } = drawingConnectionEndRef.current;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const written = drawingConnectionWrittenRef.current;
    if (written && written.x === x && written.y === y) return;
    el.setAttribute('x2', x);
    el.setAttribute('y2', y);
    drawingConnectionWrittenRef.current = { x, y };
  }, []);

  // Move the in-flight endpoint to a canvas-space point. Every path that moves it
  // goes through here — pointer moves, edge-pan, keyboard pan/zoom — so the
  // gesture's two source-relative facts (has it left the source yet, is it back
  // inside it) are evaluated once, for every kind of movement. That matters for
  // keyboard panning in particular: the pointer can sit still while the canvas
  // slides the source node out from under it, which is a real exit even though no
  // pointer event fired.
  const setDrawingConnectionEnd = useCallback((...args) => writeDrawingConnectionEnd({
    drawingConnectionEndRef, applyDrawingConnection, drawingConnectionFromRef, nodesRef,
    anchorPositionUpdatesRef, connectionExitedSourceRef, zoomLevelRef, setSelfLoopPreviewActive,
  }, ...args), [applyDrawingConnection]);

  // Same, from a client-space pointer position re-projected against the given
  // pan/zoom. This is what holds the endpoint under the cursor while the canvas
  // pans beneath it: the edge-pan loop and the keyboard loop both call it right
  // after they move the view, so the line never drifts off a stationary pointer.
  const reprojectDrawingConnectionEnd = useCallback((clientX, clientY, pan, zoom) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cs = canvasSizeRef.current;
    const { x: rawX, y: rawY } = clientToCanvas(clientX, clientY, rect, pan, zoom, cs);
    const { x, y } = GeometryUtils.clampCoordinates(rawX, rawY, cs);
    setDrawingConnectionEnd(x, y);
  }, [setDrawingConnectionEnd]);

  // Ref-wrapped for the keyboard loop, which mounts once with no dependencies.
  const reprojectDrawingConnectionEndRef = useRef(reprojectDrawingConnectionEnd);
  useEffect(() => {
    reprojectDrawingConnectionEndRef.current = reprojectDrawingConnectionEnd;
  }, [reprojectDrawingConnectionEnd]);

  // React writes x2/y2 from props whenever it renders the line, and its diff is
  // against the last value IT rendered — not against what the imperative path has
  // since written. So after every commit, check the DOM against the ref and
  // re-assert only on a genuine mismatch: a redundant setAttribute would still
  // invalidate the raster, and this runs on every render of the canvas.
  useLayoutEffect(() => {
    const el = drawingConnectionLineRef.current;
    if (!el) return;
    const { x, y } = drawingConnectionEndRef.current;
    if (el.getAttribute('x2') === String(x) && el.getAttribute('y2') === String(y)) return;
    drawingConnectionWrittenRef.current = null;
    applyDrawingConnection();
  });

  // ---------------------------------------------------------------------------
  // Starting a draw. Two gestures produce the same relative motion between the
  // pointer and the node it is holding, and both start a connection:
  //
  //   1. the pointer moves away from the node (handleMouseMove), and
  //   2. the canvas is keyboard-panned out from under a stationary pointer.
  //
  // (2) exists for hardware where holding a button while moving is genuinely
  // awkward — a Windows trackpad's button is a physical press in one corner, not
  // macOS's click-anywhere surface, so "hold and drag" costs a hand contortion
  // that "hold and press D" doesn't. Both routes are the same threshold on the
  // same gesture; only the frame of reference differs.
  // ---------------------------------------------------------------------------

  // Screen-space canvas travel accumulated while a node is held. Keyed by the
  // armed node so it self-zeroes on every new arming and on button-up — travel
  // can never leak from one gesture into the next.
  const panTravelSinceMouseDownRef = useRef({ x: 0, y: 0, armedId: null });
  // Live-mirrored so the keyboard loop, which mounts once, always calls the
  // current closure rather than the one from its mount render.
  const keyboardPanTravelRef = useRef(null);

  const [isPanning, _setIsPanningState] = useState(false);
  // The ref mirrors isPanning synchronously. Critical for touch flow: React 18 batches
  // state updates and may not flush before the next browser event fires. Without
  // it, the touchmove/touchend handlers immediately following a pinch→1-finger
  // transition would close over a stale `isPanning=false`, causing the pan branch in
  // handleMouseMove and the momentum-launch block in handleMouseUp to skip entirely
  // on fast continuous gestures.
  const isPanningRef = useRef(false);
  const setIsPanning = useCallback((value) => {
    const next = typeof value === 'function' ? value(isPanningRef.current) : value;
    if (next === isPanningRef.current) return; // same value: skip the wasted run (useTrackedState)
    isPanningRef.current = next;
    _setIsPanningState(next);
  }, []);
  // The pan anchor is ref-only: nothing renders from it, and the drag-pan rAF
  // rewrites it on every frame the view moves. (It used to be mirrored into React
  // state as well, which re-rendered all of NodeCanvas once per pan frame.)
  const panStartRef = useRef({ x: 0, y: 0 });
  const setPanStart = useCallback((value) => {
    panStartRef.current = typeof value === 'function' ? value(panStartRef.current) : value;
  }, []);
  // setPanOffset alias is defined after useCanvasTransform initialization (see below canvasSize)

  const orbitClickDownPos = useRef(null); // Track mousedown position for orbit overlay pan detection

  // Marquee. `selectionStart` is state only so the <rect> mounts and unmounts
  // with the gesture; the box itself lives in marqueeBoxRef and is written
  // straight to the <rect> (P1.04, F-03), like the connection line's endpoint.
  const [selectionStart, setSelectionStartState] = useState(null);
  // The pie machine reads whether a marquee is being drawn (P5.02b).
  const setSelectionStart = useCallback((v) => {
    setSelectionStartState(v);
    useCanvasUIStore.getState().dispatchPie({ type: 'MARQUEE', active: !!v });
  }, []);
  // Set synchronously by beginMarquee/endMarquee; the effect covers resets.
  const selectionStartRef = useRef(null);
  useEffect(() => { selectionStartRef.current = selectionStart; }, [selectionStart]);
  const marqueeBoxRef = useRef(null); // { x, y, width, height } in canvas space
  const marqueeRectElRef = useRef(null);
  const marqueeSelectionRef = useRef(null); // the last selection the box committed
  const marqueeRafRef = useRef(0);
  const marqueePassRef = useRef(null);
  const setMarqueeRectEl = useCallback((el) => { // callback ref, and the writer
    marqueeRectElRef.current = el;
    const box = marqueeBoxRef.current;
    if (el && box) ['x', 'y', 'width', 'height'].forEach((k) => el.setAttribute(k, box[k]));
  }, []);

  // Drop every cached connection-label placement and the jitter deadband.
  //
  // Callers are the operations that move nodes WITHOUT going through a drag:
  // auto-layout, snap-to-grid, condense, bring-into-bounds. Dragging clears
  // the cache itself (useNodeDrag), which is why moving a node by hand always
  // looked right while those operations left labels behind.
  //
  // This used to indirect through a `labelCacheResetRef` that nothing ever
  // assigned, so every one of those callers was a silent no-op.
  const resetConnectionLabelCache = useCallback(() => {
    placedLabelsRef.current.clear();
    clearLabelStabilization();
  }, []);

  // Panel expansion states - must be defined before viewport bounds hook
  // Panel expansion states - managed globally
  const leftPanelExpanded = useGraphStore(state => state.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(state => state.rightPanelExpanded);

  // Use proper viewport bounds hook for accurate, live viewport calculations
  // We pass typeListVisible to ensure edge panning respects the TypeList visibility
  const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListVisible);

  // Calculate viewport size - use fixed window dimensions for canvas coordinate system
  // This ensures canvas coordinates are independent of panel state
  // The safe-area-padded app box, not the raw window. Under viewport-fit=cover
  // window.innerHeight includes the Dynamic Island / home-indicator bands, which
  // the app never lays out in — using it here would offset the whole canvas
  // coordinate system by the inset. See utils/appViewport.js.
  const [windowSize, setWindowSize] = useState(() => getAppViewportSize());

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
      setWindowSize(getAppViewportSize());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Large fixed canvas - stable coordinate system. Stays a constant so all
  // downstream world-coord math (spawning, drag-zoom anchors, AbstractionCarousel
  // positioning, hit testing, navigation) remains consistent. The SVG element's
  // intrinsic 100k size is fine because the per-frame pan/zoom transform is
  // applied to a child <g> via the SVG render path (see useCanvasTransform),
  // so the outer <svg> is never CSS-transformed and never tries to GPU-promote
  // a 100k compositor layer.
  const canvasSize = useMemo(() => {
    const canvasWidth = 100000;
    const canvasHeight = 100000;
    return {
      width: canvasWidth,
      height: canvasHeight,
      offsetX: -canvasWidth / 2,
      offsetY: -canvasHeight / 2,
    };
  }, []);

  const canvasSizeRef = useRef(canvasSize);
  useEffect(() => {
    canvasSizeRef.current = canvasSize;
  }, [canvasSize]);

  // --- DOM-bypass pan/zoom (Phase 1 perf refactor) ---
  // panRef/zoomRef are the authoritative values; DOM is updated directly.
  // settledPan/settledZoom are React state that updates ~150ms after interaction stops.
  const transform = useCanvasTransform(svgRef, contentGroupRef, canvasSize, overlayGroupRef);
  const panOffsetRef = transform.panRef;     // alias for existing code
  const zoomLevelRef = transform.zoomRef;    // alias for existing code
  const setPanOffset = transform.setPan;     // drop-in alias for migration
  const setZoomLevel = transform.setZoom;    // drop-in alias for migration
  const setPanAndZoom = transform.setPanAndZoom;  // atomic: single DOM write, single culling call
  // Settled values used where React re-renders are acceptable (child props, culling, view persistence)
  const panOffset = transform.settledPan;
  const zoomLevel = transform.settledZoom;
  // True from the first mutation of a gesture until SETTLE_DELAY after the last
  // one. Read ONLY from refs (never as a dependency) — see the note below on why
  // reading the state form re-renders the whole canvas twice per gesture.
  // runCulling uses it to decide whether it may remove things or only add them.
  const isViewMovingRef = transform.isMovingRef;
  // NOTE: transform.isMoving is deliberately NOT read here. Reading it makes
  // every gesture's start and end a full canvas re-render — see labelAngleQuantum.

  // Apply DOM transform after mount and whenever canvasSize changes.
  // This is the ONLY place the SVG transform is written — JSX style omits `transform`
  // so React never fights with direct DOM writes.
  useLayoutEffect(() => {
    transform.applyTransform();
  }, [transform.applyTransform]);

  // Viewport bounds ref for edge panning effect
  const viewportBoundsRef = useRef(viewportBounds);
  useEffect(() => {
    viewportBoundsRef.current = viewportBounds;
  }, [viewportBounds]);

  // How much of the framing region's bottom the bottom control panel is covering, in px,
  // or 0 when none is up.
  //
  // All four bottom panels (node, connection, abstraction, group) render the same
  // `.unified-bottom-panel` strip — position:fixed, centred, floating over the canvas.
  // Framing has to treat it as chrome: a pie menu centred in the full region lands
  // half-behind it.
  //
  // Measured, never assumed. There is no one number to assume — the strip's height
  // depends on its mode AND its content (a connection's triple preview is taller than a
  // node's pill, both scale with the node-size settings, and mobile lays the whole thing
  // out differently), and most of the time no panel is up at all: the single-Thing panel
  // is off by default (showNodeControlPanel). So this reads whatever is actually on
  // screen, and reserves nothing when that is nothing.
  //
  // Both reads are transform-free on purpose. The panel flies in on a translateY, so
  // getBoundingClientRect() reports it ~100px low for the 300ms that animation runs —
  // exactly the window in which framing fires. Computed `bottom` + offsetHeight is where
  // it will actually sit. #root carries an identity transform (see appViewport.js) and is
  // therefore the containing block for these fixed panels, so that `bottom` is measured
  // from the app box — the same space viewportBounds lives in, no safe-area correction.
  const getBottomPanelReserve = useCallback((...args) => getBottomPanelReserveWith({
    viewportBounds,
  }, ...args), [viewportBounds]);

  // The rect every framing animation (focus-on-select, the abstraction carousel,
  // decompose, the semantic orbit, search navigation) should aim at, in CONTAINER
  // coordinates — the space panOffset actually lives in.
  //
  // Three corrections on top of viewportBounds:
  //
  // 1. Space. viewportBounds is app-box space: its `x` IS the left panel's width
  //    and its `y` IS the header's height. The canvas container is a full-width
  //    flex child sitting below the header (the panels are position:fixed overlays
  //    and take no flow space), so its own origin is already (0, HEADER_HEIGHT).
  //    Panning to `vb.y + vb.height / 2` therefore counts the header twice and
  //    lands the content a full HEADER_HEIGHT below the centre of the region it
  //    was meant to be centred in — straight down toward the TypeList bar, which
  //    is exactly where a pie menu can least afford the extra 50px. Subtracting
  //    the container's own offset is the same conversion useGraphLayout's
  //    zoom-to-fit already does; doing it via the app-box origin (rather than the
  //    raw client rect) keeps it exact under viewport-fit=cover, where the client
  //    rect starts one safe-area inset in from the app box.
  //
  // 2. Occlusion. Exclusive panel mode (narrow windows — see
  //    EXCLUSIVE_PANEL_MODE_THRESHOLD) deliberately reports the FULL window width,
  //    because a panel there may cover nearly all of it and framing into the
  //    remaining sliver is worse than ignoring it. That's the right call at 390px
  //    and the wrong one at 1000px with a 300px panel open — the node ends up
  //    centred behind the panel. So subtract the open overlays here whenever doing
  //    so still leaves a region worth framing into.
  //
  // 3. The bottom control panel, for callers that ask for it (`reserveBottomPanel`).
  //    Same occlusion argument as the side panels, one axis down — see
  //    getBottomPanelReserve. Opt-in because it is only right for the framings whose
  //    subject the panel is about to sit under; `reservedBottom` on the result reports
  //    how much was actually taken, so those callers can drop their own hand-tuned
  //    "lift it a bit so the panel has room" nudge rather than double-compensating.
  const getFramingRegion = useCallback((...args) => getFramingRegionWith({
    viewportBounds, getBottomPanelReserve, leftPanelExpanded, rightPanelExpanded, containerRef,
  }, ...args), [viewportBounds, leftPanelExpanded, rightPanelExpanded, getBottomPanelReserve]);

  // Framing fires from the same effect flush that switches the bottom control panel on,
  // so on a fresh selection the panel React is about to mount is not in the DOM yet —
  // and measuring it is the entire point. One frame puts React's commit in front of the
  // measurement; the eased animation that follows swallows the 16ms. Any pending frame
  // is cancelled first, so clicking through Things quickly can't leave two framings
  // racing each other.
  const framingFrameRef = useRef(0);
  const runFramingAfterCommit = useCallback((fn) => {
    if (typeof requestAnimationFrame !== 'function') { fn(); return; }
    cancelAnimationFrame(framingFrameRef.current);
    framingFrameRef.current = requestAnimationFrame(fn);
  }, []);
  useEffect(() => () => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(framingFrameRef.current);
  }, []);

  const mousePositionRef = useRef({ x: 0, y: 0 });

  // Document-level mouse tracking (captures events even over panels or when propagation is stopped)
  useEffect(() => {
    const handleDocumentMouseMove = (e) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    document.addEventListener('mousemove', handleDocumentMouseMove, { passive: true });
    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
    };
  }, []);

  // --- Node Drag Hook (Phase 3 extraction) ---
  const nodeDrag = useNodeDrag({
    panOffsetRef,
    zoomLevelRef,
    setPanOffset,
    setZoomLevel,
    // Reactive (non-ref) settled values — see the re-cache effect in
    // useNodeDrag for why these need to be actual render dependencies rather
    // than refs.
    settledZoomLevel: zoomLevel,
    settledPanOffset: panOffset,
    containerRef,
    canvasSize,
    canvasSizeRef,
    viewportSizeRef,
    viewportBoundsRef,
    mousePositionRef,
    activeGraphId,
    nodes,
    nodeById,
    selectedInstanceIds,
    storeActions,
    gridMode,
    gridSize,
    dragZoomSettings,
    pinchSmoothingRef,
    placedLabelsRef,
    // DOM-bypass drag refs
    nodeByIdRef,
    baseDimsByIdRef,
    edgeCurveInfoRef,
    edgesByNodeIdRef,
    edgesRef,
    selectedInstanceIdsRef,
    enableAutoRoutingRef,
    routingStyleRef,
    manhattanBendsRef,
    cleanLaneSpacingRef,
    cleanLaneOffsetsRef,
    lombardiTangentsRef,
    lombardiCurvatureRef,
    labelAngleQuantumRef,
    multiConnectionCurveRef,
    groupsByNodeIdRef,
    groupsByIdRef,
    childGroupIdsByGroupIdRef,
    anchorPositionUpdatesRef,
    groupTitleRectsRef,
  });
  // Aliases for 1:1 replacement of old local state/refs
  const draggingNodeInfo = nodeDrag.draggingNodeInfo;
  const draggingNodeInfoRef = nodeDrag.draggingNodeInfoRef;
  const dragPhaseRef = nodeDrag.dragPhaseRef;
  const isAnimatingZoomRef = nodeDrag.isAnimatingZoomRef;
  // True while the game controller's crosshair drift owns the camera.
  // Deliberately NOT isAnimatingZoomRef: that flag is shared with drag-zoom and
  // focus-on-select, and letting the drift write it meant a drift standing down
  // cleared a flag that, by then, belonged to the node lift that displaced it —
  // which is what made lifting a node glitch for a frame or two. The drift
  // reads that flag and owns this one. See utils/gamepadAim.js.
  const gamepadDriftingRef = useRef(false);
  const longPressingInstanceIdRef = nodeDrag.longPressingInstanceIdRef;
  const setLongPressingInstanceId = nodeDrag.setLongPressingInstanceId;
  const wasDraggingRef = nodeDrag.wasDraggingRef;
  const startDragForNode = nodeDrag.startDragForNode;
  const startDragForNodeRef = nodeDrag.startDragForNodeRef;

  // Whether the background grid is painted right now, and which <pattern> the
  // grid overlay is publishing under that setting. Hoisted out of the overlay
  // because thing-group interiors repaint the same pattern over their own
  // opaque fill (see the shell in the groups phase) — the grid sits at the
  // bottom of the z-stack, so an opaque group would otherwise punch a hole in
  // it. Both places have to agree on the id or the interior renders unfilled.
  const gridActive = gridMode === 'always' || (gridMode === 'move' && !!draggingNodeInfo);
  const gridPatternId = gridAppearance === 'dot' ? 'grid-dots-pattern' : 'grid-lines-pattern';

  // Invalidate the connection-label placement cache when a drag ends. The
  // cache (placedLabelsRef) is consulted in the !draggingNodeInfo branch and
  // can hold stale placements based on pre-snap positions when grid snap is on
  // — drag terminates before another React render gets to recompute placement
  // for the snapped commit position. Clearing here forces the next render to
  // recompute against the committed (post-snap) node positions.
  const wasDraggingForLabelsRef = useRef(false);
  useEffect(() => {
    if (draggingNodeInfo) {
      wasDraggingForLabelsRef.current = true;
    } else if (wasDraggingForLabelsRef.current) {
      wasDraggingForLabelsRef.current = false;
      placedLabelsRef.current.clear();
    }
  }, [draggingNodeInfo]);

  // ---------------------------------------------------------------------------
  // Edge-pan while drawing a connection — mirrors the node-drag edge-pan in
  // useNodeDrag, but targets `drawingConnectionFrom`. Works for both mouse and
  // touch because `mousePositionRef` is updated by document-level mousemove
  // AND by handleMouseMove (which the touch hook invokes via window
  // pointermove during a connection draw). Keyboard-safe: bails out during an
  // active zoom animation and only reacts to pointer proximity to the edge,
  // so keyboard pan/zoom inputs still drive the canvas independently.
  // ---------------------------------------------------------------------------
  const drawingConnectionFromRef = useRef(null);
  useEffect(() => { drawingConnectionFromRef.current = drawingConnectionFrom; }, [drawingConnectionFrom]);

  // End an in-flight connection draw without building anything from it: no edge,
  // and no self-loop dialog even if the gesture is sitting over its own source.
  // The touch layer calls this when a second finger arrives, which makes the
  // gesture a pinch — drawing is a one-finger interaction, so there is no reading
  // of two fingers that should still produce a connection.
  const cancelConnectionDraw = useCallback(() => {
    connectionDrawAbandonedRef.current = true;
    connectionExitedSourceRef.current = false;
    connectionHoverTargetRef.current = null;
    setLongPressingInstanceId(null); // don't let the mouse path re-arm a draw
    setDrawingConnectionFrom(null);
  }, [setLongPressingInstanceId, setDrawingConnectionFrom]);
  useEffect(() => runConnectionEdgePan({
    drawingConnectionFrom, isAnimatingZoomRef, drawingConnectionFromRef, mousePositionRef, viewportBoundsRef,
    panOffsetRef, zoomLevelRef, canvasSizeRef, viewportSizeRef, setPanOffset, reprojectDrawingConnectionEnd,
  }), [!!drawingConnectionFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Grid Snapping Helper (kept for non-drag uses like node creation, orbit, plus sign) ---
  const snapToGridAnimated = (mouseX, mouseY, nodeWidth, nodeHeight, currentPos) => {
    return GeometryUtils.snapToGridAnimated(mouseX, mouseY, nodeWidth, nodeHeight, currentPos, gridMode, gridSize);
  };

  const { stopPanMomentum, startPanMomentum } = camera;

  useEffect(() => {
    return () => stopPanMomentum();
  }, [stopPanMomentum]);

  // View-motion sampling (the touch layer asks isViewMoving): the camera controller.
  const { sampleViewMotion, isViewMoving } = camera;

  // Center view on instances of a prototype within the active graph
  const navigateToPrototypeInstances = useCallback((prototypeId) => frameInstancesOfPrototype(prototypeId, {
    activeGraphId, baseDimsById, canvasSize, containerRef, getFramingRegion, nodes,
    transform, viewportSize,
  }), [activeGraphId, nodes, baseDimsById, viewportSize, canvasSize, MAX_ZOOM, getFramingRegion]);

  // Function to move out-of-bounds nodes back into canvas while preserving relative positions
  // Integrated graph layout logic via custom hook
  const {
    moveOutOfBoundsNodesInBounds,
    applyAutoLayoutToActiveGraph,
    condenseGraphNodes,
    snapActiveGraphToGrid,
    cancelAutoLayoutAnimation,
    cancelAutoLayout
  } = useGraphLayout({
    activeGraphId,
    storeActions,
    graphsMap,
    nodes,
    edges,
    baseDimsById,
    canvasSize,
    resetConnectionLabelCache,
    nodePrototypesMap,
    edgePrototypesMap,
    layoutScalePreset,
    layoutScaleMultiplier,
    layoutIterationPreset,
    groupLayoutAlgorithm,
    routingStyle,
    lombardiCurvature,
    routingDrivesAlgorithm,
    layoutSolver,
    forceTunerSettings,
    connectionFontSize: resolveEdgeLabelFontSize(textSettings, connectionLabelSize),
    // The group title tab the solver has to reserve room for, at the size this
    // canvas actually draws it (see groupLabelFontSize/groupLabelScale in the
    // group render below). Plain numbers, because the solver runs in a worker.
    groupLabelScale: textSettings?.nodeScale ?? 1.0,
    groupLabelFontSize: 45 * (textSettings?.fontSize ?? 1.0) * (textSettings?.nodeScale ?? 1.0),
    setZoomLevel,
    setPanOffset,
    canvasTransform: transform,
    viewportSize,
    viewportBounds,
    containerRef,
    maxZoom: MAX_ZOOM,
    gridMode,
    gridSize,
    gridSnapMode,
    draggingNodeInfoRef
  });

  // Expose functions to window for manual use (for debugging/testing)
  useEffect(() => {
    window.moveOutOfBoundsNodesInBounds = moveOutOfBoundsNodesInBounds;

    return () => {
      delete window.moveOutOfBoundsNodesInBounds;
    };
  }, [moveOutOfBoundsNodesInBounds]);

  /**
   * Transforms client/screen coordinates to canvas coordinates.
   * Wrapper around GeometryUtils.clientToCanvasCoordinates with current state.
   */
  const clientToCanvasCoordinates = useCallback((clientX, clientY) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return GeometryUtils.clientToCanvasCoordinates(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
  }, [canvasSize]);

  // Calculate proper minimum zoom to prevent zooming beyond canvas edges
  const MIN_ZOOM = Math.max(
    viewportSize.width / canvasSize.width,
    viewportSize.height / canvasSize.height,
    0.05  // Absolute minimum
  );

  const { stopZoomMomentum, startZoomMomentum } = camera;


  const { detentRectRef } = camera; // the wheel-burst rect cache, dropped when the panels or viewport change
  useEffect(() => {
    detentRectRef.current.rect = null;
  }, [leftPanelExpanded, rightPanelExpanded, viewportSize.width, viewportSize.height]);

  // Diagnostic accumulator for `window.__edgePerf`. Answers the question that
  // decides whether the edge renderer is worth caching: of the ~143ms a settled
  // commit costs with connection labels on, how much is the EDGES?
  //
  // The 143ms figure is a whole NodeCanvas commit — nodes, groups, panels and
  // edges together. Every treatment aimed at the edge path is bounded by the
  // edge share of it, so measure before spending.
  //
  // Usage, in the console on a real universe:
  //   window.__edgePerf = true          // then pan/zoom once to force a commit
  // Each commit logs its own edge-render total and edge count. Compare against
  // window.__zoomPerf's worstFrameMs for the same gesture, and switch connection
  // labels off to see the split move.
  const edgePerfRef = useRef({ ms: 0, edges: 0, commits: 0 });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.__edgePerf) return;
    const p = edgePerfRef.current;
    if (p.edges === 0) return;
    console.log('[edgePerf] commit', {
      edgeRenderMs: Number(p.ms.toFixed(2)),
      edges: p.edges,
      msPerEdge: Number((p.ms / p.edges).toFixed(3)),
    });
    p.ms = 0; p.edges = 0; p.commits++;
  });

  const { zoomPerfRef, stopTrackpadZoom } = camera;

  useEffect(() => stopTrackpadZoom, [stopTrackpadZoom]);

  // Stable culling compute. Reads every input from refs so it can be invoked
  // imperatively from `transform.onTransformChangeRef` (which fires on every
  // pan/zoom mutation) without waiting for settled-state debounce. RAF-coalesced
  // so multiple calls within the same frame produce at most one compute.
  const cullingRafIdRef = useRef(null);
  // Set by the callers that are allowed to SHRINK the visible set (settle, data
  // change, resize). Every other tick may only grow it — see the commit policy
  // inside runCulling. Consumed (and cleared) by the next tick that gets past
  // the early-out guards.
  const cullPruneRef = useRef(true);
  // Canvas-space region the viewport may roam inside before the last computed
  // membership stops being sufficient. It is the last cull's inner rect deflated
  // by half its own padding, so it says "everything on screen is already mounted,
  // with margin to spare" — a containment test cheap enough to run per frame in
  // place of the O(nodes + edges) pass.
  const cullGuardRectRef = useRef(null);
  // Event-driven glow update: EdgeGlowIndicator registers a callback here so it
  // can react to pan/zoom transform changes in lockstep with culling (one
  // RAF-coalesced tick per frame), without running its own free-running RAF loop.
  const glowUpdateRef = useRef(null);
  const runCulling = useCallback((...args) => runCullingPass({
    cullingRafIdRef, zoomPerfRef, glowUpdateRef, ENABLE_CULLING, nodesRef, edgesRef, visibleNodeIdsRef,
    setVisibleNodeIds, visibleEdgesRef, setVisibleEdges, viewportSizeRef, canvasSizeRef, draggingNodeInfoRef,
    isAnimatingZoomRef, panOffsetRef, zoomLevelRef, cullPruneRef, isViewMovingRef, cullGuardRectRef,
    baseDimsByIdRef, nodeByIdRef,
  }, ...args), [isViewMovingRef]); // Refs only — the one dep is a ref OBJECT, so identity stays stable forever.

  // Wire runCulling into the transform hook so pan/zoom mutations trigger culling
  // synchronously (without waiting for settled-state debounce).
  // Depend on the underlying ref object (stable across renders), NOT `transform`
  // itself (which is a fresh object literal each render).
  //
  // When culling is disabled the visible set is static w.r.t. pan/zoom, so we
  // skip runCulling on transform changes and fire only the glow update. The
  // reactive effect below still invokes runCulling on data changes.
  const onTransformChangeRef = transform.onTransformChangeRef;
  useEffect(() => {
    const base = ENABLE_CULLING ? runCulling : () => { glowUpdateRef.current?.(); };
    onTransformChangeRef.current = () => {
      // Every pan/zoom write funnels through here, whatever drove it — the one
      // place that can answer "is the view moving right now?" for touch.
      sampleViewMotion();
      base();
      // Notify fixed-position overlays that anchor to live on-screen node
      // coordinates (e.g. AbstractionCarousel). Pan/zoom write the DOM transform
      // directly and only update settledPan/settledZoom ~150ms after the
      // interaction stops, so these overlays must re-anchor off this signal to
      // track the canvas live instead of jumping once panning settles.
      if (typeof window !== 'undefined') {
        // Carries the live zoom so listeners can tell a zoom from a pan — the
        // orbit overlay holds its animation longer for zooms, since zoom
        // arrives in discrete steps and it should stay still across the whole
        // interaction rather than waking up between them. Plain Event
        // listeners are unaffected; they simply ignore the detail.
        window.dispatchEvent(new CustomEvent('canvas-transform-change', {
          detail: { zoom: zoomLevelRef.current },
        }));
      }
    };
    return () => { onTransformChangeRef.current = null; };
  }, [onTransformChangeRef, runCulling, sampleViewMotion]);

  // Tell the transform layer when NOT to drop the connection labels for a move.
  //
  // Two independent reasons to leave them up, both funnelled through the one
  // predicate the transform layer reads.
  //
  // The camera is being ANIMATED rather than driven by hand. `isAnimatingZoomRef`
  // is already exactly this signal: the drag lift's zoom-out, its restore on
  // release, and animateCanvasView (orbit fit, decompose framing) all raise it,
  // and every one of those is a short move to a target that was known before it
  // started — nothing accumulates, so there is nothing to protect against.
  //
  // Or the user has said not to, via `connectionLabelMoveFade`. 'large' reads
  // the same visible-edge count every other label budget reads, so it tracks
  // what is ON SCREEN rather than how big the universe is.
  //
  // Read through refs rather than closed over: this predicate runs on the
  // per-frame transform path, and re-assigning it on every settings change or
  // culling commit would re-run the effect far more often than the signal
  // actually changes. The count comes from `visibleEdgesRef`, which runCulling
  // writes synchronously, rather than from the settled React state — a gesture
  // that pulls a crowd of edges into view should be gated on what is on screen
  // NOW. See LABEL SUPPRESSION in useCanvasTransform.
  const moveFadeModeRef = useRef(connectionLabelMoveFade);
  moveFadeModeRef.current = connectionLabelMoveFade;

  // Does the setting want the labels faded at all right now? Shared by both
  // paths — the view-gesture predicate below and the node-drag hold after it —
  // so a drag can never fade labels the settings say to leave alone.
  const shouldFadeLabelsRef = useRef(null);
  shouldFadeLabelsRef.current = () => {
    const mode = moveFadeModeRef.current;
    if (mode === 'off') return false;
    if (mode === 'large') {
      return (visibleEdgesRef.current?.length ?? 0) >= CONNECTION_LABEL_MOVE_FADE_MIN_COUNT;
    }
    return true;
  };

  const isProgrammaticMoveRef = transform.isProgrammaticMoveRef;
  useEffect(() => {
    isProgrammaticMoveRef.current = () => {
      if (!shouldFadeLabelsRef.current()) return true;
      // The controller's aim drift is a short, bounded camera move like the
      // others here, so it gets the same exemption — but through its own flag,
      // never by borrowing isAnimatingZoomRef.
      return isAnimatingZoomRef.current === true || gamepadDriftingRef.current === true;
    };
    return () => { isProgrammaticMoveRef.current = null; };
  }, [isProgrammaticMoveRef, isAnimatingZoomRef]);

  // The label sprite bakery follows the labels themselves.
  //
  // While they are down, every millisecond it spends is spent on something that
  // is not on screen — and spent against the frame budget of the gesture that
  // put them down, since a PNG encode cannot be interrupted once begun and a
  // landed batch costs a full canvas render. When they are up it runs, which is
  // the right answer even for the exempt cases: a label visible during a move is
  // a label being drawn as <text>, which is the expensive form this replaces.
  //
  // Wired here rather than inside labelSpriteCache because that module has no
  // business knowing what a gesture is — see setBakingPaused.
  const onLabelsHiddenRef = transform.onLabelsHiddenRef;
  useEffect(() => {
    onLabelsHiddenRef.current = (hidden) => setBakingPaused(hidden);
    return () => {
      onLabelsHiddenRef.current = null;
      // Never leave the bakery paused behind an unmounting canvas.
      setBakingPaused(false);
    };
  }, [onLabelsHiddenRef]);

  // Hold the labels down for the WHOLE of a node drag, lift through restore.
  //
  // The camera-animation exemption above is right for an orbit fit or a
  // decompose framing — short moves that neither accumulate cost nor benefit
  // from shedding anything. It is wrong for the drag lift, and the reason is
  // that the lift is not the move: it is the opening of a much longer span in
  // which the user drags a node around a web whose edges all re-route under it.
  // Exempting the lift left the labels painting through that entire span, which
  // is exactly where a big web hurts.
  //
  // Held as one continuous span rather than re-derived at each end, so the
  // labels fade once on lift and return once after the drop, instead of
  // blinking at both ends of the drag.
  //
  // The release waits out the restore. `draggingNodeInfo` clears at the drop,
  // but the camera then animates back over DRAG_ZOOM_ANIMATION_DURATION — and
  // fading labels back IN over a running zoom animation is the last place there
  // is budget for it.
  //
  // Keyed on the SETTING rather than on `isAnimatingZoomRef`, which looks like
  // the more precise signal and is actually a race: the restore is kicked off
  // by the drop handler, so this effect can run in the window before the
  // animation has raised that flag, read false, and release into exactly the
  // frames it was meant to protect. Whether drag-zoom is on is knowable without
  // that timing. A timer rather than a poll — if the animation is interrupted
  // the labels return a little later, which is harmless.
  const setDragLabelsHidden = transform.setDragLabelsHidden;
  const dragZoomEnabled = dragZoomSettings.enabled;
  useEffect(() => {
    if (draggingNodeInfo) {
      setDragLabelsHidden(shouldFadeLabelsRef.current());
      return undefined;
    }
    if (!dragZoomEnabled) {
      setDragLabelsHidden(false);
      return undefined;
    }
    const id = setTimeout(() => setDragLabelsHidden(false), DRAG_ZOOM_RESTORE_HOLD_MS);
    return () => clearTimeout(id);
  }, [draggingNodeInfo, setDragLabelsHidden, dragZoomEnabled]);

  // Unmount cleanup for any in-flight culling RAF.
  useEffect(() => {
    return () => {
      if (cullingRafIdRef.current != null) {
        cancelAnimationFrame(cullingRafIdRef.current);
        cullingRafIdRef.current = null;
      }
    };
  }, []);

  // Reactive trigger: when non-transform inputs change (graph data, viewport
  // resize, drag end), schedule a culling recompute. Transform-driven updates
  // (pan, zoom) flow through onTransformChangeRef → runCulling directly and
  // bypass this effect entirely.
  //
  // These all invalidate membership in ways the containment gate can't see — a
  // node can be deleted, resized, or dropped somewhere else without the viewport
  // moving at all — so they ask for a full recompute rather than a grow-only one.
  useEffect(() => {
    cullPruneRef.current = true;
    runCulling();
  }, [nodes, edges, viewportSize, canvasSize, baseDimsById, nodeById, draggingNodeInfo, runCulling]);

  // Settle prune. The in-motion policy only ever grows the visible set, so the
  // one recompute allowed to remove has to be scheduled when the gesture stops —
  // and settledPan/settledZoom updating IS that moment (they commit SETTLE_DELAY
  // ms after the last transform mutation). Everything the gesture over-mounted
  // gets dropped here, in the same render the settle was going to cost anyway.
  useEffect(() => {
    if (!ENABLE_CULLING) return;
    cullPruneRef.current = true;
    runCulling();
  }, [panOffset, zoomLevel, runCulling]);

  // When a drag starts, discard any in-flight connection draw that leaked
  // through from the long-press → drag transition. Prevents both the phantom
  // static "black stub" line and an unintended edge-create on mouse-up.
  useEffect(() => {
    if (!draggingNodeInfo) return;
    if (drawingConnectionFrom) {
      connectionHoverTargetRef.current = null;
      setDrawingConnectionFrom(null);
    }
  }, [draggingNodeInfo, drawingConnectionFrom, setDrawingConnectionFrom]);

  // Flush anchor position updates from group rendering to the store
  // Skip during active drag to avoid double-renders per frame (positions sync when drag ends)
  useEffect(() => flushAnchorPositions({ draggingNodeInfo, anchorPositionUpdatesRef, activeGraphId, storeActions }));

  // A thing-group ANCHOR is not drawn as its stored instance box.
  //
  // It renders as the group's TITLE PILL, at the position the groups phase of
  // the JSX solves for it — which is why both renderConnectionEdge (see
  // sAnchorInfo there) and the DOM-bypass drag updater (see the sAnchor/eAnchor
  // overrides and tangentDims in useNodeDrag) substitute that box before they
  // route anything.
  //
  // The three WHOLE-GRAPH pre-passes below did not, and that asymmetry is the
  // whole of the "connections into a node-group are glitchy" behaviour: clean's
  // ports were staggered along a side of a box nobody draws, lombardi's tangent
  // fan was spaced from that box's centre, and the label crossing index built
  // its polyline from those same endpoints and then trimmed it against the
  // group's real outer bounds — so the indexed line and the drawn line were not
  // the same line, and labels dodged crossings that weren't there.
  //
  // Lombardi is the loudest of the three because its fan is a per-NODE solve:
  // one wrong box re-spaces every arc incident to that anchor, and (the same
  // two-hop reach useNodeDrag documents) its neighbours' arcs after that. Every
  // one of those labels rides its arc, so they all move with it.
  //
  // Read from the same ref the renderer reads. It is filled during the groups
  // phase, so a memo body sees the PREVIOUS commit's boxes — one render behind,
  // exactly as occluderFor below has always been, and still far closer than the
  // stored instance box, which is never right at all.
  const anchorGeometryFor = useCallback((node, dims) => {
    const info = node?.isGroupAnchor ? anchorPositionUpdatesRef.current.get(node.id) : null;
    if (!info) return { node, dims };
    return {
      node: { ...node, x: info.x, y: info.y },
      // Mirrors renderConnectionEdge exactly: the pill's box and nothing else.
      // Carrying the node's own scaledCornerRadius over would round the pill by
      // a radius taken from a different shape.
      dims: { currentWidth: info.width, currentHeight: info.height },
    };
  }, []);

  // Port-based routing with intelligent edge distribution - inspired by circuit board routing
  const prevCleanLaneOffsetsRef = useRef(new Map());
  const cleanLaneOffsets = useMemo(() => computeCleanLaneOffsets({
    anchorGeometryFor, baseDimsById, cleanLaneSpacing, draggingNodeInfo, edges, enableAutoRouting,
    nodeById, nodes, prevCleanLaneOffsetsRef, routingStyle, textSettings,
  }), [enableAutoRouting, routingStyle, edges, nodeById, baseDimsById, nodes, draggingNodeInfo, anchorGeometryFor]);

  // Mirror the port assignments into a ref for the DOM-bypass drag updater.
  useEffect(() => { cleanLaneOffsetsRef.current = cleanLaneOffsets; }, [cleanLaneOffsets]);

  // Lombardi's perfect-angular-resolution solve: every node's incident edges get
  // evenly spaced tangent directions. Like clean routing's lanes this is a
  // whole-graph pass over ALL edges (not visibleEdges) — a node's fan depends on
  // its degree, so culling a neighbour out of view must not re-space the ones
  // that remain, or the surviving arcs visibly swing as you pan.
  //
  // Unlike clean routing, the assignment is NOT frozen during a drag. The whole
  // point of the style is that the fan stays even, and a dragged node's bearings
  // change continuously; freezing it would leave the arcs anchored to directions
  // the graph no longer has. The solve is O(E log E) with tiny constants, so it
  // is affordable per drag frame from the ref below.
  const prevLombardiTangentsRef = useRef(new Map());
  const lombardiTangents = useMemo(() => {
    if (!enableAutoRouting || routingStyle !== 'lombardi' || !edges?.length) return new Map();
    if (draggingNodeInfo) return prevLombardiTangentsRef.current;
    // Substitute each thing-group anchor's title box, the same correction the
    // drag's live tangent solve makes (tangentDims in useNodeDrag) and the same
    // one renderConnectionEdge makes when it draws the arc. Without it the
    // settled fan was spaced from the anchor's stored instance box while every
    // arc was drawn from the pill — so the arcs swung on drop, and the labels
    // riding them swung with them. See anchorGeometryFor.
    let tangentNodes = nodes;
    let tangentDims = baseDimsById;
    if (anchorPositionUpdatesRef.current.size > 0) {
      tangentDims = new Map(baseDimsById);
      tangentNodes = nodes.map((n) => {
        const { node, dims } = anchorGeometryFor(n, baseDimsById.get(n.id));
        if (node === n) return n;
        tangentDims.set(n.id, dims);
        return node;
      });
    }
    const solved = computeLombardiTangents(tangentNodes, edges, tangentDims);
    prevLombardiTangentsRef.current = solved;
    return solved;
  }, [enableAutoRouting, routingStyle, nodes, edges, baseDimsById, draggingNodeInfo, anchorGeometryFor]);

  useEffect(() => { lombardiTangentsRef.current = lombardiTangents; }, [lombardiTangents]);

  // Memoize edgeCurveInfo for parallel edge detection (used by both rendering and hover detection).
  // NOTE: iterate ALL edges (not visibleEdges) so the pairIndex / totalInPair for
  // any given edge stays stable as neighboring edges pop in/out of visibility
  // during pan/zoom. Otherwise, parallel edges visibly jump lanes when a sibling
  // culls out = flicker.
  const edgeCurveInfo = useMemo(() => computeEdgeCurveInfo({ edges }), [edges]);

  // The geometry every OTHER connection is drawn with, so a label can be moved
  // off a line that would strike through it. See CONNECTIONS AS OBSTACLES in
  // edgeLabelPlacement.js for why this is worth an extra pass over the edges.
  //
  // It has to be the routed geometry, not the centre-to-centre chord: on every
  // style here the drawn line is nowhere near that chord, so testing against
  // one would reject the good positions and accept the covered ones. That means
  // re-deriving each route once outside the render — the same solve the render
  // does per edge, and cheap next to the label pass it feeds.
  //
  // Skipped above LABEL_CROSSING_BUDGET. Past a certain density a label is
  // crossed by something wherever it goes, so the pass stops buying anything
  // while still costing an index build plus ~35 queries per label.
  //
  // NOTE: iterate ALL edges, not visibleEdges — same reason as edgeCurveInfo and
  // the clean lane assignment. Keyed on the visible set this would rebuild on
  // every pan, and since a changed index re-solves every label, labels would
  // visibly reshuffle for the whole of a pan.
  const labelCrossingGenerationRef = useRef(0);
  const labelCrossingLastRef = useRef(null); // { polylines, index } of the last build
  const labelCrossingIndex = useMemo(() => computeLabelCrossingIndex({
    showConnectionNames, isRoutedStyle, edges, LABEL_CROSSING_BUDGET, anchorPositionUpdatesRef, nodeById,
    baseDimsById, anchorGeometryFor, routingStyle, manhattanBends, edgeCurveInfo, orthogonalLaneSpacing,
    cleanLaneOffsets, cleanLaneSpacing, lombardiTangents, lombardiCurvature, lombardiLaneSpacing,
    labelCrossingLastRef, labelCrossingGenerationRef,
  }), [showConnectionNames, isRoutedStyle, edges, nodeById, baseDimsById, routingStyle, manhattanBends, cleanLaneOffsets, cleanLaneSpacing, lombardiTangents, lombardiCurvature, edgeCurveInfo, orthogonalLaneSpacing, lombardiLaneSpacing, anchorGeometryFor]);

  // The obstacle set every label dodges. Identical for every edge, so build it
  // once — each placement call used to rebuild it from all visible nodes, which
  // was roughly half the cost of re-solving a large graph's labels.
  //
  // Nothing reads it when labels are off, and `visibleNodeIds` changes
  // throughout a pan — so without the guard this rebuilt a rect per visible
  // node on every culling commit for a result no one would look at.
  const labelObstacleOptions = useMemo(() => computeLabelObstacleOptions({
    showConnectionNames, isRoutedStyle, nodes, visibleNodeIds, baseDimsById, selectedInstanceIds,
    EMPTY_OBSTACLES, labelCrossingIndex,
  }), [showConnectionNames, isRoutedStyle, nodes, visibleNodeIds, baseDimsById, selectedInstanceIds, labelCrossingIndex]);

  // How coarsely to snap connection-label rotations. See CONNECTION LABEL
  // RENDERING BUDGETS above: the cost is the number of DISTINCT angles on
  // screen, not the angles themselves, so collapsing them into buckets is the
  // whole fix. Zero means "don't snap".
  //
  // Gated by ROUTING STYLE first and by count only as a backstop. Which style
  // is drawing is the better question, because the styles differ in kind and not
  // in degree: manhattan's labels are axis-aligned and snapping cannot touch
  // them, straight's mint one rotation each, and lombardi's mint one per
  // CHARACTER while curved and an arbitrary chord angle once flattened. Counting
  // labels treats all three as the same population. See
  // LABEL_ANGLE_QUANTUM_ALWAYS_STYLES.
  //
  // The bucket size itself is a constant — see LABEL_ANGLE_QUANTUM for why it
  // stopped being a function of zoom, which is the same reason this reads no
  // zoom at all now. A label's angle must not change unless its LINE changed; a
  // zoom moves the whole picture rigidly, so anything that re-rounds a label on
  // zoom is visible as the label rotating against its own stationary line.
  //
  // Also deliberately does NOT vary with whether the view is moving.
  //
  // It used to: a gesture took the coarsest bucket and released it on settle, on
  // the theory that in-motion tilt precision is invisible. The theory was fine
  // and the delivery was not. "Is the view moving" had to be React state for the
  // memo to read it, so each gesture flipped it twice, and each flip re-rendered
  // the whole canvas — re-solving every route and every label placement. On the
  // real universe that single re-render measured 143ms with labels on against a
  // 15ms worst frame with them off. Two of those per gesture is the stutter it
  // was supposed to prevent, and it bought nothing measurable: sweeping the
  // scale over a real graph costs the same 8.3ms/frame at exact angles as at 9°.
  //
  // Plain arithmetic rather than a useMemo: it is two comparisons, and the
  // result is a NUMBER, so the useCallback below re-uses its dependency
  // identity whenever the value is unchanged just as a memo would. Recomputing
  // it every render is also what keeps the window overrides live — a memo keyed
  // on the count alone could never see them change.
  const labelAngleQuantum = (() => {
    const rawQuantum = (typeof window !== 'undefined') ? Number(window.__labelAngleQuantum) : NaN;
    const quantum = (Number.isFinite(rawQuantum) && rawQuantum >= 0) ? rawQuantum : LABEL_ANGLE_QUANTUM;

    const style = isRoutedStyle ? routingStyle : 'straight';
    if (LABEL_ANGLE_QUANTUM_ALWAYS_STYLES.has(style)) return quantum;

    const rawMin = (typeof window !== 'undefined') ? Number(window.__labelAngleMinCount) : NaN;
    const minCount = (Number.isFinite(rawMin) && rawMin >= 0) ? rawMin : LABEL_ANGLE_QUANTUM_MIN_COUNT;
    return visibleEdges.length <= minCount ? 0 : quantum;
  })();

  const quantizeLabelAngle = useCallback(
    (degrees) => quantizeAngle(degrees, labelAngleQuantum),
    [labelAngleQuantum]
  );

  // Ref declared with the other drag refs above — useNodeDrag is called long
  // before this point and takes it as an argument, so declaring it here would
  // be a temporal dead zone. Only the sync lives here, next to the memo.
  useEffect(() => { labelAngleQuantumRef.current = labelAngleQuantum; }, [labelAngleQuantum]);

  // A curved Lombardi label costs more than a straight one even now that the
  // glyphs are placed by hand rather than by a <textPath>: every character gets
  // its own rotation and paints as its own item, so ONE curved label is worth
  // roughly its character count in straight ones.
  //
  // Two bounds share that load. The bow threshold (labelCurveMinBow, reading
  // SETTLED zoom) sheds the curves the current zoom has compressed below
  // visibility — which at fit-the-graph zoom on a large network is most of
  // them, and is what keeps that view affordable. The count budget below is
  // the backstop for pathological graphs where visible bends alone are legion.
  const curveLabels = visibleEdges.length <= CURVED_LABEL_BUDGET;
  const labelArcMinBow = labelCurveMinBow(zoomLevel);
  // The same question one level down, for the CONNECTION rather than its label:
  // below this a lombardi arc is not an arc, it is a line, and every stage after
  // routing treats it as one.
  const lombardiMinBow = connectionCurveMinBow(zoomLevel);
  // Curved labels get their OWN rotation bucket rather than the canvas-wide
  // one, which is zero at every edge count where curving happens — see
  // CURVED_GLYPH_ANGLE_QUANTUM. This is what makes curves affordable at all.
  const curvedLabelQuantum = curvedGlyphQuantum(labelAngleQuantum);

  // Connection labels carry a stroked halo so they stay legible over the lines
  // they sit on. It may also be expensive out of proportion to how it looks:
  // the browser's fast path for text is a cached per-glyph alpha mask, and
  // STROKED text generally can't use it — each glyph is converted to a path and
  // rasterised outline-first, every paint, with nothing to reuse. If that's
  // what's happening, the halo is not "one extra draw", it is what keeps these
  // labels off the cached path altogether.
  //
  // `window.__labelHalo = false` drops it so the difference can be measured on
  // a real graph rather than argued about. Nudge the zoom afterwards to force a
  // re-render. Not wired to a setting — this is a probe, not a preference.
  const labelHaloEnabled = typeof window === 'undefined' || window.__labelHalo !== false;

  // The outer ring alone, separately switchable, because `__labelHalo` kills
  // both layers and so cannot answer "what does the RING cost" — the question
  // that matters now that the ring is a second stroked <text> per label at 2.1x
  // the halo's stroke width. Set `window.__labelRing = false` and sweep the
  // zoom to price it against a real graph.
  //
  // Note this is the SETTLED state only. Every label, ring included, is also
  // dropped for the duration of a pan or zoom gesture — which is where it
  // actually hurts, and which needs no re-render to do. See CONNECTION LABELS
  // WHILE THE VIEW MOVES in NodeCanvas.css.
  const labelRingEnabled = typeof window === 'undefined' || window.__labelRing !== false;

  // Draw straight labels as pre-rasterised bitmaps instead of two stroked
  // rotated <text> elements — see labelSpriteCache.js for why this is the fix
  // rather than a tuning of the strokes. Off returns them to <text>, which is
  // crisper between zoom buckets at the per-frame cost the sprites exist to
  // avoid. `window.__labelSprites = false` forces the same fallback regardless
  // of the setting, so an A/B on a real graph needs no trip through Settings.
  const labelSpritesEnabled = connectionLabelSprites
    && (typeof window === 'undefined' || window.__labelSprites !== false);

  // Which resolution to bake at. Read from SETTLED zoom, so a gesture never
  // re-rasterises anything, and bucketed to powers of two so an ordinary zoom
  // reuses the sprites it already has — a bucket change means re-encoding every
  // label on screen, which has to be rare rather than merely cheap. Labels are
  // hidden while the view moves and fade back in on settle, so the rare change
  // lands while they are off screen and the fade covers it.
  const labelSpriteScale = spriteScaleForZoom(zoomLevel);

  // Re-render when a batch of sprites finishes baking, so the labels that were
  // held back can appear. The value is READ and travels in edgeRenderCtx — see
  // the note on labelFontVersion below for why discarding it becomes a silent
  // correctness bug the moment per-edge caching exists.
  const [labelSpriteVersion, bumpSpriteVersion] = useState(0);
  useEffect(() => onSpritesReady(() => bumpSpriteVersion((v) => v + 1)), []);

  // Read last session's sprites back in. The same ready signal a finished bake
  // sends brings them on screen, so nothing here waits on it.
  useEffect(() => { hydrateLabelSprites(); }, []);

  // Reset the label caches when the routing configuration changes.
  //
  // Correctness no longer depends on this: each cached placement now carries a
  // signature of the geometry it was computed from, so a stale entry is
  // detected at read time rather than needing to be cleared ahead of one. That
  // matters because this effect runs AFTER the render it was meant to protect,
  // and nothing necessarily re-renders afterwards — which is exactly how labels
  // ended up frozen in a routing mode the user had already left.
  //
  // What's still worth doing here: dropping entries wholesale on a mode change
  // (they can never match again) and resetting the stabilization deadband, so a
  // legitimate jump to a new routing isn't mistaken for jitter.
  useEffect(() => {
    placedLabelsRef.current.clear();
    clearLabelStabilization();
  }, [enableAutoRouting, routingStyle, manhattanBends, cleanLaneSpacing, lombardiCurvature, showConnectionNames, connectionLabelSize, connectionLabelTruncate, textSettings?.fontSize]);

  // Re-render once the label font actually arrives.
  //
  // A curved label's glyph positions come from per-character advances, and those
  // can only be measured against a font the browser has finished loading. Labels
  // that render first fall back to unmeasured bucket widths (see
  // edgeLabelGlyphAdvances) — close, but not what the text will actually be
  // drawn at. Without this, that first approximation is permanent: nothing else
  // re-renders an edge on its own, so the labels present at startup stayed
  // slightly off while any label drawn later was correct, and nudging a node was
  // the only way to fix one. getNodeDimensions has carried the same listener for
  // node text for exactly this reason (see utils.js).
  // READ THIS VALUE — do not go back to discarding it.
  //
  // It used to be write-only, on the reasoning that "edges are rendered inline
  // with no memo of their own, so a commit is all that's needed to re-solve
  // every label". That was true while every commit re-solved everything. The
  // moment any per-edge caching exists it stops being true, and the failure is
  // silent: a label cached in its <text> form never upgrades to the sprite that
  // has since baked, and placements solved against estimated widths never
  // re-solve once the real font arrives. Nothing throws; the labels just stay
  // subtly wrong forever. So the counter travels in edgeRenderCtx, and any
  // per-edge memo (P3.06) must re-render on it.
  const [labelFontVersion, bumpLabelFontVersion] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      // The placements were solved against the estimated widths; they have to go
      // too, or the labels re-render at correct sizes into stale positions.
      placedLabelsRef.current.clear();
      clearLabelStabilization();
      // Sprites are deliberately NOT cleared here.
      //
      // The worry was that a sprite baked before the font arrived would hold the
      // wrong face permanently, a bitmap being unable to fix itself the way a
      // <text> does. But both bakers refuse outright until EmOne is loadable, so
      // there is nothing to clear — and clearing anyway is now actively harmful:
      // it races the hydration that reads last session's sprites back in, and
      // whichever lands second wins. Losing that race means re-baking a set that
      // was already correct and already on disk.
      //
      // If the label font itself ever changes, that is a rendering change and
      // belongs to SCHEMA in labelSpriteStore.js, which invalidates every
      // persisted sprite at once.
      bumpLabelFontVersion((v) => v + 1);
    });
    return () => { cancelled = true; };
  }, []);

  // Every label's position depends on where the OTHER labels landed —
  // chooseRoutedLabelPlacement dodges the rects already in placedLabelsRef. So
  // renaming one connection (or retyping it, which renames it) invalidates the
  // placement of every label near it, while only that one edge's own cache
  // signature changes. The rest keep dodging a rect that no longer exists at
  // that size, and stay wrong until something else clears the cache — which is
  // why nudging a node "fixed" it.
  //
  // Signature over the displayed names, so a prototype rename counts too: it
  // changes no edge record at all, only what those edges render as.
  const connectionNameSignature = useMemo(() => {
    let signature = '';
    for (const edge of edges) {
      let name = '';
      if (edge.definitionNodeIds?.length > 0) {
        name = nodePrototypesMap.get(edge.definitionNodeIds[0])?.name || '';
      } else if (edge.typeNodeId) {
        name = edgePrototypesMap.get(edge.typeNodeId)?.name || '';
      }
      signature += `${edge.id}:${name || edge.connectionName || ''}|`;
    }
    return signature;
  }, [edges, nodePrototypesMap, edgePrototypesMap]);

  useEffect(() => {
    placedLabelsRef.current.clear();
    clearLabelStabilization();
  }, [connectionNameSignature]);

  // Anchor point for the edge pie menu.
  //
  // This used to be the plain center-to-center chord midpoint with the chord's
  // angle, so on any non-straight connection the menu opened somewhere the
  // connection doesn't actually pass through — beside a Manhattan route, inside
  // the bow of a curved one. Anchor it to the same place the connection's LABEL
  // goes instead: that's already the "you are looking here" point on the edge,
  // and it means the menu and the label agree by construction in every mode.
  const selectedEdgeMidpoint = useMemo(() => computeSelectedEdgeMidpoint({
    selectedEdgeId, selectedEdgeIds, edgesMap, nodeById, baseDimsById, edgeCurveInfo, enableAutoRouting,
    routingStyle, manhattanBends, orthogonalLaneSpacing, cleanLaneOffsets, cleanLaneSpacing, lombardiTangents,
    lombardiCurvature, selectedInstanceIds, lombardiLaneSpacing, connectionWidth, lombardiMinBow, curveSpacing,
  }), [selectedEdgeId, selectedEdgeIds, edgesMap, nodeById, baseDimsById, selectedInstanceIds, enableAutoRouting, routingStyle, manhattanBends, cleanLaneOffsets, cleanLaneSpacing, lombardiTangents, lombardiCurvature, edgeCurveInfo, curveSpacing, orthogonalLaneSpacing, lombardiLaneSpacing, connectionWidth]);

  // Reverse-index: instanceId → Set<edgeId> for O(1) lookup of edges connected to a node.
  // NOTE: iterate ALL edges (not visibleEdges) so the index stays stable across culling
  // changes — otherwise drag start misses connections whose sibling edges just culled out,
  // leaving a subset of a node's edges frozen during drag. Same pattern as edgeCurveInfo above.
  const edgesByNodeId = useMemo(() => {
    const map = new Map();
    edges.forEach(edge => {
      if (!map.has(edge.sourceId)) map.set(edge.sourceId, new Set());
      if (!map.has(edge.destinationId)) map.set(edge.destinationId, new Set());
      map.get(edge.sourceId).add(edge.id);
      map.get(edge.destinationId).add(edge.id);
    });
    return map;
  }, [edges]);

  // Refs for DOM-bypass drag: sync latest values (refs declared earlier, before useNodeDrag)
  useEffect(() => { nodeByIdRef.current = nodeById; }, [nodeById]);
  useEffect(() => { baseDimsByIdRef.current = baseDimsById; }, [baseDimsById]);
  useEffect(() => { edgeCurveInfoRef.current = edgeCurveInfo; }, [edgeCurveInfo]);
  useEffect(() => { edgesByNodeIdRef.current = edgesByNodeId; }, [edgesByNodeId]);
  // visibleNodeIdsRef / visibleEdgesRef are owned exclusively by runCulling() —
  // it writes them synchronously at the end of each RAF tick. Syncing from
  // React state via passive useEffect here would race: a commit for frame N
  // can fire its passive effect AFTER runCulling() has already advanced the
  // ref to frame N+1, clobbering the newer value with a stale one and
  // breaking hysteresis on the next tick (cause of whole-graph flicker
  // during zoom on large graphs).
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // Owned by debugConfig rather than by this component: the switch now lives in
  // the Settings modal, which is nowhere near here.
  const [debugMode, setDebugMode] = useState(() => debugConfig.isDebugOverlayEnabled());
  useEffect(() => {
    const unsubscribe = debugConfig.addListener((config) => setDebugMode(!!config.showDebugOverlay));
    setDebugMode(debugConfig.isDebugOverlayEnabled());
    return unsubscribe;
  }, []);

  const [isViewReady, setIsViewReady] = useState(false);

  const [plusSign, setPlusSign] = useState(null);
  const [videoAnimation, setVideoAnimation] = useState(null); // Y-key video animation state
  const nodeNamePrompt = useCanvasUIStore(s => s.nodeNamePrompt), setNodeNamePrompt = useCanvasUIStore(s => s.setNodeNamePrompt);
  const connectionNamePrompt = useCanvasUIStore(s => s.connectionNamePrompt), setConnectionNamePrompt = useCanvasUIStore(s => s.setConnectionNamePrompt);
  // Tracks the last one-shot edge-label suggestion so we can (a) pre-fill it only
  // while the field is untouched, and (b) log whether the user accepted/edited/ignored it.
  const connectionSuggestionRef = useRef(null); // { edgeId, suggestion, callId }
  const abstractionSuggestionRef = useRef(null); // { nodeId, direction, suggestion, callId, applied }
  const abstractionPrompt = useCanvasUIStore(s => s.abstractionPrompt), setAbstractionPrompt = useCanvasUIStore(s => s.setAbstractionPrompt);
  const nodeGroupPrompt = useCanvasUIStore(s => s.nodeGroupPrompt), setNodeGroupPrompt = useCanvasUIStore(s => s.setNodeGroupPrompt);

  /**
   * "Create New Thing" — the selector that opens a new Web by settling what
   * defines it.
   *
   * A Web is never anonymous: `createNewGraph` always mints a prototype to
   * define it, and every one of these entry points used to mint it named "New
   * Thing" in the default colour, leaving the user to rename a Web they had
   * already decided on. Naming the Web IS naming its defining Thing, so this
   * asks once, up front — and because the grid half of the selector is right
   * there, it can also hand the job to a Thing that already exists, which the
   * old path had no way to express at all.
   *
   * Four entry points share it: the header's +, the empty-canvas +, the Open
   * Things panel's + (via the window event below, the same route the merge
   * modal takes out of the panels), and Cmd/Ctrl+N.
   */
  const newWebPrompt = useCanvasUIStore(s => s.newWebPrompt), setNewWebPrompt = useCanvasUIStore(s => s.setNewWebPrompt);
  const openNewWebPrompt = useCallback(() => setNewWebPrompt({ visible: true }), []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => setNewWebPrompt({ visible: true });
    window.addEventListener('redstring:new-web', handler);
    return () => window.removeEventListener('redstring:new-web', handler);
  }, []);

  // Add logging for abstraction prompt state changes

  // Attach an accepted/edited/ignored outcome to the last edge-label suggestion.
  const finalizeConnectionSuggestion = useCallback((finalName) => {
    const s = connectionSuggestionRef.current;
    connectionSuggestionRef.current = null;
    if (!s || !s.callId) return;
    if (!s.applied) { attachOneShotOutcome(s.callId, 'ignored'); return; }
    const f = (finalName || '').trim().toLowerCase();
    const sug = (s.suggestion || '').trim().toLowerCase();
    attachOneShotOutcome(s.callId, f && f === sug ? 'accepted' : 'edited');
  }, []);

  // C4 — one-shot arrow direction. When the user confirms a verb-phrase
  // connection label, ask the model (in the background) which way the arrow
  // should point and pre-set it — but ONLY if the edge has no direction yet, and
  // re-check inside the store write so a late suggestion never overrides a
  // direction the user set in the meantime. No model → nothing happens.
  const suggestEdgeArrowDirection = useCallback((...args) => suggestEdgeArrowDirectionWith({
    edgesMap, nodeById, storeActions,
  }, ...args), [edgesMap, nodeById, storeActions]);

  // One-shot edge-label suggestion: when the connection prompt opens on an
  // untouched field, ask the configured model (in the background) for a short
  // verb-phrase label from source→target and pre-fill it as a suggestion the
  // user can overwrite. No model / timeout / malformed → nothing happens and the
  // field stays blank (identical to today).
  useEffect(() => suggestConnectionName({
    connectionNamePrompt, edgesMap, nodeById, nodePrototypesMap, connectionSuggestionRef,
    setConnectionNamePrompt,
  }), [connectionNamePrompt.visible, connectionNamePrompt.edgeId, edgesMap, nodeById, nodePrototypesMap]);

  // C6 — Attach an accepted/edited/ignored outcome to the last abstraction-name suggestion.
  const finalizeAbstractionSuggestion = useCallback((finalName) => {
    const s = abstractionSuggestionRef.current;
    abstractionSuggestionRef.current = null;
    if (!s || !s.callId) return;
    if (!s.applied) { attachOneShotOutcome(s.callId, 'ignored'); return; }
    const f = (finalName || '').trim().toLowerCase();
    const sug = (s.suggestion || '').trim().toLowerCase();
    attachOneShotOutcome(s.callId, f && f === sug ? 'accepted' : 'edited');
  }, []);

  // C6 — Abstraction-axis name suggestion. When the add-above/below prompt opens
  // on an untouched field, ask the model (background) for the name one rung
  // more general / more specific and pre-fill it. NOTE: in this app "above" =
  // MORE SPECIFIC and "below" = MORE GENERAL (see the prompt subtitle), which is
  // the opposite of the usual convention — so we pass moreGeneral accordingly.
  // No model / timeout / malformed → field stays blank (identical to today).
  useEffect(() => fillAbstractionNameSuggestion({
    abstractionPrompt, nodePrototypesMap, abstractionSuggestionRef, setAbstractionPrompt,
  }), [abstractionPrompt.visible, abstractionPrompt.nodeId, abstractionPrompt.direction, nodePrototypesMap]);

  // Dialog color picker state
  const [dialogColorPickerVisible, setDialogColorPickerVisible] = useState(false);
  const [dialogColorPickerPosition, setDialogColorPickerPosition] = useState({ x: 0, y: 0 });
  const [colorPickerTarget, setColorPickerTarget] = useState(null); // { type: 'node_prompt' | 'connection_prompt' | 'group', id: string }

  // Add to group dialog state
  const [addToGroupDialog, setAddToGroupDialog] = useState(null); // { nodeId, groupId, groupName, isNodeGroup, position }

  // Ask The Wizard intent picker. One piece of state for every entry point —
  // Connection, Thing, Web and abstraction ladder all open the same modal, which
  // asks WHAT you want to ask rather than merely where the answer should land.
  // { surface, facts, subjectLabel, payload }
  const [askWizardPicker, setAskWizardPicker] = useState(null);
  // Where the next ask goes. Sticky rather than a per-element tri-state with an
  // "ask me" option: the modal always opens now, so there is nothing left for an
  // "ask me" setting to trigger.
  const [wizardDestination, setWizardDestinationState] = useState(() => {
    try { return debugConfig.getWizardDestination(); } catch { return 'new'; }
  });
  const chooseWizardDestination = useCallback((value) => {
    setWizardDestinationState(value);
    try { debugConfig.setWizardDestination(value); } catch { }
  }, []);
  const [wizardEnabled, setWizardEnabled] = useState(() => {
    try { return debugConfig.isWizardEnabled(); } catch { return false; }
  });
  useEffect(() => {
    const handler = (newConfig) => {
      setWizardEnabled(!!newConfig?.enableWizard);
    };
    const unsubscribe = debugConfig.addListener(handler);
    return unsubscribe;
  }, []);

  // Gate for every "Ask The Wizard" entry point: if no AI API key is configured,
  // open Settings directly to the AI & API Keys section instead of invoking the wizard.
  // Returns true if a key exists (caller may proceed), false if it opened settings.
  const ensureWizardApiKey = useCallback(async () => {
    try {
      if (await apiKeyManager.hasAPIKey()) return true;
    } catch (err) {
      console.error('[NodeCanvas] API key check failed:', err);
    }
    try {
      window.dispatchEvent(new CustomEvent('openSettingsModal', { detail: { section: 'ai' } }));
    } catch { }
    return false;
  }, []);

  // Shared helper used by both wizard prompts to emit an "About this graph" block.
  // Returns an array of lines (already prefixed with bullets) — caller handles surrounding header/blank lines.
  // The prompt builders live in src/wizard/prompts/. They were always pure over
  // useGraphStore.getState() — none of them closed over anything in this component,
  // which is why each declared an empty dependency array — so what remains here is
  // only the part that genuinely belongs to the canvas: the API-key gate, opening
  // the AI panel, and clearing whatever selection the ask consumed.
  const openWizardAsk = useCallback(async (build, { newConversation, afterSend, toolPolicy } = {}) => {
    if (!(await ensureWizardApiKey())) return;
    // Build BEFORE opening the panel. Three of the four openers used to do this the
    // other way round, which left the panel expanded over nothing when a builder
    // bailed on missing state.
    const built = build();
    if (!built || !built.message) return;
    try {
      storeActions.setLeftPanelExpanded(true);
    } catch { }
    openLeftPanelView('ai');
    sendWizardAsk(built, { newConversation, toolPolicy });
    afterSend?.();
  }, [ensureWizardApiKey, storeActions]);

  const openWizardWithPrompt = useCallback(async (edges, { newConversation }) => {
    if (!edges || edges.length === 0) return;
    await openWizardAsk(
      () => buildWizardConnectionPrompt(edges, {
        includeInstructions: resolveIncludeInstructions('refine-connections', newConversation)
      }),
      {
        newConversation,
        afterSend: () => {
          try {
            storeActions.setSelectedEdgeId(null);
            storeActions.setSelectedEdgeIds(new Set());
          } catch { }
        }
      }
    );
  }, [openWizardAsk, storeActions]);

  const openNodeWizardWithPrompt = useCallback(async (prototype, { newConversation }) => {
    if (!prototype) return;
    await openWizardAsk(
      () => buildWizardNodeDefinitionPrompt(prototype, {
        includeInstructions: resolveIncludeInstructions('define-node', newConversation)
      }),
      { newConversation, afterSend: () => setSelectedInstanceIds(new Set()) }
    );
  }, [openWizardAsk]);

  const openAbstractionWizardWithPrompt = useCallback(async (prototype, dimension, { newConversation }) => {
    if (!prototype || !dimension) return;
    await openWizardAsk(
      () => buildWizardAbstractionPrompt(prototype, dimension, {
        includeInstructions: resolveIncludeInstructions('refine-abstraction', newConversation)
      }),
      { newConversation }
    );
  }, [openWizardAsk]);

  const openGrowGraphWizardWithPrompt = useCallback(async ({ newConversation }) => {
    if (!useGraphStore.getState().activeGraphId) return;
    await openWizardAsk(
      () => buildWizardGrowGraphPrompt({
        includeInstructions: resolveIncludeInstructions('grow-graph', newConversation)
      }),
      { newConversation }
    );
  }, [openWizardAsk]);

  // Run whichever intent the picker settled on.
  //
  // Routing is by intent id, not by surface: a Thing has five different asks and
  // they are not interchangeable. The four original openers keep their own paths
  // because they carry per-ask side effects (clearing the selection) and the
  // full/short instruction dedupe; everything else goes through one branch.
  const runWizardIntent = useCallback((a0) => dispatchWizardIntent(a0, {
    openAbstractionWizardWithPrompt, openGrowGraphWizardWithPrompt, openNodeWizardWithPrompt, openWizardAsk, openWizardWithPrompt,
  }), [
    openWizardWithPrompt, openNodeWizardWithPrompt,
    openAbstractionWizardWithPrompt, openGrowGraphWizardWithPrompt, openWizardAsk
  ]);

  // The single entry point every Ask The Wizard button now goes through.
  //
  // Opens the picker — except on a surface with only one thing to ask, where a
  // picker would be a confirm dialog wearing a costume. That is the abstraction
  // ladder today, and the rule maintains itself: give the ladder a second ask and
  // its picker reappears without anything here changing.
  const openWizardPicker = useCallback((surface, payload, { facts, subjectLabel }) => {
    if (shouldSkipPicker(surface, facts)) {
      const intent = defaultIntentForSurface(surface, facts);
      if (intent) runWizardIntent({ intent, destination: wizardDestination, payload });
      return;
    }
    setAskWizardPicker({ surface, facts, subjectLabel, payload });
  }, [runWizardIntent, wizardDestination]);

  // "Ask The Wizard" on a Thing, dispatched from the right panel and the pie menu.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e) => {
      const protoId = e?.detail?.prototypeId;
      if (!protoId) return;
      const proto = useGraphStore.getState().nodePrototypes.get(protoId);
      if (!proto) {
        console.error('[NodeCanvas] rs-ask-wizard-define-node: prototype not found:', protoId);
        return;
      }
      openWizardPicker(WIZARD_SURFACES.THING, { prototype: proto }, {
        facts: thingFacts(proto),
        subjectLabel: `"${proto.name || 'this Thing'}"`
      });
    };
    window.addEventListener('rs-ask-wizard-define-node', handler);
    return () => window.removeEventListener('rs-ask-wizard-define-node', handler);
  }, [openWizardPicker]);

  // "Ask The Wizard" from the abstraction carousel. This surface has a single
  // intent, so openWizardPicker fires it directly and no modal ever appears.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e) => {
      const protoId = e?.detail?.prototypeId;
      const dimension = e?.detail?.dimension;
      if (!protoId || !dimension) return;
      const proto = useGraphStore.getState().nodePrototypes.get(protoId);
      if (!proto) {
        console.error('[NodeCanvas] rs-ask-wizard-abstraction: prototype not found:', protoId);
        return;
      }
      openWizardPicker(WIZARD_SURFACES.LADDER, { prototype: proto, dimension }, {
        facts: ladderFacts(proto, dimension),
        subjectLabel: `"${proto.name || 'this Thing'}" · ${dimension}`
      });
    };
    window.addEventListener('rs-ask-wizard-abstraction', handler);
    return () => window.removeEventListener('rs-ask-wizard-abstraction', handler);
  }, [openWizardPicker]);

  // Pie menu color picker state
  const [pieMenuColorPickerVisible, setPieMenuColorPickerVisible] = useTrackedState(false);
  const [pieMenuColorPickerPosition, setPieMenuColorPickerPosition] = useState({ x: 0, y: 0 });
  const [activePieMenuColorNodeId, setActivePieMenuColorNodeId] = useTrackedState(null);
  // Connection color picker. Kept separate from the node one above because it
  // targets a prototype directly: a connection has no instance to look a
  // prototypeId up from, it just points at the Thing that defines it.
  const [edgeColorPickerVisible, setEdgeColorPickerVisible] = useState(false);
  const [edgeColorPickerPosition, setEdgeColorPickerPosition] = useState({ x: 0, y: 0 });
  const [activeEdgeColorPrototypeId, setActiveEdgeColorPrototypeId] = useState(null);
  // Pie-menu "Swap": UnifiedSelector prompt to re-point this instance at an existing
  // prototype or a brand-new Thing.
  const swapPrompt = useCanvasUIStore(s => s.swapPrompt), setSwapPrompt = useCanvasUIStore(s => s.setSwapPrompt);

  // Carousel PieMenu stage state
  const carouselPieMenuStage = useCanvasUIStore(s => s.carouselPieMenuStage), setCarouselPieMenuStage = useCanvasUIStore(s => s.setCarouselPieMenuStage); // 1 = main stage, 2 = position selection stage
  const setIsCarouselStageTransition = useCanvasUIStore(s => s.setIsCarouselStageTransition); // Flag to track internal stage transitions
  // Request for AbstractionCarousel to move focus relative to current (up/down)
  const [carouselRelativeMoveRequest, setCarouselRelativeMoveRequest] = useState(null); // 'up' | 'down' | null
  // Request for AbstractionCarousel to focus a specific prototype by id (e.g. a freshly added layer)
  const [carouselFocusPrototypeRequest, setCarouselFocusPrototypeRequest] = useState(null); // prototypeId | null

  // Add logging for carousel stage changes

  const isHeaderEditing = useCanvasUIStore(s => s.isHeaderEditing);
  const isPieMenuRendered = useCanvasUIStore(s => s.isPieMenuRendered), setIsPieMenuRendered = useCanvasUIStore(s => s.setIsPieMenuRendered); // Controls if PieMenu is in DOM for animation
  // { node, buttons, nodeDimensions } is read by NodePieMenuLayer; NodeCanvas reads only the target (P5.04a).
  const currentPieMenuNodeId = useCanvasUIStore(s => s.currentPieMenuData?.node?.id ?? null);
  const hasPieMenuData = useCanvasUIStore(s => s.currentPieMenuData != null), setCurrentPieMenuData = useCanvasUIStore(s => s.setCurrentPieMenuData);
  // 0 = primary node options, 1 = secondary options (Duplicate / Ask The Wizard / Change Size).
  // In canvasUIStore: the pie machine resets it to 0 whenever the target changes.
  const pieMenuPage = useCanvasUIStore(s => s.pieMenuPage), setPieMenuPage = useCanvasUIStore(s => s.setPieMenuPage);
  const setEditingNodeIdOnCanvas = useCanvasUIStore(s => s.setEditingNodeIdOnCanvas); // For panel-less editing
  const [editingGroupId, setEditingGroupId] = useState(null); // For group inline editing
  const [tempGroupName, setTempGroupName] = useState(''); // Temporary name during editing
  const groupEditInputRef = useRef(null); // The inline rename <input>, for touch outside-tap dismissal

  // While renaming a group, a touch outside the input must commit + close the edit.
  // On touch, the canvas tap handler calls preventDefault(), which suppresses the
  // native focus change that would otherwise blur the input — so onBlur never fires
  // and the edit stays open. Blur it explicitly here (which runs the onBlur commit).
  useEffect(() => {
    if (!editingGroupId) return;
    const dismissOnOutsideTouch = (e) => {
      const input = groupEditInputRef.current;
      if (!input) return;
      if (e.target === input || input.contains?.(e.target)) return;
      input.blur();
    };
    // Capture phase so we still see the tap even if a child stops propagation.
    document.addEventListener('touchstart', dismissOnOutsideTouch, true);
    return () => document.removeEventListener('touchstart', dismissOnOutsideTouch, true);
  }, [editingGroupId]);
  // The connection under the pointer lives in canvasUIStore (P3.06a), so a hover
  // change re-renders only EdgeLayer. Handlers read it at event time, which also
  // lets click selection pick the nearest of several overlapping connections
  // (matching the hover highlight) rather than whichever hitbox is on top.
  const setHoveredEdgeInfo = useCanvasUIStore.getState().setHoveredEdgeInfo;

  // Currently-visible connection endpoint "orbs" (the arrow-direction toggles that
  // appear on a hovered/selected connection). Populated fresh each render by the
  // edge-render blocks with each orb's SVG-space center + radius so touch input can
  // hit-test them BEFORE the node/canvas handlers claim the tap. Nodes paint on top
  // of edges, so without this an orb sitting over a node border loses the touch to
  // the node; this ref lets the touch layer give orbs priority. Entries:
  // { cx, cy, r, edgeId, nodeId }.
  //
  // Keyed by edge id (Map<edgeId, orb[]>) rather than a flat list: a flat list
  // is only correct while every edge is guaranteed to run on every pass, and a
  // memoized edge (P3.06) removes that guarantee. See renderConnectionEdge.
  const connectionOrbHitsRef = useRef(new Map());

  // The orb map is written by edges that RUN, so an edge that leaves the visible
  // set (culled, or deleted) leaves its last entry behind. It isn't load-bearing
  // enough to justify work during render, so it is swept here, after the commit
  // that changed the visible set.
  useEffect(() => {
    const live = new Set(visibleEdges.map(e => e.id));
    for (const id of connectionOrbHitsRef.current.keys()) {
      if (!live.has(id)) connectionOrbHitsRef.current.delete(id);
    }
  }, [visibleEdges]);

  // Timestamp of the last touch-driven orb toggle. React's touch listeners are
  // passive, so we can't preventDefault the synthesized click that follows a tap —
  // it would re-fire the orb's onClick (handleArrowClick) and undo the toggle. Any
  // handleArrowClick within this window of a touch toggle is that echo and is ignored.
  const orbToggleEchoRef = useRef(0);

  // Hit-test a client-space point against the visible connection orbs. `padding`
  // scales each orb's drawn radius — see nearestConnectionOrb.
  const findConnectionOrbAtPoint = useCallback((clientX, clientY, padding = 1) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const { x: px, y: py } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
    return nearestConnectionOrb(connectionOrbHitsRef.current, px, py, padding);
  }, [containerRef, panOffsetRef, zoomLevelRef, canvasSize]);

  // Flip the arrow at one end of a connection (mirrors handleArrowClick, which
  // is the same toggle reached by clicking the orb with a mouse).
  const toggleConnectionOrbArrow = useCallback((orb) => {
    if (!orb) return;
    haptic('directionToggle');
    storeActions.updateEdge(orb.edgeId, (draft) => {
      if (!draft.directionality) draft.directionality = { arrowsToward: new Set() };
      if (!draft.directionality.arrowsToward) draft.directionality.arrowsToward = new Set();
      if (draft.directionality.arrowsToward.has(orb.nodeId)) {
        draft.directionality.arrowsToward.delete(orb.nodeId);
      } else {
        draft.directionality.arrowsToward.add(orb.nodeId);
      }
    });
  }, [storeActions]);

  // The touch path: hit-test, and on a hit toggle that end's arrow. Returns true
  // if a toggle happened so the touch layer can swallow the gesture and skip node
  // selection / canvas deselection.
  const tryToggleConnectionOrbAtPoint = useCallback((clientX, clientY) => {
    const orb = findConnectionOrbAtPoint(clientX, clientY, ORB_HIT_PADDING_TOUCH);
    if (!orb) return false;
    // Only the touch path arms the echo guard: it is there for the synthesized
    // click that follows a tap, which no other input produces.
    orbToggleEchoRef.current = performance.now();
    toggleConnectionOrbArrow(orb);
    return true;
  }, [findConnectionOrbAtPoint, toggleConnectionOrbArrow]);

  // Hover vision aid state lives in canvasUIStore and HoverVisionAidLayer reads
  // it (P2.13); NodeCanvas only writes it, so it doesn't render for it.
  const { setActivePieMenuItemForVision } = useCanvasUIStore.getState();

  // Hover intent: which canvas target counts as hovered, after a short dwell (P2.13).
  const { commitHoverTarget, clearHoverImmediate, hoverStickyEdgeId } = useHoverIntent({ setHoveredEdgeInfo, semanticOrbitActiveRef });

  const clearVisionAid = useCallback(() => {
    clearHoverImmediate();
    setActivePieMenuItemForVision(null);
  }, [clearHoverImmediate]);

  // Button hover reports to the vision aid through a stable module function (P2.13).
  const handlePieMenuHoverChange = setActionHover;

  // Connection control panel animation state

  // New states for PieMenu transition
  const selectedNodeIdForPieMenu = useCanvasUIStore(s => s.selectedNodeIdForPieMenu), setSelectedNodeIdForPieMenu = useCanvasUIStore(s => s.setSelectedNodeIdForPieMenu);
  const isTransitioningPieMenu = useCanvasUIStore(s => s.isTransitioningPieMenu), setIsTransitioningPieMenu = useCanvasUIStore(s => s.setIsTransitioningPieMenu);
  // Ghost rects rendered after node deletion so the shrink animation plays on a
  // decoupled element. They live in canvasUIStore and DeletionGhostLayer (P2.07).

  const _captureGhost = (instanceId) => {
    const node = nodes.find(n => n.id === instanceId);
    if (!node) return null;
    const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
    const rx = Math.max(0, (dims.scaledCornerRadius ?? NODE_CORNER_RADIUS * (textSettings?.nodeScale ?? 1)) - 6);
    return {
      id: instanceId,
      x: node.x + 6,
      y: node.y + 6,
      width: dims.currentWidth - 12,
      height: dims.currentHeight - 12,
      rx,
      color: node.color || NODE_DEFAULT_COLOR,
      delay: 0,
    };
  };

  // Spawn the shrink ghosts for a set of instances without removing anything, so
  // delete paths that need their own removal semantics (the control panel's
  // Delete, which loops removeNodeInstance to take group anchors with it) still
  // animate identically to the pie menu and keyboard paths.
  const captureDeletionGhosts = (instanceIds) => {
    const ids = instanceIds instanceof Set ? instanceIds : new Set(instanceIds);
    const ghosts = [];
    ids.forEach(id => { const g = _captureGhost(id); if (g) ghosts.push(g); });
    if (!ghosts.length) return;

    // Shuffle, then hand out the stagger by position, so which node goes first is
    // random but the spacing between them stays even.
    for (let i = ghosts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ghosts[i], ghosts[j]] = [ghosts[j], ghosts[i]];
    }
    const step = ghosts.length > 1
      ? Math.min(DELETE_GHOST_STAGGER_STEP_MS, DELETE_GHOST_STAGGER_MAX_MS / (ghosts.length - 1))
      : 0;
    ghosts.forEach((ghost, i) => { ghost.delay = i * step; });

    useCanvasUIStore.getState().addDeletionGhosts(ghosts);
  };

  const deleteNodeWithAnimation = (instanceId) => {
    captureDeletionGhosts([instanceId]);
    storeActions.removeNodeInstance(activeGraphId, instanceId);
  };

  const deleteMultipleNodesWithAnimation = (instanceIds) => {
    const ids = instanceIds instanceof Set ? instanceIds : new Set(instanceIds);
    captureDeletionGhosts(ids);
    storeActions.removeMultipleNodeInstances(activeGraphId, ids);
  };

  // Abstraction Carousel states
  const abstractionCarouselVisible = useCanvasUIStore(s => s.abstractionCarouselVisible), setAbstractionCarouselVisible = useCanvasUIStore(s => s.setAbstractionCarouselVisible);
  const abstractionCarouselNode = useCanvasUIStore(s => s.abstractionCarouselNode), setAbstractionCarouselNode = useCanvasUIStore(s => s.setAbstractionCarouselNode);
  const setPendingAbstractionNodeId = useCanvasUIStore(s => s.setPendingAbstractionNodeId);
  const setPendingDecomposeNodeId = useCanvasUIStore(s => s.setPendingDecomposeNodeId);
  // The carousel reports its focused node's scale and size every physics frame. Refs, not
  // state (P5.04a): a new size rebuilds the pie data directly, not by re-rendering NodeCanvas.
  const carouselFocusedNodeScaleRef = useRef(1.2);
  const carouselFocusedNodeScale = carouselFocusedNodeScaleRef.current; // as of the last render, like the state was
  const setCarouselFocusedNodeScale = useCallback((scale) => { carouselFocusedNodeScaleRef.current = scale; }, []);
  const carouselFocusedNodeDimensionsRef = useRef(null);
  const rebuildPieMenuDataRef = useRef(null);
  const setCarouselFocusedNodeDimensions = useCallback((dims) => {
    if (carouselFocusedNodeDimensionsRef.current !== dims) { carouselFocusedNodeDimensionsRef.current = dims; rebuildPieMenuDataRef.current?.(); }
  }, []);
  const [carouselFocusedNode, setCarouselFocusedNode] = useTrackedState(null); // Track which node is currently focused in carousel

  // --- Carousel view-locking: on open, animate the canvas so the selected node
  // is centered at a fixed reference zoom; while open, all user pan/zoom is
  // blocked (see wheel/drag/pinch/keyboard guards). On close, the framing is
  // left as-is. This gives the carousel a stable, predictable frame to live in
  // instead of fighting a moving canvas.
  // The carousel frames the focused node so the pie-menu buttons — which radiate
  // horizontally from the node — stay on-screen at a comfortable size. Rather than a
  // hand-tuned reference zoom (which broke when the node/pie-menu button sizes changed
  // and made the carousel zoom in far too much), we derive the zoom from the button
  // cluster's actual canvas footprint so it self-corrects for any size change. The zoom
  // is chosen so the cluster occupies a target fraction of the viewport's half-width:
  // nearly full on narrow/mobile screens (so the buttons still fit) and roomier on wide
  // screens (so the node isn't blown up).
  const CAROUSEL_FILL_WIDE = 0.42;   // desktop: button cluster fills ~42% of the half-width
  const CAROUSEL_FILL_NARROW = 0.9;  // mobile: fill nearly the whole half-width
  const CAROUSEL_ZOOM_WIDTH_WIDE = 1200;   // px: at/above this, use WIDE
  const CAROUSEL_ZOOM_WIDTH_NARROW = 480;  // px: at/below this, use NARROW
  // No vertical bias here either, for the same reason as focus-on-select below: the 10%
  // nudge was standing in for the control panel under the stack, and that is measured
  // now, so the region already stops where the panel starts.
  // Screen px reserved above and below the focused node for the "More Specific" /
  // "Less Specific" hints. Those are drawn at a FIXED size (30px text, 40px chevron,
  // 60px margin off the node box — see AbstractionCarousel's hint block), so the
  // allowance is in screen px and is NOT scaled into canvas units.
  const CAROUSEL_HINT_BAND = 140;
  const prevCarouselVisibleRef = useRef(false);
  const carouselViewAnimRef = useRef(null);
  // Live ref mirror so closures (gesture handlers) can read the current value.
  const abstractionCarouselVisibleRef = useRef(false);
  useEffect(() => { abstractionCarouselVisibleRef.current = abstractionCarouselVisible; }, [abstractionCarouselVisible]);

  // Smoothly animate the canvas to a target pan/zoom (easeOutCubic). Reuses the
  // DOM-bypass transform path; the AbstractionCarousel re-anchors each frame off
  // the 'canvas-transform-change' event so it tracks the motion cleanly.
  const animateCanvasView = useCallback((targetPan, targetZoom, durationMs = 320) => {
    if (carouselViewAnimRef.current) cancelAnimationFrame(carouselViewAnimRef.current);
    const startPan = { ...panOffsetRef.current };
    const startZoom = zoomLevelRef.current;
    const startTime = performance.now();
    isAnimatingZoomRef.current = true;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const e = ease(t);
      const pan = {
        x: startPan.x + (targetPan.x - startPan.x) * e,
        y: startPan.y + (targetPan.y - startPan.y) * e,
      };
      const zoom = startZoom + (targetZoom - startZoom) * e;
      setPanAndZoom(pan, zoom);
      if (t < 1) {
        carouselViewAnimRef.current = requestAnimationFrame(step);
      } else {
        carouselViewAnimRef.current = null;
        isAnimatingZoomRef.current = false;
      }
    };
    carouselViewAnimRef.current = requestAnimationFrame(step);
  }, [setPanAndZoom, panOffsetRef, zoomLevelRef, isAnimatingZoomRef]);

  // Center on open. On close we intentionally leave the canvas where it is —
  // the carousel framing becomes the new resting view rather than snapping back.
  useEffect(() => {
    const was = prevCarouselVisibleRef.current;
    prevCarouselVisibleRef.current = abstractionCarouselVisible;

    if (!was && abstractionCarouselVisible) {
      // Opening: frame the node.
      const node = abstractionCarouselNode;
      if (!node) return;
      runFramingAfterCommit(() => {
      const dims = getNodeDimensions(node, false, null);
      const centerX = node.x + dims.currentWidth / 2;
      const centerY = node.y + dims.currentHeight / 2;
      // Frame against the usable canvas region (panels/header/typelist excluded),
      // in container coordinates — so the node centers in what's actually visible
      // rather than the full window when panels/typelist are open. The abstraction
      // control panel comes up with the carousel (showAbstractionControlPanel, on by
      // default) and sits right under the stack, so it's excluded too when present.
      const vb = getFramingRegion({ reserveBottomPanel: true });
      const regionCenterX = vb.x + vb.width / 2;
      const regionCenterY = vb.y + vb.height / 2;
      // 0 on wide regions → 1 on narrow regions, interpolated by usable width.
      const narrowness = Math.max(0, Math.min(1,
        (CAROUSEL_ZOOM_WIDTH_WIDE - vb.width) / (CAROUSEL_ZOOM_WIDTH_WIDE - CAROUSEL_ZOOM_WIDTH_NARROW)
      ));
      // Max horizontal reach of the pie-menu button cluster from the focused-node
      // centre, in canvas units: the focused-node half-width plus the outermost
      // button and its radius. Buttons are BUBBLE_SIZE/BUBBLE_PADDING (see
      // PieMenu.jsx) scaled by nodeScale·pieMenuScale, so this tracks any size
      // change automatically. The furthest slot stage 1 fills is 'right-third'
      // (Delete), at halfW + padding + 2·slotStep, where padding = bPad + bSize/2
      // and slotStep = CAROUSEL_SLOT_FRACTION·(bSize + bPad), plus bSize/2 for the
      // bubble's own radius. Row 1 reaches slot 1 plus its stagger — 1.5 steps —
      // so it stays inside row 0's reach and doesn't enter this.
      const pieScale = (textSettings?.nodeScale ?? 1.0) * (textSettings?.pieMenuScale ?? 1.0);
      const bSize = 120 * pieScale; // BUBBLE_SIZE
      const bPad = 32 * pieScale;   // BUBBLE_PADDING
      const slotStep = (bSize + bPad) * CAROUSEL_SLOT_FRACTION;
      const focusScale = carouselFocusedNodeScale || 1.2;
      const clusterHalfReach = (dims.currentWidth * focusScale) / 2 + bSize + bPad + 2 * slotStep;
      // Fraction of the usable region half-width the cluster should occupy (fuller on narrow).
      const fillFrac = CAROUSEL_FILL_WIDE + (CAROUSEL_FILL_NARROW - CAROUSEL_FILL_WIDE) * narrowness;
      const referenceZoom = (vb.width * 0.5 * fillFrac) / clusterHalfReach;
      // Vertical fit. The derivation above knows only the node's WIDTH, and an image
      // node grows in height ALONE — getNodeDimensions gives it a fixed
      // EXPANDED_NODE_WIDTH and then adds imageWidth * aspect (up to
      // IMAGE_MAX_ASPECT = 2.0) to its height, so a portrait image node is ~8.5x the
      // height of a text node at the same width-derived zoom. Framed horizontally it
      // overflowed the region vertically and took the More/Less Specific hints
      // off-screen with it.
      //
      // Sized to the focused node alone, not its neighbours: a chain of portrait
      // image nodes puts ~1150 canvas units between adjacent centres, so demanding a
      // neighbour fit would drive the zoom to ~0.09 and render the focused node
      // barely 100px tall. The stack is built to overlap and fade (LEVEL_SPACING is
      // negative), so neighbours peeking in is the intended read.
      //
      // Stage 1's two button rows straddle the node's centre line, half a slot step
      // either side of it, so on a short node they — not the node — set the vertical
      // extent. Fit whichever reaches further.
      const availableHalfHeight = Math.max(1, vb.height * 0.5 - CAROUSEL_HINT_BAND);
      const nodeHalfHeight = Math.max(1, (dims.currentHeight * focusScale) / 2, slotStep / 2 + bSize / 2);
      const verticalZoom = availableHalfHeight / nodeHalfHeight;
      const tz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(referenceZoom, verticalZoom)));
      const targetPanX = regionCenterX - (centerX - canvasSize.offsetX) * tz;
      const targetPanY = regionCenterY - (centerY - canvasSize.offsetY) * tz;
      const finalPan = clampPan({ x: targetPanX, y: targetPanY }, tz, viewportSize, canvasSize);
      animateCanvasView(finalPan, tz);
      });
    }
  }, [abstractionCarouselVisible, abstractionCarouselNode, animateCanvasView, viewportSize, getFramingRegion, canvasSize, MIN_ZOOM, MAX_ZOOM, textSettings, carouselFocusedNodeScale, runFramingAfterCommit]);

  // Frame the orbit when it opens, out to a limit.
  //
  // Fits against viewportBounds — the usable canvas region, with the panels, the
  // header and the type-list bar already subtracted — the same bounds the
  // carousel framing and the edge glow use, so the orbit centres in what is
  // actually visible rather than in the raw window. Fitting the SMALLER of the
  // two axes is what gets the vertical extent in; the region is wider than it is
  // tall, so height is normally the binding one.
  //
  // Candidates arrive asynchronously and the orbit keeps growing after it opens,
  // so this reframes as it grows — but only as far as ORBIT_FIT_MIN_ZOOM, and
  // never while the orbit still fits the frame. animateCanvasView re-eases from
  // wherever the last one reached, so consecutive reframes read as one
  // continuous pull-back rather than a series of jumps.
  useEffect(() => {
    if (!semanticOrbitActive) {
      orbitFitRef.current = { fitted: false, zoom: 0 };
      return;
    }
    if (!orbitFrame || !(orbitFrame.radius > 0)) return;

    const vb = getFramingRegion();
    const usable = Math.min(
      vb.width * (1 - 2 * ORBIT_FIT_PADDING),
      vb.height * (1 - 2 * ORBIT_FIT_PADDING)
    );
    const diameter = orbitFrame.radius * 2;
    const floor = typeof window !== 'undefined' && window.__orbitZoom != null
      ? Number(window.__orbitZoom)
      : ORBIT_FIT_MIN_ZOOM;
    const tz = Math.max(MIN_ZOOM, floor, Math.min(MAX_ZOOM, usable / diameter));

    const state = orbitFitRef.current;
    if (state.fitted) {
      // Already pulled back as far as this is willing to go — growing past that
      // asks for the same zoom, so there is nothing left to do.
      if (tz === state.zoom) return;
      // It grew and wants a different zoom, but still fits at whatever zoom we
      // are actually at (the user may have moved since) — leave the view alone.
      if (diameter * (zoomLevelRef.current || 1) <= usable) return;
    }

    const targetPanX = (vb.x + vb.width / 2) - (orbitFrame.centerX - canvasSize.offsetX) * tz;
    const targetPanY = (vb.y + vb.height / 2) - (orbitFrame.centerY - canvasSize.offsetY) * tz;
    const minPanX = viewportSize.width - canvasSize.width * tz;
    const minPanY = viewportSize.height - canvasSize.height * tz;
    animateCanvasView({
      x: Math.min(Math.max(targetPanX, minPanX), 0),
      y: Math.min(Math.max(targetPanY, minPanY), 0),
    }, tz);

    orbitFitRef.current = { fitted: true, zoom: tz };
  }, [semanticOrbitActive, orbitFrame, getFramingRegion, viewportSize, canvasSize, animateCanvasView, zoomLevelRef, MIN_ZOOM, MAX_ZOOM]);

  // Animation states for carousel
  const carouselAnimationState = useCanvasUIStore(s => s.carouselAnimationState), setCarouselAnimationState = useCanvasUIStore(s => s.setCarouselAnimationState); // 'hidden', 'entering', 'visible', 'exiting'
  const justCompletedCarouselExit = useCanvasUIStore(s => s.justCompletedCarouselExit), setJustCompletedCarouselExit = useCanvasUIStore(s => s.setJustCompletedCarouselExit);

  // Abstraction dimension management
  const [abstractionDimensions, setAbstractionDimensions] = useState(['Generalization Axis']);
  const [currentAbstractionDimension, setCurrentAbstractionDimension] = useState('Generalization Axis');

  // Abstraction control panel states
  const abstractionControlPanelVisible = useCanvasUIStore(s => s.abstractionControlPanelVisible), setAbstractionControlPanelVisible = useCanvasUIStore(s => s.setAbstractionControlPanelVisible);
  const abstractionControlPanelShouldShow = useCanvasUIStore(s => s.abstractionControlPanelShouldShow), setAbstractionControlPanelShouldShow = useCanvasUIStore(s => s.setAbstractionControlPanelShouldShow);
  // The carousel's 100 ms click guard and pending Swap live in canvasUIStore, where
  // the pie machine writes them (P5.02b step 4).
  const isPieMenuActionInProgress = useCanvasUIStore(s => s.isPieMenuActionInProgress);
  const setIsPieMenuActionInProgress = useCallback((v) => useCanvasUIStore.setState({ isPieMenuActionInProgress: v }), []);
  const nodeControlPanelVisible = useCanvasUIStore(s => s.nodeControlPanelVisible), setNodeControlPanelVisible = useCanvasUIStore(s => s.setNodeControlPanelVisible);
  const nodeControlPanelShouldShow = useCanvasUIStore(s => s.nodeControlPanelShouldShow), setNodeControlPanelShouldShow = useCanvasUIStore(s => s.setNodeControlPanelShouldShow);
  const groupControlPanelShouldShow = useCanvasUIStore(s => s.groupControlPanelShouldShow), setGroupControlPanelShouldShow = useCanvasUIStore(s => s.setGroupControlPanelShouldShow);
  const groupControlPanelVisible = useCanvasUIStore(s => s.groupControlPanelVisible), setGroupControlPanelVisible = useCanvasUIStore(s => s.setGroupControlPanelVisible);
  // P2.03b: id in canvasUIStore, group read from the active web (was a stale snapshot).
  const selectedGroupId = useCanvasUIStore(s => s.selectedGroupId);
  const selectedGroup = useMemo(() => (selectedGroupId ? graphsMap.get(activeGraphId)?.groups?.get(selectedGroupId) ?? null : null), [selectedGroupId, graphsMap, activeGraphId]);
  const selectedGroupRef = useRef(selectedGroup);
  selectedGroupRef.current = selectedGroup;
  const setSelectedGroup = useCallback((next) => useCanvasUIStore.getState().setSelectedGroupId((typeof next === 'function' ? next(selectedGroupRef.current) : next)?.id ?? null), []);
  // Tracks the last group-title tap ({ id, time }) for touch double-tap (rename) detection.
  const lastGroupTapRef = useRef({ id: null, time: 0 });
  // Start position of an in-progress group-title touch, used by onTouchEnd to tell a
  // tap from a drag. Set on touchstart, read on touchend.
  const groupTouchStartRef = useRef(null);
  // Removes the document-level touch listeners a group-title touch installed. Held here
  // so onTouchEnd can clean up even when it stopPropagation()s (which prevents the
  // document-level endListener from ever firing).
  const groupTouchCleanupRef = useRef(null);
  // Preserve last selections during exit animations
  // Latched during render below (not an effect + store write, which cost a second
  // NodeCanvas render on every selection change): the node panel's exit animation.
  const lastSelectedNodePrototypesRef = useRef([]);
  // Snapshot for the exit animation (even of a just-deleted group); latched in render (P2.03).
  const lastSelectedGroupRef = useRef(null);
  if (selectedGroup) lastSelectedGroupRef.current = selectedGroup;
  const lastSelectedGroup = lastSelectedGroupRef.current;
  const connectionControlPanelVisible = useCanvasUIStore(s => s.connectionControlPanelVisible), setConnectionControlPanelVisible = useCanvasUIStore(s => s.setConnectionControlPanelVisible);
  const connectionControlPanelShouldShow = useCanvasUIStore(s => s.connectionControlPanelShouldShow), setConnectionControlPanelShouldShow = useCanvasUIStore(s => s.setConnectionControlPanelShouldShow);
  const [edgePieMenuVisible, setEdgePieMenuVisible] = useState(false);
  const [edgePieMenuRendered, setEdgePieMenuRendered] = useState(false);
  const edgePieMenuAnchorRef = useRef(null);   // frozen on show, held through exit animation
  const edgePieMenuButtonsRef = useRef(null);  // frozen on show, held through exit animation
  // Track prior selection/drag state so the management effect only *forces* the menu
  // open on a genuine show trigger (edge just selected, or a drag just released) — not
  // on every incidental re-run. Without this, a button action that dismisses the menu
  // (setEdgePieMenuVisible(false)) but leaves the edge selected would be immediately
  // re-shown by the effect, replaying the intro pop animation.
  const prevEdgePieShouldShowRef = useRef(false);
  const prevEdgePieDraggingRef = useRef(false);

  // Pending swap operation (canvasUIStore; see isPieMenuActionInProgress)
  const setPendingSwapOperation = useCallback((v) => useCanvasUIStore.setState((st) => ({ pendingSwapOperation: typeof v === 'function' ? v(st.pendingSwapOperation) : v })), []);

  // Header search state
  // The searches render from SearchHosts (P2.06d); the keyboard shortcut opens one.
  const setHeaderSearchVisible = useCanvasUIStore(s => s.setHeaderSearchVisible);
  // The force-sim tuner renders from ForceSimHost (P2.06f); the canvas menu opens it.
  const setForceSimModalVisible = useCanvasUIStore(s => s.setForceSimModalVisible);

  // Define carousel callbacks outside conditional rendering to avoid hook violations
  // The carousel's own timers report through the pie machine (P5.02b step 4). The
  // callbacks are stable now, so a web change no longer restarts the carousel's
  // 200 ms exit timer (P5.02a NEW-3, the one intended timing change).
  const onCarouselAnimationStateChange = useCallback(() => {
    useCanvasUIStore.getState().dispatchPie({ type: 'CAROUSEL_ENTERED' });
  }, []);

  const onCarouselClose = useCallback(() => {
    // Behave EXACTLY like the Stage-1 "Back" button: run the normal pie-menu
    // shrink → onExitAnimationComplete → carousel-exit chain, and let the pie
    // menu reopen on the node afterward (CAROUSEL_CLOSE in the pie machine).
    //
    // Do NOT null selectedNodeIdForPieMenu or flag a click-away dismissal here.
    // Nulling the selection unmounts the pie menu before its exit animation can
    // fire, so onExitAnimationComplete never runs and isTransitioningPieMenu gets
    // stuck true — which permanently disables the pie menu until refresh.
    useCanvasUIStore.getState().dispatchPie({ type: 'CAROUSEL_CLOSE' });
  }, []);

  // Touch's way in to the same exit, handed to the carousel as onRequestClose.
  //
  // The carousel dismisses itself on a click outside — but it listens for
  // `mousedown`, and its own touchstart calls preventDefault(), which suppresses
  // the compatibility mouse events entirely. So on a touch device that listener
  // never fires; the carousel's touch state machine resolves the tap itself and
  // calls this instead.
  //
  // It can't simply call onCarouselClose. That routes the exit through the pie
  // menu's shrink animation, and when no pie menu is up there is nothing to
  // animate — so the exit chain hanging off it never runs and the carousel stays
  // up for good, over a node the canvas is already hiding, with the pie menu
  // permanently disabled. That is the frozen node. The mouse is covered by
  // handleCanvasClick's own defensive branch; touch has no equivalent, which is
  // what the no-pie-menu teardown below is for.
  //
  // Idempotent because a second request part-way through the exit would restart
  // the transition.
  const carouselCloseRequestedRef = useMemo(() => storeFieldRef(useCanvasUIStore, 'carouselCloseRequested'), []);
  useEffect(() => {
    if (!abstractionCarouselVisible) carouselCloseRequestedRef.current = false;
  }, [abstractionCarouselVisible]);
  // With no pie menu up there is nothing to animate out, and the exit chain
  // hangs off that animation, so the machine tears the carousel down directly
  // (CAROUSEL_TOUCH_CLOSE → CAROUSEL_TEARDOWN), as handleCanvasClick's defensive
  // branch does for the mouse.
  const requestCarouselClose = useCallback(() => {
    if (!useCanvasUIStore.getState().abstractionCarouselVisible) return false;
    useCanvasUIStore.getState().dispatchPie({ type: 'CAROUSEL_TOUCH_CLOSE' });
    return true;
  }, []);

  const onCarouselReplaceNode = useCallback((oldNodeId, newNodeData) => {
    // TODO: Implement node replacement functionality

  }, []);

  // While the abstraction prompt is open the carousel stays in stage 2 on its node:
  // an invariant of the pie machine's selection rule (was an effect, P5.02b step 6).

  // The carousel has faded out: apply a pending Swap, hide it, restore the node's
  // selection and pie, and frame it (CAROUSEL_EXITED; the Swap and the framing
  // come back as commands, see handlePieCommand).
  const onCarouselExitAnimationComplete = useCallback(() => {
    useCanvasUIStore.getState().dispatchPie({ type: 'CAROUSEL_EXITED' }, getPieEnv());
  }, []);
  const previewingNodeId = useCanvasUIStore(s => s.previewingNodeId), setPreviewingNodeId = useCanvasUIStore(s => s.setPreviewingNodeId);

  // When a node is decomposed into its preview (decomposition view), frame it on
  // the canvas with the same animated zoom-in used for the abstraction carousel.
  // The previewed node expands to show its inner graph, so we fit it to the
  // viewport (with padding) rather than using a fixed reference zoom.
  const DECOMPOSE_VIEW_PADDING = 120; // px of breathing room around the expanded node
  // The framing scales with viewport width: on narrow/mobile screens the
  // width-constrained fit lands too small and too centered, so zoom in harder and
  // lift the node higher; on wide screens pull back and keep it near center.
  const DECOMPOSE_ZOOM_FACTOR_WIDE = 0.7;   // pullback on desktop
  const DECOMPOSE_ZOOM_FACTOR_NARROW = 0.75; // leave margin on mobile so neighbouring nodes
                                             // stay visible/draggable and there's empty canvas to pan from
  const DECOMPOSE_BIAS_WIDE = 0.08;          // fraction of viewport height above center on desktop
  const DECOMPOSE_BIAS_NARROW = 0.16;        // more lift on mobile
  const DECOMPOSE_WIDTH_WIDE = 1200;         // px: at/above this, use the WIDE values
  const DECOMPOSE_WIDTH_NARROW = 480;        // px: at/below this, use the NARROW values
  const prevPreviewingNodeIdRef = useRef(null);
  useEffect(() => frameDecomposedNode({
    prevPreviewingNodeIdRef, previewingNodeId, nodes, getFramingRegion, DECOMPOSE_WIDTH_WIDE,
    DECOMPOSE_WIDTH_NARROW, DECOMPOSE_ZOOM_FACTOR_WIDE, DECOMPOSE_ZOOM_FACTOR_NARROW, DECOMPOSE_BIAS_WIDE,
    DECOMPOSE_BIAS_NARROW, DECOMPOSE_VIEW_PADDING, MIN_ZOOM, canvasSize, viewportSize, animateCanvasView,
  }), [previewingNodeId, nodes, animateCanvasView, viewportSize, getFramingRegion, canvasSize, MIN_ZOOM, MAX_ZOOM]);

  const prevFocusPieNodeIdRef = useRef(null);

  // Frame a single node with the pie-menu-aware zoom. Shared by focus-on-select and
  // recompose (collapsing a decomposed node) so both land at the exact same view.
  const focusNodeInView = useCallback((...args) => focusNodeInViewWith({
    nodes, runFramingAfterCommit, getFramingRegion, textSettings, focusOnSelectZoomAmount, MIN_ZOOM,
    canvasSize, viewportSize, zoomLevelRef, panOffsetRef, animateCanvasView,
  }, ...args), [nodes, animateCanvasView, viewportSize, getFramingRegion, canvasSize, MIN_ZOOM, MAX_ZOOM, textSettings, runFramingAfterCommit, focusOnSelectZoomAmount]);

  // Frame the connection (edge) pie menu the same way focusNodeInView frames a node:
  // fit the menu's own bounds into the usable region. The edge menu is one or more
  // rows of buttons laid out along the connection's slope and pushed to one side of
  // it (PieMenu's line mode) — so its bounds are the block's extent, not a radial ring.
  // This replaces the old "..." compact fallback: rather than collapsing the row when
  // it would be clipped, we zoom out until the whole row fits.
  //
  // `labelRect` (optional, canvas-space {minX,maxX,minY,maxY}) is the connection's own
  // name label — folded into the framed box so selecting a connection shows you what
  // it says, not just its buttons. It's a want, not a requirement: a label longer than
  // the button row would drag the zoom down, so it's only honored while it doesn't
  // cost more than FOCUS_EDGE_LABEL_MAX_GROWTH of extra box.
  const focusEdgePieMenuInView = useCallback((...args) => focusEdgePieMenuInViewWith({
    runFramingAfterCommit, textSettings, getFramingRegion, focusOnSelectZoomAmount, MIN_ZOOM, canvasSize,
    viewportSize, zoomLevelRef, panOffsetRef, animateCanvasView,
  }, ...args), [animateCanvasView, viewportSize, getFramingRegion, canvasSize, MIN_ZOOM, MAX_ZOOM, textSettings, runFramingAfterCommit, focusOnSelectZoomAmount]);

  useEffect(() => {
    const was = prevFocusPieNodeIdRef.current;
    const id = selectedNodeIdForPieMenu;
    prevFocusPieNodeIdRef.current = id;

    if (!FOCUS_ON_SELECT_ENABLED || !focusOnSelectEnabled) return;
    // Only on a fresh focus (new node), not re-fires for the same node.
    if (!id || id === was) return;
    // Other framing owners take precedence; don't fight them, and don't animate
    // mid-drag or mid-transition.
    if (abstractionCarouselVisible || previewingNodeId || isTransitioningPieMenu) return;
    if (draggingNodeInfoRef.current) return;
    // Multi-selection: no single node to frame, so skip the focus-on-select zoom.
    if (selectedInstanceIdsRef.current.size > 1) return;

    focusNodeInView(id);
  }, [selectedNodeIdForPieMenu, abstractionCarouselVisible, previewingNodeId, isTransitioningPieMenu, focusNodeInView, focusOnSelectEnabled]);

  // When a decomposed node is recomposed (collapsed back to a normal node), frame it
  // with the exact same pie-menu-aware zoom as focus-on-select. Fires on the
  // previewingNodeId node -> null transition (both the Compose and Decompose-toggle
  // paths clear it). If the node no longer exists (e.g. a graph switch also cleared
  // preview) focusNodeInView no-ops on the missing-node guard.
  const prevRecomposeNodeIdRef = useRef(null);
  useEffect(() => {
    const was = prevRecomposeNodeIdRef.current;
    prevRecomposeNodeIdRef.current = previewingNodeId;
    if (!was || previewingNodeId) return; // recompose = node -> null only
    if (abstractionCarouselVisible || isTransitioningPieMenu || draggingNodeInfoRef.current) return;
    focusNodeInView(was);
  }, [previewingNodeId, abstractionCarouselVisible, isTransitioningPieMenu, focusNodeInView]);

  // The node the carousel returns to is framed by the pie machine's `frame
  // returnFocus` command (handlePieCommand), not an effect (P5.02b step 4).

  // Track current definition index for each node per graph context (nodeId-graphId -> index)
  const nodeDefinitionIndices = useCanvasUIStore(s => s.nodeDefinitionIndices), setNodeDefinitionIndices = useCanvasUIStore(s => s.setNodeDefinitionIndices);

  // Ref to track carousel exit process to prevent cleanup interference
  const carouselExitInProgressRef = useMemo(() => storeFieldRef(useCanvasUIStore, 'carouselExitInProgress'), []);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const clearLabelsOnMouseMove = useCallback(() => {
    clearHoverImmediate();
  }, [clearHoverImmediate]);

  // --- Graph Change Cleanup ---
  // A web change resets the pie, carousel, preview, selection and the panels
  // (GRAPH_CHANGED: the pie machine's full reset and close-all; state that still
  // lives here comes back as `local` commands, see handlePieCommand). The same
  // reset also follows carousel and transition changes inside the machine.
  useEffect(() => {
    useCanvasUIStore.getState().dispatchPie({ type: 'GRAPH_CHANGED' });
  }, [activeGraphId]);

  // The node, group, connection and abstraction panel management effects live in
  // ControlPanelsHost with the panels (P5.05a). The edge pie stays here for now.

  // --- Edge Pie Menu Management (single edge selection) ---
  useEffect(() => {
    const nodesSelected = selectedInstanceIds.size > 0;
    const singleEdgeSelected = selectedEdgeId !== null && selectedEdgeIds.size === 0;
    const shouldShow = Boolean(singleEdgeSelected && !nodesSelected && !abstractionCarouselVisible && !connectionNamePrompt.visible);
    const dragging = Boolean(draggingNodeInfo);
    // Only re-assert visibility on a genuine show trigger: the edge just became the
    // sole selection, or a drag just released (the menu outros mid-drag, see the
    // inline render block, and must pop back in on drop). On any other re-run where
    // shouldShow is merely still-true (e.g. a button dismissed the menu without
    // deselecting the edge), leave visibility alone so we don't replay the intro.
    const roseIntoShow = shouldShow && !prevEdgePieShouldShowRef.current;
    const dragJustEnded = prevEdgePieDraggingRef.current && !dragging;
    prevEdgePieShouldShowRef.current = shouldShow;
    prevEdgePieDraggingRef.current = dragging;
    if (shouldShow) {
      if (selectedEdgeMidpoint) edgePieMenuAnchorRef.current = selectedEdgeMidpoint;
      if (roseIntoShow || dragJustEnded) {
        setEdgePieMenuVisible(true);
        setEdgePieMenuRendered(true);
      }
    } else if (edgePieMenuVisible) {
      setEdgePieMenuVisible(false);
    }
    // draggingNodeInfo drives the dragJustEnded branch above: when a drag involving
    // this edge's endpoints ends, the effect re-asserts `edgePieMenuRendered` (which
    // the isVisible-driven outro animation clears mid-drag, see the inline render
    // block below) and refreshes the anchor to the node's settled position, so the
    // menu plays its intro (pop) animation back in on release.
  }, [selectedInstanceIds, selectedEdgeId, selectedEdgeIds, abstractionCarouselVisible, connectionNamePrompt.visible, edgePieMenuVisible, selectedEdgeMidpoint, draggingNodeInfo]);



  const handleNodeControlPanelAnimationComplete = useCallback(() => {
    setNodeControlPanelShouldShow(false);
    // Clear the last selected prototypes when animation completes
    lastSelectedNodePrototypesRef.current = [];
  }, [setNodeControlPanelShouldShow]);

  const handleConnectionControlPanelAnimationComplete = useCallback(() => {
    setConnectionControlPanelShouldShow(false);
  }, [setConnectionControlPanelShouldShow]);

  const handleGroupControlPanelAnimationComplete = useCallback(() => {
    setGroupControlPanelShouldShow(false);
    setGroupControlPanelVisible(false);
    lastSelectedGroupRef.current = null;
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

  if (selectedNodePrototypes.length > 0) lastSelectedNodePrototypesRef.current = selectedNodePrototypes;
  const lastSelectedNodePrototypes = lastSelectedNodePrototypesRef.current;

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

  // The instance the control panel's pie-menu pages act on. Strictly single
  // selection: every action in nodePieMenuPages is written against one instance,
  // so with two Things selected the panel falls back to its own selection-wide
  // buttons rather than silently applying Delete to whichever one sorted first.
  // Latched during render, like lastSelectedNodePrototypes above.
  const lastSingleSelectedInstanceIdRef = useRef(null);
  if (selectedInstanceIds.size === 1) lastSingleSelectedInstanceIdRef.current = Array.from(selectedInstanceIds)[0];
  // Forget it on multi-select, or a later deselect would let the panel animate
  // out still showing the pages of whichever Thing was selected before.
  else if (selectedInstanceIds.size > 1) lastSingleSelectedInstanceIdRef.current = null;
  const lastSingleSelectedInstanceId = lastSingleSelectedInstanceIdRef.current;

  const singleSelectedInstanceId = useMemo(() => {
    if (selectedInstanceIds.size === 1) return Array.from(selectedInstanceIds)[0];
    // Selection already cleared but the panel is still animating out — hold the
    // last target (same trick as nodePrototypesForPanel above) so the buttons
    // don't flip to the multi-select set for the length of the exit.
    if (selectedInstanceIds.size === 0 && nodeControlPanelVisible) return lastSingleSelectedInstanceId;
    return null;
  }, [selectedInstanceIds, nodeControlPanelVisible, lastSingleSelectedInstanceId]);

  const groupPanelTarget = selectedGroup || lastSelectedGroup;
  const groupPanelMode = groupPanelTarget?.linkedNodePrototypeId ? "nodegroup" : "group";

  // A node-group's name/color live on its linked prototype; read identity through it.
  const selectedGroupEffectiveColor = useMemo(() => {
    if (!selectedGroup) return null;
    const linkedPrototype = selectedGroup.linkedNodePrototypeId
      ? nodePrototypesMap.get(selectedGroup.linkedNodePrototypeId)
      : null;
    return linkedPrototype?.color || selectedGroup.color || null;
  }, [selectedGroup, nodePrototypesMap]);

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
    // Start inline editing; a node-group's prototype owns the name, so seed from it.
    const linkedPrototype = selectedGroup.linkedNodePrototypeId
      ? nodePrototypesMap.get(selectedGroup.linkedNodePrototypeId)
      : null;
    setEditingGroupId(selectedGroup.id);
    setTempGroupName(linkedPrototype?.name || selectedGroup.name || 'Group');
  }, [selectedGroup, nodePrototypesMap]);

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
  const handleNodeConvertToNodeGroup = useCallback((instanceId, prototypeId, definitionGraphId) => convertNodeToNodeGroup(instanceId, prototypeId, definitionGraphId, {
    activeGraphId, edgesMap, graphsMap, nodePrototypesMap, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow,
    setNodeControlPanelVisible, setPreviewingNodeId, setSelectedGroup, setSelectedInstanceIds, storeActions,
  }), [activeGraphId, graphsMap, edgesMap, nodePrototypesMap, storeActions, setSelectedGroup, setSelectedInstanceIds, setPreviewingNodeId, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow, setNodeControlPanelVisible]);

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

  // --- Refs (Keep these) ---

  const [, drop] = useDrop(() => ({
    accept: SPAWNABLE_NODE,
    drop: (item, monitor) => handleCanvasDrop({
      activeGraphId, containerRef, clientToCanvasCoordinates, nodePrototypesMap, storeActions, gridMode,
      snapToGridAnimated, selectedInstanceIds,
    }, item, monitor),
  }), [activeGraphId, clientToCanvasCoordinates, nodePrototypesMap, storeActions, gridMode, snapToGridAnimated]);

  const setCanvasAreaRef = useCallback(node => {
    containerRef.current = node;
    drop(node);
  }, [drop]);

  const isMouseDown = useRef(false);
  const ignoreCanvasClick = useRef(false);
  // Set when a marquee release just committed a selection, and consumed by the
  // synthetic click the browser fires right after that mouseup. ignoreCanvasClick
  // can't cover this: it deliberately falls through when something is selected, so
  // the first click after a pan isn't wasted just clearing the flag — but that
  // fall-through is exactly what reaches the click handler's deselect branch and
  // wipes the selection the marquee just made.
  const justCompletedBoxSelectRef = useRef(false);
  const mouseDownPosition = useRef({ x: 0, y: 0 });
  const mouseMoved = useRef(false);
  const startedOnNode = useRef(false);
  const longPressTimeout = useRef(null);
  const mouseInsideNode = useRef(true);
  // Middle-mouse zoom gesture: when active, vertical drag zooms anchored at the mousedown point.
  // Middle-click on a node (no drag) opens its right-panel tab.
  // Uses Pointer Lock so the cursor stays pinned at the click point instead of drifting off-canvas.
  const middleMouseZoomRef = useRef(null);

  // If pointer lock exits unexpectedly (e.g. Escape, focus loss), abort the gesture cleanly.
  useEffect(() => {
    const onLockChange = () => {
      if (!document.pointerLockElement && middleMouseZoomRef.current) {
        middleMouseZoomRef.current = null;
        isPanningOrZooming.current = false;
      }
    };
    document.addEventListener('pointerlockchange', onLockChange);
    return () => document.removeEventListener('pointerlockchange', onLockChange);
  }, []);

  const canvasWorker = useCanvasWorker();
  // Ensure async zoom results apply in order to avoid ghost frames
  const zoomOpIdRef = useRef(0);
  const selectionBaseRef = useRef(new Set());
  const wasDrawingConnection = useRef(false);
  // Atomic re-entry guard for handleMouseUp. Multiple release paths
  // (window+capture pointerup, React onMouseUp/onTouchEnd) can synchronously
  // invoke handleMouseUp in the same tick — without this guard, connection
  // creation, drag finalization, and selection-box logic all run twice.
  // Set at top of handleMouseUp, cleared in finally. Replaces the older
  // timeout-based connectionCreationInProgressRef + dragFinalizationInProgressRef.
  const handleMouseUpInProgressRef = useRef(false);
  // Add refs for click vs double-click detection
  const clickTimeoutIdRef = useRef(null);
  const potentialClickNodeRef = useRef(null);
  const CLICK_DELAY = 180; // Reduced milliseconds to wait for a potential double-click
  // The previous press that could be the first half of a double-click: a
  // namespaced target key plus where it landed.
  //
  // `event.detail` counts consecutive clicks by TIME, and the browser's
  // positional slop for that count is generous — wide enough that on a dense
  // canvas a quick click on one Thing followed by a click on its neighbour
  // arrives as detail === 2. On a Thing that opened the neighbour's panel tab;
  // on a group title (which for a node-group IS the Thing, drawn without its
  // pill) it opened the neighbour's inline rename. A double-click has to be two
  // presses on the SAME target in the same place; anything else is two separate
  // single clicks, however fast they came.
  //
  // One shared record rather than one per kind, so the cross-target runs are
  // covered too — Thing then group title, group title then Thing.
  const lastPressRef = useRef({ key: null, x: 0, y: 0 });
  const DOUBLE_CLICK_SLOP_PX = 10;

  /**
   * Records a press and reports whether it completes a double-click on the same
   * target. Call exactly once per press — it mutates the record.
   *
   * @param {string|null} key - Namespaced target, e.g. `node:<instanceId>`.
   *   Null for bare canvas, which ends any run without starting one.
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} detail - The event's own click count.
   */
  const isDoublePress = useCallback((key, clientX, clientY, detail) => {
    const prev = lastPressRef.current;
    const sameTarget = key !== null
      && prev.key === key
      && Math.hypot(clientX - prev.x, clientY - prev.y) <= DOUBLE_CLICK_SLOP_PX;
    lastPressRef.current = { key, x: clientX, y: clientY };
    return detail >= 2 && sameTarget;
  }, []);

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
    if (!activePieMenuColorNodeId) return;
    // The picker was opened from a multi-selection (the control panel anchors it
    // on a selected instance), so it recolours the whole selection — otherwise
    // Palette silently repainted one Thing out of the several that were selected.
    const targetIds = selectedInstanceIds.size > 1 && selectedInstanceIds.has(activePieMenuColorNodeId)
      ? Array.from(selectedInstanceIds)
      : [activePieMenuColorNodeId];
    // Two instances can share a prototype; recolouring it twice would be a no-op
    // with a second history entry attached.
    const prototypeIds = new Set(
      targetIds.map(id => nodes.find(n => n.id === id)?.prototypeId).filter(Boolean)
    );
    prototypeIds.forEach(prototypeId => {
      // Coalesced across the drag; committed by handlePieMenuColorCommit.
      storeActions.updateNodePrototype(prototypeId, draft => {
        draft.color = color;
      }, { coalesce: `node-color:${prototypeId}` });
    });
  }, [activePieMenuColorNodeId, selectedInstanceIds, nodes, storeActions]);

  const handlePieMenuColorCommit = useCallback(() => {
    storeActions.flushHistory?.();
  }, [storeActions]);

  // Connection color picker. Recolours the Thing that defines the connection, so
  // every connection of that kind changes together — the same relationship a
  // node's Palette has with its prototype, and the reason a connection with no
  // definition yet has no Palette button to press (see edgePieMenuButtons).
  const handleEdgeColorPickerOpen = useCallback((prototypeId, position) => {
    if (!prototypeId) return;
    if (edgeColorPickerVisible && activeEdgeColorPrototypeId === prototypeId) {
      setEdgeColorPickerVisible(false);
      setActiveEdgeColorPrototypeId(null);
      return;
    }
    setEdgeColorPickerPosition(position || { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setEdgeColorPickerVisible(true);
    setActiveEdgeColorPrototypeId(prototypeId);
  }, [edgeColorPickerVisible, activeEdgeColorPrototypeId]);

  const handleEdgeColorPickerClose = useCallback(() => {
    setEdgeColorPickerVisible(false);
    setActiveEdgeColorPrototypeId(null);
  }, []);

  const handleEdgeColorChange = useCallback((color) => {
    if (!activeEdgeColorPrototypeId) return;
    // Coalesced across the drag; committed by handleEdgeColorCommit, so a whole
    // picker session is one undo step.
    storeActions.updateNodePrototype(activeEdgeColorPrototypeId, draft => {
      draft.color = color;
    }, { coalesce: `node-color:${activeEdgeColorPrototypeId}` });
  }, [activeEdgeColorPrototypeId, storeActions]);

  const handleEdgeColorCommit = useCallback(() => {
    storeActions.flushHistory?.();
  }, [storeActions]);

  // Deselecting the connection takes its picker with it — both menus that can
  // open it are gone by then, so it would otherwise be left floating with
  // nothing on screen explaining what it's colouring.
  useEffect(() => {
    if (!edgeColorPickerVisible) return;
    if (selectedEdgeId || selectedEdgeIds.size > 0) return;
    setEdgeColorPickerVisible(false);
    setActiveEdgeColorPrototypeId(null);
  }, [edgeColorPickerVisible, selectedEdgeId, selectedEdgeIds]);

  // Re-point an existing instance at a different prototype (pie-menu "Swap").
  // Edges reference instance IDs, so every connection stays attached — only the
  // instance's prototypeId changes. Position is nudged so the node keeps its
  // center despite the new prototype's (possibly different) dimensions. This is the
  // same operation the abstraction carousel performs on swap.
  const performInstanceSwap = useCallback((instanceId, newPrototypeId) => {
    const instance = nodes.find(n => n.id === instanceId);
    if (!instance || !activeGraphId || !newPrototypeId) return;
    if (instance.prototypeId === newPrototypeId) return; // no-op
    // Read fresh from the store so a prototype created moments ago (new-Thing swap) resolves.
    const newPrototype = useGraphStore.getState().nodePrototypes.get(newPrototypeId);
    if (!newPrototype) return;

    const originalDimensions = getNodeDimensions(instance, false, null);
    const tempNodeWithNewPrototype = {
      ...instance,
      prototypeId: newPrototypeId,
      name: newPrototype.name || instance.name,
      color: newPrototype.color || instance.color,
      thumbnailSrc: newPrototype.thumbnailSrc || instance.thumbnailSrc,
      definitionGraphIds: newPrototype.definitionGraphIds || []
    };
    const newDimensions = getNodeDimensions(tempNodeWithNewPrototype, false, null);

    const centerX = instance.x + originalDimensions.currentWidth / 2;
    const centerY = instance.y + originalDimensions.currentHeight / 2;
    const newX = centerX - newDimensions.currentWidth / 2;
    const newY = centerY - newDimensions.currentHeight / 2;

    storeActions.updateNodeInstance(activeGraphId, instanceId, (inst) => {
      inst.prototypeId = newPrototypeId;
      inst.x = newX;
      inst.y = newY;
    }, { finalize: true });
  }, [nodes, activeGraphId, storeActions]);

  /**
   * Every page of the default single-Thing pie menu, in display order.
   *
   * This is the one list, and it is the whole reason both menus can stay in
   * step: PieMenu pages through it with its chevrons, the bottom control panel
   * pages through it with its own, and neither has to be edited to add a page.
   * The panel used to hand-transcribe a subset of page 0, which is how it ended
   * up offering Orbit but not Duplicate, Copy, Swap, Add Image, Semantic Search,
   * Ask The Wizard, or Open in Panel — those were reachable only from the canvas.
   *
   * An entry is a page: an array of the {id, label, icon, action} buttons PieMenu
   * already renders. Actions take (instanceId, buttonPosition) and are written
   * against one instance, which is what both consumers target.
   */
  const nodePieMenuPages = useMemo(() => buildNodePieMenuPages({
    abstractionCarouselVisible, activeGraphId, carouselAnimationState, clipboardRef, deleteNodeWithAnimation, handlePieMenuColorPickerOpen,
    markClipboardChanged, nodes, savedNodeIds, selectedNodeIdForPieMenu, setActivePieMenuItemForVision, setEditingNodeIdOnCanvas,
    setIsTransitioningPieMenu, setNodeControlPanelVisible, setPendingAbstractionNodeId, setPendingDecomposeNodeId, setSelectedInstanceIds, setSelectedNodeIdForPieMenu,
    setSemanticOrbitActive, setSwapPrompt, singleSelectedInstanceId, startHurtleAnimation: (...args) => startHurtleAnimation(...args), storeActions, wizardEnabled,
  }), [singleSelectedInstanceId, storeActions, setSelectedInstanceIds, selectedNodeIdForPieMenu, previewingNodeId, nodes, activeGraphId, abstractionCarouselVisible, carouselAnimationState, markClipboardChanged, handlePieMenuColorPickerOpen, savedNodeIds, wizardEnabled]);

  // Pie Menu Button Configuration - now targetPieMenuButtons and dynamic
  const targetPieMenuButtons = useMemo(() => buildTargetPieMenuButtons({
    abstractionCarouselNode, abstractionCarouselVisible, activeGraphId, carouselAnimationState, carouselFocusedNode, carouselPieMenuStage,
    currentAbstractionDimension, nodeDefinitionIndices, nodePieMenuPages, nodes, pieMenuPage, previewingNodeId,
    selectedNodeIdForPieMenu, setAbstractionPrompt, setCarouselFocusPrototypeRequest, setGroupControlPanelShouldShow, setIsCarouselStageTransition, setIsPieMenuActionInProgress,
    setIsTransitioningPieMenu, setJustCompletedCarouselExit, setNodeControlPanelShouldShow, setNodeControlPanelVisible, setNodeDefinitionIndices, setPendingSwapOperation,
    setPreviewingNodeId, setSelectedGroup, setSelectedInstanceIds, setSelectedNodeIdForPieMenu, startHurtleAnimation: (...args) => startHurtleAnimation(...args), storeActions,
    wizardEnabled,
  }), [nodePieMenuPages, storeActions, setSelectedInstanceIds, setPreviewingNodeId, selectedNodeIdForPieMenu, previewingNodeId, nodes, activeGraphId, abstractionCarouselVisible, abstractionCarouselNode, carouselPieMenuStage, carouselFocusedNode, currentAbstractionDimension, carouselAnimationState, nodeDefinitionIndices, setNodeDefinitionIndices, handleNodeConvertToNodeGroup, pieMenuPage, wizardEnabled]);

  // Data for the decomposition CONTROL PANEL (mirrors the decomposition pie-menu state).
  // Non-null whenever a node is being previewed/decomposed; supplies the current definition
  // index, nav availability, and a setter so the panel's options match the pie menu.
  const decomposePanelInfo = useMemo(() => buildDecomposePanelInfo({
    activeGraphId, nodeDefinitionIndices, nodePrototypesMap, nodes, previewingNodeId, setNodeDefinitionIndices,
  }), [previewingNodeId, nodes, nodePrototypesMap, activeGraphId, nodeDefinitionIndices, setNodeDefinitionIndices]);

  // Keep currentPieMenuData.buttons in sync with targetPieMenuButtons so UI reflects state changes (e.g., Save/Unsave) immediately
  useEffect(() => {
    setCurrentPieMenuData(prev => prev ? { ...prev, buttons: targetPieMenuButtons } : prev);
  }, [targetPieMenuButtons]);

  // Reset the pie menu back to its first page whenever the targeted node changes
  // (including when the menu closes). Page state only applies to the default node menu.
  useEffect(() => {
    setPieMenuPage(0);
  }, [selectedNodeIdForPieMenu]);

  // Effect to restore view state on graph change or center if no stored state.
  // IMPORTANT: Does NOT depend on graphsMap — we read it imperatively to avoid
  // snapping the view back whenever any graph mutation changes the graphsMap ref.
  useLayoutEffect(() => restoreViewForGraph({
    draggingNodeInfoRef, isAnimatingZoomRef, wasDraggingRef, setIsViewReady, activeGraphId, viewportSize,
    canvasSize, transform,
  }), [activeGraphId, viewportSize, canvasSize]);

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
  useEffect(() => saveViewWhenSettled({
    activeGraphId, panOffset, zoomLevel, saveViewStateTimeout, pinchRef, draggingNodeInfo, isAnimatingZoomRef,
    isPanningOrZooming, draggingNodeInfoRef, updateGraphViewInStore,
  }), [activeGraphId, panOffset, zoomLevel, updateGraphViewInStore, draggingNodeInfo]);

  // --- Utility Functions ---

  const clampCoordinates = (x, y) => {
    return GeometryUtils.clampCoordinates(x, y, canvasSize);
  };


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
    return GeometryUtils.isInsideNode(nodeData, clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize, previewingNodeId);
  };

  // The selection a live box leaves (utils/canvas/canvasHitTest.js).
  const selectionFromRect = (rect) => selectionInRect(rect, nodes, selectionBaseRef.current, previewingNodeId);

  // The marquee, for mouse and pad alike (P1.04). The box is written straight
  // to the <rect>; the selection is re-derived at most once a frame and reaches
  // React only when its membership changes. Points are canvas-space.
  const beginMarquee = (x, y) => {
    selectionStartRef.current = { x, y };
    setSelectionStart({ x, y });
    marqueeBoxRef.current = { x, y, width: 0, height: 0 };
    // Extend whatever was already selected (see selectionFromRect).
    selectionBaseRef.current = new Set([...selectedInstanceIds]);
    marqueeSelectionRef.current = selectionBaseRef.current;
  };
  // Assigned every render so a queued frame uses the current nodes.
  marqueePassRef.current = () => {
    const box = marqueeBoxRef.current;
    if (!selectionStartRef.current || !box) return marqueeSelectionRef.current;
    const next = selectionFromRect(box);
    const prev = marqueeSelectionRef.current;
    if (!prev || prev.size !== next.size || [...next].some((id) => !prev.has(id))) {
      marqueeSelectionRef.current = next;
      setSelectedInstanceIds(next);
    }
    return marqueeSelectionRef.current;
  };
  const updateMarquee = (x, y) => {
    const start = selectionStartRef.current;
    if (!start) return;
    marqueeBoxRef.current = {
      x: Math.min(start.x, x), y: Math.min(start.y, y),
      width: Math.abs(x - start.x), height: Math.abs(y - start.y),
    };
    setMarqueeRectEl(marqueeRectElRef.current);
    if (marqueeRafRef.current) return;
    marqueeRafRef.current = requestAnimationFrame(() => { marqueeRafRef.current = 0; marqueePassRef.current?.(); });
  };
  // Runs a final pass now, retires the box, and returns the selection it leaves.
  const endMarquee = () => {
    cancelAnimationFrame(marqueeRafRef.current);
    marqueeRafRef.current = 0;
    const final = marqueePassRef.current?.() ?? new Set();
    selectionStartRef.current = null;
    marqueeBoxRef.current = null;
    setSelectionStart(null);
    return final;
  };

  // Check if a client-space point hits a thing group's title area, returns the group or null
  const findGroupTitleAtPoint = (clientX, clientY) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    // Convert client to canvas coordinates
    const { x: canvasX, y: canvasY } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);

    return groupTitleAtCanvasPoint(canvasX, canvasY, anchorPositionUpdatesRef.current);
  };

  // The offsets a group drag needs (utils/canvas/canvasHitTest.js).
  const buildGroupDragOffsets = (group, members, isNodeGroup, canvasX, canvasY) => groupDragOffsets(
    group, members, isNodeGroup, canvasX, canvasY,
    { nodes, childGroupIdsByGroupId: childGroupIdsByGroupIdRef.current, groupsById: groupsByIdRef.current },
  );

  /**
   * Start a group drag from a client point — the pill's long-press path and the
   * controller's trigger both end up here.
   */
  const startGroupDragAtPointRef = useRef(null);
  startGroupDragAtPointRef.current = (groupId, clientX, clientY) => {
    const group = groupsByIdRef.current.get(groupId);
    if (!group || !containerRef.current) return false;
    const rect = containerRef.current.getBoundingClientRect();
    const { x: canvasX, y: canvasY } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
    const memberIdSet = new Set(group.memberInstanceIds || []);
    const members = nodes.filter(n => memberIdSet.has(n.id));
    const offsets = buildGroupDragOffsets(group, members, !!group.linkedNodePrototypeId, canvasX, canvasY);
    nodeDrag.startGroupDrag(groupId, offsets, clientX, clientY);
    return true;
  };

  // What a connection release at this point would attach to — the same test
  // handleMouseUp runs, factored out so the in-flight hover haptic can never
  // promise a target the drop would then reject. Returns an instance id or null.
  //
  // Hoists the container rect out of the node loop: isInsideNode reads it on
  // every call, which would be a forced layout per node per pointermove.
  const findConnectionDropTarget = (clientX, clientY) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    for (const n of nodes) {
      if (n.isGroupAnchor) continue;
      if (GeometryUtils.isInsideNode(n, clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize, previewingNodeId)) {
        return n.id;
      }
    }
    const hitGroup = findGroupTitleAtPoint(clientX, clientY);
    return hitGroup ? hitGroup.anchorInstanceId : null;
  };

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

  // --- Connection hit-testing (shared by hover, click and touch) -------------
  //
  // The nearest connection to a canvas point: utils/canvas/edgeHitTest.js.
  const findNearestEdgeAtCanvasPoint = useCallback((cx, cy, threshold, options) => findNearestEdge(cx, cy, threshold, {
    visibleEdges, nodeById, baseDimsById, previewingNodeId, edgeCurveInfo, nodePrototypesMap,
    enableAutoRouting, routingStyle, cleanLaneOffsets, cleanLaneSpacing, manhattanBends,
    lombardiTangents, lombardiCurvature, lombardiLaneSpacing, orthogonalLaneSpacing, curveSpacing,
    lombardiMinBow, anchorGeometryFor, labelTruncationRef,
  }, options), [visibleEdges, nodeById, baseDimsById, previewingNodeId, edgeCurveInfo, nodePrototypesMap,
    enableAutoRouting, routingStyle, cleanLaneOffsets, cleanLaneSpacing, manhattanBends,
    lombardiTangents, lombardiCurvature, lombardiLaneSpacing, orthogonalLaneSpacing, curveSpacing,
    lombardiMinBow, anchorGeometryFor]);

  // Grab radius for the hit-test above, in canvas units: see edgeHitThreshold.
  const getEdgeHitThreshold = useCallback((pointerKind = 'mouse') => (
    edgeHitThreshold(pointerKind, isRoutedStyle, connectionWidth, zoomLevelRef.current)
  ), [isRoutedStyle, connectionWidth]);

  // Client-space wrapper around the two above.
  const findEdgeAtClientPoint = useCallback((clientX, clientY, pointerKind = 'mouse') => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const { x: cx, y: cy } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
    return findNearestEdgeAtCanvasPoint(cx, cy, getEdgeHitThreshold(pointerKind));
  }, [findNearestEdgeAtCanvasPoint, getEdgeHitThreshold, canvasSize]);

  // Select an edge from a mouse click on its line/path hitbox. When several
  // connections overlap, the topmost SVG hitbox receives the click but is not
  // necessarily the one closest to the pointer, so we prefer the nearest edge
  // computed by the hover hit-test (hoveredEdgeInfo in canvasUIStore). Falls back
  // to the clicked edge when no hover has been computed (e.g. the pointer never
  // moved over the canvas first).
  const selectEdgeFromClick = useCallback((clickedEdgeId, e) => {
    const targetEdgeId = useCanvasUIStore.getState().hoveredEdgeInfo?.edgeId
      || findEdgeAtClientPoint(e.clientX, e.clientY, 'mouse')?.edgeId
      || clickedEdgeId;
    haptic('edgeSelect');
    if (e.ctrlKey || e.metaKey) {
      if (selectedEdgeIds.has(targetEdgeId)) {
        storeActions.removeSelectedEdgeId(targetEdgeId);
      } else {
        storeActions.addSelectedEdgeId(targetEdgeId);
      }
    } else {
      storeActions.clearSelectedEdgeIds();
      storeActions.setSelectedEdgeId(targetEdgeId);
    }
  }, [selectedEdgeIds, storeActions, findEdgeAtClientPoint]);

  // Nearest-wins resolution for a touch/pen tap that landed on a connection's
  // transparent stroke. The topmost stroke receives the event, which in a curved
  // bundle (Lombardi arcs, parallel fans) is routinely not the connection under
  // the finger. Mouse clicks correct for this via the hover ref; touch has no
  // hover to lean on, so it re-runs the geometry.
  const resolveTouchEdgeTarget = useCallback((fallbackEdgeId, e) => {
    const x = e?.clientX ?? e?.touches?.[0]?.clientX;
    const y = e?.clientY ?? e?.touches?.[0]?.clientY;
    if (typeof x !== 'number' || typeof y !== 'number') return fallbackEdgeId;
    return findEdgeAtClientPoint(x, y, 'touch')?.edgeId || fallbackEdgeId;
  }, [findEdgeAtClientPoint]);

  // --- Deferred touch selection for connections ------------------------------
  //
  // Touch used to select the connection on touchdown. That made a pan which merely
  // STARTED on a line leave that line selected once your finger came up somewhere
  // else entirely — the gesture was a pan, but the line had already claimed it.
  // Mouse has never behaved this way (it selects on click, i.e. on release).
  //
  // So: touchdown only *records* a candidate, movement past the slop cancels it,
  // and release commits it. The edge id is resolved at touchdown, where the finger
  // position is known and nearest-wins can run — touchend carries no touches[] to
  // re-resolve from.
  const pendingEdgeTouchRef = useRef(null);
  const EDGE_TAP_SLOP_PX = 10;

  const beginEdgeTouch = useCallback((edgeId, e) => {
    // A finger landing while the view is moving is catching it — it selects
    // nothing, the same rule nodes and group titles follow.
    if (isViewMoving()) { pendingEdgeTouchRef.current = null; return; }
    const x = e?.clientX ?? e?.touches?.[0]?.clientX;
    const y = e?.clientY ?? e?.touches?.[0]?.clientY;
    if (typeof x !== 'number' || typeof y !== 'number') { pendingEdgeTouchRef.current = null; return; }
    pendingEdgeTouchRef.current = {
      edgeId: resolveTouchEdgeTarget(edgeId, e),
      x, y,
      additive: Boolean(e?.ctrlKey || e?.metaKey),
    };
  }, [resolveTouchEdgeTarget, isViewMoving]);

  const moveEdgeTouch = useCallback((e) => {
    const pending = pendingEdgeTouchRef.current;
    if (!pending) return;
    const x = e?.clientX ?? e?.touches?.[0]?.clientX;
    const y = e?.clientY ?? e?.touches?.[0]?.clientY;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (Math.hypot(x - pending.x, y - pending.y) > EDGE_TAP_SLOP_PX) {
      pendingEdgeTouchRef.current = null; // it's a pan — this line never gets selected
    }
  }, []);

  const cancelEdgeTouch = useCallback(() => {
    pendingEdgeTouchRef.current = null;
  }, []);

  const commitEdgeTouch = useCallback((e) => {
    const pending = pendingEdgeTouchRef.current;
    pendingEdgeTouchRef.current = null;
    if (!pending) return;
    // Release position, when we have one — a gesture can outrun moveEdgeTouch
    // (coalesced moves, a fast flick) and still land far from where it began.
    const x = e?.clientX ?? e?.changedTouches?.[0]?.clientX;
    const y = e?.clientY ?? e?.changedTouches?.[0]?.clientY;
    if (typeof x === 'number' && typeof y === 'number'
      && Math.hypot(x - pending.x, y - pending.y) > EDGE_TAP_SLOP_PX) return;

    haptic('edgeSelect');
    // Double-tap → open definition. Counted on release for the same reason
    // selection is: a pan is not a tap and must not accumulate toward one.
    handleEdgePointerDownTouch(pending.edgeId, { pointerType: 'touch', preventDefault: () => { }, stopPropagation: () => { } });
    if (pending.additive) {
      if (selectedEdgeIds.has(pending.edgeId)) {
        storeActions.removeSelectedEdgeId(pending.edgeId);
      } else {
        storeActions.addSelectedEdgeId(pending.edgeId);
      }
    } else {
      storeActions.clearSelectedEdgeIds();
      storeActions.setSelectedEdgeId(pending.edgeId);
    }
  }, [selectedEdgeIds, storeActions, handleEdgePointerDownTouch]);

  // The touch half of an edge hitbox's handlers, shared by every hitbox that draws
  // one (the shared helper below and the per-routing-style inline strokes).
  const edgeTouchHandlers = useCallback((edgeId) => ({
    onPointerDown: (e) => {
      if (!e.pointerType || e.pointerType === 'mouse') return false;
      e.preventDefault?.();
      e.stopPropagation?.();
      ignoreCanvasClick.current = true; // suppress canvas click -> plus sign
      setLongPressingInstanceId(null);  // prevent connection drawing intent
      setDrawingConnectionFrom(null);
      beginEdgeTouch(edgeId, e);
      return true;
    },
    onPointerMove: moveEdgeTouch,
    onPointerUp: commitEdgeTouch,
    onPointerCancel: cancelEdgeTouch,
    // Deliberately NOT stopping propagation here: the canvas's own touch pipeline
    // (handleTouchStartCanvas) has to see this touch, or a gesture that begins on a
    // connection can't pan at all. It owns preventDefault and ignoreCanvasClick; we
    // only record the selection candidate and let the pan machinery run.
    onTouchStart: (e) => {
      setLongPressingInstanceId(null);
      setDrawingConnectionFrom(null);
      beginEdgeTouch(edgeId, e);
    },
    onTouchMove: moveEdgeTouch,
    onTouchEnd: commitEdgeTouch,
    onTouchCancel: cancelEdgeTouch,
  }), [beginEdgeTouch, moveEdgeTouch, commitEdgeTouch, cancelEdgeTouch]);

  // Select a connection from a bare-canvas tap — the touch counterpart of the
  // mouse hover→click path. The transparent SVG stroke is a narrow fast path;
  // this catches everything inside the (much larger) touch grab radius that
  // missed it. Nodes keep priority: they paint above connections and claim
  // their own taps, and a tap that lands inside one is never redirected here.
  // Returns true if a connection was selected.
  const trySelectConnectionAtPoint = useCallback((clientX, clientY) => {
    if (!containerRef.current) return false;
    const rect = containerRef.current.getBoundingClientRect();
    for (const n of nodes) {
      if (n.isGroupAnchor) continue;
      if (GeometryUtils.isInsideNode(n, clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize, previewingNodeId)) {
        return false;
      }
    }
    const hit = findEdgeAtClientPoint(clientX, clientY, 'touch');
    if (!hit) return false;
    haptic('edgeSelect');
    storeActions.clearSelectedEdgeIds();
    storeActions.setSelectedEdgeId(hit.edgeId);
    return true;
  }, [nodes, canvasSize, previewingNodeId, findEdgeAtClientPoint, storeActions]);

  // Shared pointer handlers for edge hitboxes (line stroke + label rect) so the
  // connection label text is just as clickable as the line itself.
  const getEdgeHitboxHandlers = useCallback((edgeId) => ({
    ...edgeTouchHandlers(edgeId),
    onClick: (e) => {
      e.stopPropagation();
      ignoreCanvasClick.current = true;
      haptic('edgeSelect');
      if (e.ctrlKey || e.metaKey) {
        if (selectedEdgeIds.has(edgeId)) {
          storeActions.removeSelectedEdgeId(edgeId);
        } else {
          storeActions.addSelectedEdgeId(edgeId);
        }
      } else {
        storeActions.clearSelectedEdgeIds();
        storeActions.setSelectedEdgeId(edgeId);
      }
    },
    onDoubleClick: (e) => {
      e.stopPropagation();
      const state = useGraphStore.getState();
      const edge = state.edges?.get?.(edgeId);
      let definingNodeId = null;
      if (edge?.definitionNodeIds && edge.definitionNodeIds.length > 0) {
        definingNodeId = edge.definitionNodeIds[0];
      } else if (edge?.typeNodeId) {
        definingNodeId = edge.typeNodeId;
      }
      if (definingNodeId) {
        storeActions.openRightPanelNodeTab(definingNodeId);
      }
    },
  }), [selectedEdgeIds, storeActions, edgeTouchHandlers]);

  // Canvas pointer handlers (P4.04a: components/canvas/input/pointerHandlers.js):
  // node press, pointer move/press/release, the canvas click, the connection-draw
  // start and keyboard pan travel. Created once; pointerCtxRef is assigned on
  // every render, just before the JSX.
  const pointerCtxRef = useRef(null);
  const pointer = useMemo(() => createPointerHandlers(pointerCtxRef), []);
  const {
    handleNodeMouseDown, beginConnectionDrawFromNode, handleKeyboardPanTravel, handleMouseMove,
    handleMouseDown, handleMouseUp, handleMouseUpCanvas, handleCanvasClick,
  } = pointer;

  // Wheel zoom and pan, with the trackpad/mouse discrimination: the camera controller (P4.02).
  const handleWheel = camera.handleWheel;

  useEffect(() => camera.attachWheelGuard(), [camera, trackpadZoomEnabled]);

  // Safari gesture events (macOS trackpad pinch) zoom the canvas: the camera controller (P4.02).
  useEffect(() => camera.attachGestures(), [camera, MIN_ZOOM, MAX_ZOOM, trackpadZoomEnabled]);

  // --- Touch helpers for canvas interactions (moved here to ensure refs/state are initialized) ---
  const touch = useCanvasTouch({
    containerRef,
    panOffsetRef,
    zoomLevelRef,
    canvasSize,
    activeGraphId,
    startDragForNode,
    handleMouseMove,
    handleMouseUp,
    handleMouseDown,
    setPanStart,
    setIsPanning,
    setPanAndZoom,
    stopPanMomentum,
    isViewMoving,
    cancelConnectionDraw,
    startZoomMomentum,
    stopZoomMomentum,
    storeActions,
    selectedInstanceIds,
    setSelectedInstanceIds,
    selectedEdgeId,
    selectedEdgeIds,
    plusSign,
    setPlusSign,
    nodeNamePrompt,
    previewingNodeId,
    selectedNodeIdForPieMenu,
    setSelectedNodeIdForPieMenu,
    drawingConnectionFrom,
    setDrawingConnectionFrom,
    draggingNodeInfo,
    setDraggingNodeInfo: nodeDrag.cancelDrag,
    draggingNodeInfoRef,
    isAnimatingZoomRef,
    isPanningOrZooming,
    panSourceRef,
    panVelocityHistoryRef,
    isMouseDown,
    mouseMoved,
    startedOnNode,
    mouseInsideNode,
    mouseDownPosition,
    groupControlPanelShouldShow,
    groupControlPanelVisible,
    setGroupControlPanelVisible,
    connectionControlPanelShouldShow,
    connectionControlPanelVisible,
    setConnectionControlPanelVisible,
    selectedGroup,
    setSelectedGroup,
    isInsideNode,
    getNodeDimensions,
    clampCoordinates,
    isTouchDeviceRef,
    suppressNextMouseDownRef,
    nodes,
    pinchRef,
    pinchSmoothingRef,
    ignoreCanvasClick,
    armGestureBlock,
    scheduleGestureBlockClear,
    touchSettings,
    nodeLiftDelay,
    tryToggleConnectionOrbAtPoint,
    trySelectConnectionAtPoint,
    abstractionCarouselVisibleRef,
  });

  // Prevent native long-press context menu on touch devices (iOS/Android)
  useEffect(() => {

    const preventContextMenu = (e) => {
      if (isTouchDeviceRef.current || likelyTouch()) {
        try { e.preventDefault(); } catch { }
      }
    };
    document.addEventListener('contextmenu', preventContextMenu, { passive: false });
    return () => document.removeEventListener('contextmenu', preventContextMenu);
  }, []);

  // Re-point every render so the once-mounted keyboard loop never calls a stale
  // closure (this reads render-scope values like `nodes` and `previewingNodeId`).
  useEffect(() => {
    keyboardPanTravelRef.current = handleKeyboardPanTravel;
  });


  const handlePlusSignClick = () => {
    if (!plusSign) return;
    if (plusSign.mode === 'morph' || plusSign.mode === 'preparing' || plusSign.mode === 'landed') return;

    // Special Y-key video animation mode (session-only)
    if (keysPressed.current['y']) {
      // Store position and trigger video animation
      setVideoAnimation({ x: plusSign.x, y: plusSign.y, active: true });
      setPlusSign(null); // Immediately remove plus sign
      return;
    }

    setNodeNamePrompt({ visible: true, name: '' });
  };

  const handleClosePrompt = () => {
    if (!nodeNamePrompt.name.trim()) {
      setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
    }
    setNodeNamePrompt({ visible: false, name: '', color: null });
    setDialogColorPickerVisible(false); // Close color picker when closing prompt
  };

  const handleAbstractionSubmit = (a0) => submitAbstraction(a0, {
    abstractionCarouselNode, abstractionPrompt, currentAbstractionDimension, nodePrototypesMap, nodes, setAbstractionCarouselVisible,
    setAbstractionPrompt, setCarouselFocusPrototypeRequest, setCarouselPieMenuStage, setIsCarouselStageTransition, setSelectedNodeIdForPieMenu, storeActions,
  });

  const handleNodeSelection = (nodePrototype) => choosePlusSignNode(nodePrototype, {
    activeGraphId, decodeThumbnail, getPlusSignMorphNode, nodePrototypesMap, plusSign, setNodeNamePrompt,
    setPlusSign, waitForCachedImage,
  });

  // The node the morph is turning into, shaped the way the `nodes` memo will hydrate
  // it — including its image. A name-only stand-in sizes the morph (and the final
  // placement) as a text node, so an image node snaps to its real height on landing.
  const getPlusSignMorphNode = (ps) => {
    const proto = ps.selectedPrototype
      ? (nodePrototypesMap.get(ps.selectedPrototype.id) || ps.selectedPrototype)
      : null;
    if (!proto) return { name: ps.tempName };
    // Mirrors the image resolution in the `nodes` memo. Read live, not from the
    // render-time imageCacheMap: the fetch in handleNodeSelection can land after
    // the render whose closures the morph callbacks captured.
    const cached = useImageCache.getState().images[proto.id];
    const thumbnailSrc = (cached && !proto.thumbnailSrc) ? cached.thumbnailSrc : (proto.thumbnailSrc || null);
    const imageAspectRatio = (cached && !proto.thumbnailSrc)
      ? cached.imageAspectRatio
      : (proto.imageAspectRatio ?? proto.semanticMetadata?.imageAspectRatio);
    return { name: proto.name, thumbnailSrc, imageAspectRatio };
  };

  // Where the morph ends: the node's full dims and the canvas point its center
  // lands on. With the grid on that's the snapped vertex, and the PlusSign glides
  // there DURING the morph — placing the node at the snap afterwards made it
  // teleport from the plus position to the grid on landing.
  const getPlusSignMorphTarget = (ps) => {
    const morphNode = getPlusSignMorphNode(ps);
    const dims = getNodeDimensions(morphNode, false, null);
    let center = { x: ps.x, y: ps.y };
    if (gridMode !== 'off') {
      const snapped = snapToGridAnimated(ps.x, ps.y, dims.currentWidth, dims.currentHeight, null);
      center = { x: snapped.x + dims.currentWidth / 2, y: snapped.y + dims.currentHeight / 2 };
    }
    return { morphNode, dims, center };
  };

  // After the morph, the PlusSign holds its last frame ('landed') until the new
  // instance is actually in the visible set. Culling admits it a frame or two after
  // the store commit (effect → rAF → setVisibleNodeIds), and dropping the PlusSign
  // in the same commit as the add left that gap empty — a one-frame flash.
  // Layout effect so the swap lands in a single paint.
  const landedInstanceId = plusSign?.mode === 'landed' ? plusSign.landedInstanceId : null;
  useLayoutEffect(() => {
    if (!landedInstanceId) return;
    if (visibleNodeIds.has(landedInstanceId)) {
      setPlusSign(null);
      return;
    }
    // Safety net: never leave the placeholder stranded if the node doesn't show up.
    const t = setTimeout(() => setPlusSign(ps => (ps?.landedInstanceId === landedInstanceId ? null : ps)), 500);
    return () => clearTimeout(t);
  }, [landedInstanceId, visibleNodeIds]);

  const handleMorphDone = () => {
    if (!plusSign || !activeGraphId) return;

    // Same target the morph animated to, so the node lands exactly under it.
    const { dims, center } = getPlusSignMorphTarget(plusSign);
    const position = {
      x: center.x - dims.currentWidth / 2,
      y: center.y - dims.currentHeight / 2,
    };

    const newInstanceId = uuidv4();
    let added = false;
    if (plusSign.selectedPrototype) {
      // A prototype was selected from the grid - create instance of existing prototype
      storeActions.addNodeInstance(activeGraphId, plusSign.selectedPrototype.id, position, newInstanceId);
      added = true;
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
      storeActions.addNodeInstance(activeGraphId, newPrototypeId, position, newInstanceId);
      added = true;
    }

    setPlusSign(added ? { ...plusSign, mode: 'landed', landedInstanceId: newInstanceId } : null);
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
    if (!hasPieMenuData || !selectedNodeIdForPieMenu) {
      setPieMenuColorPickerVisible(false);
      setActivePieMenuColorNodeId(null);
    }
  }, [hasPieMenuData, selectedNodeIdForPieMenu]);

  const shouldPanelsBeExclusive = (windowSize?.width ?? window.innerWidth) <= EXCLUSIVE_PANEL_MODE_THRESHOLD;

  // The store's toggles close the opposite panel themselves in exclusive mode,
  // so every open path (toggle buttons, node double-click/double-tap, pie menu)
  // behaves the same way.
  const handleToggleRightPanel = useCallback(() => {
    storeActions.toggleRightPanel();
  }, [storeActions]);

  const handleToggleLeftPanel = useCallback(() => {
    storeActions.toggleLeftPanel();
  }, [storeActions]);

  // Only reachable by resizing into exclusive mode with both panels already
  // open — opening a panel below the threshold closes the other in the store.
  useEffect(() => {
    if (shouldPanelsBeExclusive && leftPanelExpanded && rightPanelExpanded) {
      storeActions.setRightPanelExpanded(false);
    }
  }, [leftPanelExpanded, rightPanelExpanded, shouldPanelsBeExclusive, storeActions]);

  // Panel toggle and TypeList keyboard shortcuts - work even when inputs are focused
  useEffect(() => listenForShellShortcuts({
    setHeaderSearchVisible, setNewWebPrompt, handleToggleLeftPanel, handleToggleRightPanel, storeActions,
  }), [handleToggleLeftPanel, handleToggleRightPanel, storeActions]);

  // Integrated keyboard handling via custom hook
  // --- Game controller -------------------------------------------------------
  // Ref mirrors of the values the controller tick reads every frame. They exist
  // so the tick never has to be rebuilt (and so the rAF that calls it never has
  // to re-subscribe) when any of these change.
  const activeGraphIdRef = useRef(activeGraphId);
  activeGraphIdRef.current = activeGraphId;
  const pieMenuButtonsRef = useRef(targetPieMenuButtons);
  pieMenuButtonsRef.current = targetPieMenuButtons;
  const pieMenuPageCountRef = useRef(1);
  pieMenuPageCountRef.current = nodePieMenuPages.length;
  const pieMenuNodeIdRef = useRef(null);
  pieMenuNodeIdRef.current = selectedNodeIdForPieMenu;
  // The controller drops a carried node through the real release path rather
  // than a parallel one, so group-drop detection, click suppression and the
  // save signalling all behave exactly as they do for a mouse. handleMouseUp
  // only ever reads clientX/clientY off its argument, so a plain object does.
  const releasePointerRef = useRef(null);
  releasePointerRef.current = handleMouseUp;
  // Left trigger draws a connection. beginConnectionDrawFromNode refuses unless
  // the pointer has left the source node OR the gesture began on it — with a
  // mouse those are the two ways a drag can look. The crosshair is sitting dead
  // on the node when the trigger goes down, so this is the second case, and
  // saying so is what lets the same function serve the controller. The draw
  // then tracks the crosshair as the canvas pans, and releasing over another
  // node lands the edge through the ordinary release path.
  // The connection menu's slope, mirrored for the controller's aiming. Its
  // buttons already live in edgePieMenuButtonsRef.
  const edgeAnchorAngleRef = useRef(0);
  edgeAnchorAngleRef.current = selectedEdgeMidpoint?.angle ?? 0;
  const findEdgeAtClientPointRef = useRef(null);
  findEdgeAtClientPointRef.current = findEdgeAtClientPoint;
  // A connection's endpoint orbs, as the controller sees them: what the
  // crosshair is standing on, and the one thing A does with it.
  //
  // Orbs only exist while their connection is hovered or selected, so this is
  // empty almost all of the time — which is what keeps a target this large from
  // shadowing the nodes it sits against. The padding is 1 (the disc as drawn):
  // the crosshair is a cursor, not a finger, and it has the auto-aim drift
  // pulling the orb under it besides.
  const connectionOrbControlRef = useRef(null);
  connectionOrbControlRef.current = {
    findAt: (clientX, clientY) => findConnectionOrbAtPoint(clientX, clientY, 1),
    toggle: (orb) => toggleConnectionOrbArrow(orb),
  };
  // The plus sign, as the controller sees it: where it is, how big its target
  // is, and the three things A and B can do to it. Bundled into one ref rather
  // than five because they are only ever used together, and because the hook
  // needs the CURRENT sign each frame — a captured value would go stale the
  // moment the sign appeared.
  const plusSignControlRef = useRef(null);
  plusSignControlRef.current = {
    // Only a settled plus sign is a target. One that is animating away, or
    // morphing into a node, is already committed to an outcome.
    sign: plusSign && plusSign.mode === 'appear' ? plusSign : null,
    // Half-extent of the hit square, in canvas units. Mirrors the invisible
    // rect PlusSign draws for touch (max(44, size)), so the controller's target
    // is the same size as everyone else's.
    halfHit: Math.max(44, PLUS_SIGN_SIZE * (textSettings?.plusSignScale ?? 1.0)) / 2,
    create: (clientX, clientY) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { x, y } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
      setPlusSign({ x, y, mode: 'appear', tempName: '' });
    },
    activate: () => handlePlusSignClick(),
    dismiss: () => {
      // Same guard the canvas click path uses: a morphing plus is committed.
      if (!plusSign || plusSign.mode === 'morph' || plusSign.mode === 'preparing' || plusSign.mode === 'landed') return;
      setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
    },
  };

  /**
   * Groups, as the controller sees them: what the crosshair is over, and the
   * three things it can do with one.
   *
   * A group's whole interactive surface is its title pill — that is what the
   * mouse clicks to select, double-clicks to rename, and long-presses to drag
   * the group by — so the pad aims at the same pill rather than at the box,
   * which would otherwise swallow every node inside it.
   */
  const groupControlRef = useRef(null);
  groupControlRef.current = {
    /**
     * The group whose title pill is under this point, with the pill's rect.
     *
     * Reads groupTitleRectsRef, which carries EVERY group — not
     * findGroupTitleAtPoint, whose map only ever held node-group anchors and so
     * made plain groups invisible to the pad. Deepest-first, because a nested
     * group's pill sits on top of its parent's shell and is the one drawn over
     * the point; findGroupTitleAtPoint's insertion-order scan would hand back
     * the parent.
     */
    findAt: (clientX, clientY) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const { x: canvasX, y: canvasY } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
      const depths = groupDepthByGroupIdRef.current;
      let best = null;
      let bestDepth = -Infinity;
      for (const [groupId, info] of groupTitleRectsRef.current.entries()) {
        if (canvasX < info.x || canvasX > info.x + info.width
          || canvasY < info.y || canvasY > info.y + info.height) continue;
        const depth = depths.get(groupId) ?? 0;
        if (depth < bestDepth) continue;
        bestDepth = depth;
        best = {
          groupId,
          anchorInstanceId: info.anchorInstanceId,
          // Canvas-space centre of the pill: where the auto-aim drift pulls to,
          // the same way a node drifts to its centre.
          center: { x: info.x + info.width / 2, y: info.y + info.height / 2 },
        };
      }
      return best;
    },
    /**
     * Select a group, exactly as a single click on its title does — including
     * clearing the node and edge selections. Those clears are not tidiness:
     * without them the Node and Connection panel effects see a stale selection
     * and stomp selectedGroup back to null in the same flush.
     */
    select: (groupId) => {
      const group = groupsByIdRef.current.get(groupId);
      if (!group) return false;
      setSelectedGroup(group);
      setSelectedInstanceIds(new Set());
      storeActions.setSelectedEdgeId(null);
      storeActions.clearSelectedEdgeIds();
      setGroupControlPanelShouldShow(true);
      setNodeControlPanelShouldShow(false);
      setNodeControlPanelVisible(false);
      setAbstractionControlPanelVisible(false);
      setAbstractionControlPanelShouldShow(false);
      setConnectionControlPanelVisible(false);
      setConnectionControlPanelShouldShow(false);
      return true;
    },
    dismiss: () => setSelectedGroup(null),
    /** Whether a group is selected right now — the pad re-derives its mode from this. */
    selectedId: () => selectedGroup?.id ?? null,
    startDrag: (groupId, clientX, clientY) => startGroupDragAtPointRef.current?.(groupId, clientX, clientY) === true,
  };

  /**
   * The selection box, as the controller draws it.
   *
   * A mouse marquee is a pointer travelling across a still canvas. A pad's is
   * the opposite — the crosshair is nailed to the middle of the screen and the
   * CANVAS travels underneath it — but the rectangle itself is in canvas
   * coordinates either way, so anchoring one corner and tracking the crosshair
   * with the other produces the same box from the opposite motion.
   */
  const marqueeControlRef = useRef(null);
  marqueeControlRef.current = {
    begin: (clientX, clientY) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return false;
      const { x, y } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
      beginMarquee(x, y);
      return true;
    },
    /**
     * Called every frame the box is live, from inside the controller's rAF
     * tick. Same path as the mouse: the box is written to the DOM at once and
     * the selection follows at most a frame later.
     */
    update: (clientX, clientY) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { x, y } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
      updateMarquee(x, y);
    },
    /**
     * Ends the box and reports how many instances it leaves selected, as
     * endMarquee computed them.
     */
    end: () => endMarquee().size,
  };

  /**
   * The canvas context menu, as the controller raises it.
   *
   * Declared here and FILLED IN further down, after getCanvasContextMenuOptions
   * exists — the options are assembled from clipboard contents and feature
   * flags that are themselves derived below this point, and the controller only
   * ever calls through the ref from inside its own tick, long after the render
   * that populates it.
   */
  const canvasContextMenuControlRef = useRef(null);

  const startConnectionFromNodeRef = useRef(null);
  startConnectionFromNodeRef.current = (instanceId, clientX, clientY) => {
    startedOnNode.current = true;
    return beginConnectionDrawFromNode(instanceId, clientX, clientY);
  };

  const {
    gamepadTickRef,
    gamepadActive,
    gamepadMode,
    pieFocusedIndex: gamepadPieFocusedIndex,
  } = useGamepad({
    containerRef,
    viewportBoundsRef,
    panOffsetRef,
    zoomLevelRef,
    canvasSizeRef,
    mousePositionRef,
    nodesRef,
    visibleNodeIdsRef,
    startDragForNodeRef: nodeDrag.startDragForNodeRef,
    draggingNodeInfoRef: nodeDrag.draggingNodeInfoRef,
    dragPhaseRef: nodeDrag.dragPhaseRef,
    releasePointerRef,
    startConnectionFromNodeRef,
    drawingConnectionFromRef,
    plusSignControlRef,
    groupControlRef,
    marqueeControlRef,
    canvasContextMenuControlRef,
    panelResizeControlRef,
    setSelectedInstanceIds,
    selectedInstanceIdsRef,
    commitHoverTarget,
    clearHoverImmediate,
    pieMenuButtonsRef,
    pieMenuPageCountRef,
    pieMenuNodeIdRef,
    edgePieMenuButtonsRef,
    edgeAnchorAngleRef,
    findEdgeAtClientPointRef,
    connectionOrbControlRef,
    setPieMenuPage,
    onPieMenuHoverChange: handlePieMenuHoverChange,
    setPan: setPanOffset,
    isAnimatingZoomRef,
    abstractionCarouselVisibleRef,
    driftingRef: gamepadDriftingRef,
    semanticOrbitActiveRef,
    orbitControlRef,
    activeGraphIdRef,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  });

  useCanvasKeyboard({
    activeGraphId,
    storeActions,
    graphsMap,
    nodePrototypesMap,
    edgesMap,
    selectedInstanceIds,
    setSelectedInstanceIds,
    selectedEdgeId,
    selectedEdgeIds,
    clipboardRef,
    onClipboardChange: markClipboardChanged,
    keysPressed,
    mousePositionRef, // {x, y} in client coords
    panOffset,
    panOffsetRef,
    setPanOffset,
    zoomLevel,
    zoomLevelRef,
    setZoomLevel,
    applyTransform: transform.applyTransform,
    flushSettle: transform.flushSettle,
    syncLabelsForGesture: transform.syncLabelsForGesture,
    onTransformChange: () => transform.onTransformChangeRef.current?.(),
    isPanningOrZoomingRef: isPanningOrZooming,
    canvasSize, // {width, height, offsetX, offsetY}
    viewportSize, // {width, height}
    viewportBounds, // {x, y, width, height}
    draggingNodeInfo,
    draggingNodeInfoRef: nodeDrag.draggingNodeInfoRef,
    performDragUpdateRef: nodeDrag.performDragUpdateRef,
    drawingConnectionFromRef,
    reprojectConnectionEndRef: reprojectDrawingConnectionEndRef,
    onPanTravelRef: keyboardPanTravelRef,
    isAnimatingZoomRef,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    gamepadTickRef,
    nodeNamePrompt,
    connectionNamePrompt,
    abstractionPrompt,
    newWebPrompt,
    isHeaderEditing,
    abstractionCarouselVisible,
    keyboardSettings,
    onDeleteNodes: deleteMultipleNodesWithAnimation,
  });

  /**
   * Commits an on-canvas node title edit.
   *
   * Node.jsx live-commits every keystroke so the node box can resize as you type
   * (getNodeDimensions measures the committed name). Those intermediate writes
   * still happen — they are just coalesced into one history entry, keyed per
   * prototype, so one Cmd+Z undoes the whole typed name instead of one character.
   *
   * Was duplicated verbatim at three render paths (normal, active, dragging).
   */
  const handleCommitCanvasEdit = useCallback((prototypeId, newName, isRealTime = false, isAbort = false) => {
    if (!prototypeId) return;
    const coalesceKey = `node-name:${prototypeId}`;
    const historyContext = isAbort
      ? { coalesceAbort: coalesceKey }
      : isRealTime
        ? { coalesce: coalesceKey }
        : { coalesceCommit: coalesceKey };

    if (newName && newName.trim()) {
      storeActions.updateNodePrototype(prototypeId, draft => { draft.name = newName; }, historyContext);
    }
    if (!isRealTime) setEditingNodeIdOnCanvas(null);
  }, [storeActions]);

  // The pie target follows the selection through the pie machine: every selection
  // change and marquee start/commit dispatches, and the machine applies the rule
  // (reconcileWrites in pieMachine.js; it was an effect here until P5.02b step 6).
  // Prepare and render PieMenu when its target changes (assigned each render: see setCarouselFocusedNodeDimensions).
  rebuildPieMenuDataRef.current = () => {
    if (selectedNodeIdForPieMenu && !isTransitioningPieMenu && !semanticOrbitActive) {
      // If the pie-menu node is being lifted/dragged, FREEZE currentPieMenuData so the
      // shrink-out animation keeps playing from where the menu was. `nodes` is a dep of
      // this effect and the lift writes a LIFT_SCALE onto the node every frame, so without
      // this early return we'd rebuild the menu data mid-shrink and re-pop the bubbles.
      const isDraggingThisNode = draggingNodeInfo &&
        (draggingNodeInfo.primaryId === selectedNodeIdForPieMenu ||
         draggingNodeInfo.instanceId === selectedNodeIdForPieMenu);
      if (isDraggingThisNode) {
        return;
      }
      const node = nodes.find(n => n.id === selectedNodeIdForPieMenu);
      if (node) {
        // Check if we're in carousel mode and have dynamic dimensions
        const isInCarouselMode = abstractionCarouselVisible && abstractionCarouselNode && node.id === abstractionCarouselNode.id;

        // Use dynamic carousel dimensions if available, otherwise calculate from the actual node
        const carouselDims = carouselFocusedNodeDimensionsRef.current;
        const dimensions = isInCarouselMode && carouselDims
          ? carouselDims
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
        }

        setCurrentPieMenuData({
          node: nodeForPieMenu,
          buttons: targetPieMenuButtons,
          nodeDimensions: dimensions
        });
        setIsPieMenuRendered(true); // Ensure PieMenu is in DOM to animate in
      } else {
        setCurrentPieMenuData(null); // Keep this for safety if node genuinely disappears
        // isPieMenuRendered will be set to false by onExitAnimationComplete if it was visible
      }
    }
    // With no target, or mid-transition, currentPieMenuData is left alone: PieMenu needs it to
    // animate out (isVisible hides it), and onExitAnimationComplete nulls it.
  };
  // semanticOrbitActive is a dep because leaving orbit has to rebuild the data (the exit
  // animation nulled it) and put the menu back in the DOM.
  useEffect(() => { rebuildPieMenuDataRef.current(); }, [selectedNodeIdForPieMenu, nodes, previewingNodeId, isTransitioningPieMenu, semanticOrbitActive, abstractionCarouselVisible, abstractionCarouselNode, carouselPieMenuStage, carouselFocusedNodeScale, carouselFocusedNode, draggingNodeInfo]);

  useEffect(() => {
    if (!isPieMenuRendered) {
      setActivePieMenuItemForVision(null);
    }
  }, [isPieMenuRendered]);

  // Watchdog: isTransitioningPieMenu is only ever meant to be true briefly while a
  // rendered pie menu plays its shrink animation. If it is set with nothing
  // animating out, the callback that clears it never fires; the pie machine's
  // 1200 ms watchdog timer (PIE_WATCHDOG_MS) recovers the pie instead of leaving it
  // blocked until a refresh.

  // Sync semanticOrbitActive ref for RAF callbacks
  useEffect(() => {
    semanticOrbitActiveRef.current = semanticOrbitActive;
    // Crossing the boundary in either direction retires whatever was hovered on
    // the other side of it. The RAF hover check no longer clears per-frame
    // during orbit (an orbit item's hover bubbles through it), so this is the
    // one place the canvas's own hover is dropped on the way in — and on the
    // way out it drops the candidate, which no longer exists.
    clearHoverImmediate();
  }, [semanticOrbitActive, clearHoverImmediate]);

  // Keep the orbit dim rect sized to the visible viewport (plus a full viewport
  // of margin per side) instead of the whole 100000px canvas plane. A full-plane
  // rect's transformed bounds at high zoom are enormous, which thrashes the SVG
  // renderer's tile cache during the per-frame repaints orbit mode causes.
  // Sized imperatively on every pan/zoom tick (canvas-transform-change fires
  // synchronously from the transform mutators) so it never lags a gesture the
  // way settled-state (150ms debounce) sizing did.
  const orbitDimRectRef = useRef(null);
  const updateOrbitDimRect = useCallback((...args) => sizeOrbitDimRect({
    orbitDimRectRef, ENABLE_ORBIT_DIM, panOffsetRef, zoomLevelRef, viewportSizeRef, canvasSize,
    ORBIT_DIM_MARGIN,
  }, ...args), [canvasSize]);

  // Seed the orbit layer with the current transform the moment it mounts. Pan
  // and zoom write to it from then on, but nothing fires between mount and the
  // next interaction, so without this the layer would start at identity and the
  // focus node would appear at raw canvas coords until the user moved.
  useEffect(() => {
    if (overlayGroupEl) transform.applyTransform();
  }, [overlayGroupEl, transform.applyTransform]);

  useEffect(() => {
    if (!semanticOrbitActive || !ENABLE_ORBIT_DIM) return;
    updateOrbitDimRect();
    window.addEventListener('canvas-transform-change', updateOrbitDimRect);
    return () => window.removeEventListener('canvas-transform-change', updateOrbitDimRect);
  }, [semanticOrbitActive, updateOrbitDimRect, ENABLE_ORBIT_DIM]);

  // Fetch orbit candidates only when orbit mode is explicitly active
  useEffect(() => fetchOrbitCandidates({
    semanticOrbitActive, selectedInstanceIds, orbitSetRef, EMPTY_ORBIT, setOrbitData, setOrbitLoading,
    activeGraphId,
  }), [semanticOrbitActive, selectedInstanceIds, activeGraphId]);

  // Exit orbit mode when node is deselected
  useEffect(() => {
    if (selectedInstanceIds.size === 0 && semanticOrbitActive) {
      useCanvasUIStore.getState().dispatchPie({ type: 'ORBIT', active: false });
      setOrbitData(EMPTY_ORBIT);
    }
  }, [selectedInstanceIds, semanticOrbitActive]);

  /**
   * An orbit candidate took (or lost) focus — from the pointer crossing it, or
   * from the stick aiming at it. Goes through the same dwell timer every other
   * hover does, so the preview behaves identically whichever raised it.
   *
   * What gets previewed is the TRIPLET the candidate would become if it were
   * placed: focus node —predicate→ candidate, in the same payload shape the
   * edge hit test produces, so the aid draws it with the connection recipe and
   * knows nothing about orbit. A lone node box would only repeat what the orbit
   * already draws; the relationship is the thing that is actually on offer.
   */
  const handleOrbitCandidateHover = useCallback((...args) => hoverOrbitCandidate({
    selectedInstanceIds, nodes, commitHoverTarget, baseDimsById,
  }, ...args), [commitHoverTarget, selectedInstanceIds, nodes, baseDimsById]);

  // Exit orbit mode callback
  const exitOrbitMode = useCallback(() => {
    useCanvasUIStore.getState().dispatchPie({ type: 'ORBIT', active: false });
    setOrbitData(EMPTY_ORBIT);
    setOrbitLoading(false);
    // Re-show control panel if nodes still selected
    if (selectedInstanceIds.size > 0) {
      setNodeControlPanelVisible(true);
      setNodeControlPanelShouldShow(true);
    }
  }, [selectedInstanceIds]);

  // Click-to-materialize: clicking an orbit item creates a real node at its position
  /**
   * Place a clicked orbit item into the graph, where it was.
   *
   * `centerX` / `centerY` are the item's CENTRE in canvas coordinates, resolved
   * live by OrbitOverlay. Node positions are top-left, so the centring happens
   * here, once, against the dimensions the placed node will actually have —
   * which are not necessarily the orbit item's, since the prototype may carry a
   * type or definitions the orbit preview did not.
   */
  const handleOrbitItemClick = useCallback((candidate, centerX, centerY, dims) => placeOrbitCandidate(candidate, centerX, centerY, dims, {
    activeGraphId, exitOrbitMode, gridMode, nodePrototypesMap, selectedInstanceIds, snapToGridAnimated,
    storeActions,
  }), [activeGraphId, nodePrototypesMap, selectedInstanceIds, storeActions, gridMode, snapToGridAnimated, exitOrbitMode]);

  // --- Hurtle ---
  // The orb's flight runs in <HurtleOrb> (P1.06, F-05). NodeCanvas only
  // launches it (hurtleFlight) and handles the landing.
  const [hurtleFlight, setHurtleFlight] = useState(null);
  const handleHurtleLand = useCallback((flight) => {
    // The orb lands and the new graph takes over, which is the same event a tab
    // tap produces — forced past the rate limit so the last detent can't swallow it.
    haptic('graphSwitch', { force: true });
    storeActions.openGraphTabAndBringToTop(flight.targetGraphId, flight.definitionNodeId);
    setHurtleFlight(null);
  }, [storeActions]);

  /**
   * Where the hurtling orb should land: the centre of the header's active tab,
   * in viewport coords (the orb is position:fixed).
   *
   * MEASURED off the tab rather than computed from the canvas container, which
   * is what both callers used to do. The strip centres its active tab on the
   * WINDOW (see scrollToCenter in Header.jsx) while the container is inset by
   * whichever side panels are open — so half the container's width is only the
   * right answer with both panels shut, and the orb otherwise sailed past the
   * tab and landed on empty header. Measuring also picks up the real vertical
   * centre, which a safe-area inset can push below HEADER_HEIGHT / 2.
   *
   * The tab being measured is the one we are LEAVING, which is fine: the web
   * being opened takes that same centred slot when it arrives.
   */
  const getHeaderTabTarget = useCallback(() => {
    const activeId = useGraphStore.getState().activeGraphId;
    const el = activeId ? document.querySelector(`[data-header-tab-id="${activeId}"]`) : null;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) {
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      }
    }
    // Nothing in the strip yet (the first web of a fresh universe): it is about
    // to appear centred on the window, so aim there.
    return { x: Math.round(window.innerWidth / 2), y: Math.round(HEADER_HEIGHT / 2) };
  }, []);

  // Simple Particle Transfer Animation - always use fresh coordinates
  const startHurtleAnimation = useCallback((a0, a1, a2, a3) => startHurtle(a0, a1, a2, a3, {
    canvasSize, containerRef, getHeaderTabTarget, getNodeDescriptionContent, panOffsetRef, previewingNodeId,
    setHurtleFlight, zoomLevelRef,
  }), [containerRef, previewingNodeId, getHeaderTabTarget, canvasSize]);

  const startHurtleAnimationFromPanel = useCallback((nodeId, targetGraphId, definitionNodeId, startRect) => {
    const currentState = useGraphStore.getState();
    const nodeData = currentState.nodePrototypes.get(nodeId);
    if (!nodeData) {

      return;
    }

    if (!containerRef.current) return;

    // B-04: this used to parse the <svg>'s style.transform, which no longer
    // carries the camera (it's an attribute on the content group now), so zoom
    // always read 1 and the orb was always 30 px. The ref is authoritative.
    const currentZoom = zoomLevelRef.current || 1;

    // Start position is the center of the icon's rect
    const startX = startRect.left + startRect.width / 2;
    const startY = startRect.top + startRect.height / 2;

    // Calculate orb size proportional to current zoom, same as pie menu animation
    const orbSize = Math.max(12, Math.round(30 * currentZoom));

    const animationData = {
      nodeId,
      targetGraphId,
      definitionNodeId,
      startTime: performance.now(),
      duration: 400, // Slower arc
      startPos: { x: startX, y: startY },
      // Was the canvas container's half-width used as a client x, which ignored
      // the container's own left edge entirely — so with the panel this button
      // lives in open, the orb aimed a whole panel-width left of the tab.
      targetPos: getHeaderTabTarget(),
      nodeColor: nodeData.color || NODE_DEFAULT_COLOR,
      orbSize: orbSize, // Use calculated, zoom-dependent size
    };

    setHurtleFlight(animationData);
  }, [containerRef, getHeaderTabTarget]);

  /**
   * The connection menu's buttons, in display order.
   *
   * One list, two consumers, exactly as nodePieMenuPages is: PieMenu draws it on
   * the canvas (wrapping it into rows once it outgrows one — see
   * utils/pieMenuLayout.js) and the bottom control panel renders the same
   * buttons in its own strip. The panel used to hand-transcribe a subset, which
   * is how the two drifted apart in the first place.
   *
   * Half of these come and go: Palette and Copy need a definition to act on,
   * Paste needs a clipboard that holds one. That's what makes the row's length a
   * layout problem rather than a constant.
   */
  const edgePieMenuButtons = useMemo(() => buildEdgePieMenuButtons({
    clipboardRef, edgesMap, handleEdgeColorPickerOpen, markClipboardChanged, nodePrototypesMap, openWizardPicker,
    rightPanelExpanded, selectedEdgeId, setConnectionNamePrompt, setEdgePieMenuVisible, startHurtleAnimationFromPanel, storeActions,
    wizardEnabled,
  }), [selectedEdgeId, edgesMap, nodePrototypesMap, wizardEnabled, storeActions, startHurtleAnimationFromPanel, rightPanelExpanded, handleEdgeColorPickerOpen, clipboardRef, clipboardVersion, markClipboardChanged]);

  // Freeze edge pie menu buttons when visible so they survive edge deselection during exit animation
  useEffect(() => {
    if (edgePieMenuVisible && edgePieMenuButtons.length > 0) {
      edgePieMenuButtonsRef.current = edgePieMenuButtons;
    }
  }, [edgePieMenuVisible, edgePieMenuButtons]);

  // Raise the pie-menu label chip for whichever bubble the controller is
  // aiming at, so a stick-aimed menu shows the same chip a moused one does.
  // Driven from an effect rather than from inside the gamepad tick because it
  // depends on the button arrays, which are rebuilt a commit AFTER the
  // selection that opened the menu — the tick would chip the previous
  // subject's buttons. It lives down here, rather than beside the useGamepad
  // call, because edgePieMenuButtons is declared above this line and nowhere
  // earlier: reading it up there is a temporal-dead-zone throw, not a warning.
  useEffect(() => {
    if (gamepadPieFocusedIndex < 0) return;
    const list = gamepadMode === 'edge' ? edgePieMenuButtons : targetPieMenuButtons;
    const btn = list?.[gamepadPieFocusedIndex];
    handlePieMenuHoverChange(btn ? { id: btn.id, label: btn.label } : null);
  }, [gamepadPieFocusedIndex, gamepadMode, targetPieMenuButtons, edgePieMenuButtons, handlePieMenuHoverChange]);

  // Focus-on-select for connections: when an edge's pie menu first appears, frame it
  // the same way selecting a node frames its menu. Only on a fresh show (new edge),
  // never on re-renders while the same menu is up — otherwise every button press or
  // pan would re-yank the view. Mid-drag is skipped: the anchor is frozen then, and
  // the menu is outroing anyway.
  const prevFocusPieEdgeIdRef = useRef(null);
  useEffect(() => frameEdgePieOnOpen({
    prevFocusPieEdgeIdRef, edgePieMenuVisible, selectedEdgeId, focusOnSelectEnabled,
    abstractionCarouselVisible, draggingNodeInfoRef, selectedEdgeMidpoint, edgePieMenuButtons,
    showConnectionNames, placedLabelsRef, edgesMap, nodePrototypesMap, edgePrototypesMap, textSettings,
    connectionLabelSize, focusEdgePieMenuInView,
  }), [edgePieMenuVisible, selectedEdgeId, selectedEdgeMidpoint, edgePieMenuButtons, abstractionCarouselVisible, focusEdgePieMenuInView, focusOnSelectEnabled, showConnectionNames, edgesMap, nodePrototypesMap, edgePrototypesMap, textSettings, connectionLabelSize]);

  // Callback for activating semantic orbit from control panel
  const activateSemanticOrbit = useCallback(() => {
    useCanvasUIStore.getState().dispatchPie({ type: 'ORBIT', active: true, clearTarget: true });
    setNodeControlPanelVisible(false);
  }, []);

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
    handleNodePanelOrbit,
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
    setRightPanelExpanded: storeActions.setRightPanelExpanded,
    setEditingNodeIdOnCanvas,
    NODE_DEFAULT_COLOR,
    onStartHurtleAnimationFromPanel: startHurtleAnimationFromPanel,
    onOpenColorPicker: handlePieMenuColorPickerOpen,
    onActivateSemanticOrbit: activateSemanticOrbit,
    onCaptureDeletionGhosts: captureDeletionGhosts
  });

  // Copy the whole selection (and any edges running between its members) to the
  // clipboard — same path as Ctrl/Cmd+C and the single-Thing pie menu's Copy, so
  // a multi-selection pastes back as one shape rather than a pile of loose Things.
  const handleNodePanelCopy = useCallback(() => {
    const currentGraph = graphsMap.get(activeGraphId);
    if (!currentGraph || selectedInstanceIds.size === 0) return;
    const copied = copySelection(selectedInstanceIds, currentGraph, nodePrototypesMap, edgesMap);
    if (copied) {
      clipboardRef.current = copied;
      markClipboardChanged();
    }
  }, [activeGraphId, selectedInstanceIds, graphsMap, nodePrototypesMap, edgesMap, markClipboardChanged]);

  // Duplicate the selection in place. Built from copy+paste rather than a loop of
  // addNodeInstance so the edges running between the selected Things come along —
  // duplicating a shape and getting back a pile of disconnected Things isn't a
  // duplicate. Deliberately does NOT touch clipboardRef: duplicating shouldn't
  // silently overwrite whatever the user has copied.
  const handleNodePanelDuplicate = useCallback(() => {
    const currentGraph = graphsMap.get(activeGraphId);
    if (!currentGraph || selectedInstanceIds.size === 0) return;
    const copied = copySelection(selectedInstanceIds, currentGraph, nodePrototypesMap, edgesMap);
    if (!copied) return;
    // Same down-right offset the single-Thing Duplicate uses, so the copy reads as
    // a copy. pasteClipboard spirals further out if that lands on something.
    const offset = 40;
    const result = pasteClipboard(
      copied,
      activeGraphId,
      { x: copied.originalCenter.x + offset, y: copied.originalCenter.y + offset },
      storeActions,
      currentGraph,
      getNodeDimensions
    );
    // Move the selection to the new copies, matching the single-Thing Duplicate
    // and paste — the panel stays up, now acting on what was just made.
    if (result?.newInstanceIds?.length) {
      setSelectedInstanceIds(new Set(result.newInstanceIds));
    }
  }, [activeGraphId, selectedInstanceIds, graphsMap, nodePrototypesMap, edgesMap, storeActions, setSelectedInstanceIds]);

  // Node-group control panel action handlers
  const handleNodeGroupDiveIntoDefinition = useCallback((a0) => diveIntoNodeGroupDefinition(a0, {
    activeGraphId, nodePrototypesMap, selectedGroup, setGroupControlPanelVisible, setSelectedGroup, startHurtleAnimationFromPanel,
    storeActions,
  }), [
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

  // Push the node-group's current contents into its linked definition graph, overwriting it.
  const handleNodeGroupUpdateDefinition = useCallback(() => {
    if (!activeGraphId || !selectedGroup?.id) return;
    if (typeof storeActions.updateDefinitionFromNodeGroup !== 'function') {
      console.warn('updateDefinitionFromNodeGroup action is unavailable on storeActions');
      return;
    }
    storeActions.updateDefinitionFromNodeGroup(activeGraphId, selectedGroup.id);
  }, [activeGraphId, selectedGroup, storeActions]);

  // Refresh the node-group from its linked definition graph, discarding the group's current members.
  const handleNodeGroupRefreshFromDefinition = useCallback(() => {
    if (!activeGraphId || !selectedGroup?.id) return;
    if (typeof storeActions.refreshNodeGroupFromDefinition !== 'function') {
      console.warn('refreshNodeGroupFromDefinition action is unavailable on storeActions');
      return;
    }
    storeActions.refreshNodeGroupFromDefinition(activeGraphId, selectedGroup.id);

    const gs = useGraphStore.getState();
    const refreshedGroup = gs.graphs?.get(activeGraphId)?.groups?.get(selectedGroup.id);
    if (refreshedGroup) {
      setSelectedGroup(refreshedGroup);
    }
  }, [activeGraphId, selectedGroup, storeActions, setSelectedGroup]);

  // Trigger auto-layout: batch engine computes the final positions, then
  // nodes tween directly to their targets (edges/labels follow the nodes).
  // No live physics — one coherent motion instead of redundant exploration.
  const triggerAutoLayout = useCallback(() => {
    if (!activeGraphId) return;
    applyAutoLayoutToActiveGraph();
  }, [activeGraphId, applyAutoLayoutToActiveGraph]);

  // Snap every node in the active graph to the grid (explicit user action —
  // works regardless of whether the grid is currently enabled).
  const snapToGrid = useCallback(() => {
    if (!activeGraphId) return;
    snapActiveGraphToGrid();
  }, [activeGraphId, snapActiveGraphToGrid]);

  // What Header asks the canvas to do (P2.08). Callers go through
  // runCanvasCommand(name) rather than props, so they don't render with us.
  useCanvasCommands({
    autoLayout: triggerAutoLayout,
    snapToGrid,
    condense: condenseGraphNodes,
    // The Panels' "open this definition" hurtle (P2.09).
    startHurtleFromPanel: startHurtleAnimationFromPanel,
    // The header's component search flies to the Thing's instances (P2.06d).
    navigateToPrototypeInstances,
    // The force-simulation tuner reads the live canvas while it runs (P2.06f).
    layoutNodes: () => hydratedNodes.map(n => {
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
    }),
    layoutEdges: () => edges.map(e => {
      let connName = e.connectionName || '';
      if (!connName && e.definitionNodeIds?.length > 0) {
        const defNode = nodePrototypesMap.get(e.definitionNodeIds[0]);
        if (defNode?.name) connName = defNode.name;
      }
      if (!connName && e.typeNodeId) {
        const proto = edgePrototypesMap.get(e.typeNodeId);
        if (proto?.name) connName = proto.name;
      }
      return { sourceId: e.sourceId, destinationId: e.destinationId, name: connName };
    }),
    draggedNodeIds: () => {
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
    },
    resetConnectionLabelCache,
    cancelAutoLayout,
  });

  // Context Menu options for canvas background.
  // clientX/clientY are the right-click screen coords (used to place a paste).
  const getCanvasContextMenuOptions = useCallback((clientX, clientY) => buildCanvasContextMenuOptions(clientX, clientY, {
    activeGraphId, canvasSize, clipboardRef, condenseGraphNodes, containerRef, graphsMap,
    openWizardPicker, panOffsetRef, setForceSimModalVisible, setSelectedInstanceIds, snapToGrid, storeActions,
    triggerAutoLayout, wizardEnabled, zoomLevelRef,
  }), [triggerAutoLayout, snapToGrid, condenseGraphNodes, setForceSimModalVisible, wizardEnabled, activeGraphId, graphsMap, storeActions, canvasSize, setSelectedInstanceIds]);

  // The controller's handle on that menu — see the ref's declaration above.
  // `force`, because the pad's trigger tap is not the long-press gesture the
  // touch suppression in showContextMenu exists to protect.
  canvasContextMenuControlRef.current = {
    open: (clientX, clientY) => {
      showContextMenu(clientX, clientY, getCanvasContextMenuOptions(clientX, clientY), { force: true });
    },
    close: () => hideContextMenu(),
  };

  // Raise the blank-canvas context menu without a right-click.
  //
  // There is no right mouse button on a phone and none on a game controller,
  // and this menu is where Auto Layout, Snap to Grid, Condense, Merge and Paste
  // now live — so on those devices an entire surface was unreachable. The
  // header's hamburger dispatches this; the pad has its own route through
  // canvasContextMenuControlRef.
  //
  // Centre of the viewport by default, because that is the honest answer to
  // "where did you click" when nobody clicked. The coordinates are not just
  // placement: Paste drops its nodes at them.
  //
  // Centred rather than dropped from the point: the ordinary path puts the
  // card's top-left corner under the cursor, which is right when there IS a
  // cursor to drop away from and simply looks off-centre when there is not.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e) => {
      const x = e?.detail?.x ?? window.innerWidth / 2;
      const y = e?.detail?.y ?? window.innerHeight / 2;
      showContextMenuCentered(x, y, getCanvasContextMenuOptions(x, y));
    };
    window.addEventListener('redstring:open-canvas-context-menu', handler);
    return () => window.removeEventListener('redstring:open-canvas-context-menu', handler);
  }, [getCanvasContextMenuOptions]);

  // Context Menu options for nodes - core functionality without pie menu transition logic
  const getContextMenuOptions = useCallback((instanceId) => buildNodeContextMenuOptions(instanceId, {
    abstractionCarouselVisible, activeGraphId, canvasSize, carouselAnimationState, containerRef, deleteNodeWithAnimation,
    handlePieMenuColorPickerOpen, nodes, panOffsetRef, previewingNodeId, rightPanelExpanded, savedNodeIds,
    setAbstractionCarouselNode, setAbstractionCarouselVisible, setCarouselAnimationState, setEditingNodeIdOnCanvas, setNodeControlPanelVisible, setSelectedInstanceIds,
    setSelectedNodeIdForPieMenu, setSemanticOrbitActive, startHurtleAnimation, storeActions, targetPieMenuButtons, zoomLevelRef,
  }), [nodes, savedNodeIds, abstractionCarouselVisible, carouselAnimationState, previewingNodeId, setAbstractionCarouselNode, setCarouselAnimationState, setAbstractionCarouselVisible, setSelectedNodeIdForPieMenu, storeActions, activeGraphId, setSelectedInstanceIds, rightPanelExpanded, setEditingNodeIdOnCanvas, getNodeDimensions, containerRef, handlePieMenuColorPickerOpen, startHurtleAnimation, useGraphStore]);

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
  const relevantNodesVisibleInStrictViewport = useMemo(() => computeRelevantNodesVisible({
    enableClustering, clusterAnalysis, nodes, panOffset, zoomLevel, viewportSize, canvasSize, baseDimsById,
  }), [enableClustering, clusterAnalysis.mainCluster, nodes, panOffset, zoomLevel, viewportSize, canvasSize, baseDimsById]);

  // Determine if BackToCivilization should be shown
  const shouldShowBackToCivilization = useMemo(() => computeShouldShowBackToCivilization({
    isInitialLoadComplete, isUniverseLoaded, hasUniverseFile, activeGraphId, isViewReady, nodeNamePrompt,
    connectionNamePrompt, abstractionPrompt, abstractionCarouselVisible, selectedNodeIdForPieMenu, plusSign,
    draggingNodeInfo, drawingConnectionFrom, isPanning, selectionStart, nodes,
    relevantNodesVisibleInStrictViewport,
  }), [isInitialLoadComplete, isUniverseLoaded, hasUniverseFile, activeGraphId, isViewReady, nodes, relevantNodesVisibleInStrictViewport, nodeNamePrompt.visible, connectionNamePrompt.visible, abstractionPrompt.visible, abstractionCarouselVisible, selectedNodeIdForPieMenu, plusSign, draggingNodeInfo, drawingConnectionFrom, isPanning, selectionStart]);

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
  const handleBackToCivilizationClick = useCallback(() => backToCivilization({
    baseDimsById, canvasSize, clusterAnalysis, containerRef, draggingNodeInfoRef, enableClustering,
    isAnimatingZoomRef, nodes, transform, viewportSize,
  }), [enableClustering, clusterAnalysis, nodes, baseDimsById, viewportSize, canvasSize, MAX_ZOOM]);

  // Listen for auto-layout trigger events from AI operations (mutations).
  //
  // The pending debounce lives in a ref, and the listener is registered ONCE,
  // because `triggerAutoLayout` changes identity on essentially every store
  // mutation (it closes over `nodes`/`edges`/`baseDimsById`/`graphsMap`). When
  // the timer was an effect-local `let` with the effect keyed on
  // [triggerAutoLayout, activeGraphId], the cleanup cancelled the pending
  // layout every time anything in the active graph changed — and nothing ever
  // rescheduled it. The wizard's first createPopulatedGraph is exactly that
  // case: it flips activeGraphId to the new graph and then keeps churning the
  // store (bulk update → cleanupOrphanedData → composition/unfold → Wikipedia
  // enrichment → thumbnail cache) straight through the 500ms window, so the
  // graph rendered with its random seed positions and layout never ran.
  const autoLayoutDebounceRef = useRef(null);
  const triggerAutoLayoutRef = useRef(triggerAutoLayout);
  useEffect(() => { triggerAutoLayoutRef.current = triggerAutoLayout; }, [triggerAutoLayout]);

  useEffect(() => {
    // Bound the "user is holding a node" retry so a held pointer can't re-arm
    // the timer forever.
    const MAX_HELD_RETRIES = 20; // 20 × 500ms = 10s
    let heldRetries = 0;

    // Tell the requester the canvas took responsibility for this graph. Wizard
    // mutations arm an offscreen-layout fallback on every dispatch and cancel it
    // on this ack — without it, a request that reached no live canvas would
    // leave the graph at its seed-random positions forever.
    const ack = (graphId) => {
      window.dispatchEvent(new CustomEvent('rs-auto-layout-ack', { detail: { graphId } }));
    };

    const runWhenFree = (graphId) => {
      autoLayoutDebounceRef.current = null;
      // Don't yank a node the user is currently grabbing/holding/dragging.
      // applyAutoLayoutToActiveGraph also guards the drag case, but the
      // pre-lift hold (mouse down on a node, not yet lifted) isn't a drag yet.
      if (draggingNodeInfoRef.current || (isMouseDown.current && startedOnNode.current)) {
        // Deferred, not dropped — ack so the fallback doesn't snap the graph out
        // from under the hand that's holding it, and retry.
        ack(graphId);
        if (heldRetries++ < MAX_HELD_RETRIES) {
          autoLayoutDebounceRef.current = setTimeout(() => runWhenFree(graphId), 500);
        }
        return;
      }
      heldRetries = 0;
      clearLabelStabilization();
      triggerAutoLayoutRef.current?.();
      ack(graphId);
    };

    const handleTriggerAutoLayout = (event) => {
      const { graphId } = event.detail || {};
      // Read the store rather than the render closure — the listener is
      // registered once, and the active graph may have changed since.
      const currentActiveGraphId = useGraphStore.getState().activeGraphId;

      if (!graphId || graphId === currentActiveGraphId) {
        // Active graph: use DOM-aware layout with debounce to batch rapid mutations
        if (autoLayoutDebounceRef.current) {
          clearTimeout(autoLayoutDebounceRef.current);
        }
        heldRetries = 0;
        autoLayoutDebounceRef.current = setTimeout(() => runWhenFree(graphId), 500);
      } else {
        // Non-active graph: apply offscreen layout so wizard-created graphs are
        // laid out even when the user isn't watching
        try { applyOffscreenLayout(graphId); } catch (e) {
          console.error('[NodeCanvas] Offscreen layout failed for non-active graph', graphId, e);
        }
        ack(graphId);
      }
    };

    window.addEventListener('rs-trigger-auto-layout', handleTriggerAutoLayout);

    return () => {
      if (autoLayoutDebounceRef.current) {
        clearTimeout(autoLayoutDebounceRef.current);
        autoLayoutDebounceRef.current = null;
      }
      window.removeEventListener('rs-trigger-auto-layout', handleTriggerAutoLayout);
    };
  }, []);

  // Listen for selectNode events from the Wizard AI
  useEffect(() => listenForSelectNode({
    nodes, setSelectedInstanceIds, setSelectedNodeIdForPieMenu,
  }), [nodes, setSelectedInstanceIds, setSelectedNodeIdForPieMenu]);

  // Listen for navigation events from the Wizard and other systems
  useEffect(() => listenForNavigateTo({
    draggingNodeInfoRef, isAnimatingZoomRef, activeGraphId, handleBackToCivilizationClick, nodes, baseDimsById,
    viewportSize, canvasSize, transform,
  }), [activeGraphId, nodes, baseDimsById, viewportSize, canvasSize, handleBackToCivilizationClick, MAX_ZOOM]);

  // Node's memo ignores function props, so a Node that hasn't re-rendered keeps
  // its first handlers (B-05: e.g. the context menu kept offering "Save" after a
  // save). Its handlers read the render-scope functions through this ref, which
  // always holds the latest commit's (P3.02).
  const nodeScope = useLatestRef({
    handleNodeMouseDown, touch, getContextMenuOptions, handleCommitCanvasEdit,
    startHurtleAnimation, activeGraphId, handleNodeConvertToNodeGroup,
  });
  // The Node callbacks that were copied into all three Node blocks. Memoized so
  // NodeLayer's memo holds: each reads through nodeScope, refs or stable setters.
  const nodeCallbacks = useMemo(() => ({
    onCancelCanvasEdit: () => setEditingNodeIdOnCanvas(null),
    onCreateDefinition: (prototypeId) => {
      if (mouseMoved.current) return;
      storeActions.createAndAssignGraphDefinition(prototypeId);
    },
    onAddNodeToDefinition: (prototypeId) => storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId),
    onDeleteDefinition: (prototypeId, graphId) => storeActions.removeDefinitionFromNode(prototypeId, graphId),
    onExpandDefinition: (instanceId, prototypeId, graphId) => {
      if (graphId) {
        nodeScope.current.startHurtleAnimation(instanceId, graphId, prototypeId);
        return;
      }
      // No definition yet: create one, then animate into it.
      const sourceGraphId = nodeScope.current.activeGraphId; // before it changes
      storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);
      setTimeout(() => {
        const ids = useGraphStore.getState().nodePrototypes.get(prototypeId)?.definitionGraphIds;
        if (ids?.length > 0) nodeScope.current.startHurtleAnimation(instanceId, ids[ids.length - 1], prototypeId, sourceGraphId);
      }, 50);
    },
    onConvertToNodeGroup: (...args) => nodeScope.current.handleNodeConvertToNodeGroup(...args),
    onNavigateDefinition: (prototypeId, newIndex) => {
      const contextKey = `${prototypeId}-${nodeScope.current.activeGraphId}`;
      setNodeDefinitionIndices(prev => { const next = new Map(prev); next.set(contextKey, newIndex); return next; });
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- every callback reads through nodeScope, refs or stable setters
  }), [storeActions]);

  // The shell (Header, Panels, TypeList) is CanvasShell's since P2.11. The
  // screen-level overlays below the canvas still live here until their hosts
  // land (P2.06, P5); they go into the shell's slot after TypeList, so they lay
  // out and paint where they always did.
  const placeOverlays = (overlays) => {
    if (overlaySlot === undefined) return overlays; // no shell (tests)
    return overlaySlot ? createPortal(overlays, overlaySlot) : null;
  };

  // Group layouts as data (P3.03a): recomputed when groups, nodes, sizes, the
  // rename draft or the label font change, not on every render.
  const groupLayouts = useMemo(() => computeGroupLayouts({
    graphData: activeGraph, groupStructure, hydratedNodes, textSettings, editingGroupId, tempGroupName,
    nodePrototypesMap, baseDimsById, gridSize, getTextWidth,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getTextWidth is a stateless wrapper; labelFontVersion re-measures once the font arrives
  }), [activeGraph, groupStructure, hydratedNodes, textSettings, editingGroupId, tempGroupName, nodePrototypesMap, baseDimsById, gridSize, labelFontVersion]);

  // Everything renderConnectionEdge reads except hover, gathered in one place;
  // EdgeLayer adds hover from canvasUIStore (P3.06a).
  // The renderer now lives in components/canvas/renderConnectionEdge.jsx;
  // this object is its entire input surface. Adding a value the renderer
  // needs means adding it here — there is no implicit closure any more.
  const edgeRenderCtx = {
    // Not read by the renderer directly: they are here so that a
    // per-edge memo (P3.06) re-renders when a sprite batch
    // finishes or the label font arrives.
    labelSpriteVersion,
    labelFontVersion,
    anchorPositionUpdatesRef,
    baseDimsById,
    canvasSize,
    cleanLaneOffsets,
    cleanLaneSpacing,
    connectionLabelColorMode,
    connectionLabelOuterRing,
    connectionLabelRingWidth,
    connectionLabelSize,
    connectionLabelTruncate,
    connectionOrbHitsRef,
    connectionWidth,
    curveLabels,
    curveSpacing,
    curvedLabelQuantum,
    darkMode,
    draggingNodeInfo,
    edgeCurveInfo,
    edgePrototypesMap,
    edgeTouchHandlers,
    enableAutoRouting,
    getEdgeHitboxHandlers,
    ignoreCanvasClick,
    isRoutedStyle,
    labelArcMinBow,
    labelCrossingIndex,
    labelHaloEnabled,
    labelObstacleOptions,
    labelRingEnabled,
    labelSpriteScale,
    labelSpritesEnabled,
    labelTruncationRef,
    lombardiCurvature,
    lombardiLaneSpacing,
    lombardiMinBow,
    lombardiTangents,
    manhattanBends,
    nodeById,
    nodePrototypesMap,
    nodes,
    orbToggleEchoRef,
    orthogonalLaneSpacing,
    placedLabelsRef,
    quantizeLabelAngle,
    routingStyle,
    selectEdgeFromClick,
    selectedEdgeId,
    selectedEdgeIds,
    selectedInstanceIds,
    showConnectionNames,
    storeActions,
    textSettings,
    visibleNodeIds,
  };

  // The orbit overlay around the active node while orbiting (NodeLayer places it).
  const renderOrbitOverlay = useCallback((centerX, centerY, focusWidth, focusHeight) => (
    <OrbitOverlay
      centerX={centerX}
      centerY={centerY}
      focusWidth={focusWidth}
      focusHeight={focusHeight}
      ring1Candidates={orbitData.ring1 || []}
      ring2Candidates={orbitData.ring2 || []}
      ring3Candidates={orbitData.ring3 || []}
      ring4Candidates={orbitData.ring4 || []}
      onOrbitItemClick={handleOrbitItemClick}
      onExtentChange={setOrbitFrame}
      onCandidateHover={handleOrbitCandidateHover}
      controlRef={orbitControlRef}
      onExit={exitOrbitMode}
      isLoading={orbitLoading}
    />
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setOrbitFrame and orbitControlRef are stable
  ), [orbitData, orbitLoading, handleOrbitItemClick, handleOrbitCandidateHover, exitOrbitMode]);
  const nodeLayerProps = {
    nodes, visibleNodeIds, baseDimsById, thingGroupMemberIds: groupLayouts.thingGroupMemberIds,
    draggingNodeId: draggingNodeInfo?.primaryId || draggingNodeInfo?.instanceId, marqueeActive: !!selectionStart,
    activeGraphId, graphsMap, nodeScope, nodeCallbacks, storeActions, overlayGroupEl, renderOrbitOverlay,
  };

  // The control panels' handlers and derived data (P5.05a).
  const controlPanelsCtx = {
    decomposePanelInfo, nodePrototypesForPanel, typeListVisible, handleNodeControlPanelAnimationComplete,
    storeActions, handleNodePanelDelete, handleNodePanelAdd, startHurtleAnimation, handleNodePanelUp,
    handleNodePanelOpenInPanel, graphsMap, activeGraphId, setSelectedInstanceIds, handleNodePanelDecompose,
    handleNodePanelAbstraction, handleNodePanelEdit, handleNodePanelSave, handleNodePanelPalette,
    handleNodePanelOrbit, handleNodePanelGroup, handleNodePanelCopy, handleNodePanelDuplicate,
    nodePieMenuPages, singleSelectedInstanceId, handlePieMenuHoverChange, wizardEnabled, groupPanelMode,
    handleGroupControlPanelAnimationComplete, groupPanelTarget, handleGroupPanelUngroup,
    handleGroupPanelEdit, handleGroupPanelColor, handleGroupPanelConvertToNodeGroup,
    handleNodeGroupDiveIntoDefinition, handleNodeGroupOpenInPanel, handleNodeGroupCombine,
    handleNodeGroupUpdateDefinition, handleNodeGroupRefreshFromDefinition, edgesMap,
    handleConnectionControlPanelAnimationComplete, edgePieMenuButtons, setConnectionNamePrompt,
    startHurtleAnimationFromPanel, openWizardPicker, currentAbstractionDimension, abstractionDimensions,
    handleAbstractionDimensionChange, handleAddAbstractionDimension, handleDeleteAbstractionDimension,
    handleExpandAbstractionDimension, handleAbstractionControlPanelAnimationComplete, onCarouselClose,
  };

  // The name prompts' state and handlers (P5.06a).
  const promptsCtx = {
    nodeNamePrompt, connectionNamePrompt, abstractionPrompt, nodeGroupPrompt, swapPrompt, setSwapPrompt,
    leftPanelExpanded, rightPanelExpanded, setDialogColorPickerVisible, storeActions, performInstanceSwap,
    handleClosePrompt, plusSign, setPlusSign, setNodeNamePrompt, handleNodeSelection,
    finalizeConnectionSuggestion, setConnectionNamePrompt, suggestEdgeArrowDirection, setNodeGroupPrompt,
    activeGraphId, setSelectedGroup, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow,
    setNodeControlPanelVisible, finalizeAbstractionSuggestion, handleAbstractionSubmit,
  };

  // The shell-slot overlays' state and handlers (P5.06a).
  const canvasOverlaysCtx = {
    abstractionCarouselVisible, abstractionCarouselNode, panOffset, zoomLevel, zoomLevelRef, panOffsetRef,
    containerRef, canvasSize, debugMode, carouselAnimationState, onCarouselAnimationStateChange,
    onCarouselClose, requestCarouselClose, onCarouselReplaceNode, setCarouselFocusedNodeScale,
    setCarouselFocusedNodeDimensions, setCarouselFocusedNode, onCarouselExitAnimationComplete,
    carouselRelativeMoveRequest, setCarouselRelativeMoveRequest, carouselFocusPrototypeRequest,
    setCarouselFocusPrototypeRequest, storeActions, currentAbstractionDimension, abstractionDimensions,
    handleAbstractionDimensionChange, handleAddAbstractionDimension, handleDeleteAbstractionDimension,
    handleExpandAbstractionDimension, setAbstractionControlPanelVisible, dialogColorPickerVisible,
    handleDialogColorPickerClose, handleDialogColorChange, colorPickerTarget, selectedGroupEffectiveColor,
    nodeNamePrompt, connectionNamePrompt, dialogColorPickerPosition, pieMenuColorPickerVisible,
    activePieMenuColorNodeId, handlePieMenuColorPickerClose, handlePieMenuColorChange,
    handlePieMenuColorCommit, nodes, pieMenuColorPickerPosition, edgeColorPickerVisible,
    activeEdgeColorPrototypeId, handleEdgeColorPickerClose, handleEdgeColorChange, handleEdgeColorCommit,
    nodePrototypesMap, edgeColorPickerPosition, addToGroupDialog, setAddToGroupDialog, activeGraphId,
    askWizardPicker, wizardDestination, chooseWizardDestination, setAskWizardPicker, runWizardIntent,
    selfLoopDialog, setSelfLoopDialog,
  };

  // The pointer handlers' context (P4.04a), assigned during render for the same
  // reason as the camera's: effects in this commit see this render's values.
  pointerCtxRef.current = {
    CLICK_DELAY, MIN_ZOOM, abstractionCarouselVisible, activeGraphId, anchorPositionUpdatesRef,
    armGestureBlock, baseDimsById, beginMarquee, cancelAutoLayoutAnimation, canvasSize, canvasWorker,
    carouselAnimationState, carouselExitInProgressRef, clampCoordinates, clearHoverImmediate,
    clearLabelsOnMouseMove, clickTimeoutIdRef, commitHoverTarget, connectionControlPanelShouldShow,
    connectionControlPanelVisible, connectionDrawAbandonedRef, connectionExitedSourceRef,
    connectionHoverTargetRef, connectionStretchTrack, containerRef, dragPhaseRef, draggingNodeInfo,
    draggingNodeInfoRef, drawingConnectionFrom, drawingConnectionFromRef, edgePieMenuRendered,
    edgePieMenuVisible, endMarquee, exitOrbitMode, findConnectionDropTarget, findEdgeAtClientPoint,
    findGroupTitleAtPoint, findNearestEdgeAtCanvasPoint, gestureBlockRef, getEdgeHitThreshold, graphsMap,
    gridSize, groupControlPanelShouldShow, groupControlPanelVisible, groupLongPressTimeout, groupStructure,
    handleMouseUpInProgressRef, hoverStickyEdgeId, ignoreCanvasClick, inputModeRef, isAnimatingZoomRef,
    isDoublePress, isInsideNode, isMouseDown, isPanning, isPanningOrZooming, isPanningRef,
    isPieMenuActionInProgress, isTouchDeviceRef, justCompletedBoxSelectRef, justCompletedCarouselExit,
    lastMousePosRef, lastPanSampleRef, lastPanVelocityRef, longPressTimeout, longPressingInstanceIdRef,
    middleMouseZoomEnabled, middleMouseZoomRef, mouseDownPosition, mouseInsideNode, mouseMoved,
    mousePositionRef, nodeDrag, nodeLiftDelay, nodeNamePrompt, nodes, panMomentumRef, panOffsetRef,
    panSourceRef, panStartRef, panTravelSinceMouseDownRef, panVelocityHistoryRef, panelResizeControlRef,
    pinchRef, plusSign, potentialClickNodeRef, previewingNodeId, rightPanelExpanded, scheduleGestureBlockClear,
    selectEdgeFromClick, selectedEdgeId, selectedEdgeIds, selectedGroup, selectedInstanceIds,
    selectedNodeIdForPieMenu, selectionStartRef, semanticOrbitActive, semanticOrbitActiveRef,
    setAbstractionCarouselNode, setAbstractionCarouselVisible, setAddToGroupDialog, setCarouselAnimationState,
    setCarouselFocusedNode, setCarouselFocusedNodeDimensions, setCarouselPieMenuStage,
    setConnectionControlPanelVisible, setDrawingConnectionEnd, setDrawingConnectionFrom, setEdgePieMenuVisible,
    setGroupControlPanelVisible, setIsPanning, setLongPressingInstanceId, setPanAndZoom, setPanOffset,
    setPanStart, setPlusSign, setPreviewingNodeId, setSelectedGroup, setSelectedInstanceIds, setSelfLoopDialog,
    startDragForNodeRef, startPanMomentum, startedOnNode, stopPanMomentum, stopTrackpadZoom, stopZoomMomentum,
    storeActions, suppressNextMouseDownRef, touchSettingsRef, updateMarquee, viewportSize, visibleNodeIds,
    wasDrawingConnection, zoomLevelRef, zoomOpIdRef,
  };

  // Commands from the pie machine (P5.02b): camera framing, the carousel Swap,
  // and resets of state that still lives here. Reassigned every render so it
  // runs with this render's setters and values; registered once, on mount.
  pieCommandHandlerRef.current = (cmd) => {
    if (cmd.type === 'frame') {
      // Only the return to the carousel's node so far. The other kinds still come
      // from NodeCanvas's own framing effects until later steps remove them.
      if (cmd.kind === 'returnFocus' && cmd.nodeId) focusNodeInView(cmd.nodeId);
      return;
    }
    if (cmd.type === 'graph' && cmd.action === 'applyCarouselSwap') {
      const { swap, graphId } = cmd.args;
      if (swap) {
        const { originalNodeId, originalInstance, focusedPrototypeId, newPrototype } = swap;

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
        storeActions.updateNodeInstance(graphId, originalNodeId, (instance) => {
          instance.prototypeId = focusedPrototypeId;
          instance.x = newX;
          instance.y = newY;
        }, { finalize: true });
      }
      return;
    }
    if (cmd.type !== 'local') return;
    switch (cmd.action) {
      case 'fullReset':
        setEditingGroupId(null);
        setTempGroupName('');
        setPlusSign(null);
        selectionStartRef.current = null; // a pending marquee pass must not outlive the graph
        setSelectionStart(null);
        setDrawingConnectionFrom(null);
        setPieMenuColorPickerVisible(false);
        setActivePieMenuColorNodeId(null);
        setCarouselFocusedNodeScale(1.2);
        setCarouselFocusedNodeDimensions(null);
        setCarouselFocusedNode(null);
        setAbstractionControlPanelVisible(false);
        setAbstractionControlPanelShouldShow(false);
        break;
      case 'closeAllPanels':
        setNodeControlPanelVisible(false);
        setConnectionControlPanelVisible(false);
        setAbstractionControlPanelVisible(false);
        setGroupControlPanelVisible(false);
        break;
      case 'closePieColorPicker':
        setPieMenuColorPickerVisible(false);
        setActivePieMenuColorNodeId(null);
        break;
      case 'clearCarouselFocus':
        setCarouselFocusedNode(null);
        setCarouselFocusedNodeDimensions(null);
        break;
      case 'carouselFocusPrototypeRequest':
        setCarouselFocusPrototypeRequest(cmd.args?.prototypeId ?? null);
        break;
      default:
        break;
    }
  };

  // The camera controller's context (P4.02). Assigned during render rather than
  // in a layout effect so that effects in this commit, which call into the
  // camera, see this render's values, as the old per-render closures did.
  cameraCtxRef.current = {
    MAX_ZOOM, MIN_ZOOM, abstractionCarouselVisible, abstractionCarouselVisibleRef, armGestureBlock, canvasSize,
    canvasSizeRef, containerRef, draggingNodeInfo, draggingNodeInfoRef, ignoreCanvasClick, isAnimatingZoomRef,
    isPanningOrZooming, isTouchDeviceRef, lastMousePosRef, panOffsetRef, panSourceRef, panVelocityHistoryRef,
    pinchRef, scheduleGestureBlockClear, setPanAndZoom, setPanOffset, trackpadPanSensitivityRef,
    trackpadZoomEnabled, trackpadZoomSensitivityRef, viewportSize, viewportSizeRef, visibleEdgesRef,
    visibleNodeIdsRef, zoomLevelRef, zoomOpIdRef,
  };

  // Group input (P3.04): one stable handler set reading the latest values here.
  const groupInputCtxRef = useLatestRef({
    wasDraggingRef, mouseMoved, isDoublePress, setEditingGroupId, setTempGroupName, setSelectedGroup,
    setSelectedInstanceIds, storeActions, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow,
    setNodeControlPanelVisible, setAbstractionControlPanelVisible, setAbstractionControlPanelShouldShow,
    setConnectionControlPanelVisible, setConnectionControlPanelShouldShow, editingGroupId, isMouseDown,
    mouseDownPosition, mouseInsideNode, startedOnNode, setLongPressingInstanceId, groupLongPressTimeout,
    drawingConnectionFrom, startGroupDragAtPointRef, nodeLiftDelay, isViewMoving, groupTouchStartRef, touch,
    nodeDrag, TOUCH_MOVEMENT_THRESHOLD, handleMouseMove, handleMouseUp, groupTouchCleanupRef, containerRef,
    panOffsetRef, zoomLevelRef, canvasSize, nodes, childGroupIdsByGroupIdRef, groupsByIdRef, ignoreCanvasClick,
    lastGroupTapRef, tempGroupName, activeGraphId, selectedGroup, draggingNodeInfo, nodeNamePrompt,
    groupControlPanelShouldShow, groupControlPanelVisible, setGroupControlPanelVisible, abstractionCarouselVisible,
    selectedNodeIdForPieMenu, setAbstractionCarouselVisible, setAbstractionCarouselNode, setCarouselAnimationState,
    setCarouselPieMenuStage, setCarouselFocusedNode, setCarouselFocusedNodeDimensions, carouselAnimationState,
    selectedInstanceIds, justCompletedCarouselExit, carouselExitInProgressRef, selectedEdgeId, selectedEdgeIds,
  });
  const groupInputHandlers = useMemo(() => createGroupInputHandlers(groupInputCtxRef), [groupInputCtxRef]);
  const draggingGroupId = draggingNodeInfo?.groupId ?? null;
  const groupElements = useMemo(() => buildGroupElements({
    groupLayouts, groupDepths: groupStructure.groupDepths, draggingGroupId, editingGroupId, tempGroupName,
    theme, gridActive, gridPatternId, groupEditInputRef, handlers: groupInputHandlers,
  }), [groupLayouts, groupStructure, draggingGroupId, editingGroupId, tempGroupName, theme, gridActive, gridPatternId, groupInputHandlers]);

  // Publish the layout to the refs the rest of the canvas reads (drag, gamepad,
  // edges, the anchor flush). Rebuilt, not accumulated: a group that is gone (or
  // has become undrawable — emptied, or its layout bailed) must leave no rect
  // behind, or the controller keeps aiming at a pill nobody draws.
  groupTitleRectsRef.current.clear();
  for (const [id, r] of groupLayouts.titleRects) groupTitleRectsRef.current.set(id, r);
  for (const [id, a] of groupLayouts.anchorPositions) anchorPositionUpdatesRef.current.set(id, a);
  nodeGroupBackgroundsByDepthRef.current = groupElements.backgroundsByDepth;
  nodeGroupTitlesRef.current = groupElements.titles;
  thingGroupMemberIdsRef.current = groupLayouts.thingGroupMemberIds;
  anchorInstanceIdsRef.current = groupLayouts.anchorIds;
  nestedRegularGroupsByDepthRef.current = groupElements.nestedRegularByDepth;

  return (
    <>
        <div
          ref={setCanvasAreaRef}
          className="canvas-area"
          style={{
            flexGrow: 1,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: theme.canvas.bg,
            touchAction: 'none',
          }}
          // Event handlers uncommented
          onWheel={handleWheel}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUpCanvas}
          onMouseLeave={clearVisionAid}
          onClick={handleCanvasClick}
          onTouchStart={touch.handleTouchStartCanvas}
          onTouchMove={touch.handleTouchMoveCanvas}
          onTouchEnd={touch.handleTouchEndCanvas}
          onTouchCancel={touch.handleTouchEndCanvas}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, getCanvasContextMenuOptions(e.clientX, e.clientY));
          }}
        >
          {(isUniverseLoading || !isUniverseLoaded || !hasUniverseFile) ? (
            // Loading, or no universe yet (with the load error and the GitHub
            // reconnect card): UniverseScreens since P2.06c.
            <UniverseScreens />
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
              <div style={{ fontSize: '16px', color: theme.canvas.textPrimary, opacity: 0.7 }}>
                Open a New Thing
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Same act as the header's + (Create New Thing), so it gets the
                  // same feedback — see Header.jsx's action row — and opens the
                  // same selector rather than minting an unnamed Web.
                  haptic('menuSelect');
                  openNewWebPrompt();
                }}
                onTouchEnd={(e) => {
                  // The canvas container uses touchAction:'none' and intercepts touch events,
                  // which prevents synthetic clicks from firing on this button on mobile.
                  // Handle the tap explicitly here.
                  e.stopPropagation();
                  haptic('menuSelect');
                  openNewWebPrompt();
                }}
                style={{
                  width: '120px',
                  height: '120px',
                  backgroundColor: 'transparent',
                  border: `3px dotted ${theme.canvas.textPrimary}`,
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  outline: 'none',
                  touchAction: 'manipulation'
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
                <Plus size={48} strokeWidth={2} color={theme.canvas.textPrimary} />
              </button>
            </div>
          ) : (
            <>
              <svg
                ref={svgRef}
                className="canvas"
                width={canvasSize.width}
                height={canvasSize.height}
                style={{
                  opacity: 1,
                  pointerEvents: 'auto',
                  overflow: 'visible',
                  touchAction: 'none',
                }}
                onMouseUp={handleMouseUp} // Uncommented
              // No onMouseMove: the .canvas-area div's binding covers it (F-02, P1.03).
              >
                {/* Pan/zoom transform is written to this <g> via SVG attribute. */}
                <g ref={contentGroupRef}>
                  {/* Cluster hulls (debug) and the grid sit under groups, nodes and edges (P3.09). */}
                  {showClusterHulls && <ClusterHullsLayer nodes={hydratedNodes} edges={edges} />}
                  {gridActive && (
                    <GridLayer
                      gridSize={gridSize} appearance={gridAppearance} darkMode={theme.darkMode}
                      dotColor={theme.canvas.textPrimary} canvasSize={canvasSize} patternId={gridPatternId}
                    />
                  )}

                  {/* Regular groups, at the bottom of the stack (P3.04: built by the groupElements memo). */}
                  {groupElements.regular}
                  {/* Debug: Node Hitbox Visualization */}
                  {showNodeHitboxes && hydratedNodes.map(node => {
                    const dims = baseDimsById.get(node.id);
                    if (!dims) return null;

                    const isSelected = selectedInstanceIds.has(node.id);
                    const hitbox = getNodeHitbox(node, dims, isSelected);

                    return (
                      <rect
                        key={`hitbox-${node.id}`}
                        x={hitbox.minX}
                        y={hitbox.minY}
                        width={hitbox.maxX - hitbox.minX}
                        height={hitbox.maxY - hitbox.minY}
                        fill="cyan"
                        fillOpacity={0.15}
                        stroke="cyan"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        pointerEvents="none"
                        style={{ mixBlendMode: 'multiply' }}
                      />
                    );
                  })}

                  {isViewReady && (
                    <EdgeLayer
                      ctx={edgeRenderCtx} visibleEdges={visibleEdges} edgeZSlots={groupStructure.edgeZSlots}
                      nodeGroupShellsByDepth={groupElements.backgroundsByDepth}
                      nestedRegularGroupsByDepth={groupElements.nestedRegularByDepth} edgePerfRef={edgePerfRef}
                    />
                  )}

                  {/* Drawing connection line (same z-level as existing edges, below nodes).
                    Hidden while dragging — a race can leak `drawingConnectionFrom` state
                    into a drag, which would otherwise leave a frozen black stub behind. */}
                  {drawingConnectionFrom && !draggingNodeInfo && (
                    <line
                      ref={drawingConnectionLineRef}
                      x1={drawingConnectionFrom.startX}
                      y1={drawingConnectionFrom.startY}
                      /* Endpoint is ref-owned (see drawingConnectionEndRef) and re-asserted
                         imperatively after every commit — rendered here only so a fresh
                         mount paints in the right place. */
                      x2={drawingConnectionEndRef.current.x}
                      y2={drawingConnectionEndRef.current.y}
                      stroke="black"
                      strokeWidth={27 * connectionWidth}
                    />
                  )}
                  {/* Self-loop preview. Gated on the state flag rather than on the live
                    endpoint: the flag is what re-renders this at all, since endpoint
                    movement no longer goes through React. */}
                  {drawingConnectionFrom && !draggingNodeInfo && selfLoopPreviewActive && (() => {
                    const srcNode = nodes.find(n => n.id === drawingConnectionFrom.sourceInstanceId);
                    if (!srcNode) return null;
                    const srcDims = baseDimsById.get(srcNode.id) || getNodeDimensions(srcNode, false, null);
                    const sx = srcNode.x;
                    const sy = srcNode.y;
                    const existing = countSelfLoopsForNode(visibleEdges, srcNode.id);
                    const loop = calculateSelfLoopPath(sx, sy, srcDims.currentWidth, srcDims.currentHeight, { pairIndex: existing, totalInPair: existing + 1 });
                    return (
                      <path
                        d={loop.path}
                        fill="none"
                        stroke="black"
                        strokeWidth={10 * connectionWidth}
                        strokeDasharray="6 6"
                        strokeLinecap="round"
                        opacity="0.7"
                        style={{ pointerEvents: 'none' }}
                      />
                    );
                  })()}

                  {/* Nodes: ordinary, then node-group members (P3.08b: NodeLayer reads selection and preview itself). */}
                  <NodeLayer part="rest" {...nodeLayerProps} />

                  {/* Groups Phase 3: Thing-group titles (above member nodes, below active/dragging) */}
                  {groupElements.titles}

                  {/* Delete ghost rects (P2.07) */}
                  <DeletionGhostLayer />

                  {/* Render The PieMenu next (it will be visually under the active node) */}
                  {isPieMenuRendered && hasPieMenuData && (
                    <NodePieMenuLayer
                      nodeScale={textSettings?.nodeScale ?? 1.0}
                      focusedNode={carouselFocusedNode}
                      pageCount={/* Counted off nodePieMenuPages rather than written down here, so
                                    adding a page to that list grows the chevrons' range on its own.
                                    Carousel and decomposition build their own single-page sets. */
                        (!abstractionCarouselVisible && !(previewingNodeId && previewingNodeId === selectedNodeIdForPieMenu)) ? nodePieMenuPages.length : 1}
                      currentPage={pieMenuPage}
                      onPageChange={setPieMenuPage}
                      focusedButtonIndex={gamepadMode === 'node' ? gamepadPieFocusedIndex : -1}
                      isVisible={(
                        currentPieMenuNodeId === selectedNodeIdForPieMenu &&
                        // Orbit owns the screen while it is up. Hiding via
                        // isVisible (rather than clearing the target) keeps
                        // the menu mounted and its page intact, so leaving
                        // orbit animates it back exactly where it was.
                        !semanticOrbitActive &&
                        (!isTransitioningPieMenu || abstractionPrompt.visible || carouselAnimationState === 'exiting') &&
                        !(draggingNodeInfo &&
                          (draggingNodeInfo.primaryId === selectedNodeIdForPieMenu || draggingNodeInfo.instanceId === selectedNodeIdForPieMenu)
                        )
                      )}
                      onHoverChange={handlePieMenuHoverChange}
                      onExitAnimationComplete={handlePieExitComplete}
                    />
                  )}

                  {/* Edge pie menu — rendered inline at the edge midpoint */}
                  {(() => {
                    // Live midpoint wins whenever there is one; the frozen ref only stands in
                    // once the edge is deselected, which is the case it exists for — the
                    // bubbles have to finish shrinking where they were.
                    //
                    // Same reasoning as frozenButtons below, and for the same reason: the
                    // effect that maintains this ref writes it AFTER the render that changed
                    // the selection, and a ref write re-renders nothing. Reading the ref first
                    // therefore pinned the menu to the previous connection until an unrelated
                    // render came along — the visible stall when clicking from one connection
                    // straight to another. The glide to the new midpoint is a CSS transition on
                    // the bubbles (see PieMenu's line mode), so it plays either way; this only
                    // decides whether it starts now or whenever something else happens to render.
                    const anchor = selectedEdgeMidpoint || edgePieMenuAnchorRef.current;
                    // Live buttons win whenever there are any; the frozen ref only stands in once
                    // the list empties out, which is exactly the case it exists for — the edge is
                    // deselected while the menu is still animating away, and the bubbles have to
                    // finish shrinking on the set they were showing.
                    //
                    // Deliberately not the other way round: this list changes under an open menu
                    // (Copy makes Paste available, pasting a definition makes Palette and Copy
                    // available), and a ref write re-renders nothing — so preferring the ref would
                    // pin the menu to whatever it had when it opened until some unrelated render
                    // happened to come along.
                    const frozenButtons = edgePieMenuButtons.length > 0
                      ? edgePieMenuButtons
                      : edgePieMenuButtonsRef.current;
                    if (!edgePieMenuRendered || !anchor || !frozenButtons || frozenButtons.length === 0) return null;

                    // Hide (outro) while a node this edge is attached to is being dragged —
                    // mirrors the node's own PieMenu (isVisible gated on draggingNodeInfo above).
                    // The anchor position is frozen mid-drag (nodeById doesn't update during
                    // DOM-bypass drag), so without this the menu would float detached from the
                    // connection until it snaps to the new spot on drop.
                    const draggedNodeIds = !draggingNodeInfo ? null
                      : draggingNodeInfo.instanceId ? new Set([draggingNodeInfo.instanceId])
                      : draggingNodeInfo.primaryId ? new Set([draggingNodeInfo.primaryId, ...Object.keys(draggingNodeInfo.relativeOffsets || {})])
                      : (draggingNodeInfo.groupId && draggingNodeInfo.memberOffsets) ? new Set(draggingNodeInfo.memberOffsets.map(m => m.id))
                      : null;
                    const edgeAttachedToDraggedNode = Boolean(draggedNodeIds && (draggedNodeIds.has(anchor.sourceId) || draggedNodeIds.has(anchor.destinationId)));

                    // No compact/"..." fallback: focusEdgePieMenuInView (see the
                    // focus-on-select effect) zooms the view to the menu's own bounds
                    // whenever the row wouldn't fit, so the full row is always reachable.
                    const displayButtons = frozenButtons;

                    return (
                      <PieMenu
                        anchor={anchor}
                        anchorAngle={anchor.angle ?? 0}
                        buttons={displayButtons}
                        focusedButtonIndex={gamepadMode === 'edge' ? gamepadPieFocusedIndex : -1}
                        nodeScale={textSettings?.nodeScale ?? 1.0}
                        isVisible={edgePieMenuVisible && !edgeAttachedToDraggedNode}
                        onHoverChange={handlePieMenuHoverChange}
                        onExitAnimationComplete={() => {
                          edgePieMenuAnchorRef.current = null;
                          edgePieMenuButtonsRef.current = null;
                          setEdgePieMenuRendered(false);
                        }}
                      />
                    );
                  })()}

                  {/* Dim overlay for semantic orbit mode.
                      Plain SVG rect (not foreignObject) so it stays in proper paint order
                      on iOS WebKit — foreignObject with backdrop-filter punches itself to
                      the top of the stack and eats taps on orbit items. */}
                  {semanticOrbitActive && (
                    <rect
                      /* Geometry is set imperatively (viewport-sized, tracks
                         every pan/zoom tick) — see updateOrbitDimRect. Kept out
                         of JSX so React re-renders don't clobber it. */
                      ref={(el) => {
                        orbitDimRectRef.current = el;
                        if (el) updateOrbitDimRect();
                      }}
                      data-orbit-dim=""
                      /* Dimming off: transparent and static at full canvas
                         size — nothing to paint, nothing to blend through,
                         no per-tick geometry writes, and still the click
                         target that exits orbit mode. */
                      {...(ENABLE_ORBIT_DIM ? null : {
                        x: canvasSize.offsetX,
                        y: canvasSize.offsetY,
                        width: canvasSize.width,
                        height: canvasSize.height,
                      })}
                      fill={ENABLE_ORBIT_DIM ? 'rgba(0, 0, 0, 0.7)' : 'transparent'}
                      /* touchAction 'none', like the canvas surface this
                         covers — every gesture here is the app's to
                         interpret. It read 'manipulation' before, copied
                         from a small button where handing pan and pinch
                         back to the browser is harmless; on something
                         spanning the whole canvas it is not. */
                      style={{ cursor: 'pointer', touchAction: 'none' }}
                      onMouseDown={(e) => {
                        orbitClickDownPos.current = { x: e.clientX, y: e.clientY };
                      }}
                      onClick={(e) => {
                        const down = orbitClickDownPos.current;
                        orbitClickDownPos.current = null;
                        // No matching mousedown means this is a synthesized click after a
                        // touch gesture (pan) — ignore. Real mouse clicks always come with
                        // a mousedown right before.
                        if (!down) return;
                        const dx = e.clientX - down.x;
                        const dy = e.clientY - down.y;
                        if (dx * dx + dy * dy > 25) return; // moved >5px = was a pan
                        e.stopPropagation();
                        exitOrbitMode();
                      }}
                      onTouchStart={(e) => {
                        // Only a one-finger sequence can be a tap. A second finger
                        // means a pinch, which is the canvas's gesture, not ours.
                        const t = e.touches?.length === 1 ? e.touches[0] : null;
                        orbitClickDownPos.current = t ? { x: t.clientX, y: t.clientY } : null;
                      }}
                      onTouchEnd={(e) => {
                        const down = orbitClickDownPos.current;
                        orbitClickDownPos.current = null;
                        // Suppress the synthetic click that follows touchend either way,
                        // so a pan-then-lift can't fall through to onClick and exit.
                        if (e.cancelable) e.preventDefault();

                        const t = e.changedTouches?.[0];
                        const isTap = down && t
                          && e.touches?.length === 0            // last finger up
                          && (t.clientX - down.x) ** 2 + (t.clientY - down.y) ** 2 <= 25;

                        // Deliberately does NOT stop propagation, for any outcome.
                        //
                        // The canvas's own touchend is where a gesture gets torn down —
                        // the pinch flag cleared, pan momentum launched — and it is also
                        // what removes the document-level touchmove/touchend listeners
                        // that handleTouchStartCanvas attached for this gesture. Stopping
                        // propagation here (which React forwards to the native event, so
                        // the document listeners never fire either) meant that in orbit
                        // mode none of it ran: pans lost their inertia, every touch leaked
                        // a live touchmove listener, and after a pinch the pinch flag
                        // stayed set, so every later touch was read as a continuing pinch
                        // and panning stopped working at all.
                        //
                        // The canvas will read a tap here as a bare-canvas tap and clear
                        // the selection, which exits orbit by way of the deselect effect.
                        // Exiting explicitly as well is harmless and does not depend on
                        // that chain holding.
                        if (isTap) exitOrbitMode();
                      }}
                    />
                  )}


                  {/* The active node (with the orbit overlay while orbiting), then the dragged node, on top. */}
                  <NodeLayer part="top" {...nodeLayerProps} />

                  {/* Marquee: geometry is written by setMarqueeRectEl, never by React. */}
                  {selectionStart && (
                    <rect
                      ref={setMarqueeRectEl}
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
                      gestureBlockRef={gestureBlockRef}
                      isPanningOrZoomingRef={isPanningOrZooming}
                      {...(plusSign.tempName ? (() => {
                        const { morphNode, dims, center } = getPlusSignMorphTarget(plusSign);
                        const W = dims.currentWidth;
                        const H = dims.currentHeight;
                        // Only draw the image once it's decoded (see handleNodeSelection);
                        // otherwise the slot is still reserved and the node fills it in.
                        const hasImage = plusSign.imageReady && Boolean(morphNode.thumbnailSrc) && dims.calculatedImageHeight > 0;
                        return {
                          targetCenter: center,
                          // Make the PlusSign slightly smaller so the final node feels like an expansion
                          targetWidth: W * 0.9,
                          targetHeight: H * 0.9,
                          targetCornerRadius: dims.scaledCornerRadius,
                          // Image slot as fractions of the node box, so it tracks the morphing rect.
                          targetImage: hasImage ? {
                            src: morphNode.thumbnailSrc,
                            fx: (W - dims.imageWidth) / 2 / W,
                            fy: dims.textAreaHeight / H,
                            fw: dims.imageWidth / W,
                            fh: dims.calculatedImageHeight / H,
                          } : null,
                        };
                      })() : {
                        targetWidth: NODE_WIDTH,
                        targetHeight: NODE_HEIGHT,
                        targetCornerRadius: NODE_CORNER_RADIUS * 1.4 * (textSettings?.nodeScale ?? 1.0),
                      })}
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
                </g>
              </svg>

              {/* Orbit scrim. An HTML layer above the <svg>, NOT a rect inside
                  it: a translucent element inside the content group makes the
                  canvas's own tiles non-opaque, so the whole graph beneath has
                  to be blended instead of discarded — that is what exhausted
                  the GPU tile budget in orbit mode. As a sibling layer it is a
                  single flat composite on the GPU and costs essentially
                  nothing. pointer-events stays off so the transparent rect
                  inside the canvas keeps handling click-to-exit unchanged. */}
              {semanticOrbitActive && (() => {
                const blurPx = typeof window !== 'undefined' && window.__orbitBlur != null
                  ? Number(window.__orbitBlur)
                  : ORBIT_SCRIM_BLUR_PX;
                const blur = blurPx > 0 ? `blur(${blurPx}px)` : undefined;
                return (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: ORBIT_SCRIM_COLOR,
                      backdropFilter: blur,
                      WebkitBackdropFilter: blur, // Safari / iOS still need the prefix
                      pointerEvents: 'none',
                    }}
                  />
                );
              })()}

              {/* Orbit layer. Geometry mirrors the main <svg> exactly (same
                  origin, same size) and its content group carries the same
                  transform, so anything portalled in here lands where it would
                  have inside the canvas — just above the scrim. Only mounted
                  during orbit, so normal rendering is untouched. */}
              {semanticOrbitActive && (
                <svg
                  className="canvas-orbit-layer"
                  width={canvasSize.width}
                  height={canvasSize.height}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    overflow: 'visible',
                    // Empty space must fall through to the canvas beneath; the
                    // content group re-enables hits on the shapes themselves.
                    pointerEvents: 'none',
                  }}
                >
                  <g ref={setOverlayGroup} style={{ pointerEvents: 'auto' }} />
                </svg>
              )}

              <HoverVisionAidLayer headerHeight={headerHeight} zoomLevel={zoomLevel} />

              {/* The controller's cursor. Pinned to the absolute screen centre
                  so panels opening and closing never move it, and the zoom is
                  anchored on the same point, so the world scales under it
                  without sliding. */}
              <GamepadCrosshair
                visible={gamepadActive}
                viewportBounds={viewportBounds}
                headerHeight={headerHeight}
                scale={gamepadCrosshairScale}
              />
            </>
          )}

          {/* Edge glow indicators for off-screen nodes */}
          {edgeGlowMode !== 'off' && (
            <EdgeGlowIndicator
              nodes={hydratedNodes}
              baseDimensionsById={baseDimsById}
              panOffset={panOffset}
              zoomLevel={zoomLevel}
              panOffsetRef={panOffsetRef}
              zoomLevelRef={zoomLevelRef}
              glowUpdateRef={glowUpdateRef}
              leftPanelExpanded={leftPanelExpanded}
              rightPanelExpanded={rightPanelExpanded}
              previewingNodeId={previewingNodeId}
              containerRef={containerRef}
              showViewportDebug={false}
              showDirectionLines={false}
            />
          )}

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

          {/* One-time desktop-app nudge (web only). Held back while first-run
              setup is up — nobody needs a download offer before they have a
              universe — and while a bottom control panel is showing, since both
              center on the same strip of canvas above the TypeList. The pill is
              in no hurry: it waits and pops once the way is clear. */}
          <DownloadAppPill
            suppressed={
              showStorageSetupModal ||
              nodeControlPanelShouldShow || nodeControlPanelVisible ||
              connectionControlPanelShouldShow || connectionControlPanelVisible ||
              abstractionControlPanelShouldShow || abstractionControlPanelVisible
            }
          />

          {/* Overlay panel resizers (outside panels) */}
          <PanelResizers controlRef={panelResizeControlRef} />

          <PromptsHost ctx={promptsCtx} />
          {/* Debug overlay disabled */}
        </div>

        <HurtleOrb flight={hurtleFlight} onLand={handleHurtleLand} />

      {placeOverlays(<>

      {/* The bottom control panels and the effects that choose between them (P5.05a). */}
      <ControlPanelsHost ctx={controlPanelsCtx} />

      <CanvasOverlaysHost ctx={canvasOverlaysCtx} />
      </>)}
    </>
  );
}

export default NodeCanvas;
