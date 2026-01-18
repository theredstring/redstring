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
const DEBOUNCE_MS = 3000; // Wait 3000ms after last change before saving (merges node drop + view restore)

class SaveCoordinator {
  constructor() {
    this.isEnabled = false;
    this.fileStorage = null;
    this.gitSyncEngine = null;

    // SIMPLIFIED: Single state tracking
    this.lastSaveHash = null;
    this.pendingHash = null;  // Hash of changes waiting to be saved
    this.pendingString = null; // Pre-serialized JSON string from worker
    this.pendingRedstringData = null; // Pre-computed Redstring object from worker
    this.lastState = null;
    this.lastChangeContext = {};
    this.saveTimer = null; // Single timer for all changes

    // Drag performance optimization
    this._lastDragLogTime = 0; // Throttle console logs during drag
    this._lastInteractionEndTime = 0; // Track when interaction ended for cooldown

    // Status tracking
    this.statusHandlers = new Set();
    this.isSaving = false;
    this.lastError = null;
    this.isGlobalDragging = false; // Track drag state globally to prevent interleaved updates from triggering saves
    
    // Worker for offloading heavy serialization
    this.saveWorker = null;
    this.workerProcessing = false;
    this.workerDirty = false;
    this.nextStateToProcess = null;

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

    // Initialize Save Worker
    try {
      this.saveWorker = new Worker(new URL('./save.worker.js', import.meta.url), { type: 'module' });
      this.saveWorker.onmessage = this.handleWorkerMessage.bind(this);
      console.log('[SaveCoordinator] Save worker initialized');
    } catch (e) {
      console.warn('[SaveCoordinator] Failed to initialize save worker:', e);
      this.saveWorker = null;
    }

    // Initialize Git autosave policy
    gitAutosavePolicy.initialize(gitSyncEngine, this);

    console.log('[SaveCoordinator] Initialized with dependencies and autosave policy');
    this.notifyStatus('info', 'Save coordinator ready with Git autosave policy');
  }

  handleWorkerMessage(e) {
    const { type, hash, jsonString, redstringData, success, error } = e.data;

    this.workerProcessing = false;

    if (type === 'save_processed' && success) {
      // Worker finished processing

      // Check if hash changed
      if (hash !== this.lastSaveHash && hash !== this.pendingHash) {
        this.pendingHash = hash;
        this.pendingString = jsonString; // Store the pre-serialized string
        this.pendingRedstringData = redstringData; // Store the pre-computed object

        console.log('[SaveCoordinator] Change detected by worker, hash:', hash.substring(0, 8));
        this.isDirty = true;
        this.notifyStatus('info', 'Changes detected');

        // Notify Git autosave policy
        gitAutosavePolicy.onEditActivity();

        // Schedule the actual write
        this.scheduleSave();
      }
    } else if (type === 'error') {
      console.error('[SaveCoordinator] Worker error:', error);
      this.notifyStatus('error', `Worker save failed: ${error}`);
    }

    // Process any queued updates
    if (this.workerDirty) {
      this.workerDirty = false;
      this.sendToWorker();
    }
  }

