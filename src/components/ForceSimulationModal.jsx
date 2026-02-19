import React, { useState, useRef, useEffect } from 'react';
import { X, Play, Pause, RotateCcw } from 'lucide-react';
import './ForceSimulationModal.css';
import { FORCE_LAYOUT_DEFAULTS, LAYOUT_ITERATION_PRESETS, LAYOUT_SCALE_PRESETS, MAX_LAYOUT_SCALE_MULTIPLIER } from '../services/graphLayoutService.js';

/**
 * Draggable modal for interactive force-directed layout tuning
 * Applies forces directly to the active graph - no separate preview!
 */
const ForceSimulationModal = ({
  isOpen,
  onClose,
  graphId,
  storeActions,
  getNodes,
  getEdges,
  getGroups = () => [],
  getDraggedNodeIds = () => new Set(),
  onNodePositionsUpdated,
  layoutScalePreset = FORCE_LAYOUT_DEFAULTS.layoutScale || 'balanced',
  layoutScaleMultiplier = FORCE_LAYOUT_DEFAULTS.layoutScaleMultiplier || 1,
  onLayoutScalePresetChange,
  onLayoutScaleMultiplierChange,
  layoutIterationPreset = FORCE_LAYOUT_DEFAULTS.iterationPreset || 'balanced',
  onLayoutIterationPresetChange
  ,
  onCopyToAutoLayout
}) => {
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const modalRef = useRef(null);
  const animationRef = useRef(null);
  const initialScaleMultiplier = Math.min(
    MAX_LAYOUT_SCALE_MULTIPLIER,
    layoutScaleMultiplier ?? (FORCE_LAYOUT_DEFAULTS.layoutScaleMultiplier || 1)
  );
  const initialIterationPreset = layoutIterationPreset ?? (FORCE_LAYOUT_DEFAULTS.iterationPreset || 'balanced');
  const initialAlphaDecay = LAYOUT_ITERATION_PRESETS[initialIterationPreset]?.alphaDecay ?? defaultAlphaDecay;
  const [scaleMultiplier, setScaleMultiplier] = useState(initialScaleMultiplier);
  const [iterationPreset, setIterationPreset] = useState(initialIterationPreset);
  const [simulationSpeed, setSimulationSpeed] = useState(1.0);
  const baseNodeSeparationMultiplier = FORCE_LAYOUT_DEFAULTS.nodeSeparationMultiplier || 1.25;
  const nodeSeparationMultiplier = baseNodeSeparationMultiplier * scaleMultiplier;
  const scalePresetEntries = Object.entries(LAYOUT_SCALE_PRESETS);
  const iterationPresetEntries = Object.entries(LAYOUT_ITERATION_PRESETS);

  // Force simulation parameters (optimized defaults)
  const {
    repulsionStrength: defaultRepulsion,
    attractionStrength: defaultAttraction,
    linkDistance: defaultLinkDistance,
    minLinkDistance: defaultMinLinkDistance,
    centerStrength: defaultCenterStrength,
    collisionRadius: defaultCollisionRadius,
    edgeAvoidance: defaultEdgeAvoidance,
    alphaDecay: defaultAlphaDecay,
    velocityDecay: defaultVelocityDecay,
    // Group forces
    groupAttractionStrength: defaultGroupAttraction = 0.6,
    groupRepulsionStrength: defaultGroupRepulsion = 2.0,
    groupExclusionStrength: defaultGroupExclusion = 1.5,
    minGroupDistance: defaultMinGroupDistance = 800,
    groupBoundaryPadding: defaultGroupBoundaryPadding = 100,
    stiffness: defaultStiffness = 0.6
  } = FORCE_LAYOUT_DEFAULTS;

  const [params, setParams] = useState({
    repulsionStrength: defaultRepulsion,
    attractionStrength: defaultAttraction,
    linkDistance: defaultLinkDistance,
    minLinkDistance: defaultMinLinkDistance,
    centerStrength: defaultCenterStrength,
    collisionRadius: defaultCollisionRadius,
    edgeAvoidance: defaultEdgeAvoidance,
    alphaDecay: initialAlphaDecay,
    velocityDecay: defaultVelocityDecay,
    // Group forces
    groupAttractionStrength: defaultGroupAttraction,
    groupRepulsionStrength: defaultGroupRepulsion,
    groupExclusionStrength: defaultGroupExclusion,
    minGroupDistance: defaultMinGroupDistance,
    groupBoundaryPadding: defaultGroupBoundaryPadding,
    stiffness: defaultStiffness
  });

  // Simulation state
  const [displayIteration, setDisplayIteration] = useState(0);
  const [displayAlpha, setDisplayAlpha] = useState(1.0);
  const [showJson, setShowJson] = useState(false);
  const simulationState = useRef({
    velocities: new Map(), // instanceId -> {vx, vy}
    alpha: 1.0,
    iteration: 0
  });
  const lastDisplayUpdate = useRef(0);

  const handleScaleMultiplierChange = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const clamped = Math.max(0.2, Math.min(MAX_LAYOUT_SCALE_MULTIPLIER, numeric));
    const rounded = Math.round(clamped * 100) / 100;
    setScaleMultiplier(rounded);
    onLayoutScaleMultiplierChange?.(rounded);
  };

  const handleResetScale = () => {
    setScaleMultiplier(1);
    onLayoutScaleMultiplierChange?.(1);
  };

  const handleCopySettings = async () => {
    // Build settings JSON
    const settings = {
      // Scale settings
      layoutScale: layoutScalePreset,
      layoutScaleMultiplier: scaleMultiplier,
      simulationSpeed: simulationSpeed,
      iterationPreset: iterationPreset,
      // Force parameters
      repulsionStrength: params.repulsionStrength,
      attractionStrength: params.attractionStrength,
      linkDistance: params.linkDistance,
      minLinkDistance: params.minLinkDistance,
      centerStrength: params.centerStrength,
      collisionRadius: params.collisionRadius,
      edgeAvoidance: params.edgeAvoidance,
      alphaDecay: params.alphaDecay,
      velocityDecay: params.velocityDecay,
      // Group forces
      groupAttractionStrength: params.groupAttractionStrength,
      groupRepulsionStrength: params.groupRepulsionStrength,
      groupExclusionStrength: params.groupExclusionStrength,
      minGroupDistance: params.minGroupDistance,
      groupBoundaryPadding: params.groupBoundaryPadding,
      stiffness: params.stiffness
    };

    const json = JSON.stringify(settings, null, 2);
    let copySuccess = false;

    try {
      // Try Electron clipboard first
      if (window.electron?.clipboard?.writeText) {
        await window.electron.clipboard.writeText(json);
        copySuccess = true;
        console.log('✓ Copied via Electron clipboard');
      }
      // Try standard clipboard API
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        copySuccess = true;
        console.log('✓ Copied via Navigator clipboard');
      }
    } catch (err) {
      console.error('Primary clipboard methods failed:', err);

      // Fallback: textarea method
      try {
        const textArea = document.createElement("textarea");
        textArea.value = json;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        copySuccess = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (copySuccess) {
          console.log('✓ Copied via fallback method');
        }
      } catch (fallbackErr) {
        console.error('All clipboard methods failed:', fallbackErr);
      }
    }

    // Visual feedback
    const btn = document.querySelector('.force-sim-btn[title*="Copy"]');
    if (btn) {
      const originalHTML = btn.innerHTML;
      if (copySuccess) {
        btn.innerHTML = '✓ Copied!';
        btn.style.backgroundColor = '#2E7D32';
      } else {
        btn.innerHTML = '✗ Copy Failed';
        btn.style.backgroundColor = '#B71C1C';
      }
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.style.backgroundColor = '';
      }, 1500);
    }

    // Alert user if failed
    if (!copySuccess) {
      alert('Failed to copy to clipboard. Please use the "Show JSON" button and copy manually.');
    }
  };

  const handleIterationPresetChange = (presetKey) => {
    if (!LAYOUT_ITERATION_PRESETS[presetKey]) return;
    setIterationPreset(presetKey);
    onLayoutIterationPresetChange?.(presetKey);
    const preset = LAYOUT_ITERATION_PRESETS[presetKey];
    if (preset?.alphaDecay !== undefined) {
      setParams(prev => ({ ...prev, alphaDecay: preset.alphaDecay }));
    }
  };

  const handleScalePresetChange = (presetKey) => {
    if (!LAYOUT_SCALE_PRESETS[presetKey]) return;
    onLayoutScalePresetChange?.(presetKey);
    const preset = LAYOUT_SCALE_PRESETS[presetKey];
    if (preset?.linkDistance) {
      setParams(prev => {
        const nextLinkDistance = preset.linkDistance;
        const maxMinLink = Math.max(60, nextLinkDistance - 20);
        const nextMinLink = Math.min(prev.minLinkDistance, maxMinLink);
        return {
          ...prev,
          linkDistance: nextLinkDistance,
          minLinkDistance: nextMinLink
        };
      });
    }
    handleScaleMultiplierChange(1);
  };

  const getNodeRadiusWithPadding = (node) => {
    const fallbackRadius = (params.collisionRadius || defaultCollisionRadius) * scaleMultiplier;
    if (!node) return fallbackRadius;
    const base = Math.max(node.width || 0, node.height || 0) / 2;
    if (!base || !Number.isFinite(base)) {
      return fallbackRadius;
    }
    const padding = fallbackRadius * 0.25;
    const imageBonus = Math.max(node.imageHeight || 0, 0) * (FORCE_LAYOUT_DEFAULTS.imageRadiusMultiplier || 0.8);
    return base + padding + imageBonus;
  };

  // Initialize velocities when modal opens + add jitter for stacked nodes
  useEffect(() => {
    if (isOpen) {
      const nodes = getNodes();

      // Check if nodes are stacked (within 50px of each other)
      let hasStackedNodes = false;
      if (nodes.length > 1) {
        for (let i = 0; i < nodes.length - 1; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 50) {
              hasStackedNodes = true;
              break;
            }
          }
          if (hasStackedNodes) break;
        }
      }

      // If nodes are stacked, add initial jitter to break symmetry
      if (hasStackedNodes) {
        console.log('[ForceSim] Detected stacked nodes, applying jitter');
        const jitterRadius = 100;
        const updates = nodes.map(node => ({
          instanceId: node.id,
          x: node.x + (Math.random() - 0.5) * jitterRadius * 2,
          y: node.y + (Math.random() - 0.5) * jitterRadius * 2
        }));

        storeActions.updateMultipleNodeInstancePositions(
          graphId,
          updates,
          { skipSave: true }
        );
        onNodePositionsUpdated?.();
      }

      // Initialize velocities with slight random impulse
      const velocities = new Map();
      nodes.forEach(node => {
        velocities.set(node.id, {
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2
        });
      });

      simulationState.current = {
        velocities,
        alpha: 1.0,
        iteration: 0
      };
      lastDisplayUpdate.current = 0;
      setDisplayIteration(0);
      setDisplayAlpha(1.0);
    }
  }, [isOpen, getNodes, graphId, storeActions]);

  useEffect(() => {
    if (typeof layoutScaleMultiplier === 'number' && !Number.isNaN(layoutScaleMultiplier)) {
      setScaleMultiplier(layoutScaleMultiplier);
    }
  }, [layoutScaleMultiplier]);

  useEffect(() => {
    if (!layoutIterationPreset) return;
    setIterationPreset(layoutIterationPreset);
    const preset = LAYOUT_ITERATION_PRESETS[layoutIterationPreset];
    if (preset?.alphaDecay === undefined) return;
    setParams(prev => {
      if (Math.abs(prev.alphaDecay - preset.alphaDecay) < 0.0001) {
        return prev;
      }
      return { ...prev, alphaDecay: preset.alphaDecay };
    });
  }, [layoutIterationPreset]);

  // Force simulation step - applies directly to the store!
  const simulationStep = () => {
    const state = simulationState.current;
    if (state.alpha < 0.001) {
      setIsRunning(false);
      return;
    }

    const nodes = getNodes();
    const nodesById = new Map(nodes.map(node => [node.id, node]));
    const draggedIds = getDraggedNodeIds(); // Get currently dragged nodes to exclude from forces
    const nodeRadiusCache = new Map();
    const getRadius = (node) => {
      if (!node) return (params.collisionRadius || defaultCollisionRadius) * scaleMultiplier;
      if (nodeRadiusCache.has(node.id)) return nodeRadiusCache.get(node.id);
      const radius = getNodeRadiusWithPadding(node);
      nodeRadiusCache.set(node.id, radius);
      return radius;
    };
    const edges = getEdges();
    const velocities = state.velocities;

    const {
      repulsionStrength,
      attractionStrength,
      linkDistance,
      minLinkDistance,
      centerStrength,
      collisionRadius,
      edgeAvoidance,
      alphaDecay,
      velocityDecay
    } = params;
    const scaledLinkDistance = linkDistance * scaleMultiplier;
    const scaledMinLinkDistance = minLinkDistance * scaleMultiplier;
    const scaledCollisionRadius = collisionRadius * scaleMultiplier;

    // Apply velocity decay
    velocities.forEach(vel => {
      vel.vx *= velocityDecay;
      vel.vy *= velocityDecay;
    });

    // Repulsion force (n-body) - improved with distance cap
    // Dragged nodes still repel others, but don't receive forces themselves
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        const velA = velocities.get(nodeA.id);
        const velB = velocities.get(nodeB.id);
        const aIsDragged = draggedIds.has(nodeA.id);
        const bIsDragged = draggedIds.has(nodeB.id);

        if (!velA || !velB) continue;

        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distSq = Math.max(dx * dx + dy * dy, 1); // Prevent division by zero
        const dist = Math.sqrt(distSq) || 0.0001;

        // Only apply repulsion within a certain range (performance + stability)
        const maxRepulsionDist = scaledLinkDistance * 3;
        if (dist > maxRepulsionDist) continue;

        // Inverse square law with alpha scaling
        const radiusA = getRadius(nodeA);
        const radiusB = getRadius(nodeB);
        const minDistance = (radiusA + radiusB) * nodeSeparationMultiplier;
        const effectiveDistance = Math.max(dist, minDistance);
        const force = (repulsionStrength * state.alpha) / (effectiveDistance * effectiveDistance);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        // Only apply forces to non-dragged nodes
        if (!aIsDragged) {
          velA.vx -= fx;
          velA.vy -= fy;
        }
        if (!bIsDragged) {
          velB.vx += fx;
          velB.vy += fy;
        }
      }
    }

    // Attraction/Repulsion force along edges - maintains distance range
    // Dragged nodes are fixed, so only apply forces to non-dragged endpoints
    edges.forEach(edge => {
      const source = nodesById.get(edge.sourceId);
      const target = nodesById.get(edge.destinationId);

      if (!source || !target) return;

      const velSource = velocities.get(source.id);
      const velTarget = velocities.get(target.id);
      const sourceIsDragged = draggedIds.has(source.id);
      const targetIsDragged = draggedIds.has(target.id);

      if (!velSource || !velTarget) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const radiusSource = getRadius(source);
      const radiusTarget = getRadius(target);
      // Min distance is the SLIDER value, not computed from radii
      const minDistance = scaledMinLinkDistance;
      let force;

      // ENFORCE MINIMUM DISTANCE - VERY strong repulsion if too close
      if (dist < minDistance) {
        // Push apart HARD when below minimum - exponentially stronger as they get closer
        const ratio = dist / minDistance; // 0 to 1
        const deficit = minDistance - dist;
        // Much stronger: 10x base, plus exponential boost when very close
        const intensityMultiplier = 10 + (1 - ratio) * 20; // 10-30x depending on how close
        force = -deficit * attractionStrength * intensityMultiplier * state.alpha;
      }
      // Normal spring behavior between min and target
      else if (dist < scaledLinkDistance) {
        // Gentle pull toward target distance
        const displacement = dist - scaledLinkDistance;
        force = displacement * attractionStrength * state.alpha;
      }
      // Pull together if too far
      else {
        // Normal spring pull
        const displacement = dist - scaledLinkDistance;
        force = displacement * attractionStrength * state.alpha;
      }

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      // Only apply forces to non-dragged nodes
      if (!sourceIsDragged) {
        velSource.vx += fx;
        velSource.vy += fy;
      }
      if (!targetIsDragged) {
        velTarget.vx -= fx;
        velTarget.vy -= fy;
      }
    });

    // Edge avoidance force - push nodes away from edges they're not part of
    // Skip dragged nodes - they're fixed in place
    if (edgeAvoidance > 0) {
      // Pre-build node map for faster lookup
      const nodesMap = new Map(nodes.map(n => [n.id, n]));
      
      nodes.forEach(node => {
        // Skip dragged nodes
        if (draggedIds.has(node.id)) return;
        
        const vel = velocities.get(node.id);
        if (!vel) return;
        const nodeRadius = getRadius(node);

        edges.forEach(edge => {
          // Skip if node is part of this edge
          if (edge.sourceId === node.id || edge.destinationId === node.id) return;

          const source = nodesMap.get(edge.sourceId);
          const target = nodesMap.get(edge.destinationId);
          if (!source || !target) return;

          // Calculate distance from node to line segment (edge)
          const edgeVecX = target.x - source.x;
          const edgeVecY = target.y - source.y;
          const edgeLengthSq = edgeVecX * edgeVecX + edgeVecY * edgeVecY;

          if (edgeLengthSq < 1) return; // Skip degenerate edges

          // Project node onto edge line
          const nodeVecX = node.x - source.x;
          const nodeVecY = node.y - source.y;
          const t = Math.max(0, Math.min(1, (nodeVecX * edgeVecX + nodeVecY * edgeVecY) / edgeLengthSq));

          // Closest point on edge to node
          const closestX = source.x + t * edgeVecX;
          const closestY = source.y + t * edgeVecY;

          // Distance from node to closest point on edge
          const dx = node.x - closestX;
          const dy = node.y - closestY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Avoidance radius is based on node size + extra buffer
          // Larger radius = nodes stay further from edges
          const avoidanceRadius = nodeRadius * 2 + scaledLinkDistance * 0.3;
          
          if (dist < avoidanceRadius && dist > 1) {
            // Push node away from edge - exponential falloff for stronger close-range push
            const ratio = dist / avoidanceRadius; // 0 to 1
            // Exponential: much stronger when close, gentler when far
            const intensity = Math.pow(1 - ratio, 2); // Quadratic falloff
            // Scale by edgeAvoidance slider (0-1 typically) * 500 for significant effect
            const force = intensity * edgeAvoidance * state.alpha * 500;
            vel.vx += (dx / dist) * force;
            vel.vy += (dy / dist) * force;
          }
        });
      });
    }

    // Center force - skip dragged nodes
    const centerX = 0;
    const centerY = 0;
    nodes.forEach(node => {
      if (draggedIds.has(node.id)) return; // Skip dragged nodes
      const vel = velocities.get(node.id);
      if (vel) {
        vel.vx += (centerX - node.x) * centerStrength * state.alpha;
        vel.vy += (centerY - node.y) * centerStrength * state.alpha;
      }
    });

    // Group forces - pull members together, push different groups apart
    const currentGroups = getGroups();
    if (currentGroups.length > 0) {
      const {
        groupAttractionStrength: gAttract,
        groupRepulsionStrength: gRepulse,
        groupExclusionStrength: gExclude,
        minGroupDistance: gMinDist,
        groupBoundaryPadding: gPadding
      } = params;

      // Build node-to-group membership map
      const nodeGroupsMap = new Map();
      currentGroups.forEach(group => {
        (group.memberInstanceIds || []).forEach(nodeId => {
          if (!nodeGroupsMap.has(nodeId)) nodeGroupsMap.set(nodeId, new Set());
          nodeGroupsMap.get(nodeId).add(group.id);
        });
      });

      // 1. Calculate group centroids from current positions
      const groupCentroids = new Map();
      currentGroups.forEach(group => {
        let sumX = 0, sumY = 0, count = 0;
        (group.memberInstanceIds || []).forEach(nodeId => {
          const node = nodesById.get(nodeId);
          if (node) { sumX += node.x; sumY += node.y; count++; }
        });
        if (count > 0) {
          groupCentroids.set(group.id, { x: sumX / count, y: sumY / count });
        }
      });

      // 2. Intra-group attraction: pull members toward centroid
      nodes.forEach(node => {
        if (draggedIds.has(node.id)) return;
        const groupIds = nodeGroupsMap.get(node.id);
        if (!groupIds || groupIds.size === 0) return;
        const vel = velocities.get(node.id);
        if (!vel) return;

        groupIds.forEach(groupId => {
          const centroid = groupCentroids.get(groupId);
          if (!centroid) return;
          const dx = centroid.x - node.x;
          const dy = centroid.y - node.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.1) return;
          const strength = gAttract * state.alpha / groupIds.size;
          const pullDist = Math.max(dist, 50);
          vel.vx += (dx / dist) * strength * pullDist;
          vel.vy += (dy / dist) * strength * pullDist;
        });
      });

      // 3. Inter-group repulsion: push nodes in different groups apart
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const g1 = nodeGroupsMap.get(n1.id);
          const g2 = nodeGroupsMap.get(n2.id);
          if (!g1 || g1.size === 0 || !g2 || g2.size === 0) continue;
          let sharesGroup = false;
          for (const gid of g1) { if (g2.has(gid)) { sharesGroup = true; break; } }
          if (sharesGroup) continue;

          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > gMinDist * 1.5) continue;

          const overlap = Math.max(0, gMinDist - dist);
          const falloff = dist < gMinDist ? 1.0 : Math.max(0, 1 - (dist - gMinDist) / (gMinDist * 0.5));
          const pushStrength = (overlap * gRepulse * state.alpha) + (gRepulse * state.alpha * 20 * falloff);
          const ux = dx / Math.max(dist, 1);
          const uy = dy / Math.max(dist, 1);

          const v1 = velocities.get(n1.id);
          const v2 = velocities.get(n2.id);
          if (v1 && !draggedIds.has(n1.id)) { v1.vx -= ux * pushStrength; v1.vy -= uy * pushStrength; }
          if (v2 && !draggedIds.has(n2.id)) { v2.vx += ux * pushStrength; v2.vy += uy * pushStrength; }
        }
      }

      // 4. Group exclusion: push non-members out of group bounding boxes
      const groupBounds = new Map();
      currentGroups.forEach(group => {
        let minGX = Infinity, minGY = Infinity, maxGX = -Infinity, maxGY = -Infinity;
        (group.memberInstanceIds || []).forEach(nodeId => {
          const node = nodesById.get(nodeId);
          if (node) {
            minGX = Math.min(minGX, node.x);
            minGY = Math.min(minGY, node.y);
            maxGX = Math.max(maxGX, node.x + (node.width || 100));
            maxGY = Math.max(maxGY, node.y + (node.height || 60));
          }
        });
        if (minGX !== Infinity) {
          groupBounds.set(group.id, {
            minX: minGX - gPadding, minY: minGY - gPadding,
            maxX: maxGX + gPadding, maxY: maxGY + gPadding,
            centerX: (minGX + maxGX) / 2, centerY: (minGY + maxGY) / 2
          });
        }
      });

      nodes.forEach(node => {
        if (draggedIds.has(node.id)) return;
        const vel = velocities.get(node.id);
        if (!vel) return;
        const nodeGroups = nodeGroupsMap.get(node.id) || new Set();
        const cx = node.x + (node.width || 100) / 2;
        const cy = node.y + (node.height || 60) / 2;

        currentGroups.forEach(group => {
          if (nodeGroups.has(group.id)) return;
          const bounds = groupBounds.get(group.id);
          if (!bounds) return;
          if (cx >= bounds.minX && cx <= bounds.maxX && cy >= bounds.minY && cy <= bounds.maxY) {
            // Push radially away from group center (not toward nearest edge)
            // This prevents trapping nodes on wrong side of groups
            const dx = cx - bounds.centerX;
            const dy = cy - bounds.centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const push = gExclude * state.alpha * 50;
            if (dist > 0.1) {
              vel.vx += (dx / dist) * push;
              vel.vy += (dy / dist) * push;
            } else {
              // Node at group center — push in random direction
              const angle = Math.random() * Math.PI * 2;
              vel.vx += Math.cos(angle) * push;
              vel.vy += Math.sin(angle) * push;
            }
          }
        });
      });
    }

    // Update positions in bulk (apply speed multiplier)
    // Skip dragged nodes - they're controlled by the user
    const updates = [];
    nodes.forEach(node => {
      if (draggedIds.has(node.id)) return; // Skip dragged nodes
      const vel = velocities.get(node.id);
      if (vel) {
        updates.push({
          instanceId: node.id,
          x: node.x + vel.vx * simulationSpeed,
          y: node.y + vel.vy * simulationSpeed
        });
      }
    });

    // Apply STRONG collision detection to updates with padding
    // Dragged nodes are not in updates array, but we still need to avoid them
    // First, collect current positions of dragged nodes for collision
    const draggedPositions = [];
    draggedIds.forEach(id => {
      const node = nodesById.get(id);
      if (node) {
        draggedPositions.push({ instanceId: id, x: node.x, y: node.y, isDragged: true });
      }
    });

    for (let i = 0; i < updates.length; i++) {
      for (let j = i + 1; j < updates.length; j++) {
        const updateA = updates[i];
        const updateB = updates[j];

        const dx = updateB.x - updateA.x;
        const dy = updateB.y - updateA.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const nodeA = nodesById.get(updateA.instanceId);
        const nodeB = nodesById.get(updateB.instanceId);
        const radiusA = getRadius(nodeA);
        const radiusB = getRadius(nodeB);
        const minDist = (radiusA + radiusB) * nodeSeparationMultiplier;

        if (dist < minDist && dist > 0) {
          // Strong separation with extra push
          const overlap = minDist - dist;
          const angle = Math.atan2(dy, dx);
          const pushFactor = 0.6; // Push harder (was 0.5)
          const moveX = Math.cos(angle) * overlap * pushFactor;
          const moveY = Math.sin(angle) * overlap * pushFactor;

          updateA.x -= moveX;
          updateA.y -= moveY;
          updateB.x += moveX;
          updateB.y += moveY;
        }
      }
    }

    // Collision with dragged nodes - push non-dragged away, dragged stays fixed
    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      for (const dragged of draggedPositions) {
        const dx = update.x - dragged.x;
        const dy = update.y - dragged.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const nodeUpdate = nodesById.get(update.instanceId);
        const nodeDragged = nodesById.get(dragged.instanceId);
        const radiusUpdate = getRadius(nodeUpdate);
        const radiusDragged = getRadius(nodeDragged);
        const minDist = (radiusUpdate + radiusDragged) * nodeSeparationMultiplier;

        if (dist < minDist && dist > 0) {
          // Push the non-dragged node away (full push since dragged is fixed)
          const overlap = minDist - dist;
          const angle = Math.atan2(dy, dx);
          update.x += Math.cos(angle) * overlap;
          update.y += Math.sin(angle) * overlap;
        }
      }
    }

    // Apply to store (batch update)
    if (updates.length > 0) {
      storeActions.updateMultipleNodeInstancePositions(
        graphId,
        updates,
        { skipSave: true } // Don't save every frame
      );
      onNodePositionsUpdated?.();
    }

    // Decay alpha
    state.alpha *= (1 - alphaDecay);
    state.iteration++;

    // Only update display every 10 frames to avoid excessive re-renders
    if (state.iteration - lastDisplayUpdate.current >= 10) {
      lastDisplayUpdate.current = state.iteration;
      setDisplayIteration(state.iteration);
      setDisplayAlpha(state.alpha);
    }
  };

  // Store latest simulationStep in a ref so the animation loop always uses current values
  const simulationStepRef = useRef(simulationStep);
  useEffect(() => {
    simulationStepRef.current = simulationStep;
  });

  // Animation loop - only depends on isRunning to avoid restarts
  useEffect(() => {
    if (isRunning) {
      const animate = () => {
        simulationStepRef.current();
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }
  }, [isRunning]);

  // NOTE: Removed auto-step on param change while paused for performance
  // Users can manually click Play to see changes

  // Dragging logic
  const handleMouseDown = (e) => {
    if (e.target.closest('.force-sim-header')) {
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
    }
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  const handleReset = () => {
    setIsRunning(false);
    simulationState.current.alpha = 1.0;
    simulationState.current.iteration = 0;

    // Reset velocities with random impulse
    const velocities = new Map();
    const nodes = getNodes();
    nodes.forEach(node => {
      velocities.set(node.id, {
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5
      });
    });
    simulationState.current.velocities = velocities;
    lastDisplayUpdate.current = 0;
    setDisplayIteration(0);
    setDisplayAlpha(1.0);
  };

  const handleRandomize = () => {
    const nodes = getNodes();
    const spreadRadius = 200;

    const updates = nodes.map(node => ({
      instanceId: node.id,
      x: node.x + (Math.random() - 0.5) * spreadRadius * 2,
      y: node.y + (Math.random() - 0.5) * spreadRadius * 2
    }));

    if (updates.length > 0) {
      storeActions.updateMultipleNodeInstancePositions(
        graphId,
        updates,
        { skipSave: true }
      );
      onNodePositionsUpdated?.();
    }

    // Reset simulation
    handleReset();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="force-sim-modal"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="force-sim-header" style={{ cursor: 'grab' }}>
        <h3>Force Simulation Tuner</h3>
        <button className="force-sim-close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="force-sim-body">
        {/* Stats */}
        <div className="force-sim-stats-box">
          <div className="force-sim-stat">
            <span className="force-sim-stat-label">Iteration:</span>
            <span className="force-sim-stat-value">{displayIteration}</span>
          </div>
          <div className="force-sim-stat">
            <span className="force-sim-stat-label">Alpha:</span>
            <span className="force-sim-stat-value">{displayAlpha.toFixed(4)}</span>
          </div>
          <div className="force-sim-stat">
            <span className="force-sim-stat-label">Status:</span>
            <span className="force-sim-stat-value">{isRunning ? '🟢 Running' : '⏸️ Paused'}</span>
          </div>
        </div>

        <div className="force-sim-info">
          💡 <strong>Edge Avoidance</strong> pushes nodes away from crossing over edges. <strong>Min Link Length</strong> keeps connected nodes apart.
        </div>

        {/* Controls */}
        <div className="force-sim-controls">
          <div className="force-sim-buttons">
            <button
              className="force-sim-btn"
              onClick={() => setIsRunning(!isRunning)}
            >
              {isRunning ? <Pause size={16} /> : <Play size={16} />}
              {isRunning ? 'Pause' : 'Play'}
            </button>
            <button className="force-sim-btn" onClick={handleReset}>
              <RotateCcw size={16} />
              Reset
            </button>
            <button className="force-sim-btn force-sim-btn-secondary" onClick={handleRandomize}>
              🎲 Randomize
            </button>
            <button className="force-sim-btn" onClick={handleCopySettings} title="Copy settings JSON to clipboard">
              📋 Copy
            </button>
            <button className="force-sim-btn" onClick={() => setShowJson(!showJson)}>
              {showJson ? '🔼 Hide JSON' : '🔽 Show JSON'}
            </button>
          </div>

          {/* JSON textarea (conditionally rendered) */}
          {showJson && (
            <div className="force-sim-json-container">
              <textarea
                readOnly
                value={JSON.stringify({
                  layoutScale: layoutScalePreset,
                  layoutScaleMultiplier: scaleMultiplier,
                  simulationSpeed: simulationSpeed,
                  iterationPreset: iterationPreset,
                  repulsionStrength: params.repulsionStrength,
                  attractionStrength: params.attractionStrength,
                  linkDistance: params.linkDistance,
                  minLinkDistance: params.minLinkDistance,
                  centerStrength: params.centerStrength,
                  collisionRadius: params.collisionRadius,
                  edgeAvoidance: params.edgeAvoidance,
                  alphaDecay: params.alphaDecay,
                  velocityDecay: params.velocityDecay,
                  groupAttractionStrength: params.groupAttractionStrength,
                  groupRepulsionStrength: params.groupRepulsionStrength,
                  groupExclusionStrength: params.groupExclusionStrength,
                  minGroupDistance: params.minGroupDistance,
                  groupBoundaryPadding: params.groupBoundaryPadding,
                  stiffness: params.stiffness
                }, null, 2)}
                className="force-sim-json-textarea"
                onClick={(e) => e.target.select()}
              />
            </div>
          )}

          <div className="force-sim-preset-row">
            <div className="force-sim-preset-label">Layout Iterations</div>
            <div className="force-sim-chip-row">
              {iterationPresetEntries.map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  className={`force-sim-chip ${iterationPreset === key ? 'active' : ''}`}
                  onClick={() => handleIterationPresetChange(key)}
                >
                  <span>{key === 'fast' ? 'Fast' : key === 'deep' ? 'Deep' : 'Balanced'}</span>
                  <small>{preset.iterations} iters</small>
                </button>
              ))}
            </div>
          </div>

          {/* Parameters */}
          <div className="force-sim-params">
            <div className="force-sim-param">
              <label>Layout Scale</label>
              <input
                type="range"
                min="0.2"
                max={MAX_LAYOUT_SCALE_MULTIPLIER}
                step="0.05"
                value={scaleMultiplier}
                onChange={(e) => handleScaleMultiplierChange(e.target.value)}
              />
              <span>{scaleMultiplier.toFixed(2)}×</span>
              <div className="force-sim-chip-group">
                {scalePresetEntries.map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    className={`force-sim-chip ${layoutScalePreset === key ? 'active' : ''}`}
                    onClick={() => handleScalePresetChange(key)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="force-sim-chip-group">
                <button type="button" className="force-sim-chip" onClick={handleResetScale}>
                  Reset scale
                </button>
              </div>
            </div>

            <div className="force-sim-param">
              <label>Speed</label>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={simulationSpeed}
                onChange={(e) => setSimulationSpeed(Number(e.target.value))}
              />
              <span>{simulationSpeed.toFixed(1)}×</span>
              <div className="force-sim-chip-group">
                <button type="button" className="force-sim-chip" onClick={() => setSimulationSpeed(0.5)}>
                  0.5×
                </button>
                <button type="button" className="force-sim-chip" onClick={() => setSimulationSpeed(1.0)}>
                  1×
                </button>
                <button type="button" className="force-sim-chip" onClick={() => setSimulationSpeed(2.0)}>
                  2×
                </button>
              </div>
            </div>

            <div className="force-sim-param">
              <label>Repulsion</label>
              <input
                type="range"
                min="200"
                max="4000"
                step="100"
                value={params.repulsionStrength}
                onChange={(e) => setParams({ ...params, repulsionStrength: Number(e.target.value) })}
              />
              <span>{params.repulsionStrength}</span>
            </div>

            <div className="force-sim-param">
              <label>Attraction</label>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={params.attractionStrength}
                onChange={(e) => setParams({ ...params, attractionStrength: Number(e.target.value) })}
              />
              <span>{params.attractionStrength.toFixed(2)}</span>
            </div>

            <div className="force-sim-param">
              <label>Link Distance</label>
              <input
                type="range"
                min="80"
                max="500"
                step="10"
                value={params.linkDistance}
                onChange={(e) => {
                  const newDist = Number(e.target.value);
                  setParams({
                    ...params,
                    linkDistance: newDist,
                    // Keep minLinkDistance below linkDistance
                    minLinkDistance: Math.min(params.minLinkDistance, Math.max(60, newDist - 20))
                  });
                }}
              />
              <span>{Math.round(params.linkDistance * scaleMultiplier)}px</span>
            </div>

            <div className="force-sim-param">
              <label>Min Link Length</label>
              <input
                type="range"
                min="60"
                max={Math.max(80, params.linkDistance - 20)}
                step="10"
                value={params.minLinkDistance}
                onChange={(e) => setParams({ ...params, minLinkDistance: Number(e.target.value) })}
              />
              <span>{Math.round(params.minLinkDistance * scaleMultiplier)}px</span>
            </div>

            <div className="force-sim-param">
              <label>Damping</label>
              <input
                type="range"
                min="0.3"
                max="0.9"
                step="0.05"
                value={params.velocityDecay}
                onChange={(e) => setParams({ ...params, velocityDecay: Number(e.target.value) })}
              />
              <span>{params.velocityDecay.toFixed(2)}</span>
            </div>

            <div className="force-sim-param">
              <label>Node Size</label>
              <input
                type="range"
                min="40"
                max="150"
                step="5"
                value={params.collisionRadius}
                onChange={(e) => setParams({ ...params, collisionRadius: Number(e.target.value) })}
              />
              <span>{Math.round(params.collisionRadius * scaleMultiplier)}px</span>
            </div>

            <div className="force-sim-param">
              <label>Edge Avoidance</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={params.edgeAvoidance}
                onChange={(e) => setParams({ ...params, edgeAvoidance: Number(e.target.value) })}
              />
              <span>{params.edgeAvoidance.toFixed(2)}</span>
            </div>

            <div className="force-sim-param">
              <label>Center Pull</label>
              <input
                type="range"
                min="0"
                max="0.3"
                step="0.01"
                value={params.centerStrength}
                onChange={(e) => setParams({ ...params, centerStrength: Number(e.target.value) })}
              />
              <span>{params.centerStrength.toFixed(2)}</span>
            </div>

            <div className="force-sim-param">
              <label>Cooling Rate</label>
              <input
                type="range"
                min="0.005"
                max="0.05"
                step="0.001"
                value={params.alphaDecay}
                onChange={(e) => setParams({ ...params, alphaDecay: Number(e.target.value) })}
              />
              <span>{params.alphaDecay.toFixed(3)}</span>
            </div>

            <div className="force-sim-param">
              <label>Stiffness</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={params.stiffness}
                onChange={(e) => setParams({ ...params, stiffness: Number(e.target.value) })}
              />
              <span>{params.stiffness.toFixed(2)}</span>
            </div>
          </div>

          {/* Group Forces Section */}
          <div className="force-sim-section">
            <h4 className="force-sim-section-title">🎯 Group Forces</h4>
            
            <div className="force-sim-param">
              <label>Group Attraction</label>
              <input
                type="range"
                min="0"
                max="2.0"
                step="0.05"
                value={params.groupAttractionStrength}
                onChange={(e) => setParams({ ...params, groupAttractionStrength: Number(e.target.value) })}
              />
              <span>{params.groupAttractionStrength.toFixed(2)}</span>
            </div>

            <div className="force-sim-param">
              <label>Group Repulsion</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={params.groupRepulsionStrength}
                onChange={(e) => setParams({ ...params, groupRepulsionStrength: Number(e.target.value) })}
              />
              <span>{params.groupRepulsionStrength.toFixed(2)}</span>
            </div>

            <div className="force-sim-param">
              <label>Group Exclusion</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={params.groupExclusionStrength}
                onChange={(e) => setParams({ ...params, groupExclusionStrength: Number(e.target.value) })}
              />
              <span>{params.groupExclusionStrength.toFixed(2)}</span>
            </div>

            <div className="force-sim-param">
              <label>Min Group Distance</label>
              <input
                type="range"
                min="100"
                max="1500"
                step="25"
                value={params.minGroupDistance}
                onChange={(e) => setParams({ ...params, minGroupDistance: Number(e.target.value) })}
              />
              <span>{Math.round(params.minGroupDistance)}px</span>
            </div>

            <div className="force-sim-param">
              <label>Group Padding</label>
              <input
                type="range"
                min="0"
                max="150"
                step="10"
                value={params.groupBoundaryPadding}
                onChange={(e) => setParams({ ...params, groupBoundaryPadding: Number(e.target.value) })}
              />
              <span>{Math.round(params.groupBoundaryPadding)}px</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForceSimulationModal;

