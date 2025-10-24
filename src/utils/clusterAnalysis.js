/**
 * Cluster Analysis Utilities for Node Spatial Grouping
 * 
 * Provides clustering algorithms to identify groups of spatially related nodes
 * and distinguish main clusters from outliers.
 */

/**
 * Calculate Euclidean distance between two points
 */
export const calculateDistance = (point1, point2) => {
  const dx = point1.x - point2.x;
  const dy = point1.y - point2.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Calculate the center point of a node including its dimensions
 */
export const getNodeCenter = (node, nodeDimensions) => {
  return {
    x: node.x + nodeDimensions.currentWidth / 2,
    y: node.y + nodeDimensions.currentHeight / 2
  };
};

/**
 * DBSCAN clustering algorithm adapted for node spatial analysis
 * 
 * @param {Array} nodes - Array of node objects with x, y coordinates
 * @param {Function} getDimensions - Function to get node dimensions
 * @param {Object} options - Clustering parameters
 * @param {number} options.epsilon - Maximum distance for nodes to be in same cluster
 * @param {number} options.minPoints - Minimum points required to form a cluster
 * @param {boolean} options.adaptiveEpsilon - Whether to auto-calculate epsilon based on node density
 * @returns {Object} Clustering result with clusters and outliers
 */
export const clusterNodes = (nodes, getDimensions, options = {}) => {
  const {
    epsilon = null, // Will be auto-calculated if null
    minPoints = 2,
    adaptiveEpsilon = true
  } = options;

  if (!nodes || nodes.length === 0) {
    return { clusters: [], outliers: [], mainCluster: null, statistics: {} };
  }

  // Convert nodes to points with centers
  const points = nodes.map(node => {
    const dims = getDimensions(node);
    const center = getNodeCenter(node, dims);
    return {
      ...center,
      node,
      dimensions: dims,
      clusterId: null,
      visited: false
    };
  });

  // Auto-calculate epsilon if not provided
  let actualEpsilon = epsilon;
  if (adaptiveEpsilon || actualEpsilon === null) {
    actualEpsilon = calculateAdaptiveEpsilon(points);
  }

  console.log('[ClusterAnalysis] Starting DBSCAN with parameters:', {
    nodeCount: points.length,
    epsilon: actualEpsilon,
    minPoints,
    adaptiveEpsilon
  });

  // DBSCAN algorithm
  const clusters = [];
  let clusterId = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.visited) continue;

    point.visited = true;
    const neighbors = getNeighbors(point, points, actualEpsilon);

    if (neighbors.length < minPoints) {
      // Mark as outlier (will be handled later)
      continue;
    }

    // Start a new cluster
    const cluster = [point];
    point.clusterId = clusterId;
    
    // Expand cluster
    const neighborQueue = [...neighbors];
    for (let j = 0; j < neighborQueue.length; j++) {
      const neighbor = neighborQueue[j];
      
      if (!neighbor.visited) {
        neighbor.visited = true;
        const neighborNeighbors = getNeighbors(neighbor, points, actualEpsilon);
        
        if (neighborNeighbors.length >= minPoints) {
          neighborQueue.push(...neighborNeighbors.filter(nn => !neighborQueue.includes(nn)));
        }
      }
      
      if (neighbor.clusterId === null) {
        neighbor.clusterId = clusterId;
        cluster.push(neighbor);
      }
    }

    clusters.push(cluster);
    clusterId++;
  }

  // Identify outliers (points not assigned to any cluster)
  const outliers = points.filter(point => point.clusterId === null);

  // Find the main cluster (largest cluster by node count)
  const mainCluster = clusters.length > 0 
    ? clusters.reduce((largest, current) => 
        current.length > largest.length ? current : largest
      )
    : null;

  // Calculate statistics
  const statistics = {
    totalNodes: nodes.length,
    clusterCount: clusters.length,
    outlierCount: outliers.length,
    mainClusterSize: mainCluster ? mainCluster.length : 0,
    mainClusterPercentage: mainCluster ? Math.round((mainCluster.length / nodes.length) * 100) : 0,
    epsilon: actualEpsilon,
    averageClusterSize: clusters.length > 0 
      ? Math.round(clusters.reduce((sum, cluster) => sum + cluster.length, 0) / clusters.length)
      : 0
  };

  console.log('[ClusterAnalysis] Clustering complete:', statistics);

  return {
    clusters: clusters.map(cluster => cluster.map(point => point.node)),
    outliers: outliers.map(point => point.node),
    mainCluster: mainCluster ? mainCluster.map(point => point.node) : null,
    statistics,
    epsilon: actualEpsilon
  };
};

