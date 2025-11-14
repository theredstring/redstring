/**
 * Graph Layout Service
 * 
 * Provides various layout algorithms for positioning nodes in a graph.
 * Respects Redstring's three-layer architecture (prototypes/instances/graphs).
 */

function getGraphClusters(nodes, adjacency) {
  const visited = new Set();
  const clusters = [];
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  nodes.forEach(node => {
    if (visited.has(node.id)) return;
    const stack = [node.id];
    visited.add(node.id);
    const cluster = [];

    while (stack.length > 0) {
      const currentId = stack.pop();
      cluster.push(nodeById.get(currentId));
      const neighbors = adjacency.get(currentId) || [];
      neighbors.forEach(neighborId => {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          stack.push(neighborId);
        }
      });
    }

    clusters.push(cluster);
  });

  return clusters.sort((a, b) => b.length - a.length);
}

function generateRingPositions(nodesSorted, centerX, centerY, maxRadius) {
  const positions = new Map();
  if (nodesSorted.length === 0) return positions;

  const ringSpacing = Math.max(120, maxRadius / Math.max(3, Math.ceil(Math.sqrt(nodesSorted.length)) + 1));
  let index = 0;
  let ring = 0;

  while (index < nodesSorted.length) {
    if (ring === 0) {
      const node = nodesSorted[index++];
      positions.set(node.id, { x: centerX, y: centerY });
      ring += 1;
      continue;
    }

    const radius = Math.min(maxRadius, ringSpacing * ring);
    const circumference = Math.max(2 * Math.PI * radius, 1);
    const ringCapacity = Math.max(6 * ring, Math.round(circumference / Math.max(ringSpacing * 0.9, 90)));
    const nodesInRing = Math.min(ringCapacity, nodesSorted.length - index);

    for (let j = 0; j < nodesInRing; j++) {
      const node = nodesSorted[index++];
      const angle = (2 * Math.PI * j) / nodesInRing;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      });
    }

    ring += 1;
    if (radius >= maxRadius) break;
  }

  if (index < nodesSorted.length) {
    const remaining = nodesSorted.slice(index);
    const radius = maxRadius;
    const nodesInRing = remaining.length;
    remaining.forEach((node, idx) => {
      const angle = (2 * Math.PI * idx) / nodesInRing;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      });
    });
  }

  return positions;
}

function generateDeterministicPositions(nodes, adjacency, width, height, options = {}) {
  const positions = new Map();
  if (!nodes.length) return positions;

  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = (options.maxRadiusFactor ?? 0.45) * Math.min(width, height);
  const nodeDegrees = new Map();
  nodes.forEach(node => nodeDegrees.set(node.id, (adjacency.get(node.id) || []).length));

  const clusters = getGraphClusters(nodes, adjacency);
  const mainCluster = clusters[0] || [];
  const otherClusters = clusters.slice(1);

  const placeCluster = (clusterNodes, clusterCenterX, clusterCenterY, radius) => {
    const sorted = [...clusterNodes].sort((a, b) => {
      const degDiff = (nodeDegrees.get(b.id) || 0) - (nodeDegrees.get(a.id) || 0);
      if (degDiff !== 0) return degDiff;
      return String(a.id).localeCompare(String(b.id));
    });
    const placements = generateRingPositions(sorted, clusterCenterX, clusterCenterY, radius);
    placements.forEach((pos, id) => positions.set(id, pos));
  };

  const innerRadius = Math.max(180, maxRadius * 0.35);
  placeCluster(mainCluster, centerX, centerY, innerRadius);

  if (otherClusters.length > 0) {
    const outerRadius = Math.min(maxRadius * 0.85, Math.max(innerRadius + 140, maxRadius * 0.6));
    otherClusters.forEach((cluster, idx) => {
      const angle = (2 * Math.PI * idx) / otherClusters.length;
      const clusterCenterX = centerX + Math.cos(angle) * outerRadius;
      const clusterCenterY = centerY + Math.sin(angle) * outerRadius;
      const clusterRadius = Math.max(160, innerRadius * 0.75);
      placeCluster(cluster, clusterCenterX, clusterCenterY, clusterRadius);
    });
  }

  return positions;
}

