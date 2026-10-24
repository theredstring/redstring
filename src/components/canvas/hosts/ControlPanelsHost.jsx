/**
 * The bottom control panels (P5.05a): node, group, connection and abstraction,
 * with the effects that decide which one shows. Both moved verbatim from
 * NodeCanvas. The host subscribes to what those effects react to (selection,
 * edge selection, carousel, prompts, orbit, marquee, preview, the panel
 * settings and the latches in canvasUIStore). Since P5.05b the panels' action
 * handlers and the exit-animation latches live here too; NodeCanvas passes the
 * canvas values and setters they need as `ctx`.
 */
import { Profiler, useCallback, useMemo, useRef } from 'react';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import useGraphStore from '../../../store/graphStore.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import NodeControlPanel from '../../../NodeControlPanel.jsx';
import UnifiedBottomControlPanel from '../../../UnifiedBottomControlPanel.jsx';
import ConnectionControlPanel from '../../../ConnectionControlPanel.jsx';
import AbstractionControlPanel from '../../../AbstractionControlPanel.jsx';
import { useEffect } from 'react';
import { CONNECTION_DEFAULT_COLOR } from '../../../constants';
import { SURFACES as WIZARD_SURFACES } from '../../../wizard/prompts/intents.js';
import { connectionFacts } from '../../../wizard/prompts/facts.js';
import { NODE_DEFAULT_COLOR, nextNodeSizeStep, nodeSizeLabel } from '../../../constants';
import { getActionHoverItem } from '../../../utils/canvas/actionHover.js';
import { useControlPanelActions } from '../../../hooks/useControlPanelActions.js';
import { copySelection, pasteClipboard } from '../../../utils/clipboard.js';
import { getNodeDimensions, getDefinitionDescription } from '../../../utils.js';
import { diveIntoNodeGroupDefinition } from '../actions/nodeGroupDive.js';
import { openGroupColorPicker, togglePieMenuColorPicker } from '../colorPickers/colorPickers.js';
import { requestDeleteDefinition } from '../dialogs/deleteDefinition.js';
import { expandNodeInPlace } from '../actions/expandInPlace.js';
import { withBoxCloseMorph } from '../groups/boxMorph.js';
import { projectGraphView } from '../../../core/openDefinitions.js';
import FormatPanelPreview from '../formats/FormatPanelPreview.jsx';
import { deleteFormula } from '../formats/formula/deleteFormula.js';
import { condenseFormula } from '../formats/formula/condenseFormula.js';
import { deleteNodeGroup } from '../groups/deleteNodeGroup.js';
import { useGroupFormulaText, groupFormats, FORMAT_LABELS } from '../formats/groupFormats.js';
import useFormatsStore, { showFormatInPlace, showAsThings, setNotation, setFormulaNames, selectStandard } from '../formats/formatsStore.js';
import { Shapes, Sigma, Superscript, WholeWord } from 'lucide-react';
import { buildGroupPieButtons, setGroupPieButtons, reframeGroup } from '../pie/groupPieButtons.js';
import {
  onCarouselClose,
  changeAbstractionDimension as handleAbstractionDimensionChange, addAbstractionDimension as handleAddAbstractionDimension,
  deleteAbstractionDimension as handleDeleteAbstractionDimension, expandAbstractionDimension as handleExpandAbstractionDimension,
} from '../carousel/carouselActions.js';

