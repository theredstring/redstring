/**
 * Semantic Hash Worker
 * Canonicalizes one .redstring document (URDNA2015) and hashes it, off the
 * main thread. For a multi-megabyte universe that is most of a second of
 * work, and on the main thread it froze the loading screen.
 *
 * Takes the document as a JSON string: posting a string is a copy, while
 * posting the object would structured-clone every node on the main thread.
 */

import { semanticHash } from './semanticHashCore.js';

self.onmessage = async (e) => {
  const { id, json } = e.data;
  try {
    const hash = await semanticHash(JSON.parse(json));
    self.postMessage({ id, hash });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
