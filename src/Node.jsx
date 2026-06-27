import React, { useMemo, useState, useEffect, useRef, memo } from 'react';
// Import base constants used
import { NODE_WIDTH, NODE_HEIGHT, NODE_CORNER_RADIUS, NODE_PADDING, NODE_DEFAULT_COLOR } from './constants';
import './Node.css';
import UniversalNodeRenderer from './UniversalNodeRenderer.jsx'; // Used for hover preview
import InnerNetwork from './InnerNetwork.jsx'; // Pure SVG — used for the main inner network preview (avoids foreignObject iOS issues)
import { getNodeDimensions } from './utils.js'; // Import needed for node dims
import { getTextColor } from './utils/colorUtils.js';
import { isValidColor } from './ai/palettes.js';
import { ChevronLeft, ChevronRight, Trash2, Expand, ArrowUpFromDot, PackageOpen } from 'lucide-react'; // Import navigation icons, trash, expand, and package-open
import useGraphStore, { getHydratedNodesForGraph, getEdgesForGraph } from "./store/graphStore.jsx"; // Import store selectors

import { useTheme } from './hooks/useTheme.js';

const PREVIEW_SCALE_FACTOR = 0.3; // How much to shrink the network layout

// Accept dimensions and other props
// Expect plain node data object
const Node = ({
  node,
  isSelected,
  isDragging,
  onMouseDown,
  onContextMenu,
  currentWidth,
  currentHeight,
  textAreaHeight,
  imageWidth,
  imageHeight,
  scaledPadding,
  scaledCornerRadius,
  // --- Add preview-related props ---
  isPreviewing,
  innerNetworkWidth,
  innerNetworkHeight,
  descriptionAreaHeight, // Add description area height prop
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
  isDeleting = false,
  onDeleteAnimationEnd,
}) => {
  const theme = useTheme();
  const textSettings = useGraphStore(state => state.textSettings);
  const globalNodeScale = textSettings?.nodeScale ?? 1.0;

  // Fallback to unscaled constants if NodeCanvas didn't pass scaled values
  const effPadding = scaledPadding ?? NODE_PADDING * globalNodeScale;
  const effCornerRadius = scaledCornerRadius ?? NODE_CORNER_RADIUS * globalNodeScale;

  // Destructure properties from the hydrated node object
  // Instance-specific properties
  const instanceId = node.id;
  const nodeX = node.x ?? 0;
  const nodeY = node.y ?? 0;
  const instanceScale = node.scale ?? 1;
  const prototypeId = node.prototypeId;

  // Prototype properties
  const nodeName = node.name ?? 'Untitled';
  const nodeThumbnailSrc = node.thumbnailSrc ?? null;
  const definitionGraphIds = node.definitionGraphIds || [];

  // --- Inline Editing State ---
  const [tempName, setTempName] = useState(nodeName);
  const inputRef = useRef(null);

  // Update tempName when node name changes (from panel or other sources)
  useEffect(() => {
    setTempName(nodeName);
  }, [nodeName]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingOnCanvas && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingOnCanvas]);

  // Handle editing commit
  const handleCommitEdit = () => {
    const newName = tempName.trim();
    if (newName && newName !== nodeName) {
      onCommitCanvasEdit?.(instanceId, newName);
    } else {
      onCancelCanvasEdit?.();
    }
  };

  // Handle editing cancel
  const handleCancelEdit = () => {
    setTempName(nodeName); // Reset to original name
    onCancelCanvasEdit?.();
  };

  // Handle key events for editing
  const handleKeyDown = (e) => {
    e.stopPropagation(); // Prevent canvas keyboard shortcuts
    if (e.key === 'Enter') {
      handleCommitEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // Handle real-time input changes for dynamic resizing
  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setTempName(newValue);
  };

  const hasThumbnail = Boolean(nodeThumbnailSrc);

  // Unique ID for the clip path - incorporate prefix and INSTANCE ID
  const clipPathId = `${idPrefix}node-clip-${instanceId}`;
  const innerClipPathId = `${idPrefix}node-inner-clip-${instanceId}`;

  // Calculate image position based on dynamic textAreaHeight
  const contentAreaY = nodeY + textAreaHeight;

  // Define consistent padding for inner canvas from colored border (matches left/right padding of 24px)
  const INNER_CANVAS_PADDING = 24;

  // Calculate description area position (below InnerNetwork when previewing) with minimal spacing
  const descriptionAreaY = contentAreaY + innerNetworkHeight + (isPreviewing ? 8 : 0);

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
  const graphsMap = useGraphStore((state) => isPreviewing ? state.graphs : null);
  const edgesMap = useGraphStore((state) => isPreviewing ? state.edges : null);
  const nodePrototypesMap = useGraphStore((state) => isPreviewing ? state.nodePrototypes : null);
  const showHoverPreview = useGraphStore((state) => state.showHoverPreview ?? true);
  const hoverPreviewSize = useGraphStore((state) => state.hoverPreviewSize ?? 0.75);

  // Determine display title: prefer current graph title in preview, else node name
  const currentGraphName = useMemo(() => {
    if (!isPreviewing || !definitionGraphIds.length) return null;
    const gid = definitionGraphIds[currentDefinitionIndex] || definitionGraphIds[0];
    if (!gid) return null;
    const graphData = graphsMap.get(gid);
    const title = graphData?.name;
    return (typeof title === 'string' && title.trim()) ? title.trim() : null;
  }, [isPreviewing, definitionGraphIds, currentDefinitionIndex, graphsMap]);

  const displayTitle = (isPreviewing && currentGraphName) ? currentGraphName : nodeName;

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
  }, [node]);
  const previewTextMaxWidth = unexpandedDims ? unexpandedDims.currentWidth - 60 : undefined; // 60px = 2 * 30px (multi-line padding for consistent wrapping)

  // Determine if text will be multiline for conditional padding

  // Get the currently displayed graph ID
  const currentGraphId = definitionGraphIds[currentDefinitionIndex] || definitionGraphIds[0];

  // Filter nodes and edges for the current graph definition
  const currentGraphNodes = useMemo(() => {
    if (!isPreviewing || !currentGraphId) return [];

    // Manual hydration to avoid storeState dependency
    const graphData = graphsMap.get(currentGraphId);
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
  }, [isPreviewing, currentGraphId, graphsMap, nodePrototypesMap]);

  const currentGraphEdges = useMemo(() => {
    if (!isPreviewing || !currentGraphId) return [];
    const graphData = graphsMap.get(currentGraphId);
    if (!graphData || !graphData.edgeIds) return [];

    // Map edge IDs to actual edge data from the global edges map
    return graphData.edgeIds
      .map(edgeId => edgesMap.get(edgeId))
      .filter(edge => edge !== undefined);
  }, [isPreviewing, currentGraphId, graphsMap, edgesMap]);

  // Get the current definition graph's description
  const currentGraphDescription = useMemo(() => {
    if (!isPreviewing || !currentGraphId) return 'No description.';
    const graphData = graphsMap.get(currentGraphId);
    return graphData?.description || 'No description.';
  }, [isPreviewing, currentGraphId, graphsMap]);

  // Use the passed descriptionAreaHeight which is now calculated dynamically in utils.js
  const actualDescriptionHeight = descriptionAreaHeight;

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
      className={`node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isPreviewing ? 'previewing' : ''} ${isDeleting ? 'node-deleting' : ''}`}
      data-instance-id={instanceId}
      data-has-context-menu="true"
      /* Disable default touch gestures on node group */
      style={isDragging ? {
        // CSS transform + will-change only during drag — either property on a parent <g>
        // creates a GPU compositing layer on iOS WebKit, which mispositions foreignObject
        // children to the SVG origin and causes a blank inner preview. Leave both absent
        // when not dragging so no compositing layer is created.
        transform: `scale(${instanceScale})`,
        transformOrigin: `${nodeX + currentWidth / 2}px ${nodeY + currentHeight / 2}px`,
        willChange: 'transform',
        cursor: 'pointer',
        touchAction: 'none'
      } : {
        cursor: 'pointer',
        touchAction: 'none'
      }}
      onAnimationEnd={(e) => {
        if (isDeleting && e.animationName === 'node-delete-out') {
          onDeleteAnimationEnd?.();
        }
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
            rx={22 * globalNodeScale}
            ry={22 * globalNodeScale}
          />
        </clipPath>

        {/* Mask for creating a true transparent cutout in the node background for the preview area */}
        {isPreviewing && innerNetworkWidth > 0 && innerNetworkHeight > 0 && (
          <mask id={`${idPrefix}node-mask-${instanceId}`}>
            <rect x={nodeX - 200} y={nodeY - 200} width={currentWidth + 400} height={currentHeight + 400} fill="white" />
            <rect
              x={nodeX + effPadding}
              y={contentAreaY + 0.01}
              width={innerNetworkWidth}
              height={innerNetworkHeight}
              rx={22 * globalNodeScale}
              ry={22 * globalNodeScale}
              fill="black"
            />
          </mask>
        )}
      </defs>

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
        strokeWidth={12}
        mask={isPreviewing && innerNetworkWidth > 0 && innerNetworkHeight > 0 ? `url(#${idPrefix}node-mask-${instanceId})` : undefined}
        style={{ transition: 'width 0.3s ease, height 0.3s ease, fill 0.2s ease' }}
      />

      <foreignObject
        x={nodeX}
        y={nodeY} // Use absolute nodeY
        width={currentWidth}
        height={textAreaHeight}
        style={{
          transition: 'width 0.3s ease, height 0.3s ease',
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
            padding: (() => {
              if (nodeThumbnailSrc) {
                return `${31 * globalNodeScale}px ${effPadding}px ${25 * globalNodeScale}px`;
              }
              return `${34 * globalNodeScale}px ${effPadding}px`;
            })(),
            boxSizing: 'border-box',
            pointerEvents: isEditingOnCanvas ? 'auto' : 'none',
            userSelect: 'none',
            minWidth: 0,
            transition: 'padding 0.3s ease',
          }}
        >
          {isEditingOnCanvas ? (
            <input
              ref={inputRef}
              type="text"
              className="node-name-input"
              value={tempName}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={handleCommitEdit}
            />
          ) : (
            <span
              className="node-name-text"
              style={{
                fontSize: `${45 * textSettings.fontSize * globalNodeScale}px`,
                fontWeight: 'bold',
                color: nodeTextColor,
                lineHeight: `${39 * textSettings.lineSpacing * globalNodeScale}px`,
                whiteSpace: 'normal',
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
                textAlign: 'center',
                minWidth: 0,
                display: 'inline-block',
                width: '100%',
                maxWidth: previewTextMaxWidth ? `${previewTextMaxWidth}px` : '100%',
                transition: 'color 0.3s ease',
                hyphens: 'auto',
              }}
              lang="en"
            >
              {displayTitle}
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
      {hasThumbnail && (
        <foreignObject
          x={nodeX + effPadding}
          y={contentAreaY}
          width={imageWidth}
          height={imageHeight}
          clipPath={`url(#${clipPathId})`}
          style={{ overflow: 'hidden' }}
        >
          <img
            xmlns="http://www.w3.org/1999/xhtml"
            src={nodeThumbnailSrc}
            alt=""
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              userSelect: 'none',
              WebkitUserDrag: 'none',
            }}
          />
        </foreignObject>
      )}
      {/* </g> */}

      {/* --- Network Preview Container --- */}
      {/* NOTE: no opacity/transition on this <g>. Group-opacity forces iOS WebKit to
          composite the group, which mispositions foreignObject children to the SVG
          origin (top-left) — the cause of the blank/misplaced preview on mobile. */}
      {isPreviewing && innerNetworkWidth > 0 && innerNetworkHeight > 0 && (
        <g>
          {/* NOTE: do NOT wrap these foreignObjects in a <g clipPath> — iOS WebKit
              fails to render foreignObject content under a clipPath ancestor (blank).
              Visual rounding is done via rx/ry on the background rect only. */}
          <g>
            <rect
              x={nodeX + effPadding}
              y={contentAreaY}
              width={innerNetworkWidth}
              height={innerNetworkHeight}
              rx={22 * globalNodeScale}
              ry={22 * globalNodeScale}
              fill={theme.canvas.bg}
            />

            {hasAnyDefinitions ? (
              // Pure SVG inner network — no foreignObject, no HTML nesting.
              // UniversalNodeRenderer (HTML inside SVG inside SVG) reliably fails on iOS
              // WebKit when the parent SVG canvas has a scale transform. InnerNetwork is
              // a plain <g> that renders directly into the existing SVG coordinate space,
              // so it works on all platforms without any foreignObject workarounds.
              <g transform={`translate(${nodeX + effPadding}, ${contentAreaY})`} pointerEvents="none">
                <InnerNetwork
                  nodes={currentGraphNodes}
                  edges={currentGraphEdges}
                  width={innerNetworkWidth}
                  height={innerNetworkHeight}
                  padding={14 * globalNodeScale}
                />
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
                    fontSize: '16px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    padding: '20px',
                    boxSizing: 'border-box',
                    transition: 'all 0.2s ease',
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
                  <div style={{ fontSize: '48px', marginBottom: '10px' }}>+</div>
                  <div>Define {nodeName}</div>
                  <div>With a New Web</div>
                </div>
              </foreignObject>
            )}
          </g>
        </g>
      )}

      {/* Description Area - Below InnerNetwork when previewing */}
      {isPreviewing && actualDescriptionHeight > 0 && currentGraphDescription && currentGraphDescription.trim() && currentGraphDescription !== 'No description.' && (
        <foreignObject
          x={nodeX + effPadding}
          y={descriptionAreaY}
          width={innerNetworkWidth}
          height={actualDescriptionHeight}
          style={{
            pointerEvents: 'none',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              padding: '12px 8px 4px',
              boxSizing: 'border-box',
              fontFamily: "'EmOne', sans-serif",
              fontSize: `${40 * textSettings.fontSize * globalNodeScale}px`,
              color: nodeTextColor,
              fontWeight: 'normal',
              lineHeight: `${33 * textSettings.lineSpacing * globalNodeScale}px`,
              textAlign: 'center',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {currentGraphDescription}
          </div>
        </foreignObject>
      )}

      {/* Hover Preview - Styled like HoverVisionAid for consistency */}
      {isPreviewing && showHoverPreview && hoveredInnerNodeData && (() => {
        // Base dimensions (smaller than before) scaled by the user's hover preview size setting
        const hpWidth = Math.round(194 * hoverPreviewSize);
        const hpHeight = Math.round(70 * hoverPreviewSize);
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
              minNodeSize={Math.round(160 * hoverPreviewSize)}
              maxNodeSize={Math.round(240 * hoverPreviewSize)}
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
    prev.descriptionAreaHeight === next.descriptionAreaHeight &&
    prev.idPrefix === next.idPrefix &&
    prev.isDeleting === next.isDeleting;
});
