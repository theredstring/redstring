import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  RefreshCw,
  XCircle,
  Github,
  Trash2,
  Save,
  Settings,
  Shield,
  Cloud,
  CloudDownload,
  CloudUpload,
  GitBranch,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Info,
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2
} from 'lucide-react';

import gitFederationService, { STORAGE_TYPES } from './services/gitFederationService.js';
import { isElectron, pickFile, pickSaveLocation, readFile, writeFile } from './utils/fileAccessAdapter.js';
import { HEADER_HEIGHT } from './constants.js';
import useGraphStore from './store/graphStore.jsx';
import { getStorageKey } from './utils/storageUtils.js';

const GF_TAG = '[GF-DEBUG]';
const { log: __gfNativeLog, warn: __gfNativeWarn, error: __gfNativeError } = console;
const gfLog = (...args) => __gfNativeLog.call(console, GF_TAG, ...args);
const gfWarn = (...args) => __gfNativeWarn.call(console, GF_TAG, ...args);
const gfError = (...args) => __gfNativeError.call(console, GF_TAG, ...args);
import { persistentAuth } from './services/persistentAuth.js';
import { oauthFetch } from './services/bridgeConfig.js';
import universeBackend from './services/universeBackend.js';
import universeBackendBridge from './services/universeBackendBridge.js';
import PanelIconButton from './components/shared/PanelIconButton.jsx';
import RepositorySelectionModal from './components/modals/RepositorySelectionModal.jsx';
import UniverseLinkingModal from './components/modals/UniverseLinkingModal.jsx';
import ConflictResolutionModal from './components/modals/ConflictResolutionModal.jsx';
import Modal from './components/shared/Modal.jsx';
import ConfirmDialog from './components/shared/ConfirmDialog.jsx';
import LocalFileConflictDialog from './components/shared/LocalFileConflictDialog.jsx';
import ConnectionStats from './components/git-federation/ConnectionStats.jsx';
import AuthSection from './components/git-federation/AuthSection.jsx';
import UniversesList from './components/git-federation/UniversesList.jsx';
import SourcesSection from './components/git-federation/SourcesSection.jsx';
import RepositoriesSection from './components/git-federation/RepositoriesSection.jsx';

const STORAGE_LABELS = {
  [STORAGE_TYPES.GIT]: 'Git repository',
  [STORAGE_TYPES.LOCAL]: 'Local file',
  [STORAGE_TYPES.BROWSER]: 'Browser cache'
};

const STATUS_COLORS = {
  success: '#2e7d32',
  info: '#1565c0',
  warning: '#ef6c00',
  error: '#c62828'
};

const blankState = {
  universes: [],
  activeUniverseSlug: null,
  activeUniverse: null,
  authStatus: null,
  githubAppInstallation: null
};

function detectDeviceInfo() {
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      isTablet: false,
      supportsFileSystemAPI: false,
      gitOnlyMode: false
    };
  }

  const ua = window.navigator.userAgent.toLowerCase();
  const isTouch = 'ontouchstart' in window || window.navigator.maxTouchPoints > 0;
  const isMobile = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/.test(ua);
  const isTablet = /ipad|android(?!.*mobile)|kindle|silk|playbook|bb10/.test(ua) ||
    (/macintosh/.test(ua) && isTouch);

  return {
    isMobile,
    isTablet,
    supportsFileSystemAPI: 'showSaveFilePicker' in window,
    gitOnlyMode: isMobile || isTablet || !('showSaveFilePicker' in window)
  };
}

function formatWhen(value) {
  if (!value) return 'Unknown';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function computeStoreMetrics(storeState) {
  if (!storeState) {
    return { nodeCount: null, edgeCount: null };
  }

  const resolveCount = (value) => {
    if (value instanceof Map || value instanceof Set) return value.size;
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return null;
  };

  const nodeCount = resolveCount(storeState.nodePrototypes);
  let edgeCount = resolveCount(storeState.edges);

  if (edgeCount === null && storeState.graphs) {
    const graphs = storeState.graphs instanceof Map
      ? Array.from(storeState.graphs.values())
      : Object.values(storeState.graphs || {});
    edgeCount = graphs.reduce((total, graph) => {
      const edgeIds = Array.isArray(graph?.edgeIds) ? graph.edgeIds : [];
      return total + edgeIds.length;
    }, 0);
  }

  return {
    nodeCount,
    edgeCount
  };
}

function resolveFileDisplayPath(fileHandle, file) {
  if (file?.path) return file.path;
  if (file?.webkitRelativePath) return file.webkitRelativePath;
  if (fileHandle?.name) return fileHandle.name;
  if (file?.name) return file.name;
  return 'Unknown.redstring';
}

function BrowserFallbackNote() {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 12px',
        borderRadius: 6,
        border: '1px dashed #7A0000',
        backgroundColor: 'rgba(122,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: '#260000',
        fontSize: '0.8rem'
      }}
    >
      <Cloud size={16} />
      <div>
        <div style={{ fontWeight: 600 }}>Browser cache</div>
        <div>Data stored in browser. Link a Git repository or local file for persistence.</div>
      </div>
    </div>
  );
}

function buttonStyle(variant = 'outline') {
  const base = {
    border: '1px solid #260000',
    backgroundColor: 'transparent',
    color: '#260000',
    padding: '6px 10px',
    borderRadius: 6,
    fontSize: '0.75rem',
    cursor: 'pointer',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    textDecoration: 'none'
  };

  switch (variant) {
    case 'solid':
      return {
        ...base,
        backgroundColor: '#1a0000',
        color: '#8a8080'
      };
    case 'danger':
      return {
        ...base,
        border: '1px solid #7A0000',
        color: '#7A0000',
        backgroundColor: 'rgba(122,0,0,0.08)'
      };
    case 'disabled':
      return {
        ...base,
        border: '1px solid #999',
        color: '#666',
        backgroundColor: '#ccc',
        cursor: 'not-allowed'
      };
    default:
      return base;
  }
}

