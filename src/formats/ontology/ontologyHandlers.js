/**
 * What the ontology worker does, as plain functions.
 *
 * Split from the worker file so the same handlers run in-process where there
 * is no Worker (tests, a headless host), with the same messages and results.
 */

import { indexOntology, summarizeIndex, planImport, searchTerms } from './importOntology.js';

const PROGRESS_INTERVAL_MS = 200;

/**
 * Decoded text chunks of a File/Blob, gunzipping `.gz` files on the way.
 * Yields the first chunk first so the caller can sniff the format from it.
 */
export async function* fileTextChunks(file) {
  let stream = file.stream();
  if (/\.gz$/i.test(file.name || '')) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unpack .gz files. Unzip it first.');
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value) yield value;
  }
}

export function createOntologyHandlers() {
  let index = null;

  const requireIndex = () => {
    if (!index) throw new Error('No ontology has been read yet.');
    return index;
  };

  return {
    async handle(type, payload = {}, onProgress = null) {
      switch (type) {
        case 'index': {
          const { file, text, fileName } = payload;
          index = null;
          let source;
          let sample = '';
          if (typeof text === 'string') {
            source = text;
            sample = text.slice(0, 4096);
          } else if (file) {
            const chunks = fileTextChunks(file);
            const first = await chunks.next();
            sample = first.done ? '' : first.value.slice(0, 4096);
            source = (async function* () {
              if (!first.done) yield first.value;
              yield* chunks;
            })();
          } else {
            throw new Error('Nothing to read.');
          }
          let last = 0;
          const total = file && !/\.gz$/i.test(file.name || '') ? file.size : null;
          index = await indexOntology({
            source,
            sample,
            fileName: fileName || file?.name || 'ontology',
            onProgress: (p) => {
              const now = Date.now();
              if (!onProgress || now - last < PROGRESS_INTERVAL_MS) return;
              last = now;
              onProgress({ ...p, total });
            },
          });
          return summarizeIndex(index);
        }
        case 'summary':
          return summarizeIndex(requireIndex());
        case 'search':
          return searchTerms(requireIndex(), payload.query, payload.limit || 12);
        case 'preview':
          return planImport(requireIndex(), payload.options || {}).report;
        case 'build': {
          const { state, report, plan } = planImport(requireIndex(), payload.options || {});
          return { state, report, folderWebId: plan.source.folderWebId, sourceId: plan.source.id };
        }
        case 'dispose':
          index = null;
          return true;
        default:
          throw new Error(`Unknown ontology import request: ${type}`);
      }
    },
  };
}
