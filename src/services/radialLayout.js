/**
 * Radial Layout Service
 *
 * Dimension-aware radial graph layout with intelligent overflow handling,
 * collision detection, and smart connection routing.
 */

/**
 * Configuration for radial layout
 */
export const RADIAL_CONFIG = {
  baseRadius: 150,
  orbitSpacing: 120,
  minNodeMargin: 24,
  maxNodesPerOrbit: 16,
  minNodeWidth: 80,
  nodeHeight: 40,
  fontSize: 14,
  fontFamily: 'system-ui, -apple-system, sans-serif',

  // Overflow strategies
  overflowStrategy: 'subdivide', // 'subdivide' | 'increase-radius' | 'force-adjust'

  // Force-directed collision resolution
  collisionIterations: 50,
  collisionForce: 0.5,

  // Connection routing
  connectionRouting: 'curved', // 'straight' | 'curved' | 'orthogonal'
  connectionCurvature: 0.3
};

/**
 * Measure text width using canvas
 */
let measurementCanvas = null;
function getTextWidth(text, fontSize = RADIAL_CONFIG.fontSize, fontFamily = RADIAL_CONFIG.fontFamily) {
  if (!measurementCanvas) {
    measurementCanvas = document.createElement('canvas');
  }

  const context = measurementCanvas.getContext('2d');
  context.font = `${fontSize}px ${fontFamily}`;

  const metrics = context.measureText(text);
  return metrics.width;
}

/**
 * Calculate node dimensions based on label
 */
export function calculateNodeDimensions(node) {
  const label = node.name || node.label || '';
  const textWidth = getTextWidth(label);

  return {
    width: Math.max(textWidth + 40, RADIAL_CONFIG.minNodeWidth), // Add padding
    height: RADIAL_CONFIG.nodeHeight
  };
}

/**
 * Convert linear width to angular width at given radius
 */
function linearToAngular(linearWidth, radius) {
  return linearWidth / radius;
}

/**
 * Distribute nodes evenly on an orbit
 */
function distributeNodesOnOrbit(nodes, radius, orbitIndex) {
  const positions = [];
  const circumference = 2 * Math.PI * radius;

  // Calculate total space needed
  let totalNeeded = 0;
  for (const node of nodes) {
    const dimensions = calculateNodeDimensions(node);
    const angularWidth = linearToAngular(dimensions.width, radius);
    const margin = linearToAngular(RADIAL_CONFIG.minNodeMargin * 2, radius);
    totalNeeded += angularWidth + margin;
  }

  // Check if we have enough space
  const hasOverflow = totalNeeded > (2 * Math.PI);

  if (!hasOverflow) {
    // Distribute with even padding
    const paddingAngle = (2 * Math.PI - totalNeeded) / nodes.length;
    let currentAngle = 0;

    for (const node of nodes) {
      const dimensions = calculateNodeDimensions(node);
      const angularWidth = linearToAngular(dimensions.width, radius);
      const margin = linearToAngular(RADIAL_CONFIG.minNodeMargin, radius);

      // Center the node in its arc
      const centerAngle = currentAngle + margin + angularWidth / 2;

      positions.push({
        node,
        angle: centerAngle,
        startAngle: currentAngle + margin,
        endAngle: currentAngle + margin + angularWidth,
        radius,
        orbitIndex,
        x: radius * Math.cos(centerAngle),
        y: radius * Math.sin(centerAngle),
        dimensions,
        hasOverflow: false
      });

      currentAngle += angularWidth + margin * 2 + paddingAngle;
    }
  } else {
    // Has overflow - distribute proportionally
    const scale = (2 * Math.PI) / totalNeeded;
    let currentAngle = 0;

    for (const node of nodes) {
      const dimensions = calculateNodeDimensions(node);
      const angularWidth = linearToAngular(dimensions.width, radius) * scale;
      const margin = linearToAngular(RADIAL_CONFIG.minNodeMargin, radius) * scale;

      const centerAngle = currentAngle + margin + angularWidth / 2;

      positions.push({
        node,
        angle: centerAngle,
        startAngle: currentAngle + margin,
        endAngle: currentAngle + margin + angularWidth,
        radius,
        orbitIndex,
        x: radius * Math.cos(centerAngle),
        y: radius * Math.sin(centerAngle),
        dimensions,
        hasOverflow: true
      });

      currentAngle += angularWidth + margin * 2;
    }
  }

  return positions;
}

/**
 * Subdivide an overcrowded orbit into multiple sub-orbits
 */
