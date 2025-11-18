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

// ============================================================================
// CONSTANTS & PRESETS
// ============================================================================

export const FORCE_LAYOUT_DEFAULTS = {
  width: 2000,
  height: 1500,
  iterations: 300,
  
  // Basic forces
  repulsionStrength: 500000,  // Much stronger to push nodes apart
  attractionStrength: 0.2,    // Weaker to allow spreading
  centerStrength: 0.015,      // Gentler centering
  
  // Distance parameters
  targetLinkDistance: 400,    // Much longer target distance
  linkDistance: 400,          // Alias for compatibility
  minNodeDistance: 250,       // More minimum space
  minLinkDistance: 250,       // Alias for compatibility
  maxRepulsionDistance: 1500, // Allow repulsion from further away
  
  // Simulation control
  damping: 0.85,
  velocityDecay: 0.85,  // Alias for damping
  alphaDecay: 0.015,
  alphaMin: 0.001,
  
  // Node sizing
  nodeSpacing: 140,
  labelPadding: 40,
  minNodeRadius: 80,
  collisionRadius: 80,  // Alias for minNodeRadius
  
  // Edge avoidance (not used in new algo but kept for tuner)
  edgeAvoidance: 0,
  edgeAvoidanceRadius: 200,
  
  // Bounds
  padding: 200,

  // Label-aware connection tuning
  labelAwareLinkDistance: true,
  labelAwareLinkPadding: 30,
  labelAwareLinkReduction: 1,
  
  // Presets
  layoutScale: 'balanced',
  layoutScaleMultiplier: 1,
  iterationPreset: 'balanced'
};

export const LAYOUT_SCALE_PRESETS = {
  compact: {
    label: 'Compact',
    targetLinkDistance: 280,
    linkDistance: 280,  // Alias
    minNodeDistance: 180,
    minLinkDistance: 180,  // Alias
    repulsionStrength: 350000
  },
  balanced: {
    label: 'Balanced',
    targetLinkDistance: 400,
    linkDistance: 400,  // Alias
    minNodeDistance: 250,
    minLinkDistance: 250,  // Alias
    repulsionStrength: 500000
  },
  spacious: {
    label: 'Spacious',
    targetLinkDistance: 550,
    linkDistance: 550,  // Alias
    minNodeDistance: 350,
    minLinkDistance: 350,  // Alias
    repulsionStrength: 700000
  }
};

export const LAYOUT_ITERATION_PRESETS = {
  fast: {
    iterations: 200,
    alphaDecay: 0.025
  },
  balanced: {
    iterations: 300,
    alphaDecay: 0.015
  },
  deep: {
    iterations: 450,
    alphaDecay: 0.01
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
// MAIN FORCE-DIRECTED LAYOUT
// ============================================================================

/**
 * Force-directed graph layout
 * Clean implementation with proper cluster separation
 */
export function forceDirectedLayout(nodes, edges, options = {}) {
  if (nodes.length === 0) return new Map();
  
  // Merge options with presets
  const scalePreset = LAYOUT_SCALE_PRESETS[options.layoutScale] || LAYOUT_SCALE_PRESETS.balanced;
  const iterPreset = LAYOUT_ITERATION_PRESETS[options.iterationPreset] || LAYOUT_ITERATION_PRESETS.balanced;
  
  const config = {
    ...FORCE_LAYOUT_DEFAULTS,
    ...scalePreset,
    ...iterPreset,
    ...options
  };
  
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
  
  // Calculate node radii
  const getNodeRadius = (node) => {
    if (!node) return config.minNodeRadius;
    const w = Math.max(node.width || config.nodeSpacing, config.nodeSpacing);
    const h = Math.max(node.height || config.nodeSpacing, config.nodeSpacing);
    const baseRadius = Math.max(w, h) / 2 + config.labelPadding;
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
    const initial = generateInitialPositions(nodes, adjacency, config.width, config.height, initialOptions);
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
      const effectiveTarget = Math.max(preferredTarget, Math.min(blendedTarget, baseTarget));
      
      const spring = calculateSpring(p1, p2, effectiveTarget, 
        attractionStrength * springMult * alpha);
      
      const f1 = forces.get(edge.sourceId);
      const f2 = forces.get(edge.destinationId);
      if (f1 && f2) {
        f1.fx += spring.fx;
        f1.fy += spring.fy;
        f2.fx -= spring.fx;
        f2.fy -= spring.fy;
      }
    });
    
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
  }
  
  // Multi-stage constraint enforcement for rigidity
  // Stage 1: Enforce edge constraints (connected nodes stay at target distance)
  enforceEdgeConstraints(positions, edges, nodeById, getNodeRadius, 
    finalTargetLinkDistance, 5);
  
  // Stage 2: Resolve all overlaps
  resolveOverlaps(positions, nodes, getNodeRadius, config.padding, 
    config.width, config.height, 10);
  
  // Stage 3: Re-enforce edge constraints (maintain connectivity after overlap resolution)
  enforceEdgeConstraints(positions, edges, nodeById, getNodeRadius, 
    finalTargetLinkDistance, 3);
  
  // Stage 4: Final gentle overlap check
  resolveOverlaps(positions, nodes, getNodeRadius, config.padding, 
    config.width, config.height, 3);
  
  condenseClusters(positions, clusters, centerX, centerY, config);

  return positions;
}

/**
 * Enforce edge length constraints
 * Connected nodes try to maintain target distance (rigid body behavior)
 */
function enforceEdgeConstraints(positions, edges, nodeById, getRadius, targetDistance, passes) {
  for (let pass = 0; pass < passes; pass++) {
    edges.forEach(edge => {
      const p1 = positions.get(edge.sourceId);
      const p2 = positions.get(edge.destinationId);
      if (!p1 || !p2) return;
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 1) return; // Skip degenerate edges
      
      const n1 = nodeById.get(edge.sourceId);
      const n2 = nodeById.get(edge.destinationId);
      const r1 = getRadius(n1);
      const r2 = getRadius(n2);
      
      // Constraint: maintain distance between min and target
      const minAllowed = (r1 + r2) * 1.3;
      const maxAllowed = targetDistance * 1.2;
      
      let correction = 0;
      if (dist < minAllowed) {
        // Too close - push apart
        correction = (minAllowed - dist) / 2;
      } else if (dist > maxAllowed) {
        // Too far - pull together
        correction = (maxAllowed - dist) / 2;
      } else {
        // Within acceptable range - still nudge toward target
        correction = (targetDistance - dist) * 0.1;
      }
      
      const ux = dx / dist;
      const uy = dy / dist;
      
      // Apply constraint symmetrically (both nodes move)
      p1.x -= ux * correction;
      p1.y -= uy * correction;
      p2.x += ux * correction;
      p2.y += uy * correction;
    });
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
 */
function condenseClusters(positions, clusters, centerX, centerY, config) {
  if (clusters.length <= 1) return;

  const shrinkFactor = 0.9;
  const minDistanceFromCenter = 90;

  clusters.forEach(cluster => {
    if (!cluster || cluster.length === 0) return;

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
  hierarchicalLayout,
  radialLayout,
  gridLayout,
  circularLayout,
  applyLayout,
  FORCE_LAYOUT_DEFAULTS,
  LAYOUT_SCALE_PRESETS,
  LAYOUT_ITERATION_PRESETS
};
