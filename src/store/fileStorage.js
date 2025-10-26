/**
 * File Storage Module for Redstring
 * Bridge to UniverseManager for backward compatibility
 * Delegates to UniverseManager while maintaining existing API
 */

import { exportToRedstring, importFromRedstring } from '../formats/redstringFormat.js';
import { v4 as uuidv4 } from 'uuid';
import { CONNECTION_DEFAULT_COLOR } from '../constants.js';

// NO UNIVERSE MANAGER IMPORT - This module must be standalone to avoid circular dependencies
// This is a legacy compatibility layer that doesn't need universeManager access

// Global state - now primarily for backward compatibility
let fileHandle = null;
let autoSaveInterval = null;
let isAutoSaveEnabled = true;
let lastSaveTime = 0;
let lastChangeTime = 0;
let preferredDirectory = null;

// Constants
const AUTO_SAVE_INTERVAL = 500; // Auto-save every 500ms (2x per second)
const DEBOUNCE_DELAY = 150; // Wait 150ms after last change before saving
const FILE_NAME = 'universe.redstring';

// Default paths for different operating systems
const DEFAULT_PATHS = {
  mac: ['Documents', 'Documents/redstring'],
  windows: ['Documents', 'Documents\\redstring'],
  linux: ['Documents', 'Documents/redstring']
};

// Storage keys
const STORAGE_KEYS = {
  FILE_HANDLE: 'redstring_universe_handle',
  PREFERRED_DIRECTORY: 'redstring_preferred_directory',
};

// Browser-storage fallback (IndexedDB) for mobile/tablet
const BROWSER_DB_NAME = 'RedstringBrowserUniverse';
const BROWSER_STORE_NAME = 'universe';
const BROWSER_KEY = 'current';

const openBrowserUniverseDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BROWSER_DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(BROWSER_STORE_NAME)) {
        db.createObjectStore(BROWSER_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = () => reject(request.error);
  });
};

const storeBrowserUniverse = async (redstringData) => {
  const db = await openBrowserUniverseDB();
  const tx = db.transaction([BROWSER_STORE_NAME], 'readwrite');
  const store = tx.objectStore(BROWSER_STORE_NAME);
  store.put({ id: BROWSER_KEY, data: redstringData, savedAt: Date.now() });
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

const loadBrowserUniverse = async () => {
  try {
    const db = await openBrowserUniverseDB();
    const tx = db.transaction([BROWSER_STORE_NAME], 'readonly');
    const store = tx.objectStore(BROWSER_STORE_NAME);
    const req = store.get(BROWSER_KEY);
    const result = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result ? result.data : null;
  } catch (e) {
    console.warn('[FileStorage] Failed to load browser-stored universe:', e);
    return null;
  }
};

/**
 * Check if File System Access API is supported
 */
export const isFileSystemSupported = () => {
  return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
};

// Fallback mode for browsers without the File System Access API (e.g., many mobile/tablet browsers)
const isBrowserStorageMode = () => {
  try {
    return !('showSaveFilePicker' in window && 'showOpenFilePicker' in window);
  } catch {
    return true;
  }
};

/**
 * Detect operating system
 */
const getOperatingSystem = () => {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('mac')) return 'mac';
  if (userAgent.includes('win')) return 'windows';
  return 'linux';
};

/**
 * Store preferred directory handle in IndexedDB
 */
const storePreferredDirectory = async (directoryHandle) => {
  try {
    const idbReq = indexedDB.open('redstring-directory', 1);
    idbReq.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('directories')) {
        db.createObjectStore('directories');
      }
    };
    
    return new Promise((resolve, reject) => {
      idbReq.onsuccess = async () => {
        try {
          const db = idbReq.result;
          
          // Check if object store exists before creating transaction
          if (!db.objectStoreNames.contains('directories')) {
            console.warn('[FileStorage] Object store "directories" does not exist');
            db.close();
            return resolve();
          }
          
          const tx = db.transaction('directories', 'readwrite');
          const store = tx.objectStore('directories');
          await store.put(directoryHandle, STORAGE_KEYS.PREFERRED_DIRECTORY);
          preferredDirectory = directoryHandle;
          db.close();
          resolve();
        } catch (error) {
          console.error('[FileStorage] Error storing directory:', error);
          reject(error);
        }
      };
      idbReq.onerror = () => reject(idbReq.error);
    });
  } catch (error) {
    console.warn('[FileStorage] Failed to store preferred directory:', error);
  }
};

/**
 * Try to restore preferred directory handle from IndexedDB
 */
