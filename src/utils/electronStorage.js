/**
 * Electron Storage Adapter
 * 
 * Provides a localStorage-like API that persists to files in Electron.
 * Falls back to actual localStorage in browser environments.
 */

import { isElectron } from './fileAccessAdapter.js';

const SETTINGS_STORE = 'settings';
const UNIVERSE_STORE = 'universes';

/**
 * Get an item from storage (like localStorage.getItem)
 * @param {string} key - The key to retrieve
 * @returns {Promise<string|null>} - The value or null if not found
 */
export const getItem = async (key) => {
  if (isElectron()) {
    try {
      const value = await window.electron.storage.getItem(SETTINGS_STORE, key);
      return value;
    } catch (error) {
      console.warn('[ElectronStorage] getItem failed:', error);
      return null;
    }
  }
  return localStorage.getItem(key);
};

/**
 * Set an item in storage (like localStorage.setItem)
 * @param {string} key - The key to set
 * @param {string} value - The value to store
 * @returns {Promise<void>}
 */
export const setItem = async (key, value) => {
  if (isElectron()) {
    try {
      await window.electron.storage.setItem(SETTINGS_STORE, key, value);
    } catch (error) {
      console.warn('[ElectronStorage] setItem failed:', error);
    }
    return;
  }
  localStorage.setItem(key, value);
};

/**
 * Remove an item from storage (like localStorage.removeItem)
 * @param {string} key - The key to remove
 * @returns {Promise<void>}
 */
export const removeItem = async (key) => {
  if (isElectron()) {
    try {
      await window.electron.storage.removeItem(SETTINGS_STORE, key);
    } catch (error) {
      console.warn('[ElectronStorage] removeItem failed:', error);
    }
    return;
  }
  localStorage.removeItem(key);
};

/**
 * Get all keys from storage
 * @returns {Promise<string[]>} - Array of keys
 */
export const getAllKeys = async () => {
  if (isElectron()) {
    try {
      const data = await window.electron.storage.getAll(SETTINGS_STORE);
      return Object.keys(data || {});
    } catch (error) {
      console.warn('[ElectronStorage] getAllKeys failed:', error);
      return [];
    }
  }
  return Object.keys(localStorage);
};

/**
 * Clear all items from storage
 * @returns {Promise<void>}
 */
export const clear = async () => {
  if (isElectron()) {
    try {
      await window.electron.storage.clear(SETTINGS_STORE);
    } catch (error) {
      console.warn('[ElectronStorage] clear failed:', error);
    }
    return;
  }
  localStorage.clear();
};

/**
 * Get the default Redstring paths (Electron only)
 * @returns {Promise<{data: string, documents: string, userData: string}|null>}
 */
export const getRedstringPaths = async () => {
  if (isElectron()) {
    try {
      return await window.electron.storage.getPaths();
    } catch (error) {
      console.warn('[ElectronStorage] getPaths failed:', error);
      return null;
    }
  }
  return null;
};

/**
 * Synchronous localStorage wrapper for compatibility
 * Note: In Electron, this falls back to in-memory cache for sync access
 */
const syncCache = new Map();
let syncCacheInitialized = false;

export const initSyncCache = async () => {
  if (isElectron() && !syncCacheInitialized) {
    try {
      const data = await window.electron.storage.getAll(SETTINGS_STORE);
      Object.entries(data || {}).forEach(([key, value]) => {
        syncCache.set(key, value);
      });
      syncCacheInitialized = true;
      console.log('[ElectronStorage] Sync cache initialized with', syncCache.size, 'items');
    } catch (error) {
      console.warn('[ElectronStorage] initSyncCache failed:', error);
    }
  }
};

/**
 * Synchronous getItem (uses cache in Electron)
 */
export const getItemSync = (key) => {
  if (isElectron()) {
    return syncCache.get(key) ?? null;
  }
  return localStorage.getItem(key);
};

/**
 * Synchronous setItem (updates cache and persists async in Electron)
 */
export const setItemSync = (key, value) => {
  if (isElectron()) {
    syncCache.set(key, value);
    // Persist asynchronously
    window.electron.storage.setItem(SETTINGS_STORE, key, value).catch(error => {
      console.warn('[ElectronStorage] Async persist failed:', error);
    });
    return;
  }
  localStorage.setItem(key, value);
};

/**
 * Synchronous removeItem (updates cache and persists async in Electron)
 */
export const removeItemSync = (key) => {
  if (isElectron()) {
    syncCache.delete(key);
    // Persist asynchronously
    window.electron.storage.removeItem(SETTINGS_STORE, key).catch(error => {
      console.warn('[ElectronStorage] Async remove failed:', error);
    });
    return;
  }
  localStorage.removeItem(key);
};

export default {
  getItem,
  setItem,
  removeItem,
  getAllKeys,
  clear,
  getRedstringPaths,
  initSyncCache,
  getItemSync,
  setItemSync,
  removeItemSync
};










