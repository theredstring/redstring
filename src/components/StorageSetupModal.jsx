import React, { useCallback, useEffect, useRef, useState } from 'react';
import CanvasModal from './CanvasModal';
import AuthSection from './universe-manager/AuthSection.jsx';
import GitHubDeviceFlowModal from './modals/GitHubDeviceFlowModal.jsx';
import { isElectron } from '../utils/fileAccessAdapter.js';
import {
  FolderOpen, ArrowRightCircle, ArrowRight, ArrowLeft, Github, Lock, Globe,
  Loader2, CheckCircle, AlertCircle, Circle, RefreshCw
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';
import { useGitHubDeviceFlow } from '../hooks/useGitHubDeviceFlow.js';
import { persistentAuth } from '../services/persistentAuth.js';
import { getStorageKey } from '../utils/storageUtils.js';
import { getStatusColors } from '../utils/statusColors.js';
import { runPendingCallbacks, recheckAppOnFocus } from '../services/githubAuthCallbacks.js';
import {
  connectOAuth as ghConnectOAuth,
  connectApp as ghConnectApp,
  detectAppInstall as ghDetectAppInstall,
  disconnectOAuth as ghDisconnectOAuth,
  disconnectApp as ghDisconnectApp
} from '../services/githubAuthFlows.js';
import { listUserRepos } from '../services/githubRepoService.js';
import { runGitOnboardingSetup, GIT_ONBOARDING_TASKS } from '../services/gitOnboardingService.js';

/**
 * Storage Setup Modal — first-run onboarding.
 * Lets a first-time user choose where their universes live: a local folder,
 * a GitHub repository (guided wizard), or browser storage (skip).
 *
 * Flow:
 * 1. "Where should we save your universes?" (Folder / GitHub / Skip)
 *    - Mobile (no File System Access API): GitHub is the primary option and
 *      the folder option is hidden — folder picking doesn't work there.
 *    - Desktop: folder is primary, GitHub is optional.
 * 2. Folder -> "Name your Universe" -> create file in chosen folder.
 * 3. GitHub -> guided wizard, 1:1 with the Universes panel machinery:
 *      git-connect  — Accounts & Access (OAuth + GitHub App; web redirects /
 *                     Electron device flow; existing App installs are
 *                     discovered before ever showing the install page)
 *      git-repo     — create "Redstring-Universes" (preferred) or link an
 *                     existing repository
 *      git-name     — universe name + optional local .redstring copy (desktop)
 *      git-finishing— repo → universe → attach → push → promote git checklist
 *    The web OAuth/App-install redirects unload the page; sessionStorage
 *    resume flags (redstring_onboarding_resume/_step) reopen the wizard at
 *    git-connect on return.
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
  return 'selection';
};

const clearWizardResumeFlags = () => {
  try {
    sessionStorage.removeItem('redstring_onboarding_resume');
    sessionStorage.removeItem('redstring_onboarding_step');
  } catch { /* ignore */ }
};