function subdivideOrbit(nodes, baseRadius, orbitIndex) {
  const subOrbitCount = Math.ceil(nodes.length / RADIAL_CONFIG.maxNodesPerOrbit);
  const subOrbits = [];

  // Split nodes into sub-groups
  const nodesPerSubOrbit = Math.ceil(nodes.length / subOrbitCount);
  for (let i = 0; i < subOrbitCount; i++) {
    const start = i * nodesPerSubOrbit;
    const end = Math.min(start + nodesPerSubOrbit, nodes.length);
    const subOrbitNodes = nodes.slice(start, end);

    // Offset radius for each sub-orbit
    const radiusOffset = (i - (subOrbitCount - 1) / 2) * (RADIAL_CONFIG.orbitSpacing / subOrbitCount);
    const subRadius = baseRadius + radiusOffset;

    const positions = distributeNodesOnOrbit(subOrbitNodes, subRadius, orbitIndex + i * 0.1);
    subOrbits.push(...positions);
  }

  return subOrbits;
}

/**
 * Calculate overlap between two nodes
 */
function calculateOverlap(nodeA, nodeB) {
  // Calculate Euclidean distance
  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Required separation (half width of each + margin)
  const requiredSep = (nodeA.dimensions.width + nodeB.dimensions.width) / 2 + RADIAL_CONFIG.minNodeMargin;

  return Math.max(0, requiredSep - distance);
}

/**
 * Apply force-directed collision resolution
 */
function applyCollisionResolution(layout) {
  const positions = [...layout];
  const maxIterations = RADIAL_CONFIG.collisionIterations;

  for (let iter = 0; iter < maxIterations; iter++) {
    let adjusted = false;

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const nodeA = positions[i];
        const nodeB = positions[j];

        // Only check nodes on same or adjacent orbits
        if (Math.abs(nodeA.orbitIndex - nodeB.orbitIndex) > 1) continue;

        const overlap = calculateOverlap(nodeA, nodeB);

        if (overlap > 0) {
          // Calculate push direction along orbital paths
          const force = overlap * RADIAL_CONFIG.collisionForce;

          // Push apart along their respective orbits
          nodeA.angle -= force / nodeA.radius;
          nodeB.angle += force / nodeB.radius;

          // Update positions
          nodeA.x = nodeA.radius * Math.cos(nodeA.angle);
          nodeA.y = nodeA.radius * Math.sin(nodeA.angle);
          nodeB.x = nodeB.radius * Math.cos(nodeB.angle);
          nodeB.y = nodeB.radius * Math.sin(nodeB.angle);

          adjusted = true;
        }
      }
    }

    if (!adjusted) {
      console.log(`[RadialLayout] Collision resolution converged after ${iter + 1} iterations`);
      break;
    }
  }

  return positions;
}

/**
 * Apply visual staggering for depth perception
 */
function applyStaggering(layout) {
  return layout.map((node, idx) => ({
    ...node,
    // Alternate z-index for depth
    zIndex: node.orbitIndex * 10 + (idx % 2 === 0 ? 5 : 0),
    // Slight opacity variation
    opacity: idx % 2 === 0 ? 1.0 : 0.90,
    // Small radius offset for visual separation
    visualRadius: node.radius + (idx % 2 === 0 ? 2 : -2)
  }));
}

/**
 * Route connection lines between nodes
 */
function routeConnections(layout, centralNode, connections) {
  const routes = [];

  for (const connection of connections) {
    const sourceNode = connection.source === centralNode.name
      ? centralNode
      : layout.find(n => n.node.name === connection.source);

    const targetNode = connection.target === centralNode.name
      ? centralNode
      : layout.find(n => n.node.name === connection.target);

    if (!sourceNode || !targetNode) continue;

    const route = {
      source: connection.source,
      target: connection.target,
      relation: connection.relation,
      confidence: connection.confidence,
      path: null
    };

    // Generate path based on routing strategy
    if (RADIAL_CONFIG.connectionRouting === 'straight') {
      route.path = {
        type: 'line',
        x1: sourceNode.x || 0,
        y1: sourceNode.y || 0,
        x2: targetNode.x,
        y2: targetNode.y
      };
    } else if (RADIAL_CONFIG.connectionRouting === 'curved') {
      // Quadratic Bezier curve
      const midX = (sourceNode.x + targetNode.x) / 2;
      const midY = (sourceNode.y + targetNode.y) / 2;

      // Calculate perpendicular offset for curve
      const dx = targetNode.x - (sourceNode.x || 0);
      const dy = targetNode.y - (sourceNode.y || 0);
      const dist = Math.sqrt(dx * dx + dy * dy);

      const offsetX = -dy / dist * dist * RADIAL_CONFIG.connectionCurvature;
      const offsetY = dx / dist * dist * RADIAL_CONFIG.connectionCurvature;

      route.path = {
        type: 'quadratic',
        x1: sourceNode.x || 0,
        y1: sourceNode.y || 0,
        cx: midX + offsetX,
        cy: midY + offsetY,
        x2: targetNode.x,
        y2: targetNode.y
      };
    }

    routes.push(route);
  }

  return routes;
}

