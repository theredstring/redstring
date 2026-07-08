/**
 * Graph Layout Service - Redesigned 2025
 *
 * Clean, robust force-directed layout with proper cluster separation.
 * Focuses on predictability, spaciousness, and preventing node overlap.
 */

import { GROUP_LAYOUT_CONSTANTS } from './groupLayout.js';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const MAX_LAYOUT_SCALE_MULTIPLIER = 1.6;

/**
 * Build the implicit group containment hierarchy from member-set subset
 * relationships. B is a strict child of A iff B.memberInstanceIds ⊊
 * A.memberInstanceIds. We pick each group's *direct* parent as the smallest
 * strict ancestor (transitive reduction). Sibling/peer groups (overlapping
 * but neither contains the other) get no parent-child relation here — those
 * are handled separately by the existing centroid fallback.
 */
function buildGroupContainmentHierarchy(groups) {
  const groupsById = new Map();
  const memberSets = new Map();
  for (const g of groups) {
    groupsById.set(g.id, g);
    memberSets.set(g.id, new Set(g.memberInstanceIds || []));
  }

  const directParentOf = new Map();
  const childrenOf = new Map();
  groups.forEach(g => childrenOf.set(g.id, []));

  for (const child of groups) {
    const childMembers = memberSets.get(child.id);
    if (childMembers.size === 0) continue;

    let bestParent = null;
    let bestParentSize = Infinity;

    for (const candidate of groups) {
      if (candidate.id === child.id) continue;
      const candMembers = memberSets.get(candidate.id);
      if (candMembers.size <= childMembers.size) continue;
      let isSuperset = true;
      for (const m of childMembers) {
        if (!candMembers.has(m)) { isSuperset = false; break; }
      }
      if (!isSuperset) continue;
      if (candMembers.size < bestParentSize) {
        bestParent = candidate.id;
        bestParentSize = candMembers.size;
      }
    }

    if (bestParent) {
      directParentOf.set(child.id, bestParent);
      childrenOf.get(bestParent).push(child.id);
    }
  }

  // Topological order: leaves first (groups with no children come first).
  const topo = [];
  const remainingChildren = new Map();
  groups.forEach(g => remainingChildren.set(g.id, [...childrenOf.get(g.id)]));
  const queue = groups.filter(g => remainingChildren.get(g.id).length === 0).map(g => g.id);
  while (queue.length > 0) {
    const id = queue.shift();
    topo.push(id);
    const parent = directParentOf.get(id);
    if (parent) {
      const list = remainingChildren.get(parent);
      const idx = list.indexOf(id);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) queue.push(parent);
    }
  }

  const topLevelGroupIds = groups.filter(g => !directParentOf.has(g.id)).map(g => g.id);

  return { groupsById, memberSets, directParentOf, childrenOf, topo, topLevelGroupIds };
}

/**
 * Compute a group's visual bounding box from its laid-out member positions,
 * folding the title bar overhang for node-groups. Mirrors the math in
 * services/groupLayout.js so meta-positioning sees the same rect a renderer
 * would draw.
 */
export function deriveGroupVisualBounds(group, bbox, gridSize, measureLabelWidth) {
  const C = GROUP_LAYOUT_CONSTANTS;
  const memberPad = Math.max(24, Math.round((gridSize ?? 100) * 0.2));
  const margin = memberPad + C.innerCanvasBorder;
  const rectX = bbox.minX - margin;
  const rectY = bbox.minY - margin;
  const rectW = (bbox.maxX - bbox.minX) + margin * 2;
  const rectH = (bbox.maxY - bbox.minY) + margin * 2;
  const labelHeight = Math.max(80, C.fontSize * 1.4 + C.titlePaddingVertical * 2);
  const measured = measureLabelWidth ? measureLabelWidth(group.name || 'Group') : (group.name || 'Group').length * 12;
  const labelWidth = Math.min(1000, Math.max(100, measured + C.titlePaddingHorizontal * 2 + C.strokeWidth * 2));
  const labelX = rectX + (rectW - labelWidth) / 2;
  const labelY = rectY - labelHeight - C.titleToCanvasGap;
  const isNodeGroup = !!group.linkedNodePrototypeId;
  const vTop = isNodeGroup ? labelY - C.titleTopMargin : labelY;
  const vLeft = Math.min(rectX, labelX);
  const vRight = Math.max(rectX + rectW, labelX + labelWidth);
  const vBottom = rectY + rectH;
  return { x: vLeft, y: vTop, w: vRight - vLeft, h: vBottom - vTop };
}

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
 * Estimate the pixel width of an edge label string.
 * Edge labels are rendered bold with a stroke outline, so we use a wider
 * character width factor (0.7) than the normal-weight estimate (0.55).
 * Adds a flat buffer for the stroke outline that extends beyond glyph bounds.
 * fontSize defaults to 54 — the canvas base connectionFontSize. Callers
 * should pass the resolved size (54 × textSettings.fontSize ×
 * connectionLabelSize) so layout reserves the space labels actually occupy.
 */
