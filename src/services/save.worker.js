/**
 * Save Worker
 * Handles heavy serialization and hashing off the main thread
 */

import { exportToRedstring } from '../formats/redstringFormat.js';

// FNV-1a hash - simple and fast
const generateHash = (str) => {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString();
};

self.onmessage = (e) => {
  const { type, state, userDomain } = e.data;

  if (type === 'process_save') {
    try {
      // 1. Export to Redstring format (heavy transformation)
      const redstringData = exportToRedstring(state, userDomain);

      // 2. Serialize to JSON (heavy stringification)
      const jsonString = JSON.stringify(redstringData, null, 2);

      // 3. Generate hash for change detection
      // We hash the *content* logic, not necessarily the exact JSON string if we want to skip viewport changes
      // But for now, hashing the result is a good enough proxy for "did the file change?"
      // Ideally we should use the same hashing logic as SaveCoordinator used to use:
      // filtering out viewport state.
      // Let's stick to the SaveCoordinator's logic of what constitutes a "change" 
      // which was hashing a specific subset of the state.
      
      // RE-IMPLEMENTING SaveCoordinator's hasing logic here to keep it consistent
      // But actually, if we just hash the output string, any change to the output (including viewport)
      // triggers a save. SaveCoordinator was trying to AVOID viewport saves.
      // Let's implement the selective hashing here too.
      
      const contentState = {
        graphs: state.graphs ? Array.from(state.graphs.entries()).map(([id, graph]) => {
          // Destructure to exclude viewport properties
          const { panOffset, zoomLevel, instances, ...rest } = graph || {};
          const instancesArray = instances ? Array.from(instances.entries()) : [];
          return [id, { ...rest, instances: instancesArray }];
        }) : [],
        nodePrototypes: state.nodePrototypes ? Array.from(state.nodePrototypes.entries()) : [],
        edges: state.edges ? Array.from(state.edges.entries()) : []
      };
      
      const contentString = JSON.stringify(contentState);
      const hash = generateHash(contentString);

      self.postMessage({
        type: 'save_processed',
        jsonString,
        hash,
        success: true
      });

    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error.message,
        success: false
      });
    }
  }
};

