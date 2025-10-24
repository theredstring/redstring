import React, { useMemo } from 'react';
import UnifiedBottomControlPanel from './UnifiedBottomControlPanel';
import useGraphStore from './store/graphStore.jsx';
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
  onActionHoverChange
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

  // Convert edges to triples format for UnifiedBottomControlPanel
  const triples = useMemo(() => {
    const edges = selectedEdge ? [selectedEdge] : selectedEdges;
    if (!edges || edges.length === 0 || !instances) return [];


    return edges.map(edge => {
      const sourceNode = instances.get(edge.sourceId);
      const targetNode = instances.get(edge.destinationId || edge.targetId);
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

      // Calculate arrow states from directionality
      const arrowsToward = edge.directionality?.arrowsToward || new Set();
      const hasLeftArrow = arrowsToward.has(edge.sourceId); // Arrow points TO source (left side)
      const hasRightArrow = arrowsToward.has(edge.destinationId || edge.targetId); // Arrow points TO target (right side)

      // Ensure we have a proper string ID
      const edgeId = typeof edge.id === 'string' ? edge.id : edge.id?.id || String(edge.id);
      
      const triple = {
        id: edgeId,
        sourceId: edge.sourceId,
        destinationId: edge.destinationId || edge.targetId,
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
  }, [selectedEdge, selectedEdges, edgePrototypesMap, nodePrototypesMap, instances]);

  const handleToggleLeftArrow = (tripleId) => {
    const updateEdge = useGraphStore.getState().updateEdge;
    // Use the actual edge ID, not the definition node ID
    const edges = selectedEdge ? [selectedEdge] : selectedEdges;
    const actualEdgeId = edges[0]?.id || tripleId;
    
    updateEdge(actualEdgeId, (draft) => {
      if (!draft.directionality) {
        draft.directionality = { arrowsToward: new Set() };
      }
      if (!draft.directionality.arrowsToward) {
        draft.directionality.arrowsToward = new Set();
      }
      
      // Toggle arrow pointing TO source (left side)
      if (draft.directionality.arrowsToward.has(draft.sourceId)) {
        draft.directionality.arrowsToward.delete(draft.sourceId);
      } else {
        draft.directionality.arrowsToward.add(draft.sourceId);
      }
    });
  };

  const handleToggleRightArrow = (tripleId) => {
    const updateEdge = useGraphStore.getState().updateEdge;
    // Use the actual edge ID, not the definition node ID
    const edges = selectedEdge ? [selectedEdge] : selectedEdges;
    const actualEdgeId = edges.find(e => e.id === tripleId || String(e.id) === String(tripleId))?.id || tripleId;
    
    updateEdge(actualEdgeId, (draft) => {
      if (!draft.directionality) {
        draft.directionality = { arrowsToward: new Set() };
      }
      if (!draft.directionality.arrowsToward) {
        draft.directionality.arrowsToward = new Set();
      }
      
      // Toggle arrow pointing TO target (right side)
      if (draft.directionality.arrowsToward.has(draft.destinationId || draft.targetId)) {
        draft.directionality.arrowsToward.delete(draft.destinationId || draft.targetId);
      } else {
        draft.directionality.arrowsToward.add(draft.destinationId || draft.targetId);
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
      onActionHoverChange={onActionHoverChange}
    />
  );
};

export default ConnectionControlPanel;
