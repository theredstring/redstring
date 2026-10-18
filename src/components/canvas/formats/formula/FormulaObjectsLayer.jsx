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
 * - a token that stands for a Thing that means more than what is written (P for
 *   Pressure, + for Addition, the parentheses of a named part) unveils it: the
 *   token grows into that Thing's node, real name and all, above the formula.
 *   With a mouse, on hover; by touch, on a tap (until a tap elsewhere). A bare
 *   symbol (an x that means nothing yet) is just text;
 * - a tap selects the formula's group, which brings up its control panel (the
 *   format mode of UnifiedBottomControlPanel, where formats are swapped);
 * - a double tap on a token opens that Thing in the panel; on the title, the
 *   equation's own Thing;
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
import { getNodeLabelStyle } from '../../../../utils/nodeLabelStyle.js';
import { haptic } from '../../../../services/haptics.js';
import { NODE_DEFAULT_COLOR, NODE_CORNER_RADIUS } from '../../../../constants.js';
import { GROUP_LAYOUT_CONSTANTS as G } from '../../../../services/groupLayout.js';
import { NODE_GROUP_INTERIOR_TINT } from '../../groups/groupElements.jsx';
import { useFormulaObjects } from './useFormulaObjects.js';
import { subscriptOf } from './formulaChain.js';
import {
  FORMULA_FONT_FAMILY, FORMULA_FONT_WEIGHT, SUBSCRIPT_SCALE, SUBSCRIPT_DROP, TITLE_FONT,
} from './formulaObjects.js';

const MOVE_SLOP_PX = 6;      // a press that wanders this far before the lift is not a hold
const DOUBLE_TAP_MS = 320;
const LIFT_SCALE = 1.04;
const UNVEIL_DELAY_MS = 90;  // a pointer passing over on its way somewhere unveils nothing
const UNVEIL_SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 };
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

/** A token's text, its subscript (v_0) lowered and smaller. */
function TokenText({ text, x, y, size, fill, opacity }) {
  const sub = subscriptOf(text);
  return (
    <text
      x={x} y={y}
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

/**
 * A token growing into the Thing it stands for: from the token's box to the
 * node's, centred on the token, the symbol fading as the real name comes in.
 * Drawn over the formula and never hit, so the pointer still finds the tokens
 * under it.
 */
function Unveil({ token, box, proto, theme, textSettings }) {
  const fill = proto?.color || NODE_DEFAULT_COLOR;
  const name = token.realName;
  const dims = getNodeDimensions({ name }, false, null);
  const w = dims.currentWidth;
  const h = dims.currentHeight;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const from = { x: box.x, y: box.y, width: box.w, height: box.h, rx: Math.min(box.h * 0.4, box.w / 2) };
  const to = { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: NODE_CORNER_RADIUS };
  const color = getTextColor(fill, theme.darkMode);
  const label = getNodeLabelStyle({ textSettings, color, unexpandedDims: dims });
  return (
    <motion.g
      className="formula-unveil"
      pointerEvents="none"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      style={{ filter: 'drop-shadow(0px 8px 14px rgba(0, 0, 0, 0.22))' }}
    >
      <motion.rect initial={from} animate={to} exit={from} transition={UNVEIL_SPRING} fill={fill} />
      <motion.g initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.12 }}>
        <TokenText text={token.text} x={box.textX} y={box.baseline} size={box.size} fill={color} />
      </motion.g>
      <motion.foreignObject
        x={to.x} y={to.y} width={w} height={h}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.07, duration: 0.16 }}
      >
        <div
          data-formula-unveil={token.target}
          style={{
            width: '100%', height: '100%', boxSizing: 'border-box', padding: label.containerPadding,
            display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
          }}
        >
          <span style={{ ...label.typography, maxWidth: label.wrapMaxWidth || undefined, overflowWrap: 'break-word', userSelect: 'none' }}>
            {name}
          </span>
        </div>
      </motion.foreignObject>
    </motion.g>
  );
}

