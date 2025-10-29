import React, { useRef, useEffect } from 'react';
import { NODE_WIDTH, NODE_HEIGHT } from './constants';

/**
 * Special video animation component for Y-key + plus sign click
 * Phases:
 * 1. Stretch (0-1s): Dot expands into horizontal line
 * 2. Tremble (1-4s): Line oscillates height (±1/6 of NODE_HEIGHT)
 * 3. Explode (4-5s): Expands to full node with "Hello, World" text
 */
const VideoNodeAnimation = ({ x, y, onComplete }) => {
  const animationFrameRef = useRef(null);
  const startTimeRef = useRef(null);
  const [, forceUpdate] = React.useReducer((s) => s + 1, 0);
  
  const stateRef = useRef({
    width: 10,
    height: 10,
    cornerRadius: 40,
    textOpacity: 0,
    phase: 'stretch' // stretch, tremble, explode, done
  });

  const PHASES = {
    stretch: { duration: 1000, startTime: 0 },
    tremble: { duration: 3000, startTime: 1000 },
    explode: { duration: 1000, startTime: 4000 }
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
        
        stateRef.current.width = lerp(10, NODE_WIDTH, easeT);
        stateRef.current.height = 10;
        stateRef.current.cornerRadius = 40;
        stateRef.current.textOpacity = 0;
        
      } else if (phase === 'tremble') {
        // Phase 2: Line trembles with oscillating height
        const phaseElapsed = elapsed - PHASES.tremble.startTime;
        const oscillationAmount = NODE_HEIGHT / 6; // ±16.67px
        const frequency = 6; // 6 cycles per second
        
        // Sine wave oscillation
        const oscillation = oscillationAmount * Math.sin(phaseElapsed * frequency * Math.PI * 2 / 1000);
        
        stateRef.current.width = NODE_WIDTH;
        stateRef.current.height = 10 + Math.abs(oscillation); // Keep height positive
        stateRef.current.cornerRadius = 40;
        stateRef.current.textOpacity = 0;
        
      } else if (phase === 'explode') {
        // Phase 3: Explodes to full node size with text
        const phaseElapsed = elapsed - PHASES.explode.startTime;
        const t = Math.min(phaseElapsed / PHASES.explode.duration, 1);
        const easeT = easeOutCubic(t);
        
        // Get current tremble height at the transition point
        const trembleOscillation = NODE_HEIGHT / 6 * Math.sin((PHASES.explode.startTime - PHASES.tremble.startTime) * 6 * Math.PI * 2 / 1000);
        const startHeight = 10 + Math.abs(trembleOscillation);
        
        stateRef.current.width = NODE_WIDTH;
        stateRef.current.height = lerp(startHeight, NODE_HEIGHT, easeT);
        stateRef.current.cornerRadius = 40;
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

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* The animated shape */}
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={cornerRadius}
        ry={cornerRadius}
        fill="#DEDADA"
        stroke="maroon"
        strokeWidth={5}
      />
      
      {/* "Hello, World" text - fades in during explosion */}
      {textOpacity > 0 && (
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          fill="maroon"
          fontSize="16"
          fontFamily="Arial, sans-serif"
          fontWeight="bold"
          opacity={textOpacity}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          Hello, World
        </text>
      )}
    </g>
  );
};

export default VideoNodeAnimation;

