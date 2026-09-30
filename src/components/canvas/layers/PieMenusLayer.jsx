/**
 * The node pie and the edge pie, drawn under the active node (moved verbatim
 * from NodeCanvas). Both menus are memoized (P5.03).
 */
import { Profiler, memo, useCallback, useRef } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import NodePieMenuLayer from './NodePieMenuLayer.jsx';
import PieMenu from '../../../PieMenu.jsx';

// The edge pie, memoized like the node pie (P5.03): its props are the anchor and
// button list (memoized upstream), primitives and stable callbacks.
const EdgePieMenu = memo(PieMenu);

export default function PieMenusLayer({ ctx }) {
  const {
    isPieMenuRendered, hasPieMenuData, textSettings, carouselFocusedNode, abstractionCarouselVisible,
    previewingNodeId, selectedNodeIdForPieMenu, nodePieMenuPages, pieMenuPage, setPieMenuPage, gamepadMode,
    gamepadPieFocusedIndex, currentPieMenuNodeId, semanticOrbitActive, isTransitioningPieMenu,
    abstractionPrompt, carouselAnimationState, draggingNodeInfo, handlePieMenuHoverChange,
    handlePieExitComplete, selectedEdgeMidpoint, edgePieMenuAnchorRef, edgePieMenuButtons,
    edgePieMenuButtonsRef, edgePieMenuRendered, edgePieMenuVisible, setEdgePieMenuRendered, placedLabelsRef,
  } = ctx;

  const placedAnchorRef = useRef(null);

  // Stable, so the memoized edge menu isn't re-rendered for a new closure; the
  // refs and the setter it touches never change.
  const handleEdgePieExitComplete = useCallback(() => {
    edgePieMenuAnchorRef.current = null;
    edgePieMenuButtonsRef.current = null;
    setEdgePieMenuRendered(false);
  }, [edgePieMenuAnchorRef, edgePieMenuButtonsRef, setEdgePieMenuRendered]);

  return (
    <Profiler id="PieMenusLayer" onRender={onRenderProbe}>
      {/* Render The PieMenu next (it will be visually under the active node) */}
      {isPieMenuRendered && hasPieMenuData && (
        <NodePieMenuLayer
          nodeScale={textSettings?.nodeScale ?? 1.0}
          focusedNode={carouselFocusedNode}
          pageCount={/* Counted off nodePieMenuPages rather than written down here, so
                        adding a page to that list grows the chevrons' range on its own.
                        Carousel and decomposition build their own single-page sets. */
            (!abstractionCarouselVisible && !(previewingNodeId && previewingNodeId === selectedNodeIdForPieMenu)) ? nodePieMenuPages.length : 1}
          currentPage={pieMenuPage}
          onPageChange={setPieMenuPage}
          focusedButtonIndex={gamepadMode === 'node' ? gamepadPieFocusedIndex : -1}
          isVisible={(
            currentPieMenuNodeId === selectedNodeIdForPieMenu &&
            // Orbit owns the screen while it is up. Hiding via
            // isVisible (rather than clearing the target) keeps
            // the menu mounted and its page intact, so leaving
            // orbit animates it back exactly where it was.
            !semanticOrbitActive &&
            (!isTransitioningPieMenu || abstractionPrompt.visible || carouselAnimationState === 'exiting') &&
            !(draggingNodeInfo &&
              (draggingNodeInfo.primaryId === selectedNodeIdForPieMenu || draggingNodeInfo.instanceId === selectedNodeIdForPieMenu)
            )
          )}
          onHoverChange={handlePieMenuHoverChange}
          onExitAnimationComplete={handlePieExitComplete}
        />
      )}

      {/* Edge pie menu — rendered inline at the edge midpoint */}
      {(() => {
        // Live midpoint wins whenever there is one; the frozen ref only stands in
        // once the edge is deselected, which is the case it exists for — the
        // bubbles have to finish shrinking where they were.
        //
        // Same reasoning as frozenButtons below, and for the same reason: the
        // effect that maintains this ref writes it AFTER the render that changed
        // the selection, and a ref write re-renders nothing. Reading the ref first
        // therefore pinned the menu to the previous connection until an unrelated
        // render came along — the visible stall when clicking from one connection
        // straight to another. The glide to the new midpoint is a CSS transition on
        // the bubbles (see PieMenu's line mode), so it plays either way; this only
        // decides whether it starts now or whenever something else happens to render.
        const liveAnchor = selectedEdgeMidpoint || edgePieMenuAnchorRef.current;
        // The label the connection actually drew wins over the geometric middle:
        // routed labels slide along the route to dodge nodes and each other (and
        // sit clear of group outlines), so the plain midpoint can land beside the
        // label rather than on it. The edge layer registers the drawn position
        // before this layer renders; connections that don't register one keep the
        // computed anchor.
        const placedPos = liveAnchor?.edgeId ? placedLabelsRef?.current?.get(liveAnchor.edgeId)?.position : null;
        let anchor = liveAnchor;
        if (placedPos && Number.isFinite(placedPos.x) && Number.isFinite(placedPos.y)) {
          let deg = (((placedPos.angle || 0) % 180) + 180) % 180;
          if (deg > 90) deg -= 180;
          const next = { ...liveAnchor, x: placedPos.x, y: placedPos.y, angle: deg * (Math.PI / 180) };
          // Same values, same object: EdgePieMenu is memoized on the anchor's identity.
          const prev = placedAnchorRef.current;
          const same = prev && prev.edgeId === next.edgeId && prev.x === next.x && prev.y === next.y
            && prev.angle === next.angle && prev.sourceId === next.sourceId && prev.destinationId === next.destinationId;
          if (!same) placedAnchorRef.current = next;
          anchor = placedAnchorRef.current;
        }
        // Live buttons win whenever there are any; the frozen ref only stands in once
        // the list empties out, which is exactly the case it exists for — the edge is
        // deselected while the menu is still animating away, and the bubbles have to
        // finish shrinking on the set they were showing.
        //
        // Deliberately not the other way round: this list changes under an open menu
        // (Copy makes Paste available, pasting a definition makes Palette and Copy
        // available), and a ref write re-renders nothing — so preferring the ref would
        // pin the menu to whatever it had when it opened until some unrelated render
        // happened to come along.
        const frozenButtons = edgePieMenuButtons.length > 0
          ? edgePieMenuButtons
          : edgePieMenuButtonsRef.current;
        if (!edgePieMenuRendered || !anchor || !frozenButtons || frozenButtons.length === 0) return null;

        // Hide (outro) while a node this edge is attached to is being dragged —
        // mirrors the node's own PieMenu (isVisible gated on draggingNodeInfo above).
        // The anchor position is frozen mid-drag (nodeById doesn't update during
        // DOM-bypass drag), so without this the menu would float detached from the
        // connection until it snaps to the new spot on drop.
        const draggedNodeIds = !draggingNodeInfo ? null
          : draggingNodeInfo.instanceId ? new Set([draggingNodeInfo.instanceId])
          : draggingNodeInfo.primaryId ? new Set([draggingNodeInfo.primaryId, ...Object.keys(draggingNodeInfo.relativeOffsets || {})])
          : (draggingNodeInfo.groupId && draggingNodeInfo.memberOffsets) ? new Set(draggingNodeInfo.memberOffsets.map(m => m.id))
          : null;
        const edgeAttachedToDraggedNode = Boolean(draggedNodeIds && (draggedNodeIds.has(anchor.sourceId) || draggedNodeIds.has(anchor.destinationId)));

        // No compact/"..." fallback: focusEdgePieMenuInView (see the
        // focus-on-select effect) zooms the view to the menu's own bounds
        // whenever the row wouldn't fit, so the full row is always reachable.
        const displayButtons = frozenButtons;

        return (
          <EdgePieMenu
            anchor={anchor}
            anchorAngle={anchor.angle ?? 0}
            buttons={displayButtons}
            focusedButtonIndex={gamepadMode === 'edge' ? gamepadPieFocusedIndex : -1}
            nodeScale={textSettings?.nodeScale ?? 1.0}
            isVisible={edgePieMenuVisible && !edgeAttachedToDraggedNode}
            onHoverChange={handlePieMenuHoverChange}
            onExitAnimationComplete={handleEdgePieExitComplete}
          />
        );
      })()}

    </Profiler>
  );
}
