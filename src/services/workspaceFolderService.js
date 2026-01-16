
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
 * @param {object} options - Options for creation
 * @param {boolean} [options.overwrite=true] - Whether to overwrite existing files
 * @returns {Promise<FileSystemFileHandle|null>} The created file handle, or null if no workspace folder
 */
export async function createFileInWorkspace(fileName, content, options = {}) {
    const { overwrite = true } = options;
    const dirHandle = await getWorkspaceHandle();
    if (!dirHandle) return null;

    try {
        // Check permission first
        if (dirHandle.requestPermission) {
            const status = await dirHandle.requestPermission({ mode: 'readwrite' });
            if (status !== 'granted') throw new Error('Permission denied to workspace folder');
        }

        // Safety check: if not overwriting, check existence first
        if (!overwrite) {
            try {
                // Try to get handle without creating - if successful, file exists
                await dirHandle.getFileHandle(fileName, { create: false });
                throw new Error(`File "${fileName}" already exists in workspace. Overwrite prevented.`);
            } catch (e) {
                // If NotFoundError, we are good to proceed. If other error (like the one we just threw), rethrow.
                if (e.message.includes('already exists')) throw e;
                if (e.name !== 'NotFoundError' && e.name !== 'TypeMismatchError') throw e;
            }
        }

        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        return fileHandle;
    } catch (error) {
        console.error('[WorkspaceFolderService] Failed to create file in workspace:', error);
        // Propagate specific errors like overwrite protection
        if (error.message.includes('already exists')) throw error;
        // Return null to allow fallback to system picker
        return null;
    }
}

/**
 * Gets a file handle for a file within the workspace folder
 * @param {string} fileName - The filename to open
 * @returns {Promise<FileSystemFileHandle|null>}
 */
export async function getFileFromWorkspace(fileName) {
    const dirHandle = await getWorkspaceHandle();
    if (!dirHandle) return null;

    try {
        // Check permission if needed
        if (dirHandle.requestPermission) {
            // We can't always request permission without user gesture, but if we already have it from
            // opening the directory, queryPermission might return 'granted'.
            // If it returns 'prompt', we might need to handle that upstream or rely on a user gesture wrapper.
            // For now, let's assume if we have the directory handle, we might have access or get it via prompt.
            const status = await dirHandle.queryPermission({ mode: 'readwrite' });
            if (status !== 'granted') {
                // Try requesting (might fail without user gesture context, but worth a try if supported)
                try {
                    const reqStatus = await dirHandle.requestPermission({ mode: 'readwrite' });
                    if (reqStatus !== 'granted') return null;
                } catch (e) {
                    // Start fresh if permission check fails
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
