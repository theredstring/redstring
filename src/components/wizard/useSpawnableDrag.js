import { useEffect } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';

/**
 * The universal dragged node, as Open Webs and the header tabs start it: the
 * Thing (and the Web, for a Web's card) rides along, and SpawningNodeDragLayer
 * draws it under the pointer. Drop it on the canvas to place it, on the header
 * to open it, on the Wizard to pin it.
 *
 * @param {{prototypeId?:string|null, nodeName?:string, graphId?:string|null}} item
 * @returns {[Function, boolean]} the ref to attach, and whether it's being dragged
 */
export default function useSpawnableDrag({ prototypeId, nodeName, graphId = null }) {
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: 'spawnable_node',
    item: { prototypeId, nodeName, ...(graphId ? { graphId } : {}) },
    canDrag: () => !!prototypeId,
    collect: (monitor) => ({ isDragging: !!monitor.isDragging() })
  }), [prototypeId, nodeName, graphId]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return [drag, isDragging];
}
