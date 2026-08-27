import React, { useEffect } from 'react';
import NodeCanvas from './NodeCanvas';
import SpawningNodeDragLayer from './SpawningNodeDragLayer';
import BridgeClient from './ai/BridgeClient.jsx';
import GlobalContextMenu from './components/GlobalContextMenu.jsx';
import UniverseManagerBootstrap from './components/UniverseManagerBootstrap.jsx';
import UpdateToast from './components/UpdateToast.jsx';
import useGraphStore from './store/graphStore.js';
import { isElectron } from './utils/fileAccessAdapter.js';
import { isCapacitor, registerCapacitorLifecycle, logPlatformDiagnostics } from './utils/capacitorAdapter.js';
import { warmHaptics } from './services/haptics.js';
import { saveCoordinator } from './services/SaveCoordinator.js';
import { DARK_THEME, LIGHT_THEME } from './utils/themeColors.js';
import './App.css';

// TEMP: manual test hook for empty node-group placeholder feature — remove before commit.
if (typeof window !== 'undefined') window.useGraphStore = useGraphStore;

function App() {
  const darkMode = useGraphStore(s => s.darkMode);

  // Prints one "[Platform] isCapacitor=..." line, visible in the Xcode console
  // because Capacitor forwards JS console output to the native log.
  useEffect(() => { logPlatformDiagnostics(); }, []);

  // Load the haptics plugin chunk at idle so the first node lift isn't the
  // thing that pays for it.
  useEffect(() => { warmHaptics(); }, []);

  useEffect(() => {
    const theme = darkMode ? DARK_THEME : LIGHT_THEME;
    const root = document.documentElement;

    // The page background is the app's background — everywhere that isn't the
    // canvas. With viewport-fit=cover it is also what fills the safe-area bands
    // held by <body>'s padding (the Dynamic Island strip and the home-indicator
    // strip), so those follow the header instead of showing a flat native slab.
    //
    // `--rs-header-bg` is published by Header.jsx and tracks the ACTIVE GRAPH's
    // colour, not just dark mode, so the bands re-colour as you navigate. The
    // canvas colour is only the fallback for the first paint, before a header
    // has mounted. The canvas paints its own background over this.
    //
    // In the fullscreen landscape shell there are no bands at all — that mode
    // releases every inset (App.css) — so this only backs rubber-band overscroll
    // there.
    const bandColor = `var(--rs-header-bg, ${theme.canvas.bg})`;
    document.body.style.backgroundColor = bandColor;
    // html too: iOS rubber-band overscroll reveals the root background, not the
    // body's, and a mismatch there flashes the wrong colour at the edges.
    root.style.backgroundColor = bandColor;
    // (The body class that releases the insets in the fullscreen landscape
    // shell is owned by useMobileLandscapeShell.js — it has to be applied
    // before anything re-measures #root, which a React effect here cannot
    // guarantee.)

    // Add/remove dark-mode class on html element for CSS
    root.classList.toggle('dark-mode', darkMode);

    // Set CSS variables for use in stylesheets
    root.style.setProperty('--canvas-bg', theme.canvas.bg);
    root.style.setProperty('--canvas-text', theme.canvas.textPrimary);
    root.style.setProperty('--canvas-text-muted', theme.canvas.textSecondary);
    root.style.setProperty('--canvas-border', theme.canvas.border);
    root.style.setProperty('--canvas-hover', theme.canvas.hover);
    root.style.setProperty('--canvas-active', theme.canvas.active);
    root.style.setProperty('--canvas-inactive', theme.canvas.inactive);

    // Message bubble colors - different for light vs dark mode
    if (darkMode) {
      root.style.setProperty('--bubble-wizard-bg', '#260000');
      root.style.setProperty('--bubble-wizard-text', '#DEDADA');
      root.style.setProperty('--bubble-wizard-border', 'rgba(38, 0, 0, 0.8)');
      root.style.setProperty('--bubble-user-bg', '#201617');
      root.style.setProperty('--bubble-user-text', '#DEDADA');
      root.style.setProperty('--bubble-user-border', 'rgba(32, 22, 23, 0.8)');
    } else {
      root.style.setProperty('--bubble-wizard-bg', '#CCAAA8');
      root.style.setProperty('--bubble-wizard-text', '#260000');
      root.style.setProperty('--bubble-wizard-border', 'rgba(204, 170, 168, 0.8)');
      root.style.setProperty('--bubble-user-bg', '#979090');
      root.style.setProperty('--bubble-user-text', '#260000');
      root.style.setProperty('--bubble-user-border', 'rgba(151, 144, 144, 0.8)');
    }
  }, [darkMode]);

  // Unsaved-changes protection on exit.
  //
  // Browser: prompt only when there are actually unsaved changes, and flush
  // pending saves when the tab is hidden (visibilitychange is the last
  // reliable moment on mobile — beforeunload often never fires there).
  //
  // Electron: the main process intercepts window close and asks us to flush
  // via the lifecycle IPC channel before it destroys the window.
  //
  // Capacitor/iOS: appStateChange fires before the system suspends the
  // WKWebView, which is the last chance to beat the 3s save debounce.
  useEffect(() => {
    if (isCapacitor()) {
      const cleanupLifecycle = registerCapacitorLifecycle(() => {
        saveCoordinator.flush('ios-background').catch(() => { /* logged inside */ });
      });
      // visibilitychange also fires in WKWebView — keep it as a second signal.
      const handleVisibility = () => {
        if (document.visibilityState === 'hidden') {
          saveCoordinator.flush('tab-hidden').catch(() => { /* logged inside */ });
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);
      return () => {
        cleanupLifecycle();
        document.removeEventListener('visibilitychange', handleVisibility);
      };
    }

    if (isElectron()) {
      const lifecycle = window.electron?.lifecycle;
      if (!lifecycle?.onFlushBeforeQuit) return;
      lifecycle.onFlushBeforeQuit(async () => {
        try {
          await saveCoordinator.flush('electron-quit', { terminal: true });
        } catch (error) {
          console.error('[App] Quit flush failed:', error);
        } finally {
          lifecycle.notifyFlushComplete();
        }
      });
      return;
    }

    const handleBeforeUnload = (event) => {
      if (!saveCoordinator.hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Fire-and-forget: the write itself races the page teardown, but an
        // FSA write started here usually completes; waiting out the 3s
        // debounce guarantees it never starts.
        saveCoordinator.flush('tab-hidden').catch(() => { /* logged inside */ });
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <>
      {/* UniverseManagerBootstrap handles backend initialization */}
      <UniverseManagerBootstrap enableEagerInit={true} />
      <NodeCanvas />
      <SpawningNodeDragLayer />
      <BridgeClient />
      <GlobalContextMenu />
      <UpdateToast />
    </>
  );
}

export default App;
