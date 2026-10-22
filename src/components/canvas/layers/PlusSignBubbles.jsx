/**
 * The small bubbles around the plus sign: other things to make at that spot.
 * They start at the top and go round clockwise, the way the pie menu's do,
 * pop out once the plus has turned in, and go back into it as soon as the plus
 * is used (named, morphing) or dismissed.
 *
 * New Formula, the same as the canvas right-click's, placed where the plus
 * sign is. New Thing Group: choose a Thing and which Web of it opens there
 * (thingGroupPrompt/); the plus sign waits meanwhile, then becomes it. And,
 * last, while something is copied: Paste, as the right-click's, centred there;
 * one Thing copied, the plus sign morphs into it as it does into a chosen Thing;
 * more, they grow out of it (spawn/nodeSpawn.js).
 */
import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Sigma } from 'lucide-react';
import GraphStar from './graphStarIcon.js';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { pasteClipboard, pasteLabelFor } from '../../../utils/clipboard.js';
import { getNodeDimensions } from '../../../utils.js';
import { queueNodeSpawn } from '../spawn/nodeSpawn.js';
import { PLUS_SIGN_SIZE, PLUS_SIGN_STROKE } from '../../../constants';
import { haptic } from '../../../services/haptics.js';
import { setActionHover, clearActionHoverIf } from '../../../utils/canvas/actionHover.js';
import { openFormulaComposer } from '../formats/formatsStore.js';
import { openThingGroupPrompt } from '../thingGroupPrompt/thingGroupPrompt.js';

const BUBBLE_SHARE = 0.46; // diameter, of the plus sign's
const GAP_SHARE = 0.14; // between the plus and a bubble, of the plus sign's size
const STEP_DEG = 40; // between neighbouring bubbles, clockwise from the top
const APPEAR_DELAY_MS = 120; // once the plus has mostly turned in
const STROKE_SHARE = 0.4; // of the plus sign's outline

