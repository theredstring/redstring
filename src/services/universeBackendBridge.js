/**
 * Universe Backend Bridge Utility
 *
 * Provides a safe, reusable bridge for UI components to communicate with
 * the universe backend via window events. Centralizes command dispatching
 * to avoid temporal dead zone pitfalls and duplicate implementations.
 */

const COMMAND_EVENT = 'universe-backend-command';
const STATUS_EVENT = 'universe-backend-status';
const RESPONSE_EVENT_PREFIX = 'universe-backend-response-';

class UniverseBackendBridge {
  constructor(timeoutMs = 6000) {
    this.timeoutMs = timeoutMs;
    this.commandQueue = [];
    this.isBackendReady = false;
    this.backendReadyPromise = null;
    this.hasWarnedInitDelay = false;
    
    // Listen for backend ready signal
    this.setupBackendReadyListener();
  }
  
  setupBackendReadyListener() {
    if (typeof window === 'undefined') return;
    
    // Check if backend is ALREADY ready (for components that load late)
    if (window._universeBackendReady === true) {
      console.log('[UniverseBackendBridge] Backend was already ready (late initialization)');
      this.isBackendReady = true;
      // Process any commands that were queued during constructor
      if (this.commandQueue.length > 0) {
        this.processQueuedCommands();
      }
      return;
    }
    
    // Listen for backend initialization completion
    window.addEventListener('universe-backend-ready', (event) => {
      console.log('[UniverseBackendBridge] Backend ready signal received');
      if (event.detail?.error) {
        console.error('[UniverseBackendBridge] Backend ready event reported error:', event.detail.error);
        this.flushQueuedCommandsWithError(new Error(event.detail.error));
        this.backendReadyPromise = null; // Reset promise so new commands can try again
        return;
      }
      this.isBackendReady = true;
      this.backendReadyPromise = null; // Reset promise now that backend is ready
      this.processQueuedCommands();
    });
  }
  
