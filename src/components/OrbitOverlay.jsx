import React, { useMemo, useEffect, useRef, useState } from 'react';

import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { getNodeDimensions } from '../utils.js';
import { NODE_CORNER_RADIUS, NODE_PADDING, NODE_DEFAULT_COLOR } from '../constants';
import { candidateToConcept } from '../services/candidates.js';
import { useTheme } from '../hooks/useTheme.js';
import useGraphStore from '../store/graphStore.jsx';
import { getTextColor, getInvertedTextColor } from '../utils/colorUtils';
import { formatPredicate } from '../utils/predicateFormatter.js';

const SPAWNABLE_NODE = 'spawnable_node';

const DRAG_MARGIN = 90; // Spacing from node edge to orbit ring and between rings
const ORBIT_ANGULAR_SPEED_RAD_PER_SEC = 0.015; // Very slow clockwise rotation
const RADIAL_PERTURBATION_PX_BASE = 6; // subtle radial wiggle
const ANGLE_JITTER_RAD_BASE = 0.008; // subtle angle wobble
const MIN_FREQ_HZ = 0.2;
const MAX_FREQ_HZ = 1.2;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Deterministic pseudo-random in [0,1) from a string and optional salt
const hashToUnitFloat = (str, salt = '') => {
  let h = 2166136261;
  const s = String(str) + '|' + String(salt);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  // Convert to [0,1)
  return (h & 0x7fffffff) / 0x80000000;
};

