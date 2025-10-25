import React, { useState, useRef, useEffect, useCallback, useMemo, useReducer } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { NODE_WIDTH, NODE_HEIGHT, NODE_CORNER_RADIUS, NODE_DEFAULT_COLOR, NODE_PADDING } from './constants';
import { getNodeDimensions } from './utils';
import useGraphStore from './store/graphStore.jsx';
import './AbstractionCarousel.css';

// Color utility functions for hue-based progression

// Helper function to convert CSS color names to hex
const cssColorToHex = (color) => {
  // If it's already a hex color, return as-is
  if (typeof color === 'string' && color.startsWith('#')) {
    return color;
  }
  
  // Create a temporary element to get the computed color
  if (typeof document !== 'undefined') {
    const tempElement = document.createElement('div');
    tempElement.style.color = color;
    document.body.appendChild(tempElement);
    
    const computedColor = getComputedStyle(tempElement).color;
    document.body.removeChild(tempElement);
    
    // Parse rgb(r, g, b) format
    const rgbMatch = computedColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
      const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
      const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  
  // Fallback for common CSS colors
  const colorMap = {
    'maroon': '#800000',
    'red': '#ff0000',
    'orange': '#ffa500',
    'yellow': '#ffff00',
    'olive': '#808000',
    'lime': '#00ff00',
    'green': '#008000',
    'aqua': '#00ffff',
    'teal': '#008080',
    'blue': '#0000ff',
    'navy': '#000080',
    'fuchsia': '#ff00ff',
    'purple': '#800080',
    'black': '#000000',
    'gray': '#808080',
    'silver': '#c0c0c0',
    'white': '#EFE8E5'
  };
  
  return colorMap[color.toLowerCase()] || '#800000'; // Default to maroon if unknown
};

const hexToHsl = (hex) => {
  // Convert CSS color names to hex first
  hex = cssColorToHex(hex);
  
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16) / 255;
  const g = parseInt(hex.substr(2, 2), 16) / 255;
  const b = parseInt(hex.substr(4, 2), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l;

  l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
};

const hslToHex = (h, s, l) => {
  h = h % 360;
  s = s / 100;
  l = l / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const generateProgressiveColor = (baseColor, level) => {
  if (level === 0) return baseColor; // Center node stays the same
  
  const { h, s, l } = hexToHsl(baseColor);
  
  // Reduce saturation significantly for less gaudy colors
  const reducedSaturation = Math.max(0, s - 25); // Reduce saturation by 25%
  
  // For specific levels (negative), make progressively lighter
  // For general levels (positive), make progressively darker
  let newLightness = l;
  
  if (level < 0) {
    // Specific levels: lighter with bigger first jump for better contrast
    if (level === -1) {
      // First level above center gets an even bigger jump for better contrast
      newLightness = Math.min(90, l + 40); // 40% lighter for first step (increased from 25%)
    } else {
      // More linear progression after the first jump
      // Use a gentler curve that starts slower and increases gradually
      const stepsFromFirst = Math.abs(level) - 1; // Steps beyond the first (-1)
      const linearBase = 40; // Start from the first jump
      const linearIncrement = 8; // Smaller, more linear increments (was 15)
      const lighteningFactor = linearBase + (stepsFromFirst * linearIncrement);
      newLightness = Math.min(90, l + lighteningFactor);
    }
      } else if (level > 0) {
    // General levels: darker with more linear progression
    // Make the darkening more gradual and linear too
    const linearDarkeningFactor = level * 6; // Even gentler than before (was 8)
    newLightness = Math.max(10, l - linearDarkeningFactor);
  }
  
  return hslToHex(h, reducedSaturation, newLightness);
};

const getTextColor = (backgroundColor) => {
  const { h, s, l } = hexToHsl(backgroundColor);
  
  // If background is bright (lightness > 35), use dark text with same hue
  // Lowered threshold from 42% to 35% for better contrast
  if (l > 35) {
    // Create a dark color with the same hue but very low lightness for better contrast
    return hslToHex(h, Math.min(s, 50), 12); // Darker text (12% instead of 15%) with slightly higher saturation
  } else {
    // Use light text for dark backgrounds
    return '#bdb5b5';
  }
};

const LEVEL_SPACING = -30; // Overlapping spacing to create a stacked effect
const PHYSICS_DAMPING = 0.75; // Much lower damping for less friction/stickiness
const BASE_SCROLL_SENSITIVITY = 0.0003; // Reduced from 0.0008 for less sensitive quick scrolls
const PRECISION_SCROLL_SENSITIVITY = 0.0008; // Increased from 0.0010 for better slow start gain
const SNAP_THRESHOLD = 0.25; // Higher threshold to prevent premature snapping
const SNAP_SPRING = 0.35; // Stronger spring for faster snapping
const MIN_VELOCITY = 0.003; // Lower minimum to allow smaller movements
const MAX_VELOCITY = 0.8; // Slightly lower max velocity for better control
const VELOCITY_HISTORY_SIZE = 5; // Number of recent velocity samples to track
const CONTINUOUS_SCROLL_THRESHOLD = 0.12; // Lowered threshold to detect continuous scrolling sooner

// Physics state reducer
const physicsReducer = (state, action) => {
  switch (action.type) {
    case 'UPDATE_PHYSICS': {
      const { frameMultiplier } = action.payload;
      const dampedVelocity = state.velocity * Math.pow(PHYSICS_DAMPING, frameMultiplier);
      
      let nextVelocity = dampedVelocity;
      let nextPosition = state.realPosition;
      let nextIsSnapping = state.isSnapping;
      let nextTargetPosition = state.targetPosition;
      
      if (state.isSnapping) {
        // Move toward target position
        const diff = state.targetPosition - state.realPosition;
        
        if (Math.abs(diff) < 0.01) {
          nextIsSnapping = false;
          nextPosition = state.targetPosition; // Snap exactly to target
        } else {
          nextPosition = state.realPosition + diff * SNAP_SPRING * frameMultiplier;
        }
      } else {
        // Normal velocity-based movement
        nextPosition = state.realPosition + dampedVelocity * frameMultiplier;
        
        // Dynamic bounds based on actual chain length
        const minLevel = action.payload.minLevel || -6;
        const maxLevel = action.payload.maxLevel || 6;
        nextPosition = Math.max(minLevel, Math.min(maxLevel, nextPosition));
        
        // Check if we should start snapping (with enhanced "stuck" detection)
        if (Math.abs(dampedVelocity) < MIN_VELOCITY && !state.isSnapping && state.hasUserScrolled) {
          nextIsSnapping = true;
          nextVelocity = 0;
          
          // Calculate target based on the new position and velocity direction
          const velocityDirection = state.velocity > 0 ? 1 : (state.velocity < 0 ? -1 : 0);
          
          // Get nearest integer positions
          const floor = Math.floor(nextPosition);
          const ceil = Math.ceil(nextPosition);
          
          let newTarget;
          
          if (floor === ceil) {
            // Already at integer
            newTarget = floor;
          } else {
            const distToFloor = nextPosition - floor;
            const distToCeil = ceil - nextPosition;
            
            // Enhanced snapping: if we're very close to a node (within 0.1), snap immediately
            const STUCK_THRESHOLD = 0.1; // Much smaller threshold for "stuck" detection
            
            if (distToFloor < STUCK_THRESHOLD) {
              // Very close to floor, snap immediately
              newTarget = floor;
            } else if (distToCeil < STUCK_THRESHOLD) {
              // Very close to ceiling, snap immediately  
              newTarget = ceil;
            } else if (distToFloor < SNAP_THRESHOLD) {
              // Close to floor, snap to floor
              newTarget = floor;
            } else if (distToCeil < SNAP_THRESHOLD) {
              // Close to ceiling, snap to ceiling
              newTarget = ceil;
            } else {
              // In the middle, use velocity direction to decide
              if (velocityDirection > 0) {
                newTarget = ceil; // Moving forward, snap to next
              } else if (velocityDirection < 0) {
                newTarget = floor; // Moving backward, snap to previous
              } else {
                newTarget = Math.round(nextPosition); // No velocity, snap to nearest
              }
            }
          }
          
          nextTargetPosition = Math.max(minLevel, Math.min(maxLevel, newTarget));
        }
      }
      
      return {
        ...state,
        velocity: nextVelocity,
        realPosition: nextPosition,
        isSnapping: nextIsSnapping,
        targetPosition: nextTargetPosition
      };
    }
    case 'SET_VELOCITY':
      return { ...state, velocity: action.payload };
    case 'SET_VELOCITY_WITH_HISTORY':
      const { velocity, deltaY } = action.payload;
      const newHistory = [...(state.velocityHistory || []), Math.abs(velocity)];
      // Keep only the most recent samples
      const trimmedHistory = newHistory.slice(-VELOCITY_HISTORY_SIZE);
      return { 
        ...state, 
        velocity, 
        velocityHistory: trimmedHistory 
      };
    case 'SET_USER_SCROLLED':
      return { ...state, hasUserScrolled: action.payload };
    case 'INTERRUPT_SNAPPING':
      return { ...state, isSnapping: false };
    case 'JUMP_TO_LEVEL':
      return { 
        ...state, 
        // Don't immediately change realPosition - let it animate smoothly
        targetPosition: action.payload, 
        isSnapping: true, // Enable snapping animation to target
        velocity: 0, // Clear any existing velocity for clean animation
        hasUserScrolled: true
      };
    case 'RESET':
      return {
        realPosition: 0,
        targetPosition: 0,
        velocity: 0,
        isSnapping: false,
        hasUserScrolled: false,
        velocityHistory: []
      };
    default:
      return state;
  }
};

const AbstractionCarousel = ({
  isVisible,
  selectedNode,
  panOffset,
  zoomLevel,
  containerRef,
  canvasSize, // Canvas size with offsetX/offsetY for coordinate system alignment
  debugMode,
  animationState = 'visible', // 'hidden', 'entering', 'visible', 'exiting'
  onAnimationStateChange,
  onExitAnimationComplete,
  onClose,
  onReplaceNode,
  onScaleChange, // New callback to report the focused node's current scale
  onFocusedNodeDimensions, // New callback to report the focused node's dimensions
  onFocusedNodeChange, // New callback to report which node is currently focused
  currentDimension = 'Generalization Axis', // Current abstraction axis/dimension
  availableDimensions = [], // Available abstraction axes for this node
  onDimensionChange, // Called when user changes dimension
  onAddDimension, // Called when user adds a new dimension
  onDeleteDimension, // Called when user deletes a dimension
  onExpandDimension, // Called when user expands a dimension
  onOpenInPanel, // Called when user opens dimension in panel
  relativeMoveRequest, // 'up' | 'down' | null - request to move focus one level
  onRelativeMoveHandled // callback to clear request once applied
}) => {
  const carouselRef = useRef(null);
  
  // Store bindings
  const nodePrototypesMap = useGraphStore((state) => state.nodePrototypes);
  const thingNodeId = useGraphStore((state) => state.thingNodeId);
  
  // Pre-calculate the abstraction chain and base dimensions for each node
  const abstractionChainWithDims = useMemo(() => {
    if (!selectedNode) return [];
    
    console.log('[AbstractionCarousel] Building chain for selectedNode:', {
      id: selectedNode.id,
      prototypeId: selectedNode.prototypeId,
      name: selectedNode.name,
      currentDimension
    });
    
    // Guard clause: ensure selectedNode has a prototypeId
    if (!selectedNode.prototypeId) {
      console.warn('[AbstractionCarousel] selectedNode missing prototypeId, returning empty chain');
      return [];
    }
    
    const baseColor = selectedNode.color || NODE_DEFAULT_COLOR;
    
    // Find the abstraction chain for this node and dimension
    // The selectedNode might be the chain owner, or it might be a member of someone else's chain
    let chainNodeIds = [];
    let chainOwnerNodeId = null;
    
    // First, check if this node owns a chain
    const selectedNodePrototype = nodePrototypesMap.get(selectedNode.prototypeId);
    if (selectedNodePrototype?.abstractionChains?.[currentDimension]?.length > 0) {
      // This node owns a chain
      chainNodeIds = selectedNodePrototype.abstractionChains[currentDimension];
      chainOwnerNodeId = selectedNode.prototypeId;
    } else {
      // This node doesn't own a chain, check if it's a member of someone else's chain
      for (const [nodeId, nodePrototype] of nodePrototypesMap.entries()) {
        const existingChain = nodePrototype.abstractionChains?.[currentDimension];
        if (existingChain && existingChain.includes(selectedNode.prototypeId)) {
          // Found the chain that contains this node
          chainNodeIds = existingChain;
          chainOwnerNodeId = nodeId;
          break;
        }
      }
    }
    
    console.log('[AbstractionCarousel] Chain search result:', {
      chainNodeIds,
      chainOwnerNodeId,
      selectedNodeInChain: chainNodeIds.includes(selectedNode.prototypeId)
    });
    
    // If no chain was found, create a default single-node chain
    if (chainNodeIds.length === 0) {
      chainNodeIds = [selectedNode.prototypeId];
      chainOwnerNodeId = selectedNode.prototypeId;
      console.log('[AbstractionCarousel] No existing chain found, created default single-node chain');
    }
    
    console.log('[AbstractionCarousel] Final chain setup:', {
      chainNodeIds,
      chainOwnerNodeId,
      currentDimension,
      nodePrototypesMapSize: nodePrototypesMap.size
    });
    
    const chain = [];
    const thingNode = nodePrototypesMap.get(thingNodeId);
    
    if (chainNodeIds.length === 0) {
      // No chain exists yet - show default layout with only the current node
      chain.push({ 
        ...selectedNode, 
        type: 'current', 
        level: 0,
        textColor: getTextColor(selectedNode.color),
        prototypeId: selectedNode.prototypeId
      });
    } else {
      // Chain exists - build it properly with current node always at level 0
      
      // Find the current node's position in the chain
      const currentNodeIndex = chainNodeIds.indexOf(selectedNode.prototypeId);
      if (currentNodeIndex === -1) {
        console.error('Current node not found in abstraction chain!', {
          selectedNodeId: selectedNode.prototypeId,
          chainNodeIds,
          chainOwnerNodeId,
          currentDimension
        });
        return [];
      }
      
      // Removed injected base "Thing" entry to reduce confusion
      
      // Add all nodes in the chain, with current node always at level 0
      chainNodeIds.forEach((nodeId, index) => {
        const node = nodePrototypesMap.get(nodeId);
        if (node) {
          const level = index - currentNodeIndex; // Current node will be at level 0
          const nodeType = nodeId === selectedNode.prototypeId ? 'current' : 'related';
          
          // Calculate color based on level - nodes more general than current (positive levels) get darker
          let nodeColor;
          if (nodeType === 'current') {
            nodeColor = selectedNode.color;
          } else {
            nodeColor = generateProgressiveColor(baseColor, level);
          }
          
          // For nodes more general than current (positive levels), ensure dark background + bright text
          let textColor = getTextColor(nodeColor);
          if (level > 0) {
            // Force bright text for darker general nodes
            textColor = '#EFE8E5';
          }
          
          chain.push({
            ...node,
            type: nodeType,
            level: level,
            color: nodeColor,
            textColor: textColor,
            prototypeId: nodeId // Ensure prototypeId is set for focused node reporting
          });
        }
      });
    }



    // Pre-calculate base dimensions for each node
    const finalChain = chain.map(item => {
      const nodeForDimensions = item.type === 'current' ? selectedNode : item;
      const baseDimensions = getNodeDimensions(nodeForDimensions, false, null);
      return { ...item, baseDimensions };
    });
    
    console.log('[AbstractionCarousel] Final chain with dimensions:', {
      chainLength: finalChain.length,
      chainItems: finalChain.map(item => ({
        id: item.id,
        name: item.name,
        level: item.level,
        type: item.type,
        hasBaseDimensions: !!item.baseDimensions
      }))
    });
    
    return finalChain;
  }, [selectedNode, currentDimension, nodePrototypesMap, thingNodeId]);
  
  // Calculate physics bounds based on chain, excluding non-reachable nodes
  const physicsMinLevel = useMemo(() => {
    if (!abstractionChainWithDims.length) return -6;
    // Find the most abstract reachable level (exclude Thing if marked as non-reachable)
    const reachableLevels = abstractionChainWithDims
      .filter(n => !n.isNonReachable && (n.type === 'current' || n.type === 'generic' || n.type === 'related'))
      .map(n => n.level);
    
    if (reachableLevels.length === 0) return -6;
    
    const minLevel = Math.min(...reachableLevels);
    
    // If there's only one reachable node (just the current node), allow limited scrolling range above it
    if (reachableLevels.length === 1) {
      // Allow scrolling to 0.1 levels above the only node (very limited range)
      return minLevel - 0.1;
    }
    
    console.log(`[AbstractionCarousel] Physics min level: ${minLevel}, reachable levels:`, reachableLevels);
    // For multiple nodes, also add a small buffer to prevent scrolling past node centers
    return minLevel + 0.05;
  }, [abstractionChainWithDims]);
  
  const physicsMaxLevel = useMemo(() => {
    if (!abstractionChainWithDims.length) return 6;
    // Find the most specific reachable level
    const reachableLevels = abstractionChainWithDims
      .filter(n => !n.isNonReachable && (n.type === 'current' || n.type === 'generic' || n.type === 'related'))
      .map(n => n.level);
    
    if (reachableLevels.length === 0) return 6;
    
    const maxLevel = Math.max(...reachableLevels);
    
    // If there's only one reachable node (just the current node), allow limited scrolling range below it
    if (reachableLevels.length === 1) {
      // Allow scrolling to 0.1 levels below the only node (very limited range)
      return maxLevel + 0.1;
    }
    
    console.log(`[AbstractionCarousel] Physics max level: ${maxLevel}, reachable levels:`, reachableLevels);
    // For multiple nodes, also add a small buffer to prevent scrolling past node centers
    return maxLevel - 0.05;
  }, [abstractionChainWithDims]);

  // Physics state using reducer
  const [physicsState, dispatchPhysics] = useReducer(physicsReducer, {
    realPosition: 0,
    targetPosition: 0,
    velocity: 0,
    isSnapping: false,
    hasUserScrolled: false,
    velocityHistory: []
  });
  
  // Animation refs
  const animationFrameRef = useRef(null);
  const lastFrameTimeRef = useRef(0);
  const physicsStateRef = useRef(physicsState);
  const updatePhysicsRef = useRef(null);

  // Update physics state ref whenever state changes
  useEffect(() => {
    physicsStateRef.current = physicsState;
  }, [physicsState]);

  // Handle animation state transitions
  useEffect(() => {
    if (animationState === 'entering') {
      // Start entrance animation, then transition to visible
      const timer = setTimeout(() => {
        onAnimationStateChange?.('visible');
      }, 200); // Faster animation duration
      return () => clearTimeout(timer);
    } else if (animationState === 'exiting') {
      // Start exit animation, then call completion callback
      const timer = setTimeout(() => {
        onExitAnimationComplete?.();
      }, 200); // Faster animation duration
      return () => clearTimeout(timer);
    }
  }, [animationState, onAnimationStateChange, onExitAnimationComplete]);

  // Pre-calculate the y-offset for each level based on dynamic heights
  const levelOffsets = useMemo(() => {
    const offsets = { 0: 0 };
    if (!abstractionChainWithDims.length) return offsets;

    // Find the minimum and maximum levels
    const levels = abstractionChainWithDims.map(n => n.level);
    const minLevel = Math.min(...levels);
    const maxLevel = Math.max(...levels);

    // Calculate upwards from 0
    let upY = 0;
    for (let i = -1; i >= minLevel; i--) {
      const nodeCurrent = abstractionChainWithDims.find(n => n.level === i);
      const nodeAbove = abstractionChainWithDims.find(n => n.level === i + 1);
      if (!nodeCurrent) {
        // If no node at this level, use fallback spacing
        upY -= (NODE_HEIGHT + LEVEL_SPACING);
        offsets[i] = upY;
        continue;
      }
      if (!nodeAbove) break;
      
      const hCurrent = nodeCurrent.baseDimensions?.currentHeight || NODE_HEIGHT;
      const hAbove = nodeAbove.baseDimensions?.currentHeight || NODE_HEIGHT;
      
      upY -= ((hAbove / 2) + (hCurrent / 2) + LEVEL_SPACING);
      offsets[i] = upY;
    }

    // Calculate downwards from 0
    let downY = 0;
    for (let i = 1; i <= maxLevel; i++) {
      const nodeCurrent = abstractionChainWithDims.find(n => n.level === i);
      const nodeBelow = abstractionChainWithDims.find(n => n.level === i - 1);
      if (!nodeCurrent) {
        // If no node at this level, use fallback spacing
        downY += (NODE_HEIGHT + LEVEL_SPACING);
        offsets[i] = downY;
        continue;
      }
      if (!nodeBelow) break;

      const hCurrent = nodeCurrent.baseDimensions?.currentHeight || NODE_HEIGHT;
      const hBelow = nodeBelow.baseDimensions?.currentHeight || NODE_HEIGHT;

      downY += ((hBelow / 2) + (hCurrent / 2) + LEVEL_SPACING);
      offsets[i] = downY;
    }
    return offsets;
  }, [abstractionChainWithDims]);

  // Calculate the center position where the carousel should be anchored
  const getCarouselPosition = useCallback(() => {
    if (!selectedNode || !containerRef.current || !canvasSize) return { x: 0, y: 0 };

    const containerRect = containerRef.current.getBoundingClientRect();
    const nodeDimensions = getNodeDimensions(selectedNode, false, null);

    // Calculate node center in canvas coordinates
    const nodeCenterX = selectedNode.x + nodeDimensions.currentWidth / 2;
    const nodeCenterY = selectedNode.y + nodeDimensions.currentHeight / 2;

    // Convert canvas coordinates to screen coordinates
    // Match the canvas transform: translate(${panOffset.x - canvasSize.offsetX * zoomLevel}px, ${panOffset.y - canvasSize.offsetY * zoomLevel}px) scale(${zoomLevel})
    const screenX = nodeCenterX * zoomLevel + (panOffset.x - canvasSize.offsetX * zoomLevel) + containerRect.left;
    const screenY = nodeCenterY * zoomLevel + (panOffset.y - canvasSize.offsetY * zoomLevel) + containerRect.top;

    const finalPosition = { x: screenX, y: screenY };

    console.log('[AbstractionCarousel] Position calculation:', {
      selectedNode: { x: selectedNode.x, y: selectedNode.y },
      nodeDimensions: { currentWidth: nodeDimensions.currentWidth, currentHeight: nodeDimensions.currentHeight },
      nodeCenter: { x: nodeCenterX, y: nodeCenterY },
      zoomLevel,
      panOffset,
      canvasSize: { offsetX: canvasSize.offsetX, offsetY: canvasSize.offsetY },
      containerRect: { left: containerRect.left, top: containerRect.top },
      finalPosition
    });

    return finalPosition;
  }, [selectedNode, panOffset, zoomLevel, containerRef, canvasSize]);

  // Calculate the stack offset using real position and dynamic offsets
  const getStackOffset = useCallback(() => {
    const position = physicsState.realPosition;
    const floorLevel = Math.floor(position);
    const ceilLevel = Math.ceil(position);

    const offsetA = levelOffsets[floorLevel];
    const offsetB = levelOffsets[ceilLevel];

    if (offsetA === undefined || offsetB === undefined) {
      // Fallback for out-of-bounds levels during animation
      return -position * (NODE_HEIGHT + LEVEL_SPACING) * zoomLevel;
    }

    const factor = position - floorLevel;
    const interpolatedOffset = offsetA + (offsetB - offsetA) * factor;

    return -interpolatedOffset * zoomLevel;
  }, [physicsState.realPosition, zoomLevel, levelOffsets]);

  // Hints: fade-in on open, fade-out on first scroll
  const [hintsDismissed, setHintsDismissed] = useState(false);
  const [hintOpacity, setHintOpacity] = useState(0);

  useEffect(() => {
    if (isVisible) {
      setHintsDismissed(false);
      setHintOpacity(0);
      const t = setTimeout(() => setHintOpacity(1), 30);
      return () => clearTimeout(t);
    } else {
      setHintOpacity(0);
    }
  }, [isVisible]);

  // Physics update loop using reducer
  const updatePhysics = useCallback((currentTime) => {
    if (!isVisible) {
      animationFrameRef.current = null;
      return;
    }
    
    const deltaTime = Math.min(currentTime - lastFrameTimeRef.current, 32);
    lastFrameTimeRef.current = currentTime;

    // Skip first frame to avoid large deltaTime
    if (deltaTime > 100) {
      animationFrameRef.current = requestAnimationFrame(updatePhysicsRef.current);
      return;
    }

    const deltaTimeSeconds = deltaTime / 1000;
    const frameMultiplier = deltaTimeSeconds * 60;

    // Update physics using reducer
    dispatchPhysics({ 
      type: 'UPDATE_PHYSICS', 
      payload: { 
        frameMultiplier,
        minLevel: physicsMinLevel,
        maxLevel: physicsMaxLevel
      } 
    });

    // After physics update, get the latest position from the state ref
    // This avoids adding physicsState as a dependency to this callback
    const position = physicsStateRef.current.realPosition;

    // Calculate and report scale factor for the focused node
    if (onScaleChange) {
      const distanceFromFocus = Math.abs(0 - position);
      let scale = 1.0;
      if (distanceFromFocus === 0) {
        scale = 1.0;
      } else if (distanceFromFocus < 1) {
        scale = 1.0 - (distanceFromFocus * 0.3);
      } else {
        scale = 0.7 - ((distanceFromFocus - 1) * 0.15);
        scale = Math.max(0.4, scale);
      }
      onScaleChange(scale);
    }
    
    // Calculate and report the focused node's actual current dimensions
    if (onFocusedNodeDimensions && abstractionChainWithDims.length > 0) {
      const floorLevel = Math.floor(position);
      const ceilLevel = Math.ceil(position);
      const nodeA = abstractionChainWithDims.find(item => item.level === floorLevel);
      const nodeB = abstractionChainWithDims.find(item => item.level === ceilLevel);
      const dimA = nodeA?.baseDimensions;
      const dimB = nodeB?.baseDimensions || dimA;

      if (dimA && dimB) {
        const factor = position - floorLevel;
        const lerp = (a, b, t) => a + (b - a) * t;
        const interpolatedWidth = lerp(dimA.currentWidth, dimB.currentWidth, factor);
        const interpolatedHeight = lerp(dimA.currentHeight, dimB.currentHeight, factor);
        const interpolatedTextAreaHeight = lerp(dimA.textAreaHeight, dimB.textAreaHeight, factor);
        const actualCurrentDimensions = {
          currentWidth: interpolatedWidth,
          currentHeight: interpolatedHeight,
          textAreaHeight: interpolatedTextAreaHeight
        };
        onFocusedNodeDimensions(actualCurrentDimensions);
      }
    }
    
    // Report which node is currently focused (closest to the center)
    if (onFocusedNodeChange && abstractionChainWithDims.length > 0) {
      const roundedLevel = Math.round(position);
      const focusedNode = abstractionChainWithDims.find(item => item.level === roundedLevel);
      if (focusedNode) {
        onFocusedNodeChange(focusedNode);
      }
    }

    // Check current state to decide whether to continue the animation loop
    const currentState = physicsStateRef.current;
    if (Math.abs(currentState.velocity) > MIN_VELOCITY || currentState.isSnapping) {
      animationFrameRef.current = requestAnimationFrame(updatePhysicsRef.current);
    } else {
      animationFrameRef.current = null;
    }
  }, [isVisible, abstractionChainWithDims, onScaleChange, onFocusedNodeDimensions, physicsMinLevel, physicsMaxLevel]);

  // Update updatePhysics ref
  useEffect(() => {
    updatePhysicsRef.current = updatePhysics;
  }, [updatePhysics]);

  // Start physics loop when component becomes visible
  useEffect(() => {
    if (isVisible && !animationFrameRef.current) {
      // Reset all state when carousel opens
      dispatchPhysics({ type: 'RESET' });
      lastFrameTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(updatePhysicsRef.current);
    } else if (!isVisible && animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      // Reset all state when closing
      dispatchPhysics({ type: 'RESET' });
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isVisible]); // Removed updatePhysics dependency

  // Handle wheel events for continuous scrolling
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!isVisible) return;
    
    // Mark that user has started scrolling
    dispatchPhysics({ type: 'SET_USER_SCROLLED', payload: true });
    // Dismiss hints on first scroll with fade-out
    if (!hintsDismissed) {
      setHintsDismissed(true);
      setHintOpacity(0);
    }
    
    // Allow new input to interrupt snapping
    dispatchPhysics({ type: 'INTERRUPT_SNAPPING' });
    
    // Get current state for adaptive sensitivity calculation
    const currentState = physicsStateRef.current;
    const velocityHistory = currentState.velocityHistory || [];
    
    // Calculate if we're in continuous scrolling mode
    // Look at recent velocity magnitudes to detect sustained scrolling
    const recentVelocities = velocityHistory.slice(-3); // Last 3 samples
    const hasRecentActivity = recentVelocities.length >= 2;
    const avgRecentVelocity = hasRecentActivity 
      ? recentVelocities.reduce((sum, v) => sum + Math.abs(v), 0) / recentVelocities.length 
      : 0;
    
    // Determine if we're in continuous scrolling mode
    const isContinuousScrolling = hasRecentActivity && avgRecentVelocity > CONTINUOUS_SCROLL_THRESHOLD;
    
    // Use adaptive sensitivity based on scrolling context
    const baseSensitivity = isContinuousScrolling ? BASE_SCROLL_SENSITIVITY : PRECISION_SCROLL_SENSITIVITY;
    
    // Add scroll curve enhancement for easier slow starts
    const deltaY = e.deltaY;
    const absDeltaY = Math.abs(deltaY);
    
    // Progressive sensitivity curve: lower values get boosted more
    let sensitivityMultiplier = 1.0;
    if (absDeltaY < 10) {
      // Small movements get significant boost for easier starts
      sensitivityMultiplier = 2.5;
    } else if (absDeltaY < 25) {
      // Medium movements get moderate boost
      sensitivityMultiplier = 1.8;
    } else if (absDeltaY < 50) {
      // Larger movements get small boost
      sensitivityMultiplier = 1.2;
    }
    // Very large movements (>50) use base sensitivity (1.0)
    
    const adjustedSensitivity = baseSensitivity * sensitivityMultiplier;
    const velocityChange = deltaY * adjustedSensitivity;
    
    // Calculate new velocity using current state from ref
    const newVelocity = currentState.velocity + velocityChange;
    const clampedVelocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, newVelocity));
    
    // Update velocity and add to history
    dispatchPhysics({ type: 'SET_VELOCITY_WITH_HISTORY', payload: { velocity: clampedVelocity, deltaY } });
    
    // Always start physics loop on wheel input
    if (!animationFrameRef.current) {
      lastFrameTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(updatePhysicsRef.current);
    }
  }, [isVisible, hintsDismissed]); // Remove updatePhysics dependency to avoid frequent recreations

  // Set up global, non-passive wheel event listener when carousel is visible
  useEffect(() => {
    if (isVisible) {
      document.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        document.removeEventListener('wheel', handleWheel, { passive: false });
      };
    }
  }, [isVisible]); // Removed handleWheel from dependencies to prevent infinite loop

  // Handle clicks on abstraction nodes
  const handleNodeClick = useCallback((item) => {
    if (!isVisible) return;
    
    // Jump to clicked level and set it as target
    dispatchPhysics({ type: 'JUMP_TO_LEVEL', payload: item.level });
    
    // Start physics loop for smooth animation to target
    if (!animationFrameRef.current) {
      lastFrameTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(updatePhysicsRef.current);
    }
    
    // Handle click actions for non-current nodes
    if (item.type !== 'current') {
      // TODO: Handle navigation to other abstraction levels
    }
  }, [isVisible, selectedNode]);

  // Handle external requests to move focus up/down one level
  useEffect(() => {
    if (!isVisible || !relativeMoveRequest || !abstractionChainWithDims.length) return;
    const currentPos = physicsStateRef.current.realPosition;
    const rounded = Math.round(currentPos);
    const levels = abstractionChainWithDims
      .filter(n => !n.isNonReachable && (n.type === 'current' || n.type === 'generic'))
      .map(n => n.level);
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    let target = rounded;
    if (relativeMoveRequest === 'up') {
      target = Math.max(min, rounded - 1);
    } else if (relativeMoveRequest === 'down') {
      target = Math.min(max, rounded + 1);
    }
    if (target !== rounded) {
      dispatchPhysics({ type: 'JUMP_TO_LEVEL', payload: target });
      if (!animationFrameRef.current) {
        lastFrameTimeRef.current = performance.now();
        animationFrameRef.current = requestAnimationFrame(updatePhysicsRef.current);
      }
    }
    onRelativeMoveHandled && onRelativeMoveHandled();
  }, [relativeMoveRequest, isVisible, abstractionChainWithDims]);

  // Handle escape key and click-away to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickAway = (e) => {
      if (carouselRef.current && !carouselRef.current.contains(e.target)) {
        // Also check if the click was on the abstraction control panel
        const isOnControlPanel = e.target.closest('.abstraction-control-panel');
        const isOnPieMenu = e.target.closest('.pie-menu');
        const isOnCanvas = e.target.closest('.canvas');
        
        // Only close if the click is not on any of these elements
        if (!isOnControlPanel && !isOnPieMenu && !isOnCanvas) {
          onClose();
        }
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown);
      // We listen on the document and check if the click was outside the visuals
      document.addEventListener('mousedown', handleClickAway);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('mousedown', handleClickAway);
      };
    }
  }, [isVisible, onClose]);

  if (!isVisible || !selectedNode) return null;

  const carouselPosition = getCarouselPosition();
  const stackOffset = getStackOffset();
  
  console.log('[AbstractionCarousel] Render state:', {
    isVisible,
    selectedNodeId: selectedNode?.id,
    carouselPosition,
    stackOffset,
    abstractionChainLength: abstractionChainWithDims.length,
    physicsState: {
      realPosition: physicsState.realPosition,
      targetPosition: physicsState.targetPosition,
      velocity: physicsState.velocity,
      isSnapping: physicsState.isSnapping
    }
  });

  // Compute hint placement levels and positions
  const reachableChainLevels = useMemo(() => {
    return abstractionChainWithDims
      .filter(n => !n.isNonReachable && (n.type === 'current' || n.type === 'generic'))
      .map(n => n.level);
  }, [abstractionChainWithDims]);

  const chainLevelStats = useMemo(() => {
    if (!reachableChainLevels.length) return null;
    return {
      min: Math.min(...reachableChainLevels),
      max: Math.max(...reachableChainLevels),
      count: reachableChainLevels.length
    };
  }, [reachableChainLevels]);

  const computeNodeCenterYForLevel = useCallback((level) => {
    const levelOffset = levelOffsets[level] ?? (level * (NODE_HEIGHT + LEVEL_SPACING));
    return window.innerHeight * 2 + (levelOffset * zoomLevel);
  }, [levelOffsets, zoomLevel]);

  let topHintPos = null;
  let bottomHintPos = null;
  if (chainLevelStats) {
    const centerLevel = Math.round(physicsState.realPosition);
    const topLevel = chainLevelStats.count < 7
      ? chainLevelStats.min
      : Math.max(chainLevelStats.min, centerLevel - 3);
    const bottomLevel = chainLevelStats.count < 7
      ? chainLevelStats.max
      : Math.min(chainLevelStats.max, centerLevel + 3);

    const topItem = abstractionChainWithDims.find(i => i.level === topLevel);
    const bottomItem = abstractionChainWithDims.find(i => i.level === bottomLevel);
    const topHeight = topItem?.baseDimensions?.currentHeight || NODE_HEIGHT;
    const bottomHeight = bottomItem?.baseDimensions?.currentHeight || NODE_HEIGHT;

    const nodeX = window.innerWidth * 0.5;
    const topCenterY = computeNodeCenterYForLevel(topLevel);
    const bottomCenterY = computeNodeCenterYForLevel(bottomLevel);
    const margin = 60; // px margin away from node box

    topHintPos = {
      x: nodeX,
      y: topCenterY - (topHeight / 2) * zoomLevel - margin
    };
    bottomHintPos = {
      x: nodeX,
      y: bottomCenterY + (bottomHeight / 2) * zoomLevel + margin
    };
  }

  return (
    <div
      ref={carouselRef}
      style={{
        position: 'fixed',
        left: carouselPosition.x,
        top: carouselPosition.y,
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        pointerEvents: 'auto',
        cursor: 'grab'
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Debug indicator - temporary visual aid */}
      {debugMode && (
        <div style={{
          position: 'absolute',
          left: '-10px',
          top: '-10px',
          width: '20px',
          height: '20px',
          backgroundColor: 'red',
          borderRadius: '50%',
          zIndex: 1001,
          pointerEvents: 'none'
        }} />
      )}
      
      {/* SVG Container for the abstraction nodes */}
      <svg
        style={{
          position: 'absolute',
          left: '-50vw',
          top: '-200vh',
          width: '100vw',
          height: '400vh',
          pointerEvents: 'none',
          transform: `translateY(${stackOffset}px)`,
          transition: physicsState.isSnapping ? 'none' : 'none' // No CSS transitions, using JS animation
        }}
      >
        <defs>
          {/* Define clip paths for each node's image */}
          {abstractionChainWithDims.map((item) => {
            // Check if this node has a thumbnail (current node uses selectedNode data)
            const hasThumbnail = Boolean(item.thumbnailSrc);
            if (!hasThumbnail) return null; // Only for nodes with images

            const nodeDimensions = item.baseDimensions;
            const { currentWidth, currentHeight, textAreaHeight, imageWidth, calculatedImageHeight } = nodeDimensions;
            
            // Use simple corner radius to match Node.jsx
            const imageCornerRadius = NODE_CORNER_RADIUS;

            return (
              <clipPath key={`clip-image-${item.id}`} id={`carousel-image-clip-${item.id}`}>
                <rect
                  // These coordinates are relative to the center of the node group's transform
                  x={-currentWidth / 2 + NODE_PADDING}
                  y={-currentHeight / 2 + textAreaHeight}
                  width={imageWidth}
                  height={calculatedImageHeight}
                  rx={imageCornerRadius}
                  ry={imageCornerRadius}
                />
              </clipPath>
            );
          })}
        </defs>

        {/* Render all abstraction levels in a vertical stack */}
        {(() => {
          console.log('[AbstractionCarousel] Rendering nodes:', {
            totalNodes: abstractionChainWithDims.length,
            physicsPosition: physicsState.realPosition,
            nodes: abstractionChainWithDims.map(item => ({
              id: item.id,
              name: item.name,
              level: item.level,
              type: item.type
            }))
          });
          
          return [...abstractionChainWithDims]
            .sort((a, b) => {
              const distA = Math.abs(a.level - physicsState.realPosition);
              const distB = Math.abs(b.level - physicsState.realPosition);

              // Centered node (closest to scroll position) always renders on top
              const isACenter = distA < 0.5;
              const isBCenter = distB < 0.5;
              
              if (isACenter && !isBCenter) return 1; // A is center, B is not - A on top
              if (isBCenter && !isACenter) return -1; // B is center, A is not - B on top
              
              // If both are center or neither are center, sort by distance - closer nodes render on top
              return distA - distB;
            })
            .map((item, index) => {
          const nodeDimensions = item.baseDimensions; // Use pre-calculated dimensions
          const isCurrent = item.type === 'current';
          const distanceFromMain = Math.abs(item.level - physicsState.realPosition);
          
          // Fog of war: hide nodes beyond a certain distance (show more for stacking effect)
          const maxVisibleDistance = Math.min(10, abstractionChainWithDims.length + 2);
          if (distanceFromMain > maxVisibleDistance) {
            return null;
          }

          // Calculate entrance/exit animation properties
          let animationOpacity = 1;
          let animationScale = 1;
          let animationDelay = 0;
          let useAnimationOpacity = false;
          let opacityTransitionDelay = 0;

          // Only animate nodes within 2 levels of the center
          const shouldAnimate = distanceFromMain <= 2;

          if (animationState === 'entering' && shouldAnimate) {
            // Entrance animation: start from center, staggered by distance
            // EXCEPTION: Current node (isCurrent) should NOT animate - it's the "hidden cut"
            if (!isCurrent) {
              animationDelay = distanceFromMain * 40; // 40ms per level (faster)
              animationOpacity = 0;
              animationScale = 0.3;
              useAnimationOpacity = true; // Override opacity for entrance
              // Add additional delay for opacity transition after entrance completes
              opacityTransitionDelay = animationDelay + 200; // 200ms entrance duration + stagger delay
            }
          } else if (animationState === 'exiting' && !isCurrent && shouldAnimate) {
            // Exit animation: shrink to center, reverse stagger
            animationDelay = (4 - distanceFromMain) * 30; // 30ms reverse stagger (faster)
            animationScale = 0.3;
            useAnimationOpacity = false; // Don't override opacity - let CSS animate from current opacity
          }
          
          // Progressive scaling for stacking effect - more pronounced size differences
          let scale = 1.0;
          if (distanceFromMain === 0) {
            // Exactly at focus - should match the real node size
            scale = 1.0;
          } else if (distanceFromMain < 1) {
            // Close to focus - more pronounced drop for stacking
            scale = 1.0 - (distanceFromMain * 0.25);
          } else if (distanceFromMain < 2) {
            // Medium distance - continue shrinking
            scale = 0.75 - ((distanceFromMain - 1) * 0.15);
          } else {
            // Further from focus - shrink more significantly for layering effect
            scale = 0.6 - ((distanceFromMain - 2) * 0.08);
            scale = Math.max(0.35, scale); // Minimum scale for visibility in stack
          }
          
          // Calculate opacity: more pronounced falloff for stacking effect
          let opacity = 1;
          if (distanceFromMain <= 0.5) {
            opacity = 1.0; // Full opacity for center node
          } else if (distanceFromMain <= 1) {
            opacity = 0.95 - (distanceFromMain * 0.15); // Gentle falloff for adjacent nodes
          } else if (distanceFromMain <= 2) {
            opacity = 0.8 - ((distanceFromMain - 1) * 0.3); // More pronounced falloff for stacking
          } else if (distanceFromMain <= 3) {
            opacity = 0.5 - ((distanceFromMain - 2) * 0.3); // Continue falloff
          } else {
            opacity = 0.2 - ((distanceFromMain - 3) * 0.15); // Fade to very low opacity
          }
          
          // Apply animation opacity only when we want to override (entrance animation)
          if (useAnimationOpacity) {
            opacity = animationOpacity; // Apply to all nodes during entrance, including current
          }
          // For exit animations, keep the natural calculated opacity so CSS can animate from it
          
          // Position calculation - uses dynamic offsets now
          const nodeX = window.innerWidth * 0.5;
          // Fix NaN issue by providing fallback for missing levelOffsets
          const levelOffset = levelOffsets[item.level] ?? (item.level * (NODE_HEIGHT + LEVEL_SPACING));
          const nodeY = window.innerHeight * 2 + (levelOffset * zoomLevel);
          
          // Determine if this is the "main" node (closest to scroll position)
          const isMainNode = distanceFromMain < 0.5;
          
          // --- Refactored for Stable Scaling & Image Support ---
          const {
            currentWidth: unscaledWidth,
            currentHeight: unscaledHeight,
            textAreaHeight: unscaledTextAreaHeight,
            imageWidth: unscaledImageWidth,
            calculatedImageHeight: unscaledImageHeight
          } = item.baseDimensions;
          const hasThumbnail = Boolean(item.thumbnailSrc);

          // Unscaled border and corner radius
          const borderWidth = isMainNode ? 12 : 0; // Match NodeCanvas: 12 for centered, 0 for others
          const cornerRadius = NODE_CORNER_RADIUS;
          
          const borderColor = isMainNode ? 'black' : 'none'; // Match NodeCanvas: black for centered, none for others
          const nodeColor = item.color || NODE_DEFAULT_COLOR;
          


          // Calculate animation transform for enter/exit
          // EXCEPTION: Current node does NOT animate during entrance (hidden cut)
          const shouldApplyAnimation = shouldAnimate && (
            (animationState === 'entering' && !isCurrent) || // Non-current nodes animate in, current node appears instantly
            (animationState === 'exiting' && !isCurrent) // Only non-current nodes animate out
          );

          const animationTransform = shouldApplyAnimation
            ? `scale(${animationScale})`
            : 'scale(1)';

          const animationStyles = shouldApplyAnimation ? {
            animation: animationState === 'entering'
              ? `carousel-node-enter 0.2s ease-out ${animationDelay}ms both`
              : `carousel-node-exit 0.2s ease-in ${animationDelay}ms both`,
            // For exit animations, pass the current opacity as a CSS variable
            ...(animationState === 'exiting' ? { '--start-opacity': opacity } : {})
          } : {};

          // Calculate final opacity with transition
          const finalOpacity = useAnimationOpacity ? animationOpacity : opacity;
          const opacityStyle = (animationState === 'entering' && shouldAnimate && !isCurrent) ? {
            opacity: 1, // Start at full opacity after entrance
            animation: `carousel-opacity-transition 0.4s ease ${opacityTransitionDelay}ms forwards`,
            // Set CSS custom property for the final target opacity
            '--target-opacity': opacity
          } : {
            opacity: finalOpacity
          };

          return (
            <g
              key={item.id}
              style={{
                ...opacityStyle,
                cursor: 'pointer',
                pointerEvents: 'auto',
                transform: animationTransform,
                transformOrigin: `${nodeX}px ${nodeY}px`,
                ...animationStyles
              }}
              onClick={() => handleNodeClick(item)}
            >
              {/* This group handles positioning and dynamic scaling, keeping contents stable */}
              <g transform={`translate(${nodeX}, ${nodeY}) scale(${zoomLevel * scale})`}>
                {/* Background rect - uses unscaled dimensions */}
                <rect
                  x={-unscaledWidth / 2 + 6}
                  y={-unscaledHeight / 2 + 6}
                  width={unscaledWidth - 12}
                  height={unscaledHeight - 12}
                  rx={cornerRadius - 6}
                  ry={cornerRadius - 6}
                  fill={nodeColor}
                  stroke={borderColor}
                  strokeWidth={8}
                  style={{
                    filter: isMainNode 
                      ? 'drop-shadow(0px 0px 20px rgba(0, 0, 0, 0.6))'
                      : `drop-shadow(0px ${Math.min(8, 2 + distanceFromMain * 2)}px ${Math.min(16, 4 + distanceFromMain * 4)}px rgba(0, 0, 0, ${Math.min(0.4, 0.1 + distanceFromMain * 0.1)}))`
                  }}
                />
                
                {/* Image (if available) - positioned relative to center */}
                {hasThumbnail && (
                    <image
                        x={-unscaledWidth / 2 + NODE_PADDING}
                        y={-unscaledHeight / 2 + unscaledTextAreaHeight}
                        width={unscaledImageWidth}
                        height={unscaledImageHeight}
                        href={item.thumbnailSrc}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#carousel-image-clip-${item.id})`}
                    />
                )}

                {/* ForeignObject for name text - uses unscaled dimensions */}
                <foreignObject
                  x={-unscaledWidth / 2}
                  y={-unscaledHeight / 2}
                  width={unscaledWidth}
                  height={hasThumbnail ? unscaledTextAreaHeight : unscaledHeight}
                  style={{
                    overflow: 'hidden',
                    pointerEvents: 'none'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      height: '100%',
                      // Match Node.jsx single-line padding for non-preview nodes
                      // Node.jsx uses `20px ${isMultiline ? 30 : 22}px` when not previewing
                      padding: `20px ${(() => {
                        const singleLineSidePadding = 22;
                        const availableWidth = unscaledWidth - (2 * singleLineSidePadding);
                        const averageCharWidth = 12; // Keep consistent with Node.jsx
                        const charsPerLine = Math.floor(availableWidth / averageCharWidth);
                        const isMultiline = (item.name || '').length > charsPerLine;
                        return isMultiline ? 30 : 22;
                      })()}px`,
                      boxSizing: 'border-box',
                      userSelect: 'none',
                      minWidth: 0
                    }}
                  >
                    <span
                      style={{
                        fontSize: '20px',
                        fontWeight: 'bold',
                        fontFamily: "'EmOne', sans-serif",
                        color: item.textColor || getTextColor(nodeColor),
                        lineHeight: '32px',
                        whiteSpace: 'normal',
                        overflowWrap: 'break-word',
                        wordBreak: 'break-word',
                        textAlign: 'center',
                        minWidth: 0,
                        width: '100%',
                        display: 'inline-block',
                        hyphens: 'auto'
                      }}
                      lang="en"
                    >
                      {item.name}
                    </span>
                  </div>
                </foreignObject>

                {/* Level indicator - positioned inside the transformed group */}
                {debugMode && (
                  <g>
                    <circle
                      cx={unscaledWidth / 2 - 8}
                      cy={-unscaledHeight / 2 + 8}
                      r={12}
                      fill={isMainNode ? 'black' : '#666'}
                      stroke="none"
                    />
                    <text
                      x={unscaledWidth / 2 - 8}
                      y={-unscaledHeight / 2 + 8}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={12}
                      fontFamily="'EmOne', sans-serif"
                      fill="#bdb5b5"
                      fontWeight="bold"
                      style={{
                        userSelect: 'none',
                        pointerEvents: 'none'
                      }}
                    >
                      {item.level}
                    </text>
                  </g>
                )}
              </g>
            </g>
          );
        });
        })()}
      </svg>

      {/* Static hint overlays: fade-in on open, fade-out on first scroll */}
      {isVisible && topHintPos && bottomHintPos && (
        <svg
          style={{
            position: 'absolute',
            left: '-50vw',
            top: '-200vh',
            width: '100vw',
            height: '400vh',
            pointerEvents: 'none',
            transform: `translateY(${stackOffset}px)`,
            opacity: hintsDismissed ? 0 : hintOpacity,
            transition: 'opacity 180ms ease'
          }}
        >
          {/* Top hint: text above, up chevron below the text */}
          <g transform={`translate(${topHintPos.x}, ${topHintPos.y})`}>
            <text
              x={0}
              y={-46}
              textAnchor="middle"
              dominantBaseline="baseline"
              fontSize={30}
              fontFamily="'EmOne', sans-serif"
              fill="#260000"
              stroke="#BDB5B5"
              strokeWidth={2}
              style={{ paintOrder: 'stroke fill' }}
            >
              More Specific
            </text>
            <ChevronUp className="hint-arrow-up" x={-20} y={-34} size={40} color="#260000" strokeWidth={3} />
          </g>

          {/* Bottom hint: down chevron, then text below */}
          <g transform={`translate(${bottomHintPos.x}, ${bottomHintPos.y})`}>
            <ChevronDown className="hint-arrow-down" x={-20} y={-2} size={40} color="#260000" strokeWidth={3} />
            <text
              x={0}
              y={46}
              textAnchor="middle"
              dominantBaseline="hanging"
              fontSize={30}
              fontFamily="'EmOne', sans-serif"
              fill="#260000"
              stroke="#BDB5B5"
              strokeWidth={2}
              style={{ paintOrder: 'stroke fill' }}
            >
              Less Specific
            </text>
          </g>
        </svg>
      )}

      {/* Navigation hints - now shows continuous position */}
      {debugMode && (
        <div style={{
          position: 'absolute',
          right: '-80px',
          top: `${stackOffset}px`,
          color: '#666',
          fontSize: `${12 * zoomLevel}px`,
          fontFamily: "'EmOne', sans-serif",
          pointerEvents: 'none',
          userSelect: 'none',
          textAlign: 'left'
        }}>
          <div style={{ marginBottom: '8px' }}>↑ Specific</div>
          <div style={{ 
            color: '#333', 
            fontWeight: 'bold',
            fontSize: `${14 * zoomLevel}px`,
            fontFamily: "'EmOne', sans-serif",
            marginBottom: '8px'
          }}>
            Level {physicsState.realPosition.toFixed(1)}
          </div>
          <div>↓ General</div>
          
          {/* Physics debug info */}
          <div style={{ 
            fontSize: `${10 * zoomLevel}px`,
            fontFamily: "'EmOne', sans-serif",
            color: '#999',
            marginTop: '10px'
          }}>
            <div>real: {physicsState.realPosition.toFixed(2)}</div>
            <div>target: {physicsState.targetPosition}</div>
            <div>v: {physicsState.velocity.toFixed(2)}</div>
            {physicsState.isSnapping && <div>snapping</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default AbstractionCarousel; 
