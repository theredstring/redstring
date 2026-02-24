/**
 * Graph Layout Service - Redesigned 2025
 * 
 * Clean, robust force-directed layout with proper cluster separation.
 * Focuses on predictability, spaciousness, and preventing node overlap.
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const MAX_LAYOUT_SCALE_MULTIPLIER = 1.6;

/**
 * Find connected components (clusters) in the graph
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

/**
 * Calculate node degree (connection count)
 */
function buildDegreeMap(nodes, adjacency) {
  const degrees = new Map();
  nodes.forEach(node => {
    degrees.set(node.id, (adjacency.get(node.id) || []).length);
  });
  return degrees;
}

// ============================================================================
// INITIAL POSITIONING
// ============================================================================

/**
 * Generate initial positions for a cluster using concentric rings
 * High-degree nodes go in center, low-degree on periphery
 */
function positionClusterInRings(cluster, centerX, centerY, maxRadius, degrees) {
  const positions = new Map();
  if (cluster.length === 0) return positions;

  // Sort by degree (high to low) for deterministic placement
  const sorted = [...cluster].sort((a, b) => {
    const degDiff = (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0);
    if (degDiff !== 0) return degDiff;
    return String(a.id).localeCompare(String(b.id));
  });

  // Single node - place at center
  if (sorted.length === 1) {
    positions.set(sorted[0].id, { x: centerX, y: centerY });
    return positions;
  }

  // Calculate ring spacing based on cluster size
  const ringCount = Math.ceil(Math.sqrt(sorted.length));
  const ringSpacing = maxRadius / Math.max(ringCount, 2);

  let nodeIndex = 0;
  let ring = 0;

  while (nodeIndex < sorted.length) {
    if (ring === 0) {
      // Center node
      positions.set(sorted[nodeIndex++].id, { x: centerX, y: centerY });
      ring++;
      continue;
    }

    const radius = Math.min(ringSpacing * ring, maxRadius);
    const circumference = 2 * Math.PI * radius;
    const nodesPerRing = Math.max(6 * ring, Math.ceil(circumference / 100));
    const nodesToPlace = Math.min(nodesPerRing, sorted.length - nodeIndex);

    for (let i = 0; i < nodesToPlace; i++) {
      const angle = (2 * Math.PI * i) / nodesToPlace;
      positions.set(sorted[nodeIndex++].id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      });
    }

    ring++;
    if (radius >= maxRadius) break;
  }

  // Place any remaining nodes on outer ring
  while (nodeIndex < sorted.length) {
    const remainingCount = sorted.length - nodeIndex;
    for (let i = 0; i < remainingCount; i++) {
      const angle = (2 * Math.PI * i) / remainingCount;
      positions.set(sorted[nodeIndex++].id, {
        x: centerX + Math.cos(angle) * maxRadius,
        y: centerY + Math.sin(angle) * maxRadius
      });
    }
  }

  return positions;
}

/**
 * Generate initial positions that respect user-defined groups
 */
function generateGroupAwareInitialPositions(nodes, adjacency, groups, width, height, options = {}) {
  const positions = new Map();
  if (nodes.length === 0) return positions;

  // Build node-to-groups mapping
  const nodeGroupsMap = new Map();
  groups.forEach(group => {
    (group.memberInstanceIds || []).forEach(nodeId => {
      if (!nodeGroupsMap.has(nodeId)) nodeGroupsMap.set(nodeId, []);
      nodeGroupsMap.get(nodeId).push(group.id);
    });
  });

  // Position groups in a circle around center
  const centerX = width / 2;
  const centerY = height / 2;
  const groupRadius = Math.min(width, height) * 0.35;
  const groupCentroids = new Map();

  if (groups.length === 1) {
    // Single group: place centroid at canvas center (avoids tug-of-war with centering force)
    groupCentroids.set(groups[0].id, { x: centerX, y: centerY });
  } else {
    groups.forEach((group, index) => {
      const angle = (2 * Math.PI * index) / groups.length;
      groupCentroids.set(group.id, {
        x: centerX + Math.cos(angle) * groupRadius,
        y: centerY + Math.sin(angle) * groupRadius
      });
    });
  }

  // Pre-compute member counts per group for scaling within-group spread
  const groupMemberCounts = new Map();
  groups.forEach(group => {
    groupMemberCounts.set(group.id, (group.memberInstanceIds || []).length);
  });

  // Position nodes based on their group membership
  nodes.forEach(node => {
    const groupIds = nodeGroupsMap.get(node.id) || [];

    if (groupIds.length === 0) {
      // Ungrouped node - position near center with jitter
      positions.set(node.id, {
        x: centerX + (Math.random() - 0.5) * 200,
        y: centerY + (Math.random() - 0.5) * 200
      });
    } else if (groupIds.length === 1) {
      // Single group - position near group centroid
      // Scale spread radius by member count: more members need more space
      const memberCount = groupMemberCounts.get(groupIds[0]) || 1;
      const nodeRadius = 80 + Math.sqrt(memberCount) * 40;
      const centroid = groupCentroids.get(groupIds[0]);
      const jitter = nodeRadius * (Math.random() - 0.5) * 2;
      positions.set(node.id, {
        x: centroid.x + jitter,
        y: centroid.y + (Math.random() - 0.5) * nodeRadius * 2
      });
    } else {
      // Multiple groups - position at average of centroids  
      let avgX = 0, avgY = 0;
      groupIds.forEach(gid => {
        const c = groupCentroids.get(gid);
        if (c) {
          avgX += c.x;
          avgY += c.y;
        }
      });
      avgX /= groupIds.length;
      avgY /= groupIds.length;
      positions.set(node.id, {
        x: avgX + (Math.random() - 0.5) * 100,
        y: avgY + (Math.random() - 0.5) * 100
      });
    }
  });

  return positions;
}

/**
 * Generate deterministic initial positions for all nodes
 * Separates clusters spatially from the start
 */
function generateInitialPositions(nodes, adjacency, width, height, options = {}) {
  const positions = new Map();
  if (nodes.length === 0) return positions;

  const centerX = width / 2;
  const centerY = height / 2;
  const degrees = buildDegreeMap(nodes, adjacency);
  const clusters = getGraphClusters(nodes, adjacency);
  const densityFactor = Math.max(0, Math.min(1, options.densityFactor ?? 0));
  const manualScaleTarget = clamp(
    options.layoutScaleMultiplier ?? 1,
    0.5,
    MAX_LAYOUT_SCALE_MULTIPLIER
  );
  const layoutScaleAdjustment = Math.min(Math.max(manualScaleTarget - 1, 0), 0.6);
  const clusterSpacingFactor = 1 - layoutScaleAdjustment * 0.25;

  // Single cluster - place at center with generous spacing
  if (clusters.length === 1) {
    const clusterRadius = Math.min(width, height) * 0.45;  // Larger initial spread
    const clusterPositions = positionClusterInRings(
      clusters[0], centerX, centerY, clusterRadius, degrees
    );
    clusterPositions.forEach((pos, id) => positions.set(id, pos));
    return positions;
  }

  // Multiple clusters - distribute widely around circle
  const mainCluster = clusters[0];
  const smallClusters = clusters.slice(1);
  const smallClusterCount = smallClusters.length;


  // Main cluster in center
  const mainRadius = Math.min(width, height) * (0.2 * Math.max(0.6, 1 - densityFactor * 0.2));  // Tighter main cluster
  const mainPositions = positionClusterInRings(
    mainCluster, centerX, centerY, mainRadius, degrees
  );
  mainPositions.forEach((pos, id) => positions.set(id, pos));

  // Small clusters start close to the main cluster for fewer groups, expanding gently as count grows
  const minDimension = Math.min(width, height);
  const isTwoClusterScenario = smallClusterCount === 1;
  const baseOrbitFactor = isTwoClusterScenario ? 0.12 : 0.26;
  const maxOrbitFactor = isTwoClusterScenario ? 0.2 : 0.45;
  const perClusterBoost = isTwoClusterScenario ? 0.015 : 0.03;
  const additionalClusters = Math.max(0, smallClusterCount - (isTwoClusterScenario ? 0 : 1));
  const orbitBoost = Math.min(maxOrbitFactor - baseOrbitFactor, additionalClusters * perClusterBoost);
  const orbitCompression = 1 - densityFactor * 0.35;
  const orbitRadius = minDimension * (baseOrbitFactor + orbitBoost) * clusterSpacingFactor * Math.max(0.55, orbitCompression);
  const clusterRadiusBoost = 1 + layoutScaleAdjustment * 0.2;
  const clusterRadius = minDimension * (isTwoClusterScenario ? 0.34 : 0.22) * clusterRadiusBoost * (1 - densityFactor * 0.12);

  smallClusters.forEach((cluster, index) => {
    const angle = (2 * Math.PI * index) / smallClusters.length;
    const geometryFactor = 1 + Math.log10(cluster.length + 1) * 0.04;
    const computedClusterRadius = clusterRadius * geometryFactor;
    const clusterNodeSpan = Math.max(5, cluster.length);
    const separationMargin = Math.max(
      computedClusterRadius * 0.15,
      Math.sqrt(clusterNodeSpan) * 14,
      minDimension * 0.035,
      50
    );
    const desiredDistance = Math.max(
      mainRadius + computedClusterRadius + separationMargin,
      minDimension * 0.15
    );
    const finalDistance = Math.min(orbitRadius, desiredDistance);
    const clusterCenterX = centerX + Math.cos(angle) * finalDistance;
    const clusterCenterY = centerY + Math.sin(angle) * finalDistance;

    const ringRadius = Math.max(clusterRadius, computedClusterRadius);
    const clusterPositions = positionClusterInRings(
      cluster, clusterCenterX, clusterCenterY, ringRadius, degrees
    );
    clusterPositions.forEach((pos, id) => positions.set(id, pos));
  });

  return positions;
}

// ============================================================================
// FORCE CALCULATION
// ============================================================================

