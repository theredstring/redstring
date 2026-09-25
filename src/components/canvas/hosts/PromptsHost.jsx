/**
 * The canvas name prompts (P5.06a): swap, new Thing, connection name, node-group
 * name and Add Above/Below, one UnifiedSelector at a time. Moved verbatim from
 * NodeCanvas, which passes the prompts' state and handlers as `ctx`.
 */
import { Profiler, useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import UnifiedSelector from '../../../UnifiedSelector';
import { v4 as uuidv4 } from 'uuid';
import { NODE_DEFAULT_COLOR } from '../../../constants';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';

export default function PromptsHost({ ctx }) {
  const {
    nodeNamePrompt, connectionNamePrompt, abstractionPrompt, nodeGroupPrompt, swapPrompt, setSwapPrompt,
    leftPanelExpanded, rightPanelExpanded, setDialogColorPickerVisible, storeActions, performInstanceSwap,
    handleClosePrompt, plusSign, setPlusSign, setNodeNamePrompt, handleNodeSelection,
    finalizeConnectionSuggestion, setConnectionNamePrompt, suggestEdgeArrowDirection, setNodeGroupPrompt,
    activeGraphId, setSelectedGroup, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow,
    setNodeControlPanelVisible, finalizeAbstractionSuggestion, handleAbstractionSubmit,
  } = ctx;

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
