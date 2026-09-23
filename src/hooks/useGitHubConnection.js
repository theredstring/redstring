import { useCallback, useEffect, useRef, useState } from 'react';
import { persistentAuth } from '../services/persistentAuth.js';
import { runPendingCallbacks, recheckAppOnFocus } from '../services/githubAuthCallbacks.js';
import {
  connectOAuth,
  connectApp,
  detectAppInstall,
  disconnectOAuth,
  disconnectApp,
  appDetectionRequiresOAuth,
  APP_NEEDS_OAUTH_MESSAGE
} from '../services/githubAuthFlows.js';
import { usesDeviceFlowAuth } from '../utils/capacitorAdapter.js';
import { useGitHubDeviceFlow } from './useGitHubDeviceFlow.js';
import { getStorageKey } from '../utils/storageUtils.js';
import { getStatusColors } from '../utils/statusColors.js';
import { useTheme } from './useTheme.js';

const AUTH_EVENTS = [
  'tokenStored', 'tokenValidated', 'authExpired',
  'appInstallationStored', 'appInstallationCleared', 'oauthVerification'
];

/** True while a native shell's device flow is on screen in place of the cards. */
export const isGitHubDeviceFlowShowing = (connection) =>
  usesDeviceFlowAuth() && !!connection?.deviceFlowState;

/**
 * GitHub OAuth + App connection state and actions, shared by every surface
 * that asks the user to connect GitHub outside the Universes panel: the
 * onboarding wizard's connect step and the reconnect modal shown when a
 * universe can't load. Render it with GitHubConnectPanel.
 *
 * While `active`, it keeps auth status live, finishes any pending OAuth/App
 * redirect, re-detects the App on tab focus, discovers an existing App
 * install as soon as OAuth is connected, and asks GitHub whether the stored
 * OAuth token actually works — so "Connected" is never just "a token is
 * saved".
 *
 * `beforeRedirect` runs before a web flow unloads the page, so the caller
 * can leave itself a note to resume from.
 *
 * `respectAppDisconnect`: automatic App discovery normally clears the
 * "user disconnected the App" flag (right for onboarding, where the user is
 * here to connect). A surface that can open right after that disconnect must
 * not quietly undo it, so it discovers without clearing; the Install/Detect
 * buttons still override, since those are the user asking.
 */
