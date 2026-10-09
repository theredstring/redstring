/**
 * Capacitor (iOS + Android) platform adapter.
 *
 * On Capacitor, universe storage is fully abstracted from the user: the app
 * owns a `Universes/` folder inside its own app-scoped container, and every
 * universe's .redstring file is created and managed there automatically — no
 * pickers, no permission prompts. Where that container lives differs by
 * platform (see defaultManagedDirectory):
 *
 *   iOS      Directory.Documents → visible in the Files app as
 *            On My iPhone → Redstring → Universes, via UIFileSharingEnabled
 *   Android  Directory.Data      → the app's internal files dir, private to
 *            the app. Earlier versions used Directory.External
 *            (/Android/data/io.redstring.app/files), which other apps could
 *            read on Android 10 and below and which rides along on USB/MTP;
 *            existing files are moved once, losslessly (see
 *            migrateAndroidUniversesToData).
 *
 * File handles on Capacitor are prefixed strings:
 *
 *   capacitor://<Directory>/Universes/<slug>.redstring
 *
 * They flow through the same `typeof handle === 'string'` code paths Electron
 * established, are distinguishable from Electron handles (absolute POSIX
 * paths) by the prefix, and encode a Directory enum + relative path rather
 * than an absolute file:// URI — iOS rotates the app-container UUID on
 * reinstall, so absolute paths must never be persisted.
 *
 * All @capacitor/* imports are lazy (dynamic import) so web/Electron bundles
 * don't depend on the Capacitor runtime being present.
 */

import { describeHaptics } from '../services/haptics.js';
import { vlog } from './verboseLog.js';

export const CAP_HANDLE_PREFIX = 'capacitor://';
export const UNIVERSES_FOLDER = 'Universes';

// Only directories we ever encode into handles. Maps handle tag → Directory
// enum string accepted by @capacitor/filesystem (enum values are the same
// strings, so we can pass them through without importing the enum eagerly).
const ALLOWED_DIRECTORIES = new Set(['Documents', 'Data', 'External']);

/**
 * True when running inside the Capacitor native shell. The native bridge
 * injects window.Capacitor before app JS runs; never cache this at module
 * eval time.
 */
export const isCapacitor = () => {
  try {
    if (typeof window === 'undefined') return false;

    const cap = window.Capacitor;
    if (cap) {
      if (typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() === true) return true;
      // Older/partial bridges, and any case where @capacitor/core replaced the
      // injected global with one that reports differently.
      if (cap.isNative === true) return true;
      const platform = cap.platform
        ?? (typeof cap.getPlatform === 'function' ? cap.getPlatform() : null);
      if (platform === 'ios' || platform === 'android') return true;
    }

    // Fall back to the same signals Capacitor's own native-bridge uses to
    // identify the platform (getPlatformId). These come from the native shell
    // itself, so they hold even if window.Capacitor is missing, replaced, or
    // not yet initialized when this is first called — which is the failure that
    // silently drops the app into mobile-web mode: no native file access, so
    // git-only storage, and every isCapacitor()-gated branch turned off.
    if (window.webkit?.messageHandlers?.bridge) return true;
    if (window.androidBridge) return true;

    // Capacitor serves the bundle from a custom scheme (capacitor://localhost).
    const protocol = window.location?.protocol;
    if (protocol === 'capacitor:' || protocol === 'ionic:') return true;

    return false;
  } catch {
    return false;
  }
};

/**
 * Which native shell we are in ('ios' | 'android' | null). Uses the same
 * signals as isCapacitor(), including the native-shell globals, so it is
 * answerable before @capacitor/core has initialized window.Capacitor.
 */
export const capacitorPlatform = () => {
  try {
    if (typeof window === 'undefined') return null;
    const cap = window.Capacitor;
    const platform = cap?.platform
      ?? (typeof cap?.getPlatform === 'function' ? cap.getPlatform() : null);
    if (platform === 'ios' || platform === 'android') return platform;
    if (window.androidBridge) return 'android';
    if (window.webkit?.messageHandlers?.bridge) return 'ios';
    return null;
  } catch {
    return null;
  }
};

