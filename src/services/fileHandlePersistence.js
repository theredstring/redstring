/**
 * File Handle Persistence Service
 * 
 * Handles persistent storage of File System Access API handles and metadata.
 * Since FileSystemFileHandle objects cannot be serialized, we store metadata
 * and attempt to restore access using the permission system.
 * 
 * In Electron: file handles are string paths stored in a local JSON file.
 * In Browser: file handles are FileSystemFileHandle objects stored in IndexedDB.
 */

import { isElectron, fileExists } from '../utils/fileAccessAdapter.js';

const DB_NAME = 'RedstringFileHandles';
const DB_VERSION = 2;
const STORE_NAME = 'fileHandles';
const ELECTRON_STORE_NAME = 'fileHandles'; // Storage namespace for Electron

// ============================================================
// Electron Storage Functions (file-based persistence)
// ============================================================

const electronGetAll = async () => {
  if (!isElectron()) return {};
  try {
    return await window.electron.storage.getAll(ELECTRON_STORE_NAME);
  } catch (error) {
    console.error('[FileHandlePersistence] Electron storage read failed:', error);
    return {};
  }
};

const electronGet = async (universeSlug) => {
  if (!isElectron()) return null;
  try {
    return await window.electron.storage.getItem(ELECTRON_STORE_NAME, universeSlug);
  } catch (error) {
    console.error('[FileHandlePersistence] Electron storage get failed:', error);
    return null;
  }
};

const electronSet = async (universeSlug, record) => {
  if (!isElectron()) return false;
  try {
    return await window.electron.storage.setItem(ELECTRON_STORE_NAME, universeSlug, record);
  } catch (error) {
    console.error('[FileHandlePersistence] Electron storage set failed:', error);
    return false;
  }
};

const electronRemove = async (universeSlug) => {
  if (!isElectron()) return false;
  try {
    return await window.electron.storage.removeItem(ELECTRON_STORE_NAME, universeSlug);
  } catch (error) {
    console.error('[FileHandlePersistence] Electron storage remove failed:', error);
    return false;
  }
};

const electronClear = async () => {
  if (!isElectron()) return false;
  try {
    return await window.electron.storage.clear(ELECTRON_STORE_NAME);
  } catch (error) {
    console.error('[FileHandlePersistence] Electron storage clear failed:', error);
    return false;
  }
};

