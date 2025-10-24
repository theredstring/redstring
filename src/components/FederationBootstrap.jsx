/**
 * Federation Bootstrap - Ensures federation services are initialized 
 * regardless of whether the GitNativeFederation tab is selected
 * 
 * This component runs at app startup and:
 * 1. Initializes authentication services
 * 2. Establishes background Git connections
 * 3. Sets up SaveCoordinator
 * 4. Manages universe synchronization
 */

import { useEffect, useState } from 'react';
import { persistentAuth } from '../services/persistentAuth.js';
import { universeBackend } from '../backend/universes/index.js';

const FederationBootstrap = ({ children }) => {
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [bootstrapError, setBootstrapError] = useState(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        console.log('[FederationBootstrap] Starting bootstrap process...');

        // 1. Initialize persistent auth first (auto-connect happens here)
        console.log('[FederationBootstrap] ===== Initializing persistent auth =====');
        await persistentAuth.initialize();

        // 2. Always initialize background services (not conditional on having tokens)
        console.log('[FederationBootstrap] ===== Setting up background services =====');

        try {
          // 3. Initialize UniverseBackend background connections
          console.log('[FederationBootstrap] ===== About to call universeBackend.initializeBackgroundSync() =====');
          await universeBackend.initializeBackgroundSync();
          console.log('[FederationBootstrap] ===== universeBackend.initializeBackgroundSync() completed =====');

          // 4. Initialize SaveCoordinator
          const saveCoordinatorModule = await import('../services/SaveCoordinator.js');
          const saveCoordinator = saveCoordinatorModule.default;

          const fileStorageModule = await import('../store/fileStorage.js');

          // Get active universe's git sync engine if available
          const activeUniverse = universeBackend.getActiveUniverse();
          const gitSyncEngine = activeUniverse ? universeBackend.getGitSyncEngine(activeUniverse.slug) : null;

          if (saveCoordinator && fileStorageModule) {
            saveCoordinator.initialize(fileStorageModule, gitSyncEngine, universeBackend);
            console.log('[FederationBootstrap] SaveCoordinator initialized in background');
          }
            
            // 5. Set up universe change listeners to update SaveCoordinator
            universeBackend.onStatusChange((status) => {
              if (status.type === 'universe_switched' && saveCoordinator) {
                const newUniverse = universeBackend.getActiveUniverse();
                const newGitSyncEngine = newUniverse ? universeBackend.getGitSyncEngine(newUniverse.slug) : null;

                if (newGitSyncEngine !== saveCoordinator.gitSyncEngine) {
                  saveCoordinator.initialize(fileStorageModule, newGitSyncEngine, universeBackend);
                  console.log('[FederationBootstrap] SaveCoordinator updated for universe switch');
                }
              }
            });

          } catch (serviceError) {
            console.warn('[FederationBootstrap] Background service setup failed (non-critical):', serviceError);
            // Don't fail bootstrap for service setup issues
          }
        // Note: We no longer gate Git services on auth here; persistentAuth initializes first
        // and services initialize regardless. This avoids a dead branch and ensures background wiring.

        // 6. Bootstrap complete
        setIsBootstrapped(true);
        console.log('[FederationBootstrap] Bootstrap complete');

      } catch (error) {
        console.error('[FederationBootstrap] Bootstrap failed:', error);
        setBootstrapError(error.message);
        
        // Still allow the app to load even if federation bootstrap fails
        setIsBootstrapped(true);
      }
    };

    bootstrap();
  }, []);

  // Always render children - don't block the app if bootstrap fails
  return children;
};

// Hook to check bootstrap status
export const useBootstrapStatus = () => {
  const [status, setStatus] = useState({
    isBootstrapped: false,
    hasError: false,
    error: null
  });

  useEffect(() => {
    // Listen for bootstrap status updates
    const checkStatus = () => {
      try {
        const authStatus = persistentAuth.getAuthStatus();
        setStatus({
          isBootstrapped: true,
          hasError: false,
          error: null,
          hasValidAuth: authStatus.isAuthenticated,
          authMethod: authStatus.authMethod
        });
      } catch (error) {
        setStatus({
          isBootstrapped: true,
          hasError: true,
          error: error.message
        });
      }
    };

    // Check initially
    checkStatus();

    // Set up periodic checks (every 30 seconds)
    const interval = setInterval(checkStatus, 30000);

    return () => clearInterval(interval);
  }, []);

  return status;
};

export default FederationBootstrap;