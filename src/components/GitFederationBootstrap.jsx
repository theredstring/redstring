import React, { useEffect, useRef } from 'react';

/**
 * Universe Backend Bootstrap - COMPLETELY DECOUPLED
 *
 * This component only acts as an event bridge. It uses dynamic imports
 * with delayed loading to completely avoid circular dependencies.
 * The backend is loaded ONLY when needed, never during module parse time.
 */
export default function GitFederationBootstrap({ enableEagerInit = false }) {
  const initRef = useRef(false);
  const backendRef = useRef(null);
  const commandListenerRef = useRef(null);
  const backendInitPromiseRef = useRef(null);
  const backendStatusUnsubscribeRef = useRef(null);

  useEffect(() => {
    if (initRef.current) return;

    initRef.current = true;

    console.log('[GitFederationBootstrap] Setting up event bridge...');

    const ensureBackendReady = async () => {
      if (backendRef.current) {
        return backendRef.current;
      }

      if (!backendInitPromiseRef.current) {
        backendInitPromiseRef.current = (async () => {
          console.log('[GitFederationBootstrap] First command received, loading backend...');

          try {
            await new Promise(resolve => setTimeout(resolve, 0));
            console.log('[GitFederationBootstrap] Importing universeBackend...');

            const module = await import('../services/universeBackend.js');
            const backend = module.default || module.universeBackend;

            console.log('[GitFederationBootstrap] Backend imported, wiring bridge and starting initialization...');

            // Wire status relay immediately
            if (!backendStatusUnsubscribeRef.current) {
              backendStatusUnsubscribeRef.current = backend.onStatusChange((status) => {
                window.dispatchEvent(new CustomEvent('universe-backend-status', {
                  detail: status
                }));
              });
            }

            // Expose backend and signal readiness for queued commands IMMEDIATELY
            backendRef.current = backend;
            window._universeBackendReady = true;
            window.dispatchEvent(new CustomEvent('universe-backend-ready'));
            // Safety: Re-dispatch after a tick to catch listeners mounting in same cycle
            setTimeout(() => window.dispatchEvent(new CustomEvent('universe-backend-ready')), 100);
            console.log('[GitFederationBootstrap] Backend ready for commands (initialization continuing in background)');

            // Start initialization in background with a warning if it takes too long
            const initializationTimeoutMs = 6000;
            const timerApi = typeof window !== 'undefined' ? window : globalThis;
            let timeoutId = timerApi.setTimeout(() => {
              console.warn('[GitFederationBootstrap] Backend initialization still running after 6000ms, continuing to wait...');
              try {
                window.dispatchEvent(new CustomEvent('universe-backend-status', {
                  detail: {
                    type: 'info',
                    message: 'Backend is still starting up. Git-enabled universes can take a little longer to load.'
                  }
                }));
              } catch (_) { }
            }, initializationTimeoutMs);

            backend.initialize()
              .then(() => {
                console.log('[GitFederationBootstrap] Backend initialization completed');
              })
              .catch((initError) => {
                console.error('[GitFederationBootstrap] Backend initialization failed:', initError);
                try {
                  window.dispatchEvent(new CustomEvent('universe-backend-status', {
                    detail: { type: 'error', message: initError.message }
                  }));
                } catch (_) { }
              })
              .finally(() => {
                try { timerApi.clearTimeout(timeoutId); } catch (_) { }
              });

            // Return backend immediately so commands can proceed
            return backend;
          } catch (error) {
            console.error('[GitFederationBootstrap] Backend initialization failed:', error);
            window.dispatchEvent(new CustomEvent('universe-backend-ready', {
              detail: { error: error.message }
            }));
            throw error;
          } finally {
            backendInitPromiseRef.current = null;
          }
        })().catch((error) => {
          if (error instanceof ReferenceError && /Cannot access '\w+' before initialization/.test(error.message)) {
            console.warn('[GitFederationBootstrap] Detected early initialization ReferenceError. This usually indicates a module circular dependency or concurrent import. Retrying...', error);
          }
          backendRef.current = null;
          throw error;
        });
      }

      return backendInitPromiseRef.current;
    };

    // Command handler that dynamically loads backend only when first command arrives
    const handleBackendCommand = async (event) => {
      const { command, payload, id } = event.detail;
      console.log(`[Bootstrap:TRACE] Received command: ${command} (${id})`);

      try {
        const backend = await ensureBackendReady();
        console.log(`[Bootstrap:TRACE] Backend ready, executing: ${command} (${id})`);

        let result;

        switch (command) {
          case 'getAllUniverses':
            result = backend.getAllUniverses();
            break;
          case 'getActiveUniverse':
            result = backend.getActiveUniverse();
            break;
          case 'getAuthStatus':
            result = backend.getAuthStatus();
            break;
          case 'getSyncStatus':
            result = backend.getSyncStatus(payload.universeSlug);
            break;
          case 'getUniverseGitStatus':
            result = backend.getUniverseGitStatus(payload.universeSlug);
            break;
          case 'getGitStatusDashboard':
            result = backend.getGitStatusDashboard();
            break;
          case 'switchActiveUniverse':
            result = await backend.switchActiveUniverse(payload.slug, payload.options);
            break;
          case 'createUniverse':
            result = backend.createUniverse(payload.name, payload.options);
            break;
          case 'deleteUniverse':
            result = await backend.deleteUniverse(payload.slug);
            break;
          case 'updateUniverse':
            result = await backend.updateUniverse(payload.slug, payload.updates);
            break;
          case 'discoverUniversesInRepository':
            result = await backend.discoverUniversesInRepository(payload.repoConfig);
            break;
          case 'linkToDiscoveredUniverse':
            result = await backend.linkToDiscoveredUniverse(payload.discoveredUniverse, payload.repoConfig);
            break;
          case 'forceSave':
            result = await backend.forceSave(payload.universeSlug, payload.storeState, payload.options);
            break;
          case 'saveActiveUniverse':
            result = await backend.saveActiveUniverse(payload.storeState);
            break;
          case 'reloadUniverse':
            result = await backend.reloadUniverse(payload.universeSlug);
            break;
          case 'uploadLocalFile':
            result = await backend.uploadLocalFile(payload.file, payload.targetUniverseSlug);
            break;
          case 'setupLocalFileHandle':
            result = await backend.setupLocalFileHandle(payload.universeSlug, payload.options);
            break;
          case 'downloadLocalFile':
            result = await backend.downloadLocalFile(payload.universeSlug, payload.storeState);
            break;
          case 'downloadGitUniverse':
            result = await backend.downloadGitUniverse(payload.universeSlug);
            break;
          case 'requestLocalFilePermission':
            result = await backend.requestLocalFilePermission(payload.universeSlug);
            break;
          case 'removeLocalFileLink':
            result = await backend.removeLocalFileLink(payload.universeSlug);
            break;
          default:
            throw new Error(`Unknown command: ${command}`);
        }

        console.log(`[Bootstrap:TRACE] Dispatching response for ${command} (${id})`);
        window.dispatchEvent(new CustomEvent(`universe-backend-response-${id}`, {
          detail: { result }
        }));
      } catch (error) {
        console.error(`[GitFederationBootstrap] Command ${command} failed:`, error);
        window.dispatchEvent(new CustomEvent(`universe-backend-response-${id}`, {
          detail: { error: error.message }
        }));
      }
    };

    // Set up command listener immediately, but don't load backend yet
    commandListenerRef.current = handleBackendCommand;
    window.addEventListener('universe-backend-command', handleBackendCommand);

    console.log('[GitFederationBootstrap] Event bridge ready (backend will load on first command)');

    // If eager init is enabled, start loading the backend immediately
    if (enableEagerInit) {
      console.log('[GitFederationBootstrap] Eager initialization enabled, starting backend load...');
      ensureBackendReady().catch(error => {
        console.error('[GitFederationBootstrap] Eager initialization failed:', error);
      });
    }

    // Cleanup
    return () => {
      // CRITICAL: Reset initRef so effect runs again on remount (fixes React StrictMode)
      initRef.current = false;
      if (commandListenerRef.current) {
        window.removeEventListener('universe-backend-command', commandListenerRef.current);
      }
      backendRef.current = null;
      commandListenerRef.current = null;
      backendInitPromiseRef.current = null;
      if (backendStatusUnsubscribeRef.current) {
        try {
          backendStatusUnsubscribeRef.current();
        } catch (error) {
          console.warn('[GitFederationBootstrap] Failed to remove backend status listener:', error);
        }
      }
      backendStatusUnsubscribeRef.current = null;
    };
  }, []);

  return null;
}