/**
 * Main layout function: Create radial graph layout
 * @param {Object} centralNode - Central node
 * @param {Array} orbits - Array of orbit levels with entities
 * @param {Array} connections - Array of connections
 * @param {Object} options - Layout options
 * @returns {Object} Complete layout with nodes and connections
 */
export function layoutRadialGraph(centralNode, orbits, connections = [], options = {}) {
  const config = { ...RADIAL_CONFIG, ...options };
  const allPositions = [];

  // Position central node
  const centralPosition = {
    node: centralNode,
    angle: 0,
    radius: 0,
    orbitIndex: 0,
    x: 0,
    y: 0,
    dimensions: calculateNodeDimensions(centralNode),
    isCentral: true
  };

  // Process each orbit
  for (let orbitIdx = 0; orbitIdx < orbits.length; orbitIdx++) {
    const orbit = orbits[orbitIdx];
    const nodes = orbit.entities || orbit.nodes || [];

    if (nodes.length === 0) continue;

    const radius = config.baseRadius + orbitIdx * config.orbitSpacing;

    // Check for overflow
    const circumference = 2 * Math.PI * radius;
    const totalWidth = nodes.reduce((sum, node) => {
      const dims = calculateNodeDimensions(node);
      return sum + dims.width + config.minNodeMargin * 2;
    }, 0);

    let orbitPositions;

    if (totalWidth > circumference && config.overflowStrategy === 'subdivide') {
      // Subdivide into multiple rings
      console.log(`[RadialLayout] Orbit ${orbitIdx} overflow: subdividing`);
      orbitPositions = subdivideOrbit(nodes, radius, orbitIdx);
    } else {
      // Normal distribution
      orbitPositions = distributeNodesOnOrbit(nodes, radius, orbitIdx);
    }

    allPositions.push(...orbitPositions);
  }

  // Apply collision resolution
  const resolvedPositions = applyCollisionResolution(allPositions);

  // Apply visual staggering
  const staggeredPositions = applyStaggering(resolvedPositions);

  // Route connections
  const routes = routeConnections(staggeredPositions, centralPosition, connections);

  return {
    central: centralPosition,
    nodes: staggeredPositions,
    connections: routes,
    stats: {
      totalNodes: staggeredPositions.length + 1,
      totalConnections: routes.length,
      orbitCount: orbits.length,
      hasOverflow: staggeredPositions.some(n => n.hasOverflow)
    }
  };
}

/**
 * Convert layout to SVG path data
 */
export function layoutToSVG(layout, options = {}) {
  const { width = 1200, height = 800, padding = 50 } = options;

  const svg = {
    width,
    height,
    viewBox: `${-width / 2} ${-height / 2} ${width} ${height}`,
    elements: []
  };

  // Draw connections first (behind nodes)
  for (const connection of layout.connections) {
    if (connection.path.type === 'line') {
      svg.elements.push({
        type: 'line',
        x1: connection.path.x1,
        y1: connection.path.y1,
        x2: connection.path.x2,
        y2: connection.path.y2,
        stroke: `rgba(100, 100, 100, ${connection.confidence * 0.6})`,
        strokeWidth: 1 + connection.confidence,
        label: connection.relation
      });
    } else if (connection.path.type === 'quadratic') {
      const pathData = `M ${connection.path.x1},${connection.path.y1} Q ${connection.path.cx},${connection.path.cy} ${connection.path.x2},${connection.path.y2}`;
      svg.elements.push({
        type: 'path',
        d: pathData,
        stroke: `rgba(100, 100, 100, ${connection.confidence * 0.6})`,
        strokeWidth: 1 + connection.confidence,
        fill: 'none',
        label: connection.relation
      });
    }
  }

  // Draw central node
  svg.elements.push({
    type: 'node',
    x: layout.central.x,
    y: layout.central.y,
    width: layout.central.dimensions.width,
    height: layout.central.dimensions.height,
    label: layout.central.node.name,
    isCentral: true,
    zIndex: 1000
  });

  // Draw orbit nodes
  for (const node of layout.nodes) {
    svg.elements.push({
      type: 'node',
      x: node.x,
      y: node.y,
      width: node.dimensions.width,
      height: node.dimensions.height,
      label: node.node.name,
      angle: node.angle,
      radius: node.radius,
      orbitIndex: node.orbitIndex,
      zIndex: node.zIndex,
      opacity: node.opacity
    });
  }

  return svg;
}

/**
 * Update layout dynamically (for animations/interactions)
 */
export function updateLayout(existingLayout, changes) {
  const updated = { ...existingLayout };

  if (changes.addNodes) {
    // Add new nodes to appropriate orbit
    // Re-run layout for affected orbits
  }

  if (changes.removeNodes) {
    // Remove nodes and re-layout
  }

  if (changes.reorganize) {
    // Trigger full re-layout
  }

  return updated;
}
