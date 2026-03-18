import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';

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

const SOURCE_TO_RING_MARGIN = 200; // Gap from source node edge to first orbit ring
const INTER_RING_MARGIN = 100;      // Gap between successive orbit rings
const ORBIT_ANGULAR_SPEED_RAD_PER_SEC = 0.02; // Steady clockwise rotation
const RADIAL_PERTURBATION_PX_BASE = 1; // very subtle radial wiggle
const ANGLE_JITTER_RAD_BASE = 0.004; // subtle angle wobble
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

const ENTRANCE_DURATION_MS = 350;

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

  // Entrance animation
  const mountTimeRef = useRef(Date.now());
  const [entranceProgress, setEntranceProgress] = useState(0);
  useEffect(() => {
    mountTimeRef.current = Date.now();
    let raf;
    const tick = () => {
      const elapsed = Date.now() - mountTimeRef.current;
      const t = Math.min(1, elapsed / ENTRANCE_DURATION_MS);
      setEntranceProgress(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, []);
  const connEase = 1 - Math.pow(1 - entranceProgress, 3);

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
    <g className="orbit-connection" opacity={(isHovered ? 1 : 0.85) * connEase} style={{ transition: connEase >= 1 ? 'opacity 0.2s ease' : undefined }}>
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

const DraggableOrbitItem = ({ candidate, x, y, rightPanelExpanded, onNodeClick, isHovered, onHover, onHoverEnd, onClick }) => {
  const theme = useTheme();
  const rotation = useGraphStore(state => state.orbitRotation);
  const concept = useMemo(() => candidateToConcept(candidate), [candidate]);

  // Entrance animation: scale from 0 + fade in
  const mountTimeRef = useRef(Date.now());
  const [entranceProgress, setEntranceProgress] = useState(0);
  useEffect(() => {
    mountTimeRef.current = Date.now();
    let raf;
    const tick = () => {
      const elapsed = Date.now() - mountTimeRef.current;
      const t = Math.min(1, elapsed / ENTRANCE_DURATION_MS);
      setEntranceProgress(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, []);
  // Ease-out cubic
  const ease = 1 - Math.pow(1 - entranceProgress, 3);

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

  // Center of the item for scale-from-center transform
  const cx = x + currentWidth / 2;
  const cy = y + currentHeight / 2;
  const baseOpacity = isDragging ? 0.3 : (isHovered ? 1.0 : 0.85);

  return (
    <g
      ref={drag}
      transform={ease < 1 ? `translate(${cx}, ${cy}) scale(${ease}) translate(${-cx}, ${-cy})` : undefined}
      style={{ opacity: baseOpacity * ease, transition: ease >= 1 ? 'opacity 0.2s ease' : undefined, cursor: 'pointer' }}
      onClick={(e) => { e.stopPropagation(); onClick?.(candidate, x, y, { currentWidth, currentHeight }); }}
      onMouseEnter={() => onHover?.(candidate.id, x, y)}
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
              cursor: 'pointer',
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

const computeRingRadius = (items, innerEdgeRadius, spacing, count) => {
  // innerEdgeRadius = the outer edge of the previous ring (or source node)
  if (items.length === 0 || count === 0) {
    return innerEdgeRadius + spacing;
  }

  const maxWidth = items.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0);

  // For a single item, no chord geometry needed
  if (count === 1) {
    return innerEdgeRadius + spacing + maxWidth / 2;
  }

  const chordNeeded = maxWidth + spacing;
  const dTheta = (Math.PI * 2) / count;
  const minR = chordNeeded / (2 * Math.sin(dTheta / 2));
  return Math.max(innerEdgeRadius + spacing + maxWidth / 2, minR);
};

// Nudge an angle away from blocked angular ranges (inner ring items' connection paths)
const COLLISION_PAD_RAD = 0.04; // extra angular padding after nudge (~2.3°)

function nudgeAngleAwayFromBlocked(angle, blockedRanges) {
  for (const { angle: blocked, halfWidth } of blockedRanges) {
    let diff = angle - blocked;
    // Normalize to [-π, π]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    if (Math.abs(diff) < halfWidth) {
      // Nudge in whichever direction is closer to escaping the blocked range
      const nudgeDir = diff >= 0 ? 1 : -1;
      angle = blocked + nudgeDir * (halfWidth + COLLISION_PAD_RAD);
    }
  }
  return angle;
}

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

// Loading animation: dots orbiting the node's rounded rectangle
const LOADING_DOT_COUNT = 8;
const LOADING_DOT_RADIUS = 6;
const LOADING_PAD = 40; // padding beyond node bounds
const LOADING_ORBIT_PERIOD_SEC = 3; // one full loop in seconds

function pointOnRoundedRect(t, cx, cy, w, h, cr) {
  // Parameterize the rounded rect perimeter clockwise from top-center
  // t ∈ [0, 1) maps to position on the perimeter
  const topStraight = w - 2 * cr;
  const rightStraight = h - 2 * cr;
  const bottomStraight = w - 2 * cr;
  const leftStraight = h - 2 * cr;
  const arcLen = (Math.PI / 2) * cr; // quarter circle
  const perimeter = topStraight + rightStraight + bottomStraight + leftStraight + 4 * arcLen;
  let d = ((t % 1) + 1) % 1 * perimeter; // distance along perimeter

  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;

  // Segment 1: top edge (left-to-right, after top-left corner)
  if (d < topStraight) {
    return { x: left + cr + d, y: top };
  }
  d -= topStraight;

  // Segment 2: top-right arc
  if (d < arcLen) {
    const a = -Math.PI / 2 + (d / arcLen) * (Math.PI / 2);
    return { x: right - cr + cr * Math.cos(a), y: top + cr + cr * Math.sin(a) };
  }
  d -= arcLen;

  // Segment 3: right edge (top-to-bottom)
  if (d < rightStraight) {
    return { x: right, y: top + cr + d };
  }
  d -= rightStraight;

  // Segment 4: bottom-right arc
  if (d < arcLen) {
    const a = 0 + (d / arcLen) * (Math.PI / 2);
    return { x: right - cr + cr * Math.cos(a), y: bottom - cr + cr * Math.sin(a) };
  }
  d -= arcLen;

  // Segment 5: bottom edge (right-to-left)
  if (d < bottomStraight) {
    return { x: right - cr - d, y: bottom };
  }
  d -= bottomStraight;

  // Segment 6: bottom-left arc
  if (d < arcLen) {
    const a = Math.PI / 2 + (d / arcLen) * (Math.PI / 2);
    return { x: left + cr + cr * Math.cos(a), y: bottom - cr + cr * Math.sin(a) };
  }
  d -= arcLen;

  // Segment 7: left edge (bottom-to-top)
  if (d < leftStraight) {
    return { x: left, y: bottom - cr - d };
  }
  d -= leftStraight;

  // Segment 8: top-left arc
  {
    const a = Math.PI + (d / arcLen) * (Math.PI / 2);
    return { x: left + cr + cr * Math.cos(a), y: top + cr + cr * Math.sin(a) };
  }
}

const OrbitLoadingDots = ({ centerX, centerY, focusWidth, focusHeight }) => {
  const [timeSec, setTimeSec] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    const loop = (ts) => {
      if (!startRef.current) startRef.current = ts;
      setTimeSec((ts - startRef.current) / 1000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const w = focusWidth + 2 * LOADING_PAD;
  const h = focusHeight + 2 * LOADING_PAD;
  const cr = NODE_CORNER_RADIUS;

  const dots = [];
  for (let i = 0; i < LOADING_DOT_COUNT; i++) {
    const t = (i / LOADING_DOT_COUNT + timeSec / LOADING_ORBIT_PERIOD_SEC) % 1;
    const pos = pointOnRoundedRect(t, centerX, centerY, w, h, cr);
    // Comet-tail: leading dot brightest, trailing fades
    const opacity = 0.3 + 0.5 * ((LOADING_DOT_COUNT - i) / LOADING_DOT_COUNT);
    dots.push(
      <circle
        key={i}
        cx={pos.x}
        cy={pos.y}
        r={LOADING_DOT_RADIUS}
        fill="white"
        opacity={opacity}
      />
    );
  }

  return <g className="orbit-loading-dots">{dots}</g>;
};

export default function OrbitOverlay({
  centerX,
  centerY,
  focusWidth,
  focusHeight,
  ring1Candidates,
  ring2Candidates,
  ring3Candidates,
  ring4Candidates,
  onOrbitItemClick,
  isLoading = false
}) {
  // Hover tracking for individual orbit items
  const [hoveredCandidateId, setHoveredCandidateId] = useState(null);
  // Freeze position when hovered — stores { x, y } at hover start
  const frozenPosRef = useRef(null);

  // Always call hooks first, before any early returns
  const measuredRing1 = useMemo(() => measureCandidates(ring1Candidates || []), [ring1Candidates]);
  const measuredRing2 = useMemo(() => measureCandidates(ring2Candidates || []), [ring2Candidates]);
  const measuredRing3 = useMemo(() => measureCandidates(ring3Candidates || []), [ring3Candidates]);
  const measuredRing4 = useMemo(() => measureCandidates(ring4Candidates || []), [ring4Candidates]);

  const centerRadius = useMemo(() => {
    return Math.max(focusWidth, focusHeight) / 2;
  }, [focusWidth, focusHeight]);

  // Chain radius calculations: ring1 uses SOURCE_TO_RING_MARGIN, subsequent rings use INTER_RING_MARGIN
  const ring1Radius = useMemo(() => {
    return computeRingRadius(measuredRing1, centerRadius, SOURCE_TO_RING_MARGIN, Math.max(1, measuredRing1.length));
  }, [measuredRing1, centerRadius]);

  const ring2Radius = useMemo(() => {
    const ring1Outer = ring1Radius + (measuredRing1.length > 0
      ? measuredRing1.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0) / 2
      : 0);
    return computeRingRadius(measuredRing2, ring1Outer, INTER_RING_MARGIN, Math.max(1, measuredRing2.length));
  }, [measuredRing2, ring1Radius, measuredRing1]);

  const ring3Radius = useMemo(() => {
    const ring2Outer = ring2Radius + (measuredRing2.length > 0
      ? measuredRing2.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0) / 2
      : 0);
    return computeRingRadius(measuredRing3, ring2Outer, INTER_RING_MARGIN, Math.max(1, measuredRing3.length));
  }, [measuredRing3, ring2Radius, measuredRing2]);

  const ring4Radius = useMemo(() => {
    const ring3Outer = ring3Radius + (measuredRing3.length > 0
      ? measuredRing3.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0) / 2
      : 0);
    return computeRingRadius(measuredRing4, ring3Outer, INTER_RING_MARGIN, Math.max(1, measuredRing4.length));
  }, [measuredRing4, ring3Radius, measuredRing3]);

  // Compute collision-free base angles for all rings (runs only when ring compositions change, NOT every frame)
  const collisionFreeAngles = useMemo(() => {
    // Ring 1: evenly spaced, no collision avoidance needed (reference ring)
    const r1n = Math.max(1, measuredRing1.length);
    const ring1Angles = measuredRing1.map((_, i) => (2 * Math.PI * i) / r1n);

    // Build blocked ranges from ring1: angular width each item blocks at ring1's radius
    const ring1Blocked = ring1Angles.map((a, i) => ({
      angle: a,
      halfWidth: (measuredRing1[i]?.dims.currentWidth / 2 + 30) / ring1Radius,
    }));

    // Ring 2: half-step brick offset + nudge away from ring1 items
    const r2n = Math.max(1, measuredRing2.length);
    const r2Offset = Math.PI / Math.max(2, r2n);
    const ring2Angles = measuredRing2.map((_, i) => {
      const raw = (2 * Math.PI * i) / r2n + r2Offset;
      return nudgeAngleAwayFromBlocked(raw, ring1Blocked);
    });

    const ring2Blocked = ring2Angles.map((a, i) => ({
      angle: a,
      halfWidth: (measuredRing2[i]?.dims.currentWidth / 2 + 30) / ring2Radius,
    }));
    const blocked12 = [...ring1Blocked, ...ring2Blocked];

    // Ring 3: quarter-step offset + nudge away from ring1 & ring2 items
    const r3n = Math.max(1, measuredRing3.length);
    const r3Offset = Math.PI / (2 * Math.max(2, r3n));
    const ring3Angles = measuredRing3.map((_, i) => {
      const raw = (2 * Math.PI * i) / r3n + r3Offset;
      return nudgeAngleAwayFromBlocked(raw, blocked12);
    });

    const ring3Blocked = ring3Angles.map((a, i) => ({
      angle: a,
      halfWidth: (measuredRing3[i]?.dims.currentWidth / 2 + 30) / ring3Radius,
    }));
    const blocked123 = [...blocked12, ...ring3Blocked];

    // Ring 4: 3/4-step offset + nudge away from all inner items
    const r4n = Math.max(1, measuredRing4.length);
    const r4Offset = (3 * Math.PI) / (2 * Math.max(2, r4n));
    const ring4Angles = measuredRing4.map((_, i) => {
      const raw = (2 * Math.PI * i) / r4n + r4Offset;
      return nudgeAngleAwayFromBlocked(raw, blocked123);
    });

    return { ring1: ring1Angles, ring2: ring2Angles, ring3: ring3Angles, ring4: ring4Angles };
  }, [measuredRing1, measuredRing2, measuredRing3, measuredRing4, ring1Radius, ring2Radius, ring3Radius, ring4Radius]);

  // Animation time state (seconds). Runs at native refresh rate for smooth motion.
  const [animTimeSec, setAnimTimeSec] = useState(0);
  const rafRef = useRef(null);
  const startTsRef = useRef(0);

  useEffect(() => {
    const loop = (ts) => {
      if (!startTsRef.current) startTsRef.current = ts;
      setAnimTimeSec((ts - startTsRef.current) / 1000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startTsRef.current = 0;
    };
  }, []);

  // Helper: compute animated positions from base angles + per-item perturbations
  const computeAnimatedPositions = (measured, baseAngles, ringRadius, ringSalt) => {
    const positions = [];
    for (let i = 0; i < measured.length; i++) {
      const { candidate, dims } = measured[i];
      const baseAngle = baseAngles[i] ?? 0;
      const seed1 = hashToUnitFloat(candidate.id, `${ringSalt}:radial`);
      const seed2 = hashToUnitFloat(candidate.id, `${ringSalt}:angle`);
      const seed3 = hashToUnitFloat(candidate.id, `${ringSalt}:freqR`);
      const seed4 = hashToUnitFloat(candidate.id, `${ringSalt}:freqA`);
      const radialAmp = RADIAL_PERTURBATION_PX_BASE * (0.6 + 0.8 * seed1);
      const angleJitterAmp = ANGLE_JITTER_RAD_BASE * (0.6 + 0.8 * seed2);
      const radialFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed3;
      const angleFreq = MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed4;
      const angle = baseAngle + ORBIT_ANGULAR_SPEED_RAD_PER_SEC * animTimeSec + angleJitterAmp * Math.sin(2 * Math.PI * angleFreq * animTimeSec + seed2 * 10);
      const radius = ringRadius + radialAmp * Math.sin(2 * Math.PI * radialFreq * animTimeSec + seed1 * 10);
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);
      positions.push({ candidate, dims, x: cx - dims.currentWidth / 2, y: cy - dims.currentHeight / 2 });
    }
    return positions;
  };

  // Apply frozen position for hovered item
  const applyFreeze = (positions) => {
    if (!hoveredCandidateId || !frozenPosRef.current) return positions;
    return positions.map(p =>
      p.candidate.id === hoveredCandidateId
        ? { ...p, x: frozenPosRef.current.x, y: frozenPosRef.current.y }
        : p
    );
  };

  const ring1Positions = applyFreeze(useMemo(() => computeAnimatedPositions(measuredRing1, collisionFreeAngles.ring1, ring1Radius, 'ring1'),
    [measuredRing1, collisionFreeAngles, ring1Radius, centerX, centerY, animTimeSec]));

  const ring2Positions = applyFreeze(useMemo(() => computeAnimatedPositions(measuredRing2, collisionFreeAngles.ring2, ring2Radius, 'ring2'),
    [measuredRing2, collisionFreeAngles, ring2Radius, centerX, centerY, animTimeSec]));

  const ring3Positions = applyFreeze(useMemo(() => computeAnimatedPositions(measuredRing3, collisionFreeAngles.ring3, ring3Radius, 'ring3'),
    [measuredRing3, collisionFreeAngles, ring3Radius, centerX, centerY, animTimeSec]));

  const ring4Positions = applyFreeze(useMemo(() => computeAnimatedPositions(measuredRing4, collisionFreeAngles.ring4, ring4Radius, 'ring4'),
    [measuredRing4, collisionFreeAngles, ring4Radius, centerX, centerY, animTimeSec]));

  // Hover callbacks that freeze/unfreeze position
  const handleOrbitHover = useCallback((candidateId, x, y) => {
    frozenPosRef.current = { x, y };
    setHoveredCandidateId(candidateId);
  }, []);

  const handleOrbitHoverEnd = useCallback(() => {
    frozenPosRef.current = null;
    setHoveredCandidateId(null);
  }, []);

  // Early return check after all hooks are called
  const allEmpty = (!ring1Candidates || ring1Candidates.length === 0) &&
    (!ring2Candidates || ring2Candidates.length === 0) &&
    (!ring3Candidates || ring3Candidates.length === 0) &&
    (!ring4Candidates || ring4Candidates.length === 0);

  if (allEmpty && !isLoading) return null;
  if (allEmpty && isLoading) {
    return <OrbitLoadingDots centerX={centerX} centerY={centerY} focusWidth={focusWidth} focusHeight={focusHeight} />;
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
            onHover={handleOrbitHover}
            onHoverEnd={handleOrbitHoverEnd}
            onClick={onOrbitItemClick}
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
            onHover={handleOrbitHover}
            onHoverEnd={handleOrbitHoverEnd}
            onClick={onOrbitItemClick}
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
            onHover={handleOrbitHover}
            onHoverEnd={handleOrbitHoverEnd}
            onClick={onOrbitItemClick}
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
            onHover={handleOrbitHover}
            onHoverEnd={handleOrbitHoverEnd}
            onClick={onOrbitItemClick}
          />
        ))}
      </g>
    </g>
  );
}