export function useGitHubConnection({ active = true, beforeRedirect = null, respectAppDisconnect = false } = {}) {
  const theme = useTheme();
  const statusColors = getStatusColors(theme.darkMode);

  const [authStatus, setAuthStatus] = useState(() => {
    try { return persistentAuth.getAuthStatus(); } catch { return {}; }
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [authNotice, setAuthNotice] = useState(null); // { type: 'error'|'info'|'warning', message }
  const [allowOAuthBackup, setAllowOAuthBackup] = useState(() => {
    try {
      return localStorage.getItem(getStorageKey('allow_oauth_backup')) !== 'false';
    } catch {
      return true;
    }
  });

  const { deviceFlowState, runDeviceFlow, cancelDeviceFlow } = useGitHubDeviceFlow();

  const hasOAuth = !!authStatus?.hasOAuthTokens;
  const hasApp = !!authStatus?.hasGitHubApp;
  const oauthVerification = authStatus?.oauthVerification || null;
  const appNeedsOAuth = appDetectionRequiresOAuth() && !hasOAuth;
  // GitHub accounts behind each connection. `authStatus` carries the OAuth
  // user; the App installation account comes straight off the auth cache and
  // re-reads whenever authStatus changes (same auth events drive both).
  const oauthAccount = authStatus?.userData || null;
  const appAccount = (() => {
    try { return persistentAuth.getAppInstallation()?.userData || null; } catch { return null; }
  })();
  const statusBadge = hasOAuth && hasApp
    ? { label: 'Fully Connected', tone: statusColors.success }
    : (hasOAuth || hasApp)
      ? { label: 'Partially Connected', tone: statusColors.info }
      : { label: 'Not Connected', tone: statusColors.error };

  const refreshAuthStatus = useCallback(() => {
    try { setAuthStatus(persistentAuth.getAuthStatus()); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refreshAuthStatus();
    const listener = () => refreshAuthStatus();
    AUTH_EVENTS.forEach((ev) => persistentAuth.on(ev, listener));
    return () => AUTH_EVENTS.forEach((ev) => persistentAuth.off(ev, listener));
  }, [active, refreshAuthStatus]);

  // Persist the OAuth-backup preference to the same key the panel uses.
  useEffect(() => {
    try {
      localStorage.setItem(getStorageKey('allow_oauth_backup'), allowOAuthBackup ? 'true' : 'false');
    } catch { /* ignore */ }
  }, [allowOAuthBackup]);

  // Process any pending OAuth/App redirect callback (single-flight — safe
  // alongside the panel), confirm the stored OAuth token with GitHub, and
  // re-detect the App on tab focus (covers install-in-another-tab).
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const { oauth, app } = await runPendingCallbacks();
        if (cancelled) return;
        if (oauth.error || app.error) {
          setAuthNotice({ type: 'error', message: oauth.error || app.error });
        }
        refreshAuthStatus();
        if (persistentAuth.hasValidTokens()) {
          await persistentAuth.verifyOAuth();
          if (!cancelled) refreshAuthStatus();
        }
      } catch (err) {
        console.warn('[useGitHubConnection] Pending auth callback processing failed:', err?.message || err);
      }
    })();

    const onVisibilityChange = async () => {
      try {
        const { detected } = await recheckAppOnFocus();
        if (detected && !cancelled) {
          refreshAuthStatus();
          setAuthNotice({ type: 'info', message: 'GitHub App detected and linked.' });
        }
      } catch { /* quiet */ }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [active, refreshAuthStatus]);

  // Auto-detect an existing GitHub App install once OAuth is connected, using
  // forceAppDiscovery (same path as the manual "Detect install" button, which
  // clears any stale sticky-disconnect flag — correct when the user is here
  // specifically to connect). On native shells discovery needs a device-flow
  // token, so this no-ops there.
  const appDiscoveryTriedRef = useRef(false);
  useEffect(() => {
    if (!active || !hasOAuth || hasApp || oauthVerification === 'invalid') {
      appDiscoveryTriedRef.current = false;
      return undefined;
    }
    if (appDiscoveryTriedRef.current) return undefined;
    appDiscoveryTriedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        if (respectAppDisconnect) {
          await persistentAuth.attemptAppAutoConnect?.();
        } else {
          await persistentAuth.forceAppDiscovery?.();
        }
        if (!cancelled) refreshAuthStatus();
      } catch (err) {
        console.warn('[useGitHubConnection] App auto-discovery failed:', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [active, hasOAuth, hasApp, oauthVerification, respectAppDisconnect, refreshAuthStatus]);

  const noteRedirect = () => {
    if (!usesDeviceFlowAuth() && typeof beforeRedirect === 'function') {
      try { beforeRedirect(); } catch { /* ignore */ }
    }
  };

  const handleConnectOAuth = async () => {
    try {
      setIsConnecting(true);
      setAuthNotice(null);
      noteRedirect();
      const result = await connectOAuth({ runDeviceFlow });
      if (result?.connected) refreshAuthStatus();
    } catch (err) {
      setAuthNotice({ type: 'error', message: `OAuth authentication failed: ${err.message}` });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnectApp = async () => {
    try {
      setIsConnecting(true);
      setAuthNotice(null);
      // connectApp only redirects after discovery finds nothing; noting the
      // redirect up front is harmless when it doesn't happen.
      noteRedirect();
      const result = await connectApp({ runDeviceFlow });
      refreshAuthStatus();
      if (result?.needsOAuth) {
        setAuthNotice({ type: 'warning', message: APP_NEEDS_OAUTH_MESSAGE });
      } else if (result?.connected) {
        setAuthNotice({ type: 'info', message: 'GitHub App linked — it was already installed on your account.' });
      } else if (result?.installPending) {
        setAuthNotice({ type: 'warning', message: 'Install the GitHub App in your browser, then come back — Redstring will detect it.' });
      }
    } catch (err) {
      setAuthNotice({ type: 'error', message: `GitHub App connection failed: ${err.message}` });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDetectApp = async () => {
    try {
      setIsConnecting(true);
      setAuthNotice(null);
      const result = await detectAppInstall({ runDeviceFlow });
      refreshAuthStatus();
      if (result?.found) {
        setAuthNotice({ type: 'info', message: 'GitHub App detected and linked.' });
      } else if (result?.needsOAuth) {
        setAuthNotice({ type: 'warning', message: APP_NEEDS_OAUTH_MESSAGE });
      } else {
        setAuthNotice({
          type: 'warning',
          message: `No GitHub App install found for ${persistentAuth.oauthCache?.user?.login || 'your account'} yet. Install the App, then tap Detect install again.`
        });
      }
    } catch (err) {
      setAuthNotice({ type: 'error', message: `App detection failed: ${err.message}` });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectOAuth = async () => {
    try {
      await disconnectOAuth();
      refreshAuthStatus();
    } catch (err) {
      setAuthNotice({ type: 'error', message: `Failed to disconnect: ${err.message}` });
    }
  };

  const handleDisconnectApp = async () => {
    try {
      await disconnectApp();
      refreshAuthStatus();
    } catch (err) {
      setAuthNotice({ type: 'error', message: `Failed to disconnect App: ${err.message}` });
    }
  };

  return {
    authStatus,
    hasOAuth,
    hasApp,
    oauthVerification,
    appNeedsOAuth,
    oauthAccount,
    appAccount,
    statusBadge,
    isConnecting,
    authNotice,
    setAuthNotice,
    allowOAuthBackup,
    setAllowOAuthBackup,
    deviceFlowState,
    cancelDeviceFlow,
    refreshAuthStatus,
    connectOAuth: handleConnectOAuth,
    connectApp: handleConnectApp,
    detectApp: handleDetectApp,
    disconnectOAuth: handleDisconnectOAuth,
    disconnectApp: handleDisconnectApp
  };
}