/**
 * Root directory for the managed Universes folder.
 *
 * Capacitor's Directory enum is NOT portable. Directory.Documents is the app's
 * private container on iOS, but on Android it resolves to
 * Environment.getExternalStoragePublicDirectory(DIRECTORY_DOCUMENTS) —
 * /storage/emulated/0/Documents, public shared storage. The Filesystem plugin
 * classifies that as a public directory and gates it behind
 * READ/WRITE_EXTERNAL_STORAGE, which are undeclared here and, on API 33+, no
 * longer grant write access under scoped storage at all. Every write to it
 * fails, so the file handle never persists and the universe lands in
 * needs_reconnect.
 *
 * Android uses Directory.Data (Context.getFilesDir): app-private and
 * permission-free. The previous choice, Directory.External
 * (getExternalFilesDir), was readable by any app holding READ_EXTERNAL_STORAGE
 * on Android 10 and below.
 */
const defaultManagedDirectory = () =>
  capacitorPlatform() === 'android' ? 'Data' : 'Documents';

// --- Android: one-time move of universes from External to Data -------------
//
// Handles are persisted strings that name their directory
// (capacitor://External/Universes/x.redstring), in universe metadata and in
// file-handle persistence. Rewriting every stored copy is how a handle gets
// missed, so the handles stay as they are: once the move has been verified,
// an External handle under Universes/ RESOLVES to the same path under Data.

const ANDROID_MOVE_MARKER_KEY = 'redstring_android_universes_moved_to_data_v1';

const androidMoveDone = () => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(ANDROID_MOVE_MARKER_KEY) === 'done';
  } catch {
    return false;
  }
};

const isUniversesPath = (path) =>
  path === UNIVERSES_FOLDER || String(path || '').startsWith(`${UNIVERSES_FOLDER}/`);

/** Where a handle's directory actually lives now. */
export const resolveHandleDirectory = (directory, path) => (
  directory === 'External'
  && capacitorPlatform() === 'android'
  && isUniversesPath(path)
  && androidMoveDone()
    ? 'Data'
    : directory
);

/**
 * Copy every file in External/Universes to Data/Universes, verify each copy
 * byte-for-byte (base64 compare), and only then mark the move done and remove
 * the originals. Any failure leaves the originals untouched and unmarked, so
 * External handles keep resolving to External and the move retries on the
 * next launch. A file already in Data with DIFFERENT content stops the move
 * entirely: nothing is overwritten, nothing is deleted.
 *
 * Idempotent: an identical copy already in Data counts as verified.
 *
 * @returns {Promise<{ moved: number, status: string }>}
 */
export const migrateAndroidUniversesToData = async ({ fsModule } = {}) => {
  if (capacitorPlatform() !== 'android') return { moved: 0, status: 'not-android' };
  if (androidMoveDone()) return { moved: 0, status: 'already-done' };

  const { Filesystem, Directory } = fsModule || await fs();

  let entries;
  try {
    entries = (await Filesystem.readdir({ path: UNIVERSES_FOLDER, directory: Directory.External })).files || [];
  } catch (error) {
    // No External Universes folder (fresh install), or external storage is
    // unmounted. Nothing readable to move now; stay unmarked so a volume that
    // mounts later still gets moved.
    return { moved: 0, status: 'no-source', error };
  }

  const files = entries.filter((entry) => entry && entry.type !== 'directory' && entry.name);
  const readBase64 = async (directory, path) =>
    (await Filesystem.readFile({ path, directory })).data;

  const verified = [];
  for (const entry of files) {
    const path = `${UNIVERSES_FOLDER}/${entry.name}`;
    let source;
    try {
      source = await readBase64(Directory.External, path);
    } catch (error) {
      return { moved: 0, status: 'source-unreadable', file: entry.name, error };
    }

    let existing = null;
    try {
      existing = await readBase64(Directory.Data, path);
    } catch { /* absent: the normal case */ }

    if (existing != null) {
      if (existing !== source) {
        console.warn(`[CapacitorAdapter] Not moving universes: Data already holds a different ${entry.name}`);
        return { moved: 0, status: 'conflict', file: entry.name };
      }
      verified.push(path);
      continue;
    }

    try {
      await Filesystem.writeFile({ path, directory: Directory.Data, data: source, recursive: true });
      const copy = await readBase64(Directory.Data, path);
      if (copy !== source) {
        return { moved: 0, status: 'verify-failed', file: entry.name };
      }
    } catch (error) {
      return { moved: 0, status: 'copy-failed', file: entry.name, error };
    }
    verified.push(path);
  }

  // Every file is safely in Data. Flip resolution first, then tidy up: a
  // crash between the two leaves duplicates, never a loss.
  try {
    localStorage.setItem(ANDROID_MOVE_MARKER_KEY, 'done');
  } catch (error) {
    return { moved: 0, status: 'marker-failed', error };
  }
  for (const path of verified) {
    try {
      await Filesystem.deleteFile({ path, directory: Directory.External });
    } catch { /* a leftover copy in External is harmless */ }
  }
  console.log(`[CapacitorAdapter] Moved ${verified.length} universe file(s) from External to Data`);
  return { moved: verified.length, status: 'moved' };
};

