import { useState, useRef, useEffect, useCallback } from 'react';
import {
  FORCE_LAYOUT_DEFAULTS,
  LAYOUT_ITERATION_PRESETS,
  LAYOUT_SCALE_PRESETS,
  MAX_LAYOUT_SCALE_MULTIPLIER
} from '../services/graphLayoutService.js';

/**
 * Custom hook encapsulating the force-directed simulation engine.
 * Handles all physics computation, animation loop, parameter management,
 * and auto-start/auto-stop behavior. No UI concerns.
 */
export function useForceSimulation({
  graphId,
  enabled,
  getNodes,
  getEdges,
  getGroups = () => [],
  getDraggedNodeIds = () => new Set(),
  onPositionsUpdated,
  onSimulationComplete,
  storeActions,
  autoStart = false,
  autoLayoutDuration = 1000,
  layoutScaleMultiplier: externalScaleMultiplier,
  layoutIterationPreset: externalIterationPreset,
  onLayoutScaleMultiplierChange,
  onLayoutIterationPresetChange,
  onLayoutScalePresetChange,
}) {
  // --- Defaults ---
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
    groupAttractionStrength: defaultGroupAttraction = 0.6,
    groupRepulsionStrength: defaultGroupRepulsion = 4.8,
    groupExclusionStrength: defaultGroupExclusion = 1.5,
    minGroupDistance: defaultMinGroupDistance = 800,
    groupBoundaryPadding: defaultGroupBoundaryPadding = 100,
    stiffness: defaultStiffness = 0.6
  } = FORCE_LAYOUT_DEFAULTS;

  const initialScaleMultiplier = Math.min(
    MAX_LAYOUT_SCALE_MULTIPLIER,
    externalScaleMultiplier ?? (FORCE_LAYOUT_DEFAULTS.layoutScaleMultiplier || 1)
  );
  const initialIterationPreset = externalIterationPreset ?? (FORCE_LAYOUT_DEFAULTS.iterationPreset || 'balanced');
  const initialAlphaDecay = LAYOUT_ITERATION_PRESETS[initialIterationPreset]?.alphaDecay ?? defaultAlphaDecay;

  // --- State ---
  const [isRunning, setIsRunning] = useState(false);
  const [scaleMultiplier, setScaleMultiplier] = useState(initialScaleMultiplier);
  const [iterationPreset, setIterationPreset] = useState(initialIterationPreset);
  const [simulationSpeed, setSimulationSpeed] = useState(autoStart ? 0.3 : 1.0);
  const [displayIteration, setDisplayIteration] = useState(0);
  const [displayAlpha, setDisplayAlpha] = useState(1.0);
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
    groupAttractionStrength: defaultGroupAttraction,
    groupRepulsionStrength: defaultGroupRepulsion,
    groupExclusionStrength: defaultGroupExclusion,
    minGroupDistance: defaultMinGroupDistance,
    groupBoundaryPadding: defaultGroupBoundaryPadding,
    stiffness: defaultStiffness
  });

  // --- Refs ---
  const animationRef = useRef(null);
  const nodesByIdRef = useRef(new Map());
  const simulationState = useRef({
    velocities: new Map(),
    prevDirections: new Map(),
    alpha: 1.0,
    iteration: 0,
    frameCount: 0
  });
  const lastDisplayUpdate = useRef(0);
  const lastJitterGraphRef = useRef(null);
  const jitterAppliedRef = useRef(false);

  // --- Derived values ---
  const baseNodeSeparationMultiplier = FORCE_LAYOUT_DEFAULTS.nodeSeparationMultiplier || 1.25;
  const nodeSeparationMultiplier = baseNodeSeparationMultiplier * scaleMultiplier;
  const scalePresetEntries = Object.entries(LAYOUT_SCALE_PRESETS);
  const iterationPresetEntries = Object.entries(LAYOUT_ITERATION_PRESETS);

  // --- Helpers ---
  const getNodeRadiusWithPadding = (node) => {
    const fallbackRadius = (params.collisionRadius || defaultCollisionRadius) * scaleMultiplier;
    if (!node) return fallbackRadius;
    const base = Math.max(node.width || 0, node.height || 0) / 2;
    if (!base || !Number.isFinite(base)) return fallbackRadius;
    const padding = fallbackRadius * 0.25;
    const imageBonus = Math.max(node.imageHeight || 0, 0) * (FORCE_LAYOUT_DEFAULTS.imageRadiusMultiplier || 0.8);
    return base + padding + imageBonus;
  };

  // --- Handlers ---
  const handleScaleMultiplierChange = useCallback((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const clamped = Math.max(0.2, Math.min(MAX_LAYOUT_SCALE_MULTIPLIER, numeric));
    const rounded = Math.round(clamped * 100) / 100;
    setScaleMultiplier(rounded);
    onLayoutScaleMultiplierChange?.(rounded);
  }, [onLayoutScaleMultiplierChange]);

  const handleResetScale = useCallback(() => {
    setScaleMultiplier(1);
    onLayoutScaleMultiplierChange?.(1);
  }, [onLayoutScaleMultiplierChange]);

  const handleIterationPresetChange = useCallback((presetKey) => {
    if (!LAYOUT_ITERATION_PRESETS[presetKey]) return;
    setIterationPreset(presetKey);
    onLayoutIterationPresetChange?.(presetKey);
    const preset = LAYOUT_ITERATION_PRESETS[presetKey];
    if (preset?.alphaDecay !== undefined) {
      setParams(prev => ({ ...prev, alphaDecay: preset.alphaDecay }));
    }
  }, [onLayoutIterationPresetChange]);

  const handleScalePresetChange = useCallback((presetKey) => {
    if (!LAYOUT_SCALE_PRESETS[presetKey]) return;
    onLayoutScalePresetChange?.(presetKey);
    const preset = LAYOUT_SCALE_PRESETS[presetKey];
    if (preset?.linkDistance) {
      setParams(prev => {
        const nextLinkDistance = preset.linkDistance;
        const maxMinLink = Math.max(60, nextLinkDistance - 20);
        const nextMinLink = Math.min(prev.minLinkDistance, maxMinLink);
        return { ...prev, linkDistance: nextLinkDistance, minLinkDistance: nextMinLink };
      });
    }
    handleScaleMultiplierChange(1);
  }, [onLayoutScalePresetChange, handleScaleMultiplierChange]);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    simulationState.current.alpha = 1.0;
    simulationState.current.iteration = 0;
    simulationState.current.frameCount = 0;
    simulationState.current.prevDirections = new Map();
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
  }, [getNodes]);

  const handleRandomize = useCallback(() => {
    const nodes = getNodes();
    const spreadRadius = 200;
    const updates = nodes.map(node => ({
      instanceId: node.id,
      x: node.x + (Math.random() - 0.5) * spreadRadius * 2,
      y: node.y + (Math.random() - 0.5) * spreadRadius * 2
    }));
    if (updates.length > 0) {
      storeActions.updateMultipleNodeInstancePositions(graphId, updates, { skipSave: true });
      onPositionsUpdated?.();
    }
    handleReset();
  }, [getNodes, storeActions, graphId, onPositionsUpdated, handleReset]);

  const getSettingsJSON = useCallback(() => ({
    layoutScaleMultiplier: scaleMultiplier,
    simulationSpeed,
    iterationPreset,
    ...params,
  }), [scaleMultiplier, simulationSpeed, iterationPreset, params]);

  const updateParams = useCallback((partial) => {
    setParams(prev => ({ ...prev, ...partial }));
  }, []);

  // --- Velocity initialization + jitter detection ---
  useEffect(() => {
    if (enabled) {
      // Check if we need to apply jitter (only once per graph activation)
      const graphKey = `${graphId}-${enabled}`;
      const needsJitter = lastJitterGraphRef.current !== graphKey;

      if (needsJitter) {
        const nodes = getNodes();
        let hasStackedNodes = false;
        if (nodes.length > 1) {
          for (let i = 0; i < nodes.length - 1; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
              const dx = nodes[i].x - nodes[j].x;
              const dy = nodes[i].y - nodes[j].y;
              if (Math.sqrt(dx * dx + dy * dy) < 50) {
                hasStackedNodes = true;
                break;
              }
            }
            if (hasStackedNodes) break;
          }
        }

        if (hasStackedNodes) {
          console.error('[ForceSim] Detected stacked nodes, applying jitter');
          const jitterRadius = 100;
          const updates = nodes.map(node => ({
            instanceId: node.id,
            x: node.x + (Math.random() - 0.5) * jitterRadius * 2,
            y: node.y + (Math.random() - 0.5) * jitterRadius * 2
          }));
          storeActions.updateMultipleNodeInstancePositions(graphId, updates, { skipSave: true });
          onPositionsUpdated?.();
        }

        // Mark jitter as applied for this graph activation
        lastJitterGraphRef.current = graphKey;
        jitterAppliedRef.current = true;
      }

      // Initialize velocities
      const nodes = getNodes();
      const velocities = new Map();
      nodes.forEach(node => {
        velocities.set(node.id, {
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2
        });
      });
      simulationState.current = {
        velocities,
        prevDirections: new Map(),
        alpha: 1.0,
        iteration: 0,
        frameCount: 0
      };
      lastDisplayUpdate.current = 0;
      setDisplayIteration(0);
      setDisplayAlpha(1.0);
    } else {
      // Reset jitter flag when disabled
      jitterAppliedRef.current = false;
    }
  }, [enabled, graphId, storeActions, onPositionsUpdated]);

  // --- Sync external scale multiplier ---
  useEffect(() => {
    if (typeof externalScaleMultiplier === 'number' && !Number.isNaN(externalScaleMultiplier)) {
      setScaleMultiplier(externalScaleMultiplier);
    }
  }, [externalScaleMultiplier]);

  // --- Auto-start ---
  useEffect(() => {
    if (enabled && autoStart) {
      setSimulationSpeed(1.0);
      setIsRunning(true);
      const timer = setTimeout(() => {
        setIsRunning(false);
        onSimulationComplete?.();
      }, autoLayoutDuration);
      return () => clearTimeout(timer);
    }
  }, [enabled, autoStart]);

  // --- Sync external iteration preset ---
  useEffect(() => {
    if (!externalIterationPreset) return;
    setIterationPreset(externalIterationPreset);
    const preset = LAYOUT_ITERATION_PRESETS[externalIterationPreset];
    if (preset?.alphaDecay === undefined) return;
    setParams(prev => {
      if (Math.abs(prev.alphaDecay - preset.alphaDecay) < 0.0001) return prev;
      return { ...prev, alphaDecay: preset.alphaDecay };
    });
  }, [externalIterationPreset]);

  // --- Simulation step (the physics engine) ---
  const simulationStep = () => {
    const state = simulationState.current;
    if (state.alpha < 0.001) {
      setIsRunning(false);
      onSimulationComplete?.();
      return;
    }
    state.frameCount = (state.frameCount || 0) + 1;

    const nodes = getNodes();
    const nodesById = nodesByIdRef.current;
    nodesById.clear();
    nodes.forEach(node => nodesById.set(node.id, node));
    const draggedIds = getDraggedNodeIds();
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
      repulsionStrength, attractionStrength, linkDistance, minLinkDistance,
      centerStrength, collisionRadius, edgeAvoidance, alphaDecay, velocityDecay
    } = params;
    const scaledLinkDistance = linkDistance * scaleMultiplier;
    const scaledMinLinkDistance = minLinkDistance * scaleMultiplier;

    // Apply velocity decay
    velocities.forEach(vel => {
      vel.vx *= velocityDecay;
      vel.vy *= velocityDecay;
    });

    // Repulsion force (n-body)
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
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const dist = Math.sqrt(distSq) || 0.0001;
        const maxRepulsionDist = scaledLinkDistance * 2;
        if (dist > maxRepulsionDist) continue;

        const radiusA = getRadius(nodeA);
        const radiusB = getRadius(nodeB);
        const minDistance = (radiusA + radiusB) * nodeSeparationMultiplier;
        const effectiveDistance = Math.max(dist, minDistance);
        const force = (repulsionStrength * state.alpha) / (effectiveDistance * effectiveDistance);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!aIsDragged) { velA.vx -= fx; velA.vy -= fy; }
        if (!bIsDragged) { velB.vx += fx; velB.vy += fy; }
      }
    }

    // Spring forces along edges
    const currentGroupsForEdges = getGroups();
    let edgeNodeGroupsMap = null;
    if (currentGroupsForEdges.length > 0) {
      edgeNodeGroupsMap = new Map();
      currentGroupsForEdges.forEach(group => {
        (group.memberInstanceIds || []).forEach(nodeId => {
          if (!edgeNodeGroupsMap.has(nodeId)) edgeNodeGroupsMap.set(nodeId, new Set());
          edgeNodeGroupsMap.get(nodeId).add(group.id);
        });
      });
    }

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

      let isCrossGroup = false;
      if (edgeNodeGroupsMap) {
        const srcGs = edgeNodeGroupsMap.get(edge.sourceId);
        const dstGs = edgeNodeGroupsMap.get(edge.destinationId);
        if (srcGs && srcGs.size > 0 && dstGs && dstGs.size > 0) {
          isCrossGroup = ![...srcGs].some(g => dstGs.has(g));
        }
      }

      const edgeMinDistance = isCrossGroup
        ? Math.max(scaledMinLinkDistance, (params.minGroupDistance || 800) * 0.4)
        : scaledMinLinkDistance;

      // Per-edge spring target: raise gently for edges with labels
      // (don't touch edgeMinDistance — its aggressive repulsion causes oscillation)
      let edgeLinkTarget = scaledLinkDistance;
      if (edge.name) {
        // 0.7 for bold text, plus stroke buffer
        const labelWidth = edge.name.length * 24 * 1 + Math.max(2, 24 * 0.25) * 2;
        const sourceRadius = getRadius(source);
        const targetRadius = getRadius(target);
        const labelMin = labelWidth + 60 + sourceRadius + targetRadius;
        edgeLinkTarget = Math.max(edgeLinkTarget, labelMin);
      }

      const crossGroupDamping = isCrossGroup ? 0.6 : 1.0;
      let force;

      if (dist < edgeMinDistance) {
        const ratio = dist / edgeMinDistance;
        const deficit = edgeMinDistance - dist;
        const intensityMultiplier = 10 + (1 - ratio) * 20;
        force = -deficit * attractionStrength * intensityMultiplier * state.alpha;
      } else if (dist < edgeLinkTarget) {
        const displacement = dist - edgeLinkTarget;
        force = displacement * attractionStrength * state.alpha * crossGroupDamping;
      } else {
        const displacement = dist - edgeLinkTarget;
        force = displacement * attractionStrength * state.alpha * crossGroupDamping;
      }

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!sourceIsDragged) { velSource.vx += fx; velSource.vy += fy; }
      if (!targetIsDragged) { velTarget.vx -= fx; velTarget.vy -= fy; }
    });

    // Edge avoidance force — coherent accumulation to prevent trapping
    // Skip when alpha is low (settling phase) — expensive O(n×e) and adds jitter
    if (edgeAvoidance > 0 && state.alpha > 0.3) {
      const nodesMap = new Map(nodes.map(n => [n.id, n]));
      nodes.forEach(node => {
        if (draggedIds.has(node.id)) return;
        const vel = velocities.get(node.id);
        if (!vel) return;
        const nodeRadius = getRadius(node);

        // Accumulate forces from all edges before applying
        let totalFx = 0, totalFy = 0;
        let totalMagnitude = 0;

        edges.forEach(edge => {
          if (edge.sourceId === node.id || edge.destinationId === node.id) return;
          const source = nodesMap.get(edge.sourceId);
          const target = nodesMap.get(edge.destinationId);
          if (!source || !target) return;

          const edgeVecX = target.x - source.x;
          const edgeVecY = target.y - source.y;
          const edgeLengthSq = edgeVecX * edgeVecX + edgeVecY * edgeVecY;
          if (edgeLengthSq < 1) return;

          const nodeVecX = node.x - source.x;
          const nodeVecY = node.y - source.y;
          const t = Math.max(0, Math.min(1, (nodeVecX * edgeVecX + nodeVecY * edgeVecY) / edgeLengthSq));
          const closestX = source.x + t * edgeVecX;
          const closestY = source.y + t * edgeVecY;
          const dx = node.x - closestX;
          const dy = node.y - closestY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const avoidanceRadius = nodeRadius * 2 + scaledLinkDistance * 0.3;

          if (dist < avoidanceRadius && dist > 1) {
            const ratio = dist / avoidanceRadius;
            const intensity = Math.pow(1 - ratio, 1.5);
            const avoidForce = intensity * edgeAvoidance * Math.max(state.alpha, 0.3) * 800;
            totalFx += (dx / dist) * avoidForce;
            totalFy += (dy / dist) * avoidForce;
            totalMagnitude += avoidForce;

            // Rotational routing: swing node in arc around nearest edge endpoint
            const pivotX = t < 0.5 ? source.x : target.x;
            const pivotY = t < 0.5 ? source.y : target.y;
            const toPivotX = node.x - pivotX;
            const toPivotY = node.y - pivotY;
            const pivotDist = Math.sqrt(toPivotX * toPivotX + toPivotY * toPivotY);
            if (pivotDist > 1) {
              const perpAx = -toPivotY / pivotDist;
              const perpAy = toPivotX / pivotDist;
              // Rotate away from edge midpoint
              const edgeMidX = (source.x + target.x) / 2;
              const edgeMidY = (source.y + target.y) / 2;
              const toMidX = edgeMidX - node.x;
              const toMidY = edgeMidY - node.y;
              const dotA = perpAx * toMidX + perpAy * toMidY;
              const sign = dotA < 0 ? 1 : -1;
              const rotForce = avoidForce * 1.2;
              totalFx += sign * perpAx * rotForce;
              totalFy += sign * perpAy * rotForce;
              totalMagnitude += rotForce;
            }
          }
        });

        if (totalMagnitude > 0) {
          const netMagnitude = Math.sqrt(totalFx * totalFx + totalFy * totalFy);
          // Coherence: 1.0 = all edge forces aligned, ~0 = forces cancel (node trapped)
          const coherence = netMagnitude / totalMagnitude;
          // Reduce force when trapped (low coherence) to prevent oscillation
          const coherenceFactor = 0.15 + 0.85 * coherence;
          vel.vx += totalFx * coherenceFactor;
          vel.vy += totalFy * coherenceFactor;

          // When trapped (low coherence), add tangential nudge to help escape
          if (coherence < 0.3 && netMagnitude > 0.01) {
            const tangentScale = (1 - coherence) * totalMagnitude * 0.2;
            const nx = totalFx / netMagnitude;
            const ny = totalFy / netMagnitude;
            vel.vx += -ny * tangentScale;
            vel.vy += nx * tangentScale;
          }
        }
      });
    }

    // Center force
    nodes.forEach(node => {
      if (draggedIds.has(node.id)) return;
      const vel = velocities.get(node.id);
      if (vel) {
        vel.vx += (0 - node.x) * centerStrength * state.alpha;
        vel.vy += (0 - node.y) * centerStrength * state.alpha;
      }
    });

    // Group forces
    const currentGroups = getGroups();
    if (currentGroups.length > 0) {
      const {
        groupAttractionStrength: gAttract,
        groupRepulsionStrength: gRepulse,
        groupExclusionStrength: gExclude,
        minGroupDistance: gMinDist,
        groupBoundaryPadding: gPadding
      } = params;

      const nodeGroupsMap = new Map();
      currentGroups.forEach(group => {
        (group.memberInstanceIds || []).forEach(nodeId => {
          if (!nodeGroupsMap.has(nodeId)) nodeGroupsMap.set(nodeId, new Set());
          nodeGroupsMap.get(nodeId).add(group.id);
        });
      });

      // Group centroids
      const groupCentroids = new Map();
      currentGroups.forEach(group => {
        let sumX = 0, sumY = 0, count = 0;
        (group.memberInstanceIds || []).forEach(nodeId => {
          const node = nodesById.get(nodeId);
          if (node) { sumX += node.x; sumY += node.y; count++; }
        });
        if (count > 0) groupCentroids.set(group.id, { x: sumX / count, y: sumY / count });
      });

      // Intra-group attraction
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

      // Inter-group repulsion (skip every other frame — slow-moving forces)
      if (state.frameCount % 2 === 0)
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

      // Group exclusion
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
        const nodeGrps = nodeGroupsMap.get(node.id) || new Set();
        const cx = node.x + (node.width || 100) / 2;
        const cy = node.y + (node.height || 60) / 2;

        currentGroups.forEach(group => {
          if (nodeGrps.has(group.id)) return;
          const bounds = groupBounds.get(group.id);
          if (!bounds) return;

          const bufferZone = gPadding * 0.5;
          const expandedMinX = bounds.minX - bufferZone;
          const expandedMinY = bounds.minY - bufferZone;
          const expandedMaxX = bounds.maxX + bufferZone;
          const expandedMaxY = bounds.maxY + bufferZone;

          if (cx >= expandedMinX && cx <= expandedMaxX && cy >= expandedMinY && cy <= expandedMaxY) {
            const dx = cx - bounds.centerX;
            const dy = cy - bounds.centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const halfW = (bounds.maxX - bounds.minX) / 2;
            const halfH = (bounds.maxY - bounds.minY) / 2;
            const maxExtent = Math.max(halfW, halfH, 1);
            const depthRatio = Math.max(0, 1 - dist / maxExtent);
            const push = gExclude * state.alpha * (80 + depthRatio * 200);

            if (dist > 0.1) {
              vel.vx += (dx / dist) * push;
              vel.vy += (dy / dist) * push;
            } else {
              const angle = Math.random() * Math.PI * 2;
              vel.vx += Math.cos(angle) * push;
              vel.vy += Math.sin(angle) * push;
            }
          }
        });
      });
    }

    // Oscillation detection + velocity clamping
    const maxVelocity = scaledLinkDistance * 0.8;
    nodes.forEach(node => {
      if (draggedIds.has(node.id)) return;
      const vel = velocities.get(node.id);
      if (!vel) return;

      // Track velocity direction flips to detect oscillation
      const signX = vel.vx >= 0 ? 1 : -1;
      const signY = vel.vy >= 0 ? 1 : -1;
      const prev = state.prevDirections.get(node.id);
      if (prev) {
        const flipped = (prev.signX !== signX) || (prev.signY !== signY);
        prev.flipCount = flipped
          ? Math.min(prev.flipCount + 1, 10)
          : Math.max(prev.flipCount - 0.5, 0);
        // Extra damping for oscillating nodes
        if (prev.flipCount > 5) {
          const dampFactor = Math.max(0.3, 1 - (prev.flipCount / 10) * 0.5);
          vel.vx *= dampFactor;
          vel.vy *= dampFactor;
        }
        prev.signX = signX;
        prev.signY = signY;
      } else {
        state.prevDirections.set(node.id, { signX, signY, flipCount: 0 });
      }

      // Hard velocity clamp
      const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
      if (speed > maxVelocity) {
        vel.vx = (vel.vx / speed) * maxVelocity;
        vel.vy = (vel.vy / speed) * maxVelocity;
      }
    });

    // Update positions
    const updates = [];
    nodes.forEach(node => {
      if (draggedIds.has(node.id)) return;
      const vel = velocities.get(node.id);
      if (vel) {
        updates.push({
          instanceId: node.id,
          x: node.x + vel.vx * simulationSpeed,
          y: node.y + vel.vy * simulationSpeed
        });
      }
    });

    // Collision detection - non-dragged pairs
    const draggedPositions = [];
    draggedIds.forEach(id => {
      const node = nodesById.get(id);
      if (node) draggedPositions.push({ instanceId: id, x: node.x, y: node.y });
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
          const overlap = minDist - dist;
          const angle = Math.atan2(dy, dx);
          const pushFactor = 0.6;
          const moveX = Math.cos(angle) * overlap * pushFactor;
          const moveY = Math.sin(angle) * overlap * pushFactor;
          updateA.x -= moveX;
          updateA.y -= moveY;
          updateB.x += moveX;
          updateB.y += moveY;
        }
      }
    }

    // Collision with dragged nodes
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
          const overlap = minDist - dist;
          const angle = Math.atan2(dy, dx);
          update.x += Math.cos(angle) * overlap;
          update.y += Math.sin(angle) * overlap;
        }
      }
    }

    // Apply to store (throttled to every 3rd frame for performance)
    if (updates.length > 0 && state.frameCount % 3 === 0) {
      storeActions.updateMultipleNodeInstancePositions(graphId, updates, { skipSave: true });
      onPositionsUpdated?.();
    }

    // Decay alpha
    state.alpha *= (1 - alphaDecay);
    state.iteration++;

    // Throttled display updates
    if (state.iteration - lastDisplayUpdate.current >= 10) {
      lastDisplayUpdate.current = state.iteration;
      setDisplayIteration(state.iteration);
      setDisplayAlpha(state.alpha);
    }
  };

  // Keep latest simulationStep in ref for animation loop
  const simulationStepRef = useRef(simulationStep);
  useEffect(() => {
    simulationStepRef.current = simulationStep;
  });

  // Animation loop
  useEffect(() => {
    if (isRunning) {
      const animate = () => {
        simulationStepRef.current();
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      };
    }
  }, [isRunning]);

  return {
    isRunning,
    alpha: displayAlpha,
    iteration: displayIteration,
    params,
    scaleMultiplier,
    iterationPreset,
    simulationSpeed,
    scalePresetEntries,
    iterationPresetEntries,
    toggleRunning: useCallback(() => setIsRunning(r => !r), []),
    reset: handleReset,
    randomize: handleRandomize,
    setParams: updateParams,
    setSimulationSpeed,
    handleScalePresetChange,
    handleScaleMultiplierChange,
    handleResetScale,
    handleIterationPresetChange,
    getSettingsJSON,
  };
}