export const FORCE_LAYOUT_DEFAULTS = {
  width: 2000,
  height: 1500,
  iterations: 220,
  springLength: 720,
  linkDistance: 720,
  springStrength: 0.35,
  attractionStrength: 0.35,
  repulsionStrength: 5200,
  damping: 0.6,
  velocityDecay: 0.58,
  centerStrength: 0.045,
  centeringStrength: 0.045,
  initialTemperature: 100,
  cooldown: 0.978,
  alphaDecay: 0.02,
  alphaMin: 0.005,
  padding: 200,
  minLinkDistance: 60,
  edgeAvoidance: 1.1,
  edgeAvoidanceRadius: 420,
  nodeSpacing: 140,
  labelPadding: 40,
  collisionRadius: 150,
  maxRepulsionDistance: 1400,
  minNodeRadius: 150,
  imageRadiusMultiplier: 0.8,
  nodeSeparationMultiplier: 2.1,
  postCenterRelaxation: 0.12,
  postRadialPasses: 4,
  radialSpreadFactor: 0.35,
  maxRadiusFactor: 0.48,
  layoutScale: 'balanced',
  layoutScaleMultiplier: 1,
  iterationPreset: 'balanced'
};
export const LAYOUT_ITERATION_PRESETS = {
  fast: {
    iterations: 160,
    alphaDecay: 0.03
  },
  balanced: {
    iterations: 260,
    alphaDecay: 0.02
  },
  deep: {
    iterations: 360,
    alphaDecay: 0.015
  }
};
export const LAYOUT_SCALE_PRESETS = {
  compact: {
    label: 'Compact',
    nodeSeparationMultiplier: 1.4,
    springLength: 500,
    linkDistance: 500
  },
  balanced: {
    label: 'Balanced',
    nodeSeparationMultiplier: 1.9,
    springLength: 620,
    linkDistance: 620
  },
  spacious: {
    label: 'Spacious',
    nodeSeparationMultiplier: 2.4,
    springLength: 780,
    linkDistance: 780
  }
};

function resolveCollisions(positions, nodes, getRadius, padding, width, height, passes = 8, separationMultiplier = 1) {
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        const posA = positions.get(nodeA.id);
        const posB = positions.get(nodeB.id);
        if (!posA || !posB) continue;

        let dx = posB.x - posA.x;
        let dy = posB.y - posA.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          dist = Math.sqrt(dx * dx + dy * dy) || 1;
        }

        const radiusA = getRadius(nodeA);
        const radiusB = getRadius(nodeB);
        const minDistance = (radiusA + radiusB) * separationMultiplier;

        if (dist < minDistance) {
          const overlap = (minDistance - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          posA.x -= ux * overlap;
          posA.y -= uy * overlap;
          posB.x += ux * overlap;
          posB.y += uy * overlap;

          posA.x = Math.max(padding, Math.min(width - padding, posA.x));
          posA.y = Math.max(padding, Math.min(height - padding, posA.y));
          posB.x = Math.max(padding, Math.min(width - padding, posB.x));
          posB.y = Math.max(padding, Math.min(height - padding, posB.y));
        }
      }
    }
  }
}

function radialRelaxation(positions, nodes, centerX, centerY, spreadFactor, passes = 2) {
  if (spreadFactor <= 0) return;
  const epsilon = 0.0001;
  for (let pass = 0; pass < passes; pass++) {
    nodes.forEach(node => {
      const pos = positions.get(node.id);
      if (!pos) return;
      let dx = pos.x - centerX;
      let dy = pos.y - centerY;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < epsilon) {
        dx = (Math.random() - 0.5) * 2;
        dy = (Math.random() - 0.5) * 2;
        dist = Math.sqrt(dx * dx + dy * dy) || 1;
      }
      const move = spreadFactor * Math.log1p(dist);
      pos.x += (dx / dist) * move;
      pos.y += (dy / dist) * move;
    });
  }
}

/**
 * Force-directed layout using simple physics simulation
 * Based on Fruchterman-Reingold algorithm
 * 
 * @param {Array} nodes - Array of node objects with {id, prototypeId, x?, y?}
 * @param {Array} edges - Array of edge objects with {sourceId, destinationId}
 * @param {Object} options - Layout configuration
 * @returns {Map} Map of nodeId -> {x, y} positions
 */
