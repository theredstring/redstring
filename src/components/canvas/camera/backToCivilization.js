/**
 * "Back to civilization": frame the nearest cluster when the view has wandered
 * off (moved verbatim from NodeCanvas's handleBackToCivilizationClick).
 * NodeCanvas passes the render values it used as `ctx`.
 */
import { MAX_ZOOM } from '../../../constants';
import { getNodeDimensions } from '../../../utils.js';

export function backToCivilization(ctx) {
  const {
    baseDimsById, canvasSize, clusterAnalysis, containerRef, draggingNodeInfoRef, enableClustering,
    isAnimatingZoomRef, nodes, transform, viewportSize,
  } = ctx;
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

  const view = civilizationView({ nodes: nodesToNavigateTo, baseDimsById, viewportSize, canvasSize });

  console.log('[BackToCivilization] Applying navigation:', {
    targetZoom: Math.round(view.zoom * 1000) / 1000,
    finalPan: { x: Math.round(view.pan.x), y: Math.round(view.pan.y) }
  });

  // Apply the new view state
  transform.jumpTo(view.pan, view.zoom);
}

// Two clusters count as separate when the empty space between them is at least
// this many times the web's usual spacing (median gap from a node to its nearest
// neighbour), and never less than MIN_CLUSTER_GAP canvas units.
const CLUSTER_GAP_FACTOR = 5;
const MIN_CLUSTER_GAP = 1000;

const boxGap = (a, b) => Math.hypot(
  Math.max(0, a.minX - b.maxX, b.minX - a.maxX),
  Math.max(0, a.minY - b.maxY, b.minY - a.maxY),
);

/**
 * The nodes worth framing: all of them, unless a wide gap splits the web into
 * clusters, in which case the cluster with the most nodes (ties: the larger
 * area). A far-off node or island would otherwise centre the view on the empty
 * space between it and the rest.
 */
export function largestCluster(nodes, dimsFor) {
  if (nodes.length < 2) return nodes;
  const boxes = nodes.map((node, i) => {
    const dims = dimsFor(node);
    return { i, minX: node.x, minY: node.y, maxX: node.x + dims.currentWidth, maxY: node.y + dims.currentHeight };
  }).sort((a, b) => a.minX - b.minX);

  // Each node's nearest-neighbour gap, by a sweep along x (a pair can't be
  // nearer than its x distance, so each scan stops once that passes the best).
  const nearest = new Array(boxes.length).fill(Infinity);
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length && boxes[b].minX - boxes[a].maxX <= nearest[a]; b++) {
      const gap = boxGap(boxes[a], boxes[b]);
      if (gap < nearest[a]) nearest[a] = gap;
      if (gap < nearest[b]) nearest[b] = gap;
    }
  }
  const sorted = nearest.filter(Number.isFinite).sort((x, y) => x - y);
  const threshold = Math.max(MIN_CLUSTER_GAP, CLUSTER_GAP_FACTOR * (sorted[Math.floor(sorted.length / 2)] || 0));

  // Join every pair closer than the threshold (union-find).
  const parent = boxes.map((_, k) => k);
  const find = (k) => { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length && boxes[b].minX - boxes[a].maxX <= threshold; b++) {
      if (boxGap(boxes[a], boxes[b]) <= threshold) parent[find(b)] = find(a);
    }
  }

  const clusters = new Map();
  boxes.forEach((box, k) => {
    const root = find(k);
    const c = clusters.get(root) || { members: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    c.members.push(box.i);
    c.minX = Math.min(c.minX, box.minX); c.minY = Math.min(c.minY, box.minY);
    c.maxX = Math.max(c.maxX, box.maxX); c.maxY = Math.max(c.maxY, box.maxY);
    clusters.set(root, c);
  });
  if (clusters.size === 1) return nodes;
  const area = (c) => (c.maxX - c.minX) * (c.maxY - c.minY);
  let best = null;
  for (const c of clusters.values()) {
    if (!best || c.members.length > best.members.length
      || (c.members.length === best.members.length && area(c) > area(best))) best = c;
  }
  return best.members.sort((x, y) => x - y).map(i => nodes[i]);
}

/** The pan and zoom that frame `nodes` in the viewport (the view Back to Civilization lands on).
 * Frames the web's largest cluster when a wide gap separates it from the rest. */
export function civilizationView({ nodes, baseDimsById, viewportSize, canvasSize, maxZoom = MAX_ZOOM }) {
  const dimsFor = (node) => baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
  // Calculate bounding box of relevant nodes
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  largestCluster(nodes, dimsFor).forEach(node => {
    const dims = dimsFor(node);
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

  // Calculate appropriate zoom level with padding
  const padding = 150;
  const targetZoomX = viewportSize.width / (nodesWidth + padding * 2);
  const targetZoomY = viewportSize.height / (nodesHeight + padding * 2);
  let targetZoom = Math.min(targetZoomX, targetZoomY);

  // Clamp zoom to reasonable bounds
  targetZoom = Math.max(Math.min(targetZoom, maxZoom), 0.2);

  // Calculate pan to center the target area (accounting for canvas offset)
  const targetPanX = (viewportSize.width / 2) - (nodesCenterX - canvasSize.offsetX) * targetZoom;
  const targetPanY = (viewportSize.height / 2) - (nodesCenterY - canvasSize.offsetY) * targetZoom;

  // Apply bounds constraints
  const maxPanX = 0;
  const minPanX = viewportSize.width - canvasSize.width * targetZoom;
  const maxPanY = 0;
  const minPanY = viewportSize.height - canvasSize.height * targetZoom;

  return {
    pan: {
      x: Math.min(Math.max(targetPanX, minPanX), maxPanX),
      y: Math.min(Math.max(targetPanY, minPanY), maxPanY),
    },
    zoom: targetZoom,
  };
}
