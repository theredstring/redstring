import { useRef } from 'react';
import { PLUS_SIGN_SIZE } from '../../../constants';
import { clientToCanvas } from '../../../utils/canvas/viewportMath.js';

/** What the game controller can aim at and do, as refs it reads each frame: connection orbs, the plus sign, group title pills, the marquee, the canvas context menu (filled in later by NodeCanvas) and connection drawing (moved verbatim from NodeCanvas, wave 6). */
export function useControllerTargets({
  beginConnectionDrawFromNode, beginMarquee, canvasSize, containerRef, endMarquee,
  findConnectionOrbAtPoint, groupDepthByGroupIdRef, groupTitleRectsRef, groupsByIdRef,
  handlePlusSignClick, panOffsetRef, plusSign, selectedGroup, setAbstractionControlPanelShouldShow,
  setAbstractionControlPanelVisible, setConnectionControlPanelShouldShow,
  setConnectionControlPanelVisible, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow,
  setNodeControlPanelVisible, setPlusSign, setSelectedGroup, setSelectedInstanceIds,
  startGroupDragAtPointRef, startedOnNode, storeActions, textSettings, toggleConnectionOrbArrow,
  updateMarquee, zoomLevelRef,
}) {
  // A connection's endpoint orbs, as the controller sees them: what the
  // crosshair is standing on, and the one thing A does with it.
  //
  // Orbs only exist while their connection is hovered or selected, so this is
  // empty almost all of the time — which is what keeps a target this large from
  // shadowing the nodes it sits against. The padding is 1 (the disc as drawn):
  // the crosshair is a cursor, not a finger, and it has the auto-aim drift
  // pulling the orb under it besides.
  const connectionOrbControlRef = useRef(null);
  connectionOrbControlRef.current = {
    findAt: (clientX, clientY) => findConnectionOrbAtPoint(clientX, clientY, 1),
    toggle: (orb) => toggleConnectionOrbArrow(orb),
  };
  // The plus sign, as the controller sees it: where it is, how big its target
  // is, and the three things A and B can do to it. Bundled into one ref rather
  // than five because they are only ever used together, and because the hook
  // needs the CURRENT sign each frame — a captured value would go stale the
  // moment the sign appeared.
  const plusSignControlRef = useRef(null);
  plusSignControlRef.current = {
    // Only a settled plus sign is a target. One that is animating away, or
    // morphing into a node, is already committed to an outcome.
    sign: plusSign && plusSign.mode === 'appear' ? plusSign : null,
    // Half-extent of the hit square, in canvas units. Mirrors the invisible
    // rect PlusSign draws for touch (max(44, size)), so the controller's target
    // is the same size as everyone else's.
    halfHit: Math.max(44, PLUS_SIGN_SIZE * (textSettings?.plusSignScale ?? 1.0)) / 2,
    create: (clientX, clientY) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { x, y } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
      setPlusSign({ x, y, mode: 'appear', tempName: '' });
    },
    activate: () => handlePlusSignClick(),
    dismiss: () => {
      // Same guard the canvas click path uses: a morphing plus is committed.
      if (!plusSign || plusSign.mode === 'morph' || plusSign.mode === 'preparing' || plusSign.mode === 'landed') return;
      setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
    },
  };

  /**
   * Groups, as the controller sees them: what the crosshair is over, and the
   * three things it can do with one.
   *
   * A group's whole interactive surface is its title pill — that is what the
   * mouse clicks to select, double-clicks to rename, and long-presses to drag
   * the group by — so the pad aims at the same pill rather than at the box,
   * which would otherwise swallow every node inside it.
   */
  const groupControlRef = useRef(null);
  groupControlRef.current = {
    /**
     * The group whose title pill is under this point, with the pill's rect.
     *
     * Reads groupTitleRectsRef, which carries EVERY group — not
     * findGroupTitleAtPoint, whose map only ever held node-group anchors and so
     * made plain groups invisible to the pad. Deepest-first, because a nested
     * group's pill sits on top of its parent's shell and is the one drawn over
     * the point; findGroupTitleAtPoint's insertion-order scan would hand back
     * the parent.
     */
    findAt: (clientX, clientY) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const { x: canvasX, y: canvasY } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
      const depths = groupDepthByGroupIdRef.current;
      let best = null;
      let bestDepth = -Infinity;
      for (const [groupId, info] of groupTitleRectsRef.current.entries()) {
        if (canvasX < info.x || canvasX > info.x + info.width
          || canvasY < info.y || canvasY > info.y + info.height) continue;
        const depth = depths.get(groupId) ?? 0;
        if (depth < bestDepth) continue;
        bestDepth = depth;
        best = {
          groupId,
          anchorInstanceId: info.anchorInstanceId,
          // Canvas-space centre of the pill: where the auto-aim drift pulls to,
          // the same way a node drifts to its centre.
          center: { x: info.x + info.width / 2, y: info.y + info.height / 2 },
        };
      }
      return best;
    },
    /**
     * Select a group, exactly as a single click on its title does — including
     * clearing the node and edge selections. Those clears are not tidiness:
     * without them the Node and Connection panel effects see a stale selection
     * and stomp selectedGroup back to null in the same flush.
     */
    select: (groupId) => {
      const group = groupsByIdRef.current.get(groupId);
      if (!group) return false;
      setSelectedGroup(group);
      setSelectedInstanceIds(new Set());
      storeActions.setSelectedEdgeId(null);
      storeActions.clearSelectedEdgeIds();
      setGroupControlPanelShouldShow(true);
      setNodeControlPanelShouldShow(false);
      setNodeControlPanelVisible(false);
      setAbstractionControlPanelVisible(false);
      setAbstractionControlPanelShouldShow(false);
      setConnectionControlPanelVisible(false);
      setConnectionControlPanelShouldShow(false);
      return true;
    },
    dismiss: () => setSelectedGroup(null),
    /** Whether a group is selected right now — the pad re-derives its mode from this. */
    selectedId: () => selectedGroup?.id ?? null,
    startDrag: (groupId, clientX, clientY) => startGroupDragAtPointRef.current?.(groupId, clientX, clientY) === true,
  };

  /**
   * The selection box, as the controller draws it.
   *
   * A mouse marquee is a pointer travelling across a still canvas. A pad's is
   * the opposite — the crosshair is nailed to the middle of the screen and the
   * CANVAS travels underneath it — but the rectangle itself is in canvas
   * coordinates either way, so anchoring one corner and tracking the crosshair
   * with the other produces the same box from the opposite motion.
   */
  const marqueeControlRef = useRef(null);
  marqueeControlRef.current = {
    begin: (clientX, clientY) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return false;
      const { x, y } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
      beginMarquee(x, y);
      return true;
    },
    /**
     * Called every frame the box is live, from inside the controller's rAF
     * tick. Same path as the mouse: the box is written to the DOM at once and
     * the selection follows at most a frame later.
     */
    update: (clientX, clientY) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { x, y } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
      updateMarquee(x, y);
    },
    /**
     * Ends the box and reports how many instances it leaves selected, as
     * endMarquee computed them.
     */
    end: () => endMarquee().size,
  };

  /**
   * The canvas context menu, as the controller raises it.
   *
   * Declared here and FILLED IN further down, after getCanvasContextMenuOptions
   * exists — the options are assembled from clipboard contents and feature
   * flags that are themselves derived below this point, and the controller only
   * ever calls through the ref from inside its own tick, long after the render
   * that populates it.
   */
  const canvasContextMenuControlRef = useRef(null);

  const startConnectionFromNodeRef = useRef(null);
  startConnectionFromNodeRef.current = (instanceId, clientX, clientY) => {
    startedOnNode.current = true;
    return beginConnectionDrawFromNode(instanceId, clientX, clientY);
  };

  return { connectionOrbControlRef, plusSignControlRef, groupControlRef, marqueeControlRef, canvasContextMenuControlRef, startConnectionFromNodeRef };
}
