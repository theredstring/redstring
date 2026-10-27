import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, memo } from 'react';
// Import base constants used
import { NODE_WIDTH, NODE_HEIGHT, NODE_CORNER_RADIUS, NODE_PADDING, NODE_DEFAULT_COLOR } from './constants';
import './Node.css';
import UniversalNodeRenderer from './UniversalNodeRenderer.jsx'; // Used for hover preview
import InnerNetwork from './InnerNetwork.jsx'; // Pure SVG — used for the main inner network preview (avoids foreignObject iOS issues)
import { previewGroupsFor } from './components/webPreview/webPreviewLayout.js';
import { getNodeDimensions } from './utils.js'; // Import needed for node dims
import useExpandMorph from './hooks/useExpandMorph.js';
import useCentredResize from './hooks/useCentredResize.js';
import { getTextColor, DEFAULT_LIFTED_THING_SHADOW, LIFTED_THING_SHADOW_FAST_LAYERS } from './utils/colorUtils.js';
import { getNodeLabelStyle } from './utils/nodeLabelStyle.js';
import { isValidColor } from './ai/palettes.js';
import { ChevronLeft, ChevronRight, Trash2, Expand, ArrowUpFromDot, PackageOpen } from 'lucide-react'; // Import navigation icons, trash, expand, and package-open
import useGraphStore, { getHydratedNodesForGraph, getEdgesForGraph } from "./store/graphStore.js"; // Import store selectors

import { useTheme } from './hooks/useTheme.js';
import { safeImageSrc } from './utils/safeUrl.js';
import { projectGraphView, viewEdges } from './core/openDefinitions.js';
import { VectorText } from './components/VectorText.jsx';

const PREVIEW_SCALE_FACTOR = 0.3; // How much to shrink the network layout

