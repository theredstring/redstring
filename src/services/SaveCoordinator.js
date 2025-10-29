/**
 * Save Coordinator - Simplified save management system
 * 
 * Coordinates between:
 * - Local file saves (FileStorage)
 * - Git repository commits (GitSyncEngine)
 * 
 * Features:
 * - Single debounced save timer (500ms) for all changes
 * - GitSyncEngine handles its own batching and rate limiting
 * - Consistent state synchronization
 */

import { exportToRedstring } from '../formats/redstringFormat.js';
import { gitAutosavePolicy } from './GitAutosavePolicy.js';

// SIMPLIFIED: No priorities - all changes batched together with a single debounce
const DEBOUNCE_MS = 500; // Wait 500ms after last change before saving

class SaveCoordinator {
  constructor() {
    this.isEnabled = false;
    this.fileStorage = null;
    this.gitSyncEngine = null;

    // SIMPLIFIED: Single state tracking
    this.lastSaveHash = null;
    this.pendingHash = null;  // Hash of changes waiting to be saved
    this.lastState = null;
    this.lastChangeContext = {};
    this.saveTimer = null; // Single timer for all changes

    // Drag performance optimization
    this._lastDragLogTime = 0; // Throttle console logs during drag

    // Status tracking
    this.statusHandlers = new Set();
    this.isSaving = false;
    this.lastError = null;

    console.log('[SaveCoordinator] Initialized with simple batched saves');
  }

