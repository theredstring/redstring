/**
 * Formulas shown in place: one canvas object per formula group, drawn where its
 * Things are (formulaObjects.js says where). Drawn by NodeLayer after the
 * nodes, inside the canvas SVG, so it pans and zooms with the web.
 *
 * It takes input the way a Thing does:
 * - the token under the pointer becomes its Thing (its color, rounded like a node):
 *   an operand its Thing, an operation the Thing that defines its connection, a
 *   parenthesis or sign or function name the part's Thing (both parentheses light);
 * - a tap selects the formula's group, which brings up its control panel (the
 *   format mode of UnifiedBottomControlPanel, where formats are swapped);
 * - a double tap on a token opens that Thing in the panel;
 * - hold, then drag, moves its Things together, snapping to the grid like a
 *   group drag when the grid is on. The Things are written as they move
 *   (drag-phase writes, no save, no history), so connections stay on their
 *   tokens; the drop is one undo step.
 */
import { memo, useEffect, useRef, useState } from 'react';
import useGraphStore from '../../../../store/graphStore.js';
import useCanvasUIStore from '../../../../store/canvasUIStore.js';
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { getNodeDimensions } from '../../../../utils.js';
import { useTheme } from '../../../../hooks/useTheme.js';
import { getTextColor } from '../../../../utils/colorUtils.js';
import { haptic } from '../../../../services/haptics.js';
import { NODE_DEFAULT_COLOR } from '../../../../constants.js';
import { useFormulaObjects } from './useFormulaObjects.js';
import { FORMULA_FONT, FORMULA_FONT_FAMILY, FORMULA_FONT_WEIGHT } from './formulaObjects.js';

const MOVE_SLOP_PX = 6;      // a press that wanders this far before the lift is not a hold
const DOUBLE_TAP_MS = 320;
const LIFT_SCALE = 1.04;

/** Select a group from the canvas, the way a click on its title does (groupInput.titleClick). */
function selectGroup(groupId) {
  const ui = useCanvasUIStore.getState();
  ui.setSelectedGroupId(groupId);
  ui.setSelectedInstanceIds(new Set());
  ui.setSelectedEdgeId(null);
  ui.clearSelectedEdgeIds();
  ui.setGroupControlPanelShouldShow(true);
  ui.setNodeControlPanelShouldShow(false);
  ui.setNodeControlPanelVisible(false);
  ui.setAbstractionControlPanelVisible(false);
  ui.setAbstractionControlPanelShouldShow(false);
  ui.setConnectionControlPanelVisible(false);
  ui.setConnectionControlPanelShouldShow(false);
}

function openThingInPanel(prototype) {
  if (!prototype) return;
  const st = useGraphStore.getState();
  st.openRightPanelNodeTab(prototype.id, prototype.name);
  if (!st.rightPanelExpanded) st.setRightPanelExpanded(true);
}

/** Where each Thing goes for a drag of (dx, dy): per Thing, snapped like a group drag's members. */
function movedPositions(start, dx, dy) {
  const { mode, size } = useGraphStore.getState().gridSettings || {};
  const snap = mode && mode !== 'off' && size > 0;
  return start.map(({ id, x, y, w, h }) => {
    if (!snap) return { instanceId: id, x: x + dx, y: y + dy };
    const cx = Math.round((x + dx + w / 2) / size) * size;
    const cy = Math.round((y + dy + h / 2) / size) * size;
    return { instanceId: id, x: cx - w / 2, y: cy - h / 2 };
  });
}

