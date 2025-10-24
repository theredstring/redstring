/**
 * Git Storage Module for Redstring
 * Handles automatic persistence to Git repository using the semantic provider
 * Integrates with existing Redstring data flow
 */

import { exportToRedstring, importFromRedstring } from '../formats/redstringFormat.js';

// Global state
let currentProvider = null;
let autoSaveInterval = null;
let isAutoSaveEnabled = true;
let lastSaveTime = 0;
let lastChangeTime = 0;
let isInitialized = false;

// Constants
const AUTO_SAVE_INTERVAL = 5000; // Auto-save every 5 seconds
const DEBOUNCE_DELAY = 2000; // Wait 2 seconds after last change before saving
const MAIN_FILE_NAME = 'universe.redstring';
const BACKUP_FILE_NAME = 'backup.redstring';

/**
 * Initialize Git storage with a semantic provider
 */
export const initializeGitStorage = async (provider) => {
  if (!provider) {
    throw new Error('Provider is required for Git storage');
  }
  
  currentProvider = provider;
  isInitialized = true;
  
  console.log('[GitStorage] Initialized with provider:', provider.name);
  
  // Test connection
  try {
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
      throw new Error('Provider is not available');
    }
    console.log('[GitStorage] Provider connection verified');
  } catch (error) {
    console.error('[GitStorage] Provider connection failed:', error);
    throw error;
  }
};

/**
 * Check if Git storage is initialized
 */
export const isGitStorageInitialized = () => {
  return isInitialized && currentProvider !== null;
};

/**
 * Get current provider
 */
export const getCurrentProvider = () => {
  return currentProvider;
};

/**
 * Load Redstring data from Git repository
 */
export const loadFromGit = async () => {
  if (!isGitStorageInitialized()) {
    throw new Error('Git storage not initialized');
  }
  
  try {
    console.log('[GitStorage] Loading data from Git repository...');
    
    // Try to load the main universe file
    let content;
    try {
      content = await currentProvider.readSemanticFile(MAIN_FILE_NAME);
      console.log('[GitStorage] Loaded main universe file');
    } catch (error) {
      console.log('[GitStorage] Main file not found, trying backup...');
      try {
        content = await currentProvider.readSemanticFile(BACKUP_FILE_NAME);
        console.log('[GitStorage] Loaded backup file');
      } catch (backupError) {
        console.log('[GitStorage] No existing files found, starting fresh');
        return null; // Return null to indicate no existing data
      }
    }
    
    // Parse the content
    const redstringData = JSON.parse(content);
    console.log('[GitStorage] Successfully parsed Redstring data');
    
    return redstringData;
  } catch (error) {
    console.error('[GitStorage] Failed to load from Git:', error);
    throw error;
  }
};

/**
 * Save Redstring data to Git repository
 */
export const saveToGit = async (storeState, showSuccess = true) => {
  if (!isGitStorageInitialized()) {
    throw new Error('Git storage not initialized');
  }
  
  try {
    console.log('[GitStorage] Saving data to Git repository...');
    
    // Export current state to Redstring format
    const redstringData = exportToRedstring(storeState);
    const jsonString = JSON.stringify(redstringData, null, 2);
    
    // Save main file
    await currentProvider.writeSemanticFile(MAIN_FILE_NAME, jsonString);
    
    // Also save a backup
    await currentProvider.writeSemanticFile(BACKUP_FILE_NAME, jsonString);
    
    lastSaveTime = Date.now();
    
    if (showSuccess) {
      console.log('[GitStorage] Successfully saved to Git repository');
    }
    
    return true;
  } catch (error) {
    console.error('[GitStorage] Failed to save to Git:', error);
    throw error;
  }
};

/**
 * Setup auto-save functionality
 */
export const setupGitAutoSave = (getStoreStateFn) => {
  if (!isGitStorageInitialized()) {
    console.warn('[GitStorage] Cannot setup auto-save: not initialized');
    return;
  }
  
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
  }
  
  console.log('[GitStorage] Setting up auto-save (every', AUTO_SAVE_INTERVAL, 'ms)');
  
  autoSaveInterval = setInterval(async () => {
    if (!isAutoSaveEnabled) return;
    
    const timeSinceLastChange = Date.now() - lastChangeTime;
    const timeSinceLastSave = Date.now() - lastSaveTime;
    
    // Only save if enough time has passed since last change and save
    if (timeSinceLastChange > DEBOUNCE_DELAY && timeSinceLastSave > AUTO_SAVE_INTERVAL) {
      try {
        const storeState = getStoreStateFn();
        await saveToGit(storeState, false); // Don't show success message for auto-save
      } catch (error) {
        console.error('[GitStorage] Auto-save failed:', error);
      }
    }
  }, AUTO_SAVE_INTERVAL);
  
  isAutoSaveEnabled = true;
};

/**
 * Enable auto-save
 */
export const enableGitAutoSave = () => {
  isAutoSaveEnabled = true;
  console.log('[GitStorage] Auto-save enabled');
};

/**
 * Disable auto-save
 */
export const disableGitAutoSave = () => {
  isAutoSaveEnabled = false;
  console.log('[GitStorage] Auto-save disabled');
};

/**
 * Check if auto-save is enabled
 */
export const isGitAutoSaveEnabled = () => {
  return isAutoSaveEnabled;
};

/**
 * Notify that changes have been made (triggers auto-save)
 */
export const notifyGitChanges = () => {
  lastChangeTime = Date.now();
};

/**
 * Force save to Git
 */
export const forceSaveToGit = async (storeState) => {
  return await saveToGit(storeState, true);
};

/**
 * Get Git storage status
 */
export const getGitStorageStatus = () => {
  return {
    isInitialized,
    provider: currentProvider?.name || null,
    isAutoSaveEnabled,
    lastSaveTime,
    lastChangeTime,
    hasProvider: currentProvider !== null
  };
};

/**
 * Disconnect from Git storage
 */
export const disconnectGitStorage = () => {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
  
  currentProvider = null;
  isInitialized = false;
  isAutoSaveEnabled = false;
  
  console.log('[GitStorage] Disconnected from Git storage');
};

/**
 * Import Redstring data into the store
 */
export const importFromGit = async (storeActions) => {
  try {
    const redstringData = await loadFromGit();
    if (redstringData) {
      importFromRedstring(redstringData, storeActions);
      console.log('[GitStorage] Successfully imported data from Git');
      return true;
    }
    return false; // No existing data
  } catch (error) {
    console.error('[GitStorage] Failed to import from Git:', error);
    throw error;
  }
};

/**
 * Create initial universe file in Git
 */
export const createUniverseInGit = async (storeState) => {
  if (!isGitStorageInitialized()) {
    throw new Error('Git storage not initialized');
  }
  
  try {
    console.log('[GitStorage] Creating initial universe file in Git...');
    await saveToGit(storeState, false);
    console.log('[GitStorage] Initial universe file created');
    return true;
  } catch (error) {
    console.error('[GitStorage] Failed to create initial universe file:', error);
    throw error;
  }
}; 