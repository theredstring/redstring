/**
 * File access the browser took back, read and restored in one place.
 *
 * On the web the workspace folder and each universe's file are handles kept in
 * IndexedDB. The handles survive between visits; the permission to use them
 * does not. Chrome drops it once every Redstring tab has closed, and on the
 * next visit `queryPermission` answers 'prompt'. Asking again needs a click,
 * so nothing here can run on load: `readFileAccess` only looks, and
 * `grantFileAccess` must be called from inside the click that asked for it.
 *
 * Electron and Capacitor hold plain path strings with no permission model, so
 * every check here passes over them and they never see the prompt.
 */

import {
  getWorkspaceHandle,
  checkWorkspacePermission,
  requestWorkspacePermission
} from './workspaceFolderService.js';
import {
  checkFileHandlePermission,
  requestFileHandlePermission,
  getFileHandleMetadata
} from './fileHandlePersistence.js';

const isBrowserHandle = (handle) =>
  !!handle && typeof handle === 'object' && typeof handle.queryPermission === 'function';

const loadBackend = async () => (await import('./universeBackend.js')).default;

// The live handle if this session has one, else the one persisted for the
// universe. Read only: restoring it into the backend is ensureLocalFileHandle's
// job, and that runs after access is back.
async function fileHandleFor(backend, slug) {
  const live = backend.fileHandles?.get?.(slug);
  if (live) return live;
  try {
    const metadata = await getFileHandleMetadata(slug);
    return metadata?.handle || null;
  } catch {
    return null;
  }
}

/**
 * What the browser currently allows, without asking for anything.
 *
 * @returns {Promise<{
 *   slug: string|null,
 *   universeName: string|null,
 *   folder: { name: string, state: 'granted'|'prompt'|'denied' }|null,
 *   file: { name: string, state: 'granted'|'prompt'|'denied', isSourceOfTruth: boolean }|null
 * }>} `folder` / `file` are null when there is nothing in the browser to ask for.
 */
export async function readFileAccess() {
  const backend = await loadBackend();
  const universe = backend.getActiveUniverse?.() || null;
  const access = {
    slug: universe?.slug || null,
    universeName: universe?.name || null,
    folder: null,
    file: null
  };

  const folderHandle = await getWorkspaceHandle().catch(() => null);
  if (isBrowserHandle(folderHandle)) {
    access.folder = { name: folderHandle.name, state: await checkWorkspacePermission() };
  }

  if (universe?.localFile?.enabled) {
    const fileHandle = await fileHandleFor(backend, universe.slug);
    if (isBrowserHandle(fileHandle)) {
      access.file = {
        name: fileHandle.name || universe.localFile.fileName || `${universe.slug}.redstring`,
        state: await checkFileHandlePermission(fileHandle),
        isSourceOfTruth: universe.sourceOfTruth === 'local'
      };
    }
  }

  return access;
}

/** True when the folder or the file is waiting on the browser. */
export const fileAccessNeeded = (access) =>
  !!access && [access.folder, access.file].some((entry) => entry && entry.state !== 'granted');

/**
 * Whether the active universe failed to load because its own file is locked,
 * as opposed to anything Git could fix. The Git reconnect modal steps aside
 * for this: a local-first universe whose file is locked is not a GitHub
 * problem, even when it also has a repository.
 */
export async function activeLoadBlockedByFileAccess() {
  const backend = await loadBackend();
  const universe = backend.getActiveUniverse?.();
  return universe?.sourceOfTruth === 'local'
    && universe?.localFile?.fileHandleStatus === 'permission_needed';
}

/**
 * Ask the browser for the folder and the file again, then reconnect.
 *
 * MUST run from a click handler. Both asks go before anything slow, while the
 * click is still fresh enough for the browser to accept them. The folder goes
 * first: a grant on it covers the files inside, so for a universe that lives
 * in the workspace folder the file's own ask is usually already answered and
 * the person sees one prompt, not two. If the browser still wants a second
 * click for the file, the returned state says so and the modal asks for it.
 *
 * @returns {Promise<ReturnType<typeof readFileAccess>>} the state afterwards
 */
export async function grantFileAccess() {
  const backend = await loadBackend();
  const universe = backend.getActiveUniverse?.() || null;

  const folderHandle = await getWorkspaceHandle().catch(() => null);
  if (isBrowserHandle(folderHandle) && (await checkWorkspacePermission()) !== 'granted') {
    await requestWorkspacePermission();
  }

  if (universe?.localFile?.enabled) {
    const fileHandle = await fileHandleFor(backend, universe.slug);
    if (isBrowserHandle(fileHandle) && (await checkFileHandlePermission(fileHandle)) !== 'granted') {
      await requestFileHandlePermission(fileHandle);
    }
  }

  // The slow part. With the folder back, every universe that lives in it gets
  // its file resolved again (and the active one reloaded if it came back
  // empty); without it, only the active universe's own file is rechecked.
  const folderNow = isBrowserHandle(folderHandle) ? await checkWorkspacePermission() : null;
  try {
    if (folderNow === 'granted') {
      await backend.reconnectFromWorkspaceFolder();
    } else if (universe) {
      await backend.ensureLocalFileHandle(universe);
    }
  } catch (error) {
    console.warn('[FileAccess] Reconnect after grant failed:', error);
  }

  return readFileAccess();
}

/**
 * Chrome, specifically: it is the browser whose prompt offers "Allow on every
 * visit", which is the one way to stop being asked. Edge, Brave, Opera and the
 * Electron shell are Chromium too but are not promised the same wording.
 */
export function isGoogleChrome() {
  if (typeof navigator === 'undefined') return false;
  const brands = navigator.userAgentData?.brands;
  if (Array.isArray(brands) && brands.length > 0) {
    return brands.some((b) => b.brand === 'Google Chrome');
  }
  const ua = navigator.userAgent || '';
  return /Chrome\//.test(ua) && !/Edg\/|OPR\/|Electron\//.test(ua) && !navigator.brave;
}
