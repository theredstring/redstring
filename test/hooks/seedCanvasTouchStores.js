// useCanvasTouch subscribes to its store-backed inputs and settings itself (P4.06), so a test
// that drives it through props also has to put those values in the stores.
// Setters go in as-is, so spies passed in props still see the calls.
import useGraphStore from '../../src/store/graphStore.js';
import useCanvasUIStore from '../../src/store/canvasUIStore.js';

const UI_FIELDS = [
  'selectedInstanceIds', 'setSelectedInstanceIds', 'selectedEdgeId', 'selectedEdgeIds', 'nodeNamePrompt',
  'previewingNodeId', 'selectedNodeIdForPieMenu', 'groupControlPanelShouldShow', 'groupControlPanelVisible',
  'setGroupControlPanelVisible', 'connectionControlPanelShouldShow', 'connectionControlPanelVisible',
  'setConnectionControlPanelVisible',
];

/**
 * useCanvasTouch takes its inputs in groups (P4.06). The tests build flat props,
 * as the hook used to take them; this regroups them.
 */
export function groupTouchProps(p) {
  return {
    transform: { panRef: p.panOffsetRef, zoomRef: p.zoomLevelRef, setPanAndZoom: p.setPanAndZoom },
    camera: {
      stopPanMomentum: p.stopPanMomentum, isViewMoving: p.isViewMoving,
      startZoomMomentum: p.startZoomMomentum, stopZoomMomentum: p.stopZoomMomentum,
    },
    pointer: { handleMouseMove: p.handleMouseMove, handleMouseUp: p.handleMouseUp, handleMouseDown: p.handleMouseDown },
    nodeDrag: {
      startDragForNode: p.startDragForNode, draggingNodeInfo: p.draggingNodeInfo,
      draggingNodeInfoRef: p.draggingNodeInfoRef, isAnimatingZoomRef: p.isAnimatingZoomRef,
    },
    gestures: {
      isPanningOrZooming: p.isPanningOrZooming, panSourceRef: p.panSourceRef, panVelocityHistoryRef: p.panVelocityHistoryRef,
      isMouseDown: p.isMouseDown, mouseMoved: p.mouseMoved, startedOnNode: p.startedOnNode,
      mouseInsideNode: p.mouseInsideNode, mouseDownPosition: p.mouseDownPosition, isTouchDeviceRef: p.isTouchDeviceRef,
      suppressNextMouseDownRef: p.suppressNextMouseDownRef, pinchRef: p.pinchRef, pinchSmoothingRef: p.pinchSmoothingRef,
      ignoreCanvasClick: p.ignoreCanvasClick, armGestureBlock: p.armGestureBlock,
      scheduleGestureBlockClear: p.scheduleGestureBlockClear,
    },
    hitTest: {
      isInsideNode: p.isInsideNode, getNodeDimensions: p.getNodeDimensions, clampCoordinates: p.clampCoordinates,
      tryToggleConnectionOrbAtPoint: p.tryToggleConnectionOrbAtPoint, trySelectConnectionAtPoint: p.trySelectConnectionAtPoint,
    },
    canvasState: {
      plusSign: p.plusSign, setPlusSign: p.setPlusSign, drawingConnectionFrom: p.drawingConnectionFrom,
      setDrawingConnectionFrom: p.setDrawingConnectionFrom, selectedGroup: p.selectedGroup,
      setSelectedGroup: p.setSelectedGroup, setPanStart: p.setPanStart, setIsPanning: p.setIsPanning,
    },
    containerRef: p.containerRef,
    canvasSize: p.canvasSize,
    cancelConnectionDraw: p.cancelConnectionDraw,
    storeActions: p.storeActions,
    nodes: p.nodes,
    abstractionCarouselVisibleRef: p.abstractionCarouselVisibleRef,
  };
}

export function seedTouchStores(props) {
  const graphPatch = {};
  if ('activeGraphId' in props) graphPatch.activeGraphId = props.activeGraphId;
  if ('touchSettings' in props) graphPatch.touchSettings = props.touchSettings;
  if ('nodeLiftDelay' in props) graphPatch.mouseSettings = { ...useGraphStore.getState().mouseSettings, nodeLiftDelay: props.nodeLiftDelay };
  useGraphStore.setState(graphPatch);
  const patch = {};
  for (const k of UI_FIELDS) if (k in props) patch[k] = props[k];
  useCanvasUIStore.setState(patch);
}