export function forceDirectedLayout(nodes, edges, options = {}) {
  const scaleKey = options.layoutScale || FORCE_LAYOUT_DEFAULTS.layoutScale || 'balanced';
  const iterationKey = options.iterationPreset || FORCE_LAYOUT_DEFAULTS.iterationPreset || 'balanced';
  const scalePreset = LAYOUT_SCALE_PRESETS[scaleKey] || LAYOUT_SCALE_PRESETS.balanced;
  const iterationPreset = LAYOUT_ITERATION_PRESETS[iterationKey] || LAYOUT_ITERATION_PRESETS.balanced;

  const mergedOptions = {
    ...FORCE_LAYOUT_DEFAULTS,
    ...scalePreset,
    ...iterationPreset,
    ...options,
    layoutScaleMultiplier: options.layoutScaleMultiplier ?? FORCE_LAYOUT_DEFAULTS.layoutScaleMultiplier ?? 1,
    springLength: options.springLength ?? scalePreset?.springLength ?? FORCE_LAYOUT_DEFAULTS.springLength,
    linkDistance: options.linkDistance ?? scalePreset?.linkDistance ?? FORCE_LAYOUT_DEFAULTS.linkDistance,
    nodeSeparationMultiplier: options.nodeSeparationMultiplier ?? scalePreset?.nodeSeparationMultiplier ?? FORCE_LAYOUT_DEFAULTS.nodeSeparationMultiplier,
    iterations: options.iterations ?? iterationPreset?.iterations ?? FORCE_LAYOUT_DEFAULTS.iterations,
    alphaDecay: options.alphaDecay ?? iterationPreset?.alphaDecay ?? FORCE_LAYOUT_DEFAULTS.alphaDecay
  };
  const scaleMultiplier = mergedOptions.layoutScaleMultiplier ?? 1;
  const scaledOptions = {
    ...mergedOptions,
    springLength: (mergedOptions.springLength ?? FORCE_LAYOUT_DEFAULTS.springLength) * scaleMultiplier,
    linkDistance: (mergedOptions.linkDistance ?? FORCE_LAYOUT_DEFAULTS.linkDistance) * scaleMultiplier,
    nodeSeparationMultiplier: (mergedOptions.nodeSeparationMultiplier ?? FORCE_LAYOUT_DEFAULTS.nodeSeparationMultiplier) * scaleMultiplier,
    maxRepulsionDistance: (mergedOptions.maxRepulsionDistance ?? FORCE_LAYOUT_DEFAULTS.maxRepulsionDistance) * scaleMultiplier,
    minLinkDistance: (mergedOptions.minLinkDistance ?? FORCE_LAYOUT_DEFAULTS.minLinkDistance) * scaleMultiplier
  };

  const {
    width,
    height,
    iterations,
    springLength,
    springStrength,
    attractionStrength,
    repulsionStrength,
    damping,
    centeringStrength,
    centerStrength,
    initialTemperature,
    cooldown,
    padding,
    minLinkDistance,
    edgeAvoidance,
    edgeAvoidanceRadius,
    nodeSpacing,
    labelPadding,
    collisionRadius,
    maxRepulsionDistance,
    minNodeRadius
  } = scaledOptions;
  const useExistingPositions = options.useExistingPositions ?? false;

  const effectiveCentering = (centerStrength ?? centeringStrength) * (mergedOptions.postCenterRelaxation ? 0.8 : 1);
  const effectiveSpringStrength = attractionStrength ?? springStrength;
  const nodeSeparationMultiplier = scaledOptions.nodeSeparationMultiplier ?? FORCE_LAYOUT_DEFAULTS.nodeSeparationMultiplier;

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const adjacency = new Map();
  nodes.forEach(node => adjacency.set(node.id, []));
  edges.forEach(edge => {
    if (adjacency.has(edge.sourceId) && adjacency.has(edge.destinationId)) {
      adjacency.get(edge.sourceId).push(edge.destinationId);
      adjacency.get(edge.destinationId).push(edge.sourceId);
    }
  });

  const deterministicPositions = generateDeterministicPositions(nodes, adjacency, width, height, mergedOptions);

  const positions = new Map();
  const velocities = new Map();

  nodes.forEach(node => {
    if (useExistingPositions && Number.isFinite(node.x) && Number.isFinite(node.y)) {
      positions.set(node.id, { x: node.x, y: node.y });
    } else if (deterministicPositions.has(node.id)) {
      const initial = deterministicPositions.get(node.id);
      positions.set(node.id, { x: initial.x, y: initial.y });
    } else {
      positions.set(node.id, { x: width / 2, y: height / 2 });
    }
    velocities.set(node.id, { x: 0, y: 0 });
  });

  const nodeRadii = new Map();
  const getNodeRadius = (node) => {
    if (!node) return minNodeRadius;
    if (nodeRadii.has(node.id)) return nodeRadii.get(node.id);
    const width = Math.max(node.width || node.labelWidth || node.nodeSize || nodeSpacing, nodeSpacing);
    const height = Math.max(node.height || node.labelHeight || node.nodeSize || nodeSpacing, nodeSpacing);
    const radius = Math.max(width, height) / 2 + labelPadding;
    const rawImageBonus = Math.max(node.imageHeight || node.calculatedImageHeight || 0, 0) *
      (mergedOptions.imageRadiusMultiplier ?? FORCE_LAYOUT_DEFAULTS.imageRadiusMultiplier);
    const imageBonus = Math.min(rawImageBonus, minNodeRadius * 0.75);
    const finalRadius = Math.max(radius + imageBonus, minNodeRadius);
    nodeRadii.set(node.id, finalRadius);
    return finalRadius;
  };

  const nodeCount = Math.max(nodes.length, 1);
  const areaPerNode = Math.max((width * height) / nodeCount, 1);
  const baseDistance = Math.sqrt(areaPerNode);

  const alphaDecay = mergedOptions.alphaDecay ?? FORCE_LAYOUT_DEFAULTS.alphaDecay;
  const alphaMin = mergedOptions.alphaMin ?? FORCE_LAYOUT_DEFAULTS.alphaMin;
  let alpha = 1;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxAllowedRadius = (mergedOptions.maxRadiusFactor ?? 0.48) * Math.min(width, height);

  for (let iter = 0; iter < iterations && alpha > alphaMin; iter++) {
    const forces = new Map();
    nodes.forEach(node => forces.set(node.id, { x: 0, y: 0 }));

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const node1 = nodes[i];
        const node2 = nodes[j];
        const pos1 = positions.get(node1.id);
        const pos2 = positions.get(node2.id);
        if (!pos1 || !pos2) continue;

        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const distanceSq = dx * dx + dy * dy;
        let distance = Math.sqrt(distanceSq);
        if (distance === 0) distance = 0.1;

        if (maxRepulsionDistance && distance > maxRepulsionDistance) continue;

        const radius1 = getNodeRadius(node1);
        const radius2 = getNodeRadius(node2);
        const minDistance = (radius1 + radius2) * nodeSeparationMultiplier;
        const directionX = dx / distance;
        const directionY = dy / distance;
        
        const effectiveDistance = Math.max(distance, minDistance);
        const repulsion = (repulsionStrength * alpha * baseDistance) / (effectiveDistance * effectiveDistance + 1);
        const fx = directionX * repulsion;
        const fy = directionY * repulsion;

        const f1 = forces.get(node1.id);
        const f2 = forces.get(node2.id);
        const overlapForce = Math.max((minDistance - distance), 0) * (repulsionStrength * alpha * 0.6);

        f1.x -= fx;
        f1.y -= fy;
        f2.x += fx;
        f2.y += fy;

        if (overlapForce > 0) {
          f1.x -= directionX * overlapForce;
          f1.y -= directionY * overlapForce;
          f2.x += directionX * overlapForce;
          f2.y += directionY * overlapForce;
        }
      }
    }

    edges.forEach(edge => {
      const pos1 = positions.get(edge.sourceId);
      const pos2 = positions.get(edge.destinationId);
      if (!pos1 || !pos2) return;

      const dx = pos2.x - pos1.x;
      const dy = pos2.y - pos1.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.1);

      const radius1 = getNodeRadius(nodeById.get(edge.sourceId));
      const radius2 = getNodeRadius(nodeById.get(edge.destinationId));
      const minDistance = Math.max(minLinkDistance, (radius1 + radius2) * nodeSeparationMultiplier);
      const targetDistance = Math.max(springLength, minDistance);

      const displacement = distance - targetDistance;
      const distanceFactor = Math.max(targetDistance, 1);
      const springForce = displacement * effectiveSpringStrength * alpha * (baseDistance / distanceFactor);

      const fx = (dx / distance) * springForce;
      const fy = (dy / distance) * springForce;

      const f1 = forces.get(edge.sourceId);
      const f2 = forces.get(edge.destinationId);
      if (f1 && f2) {
        f1.x += fx;
        f1.y += fy;
        f2.x -= fx;
        f2.y -= fy;
      }
    });

    nodes.forEach(node => {
      const pos = positions.get(node.id);
      const force = forces.get(node.id);
      if (!pos || !force) return;
      force.x += (centerX - pos.x) * effectiveCentering * alpha;
      force.y += (centerY - pos.y) * effectiveCentering * alpha;
    });

    if (edgeAvoidance > 0) {
      const avoidanceRadius = edgeAvoidanceRadius || collisionRadius * 1.8;
      nodes.forEach(node => {
        const force = forces.get(node.id);
        const nodePos = positions.get(node.id);
        if (!force || !nodePos) return;

        edges.forEach(edge => {
          if (edge.sourceId === node.id || edge.destinationId === node.id) return;
          const pos1 = positions.get(edge.sourceId);
          const pos2 = positions.get(edge.destinationId);
          if (!pos1 || !pos2) return;

          const edgeVecX = pos2.x - pos1.x;
          const edgeVecY = pos2.y - pos1.y;
          const edgeLenSq = edgeVecX * edgeVecX + edgeVecY * edgeVecY;
          if (edgeLenSq < 1) return;

          const nodeVecX = nodePos.x - pos1.x;
          const nodeVecY = nodePos.y - pos1.y;
          const t = Math.max(0, Math.min(1, (nodeVecX * edgeVecX + nodeVecY * edgeVecY) / edgeLenSq));
          const closestX = pos1.x + t * edgeVecX;
          const closestY = pos1.y + t * edgeVecY;

          const dx = nodePos.x - closestX;
          const dy = nodePos.y - closestY;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;

          if (dist < avoidanceRadius) {
            const strength = ((avoidanceRadius - dist) / avoidanceRadius) * edgeAvoidance * alpha * 120;
            force.x += (dx / dist) * strength;
            force.y += (dy / dist) * strength;
          }
        });
      });
    }

    nodes.forEach(node => {
      const pos = positions.get(node.id);
      const vel = velocities.get(node.id);
      const force = forces.get(node.id);
      if (!pos || !vel || !force) return;

      vel.x = (vel.x + force.x) * damping;
      vel.y = (vel.y + force.y) * damping;

      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      const maxVelocity = baseDistance * alpha * 0.8;
      if (speed > maxVelocity && speed > 0) {
        vel.x = (vel.x / speed) * maxVelocity;
        vel.y = (vel.y / speed) * maxVelocity;
      }

      pos.x += vel.x;
      pos.y += vel.y;

      const dx = pos.x - centerX;
      const dy = pos.y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      if (dist > maxAllowedRadius) {
        const clampFactor = maxAllowedRadius / dist;
        pos.x = centerX + dx * clampFactor;
        pos.y = centerY + dy * clampFactor;
      }

      pos.x = Math.max(padding, Math.min(width - padding, pos.x));
      pos.y = Math.max(padding, Math.min(height - padding, pos.y));
    });

    alpha = Math.max(alphaMin, alpha * (1 - alphaDecay));
  }

  resolveCollisions(positions, nodes, getNodeRadius, padding, width, height, 5, nodeSeparationMultiplier);
  radialRelaxation(
    positions,
    nodes,
    width / 2,
    height / 2,
    mergedOptions.radialSpreadFactor ?? FORCE_LAYOUT_DEFAULTS.radialSpreadFactor,
    mergedOptions.postRadialPasses ?? FORCE_LAYOUT_DEFAULTS.postRadialPasses
  );

  return positions;
}

