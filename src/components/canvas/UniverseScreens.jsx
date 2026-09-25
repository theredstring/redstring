import React, { useEffect, useState } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import UniverseLoadingScreen from '../UniverseLoadingScreen.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import useGraphStore from '../../store/graphStore.js';
import useCanvasUIStore from '../../store/canvasUIStore.js';
import universeManagerService from '../../services/universeManagerService.js';
import { useTheme } from '../../hooks/useTheme.js';
import { useMobileLandscapeShell } from '../../hooks/useMobileLandscapeShell.js';
import { HEADER_HEIGHT } from '../../constants';

const ui = () => useCanvasUIStore.getState();
const graph = () => useGraphStore.getState();

/**
 * What the canvas area shows while there is no universe to draw (P2.06c): the
 * loading screen, or the "not loaded" screen with its escape hatch, the load
 * error and the GitHub reconnect card. Moved from NodeCanvas, which renders
 * this in the same place when the universe is loading or not loaded.
 */
function UniverseLoading() {
  /*
   * Which universe the loading screen is waiting on. Read once when the wait
   * starts rather than subscribed to: the backend's own record is the only
   * place the name exists before the universe has been loaded into the store,
   * and it does not change for the life of a single wait.
   */
  const [loadingUniverseName, setLoadingUniverseName] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await universeManagerService.getState();
        if (cancelled) return;
        const active = state.universes?.find(u => u.slug === state.activeUniverseSlug);
        if (active?.name) setLoadingUniverseName(active.name);
      } catch { /* the generic wording is a fine fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Held until the universe actually arrives, or the user says to stop
  // waiting. See UniverseLoadingScreen for why there is no longer a timer here.
  return <UniverseLoadingScreen universeName={loadingUniverseName} />;
}

function UniverseNotLoaded() {
  const theme = useTheme();
  const universeLoadingError = useGraphStore(s => s.universeLoadingError);
  const typeListMode = useGraphStore(s => s.typeListMode);
  const mobileLandscapeShell = useMobileLandscapeShell();
  const typeListVisible = typeListMode !== 'closed' && !mobileLandscapeShell;
  const reconnectTarget = useCanvasUIStore(s => s.universeReconnectTarget);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      // Gutter so nothing in here — the error card especially — can sit
      // flush against the window edges.
      padding: '0 20px',
      boxSizing: 'border-box',
      backgroundColor: theme.canvas.bg
    }}>
      {/* Main content area - mostly empty, just branding */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#555'
      }}>
        <div style={{
          fontFamily: "'EmOne', sans-serif",
          color: theme.canvas.textPrimary,
          textAlign: 'center'
        }}>
          {/* The branding is deliberately quiet; the escape hatch below it
              is not, so the buttons sit outside this opacity. */}
          <div style={{ fontSize: '32px', opacity: 0.8 }}>
            Redstring
            <div style={{
              marginTop: '12px',
              display: 'flex',
              justifyContent: 'center',
              opacity: 0.6
            }}>
              <div
                className="loading-spinner"
                style={{
                  borderColor: theme.canvas.border,
                  borderTopColor: theme.canvas.textSecondary,
                  width: 20,
                  height: 20,
                  borderWidth: 2
                }}
              />
            </div>
          </div>

          {/* Escape hatch for stuck loading states. Classed so the game
              controller can drive it: this screen is one of the few
              places with no canvas behind it, so without a handle here
              a pad user would be looking at two buttons they cannot
              reach. See utils/gamepadMenuNav.js. */}
          <div className="canvas-loading-actions" style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
            <PanelIconButton
              icon={Globe}
              size={14}
              label="Go to Universes"
              labelFontSize={14}
              variant="outline"
              color={theme.canvas.textSecondary}
              onClick={() => {
                graph().setUniverseLoaded(true, false);
                graph().setLeftPanelExpanded(true);
                ui().openLeftPanelView('federation');
              }}
              style={{ pointerEvents: 'auto' }}
            />
            <PanelIconButton
              icon={RefreshCw}
              size={14}
              label="Reload"
              labelFontSize={14}
              variant="outline"
              color={theme.canvas.textSecondary}
              onClick={() => window.location.reload()}
              style={{ pointerEvents: 'auto' }}
            />
          </div>
        </div>
      </div>

      {/* Error message at the bottom. The card is sized against the
          window rather than given a fixed max-width, and its bottom
          clearance tracks whether the TypeList bar is actually open —
          a flat 100px both overshot when it was closed and left the
          card touching the viewport edges on a narrow window. */}
      {universeLoadingError && (
        <div style={{
          flexShrink: 0,
          alignSelf: 'center',
          width: 'min(500px, 100%)',
          boxSizing: 'border-box',
          // A long failure keeps its card on screen instead of pushing
          // itself off the bottom, where the TypeList would cover it.
          maxHeight: '40vh',
          overflowY: 'auto',
          padding: '20px',
          // Clear the TypeList bar when it's open, and its always-present
          // toggle button (HEADER_HEIGHT + its 10px margin) when it isn't.
          marginBottom: `${(typeListVisible ? HEADER_HEIGHT : 0) + HEADER_HEIGHT + 20}px`,
          textAlign: 'center',
          // Neutral, not alarm-red: nothing has been lost (saves are
          // blocked while a load has failed), and red on a screen with
          // no next step only made that harder to believe.
          color: theme.canvas.textPrimary,
          fontSize: '14px',
          fontFamily: "'EmOne', sans-serif",
          // Load failures name file paths and URLs, which carry no break
          // opportunities of their own and otherwise run past the card.
          overflowWrap: 'anywhere',
          backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
          border: `1px solid ${theme.canvas.border}`,
          borderRadius: '8px'
        }}>
          {reconnectTarget ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div>
                {reconnectTarget.name} couldn&rsquo;t load from GitHub. Nothing has been changed.
              </div>
              <PanelIconButton
                icon={RefreshCw}
                size={14}
                label="Reconnect"
                labelFontSize={13}
                variant="solid"
                onClick={() => {
                  ui().setUniverseReconnectDismissed(false);
                  ui().setUniverseReconnect({ mode: 'load', ...reconnectTarget });
                }}
                style={{ pointerEvents: 'auto' }}
              />
            </div>
          ) : universeLoadingError}
        </div>
      )}
    </div>
  );
}

export default function UniverseScreens() {
  const isUniverseLoading = useGraphStore(s => s.isUniverseLoading);
  return isUniverseLoading ? <UniverseLoading /> : <UniverseNotLoaded />;
}
