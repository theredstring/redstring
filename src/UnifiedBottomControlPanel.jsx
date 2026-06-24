import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Trash2, Plus, ArrowUpFromDot, ArrowRight, ChevronLeft, ChevronRight, PackageOpen, Layers, Edit3, Bookmark, Palette, Orbit, Group, Ungroup, SquarePlus, Combine, Maximize2, Minimize2, Sparkles } from 'lucide-react';
import UniversalNodeRenderer from './UniversalNodeRenderer';
import { RENDERER_PRESETS } from './UniversalNodeRenderer.presets';
import { useTheme } from './hooks/useTheme.js';
import useGraphStore from "./store/graphStore.jsx";
import { getNodeDimensions } from './utils.js';
import useMobileDetection from './hooks/useMobileDetection';
import { getTextColor, getLightHueText, getDarkHueText } from './utils/colorUtils.js';
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

const PredicateRail = ({ color = '#4A5568', leftActive, rightActive, onToggleLeft, onToggleRight, onClickCenter, centerWidth = 140, label }) => {
  const theme = useTheme();
  return (
    <div className="predicate-rail" onClick={onClickCenter}>
      <TriangleCap direction="left" color={color} variant={leftActive ? 'solid' : 'ghost'} onClick={(e) => { e.stopPropagation(); onToggleLeft?.(); }} />
      <div className="predicate-rect" style={{
        borderRadius: '8px',
        backgroundColor: theme.canvas.bg,
        border: '1px solid rgba(38, 0, 0, 0.2)',
      }}>
        <span style={{
          color: getLightHueText(color),
          fontWeight: 'bold',
          fontSize: '24px',
          fontFamily: "'EmOne', sans-serif",
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          WebkitTextStroke: `2px ${getDarkHueText(color)}`,
          paintOrder: 'stroke fill',
          textShadow: '0px 2px 3px rgba(0,0,0,0.3)'
        }}>
          {label || 'Connection'}
        </span>
      </div>
      <TriangleCap direction="right" color={color} variant={rightActive ? 'solid' : 'ghost'} onClick={(e) => { e.stopPropagation(); onToggleRight?.(); }} />
    </div>
  );
};

