import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Trash2, Plus, ArrowUpFromDot, ChevronLeft, ChevronRight, Package, PackageOpen, Layers, Edit3, Bookmark, Palette, Orbit, Group, Ungroup, SquarePlus, Combine, Maximize2, Minimize2, Sparkles, NotebookText, Save, RefreshCw, ClipboardCopy, CopyPlus } from 'lucide-react';
import UniversalNodeRenderer from './UniversalNodeRenderer';
import { RENDERER_PRESETS } from './UniversalNodeRenderer.presets';
import { useTheme } from './hooks/useTheme.js';
import useGraphStore from "./store/graphStore.js";
import useMobileDetection from './hooks/useMobileDetection';
import { getTextColor, getConnectionLabelColors, DEFAULT_CONNECTION_LABEL_RING_WIDTH, DEFAULT_CONNECTION_LABEL_COLOR_MODE, DEFAULT_CONNECTION_LABEL_OUTER_RING } from './utils/colorUtils.js';
import { haptic } from './services/haptics.js';
import './UnifiedBottomControlPanel.css';

// Small helper to render a triangle cap (rounded-ish via strokeJoin/lineJoin aesthetics)
const TriangleCap = ({ direction = 'left', color = null, variant = 'ghost', onClick }) => {
  const theme = useTheme();
  const actualColor = color === null ? theme.node.fill : color;

  // Ensure arrows face OUTWARD from the center rail on the X axis
  // Left cap should point LEFT; Right cap should point RIGHT
  const pointsLeftFacing = '2,11 20,2 20,20';
  const pointsRightFacing = '20,11 2,2 2,20';
  const points = direction === 'left' ? pointsLeftFacing : pointsRightFacing;
  const className = `predicate-arrow ${variant === 'ghost' ? 'ghost' : 'solid'}`;
  return (
    <svg className={className} viewBox="0 0 22 22" style={{ color }} onClick={onClick}>
      <polygon points={points} fill={variant === 'ghost' ? 'none' : color} />
    </svg>
  );
};

/**
 * The page-turn arrow, built the way PieMenu builds its own (see renderChevron):
 * one two-arm polyline stroked twice — a wide maroon band underneath, a narrower
 * #DEDADA band on top — so the maroon reads as an outline around a bubble-coloured
 * arrow rather than as a fill. Round caps and joins do the rest.
 *
 * Deliberately NOT a .piemenu-button. On the canvas these arrows sit outside the
 * ring of bubbles and are bare arrows precisely so that turning the page doesn't
 * look like taking an action; wrapping them in another maroon circle here would
 * throw that distinction away at exactly the moment the row grows a second page.
 *
 * Geometry is in viewBox units, at the proportions the canvas menu lands on for a
 * typical node: arm span 100, depth 42, fill 20, outline 7 a side. The box is
 * padded by half the outer stroke (17) so the round caps aren't clipped.
 */
const PIE_CHEVRON_FILL_WIDTH = 20;
const PIE_CHEVRON_OUTER_WIDTH = PIE_CHEVRON_FILL_WIDTH + 7 * 2;

