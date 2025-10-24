import React, { useMemo, useEffect, useRef, useState } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { getNodeDimensions } from '../utils.js';
import { NODE_CORNER_RADIUS, NODE_PADDING, NODE_DEFAULT_COLOR } from '../constants';
import { candidateToConcept } from '../services/candidates.js';

const SPAWNABLE_NODE = 'spawnable_node';

const DRAG_MARGIN = 18;
const ORBIT_ANGULAR_SPEED_RAD_PER_SEC = 0.08; // slow clockwise
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

const DraggableOrbitItem = ({ candidate, x, y, width, height }) => {
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

  return (
    <g style={{ opacity: isDragging ? 0.5 : 1 }}>
      <rect
        x={x + 6}
        y={y + 6}
        rx={NODE_CORNER_RADIUS - 6}
        ry={NODE_CORNER_RADIUS - 6}
        width={width - 12}
        height={height - 12}
        fill={fill}
        stroke={'none'}
      />
      <foreignObject
        x={x}
        y={y}
        width={width}
        height={height}
        style={{ overflow: 'visible' }}
        ref={drag}
      >
        <div
          style={{
            width: `${width}px`,
            height: `${height}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 22px',
            boxSizing: 'border-box',
            cursor: 'grab',
            userSelect: 'none',
            fontFamily: "'EmOne', sans-serif",
            color: '#bdb5b5',
            fontWeight: 'bold',
            fontSize: '20px',
            lineHeight: '32px',
            textAlign: 'center',
            wordBreak: 'break-word',
            overflowWrap: 'break-word'
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
  innerCandidates,
  outerCandidates
}) {
  // Always call hooks first, before any early returns
  const measuredInner = useMemo(() => measureCandidates(innerCandidates || []), [innerCandidates]);
  const measuredOuter = useMemo(() => measureCandidates(outerCandidates || []), [outerCandidates]);

  const centerRadius = useMemo(() => {
    return Math.max(focusWidth, focusHeight) / 2;
  }, [focusWidth, focusHeight]);

  const innerRadius = useMemo(() => computeRingRadius(measuredInner, centerRadius, DRAG_MARGIN, Math.max(1, measuredInner.length)), [measuredInner, centerRadius]);
  const outerRadius = useMemo(() => computeRingRadius(measuredOuter, innerRadius + DRAG_MARGIN, DRAG_MARGIN, Math.max(1, measuredOuter.length)), [measuredOuter, innerRadius]);

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

  const innerPositions = useMemo(() => {
    const n = Math.max(1, measuredInner.length);
    const positions = [];
    for (let i = 0; i < measuredInner.length; i++) {
      const { candidate, dims } = measuredInner[i];
      const baseAngle = (2 * Math.PI * i) / n; // even spacing
      // Deterministic per-item variation
      const seed1 = hashToUnitFloat(candidate.id, 'inner:radial');
      const seed2 = hashToUnitFloat(candidate.id, 'inner:angle');
      const seed3 = hashToUnitFloat(candidate.id, 'inner:freqR');
      const seed4 = hashToUnitFloat(candidate.id, 'inner:freqA');
      const radialAmp = RADIAL_PERTURBATION_PX_BASE * (0.6 + 0.8 * seed1);
      const angleJitterAmp = ANGLE_JITTER_RAD_BASE * (0.6 + 0.8 * seed2);
      const radialFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed3;
      const angleFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed4;
      const angle = baseAngle + ORBIT_ANGULAR_SPEED_RAD_PER_SEC * animTimeSec + angleJitterAmp * Math.sin(2 * Math.PI * angleFreq * animTimeSec + seed2 * 10);
      const radius = innerRadius + radialAmp * Math.sin(2 * Math.PI * radialFreq * animTimeSec + seed1 * 10);
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);
      positions.push({ candidate, dims, x: cx - dims.currentWidth / 2, y: cy - dims.currentHeight / 2 });
    }
    return positions;
  }, [measuredInner, innerRadius, centerX, centerY, animTimeSec]);

  const outerPositions = useMemo(() => {
    const n = Math.max(1, measuredOuter.length);
    const positions = [];
    const brickOffset = Math.PI / Math.max(2, n); // half-step bricklaying
    for (let i = 0; i < measuredOuter.length; i++) {
      const { candidate, dims } = measuredOuter[i];
      const baseAngle = (2 * Math.PI * i) / n + brickOffset;
      const seed1 = hashToUnitFloat(candidate.id, 'outer:radial');
      const seed2 = hashToUnitFloat(candidate.id, 'outer:angle');
      const seed3 = hashToUnitFloat(candidate.id, 'outer:freqR');
      const seed4 = hashToUnitFloat(candidate.id, 'outer:freqA');
      const radialAmp = RADIAL_PERTURBATION_PX_BASE * (0.6 + 0.8 * seed1);
      const angleJitterAmp = ANGLE_JITTER_RAD_BASE * (0.6 + 0.8 * seed2);
      const radialFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed3;
      const angleFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed4;
      const angle = baseAngle + ORBIT_ANGULAR_SPEED_RAD_PER_SEC * animTimeSec + angleJitterAmp * Math.sin(2 * Math.PI * angleFreq * animTimeSec + seed2 * 10);
      const radius = outerRadius + radialAmp * Math.sin(2 * Math.PI * radialFreq * animTimeSec + seed1 * 10);
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);
      positions.push({ candidate, dims, x: cx - dims.currentWidth / 2, y: cy - dims.currentHeight / 2 });
    }
    return positions;
  }, [measuredOuter, outerRadius, centerX, centerY, animTimeSec]);

  // Early return check after all hooks are called
  if ((!innerCandidates || innerCandidates.length === 0) && (!outerCandidates || outerCandidates.length === 0)) {
    return null;
  }

  return (
    <g>
      {innerPositions.map(({ candidate, dims, x, y }) => (
        <DraggableOrbitItem
          key={`inner-${candidate.id}`}
          candidate={candidate}
          x={x}
          y={y}
          width={dims.currentWidth}
          height={dims.currentHeight}
        />
      ))}
      {outerPositions.map(({ candidate, dims, x, y }) => (
        <DraggableOrbitItem
          key={`outer-${candidate.id}`}
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