/**
 * Calculate repulsion force between two nodes
 * Uses inverse-square law with distance cutoff
 */
function calculateRepulsion(pos1, pos2, strength, minDist = 1) {
  const dx = pos2.x - pos1.x;
  const dy = pos2.y - pos1.y;
  const distSq = Math.max(dx * dx + dy * dy, minDist * minDist);
  const dist = Math.sqrt(distSq);

  if (dist < 0.1) return { fx: 0, fy: 0 };

  const force = strength / distSq;
  return {
    fx: -(dx / dist) * force,
    fy: -(dy / dist) * force
  };
}

/**
 * Calculate spring (attraction) force along an edge
 * Hooke's law with target distance
 */
function calculateSpring(pos1, pos2, targetDist, strength) {
  const dx = pos2.x - pos1.x;
  const dy = pos2.y - pos1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.1) return { fx: 0, fy: 0 };

  const displacement = dist - targetDist;
  const force = displacement * strength;

  return {
    fx: (dx / dist) * force,
    fy: (dy / dist) * force
  };
}

/**
 * Calculate centering force toward canvas center
 */
function calculateCentering(pos, centerX, centerY, strength) {
  return {
    fx: (centerX - pos.x) * strength,
    fy: (centerY - pos.y) * strength
  };
}

/**
 * Calculate distance from point P to line segment AB.
 * Returns { distSq, closestX, closestY, t }
 * t is the projection factor (0 to 1).
 */
function getPointSegmentDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    // Segment is a point
    const diffX = px - ax;
    const diffY = py - ay;
    return { distSq: diffX * diffX + diffY * diffY, closestX: ax, closestY: ay, t: 0 };
  }

  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const closestX = ax + clampedT * dx;
  const closestY = ay + clampedT * dy;
  const diffX = px - closestX;
  const diffY = py - closestY;

  return {
    distSq: diffX * diffX + diffY * diffY,
    closestX,
    closestY,
    t: clampedT
  };
}

// ============================================================================
// CONSTANTS & PRESETS
// ============================================================================

export const FORCE_LAYOUT_DEFAULTS = {
  width: 2000,
  height: 1500,
  iterations: 600,

  // Basic forces
  repulsionStrength: 2200,     // Refined value from tuner (was 500000)
  attractionStrength: 0.05,    // Refined value from tuner (was 0.2)
  centerStrength: 0.015,       // Gentler centering

  // Distance parameters
  targetLinkDistance: 400,    // Much longer target distance
  linkDistance: 400,          // Alias for compatibility
  minNodeDistance: 280,       // Refined value from tuner (was 250)
  minLinkDistance: 280,       // Alias for compatibility
  maxRepulsionDistance: 1500, // Allow repulsion from further away

  // Simulation control
  damping: 0.85,
  velocityDecay: 0.85,  // Alias for damping
  alphaDecay: 0.008,
  alphaMin: 0.001,

  // Node sizing
  nodeSpacing: 140,
  labelPadding: 40,
  minNodeRadius: 90,        // Refined value from tuner (was 80)
  collisionRadius: 90,      // Alias for minNodeRadius

  // Edge avoidance - push nodes away from edges they're not part of
  edgeAvoidance: 0.95,      // Refined value from tuner (was 0.5)
  edgeAvoidanceRadius: 200,

  // Bounds
  padding: 200,

  // Label-aware connection tuning
  labelAwareLinkDistance: true,
  labelAwareLinkPadding: 30,
  labelAwareLinkReduction: 1,

  // Advanced forces
  enableEdgeRepulsion: true, // Triplet repulsion
  stiffness: 0.6,            // Rigid body stiffness (0.0 - 1.0)

  // Group clustering
  groupAttractionStrength: 0.6,  // How strongly nodes pull toward group center (must compete with N-body repulsion)
  groupRepulsionStrength: 4.8,   // Refined value from tuner (was 2.0)
  minGroupDistance: 800,         // Minimum distance between group centroids (must exceed initial spacing ~700px)
  groupExclusionStrength: 1.5,   // How strongly non-members are pushed out of group bounds
  groupBoundaryPadding: 100,     // Padding around group bounding boxes

  // Presets
  layoutScale: 'balanced',
  layoutScaleMultiplier: 1.6,  // Refined value from tuner (was 1.0)
  iterationPreset: 'balanced'
};

export const LAYOUT_SCALE_PRESETS = {
  compact: {
    label: 'Compact',
    targetLinkDistance: 280,
    linkDistance: 280,  // Alias
    minNodeDistance: 200,
    minLinkDistance: 200,  // Alias
    repulsionStrength: 1540
  },
  balanced: {
    label: 'Balanced',
    targetLinkDistance: 400,
    linkDistance: 400,  // Alias
    minNodeDistance: 280,
    minLinkDistance: 280,  // Alias
    repulsionStrength: 2200
  },
  spacious: {
    label: 'Spacious',
    targetLinkDistance: 550,
    linkDistance: 550,  // Alias
    minNodeDistance: 380,
    minLinkDistance: 380,  // Alias
    repulsionStrength: 3080
  }
};

export const LAYOUT_ITERATION_PRESETS = {
  fast: {
    iterations: 300,
    alphaDecay: 0.015
  },
  balanced: {
    iterations: 600,
    alphaDecay: 0.008
  },
  deep: {
    iterations: 1200,
    alphaDecay: 0.004
  }
};

// ============================================================================
// ADAPTIVE SCALING
// ============================================================================

/**
 * Calculate automatic scale multiplier based on node count
 * More nodes = more space needed
 * 
 * Scale curve:
 * - 1-5 nodes: 1.0× (baseline)
 * - 10 nodes: 1.15×
 * - 20 nodes: 1.4×
 * - 30 nodes: 1.6×
 * - 50 nodes: 1.9×
 * - 100+ nodes: 2.3×
 */
function calculateAutoScale(nodeCount) {
  if (nodeCount <= 5) return 1.0;

  // More aggressive curve to roughly double again (target ~4.1 at ~21 nodes)
  const normalized = Math.max(0, nodeCount - 5);
  const baseSpread = 1 + 2.15 * (1 - Math.exp(-normalized / 8));

  // Additional boost for very large graphs
  const extraNodes = Math.max(0, nodeCount - 21);
  const extraGrowth = Math.log1p(extraNodes) * 0.18;

  return Math.min(6, baseSpread + extraGrowth);
}

// ============================================================================
// GROUP-SEPARATED LAYOUT (Two-Phase)
// ============================================================================

/**
 * Two-phase group-aware layout that guarantees group separation:
 * Phase 1: Layout each group independently with its own force simulation
 * Phase 2: Position group clusters in a circle with spacing proportional to size
 *
 * This avoids the fundamental problem of group forces competing with N-body
 * repulsion inside a single simulation.
 */