  sendToWorker() {
    if (!this.saveWorker || !this.nextStateToProcess) return;
    
    this.workerProcessing = true;

    // Extract only data properties for the worker to avoid DataCloneError
    // The store state often contains functions (actions) mixed in
    const {
      graphs,
      nodePrototypes,
      edges,
      openGraphIds,
      activeGraphId,
      activeDefinitionNodeId,
      expandedGraphIds,
      rightPanelTabs,
      savedNodeIds,
      savedGraphIds,
      showConnectionNames
    } = this.nextStateToProcess;

    const cleanState = {
      graphs,
      nodePrototypes,
      edges,
      openGraphIds,
      activeGraphId,
      activeDefinitionNodeId,
      expandedGraphIds,
      rightPanelTabs,
      savedNodeIds,
      savedGraphIds,
      showConnectionNames
    };

    this.saveWorker.postMessage({
      type: 'process_save',
      state: cleanState,
      userDomain: null 
    });
    
    // Keep reference for fallback/Git sync
    this.lastState = this.nextStateToProcess;
    this.nextStateToProcess = null; 
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
      // Skip processing for viewport-only changes (pan/zoom) - these don't affect the save hash
      // This prevents unnecessary worker processing during keyboard/wheel panning and zooming
      if (changeContext.type === 'viewport' && !changeContext.forceProcess) {
        // Just update the latest state reference for when content changes happen
        this.nextStateToProcess = newState;
        return;
      }

      // Update global interaction state based on context
      // Track drag, pan, pinch, and animation states
      const isInteracting = changeContext.isDragging === true || 
                           changeContext.isPanning === true ||
                           changeContext.isPinching === true ||
                           changeContext.isAnimating === true;
                           
      if (isInteracting) {
        if (!this.isGlobalDragging) {
          console.log('[SaveCoordinator] Interaction started:', { 
            isDragging: changeContext.isDragging, 
            isPanning: changeContext.isPanning,
            isPinching: changeContext.isPinching,
            isAnimating: changeContext.isAnimating,
            phase: changeContext.phase,
            type: changeContext.type
          });
        }
        this.isGlobalDragging = true;
      } else if (changeContext.phase === 'end' || changeContext.phase === 'complete') {
        if (this.isGlobalDragging) {
          console.log('[SaveCoordinator] Interaction ended');
          this._lastInteractionEndTime = Date.now();
        }
        this.isGlobalDragging = false;
      }

      // Skip updates during any interaction (drag, pan, pinch, zoom animation)
      if (this.isGlobalDragging && changeContext.phase !== 'end' && changeContext.phase !== 'complete') {
        this.isDirty = true;
        this.nextStateToProcess = newState; // Keep updating the latest state
        this.lastChangeContext = changeContext;
        
        const now = Date.now();
        if (!this._lastDragLogTime || (now - this._lastDragLogTime) > 1000) {
          const interactionType = changeContext.isDragging ? 'drag' : 
                                 changeContext.isPanning ? 'pan' :
                                 changeContext.isPinching ? 'pinch' : 'interaction';
          console.log(`[SaveCoordinator] ${interactionType.charAt(0).toUpperCase() + interactionType.slice(1)} in progress - deferring processing`);
          this._lastDragLogTime = now;
        }
        return;
      }

      // Update latest state
      this.nextStateToProcess = newState;
      this.lastChangeContext = changeContext;

      // If interaction just ended, force immediate processing logic  
      if ((changeContext.phase === 'end' || changeContext.phase === 'complete') && !isInteracting) {
        console.log('[SaveCoordinator] Interaction ended, triggering processing');
        // Clear worker timer to force fresh processing after interaction
        if (this.workerTimer) {
          clearTimeout(this.workerTimer);
          this.workerTimer = null;
        }
      }

      // Debounce sending to worker to avoid flooding it
      // But ONLY if we're not in an interaction - worker serialization is expensive
      if (this.workerProcessing) {
        this.workerDirty = true;
      } else {
        // Clear existing debounce timer
        if (this.workerTimer) clearTimeout(this.workerTimer);
        
        this.workerTimer = setTimeout(() => {
          this.sendToWorker();
        }, 300); // 300ms debounce for worker calls
      }

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

    console.log(`[SaveCoordinator] Scheduling write in ${DEBOUNCE_MS}ms`);

    // Schedule new save
    this.saveTimer = setTimeout(() => {
      this.executeSave();
    }, DEBOUNCE_MS);
  }

