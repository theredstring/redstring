import { memo, useLayoutEffect, useRef } from 'react';
import { getClusterGeometries } from '../../../services/graphLayoutService.js';

/**
 * The canvas grid (P3.09): one <rect> filled with an SVG <pattern>, so the tiling
 * happens in the paint layer rather than as thousands of lines. Drawn under
 * groups, nodes and edges. Node-group interiors fill with the same pattern by
 * id (`patternId`), so the ids here must not change.
 *
 * Memoized on primitives and canvasSize, so a NodeCanvas render doesn't touch it.
 */
const LINE_WIDTH_PX = 0.75;
// Below this on-screen cell size the lines fade in proportion to it, so zooming
// out keeps the grid's overall weight steady instead of packing ever more
// constant-width lines into the view (at the 0.05 zoom floor a 200 cell is
// 10px, and full-strength lines covered about 15% of the canvas).
const FULL_STRENGTH_CELL_PX = 100;

export const GridLayer = memo(function GridLayer({ gridSize, appearance, lineColor, dotColor, canvasSize, patternId }) {
  const groupRef = useRef(null);
  const linePathRef = useRef(null);
  const dotR = Math.min(6, Math.max(3, gridSize * 0.06));
  // The appearance setting picks the look in both modes —
  // 'lattice' → lines, 'dot' → dots. Hover mode used to force
  // dots regardless, which meant the grid that appeared under
  // a drag didn't match the one the setting describes.
  const useDots = appearance === 'dot';

  // Lattice lines stay LINE_WIDTH_PX on screen at every zoom. This can't be
  // vector-effect="non-scaling-stroke": Chromium rasterises a pattern tile once
  // and doesn't redo it when an ancestor transform changes, so the width was
  // fixed at whatever zoom the grid first drew at and then scaled with the
  // camera (at zoom 0.1 a line came out 0.075px wide, i.e. the grid vanished
  // on zoom out). The camera writes the content group's transform directly,
  // never through React, so this follows that attribute and sets the width in
  // world units; changing the path also makes Chromium redraw the tile. The
  // same pass sets the fade (FULL_STRENGTH_CELL_PX).
  useLayoutEffect(() => {
    const path = linePathRef.current;
    const camera = groupRef.current?.parentNode;
    if (!path || !camera?.transform) return undefined;
    let lastZoom = null;
    const sync = () => {
      const zoom = camera.transform.baseVal.consolidate()?.matrix.a || 1;
      if (zoom === lastZoom) return; // a pan doesn't change the width
      lastZoom = zoom;
      path.setAttribute('stroke-width', String(LINE_WIDTH_PX / zoom));
      path.setAttribute('stroke-opacity', String(Math.min(1, (gridSize * zoom) / FULL_STRENGTH_CELL_PX)));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(camera, { attributes: true, attributeFilter: ['transform'] });
    return () => observer.disconnect();
  }, [useDots, gridSize]);

  return (
    <g ref={groupRef} className="grid-overlay" pointerEvents="none">
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
              ref={linePathRef}
              d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
              fill="none"
              stroke={lineColor}
              // stroke-width and stroke-opacity are written by the effect above, per zoom.
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
