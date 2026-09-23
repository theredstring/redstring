import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RefreshCw, Globe, ChevronDown, Check, X } from 'lucide-react';
import CanvasModal from '../CanvasModal';
import { MODAL_CLOSE_ICON_SIZE } from '../../constants.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import GitHubConnectPanel from '../shared/GitHubConnectPanel.jsx';
import { useGitHubConnection, isGitHubDeviceFlowShowing } from '../../hooks/useGitHubConnection.js';
import { appDetectionRequiresOAuth } from '../../services/githubAuthFlows.js';
import { RECONNECT_RESUME_KEY } from '../../services/githubAuthCallbacks.js';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * Reconnect a GitHub-backed universe.
 *
 * Two modes, one job — get the universe and GitHub talking again:
 *   'load' — the universe couldn't load. The canvas used to show the raw
 *            error in a red card whose only action, Reload, re-ran the same
 *            failing load.
 *   'sync' — it loaded, but the GitHub App isn't linked: either nobody is
 *            signed in (the save pill used to sit on "Syncing..."
 *            indefinitely) or it's riding the OAuth fallback. NodeCanvas opens
 *            it whenever a Git universe is without the App.
 *
 * Framed like Settings and onboarding (full-screen CanvasModal): it's about
 * the app's link to GitHub, so it centers on the window, ignores the panels,
 * and stacks above them.
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
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 900));

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Natural height of the content, so the modal is sized to it. A
  // ResizeObserver because it changes in place: the device-flow panel
  // swapping in, a notice appearing, details expanding.
  const contentRef = useRef(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!isVisible || !el) {
      setMeasuredHeight(0);
      return undefined;
    }
    const measure = () => {
      const next = Math.ceil(el.getBoundingClientRect().height);
      setMeasuredHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isVisible]);

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

  // Same frame as Settings and onboarding: a full-screen CanvasModal, which
  // centers on the window, ignores the panels, and stacks above them
  // (20200+, over panels at 10000 and the TypeList at ~20000). Sized to its
  // content by measurement, as StorageSetupModal does — CanvasModal centers
  // an 'auto' height as though it were 720px, which parks short content high.
  const modalMargin = isCompact ? 12 : 20;
  const padX = isCompact ? 20 : 32;
  const padTop = isCompact ? 44 : 52;
  const padBottom = isCompact ? 22 : 28;
  const maxModalHeight = Math.max(280, viewportHeight - modalMargin * 2 - 8);
  const modalHeight = measuredHeight > 0
    ? Math.min(Math.max(measuredHeight + padTop + padBottom, 240), maxModalHeight)
    : Math.min(480, maxModalHeight);
  const modalWidth = isCompact ? Math.min(Math.max(viewportWidth - 24, 300), 540) : 560;

  return (
    <CanvasModal
      isVisible={isVisible}
      onClose={onClose}
      title=""
      width={modalWidth}
      height={modalHeight}
      position="center"
      margin={modalMargin}
      fullScreenOverlay={true}
      contentStyle={{ overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <PanelIconButton
          icon={X}
          onClick={onClose}
          title="Close"
          size={MODAL_CLOSE_ICON_SIZE}
          style={{ position: 'absolute', top: isCompact ? 12 : 16, right: isCompact ? 12 : 16, zIndex: 10 }}
        />
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          padding: `${padTop}px ${padX}px ${padBottom}px`,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column'
        }}>
      <div ref={contentRef} style={{ margin: 'auto 0', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <h2 style={text(isCompact ? '1.2rem' : '1.45rem', { margin: '0 0 8px 0', color: theme.accent.primary, fontWeight: 600 })}>
            {deviceFlowShowing ? (github.deviceFlowState.title || 'Connect GitHub') : `Reconnect ${universeName}`}
          </h2>
          {!deviceFlowShowing && (repoLabel || (mode === 'load' && !loaded)) && (
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
        </div>
      </div>
    </CanvasModal>
  );
};

export default GitReconnectModal;
