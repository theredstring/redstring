import { useLayoutEffect, useMemo, useState } from 'react';
import { NODE_DEFAULT_COLOR } from '../../constants.js';
import { getNodeDimensions } from '../../utils.js';
import { getTextColor } from '../../utils/colorUtils';
import { buildNodeFontString, wrapTextToLines } from '../../services/textMeasurement.js';
import { LABEL_FONT_SIZE_BASE, LABEL_LINE_HEIGHT_BASE } from '../../utils/nodeLabelStyle.js';
import { useTheme } from '../../hooks/useTheme.js';
import useGraphStore from '../../store/graphStore.js';
import InnerNetwork from '../../InnerNetwork.jsx';

// Node.jsx: the label container's vertical padding and the background rect's inset.
const LABEL_PADDING_V = 34;
const FRAME_INSET = 6;
// The card's title sits a touch looser than the canvas label: at card size
// the canvas spacing reads cramped. Truncation still counts canvas lines.
const CARD_LINE_SPACING = 1.08;

/**
 * The corner radius, in screen px, for an HTML element that holds a WebCard
 * edge to edge inside a `border`-wide border: concentric with the card's
 * frame, so the element's own fill never shows past it. Measures the
 * element's inner width, so `fallbackWidth` only covers the first layout.
 */
export const useWebCardCornerRadius = (ref, sizingName, { border = 0, fallbackWidth = 0 } = {}) => {
  const [innerWidth, setInnerWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setInnerWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  // The frame follows the user's text and node size.
  const textSettings = useGraphStore((s) => s.textSettings);
  return useMemo(() => {
    const dims = getNodeDimensions({ name: sizingName }, true, null);
    const width = innerWidth || Math.max(1, fallbackWidth - border * 2);
    return dims.scaledCornerRadius * (width / dims.currentWidth) + border;
  }, [sizingName, innerWidth, fallbackWidth, border, textSettings]);
};

/**
 * A Web drawn as the canvas draws a Thing in the decompose preview: the same
 * geometry (getNodeDimensions in preview mode) under a viewBox, so the frame,
 * the title band and the Web keep the proportions they have on the canvas.
 * Shared by a definition in the right panel and the Open Webs list.
 *
 * `sizingName` sizes the frame (the defining Thing's name, as the canvas sizes
 * it); `title` is what the band says. `drawWeb={false}` leaves the well
 * empty (a card scrolled far out of view), at the same size.
 */
const WebCard = ({ nodes, edges, groups, title, sizingName, color, drawWeb = true }) => {
  const theme = useTheme();
  const textSettings = useGraphStore((s) => s.textSettings);
  const nodeScale = textSettings?.nodeScale ?? 1;
  const name = sizingName || title || '';
  const label = title || name;

  const geometry = useMemo(() => {
    const dims = getNodeDimensions({ name }, true, null);
    const unexpanded = getNodeDimensions({ name }, false, null);
    const fontScale = (textSettings?.fontSize ?? 1) * nodeScale;
    const fontSize = LABEL_FONT_SIZE_BASE * fontScale;
    const lineHeight = LABEL_LINE_HEIGHT_BASE * fontScale * (textSettings?.lineSpacing ?? 1);
    const wrapWidth = unexpanded.currentWidth - 2 * unexpanded.scaledPadding;
    const maxLines = Math.max(1, Math.floor((dims.textAreaHeight - 2 * LABEL_PADDING_V * nodeScale) / lineHeight));
    let lines = wrapTextToLines(label, wrapWidth, buildNodeFontString({ ...textSettings, fontSize: fontScale }));
    if (lines.length === 0) lines = [label];
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`;
    }
    return { dims, fontSize, lineHeight: lineHeight * CARD_LINE_SPACING, lines };
  }, [name, label, textSettings, nodeScale]);

  const { dims, fontSize, lineHeight, lines } = geometry;
  const width = dims.currentWidth;
  const height = dims.currentHeight;
  const inner = {
    x: dims.scaledPadding,
    y: dims.textAreaHeight,
    w: dims.innerNetworkWidth,
    h: dims.innerNetworkHeight,
    r: 22 * nodeScale
  };
  const fill = color || NODE_DEFAULT_COLOR;
  const textColor = getTextColor(fill, theme.darkMode);
  const titleCenterY = dims.textAreaHeight / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ display: 'block', height: 'auto', aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label={label}
    >
      <rect
        x={FRAME_INSET}
        y={FRAME_INSET}
        width={width - FRAME_INSET * 2}
        height={height - FRAME_INSET * 2}
        rx={dims.scaledCornerRadius - FRAME_INSET}
        ry={dims.scaledCornerRadius - FRAME_INSET}
        fill={fill}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={width / 2}
          y={titleCenterY + (i - (lines.length - 1) / 2) * lineHeight}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="'EmOne', sans-serif"
          fontWeight="bold"
          fontSize={fontSize}
          fill={textColor}
        >
          {line}
        </text>
      ))}
      <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={inner.r} ry={inner.r} fill={theme.canvas.bg} />
      {!drawWeb ? null : nodes?.length > 0 ? (
        <g transform={`translate(${inner.x}, ${inner.y})`}>
          <InnerNetwork
            nodes={nodes}
            edges={edges || []}
            groups={groups}
            width={inner.w}
            height={inner.h}
            padding={14 * nodeScale}
          />
        </g>
      ) : (
        <text
          x={inner.x + inner.w / 2}
          y={inner.y + inner.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="'EmOne', sans-serif"
          fontWeight="bold"
          fontSize={36 * nodeScale}
          fill={theme.canvas.textSecondary}
        >
          This Web is empty.
        </text>
      )}
    </svg>
  );
};

export default WebCard;