function groupSeparatedLayout(nodes, edges, options = {}) {
  const groups = options.groups || [];

  const scalePreset = LAYOUT_SCALE_PRESETS[options.layoutScale] || LAYOUT_SCALE_PRESETS.balanced;
  const iterPreset = LAYOUT_ITERATION_PRESETS[options.iterationPreset] || LAYOUT_ITERATION_PRESETS.balanced;
  const config = { ...FORCE_LAYOUT_DEFAULTS, ...scalePreset, ...iterPreset, ...options };

  // Resolve aliases (same as forceDirectedLayout Fix 1)
  if (config.linkDistance !== undefined && config.linkDistance !== config.targetLinkDistance) {
    config.targetLinkDistance = config.linkDistance;
  }
  if (config.minLinkDistance !== undefined && config.minLinkDistance !== config.minNodeDistance) {
    config.minNodeDistance = config.minLinkDistance;
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const centerX = config.width / 2;
  const centerY = config.height / 2;

  // Build node -> groups mapping (track ALL groups per node)
  const nodeToGroups = new Map(); // nodeId -> Set<groupId>
  groups.forEach(g => {
    (g.memberInstanceIds || []).forEach(id => {
      if (!nodeToGroups.has(id)) nodeToGroups.set(id, new Set());
      nodeToGroups.get(id).add(g.id);
    });
  });

  // Nodes in multiple groups get excluded from per-group layouts and placed between groups later
  const multiGroupNodeIds = new Set();
  nodeToGroups.forEach((groupIds, nodeId) => {
    if (groupIds.size > 1) multiGroupNodeIds.add(nodeId);
  });

  const ungroupedNodes = nodes.filter(n => !nodeToGroups.has(n.id));

  // ---- Phase 1: Layout each group independently ----
  const groupLayouts = new Map();

  groups.forEach(group => {
    // Exclude multi-group nodes from individual group layouts to avoid duplicate positioning
    const memberIds = new Set(
      (group.memberInstanceIds || []).filter(id => !multiGroupNodeIds.has(id))
    );
    const memberNodes = [...memberIds].map(id => nodeById.get(id)).filter(Boolean);
    if (memberNodes.length === 0) return;

    // Edges entirely within this group (both endpoints must be single-group members)
    const intraEdges = edges.filter(e => memberIds.has(e.sourceId) && memberIds.has(e.destinationId));

    // Size sub-canvas based on member count
    const subSize = Math.max(800, Math.sqrt(memberNodes.length) * 500);

    // Run isolated force layout for this group (groups: [] prevents recursion)
    const positions = forceDirectedLayout(memberNodes, intraEdges, {
      width: subSize,
      height: subSize,
      padding: 100,
      groups: [],
      layoutScale: options.layoutScale,
      layoutScaleMultiplier: options.layoutScaleMultiplier,
      iterationPreset: options.iterationPreset,
      repulsionStrength: config.repulsionStrength,
      attractionStrength: config.attractionStrength,
      stiffness: config.stiffness,
      edgeAvoidance: config.edgeAvoidance,
    });

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positions.forEach((pos, id) => {
      const node = nodeById.get(id);
      const w = node?.width || 150;
      const h = node?.height || 100;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + w);
      maxY = Math.max(maxY, pos.y + h);
    });

    groupLayouts.set(group.id, {
      positions,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    });
  });

  if (groupLayouts.size === 0) {
    // No groups had members - fall back to standard layout
    return forceDirectedLayout(nodes, edges, { ...options, groups: [] });
  }

  // ---- Phase 2: Group-level force-directed layout ----
  // Treat groups as large meta-nodes — same physics engine at a higher scale.
  // Cross-group edges become meta-edges so connected groups naturally attract.

  const ungroupedSet = new Set(ungroupedNodes.map(n => n.id));

  // Build meta-nodes sized by each group's bounding box
  const metaNodes = [];
  groupLayouts.forEach((layout, gId) => {
    metaNodes.push({
      id: gId,
      width: layout.width + 200,
      height: layout.height + 200,
      x: 0, y: 0
    });
  });

  // Virtual meta-node for ungrouped nodes (e.g. edge definition nodes)
  if (ungroupedNodes.length > 0) {
    metaNodes.push({
      id: '__ungrouped__',
      width: Math.max(300, Math.sqrt(ungroupedNodes.length) * 150),
      height: Math.max(200, Math.sqrt(ungroupedNodes.length) * 100),
      x: 0, y: 0
    });
  }

  // Build meta-edges from cross-group node connections
  // More cross-connections between two groups → stronger pull (multiple springs)
  const metaEdgePairs = new Map(); // "gA|gB" -> count
  const getNodeMetaGroups = (nodeId) => {
    const gs = nodeToGroups.get(nodeId);
    if (gs && gs.size > 0) return [...gs];
    if (ungroupedSet.has(nodeId)) return ['__ungrouped__'];
    return [];
  };
  edges.forEach(e => {
    const srcGroups = getNodeMetaGroups(e.sourceId);
    const dstGroups = getNodeMetaGroups(e.destinationId);
    // Create meta-edges for all cross-group pairs
    srcGroups.forEach(gSrc => {
      dstGroups.forEach(gDst => {
        if (gSrc === gDst) return;
        const key = [gSrc, gDst].sort().join('|');
        metaEdgePairs.set(key, (metaEdgePairs.get(key) || 0) + 1);
      });
    });
  });
  // Multi-group nodes also imply affinity between their groups
  multiGroupNodeIds.forEach(nodeId => {
    const gs = [...(nodeToGroups.get(nodeId) || [])];
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        const key = [gs[i], gs[j]].sort().join('|');
        metaEdgePairs.set(key, (metaEdgePairs.get(key) || 0) + 2); // Strong affinity
      }
    }
  });

  const metaEdges = [];
  metaEdgePairs.forEach((count, key) => {
    const [g1, g2] = key.split('|');
    // Cap at 5 springs per pair to avoid overpowering repulsion
    for (let i = 0; i < Math.min(count, 5); i++) {
      metaEdges.push({ sourceId: g1, destinationId: g2 });
    }
  });

  // Run force-directed on meta-nodes — same engine, group scale
  const avgDim = metaNodes.reduce((s, n) => s + Math.max(n.width, n.height), 0) / metaNodes.length;
  const metaPositions = forceDirectedLayout(metaNodes, metaEdges, {
    width: config.width,
    height: config.height,
    padding: 200,
    groups: [],  // No sub-groups at meta level
    iterations: 200,
    repulsionStrength: config.repulsionStrength,
    targetLinkDistance: avgDim + 200,
    minNodeDistance: avgDim * 0.8,
  });

  // Shift each group's internal layout to its meta-node position
  const finalPositions = new Map();
  groupLayouts.forEach((layout, gId) => {
    const metaPos = metaPositions.get(gId);
    if (!metaPos) return;
    const offsetX = metaPos.x - layout.centerX;
    const offsetY = metaPos.y - layout.centerY;
    layout.positions.forEach((pos, nodeId) => {
      finalPositions.set(nodeId, { x: pos.x + offsetX, y: pos.y + offsetY });
    });
  });

  // Place multi-group nodes at the centroid of their groups
  multiGroupNodeIds.forEach(nodeId => {
    const node = nodeById.get(nodeId);
    if (!node) return;
    const gs = nodeToGroups.get(nodeId);
    if (!gs) return;
    let sumX = 0, sumY = 0, gCount = 0;
    gs.forEach(gId => {
      const metaPos = metaPositions.get(gId);
      if (metaPos) { sumX += metaPos.x; sumY += metaPos.y; gCount++; }
    });
    if (gCount > 0) {
      finalPositions.set(nodeId, {
        x: sumX / gCount + (Math.random() - 0.5) * 60,
        y: sumY / gCount + (Math.random() - 0.5) * 60
      });
    } else {
      finalPositions.set(nodeId, { x: centerX, y: centerY });
    }
  });

  // Place ungrouped nodes near their connected groups
  ungroupedNodes.forEach(node => {
    let sumX = 0, sumY = 0, connCount = 0;
    edges.forEach(e => {
      let targetId = null;
      if (e.sourceId === node.id) targetId = e.destinationId;
      if (e.destinationId === node.id) targetId = e.sourceId;
      if (!targetId) return;
      const pos = finalPositions.get(targetId);
      if (pos) { sumX += pos.x; sumY += pos.y; connCount++; }
    });
    if (connCount > 0) {
      finalPositions.set(node.id, {
        x: sumX / connCount + (Math.random() - 0.5) * 80,
        y: sumY / connCount + (Math.random() - 0.5) * 80
      });
    } else {
      finalPositions.set(node.id, {
        x: centerX + (Math.random() - 0.5) * 200,
        y: centerY + (Math.random() - 0.5) * 200
      });
    }
  });

  // ---- Phase 3: Cross-group edge refinement ----
  // Brief force simulation with ALL edges and strong group forces.
  // Spring forces from cross-group edges gently adjust positions while
  // group forces maintain cohesion.
  const nodesWithPositions = nodes.map(n => {
    const pos = finalPositions.get(n.id);
    return { ...n, x: pos?.x ?? centerX, y: pos?.y ?? centerY };
  });

  // ── Fix 3b: Weaker Phase 3 refinement to preserve group separation ───
  // Fewer iterations + stronger group forces + weaker cross-group springs
  return forceDirectedLayout(nodesWithPositions, edges, {
    ...options,
    useExistingPositions: true,  // Prevents re-entering groupSeparatedLayout
    iterations: 20,  // Reduced from 40 — minimal time for springs to undo separation
    groups: groups,
    groupAttractionStrength: Math.max(config.groupAttractionStrength, 2.0),
    groupRepulsionStrength: Math.max(config.groupRepulsionStrength, 4.0),
    groupExclusionStrength: Math.max(config.groupExclusionStrength, 3.0),
    minGroupDistance: config.minGroupDistance,
    centerStrength: 0.005,
  });
}

// ============================================================================
// MAIN FORCE-DIRECTED LAYOUT
// ============================================================================

/**
 * Force-directed graph layout
 * Clean implementation with proper cluster separation
 */
