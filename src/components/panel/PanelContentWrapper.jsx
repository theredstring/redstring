import React, { useState, useMemo, memo } from 'react';
import { THUMBNAIL_MAX_DIMENSION } from '../../constants.js';
import { generateThumbnail, loadImageFileAsDataUrl, getDefinitionDescription } from '../../utils.js';
import SharedPanelContent from './SharedPanelContent.jsx';
import useGraphStore from "../../store/graphStore.js";
import useCanvasUIStore from '../../store/canvasUIStore.js';
import useImageCache from '../../services/imageCache.js';
import ColorPicker from '../../ColorPicker.jsx';
import PanelColorPickerPortal from '../PanelColorPickerPortal.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { requestDeleteDefinition } from '../canvas/dialogs/deleteDefinition.js';

/**
 * Wrapper component that handles data fetching and action binding
 * for both home and node tabs
 * 
 * PERFORMANCE: This component is memoized to prevent re-renders during zoom/pan
 */
const PanelContentWrapper = memo(({
  tabType, // 'home' | 'node' | 'graph'
  nodeId = null,
  graphId = null, // 'graph' tabs: the Web the tab is about
  storeActions,
  onTypeSelect,
  onStartHurtleAnimationFromPanel,
  isUltraSlim = false
}) => {
  const theme = useTheme();
  // #region agent log
  // Agent log removed
  // #endregion

  // PERFORMANCE FIX: Use individual selectors instead of destructuring entire store
  // This prevents re-renders when viewport state (panOffset/zoomLevel) changes
  const nodePrototypes = useGraphStore(state => state.nodePrototypes);
  const activeGraphId = useGraphStore(state => state.activeGraphId);
  // canvasUIStore, where NodeCanvas keeps it. graphStore never had this field, so
  // the component list always showed the first definition (B-11, P2.03).
  const nodeDefinitionIndices = useCanvasUIStore(state => state.nodeDefinitionIndices);

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

  // The Web a home or Web tab is about: the open one, or the tab's own.
  const subjectWebId = tabType === 'home' ? activeGraphId : (tabType === 'graph' ? graphId : null);

  // Determine which node data to use based on tab type
  const getNodeData = () => {
    if (tabType === 'home' || tabType === 'graph') {
      // A Web's page is its Thing's page, opened on that Web. A Web no Thing
      // defines stands in for its own Thing.
      if (!graphs || !subjectWebId) return null;
      const web = graphs.get(subjectWebId);
      if (!web) return null;

      // A Web tab remembers the Thing it was opened from; the Web may have more
      // than one defining Thing.
      const definingIds = [nodeId, ...(web.definingNodeIds || [])].filter(Boolean);
      const definingNodeId = definingIds.find((id) => (
        nodePrototypes?.get(id)?.definitionGraphIds?.includes(subjectWebId)
      )) || (web.definingNodeIds || []).find((id) => nodePrototypes?.has(id));
      if (definingNodeId) return nodePrototypes.get(definingNodeId);

      return {
        id: subjectWebId,
        name: web.name || 'New Thing',
        description: web.description || '',
        color: web.color || theme.accent.primary,
        typeNodeId: null,
        definitionGraphIds: [subjectWebId]
      };
    } else if (tabType === 'node' && nodeId && nodePrototypes) {
      // For node tab, use the specific node
      return nodePrototypes.get(nodeId);
    }
    return null;
  };

  // Get graph data
  const getGraphData = () => {
    const id = subjectWebId || activeGraphId;
    return graphs && id ? graphs.get(id) : null;
  };

  // The definition "you're on": the tab's own Web, then the open Web when it
  // is one of this Thing's, then the one the canvas previews for it here.
  const getCurrentDefinitionId = (prototype) => {
    const defIds = Array.isArray(prototype?.definitionGraphIds) ? prototype.definitionGraphIds : [];
    if (defIds.length === 0) return null;
    if (subjectWebId && defIds.includes(subjectWebId)) return subjectWebId;
    if (defIds.includes(activeGraphId)) return activeGraphId;
    const index = nodeDefinitionIndices?.get(`${prototype.id}-${activeGraphId}`) ?? 0;
    return defIds[Math.min(Math.max(index, 0), defIds.length - 1)];
  };

  // Stepping through definitions here is the tab's own business: it never moves
  // the canvas, and it is gone when the tab is left (Panel keys this component
  // per tab), so every visit opens on the definition you're on.
  const [browsedDefinitionId, setBrowsedDefinitionId] = useState(null);
  const getShownDefinitionId = (prototype) => {
    const defIds = Array.isArray(prototype?.definitionGraphIds) ? prototype.definitionGraphIds : [];
    if (browsedDefinitionId && defIds.includes(browsedDefinitionId)) return browsedDefinitionId;
    return getCurrentDefinitionId(prototype);
  };

  // Get nodes for the current context
  const getActiveGraphNodes = () => {
    // #region agent log
    const startTime = performance.now();
    // Agent log removed
    // #endregion
    // The components of the definition Web Definitions is showing. A Thing with
    // no definitions has none; a Web with no Thing lists its own.
    const nodeData = getNodeData();
    const targetGraphId = getShownDefinitionId(nodeData);
    if (!targetGraphId) return [];

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
          color: prototype.color || theme.accent.primary, // Assuming NODE_DEFAULT_COLOR is defined elsewhere or needs to be imported
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
          color: prototype.color || theme.accent.primary,
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
          color: prototype.color || theme.accent.primary,
          typeNodeId: prototype.typeNodeId,
          definitionGraphIds: Array.isArray(prototype.definitionGraphIds) ? prototype.definitionGraphIds : []
        });
      });
    });

    return Array.from(parentNodes.values());
  })();

  // Action handlers
  /**
   * @param {Object} updatedData - Fields to merge into the prototype.
   * @param {Object} [contextOptions] - History context. SemanticEditor's debounced
   *   auto-enrichment passes `{ ignore: true }`: it fires on name change, so it
   *   lands mid-rename and would otherwise appear as a user edit.
   */
  const handleNodeUpdate = (updatedData, contextOptions = {}) => {
    if (nodeData?.id) {
      storeActions.updateNodePrototype(nodeData.id, draft => {
        Object.assign(draft, updatedData);
      }, contextOptions);
    }
  };

  const handleImageAdd = (nodeId) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // Mobile Safari (and some mobile browsers) only open the file picker when
    // the input is in the DOM. Attach it off-screen and remove it once a file
    // is chosen or the picker is dismissed.
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);
    const cleanup = () => { try { input.remove(); } catch { } };
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      cleanup();
      if (!file) return;
      const cache = useImageCache.getState();
      cache.startImageLoading(nodeId); // shimmer placeholder while decoding
      try {
        // HEIC-aware read (tablet/phone cameras default to HEIC, which browsers
        // can't decode natively) — see loadImageFileAsDataUrl.
        const { dataUrl, width, height } = await loadImageFileAsDataUrl(file);
        const aspectRatio = (width > 0 && height > 0) ? (height / width) : 1;
        const thumbSrc = await generateThumbnail(dataUrl, THUMBNAIL_MAX_DIMENSION);
        storeActions.updateNodePrototype(nodeId, draft => {
          // imageRef cleared: it addresses the PREVIOUS image, and leaving it
          // would have the panel resolve the old picture from the repo.
          Object.assign(draft, { imageSrc: dataUrl, thumbnailSrc: thumbSrc, imageAspectRatio: aspectRatio, imageRef: null, imageRefExt: null });
          // User image replaces any auto-enriched Wikipedia thumbnail —
          // clear the flag so the save system persists it in-file instead
          // of stripping it as re-fetchable.
          if (draft.semanticMetadata?.autoEnriched) {
            draft.semanticMetadata = { ...draft.semanticMetadata, autoEnriched: false, wikipediaThumbnail: null };
          }
          // Not recorded — a base64 data URL in both the patch and its inverse.
        }, { type: 'prototype_image' });
      } catch (error) {
        console.error('Image add failed:', error);
        alert(error?.message || 'Could not add this image.');
      } finally {
        cache.stopImageLoading(nodeId);
      }
    };
    // Cancelled picker fires no onchange; clean up on next window focus.
    window.addEventListener('focus', () => setTimeout(cleanup, 300), { once: true });
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

  // Coalesced per picker session — see handleColorCommit.
  const handleColorChange = (newColor) => {
    if (colorPickerNodeId && storeActions?.updateNodePrototype) {
      storeActions.updateNodePrototype(colorPickerNodeId, draft => {
        draft.color = newColor;
      }, { coalesce: `node-color:${colorPickerNodeId}` });
    }
  };

  const handleColorCommit = () => storeActions?.flushHistory?.();

  const handleColorPickerClose = () => {
    setColorPickerVisible(false);
    setColorPickerNodeId(null);
  };

  const handleOpenNode = (nodeId) => {
    storeActions.openRightPanelNodeTab(nodeId);
  };

  // Opens a Thing's definition on the canvas, making one first if it has none.
  // `graphIdToOpen` is the definition to open when it has some.
  const expandThing = (thing, graphIdToOpen, event) => {
    const nodeId = thing?.id;
    if (!nodeId) return;

    // Get the icon's bounding rectangle for the hurtle animation
    const iconRect = event.currentTarget.getBoundingClientRect();

    // Same logic as PieMenu expand but using hurtle animation from panel
    if (thing.definitionGraphIds && thing.definitionGraphIds.length > 0) {
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

  // Web Definitions. Only a real prototype has definitions to edit: a page for
  // a Web no Thing defines shows that Web alone.
  const isRealPrototype = !!(nodeData?.id && nodePrototypes?.has(nodeData.id));
  const definitionGraphIds = Array.isArray(nodeData?.definitionGraphIds) ? nodeData.definitionGraphIds : [];
  const shownDefinitionId = getShownDefinitionId(nodeData);
  const definitionIndex = Math.max(0, definitionGraphIds.indexOf(shownDefinitionId));
  const currentDefinitionId = getCurrentDefinitionId(nodeData);

  // The Bio is the description of the definition you're on (one definition, one
  // description: see getDefinitionDescription). Subscribed narrowly, as `graphs`
  // above isn't reactive.
  const currentWebDescription = useGraphStore(state => (
    currentDefinitionId ? state.graphs.get(currentDefinitionId)?.description : undefined
  ));
  const bioText = currentDefinitionId
    ? getDefinitionDescription(nodeData, currentDefinitionId, currentWebDescription)
    : (nodeData?.description || '');
  // True when the Bio is stored on the Thing itself (no definitions, or the first).
  const bioWritesThing = isRealPrototype && (!currentDefinitionId || definitionGraphIds[0] === currentDefinitionId);

  const handleDefinitionIndexChange = (index) => {
    const id = definitionGraphIds[index];
    if (id) setBrowsedDefinitionId(id);
  };

  const handleAddDefinition = () => {
    if (!isRealPrototype) return;
    const newGraphId = storeActions.createAndAssignGraphDefinitionWithoutActivation?.(nodeData.id);
    if (newGraphId) setBrowsedDefinitionId(newGraphId);
  };

  const handleDeleteDefinition = (graphId) => {
    if (isRealPrototype) requestDeleteDefinition(nodeData.id, graphId);
  };

  const handleOpenDefinition = (graphId, event) => {
    if (!graphId || !nodeData?.id) return;
    const iconRect = event?.currentTarget?.getBoundingClientRect?.();
    if (onStartHurtleAnimationFromPanel && iconRect) {
      onStartHurtleAnimationFromPanel(nodeData.id, graphId, nodeData.id, iconRect);
    } else if (storeActions?.openGraphTabAndBringToTop) {
      storeActions.openGraphTabAndBringToTop(graphId, nodeData.id);
    }
  };

  // A Web's own tab, or this one when it already is that Web's page.
  const handleOpenDefinitionInPanel = (graphId) => {
    if (!graphId || graphId === subjectWebId) return;
    storeActions.openRightPanelGraphTab?.(graphId, isRealPrototype ? nodeData.id : null);
  };

  // Where a definition's description is kept: the first's on the Thing, the
  // rest on their Webs. A Web with no Thing keeps its own.
  const handleUpdateDefinitionDescription = (graphId, description) => {
    if (!graphId) return;
    if (isRealPrototype && definitionGraphIds[0] === graphId) {
      storeActions.updateNodePrototype(nodeData.id, (draft) => { draft.description = description; });
      return;
    }
    storeActions.updateGraph?.(graphId, (draft) => { draft.description = description; });
  };

  const handleBioChange = (description) => {
    if (currentDefinitionId) {
      handleUpdateDefinitionDescription(currentDefinitionId, description);
    } else if (isRealPrototype) {
      storeActions.updateNodePrototype(nodeData.id, (draft) => { draft.description = description; });
    }
  };

  // Expand opens the definition Web Definitions is showing.
  const handleExpandNode = (event) => {
    expandThing(nodeData, shownDefinitionId || definitionGraphIds[0], event);
  };

  const handleTypeSelect = (nodeId) => {
    if (onTypeSelect) {
      onTypeSelect(nodeId);
    }
  };

  // The type row's own buttons. An untyped Thing reads "Is a Thing", so the
  // buttons act on the base Thing.
  const typeId = nodeData?.typeNodeId || 'base-thing-prototype';
  const typePrototype = nodePrototypes?.get(typeId) || null;
  const typeDefinitionId = getCurrentDefinitionId(typePrototype);

  const handleOpenTypeInPanel = () => {
    if (typePrototype) storeActions.openRightPanelNodeTab(typePrototype.id, typePrototype.name);
  };

  const handleExpandType = (event) => {
    expandThing(typePrototype, typeDefinitionId, event);
  };

  if (!nodeData) {
    // Provide more specific error messages
    let errorMessage = '';
    if (tabType === 'home') {
      if (!activeGraphId) {
        errorMessage = 'No web open...';
      } else if (!graphs || !graphs.has(activeGraphId)) {
        errorMessage = 'Web not found in store...';
      } else {
        errorMessage = 'Web data is incomplete...';
      }
    } else {
      errorMessage = 'Thing data not found...';
    }

    return (
      <div style={{ padding: '10px', color: theme.canvas.textSecondary, fontFamily: "'EmOne', sans-serif" }}>
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
        typeActionsAvailable={!!typePrototype}
        onOpenTypeInPanel={typePrototype && typePrototype.id !== nodeData.id ? handleOpenTypeInPanel : undefined}
        onExpandType={handleExpandType}
        typeExpandDisabled={!!typeDefinitionId && typeDefinitionId === activeGraphId}
        definitionGraphIds={definitionGraphIds}
        definitionIndex={definitionIndex}
        currentDefinitionId={currentDefinitionId}
        onDefinitionIndexChange={handleDefinitionIndexChange}
        onAddDefinition={handleAddDefinition}
        onDeleteDefinition={handleDeleteDefinition}
        onOpenDefinition={handleOpenDefinition}
        onOpenDefinitionInPanel={handleOpenDefinitionInPanel}
        onUpdateDefinitionDescription={handleUpdateDefinitionDescription}
        bioText={bioText}
        onBioChange={handleBioChange}
        bioWritesThing={bioWritesThing}
        canEditDefinitions={isRealPrototype}
        activeGraphId={activeGraphId}
        subjectWebId={subjectWebId}
        isHomeTab={tabType === 'home'}
        showExpandButton={true}
        // Off only when the definition on show is the Web already open.
        expandButtonDisabled={!!shownDefinitionId && shownDefinitionId === activeGraphId}
        isUltraSlim={isUltraSlim}
      />

      {/* Color Picker Component - Rendered in Portal to prevent clipping */}
      <PanelColorPickerPortal
        isVisible={colorPickerVisible}
        onClose={handleColorPickerClose}
        onColorChange={handleColorChange}
        onColorCommit={handleColorCommit}
        currentColor={colorPickerNodeId && nodePrototypes ? nodePrototypes.get(colorPickerNodeId)?.color || theme.accent.primary : theme.accent.primary}
        position={colorPickerPosition}
        direction="down-left"
      />
    </>
  );
}); // End of memo wrapper

export default PanelContentWrapper;
