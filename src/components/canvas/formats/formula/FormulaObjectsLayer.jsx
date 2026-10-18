/**
 * Formulas shown in place: one canvas object per formula, drawn where its
 * Things were (formulaObjects.js says where). Drawn by NodeLayer after the
 * nodes, inside the canvas SVG, so it pans and zooms with the web.
 *
 * - A token under the pointer becomes its Thing: its color, rounded like a node.
 *   An operator also shades the subexpression it governs.
 * - Click a token to keep its description up (a tap does the same on touch).
 * - Drag the object to move its Things together.
 * - The button on its corner turns it back into Things.
 */
import { memo, useCallback, useRef, useState } from 'react';
import { Network } from 'lucide-react';
import useGraphStore from '../../../../store/graphStore.js';
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { useTheme } from '../../../../hooks/useTheme.js';
import { getTextColor } from '../../../../utils/colorUtils.js';
import { NODE_DEFAULT_COLOR } from '../../../../constants.js';
import { showAsThings } from '../formatsStore.js';
import { useFormulaObjects } from './useFormulaObjects.js';
import { FORMULA_FONT, FORMULA_FONT_FAMILY, FORMULA_FONT_WEIGHT } from './formulaObjects.js';

const DRAG_SLOP_PX = 4;
const CARD_W = 560;


const stop = (e) => e.stopPropagation();

function roleLine(node, parent) {
  const parentName = parent ? (parent.kind === 'op' ? parent.op.name : parent.name) : null;
  const inParent = parentName ? ` · in ${parentName}` : '';
  if (node.kind === 'op') {
    const n = node.children.length;
    return `${node.op.name} · ${n === 1 ? '1 operand' : `${n} operands`}${inParent}`;
  }
  if (node.kind === 'fn') {
    const n = node.children.length;
    return `Function · ${n === 1 ? '1 argument' : `${n} arguments`}${inParent}`;
  }
  return parentName ? `Operand of ${parentName}` : 'Operand';
}