export default function ControlPanelsHost({ ctx }) {
  const selectedInstanceIds = useCanvasUIStore((s) => s.selectedInstanceIds);
  const selectedEdgeId = useCanvasUIStore((s) => s.selectedEdgeId);
  const selectedEdgeIds = useCanvasUIStore((s) => s.selectedEdgeIds);
  const abstractionCarouselVisible = useCanvasUIStore((s) => s.abstractionCarouselVisible);
  const abstractionCarouselNode = useCanvasUIStore((s) => s.abstractionCarouselNode);
  const connectionNamePrompt = useCanvasUIStore((s) => s.connectionNamePrompt);
  const semanticOrbitActive = useCanvasUIStore((s) => s.semanticOrbitActive);
  const marqueeActive = useCanvasUIStore((s) => s.marqueeActive);
  const previewingNodeId = useCanvasUIStore((s) => s.previewingNodeId);
  const nodeControlPanelShouldShow = useCanvasUIStore((s) => s.nodeControlPanelShouldShow);
  const nodeControlPanelVisible = useCanvasUIStore((s) => s.nodeControlPanelVisible);
  const groupControlPanelShouldShow = useCanvasUIStore((s) => s.groupControlPanelShouldShow);
  const groupControlPanelVisible = useCanvasUIStore((s) => s.groupControlPanelVisible);
  const connectionControlPanelShouldShow = useCanvasUIStore((s) => s.connectionControlPanelShouldShow);
  const connectionControlPanelVisible = useCanvasUIStore((s) => s.connectionControlPanelVisible);
  const abstractionControlPanelShouldShow = useCanvasUIStore((s) => s.abstractionControlPanelShouldShow);
  const abstractionControlPanelVisible = useCanvasUIStore((s) => s.abstractionControlPanelVisible);
  const {
    setNodeControlPanelShouldShow, setNodeControlPanelVisible, setGroupControlPanelShouldShow, setGroupControlPanelVisible,
    setConnectionControlPanelShouldShow, setConnectionControlPanelVisible, setAbstractionControlPanelShouldShow,
    setAbstractionControlPanelVisible,
  } = useCanvasUIStore.getState();
  const setSelectedGroup = (group) => useCanvasUIStore.getState().setSelectedGroupId(group?.id ?? null);
  const showNodeControlPanel = useGraphStore((state) => state.showNodeControlPanel ?? false);
  const showMultipleNodesControlPanel = useGraphStore((state) => state.showMultipleNodesControlPanel ?? true);
  const showConnectionControlPanel = useGraphStore((state) => state.showConnectionControlPanel ?? true);
  const showGroupControlPanel = useGraphStore((state) => state.showGroupControlPanel ?? true);
  const showEquationControlPanel = useGraphStore((state) => state.showEquationControlPanel ?? true);
  const showAbstractionControlPanel = useGraphStore((state) => state.showAbstractionControlPanel ?? true);
  // The group the panel is about, read through to the active web so a rename or
  // recolour elsewhere shows up (P2.03b). Read as viewed: an open box's group
  // (`open:<anchorId>`) exists only in the projection, not the raw graph.
  const selectedGroupId = useCanvasUIStore((s) => s.selectedGroupId);
  const selectedGroup = useGraphStore((s) => (selectedGroupId ? projectGraphView(s, s.activeGraphId)?.groups?.get(selectedGroupId) ?? null : null));
  const {
    decomposePanelInfo, typeListVisible, storeActions, startHurtleAnimation, graphsMap, activeGraphId,
    setSelectedInstanceIds, nodePieMenuPages, singleSelectedInstanceId, handlePieMenuHoverChange, wizardEnabled,
    edgesMap, edgePieMenuButtons, setConnectionNamePrompt, startHurtleAnimationFromPanel, openWizardPicker,
    nodes, nodePrototypesMap, setNodeNamePrompt,
    setPreviewingNodeId, setAbstractionCarouselNode, setCarouselAnimationState, setAbstractionCarouselVisible,
    setSelectedNodeIdForPieMenu, rightPanelExpanded, setEditingNodeIdOnCanvas, captureDeletionGhosts, clipboardRef,
    markClipboardChanged, setEditingGroupId, setTempGroupName, setNodeGroupPrompt,
  } = ctx;

  // The carousel's axes (P5.04): canvasUIStore, handlers in carouselActions.js.
  const abstractionDimensions = useCanvasUIStore((s) => s.abstractionDimensions);
  const currentAbstractionDimension = useCanvasUIStore((s) => s.currentAbstractionDimension);
  const handleAbstractionControlPanelAnimationComplete = useCallback(() => {
    // This callback is only for the exit animation.
    // When it's called, we know it's safe to unmount the component.
    setAbstractionControlPanelShouldShow(false);
  }, []);

  // ---- Moved from NodeCanvas (P5.05b) ----
  // Preserve last selections during exit animations
  // Latched during render below (not an effect + store write, which cost a second
  // NodeCanvas render on every selection change): the node panel's exit animation.
  const lastSelectedNodePrototypesRef = useRef([]);
  // Snapshot for the exit animation (even of a just-deleted group); latched in render (P2.03).
  const lastSelectedGroupRef = useRef(null);
  if (selectedGroup) lastSelectedGroupRef.current = selectedGroup;
  const lastSelectedGroup = lastSelectedGroupRef.current;

  const handleNodeControlPanelAnimationComplete = useCallback(() => {
    setNodeControlPanelShouldShow(false);
    // Clear the last selected prototypes when animation completes
    lastSelectedNodePrototypesRef.current = [];
  }, [setNodeControlPanelShouldShow]);

  const handleConnectionControlPanelAnimationComplete = useCallback(() => {
    setConnectionControlPanelShouldShow(false);
  }, [setConnectionControlPanelShouldShow]);

  const handleGroupControlPanelAnimationComplete = useCallback(() => {
    setGroupControlPanelShouldShow(false);
    setGroupControlPanelVisible(false);
    lastSelectedGroupRef.current = null;
    setSelectedGroup(null);
  }, []);

  const selectedNodePrototypes = useMemo(() => {
    const list = [];
    if (!nodes || nodes.length === 0) return list;
    // A Map rather than a find per id: a marquee over a big web selects hundreds.
    const nodesById = new Map(nodes.map(n => [n.id, n]));
    selectedInstanceIds.forEach((instanceId) => {
      const inst = nodesById.get(instanceId);
      if (inst && inst.prototypeId) {
        const proto = nodePrototypesMap.get(inst.prototypeId);
        if (proto) list.push(proto);
      }
    });
    return list;
  }, [selectedInstanceIds, nodes, nodePrototypesMap]);

  if (selectedNodePrototypes.length > 0) lastSelectedNodePrototypesRef.current = selectedNodePrototypes;
  const lastSelectedNodePrototypes = lastSelectedNodePrototypesRef.current;

  // With nothing selected the panel is only mounted to fly out, so it keeps
  // showing the last selection rather than leaving empty.
  const nodePrototypesForPanel = selectedNodePrototypes.length > 0 ? selectedNodePrototypes : lastSelectedNodePrototypes;

  // The selected connections that still exist. A selection can outlive what it
  // names (a Thing deleted with its connections, an undo, a web switch); the
  // panels go by what is there, so one with nothing left in it leaves.
  const liveSelectedEdge = selectedEdgeId ? edgesMap.get(selectedEdgeId) : undefined;
  const liveSelectedEdges = useMemo(
    () => Array.from(selectedEdgeIds).map(id => edgesMap.get(id)).filter(Boolean),
    [selectedEdgeIds, edgesMap]
  );
  const liveNodeCount = selectedNodePrototypes.length;
  const liveEdgeSelected = Boolean(liveSelectedEdge) || liveSelectedEdges.length > 0;

  const groupPanelTarget = selectedGroup || lastSelectedGroup;
  // A group or Thing-group that reads as a formula of its own (an equation, not
  // a part in its parentheses) gets ◀ ▶ to swap how it is shown (formats/).
  // Shown as its formula, the panel is the format mode; shown as Things, an
  // equation is the Thing-group it is, with that panel (and the arrows).
  const groupFormulaText = useGroupFormulaText(groupPanelTarget?.id);
  const formatOrder = groupFormats(groupFormulaText);
  const currentFormat = groupPanelTarget?.format && formatOrder.includes(groupPanelTarget.format) ? groupPanelTarget.format : 'things';
  const isThingGroup = !!groupPanelTarget?.linkedNodePrototypeId;
  const groupPanelMode = groupFormulaText && !(currentFormat === 'things' && isThingGroup)
    ? "format"
    : (isThingGroup ? "nodegroup" : "group");
  const swapFormat = (step) => {
    if (!groupPanelTarget || !activeGraphId) return;
    const next = formatOrder[(formatOrder.indexOf(currentFormat) + step + formatOrder.length) % formatOrder.length];
    if (next === currentFormat) return;
    reframeGroup(groupPanelTarget.id);
    if (next === 'things') showAsThings(activeGraphId, groupPanelTarget.id);
    else showFormatInPlace({ source: 'group', sourceId: groupPanelTarget.id, graphId: activeGraphId, format: next });
  };
  // Standard math (mc²) or every operation written (m × c ^ 2): only offered
  // when the formula has an operation the two write differently.
  const standardNotation = useFormatsStore(selectStandard);
  const formulaNames = useFormatsStore((s) => !!groupPanelTarget && s.namesShown.has(groupPanelTarget.id));
  // By name or by symbol: the formula's width changes, so it is framed again.
  const showFormulaNames = (groupId, shown) => {
    reframeGroup(groupId);
    setFormulaNames(groupId, shown);
  };
  const formatToggles = currentFormat === 'formula'
    ? [
      // This formula's Things by their names (Pressure × Volume), or by their symbols (P V).
      {
        key: 'reading',
        icon: (size) => <WholeWord size={size} />,
        title: formulaNames ? 'Show Symbols' : 'Show Names',
        onClick: () => showFormulaNames(groupPanelTarget.id, !formulaNames),
      },
      ...(/[×^]/.test(groupFormulaText || '') ? [{
        key: 'notation',
        icon: (size) => <Superscript size={size} />,
        title: standardNotation ? 'Write Every Operation' : 'Standard Notation',
        onClick: () => setNotation(standardNotation ? 'explicit' : 'standard'),
      }] : []),
    ]
    : null;
  // Formula or Things: one button, first in the panel's row as in the group pie.
  const nextFormat = formatOrder[(formatOrder.indexOf(currentFormat) + 1) % formatOrder.length];
  const formatSwap = groupFormulaText && nextFormat !== currentFormat
    ? {
      icon: (size) => (nextFormat === 'things' ? <Shapes size={size} /> : <Sigma size={size} />),
      title: `Show as ${FORMAT_LABELS[nextFormat]}`,
      onClick: () => swapFormat(1),
    }
    : null;

  // Group control panel action handlers
  const handleGroupPanelUngroup = useCallback(() => {
    if (!activeGraphId || !selectedGroup) return;
    try {
      storeActions.deleteGroup(activeGraphId, selectedGroup.id);
      setSelectedGroup(null);
      setGroupControlPanelVisible(false);
    } catch (e) {

    }
  }, [activeGraphId, selectedGroup, storeActions.deleteGroup, setGroupControlPanelVisible]);

  // A formula's Delete: the equation, its Things and its parts, playing its exit.
  const handleFormulaDelete = useCallback(() => {
    if (!activeGraphId || !selectedGroup) return;
    deleteFormula(activeGraphId, selectedGroup.id);
    setSelectedGroup(null);
    setGroupControlPanelVisible(false);
  }, [activeGraphId, selectedGroup, setGroupControlPanelVisible]);

  // A formula's Combine Into Thing: saved into its Thing's definition, its band
  // folding into the node, which is left selected (as a Thing-group's Combine).
  const handleFormulaCondense = useCallback(() => {
    if (!activeGraphId || !selectedGroup) return;
    const nodeId = condenseFormula(activeGraphId, selectedGroup.id);
    setGroupControlPanelVisible(false);
    setSelectedGroup(null);
    if (nodeId) setSelectedInstanceIds(new Set([nodeId]));
  }, [activeGraphId, selectedGroup, setSelectedInstanceIds, setGroupControlPanelVisible, setSelectedGroup]);

  // A Thing-group's Delete: the group and its Things, shrinking away.
  const handleNodeGroupDelete = useCallback(() => {
    if (!activeGraphId || !selectedGroup) return;
    deleteNodeGroup(activeGraphId, selectedGroup.id, captureDeletionGhosts);
    setSelectedGroup(null);
    setGroupControlPanelVisible(false);
  }, [activeGraphId, selectedGroup, captureDeletionGhosts, setGroupControlPanelVisible]);

  const handleGroupPanelEdit = useCallback(() => {
    if (!selectedGroup) return;
    // Start inline editing; a node-group's prototype owns the name, so seed from it.
    const linkedPrototype = selectedGroup.linkedNodePrototypeId
      ? nodePrototypesMap.get(selectedGroup.linkedNodePrototypeId)
      : null;
    setEditingGroupId(selectedGroup.id);
    setTempGroupName(linkedPrototype?.name || selectedGroup.name || 'Group');
  }, [selectedGroup, nodePrototypesMap]);

  const handleGroupPanelColor = useCallback((e) => {
    if (!activeGraphId || !selectedGroup) return;
    openGroupColorPicker(selectedGroup.id, e);
  }, [activeGraphId, selectedGroup]);

  const handleGroupPanelConvertToNodeGroup = useCallback(() => {
    if (!activeGraphId || !selectedGroup) return;
    // Open UnifiedSelector in node-group-creation mode
    setNodeGroupPrompt({
      visible: true,
      name: selectedGroup.name || 'Group',
      color: selectedGroup.color || '#8B0000',
      groupId: selectedGroup.id
    });
  }, [activeGraphId, selectedGroup]);

  // Callback for activating semantic orbit from control panel
  const activateSemanticOrbit = useCallback(() => {
    useCanvasUIStore.getState().dispatchPie({ type: 'ORBIT', active: true, clearTarget: true });
    setNodeControlPanelVisible(false);
  }, []);

  // Use unified control panel actions hook (depends on startHurtleAnimationFromPanel above)
  const {
    handleNodePanelDelete,
    handleNodePanelAdd,
    handleNodePanelUp,
    handleNodePanelOpenInPanel,
    handleNodePanelDecompose,
    handleNodePanelAbstraction,
    handleNodePanelEdit,
    handleNodePanelSave,
    handleNodePanelOrbit,
    handleNodePanelPalette,
    handleNodePanelGroup
  } = useControlPanelActions({
    activeGraphId,
    selectedInstanceIds,
    selectedNodePrototypes,
    nodes,
    storeActions,
    setSelectedInstanceIds,
    setSelectedGroup,
    setGroupControlPanelShouldShow,
    setNodeControlPanelShouldShow,
    setNodeControlPanelVisible,
    setNodeNamePrompt,
    setPreviewingNodeId,
    setAbstractionCarouselNode,
    setCarouselAnimationState,
    setAbstractionCarouselVisible,
    setSelectedNodeIdForPieMenu,
    rightPanelExpanded,
    setRightPanelExpanded: storeActions.setRightPanelExpanded,
    setEditingNodeIdOnCanvas,
    NODE_DEFAULT_COLOR,
    onStartHurtleAnimationFromPanel: startHurtleAnimationFromPanel,
    onOpenColorPicker: togglePieMenuColorPicker,
    onActivateSemanticOrbit: activateSemanticOrbit,
    onCaptureDeletionGhosts: captureDeletionGhosts
  });

  // Copy the whole selection (and any edges running between its members) to the
  // clipboard — same path as Ctrl/Cmd+C and the single-Thing pie menu's Copy, so
  // a multi-selection pastes back as one shape rather than a pile of loose Things.
  const handleNodePanelCopy = useCallback(() => {
    const currentGraph = graphsMap.get(activeGraphId);
    if (!currentGraph || selectedInstanceIds.size === 0) return;
    const copied = copySelection(selectedInstanceIds, currentGraph, nodePrototypesMap, edgesMap);
    if (copied) {
      clipboardRef.current = copied;
      markClipboardChanged();
    }
  }, [activeGraphId, selectedInstanceIds, graphsMap, nodePrototypesMap, edgesMap, markClipboardChanged]);

  // Duplicate the selection in place. Built from copy+paste rather than a loop of
  // addNodeInstance so the edges running between the selected Things come along —
  // duplicating a shape and getting back a pile of disconnected Things isn't a
  // duplicate. Deliberately does NOT touch clipboardRef: duplicating shouldn't
  // silently overwrite whatever the user has copied.
  const handleNodePanelDuplicate = useCallback(() => {
    const currentGraph = graphsMap.get(activeGraphId);
    if (!currentGraph || selectedInstanceIds.size === 0) return;
    const copied = copySelection(selectedInstanceIds, currentGraph, nodePrototypesMap, edgesMap);
    if (!copied) return;
    // Same down-right offset the single-Thing Duplicate uses, so the copy reads as
    // a copy. pasteClipboard spirals further out if that lands on something.
    const offset = 40;
    const result = pasteClipboard(
      copied,
      activeGraphId,
      { x: copied.originalCenter.x + offset, y: copied.originalCenter.y + offset },
      storeActions,
      currentGraph,
      getNodeDimensions
    );
    // Move the selection to the new copies, matching the single-Thing Duplicate
    // and paste — the panel stays up, now acting on what was just made.
    if (result?.newInstanceIds?.length) {
      setSelectedInstanceIds(new Set(result.newInstanceIds));
    }
  }, [activeGraphId, selectedInstanceIds, graphsMap, nodePrototypesMap, edgesMap, storeActions, setSelectedInstanceIds]);

  // Node-group control panel action handlers
  const handleNodeGroupDiveIntoDefinition = useCallback((a0) => diveIntoNodeGroupDefinition(a0, {
    activeGraphId, nodePrototypesMap, selectedGroup, setGroupControlPanelVisible, setSelectedGroup, startHurtleAnimationFromPanel,
    storeActions,
  }), [
    activeGraphId,
    selectedGroup,
    nodePrototypesMap,
    storeActions,
    startHurtleAnimationFromPanel,
    setGroupControlPanelVisible,
    setSelectedGroup
  ]);

  const handleNodeGroupOpenInPanel = useCallback(() => {
    if (!activeGraphId || !selectedGroup?.linkedNodePrototypeId) return;

    const linkedPrototype = nodePrototypesMap.get(selectedGroup.linkedNodePrototypeId);
    if (!linkedPrototype) {
      console.warn('Linked node prototype not found');
      return;
    }

    if (typeof storeActions.openRightPanelNodeTab === 'function') {
      storeActions.openRightPanelNodeTab(selectedGroup.linkedNodePrototypeId);
    } else {
      console.warn('openRightPanelNodeTab action is unavailable on storeActions');
    }
  }, [activeGraphId, selectedGroup, nodePrototypesMap, storeActions]);

  const handleNodeGroupCombine = useCallback(() => {
    if (!activeGraphId || !selectedGroup?.id) return;
    if (typeof storeActions.collapseNodeGroupIntoDefinition !== 'function') {
      console.warn('collapseNodeGroupIntoDefinition action is unavailable on storeActions');
      return;
    }

    // Collapsing saves the group into its definition first, so a definition can be
    // built in place and folded away without a separate save. The box folds into
    // its node as it goes (groups/boxMorph.js).
    const newInstanceId = withBoxCloseMorph({ viewGraphId: activeGraphId, groupId: selectedGroup.id },
      () => storeActions.collapseNodeGroupIntoDefinition(activeGraphId, selectedGroup.id));

    setGroupControlPanelVisible(false);
    setSelectedGroup(null);

    if (newInstanceId) {
      setSelectedInstanceIds(new Set([newInstanceId]));
    }
  }, [activeGraphId, selectedGroup, storeActions, setSelectedInstanceIds, setGroupControlPanelVisible, setSelectedGroup]);

  // Push the node-group's current contents into its linked definition graph, overwriting it.
  const handleNodeGroupUpdateDefinition = useCallback(() => {
    if (!activeGraphId || !selectedGroup?.id) return;
    if (typeof storeActions.updateDefinitionFromNodeGroup !== 'function') {
      console.warn('updateDefinitionFromNodeGroup action is unavailable on storeActions');
      return;
    }
    storeActions.updateDefinitionFromNodeGroup(activeGraphId, selectedGroup.id);
  }, [activeGraphId, selectedGroup, storeActions]);

  // Refresh the node-group from its linked definition graph, discarding the group's current members.
  const handleNodeGroupRefreshFromDefinition = useCallback(() => {
    if (!activeGraphId || !selectedGroup?.id) return;
    if (typeof storeActions.refreshNodeGroupFromDefinition !== 'function') {
      console.warn('refreshNodeGroupFromDefinition action is unavailable on storeActions');
      return;
    }
    storeActions.refreshNodeGroupFromDefinition(activeGraphId, selectedGroup.id);

    const gs = useGraphStore.getState();
    const refreshedGroup = projectGraphView(gs, activeGraphId)?.groups?.get(selectedGroup.id);
    if (refreshedGroup) {
      setSelectedGroup(refreshedGroup);
    }
  }, [activeGraphId, selectedGroup, storeActions, setSelectedGroup]);

  // The group pie (pie/groupPieButtons.js): this panel's actions, drawn above a
  // selected Thing-group's or equation's title by GroupPieMenuLayer. Its buttons
  // call through a ref, so the list is rebuilt only when the set changes.
  const groupPieHandlersRef = useRef(null);
  groupPieHandlersRef.current = {
    swapFormat,
    onDiveIntoDefinition: handleNodeGroupDiveIntoDefinition,
    onOpenInPanel: () => {
      handleNodeGroupOpenInPanel();
      if (!rightPanelExpanded) storeActions.setRightPanelExpanded(true);
    },
    onCombine: groupPanelMode === 'format' ? handleFormulaCondense : handleNodeGroupCombine,
    onUpdateDefinition: handleNodeGroupUpdateDefinition,
    onRefreshFromDefinition: handleNodeGroupRefreshFromDefinition,
    onEdit: handleGroupPanelEdit,
    onColor: handleGroupPanelColor,
    onUngroup: handleGroupPanelUngroup,
    onDelete: groupPanelMode === 'format' ? handleFormulaDelete : handleNodeGroupDelete,
    onConvertToNodeGroup: handleGroupPanelConvertToNodeGroup,
    setFormulaNames: (shown) => { if (selectedGroup) showFormulaNames(selectedGroup.id, shown); },
    setStandardNotation: (standard) => setNotation(standard ? 'standard' : 'explicit'),
    cycleFormulaSize: () => {
      if (!selectedGroup || !activeGraphId) return;
      const next = nextNodeSizeStep(selectedGroup.formulaSize ?? 1);
      useGraphStore.getState().updateGroup(activeGraphId, selectedGroup.id, (g) => {
        if (next === 1) delete g.formulaSize; else g.formulaSize = next;
      }, { finalize: true });
      // The hover chip keeps the label it had when the pointer came in (as the node pie's Size does).
      if (getActionHoverItem()?.id === 'group-size') {
        useCanvasUIStore.getState().setActivePieMenuItemForVision({ id: 'group-size', label: `Size: ${nodeSizeLabel(next)}` });
      }
    },
  };
  const groupPieButtons = useMemo(() => {
    const handlers = Object.fromEntries(Object.keys(groupPieHandlersRef.current)
      .map(key => [key, (...args) => groupPieHandlersRef.current[key]?.(...args)]));
    return buildGroupPieButtons({
      mode: groupPanelMode, group: selectedGroup, formulaText: groupFormulaText, currentFormat,
      formulaNames, standardNotation, handlers,
    });
  // The group is read for its kind only; a rename or move is no new set of buttons.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupPanelMode, selectedGroup?.id, selectedGroup?.isOpenDefinition, selectedGroup?.linkedNodePrototypeId, selectedGroup?.formulaSize, groupFormulaText, currentFormat, formulaNames, standardNotation]);
  useEffect(() => {
    setGroupPieButtons(selectedGroup?.id ?? null, groupPieButtons);
  }, [selectedGroup?.id, groupPieButtons]);
  useEffect(() => () => setGroupPieButtons(null, null), []);

  // --- Abstraction Control Panel Management ---
  useEffect(() => {
    const shouldShow = Boolean(abstractionCarouselVisible && abstractionCarouselNode && showAbstractionControlPanel);

    if (shouldShow) {
      // Show the panel immediately when carousel is visible and hide others
      setAbstractionControlPanelShouldShow(true);
      setAbstractionControlPanelVisible(true);
      // Hide other control panels
      setNodeControlPanelVisible(false);
      setNodeControlPanelShouldShow(false);
    } else if (!abstractionCarouselVisible && abstractionControlPanelVisible) {
      // Carousel was hidden - start exit animation but keep panel mounted
      setAbstractionControlPanelVisible(false);
      // Don't set abstractionControlPanelShouldShow to false yet - let the animation complete
    } else if (!shouldShow) {
      // Other cases where panel should be hidden
      setAbstractionControlPanelVisible(false);
    }
  }, [abstractionCarouselVisible, abstractionCarouselNode, abstractionControlPanelVisible, showAbstractionControlPanel]);

  // --- Node Control Panel Management ---
  useEffect(() => {
    const nodesSelected = liveNodeCount > 0;
    const edgeSelected = liveEdgeSelected;
    const isBoxSelecting = marqueeActive;
    // Also show while previewing/decomposing a node, even if it isn't in selectedInstanceIds —
    // the panel switches to 'decompose' mode in that case (see NodeControlPanel render).
    const multipleSelected = liveNodeCount > 1;
    const panelAllowed = nodesSelected
      ? (multipleSelected ? showMultipleNodesControlPanel : showNodeControlPanel)
      : (previewingNodeId ? showNodeControlPanel : false);
    const shouldShow = Boolean(panelAllowed && (nodesSelected || previewingNodeId) && !edgeSelected && !abstractionCarouselVisible && !connectionNamePrompt.visible && !semanticOrbitActive && !isBoxSelecting);
    if (shouldShow) {
      setNodeControlPanelShouldShow(true);
      setNodeControlPanelVisible(true);
      // Hide ALL other control panels
      setAbstractionControlPanelVisible(false);
      setAbstractionControlPanelShouldShow(false);
      setConnectionControlPanelVisible(false);
      setConnectionControlPanelShouldShow(false);
      setGroupControlPanelVisible(false);
      setSelectedGroup(null);
    } else if (!shouldShow && nodeControlPanelVisible) {
      setNodeControlPanelVisible(false);
    }
  }, [liveNodeCount, liveEdgeSelected, abstractionCarouselVisible, connectionNamePrompt.visible, nodeControlPanelVisible, semanticOrbitActive, marqueeActive, previewingNodeId, showNodeControlPanel, showMultipleNodesControlPanel]);

  // --- Connection Control Panel Management (multi-edge selection only) ---
  useEffect(() => {
    const nodesSelected = liveNodeCount > 0;
    const edgeSelected = liveEdgeSelected;
    const shouldShow = Boolean(showConnectionControlPanel && edgeSelected && !nodesSelected && !abstractionCarouselVisible && !connectionNamePrompt.visible);
    if (shouldShow) {
      setConnectionControlPanelShouldShow(true);
      setConnectionControlPanelVisible(true);
      // Hide ALL other control panels
      setNodeControlPanelVisible(false);
      setNodeControlPanelShouldShow(false);
      setAbstractionControlPanelVisible(false);
      setAbstractionControlPanelShouldShow(false);
      setGroupControlPanelVisible(false);
      setSelectedGroup(null);
    } else if (!shouldShow && connectionControlPanelVisible) {
      setConnectionControlPanelVisible(false);
    }
  }, [liveNodeCount, liveEdgeSelected, abstractionCarouselVisible, connectionNamePrompt.visible, connectionControlPanelVisible, showConnectionControlPanel]);


  // --- Group Control Panel Management ---
  useEffect(() => {
    // An equation (the format mode) has its own setting; every other group reads the group one.
    const panelEnabled = groupPanelMode === 'format' ? showEquationControlPanel : showGroupControlPanel;
    const shouldShow = Boolean(panelEnabled && selectedGroup && !abstractionCarouselVisible && !connectionNamePrompt.visible);
    if (shouldShow) {
      setGroupControlPanelShouldShow(true);
      setGroupControlPanelVisible(true);
      // Hide ALL other control panels
      setNodeControlPanelVisible(false);
      setNodeControlPanelShouldShow(false);
      setAbstractionControlPanelVisible(false);
      setAbstractionControlPanelShouldShow(false);
      setConnectionControlPanelVisible(false);
      setConnectionControlPanelShouldShow(false);
    } else if (!shouldShow && groupControlPanelVisible) {
      setGroupControlPanelVisible(false);
    }
  }, [selectedGroup, abstractionCarouselVisible, connectionNamePrompt.visible, groupControlPanelVisible, showGroupControlPanel, showEquationControlPanel, groupPanelMode]);

  // The expanded Thing's description for the web it's showing, under it in the
  // panel (the node itself shows only the web).
  const decomposeDescription = useMemo(() => {
    const graphId = decomposePanelInfo?.currentGraphId;
    if (!graphId) return null;
    const proto = nodePrototypesMap.get(decomposePanelInfo.prototypeId);
    const text = getDefinitionDescription(proto, graphId, graphsMap.get(graphId)?.description);
    return text && text.trim() ? text.trim() : null;
  }, [decomposePanelInfo, nodePrototypesMap, graphsMap]);

  return (
    <Profiler id="ControlPanelsHost" onRender={onRenderProbe}>
      {/* NodeControlPanel Component - with animation */}
      {
        (nodeControlPanelShouldShow || nodeControlPanelVisible) && (
          <NodeControlPanel
            mode={decomposePanelInfo ? 'decompose' : 'nodes'}
            selectedNodePrototypes={decomposePanelInfo ? [decomposePanelInfo.prototype] : nodePrototypesForPanel}
            isVisible={nodeControlPanelVisible}
            typeListOpen={typeListVisible}
            onAnimationComplete={handleNodeControlPanelAnimationComplete}
            decompHasDefinitions={decomposePanelInfo ? decomposePanelInfo.hasDefs : false}
            decompBlocked={decomposePanelInfo?.expandBlocked || null}
            decompDescription={decomposeDescription}
            onCompose={() => useCanvasUIStore.getState().dispatchPie({ type: 'PREVIEW_SET', id: null })}
            onDelete={decomposePanelInfo
              ? () => requestDeleteDefinition(decomposePanelInfo.prototypeId, decomposePanelInfo.currentGraphId)
              : handleNodePanelDelete}
            onAdd={decomposePanelInfo
              ? () => storeActions.createAndAssignGraphDefinitionWithoutActivation(decomposePanelInfo.prototypeId)
              : handleNodePanelAdd}
            onUp={decomposePanelInfo
              ? () => { if (decomposePanelInfo.currentGraphId) startHurtleAnimation(decomposePanelInfo.instanceId, decomposePanelInfo.currentGraphId, decomposePanelInfo.prototypeId); }
              : handleNodePanelUp}
            onOpenInPanel={handleNodePanelOpenInPanel}
            onDecompose={decomposePanelInfo ? () => {
              const { instanceId, prototypeId, index } = decomposePanelInfo;
              const newGroup = expandNodeInPlace({ viewGraphId: activeGraphId, prototypeId, definitionIndex: index, instanceId });
              if (!newGroup) return;
              useCanvasUIStore.getState().dispatchPie({ type: 'PREVIEW_SET', id: null });
              setSelectedGroup(newGroup);
              setSelectedInstanceIds(new Set());
              setGroupControlPanelShouldShow(true);
              setNodeControlPanelShouldShow(false);
              setNodeControlPanelVisible(false);
            } : handleNodePanelDecompose}
            onAbstraction={handleNodePanelAbstraction}
            onEdit={handleNodePanelEdit}
            onSave={handleNodePanelSave}
            onPalette={handleNodePanelPalette}
            onOrbit={handleNodePanelOrbit}
            onGroup={handleNodePanelGroup}
            onCopy={handleNodePanelCopy}
            onDuplicate={handleNodePanelDuplicate}
            pieMenuPages={/* Decomposition builds its own single-page button set, so it
                              opts out and keeps the hand-written decompose buttons. */
              decomposePanelInfo ? null : nodePieMenuPages}
            pieMenuTargetInstanceId={decomposePanelInfo ? null : singleSelectedInstanceId}
            onLeftNav={decomposePanelInfo ? () => { if (decomposePanelInfo.hasPrev) decomposePanelInfo.setIndex(decomposePanelInfo.index - 1); } : undefined}
            onRightNav={decomposePanelInfo ? () => { if (decomposePanelInfo.hasNext) decomposePanelInfo.setIndex(decomposePanelInfo.index + 1); } : undefined}
            hasLeftNav={decomposePanelInfo ? decomposePanelInfo.hasPrev : false}
            hasRightNav={decomposePanelInfo ? decomposePanelInfo.hasNext : false}
            onActionHoverChange={handlePieMenuHoverChange}
            wizardEnabled={wizardEnabled}
            onDismiss={() => setSelectedInstanceIds(new Set())}
          />
        )
      }

      {/* GroupControlPanel Component - with animation */}
      {
        (groupControlPanelShouldShow || groupControlPanelVisible) && (
          <UnifiedBottomControlPanel
            mode={groupPanelMode}
            isVisible={groupControlPanelVisible}
            typeListOpen={typeListVisible}
            onAnimationComplete={handleGroupControlPanelAnimationComplete}
            selectedGroup={groupPanelTarget}
            onUngroup={handleGroupPanelUngroup}
            {...(groupPanelMode === 'nodegroup' ? { onDelete: handleNodeGroupDelete } : {})}
            onGroupEdit={handleGroupPanelEdit}
            onGroupColor={handleGroupPanelColor}
            onConvertToNodeGroup={handleGroupPanelConvertToNodeGroup}
            onDiveIntoDefinition={handleNodeGroupDiveIntoDefinition}
            onOpenNodePrototypeInPanel={handleNodeGroupOpenInPanel}
            onCombineNodeGroup={handleNodeGroupCombine}
            onUpdateDefinitionFromGroup={handleNodeGroupUpdateDefinition}
            onRefreshGroupFromDefinition={handleNodeGroupRefreshFromDefinition}
            onActionHoverChange={handlePieMenuHoverChange}
            onDismiss={() => setSelectedGroup(null)}
            {...(groupFormulaText ? {
              formatSwap,
              formatToggles,
              ...(currentFormat === 'formula' ? { onDelete: handleFormulaDelete } : {}),
              // Combined into its Thing, an equation folds as a Thing-group does; a plain group has no Thing to fold into.
              ...(currentFormat === 'formula' ? { onCombineNodeGroup: isThingGroup ? handleFormulaCondense : undefined } : {}),
              // An equation is a Thing-group already.
              ...(groupPanelTarget?.linkedNodePrototypeId ? { onConvertToNodeGroup: undefined } : {}),
              customContent: currentFormat === 'formula'
                ? <FormatPanelPreview groupId={groupPanelTarget.id} />
                : undefined,
              ...(currentFormat === 'formula' ? { kindLabel: 'Equation' } : {}),
            } : {})}
          />
        )
      }

      {/* ConnectionControlPanel Component - with animation */}
      {
        (connectionControlPanelShouldShow || connectionControlPanelVisible) && (
          <ConnectionControlPanel
            selectedEdge={liveSelectedEdge}
            selectedEdges={liveSelectedEdges}
            isVisible={connectionControlPanelVisible}
            typeListOpen={typeListVisible}
            onAnimationComplete={handleConnectionControlPanelAnimationComplete}
            pieMenuButtons={edgePieMenuButtons}
            pieMenuTargetEdgeId={selectedEdgeId}
            onClose={() => {
              storeActions.setSelectedEdgeId(null);
              storeActions.setSelectedEdgeIds(new Set());
            }}
            onOpenConnectionDialog={(edgeId) => {
              setConnectionNamePrompt({ visible: true, name: '', color: CONNECTION_DEFAULT_COLOR, edgeId });
            }}
            onStartHurtleAnimationFromPanel={startHurtleAnimationFromPanel}
            onActionHoverChange={handlePieMenuHoverChange}
            onAskWizard={(edges) => {
              openWizardPicker(WIZARD_SURFACES.CONNECTION, { edges }, {
                facts: connectionFacts(edges),
                subjectLabel: edges.length > 1 ? `${edges.length} Connections` : 'this Connection'
              });
            }}
            wizardEnabled={wizardEnabled}
          />
        )
      }

      {/* AbstractionControlPanel Component - with animation */}
      {
        (abstractionControlPanelShouldShow || abstractionControlPanelVisible) && (
          <AbstractionControlPanel
            selectedNode={abstractionCarouselNode}
            currentDimension={currentAbstractionDimension}
            availableDimensions={abstractionDimensions}
            onDimensionChange={handleAbstractionDimensionChange}
            onAddDimension={handleAddAbstractionDimension}
            onDeleteDimension={handleDeleteAbstractionDimension}
            onExpandDimension={handleExpandAbstractionDimension}
            typeListOpen={typeListVisible}
            isVisible={abstractionControlPanelVisible}
            onAnimationComplete={handleAbstractionControlPanelAnimationComplete}
            onActionHoverChange={handlePieMenuHoverChange}
            onDismiss={onCarouselClose}
          />
        )
      }

    </Profiler>
  );
}
