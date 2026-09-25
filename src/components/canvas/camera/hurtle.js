/**
 * The hurtle flight into a definition graph (moved verbatim from NodeCanvas's
 * startHurtleAnimation). NodeCanvas passes the render values it used as `ctx`.
 */
import { NODE_DEFAULT_COLOR } from '../../../constants';
import useGraphStore, { getHydratedNodesForGraph } from '../../../store/graphStore.js';
import { getNodeDimensions } from '../../../utils.js';

export function startHurtle(nodeId, targetGraphId, definitionNodeId, sourceGraphId = null, ctx) {
  const {
    canvasSize, containerRef, getHeaderTabTarget, getNodeDescriptionContent, panOffsetRef, previewingNodeId,
    setHurtleFlight, zoomLevelRef,
  } = ctx;
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

  // Current zoom (for orb sizing) from the authoritative ref.
  const currentZoom = zoomLevelRef.current || 1;

  // Get node dimensions — use the EXPANDED size when this node is being previewed, so the
  // hurtle launches from the expanded node's true center. Using the collapsed size here put
  // the origin up-and-to-the-left (the small node's center sits near the expanded top-left).
  const isNodePreviewing = nodeId === previewingNodeId;
  const descriptionContent = isNodePreviewing ? getNodeDescriptionContent(nodeData, true) : null;
  const nodeDimensions = getNodeDimensions(nodeData, isNodePreviewing, descriptionContent);

  // Node center in canvas coordinates
  const nodeCenterCanvasX = nodeData.x + nodeDimensions.currentWidth / 2;
  const nodeCenterCanvasY = nodeData.y + nodeDimensions.currentHeight / 2;

  // Map canvas coords -> client coords: the container's rect plus the live
  // pan/zoom, which is the exact inverse of the client→canvas math every input
  // handler uses, so it accounts for pan, zoom, header, side panels and scroll
  // and matches the position:fixed orb. Stays in pure client space, avoiding
  // getScreenCTM() — that sits ~safe-area-inset-top below client coords under
  // Capacitor (see the note in appViewport.js).
  //
  // Measured off the CONTAINER rather than the <svg> or the content group's
  // CTM: during a zoom gesture the canvas freezes the group's attribute and
  // carries the remainder as a CSS transform on the gesture layer, so both of
  // those disagree with the refs mid-gesture. .canvas-area never transforms.
  const containerRect = containerElement.getBoundingClientRect();
  const panNow = panOffsetRef.current || { x: 0, y: 0 };
  const nodeScreenX = containerRect.left
    + (nodeCenterCanvasX * currentZoom + (panNow.x - canvasSize.offsetX * currentZoom));
  const nodeScreenY = containerRect.top
    + (nodeCenterCanvasY * currentZoom + (panNow.y - canvasSize.offsetY * currentZoom));

  // Calculate orb size proportional to current zoom
  const orbSize = Math.max(12, Math.round(30 * currentZoom));

  const animationData = {
    nodeId,
    targetGraphId,
    definitionNodeId,
    startTime: performance.now(),
    duration: 400, // slower, more satisfying arc
    startPos: { x: nodeScreenX, y: nodeScreenY },
    targetPos: getHeaderTabTarget(),
    nodeColor: nodeData.color || NODE_DEFAULT_COLOR,
    orbSize,
  };

  setHurtleFlight(animationData);
}