function Bubble({ index, plusSize, scale, shown, icon: Icon, label, onActivate, gestureBlockRef, isPanningOrZoomingRef }) {
  const size = plusSize * BUBBLE_SHARE;
  const radius = plusSize / 2 + plusSize * GAP_SHARE + size / 2;
  const angle = ((-90 + index * STEP_DEG) * Math.PI) / 180;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  const downPointers = useRef(new Set());
  const downTouches = useRef(new Set());
  const moved = useRef(false);
  const start = useRef(null);
  const lastFire = useRef(0);
  // Its label, in the chip the pie menus' buttons raise.
  const hoverId = `plus-bubble-${index}`;
  useEffect(() => {
    if (!shown) clearActionHoverIf(hoverId);
    return () => clearActionHoverIf(hoverId);
  }, [shown, hoverId]);

  // Same guards as the plus sign's own press: not during or just after a pan or
  // pinch, only for a press that started here, and once per press.
  const fire = () => {
    if (!shown || moved.current) return;
    if (isPanningOrZoomingRef?.current || gestureBlockRef?.current) return;
    const now = Date.now();
    if (now - lastFire.current < 300) return;
    lastFire.current = now;
    haptic('menuSelect');
    clearActionHoverIf(hoverId);
    onActivate();
  };
  const track = (cx, cy) => {
    if (!start.current) return;
    if (Math.hypot(cx - start.current.x, cy - start.current.y) > 10) moved.current = true;
  };
  const halt = (e) => {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  };

  return (
    <g
      data-plus-sign="true"
      data-plus-bubble="true"
      aria-label={label}
      style={{
        // Out from the plus's middle to its place, and back in.
        transform: shown ? `translate(${x}px, ${y}px) scale(1)` : 'translate(0px, 0px) scale(0)',
        opacity: shown ? 1 : 0,
        transition: 'transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1), opacity 0.16s ease',
        transitionDelay: shown ? `${index * 40}ms` : '0ms',
        pointerEvents: shown ? 'auto' : 'none',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => { if (shown) setActionHover({ id: hoverId, label }); }}
      onMouseLeave={() => clearActionHoverIf(hoverId)}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onPointerDown={(e) => {
        halt(e);
        downPointers.current.add(e.pointerId);
        moved.current = !e.isPrimary;
        start.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => track(e.clientX, e.clientY)}
      onPointerUp={(e) => {
        halt(e);
        if (downPointers.current.delete(e.pointerId)) fire();
      }}
      onPointerCancel={(e) => { downPointers.current.delete(e.pointerId); moved.current = true; }}
      onTouchStart={(e) => {
        halt(e);
        for (const t of e.changedTouches) downTouches.current.add(t.identifier);
        moved.current = e.touches.length > 1;
        if (e.touches.length === 1) start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchMove={(e) => {
        if (e.touches.length > 1) { moved.current = true; return; }
        track(e.touches[0].clientX, e.touches[0].clientY);
      }}
      onTouchEnd={(e) => {
        halt(e);
        let ours = false;
        for (const t of e.changedTouches) if (downTouches.current.delete(t.identifier)) ours = true;
        if (ours && e.touches.length === 0) fire();
      }}
      onTouchCancel={(e) => {
        for (const t of e.changedTouches) downTouches.current.delete(t.identifier);
        moved.current = true;
      }}
    >
      <g className="pie-bubble-hover">
        {/* A touch-sized target even when the bubble is drawn small. */}
        <circle r={Math.max(22, size / 2)} fill="transparent" stroke="none" />
        <circle r={size / 2} fill="#DEDADA" stroke="maroon" strokeWidth={Math.max(1, PLUS_SIGN_STROKE * STROKE_SHARE * scale)} />
        <Icon x={-size / 4} y={-size / 4} width={size / 2} height={size / 2} color="maroon" strokeWidth={2.5} />
      </g>
    </g>
  );
}

export default function PlusSignBubbles({ plusSign, setPlusSign, clipboardRef, handleNodeSelection, gestureBlockRef, isPanningOrZoomingRef }) {
  const scale = useGraphStore(s => s.textSettings?.plusSignScale ?? 1.0);
  const plusSize = PLUS_SIGN_SIZE * scale;
  // Mounted hidden, then shown, so they pop out rather than appear in place.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), APPEAR_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  const shown = ready && plusSign.mode === 'appear' && !plusSign.prompting;

  const newFormula = () => {
    const graphId = useGraphStore.getState().activeGraphId;
    if (!graphId) return;
    // Where the right-click would have put it: the spot the plus sign marks.
    openFormulaComposer(graphId, { x: plusSign.x, y: plusSign.y });
    setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
  };

  // Every clipboard write bumps clipboardVersion, so this follows a copy.
  useCanvasUIStore(s => s.clipboardVersion);
  const pasteLabel = pasteLabelFor(clipboardRef?.current);

  const paste = () => {
    const clip = clipboardRef?.current;
    const store = useGraphStore.getState();
    const graph = store.graphs.get(store.activeGraphId);
    if (!clip || !graph) return;
    // One Thing: the plus sign becomes it (the selector's path, images and all).
    const only = clip.nodes.length === 1 ? store.nodePrototypes.get(clip.nodes[0].prototypeId) : null;
    if (only && !clip.edges?.length) {
      setPlusSign(ps => ps && { ...ps, pastedLabels: clip.nodes[0].labels || null });
      handleNodeSelection(only);
      return;
    }
    // Paste lines up the copied Things' corners on its point; move that point
    // so their middle lands where the plus sign is, as a Thing made from it does.
    let halfW = 0;
    let halfH = 0;
    clip.nodes.forEach((n) => {
      const dims = getNodeDimensions({ ...store.nodePrototypes.get(n.prototypeId), scale: n.scale }, false, null);
      halfW += dims.currentWidth / 2 / clip.nodes.length;
      halfH += dims.currentHeight / 2 / clip.nodes.length;
    });
    const result = pasteClipboard(clip, store.activeGraphId, { x: plusSign.x - halfW, y: plusSign.y - halfH }, store, graph, getNodeDimensions);
    setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
    if (!result?.newInstanceIds?.length) return;
    // They come out of the plus sign as it goes.
    const placed = useGraphStore.getState().graphs.get(store.activeGraphId)?.instances;
    queueNodeSpawn({
      instanceIds: result.newInstanceIds,
      edgeIds: result.newEdgeIds,
      origin: { x: plusSign.x, y: plusSign.y },
      positions: new Map(result.newInstanceIds.map(id => [id, placed?.get(id)]).filter(([, p]) => p)),
    });
    useCanvasUIStore.getState().setSelectedInstanceIds(new Set(result.newInstanceIds));
  };

  const newThingGroup = () => {
    setPlusSign(ps => ps && { ...ps, prompting: true });
    openThingGroupPrompt();
  };

  return (
    <g transform={`translate(${plusSign.x}, ${plusSign.y})`}>
      <Bubble
        index={0}
        plusSize={plusSize}
        scale={scale}
        shown={shown}
        icon={Sigma}
        label="Add Formula"
        onActivate={newFormula}
        gestureBlockRef={gestureBlockRef}
        isPanningOrZoomingRef={isPanningOrZoomingRef}
      />
      <Bubble
        index={1}
        plusSize={plusSize}
        scale={scale}
        shown={shown}
        icon={GraphStar}
        label="Add Web"
        onActivate={newThingGroup}
        gestureBlockRef={gestureBlockRef}
        isPanningOrZoomingRef={isPanningOrZoomingRef}
      />
      {pasteLabel && (
        <Bubble
          index={2}
          plusSize={plusSize}
          scale={scale}
          shown={shown}
          icon={ClipboardPaste}
          label={pasteLabel}
          onActivate={paste}
          gestureBlockRef={gestureBlockRef}
          isPanningOrZoomingRef={isPanningOrZoomingRef}
        />
      )}
    </g>
  );
}
