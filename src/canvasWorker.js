import {
  SCROLL_SENSITIVITY
} from './constants';

// Log worker initialization
console.log('Worker initialized');

// Send ready message to main thread
self.postMessage({ type: 'READY' });

// Define a scaling factor for zoom sensitivity within the worker
const ZOOM_SENSITIVITY_SCALE = 0.005;

// Calculation functions
const calculatePanOffset = (data) => {
  try {
    const {
      mouseX,
      mouseY,
      panStart,
      currentPanOffset,
      viewportSize,
      canvasSize,
      zoomLevel,
      sensitivity = SCROLL_SENSITIVITY // Add sensitivity parameter with default value
    } = data;
  
    const dx = (mouseX - panStart.x) * sensitivity;
    const dy = (mouseY - panStart.y) * sensitivity;
  
    let newPanOffsetX = currentPanOffset.x + dx;
    let newPanOffsetY = currentPanOffset.y + dy;
  
    const maxPanOffsetX = 0;
    const maxPanOffsetY = 0;
    const minPanOffsetX = viewportSize.width - canvasSize.width * zoomLevel;
    const minPanOffsetY = viewportSize.height - canvasSize.height * zoomLevel;
  
    newPanOffsetX = Math.min(Math.max(newPanOffsetX, minPanOffsetX), maxPanOffsetX);
    newPanOffsetY = Math.min(Math.max(newPanOffsetY, minPanOffsetY), maxPanOffsetY);
  
    return {
      x: newPanOffsetX,
      y: newPanOffsetY
    };
  } catch (error) {
    console.error('Pan calculation error:', error);
    throw error;
  }
};

const calculateNodePositions = (data) => {
  try {
    const { nodes, draggingNode, mouseX, mouseY, panOffset, zoomLevel, canvasSize, headerHeight } = data;
    
    return nodes.map(node => {
      if (node.id === draggingNode?.id) {
        const currentX = (mouseX - panOffset.x) / zoomLevel;
        const currentY = (mouseY - headerHeight - panOffset.y) / zoomLevel;  // Add headerHeight here
        
        const newNodeX = Math.min(
          Math.max(currentX - draggingNode.offsetX, 0),
          canvasSize.width - draggingNode.width
        );
        const newNodeY = Math.min(
          Math.max(currentY - draggingNode.offsetY, 0),
          canvasSize.height - draggingNode.height
        );
        
        return {
          ...node,
          x: newNodeX,
          y: newNodeY
        };
      }
      return node;
    });
  } catch (error) {
    console.error('Node position calculation error:', error);
    throw error;
  }
};

const calculateSelectionRect = (data) => {
  try {
    const { selectionStart, currentX, currentY } = data;
    
    return {
      x: Math.min(selectionStart.x, currentX),
      y: Math.min(selectionStart.y, currentY),
      width: Math.abs(currentX - selectionStart.x),
      height: Math.abs(currentY - selectionStart.y)
    };
  } catch (error) {
    console.error('Selection calculation error:', error);
    throw error;
  }
};

const calculateZoom = (data) => {
  try {
    const {
      deltaY,
      currentZoom,
      mousePos,
      panOffset,
      viewportSize,
      canvasSize,
      MIN_ZOOM,
      MAX_ZOOM
    } = data;

    // Calculate zoomFactor based on deltaY magnitude and sensitivity scale
    // Avoid zoomFactor of exactly 1 if deltaY is 0 to prevent unnecessary calculations
    const zoomFactor = deltaY !== 0 ? Math.pow(2, -deltaY * ZOOM_SENSITIVITY_SCALE) : 1;

    if (zoomFactor === 1) {
        // If zoomFactor is 1 (e.g., deltaY was 0), no change needed
      return { zoomLevel: currentZoom, panOffset };
    }

    let newZoomLevel = currentZoom * zoomFactor;
    newZoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoomLevel));
    
    // Calculate the actual zoom factor applied after clamping
    const actualZoomFactor = newZoomLevel / currentZoom;

    // Pan offset calculation to zoom towards the mouse pointer
    const panOffsetDeltaX = (mousePos.x - panOffset.x) * (1 - actualZoomFactor);
    const panOffsetDeltaY = (mousePos.y - panOffset.y) * (1 - actualZoomFactor);

    let newPanOffsetX = panOffset.x + panOffsetDeltaX;
    let newPanOffsetY = panOffset.y + panOffsetDeltaY;

    const maxPanOffsetX = 0;
    const maxPanOffsetY = 0;
    const minPanOffsetX = viewportSize.width - canvasSize.width * newZoomLevel;
    const minPanOffsetY = viewportSize.height - canvasSize.height * newZoomLevel;

    newPanOffsetX = Math.min(Math.max(newPanOffsetX, minPanOffsetX), maxPanOffsetX);
    newPanOffsetY = Math.min(Math.max(newPanOffsetY, minPanOffsetY), maxPanOffsetY);

    return {
      zoomLevel: newZoomLevel,
      panOffset: { x: newPanOffsetX, y: newPanOffsetY }
    };
  } catch (error) {
    console.error('Zoom calculation error:', error);
    throw error;
  }
};

// Message handler with error handling
self.onmessage = (e) => {
  try {
    const { type, data } = e.data;

    switch (type) {
      case 'TEST':
        self.postMessage({ type: 'READY' });
        break;

      case 'CALCULATE_PAN':
        self.postMessage({
          type: 'PAN_RESULT',
          data: calculatePanOffset(data)
        });
        break;

      case 'CALCULATE_NODE_POSITIONS':
        self.postMessage({
          type: 'NODE_POSITIONS_RESULT',
          data: calculateNodePositions(data)
        });
        break;

      case 'CALCULATE_SELECTION':
        self.postMessage({
          type: 'SELECTION_RESULT',
          data: calculateSelectionRect(data)
        });
        break;

      case 'CALCULATE_ZOOM':
        self.postMessage({
          type: 'ZOOM_RESULT',
          data: calculateZoom(data)
        });
        break;

      default:
        console.warn('Unknown message type:', type);
        self.postMessage({
          type: 'ERROR',
          error: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    console.error('Worker message handling error:', error);
    self.postMessage({
      type: 'ERROR',
      error: error.message
    });
  }
};