/**
 * Storage Wrapper for Redstring
 * Provides a unified interface for localStorage that respects debug settings
 * and provides fallbacks when localStorage is disabled or unavailable
 */

// Import getStorageKey for session isolation
import { getStorageKey } from './storageUtils.js';

// Import after the module is defined to avoid circular dependencies
let debugConfig = null;
const getDebugConfig = async () => {
  // Prefer any pre-initialized global debug config
  try {
    if (typeof window !== 'undefined' && window.__REDSTRING_DEBUG_CONFIG__) {
      return window.__REDSTRING_DEBUG_CONFIG__;
    }
  } catch (_) { }

  // If we already cached a config, return it
  if (debugConfig) return debugConfig;

  // Use a minimal, safe fallback without dynamic imports
  debugConfig = {
    isLocalStorageDisabled: () => false,
    isDebugMode: () => false
  };
  return debugConfig;
};

class StorageWrapper {
  constructor() {
    this.isAvailable = this.testStorageAvailability();
    this.memoryStorage = new Map(); // Fallback storage
    this.debugConfig = null;
    this.isDisabledForDebug = false;

    // Initialize debug config check
    this.initializeDebugCheck();
  }

  async initializeDebugCheck() {
    try {
      this.debugConfig = await getDebugConfig();
      this.isDisabledForDebug = !!this.debugConfig.isLocalStorageDisabled?.();

      if (this.isDisabledForDebug) {
        console.warn('[StorageWrapper] Local storage disabled for debugging - using memory storage (data not persisted)');
      }
    } catch (_) {
      // Silent failure; keep safe defaults
      this.debugConfig = { isLocalStorageDisabled: () => false, isDebugMode: () => false };
      this.isDisabledForDebug = false;
    }
  }

  testStorageAvailability() {
    try {
      const test = '__redstring_storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (error) {
      console.warn('[StorageWrapper] localStorage not available:', error);
      return false;
    }
  }

  shouldUseMemoryStorage() {
    return this.isDisabledForDebug || !this.isAvailable;
  }

  setItem(key, value) {
    if (this.shouldUseMemoryStorage()) {
      this.memoryStorage.set(key, value);

      if (this.debugConfig?.isDebugMode?.()) {
        console.log(`[StorageWrapper] Stored in memory: ${key}`);
      }
      return;
    }

    try {
      // Apply session scoping
      const scopedKey = getStorageKey(key);
      localStorage.setItem(scopedKey, value);
    } catch (error) {
      console.warn(`[StorageWrapper] localStorage.setItem failed for ${key}, falling back to memory:`, error);
      this.memoryStorage.set(key, value);
    }
  }

  getItem(key) {
    if (this.shouldUseMemoryStorage()) {
      const value = this.memoryStorage.get(key);

      if (this.debugConfig?.isDebugMode?.()) {
        console.log(`[StorageWrapper] Retrieved from memory: ${key} = ${value ? 'found' : 'not found'}`);
      }

      return value || null;
    }

    try {
      // Apply session scoping
      const scopedKey = getStorageKey(key);
      return localStorage.getItem(scopedKey);
    } catch (error) {
      console.warn(`[StorageWrapper] localStorage.getItem failed for ${key}, checking memory:`, error);
      return this.memoryStorage.get(key) || null;
    }
  }

  removeItem(key) {
    if (this.shouldUseMemoryStorage()) {
      this.memoryStorage.delete(key);

      if (this.debugConfig?.isDebugMode?.()) {
        console.log(`[StorageWrapper] Removed from memory: ${key}`);
      }
      return;
    }

    try {
      // Apply session scoping
      const scopedKey = getStorageKey(key);
      localStorage.removeItem(scopedKey);
    } catch (error) {
      console.warn(`[StorageWrapper] localStorage.removeItem failed for ${key}:`, error);
    }

    // Also remove from memory storage in case it was stored there as fallback
    this.memoryStorage.delete(key);
  }

  clear() {
    if (this.shouldUseMemoryStorage()) {
      this.memoryStorage.clear();

      if (this.debugConfig?.isDebugMode?.()) {
        console.log('[StorageWrapper] Cleared memory storage');
      }
      return;
    }

    try {
      // Cannot properly clear only session items without iterating everything
      // For now, doing a real clear() wipes everything, which matches legacy behavior
      // but ideally we would filter.
      // However, `localStorage.clear()` is historically aggressive.
      // SAFEGUARD: Only clear if NO session is active? 
      // Actually, if we are in a session, we might want to clear ONLY session items.

      // Check for session param
      let sessionParam = null;
      if (typeof window !== 'undefined') {
        sessionParam = new URLSearchParams(window.location.search).get('session');
      }

      if (sessionParam) {
        // Clear only session scoped items
        const prefix = `session_${sessionParam}_`;
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        console.log(`[StorageWrapper] Cleared ${keysToRemove.length} session-scoped items for '${sessionParam}'`);
      } else {
        localStorage.clear();
      }

    } catch (error) {
      console.warn('[StorageWrapper] localStorage.clear failed:', error);
    }

    // Also clear memory storage
    this.memoryStorage.clear();
  }

  key(index) {
    if (this.shouldUseMemoryStorage()) {
      const keys = Array.from(this.memoryStorage.keys());
      return keys[index] || null;
    }

    try {
      return localStorage.key(index);
    } catch (error) {
      console.warn(`[StorageWrapper] localStorage.key failed for index ${index}:`, error);
      return null;
    }
  }

  get length() {
    if (this.shouldUseMemoryStorage()) {
      return this.memoryStorage.size;
    }

    try {
      return localStorage.length;
    } catch (error) {
      console.warn('[StorageWrapper] localStorage.length failed:', error);
      return this.memoryStorage.size;
    }
  }

  // Get storage status for debugging
  getStorageStatus() {
    return {
      available: this.isAvailable,
      disabledForDebug: this.isDisabledForDebug,
      usingMemoryStorage: this.shouldUseMemoryStorage(),
      memoryStorageSize: this.memoryStorage.size,
      localStorageSize: this.isAvailable ? localStorage.length : 0
    };
  }

  // Warn about data loss when using memory storage
  warnAboutDataLoss() {
    if (this.shouldUseMemoryStorage() && this.memoryStorage.size > 0) {
      console.warn('[StorageWrapper] Data is stored in memory only and will be lost on page reload!');
    }
  }

  // Method to check if we should save persistence preferences
  // (we don't want to persist the debug setting that disables persistence!)
  shouldPersistPreferences() {
    // Always try to persist preferences unless localStorage is completely unavailable
    // Even in debug mode, we want to persist the debug settings themselves
    return this.isAvailable;
  }
}

// Export singleton instance
export const storageWrapper = new StorageWrapper();

// Export utility functions for common patterns
export const setStorageItem = (key, value) => storageWrapper.setItem(key, value);
export const getStorageItem = (key) => storageWrapper.getItem(key);
export const removeStorageItem = (key) => storageWrapper.removeItem(key);
export const clearStorage = () => storageWrapper.clear();
export const getStorageStatus = () => storageWrapper.getStorageStatus();

// For backwards compatibility, also export localStorage-like interface
export const storage = {
  setItem: (key, value) => storageWrapper.setItem(key, value),
  getItem: (key) => storageWrapper.getItem(key),
  removeItem: (key) => storageWrapper.removeItem(key),
  clear: () => storageWrapper.clear(),
  key: (index) => storageWrapper.key(index),
  get length() { return storageWrapper.length; }
};

export default storageWrapper;