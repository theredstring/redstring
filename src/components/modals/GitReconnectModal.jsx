import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Globe, X, ChevronDown, Check } from 'lucide-react';
import CanvasModal from '../CanvasModal';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import GitHubConnectPanel from '../shared/GitHubConnectPanel.jsx';
import { useGitHubConnection, isGitHubDeviceFlowShowing } from '../../hooks/useGitHubConnection.js';
import { appDetectionRequiresOAuth } from '../../services/githubAuthFlows.js';
import { RECONNECT_RESUME_KEY } from '../../services/githubAuthCallbacks.js';
import { useTheme } from '../../hooks/useTheme.js';
import { MODAL_CLOSE_ICON_SIZE } from '../../constants.js';

/**
 * Reconnect a GitHub-backed universe.
 *
 * Two modes, one job — get the universe and GitHub talking again:
 *   'load' — the universe couldn't load. The canvas used to show the raw
 *            error in a red card whose only action, Reload, re-ran the same
 *            failing load.
 *   'sync' — it loaded, but nobody is signed in, so it can't sync. The save
 *            pill used to sit on "Syncing..." indefinitely.
 *
 * It says which cause it is (not signed in here, OAuth revoked, GitHub
 * unreachable), puts the connect controls — the same ones onboarding uses —
 * right there, and retries the load itself the moment a connection appears.
 *
 * It closes itself only once BOTH OAuth and the App are confirmed, after a
 * beat so the user sees them land. OAuth alone is often enough for the load
 * to succeed, and closing then used to cut the user off while the App was
 * still being detected. Loaded with the App still missing, it stays up with a
 * "Done for now" button instead.
 *
 * In 'load' mode it also says what the red card left the user to wonder:
 * nothing has been touched. Saves are blocked while a load has failed
 * (SaveCoordinator + universeBackend both refuse), so that's a promise the
 * code keeps.
 *
 * Web OAuth/App redirects unload the page. `beforeRedirect` leaves the
 * `redstring_reconnect_resume` flag so NodeCanvas finishes the callback on
 * return instead of opening the Universes panel; if the load still fails
 * after that, this modal simply opens again.
 */
const AUTO_CLOSE_DELAY_MS = 600;

const armReconnectResume = () => {
  try { sessionStorage.setItem(RECONNECT_RESUME_KEY, 'true'); } catch { /* ignore */ }
};

