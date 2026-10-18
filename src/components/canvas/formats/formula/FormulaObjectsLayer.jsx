/**
 * Formulas shown in place: one canvas object per formula group, drawn where its
 * Things are (formulaObjects.js says where). Drawn by NodeLayer after the
 * nodes, inside the canvas SVG, so it pans and zooms with the web.
 *
 * It looks like the Thing-group it is: a band in the equation's color, its
 * title on the band, the formula on the ground inside. It replaces the Things
 * it stands for entirely: they are not drawn, hit or selected while it is shown.
 *
 * It takes input the way a Thing does:
 * - a tap on a token whose Thing means more than what is written (P for
 *   Pressure, + for Addition, a named part's parentheses) switches it between
 *   its symbol and its Thing, drawn by name in its color; the rest of the
 *   formula slides aside to make room. Hover only lights it, to say it can. A
 *   bare symbol (an x that means nothing yet) is just text;
 * - a tap also selects the formula's group, which brings up its control panel
 *   (the format mode of UnifiedBottomControlPanel: swap formats, write this
 *   formula by names or every operation);
 * - a double tap on a token opens that Thing in the panel (and switches
 *   nothing); on the band, the equation's own Thing;
 * - hold, then drag, moves its Things together, snapping to the grid like a
 *   group drag when the grid is on. The Things are written as they move
 *   (drag-phase writes, no save, no history), so connections stay on their
 *   tokens; the drop is one undo step.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import useGraphStore from '../../../../store/graphStore.js';
import useCanvasUIStore from '../../../../store/canvasUIStore.js';
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { getNodeDimensions } from '../../../../utils.js';
import { useTheme } from '../../../../hooks/useTheme.js';
import { getTextColor, blendColors } from '../../../../utils/colorUtils.js';
import { haptic } from '../../../../services/haptics.js';
import { NODE_DEFAULT_COLOR } from '../../../../constants.js';
import { GROUP_LAYOUT_CONSTANTS as G } from '../../../../services/groupLayout.js';
import { NODE_GROUP_INTERIOR_TINT } from '../../groups/groupElements.jsx';
import { useFormulaObjects } from './useFormulaObjects.js';
import { subscriptOf } from './formulaChain.js';
import { useGlide } from './useGlide.js';
import { flipFormulaToken } from '../formatsStore.js';
import {
  FORMULA_FONT_FAMILY, FORMULA_FONT_WEIGHT, SUBSCRIPT_SCALE, SUBSCRIPT_DROP, TITLE_FONT, PILL_RADIUS,
} from './formulaObjects.js';

const MOVE_SLOP_PX = 6;      // a press that wanders this far before the lift is not a hold
const DOUBLE_TAP_MS = 320;   // a tap waits this long to switch its token, in case it is the first of two
const LIFT_SCALE = 1.04;
const HOVER_TINT = 0.18;
const FADE = { duration: 0.14 };
const TITLE_TARGET = '__title__';

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

function openThingInPanel(protoId) {
  const st = useGraphStore.getState();
  const prototype = protoId ? st.nodePrototypes.get(protoId) : null;
  if (!prototype) return;
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

/** A token's text, its subscript (v_0) lowered and smaller; it slides to where it is put. */
function TokenText({ text, x, y, size, fill, opacity }) {
  const sub = subscriptOf(text);
  const at = useGlide({ x, y });
  return (
    <text
      x={at.x} y={at.y}
      fontSize={size} fontFamily={FORMULA_FONT_FAMILY} fontWeight={FORMULA_FONT_WEIGHT}
      fill={fill} opacity={opacity}
      style={{ userSelect: 'none', pointerEvents: 'none' }}
    >
      {sub ? (
        <>
          {sub[0]}
          <tspan dy={size * SUBSCRIPT_DROP} fontSize={size * SUBSCRIPT_SCALE}>{sub[1]}</tspan>
        </>
      ) : text}
    </text>
  );
}