  async waitForBackendReady() {
    if (this.isBackendReady || (typeof window !== 'undefined' && window._universeBackendReady === true)) {
      // If a late global flag is present, pick it up and mark ready
      this.isBackendReady = true;
      return;
    }

    if (!this.backendReadyPromise) {
      this.backendReadyPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
          this.backendReadyPromise = null;
          reject(new Error('Universe backend bridge requires a browser environment'));
          return;
        }

        let warningTimeoutId = null;
        const warningDelay = typeof this.timeoutMs === 'number' ? this.timeoutMs : 6000;

        const clearWarningTimer = () => {
          if (warningTimeoutId !== null) {
            window.clearTimeout(warningTimeoutId);
            warningTimeoutId = null;
          }
        };

        const scheduleWarning = () => {
          if (this.hasWarnedInitDelay) return;
          warningTimeoutId = window.setTimeout(() => {
            this.hasWarnedInitDelay = true;
            console.warn(`[UniverseBackendBridge] Backend still initializing after ${warningDelay}ms, continuing to wait...`);
            try {
              window.dispatchEvent(new CustomEvent('universe-backend-status', {
                detail: {
                  type: 'info',
                  message: 'Backend is still starting up. Large universes may take a little longer to load.'
                }
              }));
            } catch (_) {}
          }, warningDelay);
        };

        const handler = (event) => {
          clearWarningTimer();
          window.removeEventListener('universe-backend-ready', handler);
          this.backendReadyPromise = null;

          if (event.detail?.error) {
            reject(new Error(event.detail.error));
            return;
          }

          this.isBackendReady = true;
          resolve();
        };

        window.addEventListener('universe-backend-ready', handler);
        scheduleWarning();

        if (this.isBackendReady || window._universeBackendReady === true) {
          clearWarningTimer();
          window.removeEventListener('universe-backend-ready', handler);
          this.backendReadyPromise = null;
          this.isBackendReady = true;
          resolve();
        }
      });
    }

    return this.backendReadyPromise;
  }

  flushQueuedCommandsWithError(error) {
    console.warn('[UniverseBackendBridge] Flushing queued commands with error:', error.message);
    while (this.commandQueue.length > 0) {
      const queuedCommand = this.commandQueue.shift();
      queuedCommand.reject(error);
    }
  }
  
  async processQueuedCommands() {
    console.log(`[UniverseBackendBridge] Processing ${this.commandQueue.length} queued commands`);
    
    while (this.commandQueue.length > 0) {
      const queuedCommand = this.commandQueue.shift();
      try {
        await this.executeCommand(queuedCommand);
      } catch (error) {
        console.error('[UniverseBackendBridge] Queued command failed:', error);
        queuedCommand.reject(error);
      }
    }
  }
  
  async executeCommand({ command, payload, id, resolve, reject }) {
    try {
      const responseEvent = `${RESPONSE_EVENT_PREFIX}${id}`;
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const handleResponse = (event) => {
        cleanup();
        const detail = event?.detail;
        if (detail?.error) {
          reject(new Error(detail.error));
          return;
        }
        resolve(detail?.result);
      };

      window.addEventListener(responseEvent, handleResponse, { once: true });

      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Backend command "${command}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      window.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
        detail: { command, payload, id }
      }));
    } catch (error) {
      reject(error);
    }
  }

  async sendCommand(command, payload = {}) {
    if (typeof window === 'undefined') {
      throw new Error('Universe backend bridge is only available in the browser environment.');
    }

    return new Promise(async (resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      
      const commandData = { command, payload, id, resolve, reject };
      
      // If backend is not ready, queue the command
      if (!this.isBackendReady && !(typeof window !== 'undefined' && window._universeBackendReady === true)) {
        console.log(`[UniverseBackendBridge] Backend not ready, queueing command: ${command}`);
        this.commandQueue.push(commandData);
        
        // Wait for backend to be ready
        try {
          await this.waitForBackendReady();
        } catch (error) {
          // Check if backend actually became ready during the wait
          // (race condition: persistent listener might have set the flag)
          if (this.isBackendReady) {
            console.log(`[UniverseBackendBridge] Backend became ready during wait for ${command}, command should have been processed`);
            // The command was likely already processed by processQueuedCommands()
            // Don't reject - just return and let that resolution stand
            return;
          }
          
          // Backend is still not ready, remove from queue and reject
          const index = this.commandQueue.indexOf(commandData);
          if (index > -1) {
            this.commandQueue.splice(index, 1);
          }
          reject(error);
          return;
        }
      }
      
      // Execute command immediately if backend is ready
      await this.executeCommand(commandData);
    });
  }

  onStatusChange(callback) {
    if (typeof window === 'undefined') {
      return () => {};
    }

    const handler = (event) => {
      try {
        callback(event.detail);
      } catch (error) {
        console.warn('[UniverseBackendBridge] status handler error:', error);
      }
    };

    window.addEventListener(STATUS_EVENT, handler);
    return () => window.removeEventListener(STATUS_EVENT, handler);
  }

  // Convenience helpers --------------------------------------------------

  getAllUniverses() {
    return this.sendCommand('getAllUniverses');
  }

  getActiveUniverse() {
    return this.sendCommand('getActiveUniverse');
  }

  getAuthStatus() {
    return this.sendCommand('getAuthStatus');
  }

  getSyncStatus(universeSlug) {
    return this.sendCommand('getSyncStatus', { universeSlug });
  }

  getUniverseGitStatus(universeSlug) {
    return this.sendCommand('getUniverseGitStatus', { universeSlug });
  }

  getGitStatusDashboard() {
    return this.sendCommand('getGitStatusDashboard');
  }

  switchActiveUniverse(slug, options) {
    return this.sendCommand('switchActiveUniverse', { slug, options });
  }

  createUniverse(name, options) {
    return this.sendCommand('createUniverse', { name, options });
  }

  deleteUniverse(slug) {
    return this.sendCommand('deleteUniverse', { slug });
  }

  updateUniverse(slug, updates) {
    return this.sendCommand('updateUniverse', { slug, updates });
  }

  discoverUniversesInRepository(repoConfig) {
    return this.sendCommand('discoverUniversesInRepository', { repoConfig });
  }

  linkToDiscoveredUniverse(discoveredUniverse, repoConfig) {
    return this.sendCommand('linkToDiscoveredUniverse', { discoveredUniverse, repoConfig });
  }

  forceSave(universeSlug, storeState, options) {
    return this.sendCommand('forceSave', { universeSlug, storeState, options });
  }

  saveActiveUniverse(storeState) {
    return this.sendCommand('saveActiveUniverse', { storeState });
  }

  downloadLocalFile(universeSlug, storeState) {
    return this.sendCommand('downloadLocalFile', { universeSlug, storeState });
  }

  downloadGitUniverse(universeSlug) {
    return this.sendCommand('downloadGitUniverse', { universeSlug });
  }

  requestLocalFilePermission(universeSlug) {
    return this.sendCommand('requestLocalFilePermission', { universeSlug });
  }

  removeLocalFileLink(universeSlug) {
    return this.sendCommand('removeLocalFileLink', { universeSlug });
  }

  uploadLocalFile(file, targetUniverseSlug) {
    return this.sendCommand('uploadLocalFile', { file, targetUniverseSlug });
  }

  setupLocalFileHandle(universeSlug, options) {
    return this.sendCommand('setupLocalFileHandle', { universeSlug, options });
  }

  reloadUniverse(universeSlug) {
    return this.sendCommand('reloadUniverse', { universeSlug });
  }
}

