/**
 * Ontology import in the app: a worker session to read and plan, and the step
 * that folds the result into the open universe or a new one.
 *
 *   const session = createOntologyImportSession();
 *   const summary = await session.index(file, onProgress);
 *   const hits    = await session.search('water');
 *   const preview = await session.preview({ roots, depth });
 *   const built   = await session.build({ roots, depth });
 *   const result  = await applyOntologyImport(built);
 *   session.dispose();
 *
 * Into a new universe instead: prepareNewUniverseFile(name) on the click, then
 * importIntoNewUniverse(built, { name, file }) in place of applyOntologyImport.
 *
 * The merge goes through mergeUniverseState, the same additive path as merging
 * two universes, so an import never removes anything and importing the same
 * slice twice changes nothing the second time (every ID is derived from IRIs).
 * Like any merge it clears undo history; the universe is saved before and after.
 */

import useGraphStore from '../store/graphStore.js';
import { applyOffscreenLayout, layOutStateWebs } from './offscreenLayout.js';
import { createOntologyHandlers } from '../formats/ontology/ontologyHandlers.js';
import { exportToRedstring } from '../formats/redstringFormat.js';
import { isElectron, pickSaveLocation, writeFile } from '../utils/fileAccessAdapter.js';
import { isCapacitor } from '../utils/capacitorAdapter.js';
import { createFileInWorkspace } from './workspaceFolderService.js';

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

  // Webs this import brings in are laid out before the merge, in the built
  // state itself, so thousands of them cost one store update rather than one
  // each. A web that was already here keeps the arrangement somebody may have
  // given it, unless the import adds Things to it (a wider slice of the same
  // source): those have no place in it yet, so it's laid out again after.
  const here = useGraphStore.getState().graphs;
  const fresh = [...built.state.graphs.keys()].filter((gid) => !here.has(gid));
  let laidOut = await layOutStateWebs(built.state, fresh, {
    onProgress: (done, total) => onProgress?.({ phase: 'layout', done, total }),
  });

  onProgress?.({ phase: 'merge' });
  const report = useGraphStore.getState().mergeUniverseState(built.state, { foldSameAs: true });
  if (!report) throw new Error('The import could not be merged into this universe.');

  for (const gid of report.grownGraphIds || []) {
    try { applyOffscreenLayout(gid); laidOut++; } catch (e) { console.warn('[OntologyImport] Layout failed for', gid, e); }
  }

  if (save) {
    try { await save(); } catch (e) { console.warn('[OntologyImport] Save after import failed:', e); }
  }
  return { ...report, laidOut, folderWebId: built.folderWebId, sourceId: built.sourceId };
}

/**
 * Make the file a new universe will live in, as File > New does: in the
 * workspace folder when there is one, otherwise where the person picks. A
 * browser opens its save dialog only straight from a click, so the Import
 * button calls this before anything is built.
 *
 * On iOS the app keeps its own Universes folder, and a browser without file
 * access keeps universes in Git, so there is no file to make: `handle` is null.
 *
 * @param {string} name - the new universe's name
 * @returns {Promise<{ handle, gitOnly: boolean }|null>} null when the person cancels
 */
export async function prepareNewUniverseFile(name) {
  if (isCapacitor()) return { handle: null, gitOnly: false };
  if (!isElectron() && (typeof window === 'undefined' || !('showSaveFilePicker' in window))) {
    return { handle: null, gitOnly: true };
  }

  const suggestedName = `${name}.redstring`;
  const empty = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), viewport: { x: 0, y: 0, zoom: 1 } };
  const content = JSON.stringify(exportToRedstring(empty), null, 2);

  let handle = await createFileInWorkspace(suggestedName, content, { overwrite: false });
  if (!handle) {
    try {
      handle = await pickSaveLocation({ suggestedName });
    } catch (e) {
      // The browser cancels with AbortError; Electron's dialog returns no path.
      if (e?.name === 'AbortError' || (isElectron() && /no path/i.test(e?.message || ''))) return null;
      throw e;
    }
    await writeFile(handle, content);
  }
  return { handle, gitOnly: false };
}

/**
 * Save the open universe, make a new one, link the file prepareNewUniverseFile
 * made and import into it. The new universe is left open.
 *
 * @param {Object} built - from session.build()
 * @param {Object} options
 * @param {string} options.name - the new universe's name
 * @param {Object} options.file - from prepareNewUniverseFile
 * @param {Function} [options.onCreated] - (slug) once the universe exists, before the import
 * @param {Function} [options.onProgress] - as applyOntologyImport
 * @returns {Promise<Object>} applyOntologyImport's report plus { universeSlug }
 */
export async function importIntoNewUniverse(built, { name, file, onCreated = null, onProgress = null }) {
  if (!built?.state) throw new Error('Nothing to import.');
  const { default: universeBackend } = await import('./universeBackend.js');

  try { await universeBackend.saveActiveUniverse(); } catch (e) { console.warn('[OntologyImport] Save of the open universe failed (continuing):', e); }

  const created = await universeBackend.createUniverse(name, file?.gitOnly
    ? { enableGit: true, enableLocal: false }
    : { enableGit: false, enableLocal: true });
  const slug = created?.slug;
  if (!slug) throw new Error('Could not make the new universe.');
  if (file?.handle) {
    await universeBackend.setFileHandle(slug, file.handle, { suppressNotification: true });
  }
  window.dispatchEvent(new CustomEvent('redstring:universe-created', { detail: { slug } }));
  onCreated?.(slug);

  const report = await applyOntologyImport(built, { save: () => universeBackend.saveActiveUniverse(), onProgress });
  return { ...report, universeSlug: slug };
}

/** Bring the import's folder web forward. */
export function openImportedFolder(folderWebId, sourceId) {
  const store = useGraphStore.getState();
  if (!folderWebId || !store.graphs.has(folderWebId)) return;
  store.openGraphTabAndBringToTop(folderWebId, sourceId || null);
}