/**
 * Hierarchical tree layout (for tree-structured graphs)
 * 
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects
 * @param {Object} options - Layout configuration
 * @returns {Map} Map of nodeId -> {x, y} positions
 */
export function hierarchicalLayout(nodes, edges, options = {}) {
  const {
    width = 2000,
    height = 1500,
    levelSpacing = 200,
    nodeSpacing = 150,
    padding = 200,
    direction = 'vertical' // 'vertical' or 'horizontal'
  } = options;

  const positions = new Map();
  
  // Find root nodes (nodes with no incoming edges)
  const hasIncoming = new Set();
  edges.forEach(edge => hasIncoming.add(edge.destinationId));
  const roots = nodes.filter(node => !hasIncoming.has(node.id));
  
  if (roots.length === 0) {
    // No clear hierarchy, fallback to force-directed
    return forceDirectedLayout(nodes, edges, { width, height });
  }

  // Build adjacency list for children
  const children = new Map();
  nodes.forEach(node => children.set(node.id, []));
  edges.forEach(edge => {
    if (children.has(edge.sourceId)) {
      children.get(edge.sourceId).push(edge.destinationId);
    }
  });

  // Calculate tree levels using BFS
  const levels = [];
  const visited = new Set();
  const nodeToLevel = new Map();
  
  const queue = roots.map(root => ({ id: root.id, level: 0 }));
  
  while (queue.length > 0) {
    const { id, level } = queue.shift();
    
    if (visited.has(id)) continue;
    visited.add(id);
    nodeToLevel.set(id, level);
    
    if (!levels[level]) levels[level] = [];
    levels[level].push(id);
    
    const nodeChildren = children.get(id) || [];
    nodeChildren.forEach(childId => {
      if (!visited.has(childId)) {
        queue.push({ id: childId, level: level + 1 });
      }
    });
  }

  // Position nodes by level
  const maxLevel = levels.length;
  const effectiveWidth = width - 2 * padding;
  const effectiveHeight = height - 2 * padding;
  
  levels.forEach((levelNodes, levelIndex) => {
    const nodeCount = levelNodes.length;
    const spacing = direction === 'vertical' 
      ? effectiveWidth / (nodeCount + 1)
      : effectiveHeight / (nodeCount + 1);
    
    levelNodes.forEach((nodeId, index) => {
      if (direction === 'vertical') {
        positions.set(nodeId, {
          x: padding + spacing * (index + 1),
          y: padding + (levelIndex / Math.max(1, maxLevel - 1)) * effectiveHeight
        });
      } else {
        positions.set(nodeId, {
          x: padding + (levelIndex / Math.max(1, maxLevel - 1)) * effectiveWidth,
          y: padding + spacing * (index + 1)
        });
      }
    });
  });

  return positions;
}

