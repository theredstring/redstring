/**
 * Ontology import in the app: a worker session to read and plan, and the step
 * that folds the result into the open universe.
 *
 *   const session = createOntologyImportSession();
 *   const summary = await session.index(file, onProgress);
 *   const hits    = await session.search('water');
 *   const preview = await session.preview({ roots, depth });
 *   const built   = await session.build({ roots, depth });
 *   const result  = await applyOntologyImport(built);
 *   session.dispose();
 *
 * The merge goes through mergeUniverseState, the same additive path as merging
 * two universes, so an import never removes anything and importing the same
 * slice twice changes nothing the second time (every ID is derived from IRIs).
 * Like any merge it clears undo history; the universe is saved before and after.
 */

import useGraphStore from '../store/graphStore.js';
import { applyOffscreenLayout } from './offscreenLayout.js';
import { createOntologyHandlers } from '../formats/ontology/ontologyHandlers.js';

const canUseWorker = () => typeof window !== 'undefined' && typeof Worker === 'function';

/**
 * A session holds one ontology's index, in a worker when there is one.
 */
export function createOntologyImportSession() {
  let worker = null;
  let inProcess = null;
  let nextId = 1;
  const pending = new Map();

  if (canUseWorker()) {
    try {
      worker = new Worker(new URL('../formats/ontology/ontologyImport.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (event) => {
        const { id, ok, result, error, progress } = event.data || {};
        const entry = pending.get(id);
        if (!entry) return;
        if (progress) { entry.onProgress?.(progress); return; }
        pending.delete(id);
        if (ok) entry.resolve(result); else entry.reject(new Error(error || 'Import failed'));
      };
      worker.onerror = (event) => {
        const error = new Error(event?.message || 'The import worker stopped.');
        for (const entry of pending.values()) entry.reject(error);
        pending.clear();
      };
    } catch {
      worker = null;
    }
  }
  if (!worker) inProcess = createOntologyHandlers();

  const request = (type, payload, onProgress) => {
    if (inProcess) return inProcess.handle(type, payload, onProgress);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, type, payload });
    });
  };

  return {
    index: (file, onProgress) => request('index', { file, fileName: file?.name }, onProgress),
    indexText: (text, fileName) => request('index', { text, fileName }),
    search: (query, limit) => request('search', { query, limit }),
    preview: (options) => request('preview', { options }),
    build: (options) => request('build', { options: { ...options, importedAt: new Date().toISOString() } }),
    dispose: () => {
      for (const entry of pending.values()) entry.reject(new Error('Import cancelled.'));
      pending.clear();
      if (worker) worker.terminate();
      worker = null;
      inProcess = null;
    },
  };
}

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Merge a built import into the open universe, lay out its new webs and save.
 *
 * @param {Object} built - from session.build(): { state, report, folderWebId, sourceId }
 * @param {Object} [options]
 * @param {Function} [options.save] - saves the universe; skipped when absent (tests)
 * @param {Function} [options.onProgress] - ({ phase, done, total })
 * @returns {Promise<Object>} the merge report plus { laidOut, folderWebId, sourceId }
 */
export async function applyOntologyImport(built, { save = null, onProgress = null } = {}) {
  if (!built?.state) throw new Error('Nothing to import.');
  if (save) {
    try { await save(); } catch (e) { console.warn('[OntologyImport] Save before import failed (continuing):', e); }
  }

  onProgress?.({ phase: 'merge' });
  const report = useGraphStore.getState().mergeUniverseState(built.state, { foldSameAs: true });
  if (!report) throw new Error('The import could not be merged into this universe.');

  // Only webs this import brought in are laid out. A web that was already here
  // (a re-import, or a second slice of the same ontology) keeps the arrangement
  // somebody may have given it.
  const added = report.addedGraphIds || [];
  let laidOut = 0;
  for (let i = 0; i < added.length; i++) {
    try { applyOffscreenLayout(added[i]); laidOut++; } catch (e) { console.warn('[OntologyImport] Layout failed for', added[i], e); }
    if (i % 20 === 19) {
      onProgress?.({ phase: 'layout', done: i + 1, total: added.length });
      await yieldToUi();
    }
  }

  if (save) {
    try { await save(); } catch (e) { console.warn('[OntologyImport] Save after import failed:', e); }
  }
  return { ...report, laidOut, folderWebId: built.folderWebId, sourceId: built.sourceId };
}

/** Bring the import's folder web forward. */
export function openImportedFolder(folderWebId, sourceId) {
  const store = useGraphStore.getState();
  if (!folderWebId || !store.graphs.has(folderWebId)) return;
  store.openGraphTabAndBringToTop(folderWebId, sourceId || null);
}
