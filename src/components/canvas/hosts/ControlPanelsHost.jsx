/**
 * The bottom control panels (P5.05a): node, group, connection and abstraction,
 * with the effects that decide which one shows. Both moved verbatim from
 * NodeCanvas. The host subscribes to what those effects react to (selection,
 * edge selection, carousel, prompts, orbit, marquee, preview, the panel
 * settings and the latches in canvasUIStore); NodeCanvas passes the panels'
 * handlers and derived data as `ctx`.
 */
import { Profiler } from 'react';
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
  const showAbstractionControlPanel = useGraphStore((state) => state.showAbstractionControlPanel ?? true);
  // The group the panel is about, read through to the active web so a rename or
  // recolour elsewhere shows up (P2.03b).
  const selectedGroupId = useCanvasUIStore((s) => s.selectedGroupId);
  const selectedGroup = useGraphStore((s) => (selectedGroupId ? s.graphs.get(s.activeGraphId)?.groups?.get(selectedGroupId) ?? null : null));
  const {
    decomposePanelInfo, nodePrototypesForPanel, typeListVisible, handleNodeControlPanelAnimationComplete,
    storeActions, handleNodePanelDelete, handleNodePanelAdd, startHurtleAnimation, handleNodePanelUp,
    handleNodePanelOpenInPanel, graphsMap, activeGraphId, setSelectedInstanceIds, handleNodePanelDecompose,
    handleNodePanelAbstraction, handleNodePanelEdit, handleNodePanelSave, handleNodePanelPalette,
    handleNodePanelOrbit, handleNodePanelGroup, handleNodePanelCopy, handleNodePanelDuplicate,
    nodePieMenuPages, singleSelectedInstanceId, handlePieMenuHoverChange, wizardEnabled, groupPanelMode,
    handleGroupControlPanelAnimationComplete, groupPanelTarget, handleGroupPanelUngroup,
    handleGroupPanelEdit, handleGroupPanelColor, handleGroupPanelConvertToNodeGroup,
    handleNodeGroupDiveIntoDefinition, handleNodeGroupOpenInPanel, handleNodeGroupCombine,
    handleNodeGroupUpdateDefinition, handleNodeGroupRefreshFromDefinition, edgesMap,
    handleConnectionControlPanelAnimationComplete, edgePieMenuButtons, setConnectionNamePrompt,
    startHurtleAnimationFromPanel, openWizardPicker, currentAbstractionDimension, abstractionDimensions,
    handleAbstractionDimensionChange, handleAddAbstractionDimension, handleDeleteAbstractionDimension,
    handleExpandAbstractionDimension, handleAbstractionControlPanelAnimationComplete, onCarouselClose,
  } = ctx;

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
    const nodesSelected = selectedInstanceIds.size > 0;
    const edgeSelected = selectedEdgeId !== null || selectedEdgeIds.size > 0;
    const isBoxSelecting = marqueeActive;
    // Also show while previewing/decomposing a node, even if it isn't in selectedInstanceIds —
    // the panel switches to 'decompose' mode in that case (see NodeControlPanel render).
    const multipleSelected = selectedInstanceIds.size > 1;
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
  }, [selectedInstanceIds, selectedEdgeId, selectedEdgeIds, abstractionCarouselVisible, connectionNamePrompt.visible, nodeControlPanelVisible, semanticOrbitActive, marqueeActive, previewingNodeId, showNodeControlPanel, showMultipleNodesControlPanel]);

  // --- Connection Control Panel Management (multi-edge selection only) ---
  useEffect(() => {
    const nodesSelected = selectedInstanceIds.size > 0;
    const edgeSelected = selectedEdgeId !== null || selectedEdgeIds.size > 0;
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
  }, [selectedInstanceIds, selectedEdgeId, selectedEdgeIds, abstractionCarouselVisible, connectionNamePrompt.visible, connectionControlPanelVisible, showConnectionControlPanel]);


  // --- Group Control Panel Management ---
  useEffect(() => {
    const shouldShow = Boolean(showGroupControlPanel && selectedGroup && !abstractionCarouselVisible && !connectionNamePrompt.visible);
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
  }, [selectedGroup, abstractionCarouselVisible, connectionNamePrompt.visible, groupControlPanelVisible, showGroupControlPanel]);

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
            onCompose={() => useCanvasUIStore.getState().dispatchPie({ type: 'PREVIEW_SET', id: null })}
            onDelete={decomposePanelInfo ? () => {
              const { defIds, index, currentGraphId, prototypeId, setIndex } = decomposePanelInfo;
              if (!currentGraphId) return;
              const newLen = defIds.length - 1;
              if (newLen > 0 && index >= newLen) setIndex(newLen - 1);
              else if (newLen <= 0) setIndex(0);
              storeActions.removeDefinitionFromNode(prototypeId, currentGraphId);
            } : handleNodePanelDelete}
            onAdd={decomposePanelInfo
              ? () => storeActions.createAndAssignGraphDefinitionWithoutActivation(decomposePanelInfo.prototypeId)
              : handleNodePanelAdd}
            onUp={decomposePanelInfo
              ? () => { if (decomposePanelInfo.currentGraphId) startHurtleAnimation(decomposePanelInfo.instanceId, decomposePanelInfo.currentGraphId, decomposePanelInfo.prototypeId); }
              : handleNodePanelUp}
            onOpenInPanel={handleNodePanelOpenInPanel}
            onDecompose={decomposePanelInfo ? () => {
              const { instanceId, prototypeId, index, currentGraphId } = decomposePanelInfo;
              const currentDefGraph = currentGraphId ? graphsMap.get(currentGraphId) : null;
              const isCurrentDefEmpty = !currentDefGraph || !currentDefGraph.instances || currentDefGraph.instances.size === 0;
              const createdGroupId = isCurrentDefEmpty
                ? storeActions.decomposeEmptyNodeToGroup(activeGraphId, prototypeId, index, instanceId)
                : storeActions.decomposeNodeToGroup(activeGraphId, prototypeId, index, instanceId);
              if (!createdGroupId) return;
              useCanvasUIStore.getState().dispatchPie({ type: 'PREVIEW_SET', id: null });
              const gs = useGraphStore.getState();
              const newGroup = gs.graphs?.get(activeGraphId)?.groups?.get(createdGroupId);
              if (newGroup) {
                setSelectedGroup(newGroup);
                setSelectedInstanceIds(new Set());
                setGroupControlPanelShouldShow(true);
                setNodeControlPanelShouldShow(false);
                setNodeControlPanelVisible(false);
              }
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
          />
        )
      }

      {/* ConnectionControlPanel Component - with animation */}
      {
        (connectionControlPanelShouldShow || connectionControlPanelVisible) && (
          <ConnectionControlPanel
            selectedEdge={edgesMap.get(selectedEdgeId)}
            selectedEdges={Array.from(selectedEdgeIds).map(id => edgesMap.get(id)).filter(Boolean)}
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