/**
 * Radial layout (nodes arranged in concentric circles)
 * 
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects
 * @param {Object} options - Layout configuration
 * @returns {Map} Map of nodeId -> {x, y} positions
 */
export function radialLayout(nodes, edges, options = {}) {
  const {
    width = 2000,
    height = 1500,
    radiusStep = 200,
    startRadius = 150,
    padding = 200
  } = options;

  const positions = new Map();
  const centerX = width / 2;
  const centerY = height / 2;

  if (nodes.length === 0) return positions;
  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: centerX, y: centerY });
    return positions;
  }

  // Find the most connected node as center
  const connectivity = new Map();
  nodes.forEach(node => connectivity.set(node.id, 0));
  edges.forEach(edge => {
    connectivity.set(edge.sourceId, (connectivity.get(edge.sourceId) || 0) + 1);
    connectivity.set(edge.destinationId, (connectivity.get(edge.destinationId) || 0) + 1);
  });
  
  const centerNode = nodes.reduce((max, node) => 
    connectivity.get(node.id) > connectivity.get(max.id) ? node : max
  );

  // Position center node
  positions.set(centerNode.id, { x: centerX, y: centerY });

  // Build adjacency and calculate distances from center using BFS
  const adjacency = new Map();
  nodes.forEach(node => adjacency.set(node.id, []));
  edges.forEach(edge => {
    adjacency.get(edge.sourceId).push(edge.destinationId);
    adjacency.get(edge.destinationId).push(edge.sourceId);
  });

  const distances = new Map();
  const visited = new Set([centerNode.id]);
  const queue = [{ id: centerNode.id, dist: 0 }];
  
  while (queue.length > 0) {
    const { id, dist } = queue.shift();
    distances.set(id, dist);
    
    (adjacency.get(id) || []).forEach(neighborId => {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({ id: neighborId, dist: dist + 1 });
      }
    });
  }

  // Group nodes by distance (orbit)
  const orbits = [];
  distances.forEach((dist, nodeId) => {
    if (dist === 0) return; // Skip center
    if (!orbits[dist - 1]) orbits[dist - 1] = [];
    orbits[dist - 1].push(nodeId);
  });

  // Position nodes in orbits
  orbits.forEach((orbitNodes, orbitIndex) => {
    const radius = startRadius + orbitIndex * radiusStep;
    const angleStep = (2 * Math.PI) / orbitNodes.length;
    
    orbitNodes.forEach((nodeId, index) => {
      const angle = index * angleStep;
      positions.set(nodeId, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      });
    });
  });

  // Handle disconnected nodes
  nodes.forEach(node => {
    if (!positions.has(node.id)) {
      // Place disconnected nodes randomly in outer ring
      const angle = Math.random() * 2 * Math.PI;
      const radius = startRadius + orbits.length * radiusStep;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      });
    }
  });

  return positions;
}

