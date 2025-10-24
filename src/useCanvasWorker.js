import { useState, useRef, useEffect } from 'react';

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

    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'PAN_RESULT') {
          workerRef.current.removeEventListener('message', handler);
          resolve(e.data.data);
        }
      };
      workerRef.current.addEventListener('message', handler);
      workerRef.current.postMessage({ type: 'CALCULATE_PAN', data });
    });
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

    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'NODE_POSITIONS_RESULT') {
          workerRef.current.removeEventListener('message', handler);
          resolve(e.data.data);
        }
      };
      workerRef.current.addEventListener('message', handler);
      workerRef.current.postMessage({ type: 'CALCULATE_NODE_POSITIONS', data });
    });
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

    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'SELECTION_RESULT') {
          workerRef.current.removeEventListener('message', handler);
          resolve(e.data.data);
        }
      };
      workerRef.current.addEventListener('message', handler);
      workerRef.current.postMessage({ type: 'CALCULATE_SELECTION', data });
    });
  };

  const calculateZoom = async (data) => {
    if (!workerReady || !workerRef.current) {
      // Fallback calculation for zoom
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

      let zoomFactor = deltaY < 0 ? 1.1 : deltaY > 0 ? 1 / 1.1 : 1;
      
      let newZoomLevel = currentZoom * zoomFactor;
      newZoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoomLevel));
      
      zoomFactor = newZoomLevel / currentZoom;

      const panOffsetDeltaX = (mousePos.x - panOffset.x) * (1 - zoomFactor);
      const panOffsetDeltaY = (mousePos.y - panOffset.y) * (1 - zoomFactor);

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
    }

    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'ZOOM_RESULT') {
          workerRef.current.removeEventListener('message', handler);
          resolve(e.data.data);
        }
      };
      workerRef.current.addEventListener('message', handler);
      workerRef.current.postMessage({ type: 'CALCULATE_ZOOM', data });
    });
  };

  return {
    calculatePan,
    calculateNodePositions,
    calculateZoom,
    calculateSelection
  };
};