const tryRestorePreferredDirectory = async () => {
  try {
    const idbReq = indexedDB.open('redstring-directory', 1);
    idbReq.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('directories')) {
        db.createObjectStore('directories');
      }
    };
    
    return new Promise((resolve) => {
      idbReq.onsuccess = async () => {
        try {
          const db = idbReq.result;
          
          // Check if object store exists
          if (!db.objectStoreNames.contains('directories')) {
            console.log('[FileStorage] Object store "directories" does not exist');
            db.close();
            return resolve(null);
          }
          
          const tx = db.transaction('directories', 'readonly');
          const store = tx.objectStore('directories');
          const getReq = store.get(STORAGE_KEYS.PREFERRED_DIRECTORY);
          
          getReq.onsuccess = async () => {
            if (getReq.result) {
              // Check if directory handle is still valid
              const permission = await getReq.result.queryPermission({ mode: 'readwrite' });
              if (permission === 'granted') {
                preferredDirectory = getReq.result;
                console.log('[FileStorage] Restored preferred directory handle');
              } else {
                console.log('[FileStorage] Preferred directory handle needs permission re-request');
              }
            }
            db.close();
            resolve(getReq.result || null);
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch (error) {
          console.warn('[FileStorage] Error restoring preferred directory:', error);
          resolve(null);
        }
      };
      idbReq.onerror = () => resolve(null);
    });
  } catch (error) {
    console.warn('[FileStorage] Failed to restore preferred directory:', error);
    return null;
  }
};

/**
 * Try to find universe.redstring in preferred directory
 */
const tryFindUniverseInDirectory = async (directoryHandle) => {
  try {
    // Check permission first
    let permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        console.log('[FileStorage] Permission denied for directory');
        return null;
      }
    }

    // Look for universe.redstring file
    for await (const [name, handle] of directoryHandle.entries()) {
      if (name === FILE_NAME && handle.kind === 'file') {
        console.log('[FileStorage] Found universe.redstring in preferred directory');
        return handle;
      }
    }
    
    console.log('[FileStorage] universe.redstring not found in preferred directory');
    return null;
  } catch (error) {
    console.warn('[FileStorage] Error searching directory:', error);
    return null;
  }
};

/**
 * Store file handle in IndexedDB for persistence across sessions
 */
const storeFileHandle = async (handle) => {
  try {
    fileHandle = handle;
    
    // Store file handle in IndexedDB
    const idbReq = indexedDB.open('redstring-files', 1);
    idbReq.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
    };
    
    return new Promise((resolve, reject) => {
      idbReq.onsuccess = async () => {
        try {
          const db = idbReq.result;
          
          // Check if object store exists before creating transaction
          if (!db.objectStoreNames.contains('files')) {
            // If object store doesn't exist, we need to close and recreate with higher version
            db.close();
            const upgradeReq = indexedDB.open('redstring-files', 2);
            upgradeReq.onupgradeneeded = (event) => {
              const upgradeDb = event.target.result;
              if (!upgradeDb.objectStoreNames.contains('files')) {
                upgradeDb.createObjectStore('files');
              }
            };
            upgradeReq.onsuccess = async () => {
              const upgradeDb = upgradeReq.result;
              const tx = upgradeDb.transaction('files', 'readwrite');
              const store = tx.objectStore('files');
              await store.put(handle, STORAGE_KEYS.FILE_HANDLE);
              
              // Also store the directory for future auto-discovery
              if (handle.parent) {
                await storePreferredDirectory(handle.parent);
              }
              
              console.log('[FileStorage] File handle stored in IndexedDB (after upgrade)');
              upgradeDb.close();
              resolve();
            };
            upgradeReq.onerror = () => reject(upgradeReq.error);
            return;
          }
          
          const tx = db.transaction('files', 'readwrite');
          const store = tx.objectStore('files');
          await store.put(handle, STORAGE_KEYS.FILE_HANDLE);
          
          // Also store the directory for future auto-discovery
          if (handle.parent) {
            await storePreferredDirectory(handle.parent);
          }
          
          console.log('[FileStorage] File handle stored in IndexedDB');
          db.close();
          resolve();
        } catch (error) {
          console.error('[FileStorage] Error in transaction:', error);
          reject(error);
        }
      };
      idbReq.onerror = () => reject(idbReq.error);
    });
  } catch (error) {
    console.error('[FileStorage] Failed to store file handle:', error);
    throw error;
  }
};

/**
 * Try to restore file handle from IndexedDB
 */
const tryRestoreFileHandle = async () => {
  try {
    const idbReq = indexedDB.open('redstring-files', 1);
    idbReq.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
    };
    
    return new Promise((resolve) => {
      idbReq.onsuccess = async () => {
        try {
          const db = idbReq.result;
          
          // Check if object store exists
          if (!db.objectStoreNames.contains('files')) {
            console.log('[FileStorage] Object store "files" does not exist');
            db.close();
            return resolve(false);
          }
          
          const tx = db.transaction('files', 'readonly');
          const store = tx.objectStore('files');
          const getReq = store.get(STORAGE_KEYS.FILE_HANDLE);
          
          getReq.onsuccess = async () => {
            if (getReq.result) {
              // Check if file handle is still valid and accessible
              try {
                const permission = await getReq.result.queryPermission({ mode: 'readwrite' });
                if (permission === 'granted') {
                  fileHandle = getReq.result;
                  console.log('[FileStorage] File handle restored from IndexedDB');
                  db.close();
                  return resolve(true);
                } else {
                  // Try to re-request permission
                  const newPermission = await getReq.result.requestPermission({ mode: 'readwrite' });
                  if (newPermission === 'granted') {
                    fileHandle = getReq.result;
                    console.log('[FileStorage] File handle permission re-granted');
                    db.close();
                    return resolve(true);
                  } else {
                    console.log('[FileStorage] File handle permission denied');
                    db.close();
                    return resolve(false);
                  }
                }
              } catch (error) {
                console.warn('[FileStorage] File handle no longer valid:', error);
                // Clear file handle and disable auto-save to clean up inconsistent state
                fileHandle = null;
                disableAutoSave();
                db.close();
                return resolve(false);
              }
            } else {
              console.log('[FileStorage] No stored file handle found');
              db.close();
              return resolve(false);
            }
          };
          getReq.onerror = () => {
            db.close();
            resolve(false);
          };
        } catch (error) {
          console.warn('[FileStorage] Error restoring file handle:', error);
          resolve(false);
        }
      };
      idbReq.onerror = () => resolve(false);
    });
  } catch (error) {
    console.log('[FileStorage] Could not restore file handle:', error);
    return false;
  }
};