/**
 * Grid layout (nodes arranged in a regular grid)
 * 
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects (not used for grid)
 * @param {Object} options - Layout configuration
 * @returns {Map} Map of nodeId -> {x, y} positions
 */
export function gridLayout(nodes, edges, options = {}) {
  const {
    width = 2000,
    height = 1500,
    padding = 200,
    cellSpacing = 200
  } = options;

  const positions = new Map();
  
  // Calculate grid dimensions
  const effectiveWidth = width - 2 * padding;
  const effectiveHeight = height - 2 * padding;
  const cols = Math.ceil(Math.sqrt(nodes.length * (effectiveWidth / effectiveHeight)));
  const rows = Math.ceil(nodes.length / cols);
  
  const cellWidth = effectiveWidth / cols;
  const cellHeight = effectiveHeight / rows;

  // Position nodes in grid
  nodes.forEach((node, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    
    positions.set(node.id, {
      x: padding + col * cellWidth + cellWidth / 2,
      y: padding + row * cellHeight + cellHeight / 2
    });
  });

  return positions;
}

/**
 * Circular layout (nodes arranged in a single circle)
 * 
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects (not used)
 * @param {Object} options - Layout configuration
 * @returns {Map} Map of nodeId -> {x, y} positions
 */
export function circularLayout(nodes, edges, options = {}) {
  const {
    width = 2000,
    height = 1500,
    padding = 300
  } = options;

  const positions = new Map();
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - padding;

  if (nodes.length === 0) return positions;
  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: centerX, y: centerY });
    return positions;
  }

  const angleStep = (2 * Math.PI) / nodes.length;
  
  nodes.forEach((node, index) => {
    const angle = index * angleStep - Math.PI / 2; // Start at top
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    });
  });

  return positions;
}

