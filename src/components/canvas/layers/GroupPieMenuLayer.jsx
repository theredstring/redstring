/**
 * The group pie: the menu a selected Thing-group or equation shows, centred
 * over its title. It is the connection pie's layout (PieMenu's line mode: a
 * row, wrapping into staggered rows past five), always level.
 *
 * The buttons come from ControlPanelsHost (pie/groupPieButtons.js), which owns
 * the group's actions. The anchor is the top middle of the title: a
 * Thing-group's pill from the group layout, or an equation's title on its band
 * (its band's top edge while untitled), from the formula objects.
 *
 * Selecting one frames it with its menu (Settings, Zoom on Select: Thing-Groups
 * and Equations; framing.focusGroupInViewWith): a Thing-group by its title, an
 * equation whole. A box that has just opened is framed the same way
 * (groups/openedBoxFrame.js). Shown another way while selected
 * (pie/groupPieButtons.reframeGroup), it is framed again, whole, as what it
 * becomes.
 *
 * It leaves while the group is dragged, while its name is being edited and
 * while the carousel or orbit holds the screen, and comes back after. The last
 * anchor and buttons are latched during render, so a deselected group's menu
 * shrinks away where it was.
 */
import { Profiler, memo, useCallback, useEffect, useRef } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import PieMenu from '../../../PieMenu.jsx';
import { useGroupPieStore, takeGroupFocusHold, takeGroupReframe } from '../pie/groupPieButtons.js';
import { useFormulaObjects } from '../formats/formula/useFormulaObjects.js';
import useGraphStore from '../../../store/graphStore.js';
import { focusGroupInViewWith } from '../camera/framing.js';
import { takeOpenedBoxFrame } from '../groups/openedBoxFrame.js';

// PieMenu's BUBBLE_SIZE, before scaling.
const BUBBLE_SIZE = 120;
// A box that has just opened is framed by its title like a selection, pulled back
// this much further so more of what opened shows around it.
const OPENED_BOX_ZOOM = 0.7;

/**
 * The pie's anchor: over the middle of a group's title, in canvas coordinates,
 * or null. Line mode stands its first row half a bubble and two paddings off
 * the anchor (made for a connection's thin label); dropped half a bubble, the
 * row stands two paddings above the title.
 */
function titleAnchorOf(groupId, groupLayouts, formulaObjects, pieScale) {
  const drop = (BUBBLE_SIZE / 2) * pieScale;
  const formula = formulaObjects.objects.find(o => o.groupId === groupId);
  if (formula?.titleBox) {
    const b = formula.titleBox;
    return { x: b.x + b.w / 2, y: b.y + drop };
  }
  const r = groupLayouts?.titleRects?.get(groupId);
  if (r) return { x: r.x + r.width / 2, y: r.y + drop };
  return null;
}

/** The group as drawn, title included ({ x, y, w, h }), or null. */
function groupBoxOf(groupId, groupLayouts, formulaObjects) {
  const formula = formulaObjects.objects.find(o => o.groupId === groupId);
  if (formula?.frame) return formula.frame;
  const layout = groupLayouts?.entries?.find(e => e.group.id === groupId)?.layout;
  const vb = layout?.visualBounds;
  return vb ? { x: vb.x, y: vb.y, w: vb.w, h: vb.h } : null;
}

/**
 * What selecting a group frames: a Thing-group's title pill, or the whole of an
 * equation (its title alone says little about it). { x, y, w, h } or null.
 */
function selectionFrameOf(groupId, groupLayouts, formulaObjects) {
  if (formulaObjects.objects.some(o => o.groupId === groupId)) return groupBoxOf(groupId, groupLayouts, formulaObjects);
  const r = groupLayouts?.titleRects?.get(groupId);
  if (r) return { x: r.x, y: r.y, w: r.width, h: r.height };
  return groupBoxOf(groupId, groupLayouts, formulaObjects);
}