function FormulaObject({ obj, theme, selected }) {
  const [hoverId, setHoverId] = useState(null);
  const [lifted, setLifted] = useState(false);
  const pressRef = useRef(null);
  const lastTapRef = useRef({ target: null, at: 0 });

  useEffect(() => () => { if (pressRef.current?.timer) clearTimeout(pressRef.current.timer); }, []);

  const colorOf = (protoId) => obj.protoOf.get(protoId)?.color || NODE_DEFAULT_COLOR;

  const writePositions = (positions, contextOptions) => {
    useGraphStore.getState().updateMultipleNodeInstancePositions(obj.graphId, positions, contextOptions);
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const scale = e.currentTarget.getScreenCTM?.()?.a || 1;
    const tokenEl = e.target.closest?.('[data-formula-target]');
    const target = tokenEl?.getAttribute('data-formula-target') || null;
    const protoId = tokenEl?.getAttribute('data-formula-proto') || null;
    const press = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, scale, target, protoId, lifted: false, moved: false, frame: 0 };
    const delay = useGraphStore.getState().mouseSettings?.nodeLiftDelay ?? 250;
    press.timer = setTimeout(() => {
      // Lift: the Things' resting places, for the drag and for the drop's undo.
      const st = useGraphStore.getState();
      const view = projectGraphView(st, obj.graphId);
      press.start = obj.memberIds.map((id) => {
        const inst = view.instances.get(id);
        const proto = st.nodePrototypes.get(inst.prototypeId);
        const dims = getNodeDimensions({ ...proto, ...inst, name: proto?.name }, false, null);
        return { id, x: inst.x, y: inst.y, w: dims.currentWidth, h: dims.currentHeight };
      });
      press.lifted = true;
      setLifted(true);
      setHoverId(null);
      haptic('nodeLift');
    }, delay);
    pressRef.current = press;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    const sx = e.clientX - press.startX;
    const sy = e.clientY - press.startY;
    if (!press.lifted) {
      // Moving before the lift isn't a hold: nothing happens, as with a group's title.
      if (Math.hypot(sx, sy) > MOVE_SLOP_PX) { clearTimeout(press.timer); press.cancelled = true; }
      return;
    }
    press.moved = true;
    press.dx = sx / press.scale;
    press.dy = sy / press.scale;
    if (press.frame) return;
    press.frame = requestAnimationFrame(() => {
      press.frame = 0;
      if (pressRef.current !== press) return;
      writePositions(movedPositions(press.start, press.dx, press.dy), { isDragging: true, phase: 'move', ignore: true, skipSave: true });
    });
  };

  const endPress = (e, cancelled) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    pressRef.current = null;
    clearTimeout(press.timer);
    if (press.frame) cancelAnimationFrame(press.frame);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (press.lifted) {
      setLifted(false);
      if (press.moved && !cancelled) {
        // One undo step: back to where they were without recording, then the move.
        const from = press.start.map(({ id, x, y }) => ({ instanceId: id, x, y }));
        writePositions(from, { ignore: true, skipSave: true });
        writePositions(movedPositions(press.start, press.dx, press.dy), { finalize: true, historyLabel: 'Move Formula' });
        haptic('nodeDrop');
      } else if (press.moved) {
        writePositions(press.start.map(({ id, x, y }) => ({ instanceId: id, x, y })), { ignore: true, skipSave: true });
      }
      return;
    }
    if (cancelled || press.cancelled) return;
    // A tap. Twice on the same token opens its Thing; otherwise it selects the formula.
    const now = performance.now();
    const last = lastTapRef.current;
    if (press.target && last.target === press.target && now - last.at < DOUBLE_TAP_MS) {
      lastTapRef.current = { target: null, at: 0 };
      openThingInPanel(obj.protoOf.get(press.protoId));
      return;
    }
    lastTapRef.current = { target: press.target, at: now };
    selectGroup(obj.groupId);
  };

  const textColor = theme.canvas.textPrimary;
  const frameColor = obj.groupColor || theme.canvas.brand;
  const { frame } = obj;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;

  return (
    <g
      className={`formula-object${selected ? ' is-selected' : ''}${lifted ? ' is-lifted' : ''}`}
      data-formula-group={obj.groupId}
      transform={lifted ? `translate(${cx} ${cy}) scale(${LIFT_SCALE}) translate(${-cx} ${-cy})` : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPress(e, false)}
      onPointerCancel={(e) => endPress(e, true)}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ cursor: lifted ? 'grabbing' : 'pointer', filter: lifted ? 'drop-shadow(0px 10px 15px rgba(0, 0, 0, 0.2))' : undefined }}
    >
      <rect
        x={frame.x} y={frame.y} width={frame.w} height={frame.h} rx={FORMULA_FONT * 0.55}
        fill={frameColor} fillOpacity={selected ? 0.14 : 0.07}
        stroke={frameColor} strokeWidth={selected ? 7 : 4}
      />
      {obj.tokens.map((t, i) => {
        const b = obj.boxes[i];
        const target = t.target || null;
        const hot = !!target && target === hoverId;
        const fill = colorOf(t.protoId);
        return (
          <g
            key={t.key}
            className="formula-object-token"
            data-formula-target={target || undefined}
            data-formula-proto={t.protoId || undefined}
            onPointerEnter={target ? () => { if (!pressRef.current?.lifted) setHoverId(target); } : undefined}
            onPointerLeave={target ? () => setHoverId(prev => (prev === target ? null : prev)) : undefined}
          >
            <rect
              x={b.x} y={b.y} width={b.w} height={b.h}
              rx={Math.min(b.h * 0.4, b.w / 2)}
              fill={hot ? fill : 'transparent'}
            />
            {t.text && (
              <text
                x={b.textX} y={b.baseline}
                fontSize={b.size} fontFamily={FORMULA_FONT_FAMILY} fontWeight={FORMULA_FONT_WEIGHT}
                fill={hot ? getTextColor(fill, theme.darkMode) : textColor}
                opacity={t.kind === 'paren' && !hot ? 0.75 : 1}
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {t.text}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function FormulaObjectsLayer() {
  const formulaObjects = useFormulaObjects();
  const selectedGroupId = useCanvasUIStore(s => s.selectedGroupId);
  const theme = useTheme();
  if (!formulaObjects.objects.length) return null;
  const hideGroups = [...formulaObjects.hiddenGroupIds].map(id => `[data-group-id=${JSON.stringify(id)}]`).join(',');
  return (
    <g className="formula-objects-layer">
      {hideGroups && <style>{`${hideGroups}{display:none}`}</style>}
      {formulaObjects.objects.map(obj => (
        <FormulaObject key={obj.groupId} obj={obj} theme={theme} selected={selectedGroupId === obj.groupId} />
      ))}
    </g>
  );
}

export default memo(FormulaObjectsLayer);
