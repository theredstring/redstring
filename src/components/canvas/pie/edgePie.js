/**
 * The connection (edge) pie menu's buttons and its open framing (P5.03).
 */
import { useEffect, useMemo, useRef } from 'react';
import { buildEdgePieMenuButtons } from './edgePieButtons.js';
import { openWizardPicker } from '../wizard/canvasWizard.js';
import { frameEdgePieOnOpen } from '../camera/framing.js';

/** The connection menu's buttons, rebuilt from the selection, and the copy frozen for its exit animation (moved verbatim from NodeCanvas, P5.03). */
export function useEdgePieButtons({
  clipboardRef, clipboardVersion, edgePieMenuButtonsRef, edgePieMenuVisible, edgesMap,
  markClipboardChanged, nodePrototypesMap, rightPanelExpanded, selectedEdgeId,
  setConnectionNamePrompt, setEdgePieMenuVisible, startHurtleAnimationFromPanel, storeActions,
  wizardEnabled,
}) {
  /**
   * The connection menu's buttons, in display order.
   *
   * One list, two consumers, exactly as nodePieMenuPages is: PieMenu draws it on
   * the canvas (wrapping it into rows once it outgrows one — see
   * utils/pieMenuLayout.js) and the bottom control panel renders the same
   * buttons in its own strip. The panel used to hand-transcribe a subset, which
   * is how the two drifted apart in the first place.
   *
   * Half of these come and go: Palette and Copy need a definition to act on,
   * Paste needs a clipboard that holds one. That's what makes the row's length a
   * layout problem rather than a constant.
   */
  const edgePieMenuButtons = useMemo(() => buildEdgePieMenuButtons({
    clipboardRef, edgesMap, markClipboardChanged, nodePrototypesMap, openWizardPicker,
    rightPanelExpanded, selectedEdgeId, setConnectionNamePrompt, setEdgePieMenuVisible, startHurtleAnimationFromPanel, storeActions,
    wizardEnabled,
  }), [selectedEdgeId, edgesMap, nodePrototypesMap, wizardEnabled, storeActions, startHurtleAnimationFromPanel, rightPanelExpanded, clipboardRef, clipboardVersion, markClipboardChanged]);

  // Freeze edge pie menu buttons when visible so they survive edge deselection during exit animation
  useEffect(() => {
    if (edgePieMenuVisible && edgePieMenuButtons.length > 0) {
      edgePieMenuButtonsRef.current = edgePieMenuButtons;
    }
  }, [edgePieMenuVisible, edgePieMenuButtons]);

  return { edgePieMenuButtons };
}

/** Frames a connection's menu when it first opens (moved verbatim from NodeCanvas, P5.03). */
export function useEdgePieFraming({
  abstractionCarouselVisible, connectionLabelSize, draggingNodeInfoRef, edgePieMenuButtons,
  edgePieMenuVisible, edgePrototypesMap, edgesMap, focusEdgePieMenuInView, focusOnSelectEnabled,
  nodePrototypesMap, placedLabelsRef, selectedEdgeId, selectedEdgeMidpoint, showConnectionNames,
  textSettings,
}) {
  // Focus-on-select for connections: when an edge's pie menu first appears, frame it
  // the same way selecting a node frames its menu. Only on a fresh show (new edge),
  // never on re-renders while the same menu is up — otherwise every button press or
  // pan would re-yank the view. Mid-drag is skipped: the anchor is frozen then, and
  // the menu is outroing anyway.
  const prevFocusPieEdgeIdRef = useRef(null);
  useEffect(() => frameEdgePieOnOpen({
    prevFocusPieEdgeIdRef, edgePieMenuVisible, selectedEdgeId, focusOnSelectEnabled,
    abstractionCarouselVisible, draggingNodeInfoRef, selectedEdgeMidpoint, edgePieMenuButtons,
    showConnectionNames, placedLabelsRef, edgesMap, nodePrototypesMap, edgePrototypesMap, textSettings,
    connectionLabelSize, focusEdgePieMenuInView,
  }), [edgePieMenuVisible, selectedEdgeId, selectedEdgeMidpoint, edgePieMenuButtons, abstractionCarouselVisible, focusEdgePieMenuInView, focusOnSelectEnabled, showConnectionNames, edgesMap, nodePrototypesMap, edgePrototypesMap, textSettings, connectionLabelSize]);

}
