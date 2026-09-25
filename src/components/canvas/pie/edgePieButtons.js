/**
 * The edge pie menu's buttons (P5.01), moved verbatim from NodeCanvas's memo.
 * See nodePieButtons.js.
 */
import { ArrowUpFromDot, ClipboardCopy, ClipboardPaste, Edit3, NotebookText, Palette, Sparkles, Trash2 } from 'lucide-react';
import { CONNECTION_DEFAULT_COLOR } from '../../../constants';
import { SURFACES as WIZARD_SURFACES } from '../../../wizard/prompts/intents.js';
import { applyConnectionClipboard, copyEdgeDefinition, readConnectionClipboard } from '../../../utils/clipboard.js';
import { connectionFacts } from '../../../wizard/prompts/facts.js';
import useGraphStore from '../../../store/graphStore.js';
import { toggleEdgeColorPicker } from '../colorPickers/colorPickers.js';

export function buildEdgePieMenuButtons(ctx) {
  const {
    clipboardRef, edgesMap, markClipboardChanged, nodePrototypesMap, openWizardPicker,
    rightPanelExpanded, selectedEdgeId, setConnectionNamePrompt, setEdgePieMenuVisible, startHurtleAnimationFromPanel, storeActions,
    wizardEnabled,
  } = ctx;
  const edge = edgesMap.get(selectedEdgeId);
  if (!edge) return [];

  const getDefinitionNodeId = () => {
    if (edge.definitionNodeIds?.length > 0) return edge.definitionNodeIds[0];
    return edge.typeNodeId || null;
  };

  // The prototype a Palette press would recolour. A connection nobody has
  // defined yet points at the built-in base connection, which lives in
  // edgePrototypes and renders black for every undefined connection there is —
  // not something one connection's menu gets to change. Define it first.
  const definitionPrototypeId = (() => {
    const id = getDefinitionNodeId();
    return id && nodePrototypesMap.has(id) ? id : null;
  })();

  // What (if anything) the clipboard can hand this connection. Recomputed on
  // clipboardVersion, which every write to clipboardRef bumps.
  const pastePayload = readConnectionClipboard(clipboardRef.current, nodePrototypesMap);

  const buttons = [
    {
      id: 'edge-delete',
      label: 'Delete',
      icon: Trash2,
      action: () => {
        storeActions.removeEdge(edge.id);
        storeActions.setSelectedEdgeId(null);
        // Also clears the multi-select set: this same button is what the bottom
        // control panel presses, and there a stale id would keep the panel up
        // pointing at a connection that no longer exists.
        storeActions.setSelectedEdgeIds(new Set());
        setEdgePieMenuVisible(false);
      },
    },
    {
      id: 'edge-add',
      label: 'Define',
      icon: Edit3,
      action: () => {
        setEdgePieMenuVisible(false);
        setConnectionNamePrompt({ visible: true, name: '', color: CONNECTION_DEFAULT_COLOR, edgeId: edge.id });
      },
    },
  ];

  if (definitionPrototypeId) {
    buttons.push({
      id: 'edge-palette',
      label: 'Palette',
      icon: Palette,
      action: (_edgeId, buttonPosition) => {
        toggleEdgeColorPicker(definitionPrototypeId, buttonPosition);
      },
    });
  }

  buttons.push(
    {
      id: 'edge-open-def',
      label: 'Open Definition',
      icon: ArrowUpFromDot,
      action: () => {
        const defNodeId = getDefinitionNodeId();
        if (!defNodeId) return;
        const prototype = nodePrototypesMap.get(defNodeId);
        const mockRect = { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 40, height: 40 };
        if (prototype?.definitionGraphIds?.length > 0) {
          startHurtleAnimationFromPanel(defNodeId, prototype.definitionGraphIds[0], defNodeId, mockRect);
        } else {
          const { createAndAssignGraphDefinitionWithoutActivation } = useGraphStore.getState();
          createAndAssignGraphDefinitionWithoutActivation(defNodeId);
          setTimeout(() => {
            const updated = useGraphStore.getState().nodePrototypes.get(defNodeId);
            if (updated?.definitionGraphIds?.length > 0) {
              startHurtleAnimationFromPanel(defNodeId, updated.definitionGraphIds[updated.definitionGraphIds.length - 1], defNodeId, mockRect);
            }
          }, 50);
        }
        setEdgePieMenuVisible(false);
      },
    },
    {
      id: 'edge-open-panel',
      label: 'Open in Panel',
      icon: NotebookText,
      action: () => {
        const defNodeId = getDefinitionNodeId();
        if (defNodeId) {
          const prototype = nodePrototypesMap.get(defNodeId);
          storeActions.openRightPanelNodeTab(defNodeId, prototype?.name || 'Connection');
          if (!rightPanelExpanded) storeActions.setRightPanelExpanded(true);
        }
        setEdgePieMenuVisible(false);
      },
    }
  );

  if (definitionPrototypeId) {
    buttons.push({
      id: 'edge-copy',
      label: 'Copy',
      icon: ClipboardCopy,
      action: () => {
        // Copies what the connection MEANS, not the connection — an edge away
        // from its two endpoints is nothing. Same payload as Cmd/Ctrl+C on a
        // selected connection, so both fill one clipboard.
        const copied = copyEdgeDefinition(edge);
        if (!copied) return;
        clipboardRef.current = copied;
        markClipboardChanged();
      },
    });
  }

  if (pastePayload) {
    buttons.push({
      id: 'edge-paste',
      label: `Paste ${pastePayload.name.length > 22 ? 'Definition' : pastePayload.name}`,
      icon: ClipboardPaste,
      action: () => {
        applyConnectionClipboard(pastePayload, [edge.id], storeActions);
      },
    });
  }

  if (wizardEnabled) {
    buttons.push({
      id: 'edge-wizard',
      label: 'Ask The Wizard',
      icon: Sparkles,
      action: () => {
        openWizardPicker(WIZARD_SURFACES.CONNECTION, { edges: [edge] }, {
          facts: connectionFacts([edge]),
          subjectLabel: 'this Connection'
        });
        setEdgePieMenuVisible(false);
      },
    });
  }

  return buttons;
}
