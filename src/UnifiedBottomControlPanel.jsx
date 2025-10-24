import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Trash2, Plus, ArrowUpFromDot, ArrowRight, ChevronLeft, ChevronRight, PackageOpen, Layers, Edit3, Bookmark, Palette, MoreHorizontal, Group, Ungroup, SquarePlus, Combine } from 'lucide-react';
import UniversalNodeRenderer from './UniversalNodeRenderer';
import { RENDERER_PRESETS } from './UniversalNodeRenderer.presets';
import useGraphStore from "./store/graphStore.jsx";
import { getNodeDimensions } from './utils.js';
import './UnifiedBottomControlPanel.css';

// Small helper to render a triangle cap (rounded-ish via strokeJoin/lineJoin aesthetics)
const TriangleCap = ({ direction = 'left', color = '#bdb5b5', variant = 'ghost', onClick }) => {
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
  return (
    <div className="predicate-rail" onClick={onClickCenter}>
      <TriangleCap direction="left" color={color} variant={leftActive ? 'solid' : 'ghost'} onClick={(e) => { e.stopPropagation(); onToggleLeft?.(); }} />
      <div className="predicate-rect" style={{ backgroundColor: color }}>
        <span style={{ 
          color: '#bdb5b5', 
          fontWeight: 'bold', 
          fontSize: '14px', 
          fontFamily: "'EmOne', sans-serif",
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {label || 'Connection'}
        </span>
      </div>
      <TriangleCap direction="right" color={color} variant={rightActive ? 'solid' : 'ghost'} onClick={(e) => { e.stopPropagation(); onToggleRight?.(); }} />
    </div>
  );
};

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
  
  // Additional node action handlers
  onDecompose,
  onAbstraction,
  onEdit,
  onSave,
  onPalette,
  onMore,
  onGroup,

  // Optional navigations (shown on node mode)
  onLeftNav,
  onRightNav,
  hasLeftNav = false,
  hasRightNav = false,
}) => {
  // Get savedNodeIds from store to show save state
  const savedNodeIds = useGraphStore((state) => state.savedNodeIds);
  const [animationState, setAnimationState] = useState('entering');
  const [shouldRender, setShouldRender] = useState(true);
  const nodeGroupPreviewRef = useRef(null);

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

  const nodeRendererMetrics = useMemo(() => {
    if (!nodeDimensionEntries.length) {
      return {
        nodesForRenderer: [],
        containerWidth: 360,
        containerHeight: 90,
        padding: 10
      };
    }

    const PADDING = 10;
    const BASE_CONTAINER_WIDTH = 360;
    const MAX_CONTAINER_WIDTH = 520;
    const BASE_CONTAINER_HEIGHT = 104;
    const ROW_HEIGHT_INCREMENT = 64;
    const MAX_CONTAINER_HEIGHT = 240;
    const COLUMN_SPACING = 16;
    const ROW_SPACING = 14;
    const MAX_ITEMS_PER_ROW = 4;
    const MIN_SCALE = 0.45;

    const count = nodeDimensionEntries.length;
    const rowCount = Math.max(1, Math.ceil(count / MAX_ITEMS_PER_ROW));

    const desiredScale = (() => {
      if (count === 1) return 1;
      if (count === 2) return 0.88;
      if (count === 3) return 0.78;
      if (count === 4) return 0.7;
      if (count <= 6) return 0.62;
      if (count <= 8) return 0.54;
      if (count <= 12) return 0.5;
      return MIN_SCALE;
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
  }, [nodeDimensionEntries]);

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
    if (!nodeGroupRendererNode) {
      return {
        containerWidth: 340,
        containerHeight: 120,
        padding: 16
      };
    }

    return {
      containerWidth: Math.max(340, nodeGroupRendererNode.width + 80),
      containerHeight: Math.max(120, nodeGroupRendererNode.height + 40),
      padding: 16
    };
  }, [nodeGroupRendererNode]);

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
      color: selectedGroup.color || '#8B0000'
    };

    const dimensions = getNodeDimensions(baseNode, false, null);

    return {
      ...baseNode,
      x: 0,
      y: 0,
      width: Math.max(dimensions.currentWidth + 36, 240),
      height: Math.max(dimensions.currentHeight + 28, 104),
      isGroup: true
    };
  }, [isGroup, selectedGroup]);

  const groupRendererMetrics = useMemo(() => {
    if (!groupRendererNode) {
      return {
        containerWidth: 320,
        containerHeight: 110,
        padding: 16
      };
    }

    return {
      containerWidth: Math.max(320, groupRendererNode.width + 72),
      containerHeight: Math.max(110, groupRendererNode.height + 34),
      padding: 16
    };
  }, [groupRendererNode]);

  if (!shouldRender) return null;

  const multipleSelected = isNodes && Array.isArray(selectedNodes) && selectedNodes.length > 1;

  return (
    <div
      className={`unified-bottom-panel ${typeListOpen ? 'with-typelist' : ''} ${animationState} ${className}`}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="unified-bottom-content">
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
                <ChevronLeft size={18} />
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
                  return {
                    id: t.id,
                    sourceId: t.subject?.id,
                    destinationId: t.object?.id,
                    connectionName: t.predicate?.name || 'Connection',
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
                
                // Calculate appropriate spacing based on connection names and node count
                const maxConnectionNameLength = connections.reduce((max, conn) => {
                  return Math.max(max, (conn.connectionName || 'Connection').length);
                }, 0);
                
                // Proportional spacing calculation that accounts for text and gives more breathing room
                // Base spacing: 12-15 pixels per character, with larger minimum for better proportions
                const textSpacing = Math.max(200, maxConnectionNameLength * 12);
                
                // Additional spacing based on node count to prevent overcrowding
                const nodeCountMultiplier = Math.max(1, nodes.length * 0.8);
                const proportionalSpacing = textSpacing * nodeCountMultiplier;
                
                // Calculate container width with better proportions - more generous for readability
                const dynamicWidth = Math.max(600, nodes.length * (150 + proportionalSpacing));
                
                return (
                <UniversalNodeRenderer
                  {...RENDERER_PRESETS.CONNECTION_PANEL}
                  nodes={nodes}
                  connections={connections}
                  containerWidth={dynamicWidth}
                  containerHeight={160}
                  minHorizontalSpacing={proportionalSpacing}
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
                <ChevronRight size={18} />
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
                  <ArrowUpFromDot size={18} />
                </div>
                {multipleSelected && (
                  <div
                    className="piemenu-button"
                    onClick={onGroup}
                    title="Group Selection"
                    onMouseEnter={() => triggerActionHover('control-group-selection', 'Group Selection')}
                    onMouseLeave={clearActionHover}
                  >
                    <Group size={18} />
                  </div>
                )}
                <div
                  className="piemenu-button"
                  onClick={onDecompose || onAdd}
                  title="Decompose"
                  onMouseEnter={() => triggerActionHover('control-decompose', 'Decompose')}
                  onMouseLeave={clearActionHover}
                >
                  <PackageOpen size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onAbstraction || onOpenInPanel}
                  title="Abstraction"
                  onMouseEnter={() => triggerActionHover('control-abstraction', 'Abstraction')}
                  onMouseLeave={clearActionHover}
                >
                  <Layers size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onDelete}
                  title="Delete"
                  onMouseEnter={() => triggerActionHover('control-delete', 'Delete')}
                  onMouseLeave={clearActionHover}
                >
                  <Trash2 size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onEdit || onUp}
                  title="Edit"
                  onMouseEnter={() => triggerActionHover('control-edit', 'Edit')}
                  onMouseLeave={clearActionHover}
                >
                  <Edit3 size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onSave || onAdd}
                  title={(() => {
                    // Check if the first selected node is saved
                    if (selectedNodes && selectedNodes.length > 0 && savedNodeIds) {
                      const firstNode = selectedNodes[0];
                      return savedNodeIds.has(firstNode.id) ? 'Unsave' : 'Save';
                    }
                    return 'Save';
                  })()}
                  onMouseEnter={() => {
                    const label = (() => {
                      if (selectedNodes && selectedNodes.length > 0 && savedNodeIds) {
                        const firstNode = selectedNodes[0];
                        return savedNodeIds.has(firstNode.id) ? 'Unsave' : 'Save';
                      }
                      return 'Save';
                    })();
                    triggerActionHover('control-save', label);
                  }}
                  onMouseLeave={clearActionHover}
                >
                  <Bookmark 
                    size={18} 
                    fill={(() => {
                      // Show filled icon if the first selected node is saved
                      if (selectedNodes && selectedNodes.length > 0 && savedNodeIds) {
                        const firstNode = selectedNodes[0];
                        return savedNodeIds.has(firstNode.id) ? 'maroon' : 'none';
                      }
                      return 'none';
                    })()} 
                  />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onPalette || onOpenInPanel}
                  title="Palette"
                  onMouseEnter={() => triggerActionHover('control-palette', 'Palette')}
                  onMouseLeave={clearActionHover}
                >
                  <Palette size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onMore || onDelete}
                  title="More"
                  onMouseEnter={() => triggerActionHover('control-more', 'More')}
                  onMouseLeave={clearActionHover}
                >
                  <MoreHorizontal size={18} />
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
                  <ArrowUpFromDot size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onOpenNodePrototypeInPanel}
                  title="Open in Panel"
                  onMouseEnter={() => triggerActionHover('control-open-panel', 'Open in Panel')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowRight size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onCombineNodeGroup}
                  title="Combine Into Thing"
                  onMouseEnter={() => triggerActionHover('control-combine', 'Combine Into Thing')}
                  onMouseLeave={clearActionHover}
                >
                  <Combine size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onGroupEdit}
                  title="Edit Name"
                  onMouseEnter={() => triggerActionHover('control-edit-name', 'Edit Name')}
                  onMouseLeave={clearActionHover}
                >
                  <Edit3 size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onGroupColor}
                  title="Change Color"
                  onMouseEnter={() => triggerActionHover('control-change-color', 'Change Color')}
                  onMouseLeave={clearActionHover}
                >
                  <Palette size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onUngroup}
                  title="Ungroup"
                  onMouseEnter={() => triggerActionHover('control-ungroup', 'Ungroup')}
                  onMouseLeave={clearActionHover}
                >
                  <Ungroup size={18} />
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
                  <Ungroup size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onGroupEdit}
                  title="Edit Name"
                  onMouseEnter={() => triggerActionHover('control-edit-name', 'Edit Name')}
                  onMouseLeave={clearActionHover}
                >
                  <Edit3 size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onGroupColor}
                  title="Change Color"
                  onMouseEnter={() => triggerActionHover('control-change-color', 'Change Color')}
                  onMouseLeave={clearActionHover}
                >
                  <Palette size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onConvertToNodeGroup}
                  title="Convert to Thing-Group"
                  onMouseEnter={() => triggerActionHover('control-convert-nodegroup', 'Convert to Thing-Group')}
                  onMouseLeave={clearActionHover}
                >
                  <SquarePlus size={18} />
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
                  <Plus size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onUp}
                  title="Expand Dimension"
                  onMouseEnter={() => triggerActionHover('control-expand-dimension', 'Expand Dimension')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowUpFromDot size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onOpenInPanel}
                  title="Open in Panel"
                  onMouseEnter={() => triggerActionHover('control-open-panel', 'Open in Panel')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowRight size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onEdit}
                  title="Edit Name"
                  onMouseEnter={() => triggerActionHover('control-edit-name', 'Edit Name')}
                  onMouseLeave={clearActionHover}
                >
                  <Edit3 size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onDelete}
                  title="Delete Dimension"
                  onMouseEnter={() => triggerActionHover('control-delete-dimension', 'Delete Dimension')}
                  onMouseLeave={clearActionHover}
                >
                  <Trash2 size={18} />
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
                  <Trash2 size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onAdd}
                  title="Add"
                  onMouseEnter={() => triggerActionHover('control-add', 'Add')}
                  onMouseLeave={clearActionHover}
                >
                  <Plus size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onUp}
                  title="Open definition"
                  onMouseEnter={() => triggerActionHover('control-open-definition', 'Open definition')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowUpFromDot size={18} />
                </div>
                <div
                  className="piemenu-button"
                  onClick={onOpenInPanel}
                  title="Open in panel"
                  onMouseEnter={() => triggerActionHover('control-open-panel', 'Open in panel')}
                  onMouseLeave={clearActionHover}
                >
                  <ArrowRight size={18} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnifiedBottomControlPanel;