let androidMovePromise = null;

/** Run the Android move once per session before any universe file access. */
const ensureAndroidMove = () => {
  if (capacitorPlatform() !== 'android' || androidMoveDone()) return Promise.resolve();
  if (!androidMovePromise) {
    androidMovePromise = migrateAndroidUniversesToData().catch((error) => {
      console.warn('[CapacitorAdapter] Universe move to Data failed; files stay where they are:', error?.message || error);
    });
  }
  return androidMovePromise;
};

/** parseCapacitorHandle, after the Android move, with its redirect applied. */
const locate = async (handle) => {
  await ensureAndroidMove();
  const { directory, path } = parseCapacitorHandle(handle);
  return { directory: resolveHandleDirectory(directory, path), path };
};

export const __resetAndroidMoveForTests = () => { androidMovePromise = null; };

// Set only when ensureUniversesFolder() had to fall back — getExternalFilesDir
// returns null when external storage is unmounted. Readers never consult this:
// every read parses its directory out of the handle itself, so a fallback only
// changes where NEW universes are created, and existing handles keep resolving.
let _managedDirectoryOverride = null;

const managedDirectory = () => _managedDirectoryOverride || defaultManagedDirectory();

/** Handle for the managed Universes folder on the current platform. */
export const universesFolderHandle = () =>
  `${CAP_HANDLE_PREFIX}${managedDirectory()}/${UNIVERSES_FOLDER}/`;

/**
 * One-time platform report, logged so it is readable in the Xcode console
 * (Capacitor forwards JS console output to the native log). Answers "is the app
 * actually in native mode" without needing Safari Web Inspector.
 */
let __loggedPlatformOnce = false;
export const logPlatformDiagnostics = () => {
  if (__loggedPlatformOnce || typeof window === 'undefined') return;
  __loggedPlatformOnce = true;
  try {
    const cap = window.Capacitor;
    vlog('[Platform] isCapacitor=' + isCapacitor(), JSON.stringify({
      hasCapacitorGlobal: !!cap,
      isNativePlatformType: typeof cap?.isNativePlatform,
      isNativePlatformValue: typeof cap?.isNativePlatform === 'function'
        ? cap.isNativePlatform()
        : null,
      capPlatform: cap?.platform ?? null,
      capIsNative: cap?.isNative ?? null,
      hasWebkitBridge: !!window.webkit?.messageHandlers?.bridge,
      hasAndroidBridge: !!window.androidBridge,
      resolvedPlatform: capacitorPlatform(),
      managedDirectory: managedDirectory(),
      protocol: window.location?.protocol,
      href: window.location?.href,
      hasShowSaveFilePicker: 'showSaveFilePicker' in window,
      haptics: describeHaptics()
    }));
  } catch (err) {
    vlog('[Platform] diagnostics failed:', err?.message || err);
  }
};

// Inlined Electron check (same as fileAccessAdapter.isElectron) to avoid an
// import cycle — fileAccessAdapter imports from this module.
const isElectronRuntime = () => {
  try {
    return typeof window !== 'undefined' && window.electron?.isElectron === true;
  } catch {
    return false;
  }
};