export function forceDirectedLayout(nodes, edges, options = {}) {
  if (nodes.length === 0) return new Map();

  // Delegate to two-layer layout for fresh creation with groups
  // (useExistingPositions = refinement, handled by main simulation with group forces)
  const groups = options.groups || [];
  if (groups.length > 0 && !options.useExistingPositions) {
    return groupSeparatedLayout(nodes, edges, options);
  }

  // Merge options with presets
  const scalePreset = LAYOUT_SCALE_PRESETS[options.layoutScale] || LAYOUT_SCALE_PRESETS.balanced;
  const iterPreset = LAYOUT_ITERATION_PRESETS[options.iterationPreset] || LAYOUT_ITERATION_PRESETS.balanced;

  const config = {
    ...FORCE_LAYOUT_DEFAULTS,
    ...scalePreset,
    ...iterPreset,
    ...options
  };

  // ── Fix 1: Resolve config aliases ──────────────────────────────────────
  // The UI tuner uses linkDistance / minLinkDistance but the simulation
  // reads targetLinkDistance / minNodeDistance.  Without this bridge the
  // user's slider values are silently ignored.
  if (config.linkDistance !== undefined && config.linkDistance !== config.targetLinkDistance) {
    config.targetLinkDistance = config.linkDistance;
  }
  if (config.minLinkDistance !== undefined && config.minLinkDistance !== config.minNodeDistance) {
    config.minNodeDistance = config.minLinkDistance;
  }

  // Calculate automatic scale based on node count
  const totalNodes = nodes.length;
  const autoScale = calculateAutoScale(totalNodes);
  const manualScaleTargetRaw = config.layoutScaleMultiplier ?? 1;
  const manualScaleTarget = clamp(
    manualScaleTargetRaw,
    0.5,
    MAX_LAYOUT_SCALE_MULTIPLIER
  );
  const effectiveScale = clamp(autoScale * manualScaleTarget, 0.4, 3);
  const manualScaleReduction = Math.min(Math.max(manualScaleTarget - 1, 0), 0.6);

  const targetLinkDistance = config.targetLinkDistance * effectiveScale;
  const minNodeDistance = config.minNodeDistance * effectiveScale;
  const maxRepulsionDistance = config.maxRepulsionDistance * effectiveScale;
  const baseRepulsionStrength = config.repulsionStrength * (effectiveScale ** 0.5);
  const totalPossibleEdges = Math.max(1, totalNodes * (totalNodes - 1) / 2);
  const rawDensity = edges.length / totalPossibleEdges;
  const densityFactor = Math.min(1, rawDensity * 1.25);
  const densityRepulsionMultiplier = Math.max(0.4, 1 - densityFactor * 0.6);
  const densityAttractionMultiplier = 1 + densityFactor * 0.45;
  const densityNodeDistanceFactor = Math.max(0.65, 1 - densityFactor * 0.35);
  const densityRepulsionDistanceFactor = Math.max(0.6, 1 - densityFactor * 0.25);
  const repulsionStrength = baseRepulsionStrength * densityRepulsionMultiplier;
  const attractionStrength = config.attractionStrength * densityAttractionMultiplier;

  // Build adjacency
  const adjacency = new Map();
  nodes.forEach(node => adjacency.set(node.id, []));
  edges.forEach(edge => {
    if (adjacency.has(edge.sourceId) && adjacency.has(edge.destinationId)) {
      adjacency.get(edge.sourceId).push(edge.destinationId);
      adjacency.get(edge.destinationId).push(edge.sourceId);
    }
  });

  // Identify clusters
  const clusters = getGraphClusters(nodes, adjacency);
  const clusterMap = new Map();
  clusters.forEach((cluster, idx) => {
    cluster.forEach(node => clusterMap.set(node.id, idx));
  });

  // Build group membership map for group forces in simulation
  // (groupSeparatedLayout handles fresh creation; this runs for refinement with existing positions)
  config._hasUserGroups = groups.length > 0;
  const nodeGroupsMap = new Map(); // nodeId -> Set of groupIds
  groups.forEach(group => {
    (group.memberInstanceIds || []).forEach(nodeId => {
      if (!nodeGroupsMap.has(nodeId)) nodeGroupsMap.set(nodeId, new Set());
      nodeGroupsMap.get(nodeId).add(group.id);
    });
  });

  // Apply cluster scaling - more clusters need more space, but keep link stretch tight
  const totalClusters = clusters.length;
  const clusterDistanceFactor = totalClusters > 1
    ? Math.max(0.75, 1 - manualScaleReduction * 0.35)
    : 1;
  const clusterScale = totalClusters > 1
    ? (1 + Math.log10(totalClusters) * 0.15) * clusterDistanceFactor
    : 1;
  const linkStretch = totalClusters > 1
    ? Math.min(1.15, 0.95 + Math.log10(totalClusters) * 0.1)
    : 1;
  const linkShrinkFactor = Math.max(0.85, 1 - manualScaleReduction * 0.2);

  // Update distances with cluster scaling
  const finalTargetLinkDistance = targetLinkDistance * Math.max(0.85, linkStretch * linkShrinkFactor);
  const finalMinNodeDistance = minNodeDistance * clusterScale * densityNodeDistanceFactor;
  const finalMaxRepulsionDistance = maxRepulsionDistance * clusterScale * densityRepulsionDistanceFactor;

  // ── Fix 4: Label-aware node radius for collision ─────────────────────
  // Incorporate actual label width so wider labels produce larger collision
  // radii, preventing edges from overlapping adjacent labels.
  const getNodeRadius = (node) => {
    if (!node) return config.minNodeRadius;
    const w = Math.max(node.width || config.nodeSpacing, config.nodeSpacing);
    const h = Math.max(node.height || config.nodeSpacing, config.nodeSpacing);
    const labelW = node.labelWidth || node.width || config.nodeSpacing;
    // Use the largest of body width, body height, and label span
    const effectiveSpan = Math.max(w, h, labelW + config.labelPadding * 2);
    const baseRadius = effectiveSpan / 2 + config.labelPadding;
    const imageBonus = Math.max(node.imageHeight || 0, 0) * 0.5;
    return Math.max(baseRadius + imageBonus, config.minNodeRadius);
  };

  const getLabelWidth = (node) => {
    if (!node) return config.nodeSpacing;
    return Math.max(node.labelWidth ?? node.width ?? 0, config.nodeSpacing);
  };

  const getLabelAwareTarget = (n1, n2) => {
    if (!config.labelAwareLinkDistance) return 0;
    const widthSum = getLabelWidth(n1) + getLabelWidth(n2);
    const padding = config.labelAwareLinkPadding || 0;
    // Prefer just-enough length for label plus modest padding,
    // staying close to the minimum viable width
    return widthSum * 0.4 + padding;
  };

  // Initialize positions
  const positions = new Map();
  const velocities = new Map();

  if (options.useExistingPositions) {
    nodes.forEach(node => {
      if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
        positions.set(node.id, { x: node.x, y: node.y });
      } else {
        positions.set(node.id, { x: config.width / 2, y: config.height / 2 });
      }
      velocities.set(node.id, { x: 0, y: 0 });
    });
  } else {
    const initialOptions = {
      ...config,
      densityFactor,
      layoutScaleMultiplier: manualScaleTarget
    };

    // Use group-aware positioning when groups are present (refinement path with useExistingPositions=false
    // but groups present can happen via euler/hybrid or other callers)
    const initial = groups.length > 0
      ? generateGroupAwareInitialPositions(nodes, adjacency, config.width, config.height, groups, initialOptions)
      : generateInitialPositions(nodes, adjacency, config.width, config.height, initialOptions);

    // Detect stacked nodes and apply jitter
    const jitterRadius = 100;
    let hasStackedNodes = false;
    const positionsList = [...initial.values()];
    for (let i = 0; i < positionsList.length - 1 && !hasStackedNodes; i++) {
      for (let j = i + 1; j < positionsList.length; j++) {
        const dx = positionsList[i].x - positionsList[j].x;
        const dy = positionsList[i].y - positionsList[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < 50) {
          hasStackedNodes = true;
          break;
        }
      }
    }

    if (hasStackedNodes) {
      initial.forEach((pos, id) => {
        pos.x += (Math.random() - 0.5) * jitterRadius * 2;
        pos.y += (Math.random() - 0.5) * jitterRadius * 2;
      });
    }

    initial.forEach((pos, id) => {
      positions.set(id, { ...pos });
      velocities.set(id, { x: 0, y: 0 });
    });
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const centerX = config.width / 2;
  const centerY = config.height / 2;

  // Adaptive parameters
  const nodeCount = nodes.length;
  const clusterCount = clusters.length;
  const isMultiCluster = clusterCount > 1;
  const isSparse = edges.length < nodes.length;
  const isTwoClusterScenario = clusterCount === 2;

  // Simulation loop
  let alpha = 1.0;

  for (let iter = 0; iter < config.iterations; iter++) {
    const forces = new Map();
    nodes.forEach(node => forces.set(node.id, { fx: 0, fy: 0 }));

    // Phase control - stronger repulsion early, stronger spring/center late
    const progress = iter / config.iterations;
    const repulsionMult = progress < 0.3 ? 1.4 : (progress < 0.7 ? 1.0 : 0.8);
    const springMult = progress < 0.3 ? 0.7 : (progress < 0.7 ? 1.0 : 1.2);
    // Cross-group springs don't get late-stage boost to prevent boundary violations
    const crossGroupSpringMult = progress < 0.3 ? 0.7 : 1.0;
    const centerMult = progress < 0.5 ? 0.5 : 1.0;

    // Repulsion forces (n-body)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        const p1 = positions.get(n1.id);
        const p2 = positions.get(n2.id);
        if (!p1 || !p2) continue;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Distance cutoff for performance
        if (dist > finalMaxRepulsionDistance) continue;

        // Stronger repulsion between different clusters, but soften for small cluster counts
        const c1 = clusterMap.get(n1.id);
        const c2 = clusterMap.get(n2.id);
        const crossCluster = isMultiCluster && c1 !== c2;
        const baseCrossClusterMultiplier = crossCluster
          ? 1 + Math.min(0.5, 0.1 * Math.max(0, clusterCount - 1))
          : 1.0;
        const proximityThreshold = finalTargetLinkDistance * 0.4;
        const proximityBoost = crossCluster && dist < proximityThreshold
          ? ((proximityThreshold - dist) / proximityThreshold) * 1.2
          : 0;
        const crossClusterMultiplier = baseCrossClusterMultiplier + proximityBoost;

        const r1 = getNodeRadius(n1);
        const r2 = getNodeRadius(n2);
        const effectiveMinNodeDistance = crossCluster
          ? finalMinNodeDistance * (isTwoClusterScenario ? 0.55 : 0.75)
          : finalMinNodeDistance;
        const minDist = Math.max((r1 + r2) * 1.2, effectiveMinNodeDistance);

        const repulsion = calculateRepulsion(p1, p2,
          repulsionStrength * repulsionMult * crossClusterMultiplier * alpha, minDist);

        const f1 = forces.get(n1.id);
        const f2 = forces.get(n2.id);
        f1.fx += repulsion.fx;
        f1.fy += repulsion.fy;
        f2.fx -= repulsion.fx;
        f2.fy -= repulsion.fy;

        // Extra push if overlapping
        if (dist < minDist) {
          const pushStrength = (minDist - dist) * 2;
          const pushX = (dx / Math.max(dist, 0.1)) * pushStrength;
          const pushY = (dy / Math.max(dist, 0.1)) * pushStrength;
          f1.fx -= pushX;
          f1.fy -= pushY;
          f2.fx += pushX;
          f2.fy += pushY;
        }
      }
    }

    // ------------------------------------------------------------------------
    // Edge Repulsion (Node-Edge & Edge-Edge Interaction)
    // ------------------------------------------------------------------------
    // Edges repel nodes (and thus other edges via their endpoints).
    // This prevents nodes from crossing edges or sitting on top of them.
    // It naturally handles "triplet repulsion" (edge-edge) by repelling 
    // each edge's endpoints from the other edge's segment.

    if (config.enableEdgeRepulsion) {
      // Pre-calculate edge segments for this iteration
      const edgeSegments = [];
      edges.forEach(edge => {
        const p1 = positions.get(edge.sourceId);
        const p2 = positions.get(edge.destinationId);
        if (p1 && p2) {
          edgeSegments.push({
            sourceId: edge.sourceId,
            targetId: edge.destinationId,
            x1: p1.x, y1: p1.y,
            x2: p2.x, y2: p2.y
          });
        }
      });

      const edgeRepulsionStrength = repulsionStrength * 0.8;
      const minDist = finalMinNodeDistance;

      // Iterate all nodes against all edges
      // O(N * E) complexity - acceptable for typical graph sizes
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const nPos = positions.get(node.id);
        if (!nPos) continue;

        for (let j = 0; j < edgeSegments.length; j++) {
          const seg = edgeSegments[j];

          // Skip if node is part of the edge (incident)
          if (node.id === seg.sourceId || node.id === seg.targetId) continue;

          // Helper to apply force from segment to point
          const { distSq, closestX, closestY, t } = getPointSegmentDistSq(
            nPos.x, nPos.y,
            seg.x1, seg.y1,
            seg.x2, seg.y2
          );

          // Only interact if relatively close
          if (distSq > minDist * minDist * 4) continue;

          const dist = Math.sqrt(distSq);

          // Calculate repulsion vector
          let rx, ry;
          if (dist < 0.1) {
            // Very close/on top: random or perpendicular kick
            const dx = seg.x2 - seg.x1;
            const dy = seg.y2 - seg.y1;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            rx = -dy / len;
            ry = dx / len;
          } else {
            rx = (nPos.x - closestX) / dist;
            ry = (nPos.y - closestY) / dist;
          }

          // Strength falls off with distance
          const forceMag = (edgeRepulsionStrength * alpha) / Math.max(distSq, 100);

          const fx = rx * forceMag;
          const fy = ry * forceMag;

          // Apply force to the node (away from edge)
          const fNode = forces.get(node.id);
          if (fNode) {
            fNode.fx += fx;
            fNode.fy += fy;
          }

          // Apply equal and opposite reaction to edge endpoints
          // Distribute based on t (proximity to endpoints)
          // t=0 (source), t=1 (target)
          const reactionX = -fx;
          const reactionY = -fy;

          const fSource = forces.get(seg.sourceId);
          const fTarget = forces.get(seg.targetId);

          if (fSource) {
            fSource.fx += reactionX * (1 - t);
            fSource.fy += reactionY * (1 - t);
          }
          if (fTarget) {
            fTarget.fx += reactionX * t;
            fTarget.fy += reactionY * t;
          }
        }
      }
    }

    // Spring forces (edges)
    edges.forEach(edge => {
      const p1 = positions.get(edge.sourceId);
      const p2 = positions.get(edge.destinationId);
      if (!p1 || !p2) return;

      const n1 = nodeById.get(edge.sourceId);
      const n2 = nodeById.get(edge.destinationId);
      const r1 = getNodeRadius(n1);
      const r2 = getNodeRadius(n2);
      const minDist = (r1 + r2) * 1.2;
      const labelAwareTarget = getLabelAwareTarget(n1, n2);
      const baseTarget = finalTargetLinkDistance;
      const preferredTarget = Math.max(labelAwareTarget, minDist);
      const blendWeight = config.labelAwareLinkDistance ? 0.9 : 0.65;
      const blendedTarget = preferredTarget * blendWeight + baseTarget * (1 - blendWeight);
      let effectiveTarget = Math.max(preferredTarget, Math.min(blendedTarget, baseTarget));

      // ── Fix 2: Enforce minimum edge length ──────────────────────────────
      // finalMinNodeDistance is the scaled version of config.minNodeDistance
      // (which now correctly reflects the user's minLinkDistance setting).
      // Edges must never be shorter than this.
      effectiveTarget = Math.max(effectiveTarget, finalMinNodeDistance);

      // Detect cross-group edges
      const srcGroups = nodeGroupsMap.get(edge.sourceId);
      const dstGroups = nodeGroupsMap.get(edge.destinationId);
      const isCrossGroup = groups.length > 0
        && srcGroups && srcGroups.size > 0
        && dstGroups && dstGroups.size > 0
        && ![...srcGroups].some(g => dstGroups.has(g));

      // For cross-group edges: enforce minimum target distance and dampen strength
      if (isCrossGroup) {
        const minGroupDist = config.minGroupDistance || 800;
        effectiveTarget = Math.max(effectiveTarget, minGroupDist * 0.7);
      }

      const edgeSpringMult = isCrossGroup ? crossGroupSpringMult : springMult;
      // ── Fix 3a: Weaker cross-group springs (30% instead of 60%) ────────
      const springStrength = isCrossGroup
        ? attractionStrength * edgeSpringMult * alpha * 0.3
        : attractionStrength * springMult * alpha;

      // ── Fix 2 (cont.): Skip attraction when already shorter than min ───
      // Only repel (push apart) when edge is too short; never compress.
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const currentDist = Math.sqrt(dx * dx + dy * dy);

      let spring;
      if (currentDist < effectiveTarget) {
        // Edge is too short — only push apart (repulsive spring)
        spring = calculateSpring(p1, p2, effectiveTarget, springStrength);
      } else {
        // Edge is at or beyond target — normal spring
        spring = calculateSpring(p1, p2, effectiveTarget, springStrength);
      }

      const f1 = forces.get(edge.sourceId);
      const f2 = forces.get(edge.destinationId);
      if (f1 && f2) {
        f1.fx += spring.fx;
        f1.fy += spring.fy;
        f2.fx -= spring.fx;
        f2.fy -= spring.fy;
      }
    });

    // ------------------------------------------------------------------------
    // Group-Aware Forces (if groups are defined)
    // ------------------------------------------------------------------------
    if (groups.length > 0) {
      // Calculate group centroids
      const groupCentroids = new Map();
      groups.forEach(group => {
        let sumX = 0, sumY = 0, count = 0;
        (group.memberInstanceIds || []).forEach(nodeId => {
          const pos = positions.get(nodeId);
          if (pos) {
            sumX += pos.x;
            sumY += pos.y;
            count++;
          }
        });
        if (count > 0) {
          groupCentroids.set(group.id, { x: sumX / count, y: sumY / count });
        }
      });

      // Intra-group attraction: Pull nodes toward their group centroid(s)
      // Only apply when 2+ groups exist — with 1 group, attraction just acts as extra
      // centering that compresses the layout. Its purpose is to counterbalance inter-group
      // repulsion, which is absent with a single group.
      const groupAttractionStrength = config.groupAttractionStrength || 0.1;
      if (groups.length > 1) {
        nodes.forEach(node => {
          const groupIds = nodeGroupsMap.get(node.id);
          if (!groupIds || groupIds.size === 0) return;

          const pos = positions.get(node.id);
          const force = forces.get(node.id);
          if (!pos || !force) return;

          // Pull toward EVERY group this node belongs to
          groupIds.forEach(groupId => {
            const centroid = groupCentroids.get(groupId);
            if (!centroid) return;

            const dx = centroid.x - pos.x;
            const dy = centroid.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.1) return;

            const strength = groupAttractionStrength * alpha;
            // Scale attraction by number of groups to avoid explosive forces
            const scaledStrength = strength / groupIds.size;
            // Use floor of 50px equivalent so nodes near centroid still feel a pull
            const pullDist = Math.max(dist, 50);
            force.fx += (dx / dist) * scaledStrength * pullDist;
            force.fy += (dy / dist) * scaledStrength * pullDist;
          });
        });
      }

      // ------------------------------------------------------------------------
      // Group Exclusion Force: Push non-members OUT of group bounding boxes
      // ------------------------------------------------------------------------
      const groupExclusionStrength = config.groupExclusionStrength || 0.8;
      const groupBoundaryPadding = config.groupBoundaryPadding || 60;

      // First, compute bounding boxes for each group
      const groupBounds = new Map();
      groups.forEach(group => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        (group.memberInstanceIds || []).forEach(nodeId => {
          const pos = positions.get(nodeId);
          const node = nodeById.get(nodeId);
          if (pos && node) {
            const w = node.width || 100;
            const h = node.height || 60;
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + w);
            maxY = Math.max(maxY, pos.y + h);
          }
        });
        if (minX !== Infinity) {
          // Add padding to create the group region
          groupBounds.set(group.id, {
            minX: minX - groupBoundaryPadding,
            minY: minY - groupBoundaryPadding,
            maxX: maxX + groupBoundaryPadding,
            maxY: maxY + groupBoundaryPadding,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
          });
        }
      });

      // For each node, check if it's inside or near any group it doesn't belong to
      nodes.forEach(node => {
        const pos = positions.get(node.id);
        const force = forces.get(node.id);
        if (!pos || !force) return;

        const nodeGroups = nodeGroupsMap.get(node.id) || new Set();
        const nodeW = node.width || 100;
        const nodeH = node.height || 60;
        const nodeCenterX = pos.x + nodeW / 2;
        const nodeCenterY = pos.y + nodeH / 2;

        groups.forEach(group => {
          // Skip if node belongs to this group
          if (nodeGroups.has(group.id)) return;

          const bounds = groupBounds.get(group.id);
          if (!bounds) return;

          // Expanded check: gradient buffer zone OUTSIDE the bounds
          const bufferZone = groupBoundaryPadding * 0.5;
          const expandedMinX = bounds.minX - bufferZone;
          const expandedMinY = bounds.minY - bufferZone;
          const expandedMaxX = bounds.maxX + bufferZone;
          const expandedMaxY = bounds.maxY + bufferZone;

          if (nodeCenterX >= expandedMinX && nodeCenterX <= expandedMaxX &&
            nodeCenterY >= expandedMinY && nodeCenterY <= expandedMaxY) {

            // Push radially away from group center
            const dx = nodeCenterX - bounds.centerX;
            const dy = nodeCenterY - bounds.centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Gradient strength: stronger push when deeper inside
            const halfW = (bounds.maxX - bounds.minX) / 2;
            const halfH = (bounds.maxY - bounds.minY) / 2;
            const maxExtent = Math.max(halfW, halfH, 1);
            const depthRatio = Math.max(0, 1 - dist / maxExtent); // 1=center, 0=edge
            const pushStrength = groupExclusionStrength * alpha * (80 + depthRatio * 200);

            if (dist > 0.1) {
              force.fx += (dx / dist) * pushStrength;
              force.fy += (dy / dist) * pushStrength;
            } else {
              // Node at group center — push in random direction
              const angle = Math.random() * Math.PI * 2;
              force.fx += Math.cos(angle) * pushStrength;
              force.fy += Math.sin(angle) * pushStrength;
            }
          }
        });
      });

      // Inter-group repulsion: Push different groups apart
      const groupRepulsionStrength = config.groupRepulsionStrength || 0.5;
      const minGroupDistance = config.minGroupDistance || 400;

      // ENHANCED: Node-level repulsion between nodes with no shared groups
      // This helps separate groups even when centroids are close or aligned
      const crossGroupNodeRepulsion = groupRepulsionStrength * 2;

      // Only run this expensive check occasionally or if graph is small
      if (nodeCount < 100 || iter % 3 === 0) {
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const n1Id = nodes[i].id;
            const n2Id = nodes[j].id;

            const n1Groups = nodeGroupsMap.get(n1Id);
            const n2Groups = nodeGroupsMap.get(n2Id);

            // Skip if either node is not in any group
            if (!n1Groups || n1Groups.size === 0 || !n2Groups || n2Groups.size === 0) continue;

            // Skip if nodes share ANY group
            let sharesGroup = false;
            for (const gid of n1Groups) {
              if (n2Groups.has(gid)) { sharesGroup = true; break; }
            }
            if (sharesGroup) continue;

            // Both nodes are in groups but share NO groups - strong repulsion
            const p1 = positions.get(n1Id);
            const p2 = positions.get(n2Id);
            if (!p1 || !p2) continue;

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Wider activation range with distance falloff beyond minGroupDistance
            const activationRange = minGroupDistance * 1.5;
            if (dist < activationRange) {
              const overlap = Math.max(0, minGroupDistance - dist);
              const falloff = dist < minGroupDistance ? 1.0 : Math.max(0, 1 - (dist - minGroupDistance) / (minGroupDistance * 0.5));
              // Strong push when overlapping + base push with falloff when nearby
              const pushStrength = (overlap * crossGroupNodeRepulsion * alpha) +
                (crossGroupNodeRepulsion * alpha * 20 * falloff);
              const ux = dx / Math.max(dist, 1);
              const uy = dy / Math.max(dist, 1);

              const f1 = forces.get(n1Id);
              const f2 = forces.get(n2Id);
              if (f1) { f1.fx -= ux * pushStrength; f1.fy -= uy * pushStrength; }
              if (f2) { f2.fx += ux * pushStrength; f2.fy += uy * pushStrength; }
            }
          }
        }
      }

      const groupIds = [...groupCentroids.keys()];

      for (let i = 0; i < groupIds.length; i++) {
        for (let j = i + 1; j < groupIds.length; j++) {
          const c1 = groupCentroids.get(groupIds[i]);
          const c2 = groupCentroids.get(groupIds[j]);
          if (!c1 || !c2) continue;

          const dx = c2.x - c1.x;
          const dy = c2.y - c1.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < minGroupDistance) {
            // Push groups apart
            const pushStrength = (minGroupDistance - dist) * groupRepulsionStrength * alpha;
            const ux = dx / Math.max(dist, 0.1);
            const uy = dy / Math.max(dist, 0.1);

            // Distribute force to all members of each group
            const group1 = groups.find(g => g.id === groupIds[i]);
            const group2 = groups.find(g => g.id === groupIds[j]);

            if (group1 && group1.memberInstanceIds) {
              const memberCount1 = group1.memberInstanceIds.length;
              group1.memberInstanceIds.forEach(nodeId => {
                const force = forces.get(nodeId);
                if (force) {
                  force.fx -= (ux * pushStrength) / memberCount1;
                  force.fy -= (uy * pushStrength) / memberCount1;
                }
              });
            }

            if (group2 && group2.memberInstanceIds) {
              const memberCount2 = group2.memberInstanceIds.length;
              group2.memberInstanceIds.forEach(nodeId => {
                const force = forces.get(nodeId);
                if (force) {
                  force.fx += (ux * pushStrength) / memberCount2;
                  force.fy += (uy * pushStrength) / memberCount2;
                }
              });
            }
          }
        }
      }
    }

    // Centering force
    const centerStrength = isSparse ? config.centerStrength * 1.5 : config.centerStrength;
    nodes.forEach(node => {
      const pos = positions.get(node.id);
      const force = forces.get(node.id);
      if (!pos || !force) return;

      const center = calculateCentering(pos, centerX, centerY,
        centerStrength * centerMult * alpha);
      force.fx += center.fx;
      force.fy += center.fy;
    });

    // Apply forces
    nodes.forEach(node => {
      const pos = positions.get(node.id);
      const vel = velocities.get(node.id);
      const force = forces.get(node.id);
      if (!pos || !vel || !force) return;

      // Update velocity with damping
      vel.x = (vel.x + force.fx) * config.damping;
      vel.y = (vel.y + force.fy) * config.damping;

      // Velocity limit
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      const maxSpeed = 50 * alpha;
      if (speed > maxSpeed && speed > 0) {
        vel.x = (vel.x / speed) * maxSpeed;
        vel.y = (vel.y / speed) * maxSpeed;
      }

      // Update position
      pos.x += vel.x;
      pos.y += vel.y;

      // Keep within bounds
      pos.x = clamp(pos.x, config.padding, config.width - config.padding);
      pos.y = clamp(pos.y, config.padding, config.height - config.padding);
    });

    // Cool down
    alpha = Math.max(config.alphaMin, alpha * (1 - config.alphaDecay));

    // ------------------------------------------------------------------------
    // In-Loop Constraint Enforcement (Stiffness)
    // ------------------------------------------------------------------------
    // Applying constraints *during* the simulation loop creates "rigid body" 
    // behavior, making the graph much stiffer and encouraging emergent geometry.

    if (config.stiffness > 0) {
      // 1. Rigid Edge Constraints (Springs are not enough for stiffness)
      enforceEdgeConstraints(
        positions, edges, nodeById, getNodeRadius,
        finalTargetLinkDistance, 1, config.stiffness * alpha
      );

      // 2. Collision Resolution (Prevent overlaps actively)
      // We run this less frequently to save perf, or every frame for high quality
      if (iter % 2 === 0) {
        resolveOverlaps(
          positions, nodes, getNodeRadius, config.padding,
          config.width, config.height, 1
        );
      }
    }
  }

  // Multi-stage constraint enforcement for rigidity (Final Polish)
  // Stage 1: Enforce edge constraints (connected nodes stay at target distance)
  // Pass group info so cross-group edges use weaker correction
  enforceEdgeConstraints(positions, edges, nodeById, getNodeRadius,
    finalTargetLinkDistance, 5, 0.8, nodeGroupsMap, config.minGroupDistance || 800);

  // Stage 2: Resolve all overlaps
  resolveOverlaps(positions, nodes, getNodeRadius, config.padding,
    config.width, config.height, 10);

  // Stage 3: Re-enforce edge constraints (maintain connectivity after overlap resolution)
  enforceEdgeConstraints(positions, edges, nodeById, getNodeRadius,
    finalTargetLinkDistance, 3, 0.8, nodeGroupsMap, config.minGroupDistance || 800);

  // Stage 4: Final gentle overlap check
  resolveOverlaps(positions, nodes, getNodeRadius, config.padding,
    config.width, config.height, 3);

  // Stage 5: Enforce cross-group minimum separation (hard constraint)
  if (groups.length > 0) {
    enforceGroupSeparation(positions, nodes, nodeGroupsMap, getNodeRadius,
      config.minGroupDistance || 800, finalMinNodeDistance, config.padding,
      config.width, config.height, 10);
  }

  condenseClusters(positions, clusters, centerX, centerY, config, nodeGroupsMap);

  // ── Fix 5: Edge crossing reduction ──────────────────────────────────
  reduceEdgeCrossings(positions, edges, nodes, nodeById, 3);

  // Final group separation enforcement (after condensation and edge crossing
  // adjustments may have moved nodes closer again)
  if (groups.length > 0) {
    enforceGroupSeparation(positions, nodes, nodeGroupsMap, getNodeRadius,
      config.minGroupDistance || 800, finalMinNodeDistance, config.padding,
      config.width, config.height, 5);
  }

  return positions;
}

