import { useState, useRef, useEffect } from 'react';
import { calculateZoom as calculateZoomMath } from './utils/canvas/zoomMath.js';

export const useCanvasWorker = () => {
  const [workerReady, setWorkerReady] = useState(false);
  const workerRef = useRef(null);

  useEffect(() => {
    try {
      const worker = new Worker(
        new URL('./canvasWorker.js', import.meta.url),
        { type: 'module' }
      );

      worker.onerror = (error) => {
        console.error('Worker error:', error);
      };

      worker.onmessage = (e) => {
        if (e.data.type === 'READY') {
          console.log('Worker ready');
          setWorkerReady(true);
        }
      };

      workerRef.current = worker;

      return () => {
        console.log('Terminating worker');
        worker.terminate();
      };
    } catch (error) {
      console.error('Worker initialization failed:', error);
      return null;
    }
  }, []);

  // Correlated request/response.
  //
  // These calls are made from input handlers, so several of the same type are
  // routinely in flight at once — a trackpad emits wheel events faster than a
  // worker round-trip completes. Matching a response to its request by `type`
  // alone is not enough: every pending caller of that type sees every response,
  // so they all resolve off whichever one lands first and the later responses
  // are dropped. For zoom that silently pairs one request's input with another
  // request's output, which inverts the zoom direction whenever the two were
  // computed from different base zooms.
  //
  // So tag each request with an id and resolve only on the matching response.
  const requestIdRef = useRef(0);
  const request = (type, resultType, data) => new Promise((resolve, reject) => {
    const worker = workerRef.current;
    const id = ++requestIdRef.current;

    const handler = (e) => {
      if (e.data.id !== id) return;
      if (e.data.type === resultType) {
        worker.removeEventListener('message', handler);
        resolve(e.data.data);
      } else if (e.data.type === 'ERROR') {
        worker.removeEventListener('message', handler);
        reject(new Error(e.data.error));
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({ type, id, data });
  });

  const calculatePan = async (data) => {
    if (!workerReady || !workerRef.current) {
      // Fallback calculation for pan
      const {
        mouseX,
        mouseY,
        panStart,
        currentPanOffset,
        viewportSize,
        canvasSize,
        zoomLevel,
        sensitivity = 0.1
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

      return { x: newPanOffsetX, y: newPanOffsetY };
    }

    return request('CALCULATE_PAN', 'PAN_RESULT', data);
  };

  const calculateNodePositions = async (data) => {
    if (!workerReady || !workerRef.current) {
      // Fallback calculation for node positions
      const { nodes, draggingNode, mouseX, mouseY, panOffset, zoomLevel, canvasSize, headerHeight } = data;
      
      return nodes.map(node => {
        if (node.id === draggingNode?.id) {
          const currentX = (mouseX - panOffset.x) / zoomLevel;
          const currentY = (mouseY - headerHeight - panOffset.y) / zoomLevel;
          
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
    }

    return request('CALCULATE_NODE_POSITIONS', 'NODE_POSITIONS_RESULT', data);
  };

  const calculateSelection = async (data) => {
    if (!workerReady || !workerRef.current) {
      // Fallback calculation for selection
      const { selectionStart, currentX, currentY } = data;
      
      return {
        x: Math.min(selectionStart.x, currentX),
        y: Math.min(selectionStart.y, currentY),
        width: Math.abs(currentX - selectionStart.x),
        height: Math.abs(currentY - selectionStart.y)
      };
    }

    return request('CALCULATE_SELECTION', 'SELECTION_RESULT', data);
  };

  // Zoom is pure arithmetic (see utils/canvas/zoomMath.js) — running it through
  // the worker only bought a frame of latency, so it is computed inline. Kept
  // async so existing `await` call sites keep working.
  const calculateZoom = async (data) => calculateZoomMath(data);

  return {
    calculatePan,
    calculateNodePositions,
    calculateZoom,
    calculateSelection
  };
};