const GitReconnectModal = ({
  isVisible,
  onClose,
  onResolved = null, // () => void — everything's connected; host closes us
  mode = 'load', // 'load' | 'sync'
  loaded = false, // the universe is in the store
  universeName = 'this universe',
  repoLabel = null,
  errorMessage = null,
  onRetry, // async () => void; throws with a user-facing message on failure
  onOpenUniverses = null
}) => {
  const theme = useTheme();
  // Can open right after the user disconnects the App — don't re-link it
  // behind their back. Their own Install/Detect click still does.
  const github = useGitHubConnection({
    active: isVisible,
    beforeRedirect: armReconnectResume,
    respectAppDisconnect: true
  });
  const { hasOAuth, hasApp, oauthVerification } = github;
  const deviceFlowShowing = isGitHubDeviceFlowShowing(github);

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setRetryError(null);
      setShowDetails(false);
    }
  }, [isVisible]);

  const hasConnection = hasOAuth || hasApp;
  // OAuth is what finds the App on web, so without it the connection is only
  // half there even if an App install is cached.
  const needsOAuth = !hasOAuth && appDetectionRequiresOAuth();
  const checking = oauthVerification === 'verifying';
  const fullyConnected = hasOAuth && hasApp && !checking;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await onRetry?.();
    } catch (err) {
      setRetryError(err?.message || 'It still couldn’t be loaded.');
    } finally {
      setRetrying(false);
    }
  };

  // Close the loop without another click: when a connection appears while
  // the universe is still unloaded, that's the user having just fixed it.
  const hadConnectionRef = useRef(hasConnection);
  useEffect(() => {
    if (!isVisible) {
      hadConnectionRef.current = hasConnection;
      return;
    }
    const gained = hasConnection && !hadConnectionRef.current;
    hadConnectionRef.current = hasConnection;
    if (gained && !loaded) retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, hasConnection]);

  // Done: loaded and both halves confirmed. Wait a beat so the user sees the
  // App card flip to Installed rather than the modal vanishing mid-thought.
  // The callback rides a ref: hosts pass it inline, and a fresh identity on
  // every render would keep restarting the timer.
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  useEffect(() => {
    if (!isVisible || !loaded || !fullyConnected || deviceFlowShowing) return undefined;
    const timer = setTimeout(() => onResolvedRef.current?.(), AUTO_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isVisible, loaded, fullyConnected, deviceFlowShowing]);

  const repoRef = repoLabel ? `@${repoLabel}` : 'the repository';

  const diagnosis = (() => {
    if (checking) return 'Checking your GitHub connection…';
    if (loaded && fullyConnected) {
      return mode === 'sync' ? `Connected. ${universeName} will sync again.` : `Connected — ${universeName} is loaded.`;
    }
    if (loaded && hasOAuth && !hasApp) {
      return mode === 'sync'
        ? `The GitHub App isn’t linked. ${universeName} still syncs through OAuth, but the App is the more reliable path — link it below.`
        : `${universeName} is loaded. The GitHub App isn’t linked yet — it’s the more reliable path for sync, so link it below.`;
    }
    if (!hasConnection) {
      return mode === 'sync'
        ? `Nobody is signed in to GitHub, so ${universeName} can’t sync to ${repoRef}. Connect below.`
        : 'This device isn’t signed in to GitHub. Connect below and it will load.';
    }
    if (needsOAuth) {
      return 'Your GitHub sign-in (OAuth) has expired or was revoked. Reconnect it and Redstring will pick up from there.';
    }
    if (oauthVerification === 'unknown') {
      return 'Redstring couldn’t reach GitHub. If you’re offline, try again once you’re back.';
    }
    return `You’re signed in, but ${repoRef} couldn’t be read. That’s usually temporary — try again.`;
  })();

  const isCompact = viewportWidth <= 500;
  const width = isCompact ? Math.min(Math.max(viewportWidth - 24, 300), 540) : 560;
  const text = (size, extra = {}) => ({
    fontFamily: "'EmOne', sans-serif",
    color: theme.canvas.textPrimary,
    fontSize: size,
    ...extra
  });

  // One primary action, whichever moves things forward from here.
  const primary = (() => {
    if (!loaded) {
      return {
        icon: RefreshCw,
        label: retrying ? 'Loading…' : `Load ${universeName}`,
        onClick: retry,
        disabled: retrying || !hasConnection
      };
    }
    if (fullyConnected) {
      return { icon: Check, label: 'Done', onClick: () => onResolved?.(), disabled: false };
    }
    if (hasConnection && !needsOAuth) {
      return { icon: Check, label: 'Done for now', onClick: onClose, disabled: false };
    }
    return null;
  })();

  return (
    <CanvasModal
      isVisible={isVisible}
      onClose={onClose}
      title=""
      width={width}
      position="center"
      margin={isCompact ? 12 : 20}
      contentStyle={{ padding: 0 }}
    >
      <div style={{ position: 'relative', padding: isCompact ? '44px 20px 22px' : '52px 32px 28px', boxSizing: 'border-box' }}>
        <PanelIconButton
          icon={X}
          onClick={onClose}
          title="Close"
          size={MODAL_CLOSE_ICON_SIZE}
          style={{ position: 'absolute', top: isCompact ? 12 : 16, right: isCompact ? 12 : 16, zIndex: 10 }}
        />

        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <h2 style={text(isCompact ? '1.2rem' : '1.45rem', { margin: '0 0 8px 0', color: theme.accent.primary, fontWeight: 600 })}>
            {deviceFlowShowing ? (github.deviceFlowState.title || 'Connect GitHub') : `Reconnect ${universeName}`}
          </h2>
          {!deviceFlowShowing && (
            <p style={text(isCompact ? '0.8rem' : '0.88rem', { margin: 0, opacity: 0.8, lineHeight: 1.45 })}>
              {repoLabel ? <>It lives in <strong>@{repoLabel}</strong>. </> : null}
              {mode === 'load' && !loaded
                ? <>Nothing has been changed or saved while it couldn&rsquo;t load.</>
                : null}
            </p>
          )}
        </div>

        {!deviceFlowShowing && (
          <div style={text('0.85rem', {
            padding: '10px 12px',
            marginBottom: 14,
            borderRadius: 8,
            border: `1px solid ${theme.canvas.border}`,
            backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
            lineHeight: 1.45
          })}>
            {diagnosis}
          </div>
        )}

        <GitHubConnectPanel connection={github} compact={isCompact} />

        {!deviceFlowShowing && (
          <>
            {primary && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
                <PanelIconButton
                  icon={primary.icon}
                  label={primary.label}
                  labelPosition="right"
                  size={16}
                  labelFontSize={14}
                  variant="solid"
                  disabled={primary.disabled}
                  onClick={primary.onClick}
                  style={{ padding: '9px 20px' }}
                />
              </div>
            )}

            {retryError && !loaded && (
              <div style={text('0.78rem', { marginTop: 10, textAlign: 'center', lineHeight: 1.45, overflowWrap: 'anywhere' })}>
                Still couldn&rsquo;t load: {retryError}
              </div>
            )}

            <div style={{
              display: 'flex',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 16
            }}>
              {onOpenUniverses && (
                <PanelIconButton
                  icon={Globe}
                  label="Go to Universes"
                  size={13}
                  labelFontSize={12}
                  variant="ghost"
                  onClick={onOpenUniverses}
                />
              )}
              {errorMessage && !loaded && (
                <PanelIconButton
                  icon={ChevronDown}
                  label={showDetails ? 'Hide details' : 'Details'}
                  size={13}
                  labelFontSize={12}
                  variant="ghost"
                  onClick={() => setShowDetails((v) => !v)}
                />
              )}
            </div>

            {showDetails && errorMessage && !loaded && (
              <div style={text('0.72rem', {
                marginTop: 8,
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${theme.canvas.border}`,
                color: theme.canvas.textSecondary,
                fontFamily: 'monospace',
                overflowWrap: 'anywhere',
                maxHeight: 120,
                overflowY: 'auto'
              })}>
                {errorMessage}
              </div>
            )}
          </>
        )}
      </div>
    </CanvasModal>
  );
};

export default GitReconnectModal;
