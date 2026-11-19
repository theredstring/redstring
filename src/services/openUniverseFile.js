/**
 * Open an existing .redstring file as a new universe, without the Universes
 * panel: onboarding's Open an Existing Universe → File runs this inside its own
 * box. The same steps, in the same order, as the panel's Load and Link
 * Existing File (UniverseManager): read and check the file, make a universe
 * for it, put the data on the canvas, THEN point the universe at the file and
 * save, so the empty placeholder is never what reaches the file.
 *
 * Takes the file one of two ways:
 *  - `handle`: a picked file that stays linked where it is (desktop path,
 *    browser file handle).
 *  - `file`: a File from an <input>, where the platform can't keep a link
 *    (iOS, Android, other browsers). It comes in as a copy: in the app's own
 *    Universes folder on iOS/Android, browser storage elsewhere.
 */
import universeManagerService, { STORAGE_TYPES } from './universeManagerService.js';
import universeBackend from './universeBackend.js';
import { readFileBytes } from '../utils/fileAccessAdapter.js';
import { isCapacitor, usesPathHandles, universeFileHandle } from '../utils/capacitorAdapter.js';
import { parseRedstringBytes, isBlankBytes } from '../formats/universeBytes.js';
import { buildUniqueUniverseName } from '../utils/universeNaming.js';

const fileNameOf = ({ handle, file }) => {
  if (file) return file.name || 'Universe.redstring';
  if (typeof handle === 'string') return handle.split(/[/\\]/).pop();
  return handle?.name || 'Universe.redstring';
};

async function readBytes({ handle, file }) {
  if (file) return new Uint8Array(await file.arrayBuffer());
  if (!usesPathHandles() && typeof handle?.queryPermission === 'function') {
    let permission = await handle.queryPermission({ mode: 'read' });
    if (permission === 'prompt' && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission({ mode: 'read' });
    }
    if (permission !== 'granted') throw new Error('File read permission denied. Please allow file access to continue.');
  }
  return readFileBytes(handle);
}

export async function openUniverseFile({ handle = null, file = null }) {
  const fileName = fileNameOf({ handle, file });

  const bytes = await readBytes({ handle, file });
  if (!bytes || isBlankBytes(bytes)) throw new Error(`"${fileName}" is empty.`);
  let parsed;
  try {
    parsed = await parseRedstringBytes(bytes);
  } catch (err) {
    throw new Error(`"${fileName}" isn't a readable .redstring file.`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`"${fileName}" isn't a readable .redstring file.`);

  const { importFromRedstring, validateFormatVersion } = await import('../formats/redstringFormat.js');
  const validation = validateFormatVersion(parsed);
  if (!validation.valid) {
    if (validation.tooNew) throw new Error(`This file was made with a newer version of Redstring (${validation.version}). Update the app to open it.`);
    if (validation.tooOld) throw new Error(`This file's format is too old (${validation.version}) to open.`);
    throw new Error(validation.error || 'This file could not be read.');
  }
  const { storeState } = importFromRedstring(parsed);

  const name = buildUniqueUniverseName(fileName.replace(/\.redstring$/i, ''), universeBackend.getAllUniverses?.() || []);
  const creation = await universeManagerService.createUniverse(name, { enableGit: false, enableLocal: true });
  const slug = creation?.createdUniverse?.slug
    || creation?.slug
    || (creation?.universes || []).find((u) => u.name === name)?.slug;
  if (!slug) throw new Error('Unable to determine universe slug after creation');
  await universeBackend.switchActiveUniverse(slug);

  // A picked handle stays linked; a copy on iOS/Android goes under the handle
  // createUniverse already gave it in the app's Universes folder.
  const fileHandle = handle || (isCapacitor() ? universeFileHandle(slug) : null);
  const displayPath = usesPathHandles() && typeof fileHandle === 'string' ? fileHandle : fileName;

  const { default: useGraphStore } = await import('../store/graphStore.js');
  useGraphStore.getState().loadUniverseFromFile(storeState);

  try {
    await universeBackend.setFileHandle(slug, fileHandle, { displayPath, fileName, suppressNotification: true });
    const linkPath = usesPathHandles() && fileHandle ? fileHandle : fileName;
    await universeBackend.linkLocalFileToUniverse(slug, linkPath, { displayPath });
    await universeManagerService.forceSave(slug, { skipGit: true });
    await universeManagerService.setPrimaryStorage(slug, STORAGE_TYPES.LOCAL);
  } catch (err) {
    err.slug = slug;
    throw err;
  }

  return { slug, name, fileName };
}
