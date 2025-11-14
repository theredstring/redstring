import React, { useState, useRef, useEffect } from 'react';
import { X, Play, Pause, RotateCcw } from 'lucide-react';
import './ForceSimulationModal.css';
import { FORCE_LAYOUT_DEFAULTS, LAYOUT_ITERATION_PRESETS, LAYOUT_SCALE_PRESETS } from '../services/graphLayoutService.js';

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
  onNodePositionsUpdated,
  layoutScalePreset = FORCE_LAYOUT_DEFAULTS.layoutScale || 'balanced',
  layoutScaleMultiplier = FORCE_LAYOUT_DEFAULTS.layoutScaleMultiplier || 1,
  onLayoutScalePresetChange,
  onLayoutScaleMultiplierChange,
  layoutIterationPreset = FORCE_LAYOUT_DEFAULTS.iterationPreset || 'balanced',
  onLayoutIterationPresetChange
}) => {
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const modalRef = useRef(null);
  const animationRef = useRef(null);
  const initialScaleMultiplier = layoutScaleMultiplier ?? (FORCE_LAYOUT_DEFAULTS.layoutScaleMultiplier || 1);
  const initialIterationPreset = layoutIterationPreset ?? (FORCE_LAYOUT_DEFAULTS.iterationPreset || 'balanced');
  const initialAlphaDecay = LAYOUT_ITERATION_PRESETS[initialIterationPreset]?.alphaDecay ?? defaultAlphaDecay;
  const [scaleMultiplier, setScaleMultiplier] = useState(initialScaleMultiplier);
  const [iterationPreset, setIterationPreset] = useState(initialIterationPreset);
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
    velocityDecay: defaultVelocityDecay
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
    velocityDecay: defaultVelocityDecay
  });
  
  // Simulation state
  const [iteration, setIteration] = useState(0);
  const simulationState = useRef({
    velocities: new Map(), // instanceId -> {vx, vy}
    alpha: 1.0,
    iteration: 0
  });

  const handleScaleMultiplierChange = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const clamped = Math.max(0.5, Math.min(2.5, numeric));
    const rounded = Math.round(clamped * 100) / 100;
    setScaleMultiplier(rounded);
    onLayoutScaleMultiplierChange?.(rounded);
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
      setIteration(0);
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
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        const velA = velocities.get(nodeA.id);
        const velB = velocities.get(nodeB.id);
        
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
        
        velA.vx -= fx;
        velA.vy -= fy;
        velB.vx += fx;
        velB.vy += fy;
      }
    }
    
    // Attraction/Repulsion force along edges - maintains distance range
    edges.forEach(edge => {
      const source = nodesById.get(edge.sourceId);
      const target = nodesById.get(edge.destinationId);
      
      if (!source || !target) return;
      
      const velSource = velocities.get(source.id);
      const velTarget = velocities.get(target.id);
      
      if (!velSource || !velTarget) return;
      
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      
      const radiusSource = getRadius(source);
      const radiusTarget = getRadius(target);
      const minDistance = Math.max(scaledMinLinkDistance, (radiusSource + radiusTarget) * nodeSeparationMultiplier);
      let force;
      
      // ENFORCE MINIMUM DISTANCE - strong repulsion if too close
      if (dist < minDistance) {
        // Push apart HARD when below minimum
        const deficit = minDistance - dist;
        force = -deficit * attractionStrength * 3 * state.alpha; // 3x stronger push
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
      
      velSource.vx += fx;
      velSource.vy += fy;
      velTarget.vx -= fx;
      velTarget.vy -= fy;
    });
    
    // Edge avoidance force - push nodes away from edges they're not part of
    if (edgeAvoidance > 0) {
      nodes.forEach(node => {
        const vel = velocities.get(node.id);
        if (!vel) return;
        
        edges.forEach(edge => {
          // Skip if node is part of this edge
          if (edge.sourceId === node.id || edge.destinationId === node.id) return;
          
          const source = nodes.find(n => n.id === edge.sourceId);
          const target = nodes.find(n => n.id === edge.destinationId);
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
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq);
          
          // Only apply force if node is close to edge
          const avoidanceRadius = scaledCollisionRadius * 1.5;
          if (dist < avoidanceRadius && dist > 1) {
            // Push node away from edge
            const force = ((avoidanceRadius - dist) / avoidanceRadius) * edgeAvoidance * state.alpha * 100;
            vel.vx += (dx / dist) * force;
            vel.vy += (dy / dist) * force;
          }
        });
      });
    }
    
    // Center force
    const centerX = 0;
    const centerY = 0;
    nodes.forEach(node => {
      const vel = velocities.get(node.id);
      if (vel) {
        vel.vx += (centerX - node.x) * centerStrength * state.alpha;
        vel.vy += (centerY - node.y) * centerStrength * state.alpha;
      }
    });
    
    // Update positions in bulk
    const updates = [];
    nodes.forEach(node => {
      const vel = velocities.get(node.id);
      if (vel) {
        updates.push({
          instanceId: node.id,
          x: node.x + vel.vx,
          y: node.y + vel.vy
        });
      }
    });
    
    // Apply STRONG collision detection to updates with padding
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
    
    setIteration(state.iteration);
  };
  
  // Animation loop
  useEffect(() => {
    if (isRunning) {
      const animate = () => {
        simulationStep();
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
      
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }
  }, [isRunning, params, scaleMultiplier]);
  
  // Apply single step when params change (even when paused)
  useEffect(() => {
    if (!isRunning && isOpen) {
      // Do a single simulation step when params change
      simulationStep();
    }
  }, [params, scaleMultiplier]);
  
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
    setIteration(0);
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
            <span className="force-sim-stat-value">{iteration}</span>
          </div>
          <div className="force-sim-stat">
            <span className="force-sim-stat-label">Alpha:</span>
            <span className="force-sim-stat-value">{simulationState.current.alpha.toFixed(4)}</span>
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
          </div>
          
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
                min="0.6"
                max="2.4"
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForceSimulationModal;

