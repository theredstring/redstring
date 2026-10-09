/**
 * The ontology importer's worker: reads, indexes and builds off the main thread.
 *
 * Indexing a 200 MB ontology takes seconds of CPU and most of a gigabyte of
 * memory, and none of it may freeze the canvas. The worker keeps the index
 * between messages, so searching for a root, previewing a slice and building
 * the universe each cost milliseconds after the one slow read.
 *
 * Messages are { id, type, payload } → { id, ok, result | error } plus
 * { id, progress } while a file is being read. See services/ontologyImport.js.
 */

import { createOntologyHandlers } from './ontologyHandlers.js';

const handlers = createOntologyHandlers();

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    const result = await handlers.handle(type, payload, (progress) => self.postMessage({ id, progress }));
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
