/**
 * Save Worker
 * Handles heavy serialization and hashing off the main thread.
 *
 * It keeps its own copy of the universe, updated by changes (saveMirror.js).
 * The file goes back as UTF-8 bytes in a transferred buffer, which costs the
 * main thread nothing to receive.
 */

import { exportToRedstring } from '../formats/redstringFormat.js';
import { generateStateHash } from './saveHash.js';
import { applySaveMessage } from './saveMirror.js';

let mirror = null;

self.onmessage = (e) => {
  const { type, userDomain } = e.data;

  if (type === 'prime') {
    // A universe just loaded: take the copy, nothing to save or report.
    try {
      const applied = applySaveMessage(mirror, e.data);
      if (applied) mirror = applied;
      else self.postMessage({ type: 'prime-failed' });
    } catch {
      mirror = null;
      self.postMessage({ type: 'prime-failed' });
    }
    return;
  }

  if (type === 'process_save') {
    try {
      // Messages from before the incremental protocol carried `state` alone.
      const message = e.data.full === undefined && e.data.state ? { full: true, state: e.data.state } : e.data;
      const applied = applySaveMessage(mirror, message);
      if (!applied) {
        // A change list with no copy to apply it to (the worker restarted).
        self.postMessage({ type: 'error', code: 'no-mirror', error: 'Save worker has no copy of the universe yet', success: false });
        return;
      }
      mirror = applied;

      const redstringData = exportToRedstring(mirror, userDomain);
      const jsonString = JSON.stringify(redstringData, null, 2);
      const hash = generateStateHash(mirror);
      const jsonBytes = new TextEncoder().encode(jsonString);

      // Only the bytes go back, transferred rather than copied.
      self.postMessage({
        type: 'save_processed',
        jsonBytes,
        hash,
        success: true
      }, [jsonBytes.buffer]);

    } catch (error) {
      // The copy may be half-updated; start again from a whole state.
      mirror = null;
      self.postMessage({
        type: 'error',
        code: 'failed',
        error: error.message,
        success: false
      });
    }
  }
};
