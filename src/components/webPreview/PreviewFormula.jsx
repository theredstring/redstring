import { NODE_DEFAULT_COLOR } from '../../constants.js';
import { getTextColor, blendColors } from '../../utils/colorUtils.js';
import { GROUP_LAYOUT_CONSTANTS } from '../../services/groupLayout.js';
import { NODE_GROUP_INTERIOR_TINT } from '../canvas/groups/groupElements.jsx';
import { subscriptOf, vectorOf } from '../canvas/formats/formula/formulaChain.js';
import {
  FORMULA_FONT, FORMULA_FONT_FAMILY, FORMULA_FONT_WEIGHT, SUBSCRIPT_SCALE, SUBSCRIPT_DROP, TITLE_FONT, arrowOver,
} from '../canvas/formats/formula/formulaObjects.js';

const G = GROUP_LAYOUT_CONSTANTS;

/** A token's text: a subscript lowered and smaller, a vector's arrow over its letter. */
function TokenText({ text, x, y, size, fill, opacity }) {
  const sub = subscriptOf(text);
  const { letter, vector } = vectorOf(sub ? sub[0] : text);
  const a = vector ? arrowOver(letter, x, y, size) : null;
  return (
    <>
      <text x={x} y={y} fontSize={size} fontFamily={FORMULA_FONT_FAMILY} fontWeight={FORMULA_FONT_WEIGHT} fill={fill} opacity={opacity}>
        {letter}
        {sub && <tspan dy={size * SUBSCRIPT_DROP} fontSize={size * SUBSCRIPT_SCALE}>{sub[1]}</tspan>}
      </text>
      {a && (
        <path
          d={`M${a.x1},${a.y} L${a.x2},${a.y} M${a.x2 - a.head},${a.y - a.head * 0.7} L${a.x2},${a.y} L${a.x2 - a.head},${a.y + a.head * 0.7}`}
          fill="none" stroke={fill} strokeWidth={a.stroke} strokeLinecap="round" strokeLinejoin="round"
        />
      )}
    </>
  );
}

/**
 * A formula in a web drawn small (InnerNetwork): what FormulaObjectsLayer draws
 * on the canvas, at rest and without input. Its band in the equation's color,
 * the title on it, the formula's ground, and the formula itself while it is
 * large enough to read (`minPx`, the preview's label cutoff, against `scale`).
 */
const PreviewFormula = ({ obj, scale, minPx, theme }) => {
  const { frame, inner, titleBox } = obj;
  const titleFont = obj.titleFont ?? TITLE_FONT;
  const color = obj.color || NODE_DEFAULT_COLOR;
  const ground = blendColors(theme.surface.bg, color, NODE_GROUP_INTERIOR_TINT);
  const textColor = theme.canvas.textPrimary;
  return (
    <g>
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} rx={G.nodeGroupCornerRadius} ry={G.nodeGroupCornerRadius} fill={color} />
      {obj.title && titleFont * scale >= minPx && (
        <text
          x={titleBox.x + titleBox.w / 2} y={titleBox.y + titleBox.h / 2}
          fontSize={titleFont} fontFamily="EmOne, sans-serif" fontWeight="bold"
          fill={getTextColor(color, theme.darkMode)} textAnchor="middle" dominantBaseline="central"
          style={{ whiteSpace: 'pre' }}
        >
          {obj.title}
        </text>
      )}
      <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={G.innerCanvasCornerRadius} ry={G.innerCanvasCornerRadius} fill={ground} />
      {FORMULA_FONT * scale >= minPx && obj.tokens.map((t, i) => {
        const b = obj.boxes[i];
        if (!b) return null;
        if (b.root) {
          const r = b.root;
          const hook = (fx, fy) => `${r.x + r.signW * fx},${r.y + r.h * fy}`;
          return (
            <polyline
              key={t.key}
              points={`${hook(0, 0.58)} ${hook(0.22, 0.5)} ${hook(0.5, 1)} ${hook(1, 0)} ${r.x + r.w},${r.y}`}
              fill="none" stroke={textColor} strokeWidth={r.stroke} strokeLinejoin="round" strokeLinecap="round"
            />
          );
        }
        if (b.bar) {
          return <rect key={t.key} x={b.bar.x} y={b.bar.y} width={b.bar.w} height={b.bar.h} rx={b.bar.h / 2} fill={textColor} />;
        }
        return (
          <TokenText
            key={t.key} text={t.text} x={b.textX} y={b.baseline} size={b.size}
            fill={textColor} opacity={t.kind === 'paren' ? 0.75 : 1}
          />
        );
      })}
    </g>
  );
};

export default PreviewFormula;