/** The title, gliding to stay centred on its band. */
function TitleText({ at, children, ...rest }) {
  const now = useGlide(at);
  return <text x={now.x} y={now.y} {...rest}>{children}</text>;
}

/** A rectangle that glides to its new place and size. */
function GlideRect({ r, ...rest }) {
  const at = useGlide(r);
  return <rect x={at.x} y={at.y} width={Math.max(0, at.w)} height={Math.max(0, at.h)} {...rest} />;
}

/**
 * One token, placed by sliding: when a token near it switches between its
 * symbol and its name, it moves to its new place rather than jumping there. A
 * token written by name is its Thing: a pill in its color, grown from the
 * symbol's box.
 */
function Token({ t, b, o, fill, textColor, onBand, hot, onEnter, onLeave }) {
  const defined = !!t.target && !!t.defined;
  const shape = useGlide(b.pill
    ? { x: b.pill.x - o.x, y: b.pill.y - o.y, w: b.pill.w, h: b.pill.h, rx: b.pill.h * PILL_RADIUS, a: 1 }
    : { x: b.x - o.x, y: b.y - o.y, w: b.w, h: b.h, rx: Math.min(b.h * 0.4, b.w / 2), a: hot ? HOVER_TINT : 0 });
  return (
    <motion.g
      className={`formula-object-token${defined ? ' is-defined' : ''}${t.expanded ? ' is-expanded' : ''}`}
      data-formula-target={t.target || undefined}
      data-formula-proto={t.protoId || undefined}
      data-formula-defined={defined ? 'true' : undefined}
      data-formula-flip={defined && t.flip ? t.flip : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: FADE }}
      transition={FADE}
      onPointerEnter={defined ? onEnter : undefined}
      onPointerLeave={defined ? onLeave : undefined}
      style={defined ? undefined : { cursor: 'default' }}
    >
      <rect
        x={shape.x} y={shape.y} width={Math.max(0, shape.w)} height={Math.max(0, shape.h)}
        rx={Math.max(0, shape.rx)} fill={fill} fillOpacity={shape.a}
      />
      <AnimatePresence initial={false}>
        <motion.g key={t.text} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: FADE }} transition={FADE}>
          <TokenText
            text={t.text} x={b.textX - o.x} y={b.baseline - o.y} size={b.size}
            fill={t.expanded ? onBand : textColor}
            opacity={t.kind === 'paren' && !t.expanded ? 0.75 : 1}
          />
        </motion.g>
      </AnimatePresence>
    </motion.g>
  );
}