/**
 * Enforce edge length constraints
 * Connected nodes try to maintain target distance (rigid body behavior)
 * When nodeGroupsMap is provided, cross-group edges use weaker correction
 * and a larger minimum target to prevent undoing group separation.
 */
function enforceEdgeConstraints(positions, edges, nodeById, getRadius, targetDistance, passes, stiffness = 0.5, nodeGroupsMap = null, minGroupDistance = 0) {
  for (let pass = 0; pass < passes; pass++) {
    edges.forEach(edge => {
      const p1 = positions.get(edge.sourceId);
      const p2 = positions.get(edge.destinationId);
      if (!p1 || !p2) return;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 0.1) return; // Skip degenerate edges

      const n1 = nodeById.get(edge.sourceId);
      const n2 = nodeById.get(edge.destinationId);
      const r1 = getRadius(n1);
      const r2 = getRadius(n2);

      // Detect cross-group edges
      let isCrossGroup = false;
      if (nodeGroupsMap) {
        const srcG = nodeGroupsMap.get(edge.sourceId);
        const dstG = nodeGroupsMap.get(edge.destinationId);
        if (srcG && srcG.size > 0 && dstG && dstG.size > 0) {
          isCrossGroup = ![...srcG].some(g => dstG.has(g));
        }
      }

      // Dynamic Target Calculation
      // We want nodes to sit at 'targetDistance' generally, 
      // but MUST NOT overlap (radius + radius).
      const minSeparation = (r1 + r2) * 1.1; // 10% gap
      let effectiveTarget = Math.max(targetDistance, minSeparation);

      // Cross-group edges: larger target + weaker correction
      if (isCrossGroup && minGroupDistance > 0) {
        effectiveTarget = Math.max(effectiveTarget, minGroupDistance * 0.7);
      }

      // Calculate scalar correction
      // If stiffness is 1.0, we move exactly to target.
      // If stiffness is low, we gently nudge.
      const diff = dist - effectiveTarget;
      // Cross-group edges get much weaker correction to preserve group separation
      const effectiveStiffness = isCrossGroup ? stiffness * 0.3 : stiffness;
      const correction = diff * effectiveStiffness * 0.5; // 0.5 because we move both nodes

      const ux = dx / dist;
      const uy = dy / dist;

      // Apply correction
      p1.x += ux * correction;
      p1.y += uy * correction;
      p2.x -= ux * correction;
      p2.y -= uy * correction;
    });
  }
}

