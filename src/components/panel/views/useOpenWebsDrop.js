import { useCallback, useEffect, useRef, useState } from 'react';
import { useDrop } from 'react-dnd';
import useGraphStore from '../../../store/graphStore.js';
import { haptic } from '../../../services/haptics.js';
import { ensureConceptPrototype } from '../../../services/semanticPlacement.js';
import { NODE_DEFAULT_COLOR } from '../../../constants';
import { useEdgeAutoScroll } from '../../../hooks/useEdgeAutoScroll.js';
import { getTheme } from '../../../utils/themeColors.js';

// The universal drag (see Header.jsx). Over the Open Webs list it means one of
// two things: a web already in the strip (a row's or a header tab's drag, which
// carry a `graphId`) moves to the slot; any other Thing opens its web there.
const SPAWNABLE_NODE = 'spawnable_node';

// Sentinel for the slot past the last row. Slots are named by the web they land
// in front of, as in the header, so the order is one vocabulary in both places.
export const DROP_AT_END = '__end__';

// The slot a moved web already holds: no row matches it, so no ghost shows, and
// a drop there moves nothing. A slot of its own (not null) so crossing into it
// still ticks like any other.
const HOME_SLOT = '__home__';

const isOpenWebDrag = (item) => !!item?.graphId && useGraphStore.getState().openGraphIds.includes(item.graphId);

/**
 * The prototype a dropped item stands for. A semantic concept is made into a
 * saved Thing here, as a drop on the canvas makes it; a stale id falls back to
 * a name match, newest first.
 */
function resolveDroppedPrototypeId(item) {
  if (item?.needsMaterialization && item.conceptData) return ensureConceptPrototype(item.conceptData);
  const { nodePrototypes } = useGraphStore.getState();
  const id = item?.prototypeId || item?.nodeId;
  if (id && nodePrototypes.has(id)) return id;
  const name = item?.nodeName?.toLowerCase();
  if (!name) return null;
  let match = null;
  // No break: Maps iterate oldest first, and the newest Thing of a name is the live one.
  for (const p of nodePrototypes.values()) if (p.name?.toLowerCase() === name) match = p.id;
  return match;
}

/**
 * What the ghost row shows: the web's name and colour as the drop will leave
 * them. Read from the store per render, not memoized: it only renders mid-drag.
 */
export function describeDropGhost(item) {
  if (!item) return null;
  const { graphs, nodePrototypes } = useGraphStore.getState();
  if (isOpenWebDrag(item)) {
    const graph = graphs.get(item.graphId);
    const definer = nodePrototypes.get(graph?.definingNodeIds?.[0]);
    return { name: graph?.name || 'Untitled', color: definer?.color || graph?.color || NODE_DEFAULT_COLOR };
  }
  if (item.needsMaterialization && item.conceptData) {
    return { name: item.conceptData.name || 'Thing', color: item.conceptData.color || NODE_DEFAULT_COLOR };
  }
  const thing = nodePrototypes.get(item.prototypeId || item.nodeId);
  if (!thing) return item.nodeName ? { name: item.nodeName, color: NODE_DEFAULT_COLOR } : null;
  const web = graphs.get((thing.definitionGraphIds || []).find(id => graphs.has(id)));
  return { name: web?.name || thing.name || 'Thing', color: thing.color || NODE_DEFAULT_COLOR };
}

/**
 * Drop target for the Open Webs list: reorders open webs and opens a dropped
 * Thing's web at the slot it was let go over.
 *
 * Like the header strip, the drop is committed once on release; while the drag
 * is over the list a ghost row stands in the slot. The returned `slot` names the
 * row the ghost sits in front of (DROP_AT_END past the last), or is null.
 *
 * @param {React.RefObject<HTMLElement>} listRef - The element whose direct
 *   children are the rows (each carrying `data-graph-id`).
 * @param {Object} [options]
 * @param {boolean} [options.ordered=true] - Whether the list shows the open
 *   order. A sorted list has no slots: a Thing still opens (at the end of the
 *   open order, shown wherever the sort puts it), a moved web stays put.
 * @param {number} [options.columns=1] - Cards per row. In a grid the slot is
 *   found in reading order, across a row before down to the next.
 */
