/**
 * Save Worker
 * Handles heavy serialization and hashing off the main thread
 */

import { exportToRedstring } from '../formats/redstringFormat.js';
import { generateStateHash } from './saveHash.js';

self.onmessage = (e) => {
  const { type, state, userDomain } = e.data;

  if (type === 'process_save') {
    try {
      // 1. Export to Redstring format (heavy transformation)
      const redstringData = exportToRedstring(state, userDomain);

      // 2. Serialize to JSON (heavy stringification)
      const jsonString = JSON.stringify(redstringData, null, 2);

      // 3. Change-detection hash (shared with SaveCoordinator's fallback via
      //    saveHash.js — sees Maps/Sets and persisted UI state, excludes
      //    viewport and raw image data).
      const hash = generateStateHash(state);

      self.postMessage({
        type: 'save_processed',
        jsonString,
        redstringData, // Include the object for browser storage mode
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














