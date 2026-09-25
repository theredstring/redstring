/**
 * Group title and node-group shell input (P3.04). These were inline arrows in
 * NodeCanvas's groups pass, rebuilt on every render; they are one stable set
 * now, so the group elements can be memoized. Each handler reads NodeCanvas's
 * latest committed values from `ctxRef` when it fires (the useGamepad
 * control-object pattern), and takes the group it belongs to as `entry`:
 * `{ group, members, isNodeGroup, effectiveGroupName }`.
 *
 * The bodies are the inline handlers, moved verbatim.
 */
import { clientToCanvas } from '../../../utils/canvas/viewportMath.js';
import { placeholderIdForGroup } from '../../../services/groupLayout.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';

/** @param {{ current: object }} ctxRef */
export function createGroupInputHandlers(ctxRef) {
  return {
    titleClick(e, entry) {
      const { group, effectiveGroupName } = entry;
      const { wasDraggingRef, mouseMoved, isDoublePress, setEditingGroupId, setTempGroupName, setSelectedGroup, setSelectedInstanceIds, storeActions, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow, setNodeControlPanelVisible, setAbstractionControlPanelVisible, setAbstractionControlPanelShouldShow, setConnectionControlPanelVisible, setConnectionControlPanelShouldShow } = ctxRef.current;
      e.stopPropagation();
      if (wasDraggingRef.current || mouseMoved.current) return;
      // Same gate as a Thing's double-click, and it matters
      // more here: a node-group's title IS the Thing (drawn
      // without its pill), so clicking along a chain of them
      // at speed used to drop the last one into an inline
      // rename. See lastPressRef.
      if (isDoublePress(`group:${group.id}`, e.clientX, e.clientY, e.detail)) {
        setEditingGroupId(group.id);
        setTempGroupName(effectiveGroupName);
      } else {
        setSelectedGroup(group);
        // Clear node/edge selection so the Node/Connection Control Panel
        // effects don't see stale selections and stomp selectedGroup back
        // to null in the same effect flush (was causing the group panel to
        // "double open" and need two clicks to dismiss).
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
      }
    },

    titleMouseDown(e, entry) {
      const { group, isNodeGroup } = entry;
      const { editingGroupId, isMouseDown, mouseDownPosition, mouseMoved, mouseInsideNode, startedOnNode, setLongPressingInstanceId, groupLongPressTimeout, drawingConnectionFrom, startGroupDragAtPointRef, nodeLiftDelay } = ctxRef.current;
      e.stopPropagation();
      if (editingGroupId === group.id) return;
      if (isNodeGroup && group.anchorInstanceId) {
        isMouseDown.current = true;
        mouseDownPosition.current = { x: e.clientX, y: e.clientY };
        mouseMoved.current = false;
        mouseInsideNode.current = true;
        startedOnNode.current = true;
        setLongPressingInstanceId(group.anchorInstanceId);
      }
      clearTimeout(groupLongPressTimeout.current);
      const downX = e.clientX; const downY = e.clientY;
      groupLongPressTimeout.current = setTimeout(() => {
        if (drawingConnectionFrom) return;
        setLongPressingInstanceId(null);
        startGroupDragAtPointRef.current?.(group.id, downX, downY);
      }, nodeLiftDelay);
    },

    titleMouseUp(entry) {
      const { group, isNodeGroup } = entry;
      const { groupLongPressTimeout, setLongPressingInstanceId } = ctxRef.current;
      clearTimeout(groupLongPressTimeout.current);
      if (isNodeGroup && group.anchorInstanceId) setLongPressingInstanceId(null);
    },

    titleMouseLeave() {
      const { groupLongPressTimeout } = ctxRef.current;
      clearTimeout(groupLongPressTimeout.current);
    },

    titleTouchStart(e, entry) {
      const { group, members, isNodeGroup } = entry;
      const { isViewMoving, groupLongPressTimeout, groupTouchStartRef, touch, editingGroupId, mouseMoved, isMouseDown, mouseDownPosition, mouseInsideNode, startedOnNode, setLongPressingInstanceId, nodeDrag, TOUCH_MOVEMENT_THRESHOLD, handleMouseMove, handleMouseUp, groupTouchCleanupRef, drawingConnectionFrom, containerRef, panOffsetRef, zoomLevelRef, canvasSize, nodes, childGroupIdsByGroupIdRef, groupsByIdRef, nodeLiftDelay } = ctxRef.current;
      // Mirror onMouseDown for touch. Without this, touching a
      // group title only triggers canvas pan — the long-press
      // group-drag path never runs.
      //
      // Unless the view is moving: that finger is catching it, not
      // grabbing this title. Hand the gesture to the canvas pan
      // pipeline and drop the tap origin, so this gesture's
      // touchend can't read as a title tap (see
      // handleNodeTouchStart for the same rule on nodes).
      if (isViewMoving()) {
        clearTimeout(groupLongPressTimeout.current);
        groupTouchStartRef.current = null;
        touch.handleTouchStartCanvas(e, { claimed: true });
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      if (editingGroupId === group.id) return;
      if (!e.touches || e.touches.length !== 1) {
        // Multi-touch (pinch intent) — bail and let canvas handle it.
        clearTimeout(groupLongPressTimeout.current);
        return;
      }
      const firstTouch = e.touches[0];
      const downX = firstTouch.clientX;
      const downY = firstTouch.clientY;
      // Record the touch origin so onTouchEnd can distinguish a tap
      // (select the group) from a drag (move it).
      groupTouchStartRef.current = { groupId: group.id, downX, downY };
      // Reset unconditionally — a prior pan can leave mouseMoved
      // sticky-true, which would suppress the synthetic click's
      // selection bailout (`if (mouseMoved.current) return;`).
      mouseMoved.current = false;
      if (isNodeGroup && group.anchorInstanceId) {
        isMouseDown.current = true;
        mouseDownPosition.current = { x: downX, y: downY };
        mouseInsideNode.current = true;
        startedOnNode.current = true;
        setLongPressingInstanceId(group.anchorInstanceId);
      }
      clearTimeout(groupLongPressTimeout.current);

      // Document-level listeners so the drag survives the finger
      // leaving the title rect (it will, once dragging starts).
      const moveListener = (ev) => {
        const t = ev.touches?.[0];
        if (!t) return;
        if (ev.touches.length > 1) {
          // Second finger landed — abandon the group gesture.
          clearTimeout(groupLongPressTimeout.current);
          if (isNodeGroup && group.anchorInstanceId) setLongPressingInstanceId(null);
          cleanup();
          return;
        }
        // Cancel the long-press timer if finger moves past threshold
        // before the timer fires (matches mouseLeave behavior).
        if (!nodeDrag.draggingNodeInfoRef.current) {
          const dx = t.clientX - downX;
          const dy = t.clientY - downY;
          if (Math.hypot(dx, dy) > TOUCH_MOVEMENT_THRESHOLD) {
            clearTimeout(groupLongPressTimeout.current);
            if (isNodeGroup && group.anchorInstanceId) setLongPressingInstanceId(null);
          }
          return;
        }
        // Group drag is active — drive movement.
        handleMouseMove({
          clientX: t.clientX,
          clientY: t.clientY,
          preventDefault: () => { try { if (ev.cancelable) ev.preventDefault(); } catch { } },
          stopPropagation: () => { try { ev.stopPropagation(); } catch { } }
        });
      };
      const endListener = (ev) => {
        clearTimeout(groupLongPressTimeout.current);
        if (isNodeGroup && group.anchorInstanceId) setLongPressingInstanceId(null);
        const t = ev.changedTouches?.[0];
        const wasDragging = !!nodeDrag.draggingNodeInfoRef.current;
        cleanup();
        if (t && wasDragging) {
          handleMouseUp({
            clientX: t.clientX,
            clientY: t.clientY,
            changedTouches: ev.changedTouches,
            preventDefault: () => { try { if (ev.cancelable) ev.preventDefault(); } catch { } },
            stopPropagation: () => { try { ev.stopPropagation(); } catch { } }
          });
        }
        // A tap (no drag) is handled by the element-level onTouchEnd,
        // which runs before this and stopPropagation()s — so on a tap
        // this document listener typically won't fire at all. Selection
        // lives there so it can claim the tap from the canvas handler.
      };
      const cleanup = () => {
        try {
          document.removeEventListener('touchmove', moveListener);
          document.removeEventListener('touchend', endListener);
          document.removeEventListener('touchcancel', endListener);
        } catch { }
        groupTouchCleanupRef.current = null;
      };
      // Exposed so the element-level onTouchEnd can tear these down
      // itself — on a tap it stopPropagation()s, which prevents the
      // document-level endListener (the usual cleanup site) from firing.
      groupTouchCleanupRef.current = cleanup;
      document.addEventListener('touchmove', moveListener, { passive: true });
      document.addEventListener('touchend', endListener, { passive: true });
      document.addEventListener('touchcancel', endListener, { passive: true });

      groupLongPressTimeout.current = setTimeout(() => {
        if (drawingConnectionFrom) return;
        setLongPressingInstanceId(null);
        const rect = containerRef.current.getBoundingClientRect();
        const { x: mouseCanvasX, y: mouseCanvasY } = clientToCanvas(downX, downY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
        const offsets = members.map(m => ({ id: m.id, dx: mouseCanvasX - m.x, dy: mouseCanvasY - m.y }));
        if (group.anchorInstanceId) {
          const anchorNode = nodes.find(n => n.id === group.anchorInstanceId);
          if (anchorNode) {
            offsets.push({ id: anchorNode.id, dx: mouseCanvasX - anchorNode.x, dy: mouseCanvasY - anchorNode.y });
          }
        }
        // Empty node-group placeholder: track its own independent position
        // (never the anchor's) so it drags live using the exact same
        // offset-preserving math as a real member — see groupLayout.js for
        // why deriving it from the anchor's position doesn't work.
        if (isNodeGroup && !(group.memberInstanceIds?.length > 0) && group.emptyPlaceholderOrigin) {
          offsets.push({
            id: placeholderIdForGroup(group.id),
            dx: mouseCanvasX - group.emptyPlaceholderOrigin.x,
            dy: mouseCanvasY - group.emptyPlaceholderOrigin.y
          });
        }
        // Nested EMPTY child groups ride along too: their box position
        // lives in emptyPlaceholderOrigin (no member instance to move),
        // so without an explicit placeholder offset a parent drag would
        // leave their shells behind. Non-empty children need nothing —
        // their members are already in the parent's offset list.
        const nestedChildIds = childGroupIdsByGroupIdRef.current.get(group.id);
        if (nestedChildIds) {
          nestedChildIds.forEach(childId => {
            const childGroup = groupsByIdRef.current.get(childId);
            if (!childGroup || childGroup.memberInstanceIds?.length > 0 || !childGroup.emptyPlaceholderOrigin) return;
            offsets.push({
              id: placeholderIdForGroup(childId),
              dx: mouseCanvasX - childGroup.emptyPlaceholderOrigin.x,
              dy: mouseCanvasY - childGroup.emptyPlaceholderOrigin.y
            });
          });
        }
        // startGroupDrag fires the lift haptic itself.
        nodeDrag.startGroupDrag(group.id, offsets, downX, downY);
      }, nodeLiftDelay);
    },

    titleTouchEnd(e, entry) {
      const { group, isNodeGroup, effectiveGroupName } = entry;
      const { groupLongPressTimeout, setLongPressingInstanceId, nodeDrag, groupTouchStartRef, TOUCH_MOVEMENT_THRESHOLD, groupTouchCleanupRef, ignoreCanvasClick, editingGroupId, lastGroupTapRef, setEditingGroupId, setTempGroupName, setSelectedGroup, setSelectedInstanceIds, storeActions, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow, setNodeControlPanelVisible, setAbstractionControlPanelVisible, setAbstractionControlPanelShouldShow, setConnectionControlPanelVisible, setConnectionControlPanelShouldShow } = ctxRef.current;
      clearTimeout(groupLongPressTimeout.current);
      if (isNodeGroup && group.anchorInstanceId) setLongPressingInstanceId(null);

      const wasDragging = !!nodeDrag.draggingNodeInfoRef.current;
      const t = e.changedTouches?.[0];
      const start = groupTouchStartRef.current;
      // A tap = no group drag started and the finger barely moved.
      const isTap = !wasDragging && !!t && !!start && start.groupId === group.id &&
        Math.hypot(t.clientX - start.downX, t.clientY - start.downY) <= TOUCH_MOVEMENT_THRESHOLD;

      if (!isTap) return; // drag-end is handled by the document endListener

      // This tap belongs to the group title. Tear down our own
      // document listeners (the endListener won't fire once we
      // stopPropagation), claim the tap so the canvas touch handler
      // doesn't deselect us or spawn a plus sign, and stop the touch
      // from bubbling to that handler at all.
      groupTouchCleanupRef.current?.();
      ignoreCanvasClick.current = true;
      e.stopPropagation();
      // Without preventDefault, the browser follows this touchend with a
      // synthetic click at the same point, which re-hits the title's own
      // onClick below and double-selects the group (visible as the control
      // panel flickering / replaying its intro animation). Mirrors the
      // preventDefault call in handleNodeTouchEnd (useCanvasTouch.js).
      if (e.cancelable) e.preventDefault();

      if (editingGroupId === group.id) return;
      const now = Date.now();
      const last = lastGroupTapRef.current;
      if (last.id === group.id && (now - last.time) < 400) {
        // Double tap → inline rename (mirrors mouse dblclick).
        lastGroupTapRef.current = { id: null, time: 0 };
        setEditingGroupId(group.id);
        setTempGroupName(effectiveGroupName);
      } else {
        // Single tap → select (mirrors the mouse onClick path).
        lastGroupTapRef.current = { id: group.id, time: now };
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
      }
    },

    titleTouchCancel(entry) {
      const { group, isNodeGroup } = entry;
      const { groupLongPressTimeout, setLongPressingInstanceId, groupTouchStartRef } = ctxRef.current;
      clearTimeout(groupLongPressTimeout.current);
      if (isNodeGroup && group.anchorInstanceId) setLongPressingInstanceId(null);
      groupTouchStartRef.current = null;
    },

    renameChange(e) {
      const { setTempGroupName } = ctxRef.current;
      setTempGroupName(e.target.value);
    },

    renameKeyDown(e, entry) {
      const { group } = entry;
      const { tempGroupName, activeGraphId, storeActions, selectedGroup, setSelectedGroup, setEditingGroupId, setTempGroupName } = ctxRef.current;
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const newName = tempGroupName.trim();
        if (newName && activeGraphId) {
          storeActions.updateGroup(activeGraphId, group.id, (draft) => { draft.name = newName; });
          if (selectedGroup?.id === group.id) {
            setSelectedGroup(prev => prev ? { ...prev, name: newName } : null);
          }
        }
        setEditingGroupId(null);
      } else if (e.key === 'Escape') {
        setEditingGroupId(null);
        setTempGroupName('');
      }
    },

    renameBlur(entry) {
      const { group, effectiveGroupName } = entry;
      const { tempGroupName, activeGraphId, storeActions, selectedGroup, setSelectedGroup, setEditingGroupId } = ctxRef.current;
      const newName = tempGroupName.trim();
      if (newName && activeGraphId && newName !== effectiveGroupName) {
        storeActions.updateGroup(activeGraphId, group.id, (draft) => { draft.name = newName; });
        if (selectedGroup?.id === group.id) {
          setSelectedGroup(prev => prev ? { ...prev, name: newName } : null);
        }
      }
      setEditingGroupId(null);
    },

    innerCanvasClick(e) {
      const { draggingNodeInfo, drawingConnectionFrom, mouseMoved, nodeNamePrompt, activeGraphId, groupControlPanelShouldShow, groupControlPanelVisible, selectedGroup, setGroupControlPanelVisible, setSelectedGroup, abstractionCarouselVisible, selectedNodeIdForPieMenu, setAbstractionCarouselVisible, setAbstractionCarouselNode, setCarouselAnimationState, setCarouselPieMenuStage, setCarouselFocusedNode, setCarouselFocusedNodeDimensions, carouselAnimationState, selectedInstanceIds, justCompletedCarouselExit, carouselExitInProgressRef, setSelectedInstanceIds, selectedEdgeId, selectedEdgeIds, storeActions } = ctxRef.current;
      e.stopPropagation();
      if (draggingNodeInfo || drawingConnectionFrom || mouseMoved.current || nodeNamePrompt.visible || !activeGraphId) return;
      if (groupControlPanelShouldShow || groupControlPanelVisible || selectedGroup) {
        if (groupControlPanelShouldShow || groupControlPanelVisible) setGroupControlPanelVisible(false);
        if (selectedGroup) setSelectedGroup(null);
        return;
      }
      if (abstractionCarouselVisible && !selectedNodeIdForPieMenu) {
        setAbstractionCarouselVisible(false); setAbstractionCarouselNode(null);
        setCarouselAnimationState('hidden'); setCarouselPieMenuStage(1);
        setCarouselFocusedNode(null); setCarouselFocusedNodeDimensions(null);
        return;
      }
      if (abstractionCarouselVisible && carouselAnimationState === 'exiting') return;
      if (selectedInstanceIds.size > 0) {
        if (justCompletedCarouselExit || carouselExitInProgressRef.current) return;
        setSelectedInstanceIds(new Set()); return;
      }
      if ((selectedEdgeId || selectedEdgeIds.size > 0) && !useCanvasUIStore.getState().hoveredEdgeInfo) {
        storeActions.setSelectedEdgeId(null); storeActions.clearSelectedEdgeIds(); return;
      }
    },
  };
}