// ============================================================
// IndexedDB Functions (browser persistence)
// ============================================================

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
    // In Electron, fileHandle is a string path; in browser it's a FileHandle object
    let fileName = null;
    let resolvedHandle = fileHandle;
    
    if (isElectron()) {
      // Electron: ensure handle is always a string path
      if (typeof fileHandle === 'string') {
        resolvedHandle = fileHandle;
        const parts = fileHandle.split(/[/\\]/);
        fileName = parts[parts.length - 1];
      } else if (typeof additionalMetadata.handle === 'string') {
        resolvedHandle = additionalMetadata.handle;
        const parts = additionalMetadata.handle.split(/[/\\]/);
        fileName = parts[parts.length - 1];
      } else if (typeof additionalMetadata.displayPath === 'string') {
        resolvedHandle = additionalMetadata.displayPath;
        const parts = additionalMetadata.displayPath.split(/[/\\]/);
        fileName = parts[parts.length - 1];
      } else if (typeof additionalMetadata.path === 'string') {
        resolvedHandle = additionalMetadata.path;
        const parts = additionalMetadata.path.split(/[/\\]/);
        fileName = parts[parts.length - 1];
      }
      console.log(`[FileHandlePersistence] Electron: resolved handle for ${universeSlug}:`, resolvedHandle);
    } else if (fileHandle?.name) {
      fileName = fileHandle.name;
    }
    
    // Build record, ensuring handle doesn't get overwritten by additionalMetadata spread
    const { handle: _ignoredHandle, ...safeAdditionalMetadata } = additionalMetadata;
    
    const record = {
      universeSlug,
      fileName: fileName ?? additionalMetadata.fileName ?? null,
      kind: isElectron() ? 'file' : (fileHandle?.kind ?? additionalMetadata.kind ?? 'file'),
      handle: resolvedHandle,
      isElectron: isElectron(),
      lastAccessed: additionalMetadata.lastAccessed ?? Date.now(),
      displayPath: isElectron() && typeof resolvedHandle === 'string' ? resolvedHandle : (additionalMetadata.displayPath ?? null),
      ...safeAdditionalMetadata
    };
    
    // Use Electron storage or IndexedDB
    if (isElectron()) {
      await electronSet(universeSlug, record);
      console.log(`[FileHandlePersistence] Stored metadata for ${universeSlug}: ${record.fileName || 'unnamed'} (Electron)`);
      return record;
    }
    
    const db = await openDB();
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
    // Use Electron storage or IndexedDB
    if (isElectron()) {
      return await electronGet(universeSlug);
    }
    
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
    // Use Electron storage or IndexedDB
    if (isElectron()) {
      const data = await electronGetAll();
      return Object.values(data || {});
    }
    
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
    // Use Electron storage or IndexedDB
    if (isElectron()) {
      await electronRemove(universeSlug);
      console.log(`[FileHandlePersistence] Removed metadata for ${universeSlug} (Electron)`);
      return;
    }
    
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
  // Electron: file paths don't need permission checks
  if (isElectron() && typeof fileHandle === 'string') {
    const exists = await fileExists(fileHandle);
    return exists ? 'granted' : 'denied';
  }
  
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
  // Electron: file paths don't need permission requests
  if (isElectron() && typeof fileHandle === 'string') {
    const exists = await fileExists(fileHandle);
    return exists ? 'granted' : 'denied';
  }
  
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
  // Electron: verify file path exists
  if (isElectron() && typeof fileHandle === 'string') {
    try {
      const exists = await fileExists(fileHandle);
      return {
        isValid: exists,
        permission: exists ? 'granted' : 'denied',
        needsPermissionPrompt: false,
        reason: exists ? null : 'file_missing'
      };
    } catch (error) {
      return {
        isValid: false,
        permission: 'denied',
        needsPermissionPrompt: false,
        reason: 'file_missing'
      };
    }
  }
  
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
    
    // Extract the handle - in Electron it should be a string path
    let handle = metadata.handle;
    
    // Electron: ensure we have a valid string path
    if (isElectron()) {
      if (typeof handle !== 'string') {
        // Try to recover path from displayPath or other fields
        handle = metadata.displayPath || metadata.path || metadata.lastFilePath;
        console.log(`[FileHandlePersistence] Electron: recovered handle from metadata:`, handle);
      }
      if (typeof handle !== 'string') {
        console.warn(`[FileHandlePersistence] Electron: no valid path found in metadata for ${universeSlug}`, metadata);
        return {
          success: false,
          metadata,
          needsReconnect: true,
          message: 'File path not found in saved metadata. Please reconnect the file.'
        };
      }
    }
    
    if (handle) {
      const access = await verifyFileHandleAccess(handle);
      if (access?.isValid) {
        await storeFileHandleMetadata(universeSlug, handle, {
          lastAccessed: Date.now()
        });
        return {
          success: true,
          handle: handle,
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
    // Use Electron storage or IndexedDB
    if (isElectron()) {
      await electronClear();
      console.log('[FileHandlePersistence] Cleared all file handle metadata (Electron)');
      return;
    }
    
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

/**
 * Debug: Log all stored file handles (useful for troubleshooting)
 */
export const debugFileHandles = async () => {
  const all = await getAllFileHandleMetadata();
  console.log('[FileHandlePersistence] All stored file handles:');
  all.forEach(item => {
    console.log(`  ${item.universeSlug}:`, {
      handle: item.handle,
      handleType: typeof item.handle,
      displayPath: item.displayPath,
      fileName: item.fileName,
      isElectron: item.isElectron
    });
  });
  return all;
};

// Expose debug function globally for console access
if (typeof window !== 'undefined') {
  window.debugFileHandles = debugFileHandles;
  window.clearFileHandles = clearAllFileHandleMetadata;
}

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
  clearAllFileHandleMetadata,
  debugFileHandles
};
