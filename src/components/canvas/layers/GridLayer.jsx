import { memo } from 'react';
import { getClusterGeometries } from '../../../services/graphLayoutService.js';

/**
 * The canvas grid (P3.09): one <rect> filled with an SVG <pattern>, so the tiling
 * happens in the paint layer rather than as thousands of lines. Drawn under
 * groups, nodes and edges. Node-group interiors fill with the same pattern by
 * id (`patternId`), so the ids here must not change.
 *
 * Memoized on primitives and canvasSize, so a NodeCanvas render doesn't touch it.
 */
export const GridLayer = memo(function GridLayer({ gridSize, appearance, darkMode, dotColor, canvasSize, patternId }) {
  const dotR = Math.min(6, Math.max(3, gridSize * 0.06));
  const lineColor = darkMode ? "#716C6C" : "#979090";
  // The appearance setting picks the look in both modes —
  // 'lattice' → lines, 'dot' → dots. Hover mode used to force
  // dots regardless, which meant the grid that appeared under
  // a drag didn't match the one the setting describes.
  const useDots = appearance === 'dot';
  return (
    <g className="grid-overlay" pointerEvents="none">
      <defs>
        {useDots ? (
          <pattern
            id="grid-dots-pattern"
            // Tile origin shifted back half a cell so the centered
            // circle lands on the lattice points (multiples of
            // gridSize) that snapping uses, without being clipped
            // by the tile bounds.
            x={-gridSize / 2}
            y={-gridSize / 2}
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={gridSize / 2} cy={gridSize / 2} r={dotR} fill={dotColor} opacity={0.3} />
          </pattern>
        ) : (
          <pattern
            id="grid-lines-pattern"
            x={0}
            y={0}
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
              fill="none"
              stroke={lineColor}
              strokeWidth="0.75"
              vectorEffect="non-scaling-stroke"
            />
          </pattern>
        )}
      </defs>
      <rect
        x={canvasSize.offsetX}
        y={canvasSize.offsetY}
        width={canvasSize.width}
        height={canvasSize.height}
        fill={`url(#${patternId})`}
      />
    </g>
  );
});

const HULL_COLORS = ['#4ecdc4', '#ff6b6b', '#ffe66d', '#1a535c', '#f7fff7'];

/** Debug view of the layout's cluster hulls (autoLayoutSettings.showClusterHulls). */
export const ClusterHullsLayer = memo(function ClusterHullsLayer({ nodes, edges }) {
  const geometries = getClusterGeometries(nodes, edges);
  return (
    <g className="cluster-hulls-layer">
      {geometries.map((geo, idx) => {
        if (geo.hull.length < 3) return null;
        const pointsStr = geo.hull.map(p => `${p.x},${p.y}`).join(' ');
        const color = HULL_COLORS[idx % HULL_COLORS.length];
        return (
          <polygon
            key={idx}
            points={pointsStr}
            fill={color}
            fillOpacity="0.1"
            stroke={color}
            strokeWidth="4"
            strokeOpacity="0.3"
            strokeDasharray="8,8"
            style={{ pointerEvents: 'none' }}
          />
        );
      })}
    </g>
  );
});