function GroupPieMenuLayer({
  groupLayouts, editingGroupId, dragging, abstractionCarouselVisible, semanticOrbitActive, nodeScale, onHoverChange,
  cameraCtxRef,
}) {
  const groupId = useGroupPieStore(s => s.groupId);
  const buttons = useGroupPieStore(s => s.buttons);
  const formulaObjects = useFormulaObjects();

  const pieMenuScale = useGraphStore(s => s.textSettings?.pieMenuScale ?? 1.0);
  const anchor = groupId ? titleAnchorOf(groupId, groupLayouts, formulaObjects, nodeScale * pieMenuScale) : null;
  const live = Boolean(groupId && anchor && buttons.length);

  // Same values, same object: PieMenu re-renders on the anchor's identity.
  const latchRef = useRef(null);
  if (live) {
    const prev = latchRef.current;
    const sameAnchor = prev && prev.anchor.x === anchor.x && prev.anchor.y === anchor.y;
    if (!prev || !sameAnchor || prev.buttons !== buttons || prev.groupId !== groupId) {
      latchRef.current = { groupId, buttons, anchor: sameAnchor ? prev.anchor : anchor };
    }
  }
  const handleExitComplete = useCallback(() => { latchRef.current = null; }, []);

  // Zoom on Select: frame a group once, when it is freshly selected.
  const focusEnabled = useGraphStore(s => s.focusOnSelectGroupsEnabled !== false);
  const zoomAmount = useGraphStore(s => s.focusOnSelectZoomAmount ?? 1.0);
  const latestRef = useRef(null);
  latestRef.current = { anchor, buttonCount: buttons.length, groupLayouts, formulaObjects, dragging, abstractionCarouselVisible, semanticOrbitActive };
  // Once per selection: a group that stays selected while it changes shape
  // (swapped between formula and Things, renamed) isn't framed again. Waits for
  // the menu to be there, which may be a commit after the selection.
  const focusRef = useRef({ id: null, done: false });
  useEffect(() => {
    if (groupId !== focusRef.current.id) focusRef.current = { id: groupId, done: false };
    if (!groupId || !live || focusRef.current.done) return;
    focusRef.current.done = true;
    // A box that just opened is framed whatever Zoom on Select says, as opening
    // always has; this is where it gets room for its menu.
    const opened = takeOpenedBoxFrame(groupId);
    if (!opened && (takeGroupFocusHold(groupId) || !focusEnabled)) return;
    const l = latestRef.current;
    if (l.dragging || l.abstractionCarouselVisible || l.semanticOrbitActive) return;
    const ctx = cameraCtxRef?.current;
    const box = selectionFrameOf(groupId, l.groupLayouts, l.formulaObjects);
    if (!ctx || !box) return;
    focusGroupInViewWith(ctx, box, l.anchor, l.buttonCount, opened ? zoomAmount * OPENED_BOX_ZOOM : zoomAmount);
  }, [groupId, live, focusEnabled, zoomAmount, cameraCtxRef]);

  // Shown another way (formula or Things, names or symbols): framed again as
  // what it becomes, the camera moving with the morph, as opening a Thing
  // frames its box. Asked for, so it doesn't wait on Zoom on Select.
  useEffect(() => {
    if (!groupId || !takeGroupReframe(groupId, buttons)) return;
    const l = latestRef.current;
    if (l.dragging || l.abstractionCarouselVisible || l.semanticOrbitActive) return;
    const ctx = cameraCtxRef?.current;
    const box = groupBoxOf(groupId, l.groupLayouts, l.formulaObjects);
    if (!ctx || !box) return;
    focusGroupInViewWith(ctx, box, l.anchor, l.buttonCount, zoomAmount);
  }, [groupId, buttons, zoomAmount, cameraCtxRef]);

  const shown = latchRef.current;
  if (!shown) return null;

  const isVisible = live
    && !dragging
    && editingGroupId !== groupId
    && !abstractionCarouselVisible
    && !semanticOrbitActive;

  return (
    <Profiler id="GroupPieMenu" onRender={onRenderProbe}>
      <PieMenu
        anchor={shown.anchor}
        anchorAngle={0}
        buttons={shown.buttons}
        nodeScale={nodeScale}
        isVisible={isVisible}
        onHoverChange={onHoverChange}
        onExitAnimationComplete={handleExitComplete}
      />
    </Profiler>
  );
}

export default memo(GroupPieMenuLayer);