/**
 * Enforce minimum distance between nodes in different groups.
 * Acts as a hard position constraint after all force-based processing.
 */
function enforceGroupSeparation(positions, nodes, nodeGroupsMap, getRadius, minGroupDistance, minNodeDistance, padding, width, height, passes) {
  // Use the full minGroupDistance as the hard separation
  const separationThreshold = Math.max(minNodeDistance * 1.5, minGroupDistance * 0.8);

  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];

        const g1 = nodeGroupsMap.get(n1.id);
        const g2 = nodeGroupsMap.get(n2.id);

        // Only enforce between nodes in different, non-overlapping groups
        if (!g1 || g1.size === 0 || !g2 || g2.size === 0) continue;
        let sharesGroup = false;
        for (const gid of g1) {
          if (g2.has(gid)) { sharesGroup = true; break; }
        }
        if (sharesGroup) continue;

        const p1 = positions.get(n1.id);
        const p2 = positions.get(n2.id);
        if (!p1 || !p2) continue;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < separationThreshold && dist > 0.1) {
          const overlap = (separationThreshold - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;

          p1.x -= ux * overlap;
          p1.y -= uy * overlap;
          p2.x += ux * overlap;
          p2.y += uy * overlap;

          // Keep in bounds
          p1.x = clamp(p1.x, padding, width - padding);
          p1.y = clamp(p1.y, padding, height - padding);
          p2.x = clamp(p2.x, padding, width - padding);
          p2.y = clamp(p2.y, padding, height - padding);
        }
      }
    }
  }
}

