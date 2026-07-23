import React, { useCallback, useEffect, useRef, useState } from 'react';
import CanvasModal from './CanvasModal';
import AuthSection from './universe-manager/AuthSection.jsx';
import GitHubDeviceFlowModal from './modals/GitHubDeviceFlowModal.jsx';
import { isElectron } from '../utils/fileAccessAdapter.js';
import {
  FolderOpen, Folder, ArrowRightCircle, ArrowRight, ArrowLeft, Github, Lock, Globe,
  Loader2, CheckCircle, AlertCircle, Circle, RefreshCw, Save, X, Star, Upload, Key
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';
import { useGitHubDeviceFlow } from '../hooks/useGitHubDeviceFlow.js';
import { persistentAuth } from '../services/persistentAuth.js';
import universeBackend from '../services/universeBackend.js';
import { getStorageKey } from '../utils/storageUtils.js';
import { getStatusColors } from '../utils/statusColors.js';
import {
  saveWorkspaceHandle, getWorkspaceHandle, clearWorkspaceHandle,
  checkWorkspacePermission, requestWorkspacePermission
} from '../services/workspaceFolderService.js';
import { runPendingCallbacks, recheckAppOnFocus } from '../services/githubAuthCallbacks.js';
import {
  connectOAuth as ghConnectOAuth,
  connectApp as ghConnectApp,
  detectAppInstall as ghDetectAppInstall,
  disconnectOAuth as ghDisconnectOAuth,
  disconnectApp as ghDisconnectApp
} from '../services/githubAuthFlows.js';
import { listUserRepos } from '../services/githubRepoService.js';
import {
  fillGitSlot, addLocalFileSlot, resolveLocalFileHandle, GIT_ONBOARDING_TASKS
} from '../services/gitOnboardingService.js';

/**
 * Storage Setup Modal — first-run onboarding.
 *
 * Mirrors the Universes panel's data model: the user sets up ONE universe and
 * fills its storage slots — a GitHub repository slot and/or a local .redstring
 * file slot — rather than creating a separate universe per storage type. The
 * universe shell is created lazily the moment the first slot is filled (so
 * nothing exists until the user actually links something), and every later
 * slot fill attaches to that same universe.
 *
 * Steps:
 *   slots         — the hub: name the universe (once), set an optional
 *                   workspace folder, then add a Repository and/or Local File
 *                   slot. Source of truth follows the panel rule (git wins).
 *   git-connect   — Accounts & Access (OAuth + GitHub App; web redirects /
 *                   Electron device flow; existing App installs are discovered
 *                   before ever showing the install page)
 *   git-repo      — create "Redstring-Universes" (preferred) or link existing
 *   git-finishing — repo → universe → attach → push → promote git checklist
 *
 * The web OAuth/App-install redirects unload the page; sessionStorage resume
 * flags (redstring_onboarding_resume/_step/_universe_name) reopen the wizard at
 * git-connect, with the universe name preserved, on return.
 */
const AUTH_EVENTS = ['tokenStored', 'tokenValidated', 'authExpired', 'appInstallationStored', 'appInstallationCleared'];

const readWizardResumeStep = () => {
  try {
    if (
      sessionStorage.getItem('redstring_onboarding_resume') === 'true' &&
      sessionStorage.getItem('redstring_onboarding_step') === 'git-connect'
    ) {
      return 'git-connect';
    }
  } catch { /* ignore */ }
  return 'slots';
};

const readResumeUniverseName = () => {
  try {
    const stored = sessionStorage.getItem('redstring_onboarding_universe_name');
    if (stored && stored.trim()) return stored;
  } catch { /* ignore */ }
  return 'Universe';
};

const clearWizardResumeFlags = () => {
  try {
    sessionStorage.removeItem('redstring_onboarding_resume');
    sessionStorage.removeItem('redstring_onboarding_step');
    sessionStorage.removeItem('redstring_onboarding_universe_name');
  } catch { /* ignore */ }
};

const StorageSetupModal = ({
  isVisible,
  onClose,
  onUniverseReady = null, // ({ slug, name, warnings }) => void — a slot was filled; load it into the shell, keep modal open
  onFinishOnboarding = null, // () => void — finalize: mark seen + close (user is already in a universe)
  onBrowserStorageSelected = null,
  ...canvasModalProps
}) => {
  const theme = useTheme();
  const statusColors = getStatusColors(theme.darkMode);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));

  // Step: 'slots' (hub) | 'git-connect' | 'git-repo' | 'git-finishing'
  const [step, setStep] = useState(readWizardResumeStep);
  const [universeName, setUniverseName] = useState(readResumeUniverseName);

  // The one universe being set up. Its slug is assigned on the first slot fill
  // and reused by every later fill so all slots land on the same universe.
  const universeSlugRef = useRef(null);
  // Which slots are filled this session, for the hub's card badges.
  const [slotStatus, setSlotStatus] = useState({
    git: { done: false, label: null },
    local: { done: false, label: null }
  });
  // Current source of truth for the universe ('git' | 'local' | 'browser').
  const [sourceOfTruth, setSourceOfTruth] = useState('browser');
  const anySlotFilled = slotStatus.git.done || slotStatus.local.done;
  const bothSlotsFilled = slotStatus.git.done && slotStatus.local.done;

  // --- Workspace folder (global location; where local files land) ---
  const [workspaceFolder, setWorkspaceFolder] = useState(() => {
    try { return localStorage.getItem('redstring_workspace_folder_name') || null; } catch { return null; }
  });
  const [workspaceNeedsPermission, setWorkspaceNeedsPermission] = useState(false);

  // --- Local file slot ---
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  // --- GitHub wizard state ---
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
  const [repoChoice, setRepoChoice] = useState('create'); // 'create' | 'existing'
  const [newRepoName, setNewRepoName] = useState('Redstring-Universes');
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [showRepoList, setShowRepoList] = useState(false);
  const [repoList, setRepoList] = useState(null);
  const [repoListLoading, setRepoListLoading] = useState(false);
  const [repoListError, setRepoListError] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [taskStates, setTaskStates] = useState({});
  const [finishError, setFinishError] = useState(null);
  const [finishRunning, setFinishRunning] = useState(false);

  const { deviceFlowState, runDeviceFlow, cancelDeviceFlow } = useGitHubDeviceFlow();

  const hasOAuth = !!authStatus?.hasOAuthTokens;
  const hasApp = !!authStatus?.hasGitHubApp;
  const statusBadge = hasOAuth && hasApp
    ? { label: 'Fully Connected', tone: statusColors.success }
    : (hasOAuth || hasApp)
      ? { label: 'Partially Connected', tone: statusColors.info }
      : { label: 'Not Connected', tone: statusColors.error };

  // Only use compact layout on truly small screens (mobile)
  const isCompactLayout = viewportSize.width <= 500;
  const modalWidth = isCompactLayout
    ? Math.min(Math.max(viewportSize.width - 24, 320), 540)
    : 600;
  // Fixed height so every step renders in the same frame (and centering is
  // exact — CanvasModal only truly centers a numeric-height modal). Sized to
  // fit the tallest step (git-connect's AuthSection); denser steps on small
  // screens scroll inside the content area. Clamped to the viewport.
  const modalHeight = isCompactLayout
    ? Math.min(Math.max(viewportSize.height - 24, 440), 620)
    : Math.min(Math.max(viewportSize.height - 40, 420), 520);

  const showBrowserStorageOption = !isElectron();

  // No File System Access API (mobile browsers): folder/local-file storage
  // can't work, so git becomes the only storage path.
  const gitFirst = !isElectron() &&
    typeof window !== 'undefined' && !('showSaveFilePicker' in window);
  const canLinkLocalFile = isElectron() ||
    (typeof window !== 'undefined' && 'showSaveFilePicker' in window);
  const showLocalSlot = canLinkLocalFile;
  const showWorkspaceRow = canLinkLocalFile;
  const showGitOption = !!onUniverseReady;
  // Once a slot exists, the universe is created with its name — lock the input.
  const nameLocked = anySlotFilled;

  React.useEffect(() => {
    const handleResize = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const refreshAuthStatus = useCallback(() => {
    try { setAuthStatus(persistentAuth.getAuthStatus()); } catch { /* ignore */ }
  }, []);

  // Keep auth status live while the modal is visible (same subscription
  // pattern as the Universes panel).
  useEffect(() => {
    if (!isVisible) return undefined;
    refreshAuthStatus();
    const listener = () => refreshAuthStatus();
    AUTH_EVENTS.forEach((ev) => persistentAuth.on(ev, listener));
    return () => AUTH_EVENTS.forEach((ev) => persistentAuth.off(ev, listener));
  }, [isVisible, refreshAuthStatus]);

  // Persist the OAuth-backup preference to the same key the panel uses.
  useEffect(() => {
    try {
      localStorage.setItem(getStorageKey('allow_oauth_backup'), allowOAuthBackup ? 'true' : 'false');
    } catch { /* ignore */ }
  }, [allowOAuthBackup]);

  // Restore the workspace folder handle/permission state on mount.
  useEffect(() => {
    if (!isVisible || !showWorkspaceRow) return;
    (async () => {
      try {
        const handle = await getWorkspaceHandle();
        if (handle) {
          const name = typeof handle === 'string' ? handle.split(/[/\\]/).pop() : handle.name;
          if (name) setWorkspaceFolder(name);
          const permState = await checkWorkspacePermission();
          if (permState && permState !== 'granted') setWorkspaceNeedsPermission(true);
        }
      } catch (e) {
        console.warn('[StorageSetupModal] Failed to restore workspace folder handle:', e);
      }
    })();
  }, [isVisible, showWorkspaceRow]);

  // git-connect step: process any pending OAuth/App redirect callback
  // (single-flight — safe alongside the panel), then check for an existing App
  // install so we never prompt an install the user already has. Also re-detect
  // on tab focus (covers install-in-another-tab).
  useEffect(() => {
    if (!isVisible || step !== 'git-connect') return undefined;
    let cancelled = false;

    (async () => {
      try {
        const { oauth, app } = await runPendingCallbacks();
        if (cancelled) return;
        if (oauth.error || app.error) {
          setAuthNotice({ type: 'error', message: oauth.error || app.error });
        }
        refreshAuthStatus();
      } catch (err) {
        console.warn('[StorageSetupModal] Pending auth callback processing failed:', err?.message || err);
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
  }, [isVisible, step, refreshAuthStatus]);

  // Auto-detect an existing GitHub App install once OAuth is connected, using
  // forceAppDiscovery (same path as the manual "Detect install" button, which
  // clears any stale sticky-disconnect flag — correct during onboarding). On
  // Electron discovery needs a device-flow token, so this no-ops there.
  const appDiscoveryTriedRef = useRef(false);
  useEffect(() => {
    if (!isVisible || step !== 'git-connect' || !hasOAuth || hasApp) {
      appDiscoveryTriedRef.current = false;
      return undefined;
    }
    if (appDiscoveryTriedRef.current) return undefined;
    appDiscoveryTriedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await persistentAuth.forceAppDiscovery?.();
        if (!cancelled) refreshAuthStatus();
      } catch (err) {
        console.warn('[StorageSetupModal] App auto-discovery failed:', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [isVisible, step, hasOAuth, hasApp, refreshAuthStatus]);

  // --- Workspace folder handlers (mirror UniversesList) ---

  const handlePickWorkspaceFolder = async () => {
    try {
      if (window.electron?.fileSystem?.pickFolder) {
        const folderPath = await window.electron.fileSystem.pickFolder();
        if (!folderPath) return;
        setWorkspaceFolder(folderPath.split(/[/\\]/).pop());
        setWorkspaceNeedsPermission(false);
        await saveWorkspaceHandle(folderPath);
        return;
      }
      if (!('showDirectoryPicker' in window)) {
        alert('Directory picker is not supported in this browser.');
        return;
      }
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setWorkspaceFolder(handle.name);
      setWorkspaceNeedsPermission(false);
      await saveWorkspaceHandle(handle);
    } catch (e) {
      if (e.name !== 'AbortError') console.error('[StorageSetupModal] Failed to pick workspace folder:', e);
    }
  };

  const handleClearWorkspaceFolder = async () => {
    setWorkspaceFolder(null);
    setWorkspaceNeedsPermission(false);
    await clearWorkspaceHandle();
  };

  const handleRegrantWorkspacePermission = async () => {
    try {
      const result = await requestWorkspacePermission();
      if (result === 'granted') setWorkspaceNeedsPermission(false);
    } catch (e) {
      console.error('[StorageSetupModal] Failed to re-grant workspace permission:', e);
    }
  };

  // --- Slot fill handlers ---

  const handleAddRepository = () => {
    // Arm the resume flags BEFORE any redirect can happen — the web OAuth and
    // App-install flows unload the page, and these flags (plus the persisted
    // universe name) bring the user back into the wizard at git-connect.
    try {
      sessionStorage.setItem('redstring_onboarding_resume', 'true');
      sessionStorage.setItem('redstring_onboarding_step', 'git-connect');
      sessionStorage.setItem('redstring_onboarding_universe_name', (universeName || 'Universe').trim() || 'Universe');
    } catch { /* ignore */ }
    setAuthNotice(null);
    // Already fully connected from a prior slot fill this session? Skip to repo.
    setStep((hasOAuth && hasApp) ? 'git-repo' : 'git-connect');
  };

  const handleAddLocalFile = async () => {
    setLocalBusy(true);
    setLocalError(null);
    const finalName = (universeName && universeName.trim()) ? universeName.trim() : 'Universe';
    // Resolve the handle NOW, while we still hold the click's user activation.
    const handle = await resolveLocalFileHandle(finalName);
    if (!handle) {
      setLocalBusy(false);
      setLocalError('No file location chosen.');
      return;
    }
    const fileName = isElectron() && typeof handle === 'string'
      ? handle.split(/[/\\]/).pop()
      : (handle?.name || `${finalName}.redstring`);
    try {
      const result = await addLocalFileSlot({
        universeName: finalName,
        localFileHandle: handle,
        reuseSlug: universeSlugRef.current
      });
      universeSlugRef.current = result.slug;
      setSlotStatus((prev) => ({ ...prev, local: { done: true, label: fileName } }));
      // Local becomes source of truth only if git hasn't already claimed it.
      setSourceOfTruth((prev) => (prev === 'git' ? 'git' : 'local'));
      onUniverseReady?.({ slug: result.slug, name: finalName, warnings: result.warnings });
    } catch (err) {
      if (err?.slug) universeSlugRef.current = err.slug;
      setLocalError(err.message || 'Could not link a local file.');
    } finally {
      setLocalBusy(false);
    }
  };

  const handleBrowserStorageChoice = () => {
    if (onBrowserStorageSelected) onBrowserStorageSelected();
  };

  const handleToggleSourceOfTruth = async (type) => {
    if (!universeSlugRef.current || sourceOfTruth === type) return;
    try {
      await universeBackend.setSourceOfTruth(universeSlugRef.current, type);
      setSourceOfTruth(type);
    } catch (err) {
      console.warn('[StorageSetupModal] Failed to set source of truth:', err?.message || err);
    }
  };

  // --- GitHub wizard handlers (thin wrappers over githubAuthFlows) ---

  const handleWizardGitHubAuth = async () => {
    try {
      setIsConnecting(true);
      setAuthNotice(null);
      const result = await ghConnectOAuth({ runDeviceFlow });
      if (result?.connected) refreshAuthStatus();
    } catch (err) {
      setAuthNotice({ type: 'error', message: `OAuth authentication failed: ${err.message}` });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleWizardGitHubApp = async () => {
    try {
      setIsConnecting(true);
      setAuthNotice(null);
      const result = await ghConnectApp({ runDeviceFlow });
      refreshAuthStatus();
      if (result?.connected) {
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

  const handleWizardAppDetect = async () => {
    try {
      setIsConnecting(true);
      setAuthNotice(null);
      const result = await ghDetectAppInstall({ runDeviceFlow });
      refreshAuthStatus();
      if (result?.found) {
        setAuthNotice({ type: 'info', message: 'GitHub App detected and linked.' });
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

  const handleWizardOAuthDisconnect = async () => {
    try {
      await ghDisconnectOAuth();
      refreshAuthStatus();
    } catch (err) {
      setAuthNotice({ type: 'error', message: `Failed to disconnect: ${err.message}` });
    }
  };

  const handleWizardAppDisconnect = async () => {
    try {
      await ghDisconnectApp();
      refreshAuthStatus();
    } catch (err) {
      setAuthNotice({ type: 'error', message: `Failed to disconnect App: ${err.message}` });
    }
  };

  const loadRepoList = async () => {
    setRepoListLoading(true);
    setRepoListError(null);
    try {
      const repos = await listUserRepos();
      setRepoList(Array.isArray(repos) ? repos : []);
    } catch (err) {
      setRepoListError(err.message);
    } finally {
      setRepoListLoading(false);
    }
  };

  const startFinishing = async () => {
    const finalName = (universeName && universeName.trim()) ? universeName.trim() : 'Universe';
    setStep('git-finishing');
    setFinishError(null);
    setFinishRunning(true);
    setTaskStates({});
    try {
      const result = await fillGitSlot({
        repoChoice,
        repoName: newRepoName,
        isPrivate: newRepoPrivate,
        existingRepo: selectedRepo,
        universeName: finalName,
        authMethod: hasOAuth ? 'oauth' : 'github-app',
        reuseSlug: universeSlugRef.current,
        onProgress: (taskId, status, detail) => {
          setTaskStates((prev) => ({ ...prev, [taskId]: { status, detail } }));
        }
      });
      universeSlugRef.current = result.slug;
      clearWizardResumeFlags();
      setFinishRunning(false);
      setSlotStatus((prev) => ({ ...prev, git: { done: true, label: `@${result.owner}/${result.repo}` } }));
      setSourceOfTruth('git'); // git wins as source of truth when present
      onUniverseReady?.({ slug: result.slug, name: finalName, warnings: result.warnings });
      // Reset the git sub-state and return to the hub.
      setSelectedRepo(null);
      setShowRepoList(false);
      setStep('slots');
    } catch (err) {
      if (err?.slug) universeSlugRef.current = err.slug;
      setFinishError(err.message || 'Setup failed');
      setFinishRunning(false);
    }
  };

  const leaveGitFlow = () => {
    clearWizardResumeFlags();
    setStep('slots');
  };

  // --- Shared UI atoms (existing modal idiom) ---

  const primaryButtonStyle = (enabled) => ({
    width: '100%',
    padding: isCompactLayout ? '10px' : '12px',
    backgroundColor: enabled ? (theme.darkMode ? '#EFE8E5' : '#260000') : (theme.darkMode ? 'rgba(255,255,255,0.1)' : '#ccc'),
    color: enabled && theme.darkMode ? '#260000' : '#EFE8E5',
    border: 'none',
    borderRadius: '6px',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontSize: isCompactLayout ? '0.9rem' : '1rem',
    fontWeight: 'bold',
    fontFamily: "'EmOne', sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px'
  });

  const backButton = (onBack) => (
    <button
      onClick={onBack}
      style={{
        background: 'none',
        border: 'none',
        color: theme.canvas.textPrimary,
        opacity: 0.7,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '0.85rem',
        fontFamily: "'EmOne', sans-serif",
        padding: '4px 0',
        marginBottom: '8px'
      }}
    >
      <ArrowLeft size={16} />
      Back
    </button>
  );

  const noticeBanner = authNotice && (
    <div style={{
      marginTop: '12px',
      padding: '8px 12px',
      borderRadius: '6px',
      fontSize: '0.8rem',
      fontFamily: "'EmOne', sans-serif",
      border: `1px solid ${theme.canvas.border}`,
      color: authNotice.type === 'error' ? statusColors.error : theme.canvas.textPrimary,
      backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA'
    }}>
      {authNotice.message}
    </div>
  );

  const cardBadge = (label, tone) => (
    <span style={{
      fontSize: '0.68rem',
      fontWeight: 700,
      padding: '2px 7px',
      borderRadius: 10,
      color: tone,
      border: `1px solid ${tone}`,
      fontFamily: "'EmOne', sans-serif",
      whiteSpace: 'nowrap'
    }}>
      {label}
    </span>
  );

  // A guided storage-slot card (Repository / Local File) that acts on the one
  // universe. When filled it shows a status badge instead of the action button.
  const renderSlotCard = ({ icon, title, description, done, doneBadge, doneDetail, actionLabel, onAction, busy, error, actionSolid }) => (
    <div
      style={{
        backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
        border: `2px solid ${done ? statusColors.success : theme.canvas.border}`,
        borderRadius: '8px',
        padding: isCompactLayout ? '10px 12px' : '12px 14px',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        transition: 'all 0.2s ease'
      }}
    >
      <div style={{ flexShrink: 0, color: theme.canvas.textPrimary, display: 'flex', alignItems: 'center' }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{
            margin: 0,
            fontSize: isCompactLayout ? '0.92rem' : '1rem',
            fontWeight: 'bold',
            color: theme.canvas.textPrimary,
            fontFamily: "'EmOne', sans-serif"
          }}>
            {title}
          </h3>
          {done && cardBadge(doneBadge, statusColors.success)}
        </div>
        <p style={{
          margin: '2px 0 0 0',
          fontSize: isCompactLayout ? '0.74rem' : '0.78rem',
          color: theme.canvas.textSecondary,
          lineHeight: '1.35',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {done ? (doneDetail || description) : description}
        </p>
        {!done && error && (
          <div style={{ margin: '4px 0 0 0', fontSize: '0.74rem', color: statusColors.error, fontFamily: "'EmOne', sans-serif" }}>
            {error}
          </div>
        )}
      </div>
      {!done && (
        <button
          onClick={onAction}
          disabled={busy}
          style={{
            flexShrink: 0,
            padding: isCompactLayout ? '8px 12px' : '9px 14px',
            backgroundColor: actionSolid ? (theme.darkMode ? '#EFE8E5' : '#260000') : 'transparent',
            color: actionSolid ? (theme.darkMode ? '#260000' : '#EFE8E5') : theme.canvas.textPrimary,
            border: actionSolid ? 'none' : `2px solid ${theme.canvas.border}`,
            borderRadius: '6px',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: isCompactLayout ? '0.8rem' : '0.85rem',
            fontWeight: 'bold',
            fontFamily: "'EmOne', sans-serif",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
            opacity: busy ? 0.7 : 1
          }}
        >
          {busy ? <Loader2 size={16} style={{ animation: 'rs-onboarding-spin 1s linear infinite' }} /> : null}
          {busy ? 'Setting up…' : actionLabel}
        </button>
      )}
    </div>
  );

  const renderSlotsStep = () => (
    <>
      <style>{'@keyframes rs-onboarding-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: isCompactLayout ? '10px' : '12px', flexShrink: 0 }}>
        <h1 style={{
          margin: '0 0 2px 0',
          color: theme.accent.primary,
          fontSize: isCompactLayout ? '1.25rem' : '1.45rem',
          fontWeight: '600',
          fontFamily: "'EmOne', sans-serif",
          letterSpacing: '0.05em'
        }}>
          Welcome to Redstring
        </h1>
        <h2 style={{
          margin: 0,
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '0.95rem' : '1.05rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          {anySlotFilled ? 'Add another place to save, or get connected' : 'Set up your first universe'}
        </h2>
      </div>

      {/* Universe name */}
      <div style={{ marginBottom: '10px', flexShrink: 0 }}>
        <label style={{
          display: 'block',
          marginBottom: '4px',
          fontWeight: 'bold',
          fontSize: '0.76rem',
          color: theme.canvas.textPrimary,
          fontFamily: "'EmOne', sans-serif"
        }}>
          Universe name
        </label>
        {nameLocked ? (
          <div style={{
            padding: '8px 12px',
            fontSize: '0.95rem',
            fontWeight: 'bold',
            borderRadius: '8px',
            border: `2px solid ${theme.canvas.border}`,
            backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
            color: theme.canvas.textPrimary,
            fontFamily: "'EmOne', sans-serif"
          }}>
            {universeName || 'Universe'}
          </div>
        ) : (
          <input
            type="text"
            value={universeName}
            onChange={(e) => setUniverseName(e.target.value)}
            placeholder="Universe"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '0.95rem',
              borderRadius: '8px',
              border: `2px solid ${theme.canvas.border}`,
              backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
              color: theme.canvas.textPrimary,
              boxSizing: 'border-box',
              fontFamily: "'EmOne', sans-serif",
              outline: 'none'
            }}
          />
        )}
      </div>

      {/* Workspace folder (desktop) — global location where local files land */}
      {showWorkspaceRow && (
        <div style={{ marginBottom: '10px', flexShrink: 0 }}>
          <div style={{
            padding: '10px 12px',
            backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            borderRadius: 6,
            border: `1px solid ${theme.canvas.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              {workspaceFolder
                ? <FolderOpen size={18} color={theme.accent.primary} />
                : <Folder size={18} color={theme.canvas.textSecondary} />}
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: theme.canvas.textPrimary, fontFamily: "'EmOne', sans-serif" }}>
                  Workspace Folder
                </span>
                <span style={{
                  fontSize: '0.65rem',
                  color: workspaceFolder ? theme.canvas.textPrimary : theme.canvas.textSecondary,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontFamily: "'EmOne', sans-serif"
                }}>
                  {workspaceFolder || 'Recommended — where local files are kept'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button
                onClick={handlePickWorkspaceFolder}
                title={workspaceFolder ? 'Change workspace folder' : 'Choose workspace folder'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 9px', borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${theme.canvas.border}`,
                  background: 'transparent', color: theme.canvas.textPrimary,
                  fontSize: '0.72rem', fontFamily: "'EmOne', sans-serif"
                }}
              >
                {workspaceFolder ? <FolderOpen size={14} /> : <Upload size={14} />}
                {workspaceFolder ? 'Change' : 'Choose'}
              </button>
              {workspaceFolder && (
                <button
                  onClick={handleClearWorkspaceFolder}
                  title="Unlink workspace folder"
                  style={{
                    display: 'flex', alignItems: 'center',
                    padding: '5px', borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${theme.canvas.border}`,
                    background: 'transparent', color: theme.canvas.textPrimary
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          {workspaceFolder && workspaceNeedsPermission && (
            <div style={{
              marginTop: 6, padding: '6px 10px',
              backgroundColor: theme.alert.warning.bg,
              borderRadius: 6, border: `1px solid ${theme.alert.warning.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              fontSize: '0.66rem', color: theme.alert.warning.text, fontFamily: "'EmOne', sans-serif"
            }}>
              <span>Folder access was lost on reload.</span>
              <button
                onClick={handleRegrantWorkspacePermission}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${theme.alert.warning.text}`,
                  background: 'transparent', color: theme.alert.warning.text,
                  fontSize: '0.62rem', fontFamily: "'EmOne', sans-serif"
                }}
              >
                <Key size={12} /> Re-grant
              </button>
            </div>
          )}
        </div>
      )}

      {/* Storage slots for this one universe */}
      <div style={{ flexShrink: 0 }}>
        {showGitOption && renderSlotCard({
          icon: <Github size={22} />,
          title: gitFirst ? 'Sync with GitHub' : 'GitHub Repository',
          description: 'Save to a GitHub repository. Works on any device.',
          done: slotStatus.git.done,
          doneBadge: 'Connected ✓',
          doneDetail: slotStatus.git.label,
          actionLabel: 'Add Repository',
          onAction: handleAddRepository,
          actionSolid: gitFirst
        })}

        {showLocalSlot && renderSlotCard({
          icon: <Save size={22} />,
          title: 'Local File',
          description: 'Keep a .redstring file in your workspace folder.',
          done: slotStatus.local.done,
          doneBadge: 'Saved ✓',
          doneDetail: slotStatus.local.label,
          actionLabel: 'Add Local File',
          onAction: handleAddLocalFile,
          busy: localBusy,
          error: localError,
          actionSolid: false
        })}

        {/* Source of truth line, once at least one slot is filled */}
        {anySlotFilled && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginBottom: '10px', marginTop: '2px', fontSize: '0.78rem',
            color: theme.canvas.textPrimary, fontFamily: "'EmOne', sans-serif"
          }}>
            <span style={{ fontWeight: 600 }}>Source of truth:</span>
            {bothSlotsFilled ? (
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { key: 'git', label: 'GitHub' },
                  { key: 'local', label: 'Local File' }
                ].map(({ key, label }) => {
                  const active = sourceOfTruth === key;
                  return (
                    <button
                      key={key}
                      onClick={() => handleToggleSourceOfTruth(key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                        border: `1px solid ${theme.canvas.brand}`,
                        backgroundColor: active ? theme.canvas.brand : 'transparent',
                        color: active ? '#DEDADA' : theme.canvas.brand,
                        fontSize: '0.72rem', fontWeight: 600, fontFamily: "'EmOne', sans-serif"
                      }}
                    >
                      <Star size={11} fill={active ? '#DEDADA' : 'none'} />
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span style={{ color: theme.accent.primary, fontWeight: 700 }}>
                {sourceOfTruth === 'git' ? 'GitHub' : sourceOfTruth === 'local' ? 'Local File' : 'Browser'}
              </span>
            )}
          </div>
        )}

        {/* Skip (browser) — only before the user is in any universe */}
        {showBrowserStorageOption && !anySlotFilled && (
          <div
            style={{
              backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
              border: `2px solid ${theme.canvas.border}`,
              borderRadius: '8px',
              padding: isCompactLayout ? '10px 12px' : '12px 14px',
              cursor: 'pointer'
            }}
            onClick={handleBrowserStorageChoice}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ArrowRightCircle size={22} color={theme.canvas.textPrimary} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{
                  margin: 0, fontSize: '0.95rem', fontWeight: 'bold',
                  color: theme.canvas.textPrimary, fontFamily: "'EmOne', sans-serif"
                }}>
                  Skip For Now
                </h3>
                <div style={{ fontStyle: 'italic', color: theme.canvas.textSecondary, fontSize: '0.74rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Finish setup later on the Universes tab.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Get Connected — finishes onboarding once at least one slot is filled */}
      {anySlotFilled && (
        <div style={{ marginTop: isCompactLayout ? '6px' : '8px', flexShrink: 0 }}>
          <button
            onClick={() => onFinishOnboarding?.()}
            style={{ ...primaryButtonStyle(true), padding: isCompactLayout ? '10px' : '12px' }}
          >
            Get Connected
            <ArrowRight size={18} />
          </button>
        </div>
      )}
    </>
  );

  // --- GitHub wizard steps ---

  const renderGitConnectStep = () => (
    <>
      {backButton(leaveGitFlow)}
      <div style={{ textAlign: 'center', marginBottom: '16px', flexShrink: 0 }}>
        <h2 style={{
          margin: '0 0 8px 0',
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '1.2rem' : '1.5rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Connect GitHub
        </h2>
        <p style={{ color: theme.canvas.textPrimary, opacity: 0.8, margin: 0, fontSize: '0.9rem' }}>
          Redstring uses GitHub OAuth to browse your repositories and the GitHub App to sync your universes.
        </p>
      </div>

      <AuthSection
        statusBadge={statusBadge}
        hasApp={hasApp}
        hasOAuth={hasOAuth}
        dataAuthMethod={hasOAuth ? 'oauth' : (hasApp ? 'github-app' : null)}
        isConnecting={isConnecting}
        allowOAuthBackup={allowOAuthBackup}
        onSetAllowOAuthBackup={setAllowOAuthBackup}
        onGitHubAuth={handleWizardGitHubAuth}
        onGitHubDisconnect={handleWizardOAuthDisconnect}
        onGitHubApp={handleWizardGitHubApp}
        onGitHubAppDisconnect={handleWizardAppDisconnect}
        onGitHubAppDetect={handleWizardAppDetect}
        isSlim={isCompactLayout}
      />

      {noticeBanner}

      <div style={{ marginTop: '16px' }}>
        <button
          onClick={() => setStep('git-repo')}
          disabled={!(hasOAuth && hasApp)}
          style={primaryButtonStyle(hasOAuth && hasApp)}
        >
          Continue
          <ArrowRight size={18} />
        </button>
        {!(hasOAuth && hasApp) && (
          <div style={{
            marginTop: '8px',
            textAlign: 'center',
            fontSize: '0.78rem',
            color: theme.canvas.textSecondary,
            fontFamily: "'EmOne', sans-serif"
          }}>
            {!hasOAuth
              ? 'Connect GitHub OAuth to continue.'
              : 'Install the GitHub App for auto-sync — it will be detected automatically.'}
          </div>
        )}
        {hasOAuth && !hasApp && (
          <button
            onClick={() => setStep('git-repo')}
            style={{
              display: 'block',
              margin: '10px auto 0',
              background: 'none',
              border: 'none',
              color: theme.canvas.textSecondary,
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: '0.78rem',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            Continue with OAuth only
          </button>
        )}
      </div>
    </>
  );

  const repoCardStyle = () => ({
    backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
    border: `2px solid ${theme.canvas.border}`,
    borderRadius: '8px',
    padding: isCompactLayout ? '14px' : '18px',
    marginBottom: '14px'
  });

  const renderGitRepoStep = () => (
    <>
      {backButton(() => setStep('git-connect'))}
      <div style={{ textAlign: 'center', marginBottom: '16px', flexShrink: 0 }}>
        <h2 style={{
          margin: '0 0 8px 0',
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '1.2rem' : '1.5rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Choose a Repository
        </h2>
        <p style={{ color: theme.canvas.textPrimary, opacity: 0.8, margin: 0, fontSize: '0.9rem' }}>
          <strong>{universeName || 'Universe'}</strong> will live as a .redstring file inside this repository.
        </p>
      </div>

      {/* Preferred: create a new repo */}
      <div style={repoCardStyle()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <Github size={22} color={theme.canvas.textPrimary} />
          <h3 style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: 'bold',
            color: theme.canvas.textPrimary,
            fontFamily: "'EmOne', sans-serif"
          }}>
            Create a New Repository
          </h3>
        </div>
        <input
          type="text"
          value={newRepoName}
          onChange={(e) => setNewRepoName(e.target.value.replace(/[^A-Za-z0-9._-]/g, '-'))}
          placeholder="Redstring-Universes"
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: '0.95rem',
            borderRadius: '6px',
            border: `2px solid ${theme.canvas.border}`,
            backgroundColor: theme.canvas.bg,
            color: theme.canvas.textPrimary,
            boxSizing: 'border-box',
            fontFamily: "'EmOne', sans-serif",
            marginBottom: '10px',
            outline: 'none'
          }}
        />
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '0.8rem',
          color: theme.canvas.textPrimary,
          fontFamily: "'EmOne', sans-serif",
          marginBottom: '12px'
        }}>
          <input
            type="checkbox"
            checked={newRepoPrivate}
            onChange={(e) => setNewRepoPrivate(e.target.checked)}
          />
          <Lock size={13} />
          Private repository
        </label>
        <button
          onClick={() => {
            if (!newRepoName.trim()) return;
            setRepoChoice('create');
            setSelectedRepo(null);
            startFinishing();
          }}
          disabled={!newRepoName.trim()}
          style={primaryButtonStyle(!!newRepoName.trim())}
        >
          Create Universe Here
          <ArrowRight size={18} />
        </button>
      </div>

      {/* Or link an existing repo */}
      <div style={repoCardStyle()}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          onClick={() => {
            const next = !showRepoList;
            setShowRepoList(next);
            if (next && repoList === null && !repoListLoading) loadRepoList();
          }}
        >
          <FolderOpen size={20} color={theme.canvas.textPrimary} />
          <h3 style={{
            margin: 0,
            flex: 1,
            fontSize: '1rem',
            fontWeight: 'bold',
            color: theme.canvas.textPrimary,
            fontFamily: "'EmOne', sans-serif"
          }}>
            Link an Existing Repository
          </h3>
          <ArrowRight
            size={16}
            color={theme.canvas.textPrimary}
            style={{ transform: showRepoList ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
          />
        </div>

        {showRepoList && (
          <div style={{ marginTop: '12px' }}>
            {repoListLoading && (
              <div style={{ textAlign: 'center', padding: '14px', fontSize: '0.85rem', color: theme.canvas.textSecondary }}>
                Loading repositories…
              </div>
            )}
            {repoListError && (
              <div style={{ padding: '10px', fontSize: '0.8rem', color: statusColors.error }}>
                {repoListError}
                <button
                  onClick={loadRepoList}
                  style={{
                    marginLeft: '8px',
                    background: 'none',
                    border: 'none',
                    color: theme.canvas.textPrimary,
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontFamily: "'EmOne', sans-serif"
                  }}
                >
                  Retry
                </button>
              </div>
            )}
            {!repoListLoading && !repoListError && Array.isArray(repoList) && repoList.length === 0 && (
              <div style={{ textAlign: 'center', padding: '14px', fontSize: '0.85rem', color: theme.canvas.textSecondary }}>
                No repositories found on your account.
              </div>
            )}
            {!repoListLoading && Array.isArray(repoList) && repoList.length > 0 && (
              <div style={{
                maxHeight: '240px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                {repoList.map((repo) => (
                  <div
                    key={repo.id || repo.full_name}
                    onClick={() => {
                      setRepoChoice('existing');
                      setSelectedRepo(repo);
                      startFinishing();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: `1px solid ${theme.canvas.border}`,
                      backgroundColor: theme.canvas.bg,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: theme.canvas.textPrimary,
                      fontFamily: "'EmOne', sans-serif"
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.1)' : '#fff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = theme.canvas.bg; }}
                  >
                    {repo.private ? <Lock size={13} /> : <Globe size={13} />}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {repo.full_name || repo.name}
                    </span>
                    <ArrowRight size={14} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  const renderGitFinishingStep = () => {
    return (
      <>
        <style>{'@keyframes rs-onboarding-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
        <div style={{ textAlign: 'center', marginBottom: '20px', flexShrink: 0, marginTop: '8px' }}>
          <h2 style={{
            margin: '0 0 8px 0',
            color: theme.canvas.textPrimary,
            fontSize: isCompactLayout ? '1.2rem' : '1.5rem',
            fontWeight: 'bold',
            fontFamily: "'EmOne', sans-serif"
          }}>
            Setting Up Your Universe
          </h2>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0 12px',
          fontFamily: "'EmOne', sans-serif"
        }}>
          {GIT_ONBOARDING_TASKS.map((task) => {
            const state = taskStates[task.id];
            const status = state?.status || 'pending';
            const icon = status === 'done'
              ? <CheckCircle size={18} color={statusColors.success} />
              : status === 'running'
                ? <Loader2 size={18} color={theme.canvas.textPrimary} style={{ animation: 'rs-onboarding-spin 1s linear infinite' }} />
                : (status === 'warning' || status === 'error')
                  ? <AlertCircle size={18} color={status === 'error' ? statusColors.error : statusColors.warning || statusColors.info} />
                  : <Circle size={18} color={theme.canvas.border} />;
            return (
              <div key={task.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ flexShrink: 0, marginTop: '1px' }}>{icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '0.9rem',
                    color: theme.canvas.textPrimary,
                    opacity: status === 'pending' ? 0.5 : 1
                  }}>
                    {task.label}
                  </div>
                  {state?.detail && (
                    <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary, marginTop: '2px' }}>
                      {state.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {finishError && (
          <div style={{ padding: '0 12px', marginTop: '16px' }}>
            <div style={{
              padding: '10px 12px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              color: statusColors.error,
              border: `1px solid ${theme.canvas.border}`,
              backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
              marginBottom: '12px'
            }}>
              {finishError}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setStep('git-repo')}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: 'transparent',
                  color: theme.canvas.textPrimary,
                  border: `2px solid ${theme.canvas.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  fontFamily: "'EmOne', sans-serif"
                }}
              >
                Back
              </button>
              <button onClick={startFinishing} style={{ ...primaryButtonStyle(true), flex: 1, width: 'auto' }}>
                <RefreshCw size={16} />
                Retry
              </button>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderStep = () => {
    switch (step) {
      case 'git-connect': return renderGitConnectStep();
      case 'git-repo': return renderGitRepoStep();
      case 'git-finishing': return renderGitFinishingStep();
      case 'slots':
      default:
        return renderSlotsStep();
    }
  };

  return (
    <>
    <CanvasModal
      isVisible={isVisible}
      onClose={onClose}
      title=""
      width={modalWidth}
      height={modalHeight}
      position="center"
      margin={isCompactLayout ? 12 : 20}
      {...canvasModalProps}
    >
      <div style={{
        padding: isCompactLayout ? '14px' : '20px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}>
        {/* Close button - always available (except mid-finish) */}
        {!finishRunning && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: isCompactLayout ? '12px' : '16px',
              right: isCompactLayout ? '12px' : '16px',
              background: 'none',
              border: 'none',
              color: theme.canvas.textPrimary,
              opacity: 0.6,
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '4px',
              fontSize: '16px',
              fontWeight: 'bold',
              fontFamily: "'EmOne', sans-serif",
              zIndex: 10,
              transition: 'opacity 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
          >
            ✕
          </button>
        )}

        {renderStep()}
      </div>
    </CanvasModal>

    {/* Electron device-flow modal (OAuth + App authorize) */}
    <GitHubDeviceFlowModal
      isOpen={!!deviceFlowState}
      onCancel={cancelDeviceFlow}
      title={deviceFlowState?.title || 'Connect to GitHub'}
      subtitle={deviceFlowState?.subtitle}
      userCode={deviceFlowState?.userCode}
      verificationUri={deviceFlowState?.verificationUri}
      verificationUriComplete={deviceFlowState?.verificationUriComplete}
      expiresAt={deviceFlowState?.expiresAt}
      status={deviceFlowState?.status}
      errorMessage={deviceFlowState?.errorMessage}
    />
    </>
  );
};

export default StorageSetupModal;