  // Execute save (both local and git) - NON-BLOCKING
  executeSave() {
    if (this.isSaving) return;
    
    // CRITICAL: Don't execute save during ANY user interaction (drag, pan, pinch, zoom animation)
    // This prevents choppy performance and ensures we only save when the user is done interacting
    if (this.isGlobalDragging) {
      console.log('[SaveCoordinator] executeSave blocked - user interaction still in progress, rescheduling');
      this.scheduleSave(); // Reschedule for after interaction ends
      return;
    }
    
    // CRITICAL: Add cooldown after interaction ends to let UI settle
    // This prevents choppy lift/release by deferring heavy file I/O
    const timeSinceInteractionEnd = Date.now() - this._lastInteractionEndTime;
    const COOLDOWN_MS = 300; // Wait 300ms after interaction ends before saving
    if (this._lastInteractionEndTime > 0 && timeSinceInteractionEnd < COOLDOWN_MS) {
      const remainingCooldown = COOLDOWN_MS - timeSinceInteractionEnd;
      console.log(`[SaveCoordinator] executeSave deferred ${remainingCooldown}ms for post-interaction cooldown`);
      setTimeout(() => this.executeSave(), remainingCooldown);
      return;
    }
    
    // We need either a pending string (from worker) or a lastState (fallback)
    if (!this.pendingString && !this.lastState) return;

    // Capture values before async operations
    const state = this.lastState;
    const pendingString = this.pendingString;
    const pendingRedstringData = this.pendingRedstringData;
    const pendingHash = this.pendingHash;

    // Mark as saving immediately
    this.isSaving = true;
    console.log('[SaveCoordinator] Executing save (non-blocking)');

    // Run save operations in a non-blocking manner using requestIdleCallback or setTimeout
    // This ensures the save doesn't block the main thread
    const runSave = () => {
      // Use a microtask to defer to next event loop tick, allowing UI to remain responsive
      Promise.resolve().then(async () => {
        try {
          // Save to local file if available - fire and forget with error handling
          if (this.fileStorage && typeof this.fileStorage.saveToFile === 'function') {
            this.fileStorage.saveToFile(state, false, {
              preSerialized: !!pendingString,
              serializedData: pendingString,
              redstringData: pendingRedstringData
            }).catch(error => {
              console.error('[SaveCoordinator] Local file save failed:', error);
            });
          }

          // Save to Git if available - already non-blocking (just queues)
          if (this.gitSyncEngine && this.gitSyncEngine.isHealthy()) {
            this.gitSyncEngine.updateState(state);
          }

          // Update save hash after initiating save
          if (pendingHash) {
            this.lastSaveHash = pendingHash;
            this.pendingHash = null;
          }
          
          // Clear dirty flag and pending data
          this.isDirty = false;
          this.pendingString = null;
          this.pendingRedstringData = null;
          this.notifyStatus('success', 'Save completed');
          
        } catch (error) {
          console.error('[SaveCoordinator] Save failed:', error);
          this.notifyStatus('error', `Save failed: ${error.message}`);
        } finally {
          this.isSaving = false;
        }
      });
    };

    // Use requestIdleCallback if available for even better scheduling, otherwise setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(runSave, { timeout: 100 });
    } else {
      setTimeout(runSave, 0);
    }
  }

  // Force immediate save (for manual save button) - still awaitable for user feedback
  async forceSave(state) {
    if (!this.isEnabled) {
      throw new Error('Save coordinator not initialized');
    }

    try {
      console.log('[SaveCoordinator] Force save requested');
      this.notifyStatus('info', 'Force saving...');
      
      if (this.saveTimer) clearTimeout(this.saveTimer);
      if (this.workerTimer) clearTimeout(this.workerTimer);
      
      this.lastState = state;
      this.isSaving = true;
      
      // For force save, we do await to give user feedback that it completed
      // But we still use non-blocking patterns where possible
      if (this.fileStorage && typeof this.fileStorage.saveToFile === 'function') {
        try {
          await this.fileStorage.saveToFile(state, false, { 
            preSerialized: false // Force re-serialize for explicit save
          });
        } catch (error) {
          console.error('[SaveCoordinator] Force save local file failed:', error);
        }
      }

      // Queue Git save (non-blocking)
      if (this.gitSyncEngine && this.gitSyncEngine.isHealthy()) {
        this.gitSyncEngine.updateState(state);
      }
      
      this.isDirty = false;
      this.pendingString = null;
      this.pendingRedstringData = null;
      this.pendingHash = null;
      this.isSaving = false;
      
      this.notifyStatus('success', 'Force save completed');
      return true;

    } catch (error) {
      console.error('[SaveCoordinator] Force save failed:', error);
      this.isSaving = false;
      this.notifyStatus('error', `Force save failed: ${error.message}`);
      throw error;
    }
  }

  // Generate hash - now mostly for fallback or worker internal use
  // Kept here for compatibility if needed, but primary logic moved to worker
  generateStateHash(state) {
      // ... (implementation matches worker) ...
      // Legacy implementation kept for robustness if worker fails
    try {
      const contentState = {
        graphs: state.graphs ? Array.from(state.graphs.entries()).map(([id, graph]) => {
          const { panOffset, zoomLevel, instances, ...rest } = graph || {};
          const instancesArray = instances ? Array.from(instances.entries()) : [];
          return [id, { ...rest, instances: instancesArray }];
        }) : [],
        nodePrototypes: state.nodePrototypes ? Array.from(state.nodePrototypes.entries()) : [],
        edges: state.edges ? Array.from(state.edges.entries()) : []
      };

      const stateString = JSON.stringify(contentState);
      let hash = 2166136261;
      for (let i = 0; i < stateString.length; i++) {
        hash ^= stateString.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return (hash >>> 0).toString();
    } catch (error) {
      console.warn('[SaveCoordinator] Hash generation failed:', error);
      return Date.now().toString();
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

  // Get pre-serialized string for Git autosave policy (avoids redundant JSON.stringify)
  getPendingString() {
    return this.pendingString;
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
    return this.isDirty || (this.pendingHash !== null);
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