/**
 * Resolve any remaining overlaps after main simulation
 */
function resolveOverlaps(positions, nodes, getRadius, padding, width, height, passes) {
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        const p1 = positions.get(n1.id);
        const p2 = positions.get(n2.id);
        if (!p1 || !p2) continue;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.1) {
          // Nodes are stacked - separate them
          const angle = Math.random() * 2 * Math.PI;
          p1.x -= Math.cos(angle) * 5;
          p1.y -= Math.sin(angle) * 5;
          p2.x += Math.cos(angle) * 5;
          p2.y += Math.sin(angle) * 5;
          continue;
        }

        const r1 = getRadius(n1);
        const r2 = getRadius(n2);
        const minDist = (r1 + r2) * 1.4; // Increased from 1.3 for more breathing room

        if (dist < minDist) {
          // More aggressive separation - use full overlap + 10% extra
          const overlap = (minDist - dist) / 2;
          const extraPush = overlap * 0.1; // 10% extra push
          const totalSeparation = overlap + extraPush;

          const ux = dx / dist;
          const uy = dy / dist;

          p1.x -= ux * totalSeparation;
          p1.y -= uy * totalSeparation;
          p2.x += ux * totalSeparation;
          p2.y += uy * totalSeparation;

          // Keep in bounds
          p1.x = clamp(p1.x, padding, width - padding);
          p1.y = clamp(p1.y, padding, height - padding);
          p2.x = clamp(p2.x, padding, width - padding);
          p2.y = clamp(p2.y, padding, height - padding);
        }
      }
    }
  }
}

/**
 * Pull clusters closer to center after layout so we undo overly distant placement.
 * When user-defined groups exist, skip clusters that span multiple groups
 * to avoid collapsing separated groups toward center.
 */
function condenseClusters(positions, clusters, centerX, centerY, config, nodeGroupsMap = null) {
  if (clusters.length <= 1) return;

  // Use gentler condensation when user-defined groups exist to preserve group separation
  const shrinkFactor = config._hasUserGroups ? 0.97 : 0.9;
  const minDistanceFromCenter = 90;

  clusters.forEach(cluster => {
    if (!cluster || cluster.length === 0) return;

    // Skip clusters that contain nodes from multiple user-defined groups
    // Condensing these would undo group separation
    if (nodeGroupsMap && config._hasUserGroups) {
      const groupsInCluster = new Set();
      cluster.forEach(node => {
        const gs = nodeGroupsMap.get(node.id);
        if (gs) gs.forEach(g => groupsInCluster.add(g));
      });
      if (groupsInCluster.size > 1) return;
    }

    let sumX = 0;
    let sumY = 0;
    let count = 0;
    cluster.forEach(node => {
      const pos = positions.get(node.id);
      if (pos) {
        sumX += pos.x;
        sumY += pos.y;
        count += 1;
      }
    });

    if (count === 0) return;

    const centroidX = sumX / count;
    const centroidY = sumY / count;
    const dx = centroidX - centerX;
    const dy = centroidY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= minDistanceFromCenter) return;

    const maxShrink = Math.min(dist - minDistanceFromCenter, dist * shrinkFactor);
    if (maxShrink <= 0) return;

    const shiftDistance = maxShrink;
    const ux = dx / dist;
    const uy = dy / dist;

    const shiftX = ux * shiftDistance;
    const shiftY = uy * shiftDistance;

    cluster.forEach(node => {
      const pos = positions.get(node.id);
      if (!pos) return;
      pos.x -= shiftX;
      pos.y -= shiftY;
      pos.x = clamp(pos.x, config.padding, config.width - config.padding);
      pos.y = clamp(pos.y, config.padding, config.height - config.padding);
    });
  });
}

// ============================================================================
// EDGE CROSSING REDUCTION
// ============================================================================

/**
 * Detect if two line segments (a1-a2) and (b1-b2) cross.
 * Returns true if they properly intersect (not just touch at endpoints).
 */
function segmentsCross(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
  const d1x = a2x - a1x, d1y = a2y - a1y;
  const d2x = b2x - b1x, d2y = b2y - b1y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false; // Parallel

  const t = ((b1x - a1x) * d2y - (b1y - a1y) * d2x) / denom;
  const u = ((b1x - a1x) * d1y - (b1y - a1y) * d1x) / denom;

  // Crossing only if both parameters strictly inside (0, 1)
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

/**
 * Post-simulation edge crossing reduction.
 * For each pair of crossing edges, nudge the midpoints of their endpoints
 * apart perpendicular to the crossing point.  This untangles many common
 * crossings without altering the overall graph structure.
 *
 * Limited to `maxPasses` iterations to prevent infinite loops.
 */
function reduceEdgeCrossings(positions, edges, nodes, nodeById, maxPasses = 3) {
  if (edges.length < 2) return;

  for (let pass = 0; pass < maxPasses; pass++) {
    let crossingsFixed = 0;

    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const e1 = edges[i];
        const e2 = edges[j];

        // Skip if edges share an endpoint (they always "cross" at the shared node)
        if (e1.sourceId === e2.sourceId || e1.sourceId === e2.destinationId ||
          e1.destinationId === e2.sourceId || e1.destinationId === e2.destinationId) {
          continue;
        }

        const p1a = positions.get(e1.sourceId);
        const p1b = positions.get(e1.destinationId);
        const p2a = positions.get(e2.sourceId);
        const p2b = positions.get(e2.destinationId);
        if (!p1a || !p1b || !p2a || !p2b) continue;

        if (segmentsCross(p1a.x, p1a.y, p1b.x, p1b.y, p2a.x, p2a.y, p2b.x, p2b.y)) {
          // Compute crossing point (approximate midpoints of segments)
          const mid1x = (p1a.x + p1b.x) / 2;
          const mid1y = (p1a.y + p1b.y) / 2;
          const mid2x = (p2a.x + p2b.x) / 2;
          const mid2y = (p2a.y + p2b.y) / 2;

          // Direction between midpoints
          const dx = mid2x - mid1x;
          const dy = mid2y - mid1y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.1) continue;

          // Perpendicular nudge: push edge midpoints apart
          // Use perpendicular to the crossing direction for cleaner separation
          const perpX = -dy / dist;
          const perpY = dx / dist;

          // Gentle nudge (20px per pass) — enough to untangle without disrupting layout
          const nudge = 20;

          // Move endpoints of edge 1 in +perp direction
          p1a.x += perpX * nudge * 0.5;
          p1a.y += perpY * nudge * 0.5;
          p1b.x += perpX * nudge * 0.5;
          p1b.y += perpY * nudge * 0.5;

          // Move endpoints of edge 2 in -perp direction
          p2a.x -= perpX * nudge * 0.5;
          p2a.y -= perpY * nudge * 0.5;
          p2b.x -= perpX * nudge * 0.5;
          p2b.y -= perpY * nudge * 0.5;

          crossingsFixed++;
        }
      }
    }

    // Stop early if no crossings remain
    if (crossingsFixed === 0) break;
  }
}

// ============================================================================
// OTHER LAYOUT ALGORITHMS
// ============================================================================

/**
 * Hierarchical tree layout (for tree-structured graphs)
 */