// Component to render a connection from center to an orbit item
const OrbitConnection = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  predicate,
  color,
  isHovered = false
}) => {
  const theme = useTheme();

  // Don't render generic or missing predicates
  if (!predicate || predicate === 'relatedTo' || predicate === null) {
    return null;
  }

  const formattedPredicate = formatPredicate(predicate);
  const textColor = getTextColor(color, theme.darkMode);

  // Calculate direction vector and length (matching NodeCanvas)
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.sqrt(dx * dx + dy * dy);

  // Calculate midpoint for label placement
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  // Calculate arrow position - find intersection with target node edge, then offset back
  // This matches NodeCanvas edge rendering (lines 9950-9954)
  const targetWidth = 150; // Approximate orbit item width
  const targetHeight = 80; // Approximate orbit item height

  // Find intersection with target node rectangle
  const halfWidth = targetWidth / 2;
  const halfHeight = targetHeight / 2;

  // Direction from source to target
  const dirX = dx / length;
  const dirY = dy / length;

  // Calculate intersection with node bounds (simplified - assumes rectangle)
  let tIntersect = Infinity;

  // Check intersection with each side
  if (dirX !== 0) {
    const tRight = (halfWidth) / Math.abs(dirX);
    const tLeft = (halfWidth) / Math.abs(dirX);
    tIntersect = Math.min(tIntersect, tRight, tLeft);
  }
  if (dirY !== 0) {
    const tTop = (halfHeight) / Math.abs(dirY);
    const tBottom = (halfHeight) / Math.abs(dirY);
    tIntersect = Math.min(tIntersect, tTop, tBottom);
  }

  // Position arrow back from intersection point
  // Adjust offset based on angle - larger offset for diagonal/corner intersections
  const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
  const normalizedAngle = angle > 90 ? 180 - angle : angle;
  const isQuantizedSlope = normalizedAngle < 15 || normalizedAngle > 75; // Near horizontal/vertical
  const baseOffset = 50; // Base offset distance
  const arrowLength = isQuantizedSlope ? baseOffset * 0.7 : baseOffset; // Larger offset for corners
  const intersectionX = targetX - dirX * tIntersect;
  const intersectionY = targetY - dirY * tIntersect;
  const arrowX = intersectionX - dirX * arrowLength;
  const arrowY = intersectionY - dirY * arrowLength;
  const arrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);

  // Calculate text rotation angle
  let textAngle = arrowAngle;
  // Keep text right-side up
  if (textAngle > 90 || textAngle < -90) {
    textAngle += 180;
  }

  // Font size matching NodeCanvas
  const fontSize = 24;
  const textStrokeWidth = Math.max(2, fontSize * 0.25); // ~6px

  return (
    <g className="orbit-connection" opacity={isHovered ? 1 : 0.85} style={{ transition: 'opacity 0.2s ease' }}>
      {/* Connection line - solid like NodeCanvas edges */}
      <line
        x1={sourceX}
        y1={sourceY}
        x2={arrowX}
        y2={arrowY}
        stroke={color}
        strokeWidth={16}
        strokeLinecap="round"
        style={{
          pointerEvents: 'none'
        }}
      />

      {/* Directional arrow at target (matching NodeCanvas positioning) */}
      <g
        transform={`translate(${arrowX}, ${arrowY}) rotate(${arrowAngle + 90})`}
        style={{ pointerEvents: 'none' }}
      >
        <polygon
          points="-18,22 18,22 0,-22"
          fill={color}
          stroke={color}
          strokeWidth="6"
          strokeLinejoin="round"
          strokeLinecap="round"
          paintOrder="stroke fill"
        />
      </g>

      {/* Label text with stroke outline */}
      <text
        x={midX}
        y={midY}
        fontSize={fontSize}
        fontFamily="'EmOne', sans-serif"
        fontWeight="bold"
        fill={textColor}
        stroke={getInvertedTextColor(color, theme.darkMode)}
        strokeWidth={textStrokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        paintOrder="stroke fill"
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(${textAngle}, ${midX}, ${midY})`}
        style={{
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      >
        {formattedPredicate}
      </text>
    </g>
  );
};

const DraggableOrbitItem = ({ candidate, x, y, rightPanelExpanded, onNodeClick, isHovered, onHover, onHoverEnd }) => {
  const theme = useTheme();
  const rotation = useGraphStore(state => state.orbitRotation);
  const concept = useMemo(() => candidateToConcept(candidate), [candidate]);

  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: SPAWNABLE_NODE,
    item: {
      prototypeId: null,
      nodeId: null,
      nodeName: candidate.name,
      nodeColor: candidate.color || NODE_DEFAULT_COLOR,
      fromOrbitOverlay: true,
      conceptData: concept,
      needsMaterialization: true
    },
    collect: (monitor) => ({ isDragging: !!monitor.isDragging() }),
  }), [candidate, concept]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  const label = candidate.name || 'Untitled';
  const fill = candidate.color || NODE_DEFAULT_COLOR;
  const hasImage = Boolean(candidate.imageSrc);

  // Re-calculate width and height based on candidate for rendering
  const tempNode = {
    id: `orbit-${candidate.id}`,
    x: 0, y: 0, scale: 1, prototypeId: null,
    name: candidate.name,
    color: candidate.color || NODE_DEFAULT_COLOR,
    definitionGraphIds: []
  };
  const { currentWidth, currentHeight } = getNodeDimensions(tempNode, false, null);

  // Text sizing constants (match UniversalNodeRenderer full canvas context)
  const baseFontSize = 24;
  const baseLineHeight = 24;
  const baseVerticalPadding = 10;
  const baseSingleLineSidePadding = 22;

  // Text contrast
  const textColor = getTextColor(fill, theme.darkMode);

  return (
    <g
      ref={drag}
      style={{ opacity: isDragging ? 0.3 : (isHovered ? 1.0 : 0.85), transition: 'opacity 0.2s ease' }}
      onMouseEnter={() => onHover?.(candidate.id)}
      onMouseLeave={() => onHoverEnd?.()}
    >
      {/* Clip path for image nodes */}
      {hasImage && (
        <defs>
          <clipPath id={`orbit-image-clip-${candidate.id}`}>
            <rect
              x={x}
              y={y}
              width={currentWidth}
              height={currentHeight}
              rx={NODE_CORNER_RADIUS}
              ry={NODE_CORNER_RADIUS}
            />
          </clipPath>
        </defs>
      )}

      {/* Image (if present) */}
      {hasImage && (
        <image
          x={x}
          y={y}
          width={currentWidth}
          height={currentHeight}
          href={candidate.imageSrc}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#orbit-image-clip-${candidate.id})`}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Node background - stroke for image nodes, fill for text nodes */}
      <rect
        x={x}
        y={y}
        width={currentWidth}
        height={currentHeight}
        rx={NODE_CORNER_RADIUS}
        ry={NODE_CORNER_RADIUS}
        fill={hasImage ? 'none' : fill}
        stroke={hasImage ? fill : 'none'}
        strokeWidth={hasImage ? 1.5 : 0}
        style={{ pointerEvents: 'none' }}
      />

      {/* Text using foreignObject - only show if no image */}
      {!hasImage && (
        <foreignObject
          x={x}
          y={y}
          width={currentWidth}
          height={currentHeight}
          style={{ pointerEvents: 'auto', overflow: 'hidden' }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '100%',
              padding: `${baseVerticalPadding}px ${baseSingleLineSidePadding}px`,
              boxSizing: 'border-box',
              userSelect: 'none',
              minWidth: 0,
              cursor: 'grab',
            }}
          >
            <span
              style={{
                fontSize: `${baseFontSize}px`,
                fontWeight: 'bold',
                color: textColor,
                lineHeight: `${baseLineHeight}px`,
                letterSpacing: '-0.3px',
                whiteSpace: 'normal',
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
                textAlign: 'center',
                minWidth: 0,
                display: 'inline-block',
                width: '100%',
                fontFamily: 'EmOne, sans-serif',
                textRendering: 'optimizeLegibility',
              }}
            >
              {label}
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  );
};

