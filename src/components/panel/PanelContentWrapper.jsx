import React, { useState, useMemo, memo } from 'react';
import { THUMBNAIL_MAX_DIMENSION } from '../../constants.js';
import { generateThumbnail } from '../../utils.js';
import SharedPanelContent from './SharedPanelContent.jsx';
import useGraphStore from "../../store/graphStore.jsx";
import ColorPicker from '../../ColorPicker.jsx';
import PanelColorPickerPortal from '../PanelColorPickerPortal.jsx';

/**
 * Wrapper component that handles data fetching and action binding
 * for both home and node tabs
 * 
 * PERFORMANCE: This component is memoized to prevent re-renders during zoom/pan
 */
const PanelContentWrapper = memo(({
  tabType, // 'home' | 'node'
  nodeId = null,
  storeActions,
  onFocusChange,
  onTypeSelect,
  onStartHurtleAnimationFromPanel,
  isUltraSlim = false
}) => {
  // #region agent log
  // Agent log removed
  // #endregion

  // PERFORMANCE FIX: Use individual selectors instead of destructuring entire store
  // This prevents re-renders when viewport state (panOffset/zoomLevel) changes
  const nodePrototypes = useGraphStore(state => state.nodePrototypes);
  const activeGraphId = useGraphStore(state => state.activeGraphId);
  const nodeDefinitionIndices = useGraphStore(state => state.nodeDefinitionIndices);

  // CRITICAL PERFORMANCE FIX: Don't subscribe to graphs changes!
  // The graphs Map contains panOffset/zoomLevel which change during zoom.
  // Instead, read graphs non-reactively using getState() since we don't need
  // to re-render when only viewport state changes.
  // The component re-renders when activeGraphId or nodePrototypes change, which is when we need fresh graph data.
  const graphs = useMemo(() => {
    return useGraphStore.getState().graphs;
  }, [activeGraphId, nodePrototypes]); // Re-read graphs when active graph or prototypes change

  // Color picker state
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [colorPickerPosition, setColorPickerPosition] = useState({ x: 0, y: 0 });
  const [colorPickerNodeId, setColorPickerNodeId] = useState(null);

  // Determine which node data to use based on tab type
  const getNodeData = () => {
    if (tabType === 'home') {
      // For home tab, we need either a defining node OR just graph data
      // Don't return null if we have an active graph, even without a defining node
      if (!graphs || !activeGraphId) return null;
      const currentGraph = graphs.get(activeGraphId);
      if (!currentGraph) return null;

      const definingNodeId = currentGraph?.definingNodeIds?.[0];
      if (definingNodeId && nodePrototypes && nodePrototypes.has(definingNodeId)) {
        // Verify the defining node actually exists
        return nodePrototypes.get(definingNodeId);
      }

      // If no defining node or defining node doesn't exist, create a fallback node data object from the graph
      return {
        id: activeGraphId,
        name: currentGraph.name || 'Untitled Graph',
        description: currentGraph.description || '',
        color: currentGraph.color || '#8B0000',
        typeNodeId: null,
        definitionGraphIds: [activeGraphId]
      };
    } else if (tabType === 'node' && nodeId && nodePrototypes) {
      // For node tab, use the specific node
      return nodePrototypes.get(nodeId);
    }
    return null;
  };

  // Get graph data
  const getGraphData = () => {
    return graphs && activeGraphId ? graphs.get(activeGraphId) : null;
  };

  // Get nodes for the current context
  const getActiveGraphNodes = () => {
    // #region agent log
    const startTime = performance.now();
    // Agent log removed
    // #endregion
    let targetGraphId = activeGraphId;

    // For node tabs, show components from the node's definition graph if it has one
    if (tabType === 'node' && nodeId && nodePrototypes) {
      const nodeData = nodePrototypes.get(nodeId);
      if (nodeData && nodeData.definitionGraphIds && nodeData.definitionGraphIds.length > 0) {
        // Get the context-specific definition index
        const contextKey = `${nodeId}-${activeGraphId}`;
        const currentIndex = nodeDefinitionIndices?.get(contextKey) || 0;
        targetGraphId = nodeData.definitionGraphIds[currentIndex] || nodeData.definitionGraphIds[0];
      } else {
        // Node has no definition graphs - return empty array instead of falling back to active graph
        return [];
      }
    }

    if (!graphs) return [];
    const targetGraph = graphs.get(targetGraphId);
    if (!targetGraph || !targetGraph.instances) return [];

    // Convert instances to hydrated nodes
    const result = Array.from(targetGraph.instances.values())
      .map(instance => {
        const prototype = nodePrototypes?.get(instance.prototypeId);
        if (!prototype) return null;

        // Ensure prototype data (including name) is preserved, instance data only adds spatial properties
        return {
          id: instance.id,
          prototypeId: instance.prototypeId,
          name: prototype.name || 'Unnamed Component', // Always preserve prototype name
          description: prototype.description || '',
          color: prototype.color || '#8B0000', // Assuming NODE_DEFAULT_COLOR is defined elsewhere or needs to be imported
          // Instance spatial data
          x: instance.x || 0,
          y: instance.y || 0,
          scale: instance.scale || 1,
          // Preserve other prototype properties
          typeNodeId: prototype.typeNodeId,
          definitionGraphIds: prototype.definitionGraphIds || []
        };
      })
      .filter(Boolean);
    // #region agent log
    // Agent log removed
    // #endregion
    return result;
  };

  const nodeData = getNodeData();
  const graphData = getGraphData();
  const activeGraphNodes = getActiveGraphNodes();
  const componentOfNodes = (() => {
    // Support both home and node tabs
    if (!nodeData?.id || !graphs || !nodePrototypes) return [];

    const targetPrototypeId = nodeData.id;
    const containingGraphIds = new Set();

    graphs.forEach((graph, graphId) => {
      if (!graph?.instances) return;
      for (const instance of graph.instances.values()) {
        if (instance.prototypeId === targetPrototypeId) {
          containingGraphIds.add(graphId);
          break;
        }
      }
    });

    if (containingGraphIds.size === 0) return [];

    const parentNodes = new Map();

    nodePrototypes.forEach((prototype, prototypeId) => {
      if (prototypeId === targetPrototypeId) return;
      const definitionIds = Array.isArray(prototype.definitionGraphIds) ? prototype.definitionGraphIds : [];
      if (definitionIds.some((id) => containingGraphIds.has(id))) {
        parentNodes.set(prototypeId, {
          id: prototypeId,
          prototypeId,
          name: prototype.name || 'Unnamed Component',
          description: prototype.description || '',
          color: prototype.color || '#8B0000',
          typeNodeId: prototype.typeNodeId,
          definitionGraphIds: definitionIds
        });
      }
    });

    containingGraphIds.forEach((graphId) => {
      const graph = graphs.get(graphId);
      if (!graph) return;
      const definingNodeIds = Array.isArray(graph.definingNodeIds) ? graph.definingNodeIds : [];
      definingNodeIds.forEach((definingNodeId) => {
        if (!definingNodeId || definingNodeId === targetPrototypeId) return;
        if (parentNodes.has(definingNodeId)) return;
        if (!nodePrototypes.has(definingNodeId)) return;
        const prototype = nodePrototypes.get(definingNodeId);
        parentNodes.set(definingNodeId, {
          id: definingNodeId,
          prototypeId: definingNodeId,
          name: prototype.name || 'Unnamed Component',
          description: prototype.description || '',
          color: prototype.color || '#8B0000',
          typeNodeId: prototype.typeNodeId,
          definitionGraphIds: Array.isArray(prototype.definitionGraphIds) ? prototype.definitionGraphIds : []
        });
      });
    });

    return Array.from(parentNodes.values());
  })();

  // Check if this node is the defining node of the current active graph
  const isDefiningNodeOfCurrentGraph = activeGraphId && graphData &&
    graphData.definingNodeIds && graphData.definingNodeIds.includes(nodeData?.id);

  // Action handlers
  const handleNodeUpdate = (updatedData) => {
    if (nodeData?.id) {
      storeActions.updateNodePrototype(nodeData.id, draft => {
        Object.assign(draft, updatedData);
      });
    }
  };

  const handleImageAdd = (nodeId) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (loadEvent) => {
        const fullImageSrc = loadEvent.target?.result;
        if (typeof fullImageSrc !== 'string') return;

        const img = new Image();
        img.onload = async () => {
          try {
            const aspectRatio = (img.naturalHeight > 0 && img.naturalWidth > 0) ? (img.naturalHeight / img.naturalWidth) : 1;
            const thumbSrc = await generateThumbnail(fullImageSrc, THUMBNAIL_MAX_DIMENSION);
            const nodeDataToSave = {
              imageSrc: fullImageSrc,
              thumbnailSrc: thumbSrc,
              imageAspectRatio: aspectRatio
            };
            storeActions.updateNodePrototype(nodeId, draft => {
              Object.assign(draft, nodeDataToSave);
            });
          } catch (error) {
            console.error("Image save failed:", error);
          }
        };
        img.src = fullImageSrc;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleColorPickerOpen = (event) => {
    event.stopPropagation();
    const nodeId = nodeData?.id;
    if (!nodeId) return;

    // If already open for the same node, close it (toggle behavior)
    if (colorPickerVisible && colorPickerNodeId === nodeId) {
      setColorPickerVisible(false);
      setColorPickerNodeId(null);
      return;
    }

    // Open color picker - align with the icon position
    const rect = event.currentTarget.getBoundingClientRect();
    setColorPickerPosition({ x: rect.right - 10, y: rect.top - 5 });
    setColorPickerNodeId(nodeId);
    setColorPickerVisible(true);
  };

  const handleColorChange = (newColor) => {
    if (colorPickerNodeId && storeActions?.updateNodePrototype) {
      storeActions.updateNodePrototype(colorPickerNodeId, draft => {
        draft.color = newColor;
      });
    }
  };

  const handleColorPickerClose = () => {
    setColorPickerVisible(false);
    setColorPickerNodeId(null);
  };

  const handleOpenNode = (nodeId) => {
    storeActions.openRightPanelNodeTab(nodeId);
  };

  const handleExpandNode = (event) => {
    const nodeId = nodeData?.id;
    if (!nodeId) return;

    // Get the icon's bounding rectangle for the hurtle animation
    const iconRect = event.currentTarget.getBoundingClientRect();

    // Same logic as PieMenu expand but using hurtle animation from panel
    if (nodeData.definitionGraphIds && nodeData.definitionGraphIds.length > 0) {
      // Node has existing definition(s) - start hurtle animation to first one
      const graphIdToOpen = nodeData.definitionGraphIds[0];
      if (onStartHurtleAnimationFromPanel) {
        onStartHurtleAnimationFromPanel(nodeId, graphIdToOpen, nodeId, iconRect);
      } else if (storeActions?.openGraphTabAndBringToTop) {
        // Fallback if hurtle animation not available
        storeActions.openGraphTabAndBringToTop(graphIdToOpen, nodeId);
      }
    } else {
      // Node has no definitions - create one first, then start hurtle animation
      if (storeActions?.createAndAssignGraphDefinitionWithoutActivation) {
        const sourceGraphId = activeGraphId; // Capture current graph before it changes
        storeActions.createAndAssignGraphDefinitionWithoutActivation(nodeId);

        setTimeout(() => {
          const currentState = useGraphStore.getState();
          const updatedNodeData = currentState.nodePrototypes.get(nodeId);
          if (updatedNodeData?.definitionGraphIds?.length > 0) {
            const newGraphId = updatedNodeData.definitionGraphIds[updatedNodeData.definitionGraphIds.length - 1];
            if (onStartHurtleAnimationFromPanel) {
              onStartHurtleAnimationFromPanel(nodeId, newGraphId, nodeId, iconRect);
            }
          }
        }, 50);
      }
    }
  };

  const handleTypeSelect = (nodeId) => {
    if (onTypeSelect) {
      onTypeSelect(nodeId);
    }
  };

  const handleMaterializeConnection = (connection) => {
    console.log('[PanelContentWrapper] Materializing semantic connection:', connection);

    const { subject, predicate, object, subjectColor, objectColor } = connection;

    // Find or create subject node prototype (REUSE if exists!)
    let subjectPrototypeId = null;
    for (const [id, prototype] of nodePrototypes.entries()) {
      if (prototype.name.toLowerCase() === subject.toLowerCase()) {
        subjectPrototypeId = id;
        console.log(`[PanelContentWrapper] ✓ Found existing PROTOTYPE for subject: "${subject}" (${id})`);
        break;
      }
    }

    // If subject node doesn't exist, create it
    if (!subjectPrototypeId) {
      subjectPrototypeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.log(`[PanelContentWrapper] → Creating NEW prototype for subject: "${subject}" (${subjectPrototypeId})`);
      storeActions.addNodePrototype({
        id: subjectPrototypeId,
        name: subject,
        description: `Semantic node: ${subject}`,
        color: subjectColor || '#8B0000',
        definitionGraphIds: []
      });
    }

    // Find or create object node prototype (REUSE if exists!)
    let objectPrototypeId = null;
    for (const [id, prototype] of nodePrototypes.entries()) {
      if (prototype.name.toLowerCase() === object.toLowerCase()) {
        objectPrototypeId = id;
        console.log(`[PanelContentWrapper] ✓ Found existing PROTOTYPE for object: "${object}" (${id})`);
        break;
      }
    }

    // If object node doesn't exist, create it
    if (!objectPrototypeId) {
      objectPrototypeId = `node-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`;
      console.log(`[PanelContentWrapper] → Creating NEW prototype for object: "${object}" (${objectPrototypeId})`);
      storeActions.addNodePrototype({
        id: objectPrototypeId,
        name: object,
        description: `Semantic node: ${object}`,
        color: objectColor || '#8B0000',
        definitionGraphIds: []
      });
    }

    // Add instances to current graph if they don't exist
    const currentGraph = graphs.get(activeGraphId);
    if (currentGraph) {
      let subjectInstanceId = null;
      let objectInstanceId = null;

      // Check if instances already exist in current graph
      // IMPORTANT: Only create NEW instances if the prototype isn't already in this graph
      for (const [instanceId, instance] of currentGraph.instances.entries()) {
        if (instance.prototypeId === subjectPrototypeId) {
          subjectInstanceId = instanceId;
          console.log(`[PanelContentWrapper] Found existing subject instance: ${subject} (${instanceId})`);
        }
        if (instance.prototypeId === objectPrototypeId) {
          objectInstanceId = instanceId;
          console.log(`[PanelContentWrapper] Found existing object instance: ${object} (${instanceId})`);
        }
      }

      // Only create subject instance if it doesn't exist in current graph
      if (!subjectInstanceId) {
        subjectInstanceId = `instance-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[PanelContentWrapper] Creating NEW subject instance: ${subject} (${subjectInstanceId})`);
        storeActions.addNodeInstance(activeGraphId, subjectPrototypeId, {
          x: 100,
          y: 100,
          scale: 1
        }, subjectInstanceId);
      }

      // Only create object instance if it doesn't exist in current graph
      if (!objectInstanceId) {
        objectInstanceId = `instance-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[PanelContentWrapper] Creating NEW object instance: ${object} (${objectInstanceId})`);
        storeActions.addNodeInstance(activeGraphId, objectPrototypeId, {
          x: 300,
          y: 100,
          scale: 1
        }, objectInstanceId);
      }

      // Create edge between instances
      // Dedupe: avoid duplicate edges with same S–P–O in current graph
      try {
        const edgesMap = useGraphStore.getState().edges;
        const hasDuplicate = Array.isArray(currentGraph.edgeIds) && currentGraph.edgeIds.some((eid) => {
          const e = edgesMap.get(eid);
          return e && e.sourceId === subjectInstanceId && e.destinationId === objectInstanceId && e.label === predicate;
        });

        if (hasDuplicate) {
          console.log(`[PanelContentWrapper] ⚠ Edge already exists: "${subject}" → "${predicate}" → "${object}" - SKIPPED`);
        } else {
          const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          console.log(`[PanelContentWrapper] ➕ Creating edge: "${subject}" → "${predicate}" → "${object}" (${edgeId})`);
          storeActions.addEdge(activeGraphId, {
            id: edgeId,
            sourceId: subjectInstanceId,
            destinationId: objectInstanceId,
            label: predicate,
            color: '#666666'
          });
        }
      } catch { }

      console.log('[PanelContentWrapper] Created semantic connection in graph:', {
        subjectPrototypeId,
        objectPrototypeId,
        subjectInstanceId,
        objectInstanceId,
        edgeId,
        predicate
      });
    }
  };

  if (!nodeData) {
    // Provide more specific error messages
    let errorMessage = '';
    if (tabType === 'home') {
      if (!activeGraphId) {
        errorMessage = 'No active graph selected...';
      } else if (!graphs || !graphs.has(activeGraphId)) {
        errorMessage = 'Active graph not found in store...';
      } else {
        errorMessage = 'Graph data is incomplete...';
      }
    } else {
      errorMessage = 'Node data not found...';
    }

    return (
      <div style={{ padding: '10px', color: '#aaa', fontFamily: "'EmOne', sans-serif" }}>
        {errorMessage}
      </div>
    );
  }

  return (
    <>
      <SharedPanelContent
        nodeData={nodeData}
        graphData={graphData}
        activeGraphNodes={activeGraphNodes}
        componentOfNodes={componentOfNodes}
        nodePrototypes={nodePrototypes}
        onNodeUpdate={handleNodeUpdate}
        onImageAdd={handleImageAdd}
        onColorChange={handleColorPickerOpen}
        onOpenNode={handleOpenNode}
        onExpandNode={handleExpandNode}
        onTypeSelect={handleTypeSelect}
        onMaterializeConnection={handleMaterializeConnection}
        isHomeTab={tabType === 'home'}
        showExpandButton={true}
        expandButtonDisabled={isDefiningNodeOfCurrentGraph}
        isUltraSlim={isUltraSlim}
      />

      {/* Color Picker Component - Rendered in Portal to prevent clipping */}
      <PanelColorPickerPortal
        isVisible={colorPickerVisible}
        onClose={handleColorPickerClose}
        onColorChange={handleColorChange}
        currentColor={colorPickerNodeId && nodePrototypes ? nodePrototypes.get(colorPickerNodeId)?.color || '#8B0000' : '#8B0000'}
        position={colorPickerPosition}
        direction="down-left"
      />
    </>
  );
}); // End of memo wrapper

export default PanelContentWrapper;