import { measureTextWidth } from './services/textMeasurement.js';

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

  // Pie menu button handlers
  onDelete,
  onAdd,
  onUp,
  onOpenInPanel,

  // Connection-mode wizard handler
  onAskWizard,
  wizardEnabled = false,

  // Node-mode wizard handler (only relevant for nodes mode and when the selected node has no/empty definition)
  onAskWizardDefineNode,
  askWizardDefineNodeEligible = false,

  // Additional node action handlers
  onDecompose,
  onAbstraction,
  onEdit,
  onSave,
  onPalette,
  onOrbit,
  onGroup,

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
  const [animationState, setAnimationState] = useState('entering');
  const [shouldRender, setShouldRender] = useState(true);
  const nodeGroupPreviewRef = useRef(null);
  const mobileState = useMobileDetection();
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef(0);
  const dismissThresholdPx = 70;

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
    setDragOffset(Math.max(0, delta));
  }, [isDragging]);

  const handleDismissPointerUp = useCallback((e) => {
    if (!isDragging) return;
    setIsDragging(false);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
    if (dragOffset > dismissThresholdPx) {
      setDragOffset(320);
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
    const scale = Math.max(0.55, 1 - dragOffset / 500);
    const opacity = Math.max(0, 1 - dragOffset / 260);
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

  const clearActionHover = useCallback(() => {
    onActionHoverChange?.(null);
  }, [onActionHoverChange]);

  const triggerActionHover = useCallback((id, label) => {
    onActionHoverChange?.({ id, label });
  }, [onActionHoverChange]);

  const nodeDimensionEntries = useMemo(() => {
    if (!isNodes || !Array.isArray(selectedNodes)) {
      return [];
    }

    return selectedNodes.map((node) => {
      const dims = getNodeDimensions(node, false, null);
      return {
        node,
        width: dims.currentWidth,
        height: dims.currentHeight
      };
    });
  }, [isNodes, selectedNodes]);

  // Mobile-responsive icon sizing
  const iconSize = mobileState.isMobile ? 14 : 18;

  // Upper bound for any renderer containerWidth — keeps us from asking for more
  // space than the segment actually offers. On mobile the panel reserves 8px
  // viewport margin + 16px inner padding per side (see UnifiedBottomControlPanel.css
  // mode-nodes block); desktop only reserves ~12px per side.
  const viewportLimit = Math.max(260, mobileState.width - (mobileState.isMobile ? 48 : 24));

  const nodeRendererMetrics = useMemo(() => {
    const padding = mobileState.isMobile ? 0 : 8;
    if (!nodeDimensionEntries.length) {
      return {
        nodesForRenderer: [],
        containerWidth: Math.min(360, viewportLimit),
        containerHeight: mobileState.isMobile ? 72 : 84,
        padding
      };
    }

    const PADDING = padding;
    const BASE_CONTAINER_WIDTH = mobileState.isMobile
      ? Math.min(180, viewportLimit)
      : Math.min(360, viewportLimit);
    const MAX_CONTAINER_WIDTH = Math.min(520, viewportLimit);
    const BASE_CONTAINER_HEIGHT = mobileState.isMobile ? 64 : 92;
    const ROW_HEIGHT_INCREMENT = mobileState.isMobile ? 56 : 60;
    const MAX_CONTAINER_HEIGHT = mobileState.isMobile ? 200 : 220;
    const COLUMN_SPACING = mobileState.isMobilePortrait ? 12 : 16;
    const ROW_SPACING = mobileState.isMobilePortrait ? 10 : 14;
    const MAX_ITEMS_PER_ROW = mobileState.isMobilePortrait ? 3 : 4;
    const MIN_SCALE = mobileState.isMobile ? 0.5 : 0.45;

    const count = nodeDimensionEntries.length;
    const rowCount = Math.max(1, Math.ceil(count / MAX_ITEMS_PER_ROW));

    const narrow = mobileState.isMobile;
    const desiredScale = (() => {
      if (count === 1) return narrow ? 0.85 : 0.5;
      if (count === 2) return narrow ? 0.75 : 0.44;
      if (count === 3) return narrow ? 0.65 : 0.39;
      if (count === 4) return narrow ? 0.6 : 0.35;
      if (count <= 6) return narrow ? 0.5 : 0.31;
      if (count <= 8) return narrow ? 0.42 : 0.27;
      if (count <= 12) return narrow ? 0.36 : 0.25;
      return MIN_SCALE * 0.5;
    })();

    const rows = [];
    let cursor = 0;
    let remaining = count;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const remainingRows = rowCount - rowIndex;
      const itemsThisRow = Math.min(
        MAX_ITEMS_PER_ROW,
        Math.ceil(remaining / remainingRows)
      );

      const rowEntries = [];
      let rowWidth = 0;
      let rowHeight = 0;

      for (let i = 0; i < itemsThisRow && cursor < nodeDimensionEntries.length; i += 1) {
        const entry = nodeDimensionEntries[cursor++];
        rowEntries.push(entry);
        rowWidth += entry.width;
        if (i < itemsThisRow - 1) {
          rowWidth += COLUMN_SPACING;
        }
        rowHeight = Math.max(rowHeight, entry.height);
      }

      rows.push({
        entries: rowEntries,
        width: rowWidth,
        height: rowHeight
      });

      remaining -= itemsThisRow;
    }

    const positionedNodes = [];
    let currentY = 0;
    let boundingWidth = 0;

    rows.forEach((row, rowIndex) => {
      let currentX = 0;
      row.entries.forEach(({ node, width, height }, entryIndex) => {
        positionedNodes.push({
          ...node,
          x: currentX,
          y: currentY,
          width,
          height
        });
        currentX += width;
        if (entryIndex < row.entries.length - 1) {
          currentX += COLUMN_SPACING;
        }
      });

      boundingWidth = Math.max(boundingWidth, currentX);
      currentY += row.height;
      if (rowIndex < rows.length - 1) {
        currentY += ROW_SPACING;
      }
    });

    const boundingHeight = currentY;
    const safeBoundingWidth = Math.max(boundingWidth, 1);
    const safeBoundingHeight = Math.max(boundingHeight, 1);

    const containerWidth = Math.min(
      MAX_CONTAINER_WIDTH,
      Math.max(
        BASE_CONTAINER_WIDTH,
        safeBoundingWidth * Math.max(MIN_SCALE, desiredScale) + PADDING * 2
      )
    );

    const baseHeightForRows =
      BASE_CONTAINER_HEIGHT + ROW_HEIGHT_INCREMENT * Math.max(0, rows.length - 1);
    const heightForDesiredScale =
      safeBoundingHeight * Math.max(MIN_SCALE, desiredScale) + PADDING * 2;

    const containerHeight = Math.min(
      MAX_CONTAINER_HEIGHT,
      Math.max(baseHeightForRows, heightForDesiredScale)
    );

    return {
      nodesForRenderer: positionedNodes,
      containerWidth,
      containerHeight,
      padding: PADDING
    };
  }, [nodeDimensionEntries, viewportLimit, mobileState.isMobilePortrait]);

  const nodeGroupPrototype = useMemo(() => {
    if (!isNodeGroup || !selectedGroup?.linkedNodePrototypeId) return null;
    const state = useGraphStore.getState();
    if (!state?.nodePrototypes?.get) return null;
    return state.nodePrototypes.get(selectedGroup.linkedNodePrototypeId) || null;
  }, [isNodeGroup, selectedGroup?.linkedNodePrototypeId]);

  const nodeGroupRendererNode = useMemo(() => {
    if (!isNodeGroup || !selectedGroup) return null;

    const baseNode = {
      id: selectedGroup.linkedNodePrototypeId || selectedGroup.id || 'nodegroup-preview',
      name: nodeGroupPrototype?.name || selectedGroup.name || 'Thing Group',
      color: nodeGroupPrototype?.color || selectedGroup.color || '#800000',
      definitionGraphIds: nodeGroupPrototype?.definitionGraphIds || []
    };

    const dimensions = getNodeDimensions(baseNode, false, null);

    return {
      ...baseNode,
      x: 0,
      y: 0,
      width: Math.max(dimensions.currentWidth, 220),
      height: Math.max(dimensions.currentHeight, 96)
    };
  }, [isNodeGroup, selectedGroup, nodeGroupPrototype]);

  const nodeGroupRendererMetrics = useMemo(() => {
    const minHeight = mobileState.isMobile ? 72 : 120;
    const heightExtra = mobileState.isMobile ? 8 : 40;
    const pad = mobileState.isMobile ? 6 : 16;
    if (!nodeGroupRendererNode) {
      return {
        containerWidth: Math.min(340, viewportLimit),
        containerHeight: minHeight,
        padding: pad
      };
    }

    return {
      containerWidth: Math.min(viewportLimit, Math.max(280, nodeGroupRendererNode.width + 80)),
      containerHeight: Math.max(minHeight, nodeGroupRendererNode.height + heightExtra),
      padding: pad
    };
  }, [nodeGroupRendererNode, viewportLimit, mobileState.isMobile]);

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

    const baseNode = {
      id: selectedGroup.id,
      name: selectedGroup.name || 'Group',
      color: selectedGroup.color || theme.accent.primary
    };

    const dimensions = getNodeDimensions(baseNode, false, null);

    return {
      ...baseNode,
      x: 0,
      y: 0,
      width: Math.max(200, (selectedGroup.name?.length || 5) * 14),
      height: 90,
      isGroup: true
    };
  }, [isGroup, selectedGroup]);

  const groupRendererMetrics = useMemo(() => {
    const minHeight = mobileState.isMobile ? 64 : 110;
    const heightExtra = mobileState.isMobile ? 6 : 20;
    const pad = mobileState.isMobile ? 4 : 8;
    if (!groupRendererNode) {
      return {
        containerWidth: Math.min(320, viewportLimit),
        containerHeight: minHeight,
        padding: pad
      };
    }

    return {
      containerWidth: Math.min(viewportLimit, Math.max(200, groupRendererNode.width + 48)),
      containerHeight: Math.max(minHeight, groupRendererNode.height + heightExtra),
      padding: pad
    };
  }, [groupRendererNode, viewportLimit, mobileState.isMobile]);

  if (!shouldRender) return null;

  const multipleSelected = isNodes && Array.isArray(selectedNodes) && selectedNodes.length > 1;

  return (
    <div
      className={`unified-bottom-panel mode-${mode} ${typeListOpen ? 'with-typelist' : ''} ${animationState} ${className}`}
      onAnimationEnd={handleAnimationEnd}
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
          {isNodes ? (
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

          {isNodes ? (
            selectedNodes && selectedNodes.length > 0 ? (
              <UniversalNodeRenderer
                nodes={nodeRendererMetrics.nodesForRenderer}
                connections={[]}
                containerWidth={nodeRendererMetrics.containerWidth}
                containerHeight={nodeRendererMetrics.containerHeight}
                padding={nodeRendererMetrics.padding}
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
              const nodes = Array.from(nodesMap.values());

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

              // Dynamic sizing based on actual content needs, clamped to viewport.
              // Mobile rebalances the budget so predicate labels stop crowding out the node previews.
              const isMobile = mobileState.isMobile;
              const baseSpacing = isMobile ? 90 : 140;
              // Self-loops render as two side-by-side copies in UniversalNodeRenderer; budget width accordingly.
              const selfLoopCount = connections.reduce(
                (n, c) => n + (c.sourceId && c.destinationId && c.sourceId === c.destinationId ? 1 : 0),
                0
              );
              const layoutNodeCount = nodes.length + selfLoopCount;
              const nodeSpacing = layoutNodeCount * (isMobile ? 90 : 70);

              const connectionLabelFont = isMobile
                ? '22px "EmOne", sans-serif'
                : '28px "EmOne", sans-serif';

              const longestConnectionLabelWidth = connections.reduce((max, conn) => {
                const width = measureTextWidth(conn.connectionName, connectionLabelFont);
                return Math.max(max, width);
              }, 0);

              const connectionLabelSpace = Math.max(
                isMobile ? 120 : 220,
                Math.ceil(longestConnectionLabelWidth + (isMobile ? 70 : 180))
              );

              // Container width — never exceeds available viewport.
              const calculatedWidth = Math.min(
                viewportLimit,
                1600,
                baseSpacing + nodeSpacing + connectionLabelSpace
              );

              const dynamicMinHorizontalSpacing = Math.max(
                isMobile ? 60 : 80,
                Math.min(connectionLabelSpace - 60, 380)
              );

              const calculatedHeight = isMobile
                ? Math.min(118, Math.max(78, calculatedWidth * 0.23))
                : Math.min(138, Math.max(82, calculatedWidth * 0.25));

              return (
                <UniversalNodeRenderer
                  {...RENDERER_PRESETS.CONNECTION_PANEL}
                  nodes={nodes}
                  connections={connections}
                  padding={isMobile ? 6 : 6}
                  containerWidth={calculatedWidth}
                  containerHeight={calculatedHeight}
                  minHorizontalSpacing={dynamicMinHorizontalSpacing}
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

          {isNodes ? (
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
            {isNodes ? (
              // Node mode: Show all available node actions
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
                {multipleSelected && (
                  <div
                    className="piemenu-button"
                    onClick={onGroup}
                    title="Group Selection"
                    onMouseEnter={() => triggerActionHover('control-group-selection', 'Group Selection')}
                    onMouseLeave={clearActionHover}
                  >
                    <Group size={iconSize} />
                  </div>
                )}
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
                  title="Save"
                  onMouseEnter={() => triggerActionHover('control-save', 'Save')}
                  onMouseLeave={clearActionHover}
                >
                  <Bookmark size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={(e) => {
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
                {wizardEnabled && askWizardDefineNodeEligible && onAskWizardDefineNode && (
                  <div
                    className="piemenu-button"
                    onClick={onAskWizardDefineNode}
                    title="Ask The Wizard"
                    onMouseEnter={() => triggerActionHover('control-ask-wizard-define', 'Ask The Wizard')}
                    onMouseLeave={clearActionHover}
                  >
                    <Sparkles size={iconSize} />
                  </div>
                )}
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
                  <ArrowRight size={iconSize} />
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
                  <ArrowRight size={iconSize} />
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
            ) : (
              // Connection mode: Show connection actions
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
                  title="Add"
                  onMouseEnter={() => triggerActionHover('control-add', 'Add')}
                  onMouseLeave={clearActionHover}
                >
                  <Plus size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onUp}
                  title="Open definition"
                  onMouseEnter={() => triggerActionHover('control-open-definition', 'Open definition')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowUpFromDot size={iconSize} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onOpenInPanel}
                  title="Open in panel"
                  onMouseEnter={() => triggerActionHover('control-open-panel', 'Open in panel')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowRight size={iconSize} />
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