const GitNativeFederation = ({ variant = 'panel', onRequestClose }) => {
  const [serviceState, setServiceState] = useState(blankState);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false); // Start false - don't block UI on load
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [allowOAuthBackup, setAllowOAuthBackup] = useState(() => {
    try {
      return localStorage.getItem(getStorageKey('allow_oauth_backup')) !== 'false';
    } catch {
      return true;
    }
  });
  const [showRepositoryManager, setShowRepositoryManager] = useState(false);
  const [showConnectionStats, setShowConnectionStats] = useState(() => {
    try {
      return localStorage.getItem(getStorageKey('redstring_show_connection_stats')) !== 'false';
    } catch {
      return false; // Collapsed by default
    }
  });

  // TypeList gap spacing - same logic as Panel.jsx
  const typeListMode = useGraphStore((state) => state.typeListMode);
  const isTypeListVisible = typeListMode !== 'closed';
  const bottomSafeArea = isTypeListVisible ? HEADER_HEIGHT + 10 : 0; // footer height + small gap
  const [showUniverseFileSelector, setShowUniverseFileSelector] = useState(false);
  const [showUniverseCreationModeDialog, setShowUniverseCreationModeDialog] = useState(false);
  const [pendingRepoAttachment, setPendingRepoAttachment] = useState(null);
  const [discoveredUniverseFiles, setDiscoveredUniverseFiles] = useState([]);
  const [showUniverseLinking, setShowUniverseLinking] = useState(false);
  const [pendingUniverseLink, setPendingUniverseLink] = useState(null);

  const [repositoryTargetSlug, setRepositoryTargetSlug] = useState(null);
  const [discoveryMap, setDiscoveryMap] = useState({});
  const [syncTelemetry, setSyncTelemetry] = useState({});
  const [managedRepositories, setManagedRepositories] = useState(() => {
    try {
      const stored = localStorage.getItem(getStorageKey('redstring_managed_repos'));
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [repositoryIntent, setRepositoryIntent] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [conflictDialog, setConflictDialog] = useState(null);
  const [slotConflict, setSlotConflict] = useState(null);
  const [authExpiredDialog, setAuthExpiredDialog] = useState(null);

  const containerRef = useRef(null);
  const [isSlim, setIsSlim] = useState(false);
  const pendingLocalLinkRef = useRef(null);
  const graphStoreModuleRef = useRef(null);

  const deviceInfo = useMemo(() => detectDeviceInfo(), []);
  const autosaveRef = useRef({ cooldownUntil: 0, triggerAt: 0 });

  const loadGraphStore = useCallback(async () => {
    if (!graphStoreModuleRef.current) {
      const module = await import('./store/graphStore.jsx');
      graphStoreModuleRef.current = module.default;
    }
    return graphStoreModuleRef.current;
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const auth = await gitFederationService.refreshAuth();
      setServiceState((prev) => ({ ...prev, ...auth }));
    } catch (err) {
      gfWarn('[GitNativeFederation] Auth refresh failed:', err);
    }
  }, []);

  const refreshState = useCallback(async (options = {}) => {
    const { silent = false, timeoutMs = 5000 } = options; // 5s timeout for better reliability
    const timerApi = typeof window !== 'undefined' ? window : globalThis;
    let timeoutId = null;
    let didTimeout = false;

    const statePromise = gitFederationService.getState();
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = timerApi.setTimeout(() => {
        didTimeout = true;
        reject(new Error('STATE_REFRESH_TIMEOUT'));
      }, timeoutMs);
    });

    try {
      if (!silent) {
        setLoading(true);
      }

      const next = await Promise.race([statePromise, timeoutPromise]);
      if (timeoutId !== null) {
        timerApi.clearTimeout(timeoutId);
        timeoutId = null;
      }

      gfLog('[GF-DEBUG] Refreshed federation state:', next);
      console.log(`[Perf] Federation Data Loaded at ${(performance.now() / 1000).toFixed(3)}s`);
      setServiceState(next);
      setSyncTelemetry(next.syncStatuses || {});
      setError(null); // Clear any previous errors on success
    } catch (err) {
      if (timeoutId !== null) {
        timerApi.clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (didTimeout) {
        gfWarn('[GF-DEBUG] Federation state refresh timed out, continuing without blocking UI');
        // Warning removed per user request - silent degradation
        // setSyncStatus({ ... });
        setError(null);

        statePromise
          .then((next) => {
            gfLog('[GF-DEBUG] Late federation state response applied:', next);
            setServiceState(next);
            setSyncTelemetry(next.syncStatuses || {});
            setError(null);
          })
          .catch((lateErr) => {
            gfError('[GF-DEBUG] Late federation state refresh failed:', lateErr);
            setError('Unable to load Git federation state – please retry.');
          });
      } else {
        gfError('[GF-DEBUG] Failed to load state:', err);
        setError('Unable to load Git federation state – please retry.');
      }
    } finally {
      if (timeoutId !== null) {
        timerApi.clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (!silent) {
        setLoading(false);
      }
    }
  }, [setError, setLoading, setServiceState, setSyncStatus, setSyncTelemetry]);

  useEffect(() => {
    console.log(`[Perf] GitNativeFederation Mounted at ${(performance.now() / 1000).toFixed(3)}s`);
    // CRITICAL: Don't block UI rendering on backend initialization
    // Load state asynchronously and allow component to render immediately
    (async () => {
      try {
        // Use silent mode for initial load to avoid showing loading state
        await refreshState({ silent: true });
      } finally {
        setInitializing(false);
      }
    })();

    const handleAuthConnected = async () => {
      try {
        const next = await gitFederationService.refreshAuth();
        setServiceState((prev) => ({ ...prev, ...next }));
        const universes = await gitFederationService.refreshUniverses();
        setServiceState((prev) => ({ ...prev, ...universes }));
        setSyncTelemetry(universes.syncStatuses || {});
      } catch (err) {
        gfWarn('[GF-DEBUG] Auth connected refresh failed:', err);
      }
    };

    window.addEventListener('redstring:auth-connected', handleAuthConnected);

    // Handle authentication expiration (401 errors)
    const handleAuthExpired = async (event) => {
      try {
        const detail = event.detail || {};
        gfWarn('[GF-DEBUG] Authentication expired:', detail);

        // Clear any stale state
        await refreshAuth();

        // Show prominent dialog prompting re-authentication
        setAuthExpiredDialog({
          message: detail.message || 'GitHub authentication has expired.',
          authMethod: detail.authMethod || 'oauth'
        });

        // Clear any success status
        setSyncStatus(null);
      } catch (err) {
        gfWarn('[GF-DEBUG] Auth expired handler failed:', err);
      }
    };

    window.addEventListener('redstring:auth-expired', handleAuthExpired);

    // Handle universe creation events from onboarding flow
    const handleUniverseCreated = async () => {
      try {
        gfLog('[GF-DEBUG] Universe created event received, refreshing state...');
        await refreshState();
      } catch (err) {
        gfWarn('[GF-DEBUG] Universe created handler refresh failed:', err);
      }
    };

    window.addEventListener('redstring:universe-created', handleUniverseCreated);

    // Track mount state nicely
    const isMounted = { current: true };

    // Poll sync status safely - prevent overlapping calls if backend is slow
    let pollTimeout;
    const pollSafe = async () => {
      try {
        if (!isMounted.current) return;
        const universes = await gitFederationService.refreshUniverses();
        if (isMounted.current) {
          setSyncTelemetry(universes.syncStatuses || {});
        }
      } catch (err) {
        // Silent fail
      } finally {
        if (isMounted.current) {
          pollTimeout = setTimeout(pollSafe, 5000);
        }
      }
    };

    // Start polling loop
    pollTimeout = setTimeout(pollSafe, 5000);

    return () => {
      isMounted.current = false;
      window.removeEventListener('redstring:auth-connected', handleAuthConnected);
      window.removeEventListener('redstring:auth-expired', handleAuthExpired);
      window.removeEventListener('redstring:universe-created', handleUniverseCreated);
      clearTimeout(pollTimeout);
    };
  }, [refreshState, refreshAuth]);



  // Audit: If both Git and Local slots are enabled and primary is unset or ambiguous, prompt user to choose
  useEffect(() => {
    const slug = serviceState.activeUniverseSlug;
    if (!slug) return;
    const u = (serviceState.universes || []).find((x) => x.slug === slug);
    if (!u) return;
    const raw = u.raw || {};
    const hasLocal = !!raw.localFile?.enabled;
    const hasRepo = !!(raw.gitRepo?.enabled && raw.gitRepo?.linkedRepo);
    const currentPrimary = u.sourceOfTruth || u.storage?.primary?.type || null;

    if (hasLocal && hasRepo && (currentPrimary !== 'git' && currentPrimary !== 'local')) {
      setConfirmDialog({
        title: 'Choose Source of Truth',
        message: 'Both Git and Local are linked. Choose the primary source for saves and loads.',
        confirmLabel: 'Use Git as Primary',
        cancelLabel: 'Use Local as Primary',
        variant: 'warning',
        onConfirm: async () => {
          try { await gitFederationService.setPrimaryStorage(slug, STORAGE_TYPES.GIT); await refreshState(); } catch (e) { gfWarn('Failed to set git as primary (audit)', e); }
        },
        onCancel: async () => {
          try { await gitFederationService.setPrimaryStorage(slug, STORAGE_TYPES.LOCAL); await refreshState(); } catch (e) { gfWarn('Failed to set local as primary (audit)', e); }
        }
      });
    }
  }, [serviceState.activeUniverseSlug, serviceState.universes, refreshState]);

  // First-time link guidance: when returning from auth or entering federation with no file linked,
  // prompt the user to either create a local file or link a repo file (if none discovered yet).
  useEffect(() => {
    try {
      const shouldPrompt = sessionStorage.getItem('redstring_first_link_prompt') === 'true';
      if (!shouldPrompt) return;
    } catch { return; }

    const slug = serviceState.activeUniverseSlug;
    if (!slug) return;
    const u = (serviceState.universes || []).find((x) => x.slug === slug);
    if (!u) return;

    const hasLocal = !!(u.raw?.localFile?.enabled && (u.raw?.localFile?.hadFileHandle || u.raw?.localFile?.path));
    const hasGit = !!(u.raw?.gitRepo?.enabled && u.raw?.gitRepo?.linkedRepo);

    // If neither slot is concretely linked yet, guide the user to link/create
    if (!hasLocal && !hasGit) {
      setConfirmDialog({
        title: 'Connect Your Universe',
        message: 'Choose how to persist your universe: link a repository file or create/link a local file.',
        variant: 'default',
        confirmLabel: 'Open Repository Picker',
        cancelLabel: 'Create/Link Local File',
        onConfirm: () => {
          setRepositoryIntent('attach');
          setRepositoryTargetSlug(slug);
          setShowRepositoryManager(true);
          try { sessionStorage.removeItem('redstring_first_link_prompt'); } catch { }
        },
        onCancel: async () => {
          try {
            // Prefer linking existing local, fall back to create
            await handleLinkLocalFile(slug);
          } catch (_) {
            try { await handleCreateLocalFile(slug); } catch (__) { }
          } finally {
            try { sessionStorage.removeItem('redstring_first_link_prompt'); } catch { }
          }
        }
      });
    } else {
      try { sessionStorage.removeItem('redstring_first_link_prompt'); } catch { }
    }
  }, [serviceState.activeUniverseSlug, serviceState.universes]);

  // Ensure a clean git-only startup experience: if we're in git-only context without a linked repo,
  // disable local file to avoid reconnect prompts and use browser cache as temporary primary.
  useEffect(() => {
    const shouldFavorGit = deviceInfo.gitOnlyMode || (() => {
      try { return sessionStorage.getItem('redstring_onboarding_resume') === 'true'; } catch { return false; }
    })();
    if (!shouldFavorGit) return;
    const slug = serviceState.activeUniverseSlug;
    if (!slug) return;
    const u = (serviceState.universes || []).find((x) => x.slug === slug);
    if (!u) return;
    const raw = u.raw || {};
    const hasLinkedRepo = !!(raw.gitRepo?.enabled && raw.gitRepo?.linkedRepo);
    const needsLocalDisable = raw.localFile?.enabled && !raw.localFile?.hadFileHandle;
    if (!hasLinkedRepo && needsLocalDisable) {
      (async () => {
        try {
          await universeBackendBridge.updateUniverse(slug, {
            localFile: { ...raw.localFile, enabled: false },
            sourceOfTruth: 'browser',
            browserStorage: { ...(raw.browserStorage || {}), enabled: true }
          });
          // Refresh UI state after mutation
          await refreshState({ silent: true });
        } catch (e) {
          gfWarn('[GitNativeFederation] Failed to auto-configure git-only startup state:', e);
        }
      })();
    }
  }, [serviceState.activeUniverseSlug, serviceState.universes, deviceInfo.gitOnlyMode, refreshState]);

  useEffect(() => {
    const listener = () => refreshAuth();

    persistentAuth.on('tokenStored', listener);
    persistentAuth.on('tokenValidated', listener);
    persistentAuth.on('authExpired', listener);
    persistentAuth.on('appInstallationStored', listener);
    persistentAuth.on('appInstallationCleared', listener);

    return () => {
      persistentAuth.off('tokenStored', listener);
      persistentAuth.off('tokenValidated', listener);
      persistentAuth.off('authExpired', listener);
      persistentAuth.off('appInstallationStored', listener);
      persistentAuth.off('appInstallationCleared', listener);
    };
  }, [refreshAuth]);

  // Removed autosave batch-size polling; rely on engine flags for UI state

  // Lightweight autosave fallback: if unsaved changes persist for 20s, save once; 60s cooldown
  const hasOAuth = !!serviceState.authStatus?.hasOAuthTokens;
  const hasApp = !!(serviceState.authStatus?.hasGitHubApp || serviceState.githubAppInstallation?.installationId);
  const dataAuthMethod = hasOAuth ? 'oauth' : (hasApp ? 'github-app' : null);

  useEffect(() => {
    if (!serviceState.activeUniverseSlug) return undefined;
    const active = serviceState.universes.find(u => u.slug === serviceState.activeUniverseSlug);
    const hasUnsaved = !!(active?.sync?.hasUnsavedChanges);

    if (!hasUnsaved) {
      autosaveRef.current.triggerAt = 0;
      return undefined;
    }

    const now = Date.now();
    if (now < autosaveRef.current.cooldownUntil) {
      return undefined;
    }

    if (!autosaveRef.current.triggerAt) {
      autosaveRef.current.triggerAt = now + 20000; // 20s persistence window
    }

    const timer = setTimeout(async () => {
      try {
        // Double-check still unsaved before saving
        const fresh = await gitFederationService.refreshUniverses();
        const latest = fresh.universes.find(u => u.slug === fresh.activeUniverseSlug);
        if (latest?.sync?.hasUnsavedChanges) {
          const hasGitRepo = !!(latest.raw?.gitRepo?.enabled && latest.raw?.gitRepo?.linkedRepo);
          const hasGitAuth = hasOAuth || hasApp;
          setLoading(true);
          await gitFederationService.forceSave(latest.slug, hasGitRepo && hasGitAuth ? undefined : { skipGit: true });
          setSyncStatus({
            type: hasGitRepo && hasGitAuth ? 'success' : 'info',
            message: hasGitRepo && hasGitAuth
              ? 'Autosaved changes to Git'
              : 'Autosaved local changes. Connect GitHub to sync remote repository.'
          });
          await refreshState();
        }
      } catch (e) {
        // Silent; error banner handled elsewhere if needed
      } finally {
        setLoading(false);
        autosaveRef.current.cooldownUntil = Date.now() + 60000; // 60s cooldown
        autosaveRef.current.triggerAt = 0;
      }
    }, Math.max(0, autosaveRef.current.triggerAt - now));

    return () => clearTimeout(timer);
  }, [serviceState.activeUniverseSlug, serviceState.universes, serviceState.authStatus, hasOAuth, hasApp, refreshState]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect?.width || el.clientWidth || 0;
        setIsSlim(width < 540);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!syncStatus) return undefined;
    const timeout = setTimeout(
      () => setSyncStatus(null),
      syncStatus.type === 'success' ? 4000 : 6000
    );
    return () => clearTimeout(timeout);
  }, [syncStatus]);

  useEffect(() => {
    if (!error) return undefined;
    const timeout = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    try {
      localStorage.setItem(getStorageKey('allow_oauth_backup'), allowOAuthBackup ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [allowOAuthBackup]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let cancelled = false;

    const safeSessionGet = (key) => {
      try {
        return sessionStorage.getItem(key);
      } catch {
        return null;
      }
    };

    const safeSessionRemove = (key) => {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // ignore
      }
    };

    const readSessionJSON = (key) => {
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const data = JSON.parse(raw);
        sessionStorage.removeItem(key);
        return data;
      } catch (err) {
        gfWarn(`[GitNativeFederation] Failed to parse session data for ${key}:`, err);
        sessionStorage.removeItem(key);
        return null;
      }
    };

    const cleanupUrl = () => {
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch {
        // ignore
      }
    };

    const processOAuthCallback = async () => {
      const storedResult = readSessionJSON('github_oauth_result');
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
      const code = storedResult?.code || urlParams.get('code') || hashParams.get('code');
      const stateValue = storedResult?.state || urlParams.get('state') || hashParams.get('state');
      const expectedState = safeSessionGet('github_oauth_state');
      const pending = safeSessionGet('github_oauth_pending') === 'true';

      if (!code || !stateValue || !pending) {
        return false;
      }

      if (expectedState && stateValue !== expectedState) {
        setError('GitHub authentication state mismatch. Please retry.');
        safeSessionRemove('github_oauth_pending');
        safeSessionRemove('github_oauth_state');
        cleanupUrl();
        return false;
      }

      const redirectUri = gitFederationService.getOAuthRedirectUri();

      try {
        setIsConnecting(true);
        const resp = await oauthFetch('/api/github/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state: stateValue, redirect_uri: redirectUri })
        });

        if (!resp.ok) {
          const message = await resp.text().catch(() => 'unknown error');
          throw new Error(`Token exchange failed (${resp.status} ${message})`);
        }

        const tokenData = await resp.json();
        const userResp = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `token ${tokenData.access_token}`,
            Accept: 'application/vnd.github.v3+json'
          }
        });

        if (!userResp.ok) {
          const message = await userResp.text().catch(() => 'unknown error');
          throw new Error(`Failed to fetch GitHub user (${userResp.status} ${message})`);
        }

        const userData = await userResp.json();
        await persistentAuth.storeTokens(tokenData, userData);

        if (!cancelled) {
          await refreshAuth();
          await refreshState();
          setSyncStatus({ type: 'success', message: 'GitHub OAuth connected' });
        }
        // Clear resume flag now that OAuth is complete
        try {
          sessionStorage.removeItem('redstring_onboarding_resume');
          sessionStorage.removeItem('redstring_onboarding_step');
        } catch { }
        return true;
      } catch (err) {
        if (!cancelled) {
          gfError('[GF-DEBUG] OAuth callback failed:', err);
          setError(`GitHub OAuth failed: ${err.message}`);
        }
        return false;
      } finally {
        safeSessionRemove('github_oauth_pending');
        safeSessionRemove('github_oauth_state');
        setIsConnecting(false);
        cleanupUrl();
      }
    };

    const processAppCallback = async () => {
      const storedResult = readSessionJSON('github_app_result');
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
      let installationId =
        storedResult?.installation_id || urlParams.get('installation_id') || hashParams.get('installation_id');

      const pending = safeSessionGet('github_app_pending') === 'true';

      // CRITICAL FIX: If no installation_id, try to discover it via installations API
      if (!installationId && pending) {
        gfLog('[GitNativeFederation] No installation_id in callback, attempting discovery...');
        try {
          const listResp = await oauthFetch('/api/github/app/installations');
          if (listResp.ok) {
            const installations = await listResp.json();
            if (Array.isArray(installations) && installations.length > 0) {
              // Use most recent installation
              const latest = installations[0];
              installationId = latest?.id;
              gfLog('[GitNativeFederation] Discovered installation:', installationId);
            }
          }
        } catch (discoveryErr) {
          gfWarn('[GitNativeFederation] Installation discovery failed:', discoveryErr);
        }
      }

      if (!installationId) return false;

      try {
        setIsConnecting(true);
        gfLog('[GitNativeFederation] Requesting installation token for:', installationId);

        const resp = await oauthFetch('/api/github/app/installation-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ installation_id: installationId })
        });

        if (!resp.ok) {
          const message = await resp.text().catch(() => 'unknown error');

          // IMPROVED ERROR HANDLING: Provide specific guidance for common errors
          let errorMessage = `Failed to obtain installation token (${resp.status})`;

          if (resp.status === 401) {
            errorMessage = 'GitHub OAuth authentication required. Please connect OAuth first, then retry the GitHub App installation.';
          } else if (resp.status === 403) {
            errorMessage = 'Installation not accessible. The GitHub App installation may not match your authenticated GitHub account.';
          } else if (resp.status === 502) {
            errorMessage = 'GitHub API gateway error. This may indicate the GitHub App configuration is incorrect. Please check GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY environment variables.';
          } else if (resp.status === 404) {
            errorMessage = 'Installation not found. Please reinstall the GitHub App.';
          } else {
            errorMessage += `: ${message}`;
          }

          throw new Error(errorMessage);
        }

        const tokenData = await resp.json();
        const token = tokenData?.token;
        if (!token) {
          throw new Error('GitHub App token response missing token');
        }

        const tokenExpiresAtMs = tokenData.expires_at ? Date.parse(tokenData.expires_at) : null;

        gfLog('[GitNativeFederation] Storing GitHub App installation...');
        await persistentAuth.storeAppInstallation({
          installationId,
          accessToken: token,
          repositories: tokenData.repositories || [],
          userData: tokenData.account || {},
          permissions: tokenData.permissions || null,
          tokenExpiresAt: Number.isFinite(tokenExpiresAtMs) ? tokenExpiresAtMs : null,
          verification: tokenData.verification || null,
          lastUpdated: Date.now()
        });

        if (!cancelled) {
          await refreshAuth();
          await refreshState();
          setSyncStatus({ type: 'success', message: 'GitHub App connected' });
        }
        // Clear resume flag now that App installation is complete
        try {
          sessionStorage.removeItem('redstring_onboarding_resume');
          sessionStorage.removeItem('redstring_onboarding_step');
        } catch { }
        return true;
      } catch (err) {
        if (!cancelled) {
          gfError('[GitNativeFederation] GitHub App callback failed:', err);
          setError(`GitHub App connection failed: ${err.message}`);
        }
        return false;
      } finally {
        if (pending) safeSessionRemove('github_app_pending');
        setIsConnecting(false);
        cleanupUrl();
      }
    };

    (async () => {
      const oauthDone = await processOAuthCallback();
      const appDone = await processAppCallback();
      if ((oauthDone || appDone) && !cancelled) {
        await refreshState();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshAuth, refreshState]);

  const activeUniverse = useMemo(() => {
    if (!serviceState.activeUniverseSlug) return null;
    return serviceState.universes.find((u) => u.slug === serviceState.activeUniverseSlug) || null;
  }, [serviceState]);

  const syncStatusFor = useCallback((slug) => {
    if (!slug) return null;
    return syncTelemetry?.[slug] || null;
  }, [syncTelemetry]);

  useEffect(() => {
    if (!activeUniverse?.raw?.sources) return;
    setDiscoveryMap((prev) => {
      const next = {};
      activeUniverse.raw.sources.forEach((src) => {
        if (src.type === 'github' && src.user && src.repo) {
          const key = `${src.user}/${src.repo}`;
          if (prev[key]) next[key] = prev[key];
        }
      });
      return next;
    });
  }, [activeUniverse?.raw?.sources]);

  // Listen for slot conflict events from universeBackend
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleSlotConflict = (event) => {
      gfLog('[GitNativeFederation] Slot conflict detected:', event.detail);
      setSlotConflict(event.detail);
    };

    window.addEventListener('redstring:slot-conflict', handleSlotConflict);
    return () => {
      window.removeEventListener('redstring:slot-conflict', handleSlotConflict);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleGitEngineReady = (event) => {
      const slug = event?.detail?.slug;
      gfLog('[GitNativeFederation] Git engine ready event received:', slug);
      refreshState();
    };

    window.addEventListener('redstring:git-engine-ready', handleGitEngineReady);
    return () => {
      window.removeEventListener('redstring:git-engine-ready', handleGitEngineReady);
    };
  }, [refreshState]);

  const discoveryFor = useCallback(
    (user, repo) => discoveryMap[`${user}/${repo}`] || { items: [], loading: false },
    [discoveryMap]
  );

  const statusBadge = useMemo(() => {
    if (hasOAuth && hasApp) return { label: 'Fully Connected', tone: STATUS_COLORS.success };
    if (hasOAuth || hasApp) return { label: 'Partially Connected', tone: STATUS_COLORS.info };
    return { label: 'Not Connected', tone: STATUS_COLORS.error };
  }, [hasOAuth, hasApp]);

  const handleCreateUniverse = async () => {
    // Show creation mode selection dialog first
    setShowUniverseCreationModeDialog(true);
  };

  const handleCreateUniverseFromRepo = async () => {
    setShowUniverseCreationModeDialog(false);
    handleLoadFromRepo();
  };

  const handleCreateUniverseFromScratch = async () => {
    setShowUniverseCreationModeDialog(false);
    setConfirmDialog({
      title: 'Create New Universe',
      message: 'Choose a name for your new universe:',
      variant: 'default',
      confirmLabel: 'Create',
      cancelLabel: 'Cancel',
      inputField: {
        placeholder: 'My Universe',
        defaultValue: '',
        label: 'Universe Name'
      },
      onConfirm: async (name) => {
        try {
          setLoading(true);
          await gitFederationService.createUniverse(name, {
            enableGit: deviceInfo.gitOnlyMode,
            enableLocal: !deviceInfo.gitOnlyMode
          });
          setSyncStatus({ type: 'success', message: `Universe "${name}" created` });
          await refreshState();
        } catch (err) {
          gfError('[GitNativeFederation] Create failed:', err);
          setError(`Failed to create universe: ${err.message}`);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleCreateUniverseFromLocalFile = async () => {
    setConfirmDialog({
      title: 'Create Universe from New File',
      message: 'Choose a name for your new universe. A fresh .redstring file will be created for it.',
      variant: 'default',
      confirmLabel: 'Create',
      cancelLabel: 'Cancel',
      inputField: {
        placeholder: 'My Universe',
        defaultValue: '',
        label: 'Universe Name'
      },
      onConfirm: async (rawName) => {
        const universeName = (rawName || '').trim();
        if (!universeName) {
          setError('Universe name is required.');
          return;
        }

        let createdSlug = null;
        try {
          setLoading(true);
          const creationResult = await gitFederationService.createUniverse(universeName, {
            enableGit: false,
            enableLocal: true
          });

          createdSlug =
            creationResult?.createdUniverse?.slug ||
            (creationResult?.universes || []).find(
              (u) => u.name === creationResult?.createdUniverse?.name
            )?.slug ||
            (creationResult?.universes || []).find((u) => u.name === universeName)?.slug;

          if (!createdSlug) {
            throw new Error('Unable to determine universe slug after creation');
          }

          try {
            await universeBackendBridge.setupLocalFileHandle(createdSlug, {
              mode: 'saveAs',
              suggestedName: `${universeName}.redstring`
            });
            await universeBackendBridge.saveActiveUniverse();
            setSyncStatus({
              type: 'success',
              message: `Universe "${universeName}" created with a new local file.`
            });
          } catch (fileError) {
            if (fileError?.name === 'AbortError') {
              setSyncStatus({
                type: 'warning',
                message: `Universe "${universeName}" was created without linking a file. Use "Create File" later to attach one.`
              });
            } else {
              gfWarn('[GitNativeFederation] Failed to create local file for new universe:', fileError);
              setError(`Universe created but local file setup failed: ${fileError.message}`);
            }
          }
        } catch (err) {
          gfError('[GitNativeFederation] Create universe from file failed:', err);
          setError(`Failed to create universe: ${err.message}`);
        } finally {
          setLoading(false);
          await refreshState();
        }
      }
    });
  };

  const handleLoadFromLocal = async (file) => {
    try {
      setLoading(true);
      const fileName = file.name.replace('.redstring', '');

      // Read the file content
      const text = await file.text();
      const storeState = JSON.parse(text);

      setLoading(false);

      // Ask for universe name
      setConfirmDialog({
        title: 'Load Universe from File',
        message: 'Choose a name for this universe:',
        variant: 'default',
        confirmLabel: 'Load',
        cancelLabel: 'Cancel',
        inputField: {
          placeholder: 'Universe name',
          defaultValue: fileName,
          label: 'Universe Name'
        },
        onConfirm: async (universeName) => {
          try {
            setLoading(true);

            // Create the universe first and get the resulting slug
            const creationResult = await gitFederationService.createUniverse(universeName, {
              enableGit: false,
              enableLocal: true
            });

            const createdSlug = creationResult?.createdUniverse?.slug ||
              (creationResult?.universes || []).find(u => u.name === creationResult?.createdUniverse?.name)?.slug ||
              (creationResult?.universes || []).find(u => u.name === universeName)?.slug;

            if (!createdSlug) {
              throw new Error('Unable to determine universe slug after creation');
            }

            // Load the file data into it via uploadLocalFile (file first, then target slug)
            const uploadResult = await universeBackendBridge.uploadLocalFile(file, createdSlug);

            if (uploadResult?.needsFileHandle) {
              try {
                await universeBackendBridge.setupLocalFileHandle(createdSlug, {
                  mode: 'saveAs',
                  suggestedName: file.name
                });
                await universeBackendBridge.saveActiveUniverse();
                setSyncStatus({
                  type: 'success',
                  message: `Universe "${universeName}" loaded and linked to a local file`
                });
              } catch (handleError) {
                if (handleError?.name === 'AbortError') {
                  setSyncStatus({
                    type: 'warning',
                    message: 'Universe loaded. Link a local file to enable auto-save.'
                  });
                } else {
                  gfWarn('[GitNativeFederation] Failed to establish local file handle after import:', handleError);
                  setSyncStatus({
                    type: 'warning',
                    message: 'Universe loaded, but local file linking failed. Use "Pick File" to connect a file.'
                  });
                }
              }
            } else {
              setSyncStatus({ type: 'success', message: `Universe "${universeName}" loaded from file` });
            }
            await refreshState();
          } catch (err) {
            gfError('[GitNativeFederation] Load from local failed:', err);
            setError(`Failed to load universe from file: ${err.message}`);
          } finally {
            setLoading(false);
          }
        }
      });
    } catch (err) {
      gfError('[GitNativeFederation] Load from local failed:', err);
      setError(`Failed to load universe from file: ${err.message}`);
      setLoading(false);
    }
  };

  const handleLoadFromRepo = () => {
    // Trigger the repository connection flow which will discover universe files
    setRepositoryIntent('import');
    setRepositoryTargetSlug(null);
    setShowRepositoryManager(true);
  };

  const handleSwitchUniverse = async (slug) => {
    if (slug === serviceState.activeUniverseSlug) return;

    let attemptedPermission = false;
    const attemptSwitch = async () => {
      await gitFederationService.switchUniverse(slug);
      await refreshState();
      setSyncStatus({ type: 'info', message: 'Universe switched' });
    };

    const promptForPermissionIfNeeded = async () => {
      const targetUniverse = serviceState.universes.find((u) => u.slug === slug);
      if (targetUniverse?.localFile?.fileHandleStatus === 'permission_needed') {
        attemptedPermission = true;
        await gitFederationService.requestLocalFilePermission(slug);
      }
    };

    try {
      setLoading(true);
      await promptForPermissionIfNeeded();
      await attemptSwitch();
    } catch (err) {
      const message = String(err?.message || '');
      const needsPermission = /permission/i.test(message) || /access/i.test(message);

      if (!attemptedPermission && needsPermission) {
        try {
          attemptedPermission = true;
          await gitFederationService.requestLocalFilePermission(slug);
          await attemptSwitch();
          return;
        } catch (permissionError) {
          gfError('[GitNativeFederation] Permission prompt failed:', permissionError);
          setError(`Permission required to load this universe: ${permissionError.message}`);
          return;
        }
      }

      gfError('[GitNativeFederation] Switch failed:', err);
      setError(`Failed to switch universe: ${message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUniverse = async (slug, name) => {
    setConfirmDialog({
      title: 'Delete Universe',
      message: `Delete universe "${name}"?`,
      details: 'This action cannot be undone. All data in this universe will be permanently removed.',
      variant: 'danger',
      confirmLabel: 'Delete Universe',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        try {
          setLoading(true);
          await gitFederationService.deleteUniverse(slug);
          setSyncStatus({ type: 'info', message: `Universe "${name}" deleted` });
          await refreshState();
        } catch (err) {
          gfError('[GitNativeFederation] Delete failed:', err);
          setError(`Failed to delete universe: ${err.message}`);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleSetPrimarySlot = async (slug, slot) => {
    try {
      setLoading(true);
      gfLog('[GitNativeFederation] Requesting primary storage change:', {
        slug,
        slotType: slot?.type,
        storage: slot
      });
      await gitFederationService.setPrimaryStorage(slug, slot.type);
      setSyncStatus({ type: 'success', message: `${STORAGE_LABELS[slot.type]} promoted to primary` });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Promote failed:', err);
      setError(`Failed to set primary storage: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAttachRepo = (slug) => {
    setRepositoryIntent('attach');
    setRepositoryTargetSlug(slug);
    setShowRepositoryManager(true);
  };

  const handleRepositorySelect = async (repo) => {
    if (!repo) {
      setRepositoryIntent(null);
      setRepositoryTargetSlug(null);
      setShowRepositoryManager(false);
      return;
    }

    if (repositoryIntent === 'import') {
      await handleImportFromRepository(repo);
      return;
    }

    if (repositoryIntent === 'attach' && repositoryTargetSlug) {
      await handleAttachRepoToUniverse(repo, repositoryTargetSlug);
      return;
    }

    if (repositoryTargetSlug) {
      await handleAttachRepoToUniverse(repo, repositoryTargetSlug);
      return;
    }

    // Fallback: close the modal if no intent/target was specified
    setRepositoryIntent(null);
    setRepositoryTargetSlug(null);
    setShowRepositoryManager(false);
  };

  const handleImportFromRepository = async (repo) => {
    const owner = repo.owner?.login || repo.owner?.name || repo.owner || repo.full_name?.split('/')[0];
    const repoName = repo.name || repo.full_name?.split('/').pop();

    if (!owner || !repoName) {
      setError('Selected repository is missing owner/name metadata.');
      setRepositoryIntent(null);
      setShowRepositoryManager(false);
      return;
    }

    try {
      setLoading(true);
      setShowRepositoryManager(false);
      setRepositoryTargetSlug(null);

      const repoKey = `${owner}/${repoName}`;
      const alreadyManaged = managedRepositories.some(r =>
        `${r.owner?.login || r.owner}/${r.name}` === repoKey
      );

      if (!alreadyManaged) {
        const newList = [...managedRepositories, repo];
        setManagedRepositories(newList);
        localStorage.setItem(getStorageKey('redstring-managed-repositories'), JSON.stringify(newList));
        gfLog(`[GitNativeFederation] Auto-added ${repoKey} to managed repositories for import`);
      }

      gfLog(`[GitNativeFederation] Import discovery for ${owner}/${repoName}`);
      const discovered = await gitFederationService.discoverUniverses({
        user: owner,
        repo: repoName,
        authMethod: dataAuthMethod || 'oauth'
      });

      if (!Array.isArray(discovered) || discovered.length === 0) {
        // Offer to create a new universe file in this repo
        setConfirmDialog({
          title: 'No Universe File Found',
          message: `No .redstring files exist in ${owner}/${repoName}. Create a new universe file in this repository?`,
          variant: 'default',
          confirmLabel: 'Create Universe File',
          cancelLabel: 'Cancel',
          inputField: {
            placeholder: 'Universe name',
            defaultValue: 'My Universe',
            label: 'Universe Name'
          },
          onConfirm: async (universeName) => {
            try {
              setLoading(true);
              // Create a new universe
              const creation = await gitFederationService.createUniverse(universeName, {
                enableGit: true,
                enableLocal: !deviceInfo.gitOnlyMode
              });
              const createdSlug = creation?.createdUniverse?.slug;
              const slug = createdSlug || (creation?.universes || []).find(u => u.name === (creation?.createdUniverse?.name || universeName))?.slug;
              if (!slug) throw new Error('Could not determine newly created universe slug');

              // Attach repo to this universe and initialize
              await gitFederationService.attachGitRepository(slug, {
                user: owner,
                repo: repoName,
                authMethod: dataAuthMethod || 'oauth',
                universeFolder: slug,
                universeFile: `${slug}.redstring`
              });

              try {
                await gitFederationService.forceSave(slug, (hasOAuth || hasApp) ? undefined : { skipGit: true });
              } catch (e) {
                gfWarn('[GitNativeFederation] Initial save after creating repo file failed:', e);
              }

              // Set Source of Truth to Git by default in this creation flow
              try {
                await gitFederationService.setPrimaryStorage(slug, STORAGE_TYPES.GIT);
              } catch (e) {
                gfWarn('[GitNativeFederation] Failed to set Git as primary after creating repo file:', e);
              }

              setSyncStatus({ type: 'success', message: `Created universe in @${owner}/${repoName}` });
              await refreshState();
            } catch (createErr) {
              gfError('[GitNativeFederation] Create universe file in repo failed:', createErr);
              setError(`Failed to create universe in repo: ${createErr.message}`);
            } finally {
              setLoading(false);
            }
          }
        });
        return;
      }

      setPendingRepoAttachment({
        repo,
        owner,
        repoName,
        mode: 'import'
      });
      setDiscoveredUniverseFiles(discovered);
      setShowUniverseFileSelector(true);
    } catch (err) {
      gfError('[GitNativeFederation] Import discovery failed:', err);
      setError(`Failed to discover universes: ${err.message}`);
    } finally {
      setLoading(false);
      setRepositoryIntent(null);
    }
  };

  const handleAttachRepoToUniverse = async (repo, targetSlug) => {
    if (!targetSlug) {
      setRepositoryTargetSlug(null);
      setRepositoryIntent(null);
      setShowRepositoryManager(false);
      return;
    }

    const owner = repo.owner?.login || repo.owner?.name || repo.owner || repo.full_name?.split('/')[0];
    const repoName = repo.name || repo.full_name?.split('/').pop();

    if (!owner || !repoName) {
      setError('Selected repository is missing owner/name metadata.');
      setRepositoryTargetSlug(null);
      setRepositoryIntent(null);
      setShowRepositoryManager(false);
      return;
    }

    try {
      setShowRepositoryManager(false);
      setLoading(true);

      const repoKey = `${owner}/${repoName}`;
      const alreadyManaged = managedRepositories.some(r =>
        `${r.owner?.login || r.owner}/${r.name}` === repoKey
      );

      if (!alreadyManaged) {
        const newList = [...managedRepositories, repo];
        setManagedRepositories(newList);
        localStorage.setItem(getStorageKey('redstring-managed-repositories'), JSON.stringify(newList));
        gfLog(`[GitNativeFederation] Auto-added ${repoKey} to managed repositories`);
      }

      gfLog(`[GitNativeFederation] Discovering universe files in ${repoKey} for attach...`);
      const discovered = await gitFederationService.discoverUniverses({
        user: owner,
        repo: repoName,
        authMethod: dataAuthMethod || 'oauth'
      });

      if (Array.isArray(discovered) && discovered.length > 0) {
        setPendingRepoAttachment({
          repo,
          owner,
          repoName,
          universeSlug: targetSlug,
          mode: 'attach'
        });
        setDiscoveredUniverseFiles(discovered);
        setShowUniverseFileSelector(true);
        return;
      }

      await handleAttachRepoCreateNew(owner, repoName, repo, targetSlug);
    } catch (err) {
      gfError('[GitNativeFederation] Repository selection failed:', err);
      setError(`Failed to process repository: ${err.message}`);
      setShowRepositoryManager(false);
    } finally {
      setLoading(false);
      setRepositoryIntent(null);
    }
  };

  const handleAttachRepoCreateNew = async (owner, repoName, repo, targetSlug = repositoryTargetSlug) => {
    try {
      setLoading(true);

      await gitFederationService.attachGitRepository(targetSlug, {
        user: owner,
        repo: repoName,
        authMethod: dataAuthMethod || 'oauth',
        universeFolder: targetSlug,
        universeFile: `${targetSlug}.redstring`
      });

      // Initialize the repository with current universe data
      gfLog(`[GitNativeFederation] Initializing repository with universe data for ${targetSlug}`);
      const hasGitAuth = hasOAuth || hasApp;

      try {
        await gitFederationService.forceSave(targetSlug, hasGitAuth ? undefined : { skipGit: true });
        if (hasGitAuth) {
          setSyncStatus({ type: 'success', message: `Linked @${owner}/${repoName} and initialized with universe data` });
        } else {
          setSyncStatus({
            type: 'info',
            message: `Linked @${owner}/${repoName}. Connect GitHub to sync this universe.`
          });
        }
      } catch (commitErr) {
        gfWarn('[GitNativeFederation] Initial Git save failed:', commitErr);
        setSyncStatus({
          type: 'warning',
          message: `Linked @${owner}/${repoName}, but initial save failed: ${commitErr.message}.`
        });
      }

      // If coming from onboarding/git-only flow, default primary to Git now that a repo is linked
      try {
        const resume = (() => { try { return sessionStorage.getItem('redstring_onboarding_resume') === 'true'; } catch { return false; } })();
        if (resume || deviceInfo.gitOnlyMode) {
          await gitFederationService.setPrimaryStorage(targetSlug, STORAGE_TYPES.GIT);
          try {
            sessionStorage.removeItem('redstring_onboarding_resume');
            sessionStorage.removeItem('redstring_onboarding_step');
          } catch { }
        } else {
          // Otherwise, if both slots are enabled, prompt the user to choose Source of Truth
          const state = await gitFederationService.refreshUniverses();
          const u = state.universes.find((x) => x.slug === targetSlug);
          const raw = u?.raw || {};
          const hasLocal = !!raw.localFile?.enabled;
          const hasRepo = !!(raw.gitRepo?.enabled && raw.gitRepo?.linkedRepo);
          if (hasLocal && hasRepo) {
            setConfirmDialog({
              title: 'Choose Source of Truth',
              message: 'Select the primary storage for this universe. You can change this later.',
              confirmLabel: 'Use Git as Primary',
              cancelLabel: 'Use Local File as Primary',
              variant: 'default',
              onConfirm: async () => {
                try { await gitFederationService.setPrimaryStorage(targetSlug, STORAGE_TYPES.GIT); await refreshState(); } catch (e) { gfWarn('Failed to set git as primary', e); }
              },
              onCancel: async () => {
                try { await gitFederationService.setPrimaryStorage(targetSlug, STORAGE_TYPES.LOCAL); await refreshState(); } catch (e) { gfWarn('Failed to set local as primary', e); }
              }
            });
          }
        }
      } catch (e) {
        gfWarn('[GitNativeFederation] Failed to set or prompt Source of Truth after linking:', e);
      }

      setDiscoveryMap((prev) => {
        const next = { ...prev };
        delete next[`${owner}/${repoName}`];
        return next;
      });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Attach failed:', err);
      setError(`Failed to link repository: ${err.message}`);
    } finally {
      setLoading(false);
      setRepositoryTargetSlug(null);
      setShowRepositoryManager(false);
      setPendingRepoAttachment(null);
      setShowUniverseFileSelector(false);
      setRepositoryIntent(null);
    }
  };

  const handleLoadFromRepositoryFile = async (file) => {
    // Simple handler for loading from an already-discovered repository file
    if (!file) return;

    try {
      setLoading(true);

      // If the file already has a linked universe (slug), load from it
      if (file.slug) {
        gfLog('[GitNativeFederation] Loading from existing universe:', file.slug);
        await universeBackendBridge.reloadUniverse(file.slug);
        await gitFederationService.switchUniverse(file.slug);
        await refreshState();
        setSyncStatus({ type: 'success', message: `Loaded universe "${file.name || file.slug}" from repository` });
        setShowUniverseFileSelector(false);
        return;
      }

      // Otherwise, we need to import it (this shouldn't normally happen with "Load" button)
      gfError('[GitNativeFederation] Cannot load file without slug - use Import instead');
      setError('This file needs to be imported first. Use "Import Copy" instead.');
    } catch (err) {
      gfError('[GitNativeFederation] Load from repository file failed:', err);
      setError(`Failed to load from repository: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUniverseFileSelection = async (selectedFile) => {
    if (!pendingRepoAttachment) return;

    const { owner, repoName, repo, universeSlug, mode } = pendingRepoAttachment;
    const targetSlug = universeSlug || repositoryTargetSlug;

    const resolveCount = (value) => (typeof value === 'number' && !Number.isNaN(value) ? value : 'unknown');
    let preserveSelectionState = false;

    try {
      setLoading(true);

      if (mode === 'import') {
        if (selectedFile === 'CREATE_NEW') {
          setError('Cannot create a new repository file while importing. Use "Add Repository" on an existing universe to push local data.');
          preserveSelectionState = true;
          return;
        }

        setShowUniverseFileSelector(false);

        const resultState = await gitFederationService.linkDiscoveredUniverse(selectedFile, {
          user: owner,
          repo: repoName,
          authMethod: dataAuthMethod || 'oauth'
        });

        const importedName = selectedFile.name || selectedFile.slug || 'Imported universe';
        const importedSlug = resultState?.activeUniverseSlug || selectedFile.slug || selectedFile.name;

        if (importedSlug) {
          try {
            await universeBackendBridge.reloadUniverse(importedSlug);
            // Ensure UI switches to the imported universe
            try {
              await gitFederationService.switchUniverse(importedSlug);
            } catch (switchErr) {
              gfWarn('[GitNativeFederation] Failed to switch to imported universe:', switchErr);
            }
            // Ensure Git is the source of truth for imported universes
            try {
              await gitFederationService.setPrimaryStorage(importedSlug, STORAGE_TYPES.GIT);
            } catch (err) {
              gfWarn('[GitNativeFederation] Failed to set Git as primary after import (modal):', err);
            }
          } catch (err) {
            gfWarn('[GitNativeFederation] Initial universe reload failed after import:', err);
          }
        }

        setSyncStatus({ type: 'success', message: `Imported universe "${importedName}" from repository` });
        await refreshState();
        return;
      }

      if (!targetSlug) {
        setError('No universe selected for attachment. Choose a universe before syncing repository files.');
        preserveSelectionState = true;
        return;
      }

      if (selectedFile === 'CREATE_NEW') {
        setShowUniverseFileSelector(false);
        await handleAttachRepoCreateNew(owner, repoName, repo, targetSlug);
        return;
      }

      const localUniverse = serviceState.universes.find(u => u.slug === targetSlug);
      const localName = localUniverse?.name || localUniverse?.slug || targetSlug;
      const remoteName = selectedFile.name || selectedFile.slug || 'Repository universe';
      const localNodeCount = resolveCount(localUniverse?.nodeCount ?? localUniverse?.stats?.nodeCount ?? localUniverse?.metadata?.nodeCount);
      const remoteNodeCount = resolveCount(selectedFile.nodeCount ?? selectedFile.stats?.nodeCount ?? selectedFile.metadata?.nodeCount);

      // Helper function to complete the sync after confirmation
      const completeSyncAfterOverwrite = async () => {
        gfLog('[GitNativeFederation] Replace Local Data confirmed. Proceeding to sync from repository...', {
          targetSlug,
          repo: `${owner}/${repoName}`,
          repoFile: selectedFile?.slug || selectedFile?.name || selectedFile?.path
        });
        const repoFileSlug = selectedFile.slug || selectedFile.name;

        // Check if name mismatch and show rename dialog
        if (localUniverse && repoFileSlug && localUniverse.slug !== repoFileSlug) {
          setConfirmDialog({
            title: 'Name Mismatch Resolution',
            message: `The repository file uses the name "${remoteName}" (slug: ${repoFileSlug}).`,
            details: `Choose "Rename to Match" to rename your local universe to match the repository before syncing.\n\nChoose "Keep Local Name" to keep your current local name; the repository will adopt your local name on next save.`,
            variant: 'warning',
            confirmLabel: 'Rename to Match',
            cancelLabel: 'Keep Local Name',
            onConfirm: async () => {
              gfLog(`[GitNativeFederation] Renaming local universe to match repo: ${repoFileSlug}`);
              setSyncStatus({ type: 'info', message: `Renaming local universe to "${remoteName}" before syncing...` });
              await finalizeLinkDiscoveredUniverse();
            },
            onCancel: async () => {
              gfLog(`[GitNativeFederation] Keeping local universe name while syncing repo file ${repoFileSlug}`);
              setSyncStatus({ type: 'info', message: `Keeping local name "${localName}" while syncing repository file` });
              await finalizeLinkDiscoveredUniverse();
            }
          });
          preserveSelectionState = true;
          return;
        }

        await finalizeLinkDiscoveredUniverse();
      };

      const finalizeLinkDiscoveredUniverse = async () => {
        try {
          setShowUniverseFileSelector(false);

          await gitFederationService.linkDiscoveredUniverse(selectedFile, {
            user: owner,
            repo: repoName,
            authMethod: dataAuthMethod || 'oauth'
          });

          // After linking, proactively reload the target universe if it's active
          try {
            if (targetSlug && serviceState.activeUniverseSlug === targetSlug) {
              await universeBackendBridge.reloadUniverse(targetSlug);
            }
          } catch (reloadErr) {
            gfWarn('[GitNativeFederation] Universe reload after linking failed:', reloadErr);
          }

          // Ensure Git is the source of truth so sync engine runs and status reflects connected
          try {
            await gitFederationService.setPrimaryStorage(targetSlug, STORAGE_TYPES.GIT);
          } catch (err) {
            gfWarn('[GitNativeFederation] Failed to set Git as primary after linking:', err);
          }

          setSyncStatus({ type: 'success', message: `Synced repository data from "${remoteName}"` });
          await refreshState();
        } catch (err) {
          gfError('[GitNativeFederation] Link discovered universe failed:', err);
          setError(`Failed to sync universe: ${err.message}`);
        }
      };

      // Show data overwrite warning
      setConfirmDialog({
        title: 'Replace Local Data',
        message: `Syncing with "${remoteName}" will replace your local data for "${localName}".`,
        details: `Local data: ${localName} (${localNodeCount} nodes)\nRemote data: ${remoteName} (${remoteNodeCount} nodes)`,
        variant: 'danger',
        confirmLabel: 'Replace My Data',
        cancelLabel: 'Cancel',
        onConfirm: completeSyncAfterOverwrite
      });
      preserveSelectionState = true;
      return;
    } catch (err) {
      gfError('[GitNativeFederation] Universe file selection failed:', err);
      setError(`Failed to process universe file: ${err.message}`);
    } finally {
      setLoading(false);
      if (!preserveSelectionState) {
        setRepositoryTargetSlug(null);
        setRepositoryIntent(null);
        setPendingRepoAttachment(null);
        setDiscoveredUniverseFiles([]);
      }
    }
  };

  const handleSaveToSelectedRepositoryFile = async (selectedFile) => {
    if (!pendingRepoAttachment) return;

    const { owner, repoName, universeSlug } = pendingRepoAttachment;
    const targetSlug = universeSlug || repositoryTargetSlug;

    if (!targetSlug) {
      setError('No universe selected for attachment. Choose a universe before saving to repository.');
      return;
    }

    const localUniverse = serviceState.universes.find(u => u.slug === targetSlug);
    const localName = localUniverse?.name || localUniverse?.slug || targetSlug;
    const repoNameLabel = selectedFile?.name || selectedFile?.slug || 'Repository universe';

    setConfirmDialog({
      title: 'Overwrite Repository Data',
      message: `Save your current "${localName}" to "${repoNameLabel}" in ${owner}/${repoName}?`,
      details: 'This will overwrite the data in the selected repository file.',
      variant: 'danger',
      confirmLabel: 'Overwrite in Repo',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        try {
          setLoading(true);
          setShowUniverseFileSelector(false);
          const repo = { user: owner, repo: repoName };
          const repoKey = `${owner}/${repoName}`;
          await continueAttachFlow(targetSlug, selectedFile, repo, repoKey);
        } catch (err) {
          gfError('[GitNativeFederation] Save to selected repo file failed:', err);
          setError(`Failed to save to repository: ${err.message}`);
        } finally {
          setLoading(false);
          setPendingRepoAttachment(null);
          setDiscoveredUniverseFiles([]);
          setRepositoryIntent(null);
        }
      }
    });
  };

  const handleDetachRepo = async (universe, source) => {
    try {
      setLoading(true);
      await gitFederationService.detachGitRepository(universe.slug, {
        user: source.user,
        repo: source.repo
      });
      setSyncStatus({ type: 'info', message: `Detached @${source.user}/${source.repo}` });
      setDiscoveryMap((prev) => {
        const next = { ...prev };
        delete next[`${source.user}/${source.repo}`];
        return next;
      });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Detach failed:', err);
      setError(`Failed to detach repository: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDiscover = async (source) => {
    const key = `${source.user}/${source.repo}`;
    setDiscoveryMap((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), loading: true, error: null }
    }));

    try {
      const results = await gitFederationService.discoverUniverses({
        user: source.user,
        repo: source.repo,
        authMethod: dataAuthMethod || 'oauth'
      });
      setDiscoveryMap((prev) => ({
        ...prev,
        [key]: { items: results, loading: false, error: null }
      }));
    } catch (err) {
      gfError('[GitNativeFederation] Discovery failed:', err);
      setDiscoveryMap((prev) => ({
        ...prev,
        [key]: { items: [], loading: false, error: err.message }
      }));
      setError(`Discovery failed: ${err.message}`);
    }
  };

  const handleLinkDiscovered = async (discovered, repo) => {
    // Show universe linking modal to let user choose existing universe or create new one
    setPendingUniverseLink({ discovered, repo });
    setShowUniverseLinking(true);
    setShowRepositoryManager(false);
  };

  // Helper function to complete the ATTACH flow (save to repo)
  const continueAttachFlow = async (targetSlug, discovered, repo, repoKey) => {
    try {
      setLoading(true);

      // Add repo to managed list if not already there
      const alreadyManaged = managedRepositories.some(r =>
        `${r.owner?.login || r.owner}/${r.name}` === repoKey
      );

      if (!alreadyManaged) {
        const repoObject = {
          name: repo.repo,
          owner: { login: repo.user },
          full_name: `${repo.user}/${repo.repo}`,
          html_url: `https://github.com/${repo.user}/${repo.repo}`,
          private: false,
          id: `discovered-${repo.user}-${repo.repo}`
        };

        const newList = [...managedRepositories, repoObject];
        setManagedRepositories(newList);
        localStorage.setItem(getStorageKey('redstring-managed-repositories'), JSON.stringify(newList));
        gfLog(`[GitNativeFederation] Auto-added ${repoKey} to managed repositories`);
      }

      // Attach the Git repository
      const resolvePathParts = (universePath, fileName) => {
        const parts = (universePath || '').split('/').filter(Boolean);
        if (parts.length >= 3) {
          return { folder: parts[parts.length - 2], file: parts[parts.length - 1] };
        }
        if (fileName) {
          return {
            folder: (parts[parts.length - 1] || '').replace(/\.redstring$/i, '') || targetSlug,
            file: fileName
          };
        }
        return { folder: targetSlug, file: `${targetSlug}.redstring` };
      };

      const inferredPath = discovered.path || (discovered.location && discovered.fileName ? `${discovered.location}/${discovered.fileName}` : null);
      const inferredFile = discovered.fileName || (inferredPath ? inferredPath.split('/').pop() : null);
      const { folder: resolvedFolder, file: resolvedFile } = resolvePathParts(inferredPath, inferredFile);

      await gitFederationService.attachGitRepository(targetSlug, {
        user: repo.user,
        repo: repo.repo,
        authMethod: dataAuthMethod || 'oauth',
        universeFolder: resolvedFolder || targetSlug,
        universeFile: resolvedFile || `${targetSlug}.redstring`
      });

      gfLog(`[GitNativeFederation] Linked repository, now saving universe data to repo...`);
      await gitFederationService.forceSave(targetSlug);

      // Set source of truth
      const state = await gitFederationService.refreshUniverses();
      const u = state.universes.find((x) => x.slug === targetSlug);
      const raw = u?.raw || {};
      const hasLocal = !!raw.localFile?.enabled;
      const hasRepo = !!(raw.gitRepo?.enabled && raw.gitRepo?.linkedRepo);

      if (hasRepo && !hasLocal) {
        await gitFederationService.setPrimaryStorage(targetSlug, STORAGE_TYPES.GIT);
        gfLog(`[GitNativeFederation] Set Git as source of truth: ${targetSlug}`);
      } else if (hasLocal && hasRepo) {
        setConfirmDialog({
          title: 'Choose Source of Truth',
          message: 'Select the primary storage for this universe.',
          confirmLabel: 'Use Git as Primary',
          cancelLabel: 'Use Local File as Primary',
          variant: 'default',
          onConfirm: async () => { try { await gitFederationService.setPrimaryStorage(targetSlug, STORAGE_TYPES.GIT); await refreshState(); } catch (e) { gfWarn('Failed to set git as primary', e); } },
          onCancel: async () => { try { await gitFederationService.setPrimaryStorage(targetSlug, STORAGE_TYPES.LOCAL); await refreshState(); } catch (e) { gfWarn('Failed to set local as primary', e); } }
        });
      }

      setSyncStatus({ type: 'success', message: `Saved to repository` });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Attach flow failed:', err);
      setError(`Failed to save to repository: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to switch to IMPORT flow (load from repo)
  const switchToImportFlow = async (targetSlug, discovered, repo, repoKey) => {
    try {
      setLoading(true);

      // Add repo to managed list
      const alreadyManaged = managedRepositories.some(r =>
        `${r.owner?.login || r.owner}/${r.name}` === repoKey
      );

      if (!alreadyManaged) {
        const repoObject = {
          name: repo.repo,
          owner: { login: repo.user },
          full_name: `${repo.user}/${repo.repo}`,
          html_url: `https://github.com/${repo.user}/${repo.repo}`,
          id: `discovered-${repo.user}-${repo.repo}`
        };

        const newList = [...managedRepositories, repoObject];
        setManagedRepositories(newList);
        localStorage.setItem(getStorageKey('redstring-managed-repositories'), JSON.stringify(newList));
        gfLog(`[GitNativeFederation] Auto-added ${repoKey} to managed repositories for import`);
      }

      // Link repo config
      const resolvePathParts = (universePath, fileName) => {
        const parts = (universePath || '').split('/').filter(Boolean);
        if (parts.length >= 3) {
          return { folder: parts[parts.length - 2], file: parts[parts.length - 1] };
        }
        if (fileName) {
          return {
            folder: (parts[parts.length - 1] || '').replace(/\.redstring$/i, '') || targetSlug,
            file: fileName
          };
        }
        return { folder: targetSlug, file: `${targetSlug}.redstring` };
      };

      const inferredPath = discovered.path || (discovered.location && discovered.fileName ? `${discovered.location}/${discovered.fileName}` : null);
      const inferredFile = discovered.fileName || (inferredPath ? inferredPath.split('/').pop() : null);
      const { folder: resolvedFolder, file: resolvedFile } = resolvePathParts(inferredPath, inferredFile);

      await gitFederationService.attachGitRepository(targetSlug, {
        user: repo.user,
        repo: repo.repo,
        authMethod: dataAuthMethod || 'oauth',
        universeFolder: resolvedFolder || targetSlug,
        universeFile: resolvedFile || `${targetSlug}.redstring`
      });

      gfLog(`[GitNativeFederation] Linked repo config, now loading data from repository...`);

      // Load data from repository
      await universeBackendBridge.reloadUniverse(targetSlug);
      gfLog(`[GitNativeFederation] Successfully loaded data from repository`);

      // Set Git as source of truth
      await gitFederationService.setPrimaryStorage(targetSlug, STORAGE_TYPES.GIT);
      gfLog(`[GitNativeFederation] Set Git as source of truth: ${targetSlug}`);

      setSyncStatus({ type: 'success', message: `Loaded universe from repository` });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Import flow failed:', err);
      setError(`Failed to load from repository: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUniverseLinkingSelectExisting = async (targetSlug) => {
    if (!pendingUniverseLink) return;

    const { discovered, repo } = pendingUniverseLink;
    const repoKey = `${repo.user}/${repo.repo}`;

    try {
      setLoading(true);
      setShowUniverseLinking(false);

      // Check if the universe is empty - if so, IMPORT (load data from repo)
      const universe = serviceState.universes.find(u => u.slug === targetSlug);
      const nodeCount = universe?.nodeCount || universe?.raw?.nodeCount || 0;
      const isEmpty = nodeCount === 0;

      if (isEmpty) {
        // Universe is empty - use IMPORT flow (load data from repo)
        gfLog(`[GitNativeFederation] Universe is empty (${nodeCount} nodes), using IMPORT flow to load data from repo`);

        // Add repo to managed list
        const alreadyManaged = managedRepositories.some(r =>
          `${r.owner?.login || r.owner}/${r.name}` === repoKey
        );

        if (!alreadyManaged) {
          const repoObject = {
            name: repo.repo,
            owner: { login: repo.user },
            full_name: `${repo.user}/${repo.repo}`,
            html_url: `https://github.com/${repo.user}/${repo.repo}`,
            id: `discovered-${repo.user}-${repo.repo}`
          };

          const newList = [...managedRepositories, repoObject];
          setManagedRepositories(newList);
          localStorage.setItem(getStorageKey('redstring-managed-repositories'), JSON.stringify(newList));
          gfLog(`[GitNativeFederation] Auto-added ${repoKey} to managed repositories for import`);
        }

        // Step 1: Link the repo config WITHOUT saving (to avoid overwriting repo data)
        const resolvePathParts = (universePath, fileName) => {
          const parts = (universePath || '').split('/').filter(Boolean);
          if (parts.length >= 3) {
            return {
              folder: parts[parts.length - 2],
              file: parts[parts.length - 1]
            };
          }
          if (fileName) {
            return {
              folder: (parts[parts.length - 1] || '')
                .replace(/\.redstring$/i, '') || targetSlug,
              file: fileName
            };
          }
          return {
            folder: targetSlug,
            file: `${targetSlug}.redstring`
          };
        };

        const inferredPath = discovered.path || (discovered.location && discovered.fileName
          ? `${discovered.location}/${discovered.fileName}`
          : null);
        const inferredFile = discovered.fileName || (inferredPath ? inferredPath.split('/').pop() : null);
        const { folder: resolvedFolder, file: resolvedFile } = resolvePathParts(inferredPath, inferredFile);

        // Attach Git repo config (but don't force save yet - we'll load first)
        await gitFederationService.attachGitRepository(targetSlug, {
          user: repo.user,
          repo: repo.repo,
          authMethod: dataAuthMethod || 'oauth',
          universeFolder: resolvedFolder || targetSlug,
          universeFile: resolvedFile || `${targetSlug}.redstring`
        });

        gfLog(`[GitNativeFederation] Linked repo config, now loading data from repository...`);

        // Step 2: Load the data from repository (don't overwrite it!)
        try {
          await universeBackendBridge.reloadUniverse(targetSlug);
          gfLog(`[GitNativeFederation] Successfully loaded data from repository`);
        } catch (err) {
          gfWarn('[GitNativeFederation] Failed to load data from repository:', err);
          throw new Error(`Failed to load data from repository: ${err.message}`);
        }

        // Step 3: Set Git as source of truth
        try {
          await gitFederationService.setPrimaryStorage(targetSlug, STORAGE_TYPES.GIT);
          gfLog(`[GitNativeFederation] Set Git as source of truth for imported universe: ${targetSlug}`);
        } catch (err) {
          gfWarn('[GitNativeFederation] Failed to set Git as source of truth:', err);
        }

        setSyncStatus({ type: 'success', message: `Loaded universe from repository` });
        await refreshState();
        setPendingUniverseLink(null);
        return;
      }

      // Universe has data - use ATTACH flow (save current data to repo)
      gfLog(`[GitNativeFederation] Universe has ${nodeCount} nodes, using ATTACH flow to save to repo`);

      // Check if the discovered repo file also has data
      const repoNodeCount = discovered.nodeCount || discovered.stats?.nodeCount || discovered.metadata?.nodeCount || 0;
      const repoHasData = repoNodeCount > 0;

      if (repoHasData) {
        // Both have data - ask user what to do
        gfLog(`[GitNativeFederation] Repository also has ${repoNodeCount} nodes - asking user for direction`);

        setConfirmDialog({
          title: 'Both Have Data',
          message: `Your universe has ${nodeCount} nodes and the repository has ${repoNodeCount} nodes.`,
          details: `• Save to Repository: Your current ${nodeCount} nodes will overwrite the repository's ${repoNodeCount} nodes.\n\n• Load from Repository: The repository's ${repoNodeCount} nodes will replace your current ${nodeCount} nodes.`,
          confirmLabel: 'Save to Repository',
          cancelLabel: 'Load from Repository',
          variant: 'warning',
          onConfirm: async () => {
            // User wants to save their data to repo (overwrite repo)
            await continueAttachFlow(targetSlug, discovered, repo, repoKey);
          },
          onCancel: async () => {
            // User wants to load from repo (import flow)
            await switchToImportFlow(targetSlug, discovered, repo, repoKey);
          }
        });
        setPendingUniverseLink(null);
        return;
      }

      // Repo is empty or new - safe to attach and save
      await continueAttachFlow(targetSlug, discovered, repo, repoKey);
      setPendingUniverseLink(null);
    } catch (err) {
      gfError('[GitNativeFederation] Link to existing universe failed:', err);
      setError(`Failed to link repository: ${err.message}`);
      setLoading(false);
      setPendingUniverseLink(null);
    }
  };

  const handleUniverseLinkingCreateNew = async (universeName) => {
    if (!pendingUniverseLink) return;

    const { discovered, repo } = pendingUniverseLink;
    const repoKey = `${repo.user}/${repo.repo}`;

    try {
      setLoading(true);
      setShowUniverseLinking(false);

      // Add repo to managed list if not already there
      const alreadyManaged = managedRepositories.some(r =>
        `${r.owner?.login || r.owner}/${r.name}` === repoKey
      );

      if (!alreadyManaged) {
        const repoObject = {
          name: repo.repo,
          owner: { login: repo.user },
          full_name: `${repo.user}/${repo.repo}`,
          html_url: `https://github.com/${repo.user}/${repo.repo}`,
          private: false,
          id: `discovered-${repo.user}-${repo.repo}`
        };

        const newList = [...managedRepositories, repoObject];
        setManagedRepositories(newList);
        localStorage.setItem(getStorageKey('redstring-managed-repositories'), JSON.stringify(newList));
        gfLog(`[GitNativeFederation] Auto-added ${repoKey} to managed repositories (from discovery)`);
      }

      // Link the discovered universe with the custom name
      await gitFederationService.linkDiscoveredUniverse(discovered, {
        user: repo.user,
        repo: repo.repo,
        authMethod: dataAuthMethod || 'oauth',
        customName: universeName
      });

      const targetSlug = discovered.slug || discovered.name;
      if (targetSlug) {
        gfLog(`[GitNativeFederation] Initializing repository with universe data for ${targetSlug}`);
        await gitFederationService.forceSave(targetSlug);
      }

      setSyncStatus({ type: 'success', message: `Created universe "${universeName}" and linked to repository` });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Create and link universe failed:', err);
      setError(`Failed to create universe: ${err.message}`);
    } finally {
      setLoading(false);
      setPendingUniverseLink(null);
    }
  };

  const handleImportDiscovered = async (discovered, repo) => {
    const repoKey = `${repo.user}/${repo.repo}`;

    try {
      setLoading(true);
      setRepositoryIntent(null);
      setShowRepositoryManager(false);

      const alreadyManaged = managedRepositories.some(r =>
        `${r.owner?.login || r.owner}/${r.name}` === repoKey
      );

      if (!alreadyManaged) {
        const repoObject = {
          name: repo.repo,
          owner: { login: repo.user },
          full_name: `${repo.user}/${repo.repo}`,
          html_url: `https://github.com/${repo.user}/${repo.repo}`,
          id: `discovered-${repo.user}-${repo.repo}`
        };

        const newList = [...managedRepositories, repoObject];
        setManagedRepositories(newList);
        localStorage.setItem(getStorageKey('redstring-managed-repositories'), JSON.stringify(newList));
        gfLog(`[GitNativeFederation] Auto-added ${repoKey} to managed repositories for import`);
      }

      const resultState = await gitFederationService.linkDiscoveredUniverse(discovered, {
        user: repo.user,
        repo: repo.repo,
        authMethod: dataAuthMethod || 'oauth'
      });

      const importedName = discovered.name || discovered.slug || 'Imported universe';
      const importedSlug = resultState?.activeUniverseSlug || discovered.slug || discovered.name;

      if (importedSlug) {
        try {
          await universeBackendBridge.reloadUniverse(importedSlug);
        } catch (err) {
          gfWarn('[GitNativeFederation] Initial reload after import failed:', err);
        }

        // Set Git as the source of truth for the imported universe
        try {
          await gitFederationService.setPrimaryStorage(importedSlug, STORAGE_TYPES.GIT);
          gfLog(`[GitNativeFederation] Set Git as source of truth for imported universe: ${importedSlug}`);
        } catch (err) {
          gfWarn('[GitNativeFederation] Failed to set Git as source of truth:', err);
        }

        // Ensure UI switches to the imported universe
        try {
          await gitFederationService.switchUniverse(importedSlug);
        } catch (switchErr) {
          gfWarn('[GitNativeFederation] Failed to switch to imported universe:', switchErr);
        }
      }

      setSyncStatus({ type: 'success', message: `Imported universe "${importedName}" from repository` });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Import discovered failed:', err);
      setError(`Failed to import universe: ${err.message}`);
    } finally {
      setLoading(false);
      setPendingRepoAttachment(null);
      setDiscoveredUniverseFiles([]);
      setShowUniverseFileSelector(false);
    }
  };

  const handleAddToManagedList = (repo) => {
    const repoKey = `${repo.owner?.login || repo.owner}/${repo.name}`;
    const alreadyAdded = managedRepositories.some(r =>
      `${r.owner?.login || r.owner}/${r.name}` === repoKey
    );

    if (alreadyAdded) {
      setSyncStatus({ type: 'warning', message: `${repoKey} is already in your list` });
      return;
    }

    const newList = [...managedRepositories, repo];
    setManagedRepositories(newList);
    try {
      localStorage.setItem(getStorageKey('redstring_managed_repos'), JSON.stringify(newList));
      setSyncStatus({ type: 'success', message: `Added ${repoKey} to your repositories` });
    } catch (err) {
      gfError('[GitNativeFederation] Failed to save managed repos:', err);
    }
  };


  const handleSetMainRepository = (repo) => {
    const repoKey = `${repo.owner?.login || repo.owner}/${repo.name}`;
    const updatedList = managedRepositories.map(r => {
      const currentKey = `${r.owner?.login || r.owner}/${r.name}`;
      return { ...r, isMain: currentKey === repoKey };
    });

    setManagedRepositories(updatedList);
    localStorage.setItem(getStorageKey('redstring-managed-repositories'), JSON.stringify(updatedList));

    setSyncStatus({
      type: 'success',
      message: `Set ${repoKey} as main repository`
    });
  };

  const handleRemoveRepoSource = async (universeSlug, source) => {
    try {
      setLoading(true);
      await gitFederationService.detachGitRepository(universeSlug, {
        user: source.user,
        repo: source.repo
      });
      setSyncStatus({ type: 'success', message: `Removed @${source.user}/${source.repo} from ${universeSlug}` });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Remove source failed:', err);
      setError(`Failed to remove repository source: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEditRepoSource = (universeSlug, source) => {
    // Set the universe as target and show repository manager for swapping
    setRepositoryTargetSlug(universeSlug);
    setShowRepositoryManager(true);
    setSyncStatus({ type: 'info', message: `Select new repository to replace @${source.user}/${source.repo}` });
  };

  const handleSetMainRepoSource = async (universeSlug, source) => {
    // This would require backend support to reorder sources
    setSyncStatus({ type: 'info', message: `Main source feature coming soon` });
  };

  const handleSaveRepoSource = async (universeSlug, source) => {
    try {
      const universe = serviceState.universes.find(u => u.slug === universeSlug);
      const isGitPrimary = (universe?.sourceOfTruth || universe?.storage?.primary?.type) === 'git';

      if (!isGitPrimary) {
        setConfirmDialog({
          title: 'Save to Git (Non-Primary)',
          message: 'Your source of truth is Local. Saving to Git may overwrite repository data.',
          details: 'Proceed only if you intend to push your current local state to the repository.',
          variant: 'warning',
          confirmLabel: 'Save to Git',
          cancelLabel: 'Cancel',
          onConfirm: async () => {
            try {
              setLoading(true);
              await gitFederationService.forceSave(universeSlug);
              setSyncStatus({ type: 'success', message: `Saved to Git for ${universeSlug}` });
              await refreshState();
            } catch (err) {
              gfError('[GitNativeFederation] Manual save to Git failed:', err);
              setError(`Failed to save: ${err.message}`);
            } finally {
              setLoading(false);
            }
          }
        });
        return;
      }

      setLoading(true);
      await gitFederationService.forceSave(universeSlug);
      setSyncStatus({ type: 'success', message: `Manual save triggered for ${universeSlug}` });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Manual save failed:', err);
      setError(`Failed to save: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSetPrimarySource = async (universeSlug, sourceType) => {
    try {
      setLoading(true);

      // Re-validate current state to avoid stale UI actions
      const state = await gitFederationService.refreshUniverses();
      const universe = state.universes.find(u => u.slug === universeSlug);
      if (!universe) throw new Error(`Universe not found: ${universeSlug}`);

      if (universe.sourceOfTruth === sourceType) {
        setLoading(false);
        return;
      }

      const isGitTarget = sourceType === 'git';
      const hasGitLink = !!(universe.raw?.gitRepo?.linkedRepo);
      const hasLocalSlot = !!(universe.raw?.localFile?.enabled);
      const hasLocalHandle = !!(universe.raw?.localFile?.hadFileHandle);

      if (isGitTarget && !hasGitLink) {
        setSyncStatus({ type: 'info', message: 'Link a repository first to make Git primary' });
        setRepositoryTargetSlug(universeSlug);
        setShowRepositoryManager(true);
        return;
      }

      if (!isGitTarget && !hasLocalSlot) {
        setSyncStatus({ type: 'info', message: 'Create or link a local file first to make Local primary' });
        handleLinkLocalFile(universeSlug);
        return;
      }

      const confirmDetails = isGitTarget
        ? 'The current universe state will be overwritten by the latest Git data during the next sync.'
        : hasLocalHandle
          ? 'Future saves will target your linked local file. Unsaved Git changes will remain as backups.'
          : 'Future saves will target the in-memory local slot. Link a persistent file to enable auto-save.';

      const nextLabel = isGitTarget ? 'Git repository' : 'Local file';

      setConfirmDialog({
        title: `Set ${nextLabel} as Source of Truth`,
        message: `Switching the source of truth to ${nextLabel.toLowerCase()} will change where saves and loads come from.`,
        details: confirmDetails,
        variant: 'warning',
        confirmLabel: `Switch to ${nextLabel}`,
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          try {
            setLoading(true);
            await universeBackend.setSourceOfTruth(universeSlug, sourceType);
            setSyncStatus({ type: 'success', message: `Primary storage set to ${nextLabel.toLowerCase()}` });
            await refreshState();

            // If switching to Local as primary without a persistent file handle, prompt user to link a file now
            if (!isGitTarget && !hasLocalHandle) {
              try {
                await handleLinkLocalFile(universeSlug);
              } catch (_) {
                // user may cancel; leave as-is
              }
            }
          } catch (err) {
            gfError('[GitNativeFederation] Set primary source failed:', err);
            setError(`Failed to set primary source: ${err?.message || err}`);
          } finally {
            setLoading(false);
          }
        }
      });
    } catch (err) {
      gfError('[GitNativeFederation] Set primary source failed:', err);
      setError(`Failed to set primary source: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFromManagedList = async (repo) => {
    const repoKey = `${repo.owner?.login || repo.owner}/${repo.name}`;

    // Check if this repo is linked to any universes and warn the user
    const linkedUniverses = serviceState.universes.filter(universe =>
      universe.raw?.sources?.some(source =>
        source.type === 'github' &&
        source.user === (repo.owner?.login || repo.owner) &&
        source.repo === repo.name
      )
    );

    const performRemoval = () => {
      const newList = managedRepositories.filter(r =>
        `${r.owner?.login || r.owner}/${r.name}` !== repoKey
      );

      setManagedRepositories(newList);
      try {
        localStorage.setItem(getStorageKey('redstring_managed_repos'), JSON.stringify(newList));
        setSyncStatus({
          type: 'success',
          message: linkedUniverses.length > 0 ?
            `Removed ${repoKey} (still linked to ${linkedUniverses.length} universe(s))` :
            `Removed ${repoKey}`
        });
      } catch (err) {
        gfError('[GitNativeFederation] Failed to save managed repos:', err);
      }
    };

    if (linkedUniverses.length > 0) {
      const universeNames = linkedUniverses.map(u => u.name).join(', ');
      setConfirmDialog({
        title: 'Remove Repository',
        message: `This repository is linked to universe(s): ${universeNames}`,
        details: 'Removing it from your list won\'t detach it from these universes. You may need to manually detach it from those universes.',
        variant: 'warning',
        confirmLabel: 'Remove Anyway',
        cancelLabel: 'Cancel',
        onConfirm: performRemoval
      });
      return;
    }

    performRemoval();
  };

  const gatherExistingLocalMetadata = async (slug, universe, existingHandle, importFromRedstring) => {
    const localInfo = universe?.raw?.localFile || {};
    const displayLabel = localInfo.displayPath || localInfo.lastFilePath || localInfo.path || `${slug}.redstring`;
    const metadata = {
      fileName: displayLabel,
      displayPath: displayLabel,
      nodeCount: null,
      edgeCount: null,
      fileSize: null,
      lastSaved: localInfo.lastSaved || null,
      fileModified: null,
      permission: 'unknown',
      hadHandle: !!existingHandle
    };

    if (existingHandle && typeof existingHandle.queryPermission === 'function') {
      try {
        let permission = await existingHandle.queryPermission({ mode: 'read' });
        if (permission === 'prompt' && typeof existingHandle.requestPermission === 'function') {
          permission = await existingHandle.requestPermission({ mode: 'read' });
        }
        metadata.permission = permission;
        if (permission === 'granted') {
          const existingFile = await existingHandle.getFile();
          metadata.fileSize = existingFile.size;
          metadata.fileModified = existingFile.lastModified;

          if (serviceState.activeUniverseSlug === slug) {
            try {
              const useGraphStore = await loadGraphStore();
              const storeState = useGraphStore.getState();
              const metrics = computeStoreMetrics(storeState);
              metadata.nodeCount = metrics.nodeCount;
              metadata.edgeCount = metrics.edgeCount;
            } catch (error) {
              gfWarn('[GitNativeFederation] Failed to read in-memory metrics for existing file:', error);
            }
          } else if (importFromRedstring) {
            try {
              const fileText = await existingFile.text();
              const parsed = JSON.parse(fileText);
              const imported = importFromRedstring(parsed);
              const metrics = computeStoreMetrics(imported.storeState);
              metadata.nodeCount = metrics.nodeCount;
              metadata.edgeCount = metrics.edgeCount;
            } catch (error) {
              gfWarn('[GitNativeFederation] Failed to parse existing local file for metrics:', error);
            }
          }
        }
      } catch (error) {
        gfWarn('[GitNativeFederation] Unable to inspect existing local file handle:', error);
      }
    }

    if ((metadata.nodeCount === null || metadata.edgeCount === null) && serviceState.activeUniverseSlug === slug) {
      try {
        const useGraphStore = await loadGraphStore();
        const storeState = useGraphStore.getState();
        const metrics = computeStoreMetrics(storeState);
        if (metadata.nodeCount === null) metadata.nodeCount = metrics.nodeCount;
        if (metadata.edgeCount === null) metadata.edgeCount = metrics.edgeCount;
      } catch (error) {
        gfWarn('[GitNativeFederation] Failed to use active store for existing metrics:', error);
      }
    }

    if (metadata.nodeCount === null && typeof universe.nodeCount === 'number' && !Number.isNaN(universe.nodeCount)) {
      metadata.nodeCount = universe.nodeCount;
    }
    const edgeCountFromMeta = universe.raw?.metadata?.edgeCount;
    if (metadata.edgeCount === null && typeof edgeCountFromMeta === 'number' && !Number.isNaN(edgeCountFromMeta)) {
      metadata.edgeCount = edgeCountFromMeta;
    }

    return metadata;
  };

  const detectLocalFileConflict = async (payload) => {
    const { slug, fileHandle, file, metrics, importHelpers } = payload;
    const universe = serviceState.universes.find(u => u.slug === slug);
    if (!universe) {
      gfWarn('[GitNativeFederation] No universe found while detecting local conflict:', slug);
      return null;
    }

    const existingLocal = universe.raw?.localFile || {};
    const hasExistingLocal = existingLocal.enabled && (existingLocal.hadFileHandle || existingLocal.path);
    if (!hasExistingLocal) {
      return null;
    }

    if (!existingLocal.hadFileHandle && !existingLocal.lastSaved && !existingLocal.path) {
      return null;
    }

    const existingHandle = universeBackend.getFileHandle(slug);
    let isSameEntry = false;
    if (existingHandle && typeof existingHandle.isSameEntry === 'function') {
      try {
        isSameEntry = await existingHandle.isSameEntry(fileHandle);
      } catch (error) {
        gfWarn('[GitNativeFederation] Failed to compare existing and incoming handles:', error);
      }
    }

    const existingMetadata = await gatherExistingLocalMetadata(
      slug,
      universe,
      existingHandle,
      importHelpers?.importFromRedstring
    );

    const comparableNodeCounts = typeof metrics.nodeCount === 'number' && typeof existingMetadata.nodeCount === 'number';
    const comparableEdgeCounts = typeof metrics.edgeCount === 'number' && typeof existingMetadata.edgeCount === 'number';
    const countsMatch = comparableNodeCounts &&
      metrics.nodeCount === existingMetadata.nodeCount &&
      (!comparableEdgeCounts || metrics.edgeCount === existingMetadata.edgeCount);

    const nameMatches = [existingLocal.displayPath, existingLocal.path, existingLocal.lastFilePath]
      .filter(Boolean)
      .some(name => name === file.name);

    if (isSameEntry) {
      return null;
    }

    if (!existingHandle && nameMatches && (countsMatch || (!comparableNodeCounts && !comparableEdgeCounts))) {
      return null;
    }

    const incomingDisplay = payload.displayPath || file.name;

    return {
      universeName: universe.name,
      existing: {
        ...existingMetadata,
        label: 'Keep Existing File',
        role: 'Current auto-save target'
      },
      incoming: {
        fileName: incomingDisplay,
        displayPath: incomingDisplay,
        nodeCount: metrics.nodeCount,
        edgeCount: metrics.edgeCount,
        fileSize: typeof file.size === 'number' ? file.size : null,
        lastSaved: null,
        fileModified: file.lastModified || null,
        label: 'Use Linked File',
        role: 'Newly selected file'
      },
      existingLocal,
      reason: isSameEntry ? 'same-file' : 'different-file'
    };
  };

  const applyIncomingLocalFile = async (payload) => {
    const { slug, fileHandle, fileName, storeState, metrics, displayPath } = payload;

    try {
      setLoading(true);

      const useGraphStore = await loadGraphStore();
      const storeActions = useGraphStore.getState();
      gfLog('[GitNativeFederation] Loading linked file data into store...');
      storeActions.loadUniverseFromFile(storeState);

      await universeBackend.setFileHandle(slug, fileHandle, {
        displayPath,
        fileName,
        suppressNotification: true
      });
      await universeBackend.linkLocalFileToUniverse(slug, fileName, { displayPath });

      try {
        await gitFederationService.forceSave(slug, { skipGit: true });
        gfLog('[GitNativeFederation] Saved linked file data to persistent storage');
      } catch (saveErr) {
        gfWarn('[GitNativeFederation] Failed to save after linking new file:', saveErr);
      }

      await refreshState();

      // If this is the only storage option (no Git), set local as source of truth
      const universe = serviceState.universes.find(u => u.slug === slug);
      const hasGit = universe?.raw?.gitRepo?.enabled;
      if (!hasGit) {
        try {
          await gitFederationService.setPrimaryStorage(slug, STORAGE_TYPES.LOCAL);
          gfLog(`[GitNativeFederation] Set Local as source of truth (no other storage options): ${slug}`);
        } catch (err) {
          gfWarn('[GitNativeFederation] Failed to set Local as source of truth:', err);
        }
      }

      const nodeCountLabel = typeof metrics.nodeCount === 'number'
        ? ` • ${metrics.nodeCount} node${metrics.nodeCount === 1 ? '' : 's'}`
        : '';
      setSyncStatus({
        type: 'success',
        message: `Linked ${displayPath || file.name}${nodeCountLabel}`
      });
    } catch (error) {
      gfError('[GitNativeFederation] Failed to finalize local file link:', error);
      setError(`Failed to link file: ${error.message}`);
    } finally {
      setLoading(false);
      pendingLocalLinkRef.current = null;
    }
  };

  const processParsedLocalFile = async (payload) => {
    const conflictDetails = await detectLocalFileConflict(payload);
    if (conflictDetails) {
      pendingLocalLinkRef.current = payload;
      setConflictDialog(conflictDetails);
      return;
    }
    await applyIncomingLocalFile(payload);
  };

  const handleResolveLocalConflict = async (choice) => {
    const payload = pendingLocalLinkRef.current;
    const dialogData = conflictDialog;
    setConflictDialog(null);

    if (!payload) {
      return;
    }

    if (choice === 'existing') {
      pendingLocalLinkRef.current = null;
      const existingLabel = dialogData?.existing?.fileName || 'existing local file';
      setSyncStatus({
        type: 'info',
        message: `Continuing with ${existingLabel}`
      });
      return;
    }

    await applyIncomingLocalFile(payload);
  };

  const handleCancelLocalConflict = () => {
    pendingLocalLinkRef.current = null;
    setConflictDialog(null);
    setSyncStatus({ type: 'info', message: 'Local file link cancelled' });
  };

  const handleResolveSlotConflict = async (choice) => {
    if (!slotConflict) return;

    try {
      gfLog(`[GitNativeFederation] Resolving slot conflict with choice: ${choice}`);
      setSyncStatus({ type: 'info', message: `Applying ${choice} version...` });

      await universeBackend.resolveConflict(slotConflict.universeSlug, choice);

      setSlotConflict(null);
      setSyncStatus({
        type: 'success',
        message: `Successfully applied ${choice} version`
      });

      // Refresh state to show updated universe
      await refreshState();
    } catch (error) {
      gfError('[GitNativeFederation] Failed to resolve slot conflict:', error);
      setSyncStatus({
        type: 'error',
        message: `Failed to apply ${choice} version: ${error.message}`
      });
    }
  };

  const handleCancelSlotConflict = () => {
    gfLog('[GitNativeFederation] Slot conflict resolution cancelled');
    setSlotConflict(null);
    setSyncStatus({ type: 'info', message: 'Conflict resolution cancelled' });
  };

  const handleLinkLocalFile = async (slug) => {
    gfLog('[GitNativeFederation] Linking local file for universe:', slug);

    let payload = null;

    try {
      setLoading(true);

      // Use the file access adapter (works in both browser and Electron)
      const fileHandle = await pickFile();

      // Get file name for display
      let fileName;
      if (isElectron() && typeof fileHandle === 'string') {
        fileName = fileHandle.split(/[/\\]/).pop();
      } else {
        fileName = fileHandle?.name || 'unknown';
      }

      gfLog('[GitNativeFederation] File handle obtained:', fileName);

      // In Electron, we don't need permission checks
      if (!isElectron()) {
        let permissionStatus = 'granted';
        if (typeof fileHandle.queryPermission === 'function') {
          permissionStatus = await fileHandle.queryPermission({ mode: 'read' });
          gfLog('[GitNativeFederation] File permission status:', permissionStatus);

          if (permissionStatus === 'prompt' && typeof fileHandle.requestPermission === 'function') {
            const granted = await fileHandle.requestPermission({ mode: 'read' });
            gfLog('[GitNativeFederation] Permission requested, granted:', granted);
            permissionStatus = granted;
          }
        }

        if (permissionStatus !== 'granted') {
          throw new Error('File read permission denied. Please allow file access to continue.');
        }
      }

      // Read file content using adapter
      const fileContent = await readFile(fileHandle);
      gfLog('[GitNativeFederation] File content read, length:', fileContent.length);

      if (!fileContent || fileContent.trim() === '') {
        throw new Error(`The selected file "${fileName}" is empty. The file may be corrupted or not saved properly. Please check the file and try again.`);
      }

      const formatModule = await import('./formats/redstringFormat.js');
      const { importFromRedstring, validateFormatVersion } = formatModule;

      let parsedData;
      try {
        parsedData = JSON.parse(fileContent);
      } catch (parseError) {
        throw new Error(`Invalid JSON in file: ${parseError.message}. The file may be corrupted or not a valid .redstring file.`);
      }

      if (!parsedData || typeof parsedData !== 'object') {
        throw new Error('File does not contain valid redstring data.');
      }

      const validation = validateFormatVersion(parsedData);
      gfLog('[GitNativeFederation] Format validation:', validation);

      if (!validation.valid) {
        if (validation.tooNew) {
          throw new Error(`This file was created with a newer version of Redstring (${validation.version}). Please update your app to open this file.`);
        } else if (validation.tooOld) {
          throw new Error(`This file format is too old (${validation.version}) and cannot be opened. Minimum supported version is ${validation.currentVersion}.`);
        } else {
          throw new Error(validation.error);
        }
      }

      if (validation.needsMigration) {
        gfLog(`[GitNativeFederation] File will be auto-migrated from ${validation.version} to ${validation.currentVersion}`);
        setSyncStatus({
          type: 'info',
          message: `Migrating file from format ${validation.version} to ${validation.currentVersion}...`
        });
      }

      const importResult = importFromRedstring(parsedData);
      const storeState = importResult.storeState;
      const metrics = computeStoreMetrics(storeState);

      if (importResult.version?.migrated) {
        gfLog(`[GitNativeFederation] File successfully migrated from ${importResult.version.imported} to ${importResult.version.current}`);
        setSyncStatus({
          type: 'success',
          message: `File migrated from format ${importResult.version.imported} to ${importResult.version.current}`
        });
      }

      gfLog('[GitNativeFederation] Parsed file data:', {
        hasNodePrototypes: !!storeState?.nodePrototypes,
        nodeCount: typeof metrics.nodeCount === 'number' ? metrics.nodeCount : 'unknown',
        edgeCount: typeof metrics.edgeCount === 'number' ? metrics.edgeCount : 'unknown',
        fileName
      });

      // In Electron, displayPath is the full path; in browser, derive from FileHandle
      const displayPath = isElectron() && typeof fileHandle === 'string'
        ? fileHandle
        : (typeof fileHandle?.name === 'string' ? fileHandle.name : fileName);

      payload = {
        slug,
        fileHandle,
        fileName,
        storeState,
        metrics,
        displayPath,
        importHelpers: { importFromRedstring }
      };

      const fileBaseName = fileName.replace(/\.redstring$/i, '');
      const universe = serviceState.universes.find(u => u.slug === slug);
      const universeNameMismatch = universe && fileBaseName !== slug && fileBaseName !== universe.name;

      if (universeNameMismatch) {
        setConfirmDialog({
          title: 'Confirm Link',
          message: `Link "${fileName}" to universe "${universe?.name}"?`,
          details: `This will replace the current data in "${universe?.name}".`,
          variant: 'warning',
          confirmLabel: 'Link & Replace Data',
          cancelLabel: 'Cancel',
          onConfirm: async () => {
            await processParsedLocalFile(payload);
          }
        });
        return;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        gfError('[GitNativeFederation] Link local file failed:', err);
        setError(`Failed to link file: ${err.message}`);
      }
      payload = null;
    } finally {
      setLoading(false);
    }

    if (!payload) {
      return;
    }

    await processParsedLocalFile(payload);
  };

  const handleCreateLocalFile = async (slug) => {
    try {
      setLoading(true);
      gfLog('[GitNativeFederation] Creating new local file for universe:', slug);

      const universe = serviceState.universes.find(u => u.slug === slug);
      if (!universe) {
        throw new Error('Universe not found');
      }

      // Get current store state
      const useGraphStore = (await import('./store/graphStore.jsx')).default;
      const storeState = useGraphStore.getState();

      // Export to redstring format
      const { exportToRedstring } = await import('./formats/redstringFormat.js');
      const redstringData = exportToRedstring(storeState);
      const jsonString = JSON.stringify(redstringData, null, 2);

      // Prompt user to save file using adapter (works in both browser and Electron)
      const suggestedName = `${universe.name || slug}.redstring`;
      const fileHandle = await pickSaveLocation({ suggestedName });

      // Get filename for display
      const fileName = isElectron() && typeof fileHandle === 'string'
        ? fileHandle.split(/[/\\]/).pop()
        : (fileHandle?.name || suggestedName);

      // Write data to file using adapter
      await writeFile(fileHandle, jsonString);

      // Store the file handle and link to universe
      const displayPath = isElectron() && typeof fileHandle === 'string' ? fileHandle : fileName;
      await universeBackend.setFileHandle(slug, fileHandle, {
        displayPath,
        fileName,
        suppressNotification: true
      });

      setSyncStatus({ type: 'success', message: `Created and linked ${fileName}` });
      await refreshState();
    } catch (err) {
      if (err.name !== 'AbortError') {
        gfError('[GitNativeFederation] Create local file failed:', err);
        setError(`Failed to create local file: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGrantLocalPermission = async (slug) => {
    try {
      setLoading(true);
      await gitFederationService.requestLocalFilePermission(slug);
      setSyncStatus({
        type: 'success',
        message: 'Local file access restored.'
      });
      await refreshState();
    } catch (error) {
      gfError('[GitNativeFederation] Grant local permission failed:', error);
      setError(`Failed to restore file access: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadLocalFile = async (slug) => {
    try {
      setLoading(true);
      await gitFederationService.downloadLocalFile(slug);
      setSyncStatus({ type: 'success', message: 'Local universe downloaded' });
    } catch (err) {
      gfError('[GitNativeFederation] File download failed:', err);
      setError(`Failed to download file: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadRepoFile = async (slug) => {
    try {
      setLoading(true);
      await gitFederationService.downloadGitUniverse(slug);
      setSyncStatus({ type: 'success', message: 'Downloaded universe from Git repository' });
    } catch (err) {
      gfError('[GitNativeFederation] Git download failed:', err);
      setError(`Failed to download from repository: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveLocalFile = async (slug) => {
    try {
      setLoading(true);
      await gitFederationService.removeLocalFile(slug);
      setSyncStatus({ type: 'info', message: 'Local file link removed' });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Remove local file failed:', err);
      setError(`Failed to unlink local file: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleForceSave = async (slug) => {
    try {
      setLoading(true);
      const universe = serviceState.universes.find(u => u.slug === slug);
      const isGitPrimary = (universe?.sourceOfTruth || universe?.storage?.primary?.type) === 'git';
      await gitFederationService.forceSave(slug, isGitPrimary ? undefined : { skipGit: true });
      setSyncStatus({ type: 'success', message: isGitPrimary ? 'Universe saved to Git' : 'Universe saved locally (Git is not primary)' });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Save failed:', err);
      setError(`Save failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReloadActive = async () => {
    try {
      setLoading(true);
      if (serviceState.activeUniverseSlug) {
        const universe = serviceState.universes.find(u => u.slug === serviceState.activeUniverseSlug);
        const isGitPrimary = (universe?.sourceOfTruth || universe?.storage?.primary?.type) === 'git';
        if (!isGitPrimary) {
          setConfirmDialog({
            title: 'Reload from Non-Primary Source?',
            message: 'Your source of truth is Local. Reloading will pull from the configured source and may replace in-memory data.',
            details: 'Proceed only if you intend to discard unsaved in-memory changes.',
            variant: 'warning',
            confirmLabel: 'Reload',
            cancelLabel: 'Cancel',
            onConfirm: async () => {
              try {
                setLoading(true);
                await universeBackendBridge.reloadUniverse(serviceState.activeUniverseSlug);
                setSyncStatus({ type: 'info', message: 'Universe reloaded' });
                await refreshState();
              } catch (err) {
                gfError('[GitNativeFederation] Reload failed:', err);
                setError(`Reload failed: ${err.message}`);
              } finally {
                setLoading(false);
              }
            }
          });
          return;
        }
        await universeBackendBridge.reloadUniverse(serviceState.activeUniverseSlug);
      } else {
        await gitFederationService.reloadActiveUniverse();
      }
      setSyncStatus({ type: 'info', message: 'Universe reloaded' });
      await refreshState();
    } catch (err) {
      gfError('[GitNativeFederation] Reload failed:', err);
      setError(`Reload failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getStorageSlotStatus = (universe, slot) => {
    if (!slot || !universe) return { lastSaved: null, status: 'Unknown', statusColor: '#555', statusHint: null };

    // Start with the slot's existing data (already populated by gitFederationService)
    let lastSaved = slot.lastCommitTime || slot.lastSync || null;
    let status = slot.status || universe.sync?.label || 'Unknown';
    let statusColor = slot.statusTone || universe.sync?.tone || '#555';
    let statusHint = slot.statusHint || universe.sync?.description || null;

    // DEBUG: Log initial slot data
    console.log(`[GitNativeFederation] getStorageSlotStatus for ${universe.slug}:`, {
      slotType: slot.type,
      'slot.status': slot.status,
      'slot.statusTone': slot.statusTone,
      'slot.statusHint': slot.statusHint,
      'slot.lastSync': slot.lastSync,
      'slot.lastCommitTime': slot.lastCommitTime,
      initialStatus: status
    });

    // For Git slots, enhance with real-time engine status
    if (slot.type === STORAGE_TYPES.GIT) {
      const syncStatus = syncStatusFor(universe.slug);
      const engine = syncStatus || universe.sync?.engine || {};

      console.log(`[GitNativeFederation] Git slot engine data for ${universe.slug}:`, {
        hasSyncStatus: !!syncStatus,
        'universe.sync?.engine': universe.sync?.engine,
        'engine': engine
      });

      // Update lastSaved if we have fresher data from engine
      if (engine?.lastCommitTime && (!lastSaved || new Date(engine.lastCommitTime) > new Date(lastSaved))) {
        lastSaved = engine.lastCommitTime;
      }
      // Fallback to sync summary timestamps if engine is missing last commit
      if (!lastSaved && (universe.sync?.lastCommitTime || universe.sync?.lastSync)) {
        lastSaved = universe.sync?.lastCommitTime || universe.sync?.lastSync;
      }

      // Override status with real-time engine state (more accurate than cached slot data)
      if (engine?.isInErrorBackoff || engine?.isHealthy === false) {
        status = 'Error';
        statusColor = '#c62828';
        statusHint = 'Unable to save changes';
        console.log(`[GitNativeFederation] Status set to Error for ${universe.slug}`);
      } else if (engine?.isRunning || (engine?.pendingCommits && engine.pendingCommits > 0)) {
        status = 'Saving...';
        statusColor = '#666';
        console.log(`[GitNativeFederation] Status set to Saving for ${universe.slug}`);
      } else if (engine?.isPaused) {
        status = 'Paused';
        statusColor = '#ef6c00';
        statusHint = 'Sync paused';
        console.log(`[GitNativeFederation] Status set to Paused for ${universe.slug}`);
      } else if (engine?.hasChanges) {
        status = 'Unsaved changes';
        statusColor = '#ef6c00';
        console.log(`[GitNativeFederation] Status set to Unsaved changes for ${universe.slug}`);
      } else if (lastSaved) {
        status = 'Synced';
        statusColor = '#2e7d32';
        console.log(`[GitNativeFederation] Status set to Synced for ${universe.slug}`);
      } else {
        // No real-time engine data available. Fall back to sync summary from universe.sync
        if (universe.sync) {
          if (universe.sync.state === 'disconnected') {
            status = 'Git disconnected';
            statusColor = '#c62828';
            statusHint = universe.sync.description || statusHint;
          } else if (universe.sync.state === 'standby') {
            status = universe.sync.label || 'Awaiting sync engine';
            statusColor = universe.sync.tone || '#ef6c00';
            statusHint = universe.sync.description || statusHint;
          } else if (universe.sync.label) {
            status = universe.sync.label;
            statusColor = universe.sync.tone || statusColor;
            statusHint = universe.sync.description || statusHint;
          }
          if (!lastSaved && (universe.sync.lastCommitTime || universe.sync.lastSync)) {
            lastSaved = universe.sync.lastCommitTime || universe.sync.lastSync;
          }
        }
        console.log(`[GitNativeFederation] No engine data, using slot status for ${universe.slug}:`, status);
      }
    } else if (slot.type === STORAGE_TYPES.LOCAL) {
      // For local files, use the slot's data which is already accurate
      const localFile = universe.raw?.localFile || {};
      if (localFile.unavailableReason) {
        status = 'Unavailable';
        statusColor = '#c62828';
        statusHint = localFile.unavailableReason;
      } else if (localFile.lastSaved) {
        lastSaved = localFile.lastSaved;
        status = 'Saved';
        statusColor = '#2e7d32';
      }
    }

    return { lastSaved, status, statusColor, statusHint };
  };

  const handleGitHubAuth = async () => {
    try {
      setIsConnecting(true);
      try {
        sessionStorage.removeItem('github_oauth_pending');
        sessionStorage.removeItem('github_oauth_state');
        sessionStorage.removeItem('github_oauth_result');
      } catch {
        // ignore
      }

      const resp = await oauthFetch('/api/github/oauth/client-id');
      if (!resp.ok) throw new Error('Failed to load OAuth configuration');
      const { clientId } = await resp.json();
      if (!clientId) throw new Error('GitHub OAuth client ID not configured');

      const stateValue = Math.random().toString(36).slice(2);
      const redirectUri = gitFederationService.getOAuthRedirectUri();
      const scopes = 'repo';

      sessionStorage.setItem('github_oauth_state', stateValue);
      sessionStorage.setItem('github_oauth_pending', 'true');

      const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
        clientId
      )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(
        scopes
      )}&state=${encodeURIComponent(stateValue)}`;

      window.location.href = authUrl;
    } catch (err) {
      gfError('[GitNativeFederation] OAuth launch failed:', err);
      setError(`OAuth authentication failed: ${err.message}`);
      setIsConnecting(false);
    }
  };

  const handleGitHubApp = async () => {
    try {
      setIsConnecting(true);

      // Check if app is already installed
      if (hasApp && serviceState.githubAppInstallation?.installationId) {
        // App is already installed - go to settings/manage instead of install
        const installationId = serviceState.githubAppInstallation.installationId;
        gfLog('[GitNativeFederation] App already installed, redirecting to management page');

        // Try to get installation details to redirect to specific installation
        try {
          const resp = await oauthFetch(`/api/github/app/installation/${installationId}`);
          if (resp.ok) {
            const data = await resp.json();
            const accountLogin = data?.account?.login;
            if (accountLogin) {
              // Redirect to specific installation settings
              const url = `https://github.com/settings/installations/${installationId}`;
              window.location.href = url;
              return;
            }
          }
        } catch (e) {
          gfWarn('[GitNativeFederation] Could not fetch installation details:', e);
        }

        // Fallback: redirect to general installations page
        window.location.href = 'https://github.com/settings/installations';
        return;
      }

      // App not installed - proceed with installation flow
      let appName = 'redstring-semantic-sync';
      try {
        const resp = await oauthFetch('/api/github/app/info');
        if (resp.ok) {
          const data = await resp.json();
          appName = data.name || appName;
        }
      } catch {
        // ignore
      }

      sessionStorage.setItem('github_app_pending', 'true');
      const stateValue = Date.now().toString();
      const url = `https://github.com/apps/${appName}/installations/new?state=${stateValue}`;
      window.location.href = url;
    } catch (err) {
      gfError('[GitNativeFederation] GitHub App launch failed:', err);
      setError(`GitHub App authentication failed: ${err.message}`);
      setIsConnecting(false);
    }
  };

  const renderStorageSlot = (universe, slot, isPrimary) => {
    if (!slot) return null;

    const isGitSlot = slot.type === STORAGE_TYPES.GIT;
    const isLocalSlot = slot.type === STORAGE_TYPES.LOCAL;
    const storageIcon = isGitSlot ? <GitBranch size={16} /> : isLocalSlot ? <Save size={16} /> : <Cloud size={16} />;

    // Get actual status from sync data
    const { lastSaved, status, statusColor, statusHint } = getStorageSlotStatus(universe, slot);
    const lastSavedText = lastSaved ? formatWhen(lastSaved) : 'Never';

    // Format the label consistently
    let displayLabel = slot.label;
    if (isGitSlot && slot.repo) {
      displayLabel = `${slot.repo.user}/${slot.repo.repo}`;
    } else if (isLocalSlot) {
      // Extract just the filename if it's a path
      const fileName = slot.label?.split('/').pop() || slot.label;
      displayLabel = fileName;
    }

    const actions = [];

    if (slot.type === STORAGE_TYPES.GIT && slot.repo) {
      actions.push(
        <button
          key="open"
          onClick={() => window.open(`https://github.com/${slot.repo.user}/${slot.repo.repo}`, '_blank', 'noopener')}
          style={buttonStyle('outline')}
        >
          View Repo
        </button>
      );
    }

    if (!isPrimary) {
      actions.push(
        <button
          key="primary"
          onClick={() => handleSetPrimarySlot(universe.slug, slot)}
          style={buttonStyle('solid')}
        >
          Make Primary
        </button>
      );
    }

    if (slot.type === STORAGE_TYPES.GIT && slot.repo) {
      actions.push(
        <button
          key="detach"
          onClick={() => handleDetachRepo(universe, { user: slot.repo.user, repo: slot.repo.repo })}
          style={buttonStyle('danger')}
        >
          Detach
        </button>
      );
    }

    return (
      <div
        key={slot.id}
        style={{
          border: `1px solid ${isPrimary ? '#7A0000' : '#260000'}`,
          borderRadius: 8,
          padding: 12,
          backgroundColor: isPrimary ? 'rgba(122,0,0,0.08)' : '#bdb5b5',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        <div style={{
          display: 'flex',
          flexDirection: isSlim ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isSlim ? 'flex-start' : 'center',
          gap: isSlim ? 8 : 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            {storageIcon}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{STORAGE_LABELS[slot.type] || 'Storage slot'}</div>
              <div style={{ fontSize: '0.75rem', color: '#444', wordBreak: 'break-word' }}>{displayLabel}</div>
            </div>
          </div>
          {isPrimary && (
            <span
              style={{
                fontSize: '0.7rem',
                color: '#7A0000',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 10,
                backgroundColor: 'rgba(122,0,0,0.1)',
                alignSelf: isSlim ? 'flex-start' : 'center',
                flexShrink: 0
              }}
            >
              PRIMARY
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.72rem', color: '#555', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div>Last saved: {lastSavedText}</div>
          <div style={{ color: statusColor }}>Status: {status}</div>
          {statusHint && (
            <div style={{ fontSize: '0.66rem', color: '#444' }}>
              {statusHint}
            </div>
          )}
        </div>
        {actions.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', width: '100%' }}>{actions}</div>}
      </div>
    );
  };

  const renderLocalFile = (universe) => {
    const localFile = universe.raw?.localFile;
    const hasLocalFile = localFile?.enabled && localFile?.path;

    if (!hasLocalFile) {
      return (
        <div
          style={{
            padding: 12,
            border: '1px dashed #979090',
            borderRadius: 6,
            backgroundColor: '#bdb5b5',
            color: '#555',
            fontSize: '0.8rem'
          }}
        >
          No local file linked yet. Link or create one to enable local storage.
        </div>
      );
    }

    return (
      <div
        style={{
          border: '1px solid #260000',
          borderRadius: 8,
          padding: 12,
          backgroundColor: '#bdb5b5',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <div style={{
          display: 'flex',
          flexDirection: isSlim ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isSlim ? 'stretch' : 'center',
          gap: isSlim ? 10 : 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Save size={18} />
            <div>
              <div style={{ fontWeight: 600 }}>{localFile.displayPath || localFile.path}</div>
              <div style={{ fontSize: '0.72rem', color: '#555' }}>
                Local .redstring file {localFile.hadFileHandle ? '(handle stored)' : '(handle not cached)'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={() => handleLinkLocalFile(universe.slug)}
              style={buttonStyle('outline')}
            >
              Relink File
            </button>
            <button
              onClick={() => handleDownloadLocalFile(universe.slug)}
              style={buttonStyle('outline')}
            >
              Download
            </button>
          </div>
        </div>
        {localFile.unavailableReason && (
          <div style={{ fontSize: '0.72rem', color: '#7A0000', fontStyle: 'italic' }}>
            ⚠️ {localFile.unavailableReason}
          </div>
        )}
      </div>
    );
  };

  const renderSources = (universe) => {
    const sources = (universe.raw?.sources || []).filter((src) => src.type === 'github');
    if (sources.length === 0) {
      return (
        <div
          style={{
            padding: 12,
            border: '1px dashed #979090',
            borderRadius: 6,
            backgroundColor: '#bdb5b5',
            color: '#555',
            fontSize: '0.8rem'
          }}
        >
          No repositories linked yet. Add one to enable sync.
        </div>
      );
    }

    return sources.map((source) => {
      const key = `${source.user}/${source.repo}`;
      const discovery = discoveryFor(source.user, source.repo);

      return (
        <div
          key={source.id}
          style={{
            border: '1px solid #260000',
            borderRadius: 8,
            padding: 12,
            backgroundColor: '#bdb5b5',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{
            display: 'flex',
            flexDirection: isSlim ? 'column' : 'row',
            justifyContent: 'space-between',
            alignItems: isSlim ? 'stretch' : 'center',
            gap: isSlim ? 10 : 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Github size={18} />
              <div>
                <div style={{ fontWeight: 600 }}>github.com/{source.user}/{source.repo}</div>
                <div style={{ fontSize: '0.72rem', color: '#555' }}>
                  GitHub repository · Linked {new Date(source.addedAt).toLocaleDateString()}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => handleDiscover(source)}
                style={buttonStyle(discovery.loading ? 'disabled' : 'outline')}
                disabled={discovery.loading}
              >
                {discovery.loading ? 'Scanning…' : 'Discover universes'}
              </button>
              <button
                onClick={() => handleDetachRepo(universe, source)}
                style={buttonStyle('danger')}
              >
                Remove
              </button>
            </div>
          </div>

          {discovery.error && (
            <div style={{ fontSize: '0.72rem', color: '#7A0000' }}>{discovery.error}</div>
          )}

          {discovery.items && discovery.items.length > 0 && (
            <div
              style={{
                border: '1px solid #979090',
                borderRadius: 6,
                backgroundColor: '#cfc6c6',
                maxHeight: 160,
                overflowY: 'auto',
                padding: 6
              }}
            >
              {discovery.items.map((item) => (
                <div
                  key={`${key}:${item.slug || item.path}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 6,
                    borderBottom: '1px solid #979090',
                    gap: 8
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.78rem' }}>{item.name || item.slug || 'Universe'}</div>
                    <div style={{ fontSize: '0.68rem', color: '#555' }}>{item.path || item.location || 'Unknown path'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleImportDiscovered(item, { user: source.user, repo: source.repo })}
                      style={{
                        ...buttonStyle('outline'),
                        borderColor: '#1565c0',
                        color: '#1565c0',
                        backgroundColor: 'rgba(21,101,192,0.12)'
                      }}
                    >
                      Import Copy
                    </button>
                    <button
                      onClick={() => handleLinkDiscovered(item, { user: source.user, repo: source.repo })}
                      style={{
                        ...buttonStyle('solid'),
                        backgroundColor: '#7A0000',
                        color: '#ffffff',
                        borderColor: '#7A0000'
                      }}
                    >
                      Sync to Universe
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    });
  };

  const renderActiveUniverse = () => {
    if (!activeUniverse) {
      return (
        <div
          style={{
            padding: 14,
            border: '1px dashed #979090',
            borderRadius: 6,
            backgroundColor: '#bdb5b5',
            color: '#555',
            fontSize: '0.8rem'
          }}
        >
          Select or create a universe to configure storage.
        </div>
      );
    }

    const slots = [];
    if (activeUniverse.storage?.primary) slots.push({ slot: activeUniverse.storage.primary, primary: true });
    if (activeUniverse.storage?.backups) {
      activeUniverse.storage.backups.forEach((slot) => slots.push({ slot, primary: false }));
    }

    return (
      <div
        style={{
          backgroundColor: '#979090',
          borderRadius: 8,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <div style={{
          display: 'flex',
          flexDirection: isSlim ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isSlim ? 'stretch' : 'center',
          gap: isSlim ? 12 : 0
        }}>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>{activeUniverse.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#444' }}>
              Nodes: {activeUniverse.nodeCount ?? '—'} · Last opened {formatWhen(activeUniverse.lastOpenedAt)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => handleAttachRepo(activeUniverse.slug)} style={buttonStyle('solid')}>
              Link repository
            </button>
            <button onClick={() => handleForceSave(activeUniverse.slug)} style={buttonStyle('outline')}>
              <Save size={14} /> Save
            </button>
            <button onClick={handleReloadActive} style={buttonStyle('outline')}>
              <RefreshCw size={14} /> Reload
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: '#260000',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center'
          }}>
            <span>Storage slots</span>
            <span style={{ fontSize: '0.7rem', color: '#444', fontWeight: 500 }}>
              Primary: {activeUniverse.storage?.primary?.label || 'None'}
            </span>
          </div>
          {slots.length === 0 ? (
            <div
              style={{
                padding: 12,
                border: '1px dashed #979090',
                borderRadius: 6,
                backgroundColor: '#bdb5b5',
                color: '#555',
                fontSize: '0.78rem'
              }}
            >
              No storage linked yet. Link a repository or local file to persist data.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {slots.map(({ slot, primary }) => renderStorageSlot(activeUniverse, slot, primary))}
            </div>
          )}
          {activeUniverse.hasBrowserFallback && <BrowserFallbackNote />}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: '#260000',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center'
          }}>
            <span>Local file</span>
          </div>
          {renderLocalFile(activeUniverse)}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: '#260000',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center'
          }}>
            <span>Repository sources</span>
            <span style={{ fontSize: '0.7rem', color: '#444', fontWeight: 500 }}>
              Linked: {(activeUniverse.raw?.sources || []).filter((src) => src.type === 'github').length}
            </span>
          </div>
          {renderSources(activeUniverse)}
        </div>

        {/* Status and Connection Stats moved to dedicated section below Accounts & Access */}
      </div>
    );
  };

  const renderUniversesList = () => (
    <div
      style={{
        backgroundColor: '#979090',
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div style={{
        display: 'flex',
        flexDirection: isSlim ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isSlim ? 'stretch' : 'center',
        gap: isSlim ? 10 : 0
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>Universes</div>
          <div style={{ fontSize: '0.75rem', color: '#444' }}>Manage your knowledge spaces</div>
        </div>
        <button onClick={handleCreateUniverse} style={buttonStyle('solid')}>
          <Plus size={14} /> New
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {serviceState.universes.map((universe) => {
          const isActive = universe.slug === serviceState.activeUniverseSlug;
          return (
            <div
              key={universe.slug}
              style={{
                border: isActive ? '2px solid #7A0000' : '1px solid #260000',
                borderRadius: 8,
                backgroundColor: '#bdb5b5',
                padding: 12,
                display: 'flex',
                flexDirection: isSlim ? 'column' : 'row',
                justifyContent: 'space-between',
                alignItems: isSlim ? 'stretch' : 'center',
                gap: isSlim ? 10 : 0
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{universe.name}</div>
                <div style={{ fontSize: '0.72rem', color: '#555' }}>
                  Created {formatWhen(universe.createdAt)} · Updated {formatWhen(universe.updatedAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', width: isSlim ? '100%' : 'auto', flexShrink: 0 }}>
                {!isActive && (
                  <button onClick={() => handleSwitchUniverse(universe.slug)} style={buttonStyle('outline')}>
                    Switch
                  </button>
                )}
                {serviceState.universes.length > 1 && (
                  <button
                    onClick={() => handleDeleteUniverse(universe.slug, universe.name)}
                    style={buttonStyle('danger')}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const variantStyles = variant === 'modal'
    ? {
      background: 'rgba(12, 0, 0, 0.9)',
      padding: 20,
      paddingBottom: 20 + bottomSafeArea, // Add TypeList gap spacing
      borderRadius: 12,
      border: '1px solid #260000',
      height: '100%',
      overflow: 'auto'
    }
    : {
      background: 'transparent',
      padding: 0,
      paddingBottom: bottomSafeArea, // Add TypeList gap spacing for panel variant too
      height: '100%'
    };

  // Device message only shown if there are limitations
  const deviceMessage = deviceInfo.gitOnlyMode ? (() => {
    if (deviceInfo.isMobile) {
      return {
        type: 'info',
        title: 'Mobile Git-Only Mode',
        message: 'We stick to Git repositories on this device for seamless synchronization.'
      };
    }
    if (deviceInfo.isTablet) {
      return {
        type: 'info',
        title: 'Tablet Git-Only Mode',
        message: 'Optimized for tablets with Git as the source of truth.'
      };
    }
    return {
      type: 'info',
      title: 'Git-Only Mode Active',
      message: 'Local file APIs are unavailable, so we sync directly with Git.'
    };
  })() : null;

  const isUniverseImportMode = pendingRepoAttachment?.mode === 'import';
  const universeFileRepoLabel = pendingRepoAttachment
    ? `${pendingRepoAttachment.owner}/${pendingRepoAttachment.repoName}`
    : 'this repository';

  return (
    <div
      ref={containerRef}
      style={{
        fontFamily: "'EmOne', sans-serif",
        color: '#260000',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        position: 'relative',
        height: '100%',
        ...variantStyles
      }}
    >
      {variant === 'modal' && typeof onRequestClose === 'function' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onRequestClose} style={buttonStyle('outline')}>
            Close
          </button>
        </div>
      )}

      {deviceMessage && (
        <div
          style={{
            borderRadius: 8,
            border: '1px solid #260000',
            backgroundColor: '#bdb5b5',
            padding: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <Info size={18} />
          <div>
            <div style={{ fontWeight: 700 }}>{deviceMessage.title}</div>
            <div style={{ fontSize: '0.78rem', color: '#333' }}>{deviceMessage.message}</div>
          </div>
        </div>
      )}

      {syncStatus && (
        <div
          style={{
            borderRadius: 8,
            border: `1px solid ${STATUS_COLORS[syncStatus.type] || STATUS_COLORS.info}`,
            backgroundColor: 'rgba(255,255,255,0.4)',
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <AlertCircle size={16} color={STATUS_COLORS[syncStatus.type] || STATUS_COLORS.info} />
          <span style={{ fontSize: '0.8rem' }}>{syncStatus.message}</span>
        </div>
      )}

      {error && (
        <div
          style={{
            borderRadius: 8,
            border: '1px solid #c62828',
            backgroundColor: '#ffebee',
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <XCircle size={16} color="#c62828" />
          <span style={{ fontSize: '0.8rem' }}>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              color: '#c62828',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            ×
          </button>
        </div>
      )}

      <UniversesList
        isLoading={loading}
        universes={serviceState.universes}
        activeUniverseSlug={serviceState.activeUniverseSlug}
        syncStatusMap={syncTelemetry}
        onCreateUniverse={handleCreateUniverse}
        onSwitchUniverse={handleSwitchUniverse}
        onDeleteUniverse={handleDeleteUniverse}
        onLinkRepo={handleAttachRepo}
        onLinkLocalFile={handleLinkLocalFile}
        onCreateLocalFile={handleCreateLocalFile}
        onDownloadLocalFile={handleDownloadLocalFile}
        onDownloadRepoFile={handleDownloadRepoFile}
        onRemoveLocalFile={handleRemoveLocalFile}
        onRemoveRepoSource={handleRemoveRepoSource}
        onEditRepoSource={handleEditRepoSource}
        onSetMainRepoSource={handleSetMainRepoSource}
        onSaveRepoSource={handleSaveRepoSource}
        onSetPrimarySource={handleSetPrimarySource}
        onCreateUniverseFromFile={handleCreateUniverseFromLocalFile}
        onLoadFromLocal={handleLoadFromLocal}
        onLoadFromRepo={handleLoadFromRepo}
        onGrantLocalPermission={handleGrantLocalPermission}
        isSlim={isSlim}
      />

      <RepositoriesSection
        repositories={managedRepositories}
        discoveryMap={discoveryMap}
        onBrowseRepositories={() => setShowRepositoryManager(true)}
        onRemoveRepository={handleRemoveFromManagedList}
        onSetMainRepository={handleSetMainRepository}
        onDiscoverRepository={(repoInfo) => handleDiscover(repoInfo)}
        onImportUniverse={(universe, repoInfo) => handleImportDiscovered(universe, repoInfo)}
        onSyncUniverse={(universe, repoInfo) => handleLinkDiscovered(universe, repoInfo)}
      />

      <AuthSection
        statusBadge={statusBadge}
        hasApp={hasApp}
        hasOAuth={hasOAuth}
        dataAuthMethod={dataAuthMethod}
        isConnecting={isConnecting}
        allowOAuthBackup={allowOAuthBackup}
        onSetAllowOAuthBackup={setAllowOAuthBackup}
        onGitHubAuth={handleGitHubAuth}
        onGitHubApp={handleGitHubApp}
        activeUniverse={activeUniverse}
        syncStatus={activeUniverse ? syncStatusFor(activeUniverse.slug) : null}
        isSlim={isSlim}
      />

      {activeUniverse && (
        <div
          style={{
            backgroundColor: '#979090',
            borderRadius: 8,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitBranch size={18} />
            <div style={{ fontWeight: 700 }}>Status & Sync</div>
          </div>

          {(() => {
            const engine = activeUniverse ? (syncStatusFor(activeUniverse.slug) || activeUniverse.sync?.engine || {}) : {};
            const base = activeUniverse?.sync || {};
            let displayState = 'idle';
            let displayLabel = 'All changes saved';
            let displayTone = '#2e7d32';
            let displayDesc = '';

            const pendingCommits = Number(engine?.pendingCommits || 0);

            if (engine?.isInErrorBackoff || engine?.isHealthy === false) {
              displayState = 'error';
              displayLabel = 'Unable to save changes';
              displayTone = '#c62828';
            } else if (engine?.isRunning || pendingCommits > 0) {
              displayState = 'saving';
              displayLabel = 'Saving...';
              displayTone = '#666';
            } else if (engine?.isPaused) {
              displayState = 'paused';
              displayLabel = 'Sync paused';
              displayTone = '#ef6c00';
              displayDesc = 'Resume to save changes.';
            } else if (engine?.hasChanges) {
              displayState = 'unsaved';
              displayLabel = 'Unsaved changes';
              displayTone = '#b85e00';
            } else if (base?.state && base?.label) {
              // Fallback to mapped state
              displayState = base.state;
              displayLabel = base.label;
              displayTone = base.tone || displayTone;
              displayDesc = base.description || '';
            }

            const lastTime = engine?.lastCommitTime || base?.lastCommitTime;
            const elapsedText = (() => {
              try {
                if (!lastTime) return null;
                const ts = typeof lastTime === 'string' ? new Date(lastTime).getTime() : lastTime;
                const diff = Date.now() - ts;
                if (!Number.isFinite(diff) || diff < 0) return null;
                if (diff < 60000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
                if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
                if (diff < 43200000) { // < 12h
                  const h = Math.floor(diff / 3600000);
                  const m = Math.floor((diff % 3600000) / 60000);
                  return `${h}h ${m}m`;
                }
                return '12h+';
              } catch {
                return null;
              }
            })();

            return (
              <div
                style={{
                  border: '1px solid #979090',
                  borderRadius: 8,
                  backgroundColor: 'rgba(255,255,255,0.35)',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                  {displayState === 'saving' && (
                    <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite', color: '#666', flexShrink: 0 }} />
                  )}
                  {displayState === 'error' && (
                    <AlertCircle size={16} style={{ color: '#c62828', flexShrink: 0 }} />
                  )}
                  {displayState === 'unsaved' && (
                    <AlertCircle size={16} style={{ color: '#ef6c00', flexShrink: 0 }} />
                  )}
                  {displayState === 'idle' && (
                    <CheckCircle size={16} style={{ color: '#2e7d32', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: displayTone || '#260000' }}>
                      {displayLabel}
                    </div>
                    {(displayDesc || elapsedText) && (
                      <div style={{ fontSize: '0.75rem', color: '#666', marginTop: 2 }}>
                        {displayDesc}
                        {elapsedText && (
                          <span style={{ marginLeft: displayDesc ? 8 : 0 }}>Last save {elapsedText} ago</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {displayState === 'unsaved' && (
                  <button
                    onClick={() => handleForceSave(activeUniverse.slug)}
                    style={{ ...buttonStyle('solid'), flexShrink: 0 }}
                  >
                    <Save size={14} /> Save now
                  </button>
                )}
                {lastTime && displayState !== 'saving' && displayState !== 'unsaved' && (
                  <div style={{
                    fontSize: '0.7rem',
                    color: '#666',
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  }}>
                    {formatWhen(lastTime)}
                  </div>
                )}
              </div>
            );
          })()}

          <div
            style={{
              fontSize: '0.82rem',
              fontWeight: 600,
              color: '#260000',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              userSelect: 'none'
            }}
            onClick={() => {
              const newValue = !showConnectionStats;
              setShowConnectionStats(newValue);
              try {
                localStorage.setItem(getStorageKey('redstring_show_connection_stats'), newValue.toString());
              } catch (e) {
                gfWarn('Failed to save connection stats visibility:', e);
              }
            }}
          >
            <ChevronRight
              size={16}
              style={{
                transition: 'transform 0.2s ease',
                transform: showConnectionStats ? 'rotate(90deg)' : 'rotate(0deg)'
              }}
            />
            Connection Stats (Advanced)
          </div>
          {showConnectionStats && (
            <ConnectionStats
              universe={activeUniverse}
              syncStatus={syncStatusFor(activeUniverse.slug)}
              isSlim={isSlim}
            />
          )}
        </div>
      )}

      <RepositorySelectionModal
        isOpen={showRepositoryManager}
        onClose={() => {
          setShowRepositoryManager(false);
          setRepositoryTargetSlug(null);
          setRepositoryIntent(null);
        }}
        onSelectRepository={handleRepositorySelect}
        onAddToManagedList={handleAddToManagedList}
        managedRepositories={managedRepositories}
        intent={repositoryIntent}
        onImportDiscovered={(universe, repoInfo) => handleImportDiscovered(universe, repoInfo)}
        onSyncDiscovered={(universe, repoInfo) => handleLinkDiscovered(universe, repoInfo)}
      />

      {/* Universe Linking Modal */}
      <UniverseLinkingModal
        isOpen={showUniverseLinking}
        onClose={() => {
          setShowUniverseLinking(false);
          setPendingUniverseLink(null);
        }}
        onSelectExisting={handleUniverseLinkingSelectExisting}
        onCreateNew={handleUniverseLinkingCreateNew}
        existingUniverses={serviceState.universes}
        suggestedName={pendingUniverseLink?.discovered?.name || pendingUniverseLink?.discovered?.slug || ''}
        repositoryName={pendingUniverseLink ? `${pendingUniverseLink.repo.user}/${pendingUniverseLink.repo.repo}` : ''}
      />

      {/* Universe Creation Mode Selection Modal */}
      <Modal
        isOpen={showUniverseCreationModeDialog}
        onClose={() => setShowUniverseCreationModeDialog(false)}
        title="Create New Universe"
        size="medium"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>
            Choose how you want to create your new universe:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={handleCreateUniverseFromScratch}
              style={{
                ...buttonStyle('outline'),
                width: '100%',
                padding: 20,
                justifyContent: 'flex-start',
                border: '2px solid #260000',
                backgroundColor: '#bdb5b5',
                borderRadius: 14,
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#d7d0d0';
                e.currentTarget.style.borderColor = '#260000';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#bdb5b5';
                e.currentTarget.style.borderColor = '#260000';
              }}
            >
              <Save size={22} style={{ flexShrink: 0 }} />
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: '#260000', fontSize: '1rem' }}>
                  Start from Scratch
                </div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>
                  Create a new empty universe and save it to a local file
                </div>
              </div>
            </button>

            <button
              onClick={handleCreateUniverseFromRepo}
              style={{
                ...buttonStyle('outline'),
                width: '100%',
                padding: 20,
                justifyContent: 'flex-start',
                border: '2px solid #260000',
                backgroundColor: '#bdb5b5',
                borderRadius: 14,
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#d7d0d0';
                e.currentTarget.style.borderColor = '#260000';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#bdb5b5';
                e.currentTarget.style.borderColor = '#260000';
              }}
            >
              <Github size={22} style={{ flexShrink: 0 }} />
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: '#260000', fontSize: '1rem' }}>
                  Import from Repository
                </div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>
                  Import an existing universe from a GitHub repository
                </div>
              </div>
            </button>
          </div>
        </div>
      </Modal>

      {/* Welcome modal removed in favor of existing AlphaOnboardingModal */}

      {/* Universe File Selection Modal */}
      <Modal
        isOpen={showUniverseFileSelector}
        onClose={() => {
          setShowUniverseFileSelector(false);
          setPendingRepoAttachment(null);
          setDiscoveredUniverseFiles([]);
          setRepositoryIntent(null);
        }}
        title={isUniverseImportMode ? 'Import Universe File' : 'Select Repository File'}
        size="medium"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>
            {isUniverseImportMode
              ? `Select a universe file from ${universeFileRepoLabel} to import as a new universe.`
              : `Choose how you want to sync ${universeFileRepoLabel} with your local universe.`}
          </p>

          {isUniverseImportMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
              {discoveredUniverseFiles.length === 0 && (
                <div style={{
                  padding: 14,
                  border: '1px dashed #979090',
                  borderRadius: 8,
                  backgroundColor: 'rgba(38,0,0,0.04)',
                  fontSize: '0.8rem',
                  color: '#444'
                }}>
                  No universe files were discovered in {universeFileRepoLabel}.
                </div>
              )}

              {discoveredUniverseFiles.map((file, idx) => (
                <div
                  key={idx}
                  style={{
                    border: '2px solid #260000',
                    backgroundColor: '#bdb5b5',
                    borderRadius: 14,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    maxWidth: '100%'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                    <GitBranch size={18} style={{ flexShrink: 0 }} />
                    <div style={{ textAlign: 'left', flex: 1, minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, color: '#260000', fontSize: '0.9rem' }}>
                        {file.name || file.slug || 'Universe File'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: 4, textDecoration: 'none' }}>
                        {file.path || file.location || 'Unknown path'}
                      </div>
                      <div style={{
                        display: 'flex',
                        gap: 12,
                        fontSize: '0.7rem',
                        color: '#1565c0',
                        marginTop: 6,
                        flexWrap: 'wrap'
                      }}>
                        {file.nodeCount !== undefined && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontWeight: 600 }}>{file.nodeCount}</span> nodes
                          </span>
                        )}
                        {file.connectionCount !== undefined && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontWeight: 600 }}>{file.connectionCount}</span> connections
                          </span>
                        )}
                        {file.graphCount !== undefined && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontWeight: 600 }}>{file.graphCount}</span> webs
                          </span>
                        )}
                      </div>
                      {file.lastModified && (
                        <div style={{ fontSize: '0.65rem', color: '#999', marginTop: 4 }}>
                          Last updated: {file.lastModified}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <PanelIconButton
                      icon={CloudDownload}
                      size={24}
                      title="Import Copy"
                      onClick={() => handleUniverseFileSelection(file)}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <button
                onClick={() => handleUniverseFileSelection('CREATE_NEW')}
                style={{
                  ...buttonStyle('solid'),
                  width: '100%',
                  padding: 16,
                  justifyContent: 'flex-start',
                  backgroundColor: '#7A0000',
                  color: '#ffffff',
                  border: '2px solid #7A0000'
                }}
              >
                <Plus size={18} />
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Push Local Data to New File</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>
                    Create a new universe file in {universeFileRepoLabel} with your current data
                  </div>
                </div>
              </button>

              {discoveredUniverseFiles.length > 0 && (
                <>
                  <div style={{
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: '#260000',
                    marginTop: 8,
                    paddingBottom: 8
                  }}>
                    Or sync with an existing file:
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                    {discoveredUniverseFiles.map((file, idx) => (
                      <div
                        key={idx}
                        style={{
                          border: '2px solid #260000',
                          backgroundColor: '#bdb5b5',
                          borderRadius: 14,
                          padding: 12,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          maxWidth: '100%'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                          <GitBranch size={18} style={{ flexShrink: 0 }} />
                          <div style={{ textAlign: 'left', flex: 1, minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                            <div style={{ fontWeight: 700, marginBottom: 6, color: '#260000', fontSize: '0.9rem' }}>
                              {file.name || file.slug || 'Unnamed Universe'}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: 4, textDecoration: 'none' }}>
                              {file.path || file.location || 'Unknown path'}
                            </div>
                            <div style={{
                              display: 'flex',
                              gap: 12,
                              fontSize: '0.7rem',
                              color: '#7A0000',
                              marginTop: 6,
                              flexWrap: 'wrap'
                            }}>
                              {file.nodeCount !== undefined && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontWeight: 600 }}>{file.nodeCount}</span> nodes
                                </span>
                              )}
                              {file.connectionCount !== undefined && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontWeight: 600 }}>{file.connectionCount}</span> connections
                                </span>
                              )}
                              {file.graphCount !== undefined && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontWeight: 600 }}>{file.graphCount}</span> webs
                                </span>
                              )}
                            </div>
                            {file.lastModified && (
                              <div style={{ fontSize: '0.65rem', color: '#999', marginTop: 4 }}>
                                Last updated: {file.lastModified}
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <PanelIconButton
                            icon={CloudDownload}
                            size={24}
                            title="Load from Repo"
                            onClick={() => handleLoadFromRepositoryFile(file)}
                          />
                          <PanelIconButton
                            icon={CloudUpload}
                            size={24}
                            title="Save to Repo"
                            onClick={() => handleSaveToSelectedRepositoryFile(file)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              onClick={() => {
                setShowUniverseFileSelector(false);
                setPendingRepoAttachment(null);
                setDiscoveredUniverseFiles([]);
                setShowRepositoryManager(true);
                setRepositoryIntent(null);
              }}
              style={buttonStyle('outline')}
            >
              ← Back to Repositories
            </button>
          </div>
        </div>
      </Modal>

      {/* Loading overlay removed - content renders immediately while data loads in background */}

      {/* Connecting screen - inline, scrollable, PieMenu-style */}
      {isConnecting && (
        <>
          <style>
            {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
          </style>
          <div
            style={{
              position: 'relative',
              width: '100%',
              padding: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <div
              style={{
                backgroundColor: '#DEDADA',
                border: '3px solid #8B0000',
                borderRadius: '16px',
                padding: '16px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: '0.95rem',
                color: '#8B0000',
                fontWeight: 600,
                boxShadow: '0 2px 8px rgba(139, 0, 0, 0.2)'
              }}
            >
              <Loader2
                size={20}
                color="#8B0000"
                style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}
              />
              <span>Connecting...</span>
            </div>
          </div>
        </>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setConfirmDialog(null)}
          {...confirmDialog}
        />
      )}
      {conflictDialog && (
        <LocalFileConflictDialog
          isOpen={true}
          universeName={conflictDialog.universeName}
          existingOption={conflictDialog.existing}
          incomingOption={conflictDialog.incoming}
          onChooseExisting={() => handleResolveLocalConflict('existing')}
          onChooseIncoming={() => handleResolveLocalConflict('incoming')}
          onCancel={handleCancelLocalConflict}
        />
      )}
      {slotConflict && (
        <ConflictResolutionModal
          isOpen={true}
          onClose={handleCancelSlotConflict}
          onSelectLocal={() => handleResolveSlotConflict('local')}
          onSelectGit={() => handleResolveSlotConflict('git')}
          localData={slotConflict.localData}
          gitData={slotConflict.gitData}
          universeName={slotConflict.universeName}
          requiresPrimarySelection={slotConflict.requiresPrimarySelection}
        />
      )}

      {/* Auth Expired Dialog */}
      {authExpiredDialog && (
        <ConfirmDialog
          isOpen={true}
          title="GitHub Authentication Expired"
          message={authExpiredDialog.message}
          details="Your GitHub authentication has expired or been revoked. Please reconnect to continue syncing with GitHub."
          variant="error"
          confirmLabel="Reconnect Now"
          cancelLabel="Dismiss"
          onConfirm={() => {
            setAuthExpiredDialog(null);
            // Scroll to auth section to make it visible
            if (typeof window !== 'undefined') {
              setTimeout(() => {
                const authSection = document.querySelector('[data-auth-section="true"]');
                if (authSection) {
                  authSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }, 100);
            }
          }}
          onCancel={() => {
            setAuthExpiredDialog(null);
          }}
        />
      )}
    </div>
  );
};

export default GitNativeFederation;

// Optional displayName used by some tab managers
GitNativeFederation.displayName = 'Federation';
