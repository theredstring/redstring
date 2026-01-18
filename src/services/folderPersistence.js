/**
 * Folder Persistence Service
 *
 * Manages storage and retrieval of the Redstring workspace folder handle/path.
 * - Web: Stores DirectoryHandle in IndexedDB
 * - Electron: Stores folder path string in localStorage
 */

import { isElectron, validateFolderAccess } from '../utils/fileAccessAdapter.js';
import { getStorageKey } from '../utils/storageUtils.js';



const FOLDER_HANDLE_DB_NAME = () => getStorageKey('RedstringFolderStorage');
const FOLDER_HANDLE_STORE_NAME = 'folderHandles';
const FOLDER_HANDLE_KEY = 'workspaceFolder';
const LOCALSTORAGE_FOLDER_KEY = () => getStorageKey('redstring_workspace_folder_path');

/**
 * Open IndexedDB for folder handle storage (web only)
 */
const openFolderHandleDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FOLDER_HANDLE_DB_NAME(), 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(FOLDER_HANDLE_STORE_NAME)) {
        db.createObjectStore(FOLDER_HANDLE_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Store folder handle or path
 * @param {DirectoryHandle|string} folderHandleOrPath - Browser: DirectoryHandle, Electron: folder path string
 * @returns {Promise<void>}
 */
export const storeFolderHandle = async (folderHandleOrPath) => {
  if (isElectron()) {
    // Electron: Store path in localStorage
    if (typeof folderHandleOrPath !== 'string') {
      throw new Error('Electron requires folder path as string');
    }
    localStorage.setItem(LOCALSTORAGE_FOLDER_KEY(), folderHandleOrPath);
    console.log('[FolderPersistence] Stored folder path in localStorage:', folderHandleOrPath);
  } else {
    // Web: Store DirectoryHandle in IndexedDB
    try {
      const db = await openFolderHandleDB();
      const tx = db.transaction([FOLDER_HANDLE_STORE_NAME], 'readwrite');
      const store = tx.objectStore(FOLDER_HANDLE_STORE_NAME);

      store.put({
        id: FOLDER_HANDLE_KEY,
        handle: folderHandleOrPath,
        savedAt: Date.now()
      });

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      db.close();
      console.log('[FolderPersistence] Stored folder handle in IndexedDB');
    } catch (error) {
      console.error('[FolderPersistence] Failed to store folder handle:', error);
      throw error;
    }
  }
};

/**
 * Retrieve stored folder handle or path
 * @returns {Promise<DirectoryHandle|string|null>} - Browser: DirectoryHandle, Electron: folder path string, or null if not found
 */
export const getFolderHandle = async () => {
  if (isElectron()) {
    // Electron: Retrieve path from localStorage
    const folderPath = localStorage.getItem(LOCALSTORAGE_FOLDER_KEY());
    if (folderPath) {
      console.log('[FolderPersistence] Retrieved folder path from localStorage:', folderPath);
      return folderPath;
    }
    return null;
  } else {
    // Web: Retrieve DirectoryHandle from IndexedDB
    try {
      const db = await openFolderHandleDB();
      const tx = db.transaction([FOLDER_HANDLE_STORE_NAME], 'readonly');
      const store = tx.objectStore(FOLDER_HANDLE_STORE_NAME);
      const request = store.get(FOLDER_HANDLE_KEY);

      const result = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      db.close();

      if (result && result.handle) {
        console.log('[FolderPersistence] Retrieved folder handle from IndexedDB');
        return result.handle;
      }

      return null;
    } catch (error) {
      console.error('[FolderPersistence] Failed to retrieve folder handle:', error);
      return null;
    }
  }
};

/**
 * Clear stored folder handle/path
 * @returns {Promise<void>}
 */
export const clearFolderHandle = async () => {
  if (isElectron()) {
    // Electron: Clear from localStorage
    localStorage.removeItem(LOCALSTORAGE_FOLDER_KEY());
    console.log('[FolderPersistence] Cleared folder path from localStorage');
  } else {
    // Web: Clear from IndexedDB
    try {
      const db = await openFolderHandleDB();
      const tx = db.transaction([FOLDER_HANDLE_STORE_NAME], 'readwrite');
      const store = tx.objectStore(FOLDER_HANDLE_STORE_NAME);

      await store.delete(FOLDER_HANDLE_KEY);

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      db.close();
      console.log('[FolderPersistence] Cleared folder handle from IndexedDB');
    } catch (error) {
      console.error('[FolderPersistence] Failed to clear folder handle:', error);
      throw error;
    }
  }
};

/**
 * Validate that stored folder is still accessible
 * @returns {Promise<{valid: boolean, folderHandle: DirectoryHandle|string|null}>}
 */
export const validateStoredFolder = async () => {
  const folderHandle = await getFolderHandle();

  if (!folderHandle) {
    return { valid: false, folderHandle: null };
  }

  try {
    const isAccessible = await validateFolderAccess(folderHandle);

    if (isAccessible) {
      console.log('[FolderPersistence] Stored folder is valid and accessible');
      return { valid: true, folderHandle };
    } else {
      console.warn('[FolderPersistence] Stored folder exists but is not accessible (permission issue)');
      return { valid: false, folderHandle };
    }
  } catch (error) {
    console.error('[FolderPersistence] Folder validation failed:', error);
    return { valid: false, folderHandle: null };
  }
};

/**
 * Check if folder-based storage is configured
 * @returns {Promise<boolean>}
 */
export const hasFolderConfigured = async () => {
  const folderHandle = await getFolderHandle();
  return folderHandle !== null;
};
