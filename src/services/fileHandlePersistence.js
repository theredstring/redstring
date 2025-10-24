/**
 * File Handle Persistence Service
 * 
 * Handles persistent storage of File System Access API handles and metadata.
 * Since FileSystemFileHandle objects cannot be serialized, we store metadata
 * and attempt to restore access using the permission system.
 */

const DB_NAME = 'RedstringFileHandles';
const DB_VERSION = 2;
const STORE_NAME = 'fileHandles';

/**
 * Open the IndexedDB database for file handle metadata
 */
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'universeSlug' });
        objectStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        objectStore.createIndex('fileName', 'fileName', { unique: false });
      }
    };
  });
};

/**
 * Store file handle metadata for a universe
 * Note: We cannot store the actual FileSystemFileHandle, only metadata about it
 */
export const storeFileHandleMetadata = async (universeSlug, fileHandle = null, additionalMetadata = {}) => {
  try {
    const db = await openDB();
    const record = {
      universeSlug,
      fileName: fileHandle?.name ?? additionalMetadata.fileName ?? null,
      kind: fileHandle?.kind ?? additionalMetadata.kind ?? 'file',
      handle: fileHandle ?? additionalMetadata.handle ?? null,
      lastAccessed: additionalMetadata.lastAccessed ?? Date.now(),
      ...additionalMetadata
    };
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record);
      
      request.onsuccess = () => {
        console.log(`[FileHandlePersistence] Stored metadata for ${universeSlug}: ${record.fileName || 'unnamed'}`);
        resolve(record);
      };
      request.onerror = () => reject(request.error);
      
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[FileHandlePersistence] Failed to store file handle metadata:', error);
    throw error;
  }
};

/**
 * Retrieve file handle metadata for a universe
 */
export const getFileHandleMetadata = async (universeSlug) => {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(universeSlug);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[FileHandlePersistence] Failed to retrieve file handle metadata:', error);
    return null;
  }
};

/**
 * Get all stored file handle metadata
 */
export const getAllFileHandleMetadata = async () => {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
      
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[FileHandlePersistence] Failed to retrieve all file handle metadata:', error);
    return [];
  }
};

/**
 * Remove file handle metadata for a universe
 */