// Accept dimensions and other props
// Expect plain node data object
const Node = ({
  node,
  isSelected,
  isDragging,
  onMouseDown,
  onContextMenu,
  currentWidth: restingWidth,
  currentHeight: restingHeight,
  textAreaHeight: restingTextAreaHeight,
  imageWidth,
  imageHeight,
  scaledPadding,
  scaledCornerRadius,
  // --- Add preview-related props ---
  isPreviewing,
  innerNetworkWidth: restingInnerNetworkWidth,
  innerNetworkHeight: restingInnerNetworkHeight,
  idPrefix = '', // Add optional idPrefix prop with default
  // --- Add editing props ---
  isEditingOnCanvas,
  onCommitCanvasEdit,
  onCancelCanvasEdit,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  // --- Add store actions for creating definitions ---
  onCreateDefinition,
  // --- Add store access for fetching definition graph data ---
  storeActions,
  // --- Add callback for adding nodes to definition ---
  onAddNodeToDefinition,
  // --- Add callback for deleting definition graphs ---
  onDeleteDefinition,
  // --- Add callback for expanding definition graphs ---
  onExpandDefinition,
  // --- Add callback for converting to node group ---
  onConvertToNodeGroup,
  // --- Add navigation props for definition control ---
  currentDefinitionIndex = 0,
  onNavigateDefinition,
}) => {
  const theme = useTheme();
  const textSettings = useGraphStore(state => state.textSettings);
  // Only the dragged Thing ever draws a shadow, so every other node reads null
  // here and a change of setting re-renders just the one that is lifted.
  const liftShadow = useGraphStore(state => isDragging ? (state.liftedThingShadow ?? DEFAULT_LIFTED_THING_SHADOW) : null);
  // Effective node scale = global node-size scope × this instance's per-instance size.
  // Both the box geometry and the label font derive from it, so a resized instance grows
  // as a coherent whole (kept in lock-step with getNodeDimensions, which folds in the
  // same instance.sizeMul). Uses sizeMul (persistent, saved size), NOT instance.scale —
  // `scale` is the transient drag-lift transform register and must not affect layout.
  const globalNodeScale = textSettings?.nodeScale ?? 1.0;
  const effNodeScale = globalNodeScale * (node?.sizeMul ?? 1.0);

  // Fallback to unscaled constants if NodeCanvas didn't pass scaled values
  const effPadding = scaledPadding ?? NODE_PADDING * effNodeScale;
  const effCornerRadius = scaledCornerRadius ?? NODE_CORNER_RADIUS * effNodeScale;

  // Selection stroke scales gently with the node's size — only ~40% of the size change
  // is applied, so larger nodes get a modestly heavier outline rather than a big jump.
  // Anchored at 12 for normal size: XS (0.5×) → ~9.6, M (1×) → 12, L (1.5×) → ~14.4,
  // XL (2×) → ~16.8.
  const selectionStrokeWidth = 12 * (0.6 + 0.4 * effNodeScale);

  // Single duration/easing for every size-coupled transition: box width/height,
  // container padding, label font-size/line-height/wrap max-width, and selection
  // stroke. These MUST stay in lock-step — if any one desyncs, the label wraps
  // mid-resize (a small clamp/box against a still-large font, or vice-versa).
  // Tune the resize speed here.
  const SIZE_TRANSITION = '0.16s ease';

  // Resized, it grows around its middle: its corner moves with the box, on the same curve.
  const groupRef = useRef(null);
  useCentredResize(groupRef, node.x ?? 0, node.y ?? 0, node?.sizeMul ?? 1.0, Boolean(isDragging), SIZE_TRANSITION);

  // The preview card opens out of the node and closes back into it. While it is
  // open or closing, `showPreview` keeps its contents drawn; `morphing` is the
  // in-between, when the drawing follows the morph instead of the props.
  const morph = useExpandMorph(Boolean(isPreviewing));
  const showPreview = Boolean(isPreviewing) || morph.progress > 0;
  const morphing = showPreview && morph.progress < 1;

  // Destructure properties from the hydrated node object
  // Instance-specific properties
  const instanceId = node.id;
  const anchorX = node.x ?? 0;
  const anchorY = node.y ?? 0;
  const prototypeId = node.prototypeId;

  // Prototype properties
  const nodeName = node.name ?? 'Untitled';
  // From the file: only a web, blob or raster data URL is drawn (safeImageSrc).
  const nodeThumbnailSrc = safeImageSrc(node.thumbnailSrc);
  const definitionGraphIds = node.definitionGraphIds || [];

  // --- Inline Editing State ---
  const [tempName, setTempName] = useState(nodeName);
  const inputRef = useRef(null);
  // The name as it was when this edit session began. Typing live-commits to the
  // prototype (so the box resizes as you type), which means `nodeName` is no longer
  // a usable "revert to" value — Escape needs this snapshot instead.
  const originalNameRef = useRef(nodeName);

  // Update tempName when node name changes (from panel or other sources)
  useEffect(() => {
    setTempName(nodeName);
  }, [nodeName]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingOnCanvas && inputRef.current) {
      // Snapshot the pre-edit name. Deliberately NOT keyed on nodeName — the live
      // commits below change it mid-session and would clobber the snapshot.
      originalNameRef.current = nodeName;
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingOnCanvas]);

  // Handle editing commit
  const handleCommitEdit = () => {
    const newName = tempName.trim();
    // A blank title would collapse the node to nothing — restore the pre-edit name.
    onCommitCanvasEdit?.(instanceId, newName || originalNameRef.current);
  };

  // Handle editing cancel
  const handleCancelEdit = () => {
    const original = originalNameRef.current;
    setTempName(original);
    // Undo the live-committed keystrokes (real-time so the editor stays open long
    // enough for the store write to land before the field unmounts).
    // Signalled as an abort so history discards the whole coalesced edit rather
    // than recording a round trip that ended where it started. Sent even when the
    // name is unchanged, so an edit typed and manually erased still closes out.
    onCommitCanvasEdit?.(instanceId, original, true, true);
    onCancelCanvasEdit?.();
  };

  // Handle key events for editing
  const handleKeyDown = (e) => {
    e.stopPropagation(); // Prevent canvas keyboard shortcuts
    if (e.key === 'Enter') {
      e.preventDefault(); // It's a <textarea> for wrapping only — Enter commits, never newlines
      handleCommitEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // Handle real-time input changes for dynamic resizing
  const handleInputChange = (e) => {
    const newValue = e.target.value.replace(/[\r\n]+/g, ' ');
    setTempName(newValue);
    // Live-commit so the node's dynamic sizing (getNodeDimensions measures the
    // committed name) grows/shrinks the box while you type, instead of snapping
    // to the new width only on blur.
    if (newValue.trim()) onCommitCanvasEdit?.(instanceId, newValue, true);
  };

  const hasThumbnail = Boolean(nodeThumbnailSrc);

  // Unique ID for the clip path - incorporate prefix and INSTANCE ID
  const clipPathId = `${idPrefix}node-clip-${instanceId}`;
  const innerClipPathId = `${idPrefix}node-inner-clip-${instanceId}`;
  const shimmerGradId = `${idPrefix}node-shimmer-${instanceId}`;

  // A user upload is being read/decoded (e.g. HEIC transcode) but no thumbnail
  // exists yet — reserve the image slot and render a shimmer placeholder.
  const isImageLoading = node.imageLoading === true && !hasThumbnail;

  // The graph says this node has an image and we could not get it: the
  // Wikipedia URL didn't answer, or the content-addressed blob isn't in the
  // repo. The slot stays reserved and says so. Previously this rendered as a
  // plain text node, which is the same thing the canvas draws for a node that
  // never had an image — so a failed fetch was invisible, and the viewer had no
  // way to know anything was supposed to be there.
  const isImageMissing = node.imageMissing === true && !hasThumbnail && !isImageLoading;

  // Define consistent padding for inner canvas from colored border (matches left/right padding of 24px)
  const INNER_CANVAS_PADDING = 24;

  // No longer need text width calculation since arrows are in top-right corner

  // State to control arrow fade-in animation
  const [showArrows, setShowArrows] = useState(false);

  // State for hover preview
  const [hoveredInnerNodeId, setHoveredInnerNodeId] = useState(null);
  const [hoveredInnerNodeData, setHoveredInnerNodeData] = useState(null);

  // Use the currentDefinitionIndex prop passed from NodeCanvas

  // Get the node's definition graph IDs from the prototype
  const hasMultipleDefinitions = definitionGraphIds.length > 1;
  const hasAnyDefinitions = definitionGraphIds.length > 0;
  // Access store state before any memoizations that depend on it
  // PERF: Only subscribe to broad Maps when previewing — these are only needed for the
  // mini-graph preview rendering. Non-previewing nodes return null, avoiding re-renders
  // when the store changes (e.g. during drag position updates).
  const graphsMap = useGraphStore((state) => showPreview ? state.graphs : null);
  const nodePrototypesMap = useGraphStore((state) => showPreview ? state.nodePrototypes : null);
  const showHoverPreview = useGraphStore((state) => state.showHoverPreview ?? true);
  const hoverPreviewSize = useGraphStore((state) => state.hoverPreviewSize ?? 1.0);
  // Slider 1x maps to this actual scale (keep in sync with HoverVisionAid).
  const HOVER_PREVIEW_BASE_SCALE = 0.6;
  const hoverPreviewScale = hoverPreviewSize * HOVER_PREVIEW_BASE_SCALE;

  // Determine display title: prefer current graph title in preview, else node name
  const currentGraphName = useMemo(() => {
    if (!showPreview || !definitionGraphIds.length) return null;
    const gid = definitionGraphIds[currentDefinitionIndex] || definitionGraphIds[0];
    if (!gid) return null;
    const graphData = graphsMap.get(gid);
    const title = graphData?.name;
    return (typeof title === 'string' && title.trim()) ? title.trim() : null;
  }, [showPreview, definitionGraphIds, currentDefinitionIndex, graphsMap]);

  const displayTitle = (showPreview && currentGraphName) ? currentGraphName : nodeName;

  // Calculate dynamic text color based on node background
  const safeColor = useMemo(() => isValidColor(node.color) ? node.color : NODE_DEFAULT_COLOR, [node.color]);
  const nodeTextColor = useMemo(() => getTextColor(safeColor, theme.darkMode), [safeColor, theme.darkMode]);

  // We want the title to wrap exactly as it does when unexpanded — in ALL states,
  // not just while previewing. Pinning the text box width to the unexpanded
  // wrapping width keeps the wrapping identical throughout the expand/contract
  // animation. (If this were only applied while isPreviewing, the instant boolean
  // flip would un-pin maxWidth mid-contraction while the container is still wide,
  // causing the title to reflow during the animation.)
  const unexpandedDims = React.useMemo(() => {
    return getNodeDimensions(node, false, null);
    // Depend on the scale/text settings too: getNodeDimensions folds these in, but
    // the `node` reference doesn't change when a slider moves — so without these deps
    // the memo returns stale wrapping widths until the node is dragged (new ref).
  }, [node, node.sizeMul, textSettings.nodeScale, textSettings.fontSize, textSettings.lineSpacing]);

  // --- The box as drawn ---
  // At rest it is the props. With the preview showing, every frame is the expanded
  // layout at an in-between size: the card interpolated from the resting box to the
  // open card (which getNodeDimensions centres on the resting box), the title band
  // on top, and the well inset by the padding below it, opening from nothing. So the
  // card grows out of the node's middle, and at progress 1 it is exactly the open
  // layout the props describe.
  const openDims = showPreview ? getNodeDimensions(node, true, null) : null;
  let nodeX = anchorX;
  let nodeY = anchorY;
  let currentWidth = restingWidth;
  let currentHeight = restingHeight;
  let textAreaHeight = restingTextAreaHeight;
  let innerNetworkWidth = restingInnerNetworkWidth;
  let innerNetworkHeight = restingInnerNetworkHeight;
  if (openDims) {
    const t = morph.t;
    const lerp = (a, b) => a + (b - a) * t;
    nodeX = anchorX + openDims.previewOffsetX * t;
    nodeY = anchorY + openDims.previewOffsetY * t;
    currentWidth = lerp(unexpandedDims.currentWidth, openDims.currentWidth);
    currentHeight = lerp(unexpandedDims.currentHeight, openDims.currentHeight);
    textAreaHeight = lerp(unexpandedDims.textAreaHeight, openDims.textAreaHeight);
    const wellBottomInset = openDims.currentHeight - openDims.textAreaHeight - openDims.innerNetworkHeight;
    innerNetworkWidth = Math.max(0, currentWidth - 2 * effPadding);
    innerNetworkHeight = Math.max(0, Math.min(
      currentHeight - textAreaHeight - wellBottomInset,
      openDims.innerNetworkHeight * t,
    ));
  }

  // Calculate image position based on dynamic textAreaHeight
  const contentAreaY = nodeY + textAreaHeight;

  // The definition is drawn once, at its open size, and carried by the morph as a
  // whole: scaled to fit the well and centred in it, so it grows out of the middle
  // along with the card. At rest that is the identity and no transform is written.
  const openNetworkWidth = openDims?.innerNetworkWidth ?? 0;
  const openNetworkHeight = openDims?.innerNetworkHeight ?? 0;
  const openWellX = openDims ? anchorX + openDims.previewOffsetX + effPadding : 0;
  const openWellY = openDims ? anchorY + openDims.previewOffsetY + openDims.textAreaHeight : 0;
  let networkMorphTransform;
  if (morphing && openNetworkWidth > 0 && openNetworkHeight > 0) {
    const s = Math.min(innerNetworkWidth / openNetworkWidth, innerNetworkHeight / openNetworkHeight);
    const tx = nodeX + effPadding + (innerNetworkWidth - openNetworkWidth * s) / 2;
    const ty = contentAreaY + (innerNetworkHeight - openNetworkHeight * s) / 2;
    networkMorphTransform = `translate(${tx - openWellX * s}, ${ty - openWellY * s}) scale(${s})`;
  }

  // Font size for the "Define … With a New Web" placeholder shown when a decomposed
  // node has no definition yet. The preview's inner-network area is large, so a fixed
  // size reads as tiny — scale it to the area's width (which already folds in
  // effNodeScale) so it stays proportional to the node. Clamped to a sane range.
  const decompPlaceholderFont = Math.max(16, Math.min(52, openNetworkWidth * 0.05));
  // Label typography + container padding — shared with every other surface that
  // draws a node (see utils/nodeLabelStyle.js). `typography` is the single source of
  // truth for BOTH the static <span> and the inline canvas editor: keeping them on one
  // object is what stops the title from visibly changing size/color/wrapping the moment
  // you enter edit mode; anything hard-coded in Node.css for the editor would silently
  // desync from node sizing.
  const {
    fontSize: labelFontSize,
    lineHeight: labelLineHeight,
    wrapMaxWidth: previewTextMaxWidth,
    containerPadding: labelContainerPadding,
    typography: labelTypography,
  } = getNodeLabelStyle({
    textSettings,
    effNodeScale,
    color: nodeTextColor,
    unexpandedDims,
    scaledPadding: effPadding,
    hasThumbnail: Boolean(nodeThumbnailSrc),
  });

  // Auto-grow the editing field to its wrapped content height. A fixed-height
  // textarea would clip or scroll a two-line title that the static label shows in full.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !isEditingOnCanvas) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [isEditingOnCanvas, tempName, labelFontSize, labelLineHeight, previewTextMaxWidth]);

  // Determine if text will be multiline for conditional padding

  // Get the currently displayed graph ID
  const currentGraphId = definitionGraphIds[currentDefinitionIndex] || definitionGraphIds[0];

  // The definition as viewed, like the canvas: a Thing opened in place inside it
  // shows its own definition's nodes in its box, and a connection into a closed
  // box is drawn to the box.
  const currentViewGraph = useGraphStore((state) => (showPreview && currentGraphId ? projectGraphView(state, currentGraphId) : null));
  const currentViewEdges = useGraphStore((state) => (showPreview && currentGraphId ? viewEdges(state, currentGraphId) : null));

  // Filter nodes and edges for the current graph definition
  const currentGraphNodes = useMemo(() => {
    if (!showPreview || !currentGraphId) return [];

    // Manual hydration to avoid storeState dependency
    const graphData = currentViewGraph;
    if (!graphData || !graphData.instances) return [];

    const nodes = [];
    graphData.instances.forEach((instance, id) => {
      const prototype = nodePrototypesMap.get(instance.prototypeId);
      if (prototype) {
        nodes.push({ ...prototype, ...instance, id });
      } else {
        // This should ideally not happen if data integrity is maintained
      }
    });

    return nodes;
  }, [showPreview, currentGraphId, currentViewGraph, nodePrototypesMap]);

  const currentGraphEdges = useMemo(() => {
    if (!showPreview || !currentGraphId) return [];
    const graphData = currentViewGraph;
    if (!graphData || !graphData.edgeIds || !currentViewEdges) return [];

    // Map edge IDs to the edges as drawn in this view
    return graphData.edgeIds
      .map(edgeId => currentViewEdges.get(edgeId))
      .filter(edge => edge !== undefined);
  }, [showPreview, currentGraphId, currentViewGraph, currentViewEdges]);

  // Built once at the open size, so a morph frame re-renders only the transform
  // around it, never the definition's drawing.
  // A node that opens as its formula shows it here, as opening it would.
  const previewGroups = useMemo(
    () => previewGroupsFor({ id: node.id, format: node.format, formulaSize: node.sizeMul, color: node.color }, currentViewGraph),
    [node.id, node.format, node.sizeMul, node.color, currentViewGraph],
  );
  const innerNetworkElement = useMemo(() => (
    showPreview && openNetworkWidth > 0 && openNetworkHeight > 0 ? (
      <InnerNetwork
        nodes={currentGraphNodes}
        edges={currentGraphEdges}
        groups={previewGroups}
        width={openNetworkWidth}
        height={openNetworkHeight}
        padding={14 * effNodeScale}
      />
    ) : null
  ), [showPreview, currentGraphNodes, currentGraphEdges, previewGroups, openNetworkWidth, openNetworkHeight, effNodeScale]);
  const hasPreviewWell = showPreview && innerNetworkWidth > 0 && innerNetworkHeight > 0;

  // Effect to handle arrow fade-in after expansion
  useEffect(() => {
    if (isPreviewing) {
      // Small delay to let the expansion animation start, then fade in arrows
      const timer = setTimeout(() => {
        setShowArrows(true);
      }, 200); // 200ms delay after expansion starts
      return () => clearTimeout(timer);
    } else {
      // Immediately hide arrows when not previewing
      setShowArrows(false);
    }
  }, [isPreviewing]);

  // (Self-healing removed - issue is not orphan graphs but empty definition graphs)

  // Navigation functions
  const navigateToPreviousDefinition = () => {
    if (!hasMultipleDefinitions || !onNavigateDefinition) return;
    const newIndex = currentDefinitionIndex === 0 ? definitionGraphIds.length - 1 : currentDefinitionIndex - 1;
    onNavigateDefinition(prototypeId, newIndex);
  };

  const navigateToNextDefinition = () => {
    if (!hasMultipleDefinitions || !onNavigateDefinition) return;
    const newIndex = currentDefinitionIndex === definitionGraphIds.length - 1 ? 0 : currentDefinitionIndex + 1;
    onNavigateDefinition(prototypeId, newIndex);
  };

  return (
    <g
      ref={groupRef}
      className={`node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${showPreview ? 'previewing' : ''}`}
      data-instance-id={instanceId}
      data-lift-shadow={liftShadow || undefined}
      data-has-context-menu="true"
      /* Disable default touch gestures on node group */
      style={isDragging ? {
        // During drag the transform (translate delta + lift scale) is written
        // directly to this element by useNodeDrag — the lift-ramp rAF and
        // performDOMDragUpdate. We deliberately DON'T set `transform` from React
        // here: drag-zoom commits setZoomLevel every frame, which would re-render
        // this node and re-assert a static `scale()`, clobbering the JS-driven
        // ramp/translate and forcing an expensive per-commit re-apply. Leaving it
        // to JS keeps a single writer and lets the lift animate smoothly.
        // `willChange` alone still forms the GPU compositing layer (the iOS
        // foreignObject concern is unchanged — a layer forms during drag either
        // way); it's kept out of the not-dragging branch so no layer forms then.
        willChange: 'transform',
        cursor: 'pointer',
        touchAction: 'none'
      } : {
        cursor: 'pointer',
        touchAction: 'none'
      }}
      onMouseDown={(e) => {
        onMouseDown?.(e);
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        onPointerMove?.(e);
      }}
      onPointerUp={(e) => {
        onPointerUp?.(e);
      }}
      onPointerCancel={(e) => {
        onPointerCancel?.(e);
      }}
      onContextMenu={(e) => {
        // On touch or pen devices, prevent long-press context menu; allow desktop right-click
        if (e && e.nativeEvent && ('touches' in e.nativeEvent || 'pointerType' in e.nativeEvent && e.nativeEvent.pointerType !== 'mouse')) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onContextMenu?.(e);
      }}
      onTouchStart={(e) => {
        // Do NOT call e.preventDefault() - React's onTouchStart is passive by default
        // We rely on CSS touch-action: none to prevent scrolling
        onTouchStart?.(e);
      }}
      onTouchMove={(e) => {
        onTouchMove?.(e);
      }}
      onTouchEnd={(e) => {
        onTouchEnd?.(e);
      }}
      role="graphics-symbol"
      aria-label={displayTitle}
    >
      <defs>
        {/* FIX: Revert clipPath definition to use absolute coordinates */}
        <clipPath id={clipPathId}>
          <rect
            x={nodeX + effPadding - 1}
            y={contentAreaY - 1}
            width={imageWidth + 2}
            height={imageHeight + 2}
            rx={effCornerRadius}
            ry={effCornerRadius}
          />
        </clipPath>
        {/* Clip path for the inner network area - Use absolute coords */}
        <clipPath id={innerClipPathId}>
          <rect
            x={nodeX + effPadding}
            y={contentAreaY + 0.01}
            width={innerNetworkWidth}
            height={innerNetworkHeight}
            rx={22 * effNodeScale}
            ry={22 * effNodeScale}
          />
        </clipPath>

        {/* Mask for creating a true transparent cutout in the node background for the preview area */}
        {hasPreviewWell && (
          <mask id={`${idPrefix}node-mask-${instanceId}`}>
            <rect x={nodeX - 200} y={nodeY - 200} width={currentWidth + 400} height={currentHeight + 400} fill="white" />
            <rect
              x={nodeX + effPadding}
              y={contentAreaY + 0.01}
              width={innerNetworkWidth}
              height={innerNetworkHeight}
              rx={22 * effNodeScale}
              ry={22 * effNodeScale}
              fill="black"
            />
          </mask>
        )}
      </defs>

      {/* Lifted shadow, 'fast': stacked rects under the background, offset
          down and grown a little each. Plain fills, no filter, so it paints
          inline rather than through an offscreen surface. 'fancy' is a CSS
          filter on the background instead — see Node.css. */}
      {liftShadow === 'fast' && LIFTED_THING_SHADOW_FAST_LAYERS.map(({ dy, spread, alpha }, i) => (
        <rect
          key={`lift-shadow-${i}`}
          className="node-lift-shadow"
          x={nodeX + 6 - spread}
          y={nodeY + 6 - spread + dy}
          width={currentWidth - 12 + spread * 2}
          height={currentHeight - 12 + spread * 2}
          rx={Math.max(0, effCornerRadius - 6) + spread}
          ry={Math.max(0, effCornerRadius - 6) + spread}
          fill="black"
          fillOpacity={alpha}
          pointerEvents="none"
        />
      ))}

      {/* Background Rect - Use absolute coords */}
      <rect
        className="node-background"
        x={nodeX + 6} // Use absolute nodeX
        y={nodeY + 6} // Use absolute nodeY
        rx={effCornerRadius - 6}
        ry={effCornerRadius - 6}
        width={currentWidth - 12}
        height={currentHeight - 12}
        fill={safeColor}
        stroke={isSelected ? 'black' : 'none'}
        mask={hasPreviewWell ? `url(#${idPrefix}node-mask-${instanceId})` : undefined}
        // strokeWidth MUST be an inline style, not an SVG attribute: the .node.selected
        // CSS rule would otherwise override an attribute. Inline style wins, so the
        // size-scaled width actually takes effect.
        // Mid-morph the frames set the size; a CSS transition would trail behind them.
        style={{ strokeWidth: selectionStrokeWidth, transition: morphing ? 'fill 0.2s ease' : `width ${SIZE_TRANSITION}, height ${SIZE_TRANSITION}, fill 0.2s ease, stroke-width ${SIZE_TRANSITION}` }}
      />

      <foreignObject
        data-node-title
        x={nodeX}
        y={nodeY} // Use absolute nodeY
        width={currentWidth}
        height={textAreaHeight}
        style={{
          transition: morphing ? 'none' : `width ${SIZE_TRANSITION}, height ${SIZE_TRANSITION}`,
          overflow: 'hidden'
        }}
      >
        <div
          className="node-name-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            // In preview, center all text vertically to align with header buttons
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            padding: labelContainerPadding,
            boxSizing: 'border-box',
            pointerEvents: isEditingOnCanvas ? 'auto' : 'none',
            // Nodes suppress selection everywhere (see .node in Node.css) — but the
            // inline editor needs real text selection, so lift it while editing.
            userSelect: isEditingOnCanvas ? 'text' : 'none',
            minWidth: 0,
            transition: `padding ${SIZE_TRANSITION}`,
          }}
        >
          {isEditingOnCanvas ? (
            // <textarea>, not <input>: the static label wraps to multiple lines, so a
            // single-line input would look nothing like what it replaces. Enter is
            // intercepted in handleKeyDown, so it never actually takes a newline.
            <textarea
              ref={inputRef}
              rows={1}
              lang="en"
              className="node-name-input"
              value={tempName}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={handleCommitEdit}
              // Keep caret placement / text selection from being read as a node grab.
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              style={{
                ...labelTypography,
                display: 'block',
                whiteSpace: 'pre-wrap',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                padding: 0,
                margin: 0,
                resize: 'none',
                overflow: 'hidden',
                boxSizing: 'border-box',
                // Caret must track the node's contrast color, not the canvas text
                // color — it's invisible on dark node fills otherwise.
                caretColor: nodeTextColor,
                hyphens: 'auto', // Parity with the static label's wrapping
                // Match the label's size-coupled transitions so entering edit mode
                // mid-resize doesn't desync from the box.
                transition: `color 0.3s ease, font-size ${SIZE_TRANSITION}, line-height ${SIZE_TRANSITION}, max-width ${SIZE_TRANSITION}`,
              }}
            />
          ) : (
            <span
              className="node-name-text"
              style={{
                ...labelTypography,
                whiteSpace: 'normal',
                display: 'inline-block',
                // Grow/shrink the font AND the wrap clamp (max-width) in lock-step with
                // the box (foreignObject width/height + container padding all transition
                // 0.3s ease). Without the font transition, a growing node's text jumps to
                // full size while the box is still growing → wraps for ~0.3s. Without the
                // max-width transition, a shrinking node's clamp snaps to the final small
                // width instantly while the font is still large → also wraps. Everything
                // scales by the same effNodeScale and fits at both endpoints, so syncing
                // all of them keeps the text fitting at every intermediate frame.
                transition: `color 0.3s ease, font-size ${SIZE_TRANSITION}, line-height ${SIZE_TRANSITION}, max-width ${SIZE_TRANSITION}`,
                hyphens: 'auto',
              }}
              lang="en"
            >
              <VectorText text={displayTitle} />
            </span>
          )}
        </div>
      </foreignObject>

      {/* Image Container (renders if thumbnail exists) */}
      {/* FIX: Remove the wrapping group and apply clipPath directly to image */}
      {/* <g 
        transform={`translate(${nodeX + NODE_PADDING -1}, ${contentAreaY - 1})`} 
        clipPath={`url(#${clipPathId})`}
      > */}
      {hasThumbnail && !showPreview && (
        // Native SVG <image> rather than a <foreignObject><img>. A foreignObject spins up a
        // full HTML layout context inside the SVG (heavy, esp. on WebKit); when a node is
        // lifted it remounts into a separate "dragging node" render slot, and re-laying-out
        // that subtree on the same frames starves the PieMenu's CSS shrink — the exit
        // animation visibly stutters for image nodes. A native <image> is a cheap leaf
        // element, so the remount is nearly free. clipPath gives the rounded corners and
        // preserveAspectRatio="xMidYMid slice" reproduces objectFit: cover.
        <image
          x={nodeX + effPadding}
          y={contentAreaY}
          width={imageWidth}
          height={imageHeight}
          href={nodeThumbnailSrc}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipPathId})`}
          style={{ userSelect: 'none', WebkitUserDrag: 'none', pointerEvents: 'none' }}
        />
      )}

      {/* Loading shimmer — fills the reserved image slot while a user upload is
          read/decoded. A neutral base with a translucent highlight band that
          sweeps upward (SMIL <animate>, so it runs even inside the lifted-node
          render slot without React re-renders). */}
      {isImageLoading && !showPreview && imageWidth > 0 && imageHeight > 0 && (
        <g clipPath={`url(#${clipPathId})`} style={{ pointerEvents: 'none' }}>
          <defs>
            <linearGradient id={shimmerGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect
            x={nodeX + effPadding}
            y={contentAreaY}
            width={imageWidth}
            height={imageHeight}
            fill="#cfcfcf"
          />
          <rect
            x={nodeX + effPadding}
            width={imageWidth}
            height={Math.max(20, imageHeight * 0.5)}
            fill={`url(#${shimmerGradId})`}
          >
            <animate
              attributeName="y"
              from={contentAreaY + imageHeight}
              to={contentAreaY - Math.max(20, imageHeight * 0.5)}
              dur="1.2s"
              repeatCount="indefinite"
            />
          </rect>
        </g>
      )}

      {/* Unreachable image — the slot the layout reserved, filled with a quiet
          statement that something is meant to be here. Deliberately the same
          neutral as the loading shimmer and NOT an error color: an image that
          didn't load is a condition, not a fault, and colouring it red would
          both misattribute blame and break the panel's maroon-only palette. */}
      {isImageMissing && !showPreview && imageWidth > 0 && imageHeight > 0 && (() => {
        // Glyph scales with the slot but is clamped so it stays legible on a
        // small node and doesn't dominate a large one.
        const g = Math.max(12, Math.min(44, Math.min(imageWidth, imageHeight) * 0.3));
        const cx = nodeX + effPadding + imageWidth / 2;
        const cy = contentAreaY + imageHeight / 2;
        return (
          <g clipPath={`url(#${clipPathId})`} style={{ pointerEvents: 'none' }}>
            <rect
              x={nodeX + effPadding}
              y={contentAreaY}
              width={imageWidth}
              height={imageHeight}
              fill="#cfcfcf"
            />
            {/* Frame + horizon + sun: the conventional "image" mark, drawn as
                strokes so it reads at any size without a raster asset. */}
            <g
              stroke="#9a9a9a"
              strokeWidth={Math.max(1.25, g * 0.075)}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            >
              <rect
                x={cx - g / 2}
                y={cy - g / 2}
                width={g}
                height={g}
                rx={g * 0.14}
              />
              <path d={`M ${cx - g * 0.36} ${cy + g * 0.22} L ${cx - g * 0.08} ${cy - g * 0.1} L ${cx + g * 0.14} ${cy + g * 0.12} L ${cx + g * 0.26} ${cy + g * 0.02} L ${cx + g * 0.36} ${cy + g * 0.22} Z`} />
              <circle cx={cx + g * 0.16} cy={cy - g * 0.2} r={g * 0.075} />
              {/* Slash: distinguishes "absent" from "still arriving", so this is
                  never mistaken for a slow load. */}
              <path d={`M ${cx - g * 0.56} ${cy + g * 0.56} L ${cx + g * 0.56} ${cy - g * 0.56}`} />
            </g>
          </g>
        );
      })()}
      {/* </g> */}

      {/* --- Network Preview Container --- */}
      {/* NOTE: no opacity/transition on this <g>. Group-opacity forces iOS WebKit to
          composite the group, which mispositions foreignObject children to the SVG
          origin (top-left) — the cause of the blank/misplaced preview on mobile. */}
      {hasPreviewWell && (
        <g>
          {/* NOTE: do NOT wrap these foreignObjects in a <g clipPath> — iOS WebKit
              fails to render foreignObject content under a clipPath ancestor (blank).
              Visual rounding is done via rx/ry on the background rect only. */}
          <g>
            <rect
              data-preview-canvas
              x={nodeX + effPadding}
              y={contentAreaY}
              width={innerNetworkWidth}
              height={innerNetworkHeight}
              rx={22 * effNodeScale}
              ry={22 * effNodeScale}
              fill={theme.surface.bg}
            />

            {hasAnyDefinitions ? (
              // Pure SVG inner network — no foreignObject, no HTML nesting.
              // UniversalNodeRenderer (HTML inside SVG inside SVG) reliably fails on iOS
              // WebKit when the parent SVG canvas has a scale transform. InnerNetwork is
              // a plain <g> that renders directly into the existing SVG coordinate space,
              // so it works on all platforms without any foreignObject workarounds.
              // data-preview-network: the box morph (groups/boxMorph.js) carries this
              // drawing into the thing group when the node opens in place.
              // The outer group carries the morph; data-preview-network keeps the
              // resting pose the box morph reads.
              <g transform={networkMorphTransform}>
                <g data-preview-network transform={`translate(${openWellX}, ${openWellY})`} pointerEvents="none">
                  {innerNetworkElement}
                </g>
              </g>
            ) : (
              // Show "Create Definition" interface when no definitions exist
              <foreignObject
                x={nodeX + effPadding}
                y={contentAreaY}
                width={innerNetworkWidth}
                height={innerNetworkHeight}
                style={{
                  pointerEvents: 'auto',
                  cursor: 'pointer'
                }}
              >
                <div
                  data-decomp-button="true"
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                    color: theme.canvas.textSecondary,
                    fontSize: `${decompPlaceholderFont}px`,
                    fontWeight: 'bold',
                    textAlign: 'center',
                    padding: `${decompPlaceholderFont * 1.25}px`,
                    boxSizing: 'border-box',
                    transition: 'background-color 0.2s ease',
                    // Fades in as the well opens, so the clipped text never shows.
                    opacity: morphing ? morph.t * morph.t : 1,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onCreateDefinition) {
                      onCreateDefinition(prototypeId);
                    }
                    console.log(`Creating new definition for node: ${nodeName}`);
                  }}
                >
                  <div style={{ fontSize: `${decompPlaceholderFont * 3}px`, marginBottom: `${decompPlaceholderFont * 0.6}px`, lineHeight: 1 }}>+</div>
                  <div>Define {nodeName}</div>
                  <div>With a New Web</div>
                </div>
              </foreignObject>
            )}
          </g>
        </g>
      )}

      {/* Hover Preview - Styled like HoverVisionAid for consistency */}
      {isPreviewing && showHoverPreview && hoveredInnerNodeData && (() => {
        // Base dimensions (smaller than before) scaled by the user's hover preview size setting
        const hpWidth = Math.round(194 * hoverPreviewScale);
        const hpHeight = Math.round(70 * hoverPreviewScale);
        return (
        <foreignObject
          x={nodeX + effPadding + (innerNetworkWidth / 2) - (hpWidth / 2)}
          y={nodeY + textAreaHeight + 8}
          width={hpWidth}
          height={hpHeight}
          style={{
            pointerEvents: 'none',
            overflow: 'visible'
          }}
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              justifyContent: 'center'
            }}
          >
            <UniversalNodeRenderer
              nodes={[
                {
                  id: hoveredInnerNodeData.id,
                  name: hoveredInnerNodeData.name,
                  color: hoveredInnerNodeData.color,
                  prototypeId: hoveredInnerNodeData.prototypeId,
                  width: hoveredInnerNodeData.width || 176,
                  imageSrc: hoveredInnerNodeData.imageSrc
                }
              ]}
              connections={[]}
              containerWidth={hpWidth}
              containerHeight={hpHeight}
              padding={8}
              scaleMode="fixed"
              minNodeSize={Math.round(160 * hoverPreviewScale)}
              maxNodeSize={Math.round(240 * hoverPreviewScale)}
              cornerRadiusMultiplier={32}
              nodeFontScale={1.0}
              interactive={false}
              showHoverEffects={false}
              backgroundColor="transparent"
            />
          </div>
        </foreignObject>
        );
      })()}

      {/* --- End Preview --- */}

    </g>
  );
};

// Custom comparator: skip function props (always new refs but functionally identical)
// This prevents re-rendering all nodes when only one node's position changes during drag
export default memo(Node, (prev, next) => {
  return prev.node === next.node &&
    prev.isSelected === next.isSelected &&
    prev.isDragging === next.isDragging &&
    prev.currentWidth === next.currentWidth &&
    prev.currentHeight === next.currentHeight &&
    prev.textAreaHeight === next.textAreaHeight &&
    prev.imageWidth === next.imageWidth &&
    prev.imageHeight === next.imageHeight &&
    prev.isPreviewing === next.isPreviewing &&
    prev.isEditingOnCanvas === next.isEditingOnCanvas &&
    prev.currentDefinitionIndex === next.currentDefinitionIndex &&
    prev.innerNetworkWidth === next.innerNetworkWidth &&
    prev.innerNetworkHeight === next.innerNetworkHeight &&
    prev.idPrefix === next.idPrefix;
});