const StorageSetupModal = ({
  isVisible,
  onClose,
  onFolderSelected = null, // (folderPath, universeName) => void
  onGitSetupComplete = null, // ({ slug, name, warnings }) => void
  onBrowserStorageSelected = null,
  ...canvasModalProps
}) => {
  const theme = useTheme();
  const statusColors = getStatusColors(theme.darkMode);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));

  // Step state: 'selection' | 'naming' (folder path)
  //           | 'git-connect' | 'git-repo' | 'git-name' | 'git-finishing'
  const [step, setStep] = useState(readWizardResumeStep);
  const [universeName, setUniverseName] = useState('Universe');
  // Temporary storage for the selected folder path/handle while we ask for the name
  const [tempFolderHandle, setTempFolderHandle] = useState(null);

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
  const [linkLocalFile, setLinkLocalFile] = useState(false);
  const [taskStates, setTaskStates] = useState({});
  const [finishError, setFinishError] = useState(null);
  const [finishRunning, setFinishRunning] = useState(false);
  const createdSlugRef = useRef(null);

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

  const showBrowserStorageOption = !isElectron();

  // No File System Access API (mobile browsers, iOS/Android): folder-based
  // storage can't work, so git sync becomes the primary onboarding path.
  const gitFirst = !isElectron() &&
    typeof window !== 'undefined' && !('showSaveFilePicker' in window);
  const showFolderOption = !gitFirst;
  const showGitOption = !!onGitSetupComplete;
  const canLinkLocalFile = isElectron() ||
    (typeof window !== 'undefined' && 'showSaveFilePicker' in window);

  React.useEffect(() => {
    const handleResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
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

  // git-connect step: process any pending OAuth/App redirect callback
  // (single-flight — safe alongside the panel), then check for an existing
  // App install so we never prompt an install the user already has. Also
  // re-detect on tab focus (covers install-in-another-tab).
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

        // Existing-install check: surface the backend's standard discovery
        // (/api/github/app/installations) before the user touches anything.
        const status = persistentAuth.getAuthStatus();
        if (!isElectron() && status.hasOAuthTokens && !status.hasGitHubApp) {
          await persistentAuth.attemptAppAutoConnect?.();
          if (!cancelled) refreshAuthStatus();
        }
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

  const handleFolderChoice = async () => {
    try {
      const { pickFolder } = await import('../utils/fileAccessAdapter.js');
      const handle = await pickFolder();

      if (handle) {
        setTempFolderHandle(handle);
        setStep('naming');
      }
    } catch (e) {
      console.error("Failed to pick folder", e);
    }
  };

  const handleGitChoice = () => {
    // Arm the resume flags BEFORE any redirect can happen — the web OAuth
    // and App-install flows unload the page, and these flags are what bring
    // the user back into the wizard at git-connect.
    try {
      sessionStorage.setItem('redstring_onboarding_resume', 'true');
      sessionStorage.setItem('redstring_onboarding_step', 'git-connect');
    } catch { /* ignore */ }
    setAuthNotice(null);
    setStep('git-connect');
  };

  const handleConfirmUniverseCreation = () => {
    if (onFolderSelected && tempFolderHandle) {
      // Pass both the handle and the name
      onFolderSelected(tempFolderHandle, universeName || "MyUniverse");
    }
  };

  const handleBrowserStorageChoice = () => {
    if (onBrowserStorageSelected) {
      onBrowserStorageSelected();
    }
  };

  // --- GitHub wizard handlers (thin wrappers over githubAuthFlows) ---

  const handleWizardGitHubAuth = async () => {
    try {
      setIsConnecting(true);
      setAuthNotice(null);
      const result = await ghConnectOAuth({ runDeviceFlow });
      if (result?.connected) refreshAuthStatus();
      // result.redirecting: page is unloading — resume flags bring us back.
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
      const result = await runGitOnboardingSetup({
        repoChoice,
        repoName: newRepoName,
        isPrivate: newRepoPrivate,
        existingRepo: selectedRepo,
        universeName: finalName,
        linkLocalFile: canLinkLocalFile && linkLocalFile,
        authMethod: hasOAuth ? 'oauth' : 'github-app',
        reuseSlug: createdSlugRef.current,
        onProgress: (taskId, status, detail) => {
          setTaskStates((prev) => ({ ...prev, [taskId]: { status, detail } }));
        }
      });
      createdSlugRef.current = result.slug;
      clearWizardResumeFlags();
      setFinishRunning(false);
      if (onGitSetupComplete) {
        onGitSetupComplete({ slug: result.slug, name: finalName, warnings: result.warnings });
      }
    } catch (err) {
      if (err?.slug) createdSlugRef.current = err.slug;
      setFinishError(err.message || 'Setup failed');
      setFinishRunning(false);
    }
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

  const backButton = (targetStep, onBeforeBack = null) => (
    <button
      onClick={() => {
        if (onBeforeBack) onBeforeBack();
        setStep(targetStep);
      }}
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

  const renderGitCard = () => (
    <div
      style={{
        backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
        border: `2px solid ${theme.canvas.border}`,
        borderRadius: '8px',
        padding: isCompactLayout ? '16px' : '20px',
        marginBottom: '16px',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
      onClick={handleGitChoice}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.1)' : '#fff';
        e.currentTarget.style.borderColor = theme.canvas.border;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA';
        e.currentTarget.style.borderColor = theme.canvas.border;
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        marginBottom: '12px'
      }}>
        <div style={{
          flexShrink: 0,
          color: theme.canvas.textPrimary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Github size={32} />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{
            margin: '0 0 4px 0',
            fontSize: isCompactLayout ? '1rem' : '1.1rem',
            fontWeight: 'bold',
            color: theme.canvas.textPrimary,
            fontFamily: "'EmOne', sans-serif"
          }}>
            {gitFirst ? 'Sync with GitHub' : 'Sync with GitHub (Optional)'}
          </h3>
          <p style={{
            margin: '4px 0 0 0',
            fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
            color: theme.canvas.textPrimary,
            lineHeight: '1.4'
          }}>
            Save your universes to a GitHub repository. Works on any device.
          </p>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleGitChoice();
        }}
        style={{
          width: '100%',
          padding: isCompactLayout ? '10px' : '12px',
          backgroundColor: gitFirst
            ? (theme.darkMode ? '#EFE8E5' : '#260000')
            : 'transparent',
          color: gitFirst
            ? (theme.darkMode ? '#260000' : '#EFE8E5')
            : theme.canvas.textPrimary,
          border: gitFirst ? 'none' : `2px solid ${theme.canvas.border}`,
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: isCompactLayout ? '0.9rem' : '1rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}
      >
        Connect GitHub
      </button>
    </div>
  );

  const renderSelectionStep = () => (
    <>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: isCompactLayout ? '16px' : '24px', flexShrink: 0 }}>
        <h1 style={{
          margin: '0 0 4px 0',
          color: theme.accent.primary,
          fontSize: isCompactLayout ? '1.5rem' : '1.8rem',
          fontWeight: '600',
          fontFamily: "'EmOne', sans-serif",
          letterSpacing: '0.05em'
        }}>
          Welcome to Redstring
        </h1>
        <h2 style={{
          margin: '0 0 8px 0',
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '1.2rem' : '1.5rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Where should we save your universes?
        </h2>
      </div>

      {/* Start Button Options */}
      <div style={{ flexShrink: 0 }}>
        {/* Git first on mobile (folder storage unavailable there) */}
        {showGitOption && gitFirst && renderGitCard()}

        {/* Option A: Choose a Folder */}
        {showFolderOption && (
        <div
          style={{
            backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
            border: `2px solid ${theme.canvas.border}`,
            borderRadius: '8px',
            padding: isCompactLayout ? '16px' : '20px',
            marginBottom: '16px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onClick={handleFolderChoice}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.1)' : '#fff';
            e.currentTarget.style.borderColor = theme.canvas.border;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA';
            e.currentTarget.style.borderColor = theme.canvas.border;
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '12px'
          }}>
            <div style={{
              flexShrink: 0,
              color: theme.canvas.textPrimary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <FolderOpen size={32} />
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{
                margin: '0 0 4px 0',
                fontSize: isCompactLayout ? '1rem' : '1.1rem',
                fontWeight: 'bold',
                color: theme.canvas.textPrimary,
                fontFamily: "'EmOne', sans-serif"
              }}>
                Choose a Folder
              </h3>
              <p style={{
                margin: '4px 0 0 0',
                fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
                color: theme.canvas.textPrimary,
                lineHeight: '1.4'
              }}>
                Save all universes in one place. Works across sessions.
              </p>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleFolderChoice();
            }}
            style={{
              width: '100%',
              padding: isCompactLayout ? '10px' : '12px',
              backgroundColor: theme.darkMode ? '#EFE8E5' : '#260000',
              color: theme.darkMode ? '#260000' : '#EFE8E5',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: isCompactLayout ? '0.9rem' : '1rem',
              fontWeight: 'bold',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            Select Folder
          </button>
        </div>
        )}

        {/* Git as an optional extra on desktop */}
        {showGitOption && !gitFirst && renderGitCard()}

        {/* Option B: Browser Storage */}
        {showBrowserStorageOption && (
          <div
            style={{
              backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
              border: `2px solid ${theme.canvas.border}`,
              borderRadius: '8px',
              padding: isCompactLayout ? '16px' : '20px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={handleBrowserStorageChoice}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.1)' : '#fff';
              e.currentTarget.style.borderColor = theme.canvas.border;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA';
              e.currentTarget.style.borderColor = theme.canvas.border;
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              marginBottom: '12px'
            }}>
              <div style={{
                flexShrink: 0,
                color: theme.canvas.textPrimary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <ArrowRightCircle size={32} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{
                  margin: '0 0 4px 0',
                  fontSize: isCompactLayout ? '1rem' : '1.1rem',
                  fontWeight: 'bold',
                  color: theme.canvas.textPrimary,
                  fontFamily: "'EmOne', sans-serif"
                }}>
                  Skip Folder Setup
                </h3>
                <div style={{
                  marginBottom: '6px',
                  fontStyle: 'italic',
                  color: theme.canvas.textPrimary,
                  fontSize: '0.85rem'
                }}>
                  Finish Set Up on the Universes Tab in the Left Panel
                </div>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleBrowserStorageChoice();
              }}
              style={{
                width: '100%',
                padding: isCompactLayout ? '10px' : '12px',
                backgroundColor: 'transparent',
                color: theme.canvas.textPrimary,
                border: `2px solid ${theme.canvas.border}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: isCompactLayout ? '0.9rem' : '1rem',
                fontWeight: 'bold',
                fontFamily: "'EmOne', sans-serif"
              }}
            >
              Skip For Now
            </button>
          </div>
        )}
      </div>
    </>
  );

  const renderNamingStep = () => (
    <>
      <div style={{ textAlign: 'center', marginBottom: '32px', flexShrink: 0, marginTop: '16px' }}>
        <h2 style={{
          margin: '0 0 8px 0',
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '1.3rem' : '1.6rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Name Your Universe
        </h2>
        <p style={{ color: theme.canvas.textPrimary, opacity: 0.8, margin: 0, fontSize: '0.95rem' }}>
          This will be the name of your first .redstring file.
        </p>
      </div>

      <div style={{
        flexShrink: 0,
        padding: '0 20px'
      }}>
        <label style={{
          display: 'block',
          marginBottom: '8px',
          fontWeight: 'bold',
          color: theme.canvas.textPrimary,
          fontSize: '0.9rem'
        }}>
          Universe Name
        </label>
        <input
          type="text"
          value={universeName}
          onChange={(e) => setUniverseName(e.target.value)}
          placeholder="Universe"
          autoFocus
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: '1.1rem',
            borderRadius: '8px',
            border: `2px solid ${theme.canvas.border}`,
            backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
            color: theme.canvas.textPrimary,
            boxSizing: 'border-box',
            fontFamily: "'EmOne', sans-serif",
            marginBottom: '24px',
            outline: 'none'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && universeName.trim()) {
              handleConfirmUniverseCreation();
            }
          }}
        />

        <button
          onClick={handleConfirmUniverseCreation}
          disabled={!universeName.trim()}
          style={primaryButtonStyle(!!universeName.trim())}
        >
          Create Universe
          <ArrowRight size={20} />
        </button>

      </div>
    </>
  );

  // --- GitHub wizard steps ---

  const renderGitConnectStep = () => (
    <>
      {backButton('selection', clearWizardResumeFlags)}
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

  const repoCardStyle = (isPrimary) => ({
    backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
    border: `2px solid ${theme.canvas.border}`,
    borderRadius: '8px',
    padding: isCompactLayout ? '14px' : '18px',
    marginBottom: '14px'
  });

  const renderGitRepoStep = () => (
    <>
      {backButton('git-connect')}
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
          Your universes live as .redstring files inside a GitHub repository.
        </p>
      </div>

      {/* Preferred: create a new repo */}
      <div style={repoCardStyle(true)}>
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
            setStep('git-name');
          }}
          disabled={!newRepoName.trim()}
          style={primaryButtonStyle(!!newRepoName.trim())}
        >
          Use This Repository
          <ArrowRight size={18} />
        </button>
      </div>

      {/* Or link an existing repo */}
      <div style={repoCardStyle(false)}>
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
                      setStep('git-name');
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

  const renderGitNameStep = () => {
    const repoLabel = repoChoice === 'create'
      ? newRepoName
      : (selectedRepo?.full_name || selectedRepo?.name || 'repository');
    return (
      <>
        {backButton('git-repo')}
        <div style={{ textAlign: 'center', marginBottom: '24px', flexShrink: 0 }}>
          <h2 style={{
            margin: '0 0 8px 0',
            color: theme.canvas.textPrimary,
            fontSize: isCompactLayout ? '1.2rem' : '1.5rem',
            fontWeight: 'bold',
            fontFamily: "'EmOne', sans-serif"
          }}>
            Name Your Universe
          </h2>
          <p style={{ color: theme.canvas.textPrimary, opacity: 0.8, margin: 0, fontSize: '0.9rem' }}>
            It will be created in <strong>{repoLabel}</strong>, with GitHub as the source of truth.
          </p>
        </div>

        <div style={{ flexShrink: 0, padding: '0 12px' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontWeight: 'bold',
            color: theme.canvas.textPrimary,
            fontSize: '0.9rem'
          }}>
            Universe Name
          </label>
          <input
            type="text"
            value={universeName}
            onChange={(e) => setUniverseName(e.target.value)}
            placeholder="Universe"
            autoFocus
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '1.1rem',
              borderRadius: '8px',
              border: `2px solid ${theme.canvas.border}`,
              backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
              color: theme.canvas.textPrimary,
              boxSizing: 'border-box',
              fontFamily: "'EmOne', sans-serif",
              marginBottom: '16px',
              outline: 'none'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && universeName.trim()) {
                startFinishing();
              }
            }}
          />

          {canLinkLocalFile && (
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              fontSize: '0.82rem',
              color: theme.canvas.textPrimary,
              fontFamily: "'EmOne', sans-serif",
              marginBottom: '20px',
              lineHeight: 1.4
            }}>
              <input
                type="checkbox"
                checked={linkLocalFile}
                onChange={(e) => setLinkLocalFile(e.target.checked)}
                style={{ marginTop: '2px' }}
              />
              <span>
                Also save a local .redstring file copy.
                <span style={{ color: theme.canvas.textSecondary }}> GitHub stays the source of truth.</span>
              </span>
            </label>
          )}

          <button
            onClick={startFinishing}
            disabled={!universeName.trim()}
            style={primaryButtonStyle(!!universeName.trim())}
          >
            Create Universe
            <ArrowRight size={20} />
          </button>
        </div>
      </>
    );
  };

  const renderGitFinishingStep = () => {
    const visibleTasks = GIT_ONBOARDING_TASKS.filter(
      (t) => t.id !== 'local-file' || (canLinkLocalFile && linkLocalFile)
    );
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
          {visibleTasks.map((task) => {
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
                onClick={() => setStep('git-name')}
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
      case 'naming': return renderNamingStep();
      case 'git-connect': return renderGitConnectStep();
      case 'git-repo': return renderGitRepoStep();
      case 'git-name': return renderGitNameStep();
      case 'git-finishing': return renderGitFinishingStep();
      case 'selection':
      default:
        return renderSelectionStep();
    }
  };

  return (
    <>
    <CanvasModal
      isVisible={isVisible}
      onClose={onClose}
      title=""
      width={modalWidth}
      height="auto"
      position="center"
      margin={isCompactLayout ? 12 : 20}
      {...canvasModalProps}
    >
      <div style={{
        padding: isCompactLayout ? '16px' : '24px',
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