/**
 * True on platforms where file handles are opaque path strings with no
 * FSA-style permission dance (Electron absolute paths, Capacitor prefixed
 * relative paths). Use this instead of isElectron() at call sites that mean
 * "path-string handle mode" rather than "Electron IPC exists".
 */
export const usesPathHandles = () => isElectronRuntime() || isCapacitor();

/**
 * True on native shells that authenticate with GitHub via the device flow and
 * therefore hold self-managed user-to-server tokens, rather than minting
 * installation tokens through the hosted OAuth server.
 */
export const usesDeviceFlowAuth = () => isElectronRuntime() || isCapacitor();

export const isCapacitorHandle = (handle) =>
  typeof handle === 'string' && handle.startsWith(CAP_HANDLE_PREFIX);

export const makeCapacitorHandle = (directory, relPath) => {
  if (!ALLOWED_DIRECTORIES.has(directory)) {
    throw new Error(`[CapacitorAdapter] Unsupported directory "${directory}"`);
  }
  const cleanPath = String(relPath || '').replace(/^\/+/, '');
  return `${CAP_HANDLE_PREFIX}${directory}/${cleanPath}`;
};

/**
 * Parse a capacitor:// handle into { directory, path } for Filesystem calls.
 */
export const parseCapacitorHandle = (handle) => {
  if (!isCapacitorHandle(handle)) {
    throw new Error(`[CapacitorAdapter] Not a Capacitor handle: ${handle}`);
  }
  const rest = handle.slice(CAP_HANDLE_PREFIX.length);
  const slash = rest.indexOf('/');
  const directory = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '' : rest.slice(slash + 1).replace(/\/+$/, '');
  if (!ALLOWED_DIRECTORIES.has(directory)) {
    throw new Error(`[CapacitorAdapter] Unsupported directory in handle: ${handle}`);
  }
  return { directory, path };
};

/** Filename for a universe slug within the managed Universes folder. */
export const universeFileHandle = (slug) => {
  const base = sanitizeFileBaseName(slug);
  return makeCapacitorHandle(managedDirectory(), `${UNIVERSES_FOLDER}/${base}.redstring`);
};

export const sanitizeFileBaseName = (name) => {
  const cleaned = String(name || 'universe')
    .replace(/\.redstring$/i, '')
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '-')
    .trim();
  return cleaned || 'universe';
};

let filesystemModulePromise = null;
const fs = () => {
  if (!filesystemModulePromise) {
    filesystemModulePromise = import('@capacitor/filesystem');
  }
  return filesystemModulePromise;
};

/** Create <managed root>/Universes if missing. Idempotent. */
export const ensureUniversesFolder = async () => {
  await ensureAndroidMove();
  const { Filesystem, Directory } = await fs();

  const mkdirIn = async (dirName) => {
    try {
      await Filesystem.mkdir({
        path: UNIVERSES_FOLDER,
        directory: Directory[dirName],
        recursive: true
      });
    } catch (error) {
      // "Directory exists" is success; anything else is real.
      const msg = String(error?.message || '');
      if (!/exist/i.test(msg)) throw error;
    }
  };

  const preferred = managedDirectory();
  try {
    await mkdirIn(preferred);
  } catch (error) {
    // Android only: getExternalFilesDir is null when external storage is
    // unmounted. Fall back to app-internal storage rather than failing universe
    // creation outright.
    if (preferred === 'Data') throw error;
    console.warn(
      `[CapacitorAdapter] ${preferred} unavailable, falling back to Data:`,
      error?.message || error
    );
    await mkdirIn('Data');
    _managedDirectoryOverride = 'Data';
  }

  return universesFolderHandle();
};

export const capReadTextFile = async (handle) => {
  const { Filesystem, Directory, Encoding } = await fs();
  const { directory, path } = await locate(handle);
  const result = await Filesystem.readFile({
    path,
    directory: Directory[directory],
    encoding: Encoding.UTF8
  });
  return result.data;
};

/**
 * Electron-parity atomic write: write to .tmp, back up the previous version
 * to .bak, then rename over the destination. Falls back to a direct write if
 * the rename dance fails (some plugin versions refuse renaming onto an
 * existing path even after delete).
 */