/**
 * Get all neighbors within epsilon distance of a point
 */
const getNeighbors = (point, allPoints, epsilon) => {
  return allPoints.filter(otherPoint => {
    if (point === otherPoint) return false;
    return calculateDistance(point, otherPoint) <= epsilon;
  });
};

/**
 * Calculate adaptive epsilon based on node distribution
 * Uses k-nearest neighbor distance analysis
 */
const calculateAdaptiveEpsilon = (points) => {
  if (points.length < 2) return 200; // Default for single node

  // Calculate distances to k-nearest neighbors for each point
  const k = Math.min(4, points.length - 1); // Use 4-NN or less if fewer nodes
  const kDistances = [];

  points.forEach(point => {
    const distances = points
      .filter(other => other !== point)
      .map(other => calculateDistance(point, other))
      .sort((a, b) => a - b);
    
    // Take the k-th nearest neighbor distance
    const kthDistance = distances[Math.min(k - 1, distances.length - 1)];
    kDistances.push(kthDistance);
  });

  // Use the median k-distance as base epsilon
  kDistances.sort((a, b) => a - b);
  const medianKDistance = kDistances[Math.floor(kDistances.length / 2)];
  
  // Scale epsilon based on density characteristics
  // Use 1.5x median k-distance as a good balance between tight and loose clustering
  const adaptiveEpsilon = medianKDistance * 1.5;

  console.log('[ClusterAnalysis] Adaptive epsilon calculation:', {
    k,
    medianKDistance: Math.round(medianKDistance),
    adaptiveEpsilon: Math.round(adaptiveEpsilon),
    kDistanceRange: {
      min: Math.round(Math.min(...kDistances)),
      max: Math.round(Math.max(...kDistances))
    }
  });

  return adaptiveEpsilon;
};

/**
 * Get bounding box for a cluster of nodes
 */
export const getClusterBoundingBox = (clusterNodes, getDimensions) => {
  if (!clusterNodes || clusterNodes.length === 0) {
    return null;
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  clusterNodes.forEach(node => {
    const dims = getDimensions(node);
    const nodeLeft = node.x;
    const nodeTop = node.y;
    const nodeRight = node.x + dims.currentWidth;
    const nodeBottom = node.y + dims.currentHeight;

    minX = Math.min(minX, nodeLeft);
    minY = Math.min(minY, nodeTop);
    maxX = Math.max(maxX, nodeRight);
    maxY = Math.max(maxY, nodeBottom);
  });

  return {
    minX, minY, maxX, maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
};

/**
 * Analyze node distribution and identify main cluster vs outliers
 * This is the main function to use for "Back to Civilization" functionality
 * 
 * @param {Array} nodes - Array of node objects
 * @param {Function} getDimensions - Function to get node dimensions  
 * @param {Object} options - Analysis options
 * @returns {Object} Analysis result with main cluster and outliers
 */
export const analyzeNodeDistribution = (nodes, getDimensions, options = {}) => {
  const clusterResult = clusterNodes(nodes, getDimensions, options);
  
  if (!clusterResult.mainCluster) {
    return {
      ...clusterResult,
      mainClusterBounds: null,
      shouldIgnoreOutliers: false,
      civilizationCenter: null
    };
  }

  // Get bounding box for main cluster
  const mainClusterBounds = getClusterBoundingBox(clusterResult.mainCluster, getDimensions);
  
  // Determine if we should ignore outliers based on cluster analysis
  const shouldIgnoreOutliers = (
    clusterResult.statistics.outlierCount > 0 && 
    clusterResult.statistics.mainClusterPercentage >= 60 && // Main cluster has at least 60% of nodes
    clusterResult.statistics.mainClusterSize >= 2 // Main cluster has at least 2 nodes
  );

  // Calculate "civilization center" - the center of the main cluster
  const civilizationCenter = mainClusterBounds ? {
    x: mainClusterBounds.centerX,
    y: mainClusterBounds.centerY
  } : null;

  console.log('[ClusterAnalysis] Distribution analysis:', {
    mainClusterSize: clusterResult.statistics.mainClusterSize,
    outlierCount: clusterResult.statistics.outlierCount,
    shouldIgnoreOutliers,
    civilizationCenter
  });

  return {
    ...clusterResult,
    mainClusterBounds,
    shouldIgnoreOutliers,
    civilizationCenter
  };
};








