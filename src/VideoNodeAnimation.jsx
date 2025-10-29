import React, { useRef, useEffect, useMemo } from 'react';
import { NODE_CORNER_RADIUS } from './constants';
import { getNodeDimensions } from './utils.js';

/**
 * Special video animation component for Y-key + plus sign click
 * Phases:
 * 1. Stretch (0-1s): Dot expands into horizontal line
 * 2. Tremble (1-4s): Line oscillates height (±1/6 of NODE_HEIGHT)
 * 3. Explode (4-5s): Expands to full node with "Hello, World" text
 */
const VideoNodeAnimation = ({ x, y, onComplete }) => {
  const mockNode = useMemo(() => ({
    name: 'Hello, World',
    color: 'maroon',
    definitionGraphIds: [],
    prototypeId: 'video-animation-node',
  }), []);

  const nodeDimensionsRef = useRef(null);
  if (!nodeDimensionsRef.current) {
    nodeDimensionsRef.current = getNodeDimensions(mockNode, false, null);
  }

  const nodeDimensions = nodeDimensionsRef.current;
  const targetOuterWidth = nodeDimensions.currentWidth;
  const targetOuterHeight = nodeDimensions.currentHeight;
  const targetInnerWidth = Math.max(0, targetOuterWidth - 12);
  const targetInnerHeight = Math.max(0, targetOuterHeight - 12);

  const textBaseSidePadding = 22; // Matches single-line padding in Node.jsx

  const animationFrameRef = useRef(null);
  const startTimeRef = useRef(null);
  const [, forceUpdate] = React.useReducer((s) => s + 1, 0);
  
  const stateRef = useRef({
    width: 10,
    height: 10,
    cornerRadius: NODE_CORNER_RADIUS - 6, // Match actual node corner radius (34)
    textOpacity: 0,
    phase: 'stretch' // stretch, tremble, explode, done
  });

  const PHASES = {
    stretch: { duration: 1590, startTime: 1000 },
    tremble: { duration: 3110, startTime: 2590 },
    explode: { duration: 1000, startTime: 5700 }
  };

  const lerp = (a, b, t) => a + (b - a) * t;
  
  const easeInOutCubic = (t) => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  const easeOutCubic = (t) => {
    return 1 - Math.pow(1 - t, 3);
  };

  useEffect(() => {
    startTimeRef.current = performance.now();
    
    const animate = (currentTime) => {
      if (!startTimeRef.current) {
        startTimeRef.current = currentTime;
      }
      
      const elapsed = currentTime - startTimeRef.current;
      
      // Determine current phase
      let phase = 'stretch';
      if (elapsed >= PHASES.explode.startTime) {
        phase = 'explode';
      } else if (elapsed >= PHASES.tremble.startTime) {
        phase = 'tremble';
      }
      
      stateRef.current.phase = phase;
      
      if (phase === 'stretch') {
        // Phase 1: Dot expands into horizontal line
        const phaseElapsed = elapsed - PHASES.stretch.startTime;
        const t = Math.min(phaseElapsed / PHASES.stretch.duration, 1);
        const easeT = easeInOutCubic(t);
        
        stateRef.current.width = lerp(10, targetInnerWidth, easeT);
        stateRef.current.height = 10;
        stateRef.current.cornerRadius = NODE_CORNER_RADIUS - 6; // Match actual node corner (34)
        stateRef.current.textOpacity = 0;
        
      } else if (phase === 'tremble') {
        // Phase 2: Line trembles with oscillating height
        const phaseElapsed = elapsed - PHASES.tremble.startTime;
        const oscillationAmount = targetInnerHeight / 6; // ±16.67% of final height
        const frequency = 6; // 6 cycles per second
        
        // Sine wave oscillation
        const oscillation = oscillationAmount * Math.sin(phaseElapsed * frequency * Math.PI * 2 / 1000);
        
        stateRef.current.width = targetInnerWidth; // Match actual node width
        stateRef.current.height = 10 + Math.abs(oscillation); // Keep height positive
        stateRef.current.cornerRadius = NODE_CORNER_RADIUS - 6;
        stateRef.current.textOpacity = 0;
        
      } else if (phase === 'explode') {
        // Phase 3: Explodes to full node size with text
        const phaseElapsed = elapsed - PHASES.explode.startTime;
        const t = Math.min(phaseElapsed / PHASES.explode.duration, 1);
        const easeT = easeOutCubic(t);
        
        // Get current tremble height at the transition point
        const trembleOscillation = (targetInnerHeight / 6) * Math.sin((PHASES.explode.startTime - PHASES.tremble.startTime) * 6 * Math.PI * 2 / 1000);
        const startHeight = 10 + Math.abs(trembleOscillation);
        
        stateRef.current.width = targetInnerWidth; // Match actual node width
        stateRef.current.height = lerp(startHeight, targetInnerHeight, easeT); // Match actual node height
        stateRef.current.cornerRadius = NODE_CORNER_RADIUS - 6;
        stateRef.current.textOpacity = easeT; // Fade in text during explosion
        
        // Check if animation is complete
        if (t >= 1) {
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          onComplete?.();
          return;
        }
      }
      
      forceUpdate();
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [onComplete]);

  const { width, height, cornerRadius, textOpacity } = stateRef.current;

  const textContainerOpacity = Math.min(1, Math.max(0, textOpacity));

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Animated fill rectangle (inner node background) */}
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={cornerRadius}
        ry={cornerRadius}
        fill="maroon"
        stroke="none"
      />
      
      {/* Real node layout rendered via foreignObject to match Node.jsx exactly */}
      {textContainerOpacity > 0 && (
        <foreignObject
          x={-targetOuterWidth / 2}
          y={-targetOuterHeight / 2}
          width={targetOuterWidth}
          height={targetOuterHeight}
          style={{ pointerEvents: 'none', opacity: textContainerOpacity }}
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: `20px ${textBaseSidePadding}px`,
              boxSizing: 'border-box',
              pointerEvents: 'none',
              userSelect: 'none',
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#bdb5b5',
                fontFamily: "'EmOne', sans-serif",
                lineHeight: '32px',
                whiteSpace: 'normal',
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
                textAlign: 'center',
                minWidth: 0,
                display: 'inline-block',
                width: '100%',
              }}
            >
              Hello, World
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  );
};

export default VideoNodeAnimation;