function FormulaObject({ obj, theme, selected }) {
  const [hoverKey, setHoverKey] = useState(null);
  const [lifted, setLifted] = useState(false);
  const pressRef = useRef(null);
  const lastTapRef = useRef({ target: null, at: 0 });
  const flipTimerRef = useRef(null);

  useEffect(() => () => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    clearTimeout(flipTimerRef.current);
  }, []);

  const writePositions = (positions, contextOptions) => {
    useGraphStore.getState().updateMultipleNodeInstancePositions(obj.graphId, positions, contextOptions);
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const scale = e.currentTarget.getScreenCTM?.()?.a || 1;
    const tokenEl = e.target.closest?.('[data-formula-target]');
    const press = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, scale,
      target: tokenEl?.getAttribute('data-formula-target') || null,
      protoId: tokenEl?.getAttribute('data-formula-proto') || null,
      flip: tokenEl?.getAttribute('data-formula-flip') || null,
      lifted: false, moved: false, frame: 0,
    };
    const delay = useGraphStore.getState().mouseSettings?.nodeLiftDelay ?? 250;
    press.timer = setTimeout(() => {
      // Lift: the Things' resting places, for the drag and for the drop's undo.
      const st = useGraphStore.getState();
      const view = projectGraphView(st, obj.graphId);
      // The equation's own anchor rides along, so it is where its Things are when they are shown again.
      press.start = (obj.anchorId ? [...obj.memberIds, obj.anchorId] : obj.memberIds).map((id) => {
        const inst = view.instances.get(id);
        const proto = st.nodePrototypes.get(inst.prototypeId);
        const dims = getNodeDimensions({ ...proto, ...inst, name: proto?.name }, false, null);
        return { id, x: inst.x, y: inst.y, w: dims.currentWidth, h: dims.currentHeight };
      });
      press.lifted = true;
      setLifted(true);
      setHoverKey(null);
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
    // A tap. Twice on the same token opens its Thing; once switches it (if it
    // can be), after waiting to see that it was only once. Either way the
    // formula is selected.
    const now = performance.now();
    const last = lastTapRef.current;
    clearTimeout(flipTimerRef.current);
    if (press.target && last.target === press.target && now - last.at < DOUBLE_TAP_MS) {
      lastTapRef.current = { target: null, at: 0 };
      openThingInPanel(press.protoId);
      return;
    }
    lastTapRef.current = { target: press.target, at: now };
    selectGroup(obj.groupId);
    if (press.flip && press.target !== TITLE_TARGET) {
      const { flip } = press;
      flipTimerRef.current = setTimeout(() => flipFormulaToken(obj.groupId, flip), DOUBLE_TAP_MS);
    }
  };

  const hoverIn = (key) => (e) => {
    if (e.pointerType === 'touch' || pressRef.current?.lifted) return;
    setHoverKey(key);
  };
  const hoverOut = (key) => () => setHoverKey(prev => (prev === key ? null : prev));

  const color = obj.color || NODE_DEFAULT_COLOR;
  const onBand = getTextColor(color, theme.darkMode);
  const ground = blendColors(theme.surface.bg, color, NODE_GROUP_INTERIOR_TINT);
  const textColor = theme.canvas.textPrimary;
  const { frame, inner, titleBox } = obj;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  // Drawn relative to the formula's middle, so moving it moves it at once and
  // only a change of its own layout slides.
  const o = obj.center;
  const box = (r) => ({ x: r.x - o.x, y: r.y - o.y, w: r.w, h: r.h });

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
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ cursor: lifted ? 'grabbing' : 'pointer', filter: lifted ? 'drop-shadow(0px 10px 15px rgba(0, 0, 0, 0.2))' : undefined }}
    >
      <g transform={`translate(${o.x} ${o.y})`}>
        {selected && (
          <GlideRect
            r={{ x: frame.x - 10 - o.x, y: frame.y - 10 - o.y, w: frame.w + 20, h: frame.h + 20 }}
            rx={G.nodeGroupCornerRadius + 10} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={8}
          />
        )}
        {/* The band is the equation itself: a double tap on it, or its title, opens its Thing. */}
        <g
          className="formula-object-title"
          data-formula-target={TITLE_TARGET}
          data-formula-proto={obj.equationProtoId || undefined}
        >
          <GlideRect r={box(frame)} rx={G.nodeGroupCornerRadius} fill={color} />
          {obj.title && (
            <TitleText
              at={{ x: titleBox.x + titleBox.w / 2 - o.x, y: titleBox.y + titleBox.h / 2 - o.y }}
              fontSize={TITLE_FONT} fontFamily="EmOne, sans-serif" fontWeight="bold"
              fill={onBand} textAnchor="middle" dominantBaseline="central"
              style={{ userSelect: 'none', pointerEvents: 'none' }}
            >
              {obj.title}
            </TitleText>
          )}
        </g>
        <GlideRect r={box(inner)} rx={G.innerCanvasCornerRadius} fill={ground} />
        <AnimatePresence initial={false}>
          {obj.tokens.map((t, i) => (
            <Token
              key={t.key}
              t={t}
              b={obj.boxes[i]}
              o={o}
              fill={obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR}
              textColor={textColor}
              onBand={getTextColor(obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR, theme.darkMode)}
              hot={hoverKey === t.key && !lifted}
              onEnter={hoverIn(t.key)}
              onLeave={hoverOut(t.key)}
            />
          ))}
        </AnimatePresence>
      </g>
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
