import React, { useMemo, useEffect, useRef, useState } from 'react';

import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { getNodeDimensions } from '../utils.js';
import { NODE_CORNER_RADIUS, NODE_PADDING, NODE_DEFAULT_COLOR } from '../constants';
import { candidateToConcept } from '../services/candidates.js';
import { useTheme } from '../hooks/useTheme.js';
import useGraphStore from '../store/graphStore.jsx';
import { getTextColor } from '../utils/colorUtils';

const SPAWNABLE_NODE = 'spawnable_node';

const DRAG_MARGIN = 10; // Spacing from node edge to orbit ring
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

const DraggableOrbitItem = ({ candidate, x, y, rightPanelExpanded, onNodeClick }) => {
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

  // Re-calculate width and height based on candidate for rendering
  const tempNode = {
    id: `orbit-${candidate.id}`,
    x: 0, y: 0, scale: 1, prototypeId: null,
    name: candidate.name,
    color: candidate.color || NODE_DEFAULT_COLOR,
    definitionGraphIds: []
  };
  const { currentWidth, currentHeight } = getNodeDimensions(tempNode, false, null);

  return (
    <g style={{ opacity: isDragging ? 0.5 : 1 }}>
      <rect
        x={x + 6}
        y={y + 6}
        rx={NODE_CORNER_RADIUS - 6}
        ry={NODE_CORNER_RADIUS - 6}
        width={currentWidth - 12}
        height={currentHeight - 12}
        fill={fill}
        stroke={'none'}
      />
      <foreignObject
        x={x}
        y={y}
        width={currentWidth}
        height={currentHeight}
        style={{ overflow: 'visible' }}
        ref={drag}
      >
        <div
          style={{
            width: `${currentWidth}px`,
            height: `${currentHeight}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 22px',
            boxSizing: 'border-box',
            cursor: 'grab',
            userSelect: 'none',
            pointerEvents: 'auto',
            backgroundColor: fill,
            border: `1px solid rgba(0,0,0,0.1)`,
            fontFamily: "'EmOne', sans-serif",
            color: getTextColor(fill, theme.darkMode),
            fontWeight: 'bold',
            fontSize: '14px',
            lineHeight: '1.2',
            textAlign: 'center',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            borderRadius: `${NODE_CORNER_RADIUS}px`,
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
          }}
          title={`${label}`}
        >
          {label}
        </div>
      </foreignObject>
    </g>
  );
};

const computeRingRadius = (items, centerRadius, spacing, count) => {
  // If no items, just return the center radius + spacing
  if (items.length === 0 || count === 0) {
    return centerRadius + spacing;
  }

  const maxWidth = items.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0);
  const chordNeeded = maxWidth + spacing;
  const dTheta = (Math.PI * 2) / Math.max(1, count);
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

  // Debug: Log ring distribution and radii
  console.log('🔵 Orbit rings:', {
    ring1: { count: ring1Candidates?.length || 0, radius: ring1Radius },
    ring2: { count: ring2Candidates?.length || 0, radius: ring2Radius },
    ring3: { count: ring3Candidates?.length || 0, radius: ring3Radius },
    ring4: { count: ring4Candidates?.length || 0, radius: ring4Radius },
    centerRadius
  });

  return (
    <g>
      {ring1Positions.map(({ candidate, dims, x, y }) => (
        <DraggableOrbitItem
          key={`ring1-${candidate.id}`}
          candidate={candidate}
          x={x}
          y={y}
          width={dims.currentWidth}
          height={dims.currentHeight}
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
        />
      ))}
    </g>
  );
}