export function useOpenWebsDrop(listRef, { ordered = true, columns = 1 } = {}) {
  const moveGraphTabBefore = useGraphStore(s => s.moveGraphTabBefore);
  const openThingWebBefore = useGraphStore(s => s.openThingWebBefore);

  // Mirrored in a ref so the slot-crossing detent fires from the event, not
  // from a state updater StrictMode would run twice.
  const [slot, setSlotState] = useState(null);
  const slotRef = useRef(null);
  // The dragged item while it is over the list, so the slot can follow rows
  // scrolling under a pointer that has stopped moving (touch sends no hovers
  // while the finger is still). Null once the drag is past the list's edge:
  // the scroll carries on there, but a drop wouldn't land, so no ghost.
  const overItemRef = useRef(null);
  // Where the pointer last hovered the list, for the same reason: a wheel
  // scroll moves the rows under it without a hover.
  const lastHoverRef = useRef(null);

  const setSlot = useCallback((next) => {
    if (slotRef.current === next) return;
    if (slotRef.current !== null && next !== null) haptic('headerScroll');
    slotRef.current = next;
    setSlotState(next);
  }, []);

  /**
   * The first row whose midpoint the pointer hasn't passed, or HOME_SLOT where
   * the drop would change nothing. A web being moved is not a slot of its own: the
   * gaps either side of it are the place it already holds, so no ghost stands
   * beside the faded original. The ghost is not a row either.
   */
  const slotAt = useCallback((clientX, clientY, item) => {
    const movingId = isOpenWebDrag(item) ? item.graphId : null;
    if (!ordered) return movingId ? HOME_SLOT : DROP_AT_END;
    const list = listRef.current;
    if (!list) return DROP_AT_END;
    const rows = Array.from(list.querySelectorAll(':scope > [data-graph-id]'));
    const ids = rows.map(el => el.getAttribute('data-graph-id'));
    let found = DROP_AT_END;
    for (let i = 0; i < rows.length; i += 1) {
      if (ids[i] === movingId) continue;
      const rect = rows[i].getBoundingClientRect();
      // One column: in front of the first card whose midpoint is below the
      // pointer. A grid: the first card on a lower row, or on the pointer's
      // row with its midpoint to the right.
      const before = columns > 1
        ? clientY < rect.top || (clientY <= rect.bottom && clientX < (rect.left + rect.right) / 2)
        : clientY < (rect.top + rect.bottom) / 2;
      if (before) { found = ids[i]; break; }
    }
    if (movingId) {
      const at = ids.indexOf(movingId);
      const home = at === -1 ? undefined : (ids[at + 1] ?? DROP_AT_END);
      if (found === home) return HOME_SLOT;
    }
    return found;
  }, [listRef, ordered, columns]);

  // Scrolls the panel when a drag is held at its top or bottom, and keeps
  // scrolling past them (over the panel's tabs, below the window) for as long
  // as the drag stays in the panel's column.
  //
  // Quicker and reaching further in than the shared default: an open row is
  // ~245px tall, so the header strip's pace and narrow zones crawl here. Each
  // zone is a fifth of the panel's height (80-160px) inside the edge, plus the
  // reach past it. It still rises from rest every time it starts.
  const edgeScroll = useEdgeAutoScroll({
    axis: 'y',
    zones: ({ lo, hi }) => {
      const inside = Math.max(80, Math.min(160, (hi - lo) * 0.2));
      return { start: { inside, outside: 64 }, end: { inside, outside: 56 } };
    },
    maxSpeed: 1200,
    accel: 1500,
    decel: 7000,
    getElement: () => listRef.current?.closest('.panel-content') || null,
    // Stands in for the panel's own thumb while the drag scrolls it (Panel.css
    // steps that one aside), in the panel's text colour so it reads in both themes.
    indicator: {
      color: () => getTheme(useGraphStore.getState().darkMode).canvas.textPrimary,
      thickness: 6,
    },
    onScroll: (y) => {
      if (overItemRef.current) setSlot(slotAt(lastHoverRef.current?.x ?? 0, y, overItemRef.current));
    },
  });
  const stopAutoScroll = edgeScroll.stop;

  // The wheel (or a trackpad) scrolling the list mid-drag: the rows move under
  // a pointer that hasn't, so the slot is measured again, and the thumb shows
  // as it does for the drag's own scroll.
  useEffect(() => {
    const scroller = listRef.current?.closest('.panel-content');
    if (!scroller) return undefined;
    const onScroll = () => {
      const item = overItemRef.current;
      const at = lastHoverRef.current;
      if (!item || !at) return;
      setSlot(slotAt(at.x, at.y, item));
      edgeScroll.indicate();
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [listRef, edgeScroll, setSlot, slotAt]);

  const [{ dropItem }, drop] = useDrop(() => ({
    accept: SPAWNABLE_NODE,
    canDrop: (item) => isOpenWebDrag(item) || !!describeDropGhost(item),
    hover: (item, monitor) => {
      if (!monitor.canDrop()) return;
      const offset = monitor.getClientOffset();
      if (!offset) return;
      overItemRef.current = item;
      lastHoverRef.current = offset;
      edgeScroll.update(offset);
      setSlot(slotAt(offset.x, offset.y, item));
    },
    drop: (item, monitor) => {
      stopAutoScroll();
      overItemRef.current = null;
      // The slot the ghost was showing when they let go — what they saw.
      const offset = monitor.getClientOffset();
      const target = slotRef.current ?? (offset ? slotAt(offset.x, offset.y, item) : DROP_AT_END);
      setSlot(null);
      const before = target === DROP_AT_END ? null : target;
      if (isOpenWebDrag(item)) {
        // Let go where it already was: nothing moves, but the drop is still
        // claimed so nothing downstream reads it as a spawn.
        if (target === HOME_SLOT) return { reordered: false };
        haptic('nodeDrop', { force: true });
        moveGraphTabBefore(item.graphId, before);
        return { reordered: true };
      }
      const prototypeId = resolveDroppedPrototypeId(item);
      if (!prototypeId) return undefined;
      haptic('nodeDrop', { force: true });
      return { openedWebId: openThingWebBefore(prototypeId, before) };
    },
    collect: (monitor) => ({
      dropItem: monitor.isOver() && monitor.canDrop() ? monitor.getItem() : null,
    }),
  }), [slotAt, setSlot, edgeScroll, stopAutoScroll, moveGraphTabBefore, openThingWebBefore]);

  // Leaving the list takes the ghost with it — react-dnd fires no "leave" of
  // its own. Not the scroll: past the top or bottom is where it has to keep
  // going, and it stops itself when the drag leaves the column or ends.
  useEffect(() => {
    if (dropItem) return;
    overItemRef.current = null;
    setSlot(null);
  }, [dropItem, setSlot]);

  // No scroll anchoring while the ghost can exist. Anchoring holds the view
  // still when content above it changes, and the ghost moving to a new slot is
  // such a change: the view shifts, a different row is under the still
  // pointer, the ghost moves again, and the list leapt a row a frame to its
  // end. Set on the element directly: React leaves a style it doesn't manage.
  useEffect(() => {
    if (!dropItem) return undefined;
    const scroller = listRef.current?.closest('.panel-content');
    if (!scroller) return undefined;
    scroller.style.overflowAnchor = 'none';
    return () => { scroller.style.overflowAnchor = ''; };
  }, [dropItem, listRef]);

  return { drop, dropItem, slot: dropItem ? slot : null };
}
