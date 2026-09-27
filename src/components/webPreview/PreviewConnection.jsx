/**
 * One connection in a web preview, drawn from its resting geometry
 * (utils/canvas/settledConnection.js) with the canvas's own marks: the same
 * stroke, caps, Manhattan stubs, arrowhead polygon and shell cutout that
 * renderConnectionEdge / SelfLoopEdge paint.
 */
import { buildShellCutoutPath } from '../../services/groupLayout.js';
import { ARROW_POLYGON_POINTS } from '../../utils/canvas/settledConnection.js';

/**
 * @param {object} props
 * @param {object} props.geometry - settledConnectionGeometry(edge, scene).
 * @param {string} props.color
 * @param {number} props.strokeWidth - The line's width in world units.
 * @param {number} props.arrowScale - scale() for the arrowhead polygon.
 * @param {{x,y,w,h}} props.clipRegion - The preview's world bounds, for the shell cutout.
 * @param {string} props.clipId - Document-unique id for the cutout.
 */
export default function PreviewConnection({ geometry, color, strokeWidth, arrowScale, clipRegion, clipId }) {
  const { kind, stubs, arrows, clipShells } = geometry;
  const cap = geometry.roundCap ? 'round' : undefined;
  const clipped = clipShells.length > 0 && clipRegion;

  const stroke = kind === 'line'
    ? <line x1={geometry.x1} y1={geometry.y1} x2={geometry.x2} y2={geometry.y2} stroke={color} strokeWidth={strokeWidth} strokeLinecap={cap} />
    : <path d={geometry.d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap={cap} />;

  return (
    <g>
      {clipped && (
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <path d={buildShellCutoutPath(clipRegion, clipShells)} clipRule="evenodd" />
          </clipPath>
        </defs>
      )}
      <g clipPath={clipped ? `url(#${clipId})` : undefined}>
        {stubs.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        ))}
        {stroke}
      </g>
      {arrows.map((a) => (
        <g key={a.end} transform={`translate(${a.x}, ${a.y}) rotate(${a.angle + 90}) scale(${arrowScale})`}>
          <polygon
            points={ARROW_POLYGON_POINTS}
            fill={color}
            stroke={color}
            strokeWidth={6}
            strokeLinejoin="round"
            strokeLinecap="round"
            paintOrder="stroke fill"
          />
        </g>
      ))}
    </g>
  );
}