/**
 * Setup auto-save functionality
 */
const setupAutoSave = (getStoreStateFn) => {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
  }
  if (!isAutoSaveEnabled || !getStoreStateFn) return;
  autoSaveInterval = setInterval(async () => {
    try {
      const now = Date.now();
      if (lastChangeTime <= lastSaveTime) return;
      if (now - lastChangeTime < DEBOUNCE_DELAY) return;
      const storeState = getStoreStateFn();
      const redstringData = exportToRedstring(storeState);
      if (isBrowserStorageMode() || !fileHandle) {
        await storeBrowserUniverse(redstringData);
        lastSaveTime = Date.now();
        return;
      }
      const success = await saveToFile(storeState, false);
      if (!success) {
        console.warn('[FileStorage] Auto-save failed');
      }
    } catch (error) {
      console.error('[FileStorage] Auto-save failed:', error);
    }
  }, AUTO_SAVE_INTERVAL);
  console.log(`[FileStorage] Auto-save enabled (every ${AUTO_SAVE_INTERVAL}ms) [mode=${isBrowserStorageMode() ? 'browser' : 'file'}]`);
};

/**
 * Create default state for a brand-new universe:
 * - Includes base "Thing" type
 * - Creates a new prototype named "New Thing" typed by base Thing
 * - Creates a definition graph for it and places one instance on the canvas
 */
const createEmptyState = () => {
  // Base "Thing" type
  const thingId = 'base-thing-prototype';
  const thingPrototype = {
    id: thingId,
    name: 'Thing',
    description: 'The base type for all things. Things are nodes, ideas, nouns, concepts, objects, whatever you want them to be. They will always be at the bottom of the abstraction stack. They are the "atoms" of your Redstring universe.',
    color: '#8B0000',
    typeNodeId: null,
    definitionGraphIds: []
  };

  // Base "Connection" type
  const connectionId = 'base-connection-prototype';
  const connectionPrototype = {
    id: connectionId,
    name: 'Connection',
    description: 'The base type for all connections. Connections are edges, relationships, verbs, actions, predicates, links, or whatever you want them to be. They will always be at the bottom of the connection abstraction stack. They are the "bonds" of your Redstring Universe.',
    color: CONNECTION_DEFAULT_COLOR,
    typeNodeId: null,
    definitionGraphIds: []
  };

  // New default prototype and its graph
  const newThingPrototypeId = uuidv4();
  const newGraphId = uuidv4();

  const prototypeMap = new Map();
  prototypeMap.set(thingId, thingPrototype);
  prototypeMap.set(connectionId, connectionPrototype);
  prototypeMap.set(newThingPrototypeId, {
    id: newThingPrototypeId,
    name: 'New Thing',
    description: '',
    color: '#8B0000',
    typeNodeId: thingId, // Typed as Thing
    definitionGraphIds: [newGraphId]
  });

  // Single instance on the canvas so users can immediately rename it
  const instanceId = uuidv4();
  const instancesMap = new Map();
  instancesMap.set(instanceId, {
    id: instanceId,
    prototypeId: newThingPrototypeId,
    x: 300,
    y: 200,
    scale: 1
  });

  const graphsMap = new Map();
  graphsMap.set(newGraphId, {
    id: newGraphId,
    name: 'New Thing',
    description: '',
    picture: null,
    color: '#8B0000',
    directed: false,
    instances: instancesMap,
    edgeIds: [],
    definingNodeIds: [newThingPrototypeId],
    panOffset: null,
    zoomLevel: null
  });

  return {
    graphs: graphsMap,
    nodePrototypes: prototypeMap,
    edges: new Map(),
    openGraphIds: [newGraphId],
    activeGraphId: newGraphId,
    activeDefinitionNodeId: newThingPrototypeId,
    expandedGraphIds: new Set([newGraphId]),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),

    // Universe file state
    isUniverseLoaded: true,
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true
  };
};

/**
 * Create the universe.redstring file (or let user choose location)
 * Now delegates to UniverseManager
 */