export const capWriteTextFile = async (handle, content) => {
  const { Filesystem, Directory, Encoding } = await fs();
  const { directory, path } = await locate(handle);
  const dir = Directory[directory];
  const tmpPath = `${path}.tmp`;

  const directWrite = () => Filesystem.writeFile({
    path,
    directory: dir,
    data: content,
    encoding: Encoding.UTF8,
    recursive: true
  });

  try {
    await Filesystem.writeFile({
      path: tmpPath,
      directory: dir,
      data: content,
      encoding: Encoding.UTF8,
      recursive: true
    });

    let hadExisting = false;
    try {
      await Filesystem.stat({ path, directory: dir });
      hadExisting = true;
    } catch { /* first save of this file */ }

    if (hadExisting) {
      try {
        await Filesystem.copy({ from: path, to: `${path}.bak`, directory: dir, toDirectory: dir });
      } catch { /* backup is best-effort */ }
      try {
        await Filesystem.deleteFile({ path, directory: dir });
      } catch { /* rename may still succeed */ }
    }

    await Filesystem.rename({ from: tmpPath, to: path, directory: dir, toDirectory: dir });
    return true;
  } catch (error) {
    console.warn('[CapacitorAdapter] Atomic write failed, falling back to direct write:', error?.message);
    await directWrite();
    try {
      const { Filesystem: F } = await fs();
      await F.deleteFile({ path: tmpPath, directory: dir });
    } catch { /* tmp may not exist */ }
    return true;
  }
};

export const capFileExists = async (handle) => {
  try {
    const { Filesystem, Directory } = await fs();
    const { directory, path } = await locate(handle);
    await Filesystem.stat({ path, directory: Directory[directory] });
    return true;
  } catch {
    return false;
  }
};

export const capDeleteFile = async (handle) => {
  const { Filesystem, Directory } = await fs();
  const { directory, path } = await locate(handle);
  await Filesystem.deleteFile({ path, directory: Directory[directory] });
  return true;
};

/**
 * List .redstring files in the managed Universes folder (or another
 * capacitor:// folder handle). Returns [{ name, handle, kind: 'file' }].
 */
export const capListFiles = async (folderHandle = universesFolderHandle(), extension = '.redstring') => {
  const { Filesystem, Directory } = await fs();
  const { directory, path } = await locate(folderHandle);
  let entries;
  try {
    entries = (await Filesystem.readdir({ path, directory: Directory[directory] })).files || [];
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.type !== 'directory' && (!extension || entry.name.toLowerCase().endsWith(extension)))
    .map((entry) => ({
      name: entry.name,
      handle: makeCapacitorHandle(directory, path ? `${path}/${entry.name}` : entry.name),
      kind: 'file'
    }));
};

/**
 * Register background/pause listeners that fire the given callback so pending
 * saves can flush before iOS suspends the WKWebView. Returns a cleanup fn.
 */
export const registerCapacitorLifecycle = (onBackground) => {
  let listeners = [];
  let disposed = false;
  (async () => {
    try {
      const { App } = await import('@capacitor/app');
      const stateListener = await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) onBackground();
      });
      const pauseListener = await App.addListener('pause', () => onBackground());
      if (disposed) {
        stateListener.remove();
        pauseListener.remove();
      } else {
        listeners = [stateListener, pauseListener];
      }
    } catch (error) {
      console.warn('[CapacitorAdapter] Failed to register lifecycle listeners:', error?.message);
    }
  })();
  return () => {
    disposed = true;
    listeners.forEach((listener) => { try { listener.remove(); } catch { } });
    listeners = [];
  };
};

/**
 * Native HTTP request that bypasses CORS (used for the GitHub device flow,
 * whose endpoints send no CORS headers). Returns { ok, status, body } with
 * body parsed as JSON when possible.
 */
export const capHttpJSON = async (url, { method = 'GET', headers = {}, data } = {}) => {
  const { CapacitorHttp } = await import('@capacitor/core');
  const response = await CapacitorHttp.request({
    url,
    method,
    headers: { Accept: 'application/json', ...headers },
    data
  });
  let body = response.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { /* leave as text */ }
  }
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    body
  };
};