export function hierarchicalLayout(nodes, edges, options = {}) {
  const {
    width = 2000,
    height = 1500,
    levelSpacing = 200,
    nodeSpacing = 150,
    padding = 200,
    direction = 'vertical'
  } = options;

  const positions = new Map();

  // Find root nodes
  const hasIncoming = new Set();
  edges.forEach(edge => hasIncoming.add(edge.destinationId));
  const roots = nodes.filter(node => !hasIncoming.has(node.id));

  if (roots.length === 0) {
    return forceDirectedLayout(nodes, edges, { width, height });
  }

  // Build children map
  const children = new Map();
  nodes.forEach(node => children.set(node.id, []));
  edges.forEach(edge => {
    if (children.has(edge.sourceId)) {
      children.get(edge.sourceId).push(edge.destinationId);
    }
  });

  // BFS to assign levels
  const levels = [];
  const visited = new Set();
  const queue = roots.map(root => ({ id: root.id, level: 0 }));

  while (queue.length > 0) {
    const { id, level } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);

    if (!levels[level]) levels[level] = [];
    levels[level].push(id);

    (children.get(id) || []).forEach(childId => {
      if (!visited.has(childId)) {
        queue.push({ id: childId, level: level + 1 });
      }
    });
  }

  // Position nodes
  const effectiveWidth = width - 2 * padding;
  const effectiveHeight = height - 2 * padding;

  levels.forEach((levelNodes, levelIdx) => {
    const count = levelNodes.length;
    const spacing = direction === 'vertical'
      ? effectiveWidth / (count + 1)
      : effectiveHeight / (count + 1);

    levelNodes.forEach((nodeId, idx) => {
      if (direction === 'vertical') {
        positions.set(nodeId, {
          x: padding + spacing * (idx + 1),
          y: padding + (levelIdx / Math.max(1, levels.length - 1)) * effectiveHeight
        });
      } else {
        positions.set(nodeId, {
          x: padding + (levelIdx / Math.max(1, levels.length - 1)) * effectiveWidth,
          y: padding + spacing * (idx + 1)
        });
      }
    });
  });

  return positions;
}

/**
 * Radial layout (concentric circles around center node)
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

  // Find most connected node
  const connectivity = new Map();
  nodes.forEach(node => connectivity.set(node.id, 0));
  edges.forEach(edge => {
    connectivity.set(edge.sourceId, (connectivity.get(edge.sourceId) || 0) + 1);
    connectivity.set(edge.destinationId, (connectivity.get(edge.destinationId) || 0) + 1);
  });

  const centerNode = nodes.reduce((max, node) =>
    connectivity.get(node.id) > connectivity.get(max.id) ? node : max
  );

  positions.set(centerNode.id, { x: centerX, y: centerY });

  // Build adjacency
  const adjacency = new Map();
  nodes.forEach(node => adjacency.set(node.id, []));
  edges.forEach(edge => {
    adjacency.get(edge.sourceId).push(edge.destinationId);
    adjacency.get(edge.destinationId).push(edge.sourceId);
  });

  // BFS for distances
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

  // Group by distance
  const orbits = [];
  distances.forEach((dist, nodeId) => {
    if (dist === 0) return;
    if (!orbits[dist - 1]) orbits[dist - 1] = [];
    orbits[dist - 1].push(nodeId);
  });

  // Position in orbits
  orbits.forEach((orbitNodes, orbitIdx) => {
    const radius = startRadius + orbitIdx * radiusStep;
    const angleStep = (2 * Math.PI) / orbitNodes.length;

    orbitNodes.forEach((nodeId, idx) => {
      const angle = idx * angleStep;
      positions.set(nodeId, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      });
    });
  });

  // Handle disconnected nodes
  nodes.forEach(node => {
    if (!positions.has(node.id)) {
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
 * Grid layout (regular rows and columns)
 */
export function gridLayout(nodes, edges, options = {}) {
  const {
    width = 2000,
    height = 1500,
    padding = 200,
    cellSpacing = 200
  } = options;

  const positions = new Map();
  const effectiveWidth = width - 2 * padding;
  const effectiveHeight = height - 2 * padding;
  const cols = Math.ceil(Math.sqrt(nodes.length * (effectiveWidth / effectiveHeight)));
  const rows = Math.ceil(nodes.length / cols);

  const cellWidth = effectiveWidth / cols;
  const cellHeight = effectiveHeight / rows;

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
 * Circular layout (nodes on circle perimeter)
 */
// ============================================================================
// VENN / EULER LAYOUT ALGORITHMS
// ============================================================================

/**
 * Euler-Diagram Style (Region-First) Layout
 * Positions groups based on their membership overlaps first.
 */
export function eulerLayout(nodes, edges, options = {}) {
  const { width, height, padding = 100, groups = [] } = options;
  const positions = new Map();

  if (groups.length === 0) {
    return forceDirectedLayout(nodes, edges, options);
  }

  // 1. Analyze group overlaps
  const nodeGroupsMap = new Map();
  groups.forEach(group => {
    (group.memberInstanceIds || []).forEach(nodeId => {
      if (!nodeGroupsMap.has(nodeId)) nodeGroupsMap.set(nodeId, new Set());
      nodeGroupsMap.get(nodeId).add(group.id);
    });
  });

  // 2. Position group centroids using a "meta-layout"
  // Treat groups as nodes, and draw edges between groups that share members
  const metaNodes = groups.map(g => ({ id: g.id, width: 400, height: 400 }));
  const metaEdges = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const g1 = groups[i];
      const g2 = groups[j];
      const shared = (g1.memberInstanceIds || []).filter(id =>
        (g2.memberInstanceIds || []).includes(id)
      );
      if (shared.length > 0) {
        metaEdges.push({ sourceId: g1.id, destinationId: g2.id });
      }
    }
  }

  // Position group regions in a circle or force-layout
  const metaPositions = circularLayout(metaNodes, metaEdges, {
    width, height, radius: Math.min(width, height) * 0.3
  });

  // 3. Position nodes based on their group memberships
  nodes.forEach(node => {
    const groupIds = nodeGroupsMap.get(node.id);
    if (!groupIds || groupIds.size === 0) {
      // Place non-grouped nodes outside or in center
      positions.set(node.id, {
        x: width / 2 + (Math.random() - 0.5) * 200,
        y: height / 2 + (Math.random() - 0.5) * 200
      });
      return;
    }

    // Centroid of all groups this node belongs to
    let sumX = 0, sumY = 0, count = 0;
    groupIds.forEach(gid => {
      const pos = metaPositions.get(gid);
      if (pos) {
        sumX += pos.x;
        sumY += pos.y;
        count++;
      }
    });

    if (count > 0) {
      // Add a jitter to prevent total overlap
      positions.set(node.id, {
        x: sumX / count + (Math.random() - 0.5) * 100,
        y: sumY / count + (Math.random() - 0.5) * 100
      });
    } else {
      positions.set(node.id, { x: width / 2, y: height / 2 });
    }
  });

  // 4. Run a short force simulation to refine node positions while keeping them in their zones
  return forceDirectedLayout(nodes, edges, {
    ...options,
    useExistingPositions: true,
    iterations: 50, // Fewer iterations for refinement
    groupAttractionStrength: 0.3, // Stronger group pull
    groupExclusionStrength: 1.2,  // Strong exclusion to keep nodes in their zones
    centerStrength: 0.01 // Less center pull
  });
}

/**
 * Hybrid Layout (Algorithm C)
 * Combines Euler region placement with full force simulation constraints.
 */
export function hybridLayout(nodes, edges, options = {}) {
  // First pass: Euler-style placement to get initial positions
  const initialPositions = eulerLayout(nodes, edges, {
    ...options,
    iterations: 20 // Very quick pass
  });

  // Second pass: Full force directed layout with those initial positions
  const nodesWithPos = nodes.map(n => {
    const pos = initialPositions.get(n.id);
    return { ...n, x: pos?.x, y: pos?.y };
  });

  return forceDirectedLayout(nodesWithPos, edges, {
    ...options,
    useExistingPositions: true,
    groupAttractionStrength: 0.15,
    groupRepulsionStrength: 0.6,
    groupExclusionStrength: 1.0  // Strong exclusion for hybrid
  });
}

// ============================================================================
// GEOMETRY UTILITIES
// ============================================================================

/**
 * Compute the convex hull of a set of points using Monotone Chain algorithm.
 * Returns an array of points in counter-clockwise order.
 */
export function computeConvexHull(points) {
  if (points.length <= 2) return points;

  // Sort by x, then y
  const sorted = [...points].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);

  const crossProduct = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  // Build lower hull
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Build upper hull
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Get cluster geometry for visualization
 */
export function getClusterGeometries(nodes, edges) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const adjacency = new Map();
  edges.forEach(edge => {
    if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, []);
    if (!adjacency.has(edge.destinationId)) adjacency.set(edge.destinationId, []);
    adjacency.get(edge.sourceId).push(edge.destinationId);
    adjacency.get(edge.destinationId).push(edge.sourceId);
  });

  const clusters = getGraphClusters(nodes, adjacency);

  return clusters.map(cluster => {
    // Collect all corners of node rectangles to ensure hull encompasses them
    const points = [];
    cluster.forEach(node => {
      const w = node.width || 100;
      const h = node.height || 60;
      points.push({ x: node.x, y: node.y });
      points.push({ x: node.x + w, y: node.y });
      points.push({ x: node.x, y: node.y + h });
      points.push({ x: node.x + w, y: node.y + h });
    });

    return {
      nodeIds: cluster.map(n => n.id),
      hull: computeConvexHull(points)
    };
  });
}

export function circularLayout(nodes, edges, options = {}) {
  const {
    width = 2000,
    height = 1500,
    padding = 200
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
    const angle = index * angleStep - Math.PI / 2;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    });
  });

  return positions;
}

// ============================================================================
// LAYOUT WRAPPER
// ============================================================================

/**
 * Apply layout algorithm and return position updates
 */
export function applyLayout(nodes, edges, algorithm = 'force', options = {}) {
  let positions;

  switch (algorithm) {
    case 'euler':
    case 'region-first':
      positions = eulerLayout(nodes, edges, options);
      break;
    case 'hybrid':
      positions = hybridLayout(nodes, edges, options);
      break;
    case 'force':
    case 'force-directed':
    case 'node-driven':
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

  // Convert to update format
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
  eulerLayout,
  hybridLayout,
  hierarchicalLayout,
  radialLayout,
  gridLayout,
  circularLayout,
  applyLayout,
  getClusterGeometries,
  computeConvexHull,
  FORCE_LAYOUT_DEFAULTS,
  LAYOUT_SCALE_PRESETS,
  LAYOUT_ITERATION_PRESETS
};