/**
 * Apply layout to nodes, respecting Redstring's instance structure
 * 
 * @param {Array} nodes - Array of node instances with {id, prototypeId, ...}
 * @param {Array} edges - Array of edge objects
 * @param {string} algorithm - Layout algorithm name
 * @param {Object} options - Layout options
 * @returns {Array} Array of {instanceId, x, y} position updates
 */
export function applyLayout(nodes, edges, algorithm = 'force', options = {}) {
  let positions;
  
  switch (algorithm) {
    case 'force':
    case 'force-directed':
      positions = forceDirectedLayout(nodes, edges, options);
      break;
    case 'hierarchical':
    case 'tree':
      positions = hierarchicalLayout(nodes, edges, options);
      break;
    case 'radial':
    case 'orbit':
      positions = radialLayout(nodes, edges, options);
      break;
    case 'grid':
      positions = gridLayout(nodes, edges, options);
      break;
    case 'circular':
    case 'circle':
      positions = circularLayout(nodes, edges, options);
      break;
    default:
      console.warn(`Unknown layout algorithm: ${algorithm}, using force-directed`);
      positions = forceDirectedLayout(nodes, edges, options);
  }

  // Convert positions Map to array of updates
  const updates = [];
  positions.forEach((pos, nodeId) => {
    updates.push({
      instanceId: nodeId,
      x: Math.round(pos.x),
      y: Math.round(pos.y)
    });
  });

  return updates;
}

export default {
  forceDirectedLayout,
  hierarchicalLayout,
  radialLayout,
  gridLayout,
  circularLayout,
  applyLayout
};

