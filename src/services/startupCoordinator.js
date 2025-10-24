/**
 * Startup Coordinator - Prevents multiple initialization conflicts
 * 
 * This singleton coordinates app initialization to prevent:
 * - Multiple GitSyncEngine creation
 * - Race conditions between bootstrap components  
 * - API spam during startup
 */

class StartupCoordinator {
  constructor() {
    this.isInitializing = false;
    this.initializationPromise = null;
    this.initializedEngines = new Set();
    this.startupTimeout = 30000; // 30 second startup window
    this.startupStartTime = Date.now();
  }

  // Check if we're still in the startup window
  isStartupWindow() {
    return (Date.now() - this.startupStartTime) < this.startupTimeout;
  }

  // Request to initialize a GitSyncEngine for a universe
  async requestEngineInitialization(universeSlug, initializerName) {
    // During startup window, only allow ONE initializer per universe
    if (this.isStartupWindow()) {
      const engineKey = `${universeSlug}`;
      
      if (this.initializedEngines.has(engineKey)) {
        console.log(`[StartupCoordinator] Engine for ${universeSlug} already initialized by another component, blocking ${initializerName}`);
        return false; // Block this initialization
      }
      
      console.log(`[StartupCoordinator] Allowing ${initializerName} to initialize engine for ${universeSlug}`);
      this.initializedEngines.add(engineKey);
      return true; // Allow this initialization
    }
    
    // After startup window, allow normal competition
    return true;
  }

  // Check if startup is complete
  isStartupComplete() {
    return !this.isStartupWindow();
  }

  // Reset coordinator (for testing)
  reset() {
    this.isInitializing = false;
    this.initializationPromise = null;
    this.initializedEngines.clear();
    this.startupStartTime = Date.now();
  }
}

// Export singleton instance
export const startupCoordinator = new StartupCoordinator();
export default startupCoordinator;