function FormulaObject({ obj, theme }) {
  const [hoverId, setHoverId] = useState(null);
  const [pinnedId, setPinnedId] = useState(null);
  const [offset, setOffset] = useState(null);
  const dragRef = useRef(null);

  const nodeOf = useCallback((id) => {
    let found = null;
    let parentOf = null;
    const walk = (n, p) => {
      if (found) return;
      if (n.id === id) { found = n; parentOf = p; return; }
      (n.children || []).forEach(c => walk(c, n));
    };
    walk(obj.tree, null);
    return found ? { node: found, parent: parentOf } : null;
  }, [obj.tree]);

  const colorOf = (id) => obj.protoOf.get(id)?.color || NODE_DEFAULT_COLOR;

  // Drag: pointer events with capture; the press is kept from the canvas so it
  // doesn't start a pan or a marquee underneath.
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const scale = e.currentTarget.getScreenCTM?.()?.a || 1;
    dragRef.current = { startX: e.clientX, startY: e.clientY, scale, moved: false, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const sx = e.clientX - d.startX;
    const sy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(sx, sy) < DRAG_SLOP_PX) return;
    d.moved = true;
    setOffset({ dx: sx / d.scale, dy: sy / d.scale });
  };
  const onPointerUp = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    const dx = (e.clientX - d.startX) / d.scale;
    const dy = (e.clientY - d.startY) / d.scale;
    const st = useGraphStore.getState();
    const view = projectGraphView(st, obj.graphId);
    const updates = obj.memberIds
      .map(id => view.instances.get(id))
      .filter(Boolean)
      .map(inst => ({ instanceId: inst.id, x: inst.x + dx, y: inst.y + dy }));
    st.updateMultipleNodeInstancePositions(obj.graphId, updates, { finalize: true });
    setOffset(null);
    dragRef.current = { suppressClick: true };
  };
  const swallowClickAfterDrag = (e) => {
    e.stopPropagation();
    if (dragRef.current?.suppressClick) {
      dragRef.current = null;
      return true;
    }
    return false;
  };

  const litId = hoverId ?? pinnedId;
  const litSpan = litId ? obj.spans.get(litId) : null;
  let band = null;
  if (litSpan) {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (let i = litSpan[0]; i <= litSpan[1]; i++) {
      const b = obj.boxes[i];
      left = Math.min(left, b.x); right = Math.max(right, b.x + b.w);
      if (!obj.tokens[i].level) { top = Math.min(top, b.y); bottom = Math.max(bottom, b.y + b.h); }
    }
    if (Number.isFinite(top)) band = { x: left, y: top, w: right - left, h: bottom - top, color: colorOf(litId) };
  }

  const shownInfo = litId ? nodeOf(litId) : null;
  const shownProto = litId ? obj.protoOf.get(litId) : null;
  const textColor = theme.canvas.textPrimary;
  const frameColor = obj.groupColor || theme.canvas.brand;
  const { frame } = obj;
  const r = FORMULA_FONT * 0.42;

  return (
    <g
      className="formula-object"
      data-group-id-formula={obj.groupId}
      transform={offset ? `translate(${offset.dx} ${offset.dy})` : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragRef.current = null; setOffset(null); }}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={(e) => { if (!swallowClickAfterDrag(e)) setPinnedId(null); }}
      onDoubleClick={stop}
      style={{ cursor: offset ? 'grabbing' : 'grab' }}
    >
      <rect
        x={frame.x} y={frame.y} width={frame.w} height={frame.h} rx={FORMULA_FONT * 0.55}
        fill={frameColor} fillOpacity={0.07} stroke={frameColor} strokeWidth={4}
      />
      {band && (
        <rect
          x={band.x} y={band.y} width={band.w} height={band.h} rx={band.h * 0.3}
          fill={band.color} fillOpacity={0.14} pointerEvents="none"
        />
      )}
      {obj.tokens.map((t, i) => {
        const b = obj.boxes[i];
        const target = t.nodeId || t.ownerId || null;
        const hot = !!t.nodeId && t.nodeId === litId;
        const owned = !t.nodeId && t.ownerId && t.ownerId === litId;
        const inSpan = !!litSpan && i >= litSpan[0] && i <= litSpan[1];
        const fill = target ? colorOf(target) : NODE_DEFAULT_COLOR;
        let color = textColor;
        if (hot) color = getTextColor(fill, theme.darkMode);
        else if (owned || (inSpan && t.level > 0)) color = fill;
        return (
          <g
            key={t.key}
            className="formula-object-token"
            onPointerEnter={target ? () => setHoverId(target) : undefined}
            onPointerLeave={target ? () => setHoverId(null) : undefined}
            onClick={target ? (e) => {
              if (swallowClickAfterDrag(e)) return;
              setPinnedId(prev => (prev === target ? null : target));
            } : undefined}
            style={{ cursor: target ? 'pointer' : undefined }}
          >
            <rect
              x={b.x} y={b.y} width={Math.max(b.w, t.raise ? FORMULA_FONT * 0.3 : 0)} height={b.h}
              rx={Math.min(b.h * 0.4, b.w / 2)}
              fill={hot ? fill : 'transparent'}
            />
            {t.text && (
              <text
                x={b.textX} y={b.baseline}
                fontSize={b.size} fontFamily={FORMULA_FONT_FAMILY} fontWeight={FORMULA_FONT_WEIGHT}
                fill={color} opacity={t.kind === 'paren' && !owned ? 0.75 : 1}
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {t.text}
              </text>
            )}
          </g>
        );
      })}

      {/* Back to Things */}
      <g
        className="formula-object-revert"
        transform={`translate(${frame.x + frame.w} ${frame.y})`}
        onPointerDown={stop}
        onClick={(e) => { e.stopPropagation(); showAsThings(obj.graphId, obj.groupId); }}
        style={{ cursor: 'pointer' }}
      >
        <title>Show as Things</title>
        <circle r={r} fill={theme.canvas.bg} stroke={frameColor} strokeWidth={3} />
        <Network x={-r * 0.55} y={-r * 0.55} width={r * 1.1} height={r * 1.1} color={frameColor} strokeWidth={2.5} />
      </g>

      {shownInfo && (
        <foreignObject
          x={frame.x + frame.w / 2 - CARD_W / 2} y={frame.y + frame.h + 18}
          width={CARD_W} height={260} pointerEvents="none"
        >
          <div className="formula-object-card" style={{ '--fo-text': textColor, '--fo-muted': theme.canvas.textSecondary }}>
            <span
              className="formula-object-chip"
              style={{ background: colorOf(litId), color: getTextColor(colorOf(litId), theme.darkMode) }}
            >
              {shownProto?.name || shownInfo.node.name}
            </span>
            <span className="formula-object-role">{roleLine(shownInfo.node, shownInfo.parent)}</span>
            <span className="formula-object-description">
              {shownProto?.description?.trim() || 'No description'}
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function FormulaObjectsLayer() {
  const formulaObjects = useFormulaObjects();
  const theme = useTheme();
  if (!formulaObjects.objects.length) return null;
  const hideGroups = [...formulaObjects.hiddenGroupIds].map(id => `[data-group-id=${JSON.stringify(id)}]`).join(',');
  return (
    <g className="formula-objects-layer">
      {hideGroups && <style>{`${hideGroups}{display:none}`}</style>}
      {formulaObjects.objects.map(obj => <FormulaObject key={obj.groupId} obj={obj} theme={theme} />)}
    </g>
  );
}

export default memo(FormulaObjectsLayer);