export const createUniverseFile = async () => {
  if (isBrowserStorageMode()) {
    // Mobile/tablet fallback: create in IndexedDB
    const initialState = createEmptyState();
    const redstringData = exportToRedstring(initialState);
    await storeBrowserUniverse(redstringData);
    lastSaveTime = Date.now();
    console.log('[FileStorage] Created browser-stored universe (fallback mode)');
    return initialState;
  }

  try {
    // Get suggested starting directory based on OS
    const suggestedLocations = getSuggestedLocations();
    
    // Prompt user to save the universe.redstring file
    const handle = await window.showSaveFilePicker({
      suggestedName: FILE_NAME,
      startIn: 'documents',
      types: [{
        description: 'Redstring Universe Files',
        accept: { 'application/json': ['.redstring'] }
      }]
    });
    
    await storeFileHandle(handle);
    
    // Create initial empty state
    const initialState = createEmptyState();
    
    // Write initial data to file
    const redstringData = exportToRedstring(initialState);
    const dataString = JSON.stringify(redstringData, null, 2);
    
    const writable = await handle.createWritable({
      keepExistingData: false
    });
    
    await writable.write(dataString);
    await writable.close();
    
    // Store session data
    
    lastSaveTime = Date.now();
    
    // Add to recent files
    await addToRecentFiles(handle, handle.name || FILE_NAME);
    
    console.log(`[FileStorage] Universe file created successfully at: ${handle.name}`);
    
    return initialState;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[FileStorage] User cancelled file creation');
      return null;
    }
    
    // Handle NotAllowedError - common on Windows when File System Access API
    // is blocked by user agent or platform context (e.g., iframe, PWA, etc.)
    if (error.name === 'NotAllowedError' || 
        error.message.includes('not allowed by the user agent') ||
        error.message.includes('not allowed by the platform')) {
      console.warn('[FileStorage] File System Access API blocked, falling back to browser storage:', error.message);
      
      // Fall back to browser storage mode
      const initialState = createEmptyState();
      const redstringData = exportToRedstring(initialState);
      await storeBrowserUniverse(redstringData);
      lastSaveTime = Date.now();
      console.log('[FileStorage] Created browser-stored universe (Windows fallback mode)');
      return initialState;
    }
    
    console.error('[FileStorage] Failed to create universe file:', error);
    throw error;
  }
};

/**
 * Open existing universe.redstring file
 */
export const openUniverseFile = async () => {
  if (isBrowserStorageMode()) {
    // Safari and non-FS-API fallback: allow user to pick a local .redstring via <input type="file">
    const dataFromBrowser = await loadBrowserUniverse();
    // If we already have browser-stored data, load it immediately
    if (dataFromBrowser) {
      const importResult = importFromRedstring(dataFromBrowser);
      console.log('[FileStorage] Opened browser-stored universe');
      return importResult.storeState;
    }

    // Otherwise prompt for a local file using a hidden input
    const file = await new Promise((resolve) => {
      try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.redstring,application/json';
        input.style.position = 'fixed';
        input.style.left = '-9999px';

        let handled = false;
        const cleanup = () => {
          if (input && input.parentNode) input.parentNode.removeChild(input);
          window.removeEventListener('focus', onFocus);
        };
        const onChange = () => {
          handled = true;
          const selected = input.files && input.files[0] ? input.files[0] : null;
          cleanup();
          resolve(selected || null);
        };
        const onFocus = () => {
          // If the file dialog was cancelled, focus returns to the window with no change event
          setTimeout(() => {
            if (!handled) {
              cleanup();
              resolve(null);
            }
          }, 300);
        };

        input.addEventListener('change', onChange, { once: true });
        window.addEventListener('focus', onFocus, { once: true });
        document.body.appendChild(input);
        input.click();
      } catch (e) {
        console.warn('[FileStorage] Fallback file input failed to open:', e);
        resolve(null);
      }
    });

    if (!file) {
      console.log('[FileStorage] User cancelled file selection (fallback mode)');
      return null;
    }

    try {
      const text = await file.text();
      if (!text || text.trim() === '') {
        throw new Error('The selected file is empty (0 bytes).');
      }
      let jsonData;
      try {
        jsonData = JSON.parse(text);
      } catch (parseError) {
        console.error('[FileStorage] JSON parse error (fallback):', parseError);
        throw new Error(`Invalid JSON in universe file: ${parseError.message}.`);
      }
      const importResult = importFromRedstring(jsonData);
      // Persist to browser storage so autosave works in Safari/non-FS environments
      await storeBrowserUniverse(importResult.redstringData || jsonData);
      console.log('[FileStorage] Universe file loaded via file input (fallback mode)');
      return importResult.storeState;
    } catch (error) {
      console.error('[FileStorage] Failed to open universe via fallback input:', error);
      throw error;
    }
  }

  try {
    // Get suggested starting directory based on OS
    const suggestedLocations = getSuggestedLocations();
    
    const [handle] = await window.showOpenFilePicker({
      startIn: 'documents',
      types: [{
        description: 'Redstring Universe Files',
        accept: { 'application/json': ['.redstring'] }
      }],
      multiple: false
    });
    
    // Ensure we have read/write permission up front so autosave can work immediately
    let __permissionForHandle = 'granted';
    try {
      if (typeof handle.queryPermission === 'function') {
        __permissionForHandle = await handle.queryPermission({ mode: 'readwrite' });
        if (__permissionForHandle === 'prompt' && typeof handle.requestPermission === 'function') {
          __permissionForHandle = await handle.requestPermission({ mode: 'readwrite' });
        }
      }
      if (__permissionForHandle !== 'granted') {
        console.warn('[FileStorage] Read/write permission not granted at import time; proceeding read-only');
      }
    } catch (permError) {
      console.warn('[FileStorage] Failed to verify/request permission:', permError);
      __permissionForHandle = 'denied';
    }

    // Only persist file handle if we have permission; otherwise fall back to browser storage for autosave
    if (__permissionForHandle === 'granted') {
      await storeFileHandle(handle);
    }
    
    // Read the file
    const file = await handle.getFile();
    const text = await file.text();
    
    // Validate file content
    if (!text || text.trim() === '') {
      throw new Error('The selected file is empty (0 bytes). This can happen if the file was never saved to or got corrupted. Please create a new universe or choose a different file.');
    }
    
    let jsonData;
    try {
      jsonData = JSON.parse(text);
    } catch (parseError) {
      console.error('[FileStorage] JSON parse error:', parseError);
      throw new Error(`Invalid JSON in universe file: ${parseError.message}. The file may be corrupted.`);
    }
    
    // Import the data
    const importResult = importFromRedstring(jsonData);
    
    if (importResult.errors && importResult.errors.length > 0) {
      console.warn('[FileStorage] Import warnings:', importResult.errors);
    }
    
    // Store session data
    
    // Add to recent files
    await addToRecentFiles(handle, handle.name || FILE_NAME);
    
    console.log(`[FileStorage] Universe file loaded successfully from: ${handle.name}`);
    
    return importResult.storeState;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[FileStorage] User cancelled file selection');
      return null;
    }
    
    // Handle NotAllowedError - common on Windows when File System Access API
    // is blocked by user agent or platform context (e.g., iframe, PWA, etc.)
    if (error.name === 'NotAllowedError' || 
        error.message.includes('not allowed by the user agent') ||
        error.message.includes('not allowed by the platform')) {
      console.warn('[FileStorage] File System Access API blocked, falling back to browser storage:', error.message);
      
      // Try to load from browser storage instead
      const data = await loadBrowserUniverse();
      if (data) {
        const importResult = importFromRedstring(data);
        console.log('[FileStorage] Opened browser-stored universe (Windows fallback mode)');
        return importResult.storeState;
      }
      
      // If no browser storage either, return null to let user create new universe
      console.log('[FileStorage] No browser-stored universe found, user needs to create new one');
      return null;
    }
    
    console.error('[FileStorage] Failed to open universe file:', error);
    throw error;
  }
};

