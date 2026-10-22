/**
 * Plays the queued node entrances (nodeSpawn.js) once their nodes are drawn.
 * Renders nothing; NodeLayer mounts it after its nodes, so its layout effect
 * runs after every NodeLayer commit, before paint. Free when nothing is queued.
 */
import { useLayoutEffect, useRef } from 'react';
import { playQueuedSpawns, pendingNodeSpawns, pendingEdgeFades } from './nodeSpawn.js';

export default function NodeSpawnLayer() {
  const markerRef = useRef(null);
  useLayoutEffect(() => {
    if (pendingNodeSpawns.size === 0 && pendingEdgeFades.size === 0) return;
    // The whole canvas: the connections among them are in another layer.
    playQueuedSpawns(markerRef.current?.ownerSVGElement);
  });
  return <g ref={markerRef} data-node-spawns style={{ display: 'none' }} />;
}