const computeRingRadius = (items, centerRadius, spacing, count) => {
  // If no items, just return the center radius + spacing
  if (items.length === 0 || count === 0) {
    return centerRadius + spacing;
  }

  const maxWidth = items.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0);

  // For a single item, no chord geometry needed - just use simple spacing
  // (chord formula breaks down: sin(π) ≈ 0 causes division by ~0)
  if (count === 1) {
    return centerRadius + spacing + maxWidth / 2;
  }

  const chordNeeded = maxWidth + spacing;
  const dTheta = (Math.PI * 2) / count;
  const minR = chordNeeded / (2 * Math.sin(dTheta / 2));
  return Math.max(centerRadius + spacing + maxWidth / 2, minR);
};

const measureCandidates = (candidates) => {
  return candidates.map((c) => {
    const tempNode = {
      id: `orbit-${c.id}`,
      x: 0,
      y: 0,
      scale: 1,
      prototypeId: null,
      name: c.name,
      color: c.color || NODE_DEFAULT_COLOR,
      definitionGraphIds: []
    };
    const dims = getNodeDimensions(tempNode, false, null);
    return { candidate: c, dims };
  });
};

export default function OrbitOverlay({
  centerX,
  centerY,
  focusWidth,
  focusHeight,
  ring1Candidates,
  ring2Candidates,
  ring3Candidates,
  ring4Candidates
}) {
  // Hover tracking for individual orbit items
  const [hoveredCandidateId, setHoveredCandidateId] = useState(null);

  // Always call hooks first, before any early returns
  const measuredRing1 = useMemo(() => measureCandidates(ring1Candidates || []), [ring1Candidates]);
  const measuredRing2 = useMemo(() => measureCandidates(ring2Candidates || []), [ring2Candidates]);
  const measuredRing3 = useMemo(() => measureCandidates(ring3Candidates || []), [ring3Candidates]);
  const measuredRing4 = useMemo(() => measureCandidates(ring4Candidates || []), [ring4Candidates]);

  const centerRadius = useMemo(() => {
    return Math.max(focusWidth, focusHeight) / 2;
  }, [focusWidth, focusHeight]);

  // Chain radius calculations: each ring builds on the previous one
  const ring1Radius = useMemo(() => {
    return computeRingRadius(measuredRing1, centerRadius, DRAG_MARGIN, Math.max(1, measuredRing1.length));
  }, [measuredRing1, centerRadius]);

  const ring2Radius = useMemo(() => {
    return computeRingRadius(measuredRing2, ring1Radius + DRAG_MARGIN, DRAG_MARGIN, Math.max(1, measuredRing2.length));
  }, [measuredRing2, ring1Radius]);

  const ring3Radius = useMemo(() => {
    return computeRingRadius(measuredRing3, ring2Radius + DRAG_MARGIN, DRAG_MARGIN, Math.max(1, measuredRing3.length));
  }, [measuredRing3, ring2Radius]);

  const ring4Radius = useMemo(() => {
    return computeRingRadius(measuredRing4, ring3Radius + DRAG_MARGIN, DRAG_MARGIN, Math.max(1, measuredRing4.length));
  }, [measuredRing4, ring3Radius]);

  // Animation time state (seconds). Throttled to ~20 FPS for efficiency.
  const [animTimeSec, setAnimTimeSec] = useState(0);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const accumRef = useRef(0);

  useEffect(() => {
    const loop = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dtSec = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      accumRef.current += dtSec;
      // Update every ~50ms
      if (accumRef.current >= 0.05) {
        setAnimTimeSec((t) => t + accumRef.current);
        accumRef.current = 0;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = 0;
      accumRef.current = 0;
    };
  }, []);

  // Ring 1 positions: No brick-layer offset (deterministic)
  const ring1Positions = useMemo(() => {
    const n = Math.max(1, measuredRing1.length);
    const positions = [];
    for (let i = 0; i < measuredRing1.length; i++) {
      const { candidate, dims } = measuredRing1[i];
      const baseAngle = (2 * Math.PI * i) / n; // even spacing
      // Deterministic per-item variation
      const seed1 = hashToUnitFloat(candidate.id, 'ring1:radial');
      const seed2 = hashToUnitFloat(candidate.id, 'ring1:angle');
      const seed3 = hashToUnitFloat(candidate.id, 'ring1:freqR');
      const seed4 = hashToUnitFloat(candidate.id, 'ring1:freqA');
      const radialAmp = RADIAL_PERTURBATION_PX_BASE * (0.6 + 0.8 * seed1);
      const angleJitterAmp = ANGLE_JITTER_RAD_BASE * (0.6 + 0.8 * seed2);
      const radialFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed3;
      const angleFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed4;
      const angle = baseAngle + ORBIT_ANGULAR_SPEED_RAD_PER_SEC * animTimeSec + angleJitterAmp * Math.sin(2 * Math.PI * angleFreq * animTimeSec + seed2 * 10);
      const radius = ring1Radius + radialAmp * Math.sin(2 * Math.PI * radialFreq * animTimeSec + seed1 * 10);
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);
      positions.push({ candidate, dims, x: cx - dims.currentWidth / 2, y: cy - dims.currentHeight / 2 });
    }
    return positions;
  }, [measuredRing1, ring1Radius, centerX, centerY, animTimeSec]);

  // Ring 2 positions: Brick-layer offset (half-step forward)
  const ring2Positions = useMemo(() => {
    const n = Math.max(1, measuredRing2.length);
    const positions = [];
    const brickOffset = Math.PI / Math.max(2, n); // half-step forward
    for (let i = 0; i < measuredRing2.length; i++) {
      const { candidate, dims } = measuredRing2[i];
      const baseAngle = (2 * Math.PI * i) / n + brickOffset;
      const seed1 = hashToUnitFloat(candidate.id, 'ring2:radial');
      const seed2 = hashToUnitFloat(candidate.id, 'ring2:angle');
      const seed3 = hashToUnitFloat(candidate.id, 'ring2:freqR');
      const seed4 = hashToUnitFloat(candidate.id, 'ring2:freqA');
      const radialAmp = RADIAL_PERTURBATION_PX_BASE * (0.6 + 0.8 * seed1);
      const angleJitterAmp = ANGLE_JITTER_RAD_BASE * (0.6 + 0.8 * seed2);
      const radialFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed3;
      const angleFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed4;
      const angle = baseAngle + ORBIT_ANGULAR_SPEED_RAD_PER_SEC * animTimeSec + angleJitterAmp * Math.sin(2 * Math.PI * angleFreq * animTimeSec + seed2 * 10);
      const radius = ring2Radius + radialAmp * Math.sin(2 * Math.PI * radialFreq * animTimeSec + seed1 * 10);
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);
      positions.push({ candidate, dims, x: cx - dims.currentWidth / 2, y: cy - dims.currentHeight / 2 });
    }
    return positions;
  }, [measuredRing2, ring2Radius, centerX, centerY, animTimeSec]);

  // Ring 3 positions: No brick offset (aligned with ring1 for stagger pattern)
  const ring3Positions = useMemo(() => {
    const n = Math.max(1, measuredRing3.length);
    const positions = [];
    for (let i = 0; i < measuredRing3.length; i++) {
      const { candidate, dims } = measuredRing3[i];
      const baseAngle = (2 * Math.PI * i) / n; // no offset, aligned with ring1
      const seed1 = hashToUnitFloat(candidate.id, 'ring3:radial');
      const seed2 = hashToUnitFloat(candidate.id, 'ring3:angle');
      const seed3 = hashToUnitFloat(candidate.id, 'ring3:freqR');
      const seed4 = hashToUnitFloat(candidate.id, 'ring3:freqA');
      const radialAmp = RADIAL_PERTURBATION_PX_BASE * (0.6 + 0.8 * seed1);
      const angleJitterAmp = ANGLE_JITTER_RAD_BASE * (0.6 + 0.8 * seed2);
      const radialFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed3;
      const angleFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed4;
      const angle = baseAngle + ORBIT_ANGULAR_SPEED_RAD_PER_SEC * animTimeSec + angleJitterAmp * Math.sin(2 * Math.PI * angleFreq * animTimeSec + seed2 * 10);
      const radius = ring3Radius + radialAmp * Math.sin(2 * Math.PI * radialFreq * animTimeSec + seed1 * 10);
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);
      positions.push({ candidate, dims, x: cx - dims.currentWidth / 2, y: cy - dims.currentHeight / 2 });
    }
    return positions;
  }, [measuredRing3, ring3Radius, centerX, centerY, animTimeSec]);

  // Ring 4 positions: Brick-layer offset
  const ring4Positions = useMemo(() => {
    const n = Math.max(1, measuredRing4.length);
    const positions = [];
    const brickOffset = Math.PI / Math.max(2, n); // half-step bricklaying
    for (let i = 0; i < measuredRing4.length; i++) {
      const { candidate, dims } = measuredRing4[i];
      const baseAngle = (2 * Math.PI * i) / n + brickOffset;
      const seed1 = hashToUnitFloat(candidate.id, 'ring4:radial');
      const seed2 = hashToUnitFloat(candidate.id, 'ring4:angle');
      const seed3 = hashToUnitFloat(candidate.id, 'ring4:freqR');
      const seed4 = hashToUnitFloat(candidate.id, 'ring4:freqA');
      const radialAmp = RADIAL_PERTURBATION_PX_BASE * (0.6 + 0.8 * seed1);
      const angleJitterAmp = ANGLE_JITTER_RAD_BASE * (0.6 + 0.8 * seed2);
      const radialFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed3;
      const angleFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed4;
      const angle = baseAngle + ORBIT_ANGULAR_SPEED_RAD_PER_SEC * animTimeSec + angleJitterAmp * Math.sin(2 * Math.PI * angleFreq * animTimeSec + seed2 * 10);
      const radius = ring4Radius + radialAmp * Math.sin(2 * Math.PI * radialFreq * animTimeSec + seed1 * 10);
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);
      positions.push({ candidate, dims, x: cx - dims.currentWidth / 2, y: cy - dims.currentHeight / 2 });
    }
    return positions;
  }, [measuredRing4, ring4Radius, centerX, centerY, animTimeSec]);

  // Early return check after all hooks are called
  if ((!ring1Candidates || ring1Candidates.length === 0) &&
    (!ring2Candidates || ring2Candidates.length === 0) &&
    (!ring3Candidates || ring3Candidates.length === 0) &&
    (!ring4Candidates || ring4Candidates.length === 0)) {
    return null;
  }

  return (
    <g className="orbit-overlay">
      {/* Render connections FIRST (behind orbit items) */}
      <g className="orbit-connections">
        {/* Ring 1 connections */}
        {ring1Positions.map(({ candidate, x, y, dims }) => {
          const targetCenterX = x + dims.currentWidth / 2;
          const targetCenterY = y + dims.currentHeight / 2;

          return (
            <OrbitConnection
              key={`conn-${candidate.id}`}
              sourceX={centerX}
              sourceY={centerY}
              targetX={targetCenterX}
              targetY={targetCenterY}
              predicate={candidate.predicate}
              color={candidate.color}
              isHovered={hoveredCandidateId === candidate.id}
            />
          );
        })}

        {/* Ring 2 connections */}
        {ring2Positions.map(({ candidate, x, y, dims }) => {
          const targetCenterX = x + dims.currentWidth / 2;
          const targetCenterY = y + dims.currentHeight / 2;

          return (
            <OrbitConnection
              key={`conn-${candidate.id}`}
              sourceX={centerX}
              sourceY={centerY}
              targetX={targetCenterX}
              targetY={targetCenterY}
              predicate={candidate.predicate}
              color={candidate.color}
              isHovered={hoveredCandidateId === candidate.id}
            />
          );
        })}

        {/* Ring 3 connections */}
        {ring3Positions.map(({ candidate, x, y, dims }) => {
          const targetCenterX = x + dims.currentWidth / 2;
          const targetCenterY = y + dims.currentHeight / 2;

          return (
            <OrbitConnection
              key={`conn-${candidate.id}`}
              sourceX={centerX}
              sourceY={centerY}
              targetX={targetCenterX}
              targetY={targetCenterY}
              predicate={candidate.predicate}
              color={candidate.color}
              isHovered={hoveredCandidateId === candidate.id}
            />
          );
        })}

        {/* Ring 4 connections */}
        {ring4Positions.map(({ candidate, x, y, dims }) => {
          const targetCenterX = x + dims.currentWidth / 2;
          const targetCenterY = y + dims.currentHeight / 2;

          return (
            <OrbitConnection
              key={`conn-${candidate.id}`}
              sourceX={centerX}
              sourceY={centerY}
              targetX={targetCenterX}
              targetY={targetCenterY}
              predicate={candidate.predicate}
              color={candidate.color}
              isHovered={hoveredCandidateId === candidate.id}
            />
          );
        })}
      </g>

      {/* Render orbit items SECOND (on top of connections) */}
      <g className="orbit-items">
        {ring1Positions.map(({ candidate, dims, x, y }) => (
          <DraggableOrbitItem
            key={`ring1-${candidate.id}`}
            candidate={candidate}
            x={x}
            y={y}
            width={dims.currentWidth}
            height={dims.currentHeight}
            isHovered={hoveredCandidateId === candidate.id}
            onHover={setHoveredCandidateId}
            onHoverEnd={() => setHoveredCandidateId(null)}
          />
        ))}
        {ring2Positions.map(({ candidate, dims, x, y }) => (
          <DraggableOrbitItem
            key={`ring2-${candidate.id}`}
            candidate={candidate}
            x={x}
            y={y}
            width={dims.currentWidth}
            height={dims.currentHeight}
            isHovered={hoveredCandidateId === candidate.id}
            onHover={setHoveredCandidateId}
            onHoverEnd={() => setHoveredCandidateId(null)}
          />
        ))}
        {ring3Positions.map(({ candidate, dims, x, y }) => (
          <DraggableOrbitItem
            key={`ring3-${candidate.id}`}
            candidate={candidate}
            x={x}
            y={y}
            width={dims.currentWidth}
            height={dims.currentHeight}
            isHovered={hoveredCandidateId === candidate.id}
            onHover={setHoveredCandidateId}
            onHoverEnd={() => setHoveredCandidateId(null)}
          />
        ))}
        {ring4Positions.map(({ candidate, dims, x, y }) => (
          <DraggableOrbitItem
            key={`ring4-${candidate.id}`}
            candidate={candidate}
            x={x}
            y={y}
            width={dims.currentWidth}
            height={dims.currentHeight}
            isHovered={hoveredCandidateId === candidate.id}
            onHover={setHoveredCandidateId}
            onHoverEnd={() => setHoveredCandidateId(null)}
          />
        ))}
      </g>
    </g>
  );
}


