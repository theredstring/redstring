import React, { useMemo, useCallback } from 'react';
import UnifiedBottomControlPanel from './UnifiedBottomControlPanel';
import useGraphStore from './store/graphStore.js';
import { CONNECTION_DEFAULT_COLOR } from './constants';

const ConnectionControlPanel = ({
  selectedEdge,
  selectedEdges = [],
  isVisible = true,
  typeListOpen = false,
  className = '',
  onAnimationComplete,
  onClose,
  onOpenConnectionDialog,
  onStartHurtleAnimationFromPanel,
  onActionHoverChange,
  onAskWizard,
  wizardEnabled = false
}) => {
  const edgePrototypesMap = useGraphStore((state) => state.edgePrototypes);
  const nodePrototypesMap = useGraphStore((state) => state.nodePrototypes);
  const graphsMap = useGraphStore((state) => state.graphs);
  const activeGraphId = useGraphStore((state) => state.activeGraphId);
  
  // Get instances from the active graph
  const instances = useMemo(() => {
    if (!activeGraphId || !graphsMap) return null;
    return graphsMap.get(activeGraphId)?.instances;
  }, [activeGraphId, graphsMap]);

  // Orient a connection so the endpoint that sits further LEFT on the canvas is
  // shown on the left of the control panel. Two connections pointing opposite
  // ways read identically once both are laid out left-to-right by canvas
  // position — our brains can't easily re-map a reversed left→right order.
  // Arrows are keyed by node id (directionality.arrowsToward), so swapping the
  // display order of the two endpoints is lossless. Ties keep the semantic
  // source on the left.
  const orientEndpoints = useCallback((edge) => {
    const srcId = edge.sourceId;
    const dstId = edge.destinationId || edge.targetId;
    const srcNode = instances?.get(srcId) || null;
    const dstNode = instances?.get(dstId) || null;
    const srcX = srcNode?.x ?? 0;
    const dstX = dstNode?.x ?? 0;
    if (dstX < srcX) {
      return { leftId: dstId, rightId: srcId, leftNode: dstNode, rightNode: srcNode };
    }
    return { leftId: srcId, rightId: dstId, leftNode: srcNode, rightNode: dstNode };
  }, [instances]);

  // Convert edges to triples format for UnifiedBottomControlPanel
  const triples = useMemo(() => {
    const edges = selectedEdge ? [selectedEdge] : selectedEdges;
    if (!edges || edges.length === 0 || !instances) return [];


    return edges.map(edge => {
      const { leftId, rightId, leftNode: sourceNode, rightNode: targetNode } = orientEndpoints(edge);
      const sourcePrototype = sourceNode ? nodePrototypesMap.get(sourceNode.prototypeId) : null;
      const targetPrototype = targetNode ? nodePrototypesMap.get(targetNode.prototypeId) : null;
      // Use EXACT same logic as ConnectionBrowser (lines 468-481)
      let connectionName = 'Connection';
      let connectionColor = '#000000'; // Default to black for Connection prototype
      let predicateId = edge.typeNodeId || edge.prototypeId;
      
      // First try to get name and color from edge's definition node (if it has one)
      if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
        const definitionNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
        if (definitionNode) {
          connectionName = definitionNode.name || 'Connection';
          connectionColor = definitionNode.color || '#000000'; // Default to black
          predicateId = edge.definitionNodeIds[0];
        }
      } else if (edge.typeNodeId) {
        // Fallback to edge prototype type
        const edgePrototype = nodePrototypesMap.get(edge.typeNodeId);
        if (edgePrototype) {
          connectionName = edgePrototype.name || 'Connection';
          connectionColor = edgePrototype.color || '#000000'; // Default to black
        }
      }

      // Calculate arrow states from directionality. Left/right are canvas-order
      // positions (see orientEndpoints), not the edge's semantic source/target.
      const arrowsToward = edge.directionality?.arrowsToward || new Set();
      const hasLeftArrow = arrowsToward.has(leftId); // Arrow points TO the left (leftmost-on-canvas) node
      const hasRightArrow = arrowsToward.has(rightId); // Arrow points TO the right (rightmost-on-canvas) node

      // Ensure we have a proper string ID
      const edgeId = typeof edge.id === 'string' ? edge.id : edge.id?.id || String(edge.id);

      const triple = {
        id: edgeId,
        sourceId: leftId,
        destinationId: rightId,
        color: connectionColor,
        directionality: edge.directionality,
        subject: {
          id: sourceNode?.id,
          name: sourcePrototype?.name || sourceNode?.name || 'Node',
          color: sourcePrototype?.color || sourceNode?.color || '#800000'
        },
        predicate: {
          id: predicateId,
          name: connectionName,
          color: connectionColor
        },
        object: {
          id: targetNode?.id,
          name: targetPrototype?.name || targetNode?.name || 'Node',
          color: targetPrototype?.color || targetNode?.color || '#800000'
        },
        hasLeftArrow,
        hasRightArrow
      };


      return triple;
    });
  }, [selectedEdge, selectedEdges, edgePrototypesMap, nodePrototypesMap, instances, orientEndpoints]);

  // Toggle the arrow on the endpoint currently shown on the LEFT of the panel.
  // Which store-node that maps to depends on canvas orientation (orientEndpoints),
  // so resolve the left node id from the edge rather than assuming edge.sourceId.
  const handleToggleLeftArrow = (tripleId) => {
    const updateEdge = useGraphStore.getState().updateEdge;
    const edges = selectedEdge ? [selectedEdge] : selectedEdges;
    const edge = edges.find(e => e.id === tripleId || String(e.id) === String(tripleId)) || edges[0];
    if (!edge) return;
    const { leftId } = orientEndpoints(edge);

    updateEdge(edge.id, (draft) => {
      if (!draft.directionality) {
        draft.directionality = { arrowsToward: new Set() };
      }
      if (!draft.directionality.arrowsToward) {
        draft.directionality.arrowsToward = new Set();
      }

      if (draft.directionality.arrowsToward.has(leftId)) {
        draft.directionality.arrowsToward.delete(leftId);
      } else {
        draft.directionality.arrowsToward.add(leftId);
      }
    });
  };

  // Toggle the arrow on the endpoint currently shown on the RIGHT of the panel.
  const handleToggleRightArrow = (tripleId) => {
    const updateEdge = useGraphStore.getState().updateEdge;
    const edges = selectedEdge ? [selectedEdge] : selectedEdges;
    const edge = edges.find(e => e.id === tripleId || String(e.id) === String(tripleId)) || edges[0];
    if (!edge) return;
    const { rightId } = orientEndpoints(edge);

    updateEdge(edge.id, (draft) => {
      if (!draft.directionality) {
        draft.directionality = { arrowsToward: new Set() };
      }
      if (!draft.directionality.arrowsToward) {
        draft.directionality.arrowsToward = new Set();
      }

      if (draft.directionality.arrowsToward.has(rightId)) {
        draft.directionality.arrowsToward.delete(rightId);
      } else {
        draft.directionality.arrowsToward.add(rightId);
      }
    });
  };

  const handlePredicateClick = (tripleId) => {
    if (onOpenConnectionDialog) {
      // Find the actual edge ID from the selected edges
      const edges = selectedEdge ? [selectedEdge] : selectedEdges;
      const actualEdgeId = edges[0]?.id || tripleId;
      onOpenConnectionDialog(actualEdgeId);
    }
  };

  const handleDelete = () => {
    const removeEdge = useGraphStore.getState().removeEdge;
    
    // Delete selected edge(s)
    if (selectedEdge) {
      removeEdge(selectedEdge.id);
    }
    
    if (selectedEdges && selectedEdges.length > 0) {
      selectedEdges.forEach(edge => {
        if (edge && edge.id) {
          removeEdge(edge.id);
        }
      });
    }
    
    // Close the panel
    if (onClose) {
      onClose();
    }
  };

  const handleAdd = () => {
    // Open connection dialog to create a new connection type
    if (onOpenConnectionDialog && selectedEdge) {
      onOpenConnectionDialog(selectedEdge.id);
    }
  };

  const handleUp = () => {
    // Open definition of the connection type
    const edges = selectedEdge ? [selectedEdge] : selectedEdges;
    if (edges.length === 0) return;
    
    const edge = edges[0];
    let definitionNodeId = null;
    
    // Check definitionNodeIds first (for custom connection types)
    if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
      definitionNodeId = edge.definitionNodeIds[0];
    } else if (edge.typeNodeId) {
      // Fallback to typeNodeId (for base connection type)
      definitionNodeId = edge.typeNodeId;
    }
    
    if (definitionNodeId && onStartHurtleAnimationFromPanel) {
      // Get the prototype to find its definition graphs
      const prototype = nodePrototypesMap.get(definitionNodeId);
      if (prototype && prototype.definitionGraphIds && prototype.definitionGraphIds.length > 0) {
        const graphIdToOpen = prototype.definitionGraphIds[0];
        // Use a mock rect for the animation start point
        const mockRect = { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 40, height: 40 };
        onStartHurtleAnimationFromPanel(definitionNodeId, graphIdToOpen, definitionNodeId, mockRect);
      } else {
        // Create a new definition graph for this connection type
        const createAndAssignGraphDefinitionWithoutActivation = useGraphStore.getState().createAndAssignGraphDefinitionWithoutActivation;
        createAndAssignGraphDefinitionWithoutActivation(definitionNodeId);
        
        setTimeout(() => {
          const updatedPrototype = useGraphStore.getState().nodePrototypes.get(definitionNodeId);
          if (updatedPrototype?.definitionGraphIds?.length > 0) {
            const newGraphId = updatedPrototype.definitionGraphIds[updatedPrototype.definitionGraphIds.length - 1];
            const mockRect = { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 40, height: 40 };
            onStartHurtleAnimationFromPanel(definitionNodeId, newGraphId, definitionNodeId, mockRect);
          }
        }, 50);
      }
    }
  };

  const handleOpenInPanel = () => {
    // Open the connection type in the right panel
    const edges = selectedEdge ? [selectedEdge] : selectedEdges;
    if (edges.length === 0) return;
    
    const edge = edges[0];
    let definitionNodeId = null;
    
    // Check definitionNodeIds first (for custom connection types)
    if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
      definitionNodeId = edge.definitionNodeIds[0];
    } else if (edge.typeNodeId) {
      // Fallback to typeNodeId (for base connection type)
      definitionNodeId = edge.typeNodeId;
    }
    
    if (definitionNodeId) {
      const openRightPanelNodeTab = useGraphStore.getState().openRightPanelNodeTab;
      const prototype = nodePrototypesMap.get(definitionNodeId);
      openRightPanelNodeTab(definitionNodeId, prototype?.name || 'Connection');
    }
  };

  const handleAskWizard = () => {
    if (!onAskWizard) return;
    const edges = selectedEdge ? [selectedEdge] : selectedEdges;
    if (!edges || edges.length === 0) return;
    onAskWizard(edges);
  };

  return (
    <UnifiedBottomControlPanel
      mode="connections"
      isVisible={isVisible}
      typeListOpen={typeListOpen}
      className={className}
      onAnimationComplete={onAnimationComplete}

      // Connection mode props
      triples={triples}
      onToggleLeftArrow={handleToggleLeftArrow}
      onToggleRightArrow={handleToggleRightArrow}
      onPredicateClick={handlePredicateClick}

      // Pie menu button handlers
      onDelete={handleDelete}
      onAdd={handleAdd}
      onUp={handleUp}
      onOpenInPanel={handleOpenInPanel}
      onAskWizard={handleAskWizard}
      wizardEnabled={wizardEnabled}
      onActionHoverChange={onActionHoverChange}
      onDismiss={onClose}
    />
  );
};

export default ConnectionControlPanel;