const PieChevron = ({ direction, onClick, title }) => {
  const points = direction === 'left'
    ? '21,-50 -21,0 21,50'
    : '-21,-50 21,0 -21,50';

  const activate = (e) => {
    e.stopPropagation();
    onClick?.(e);
  };

  return (
    <svg
      className="piemenu-chevron"
      viewBox="-38 -67 76 134"
      role="button"
      aria-label={title}
      title={title}
      onClick={activate}
    >
      <polyline
        points={points}
        fill="none"
        stroke="maroon"
        strokeWidth={PIE_CHEVRON_OUTER_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={points}
        fill="none"
        stroke="#DEDADA"
        strokeWidth={PIE_CHEVRON_FILL_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const NodePill = ({ name, color = '#800000', onClick }) => {
  return (
    <div
      className="node-pill"
      style={{ backgroundColor: color }}
      onClick={onClick}
    >
      {name}
    </div>
  );
};

const RAIL_LABEL_STROKE_PX = 2;
const railLabelStyle = {
  display: 'block',
  fontWeight: 'bold',
  fontSize: '24px',
  fontFamily: "'EmOne', sans-serif",
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const PredicateRail = ({ color = '#4A5568', leftActive, rightActive, onToggleLeft, onToggleRight, onClickCenter, centerWidth = 140, label }) => {
  const theme = useTheme();
  const connectionLabelColorMode = useGraphStore(state => state.connectionLabelColorMode ?? DEFAULT_CONNECTION_LABEL_COLOR_MODE);
  const connectionLabelOuterRing = useGraphStore(state => state.connectionLabelOuterRing ?? DEFAULT_CONNECTION_LABEL_OUTER_RING);
  const connectionLabelRingWidth = useGraphStore(state => state.connectionLabelRingWidth ?? DEFAULT_CONNECTION_LABEL_RING_WIDTH);
  const labelColors = getConnectionLabelColors(color, theme.darkMode, connectionLabelColorMode, connectionLabelOuterRing);
  return (
    <div className="predicate-rail" onClick={onClickCenter}>
      <TriangleCap direction="left" color={color} variant={leftActive ? 'solid' : 'ghost'} onClick={(e) => { e.stopPropagation(); onToggleLeft?.(); }} />
      <div className="predicate-rect" style={{
        borderRadius: '8px',
        backgroundColor: theme.canvas.bg,
        border: '1px solid rgba(38, 0, 0, 0.2)',
      }}>
        <span style={{ position: 'relative', display: 'inline-block', minWidth: 0 }}>
          {/* Outermost ring in the connection's own color. -webkit-text-stroke
              only takes one width, so the ring is a duplicate span stacked
              behind — same text, same box, wider stroke. aria-hidden so a
              screen reader hears the name once. */}
          {labelColors.outerStroke && (
            <span aria-hidden="true" style={{
              ...railLabelStyle,
              position: 'absolute',
              inset: 0,
              color: 'transparent',
              WebkitTextStroke: `${RAIL_LABEL_STROKE_PX * connectionLabelRingWidth}px ${labelColors.outerStroke}`,
              pointerEvents: 'none'
            }}>
              {label || 'Connection'}
            </span>
          )}
          <span style={{
            ...railLabelStyle,
            position: 'relative',
            color: labelColors.fill,
            WebkitTextStroke: `${RAIL_LABEL_STROKE_PX}px ${labelColors.stroke}`,
            paintOrder: 'stroke fill',
            textShadow: '0px 2px 3px rgba(0,0,0,0.3)'
          }}>
            {label || 'Connection'}
          </span>
        </span>
      </div>
      <TriangleCap direction="right" color={color} variant={rightActive ? 'solid' : 'ghost'} onClick={(e) => { e.stopPropagation(); onToggleRight?.(); }} />
    </div>
  );
};

import {
  previewTextFor,
  previewScaleFor,
  connectionPreviewRendererProps,
  layoutNodeChips
} from './utils/connectionPreview.js';
import { layoutConnectionRow } from './utils/connectionRowLayout.js';

// Every preview in this panel — the connection row, the node chips, the
// node-group and group pills — draws its text at the fixed on-screen size for
// the platform (PREVIEW_TEXT in utils/connectionPreview.js) and truncates when
// it runs out of room. The sizing math lives there and in
// utils/connectionRowLayout.js, shared with the hover aid and the right panel's
// Connections list, so all of them read as the same node.

/**
 * Honest usable layout width for the panel.
 *
 * The panel is position:fixed, so window.innerWidth looks like the right answer —
 * but under viewport-fit=cover (Capacitor iOS) innerWidth spans the safe-area
 * bands the app never lays out into, so the panel would size its previews for
 * space it doesn't have and get squeezed/clipped by its own
 * max-width: calc(100vw - 16px). #root carries the safe-area insets as padding
 * (App.css), so its content box is the width that actually exists.
 */
const measureAppWidth = () => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 1024;
  const root = document.getElementById('root');
  if (root) {
    const cs = window.getComputedStyle(root);
    const width = root.getBoundingClientRect().width
      - (parseFloat(cs.paddingLeft) || 0)
      - (parseFloat(cs.paddingRight) || 0);
    if (width > 0) return width;
  }
  return document.documentElement?.clientWidth || window.innerWidth || 1024;
};
// The node-chip grid stops growing here and starts scaling instead — past this
// the panel would be taller than the screen it sits on.
const NODE_GRID_MAX_HEIGHT = { desktop: 220, mobile: 200 };
// One chip never takes more than this much of a row, so a single long name is
// truncated instead of turning the strip into one wide pill.
const NODE_CHIP_MAX_WIDTH = 260;
// Widest a desktop row of chips gets before wrapping to a second row. Mobile
// rows are bounded by the viewport (and the CSS width cap on the content box).
const NODE_GRID_MAX_ROW_WIDTH = 560;

// Modes: 'nodes' | 'connections' | 'abstraction' | 'group' | 'nodegroup'
const UnifiedBottomControlPanel = ({
  mode = 'nodes',
  isVisible = true,
  typeListOpen = false,
  className = '',
  onAnimationComplete,
  onActionHoverChange,

  // Node mode props
  selectedNodes = [], // [{ id, name, color }]
  onNodeClick,

  // Connection mode props
  triples = [], // [{ id, subject: {id,name,color}, predicate: {id,name,color}, object: {id,name,color}, hasLeftArrow, hasRightArrow }]
  onToggleLeftArrow, // (tripleId) => void
  onToggleRightArrow, // (tripleId) => void
  onPredicateClick, // (tripleId) => void

  // Abstraction mode props
  customContent,

  // Group mode props
  selectedGroup, // { id, name, color, memberInstanceIds, linkedNodePrototypeId }
  onUngroup,
  onGroupEdit,
  onGroupColor,
  onConvertToNodeGroup,

  // Node-group mode props
  onDiveIntoDefinition, // Navigate into the node-group's linked definition graph
  onOpenNodePrototypeInPanel, // Open the linked node prototype in right panel
  onCombineNodeGroup, // Replace group instances with the node-group prototype instance
  onUpdateDefinitionFromGroup, // Push the group's current contents into its definition graph, overwriting it
  onRefreshGroupFromDefinition, // Replace the group's contents with fresh copies from its definition graph

  // Decompose mode props (mirrors the decomposition pie-menu state)
  onCompose, // Close the decomposition preview (compose back to a normal node)
  decompHasDefinitions = false, // When false, only Add + Compose are shown (empty state)

  // Pie menu button handlers
  onDelete,
  onAdd,
  onUp,
  onOpenInPanel,

  // Connection-mode wizard handler
  onAskWizard,
  wizardEnabled = false,

  // Additional node action handlers
  onDecompose,
  onAbstraction,
  onEdit,
  onSave,
  onPalette,
  onOrbit,
  onGroup,
  onCopy,
  onDuplicate,

  // The canvas pie menu's own pages for a single Thing, handed over verbatim so
  // this panel renders the same buttons rather than a transcription of them.
  // See nodePieMenuPages in NodeCanvas: adding a page there adds it here too.
  // Null (or a null target) falls back to the hand-written node buttons below,
  // which is what multi-select still uses — the pie menu has no multi-select
  // form, and its actions are all written against exactly one instance.
  pieMenuPages = null,
  pieMenuTargetInstanceId = null,

  // The same arrangement for a single connection: the canvas connection menu's
  // own buttons (see edgePieMenuButtons in NodeCanvas), handed over whole. That
  // list grows and shrinks with the connection's state and the clipboard's, so
  // transcribing it here would mean this panel silently offering a different set
  // from the one on the canvas. Null (or a null target) falls back to the
  // hand-written connection buttons below, which multi-select still uses.
  connectionPieMenuButtons = null,
  connectionPieMenuTargetEdgeId = null,

  // Optional navigations (shown on node mode)
  onLeftNav,
  onRightNav,
  hasLeftNav = false,
  hasRightNav = false,

  // Optional dismiss handler — shown as a drag handle at the top of the panel in narrow nodes mode
  onDismiss,
}) => {
  const theme = useTheme();
  const inputMode = useGraphStore(state => state.inputMode);
  const savedNodeIds = useGraphStore(state => state.savedNodeIds);
  const [animationState, setAnimationState] = useState('entering');
  const [shouldRender, setShouldRender] = useState(true);
  const nodeGroupPreviewRef = useRef(null);
  const mobileState = useMobileDetection();
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef(0);
  const dismissThresholdPx = 70;

  // Track the app's real usable width (see measureAppWidth) rather than trusting
  // window.innerWidth, which diverges from it inside the iOS web view.
  const [appWidth, setAppWidth] = useState(measureAppWidth);
  useEffect(() => {
    const update = () => setAppWidth(measureAppWidth());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    let observer;
    const root = document.getElementById('root');
    if (root && window.ResizeObserver) {
      observer = new ResizeObserver(update);
      observer.observe(root);
    }
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      observer?.disconnect();
    };
  }, []);

  const handleDismissPointerDown = useCallback((e) => {
    if (!onDismiss) return;
    e.preventDefault();
    e.stopPropagation();
    dragStartYRef.current = e.clientY;
    setIsDragging(true);
    setDragOffset(0);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
  }, [onDismiss]);

  const handleDismissPointerMove = useCallback((e) => {
    if (!isDragging) return;
    const delta = e.clientY - dragStartYRef.current;
    setDragOffset(delta);
  }, [isDragging]);

  const handleDismissPointerUp = useCallback((e) => {
    if (!isDragging) return;
    setIsDragging(false);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
    if (Math.abs(dragOffset) > dismissThresholdPx) {
      setDragOffset(dragOffset < 0 ? -320 : 320);
      setTimeout(() => {
        onDismiss?.();
      }, 220);
    } else {
      setDragOffset(0);
    }
  }, [isDragging, dragOffset, onDismiss]);

  useEffect(() => {
    if (isVisible) {
      setDragOffset(0);
      setIsDragging(false);
    }
  }, [isVisible]);

  const dragStyle = useMemo(() => {
    const absDrag = Math.abs(dragOffset);
    const scale = Math.max(0.55, 1 - absDrag / 500);
    const opacity = Math.max(0, 1 - absDrag / 260);
    return {
      transform: `translateY(${dragOffset}px) scale(${scale})`,
      opacity,
      transition: isDragging
        ? 'none'
        : 'transform 0.28s cubic-bezier(0.34, 1.4, 0.64, 1), opacity 0.28s ease-out',
      transformOrigin: 'top center',
      willChange: dragOffset > 0 || isDragging ? 'transform, opacity' : 'auto',
    };
  }, [dragOffset, isDragging]);

  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
      setAnimationState('entering');
    } else if (shouldRender) {
      setAnimationState('exiting');
    }
  }, [isVisible]);

  const handleAnimationEnd = (e) => {
    if (e.animationName === 'unifiedBottomPanelFlyIn') {
      setAnimationState('visible');
    } else if (e.animationName === 'unifiedBottomPanelFlyOut') {
      setShouldRender(false);
      onAnimationComplete?.();
    }
  };

  useEffect(() => {
    if (animationState === 'exiting') {
      const t = setTimeout(() => {
        setShouldRender(false);
        onAnimationComplete?.();
      }, 400);
      return () => clearTimeout(t);
    }
  }, [animationState, onAnimationComplete]);

  useEffect(() => () => {
    onActionHoverChange?.(null);
  }, [onActionHoverChange]);

  const isNodes = mode === 'nodes';
  const isAbstraction = mode === 'abstraction';
  const isGroup = mode === 'group';
  const isNodeGroup = mode === 'nodegroup';
  const isDecompose = mode === 'decompose';

  const clearActionHover = useCallback(() => {
    onActionHoverChange?.(null);
  }, [onActionHoverChange]);

  const triggerActionHover = useCallback((id, label) => {
    onActionHoverChange?.({ id, label });
  }, [onActionHoverChange]);

  // Haptics for the whole button field, delegated from the root rather than
  // repeated across ~40 call sites. This panel is the flat mirror of PieMenu, so
  // it borrows PieMenu's two events wholesale: a commit is menuSelect, and the
  // ◀/▶ nav chevrons — the only .piemenu-buttons that live in an .arrow-group —
  // step through a set, which is menuPage's whole reason for existing. Capture
  // phase so the tick leads the action rather than trailing it.
  //
  // The hidden nav chevrons need no guard: they're `visibility: hidden`, which
  // takes them out of hit-testing entirely, so they never become a click target.
  const handleButtonHaptic = useCallback((e) => {
    // Page-turn arrows step through a set, same as the ◀/▶ nav chevrons below.
    if (e.target?.closest?.('.piemenu-chevron')) {
      haptic('menuPage');
      return;
    }
    const button = e.target?.closest?.('.piemenu-button');
    if (!button) return;
    haptic(button.closest('.arrow-group') ? 'menuPage' : 'menuSelect');
  }, []);

  // ---- Shared pie-menu pages -------------------------------------------------
  // The panel keeps its own page index rather than sharing the canvas menu's.
  // They are two views that happen to read the same list, and yoking their
  // scroll position together would mean paging one silently re-pages the other.
  const [pieMenuPageIndex, setPieMenuPageIndex] = useState(0);

  const pieMenuPageCount = Array.isArray(pieMenuPages) ? pieMenuPages.length : 0;
  const usePieMenuPages = isNodes && pieMenuPageCount > 0 && !!pieMenuTargetInstanceId;

  // Clamp on read: the page list is rebuilt as state changes and can get shorter
  // while the panel is parked on a page that no longer exists.
  const pagedNodeButtons = usePieMenuPages
    ? (pieMenuPages[Math.min(pieMenuPageIndex, pieMenuPageCount - 1)] || [])
    : null;

  // A different Thing is a fresh menu, not a page flip — start it at page one.
  useEffect(() => {
    setPieMenuPageIndex(0);
  }, [pieMenuTargetInstanceId]);

  const turnPieMenuPage = useCallback((delta) => {
    if (pieMenuPageCount < 2) return;
    // Wraps in both directions, matching PieMenu's chevrons.
    setPieMenuPageIndex(prev => (prev + delta + pieMenuPageCount) % pieMenuPageCount);
  }, [pieMenuPageCount]);

  const runPieMenuButton = useCallback((button, e, targetId) => {
    if (!targetId || typeof button?.action !== 'function') return;
    // Same first move PieMenu makes before running a button's action, and for the
    // same reason: an action that opens a popover (Palette) installs a
    // document-level click-away listener, and this very click would otherwise
    // carry on to document and dismiss the thing it just opened. On the canvas
    // the menu stopped propagation and Palette worked; here it did not, and
    // Palette looked dead in both the Thing and connection panels.
    e.stopPropagation();
    // Palette (and anything else that anchors a popover) is handed the button's
    // top-centre in client coords — the same shape PieMenu passes from a touch.
    const rect = e.currentTarget.getBoundingClientRect();
    button.action(targetId, {
      x: rect.left + rect.width / 2,
      y: rect.top
    });
  }, []);

  // Connections have no pages — the whole set fits one strip here, and the
  // canvas menu wraps it into rows rather than paging it.
  const useConnectionPieMenuButtons = mode === 'connections'
    && Array.isArray(connectionPieMenuButtons)
    && connectionPieMenuButtons.length > 0
    && !!connectionPieMenuTargetEdgeId;

  // Mobile-responsive icon sizing. Tracks the .piemenu-button footprint in
  // UnifiedBottomControlPanel.css — the glyph has to grow with the bubble or a
  // wider button just buys more empty margin around the same small icon.
  const iconSize = mobileState.isMobile ? 18 : 22;

  // Upper bound for any renderer containerWidth — keeps us from asking for more
  // space than the segment actually offers. On mobile the panel reserves 8px
  // viewport margin + 16px inner padding per side (see UnifiedBottomControlPanel.css
  // mode-nodes block); desktop only reserves ~12px per side.
  const viewportLimit = Math.max(
    260,
    Math.min(mobileState.width, appWidth) - (mobileState.isMobile ? 48 : 24)
  );

  // Text targets for every preview in this panel; see PREVIEW_TEXT.
  const previewText = previewTextFor(mobileState.isMobile);

  const nodeRendererMetrics = useMemo(() => {
    const padding = mobileState.isMobile ? 4 : 8;
    if (!(isNodes || isDecompose) || !Array.isArray(selectedNodes) || selectedNodes.length === 0) {
      return { nodesForRenderer: [], containerWidth: 0, containerHeight: 0, padding };
    }
    // Chips draw at the platform's fixed text size, packed into rows; a long
    // name is truncated, and only a selection too tall for the panel scales.
    const grid = layoutNodeChips({
      nodes: selectedNodes,
      text: previewText,
      maxRowWidth: mobileState.isMobile ? viewportLimit : Math.min(viewportLimit, NODE_GRID_MAX_ROW_WIDTH),
      maxHeight: mobileState.isMobile ? NODE_GRID_MAX_HEIGHT.mobile : NODE_GRID_MAX_HEIGHT.desktop,
      padding,
      columnGap: mobileState.isMobilePortrait ? 10 : 12,
      rowGap: mobileState.isMobilePortrait ? 8 : 10,
      maxChipWidth: NODE_CHIP_MAX_WIDTH
    });
    return {
      nodesForRenderer: grid.nodes,
      containerWidth: grid.containerWidth,
      containerHeight: grid.containerHeight,
      padding
    };
  }, [isNodes, isDecompose, selectedNodes, previewText, viewportLimit, mobileState.isMobile, mobileState.isMobilePortrait]);

  // Subscribed, not a getState() snapshot: the linked prototype owns the node-group's
  // name and color, so renaming or recoloring it (from here or anywhere else) has to
  // re-render this preview — a one-shot read would leave the pill showing stale identity.
  const linkedPrototypeId = isNodeGroup ? selectedGroup?.linkedNodePrototypeId : null;
  const nodeGroupPrototype = useGraphStore(
    state => (linkedPrototypeId ? state.nodePrototypes.get(linkedPrototypeId) || null : null)
  );

  // The node-group preview is one chip under the same recipe as the node grid.
  const nodeGroupRendererMetrics = useMemo(() => {
    const padding = mobileState.isMobile ? 6 : 12;
    if (!isNodeGroup || !selectedGroup) {
      return { node: null, containerWidth: 0, containerHeight: 0, padding };
    }
    const grid = layoutNodeChips({
      nodes: [{
        id: selectedGroup.linkedNodePrototypeId || selectedGroup.id || 'nodegroup-preview',
        name: nodeGroupPrototype?.name || selectedGroup.name || 'Thing Group',
        color: nodeGroupPrototype?.color || selectedGroup.color || '#800000',
        definitionGraphIds: nodeGroupPrototype?.definitionGraphIds || []
      }],
      text: previewText,
      maxRowWidth: viewportLimit,
      padding,
      maxChipWidth: NODE_CHIP_MAX_WIDTH
    });
    return {
      node: grid.nodes[0],
      containerWidth: grid.containerWidth,
      containerHeight: grid.containerHeight,
      padding
    };
  }, [isNodeGroup, selectedGroup, nodeGroupPrototype, previewText, viewportLimit, mobileState.isMobile]);
  const nodeGroupRendererNode = nodeGroupRendererMetrics.node;

  const handleNodeGroupDefinitionClick = useCallback(() => {
    if (!onDiveIntoDefinition) return;

    let rect = null;
    if (nodeGroupPreviewRef.current) {
      const { left, top, width, height } = nodeGroupPreviewRef.current.getBoundingClientRect();
      rect = { left, top, width, height };
    }

    onDiveIntoDefinition(rect);
  }, [onDiveIntoDefinition]);

  const groupRendererNode = useMemo(() => {
    if (!isGroup || !selectedGroup) return null;

    const groupName = selectedGroup.name || 'Group';
    const baseNode = {
      id: selectedGroup.id,
      name: groupName,
      color: selectedGroup.color || theme.accent.primary
    };

    // UniversalNodeRenderer decides wrapping via a fixed heuristic on the group node:
    //   charsPerLine = floor((width - 2 * sidePadding) / avgCharWidth), sidePadding 30
    //   (36 once wrapped), avgCharWidth 14 (scale-invariant — the fit scale cancels).
    // Size the pill to keep the name on one line, mirroring the canvas group tag —
    // but only up to GROUP_MAX_WIDTH. Past that the pill grows DOWN instead of out,
    // the same way the canvas tab wraps: an unbounded width just got squeezed back
    // by the fit scale, so a long name rendered as one hairline-thin line.
    const GROUP_SIDE_PADDING = 30;
    const GROUP_MULTILINE_SIDE_PADDING = 36;
    const GROUP_AVG_CHAR_WIDTH = 14;
    const GROUP_LINE_HEIGHT = 36;
    const GROUP_VERTICAL_PADDING = 16;
    const GROUP_MAX_WIDTH = 520;
    const GROUP_MAX_LINES = 3;

    const oneLineWidth = groupName.length * GROUP_AVG_CHAR_WIDTH + GROUP_SIDE_PADDING * 2 + 24;
    const width = Math.max(200, Math.min(GROUP_MAX_WIDTH, oneLineWidth));

    const charsPerLine = Math.max(1, Math.floor((width - GROUP_MULTILINE_SIDE_PADDING * 2) / GROUP_AVG_CHAR_WIDTH));
    const lineCount = oneLineWidth <= GROUP_MAX_WIDTH
      ? 1
      : Math.min(GROUP_MAX_LINES, Math.ceil(groupName.length / charsPerLine));

    return {
      ...baseNode,
      x: 0,
      y: 0,
      width,
      height: Math.max(90, lineCount * GROUP_LINE_HEIGHT + GROUP_VERTICAL_PADDING * 2),
      isGroup: true
    };
  }, [isGroup, selectedGroup]);

  // The group tag keeps its own box recipe (it wraps like the canvas tab) but is
  // drawn at the same fixed scale as everything else here: a container that is
  // exactly the tag at that scale pins the renderer's fit to it. The tag's font
  // is 30/32 of a node's, so it lands a hair under the node target.
  const groupRendererMetrics = useMemo(() => {
    const padding = mobileState.isMobile ? 4 : 8;
    if (!groupRendererNode) {
      return { containerWidth: 0, containerHeight: 0, padding };
    }
    const scale = previewScaleFor(previewText);
    const width = Math.min(viewportLimit, Math.ceil(groupRendererNode.width * scale + padding * 2));
    return {
      containerWidth: width,
      containerHeight: Math.ceil(groupRendererNode.height * scale + padding * 2),
      padding
    };
  }, [groupRendererNode, previewText, viewportLimit, mobileState.isMobile]);

  if (!shouldRender) return null;

  const multipleSelected = isNodes && Array.isArray(selectedNodes) && selectedNodes.length > 1;

  // The Bookmark fills only once the *whole* selection is saved — with one Thing
  // selected that's just its own saved state. A partially saved selection reads as
  // unsaved, which is also what pressing the button then does (see
  // handleNodePanelSave: anything unsaved means "save them all").
  const allSelectedSaved = isNodes
    && Array.isArray(selectedNodes)
    && selectedNodes.length > 0
    && selectedNodes.every(n => savedNodeIds?.has(n.id));

  return (
    <div
      className={`unified-bottom-panel mode-${mode} ${typeListOpen ? 'with-typelist' : ''} ${animationState} ${className}`}
      onAnimationEnd={handleAnimationEnd}
      onClickCapture={handleButtonHaptic}
      onTouchStart={(e) => { e.stopPropagation(); }}
    >
      <div className="unified-bottom-content" style={dragStyle}>
        <button
          type="button"
          className="unified-bottom-handle"
          aria-label="Drag down to dismiss"
          onPointerDown={handleDismissPointerDown}
          onPointerMove={handleDismissPointerMove}
          onPointerUp={handleDismissPointerUp}
          onPointerCancel={handleDismissPointerUp}
        />
        {/* Row 1: Interactive info */}
        <div className="info-row">
          {(isNodes || isDecompose) ? (
            <div className="arrow-group" style={{ marginRight: 6 }}>
              <div
                className="piemenu-button"
                onClick={onLeftNav}
                title="Previous"
                style={{ visibility: hasLeftNav ? 'visible' : 'hidden' }}
                onMouseEnter={() => triggerActionHover('control-previous', 'Previous')}
                onMouseLeave={clearActionHover}
              >
                <ChevronLeft size={iconSize} />
              </div>
            </div>
          ) : null}

          {(isNodes || isDecompose) ? (
            selectedNodes && selectedNodes.length > 0 ? (
              <UniversalNodeRenderer
                nodes={nodeRendererMetrics.nodesForRenderer}
                connections={[]}
                containerWidth={nodeRendererMetrics.containerWidth}
                containerHeight={nodeRendererMetrics.containerHeight}
                padding={nodeRendererMetrics.padding}
                ignoreGlobalScale={true}
                onNodeClick={onNodeClick}
                interactive={true}
              />
            ) : null
          ) : isNodeGroup ? (
            nodeGroupRendererNode ? (
              <div
                ref={nodeGroupPreviewRef}
                className="nodegroup-preview"
                style={{ display: 'inline-flex' }}
              >
                <UniversalNodeRenderer
                  nodes={[nodeGroupRendererNode]}
                  connections={[]}
                  containerWidth={nodeGroupRendererMetrics.containerWidth}
                  containerHeight={nodeGroupRendererMetrics.containerHeight}
                  padding={nodeGroupRendererMetrics.padding}
                  ignoreGlobalScale={true}
                  interactive={false}
                />
              </div>
            ) : null
          ) : isGroup ? (
            groupRendererNode ? (
              <UniversalNodeRenderer
                nodes={[groupRendererNode]}
                connections={[]}
                containerWidth={groupRendererMetrics.containerWidth}
                containerHeight={groupRendererMetrics.containerHeight}
                padding={groupRendererMetrics.padding}
                ignoreGlobalScale={true}
                interactive={false}
              />
            ) : null
          ) : isAbstraction ? (
            customContent
          ) : (
            (() => {
              // Get edges from store for preserving definitionNodeIds
              const edges = useGraphStore.getState().edges;

              // Extract unique nodes from triples
              const nodesMap = new Map();
              triples.forEach(t => {
                if (t.subject?.id) {
                  nodesMap.set(t.subject.id, {
                    id: t.subject.id,
                    name: t.subject.name,
                    color: t.subject.color
                  });
                }
                if (t.object?.id) {
                  nodesMap.set(t.object.id, {
                    id: t.object.id,
                    name: t.object.name,
                    color: t.object.color
                  });
                }
              });
              const previewNodes = Array.from(nodesMap.values());

              // Transform triples to the format expected by UniversalNodeRenderer
              const connections = triples.map(t => {
                // Get the original edge to preserve definitionNodeIds
                const originalEdge = edges.get(t.id);
                // Don't truncate - let it flow naturally
                const connectionName = t.predicate?.name || 'Connection';

                return {
                  id: t.id,
                  sourceId: t.subject?.id,
                  destinationId: t.object?.id,
                  connectionName,
                  color: t.predicate?.color || '#000000',
                  // Preserve original edge data for proper name resolution
                  definitionNodeIds: originalEdge?.definitionNodeIds,
                  typeNodeId: originalEdge?.typeNodeId,
                  // Add directionality for arrows
                  directionality: {
                    arrowsToward: new Set([
                      ...(t.hasLeftArrow ? [t.subject?.id] : []),
                      ...(t.hasRightArrow ? [t.object?.id] : [])
                    ])
                  }
                };
              });

              // Self-loops render as two side-by-side copies in UniversalNodeRenderer;
              // the layout budgets a second box for each.
              const selfLoopNodeIds = connections
                .filter(c => c.sourceId && c.destinationId && c.sourceId === c.destinationId)
                .map(c => c.sourceId);

              // Names and labels draw at the platform's fixed size; the row fits
              // the viewport by narrowing its gaps and then truncating its longest
              // names, never by shrinking the text. The container comes back
              // sized to the content so the renderer lands on that scale.
              const rendererPadding = 6;
              const row = layoutConnectionRow({
                nodes: previewNodes,
                labels: connections.map(conn => conn.connectionName),
                maxWidth: viewportLimit,
                text: previewText,
                padding: rendererPadding,
                duplicateNodeIds: selfLoopNodeIds,
                hasArrows: connections.some(c => c.directionality?.arrowsToward?.size > 0)
              });
              const fittedConnections = connections.map((conn, i) => ({
                ...conn,
                connectionName: row.labels[i]
              }));

              return (
                <UniversalNodeRenderer
                  {...RENDERER_PRESETS.CONNECTION_PANEL}
                  {...connectionPreviewRendererProps()}
                  nodes={row.nodes}
                  connections={fittedConnections}
                  padding={rendererPadding}
                  containerWidth={row.containerWidth}
                  containerHeight={row.containerHeight}
                  maxNodeScale={row.scale}
                  horizontalSpacing={row.spacing}
                  connectionFontScale={row.labelFontScale}
                  forceShowConnectionDots={inputMode === 'touch'}
                  onNodeClick={onNodeClick}
                  onConnectionClick={onPredicateClick}
                  onToggleArrow={(connectionId, targetNodeId) => {
                    // Ensure connectionId is a string, not an object
                    const edgeId = typeof connectionId === 'string' ? connectionId : connectionId?.id || connectionId;

                    // Determine if this is left or right arrow based on target
                    const triple = triples.find(t => t.id === edgeId);
                    if (triple && triple.subject?.id === targetNodeId) {
                      onToggleLeftArrow?.(edgeId);
                    } else if (triple && triple.object?.id === targetNodeId) {
                      onToggleRightArrow?.(edgeId);
                    }
                  }}
                />
              );
            })()
          )}

          {(isNodes || isDecompose) ? (
            <div className="arrow-group" style={{ marginLeft: 6 }}>
              <div
                className="piemenu-button"
                onClick={onRightNav}
                title="Next"
                style={{ visibility: hasRightNav ? 'visible' : 'hidden' }}
                onMouseEnter={() => triggerActionHover('control-next', 'Next')}
                onMouseLeave={clearActionHover}
              >
                <ChevronRight size={iconSize} />
              </div>
            </div>
          ) : null}
        </div>

        {/* Row 2: Pie-menu buttons */}
        <div className="piemenu-row">
          <div className="piemenu-buttons">
            {isDecompose ? (
              // Decompose mode: mirror the decomposition pie-menu options. With definitions:
              // Open, Delete, Decompose Further, Compose. Empty state: Add, Compose.
              decompHasDefinitions ? (
                <>
                  <div
                    className="piemenu-button"
                    onClick={onUp}
                    title="Open"
                    onMouseEnter={() => triggerActionHover('control-decomp-open', 'Open')}
                    onMouseLeave={clearActionHover}
                  >
                    <ArrowUpFromDot size={iconSize} />
                  </div>
                  <div
                    className="piemenu-button"
                    onClick={onAdd}
                    title="Add Definition"
                    onMouseEnter={() => triggerActionHover('control-decomp-add', 'Add Definition')}
                    onMouseLeave={clearActionHover}
                  >
                    <Plus size={iconSize} />
                  </div>
                  <div
                    className="piemenu-button"
                    onClick={onDelete}
                    title="Delete Definition"
                    onMouseEnter={() => triggerActionHover('control-decomp-delete', 'Delete Definition')}
                    onMouseLeave={clearActionHover}
                  >
                    <Trash2 size={iconSize} />
                  </div>
                  <div
                    className="piemenu-button"
                    onClick={onDecompose}
                    title="Decompose Further"
                    onMouseEnter={() => triggerActionHover('control-decomp-further', 'Decompose Further')}
                    onMouseLeave={clearActionHover}
                  >
                    <PackageOpen size={iconSize} />
                  </div>
                  <div
                    className="piemenu-button"
                    onClick={onCompose}
                    title="Compose"
                    onMouseEnter={() => triggerActionHover('control-decomp-compose', 'Compose')}
                    onMouseLeave={clearActionHover}
                  >
                    <Package size={iconSize} />
                  </div>
                </>
              ) : (
                <>
                  <div
                    className="piemenu-button"
                    onClick={onAdd}
                    title="Add Definition"
                    onMouseEnter={() => triggerActionHover('control-decomp-add', 'Add Definition')}
                    onMouseLeave={clearActionHover}
                  >
                    <Plus size={iconSize} />
                  </div>
                  <div
                    className="piemenu-button"
                    onClick={onDecompose}
                    title="Decompose"
                    onMouseEnter={() => triggerActionHover('control-decomp-further', 'Decompose')}
                    onMouseLeave={clearActionHover}
                  >
                    <PackageOpen size={iconSize} />
                  </div>
                  <div
                    className="piemenu-button"
                    onClick={onCompose}
                    title="Compose"
                    onMouseEnter={() => triggerActionHover('control-decomp-compose', 'Compose')}
                    onMouseLeave={clearActionHover}
                  >
                    <Package size={iconSize} />
                  </div>
                </>
              )
            ) : usePieMenuPages ? (
              // Single Thing: render the canvas pie menu's own pages, flanked by
              // page-turn arrows when there is more than one. Nothing about which
              // buttons exist is decided here — see the pieMenuPages prop.
              <>
                {pieMenuPageCount > 1 && (
                  <PieChevron
                    direction="left"
                    title="Previous page"
                    onClick={() => turnPieMenuPage(-1)}
                  />
                )}
                {pagedNodeButtons.map((button) => {
                  const Icon = button.icon;
                  return (
                    <div
                      key={button.id}
                      className="piemenu-button"
                      onClick={(e) => runPieMenuButton(button, e, pieMenuTargetInstanceId)}
                      title={button.label}
                      onMouseEnter={() => triggerActionHover(`control-${button.id}`, button.label)}
                      onMouseLeave={clearActionHover}
                    >
                      {Icon && <Icon size={iconSize} />}
                    </div>
                  );
                })}
                {pieMenuPageCount > 1 && (
                  <PieChevron
                    direction="right"
                    title="Next page"
                    onClick={() => turnPieMenuPage(1)}
                  />
                )}
              </>
            ) : isNodes && multipleSelected ? (
              // Multi-select: only the actions that mean something for a *set* of
              // Things. Everything else the panel can offer (Open Web, Decompose,
              // Abstraction, Edit, Orbit) is written against a single instance and
              // would silently act on whichever Thing sorted first, so it stays out
              // of this row entirely rather than lying about its scope.
              <>
                <div
                  className="piemenu-button"
                  onClick={onGroup}
                  title="Group Selection"
                  onMouseEnter={() => triggerActionHover('control-group-selection', 'Group Selection')}
                  onMouseLeave={clearActionHover}
                >
                  <Group size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onCopy}
                  title="Copy"
                  onMouseEnter={() => triggerActionHover('control-copy', 'Copy')}
                  onMouseLeave={clearActionHover}
                >
                  <ClipboardCopy size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onDuplicate}
                  title="Duplicate"
                  onMouseEnter={() => triggerActionHover('control-duplicate', 'Duplicate')}
                  onMouseLeave={clearActionHover}
                >
                  <CopyPlus size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={(e) => {
                    // See runPieMenuButton: the click must not reach document,
                    // or the picker's click-away closes it as it opens.
                    e.stopPropagation();
                    if (!onPalette) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const activeNode = selectedNodes?.[0];
                    onPalette({
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                      color: getTextColor(activeNode?.color || '#800000', theme.darkMode),
                    });
                  }}
                  title="Palette"
                  onMouseEnter={() => triggerActionHover('control-palette', 'Palette')}
                  onMouseLeave={clearActionHover}
                >
                  <Palette size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onSave}
                  title={allSelectedSaved ? 'Unsave' : 'Save'}
                  onMouseEnter={() => triggerActionHover('control-save', allSelectedSaved ? 'Unsave' : 'Save')}
                  onMouseLeave={clearActionHover}
                >
                  <Bookmark size={iconSize} fill={allSelectedSaved ? 'maroon' : 'none'} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onDelete}
                  title="Delete"
                  onMouseEnter={() => triggerActionHover('control-delete', 'Delete')}
                  onMouseLeave={clearActionHover}
                >
                  <Trash2 size={iconSize} />
                </div>
              </>
            ) : isNodes ? (
              // Single Thing with no pie-menu pages to render (and the panel's exit
              // animation, where the target id is already gone): the pie menu has no
              // form for this, so these stay hand-written.
              <>
                <div
                  className="piemenu-button"
                  onClick={onUp}
                  title="Open Web"
                  onMouseEnter={() => triggerActionHover('control-open-web', 'Open Web')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowUpFromDot size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onDecompose || onAdd}
                  title="Decompose"
                  onMouseEnter={() => triggerActionHover('control-decompose', 'Decompose')}
                  onMouseLeave={clearActionHover}
                >
                  <PackageOpen size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onAbstraction || onOpenInPanel}
                  title="Abstraction"
                  onMouseEnter={() => triggerActionHover('control-abstraction', 'Abstraction')}
                  onMouseLeave={clearActionHover}
                >
                  <Layers size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onDelete}
                  title="Delete"
                  onMouseEnter={() => triggerActionHover('control-delete', 'Delete')}
                  onMouseLeave={clearActionHover}
                >
                  <Trash2 size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onEdit || onUp}
                  title="Edit"
                  onMouseEnter={() => triggerActionHover('control-edit', 'Edit')}
                  onMouseLeave={clearActionHover}
                >
                  <Edit3 size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onSave || onAdd}
                  title={allSelectedSaved ? 'Unsave' : 'Save'}
                  onMouseEnter={() => triggerActionHover('control-save', allSelectedSaved ? 'Unsave' : 'Save')}
                  onMouseLeave={clearActionHover}
                >
                  <Bookmark size={iconSize} fill={allSelectedSaved ? 'maroon' : 'none'} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={(e) => {
                    // See runPieMenuButton: the click must not reach document,
                    // or the picker's click-away closes it as it opens.
                    e.stopPropagation();
                    if (onPalette) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const activeNode = selectedNodes?.[0];
                      const buttonCenter = {
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                        color: getTextColor(activeNode?.color || '#800000', theme.darkMode),
                      };
                      onPalette(buttonCenter);
                    } else if (onOpenInPanel) {
                      onOpenInPanel();
                    }
                  }}
                  title="Palette"
                  onMouseEnter={() => triggerActionHover('control-palette', 'Palette')}
                  onMouseLeave={clearActionHover}
                >
                  <Palette size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onOrbit || onDelete}
                  title="Semantic Orbit"
                  onMouseEnter={() => triggerActionHover('control-orbit', 'Semantic Orbit')}
                  onMouseLeave={clearActionHover}
                >
                  <Orbit size={iconSize} />
                </div>
              </>
            ) : isNodeGroup ? (
              // Node-group mode: Show node-group actions (dive into definition, open in panel, edit, color, ungroup)
              <>
                <div
                  className="piemenu-button"
                  onClick={handleNodeGroupDefinitionClick}
                  title="Open Definition"
                  onMouseEnter={() => triggerActionHover('control-open-definition', 'Open Definition')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowUpFromDot size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onOpenNodePrototypeInPanel}
                  title="Open in Panel"
                  onMouseEnter={() => triggerActionHover('control-open-panel', 'Open in Panel')}
                  onMouseLeave={clearActionHover}
                >
                  <NotebookText size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onCombineNodeGroup}
                  title="Combine Into Thing"
                  onMouseEnter={() => triggerActionHover('control-combine', 'Combine Into Thing')}
                  onMouseLeave={clearActionHover}
                >
                  <Combine size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onUpdateDefinitionFromGroup}
                  title="Update Definition"
                  onMouseEnter={() => triggerActionHover('control-update-definition', 'Update Definition')}
                  onMouseLeave={clearActionHover}
                >
                  <Save size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onRefreshGroupFromDefinition}
                  title="Refresh From Definition"
                  onMouseEnter={() => triggerActionHover('control-refresh-definition', 'Refresh From Definition')}
                  onMouseLeave={clearActionHover}
                >
                  <RefreshCw size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onGroupEdit}
                  title="Edit Name"
                  onMouseEnter={() => triggerActionHover('control-edit-name', 'Edit Name')}
                  onMouseLeave={clearActionHover}
                >
                  <Edit3 size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onGroupColor}
                  title="Change Color"
                  onMouseEnter={() => triggerActionHover('control-change-color', 'Change Color')}
                  onMouseLeave={clearActionHover}
                >
                  <Palette size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onUngroup}
                  title="Ungroup"
                  onMouseEnter={() => triggerActionHover('control-ungroup', 'Ungroup')}
                  onMouseLeave={clearActionHover}
                >
                  <Ungroup size={iconSize} />
                </div>
              </>
            ) : isGroup ? (
              // Group mode: Show group actions (ungroup, edit, color, convert to node-group)
              <>
                <div
                  className="piemenu-button"
                  onClick={onUngroup}
                  title="Ungroup"
                  onMouseEnter={() => triggerActionHover('control-ungroup', 'Ungroup')}
                  onMouseLeave={clearActionHover}
                >
                  <Ungroup size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onGroupEdit}
                  title="Edit Name"
                  onMouseEnter={() => triggerActionHover('control-edit-name', 'Edit Name')}
                  onMouseLeave={clearActionHover}
                >
                  <Edit3 size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onGroupColor}
                  title="Change Color"
                  onMouseEnter={() => triggerActionHover('control-change-color', 'Change Color')}
                  onMouseLeave={clearActionHover}
                >
                  <Palette size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onConvertToNodeGroup}
                  title="Convert to Thing-Group"
                  onMouseEnter={() => triggerActionHover('control-convert-nodegroup', 'Convert to Thing-Group')}
                  onMouseLeave={clearActionHover}
                >
                  <SquarePlus size={iconSize} />
                </div>
              </>
            ) : isAbstraction ? (
              // Abstraction mode: Show abstraction actions (add, up with dot, right, edit)
              <>
                <div
                  className="piemenu-button"
                  onClick={onAdd}
                  title="Add Dimension"
                  onMouseEnter={() => triggerActionHover('control-add-dimension', 'Add Dimension')}
                  onMouseLeave={clearActionHover}
                >
                  <Plus size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onUp}
                  title="Expand Dimension"
                  onMouseEnter={() => triggerActionHover('control-expand-dimension', 'Expand Dimension')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowUpFromDot size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onOpenInPanel}
                  title="Open in Panel"
                  onMouseEnter={() => triggerActionHover('control-open-panel', 'Open in Panel')}
                  onMouseLeave={clearActionHover}
                >
                  <NotebookText size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onEdit}
                  title="Edit Name"
                  onMouseEnter={() => triggerActionHover('control-edit-name', 'Edit Name')}
                  onMouseLeave={clearActionHover}
                >
                  <Edit3 size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onDelete}
                  title="Delete Dimension"
                  onMouseEnter={() => triggerActionHover('control-delete-dimension', 'Delete Dimension')}
                  onMouseLeave={clearActionHover}
                >
                  <Trash2 size={iconSize} />
                </div>
              </>
            ) : useConnectionPieMenuButtons ? (
              // Single connection: render the canvas connection menu's own
              // buttons. Nothing about which buttons exist is decided here —
              // see the connectionPieMenuButtons prop.
              connectionPieMenuButtons.map((button) => {
                const Icon = button.icon;
                return (
                  <div
                    key={button.id}
                    className="piemenu-button"
                    onClick={(e) => runPieMenuButton(button, e, connectionPieMenuTargetEdgeId)}
                    title={button.label}
                    onMouseEnter={() => triggerActionHover(`control-${button.id}`, button.label)}
                    onMouseLeave={clearActionHover}
                  >
                    {Icon && <Icon size={iconSize} />}
                  </div>
                );
              })
            ) : (
              // Multi-select (and the panel's exit animation, where the target
              // edge id is already gone): the connection menu has no form for
              // this, so these stay hand-written and keep their selection-wide
              // handlers.
              <>
                <div
                  className="piemenu-button"
                  onClick={onDelete}
                  title="Delete"
                  onMouseEnter={() => triggerActionHover('control-delete', 'Delete')}
                  onMouseLeave={clearActionHover}
                >
                  <Trash2 size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onAdd}
                  title="Define"
                  onMouseEnter={() => triggerActionHover('control-add', 'Define')}
                  onMouseLeave={clearActionHover}
                >
                  <Edit3 size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onUp}
                  title="Open Definition"
                  onMouseEnter={() => triggerActionHover('control-open-definition', 'Open Definition')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowUpFromDot size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onOpenInPanel}
                  title="Open in Panel"
                  onMouseEnter={() => triggerActionHover('control-open-panel', 'Open in Panel')}
                  onMouseLeave={clearActionHover}
                >
                  <NotebookText size={iconSize} />
                </div>
                {wizardEnabled && onAskWizard && (
                  <div
                    className="piemenu-button"
                    onClick={onAskWizard}
                    title="Ask The Wizard"
                    onMouseEnter={() => triggerActionHover('control-ask-wizard', 'Ask The Wizard')}
                    onMouseLeave={clearActionHover}
                  >
                    <Sparkles size={iconSize} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnifiedBottomControlPanel;
