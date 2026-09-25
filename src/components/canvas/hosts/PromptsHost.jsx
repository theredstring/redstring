/**
 * The canvas name prompts (P5.06a): swap, new Thing, connection name, node-group
 * name and Add Above/Below, one UnifiedSelector at a time. Moved verbatim from
 * NodeCanvas; since P5.06b the prompts' handlers and one-shot name suggestions
 * live here too, and NodeCanvas passes the canvas values they use as `ctx`.
 */
import { Profiler, useCallback, useEffect, useRef } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import UnifiedSelector from '../../../UnifiedSelector';
import { v4 as uuidv4 } from 'uuid';
import { NODE_DEFAULT_COLOR } from '../../../constants';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { setDialogColorPickerVisible } from '../colorPickers/colorPickers.js';
import { attachOneShotOutcome } from '../../../services/oneShot.js';
import { submitAbstraction } from '../actions/abstractionSubmit.js';
import { suggestConnectionName, fillAbstractionNameSuggestion, suggestEdgeArrowDirectionWith } from '../actions/oneShotSuggestions.js';
import { performInstanceSwapWith } from '../actions/instanceSwap.js';

export default function PromptsHost({ ctx }) {
  const {
    nodeNamePrompt, connectionNamePrompt, abstractionPrompt, setSwapPrompt, leftPanelExpanded, rightPanelExpanded,
    storeActions, plusSign, setPlusSign, setNodeNamePrompt, handleNodeSelection, setConnectionNamePrompt,
    setNodeGroupPrompt, activeGraphId, setSelectedGroup, setGroupControlPanelShouldShow,
    setNodeControlPanelShouldShow, setNodeControlPanelVisible, edgesMap, nodeById, nodePrototypesMap,
    setAbstractionPrompt, nodes, abstractionCarouselNode, currentAbstractionDimension,
    setAbstractionCarouselVisible, setCarouselFocusPrototypeRequest, setCarouselPieMenuStage,
    setIsCarouselStageTransition, setSelectedNodeIdForPieMenu,
  } = ctx;
  const nodeGroupPrompt = useCanvasUIStore(s => s.nodeGroupPrompt);
  const swapPrompt = useCanvasUIStore(s => s.swapPrompt);

  // ---- Moved from NodeCanvas (P5.06b) ----
  // Tracks the last one-shot edge-label suggestion so we can (a) pre-fill it only
  // while the field is untouched, and (b) log whether the user accepted/edited/ignored it.
  const connectionSuggestionRef = useRef(null); // { edgeId, suggestion, callId }
  const abstractionSuggestionRef = useRef(null); // { nodeId, direction, suggestion, callId, applied }

  // Attach an accepted/edited/ignored outcome to the last edge-label suggestion.
  const finalizeConnectionSuggestion = useCallback((finalName) => {
    const s = connectionSuggestionRef.current;
    connectionSuggestionRef.current = null;
    if (!s || !s.callId) return;
    if (!s.applied) { attachOneShotOutcome(s.callId, 'ignored'); return; }
    const f = (finalName || '').trim().toLowerCase();
    const sug = (s.suggestion || '').trim().toLowerCase();
    attachOneShotOutcome(s.callId, f && f === sug ? 'accepted' : 'edited');
  }, []);

  // C4 — one-shot arrow direction. When the user confirms a verb-phrase
  // connection label, ask the model (in the background) which way the arrow
  // should point and pre-set it — but ONLY if the edge has no direction yet, and
  // re-check inside the store write so a late suggestion never overrides a
  // direction the user set in the meantime. No model → nothing happens.
  const suggestEdgeArrowDirection = useCallback((...args) => suggestEdgeArrowDirectionWith({
    edgesMap, nodeById, storeActions,
  }, ...args), [edgesMap, nodeById, storeActions]);

  // One-shot edge-label suggestion: when the connection prompt opens on an
  // untouched field, ask the configured model (in the background) for a short
  // verb-phrase label from source→target and pre-fill it as a suggestion the
  // user can overwrite. No model / timeout / malformed → nothing happens and the
  // field stays blank (identical to today).
  useEffect(() => suggestConnectionName({
    connectionNamePrompt, edgesMap, nodeById, nodePrototypesMap, connectionSuggestionRef,
    setConnectionNamePrompt,
  }), [connectionNamePrompt.visible, connectionNamePrompt.edgeId, edgesMap, nodeById, nodePrototypesMap]);

  // C6 — Attach an accepted/edited/ignored outcome to the last abstraction-name suggestion.
  const finalizeAbstractionSuggestion = useCallback((finalName) => {
    const s = abstractionSuggestionRef.current;
    abstractionSuggestionRef.current = null;
    if (!s || !s.callId) return;
    if (!s.applied) { attachOneShotOutcome(s.callId, 'ignored'); return; }
    const f = (finalName || '').trim().toLowerCase();
    const sug = (s.suggestion || '').trim().toLowerCase();
    attachOneShotOutcome(s.callId, f && f === sug ? 'accepted' : 'edited');
  }, []);

  // C6 — Abstraction-axis name suggestion. When the add-above/below prompt opens
  // on an untouched field, ask the model (background) for the name one rung
  // more general / more specific and pre-fill it. NOTE: in this app "above" =
  // MORE SPECIFIC and "below" = MORE GENERAL (see the prompt subtitle), which is
  // the opposite of the usual convention — so we pass moreGeneral accordingly.
  // No model / timeout / malformed → field stays blank (identical to today).
  useEffect(() => fillAbstractionNameSuggestion({
    abstractionPrompt, nodePrototypesMap, abstractionSuggestionRef, setAbstractionPrompt,
  }), [abstractionPrompt.visible, abstractionPrompt.nodeId, abstractionPrompt.direction, nodePrototypesMap]);

  // Re-point an existing instance at a different prototype (pie-menu "Swap").
  // Edges reference instance IDs, so every connection stays attached — only the
  // instance's prototypeId changes. Position is nudged so the node keeps its
  // center despite the new prototype's (possibly different) dimensions. This is the
  // same operation the abstraction carousel performs on swap.
  const performInstanceSwap = useCallback((...args) => performInstanceSwapWith({
    nodes, activeGraphId, storeActions,
  }, ...args), [nodes, activeGraphId, storeActions]);

  const handleClosePrompt = () => {
    if (!nodeNamePrompt.name.trim()) {
      setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
    }
    setNodeNamePrompt({ visible: false, name: '', color: null });
    setDialogColorPickerVisible(false); // Close color picker when closing prompt
  };

  const handleAbstractionSubmit = (a0) => submitAbstraction(a0, {
    abstractionCarouselNode, abstractionPrompt, currentAbstractionDimension, nodePrototypesMap, nodes, setAbstractionCarouselVisible,
    setAbstractionPrompt, setCarouselFocusPrototypeRequest, setCarouselPieMenuStage, setIsCarouselStageTransition, setSelectedNodeIdForPieMenu, storeActions,
  });



  return (
    <Profiler id="PromptsHost" onRender={onRenderProbe}>
      {/* Single UnifiedSelector instance with dynamic props */}
      {(() => {
        const anyVisible = nodeNamePrompt.visible || connectionNamePrompt.visible || abstractionPrompt.visible || nodeGroupPrompt.visible || swapPrompt.visible;
        if (!anyVisible) return null;
        if (swapPrompt.visible) {
          const closeSwap = () => setSwapPrompt({ visible: false, instanceId: null, name: '', color: null });
          return (
            <UnifiedSelector
              mode="node-creation"
              isVisible={true}
              leftPanelExpanded={leftPanelExpanded}
              rightPanelExpanded={rightPanelExpanded}
              onClose={() => { setDialogColorPickerVisible(false); closeSwap(); }}
              onSubmit={({ name, color }) => {
                // Make a new Thing and swap this instance onto it.
                if (name.trim() && swapPrompt.instanceId) {
                  const newProtoId = uuidv4();
                  storeActions.addNodePrototype({ id: newProtoId, name: name.trim(), description: '', picture: null, color: color || NODE_DEFAULT_COLOR, typeNodeId: null, definitionGraphIds: [] });
                  performInstanceSwap(swapPrompt.instanceId, newProtoId);
                }
                setDialogColorPickerVisible(false);
                closeSwap();
              }}
              onNodeSelect={(prototype) => {
                // Swap this instance onto the chosen existing Thing.
                if (prototype?.id && swapPrompt.instanceId) {
                  performInstanceSwap(swapPrompt.instanceId, prototype.id);
                }
                setDialogColorPickerVisible(false);
                closeSwap();
              }}
              initialName={swapPrompt.name}
              initialColor={swapPrompt.color}
              title="Swap Thing"
              subtitle="Choose a Thing to swap to, or make a new one.<br />Connections are kept."
              searchTerm={swapPrompt.name}
            />
          );
        }
        if (nodeNamePrompt.visible) {
          return (
            <UnifiedSelector
              mode="node-creation"
              isVisible={true}
              leftPanelExpanded={leftPanelExpanded}
              rightPanelExpanded={rightPanelExpanded}
              onClose={() => { setDialogColorPickerVisible(false); handleClosePrompt(); }}
              onSubmit={({ name, color }) => {
                if (name && plusSign) {
                  setPlusSign(ps => ps && { ...ps, mode: 'morph', tempName: name, selectedColor: color });
                } else {
                  setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
                }
                setNodeNamePrompt({ visible: false, name: '', color: null });
                setDialogColorPickerVisible(false);
              }}
              onNodeSelect={handleNodeSelection}
              initialName={nodeNamePrompt.name}
              initialColor={nodeNamePrompt.color}
              title="Name Your Thing"
              subtitle="Add a new Thing to this Web."
              searchTerm={nodeNamePrompt.name}
            />
          );
        }
        if (connectionNamePrompt.visible) {
          return (
            <UnifiedSelector
              mode="connection-creation"
              isVisible={true}
              leftPanelExpanded={leftPanelExpanded}
              rightPanelExpanded={rightPanelExpanded}
              onClose={() => { finalizeConnectionSuggestion(null); setDialogColorPickerVisible(false); setConnectionNamePrompt({ visible: false, name: '', color: null, edgeId: null }); }}
              onSubmit={({ name, color }) => {
                if (name.trim()) {
                  finalizeConnectionSuggestion(name);
                  const newConnectionNodeId = uuidv4();
                  // Creating the type and applying it to the edge is one
                  // gesture. It only held together before because the
                  // context-less updateEdge inherited addNodePrototype's
                  // leaked context.
                  storeActions.withHistoryTransaction(`Defined connection "${name.trim()}"`, () => {
                    storeActions.addNodePrototype({ id: newConnectionNodeId, name: name.trim(), description: '', picture: null, color: color || NODE_DEFAULT_COLOR, typeNodeId: null, definitionGraphIds: [] });
                    if (connectionNamePrompt.edgeId) {
                      storeActions.updateEdge(connectionNamePrompt.edgeId, (draft) => { draft.definitionNodeIds = [newConnectionNodeId]; });
                    }
                  });
                  // Async, and deliberately its own entry — it lands whenever
                  // the model answers, long after this gesture is over.
                  if (connectionNamePrompt.edgeId) suggestEdgeArrowDirection(connectionNamePrompt.edgeId, name.trim());
                  setConnectionNamePrompt({ visible: false, name: '', color: null, edgeId: null });
                  setDialogColorPickerVisible(false);
                }
              }}
              onNodeSelect={(node) => {
                finalizeConnectionSuggestion(node?.name);
                if (connectionNamePrompt.edgeId) {
                  storeActions.updateEdge(connectionNamePrompt.edgeId, (draft) => { draft.definitionNodeIds = [node.id]; });
                  suggestEdgeArrowDirection(connectionNamePrompt.edgeId, node?.name);
                }
                setConnectionNamePrompt({ visible: false, name: '', color: null, edgeId: null });
                setDialogColorPickerVisible(false);
              }}
              initialName={connectionNamePrompt.name}
              initialColor={connectionNamePrompt.color}
              title="Name Your Connection"
              subtitle="The Thing that will define your Connection,<br />in verb form if available."
              searchTerm={connectionNamePrompt.name}
            />
          );
        }
        // Node-group prompt
        if (nodeGroupPrompt.visible) {
          return (
            <UnifiedSelector
              mode="node-group-creation"
              isVisible={true}
              leftPanelExpanded={leftPanelExpanded}
              rightPanelExpanded={rightPanelExpanded}
              onClose={() => setNodeGroupPrompt({ visible: false, name: '', color: null, groupId: null })}
              onSubmit={({ name, color }) => {
                if (name.trim() && activeGraphId && nodeGroupPrompt.groupId) {
                  storeActions.convertGroupToNodeGroup(
                    activeGraphId,
                    nodeGroupPrompt.groupId,
                    null, // nodePrototypeId (not used when creating new)
                    true, // createNewPrototype
                    name.trim(),
                    color
                  );
                  setNodeGroupPrompt({ visible: false, name: '', color: null, groupId: null });
                  const currentState = useGraphStore.getState();
                  const graph = currentState.graphs?.get(activeGraphId);
                  const updatedGroup = graph?.groups?.get(nodeGroupPrompt.groupId);
                  if (updatedGroup) {
                    setSelectedGroup(updatedGroup);
                    setGroupControlPanelShouldShow(true);
                    setNodeControlPanelShouldShow(false);
                    setNodeControlPanelVisible(false);
                  }
                }
              }}
              onNodeSelect={(prototype) => {
                if (activeGraphId && nodeGroupPrompt.groupId) {
                  storeActions.convertGroupToNodeGroup(
                    activeGraphId,
                    nodeGroupPrompt.groupId,
                    prototype.id, // Link to existing prototype
                    false // Don't create new
                  );
                  setNodeGroupPrompt({ visible: false, name: '', color: null, groupId: null });
                  const currentState = useGraphStore.getState();
                  const graph = currentState.graphs?.get(activeGraphId);
                  const updatedGroup = graph?.groups?.get(nodeGroupPrompt.groupId);
                  if (updatedGroup) {
                    setSelectedGroup(updatedGroup);
                    setGroupControlPanelShouldShow(true);
                    setNodeControlPanelShouldShow(false);
                    setNodeControlPanelVisible(false);
                  }
                }
              }}
              initialName={nodeGroupPrompt.name}
              initialColor={nodeGroupPrompt.color}
              title="Name Your Thing"
              subtitle="Add a new Thing that will be defined by this Group."
              searchTerm={nodeGroupPrompt.name}
            />
          );
        }
        // Abstraction prompt
        return (
          <UnifiedSelector
            mode="abstraction-node-creation"
            isVisible={true}
            leftPanelExpanded={leftPanelExpanded}
            rightPanelExpanded={rightPanelExpanded}
            onClose={() => {
              finalizeAbstractionSuggestion(null);
              // Back to stage 1 on the carousel node (PROMPT_CANCELLED).
              useCanvasUIStore.getState().dispatchPie({ type: 'PROMPT_CANCELLED' });
            }}
            onSubmit={(payload) => { finalizeAbstractionSuggestion(payload?.name); handleAbstractionSubmit(payload); }}
            onNodeSelect={(prototype) => {
              if (!prototype) return;
              finalizeAbstractionSuggestion(prototype.name);
              handleAbstractionSubmit({
                name: prototype.name || '',
                color: prototype.color,
                existingPrototypeId: prototype.id
              });
            }}
            initialName={abstractionPrompt.name}
            initialColor={abstractionPrompt.color}
            title={`Add ${abstractionPrompt.direction === 'above' ? 'Above' : 'Below'}`}
            subtitle={`Create a ${abstractionPrompt.direction === 'above' ? 'more specific' : 'more generic'} node in the abstraction chain`}
            abstractionDirection={abstractionPrompt.direction}
          />
        );
      })()}

    </Profiler>
  );
}