const bridgeInstance = new UniverseBackendBridge();

const universeBackendBridge = {
  sendCommand: bridgeInstance.sendCommand.bind(bridgeInstance),
  onStatusChange: (...args) => bridgeInstance.onStatusChange(...args),
  getAllUniverses: () => bridgeInstance.getAllUniverses(),
  getActiveUniverse: () => bridgeInstance.getActiveUniverse(),
  getAuthStatus: () => bridgeInstance.getAuthStatus(),
  getSyncStatus: (universeSlug) => bridgeInstance.getSyncStatus(universeSlug),
  getUniverseGitStatus: (universeSlug) => bridgeInstance.getUniverseGitStatus(universeSlug),
  getGitStatusDashboard: () => bridgeInstance.getGitStatusDashboard(),
  switchActiveUniverse: (slug, options) => bridgeInstance.switchActiveUniverse(slug, options),
  createUniverse: (name, options) => bridgeInstance.createUniverse(name, options),
  deleteUniverse: (slug) => bridgeInstance.deleteUniverse(slug),
  updateUniverse: (slug, updates) => bridgeInstance.updateUniverse(slug, updates),
  discoverUniversesInRepository: (repoConfig) => bridgeInstance.discoverUniversesInRepository(repoConfig),
  linkToDiscoveredUniverse: (discoveredUniverse, repoConfig) => bridgeInstance.linkToDiscoveredUniverse(discoveredUniverse, repoConfig),
  forceSave: (universeSlug, storeState, options) => bridgeInstance.forceSave(universeSlug, storeState, options),
  saveActiveUniverse: (storeState) => bridgeInstance.saveActiveUniverse(storeState),
  downloadLocalFile: (universeSlug, storeState) => bridgeInstance.downloadLocalFile(universeSlug, storeState),
  downloadGitUniverse: (universeSlug) => bridgeInstance.downloadGitUniverse(universeSlug),
  requestLocalFilePermission: (universeSlug) => bridgeInstance.requestLocalFilePermission(universeSlug),
  removeLocalFileLink: (universeSlug) => bridgeInstance.removeLocalFileLink(universeSlug),
  uploadLocalFile: (file, targetUniverseSlug) => bridgeInstance.uploadLocalFile(file, targetUniverseSlug),
  reloadUniverse: (universeSlug) => bridgeInstance.reloadUniverse(universeSlug)
};

export default universeBackendBridge;
export { UniverseBackendBridge, bridgeInstance as universeBackendBridgeInstance };