export function estimateEdgeLabelWidth(text, fontSize = 54) {
  if (!text) return 0;
  // 0.7 accounts for fontWeight="bold" on edge labels
  const avgCharWidth = fontSize * 0.7;
  // stroke outline (strokeWidth = max(2, fontSize*0.25)) adds visual width
  const strokeBuffer = Math.max(2, fontSize * 0.25) * 2;
  return text.length * avgCharWidth + strokeBuffer;
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
  edgeLabelPadding: 60,           // total horizontal padding for edge label minimum (30px per side)
  edgeLabelClearancePadding: 30,  // extra gap between midpoints of different labeled edges
  // Base font used to reserve space for edge labels. MUST track the canvas
  // renderer (NodeCanvas draws labels at 54 × textSettings.fontSize ×
  // connectionLabelSize); callers pass the resolved size via options.
  edgeLabelFontSize: 54,

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
  layoutScaleMultiplier: 1.0,
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

  // Implicit containment hierarchy from member-set subsets.
  const hierarchy = buildGroupContainmentHierarchy(groups);

  // For each node belonging to one or more groups: pick the *innermost* group
  // (the smallest one — equivalent to the deepest in the containment chain).
  // If multiple groups tie at minimum size and aren't in a containment chain,
  // it's a peer-conflict node — handled like a multi-group node.
  const innermostGroupOf = new Map(); // nodeId -> groupId | null (peer-conflict)
  const peerConflictNodes = new Set();
  nodeToGroups.forEach((groupIds, nodeId) => {
    if (groupIds.size === 0) return;
    if (groupIds.size === 1) {
      innermostGroupOf.set(nodeId, [...groupIds][0]);
      return;
    }
    let smallest = null;
    let smallestSize = Infinity;
    for (const gid of groupIds) {
      const sz = hierarchy.memberSets.get(gid)?.size ?? 0;
      if (sz < smallestSize) { smallest = gid; smallestSize = sz; }
    }
    // Verify chosen "smallest" is contained in every other group the node belongs to.
    let isStrictlyInnermost = true;
    for (const gid of groupIds) {
      if (gid === smallest) continue;
      const containerMembers = hierarchy.memberSets.get(gid);
      const innerMembers = hierarchy.memberSets.get(smallest);
      let allIn = true;
      for (const m of innerMembers) {
        if (!containerMembers.has(m)) { allIn = false; break; }
      }
      if (!allIn) { isStrictlyInnermost = false; break; }
    }
    if (isStrictlyInnermost) {
      innermostGroupOf.set(nodeId, smallest);
    } else {
      peerConflictNodes.add(nodeId);
    }
  });

  const ungroupedNodes = nodes.filter(n => !nodeToGroups.has(n.id));

  // ---- Phase 1: Layout each group leaves-first, substituting child groups
  // with synthetic rigid blocks sized by the child's visual bounds. ----
  const groupLayouts = new Map();

  for (const gId of hierarchy.topo) {
    const group = hierarchy.groupsById.get(gId);
    if (!group) continue;
    const childIds = hierarchy.childrenOf.get(gId) || [];

    // Direct members: members of this group whose innermost group IS this group.
    // Excludes members whose innermost is a child (they're inside a rigid block).
    const directMemberIds = (group.memberInstanceIds || []).filter(id => {
      if (peerConflictNodes.has(id)) return false;
      return innermostGroupOf.get(id) === gId;
    });
    const directMemberNodes = directMemberIds.map(id => nodeById.get(id)).filter(Boolean);

    // Synthetic block nodes for each direct child group.
    const blockNodes = [];
    const blockToChildId = new Map();
    for (const cid of childIds) {
      const cl = groupLayouts.get(cid);
      if (!cl) continue;
      const blockId = `__block__${cid}`;
      blockNodes.push({
        id: blockId,
        width: cl.visualBounds.w,
        height: cl.visualBounds.h,
      });
      blockToChildId.set(blockId, cid);
    }

    if (directMemberNodes.length + blockNodes.length === 0) continue;

    // Map each child's actual member ID to its synthetic block ID for edge routing.
    const memberToBlockId = new Map();
    for (const cid of childIds) {
      const cMembers = hierarchy.memberSets.get(cid);
      if (!cMembers) continue;
      cMembers.forEach(m => memberToBlockId.set(m, `__block__${cid}`));
    }

    const directMemberSet = new Set(directMemberIds);
    const intraEdges = [];
    for (const e of edges) {
      const srcEntity = directMemberSet.has(e.sourceId)
        ? e.sourceId
        : memberToBlockId.get(e.sourceId);
      const dstEntity = directMemberSet.has(e.destinationId)
        ? e.destinationId
        : memberToBlockId.get(e.destinationId);
      if (!srcEntity || !dstEntity || srcEntity === dstEntity) continue;
      intraEdges.push({ sourceId: srcEntity, destinationId: dstEntity });
    }

    const totalEntities = directMemberNodes.length + blockNodes.length;
    const subSize = Math.max(800, Math.sqrt(totalEntities) * 500);

    const positions = forceDirectedLayout(
      [...directMemberNodes, ...blockNodes],
      intraEdges,
      {
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
        edgeLabelFontSize: config.edgeLabelFontSize,
      }
    );

    // Compose final positions for every node "owned" by this group's layout.
    const composedPositions = new Map();
    directMemberIds.forEach(mid => {
      const p = positions.get(mid);
      if (p) composedPositions.set(mid, { x: p.x, y: p.y });
    });
    childIds.forEach(cid => {
      const blockPos = positions.get(`__block__${cid}`);
      const cl = groupLayouts.get(cid);
      if (!blockPos || !cl) return;
      const dx = blockPos.x - cl.centerX;
      const dy = blockPos.y - cl.centerY;
      cl.positions.forEach((pos, mid) => {
        composedPositions.set(mid, { x: pos.x + dx, y: pos.y + dy });
      });
    });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    composedPositions.forEach((pos, mid) => {
      const node = nodeById.get(mid);
      const w = node?.width || 150;
      const h = node?.height || 100;
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x + w > maxX) maxX = pos.x + w;
      if (pos.y + h > maxY) maxY = pos.y + h;
    });
    if (!isFinite(minX)) continue;

    const visualBounds = deriveGroupVisualBounds(
      group,
      { minX, minY, maxX, maxY },
      options.gridSize,
      options.measureLabelWidth,
    );

    groupLayouts.set(gId, {
      positions: composedPositions,
      width: maxX - minX,
      height: maxY - minY,
      visualBounds,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    });
  }

  if (groupLayouts.size === 0) {
    // No groups had members - fall back to standard layout
    return forceDirectedLayout(nodes, edges, { ...options, groups: [] });
  }

  // Multi-group nodes that the existing fallback expects: peer-conflict nodes
  // (kept for backwards-compat with the centroid placement at line ~734).
  const multiGroupNodeIds = peerConflictNodes;

  // ---- Phase 2: Group-level force-directed layout (top-level groups only) ----
  // Children of nested groups are already placed inside their parent's
  // composed layout via the rigid-block substitution above; only top-level
  // groups need meta-positioning relative to each other.

  const ungroupedSet = new Set(ungroupedNodes.map(n => n.id));
  const topLevelLayoutEntries = hierarchy.topLevelGroupIds
    .map(gId => [gId, groupLayouts.get(gId)])
    .filter(([, layout]) => layout);

  // Build meta-nodes sized by each top-level group's *visual* bounds (which
  // include the title-bar overhang for node-groups), plus padding. This
  // prevents node-group titles from intruding into a neighbor's region.
  const metaNodes = [];
  topLevelLayoutEntries.forEach(([gId, layout]) => {
    metaNodes.push({
      id: gId,
      width: layout.visualBounds.w + 200,
      height: layout.visualBounds.h + 200,
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

  // Build meta-edges from cross-group node connections.
  // For nested groups we walk each membership up to its top-level ancestor —
  // only top-level groups participate in meta-positioning.
  const topLevelOf = (gid) => {
    let cur = gid;
    while (hierarchy.directParentOf.get(cur)) {
      cur = hierarchy.directParentOf.get(cur);
    }
    return cur;
  };
  const metaEdgePairs = new Map(); // "gA|gB" -> count
  const getNodeMetaGroups = (nodeId) => {
    const gs = nodeToGroups.get(nodeId);
    if (gs && gs.size > 0) {
      const tops = new Set();
      for (const gid of gs) tops.add(topLevelOf(gid));
      return [...tops];
    }
    if (ungroupedSet.has(nodeId)) return ['__ungrouped__'];
    return [];
  };
  edges.forEach(e => {
    const srcGroups = getNodeMetaGroups(e.sourceId);
    const dstGroups = getNodeMetaGroups(e.destinationId);
    srcGroups.forEach(gSrc => {
      dstGroups.forEach(gDst => {
        if (gSrc === gDst) return;
        const key = [gSrc, gDst].sort().join('|');
        metaEdgePairs.set(key, (metaEdgePairs.get(key) || 0) + 1);
      });
    });
  });
  // Peer-conflict nodes (multi-group, no containment chain) → strong affinity
  // between their top-level groups.
  multiGroupNodeIds.forEach(nodeId => {
    const gs = [...(nodeToGroups.get(nodeId) || [])];
    const tops = [...new Set(gs.map(topLevelOf))];
    for (let i = 0; i < tops.length; i++) {
      for (let j = i + 1; j < tops.length; j++) {
        const key = [tops[i], tops[j]].sort().join('|');
        metaEdgePairs.set(key, (metaEdgePairs.get(key) || 0) + 2);
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

  // World-space visual boxes for each top-level group (its composed
  // visualBounds translated to its meta position). Used to place shared
  // nodes in the corridor between groups and keep ungrouped nodes out of
  // every group's rect.
  const worldGroupBoxes = new Map();
  topLevelLayoutEntries.forEach(([gId, layout]) => {
    const metaPos = metaPositions.get(gId);
    if (!metaPos) return;
    const dx = metaPos.x - layout.centerX;
    const dy = metaPos.y - layout.centerY;
    const vb = layout.visualBounds;
    worldGroupBoxes.set(gId, {
      minX: vb.x + dx, minY: vb.y + dy,
      maxX: vb.x + vb.w + dx, maxY: vb.y + vb.h + dy,
      centerX: vb.x + vb.w / 2 + dx, centerY: vb.y + vb.h / 2 + dy
    });
  });

  // Nearest point on a box's boundary to (px, py) — projects inward points
  // out through the closest edge, clamps outward points onto the perimeter.
  const nearestBoundaryPoint = (box, px, py) => {
    const inside = px > box.minX && px < box.maxX && py > box.minY && py < box.maxY;
    if (!inside) {
      return { x: clamp(px, box.minX, box.maxX), y: clamp(py, box.minY, box.maxY) };
    }
    const dLeft = px - box.minX, dRight = box.maxX - px;
    const dUp = py - box.minY, dDown = box.maxY - py;
    const m = Math.min(dLeft, dRight, dUp, dDown);
    if (m === dLeft) return { x: box.minX, y: py };
    if (m === dRight) return { x: box.maxX, y: py };
    if (m === dUp) return { x: px, y: box.minY };
    return { x: px, y: box.maxY };
  };

  // Push a point outside every group box it falls in (plus clearance).
  // A couple of rounds handles being ejected from one box into another.
  const ejectFromGroupBoxes = (px, py, clearance) => {
    for (let round = 0; round < 3; round++) {
      let movedThisRound = false;
      for (const box of worldGroupBoxes.values()) {
        if (px > box.minX - clearance && px < box.maxX + clearance &&
            py > box.minY - clearance && py < box.maxY + clearance) {
          const bp = nearestBoundaryPoint(box, px, py);
          const ux = bp.x - box.centerX;
          const uy = bp.y - box.centerY;
          const uLen = Math.hypot(ux, uy) || 1;
          px = bp.x + (ux / uLen) * clearance;
          py = bp.y + (uy / uLen) * clearance;
          movedThisRound = true;
        }
      }
      if (!movedThisRound) break;
    }
    return { x: px, y: py };
  };

  // Place peer-conflict (multi-group, non-nested) nodes in the corridor
  // between their groups: the average of each group box's boundary point
  // toward the shared midpoint. Placing at the centroid of group *centers*
  // lands the node deep inside the larger group and stretches every
  // containing rect across it.
  multiGroupNodeIds.forEach(nodeId => {
    const node = nodeById.get(nodeId);
    if (!node) return;
    const gs = nodeToGroups.get(nodeId);
    if (!gs) return;
    const tops = new Set();
    gs.forEach(gId => tops.add(topLevelOf(gId)));
    const boxes = [...tops].map(t => worldGroupBoxes.get(t)).filter(Boolean);

    if (boxes.length >= 2) {
      let cX = 0, cY = 0;
      boxes.forEach(b => { cX += b.centerX; cY += b.centerY; });
      cX /= boxes.length; cY /= boxes.length;
      let sumX = 0, sumY = 0;
      boxes.forEach(b => {
        const bp = nearestBoundaryPoint(b, cX, cY);
        sumX += bp.x; sumY += bp.y;
      });
      finalPositions.set(nodeId, {
        x: sumX / boxes.length + (Math.random() - 0.5) * 40,
        y: sumY / boxes.length + (Math.random() - 0.5) * 40
      });
    } else if (boxes.length === 1) {
      finalPositions.set(nodeId, { x: boxes[0].centerX, y: boxes[0].centerY });
    } else {
      finalPositions.set(nodeId, { x: centerX, y: centerY });
    }
  });

  // Place ungrouped nodes near their connected groups — but never seed one
  // inside a group's rect, or Phase 3's springs and exclusion force fight a
  // tug-of-war over it
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
    let anchor;
    if (connCount > 0) {
      anchor = {
        x: sumX / connCount + (Math.random() - 0.5) * 80,
        y: sumY / connCount + (Math.random() - 0.5) * 80
      };
    } else {
      anchor = {
        x: centerX + (Math.random() - 0.5) * 200,
        y: centerY + (Math.random() - 0.5) * 200
      };
    }
    finalPositions.set(node.id, ejectFromGroupBoxes(anchor.x, anchor.y, 120));
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

  // Build adjacency
  const adjacency = new Map();
  nodes.forEach(node => adjacency.set(node.id, []));
  edges.forEach(edge => {
    if (adjacency.has(edge.sourceId) && adjacency.has(edge.destinationId)) {
      adjacency.get(edge.sourceId).push(edge.destinationId);
      adjacency.get(edge.destinationId).push(edge.sourceId);
    }
  });

  // ── Isolated-node extraction ────────────────────────────────────────────
  // Edge-less, ungrouped nodes feel only two forces — center pull inward and
  // repulsion outward — both radially symmetric. At equilibrium every free
  // floater settles at the SAME radius, producing a packed ring around the
  // connected structure. They carry no structural information, so exclude
  // them from the simulation and scatter them into the empty space around
  // the finished layout instead (deterministic sunflower annulus, below).
  const groupedNodeIds = new Set();
  groups.forEach(g => (g.memberInstanceIds || []).forEach(id => groupedNodeIds.add(id)));
  const isolatedNodes = [];
  const simNodes = [];
  nodes.forEach(n => {
    const degree = (adjacency.get(n.id) || []).length;
    if (degree === 0 && !groupedNodeIds.has(n.id)) isolatedNodes.push(n);
    else simNodes.push(n);
  });
  nodes = simNodes;

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

  // Deduplicate edges by node pair (undirected) so parallel edges between the
  // same two nodes don't compound spring forces or constraint corrections.
  // For each pair, keep the edge with the longest label to preserve the
  // tightest spacing requirement.
  const _uniqueEdgePairMap = new Map();
  edges.forEach(edge => {
    const key = edge.sourceId < edge.destinationId
      ? `${edge.sourceId}|${edge.destinationId}`
      : `${edge.destinationId}|${edge.sourceId}`;
    const existing = _uniqueEdgePairMap.get(key);
    if (!existing) {
      _uniqueEdgePairMap.set(key, edge);
    } else {
      const existingW = estimateEdgeLabelWidth(existing.name || '', config.edgeLabelFontSize);
      const newW = estimateEdgeLabelWidth(edge.name || '', config.edgeLabelFontSize);
      if (newW > existingW) _uniqueEdgePairMap.set(key, edge);
    }
  });
  const uniqueEdges = Array.from(_uniqueEdgePairMap.values());

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

  // Precompute nested-group metadata for hierarchy-aware forces.
  // nestedGroupPairs: Set of "smallerId|largerId" for every ancestor-descendant pair.
  // innermostGroupOf: nodeId -> the smallest (deepest) group the node belongs to.
  // Only meaningful when 2+ groups exist; single-group graphs skip all this.
  const nestedGroupPairs = new Set();
  const innermostGroupOf = new Map();
  if (groups.length > 1) {
    const hier = buildGroupContainmentHierarchy(groups);
    for (const [childId] of hier.directParentOf) {
      let cur = childId;
      while (hier.directParentOf.has(cur)) {
        const parentId = hier.directParentOf.get(cur);
        const pairKey = childId < parentId ? `${childId}|${parentId}` : `${parentId}|${childId}`;
        nestedGroupPairs.add(pairKey);
        cur = parentId;
      }
    }
    nodeGroupsMap.forEach((groupIds, nodeId) => {
      let smallest = null, smallestSize = Infinity;
      for (const gid of groupIds) {
        const sz = hier.memberSets.get(gid)?.size ?? 0;
        if (sz < smallestSize) { smallest = gid; smallestSize = sz; }
      }
      if (smallest) innermostGroupOf.set(nodeId, smallest);
    });
  }

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

  // ── Content-derived bounds ──────────────────────────────────────────────
  // The box must be a consequence of the graph, not a constraint on it.
  // With a fixed box (e.g. the offscreen 2000×2000) the per-iteration bounds
  // clamp molds larger layouts against the walls — the layout ends up shaped
  // by the container instead of the graph structure. Grow the box to what
  // the physics actually needs; callers recenter / zoom-to-fit the result.
  const contentSpan = Math.sqrt(totalNodes) * Math.max(finalTargetLinkDistance, finalMinNodeDistance) * 1.6
    + config.padding * 2;
  if (contentSpan > config.width) config.width = contentSpan;
  if (contentSpan > config.height) config.height = contentSpan;

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

    // Incoming positions can exceed the provided box (composed group layouts
    // during Phase-3 refinement, or graphs living far from the box's
    // coordinate frame). Grow the box to fit and center the content in it so
    // the bounds clamp refines the layout instead of crushing it against the
    // walls. Callers recenter the output afterwards.
    let exMinX = Infinity, exMinY = Infinity, exMaxX = -Infinity, exMaxY = -Infinity;
    positions.forEach(pos => {
      if (pos.x < exMinX) exMinX = pos.x;
      if (pos.y < exMinY) exMinY = pos.y;
      if (pos.x > exMaxX) exMaxX = pos.x;
      if (pos.y > exMaxY) exMaxY = pos.y;
    });
    if (Number.isFinite(exMinX)) {
      config.width = Math.max(config.width, (exMaxX - exMinX) + config.padding * 2);
      config.height = Math.max(config.height, (exMaxY - exMinY) + config.padding * 2);
      const shiftX = config.width / 2 - (exMinX + exMaxX) / 2;
      const shiftY = config.height / 2 - (exMinY + exMaxY) / 2;
      if (shiftX !== 0 || shiftY !== 0) {
        positions.forEach(pos => { pos.x += shiftX; pos.y += shiftY; });
      }
    }
  } else {
    const initialOptions = {
      ...config,
      densityFactor,
      layoutScaleMultiplier: manualScaleTarget
    };

    // Use group-aware positioning when groups are present (refinement path with useExistingPositions=false
    // but groups present can happen via euler/hybrid or other callers)
    const initial = groups.length > 0
      ? generateGroupAwareInitialPositions(nodes, adjacency, groups, config.width, config.height, initialOptions)
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

      const edgeRepulsionStrength = repulsionStrength * 0.5;
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

            // Rotational routing: swing the node in an arc around the nearest
            // edge endpoint instead of just pushing it away. This lets nodes
            // orbit around blocking edges to reach their spring targets.
            const pivotX = t < 0.5 ? seg.x1 : seg.x2;
            const pivotY = t < 0.5 ? seg.y1 : seg.y2;
            const toPivotX = nPos.x - pivotX;
            const toPivotY = nPos.y - pivotY;
            const pivotDist = Math.sqrt(toPivotX * toPivotX + toPivotY * toPivotY);
            if (pivotDist > 1) {
              // Perpendicular to the node→pivot vector = rotation direction
              // Choose rotation direction that moves node away from edge midpoint
              const edgeMidX = (seg.x1 + seg.x2) / 2;
              const edgeMidY = (seg.y1 + seg.y2) / 2;
              // Two perpendicular options: (+perpY, -perpX) or (-perpY, +perpX)
              const perpAx = -toPivotY / pivotDist;
              const perpAy = toPivotX / pivotDist;
              // Pick the one that moves away from edge midpoint
              const toMidX = edgeMidX - nPos.x;
              const toMidY = edgeMidY - nPos.y;
              const dotA = perpAx * toMidX + perpAy * toMidY;
              const sign = dotA < 0 ? 1 : -1;
              const rotMag = forceMag * 1.2;
              fNode.fx += sign * perpAx * rotMag;
              fNode.fy += sign * perpAy * rotMag;
            }
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

    // Spring forces (edges — deduplicated so parallel edges don't compound)
    uniqueEdges.forEach(edge => {
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

      // ── Edge label minimum: ensure edges are long enough for their label text ──
      // effectiveTarget is center-to-center; visible gap = effectiveTarget - r1 - r2
      // so we need: edgeLabelWidth + padding + r1 + r2
      let edgeLabelMinDistance = 0;
      if (edge.name) {
        const edgeLabelWidth = estimateEdgeLabelWidth(edge.name, config.edgeLabelFontSize);
        edgeLabelMinDistance = edgeLabelWidth + (config.edgeLabelPadding || 60) + r1 + r2;
        effectiveTarget = Math.max(effectiveTarget, edgeLabelMinDistance);
      }

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

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const currentDist = Math.sqrt(dx * dx + dy * dy);

      let spring;
      // ── Hard enforcement: when edge is shorter than its label, push apart aggressively ──
      if (edgeLabelMinDistance > 0 && currentDist < edgeLabelMinDistance) {
        const deficit = edgeLabelMinDistance - currentDist;
        const ratio = currentDist / edgeLabelMinDistance;
        // Scale boost: the deeper the violation, the harder the push (up to 8x)
        const boost = 3 + (1 - ratio) * 5;
        spring = calculateSpring(p1, p2, effectiveTarget, springStrength * boost);
      } else if (currentDist < effectiveTarget) {
        // Edge is too short but not violating label minimum — normal push apart
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

          // For nested groups, only pull toward the innermost group so a node
          // inside G_inner (which also belongs to G_outer) isn't split between
          // two competing centroids. Peer-conflict nodes fall back to all groups.
          const targetGroupIds = innermostGroupOf.has(node.id)
            ? [innermostGroupOf.get(node.id)]
            : [...groupIds];
          targetGroupIds.forEach(groupId => {
            const centroid = groupCentroids.get(groupId);
            if (!centroid) return;

            const dx = centroid.x - pos.x;
            const dy = centroid.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.1) return;

            const strength = groupAttractionStrength * alpha;
            const scaledStrength = strength / targetGroupIds.length;
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
          // A node shared with a peer (non-nested) group sits in the corridor
          // between the two groups. Folding it into this box would stretch
          // the exclusion region across the corridor and shove the neighbor
          // group's edge members and any corridor-dwelling nodes every tick.
          const memberships = nodeGroupsMap.get(nodeId);
          if (memberships && memberships.size > 1) {
            let sharedWithPeer = false;
            for (const otherGid of memberships) {
              if (otherGid === group.id) continue;
              const pk = otherGid < group.id
                ? `${otherGid}|${group.id}`
                : `${group.id}|${otherGid}`;
              if (!nestedGroupPairs.has(pk)) { sharedWithPeer = true; break; }
            }
            if (sharedWithPeer) return;
          }
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
          // Nested groups (parent contains child) must not repel each other —
          // their centroids are always close by design, so the force fires at
          // max strength every tick and tears the inner group out of its parent.
          if (nestedGroupPairs.size > 0) {
            const pk = groupIds[i] < groupIds[j]
              ? `${groupIds[i]}|${groupIds[j]}`
              : `${groupIds[j]}|${groupIds[i]}`;
            if (nestedGroupPairs.has(pk)) continue;
          }

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
        positions, uniqueEdges, nodeById, getNodeRadius,
        finalTargetLinkDistance, 1, config.stiffness * alpha,
        null, 0, config.edgeLabelFontSize
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
  enforceEdgeConstraints(positions, uniqueEdges, nodeById, getNodeRadius,
    finalTargetLinkDistance, 5, 0.8, nodeGroupsMap, config.minGroupDistance || 800,
    config.edgeLabelFontSize);

  // Stage 2: Resolve all overlaps
  resolveOverlaps(positions, nodes, getNodeRadius, config.padding,
    config.width, config.height, 10);

  // Stage 3: Re-enforce edge constraints (maintain connectivity after overlap resolution)
  enforceEdgeConstraints(positions, uniqueEdges, nodeById, getNodeRadius,
    finalTargetLinkDistance, 3, 0.8, nodeGroupsMap, config.minGroupDistance || 800,
    config.edgeLabelFontSize);

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
  reduceEdgeCrossings(positions, edges, nodes, nodeById, 5);

  // ── Final label-aware edge correction ──────────────────────────────
  // Hard clamp: ensure condensation + crossing reduction didn't compress
  // labeled edges below their label width
  uniqueEdges.forEach(edge => {
    if (!edge.name) return;
    const p1 = positions.get(edge.sourceId);
    const p2 = positions.get(edge.destinationId);
    if (!p1 || !p2) return;
    const n1 = nodeById.get(edge.sourceId);
    const n2 = nodeById.get(edge.destinationId);
    const r1 = getNodeRadius(n1);
    const r2 = getNodeRadius(n2);
    const labelWidth = estimateEdgeLabelWidth(edge.name, config.edgeLabelFontSize);
    const labelMin = labelWidth + 60 + r1 + r2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < labelMin && dist > 0.1) {
      const correction = (labelMin - dist) * 0.5;
      const ux = dx / dist;
      const uy = dy / dist;
      p1.x -= ux * correction;
      p1.y -= uy * correction;
      p2.x += ux * correction;
      p2.y += uy * correction;
    }
  });

  // Enforce clearance between label midpoints of different labeled edges
  enforceEdgeLabelClearance(positions, uniqueEdges, nodeById, getNodeRadius, config);

  // Final group separation enforcement (after condensation and edge crossing
  // adjustments may have moved nodes closer again)
  if (groups.length > 0) {
    enforceGroupSeparation(positions, nodes, nodeGroupsMap, getNodeRadius,
      config.minGroupDistance || 800, finalMinNodeDistance, config.padding,
      config.width, config.height, 5);

    // Hard constraints, in order: peer groups' boxes must not interleave
    // (rigid translation apart — guarantees a corridor exists), then
    // ungrouped nodes must never finish inside a group's rect and
    // peer-shared (multi-group) nodes must finish in that corridor — the
    // polish stages above can drag all of these back in after the soft
    // exclusion force stops acting
    separateGroupBoxes(positions, groups, nodeGroupsMap, nodeById,
      nestedGroupPairs, config);
    enforceGroupBoundsExclusion(positions, nodes, groups, nodeGroupsMap,
      nodeById, getNodeRadius, config, nestedGroupPairs);
  }

  // ── Isolated-node scatter ───────────────────────────────────────────────
  // Fill actual empty pockets in and around the finished layout (inner gaps
  // first), overflowing onto a sunflower spiral outside the structure.
  // Group rects are forbidden regions — a group's interior padding is not an
  // "empty pocket" a floater may claim.
  if (isolatedNodes.length > 0) {
    const groupBoxes = groups.length > 0
      ? [...computeGroupWorldBoxes(groups, positions, nodeById, config.groupBoundaryPadding || 100).values()]
      : [];
    placeIsolatedNodes(positions, isolatedNodes, uniqueEdges, nodeById,
      getNodeRadius, finalMinNodeDistance, config, groupBoxes);
  }

  return positions;
}

/**
 * Place edge-less, ungrouped nodes into the empty space of a finished layout.
 *
 * Builds a candidate grid over the layout plus a periphery band, keeps only
 * points clear of node bodies and connection lines, and fills nearest-to-
 * center pockets first — so free floaters tuck into the gaps of the
 * structure rather than forming an equilibrium ring around it. Nodes that
 * don't fit any pocket overflow onto a golden-angle sunflower spiral outside
 * the structure (uniform 2D density, never a single-radius ring).
 * Deterministic: candidates and nodes are processed in stable order.
 */
function placeIsolatedNodes(positions, isolatedNodes, edges, nodeById, getRadius, minSpacing, config, forbiddenRects = []) {
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const sorted = [...isolatedNodes].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  let maxDiameter = 0;
  isolatedNodes.forEach(n => {
    maxDiameter = Math.max(maxDiameter, getRadius(n) * 2);
  });
  const spacing = Math.max(minSpacing, maxDiameter * 1.15);

  // Occupied bodies + layout bounds
  const occupied = [];
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  positions.forEach((p, id) => {
    occupied.push({ x: p.x, y: p.y, r: getRadius(nodeById.get(id)) });
    if (p.x < bMinX) bMinX = p.x;
    if (p.y < bMinY) bMinY = p.y;
    if (p.x > bMaxX) bMaxX = p.x;
    if (p.y > bMaxY) bMaxY = p.y;
  });

  // Graph is nothing but isolated nodes: sunflower out from the box center
  if (occupied.length === 0) {
    const cX = config.width / 2;
    const cY = config.height / 2;
    sorted.forEach((node, i) => {
      const r = Math.sqrt(((i + 0.5) * spacing * spacing) / Math.PI);
      positions.set(node.id, {
        x: cX + Math.cos(i * GOLDEN_ANGLE) * r,
        y: cY + Math.sin(i * GOLDEN_ANGLE) * r
      });
    });
    return;
  }

  const coreX = (bMinX + bMaxX) / 2;
  const coreY = (bMinY + bMaxY) / 2;
  const coreRadius = Math.hypot(bMaxX - bMinX, bMaxY - bMinY) / 2;

  // Connection segments — keep floaters off edge lines and their labels
  const edgeSegs = [];
  edges.forEach(e => {
    const p1 = positions.get(e.sourceId);
    const p2 = positions.get(e.destinationId);
    if (p1 && p2) edgeSegs.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
  });

  // Candidate grid: layout bbox plus a periphery band
  const margin = spacing * 2;
  const step = spacing * 0.75;
  const candidates = [];
  const inForbiddenRect = (px, py, buffer) => {
    for (const r of forbiddenRects) {
      if (px > r.minX - buffer && px < r.maxX + buffer &&
          py > r.minY - buffer && py < r.maxY + buffer) return true;
    }
    return false;
  };

  for (let gx = bMinX - margin; gx <= bMaxX + margin; gx += step) {
    for (let gy = bMinY - margin; gy <= bMaxY + margin; gy += step) {
      if (inForbiddenRect(gx, gy, spacing * 0.5)) continue;

      let nodeClearance = Infinity;
      for (const o of occupied) {
        const d = Math.hypot(gx - o.x, gy - o.y) - o.r;
        if (d < nodeClearance) nodeClearance = d;
        if (nodeClearance <= 0) break;
      }
      if (nodeClearance <= 0) continue;

      let edgeClearanceSq = Infinity;
      for (const s of edgeSegs) {
        const { distSq } = getPointSegmentDistSq(gx, gy, s.x1, s.y1, s.x2, s.y2);
        if (distSq < edgeClearanceSq) edgeClearanceSq = distSq;
      }

      candidates.push({
        x: gx,
        y: gy,
        nodeClearance,
        edgeClearance: Math.sqrt(edgeClearanceSq),
        dCenter: Math.hypot(gx - coreX, gy - coreY),
        used: false
      });
    }
  }
  // Inner pockets first — floaters fall INTO the empty space of the
  // structure before spilling to the periphery
  candidates.sort((a, b) => a.dCenter - b.dCenter);

  const placedIso = [];
  let overflowIndex = 0;
  sorted.forEach(node => {
    const nodeR = getRadius(node);
    let placed = null;
    for (const c of candidates) {
      if (c.used) continue;
      if (c.nodeClearance < nodeR * 1.1) continue;
      if (c.edgeClearance < nodeR) continue;
      let clearOfSiblings = true;
      for (const p of placedIso) {
        if (Math.hypot(c.x - p.x, c.y - p.y) < spacing) { clearOfSiblings = false; break; }
      }
      if (!clearOfSiblings) continue;
      c.used = true;
      placed = { x: c.x, y: c.y };
      break;
    }
    if (!placed) {
      // Overflow: sunflower annulus outside everything. Spiral points that
      // land inside a group rect are skipped (a wide group can poke past
      // coreRadius on one axis).
      const startR = coreRadius + spacing;
      for (let attempts = 0; attempts < 200; attempts++) {
        const r = Math.sqrt(startR * startR + ((overflowIndex + 0.5) * spacing * spacing) / Math.PI);
        const theta = overflowIndex * GOLDEN_ANGLE;
        overflowIndex++;
        const px = coreX + Math.cos(theta) * r;
        const py = coreY + Math.sin(theta) * r;
        if (inForbiddenRect(px, py, nodeR)) continue;
        placed = { x: px, y: py };
        break;
      }
      if (!placed) {
        // Every attempt landed in a group rect — fall back to due east of it all
        placed = { x: bMaxX + spacing * 2 + overflowIndex * spacing, y: coreY };
      }
    }
    placedIso.push(placed);
    positions.set(node.id, placed);
  });
}

/**
 * Enforce edge length constraints
 * Connected nodes try to maintain target distance (rigid body behavior)
 * When nodeGroupsMap is provided, cross-group edges use weaker correction
 * and a larger minimum target to prevent undoing group separation.
 */
function enforceEdgeConstraints(positions, edges, nodeById, getRadius, targetDistance, passes, stiffness = 0.5, nodeGroupsMap = null, minGroupDistance = 0, edgeLabelFontSize = 54) {
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

      // Respect edge label minimum — don't shrink edges below their label width
      if (edge.name) {
        const labelWidth = estimateEdgeLabelWidth(edge.name, edgeLabelFontSize);
        const labelMin = labelWidth + 60 + r1 + r2;
        effectiveTarget = Math.max(effectiveTarget, labelMin);
      }

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
/**
 * Compute each group's world-space bounding box from its members' laid-out
 * positions (the rect a renderer would derive), expanded by `pad`.
 */
function computeGroupWorldBoxes(groups, positions, nodeById, pad) {
  const boxes = new Map();
  groups.forEach(group => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (group.memberInstanceIds || []).forEach(id => {
      const pos = positions.get(id);
      const node = nodeById.get(id);
      if (!pos || !node) return;
      const w = node.width || 100;
      const h = node.height || 60;
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x + w > maxX) maxX = pos.x + w;
      if (pos.y + h > maxY) maxY = pos.y + h;
    });
    if (minX !== Infinity) {
      boxes.set(group.id, {
        minX: minX - pad, minY: minY - pad,
        maxX: maxX + pad, maxY: maxY + pad
      });
    }
  });
  return boxes;
}

/**
 * Hard guarantee that ungrouped nodes finish OUTSIDE every group's bounding
 * box. The soft exclusion force only acts during the simulation; the polish
 * stages that follow (edge constraints, overlap resolution, condensation,
 * crossing reduction) can drag an ungrouped node back inside a group rect,
 * where it renders as an apparent member. This ejects such nodes through the
 * cheapest box edge, alternating with light overlap resolution so ejected
 * nodes don't stack, and always ends on an eject pass so the guarantee holds.
 */
/**
 * Returns a (nodeId, groupId) => bool checker for whether a member is shared
 * with a peer (non-nested) group — such nodes belong in the corridor between
 * their groups, not inside any one group's exclusive core.
 */
function makePeerSharedChecker(nodeGroupsMap, nestedGroupPairs) {
  return (nodeId, groupId) => {
    const memberships = nodeGroupsMap.get(nodeId);
    if (!memberships || memberships.size < 2) return false;
    for (const otherGid of memberships) {
      if (otherGid === groupId) continue;
      const pk = otherGid < groupId ? `${otherGid}|${groupId}` : `${groupId}|${otherGid}`;
      if (!nestedGroupPairs.has(pk)) return true;
    }
    return false;
  };
}

/**
 * Rigidly translate peer (non-nested) top-level groups apart until their
 * core boxes no longer overlap. Pairwise node separation alone can leave two
 * groups spatially interleaved — which renders as one group's rect swallowing
 * the other and leaves no corridor for shared nodes. Rigid translation
 * preserves each group's internal layout; nested children ride along with
 * their parent, and peer-shared members are skipped (the corridor ejection
 * pass places them afterwards).
 */
function separateGroupBoxes(positions, groups, nodeGroupsMap, nodeById, nestedGroupPairs, config, passes = 6) {
  if (!groups || groups.length < 2) return;
  const pad = config.groupBoundaryPadding || 100;
  const isPeerSharedWith = makePeerSharedChecker(nodeGroupsMap, nestedGroupPairs);

  // Only pairs that actually share members need a corridor between their
  // PADDED boxes wide enough for the shared node plus ejection clearance
  // (or corridor placement oscillates). Pairs with nothing between them get
  // a modest gap — sizing every pair for the graph's biggest node casts the
  // whole layout apart.
  const plainGap = pad * 2;
  const gapForPair = (g1, g2) => {
    const m2 = new Set(g2.memberInstanceIds || []);
    let maxSharedExtent = 0;
    (g1.memberInstanceIds || []).forEach(id => {
      if (!m2.has(id)) return;
      const n = nodeById.get(id);
      if (n) maxSharedExtent = Math.max(maxSharedExtent, n.width || 100, n.height || 60);
    });
    if (maxSharedExtent === 0) return plainGap;
    return pad * 2 + maxSharedExtent + 80;
  };

  const memberSet = new Map(groups.map(g => [g.id, new Set(g.memberInstanceIds || [])]));
  const isContained = (innerId, outerId) => {
    const im = memberSet.get(innerId), om = memberSet.get(outerId);
    if (!im || !om || im.size === 0 || im.size >= om.size) return false;
    for (const m of im) { if (!om.has(m)) return false; }
    return true;
  };
  const topLevel = groups.filter(g =>
    !groups.some(o => o.id !== g.id && isContained(g.id, o.id)));
  if (topLevel.length < 2) return;

  for (let pass = 0; pass < passes; pass++) {
    const boxes = new Map();
    topLevel.forEach(g => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      (g.memberInstanceIds || []).forEach(id => {
        if (isPeerSharedWith(id, g.id)) return;
        const pos = positions.get(id);
        const node = nodeById.get(id);
        if (!pos || !node) return;
        const w = node.width || 100;
        const h = node.height || 60;
        if (pos.x < minX) minX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.x + w > maxX) maxX = pos.x + w;
        if (pos.y + h > maxY) maxY = pos.y + h;
      });
      if (minX !== Infinity) boxes.set(g.id, { minX, minY, maxX, maxY });
    });

    let moved = false;
    for (let i = 0; i < topLevel.length; i++) {
      for (let j = i + 1; j < topLevel.length; j++) {
        const b1 = boxes.get(topLevel[i].id);
        const b2 = boxes.get(topLevel[j].id);
        if (!b1 || !b2) continue;
        const gap = gapForPair(topLevel[i], topLevel[j]);
        const overlapX = Math.min(b1.maxX, b2.maxX) - Math.max(b1.minX, b2.minX) + gap;
        const overlapY = Math.min(b1.maxY, b2.maxY) - Math.max(b1.minY, b2.minY) + gap;
        if (overlapX <= 0 || overlapY <= 0) continue;

        let dx = 0, dy = 0;
        if (overlapX < overlapY) {
          const dir = (b1.minX + b1.maxX) <= (b2.minX + b2.maxX) ? 1 : -1;
          dx = dir * overlapX / 2;
        } else {
          const dir = (b1.minY + b1.maxY) <= (b2.minY + b2.maxY) ? 1 : -1;
          dy = dir * overlapY / 2;
        }

        const translate = (g, sx, sy, box) => {
          (g.memberInstanceIds || []).forEach(id => {
            if (isPeerSharedWith(id, g.id)) return;
            const p = positions.get(id);
            if (p) { p.x += sx; p.y += sy; }
          });
          box.minX += sx; box.maxX += sx;
          box.minY += sy; box.maxY += sy;
        };
        translate(topLevel[i], -dx, -dy, b1);
        translate(topLevel[j], dx, dy, b2);
        moved = true;
      }
    }
    if (!moved) return;
  }
}

function enforceGroupBoundsExclusion(positions, nodes, groups, nodeGroupsMap, nodeById, getRadius, config, nestedGroupPairs = new Set(), passes = 3) {
  if (!groups || groups.length === 0) return;
  const pad = config.groupBoundaryPadding || 100;
  const clearance = 30;
  const isPeerSharedWith = makePeerSharedChecker(nodeGroupsMap, nestedGroupPairs);

  const ungrouped = nodes.filter(n => {
    const gs = nodeGroupsMap.get(n.id);
    return !gs || gs.size === 0;
  });
  const peerShared = nodes.filter(n => {
    const gs = nodeGroupsMap.get(n.id);
    if (!gs || gs.size < 2) return false;
    return [...gs].some(gid => isPeerSharedWith(n.id, gid));
  });
  if (ungrouped.length === 0 && peerShared.length === 0) return;

  // Core boxes exclude peer-shared members so a shared node in the corridor
  // doesn't stretch the box it's being ejected from
  const computeCoreBoxes = () => {
    const boxes = new Map();
    groups.forEach(group => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      (group.memberInstanceIds || []).forEach(id => {
        if (isPeerSharedWith(id, group.id)) return;
        const pos = positions.get(id);
        const node = nodeById.get(id);
        if (!pos || !node) return;
        const w = node.width || 100;
        const h = node.height || 60;
        if (pos.x < minX) minX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.x + w > maxX) maxX = pos.x + w;
        if (pos.y + h > maxY) maxY = pos.y + h;
      });
      if (minX !== Infinity) {
        boxes.set(group.id, {
          minX: minX - pad, minY: minY - pad,
          maxX: maxX + pad, maxY: maxY + pad,
          centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2
        });
      }
    });
    return boxes;
  };

  const ejectNodeFromBox = (node, pos, box, bias) => {
    const w = node.width || 100;
    const h = node.height || 60;
    const hw = w / 2 + clearance;
    const hh = h / 2 + clearance;
    const cx = pos.x + w / 2;
    const cy = pos.y + h / 2;
    if (cx + hw <= box.minX || cx - hw >= box.maxX ||
        cy + hh <= box.minY || cy - hh >= box.maxY) return false;
    if (bias) {
      // Exit through the side facing the bias point (the node's other groups)
      const dx = bias.x - box.centerX;
      const dy = bias.y - box.centerY;
      if (Math.abs(dx) > Math.abs(dy)) {
        pos.x = (dx > 0 ? box.maxX + hw : box.minX - hw) - w / 2;
      } else {
        pos.y = (dy > 0 ? box.maxY + hh : box.minY - hh) - h / 2;
      }
    } else {
      const exitLeft = (cx + hw) - box.minX;
      const exitRight = box.maxX - (cx - hw);
      const exitUp = (cy + hh) - box.minY;
      const exitDown = box.maxY - (cy - hh);
      const min = Math.min(exitLeft, exitRight, exitUp, exitDown);
      if (min === exitLeft) pos.x -= min;
      else if (min === exitRight) pos.x += min;
      else if (min === exitUp) pos.y -= min;
      else pos.y += min;
    }
    return true;
  };

  const ejectPass = () => {
    const coreBoxes = peerShared.length > 0 ? computeCoreBoxes() : null;
    let moved = false;

    // Peer-shared nodes first: their corridor position stretches the rendered
    // rects, so ungrouped nodes must be validated against the boxes AFTER
    // shared nodes have settled
    peerShared.forEach(node => {
      const pos = positions.get(node.id);
      if (!pos) return;
      const memberships = [...(nodeGroupsMap.get(node.id) || [])];
      memberships.forEach(gid => {
        if (!isPeerSharedWith(node.id, gid)) return;
        const box = coreBoxes.get(gid);
        if (!box) return;
        // Bias exit toward the centroid of the node's OTHER groups so it
        // lands in the corridor between them, not on a far side
        let bx = 0, by = 0, bCount = 0;
        memberships.forEach(otherGid => {
          if (otherGid === gid) return;
          const ob = coreBoxes.get(otherGid);
          if (ob) { bx += ob.centerX; by += ob.centerY; bCount++; }
        });
        const bias = bCount > 0 ? { x: bx / bCount, y: by / bCount } : null;
        if (ejectNodeFromBox(node, pos, box, bias)) moved = true;
      });
    });

    const fullBoxes = computeGroupWorldBoxes(groups, positions, nodeById, pad);
    ungrouped.forEach(node => {
      const pos = positions.get(node.id);
      if (!pos) return;
      const w = node.width || 100;
      const h = node.height || 60;
      const hw = w / 2 + clearance;
      const hh = h / 2 + clearance;
      // Iterate until clear of ALL boxes. When the node overlaps several
      // boxes at once (two rects joined by a shared node's Venn lens),
      // eject from their UNION — per-box ejection just ping-pongs between
      // the overlapping boxes.
      for (let round = 0; round < 4; round++) {
        const cx = pos.x + w / 2;
        const cy = pos.y + h / 2;
        const hits = [];
        fullBoxes.forEach(box => {
          if (cx + hw > box.minX && cx - hw < box.maxX &&
              cy + hh > box.minY && cy - hh < box.maxY) hits.push(box);
        });
        if (hits.length === 0) break;
        const target = hits.length === 1 ? hits[0] : {
          minX: Math.min(...hits.map(b => b.minX)),
          minY: Math.min(...hits.map(b => b.minY)),
          maxX: Math.max(...hits.map(b => b.maxX)),
          maxY: Math.max(...hits.map(b => b.maxY))
        };
        if (ejectNodeFromBox(node, pos, target)) moved = true;
      }
    });

    return moved;
  };

  for (let pass = 0; pass < passes; pass++) {
    if (!ejectPass()) return;
    resolveOverlaps(positions, nodes, getRadius, config.padding, config.width, config.height, 2);
  }
  ejectPass();
}

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
 * Enforce minimum clearance between the label midpoints of different edges.
 * Two labeled edges whose midpoints are too close will have their endpoint
 * nodes pushed apart so the labels don't visually collide.
 * Only acts on edge pairs that share no endpoint nodes.
 */
function enforceEdgeLabelClearance(positions, edges, nodeById, getNodeRadius, config, passes = 3) {
  const padding = config.edgeLabelClearancePadding || 30;
  const labeled = edges.filter(e => e.name && e.sourceId && e.destinationId);
  if (labeled.length < 2) return;

  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < labeled.length; i++) {
      for (let j = i + 1; j < labeled.length; j++) {
        const eA = labeled[i];
        const eB = labeled[j];
        // Skip pairs that share an endpoint — handled by per-edge constraints
        if (eA.sourceId === eB.sourceId || eA.sourceId === eB.destinationId ||
            eA.destinationId === eB.sourceId || eA.destinationId === eB.destinationId) continue;

        const pA1 = positions.get(eA.sourceId);
        const pA2 = positions.get(eA.destinationId);
        const pB1 = positions.get(eB.sourceId);
        const pB2 = positions.get(eB.destinationId);
        if (!pA1 || !pA2 || !pB1 || !pB2) continue;

        // Label midpoints are the geometric centers of each edge
        const midAx = (pA1.x + pA2.x) / 2;
        const midAy = (pA1.y + pA2.y) / 2;
        const midBx = (pB1.x + pB2.x) / 2;
        const midBy = (pB1.y + pB2.y) / 2;

        const wA = estimateEdgeLabelWidth(eA.name, config.edgeLabelFontSize);
        const wB = estimateEdgeLabelWidth(eB.name, config.edgeLabelFontSize);
        const minClearance = (wA + wB) / 2 + padding;

        const dx = midBx - midAx; // vector from A's midpoint to B's midpoint
        const dy = midBy - midAy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= minClearance || dist < 0.1) continue;

        const deficit = minClearance - dist;
        const ux = dx / dist;
        const uy = dy / dist;
        const push = deficit * 0.5;

        // Shift the shorter-labeled edge's endpoints away from the longer one
        if (wB <= wA) {
          pB1.x += ux * push;
          pB1.y += uy * push;
          pB2.x += ux * push;
          pB2.y += uy * push;
        } else {
          pA1.x -= ux * push;
          pA1.y -= uy * push;
          pA2.x -= ux * push;
          pA2.y -= uy * push;
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
  const shrinkFactor = 0.97;
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
 * Two-phase strategy per crossing:
 *   Phase 1: Try swapping endpoint positions — accept only if total crossings decrease.
 *   Phase 2: Adaptive nudge fallback — scale nudge to edge length instead of fixed 20px.
 */
function reduceEdgeCrossings(positions, edges, nodes, nodeById, maxPasses = 5) {
  if (edges.length < 2) return;

  // Pre-build adjacency: nodeId → list of edges involving that node
  const nodeEdgeMap = new Map();
  edges.forEach(edge => {
    if (!nodeEdgeMap.has(edge.sourceId)) nodeEdgeMap.set(edge.sourceId, []);
    if (!nodeEdgeMap.has(edge.destinationId)) nodeEdgeMap.set(edge.destinationId, []);
    nodeEdgeMap.get(edge.sourceId).push(edge);
    nodeEdgeMap.get(edge.destinationId).push(edge);
  });

  // Count crossings involving edges of a specific node
  function countNodeCrossings(nodeId) {
    let count = 0;
    const nodeEdges = nodeEdgeMap.get(nodeId);
    if (!nodeEdges) return 0;
    for (const ne of nodeEdges) {
      for (let k = 0; k < edges.length; k++) {
        const oe = edges[k];
        // Skip same edge or edges sharing an endpoint
        if (ne === oe) continue;
        if (ne.sourceId === oe.sourceId || ne.sourceId === oe.destinationId ||
            ne.destinationId === oe.sourceId || ne.destinationId === oe.destinationId) continue;
        const p1a = positions.get(ne.sourceId), p1b = positions.get(ne.destinationId);
        const p2a = positions.get(oe.sourceId), p2b = positions.get(oe.destinationId);
        if (!p1a || !p1b || !p2a || !p2b) continue;
        if (segmentsCross(p1a.x, p1a.y, p1b.x, p1b.y, p2a.x, p2a.y, p2b.x, p2b.y)) count++;
      }
    }
    return count;
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;

    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const e1 = edges[i];
        const e2 = edges[j];

        // Skip if edges share an endpoint
        if (e1.sourceId === e2.sourceId || e1.sourceId === e2.destinationId ||
          e1.destinationId === e2.sourceId || e1.destinationId === e2.destinationId) {
          continue;
        }

        const p1a = positions.get(e1.sourceId);
        const p1b = positions.get(e1.destinationId);
        const p2a = positions.get(e2.sourceId);
        const p2b = positions.get(e2.destinationId);
        if (!p1a || !p1b || !p2a || !p2b) continue;

        if (!segmentsCross(p1a.x, p1a.y, p1b.x, p1b.y, p2a.x, p2a.y, p2b.x, p2b.y)) continue;

        // Phase 1: Try swapping endpoint positions — pick the best swap
        const candidates = [
          { a: e1.sourceId, b: e2.sourceId },
          { a: e1.sourceId, b: e2.destinationId },
          { a: e1.destinationId, b: e2.sourceId },
          { a: e1.destinationId, b: e2.destinationId },
        ];

        let bestSwap = null;
        let bestReduction = 0;

        for (const { a, b } of candidates) {
          const pa = positions.get(a), pb = positions.get(b);
          const beforeA = countNodeCrossings(a);
          const beforeB = countNodeCrossings(b);

          // Swap positions
          const tmpX = pa.x, tmpY = pa.y;
          pa.x = pb.x; pa.y = pb.y;
          pb.x = tmpX; pb.y = tmpY;

          const afterA = countNodeCrossings(a);
          const afterB = countNodeCrossings(b);
          const reduction = (beforeA + beforeB) - (afterA + afterB);

          // Undo swap
          pb.x = pa.x; pb.y = pa.y;
          pa.x = tmpX; pa.y = tmpY;

          if (reduction > bestReduction) {
            bestReduction = reduction;
            bestSwap = { a, b };
          }
        }

        if (bestSwap) {
          // Apply best swap
          const pa = positions.get(bestSwap.a), pb = positions.get(bestSwap.b);
          const tmpX = pa.x, tmpY = pa.y;
          pa.x = pb.x; pa.y = pb.y;
          pb.x = tmpX; pb.y = tmpY;
          improved = true;
        } else {
          // Phase 2: Adaptive nudge fallback — scale to 8% of shorter edge length
          const len1 = Math.sqrt((p1b.x - p1a.x) ** 2 + (p1b.y - p1a.y) ** 2);
          const len2 = Math.sqrt((p2b.x - p2a.x) ** 2 + (p2b.y - p2a.y) ** 2);
          const nudge = Math.max(30, Math.min(len1, len2) * 0.08);

          const mid1x = (p1a.x + p1b.x) / 2, mid1y = (p1a.y + p1b.y) / 2;
          const mid2x = (p2a.x + p2b.x) / 2, mid2y = (p2a.y + p2b.y) / 2;
          const dx = mid2x - mid1x, dy = mid2y - mid1y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.1) continue;

          const perpX = -dy / dist, perpY = dx / dist;
          p1a.x += perpX * nudge * 0.5; p1a.y += perpY * nudge * 0.5;
          p1b.x += perpX * nudge * 0.5; p1b.y += perpY * nudge * 0.5;
          p2a.x -= perpX * nudge * 0.5; p2a.y -= perpY * nudge * 0.5;
          p2b.x -= perpX * nudge * 0.5; p2b.y -= perpY * nudge * 0.5;
          improved = true;
        }
      }
    }

    if (!improved) break;
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
