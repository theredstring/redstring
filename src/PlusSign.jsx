import React, { useRef, useEffect } from 'react';
import { NODE_WIDTH, NODE_HEIGHT, PLUS_SIGN_SIZE, PLUS_SIGN_ANIMATION_DURATION } from './constants';

const PlusSign = ({
  plusSign,
  onClick,
  onMorphDone,
  onDisappearDone,
  targetWidth = NODE_WIDTH,
  targetHeight = NODE_HEIGHT
}) => {
  const animationFrameRef = useRef(null);
  const plusRef = useRef({
    rotation: -90,
    width: 0,
    height: 0,
    cornerRadius: 40,
    color: '#DEDADA',
    strokeColor: 'maroon',
    lineOpacity: 1,
    textOpacity: 0,
  });
  const [, forceUpdate] = React.useReducer((s) => s + 1, 0);
  const touchActiveRef = useRef(false);
  const pointerActiveRef = useRef(false);

  useEffect(() => {
    runAnimation();
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [plusSign.mode]);

  const lerp = (a, b, t) => a + (b - a) * t;
  
  const interpolateColor = (color1, color2, factor) => {
    // Simple color interpolation for hex colors
    if (color1 === color2) return color1;
    
    // CSS color name to hex mapping
    const colorNameToHex = {
      'maroon': '#800000',
      'red': '#FF0000',
      'orange': '#FFA500',
      'yellow': '#FFFF00',
      'olive': '#808000',
      'green': '#008000',
      'purple': '#800080',
      'fuchsia': '#FF00FF',
      'lime': '#00FF00',
      'teal': '#008080',
      'aqua': '#00FFFF',
      'blue': '#0000FF',
      'navy': '#000080',
      'black': '#000000',
      'gray': '#808080',
      'silver': '#C0C0C0',
      'white': '#EFE8E5'
    };
    
    // Convert hex to RGB
    const hexToRgb = (hex) => {
      // Handle both #RRGGBB and RRGGBB formats
      const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
      const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(cleanHex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : null;
    };
    
    // Handle different color formats
    const normalizeColor = (color) => {
      if (typeof color === 'string') {
        // Handle CSS color names
        if (colorNameToHex[color.toLowerCase()]) {
          return colorNameToHex[color.toLowerCase()];
        }
        if (color.startsWith('#')) return color;
        if (color.startsWith('rgb')) {
          // Convert RGB to hex
          const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (match) {
            const r = parseInt(match[1]);
            const g = parseInt(match[2]);
            const b = parseInt(match[3]);
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          }
        }
        // Try to parse as hex without #
        if (/^[0-9A-Fa-f]{6}$/.test(color)) {
          return `#${color}`;
        }
      }
      return color;
    };
    
    const normalizedColor1 = normalizeColor(color1);
    const normalizedColor2 = normalizeColor(color2);
    
    const rgb1 = hexToRgb(normalizedColor1);
    const rgb2 = hexToRgb(normalizedColor2);
    
    if (!rgb1 || !rgb2) {
      console.warn('Color interpolation failed:', { 
        color1, color2, 
        normalizedColor1, normalizedColor2,
        rgb1, rgb2 
      });
      return color1;
    }
    
    const r = Math.round(lerp(rgb1.r, rgb2.r, factor));
    const g = Math.round(lerp(rgb1.g, rgb2.g, factor));
    const b = Math.round(lerp(rgb1.b, rgb2.b, factor));
    
    const result = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    return result;
  };

  const runAnimation = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    const startTime = performance.now();
    const { mode } = plusSign;
    const appearDisappearDuration = PLUS_SIGN_ANIMATION_DURATION || 200;
    const morphDuration = 400; // Increased for smoother animation
    const duration = mode === 'morph' ? morphDuration : appearDisappearDuration;

    const {
      rotation: startRot,
      width: startW,
      height: startH,
      cornerRadius: startCorner,
      color: startColor,
      lineOpacity: startLineOp,
      textOpacity: startTextOp,
    } = plusRef.current;

    let endRot = 0;
    let endWidth = PLUS_SIGN_SIZE;
    let endHeight = PLUS_SIGN_SIZE;
    let endCorner = 40;
    let endColor = '#DEDADA';
    let endLineOp = 1;
    let endTextOp = 0;

    if (mode === 'appear') {
      endRot = 0;
      endWidth = PLUS_SIGN_SIZE;
      endHeight = PLUS_SIGN_SIZE;
      endCorner = 40;
      endColor = '#DEDADA';
      endLineOp = 1;
      endTextOp = 0;
    } else if (mode === 'disappear') {
      endRot = -90;
      endWidth = 0;
      endHeight = 0;
      endCorner = 40;
      endColor = '#DEDADA';
      endLineOp = 1;
      endTextOp = 0;
    } else if (mode === 'morph') {
      endRot = 0;
      endWidth = targetWidth;
      endHeight = targetHeight;
      endCorner = 40;
      endColor = plusSign.selectedColor || 'maroon'; // Use selected color if available
      console.log('Morph setup:', { 
        selectedColor: plusSign.selectedColor, 
        selectedColorType: typeof plusSign.selectedColor,
        endColor, 
        tempName: plusSign.tempName,
        mode: plusSign.mode,
        plusSignKeys: Object.keys(plusSign)
      });
      endLineOp = 0;
      endTextOp = 1;
    }

    const animateFrame = (currentTime) => {
      const elapsed = currentTime - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Smoother easing function using cubic-bezier approximation
      const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      plusRef.current = {
        x: 0, // Don't animate position - let the final node appear at the correct location
        y: 0,
        rotation: lerp(startRot, endRot, easeT),
        width: Math.max(0, lerp(startW, endWidth, easeT)), // Prevent negative width
        height: Math.max(0, lerp(startH, endHeight, easeT)), // Prevent negative height
        cornerRadius: Math.max(0, lerp(startCorner, endCorner, easeT)), // Prevent negative corner radius
        color: mode === 'morph'
          ? (() => {
              // Make color transition faster by using a steeper curve
              const colorT = Math.min(easeT * 1.5, 1); // Color changes 1.5x faster
              const interpolatedColor = interpolateColor('#DEDADA', endColor, colorT);
              return interpolatedColor;
            })()
          : '#DEDADA',
        strokeColor: mode === 'morph'
          ? interpolateColor('maroon', endColor, easeT) // Stroke fades from maroon to target color
          : 'maroon',
        lineOpacity: mode === 'morph'
          ? Math.max(0, 1 - easeT * 4) // Plus sign fades out even faster
          : lerp(startLineOp, endLineOp, easeT),
        textOpacity: mode === 'morph'
          ? Math.max(0, (easeT - 0.2) * 1.25) // Text appears sooner
          : 0,
      };

      forceUpdate();

      if (t < 1) {
        animationFrameRef.current = requestAnimationFrame(animateFrame);
      } else {
        animationFrameRef.current = null;
        if (mode === 'disappear') {
          onDisappearDone?.();
        } else if (mode === 'morph') {
          onMorphDone?.();
        }
      }
    };

    animationFrameRef.current = requestAnimationFrame(animateFrame);
  };

  const { rotation, width, height, cornerRadius, color, strokeColor, lineOpacity, textOpacity } = plusRef.current;
  const { mode, tempName } = plusSign;
  const halfCross = width / 4;

  return (
    <g
      data-plus-sign="true"
      transform={`translate(${plusSign.x}, ${plusSign.y}) rotate(${rotation})`}
      style={{ cursor: 'pointer', touchAction: 'manipulation', pointerEvents: 'auto' }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick?.();
      }}
      onPointerDown={(e) => {
        // Fallback for devices using Pointer Events (covers touch, pen, mouse)
        if (e && e.cancelable) { e.preventDefault(); }
        e.stopPropagation();
        pointerActiveRef.current = true;
      }}
      onPointerUp={(e) => {
        if (e && e.cancelable) { e.preventDefault(); }
        e.stopPropagation();
        if (pointerActiveRef.current) {
          pointerActiveRef.current = false;
          onClick?.();
        }
      }}
      onTouchStart={(e) => {
        if (e && e.cancelable) { e.preventDefault(); }
        e.stopPropagation();
        touchActiveRef.current = true;
      }}
      onTouchEnd={(e) => {
        if (e && e.cancelable) { e.preventDefault(); }
        e.stopPropagation();
        if (touchActiveRef.current) {
          touchActiveRef.current = false;
          onClick?.();
        }
      }}
    >
      {(() => {
        // Ensure a comfortable touch hit area even when small
        const hit = Math.max(44, width || 0, height || 0);
        if (hit <= 0) return null;
        return (
          <rect
            x={-hit / 2}
            y={-hit / 2}
            width={hit}
            height={hit}
            fill="transparent"
            stroke="none"
            pointerEvents="auto"
          />
        );
      })()}
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={cornerRadius}
        ry={cornerRadius}
        fill={color}
        stroke={strokeColor}
        strokeWidth={5}
      />
      <line
        x1={-halfCross}
        y1={0}
        x2={halfCross}
        y2={0}
        stroke="maroon"
        strokeWidth={5}
        opacity={lineOpacity}
      />
      <line
        x1={0}
        y1={-halfCross}
        x2={0}
        y2={halfCross}
        stroke="maroon"
        strokeWidth={5}
        opacity={lineOpacity}
      />

    </g>
  );
};

export default PlusSign; 