  // Status notification system
  onStatusChange(handler) {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  notifyStatus(type, message, details = {}) {
    const status = { type, message, timestamp: Date.now(), ...details };
    this.statusHandlers.forEach(handler => {
      try {
        handler(status);
      } catch (error) {
        console.warn('[SaveCoordinator] Status handler error:', error);
      }
    });
  }

  // Initialize with required dependencies
  initialize(fileStorage, gitSyncEngine) {
    this.fileStorage = fileStorage;
    this.setGitSyncEngine(gitSyncEngine);
    this.isEnabled = true;

    // Initialize Git autosave policy
    gitAutosavePolicy.initialize(gitSyncEngine, this);

    console.log('[SaveCoordinator] Initialized with dependencies and autosave policy');
    this.notifyStatus('info', 'Save coordinator ready with Git autosave policy');
  }

  // Main entry point for state changes
  onStateChange(newState, changeContext = {}) {
    if (!this.isEnabled || !newState) {
      if (!this.isEnabled) {
        console.log('[SaveCoordinator] State change ignored - not enabled');
      }
      return;
    }

    try {
      // PERFORMANCE OPTIMIZATION: Skip expensive hash calculation during drag 'move' phase
      // Only compute hash on drag start/end, not during every frame of movement
      if (changeContext.isDragging === true && changeContext.phase === 'move') {
        // During drag move, just mark dirty and defer everything else
        // We'll compute the hash and save when the drag ends
        this.isDirty = true;
        this.lastState = newState; // Store state for later save
        this.lastChangeContext = changeContext;
        
        // Only log occasionally to avoid console spam (once per second max)
        const now = Date.now();
        if (!this._lastDragLogTime || (now - this._lastDragLogTime) > 1000) {
          console.log('[SaveCoordinator] Drag in progress - deferring hash and save');
          this._lastDragLogTime = now;
        }
        return; // Skip hash calculation and save scheduling during drag
      }

      // Calculate hash for non-drag-move changes
      const stateHash = this.generateStateHash(newState);
      
      // Check if this is a real change
      const hasRealChange = stateHash !== this.lastSaveHash && stateHash !== this.pendingHash;
      
      if (!hasRealChange) {
        return; // No changes, nothing to do
      }

      // Set dirty flag IMMEDIATELY for UI feedback
      this.isDirty = true;
      
      // Handle drag end differently - always process it
      if (changeContext.phase === 'end' && changeContext.isDragging === false) {
        console.log('[SaveCoordinator] Drag ended, processing final state');
        this.pendingHash = stateHash;
        this.dragPendingHash = null;
        this.lastState = newState;
        this.lastChangeContext = changeContext;
        
        // Notify Git autosave policy of the change
        gitAutosavePolicy.onEditActivity();
        
        // Schedule the save
        this.scheduleSave();
        return;
      }

      // If we were dragging and now stopped, use the pending hash
      if (this.dragPendingHash) {
        console.log('[SaveCoordinator] Drag ended, processing pending changes');
        this.pendingHash = this.dragPendingHash;
        this.dragPendingHash = null;
      } else {
        this.pendingHash = stateHash;
      }

      console.log('[SaveCoordinator] State change detected:', changeContext.type || 'unknown', 'hash:', stateHash.substring(0, 8));

      // Store the latest state
      this.lastState = newState;
      this.lastChangeContext = changeContext;

      // Notify Git autosave policy of the change
      gitAutosavePolicy.onEditActivity();

      // Schedule a debounced save (all changes batched together)
      this.scheduleSave();

    } catch (error) {
      console.error('[SaveCoordinator] Error processing state change:', error);
      this.notifyStatus('error', `Save coordination failed: ${error.message}`);
    }
  }

  // Schedule a debounced save (cancels previous timer)
  scheduleSave() {
    // Clear existing timer
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    console.log(`[SaveCoordinator] Scheduling save in ${DEBOUNCE_MS}ms`);

    // Schedule new save
    this.saveTimer = setTimeout(() => {
      this.executeSave();
    }, DEBOUNCE_MS);
  }

  // Execute save (both local and git)
  async executeSave() {
    if (!this.lastState || this.isSaving) return;

    try {
      this.isSaving = true;
      const state = this.lastState;
      
      console.log('[SaveCoordinator] Executing save');

      // Save to local file if available
      if (this.fileStorage && typeof this.fileStorage.saveToFile === 'function') {
        try {
          console.log('[SaveCoordinator] Saving to local file');
          await this.fileStorage.saveToFile(state, false);
        } catch (error) {
          console.error('[SaveCoordinator] Local file save failed:', error);
        }
      }

      // Save to Git if available
      if (this.gitSyncEngine && this.gitSyncEngine.isHealthy()) {
        console.log('[SaveCoordinator] Queuing git save');
        this.gitSyncEngine.updateState(state); // rely on engine change detection to prevent redundant commits
        console.log('[SaveCoordinator] Git save queued, pending commits:', this.gitSyncEngine.pendingCommits?.length);
      }

      // Update save hash after successful save
      if (this.pendingHash) {
        this.lastSaveHash = this.pendingHash;
        this.pendingHash = null;
      }
      // Clear dirty flag after successful save
      this.isDirty = false;
      this.dragPendingHash = null;
      this.notifyStatus('success', 'Save completed');

    } catch (error) {
      console.error('[SaveCoordinator] Save failed:', error);
      this.notifyStatus('error', `Save failed: ${error.message}`);
    } finally {
      this.isSaving = false;
    }
  }

  // Force immediate save (for manual save button)
  async forceSave(state) {
    if (!this.isEnabled) {
      throw new Error('Save coordinator not initialized');
    }

    try {
      console.log('[SaveCoordinator] Force save requested');
      this.notifyStatus('info', 'Force saving...');
      
      // Clear pending timer
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      
      // Update last state
      this.lastState = state;
      
      // Execute save immediately
      await this.executeSave();
      
      this.notifyStatus('success', 'Force save completed');
      return true;

    } catch (error) {
      console.error('[SaveCoordinator] Force save failed:', error);
      this.notifyStatus('error', `Force save failed: ${error.message}`);
      throw error;
    }
  }

  // Generate hash for change detection
  generateStateHash(state) {
    try {
      // Exclude viewport state entirely so viewport-only changes don't trigger saves
      const contentState = {
        graphs: state.graphs ? Array.from(state.graphs.entries()).map(([id, graph]) => {
          const { panOffset, zoomLevel, instances, ...rest } = graph || {};
          // Convert instances Map to array for proper serialization
          const instancesArray = instances ? Array.from(instances.entries()) : [];
          return [id, { ...rest, instances: instancesArray }];
        }) : [],
        nodePrototypes: state.nodePrototypes ? Array.from(state.nodePrototypes.entries()) : [],
        edges: state.edges ? Array.from(state.edges.entries()) : []
      };

      const stateString = JSON.stringify(contentState);

      // FNV-1a hash - faster than simple hash for large strings
      let hash = 2166136261; // FNV offset basis
      for (let i = 0; i < stateString.length; i++) {
        hash ^= stateString.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }

      return (hash >>> 0).toString(); // Convert to unsigned 32-bit integer
    } catch (error) {
      console.warn('[SaveCoordinator] Hash generation failed:', error);
      return Date.now().toString(); // Fallback to timestamp
    }
  }

  // Get current state for autosave policy
  getState() {
    // Return the last state
    if (this.lastState) {
      return this.lastState;
    }

    // Fallback to Git sync engine's local state
    if (this.gitSyncEngine && this.gitSyncEngine.localState) {
      return this.gitSyncEngine.localState.get('current');
    }

    return null;
  }

  // Get current status
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      isSaving: this.isSaving,
      hasPendingSave: this.saveTimer !== null || this.pendingHash !== null,
      lastError: this.lastError,
      gitAutosavePolicy: gitAutosavePolicy.getStatus()
    };
  }

  // Enable/disable the coordinator
  setEnabled(enabled) {
    if (enabled && !this.isEnabled) {
      this.isEnabled = true;
      console.log('[SaveCoordinator] Enabled');
      this.notifyStatus('info', 'Save coordination enabled');
    } else if (!enabled && this.isEnabled) {
      this.isEnabled = false;
      
      // Clear pending timer
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      
      console.log('[SaveCoordinator] Disabled');
      this.notifyStatus('info', 'Save coordination disabled');
    }
  }

  // Check if there are unsaved changes (for immediate UI feedback)
  hasUnsavedChanges() {
    return this.isDirty || this.pendingHash !== null || this.dragPendingHash !== null;
  }

  setGitSyncEngine(gitSyncEngine) {
    this.gitSyncEngine = gitSyncEngine;
    if (gitAutosavePolicy) {
      gitAutosavePolicy.gitSyncEngine = gitSyncEngine;
    }
  }

  // Cleanup
  destroy() {
    this.setEnabled(false);
    this.statusHandlers.clear();
    console.log('[SaveCoordinator] Destroyed');
  }
}

// Export singleton instance
export const saveCoordinator = new SaveCoordinator();
export default saveCoordinator;
