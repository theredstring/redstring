/**
 * Window events from the Wizard and other systems that steer the canvas (moved
 * verbatim from NodeCanvas's listener effects). Each function attaches its
 * listeners and returns the cleanup; NodeCanvas calls it from an effect with
 * the original dependencies.
 */
import { NavigationMode, calculateNavigationParams } from '../../../services/canvasNavigationService.js';
import { getNodeDimensions } from '../../../utils.js';
import { MAX_ZOOM } from '../../../constants';
import useCanvasUIStore from '../../../store/canvasUIStore.js';

/** `rs-navigate-to`: fit the web's content, focus given nodes, go to coordinates or centre the view. */
export function listenForNavigateTo(ctx) {
  const {
    draggingNodeInfoRef, isAnimatingZoomRef, activeGraphId, handleBackToCivilizationClick, nodes,
    baseDimsById, viewportSize, canvasSize, transform,
  } = ctx;
  const handleNavigateTo = (event) => {
    // Skip navigation during drag to prevent interference with drag zoom animation
    if (draggingNodeInfoRef.current || isAnimatingZoomRef.current) return;

    const detail = event.detail || {};
    const { mode, graphId, nodeIds, targetX, targetY, targetZoom, padding = 100, minZoom = 0.3, maxZoom: navMaxZoom = 1.5 } = detail;

    // Only navigate if this is the active graph (or no graphId specified)
    if (graphId && graphId !== activeGraphId) return;

    // Handle different navigation modes
    switch (mode) {
      case NavigationMode.FIT_CONTENT: {
        // Use existing back-to-civilization logic to fit all content
        handleBackToCivilizationClick();
        break;
      }

      case NavigationMode.FOCUS_NODES: {
        // Navigate to focus on specific nodes
        if (!nodeIds || nodeIds.length === 0 || !nodes || nodes.length === 0) {
          handleBackToCivilizationClick();
          return;
        }

        // Find the specified nodes
        const targetNodes = nodes.filter(n => nodeIds.includes(n.id));
        if (targetNodes.length === 0) {
          console.warn('[CanvasNav] No matching nodes found for IDs:', nodeIds);
          handleBackToCivilizationClick();
          return;
        }

        // Calculate bounding box of target nodes
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        targetNodes.forEach(node => {
          const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
          minX = Math.min(minX, node.x);
          minY = Math.min(minY, node.y);
          maxX = Math.max(maxX, node.x + dims.currentWidth);
          maxY = Math.max(maxY, node.y + dims.currentHeight);
        });

        // Calculate navigation parameters
        const navParams = calculateNavigationParams(
          { minX, minY, maxX, maxY },
          viewportSize,
          canvasSize,
          { padding, minZoom, maxZoom: Math.min(navMaxZoom, MAX_ZOOM) }
        );

        // Apply navigation
        transform.jumpTo({ x: navParams.panX, y: navParams.panY }, navParams.zoom);
        console.log('[CanvasNav] Navigated to nodes:', { nodeIds, zoom: navParams.zoom });
        break;
      }

      case NavigationMode.COORDINATES: {
        // Navigate to specific coordinates
        if (typeof targetX !== 'number' || typeof targetY !== 'number') {
          console.warn('[CanvasNav] Invalid coordinates:', { targetX, targetY });
          return;
        }

        const effectiveZoom = Math.max(minZoom, Math.min(targetZoom || 1, navMaxZoom, MAX_ZOOM));

        // Calculate pan to center on target coordinates
        const targetPanX = (viewportSize.width / 2) - (targetX - canvasSize.offsetX) * effectiveZoom;
        const targetPanY = (viewportSize.height / 2) - (targetY - canvasSize.offsetY) * effectiveZoom;

        // Apply bounds constraints
        const maxPanX = 0;
        const minPanX = viewportSize.width - canvasSize.width * effectiveZoom;
        const maxPanY = 0;
        const minPanY = viewportSize.height - canvasSize.height * effectiveZoom;

        transform.jumpTo({
          x: Math.min(Math.max(targetPanX, minPanX), maxPanX),
          y: Math.min(Math.max(targetPanY, minPanY), maxPanY)
        }, effectiveZoom);
        console.log('[CanvasNav] Navigated to coordinates:', { x: targetX, y: targetY, zoom: effectiveZoom });
        break;
      }

      case NavigationMode.CENTER: {
        // Navigate to canvas center
        const defaultZoom = 1;
        const centerPanX = viewportSize.width / 2 - (canvasSize.width / 2) * defaultZoom;
        const centerPanY = viewportSize.height / 2 - (canvasSize.height / 2) * defaultZoom;

        const maxPanX = 0;
        const minPanX = viewportSize.width - canvasSize.width * defaultZoom;
        const maxPanY = 0;
        const minPanY = viewportSize.height - canvasSize.height * defaultZoom;

        transform.jumpTo({
          x: Math.min(Math.max(centerPanX, minPanX), maxPanX),
          y: Math.min(Math.max(centerPanY, minPanY), maxPanY)
        }, defaultZoom);
        console.log('[CanvasNav] Navigated to center');
        break;
      }

      default:
        console.warn('[CanvasNav] Unknown navigation mode:', mode);
    }
  };

  window.addEventListener('rs-navigate-to', handleNavigateTo);
  return () => {
    window.removeEventListener('rs-navigate-to', handleNavigateTo);
  };
}

/** `rs-select-node`: select (and frame) a node the Wizard names. */
export function listenForSelectNode(ctx) {
  const { nodes } = ctx;
  const handleSelectNode = (event) => {
    const { instanceId, prototypeId, name } = event.detail || {};
    if (!nodes || nodes.length === 0) return;

    // Find the node by instanceId, prototypeId, or name
    let targetNode = null;
    if (instanceId) {
      targetNode = nodes.find(n => n.id === instanceId);
    }
    if (!targetNode && prototypeId) {
      targetNode = nodes.find(n => n.prototypeId === prototypeId);
    }
    if (!targetNode && name) {
      const nameLower = name.toLowerCase();
      targetNode = nodes.find(n => (n.name || '').toLowerCase() === nameLower);
      if (!targetNode) {
        // Fuzzy: find best partial match
        targetNode = nodes.find(n => (n.name || '').toLowerCase().includes(nameLower) || nameLower.includes((n.name || '').toLowerCase()));
      }
    }

    if (targetNode) {
      console.log('[NodeCanvas] Selecting node from Wizard:', targetNode.name, targetNode.id);
      // Select the node (highlight it)
      useCanvasUIStore.getState().dispatchPie({ type: 'PIE_TARGET', id: targetNode.id, selection: [targetNode.id] });

      // Navigate to focus on the node
      window.dispatchEvent(new CustomEvent('rs-navigate-to', {
        detail: {
          mode: 'FOCUS_NODES',
          nodeIds: [targetNode.id],
          padding: 200,
          maxZoom: 1.2
        }
      }));
    } else {
      console.warn('[NodeCanvas] Could not find node to select:', { instanceId, prototypeId, name });
    }
  };

  window.addEventListener('rs-select-node', handleSelectNode);
  return () => {
    window.removeEventListener('rs-select-node', handleSelectNode);
  };
}
