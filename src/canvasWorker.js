import { calculateZoom } from './utils/canvas/zoomMath.js';
import {
  SCROLL_SENSITIVITY
} from './constants';

// Log worker initialization
console.log('Worker initialized');

// Send ready message to main thread
self.postMessage({ type: 'READY' });

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


// Message handler with error handling.
//
// Every response echoes the request's `id`. Callers can have several requests
// of the same type in flight at once (a trackpad emits wheel events faster than
// this round-trip completes), and without an id there is nothing to match a
// response to its request — a caller would resolve on whichever response of the
// right type arrived first, which is not necessarily its own.
self.onmessage = (e) => {
  const { type, data, id } = e.data;

  try {
    switch (type) {
      case 'TEST':
        self.postMessage({ type: 'READY', id });
        break;

      case 'CALCULATE_PAN':
        self.postMessage({
          type: 'PAN_RESULT',
          id,
          data: calculatePanOffset(data)
        });
        break;

      case 'CALCULATE_NODE_POSITIONS':
        self.postMessage({
          type: 'NODE_POSITIONS_RESULT',
          id,
          data: calculateNodePositions(data)
        });
        break;

      case 'CALCULATE_SELECTION':
        self.postMessage({
          type: 'SELECTION_RESULT',
          id,
          data: calculateSelectionRect(data)
        });
        break;

      case 'CALCULATE_ZOOM':
        self.postMessage({
          type: 'ZOOM_RESULT',
          id,
          data: calculateZoom(data)
        });
        break;

      default:
        console.warn('Unknown message type:', type);
        self.postMessage({
          type: 'ERROR',
          id,
          error: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    console.error('Worker message handling error:', error);
    self.postMessage({
      type: 'ERROR',
      id,
      error: error.message
    });
  }
};