// Track Git loading attempts to prevent spam
let gitLoadingInProgress = false;
let gitLoadingAttempted = false;

/**
 * Smart auto-connect that tries multiple strategies to find universe.redstring
 * @param {Object} options - Options for auto-connect behavior
 * @param {boolean} options.allowGitLoading - Whether to attempt Git loading (default: false for lazy loading)
 */
export const autoConnectToUniverse = async (options = {}) => {
  const { allowGitLoading = false } = options;
  
  if (isBrowserStorageMode()) {
    const data = await loadBrowserUniverse();
    if (data) {
      const importResult = importFromRedstring(data);
      console.log('[FileStorage] Auto-connected (browser storage)');
      return importResult.storeState;
    }
    return null;
  }

  console.log('[FileStorage] Starting auto-connect to universe...');

  // Strategy 1: Try to restore the exact file handle
  const fileRestored = await tryRestoreFileHandle();
  if (fileRestored && fileHandle) {
    try {
      const file = await fileHandle.getFile();
      const text = await file.text();
      
      // Validate file content
      if (!text || text.trim() === '') {
        throw new Error('Stored file is empty');
      }
      
      let jsonData;
      try {
        jsonData = JSON.parse(text);
      } catch (parseError) {
        throw new Error(`Invalid JSON in stored file: ${parseError.message}`);
      }
      
      const importResult = importFromRedstring(jsonData);
      
      
      // Add to recent files
      await addToRecentFiles(fileHandle, fileHandle.name || FILE_NAME);
      
      console.log('[FileStorage] Auto-connected using stored file handle');
      return importResult.storeState;
    } catch (error) {
      console.warn('[FileStorage] Stored file handle failed to load:', error);
      
      // Clear the corrupted/empty file handle from storage and disable auto-save
      fileHandle = null;
      disableAutoSave();
      try {
        await clearIndexedDB();
        console.log('[FileStorage] Cleared corrupted file handle from storage');
      } catch (clearError) {
        console.warn('[FileStorage] Failed to clear corrupted storage:', clearError);
      }
    }
  }

  // Strategy 2: Try to find universe.redstring in the preferred directory
  await tryRestorePreferredDirectory();
  if (preferredDirectory) {
    const foundFile = await tryFindUniverseInDirectory(preferredDirectory);
    if (foundFile) {
      try {
        await storeFileHandle(foundFile);
        const file = await foundFile.getFile();
        const text = await file.text();
        
        // Validate file content
        if (!text || text.trim() === '') {
          throw new Error('Found file is empty');
        }
        
        let jsonData;
        try {
          jsonData = JSON.parse(text);
        } catch (parseError) {
          throw new Error(`Invalid JSON in found file: ${parseError.message}`);
        }
        
        const importResult = importFromRedstring(jsonData);
        
        
        // Add to recent files
        await addToRecentFiles(foundFile, foundFile.name || FILE_NAME);
        
        console.log('[FileStorage] Auto-connected using preferred directory');
        return importResult.storeState;
      } catch (error) {
        console.warn('[FileStorage] Found file but failed to load:', error);
      }
    }
  }

  console.log('[FileStorage] Auto-connect failed, user intervention required');
  return null;
};

