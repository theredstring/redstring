/**
 * The node layer (P3.08b): every visible node, from the node section of
 * NodeCanvas's JSX, moved verbatim. It renders in two places in the z-order, as
 * two instances of this component:
 *   - part="rest": ordinary nodes, then node-group members above them;
 *   - part="top": the active node (pie target, preview, or sole selection; with
 *     the orbit overlay while orbiting) and, last, the dragged node.
 * NodeCanvas draws node-group titles, delete ghosts and the pie menus between
 * the two.
 *
 * It reads selection, preview, pie target, carousel, rename and definition
 * indices from canvasUIStore itself and is memoized, so a NodeCanvas render that
 * changes none of its props doesn't reach it.
 */
import { memo } from 'react';
import { createPortal } from 'react-dom';
import Node from '../../../Node.jsx';
import { getNodeDimensions } from '../../../utils.js';
import { showContextMenu } from '../../GlobalContextMenu';
import useCanvasUIStore from '../../../store/canvasUIStore.js';

function NodeLayer({
  part, nodes, visibleNodeIds, baseDimsById, thingGroupMemberIds, draggingNodeId, marqueeActive,
  activeGraphId, graphsMap, nodeScope, nodeCallbacks, storeActions, overlayGroupEl, renderOrbitOverlay,
}) {
  const selectedInstanceIds = useCanvasUIStore((s) => s.selectedInstanceIds);
  const previewingNodeId = useCanvasUIStore((s) => s.previewingNodeId);
  const currentPieMenuNodeId = useCanvasUIStore((s) => s.currentPieMenuData?.node?.id ?? null);
  const selectedNodeIdForPieMenu = useCanvasUIStore((s) => s.selectedNodeIdForPieMenu);
  const abstractionCarouselVisible = useCanvasUIStore((s) => s.abstractionCarouselVisible);
  const abstractionCarouselNode = useCanvasUIStore((s) => s.abstractionCarouselNode);
  const editingNodeIdOnCanvas = useCanvasUIStore((s) => s.editingNodeIdOnCanvas);
  const nodeDefinitionIndices = useCanvasUIStore((s) => s.nodeDefinitionIndices);
  const semanticOrbitActive = useCanvasUIStore((s) => s.semanticOrbitActive);

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


  // Determine which node should be treated as "active" for stacking,
  // Priority order: previewing > pie menu > single selection (for orbit overlay)
  let nodeIdToKeepActiveForStacking = previewingNodeId || currentPieMenuNodeId || selectedNodeIdForPieMenu;

  // If no higher-priority node is active, use the selected node for orbit overlay
  if (!nodeIdToKeepActiveForStacking &&
    selectedInstanceIds.size === 1 &&
    !marqueeActive &&
    !abstractionCarouselVisible) {
    nodeIdToKeepActiveForStacking = [...selectedInstanceIds][0];
  }

  if (nodeIdToKeepActiveForStacking === draggingNodeId) {
    nodeIdToKeepActiveForStacking = null; // Dragging node is handled separately
  }

  const allOtherNodes = nodes.filter(node =>
    node.id !== nodeIdToKeepActiveForStacking &&
    node.id !== draggingNodeId &&
    visibleNodeIds.has(node.id) &&
    !node.isGroupAnchor
  );
  // Split into normal nodes and thing-group member nodes for z-ordering
  const otherNodes = allOtherNodes.filter(n => !thingGroupMemberIds.has(n.id));
  const thingGroupMemberNodes = allOtherNodes.filter(n => thingGroupMemberIds.has(n.id));

  const activeNodeToRender = nodeIdToKeepActiveForStacking
    ? nodes.find(n => n.id === nodeIdToKeepActiveForStacking)
    : null;

  const draggingNodeToRender = draggingNodeId
    ? nodes.find(n => n.id === draggingNodeId)
    : null;


  // Helper to render a Node component with all its props (avoids duplication)
  const renderNodeElement = (node, isDragging = false) => {
    const isPreviewing = previewingNodeId === node.id;
    const baseDimensions = baseDimsById.get(node.id);
    const descriptionContent = isPreviewing ? getNodeDescriptionContent(node, true) : null;
    const dimensions = isPreviewing
      ? getNodeDimensions(node, true, descriptionContent)
      : baseDimensions || getNodeDimensions(node, false, null);
    if (abstractionCarouselVisible && abstractionCarouselNode?.id === node.id) return null;
    return (
      <Node
        key={node.id}
        node={node}
        currentWidth={dimensions.currentWidth}
        currentHeight={dimensions.currentHeight}
        textAreaHeight={dimensions.textAreaHeight}
        imageWidth={dimensions.imageWidth}
        imageHeight={dimensions.calculatedImageHeight}
        scaledPadding={dimensions.scaledPadding}
        scaledCornerRadius={dimensions.scaledCornerRadius}
        innerNetworkWidth={dimensions.innerNetworkWidth}
        innerNetworkHeight={dimensions.innerNetworkHeight}
        descriptionAreaHeight={dimensions.descriptionAreaHeight}
        isSelected={selectedInstanceIds.has(node.id)}
        isDragging={isDragging}
        onMouseDown={(e) => nodeScope.current.handleNodeMouseDown(node, e)}
        onPointerDown={(e) => nodeScope.current.touch.handleNodePointerDown(node, e)}
        onPointerMove={(e) => nodeScope.current.touch.handleNodePointerMove(node, e)}
        onPointerUp={(e) => nodeScope.current.touch.handleNodePointerUp(node, e)}
        onPointerCancel={(e) => nodeScope.current.touch.handleNodePointerCancel(node, e)}
        onTouchStart={(e) => nodeScope.current.touch.handleNodeTouchStart(node, e)}
        onTouchMove={(e) => nodeScope.current.touch.handleNodeTouchMove(node, e)}
        onTouchEnd={(e) => nodeScope.current.touch.handleNodeTouchEnd(node, e)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          showContextMenu(e.clientX, e.clientY, nodeScope.current.getContextMenuOptions(node.id));
        }}
        isPreviewing={isPreviewing}
        isEditingOnCanvas={node.id === editingNodeIdOnCanvas}
        onCommitCanvasEdit={(instanceId, newName, isRealTime = false, isAbort = false) =>
          nodeScope.current.handleCommitCanvasEdit(node.prototypeId, newName, isRealTime, isAbort)}
        {...nodeCallbacks}
        storeActions={storeActions}
        currentDefinitionIndex={nodeDefinitionIndices.get(`${node.prototypeId}-${activeGraphId}`) || 0}
      />
    );
  };

  if (part === 'rest') {
    return (
      <>
        {/* Normal nodes (not thing-group members) */}
        {otherNodes.map((n) => renderNodeElement(n))}

        {/* Thing-group member nodes (above normal nodes) */}
        {thingGroupMemberNodes.map((n) => renderNodeElement(n))}
      </>
    );
  }

  return (
    <>
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

          // While orbiting, the focus node and its overlay render
          // into the orbit layer instead — above the scrim, so the
          // graph dims behind them without a translucent element
          // inside the canvas raster. Portalled rather than moved
          // so this stays one block of JSX with one set of
          // handlers; React events still bubble through the React
          // tree, so nothing about interaction changes.
          const portalTarget = semanticOrbitActive ? overlayGroupEl : null;
          const content = (
            <>
              {/* Only mount while orbit mode is on. The overlay owns an
                  animation loop, so mounting it for any plain selection
                  put a permanent per-frame loop in the canvas subtree. */}
              {semanticOrbitActive && renderOrbitOverlay(centerX, centerY, dimensions.currentWidth, dimensions.currentHeight)}
              {renderNodeElement(activeNodeToRender)}
            </>
          );
          return portalTarget ? createPortal(content, portalTarget) : content;
        })()
      )}

      {/* Render the Dragging Node last (on top) */}
      {draggingNodeToRender && visibleNodeIds.has(draggingNodeToRender.id) && renderNodeElement(draggingNodeToRender, true)}
    </>
  );
}

export default memo(NodeLayer);
