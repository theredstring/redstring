
const WORKSPACE_DB_NAME = 'redstring-workspace';
const WORKSPACE_STORE_NAME = 'folder-handles';

let _cachedHandle = null;

// Opens the IndexedDB instance
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
 * Saves a directory handle to IndexedDB
 * @param {FileSystemDirectoryHandle} handle 
 */
export async function saveWorkspaceHandle(handle) {
    _cachedHandle = handle;
    try {
        const db = await openWorkspaceDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(WORKSPACE_STORE_NAME, 'readwrite');
            const store = tx.objectStore(WORKSPACE_STORE_NAME);
            store.put({ id: 'workspace', handle });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        // Also update localStorage for simple name checking
        localStorage.setItem('redstring_workspace_folder_name', handle.name);
    } catch (error) {
        console.warn('[WorkspaceFolderService] Failed to save handle:', error);
        throw error;
    }
}

/**
 * Retrieves the stored directory handle
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function getWorkspaceHandle() {
    if (_cachedHandle) return _cachedHandle;

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
 * Clears the stored directory handle
 */
export async function clearWorkspaceHandle() {
    _cachedHandle = null;
    localStorage.removeItem('redstring_workspace_folder_name');
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
 * Creates a file in the workspace folder if available
 * @param {string} fileName 
 * @param {string} content 
 * @returns {Promise<FileSystemFileHandle|null>} The created file handle, or null if no workspace folder
 */
export async function createFileInWorkspace(fileName, content) {
    const dirHandle = await getWorkspaceHandle();
    if (!dirHandle) return null;

    try {
        // Check permission first
        if (dirHandle.requestPermission) {
            const status = await dirHandle.requestPermission({ mode: 'readwrite' });
            if (status !== 'granted') throw new Error('Permission denied to workspace folder');
        }

        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
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