export const removeFileHandleMetadata = async (universeSlug) => {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(universeSlug);
      
      request.onsuccess = () => {
        console.log(`[FileHandlePersistence] Removed metadata for ${universeSlug}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
      
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[FileHandlePersistence] Failed to remove file handle metadata:', error);
    throw error;
  }
};

/**
 * Check if we still have permission to access a file handle
 * @param {FileSystemFileHandle} fileHandle - The handle to check
 * @returns {Promise<'granted'|'denied'|'prompt'>} Permission state
 */
export const checkFileHandlePermission = async (fileHandle) => {
  if (!fileHandle || typeof fileHandle.queryPermission !== 'function') {
    return 'denied';
  }
  
  try {
    // Check current permission state
    const permission = await fileHandle.queryPermission({ mode: 'readwrite' });
    return permission;
  } catch (error) {
    console.warn('[FileHandlePersistence] Failed to query permission:', error);
    return 'denied';
  }
};

/**
 * Request permission for a file handle
 * @param {FileSystemFileHandle} fileHandle - The handle to request permission for
 * @returns {Promise<'granted'|'denied'>} Permission state after request
 */
export const requestFileHandlePermission = async (fileHandle) => {
  if (!fileHandle || typeof fileHandle.requestPermission !== 'function') {
    return 'denied';
  }
  
  try {
    const permission = await fileHandle.requestPermission({ mode: 'readwrite' });
    return permission;
  } catch (error) {
    console.warn('[FileHandlePersistence] Failed to request permission:', error);
    return 'denied';
  }
};

/**
 * Verify a file handle is still valid and accessible
 * This attempts to read the file to confirm access
 * @param {FileSystemFileHandle} fileHandle - The handle to verify
 * @returns {Promise<boolean>} True if handle is valid and accessible
 */
export const verifyFileHandleAccess = async (fileHandle) => {
  if (!fileHandle || typeof fileHandle.queryPermission !== 'function') {
    return {
      isValid: false,
      permission: 'denied',
      reason: 'unavailable'
    };
  }

  let permission = 'denied';
  try {
    permission = await checkFileHandlePermission(fileHandle);
  } catch (error) {
    console.warn('[FileHandlePersistence] Permission query failed:', error);
    return {
      isValid: false,
      permission: 'denied',
      reason: 'permission_query_failed',
      error
    };
  }

  if (permission === 'denied') {
    return {
      isValid: false,
      permission: 'denied',
      reason: 'permission_denied'
    };
  }

  if (permission === 'prompt') {
    // Treat prompt as still connected but requiring a future user gesture.
    return {
      isValid: true,
      permission: 'prompt',
      needsPermissionPrompt: true
    };
  }

  try {
    await fileHandle.getFile();
    return {
      isValid: true,
      permission: 'granted',
      needsPermissionPrompt: false
    };
  } catch (error) {
    const name = String(error?.name || '');
    if (name === 'NotFoundError') {
      return {
        isValid: false,
        permission: 'granted',
        reason: 'file_missing',
        error
      };
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return {
        isValid: false,
        permission: 'denied',
        reason: 'permission_denied',
        error
      };
    }
    console.warn('[FileHandlePersistence] File handle verification failed:', error);
    return {
      isValid: false,
      permission: permission || 'granted',
      reason: 'unknown_error',
      error
    };
  }
};

/**
 * Attempt to restore a file handle for a universe
 * This will check if we have metadata and guide the user to reconnect if needed
 * @param {string} universeSlug - The universe slug
 * @param {FileSystemFileHandle} sessionHandle - Optional handle from current session
 * @returns {Promise<{success: boolean, handle?: FileSystemFileHandle, metadata?: Object, needsReconnect: boolean}>}
 */
export const attemptRestoreFileHandle = async (universeSlug, sessionHandle = null) => {
  try {
    // If we have a session handle, verify it's still valid
    if (sessionHandle) {
      const access = await verifyFileHandleAccess(sessionHandle);
      if (access?.isValid) {
        // Update last accessed time
        const metadata = await getFileHandleMetadata(universeSlug);
        if (metadata) {
          await storeFileHandleMetadata(universeSlug, sessionHandle, {
            lastAccessed: Date.now()
          });
        }
        return {
          success: true,
          handle: sessionHandle,
          metadata: metadata ? { ...metadata, permission: access.permission } : null,
          needsReconnect: false,
          needsPermission: !!access.needsPermissionPrompt,
          permission: access.permission
        };
      }
    }
    
    const metadata = await getFileHandleMetadata(universeSlug);
    if (!metadata) {
      return {
        success: false,
        needsReconnect: true,
        message: 'File access metadata missing. Reconnect the local file to continue.'
      };
    }
    
    if (metadata.handle) {
      const access = await verifyFileHandleAccess(metadata.handle);
      if (access?.isValid) {
        await storeFileHandleMetadata(universeSlug, metadata.handle, {
          ...metadata,
          lastAccessed: Date.now()
        });
        return {
          success: true,
          handle: metadata.handle,
          metadata: { ...metadata, permission: access.permission },
          needsReconnect: false,
          needsPermission: !!access.needsPermissionPrompt,
          permission: access.permission
        };
      } else if (access?.reason === 'file_missing') {
        return {
          success: false,
          metadata,
          needsReconnect: true,
          message: 'The linked file could not be found. Reconnect or choose a new file.'
        };
      } else if (access?.reason === 'permission_denied') {
        return {
          success: false,
          metadata,
          needsReconnect: false,
          needsPermission: true,
          permission: access.permission,
          message: metadata.displayPath
            ? `Permission needed to access ${metadata.displayPath}. Reauthorize access to continue saving.`
            : 'Permission needed to access the linked file.'
        };
      }
    }
    
    const messageLabel = metadata.displayPath || metadata.fileName;
    const message = messageLabel
      ? `File connection lost. Please reconnect to: ${messageLabel}`
      : 'File connection lost. Please reconnect the local file.';
    
    // We have metadata but no valid handle - user needs to reconnect
    return {
      success: false,
      metadata,
      needsReconnect: true,
      message
    };
    
  } catch (error) {
    console.error('[FileHandlePersistence] Failed to restore file handle:', error);
    return {
      success: false,
      needsReconnect: false,
      error: error.message
    };
  }
};

/**
 * Update the last accessed time for a file handle
 */
export const touchFileHandle = async (universeSlug, fileHandle = null) => {
  try {
    const metadata = await getFileHandleMetadata(universeSlug);
    if (metadata) {
      await storeFileHandleMetadata(
        universeSlug,
        fileHandle || metadata.handle || null,
        {
          ...metadata,
          lastAccessed: Date.now()
        }
      );
    }
  } catch (error) {
    console.warn('[FileHandlePersistence] Failed to touch file handle:', error);
  }
};

/**
 * Clear all file handle metadata (useful for debugging/reset)
 */
export const clearAllFileHandleMetadata = async () => {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      
      request.onsuccess = () => {
        console.log('[FileHandlePersistence] Cleared all file handle metadata');
        resolve();
      };
      request.onerror = () => reject(request.error);
      
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[FileHandlePersistence] Failed to clear file handle metadata:', error);
    throw error;
  }
};

export default {
  storeFileHandleMetadata,
  getFileHandleMetadata,
  getAllFileHandleMetadata,
  removeFileHandleMetadata,
  checkFileHandlePermission,
  requestFileHandlePermission,
  verifyFileHandleAccess,
  attemptRestoreFileHandle,
  touchFileHandle,
  clearAllFileHandleMetadata
};