/**
 * Get suggested default locations for universe.redstring
 */
export const getSuggestedLocations = () => {
  const os = getOperatingSystem();
  return DEFAULT_PATHS[os] || DEFAULT_PATHS.linux;
};

/**
 * Try to restore the last session with smart auto-connect
 * @param {Object} options - Options for restoration behavior
 * @param {boolean} options.allowGitLoading - Whether to attempt Git loading (default: true for session restore)
 */
export const restoreLastSession = async (options = {}) => {
  // Default to allowing Git loading for session restore (but prevent spam by being selective)
  const { allowGitLoading = true } = options;
  
  try {
    // Simplified auto-connect to avoid circular dependency with universeManager
    let autoConnectResult = null;

    // Try browser storage mode only (no universeManager calls)
    if (isBrowserStorageMode()) {
      const data = await loadBrowserUniverse();
      if (data) {
        const importResult = importFromRedstring(data);
        autoConnectResult = importResult.storeState;
        console.log('[FileStorage] Auto-connected (browser storage)');
      }
    }
    if (autoConnectResult) {
      return {
        success: true,
        storeState: autoConnectResult,
        autoConnected: true,
        hasUniverseFile: true
      };
    }

    // No fallback to localStorage - universe file is required
    console.log('[FileStorage] No universe file found, user must create or open one');
    return { 
      success: false, 
      reason: 'no_universe_file',
      message: 'No universe file found. Please create a new universe or open an existing one.'
    };
  } catch (error) {
    console.error('[FileStorage] Failed to restore session:', error);
    return { 
      success: false, 
      reason: 'error',
      message: `Failed to restore session: ${error.message}`
    };
  }
};

/**
 * Force Git loading for the current universe (called when user accesses Git federation)
 */
