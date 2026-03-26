
import { isElectron } from '../utils/fileAccessAdapter.js';

const WORKSPACE_DB_NAME = 'redstring-workspace';
const WORKSPACE_STORE_NAME = 'folder-handles';
const ELECTRON_STORE = 'workspace';

let _cachedHandle = null;

// Opens the IndexedDB instance (web only)
function openWorkspaceDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(WORKSPACE_DB_NAME, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(WORKSPACE_STORE_NAME)) {
                db.createObjectStore(WORKSPACE_STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Saves a directory handle (web) or folder path (Electron) for the workspace
 * @param {FileSystemDirectoryHandle|string} handleOrPath
 */
export async function saveWorkspaceHandle(handleOrPath) {
    _cachedHandle = handleOrPath;

    if (isElectron()) {
        // Electron: store path string in persistent file-based storage
        try {
            await window.electron.storage.setItem(ELECTRON_STORE, 'folderPath', handleOrPath);
            const folderName = typeof handleOrPath === 'string'
                ? handleOrPath.split(/[/\\]/).pop()
                : handleOrPath;
            localStorage.setItem('redstring_workspace_folder_name', folderName);
        } catch (error) {
            console.warn('[WorkspaceFolderService] Failed to save workspace path (Electron):', error);
            throw error;
        }
        return;
    }

    // Web: store FileSystemDirectoryHandle in IndexedDB
    try {
        const db = await openWorkspaceDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(WORKSPACE_STORE_NAME, 'readwrite');
            const store = tx.objectStore(WORKSPACE_STORE_NAME);
            store.put({ id: 'workspace', handle: handleOrPath });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        // Also update localStorage for simple name checking
        localStorage.setItem('redstring_workspace_folder_name', handleOrPath.name);
    } catch (error) {
        console.warn('[WorkspaceFolderService] Failed to save handle:', error);
        throw error;
    }
}

/**
 * Retrieves the stored directory handle (web) or folder path string (Electron)
 * @returns {Promise<FileSystemDirectoryHandle|string|null>}
 */
export async function getWorkspaceHandle() {
    if (_cachedHandle) return _cachedHandle;

    if (isElectron()) {
        try {
            const folderPath = await window.electron.storage.getItem(ELECTRON_STORE, 'folderPath');
            if (folderPath) {
                _cachedHandle = folderPath;
                return folderPath;
            }
        } catch (error) {
            console.warn('[WorkspaceFolderService] Failed to get workspace path (Electron):', error);
        }
        return null;
    }

    // Web: read FileSystemDirectoryHandle from IndexedDB
    try {
        const db = await openWorkspaceDB();
        const handle = await new Promise((resolve, reject) => {
            const tx = db.transaction(WORKSPACE_STORE_NAME, 'readonly');
            const store = tx.objectStore(WORKSPACE_STORE_NAME);
            const request = store.get('workspace');
            request.onsuccess = () => resolve(request.result?.handle || null);
            request.onerror = () => reject(request.error);
        });

        if (handle) {
            _cachedHandle = handle;
            // Verify permission is still granted if we can
            if (handle.queryPermission) {
                const state = await handle.queryPermission({ mode: 'readwrite' });
                if (state !== 'granted') {
                    // If queryPermission returns prompt or denied, we might need to re-request
                    // but we return the handle anyway so the UI can prompt
                }
            }
        }
        return handle;
    } catch (error) {
        console.warn('[WorkspaceFolderService] Failed to get handle:', error);
        return null;
    }
}

/**
 * Checks whether the stored workspace directory handle has granted readwrite permission.
 * Does NOT request permission (no user gesture needed).
 * @returns {Promise<'granted'|'prompt'|'denied'|null>} Permission state, or null if no handle
 */
export async function checkWorkspacePermission() {
    const handle = await getWorkspaceHandle();
    if (!handle) return null;

    if (typeof handle.queryPermission !== 'function') {
        return 'granted';
    }

    try {
        return await handle.queryPermission({ mode: 'readwrite' });
    } catch (error) {
        console.warn('[WorkspaceFolderService] Failed to query workspace permission:', error);
        return 'denied';
    }
}

/**
 * Requests readwrite permission on the stored workspace directory handle.
 * MUST be called from a user gesture context (click handler).
 * @returns {Promise<'granted'|'denied'|null>} Permission state after request, or null if no handle
 */
export async function requestWorkspacePermission() {
    const handle = await getWorkspaceHandle();
    if (!handle) return null;

    if (typeof handle.requestPermission !== 'function') {
        return 'granted';
    }

    try {
        return await handle.requestPermission({ mode: 'readwrite' });
    } catch (error) {
        console.warn('[WorkspaceFolderService] Failed to request workspace permission:', error);
        return 'denied';
    }
}

/**
 * Clears the stored directory handle
 */
export async function clearWorkspaceHandle() {
    _cachedHandle = null;
    localStorage.removeItem('redstring_workspace_folder_name');

    if (isElectron()) {
        try {
            await window.electron.storage.removeItem(ELECTRON_STORE, 'folderPath');
        } catch (error) {
            console.warn('[WorkspaceFolderService] Failed to clear workspace path (Electron):', error);
        }
        return;
    }

    // Web: clear from IndexedDB
    try {
        const db = await openWorkspaceDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(WORKSPACE_STORE_NAME, 'readwrite');
            const store = tx.objectStore(WORKSPACE_STORE_NAME);
            store.delete('workspace');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (error) {
        console.warn('[WorkspaceFolderService] Failed to clear handle:', error);
    }
}

/**
 * Given a filename like "foo.redstring", returns a deduplicated name
 * by checking for existence in the directory and appending " (N)" if needed.
 * e.g. "foo.redstring" -> "foo (1).redstring" -> "foo (2).redstring"
 */
async function findUniqueFileName(dirHandle, fileName) {
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const ext = dotIndex > 0 ? fileName.slice(dotIndex) : '';

    // Try the original name first
    let candidate = fileName;
    let counter = 0;
    const MAX_ATTEMPTS = 100;

    while (counter < MAX_ATTEMPTS) {
        try {
            await dirHandle.getFileHandle(candidate, { create: false });
            // File exists — try next candidate
            counter++;
            candidate = `${baseName} (${counter})${ext}`;
        } catch (e) {
            if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') {
                // File doesn't exist — this name is available
                return candidate;
            }
            // Unexpected error — bail out with current candidate
            return candidate;
        }
    }

    // Exhausted attempts, return the last candidate anyway
    return candidate;
}

/**
 * Electron version of findUniqueFileName using IPC file existence checks
 */
async function findUniqueFileNameElectron(folderPath, fileName) {
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const ext = dotIndex > 0 ? fileName.slice(dotIndex) : '';

    let candidate = fileName;
    let counter = 0;
    const MAX_ATTEMPTS = 100;

    while (counter < MAX_ATTEMPTS) {
        const fullPath = folderPath.replace(/[/\\]$/, '') + '/' + candidate;
        const exists = await window.electron.fileSystem.fileExists(fullPath);
        if (!exists) return candidate;
        counter++;
        candidate = `${baseName} (${counter})${ext}`;
    }

    return candidate;
}

/**
 * Creates a file in the workspace folder if available
 * @param {string} fileName
 * @param {string} content
 * @param {object} options - Options for creation
 * @param {boolean} [options.overwrite=true] - Whether to overwrite existing files
 * @returns {Promise<FileSystemFileHandle|string|null>} The created file handle/path, or null if no workspace folder
 */
export async function createFileInWorkspace(fileName, content, options = {}) {
    const { overwrite = true } = options;
    const dirHandle = await getWorkspaceHandle();
    if (!dirHandle) return null;

    if (isElectron() && typeof dirHandle === 'string') {
        // Electron: dirHandle is a folder path string
        try {
            let targetFileName = fileName;
            if (!overwrite) {
                targetFileName = await findUniqueFileNameElectron(dirHandle, fileName);
            }

            const fullPath = dirHandle.replace(/[/\\]$/, '') + '/' + targetFileName;
            await window.electron.fileSystem.writeFile(fullPath, content);
            return fullPath;
        } catch (error) {
            console.error('[WorkspaceFolderService] Failed to create file in workspace (Electron):', error);
            return null;
        }
    }

    // Web: use FileSystemDirectoryHandle
    try {
        // Check permission first
        if (dirHandle.requestPermission) {
            const status = await dirHandle.requestPermission({ mode: 'readwrite' });
            if (status !== 'granted') throw new Error('Permission denied to workspace folder');
        }

        let targetFileName = fileName;

        // If not overwriting, find a unique name instead of failing
        if (!overwrite) {
            targetFileName = await findUniqueFileName(dirHandle, fileName);
        }

        const fileHandle = await dirHandle.getFileHandle(targetFileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        return fileHandle;
    } catch (error) {
        console.error('[WorkspaceFolderService] Failed to create file in workspace:', error);
        // Return null to allow fallback to system picker
        return null;
    }
}

/**
 * Gets a file handle/path for a file within the workspace folder
 * @param {string} fileName - The filename to open
 * @returns {Promise<FileSystemFileHandle|string|null>}
 */
export async function getFileFromWorkspace(fileName) {
    const dirHandle = await getWorkspaceHandle();
    if (!dirHandle) return null;

    if (isElectron() && typeof dirHandle === 'string') {
        // Electron: dirHandle is a folder path string
        try {
            const fullPath = dirHandle.replace(/[/\\]$/, '') + '/' + fileName;
            const exists = await window.electron.fileSystem.fileExists(fullPath);
            return exists ? fullPath : null;
        } catch (error) {
            return null;
        }
    }

    // Web: use FileSystemDirectoryHandle
    try {
        // Check permission if needed
        if (dirHandle.requestPermission) {
            const status = await dirHandle.queryPermission({ mode: 'readwrite' });
            if (status !== 'granted') {
                try {
                    const reqStatus = await dirHandle.requestPermission({ mode: 'readwrite' });
                    if (reqStatus !== 'granted') return null;
                } catch (e) {
                    return null;
                }
            }
        }

        // Try to get existing file
        return await dirHandle.getFileHandle(fileName, { create: false });
    } catch (error) {
        // File doesn't exist or permission issue
        return null;
    }
}

/**
 * Checks if a filename exists in the workspace folder
 * @param {string} fileName
 * @returns {Promise<boolean>}
 */
export async function fileExistsInWorkspace(fileName) {
    const handle = await getFileFromWorkspace(fileName);
    return handle !== null;
}