function FormulaObject({ obj, theme, selected, textSettings }) {
  // The token unveiled now: { target, by: 'hover' | 'tap' }.
  const [unveiled, setUnveiled] = useState(null);
  const [lifted, setLifted] = useState(false);
  const pressRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const hoverEndedAtRef = useRef(0);
  const lastTapRef = useRef({ target: null, at: 0 });
  const rootRef = useRef(null);

  useEffect(() => () => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    clearTimeout(hoverTimerRef.current);
  }, []);

  // Unveiled by a tap: it stays until a tap anywhere else.
  useEffect(() => {
    if (unveiled?.by !== 'tap') return undefined;
    const away = (e) => { if (!rootRef.current?.contains(e.target)) setUnveiled(null); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [unveiled]);

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
    const defined = tokenEl?.getAttribute('data-formula-defined') === 'true';
    const press = {
      pointerId: e.pointerId, pointerType: e.pointerType, startX: e.clientX, startY: e.clientY, scale,
      target, protoId, defined, lifted: false, moved: false, frame: 0,
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
      setUnveiled(null);
      clearTimeout(hoverTimerRef.current);
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
      openThingInPanel(press.protoId);
      return;
    }
    lastTapRef.current = { target: press.target, at: now };
    // By touch there is no hover: a tap unveils (and a second tap elsewhere moves it).
    if (press.pointerType === 'touch' && press.defined && press.target !== TITLE_TARGET) {
      setUnveiled({ target: press.target, by: 'tap' });
    }
    selectGroup(obj.groupId);
  };

  const hoverIn = (target) => (e) => {
    if (e.pointerType === 'touch' || pressRef.current?.lifted) return;
    clearTimeout(hoverTimerRef.current);
    // Sliding from one token to the next unveils the next at once.
    const sliding = performance.now() - hoverEndedAtRef.current < UNVEIL_DELAY_MS * 2;
    if (sliding) { setUnveiled({ target, by: 'hover' }); return; }
    hoverTimerRef.current = setTimeout(() => setUnveiled({ target, by: 'hover' }), UNVEIL_DELAY_MS);
  };
  const hoverOut = (target) => (e) => {
    if (e.pointerType === 'touch') return;
    clearTimeout(hoverTimerRef.current);
    setUnveiled((prev) => {
      if (prev?.by !== 'hover' || prev.target !== target) return prev;
      hoverEndedAtRef.current = performance.now();
      return null;
    });
  };

  const color = obj.color || NODE_DEFAULT_COLOR;
  const onBand = getTextColor(color, theme.darkMode);
  const ground = blendColors(theme.surface.bg, color, NODE_GROUP_INTERIOR_TINT);
  const textColor = theme.canvas.textPrimary;
  const { frame, inner, titleBox } = obj;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  // The token drawn grown: the first of the tokens standing for that Thing.
  const unveiledIndex = unveiled ? obj.tokens.findIndex(t => t.target === unveiled.target && t.defined) : -1;
  const unveiledToken = unveiledIndex >= 0 ? obj.tokens[unveiledIndex] : null;

  return (
    <g
      ref={rootRef}
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
      {selected && (
        <rect
          x={frame.x - 10} y={frame.y - 10} width={frame.w + 20} height={frame.h + 20}
          rx={G.nodeGroupCornerRadius + 10} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={8}
        />
      )}
      {/* The band is the equation itself: a double tap on it, or its title, opens its Thing. */}
      <g
        className="formula-object-title"
        data-formula-target={TITLE_TARGET}
        data-formula-proto={obj.equationProtoId || undefined}
      >
        <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} rx={G.nodeGroupCornerRadius} fill={color} />
        {obj.title && (
          <text
            x={titleBox.x + titleBox.w / 2} y={titleBox.y + titleBox.h / 2}
            fontSize={TITLE_FONT} fontFamily="EmOne, sans-serif" fontWeight="bold"
            fill={onBand} textAnchor="middle" dominantBaseline="central"
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {obj.title}
          </text>
        )}
      </g>
      <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={G.innerCanvasCornerRadius} fill={ground} />
      {obj.tokens.map((t, i) => {
        const b = obj.boxes[i];
        const target = t.target || null;
        const defined = !!target && !!t.defined;
        return (
          <g
            key={t.key}
            className={`formula-object-token${defined ? ' is-defined' : ''}`}
            data-formula-target={target || undefined}
            data-formula-proto={t.protoId || undefined}
            data-formula-defined={defined ? 'true' : undefined}
            onPointerEnter={defined ? hoverIn(target) : undefined}
            onPointerLeave={defined ? hoverOut(target) : undefined}
            style={defined ? undefined : { cursor: lifted ? 'grabbing' : 'default' }}
          >
            <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" />
            {t.text && (
              <TokenText
                text={t.text} x={b.textX} y={b.baseline} size={b.size} fill={textColor}
                opacity={t.kind === 'paren' ? 0.75 : 1}
              />
            )}
          </g>
        );
      })}
      <AnimatePresence>
        {unveiledToken && !lifted && (
          <Unveil
            key={unveiledToken.target}
            token={unveiledToken}
            box={obj.boxes[unveiledIndex]}
            proto={obj.protoOf.get(unveiledToken.protoId)}
            theme={theme}
            textSettings={textSettings}
          />
        )}
      </AnimatePresence>
    </g>
  );
}

function FormulaObjectsLayer() {
  const formulaObjects = useFormulaObjects();
  const selectedGroupId = useCanvasUIStore(s => s.selectedGroupId);
  const textSettings = useGraphStore(s => s.textSettings);
  const theme = useTheme();
  if (!formulaObjects.objects.length) return null;
  const hideGroups = [...formulaObjects.hiddenGroupIds].map(id => `[data-group-id=${JSON.stringify(id)}]`).join(',');
  return (
    <g className="formula-objects-layer">
      {hideGroups && <style>{`${hideGroups}{display:none}`}</style>}
      {formulaObjects.objects.map(obj => (
        <FormulaObject
          key={obj.groupId} obj={obj} theme={theme} textSettings={textSettings}
          selected={selectedGroupId === obj.groupId}
        />
      ))}
    </g>
  );
}

export default memo(FormulaObjectsLayer);