export const forceGitUniverseLoad = async () => {
  try {
    console.log('[FileStorage] Force loading Git universe data...');
    if (gitLoadingInProgress) {
      console.log('[FileStorage] Git loading already in progress, skipping force load');
      return { success: false, message: 'Already loading' };
    }
    const autoConnectResult = await autoConnectToUniverse({ allowGitLoading: true });
    if (autoConnectResult) {
      return {
        success: true,
        storeState: autoConnectResult,
        hasUniverseFile: true
      };
    }
    return { success: false, message: 'No Git universe data found' };
  } catch (error) {
    console.error('[FileStorage] Failed to force load Git universe:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Save current state to the universe file
 */
export const saveToFile = async (storeState, showSuccess = true) => {
  // Legacy save function - simplified to avoid circular dependency with universeManager
  try {
    if (isBrowserStorageMode()) {
      // Save to browser storage
      const redstringData = exportToRedstring(storeState);
      await storeBrowserUniverse(redstringData);
      lastSaveTime = Date.now();
      if (showSuccess) {
        console.log('[FileStorage] Universe saved to browser storage');
      }
      return true;
    } else if (fileHandle) {
      // Save to local file handle
      const redstringData = exportToRedstring(storeState);
      const jsonString = JSON.stringify(redstringData, null, 2);
      const writable = await fileHandle.createWritable();
      await writable.write(jsonString);
      await writable.close();
      lastSaveTime = Date.now();
      if (showSuccess) {
        console.log('[FileStorage] Universe saved to local file');
      }
      return true;
    } else {
      // No available save method (e.g., no file handle and not in browser-storage mode)
      // Return false so callers can treat this as a non-fatal no-op during autosave.
      return false;
    }
  } catch (error) {
    console.error('[FileStorage] Failed to save universe:', error);
    throw error;
  }
};

/**
 * Notify that changes have been made to trigger auto-save
 */
export const notifyChanges = () => {
  lastChangeTime = Date.now();
};

/**
 * Enable auto-save with store state getter
 */
export const enableAutoSave = (getStoreStateFn) => {
  isAutoSaveEnabled = true;
  // Trigger initial change notification so auto-save can start working
  notifyChanges();
  setupAutoSave(getStoreStateFn);
};

/**
 * Disable auto-save
 */
export const disableAutoSave = () => {
  isAutoSaveEnabled = false;
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
};

/**
 * Check if we have a file handle and can auto-save
 */
export const canAutoSave = () => {
  return !!fileHandle && isAutoSaveEnabled;
};

/**
 * Get current file status
 */
export const getFileStatus = () => {
  // Legacy compatibility function - no universe manager access to avoid circular dependencies
  return {
    hasFileHandle: fileHandle !== null,
    fileName: fileHandle ? (fileHandle.name || FILE_NAME) : null,
    autoSaveEnabled: isAutoSaveEnabled,
    autoSaveActive: autoSaveInterval !== null,
    lastSaveTime: lastSaveTime,
    lastChangeTime: lastChangeTime,
    // Legacy values for backward compatibility
    activeUniverseSlug: null,
    sourceOfTruth: null
  };
};

// Export the current file handle for migration
export const getCurrentFileHandle = () => fileHandle;

// Recent files management
const RECENT_FILES_DB_NAME = 'RedstringRecentFiles';
const RECENT_FILES_STORE_NAME = 'recentFiles';
const FILE_HANDLES_STORE_NAME = 'fileHandles';
const DB_VERSION = 2; // Increased version for schema update
const MAX_RECENT_FILES = 10;

const openRecentFilesDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RECENT_FILES_DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(RECENT_FILES_STORE_NAME)) {
        db.createObjectStore(RECENT_FILES_STORE_NAME, { keyPath: 'handleId' });
      }
      if (!db.objectStoreNames.contains(FILE_HANDLES_STORE_NAME)) {
        db.createObjectStore(FILE_HANDLES_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
  });
};

const storeRecentFiles = async (files) => {
  const db = await openRecentFilesDB();
  const transaction = db.transaction([RECENT_FILES_STORE_NAME], 'readwrite');
  const store = transaction.objectStore(RECENT_FILES_STORE_NAME);
  
  // Clear existing and add new files
  store.clear();
  files.forEach(file => store.put(file));
  
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

const addToRecentFiles = async (fileHandle, fileName) => {
  try {
    const recentFiles = await getRecentFiles();
    
    // Create new entry
    const newEntry = {
      fileName: fileName,
      lastOpened: Date.now(),
      handleId: `handle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    
    // Store the file handle separately in IndexedDB with unique ID
    await storeFileHandleWithId(fileHandle, newEntry.handleId);
    
    // Remove any existing entry with the same file name
    const filteredFiles = recentFiles.filter(file => file.fileName !== fileName);
    
    // Add new entry at the beginning
    const updatedFiles = [newEntry, ...filteredFiles].slice(0, MAX_RECENT_FILES);
    
    // Store in IndexedDB
    await storeRecentFiles(updatedFiles);
    
    console.log(`[FileStorage] Added ${fileName} to recent files`);
  } catch (error) {
    console.error('[FileStorage] Error adding to recent files:', error);
  }
};

const storeFileHandleWithId = async (handle, handleId) => {
  try {
    const db = await openRecentFilesDB();
    const transaction = db.transaction([FILE_HANDLES_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(FILE_HANDLES_STORE_NAME);
    
    const putRequest = store.put({ id: handleId, handle: handle });
    
    return new Promise((resolve, reject) => {
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    });
  } catch (error) {
    console.error('[FileStorage] Error storing file handle with ID:', error);
    throw error;
  }
};

export const getRecentFiles = async () => {
  try {
    const db = await openRecentFilesDB();
    const transaction = db.transaction([RECENT_FILES_STORE_NAME], 'readonly');
    const store = transaction.objectStore(RECENT_FILES_STORE_NAME);
    const getAllRequest = store.getAll();
    
    return new Promise((resolve, reject) => {
      getAllRequest.onsuccess = () => {
        // Sort by lastOpened descending
        const sortedFiles = (getAllRequest.result || []).sort((a, b) => b.lastOpened - a.lastOpened);
        resolve(sortedFiles);
      };
      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  } catch (error) {
    console.error('[FileStorage] Error getting recent files:', error);
    return [];
  }
};

export const openRecentFile = async (recentFileEntry) => {
  try {
    console.log(`[FileStorage] Opening recent file: ${recentFileEntry.fileName}`);
    
    // Try to restore the file handle
    const handle = await tryRestoreFileHandleById(recentFileEntry.handleId);
    
    if (!handle) {
      throw new Error('File handle no longer available. The file may have been moved or deleted.');
    }
    
    // Read the file with comprehensive error handling
    let file;
    try {
      file = await handle.getFile();
    } catch (fileError) {
      console.error('[FileStorage] Error getting file from handle:', fileError);
      throw new Error('File handle is no longer valid. The file may have been moved, deleted, or permissions changed.');
    }
    
    // Check if file is valid
    if (!file) {
      throw new Error('File handle returned null or undefined file.');
    }
    
    if (typeof file.size === 'undefined') {
      throw new Error('File object is invalid - missing size property.');
    }
    
    // Read file content
    let content;
    try {
      content = await file.text();
    } catch (readError) {
      console.error('[FileStorage] Error reading file content:', readError);
      throw new Error('Failed to read file content. The file may be corrupted or inaccessible.');
    }
    
    // Parse JSON
    let data;
    try {
      data = JSON.parse(content);
    } catch (parseError) {
      console.error('[FileStorage] Error parsing file JSON:', parseError);
      throw new Error('File contains invalid JSON data.');
    }
    
    // Update current file references
    fileHandle = handle;
    
    // Update the last opened time for this file
    const recentFiles = await getRecentFiles();
    const updatedFiles = recentFiles.map(file => 
      file.handleId === recentFileEntry.handleId 
        ? { ...file, lastOpened: Date.now() }
        : file
    );
    await storeRecentFiles(updatedFiles);
    
    // Store the current file handle for auto-save (using original function)
    await storeFileHandle(handle);
    
    console.log(`[FileStorage] Successfully opened recent file: ${recentFileEntry.fileName}`);
    return data;
    
  } catch (error) {
    console.error(`[FileStorage] Error opening recent file ${recentFileEntry.fileName}:`, error);
    
    // Remove the problematic entry from recent files
    await removeFromRecentFiles(recentFileEntry.handleId);
    
    // If this is a file handle error, try to clear all corrupted files
    if (error.message.includes('File handle') || error.message.includes('size')) {
      console.log('[FileStorage] Attempting to clear corrupted recent files');
      await clearCorruptedRecentFiles();
    }
    
    throw error;
  }
};

const removeFromRecentFiles = async (handleId) => {
  try {
    const recentFiles = await getRecentFiles();
    const filteredFiles = recentFiles.filter(file => file.handleId !== handleId);
    await storeRecentFiles(filteredFiles);
    console.log(`[FileStorage] Removed invalid recent file entry`);
  } catch (error) {
    console.error('[FileStorage] Error removing from recent files:', error);
  }
};

const tryRestoreFileHandleById = async (handleId) => {
  try {
    console.log(`[FileStorage] Attempting to restore file handle for ID: ${handleId}`);
    
    const db = await openRecentFilesDB();
    
    if (!db.objectStoreNames.contains(FILE_HANDLES_STORE_NAME)) {
      console.warn(`[FileStorage] Object store "${FILE_HANDLES_STORE_NAME}" not found.`);
      return null;
    }
        
    const transaction = db.transaction([FILE_HANDLES_STORE_NAME], 'readonly');
    const store = transaction.objectStore(FILE_HANDLES_STORE_NAME);
    const getRequest = store.get(handleId);
    
    return new Promise((resolve) => {
      getRequest.onsuccess = () => {
        const result = getRequest.result;
        console.log(`[FileStorage] Retrieved file handle result:`, result);
        if (result && result.handle) {
          console.log(`[FileStorage] File handle restored successfully`);
          resolve(result.handle);
        } else {
          console.warn(`[FileStorage] No file handle found for ID: ${handleId}`);
          resolve(null);
        }
      };
      getRequest.onerror = () => {
        console.error(`[FileStorage] Error retrieving file handle for ID: ${handleId}`);
        resolve(null);
      };
    });
  } catch (error) {
    console.error('[FileStorage] Error restoring file handle by ID:', error);
    return null;
  }
};

/**
 * Clear corrupted recent files
 */
export const clearCorruptedRecentFiles = async () => {
  try {
    console.log('[FileStorage] Clearing potentially corrupted recent files');
    
    const recentFiles = await getRecentFiles();
    const validFiles = [];
    
    for (const file of recentFiles) {
      try {
        const handle = await tryRestoreFileHandleById(file.handleId);
        if (handle) {
          // Test if the handle is still valid
          await handle.getFile();
          validFiles.push(file);
        } else {
          console.log(`[FileStorage] Removing invalid file: ${file.fileName}`);
        }
      } catch (error) {
        console.log(`[FileStorage] Removing corrupted file: ${file.fileName}`, error);
      }
    }
    
    await storeRecentFiles(validFiles);
    console.log(`[FileStorage] Kept ${validFiles.length} valid files, removed ${recentFiles.length - validFiles.length} corrupted files`);
    
    return validFiles;
  } catch (error) {
    console.error('[FileStorage] Error clearing corrupted recent files:', error);
    return [];
  }
};

/**
 * Clear corrupted IndexedDB databases
 */
export const clearIndexedDB = async () => {
  try {
    console.log('[FileStorage] Clearing potentially corrupted IndexedDB databases');
    
    // Clear file handles database
    try {
      const deleteFileDb = indexedDB.deleteDatabase('redstring-files');
      await new Promise((resolve, reject) => {
        deleteFileDb.onsuccess = () => resolve();
        deleteFileDb.onerror = () => reject(deleteFileDb.error);
      });
      console.log('[FileStorage] Cleared redstring-files database');
    } catch (error) {
      console.warn('[FileStorage] Could not clear redstring-files database:', error);
    }
    
    // Clear directory database
    try {
      const deleteDirDb = indexedDB.deleteDatabase('redstring-directory');
      await new Promise((resolve, reject) => {
        deleteDirDb.onsuccess = () => resolve();
        deleteDirDb.onerror = () => reject(deleteDirDb.error);
      });
      console.log('[FileStorage] Cleared redstring-directory database');
    } catch (error) {
      console.warn('[FileStorage] Could not clear redstring-directory database:', error);
    }
    
    // Reset global state
    fileHandle = null;
    preferredDirectory = null;
    
    console.log('[FileStorage] IndexedDB cleared successfully');
  } catch (error) {
    console.error('[FileStorage] Error clearing IndexedDB:', error);
  }
};

/**
 * Clear session data
 */
export const clearSession = async () => {
  fileHandle = null;
  disableAutoSave();
  
  // Also clear IndexedDB to prevent corruption issues
  await clearIndexedDB();
  
  console.log('[FileStorage] Session cleared');
};

/**
 * Force save (for manual save actions)
 */
export const forceSave = async (storeState) => {
  if (!fileHandle) {
    throw new Error('No file selected. Please create or open a universe file first.');
  }
  
  return await saveToFile(storeState, true);
};

/**
 * Initialize with auto-save capability
 */
export const initializeAutoSave = (getStoreStateFn) => {
  if (fileHandle && isAutoSaveEnabled) {
    setupAutoSave(getStoreStateFn);
  }
};

// Legacy functions for compatibility
export const createDefaultFile = createUniverseFile;
export const loadFromFile = openUniverseFile;
export const promptForFile = openUniverseFile; 