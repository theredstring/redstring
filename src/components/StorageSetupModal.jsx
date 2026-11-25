import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import CanvasModal from './CanvasModal';
import GitHubConnectStep from './shared/GitHubConnectStep.jsx';
import PanelIconButton from './shared/PanelIconButton.jsx';
import { isElectron, hasFileSystemAccess, pickFile } from '../utils/fileAccessAdapter.js';
import { isCapacitor, usesPathHandles } from '../utils/capacitorAdapter.js';
import {
  FolderOpen, Folder, ArrowRight, ArrowLeft, Github, Lock, Globe, FileText, Link,
  Loader2, CheckCircle, AlertCircle, Circle, RefreshCw, Save, X, Star, Upload, Key, Plus,
  Monitor, Smartphone, Download
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';
import { useGitHubConnection } from '../hooks/useGitHubConnection.js';
import { persistentAuth } from '../services/persistentAuth.js';
import universeBackend from '../services/universeBackend.js';
import { MODAL_CLOSE_ICON_SIZE } from '../constants.js';
import { showNotice } from './shared/appDialogs.js';
import { getStatusColors } from '../utils/statusColors.js';
import {
  saveWorkspaceHandle, getWorkspaceHandle, clearWorkspaceHandle,
  checkWorkspacePermission, requestWorkspacePermission
} from '../services/workspaceFolderService.js';
import { listUserRepos } from '../services/githubRepoService.js';
import universeManagerService from '../services/universeManagerService.js';
import { openUniverseFile } from '../services/openUniverseFile.js';
import { saveLinkedAsLocalFile, publishLinkedToRepo } from '../services/externalLinkDestinations.js';
import ExternalLinkLoadModal from './modals/ExternalLinkLoadModal.jsx';
import { canOfferAppDownloads, DESKTOP_DOWNLOAD_URL, APP_STORE_URL, GOOGLE_PLAY_URL } from '../utils/appDownloads.js';
import { openExternalUrl } from '../utils/safeUrl.js';
import {
  fillGitSlot, addLocalFileSlot, resolveLocalFileHandle, openRepoUniverse,
  GIT_ONBOARDING_TASKS, OPEN_REPO_TASKS
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
 * Open an Existing Universe → Repository runs the same connect step with the
 * 'open' intent, then:
 *   git-open      — pick a repository, then a universe found in it
 *   git-finishing — universe → attach → load (nothing is pushed), and back to
 *                   the hub with the git slot filled, so a local file can join
 *                   it and Get Connected finishes, as after a fresh setup.
 *
 * The web OAuth/App-install redirects unload the page; sessionStorage resume
 * flags (redstring_onboarding_resume/_step/_universe_name) reopen the wizard at
 * git-connect, with the universe name preserved, on return.
 *
 * The connect step itself (auth state, redirect callbacks, App discovery, the
 * OAuth/App cards) is useGitHubConnection + GitHubConnectPanel, shared with
 * GitReconnectModal.
 */

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

// 'create' fills the git slot with a new universe; 'open' brings in one that
// already lives in a repository. Survives the web redirects with the step.
const readResumeIntent = () => {
  try {
    if (sessionStorage.getItem('redstring_onboarding_intent') === 'open') return 'open';
  } catch { /* ignore */ }
  return 'create';
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
    sessionStorage.removeItem('redstring_onboarding_intent');
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

  // In a browser, onboarding starts on Get the App: the desktop and phone
  // apps, or Continue on Web to the hub. Never in the apps themselves, which
  // are already installed. The platform doesn't change while the app runs.
  const [offerGetApp] = useState(() => !isElectron() && canOfferAppDownloads());
  // Step: 'get-app' (browser only) | 'slots' (hub) | 'git-connect' | 'git-repo' | 'git-finishing'
  const [step, setStep] = useState(() => {
    const resume = readWizardResumeStep();
    return resume === 'slots' && offerGetApp ? 'get-app' : resume;
  });
  const [gitIntent, setGitIntent] = useState(readResumeIntent);
  const afterConnectStep = gitIntent === 'open' ? 'git-open' : 'git-repo';
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
  // --- Open an Existing Universe → File ---
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState(null);

  // --- GitHub wizard state ---
  const github = useGitHubConnection({ active: isVisible && step === 'git-connect' });
  const { hasOAuth, setAuthNotice } = github;
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
  // Open from a repository: which repo is expanded, what each scan found, and
  // the pick being opened (kept for Retry).
  const [openRepoKey, setOpenRepoKey] = useState(null);
  const [repoUniverses, setRepoUniverses] = useState({});
  const [openPick, setOpenPick] = useState(null);
  // The Git-only shell a failed open left behind, for its Retry. Never the
  // create flow's browser-backed shell: loading that would load it empty.
  const openSlugRef = useRef(null);

  // Only use compact layout on truly small screens (mobile)
  const isCompactLayout = viewportSize.width <= 500;
  const modalWidth = isCompactLayout
    ? Math.min(Math.max(viewportSize.width - 24, 320), 540)
    : 600;

  // Content padding. The top pad also reserves the strip the absolutely
  // positioned back/close buttons occupy, so no step's heading can slide under
  // them. These numbers feed the height math below, so keep them in JS rather
  // than inlining different values in the style object.
  const contentPadX = isCompactLayout ? 20 : 32;
  const contentPadTop = isCompactLayout ? 44 : 52;
  const contentPadBottom = isCompactLayout ? 22 : 28;

  // The modal is sized to the step it is showing rather than pinned to one
  // height for every step: short steps get a compact box with real margins,
  // and tall ones (git-connect's AuthSection, git-repo with the repo list
  // open) grow instead of clipping. Past the viewport the content area
  // scrolls, so nothing is ever cut off.
  const contentRef = useRef(null);
  const [measuredContentHeight, setMeasuredContentHeight] = useState(0);
  const modalVerticalMargin = isCompactLayout ? 12 : 20;
  const maxModalHeight = Math.max(280, viewportSize.height - modalVerticalMargin * 2 - 8);
  const modalHeight = measuredContentHeight > 0
    ? Math.min(
        Math.max(measuredContentHeight + contentPadTop + contentPadBottom, 280),
        maxModalHeight
      )
    // Pre-measurement fallback (first frame only) — close to the common case so
    // the modal does not visibly resize on open.
    : Math.min(isCompactLayout ? 560 : 500, maxModalHeight);

  // No File System Access API (mobile browsers): folder/local-file storage
  // can't work, so git becomes the only storage path.
  const gitFirst = !isElectron() && !isCapacitor() &&
    typeof window !== 'undefined' && !('showSaveFilePicker' in window);
  const canLinkLocalFile = isElectron() || isCapacitor() ||
    (typeof window !== 'undefined' && 'showSaveFilePicker' in window);
  // On iOS there is no file to pick and no workspace folder to choose — storage
  // lands in the app-managed Universes folder. That is a reason to drop the
  // picker, NOT the slot: hiding the slot left `slotStatus.local` permanently
  // false, and since "Get Connected" needs a filled slot, onboarding could not
  // be completed at all without linking GitHub. The slot still requires an
  // explicit tap, so nothing is created behind the user's back.
  const showLocalSlot = canLinkLocalFile;
  const showWorkspaceRow = canLinkLocalFile && !isCapacitor();
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

  // Track the natural height of whatever step is rendered so the modal can size
  // itself to it. ResizeObserver (not a step-keyed effect) because content
  // grows in place too: the repo list expanding, an error banner appearing, the
  // device-flow panel swapping in.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!isVisible || !el) {
      setMeasuredContentHeight(0);
      return undefined;
    }
    const measure = () => {
      const next = Math.ceil(el.getBoundingClientRect().height);
      setMeasuredContentHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isVisible, step]);

  // The open step starts from the repository list.
  useEffect(() => {
    if (isVisible && step === 'git-open' && repoList === null && !repoListLoading) loadRepoList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, step]);

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

  // --- Workspace folder handlers (mirror UniversesList) ---

  // Linking the folder only stores the directory handle. Universes that lost
  // their file handle stay disconnected until something re-runs resolution, so
  // kick that off here — otherwise the canvas needs a manual app reload.
  const reconnectAfterWorkspaceChange = async () => {
    try {
      await universeBackend.reconnectFromWorkspaceFolder();
    } catch (e) {
      console.error('[StorageSetupModal] Failed to reconnect universes to workspace folder:', e);
    }
  };

  const handlePickWorkspaceFolder = async () => {
    try {
      if (window.electron?.fileSystem?.pickFolder) {
        const folderPath = await window.electron.fileSystem.pickFolder();
        if (!folderPath) return;
        setWorkspaceFolder(folderPath.split(/[/\\]/).pop());
        setWorkspaceNeedsPermission(false);
        await saveWorkspaceHandle(folderPath);
        await reconnectAfterWorkspaceChange();
        return;
      }
      if (!('showDirectoryPicker' in window)) {
        await showNotice({ title: 'Folders Not Supported', message: "This browser can't link a folder. Try Chrome, Edge or the desktop app." });
        return;
      }
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setWorkspaceFolder(handle.name);
      setWorkspaceNeedsPermission(false);
      await saveWorkspaceHandle(handle);
      await reconnectAfterWorkspaceChange();
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
      if (result === 'granted') {
        setWorkspaceNeedsPermission(false);
        await reconnectAfterWorkspaceChange();
      }
    } catch (e) {
      console.error('[StorageSetupModal] Failed to re-grant workspace permission:', e);
    }
  };

  // --- Slot fill handlers ---

  const enterGitFlow = (intent) => {
    // Arm the resume flags BEFORE any redirect can happen — the web OAuth and
    // App-install flows unload the page, and these flags (plus the persisted
    // universe name and intent) bring the user back into the wizard at
    // git-connect.
    try {
      sessionStorage.setItem('redstring_onboarding_resume', 'true');
      sessionStorage.setItem('redstring_onboarding_step', 'git-connect');
      sessionStorage.setItem('redstring_onboarding_universe_name', (universeName || 'Universe').trim() || 'Universe');
      sessionStorage.setItem('redstring_onboarding_intent', intent);
    } catch { /* ignore */ }
    setGitIntent(intent);
    setAuthNotice(null);
    // Already fully connected from a prior slot fill this session? Skip to repo.
    // Read fresh: the hook only tracks auth while the connect step is showing.
    // A token GitHub hasn't vouched for yet goes through the connect step,
    // which verifies it, rather than straight to a repo list that would 401.
    const now = persistentAuth.getAuthStatus();
    const readyToSkip = now?.hasOAuthTokens && now?.hasGitHubApp && now?.oauthVerification === 'valid';
    setStep(readyToSkip ? (intent === 'open' ? 'git-open' : 'git-repo') : 'git-connect');
  };
  const handleAddRepository = () => enterGitFlow('create');
  const handleOpenRepository = () => enterGitFlow('open');

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
    const fileName = usesPathHandles() && typeof handle === 'string'
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

  const handleToggleSourceOfTruth = async (type) => {
    if (!universeSlugRef.current || sourceOfTruth === type) return;
    try {
      await universeBackend.setSourceOfTruth(universeSlugRef.current, type);
      setSourceOfTruth(type);
    } catch (err) {
      console.warn('[StorageSetupModal] Failed to set source of truth:', err?.message || err);
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
    }
  };

  const repoKeyOf = (repo) => {
    const user = repo?.owner?.login || repo?.owner?.name || repo?.owner || repo?.full_name?.split('/')[0];
    const name = repo?.name || repo?.full_name?.split('/').pop();
    return user && name ? { user, repo: name, key: `${user}/${name}` } : null;
  };

  const toggleOpenRepo = async (repo) => {
    const info = repoKeyOf(repo);
    if (!info) return;
    if (openRepoKey === info.key) { setOpenRepoKey(null); return; }
    setOpenRepoKey(info.key);
    if (repoUniverses[info.key]?.list) return;
    setRepoUniverses((prev) => ({ ...prev, [info.key]: { loading: true } }));
    try {
      const list = await universeManagerService.discoverUniverses({
        user: info.user,
        repo: info.repo,
        authMethod: hasOAuth ? 'oauth' : 'github-app'
      });
      setRepoUniverses((prev) => ({ ...prev, [info.key]: { list: Array.isArray(list) ? list : [] } }));
    } catch (err) {
      setRepoUniverses((prev) => ({ ...prev, [info.key]: { error: err.message || 'Could not read this repository.' } }));
    }
  };

  const startOpening = async (pick, { retry = false } = {}) => {
    setOpenPick(pick);
    setStep('git-finishing');
    setFinishError(null);
    setTaskStates({});
    try {
      const result = await openRepoUniverse({
        discovered: pick.universe,
        repo: { user: pick.user, repo: pick.repo },
        authMethod: hasOAuth ? 'oauth' : 'github-app',
        // Only a retry of the same pick takes the shell a failed attempt left.
        reuseSlug: retry ? openSlugRef.current : null,
        onProgress: (taskId, status, detail) => {
          setTaskStates((prev) => ({ ...prev, [taskId]: { status, detail } }));
        }
      });
      universeSlugRef.current = result.slug;
      openSlugRef.current = null;
      clearWizardResumeFlags();
      setUniverseName(result.name);
      setSlotStatus((prev) => ({ ...prev, git: { done: true, label: `@${pick.user}/${pick.repo}` } }));
      setSourceOfTruth('git');
      onUniverseReady?.({ slug: result.slug, name: result.name, warnings: [] });
      setOpenRepoKey(null);
      setOpenPick(null);
      setGitIntent('create');
      setStep('slots');
    } catch (err) {
      openSlugRef.current = err?.slug || (retry ? openSlugRef.current : null);
      setFinishError(err.message || 'Could not open the universe');
    }
  };

  const leaveGitFlow = () => {
    clearWizardResumeFlags();
    setGitIntent('create');
    setStep('slots');
  };

  // --- Shared UI atoms (existing modal idiom) ---

  // Full-width, centered solid pill CTA built on the shared PanelIconButton so
  // primary actions share the same hover system as every other icon button.
  const primaryCta = ({ label, onClick, disabled = false, icon = ArrowRight, iconLeft = false, large = false }) => (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <PanelIconButton
        label={label}
        icon={icon}
        size={large ? 20 : 16}
        labelFontSize={large ? 15 : 13}
        labelPosition={iconLeft ? 'right' : 'left'}
        variant="solid"
        onClick={onClick}
        disabled={disabled}
        style={large ? { padding: '10px 22px' } : undefined}
      />
    </div>
  );

  // Left-side mirror of the close button: icon-only, same dimensions/position.
  const backButton = (onBack) => (
    <PanelIconButton
      icon={ArrowLeft}
      onClick={onBack}
      title="Back"
      size={MODAL_CLOSE_ICON_SIZE}
      style={{
        position: 'absolute',
        top: isCompactLayout ? '12px' : '16px',
        left: isCompactLayout ? '12px' : '16px',
        zIndex: 10
      }}
    />
  );

  // A universe opened from a file or a link becomes this box's universe, as
  // one opened from a repository does: its name, its filled slot, back to the
  // hub to add another place or Get Connected. Onboarding never leaves this box.
  const landOpened = ({ slug, name, local = null, git = null }) => {
    universeSlugRef.current = slug;
    if (name) setUniverseName(name);
    setSlotStatus((prev) => ({
      local: local ? { done: true, label: local } : prev.local,
      git: git ? { done: true, label: git } : prev.git
    }));
    setSourceOfTruth(git ? 'git' : 'local');
    clearWizardResumeFlags();
    onUniverseReady?.({ slug, name, warnings: [] });
    setStep('slots');
  };

  const runOpenFile = async (source) => {
    setOpenBusy(true);
    setOpenError(null);
    try {
      const result = await openUniverseFile(source);
      landOpened({ slug: result.slug, name: result.name, local: result.fileName });
    } catch (err) {
      if (err?.slug) universeSlugRef.current = err.slug;
      setOpenError(err?.message || 'Could not open that file.');
    } finally {
      setOpenBusy(false);
    }
  };

  // Open an Existing Universe → File: a file stays linked where the platform
  // can keep it (desktop, a browser with file access), and comes in as a copy
  // where it can't (iOS, Android, other browsers). Picked here, inside the
  // tap, so the picker isn't blocked, and opened here too.
  const openExistingFile = async () => {
    if (openBusy) return;
    if (!isCapacitor() && (isElectron() || hasFileSystemAccess())) {
      try {
        const handle = await pickFile();
        if (handle) await runOpenFile({ handle });
      } catch (err) {
        if (err?.name !== 'AbortError' && !/returned no file/i.test(err?.message || '')) {
          console.warn('[StorageSetupModal] Open existing file failed:', err);
        }
      }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.redstring';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) runOpenFile({ file });
    };
    input.click();
  };

  // The hub's two cards, Create a New Universe and Open an Existing Universe,
  // laid out for a phone first: icon and title on one line, what it does under
  // them in full, and the choices in a row of their own beneath that, sharing
  // the card's width and wrapping to another row before anything is cut.
  const hubCard = ({ icon, title, description, children }) => (
    <div
      style={{
        backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
        border: `2px solid ${theme.canvas.border}`,
        borderRadius: '8px',
        padding: isCompactLayout ? '12px' : '14px',
        marginBottom: '12px',
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ flexShrink: 0, color: theme.canvas.textPrimary, display: 'flex', alignItems: 'center' }}>
          {icon}
        </div>
        <h3 style={{
          margin: 0,
          minWidth: 0,
          fontSize: isCompactLayout ? '0.95rem' : '1rem',
          fontWeight: 'bold',
          lineHeight: 1.25,
          color: theme.canvas.textPrimary,
          fontFamily: "'EmOne', sans-serif"
        }}>
          {title}
        </h3>
      </div>
      {description && (
        <p style={{
          margin: '4px 0 0 0',
          fontSize: isCompactLayout ? '0.76rem' : '0.8rem',
          color: theme.canvas.textSecondary,
          lineHeight: 1.35,
          fontFamily: "'EmOne', sans-serif"
        }}>
          {description}
        </p>
      )}
      {children}
    </div>
  );

  const hubActions = (children) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      {children}
    </div>
  );

  // A choice in a card's row: grows to share the row, and wraps to the next
  // one rather than squeezing its label. Trimmed padding so File, Repository
  // and Link still share one row on a phone held upright.
  const hubButtonStyle = { flex: '1 1 auto', whiteSpace: 'nowrap', padding: '6px 10px', gap: 6 };

  // A filled slot, in the row where its button was.
  const doneChip = (label) => (
    <div style={{
      flex: '1 1 auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      padding: '6px 10px',
      borderRadius: 20,
      border: `1px solid ${statusColors.success}`,
      color: statusColors.success,
      fontSize: '13px',
      fontWeight: 600,
      fontFamily: "'EmOne', sans-serif",
      whiteSpace: 'nowrap'
    }}>
      <CheckCircle size={14} />
      {label}
    </div>
  );

  // Where a filled slot went (the file, the repository), in full: a name is
  // the one thing here worth wrapping mid-word for.
  const slotDetail = (icon, text) => text && (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 8,
      fontSize: '0.76rem', lineHeight: 1.35, color: theme.canvas.textPrimary,
      fontFamily: "'EmOne', sans-serif", overflowWrap: 'anywhere', minWidth: 0
    }}>
      <span style={{ flexShrink: 0, display: 'flex', marginTop: 1 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>{text}</span>
    </div>
  );

  const localSlotLabel = isCapacitor() ? 'On This Device' : 'Local File';

  const renderCreateCard = () => hubCard({
    icon: <Plus size={22} />,
    title: 'Create a New Universe',
    description: !showLocalSlot ? 'In a GitHub repository' : !showGitOption ? 'On this device' : 'On this device, on GitHub, or both',
    children: (
      <>
        {/* Universe name */}
        <div style={{ marginTop: 12 }}>
          <label style={{
            display: 'block',
            marginBottom: '6px',
            fontWeight: 'bold',
            fontSize: '0.76rem',
            color: theme.canvas.textPrimary,
            fontFamily: "'EmOne', sans-serif"
          }}>
            Universe Name
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
              fontFamily: "'EmOne', sans-serif",
              overflowWrap: 'anywhere'
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
                backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : theme.canvas.bg,
                color: theme.canvas.textPrimary,
                boxSizing: 'border-box',
                fontFamily: "'EmOne', sans-serif",
                outline: 'none'
              }}
            />
          )}
        </div>

        {hubActions(
          <>
            {showLocalSlot && (slotStatus.local.done
              ? doneChip('Saved')
              : (
                <PanelIconButton
                  icon={Save}
                  size={14}
                  label={localBusy ? 'Setting up…' : localSlotLabel}
                  variant="outline"
                  onClick={handleAddLocalFile}
                  disabled={localBusy}
                  style={hubButtonStyle}
                />
              ))}
            {showGitOption && (slotStatus.git.done
              ? doneChip('Connected')
              : (
                <PanelIconButton
                  icon={Github}
                  size={14}
                  label="Repository"
                  variant={gitFirst ? 'solid' : 'outline'}
                  onClick={handleAddRepository}
                  style={hubButtonStyle}
                />
              ))}
          </>
        )}

        {slotStatus.local.done && slotDetail(<Save size={13} />, slotStatus.local.label)}
        {slotStatus.git.done && slotDetail(<Github size={13} />, slotStatus.git.label)}
        {!slotStatus.local.done && localError && (
          <div style={{ marginTop: 8, fontSize: '0.76rem', lineHeight: 1.35, color: statusColors.error, fontFamily: "'EmOne', sans-serif" }}>
            {localError}
          </div>
        )}

        {/* Source of truth, once at least one slot is filled */}
        {anySlotFilled && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            marginTop: 12, fontSize: '0.78rem',
            color: theme.canvas.textPrimary, fontFamily: "'EmOne', sans-serif"
          }}>
            <span style={{ fontWeight: 600 }}>Source of truth:</span>
            {bothSlotsFilled ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { key: 'local', label: localSlotLabel },
                  { key: 'git', label: 'GitHub' }
                ].map(({ key, label }) => {
                  const active = sourceOfTruth === key;
                  return (
                    <PanelIconButton
                      key={key}
                      icon={Star}
                      label={label}
                      size={12}
                      active={active}
                      filled={active}
                      variant="outline"
                      onClick={() => handleToggleSourceOfTruth(key)}
                    />
                  );
                })}
              </div>
            ) : (
              <span style={{ color: theme.canvas.brandText, fontWeight: 700 }}>
                {sourceOfTruth === 'git' ? 'GitHub' : sourceOfTruth === 'local' ? localSlotLabel : 'Browser'}
              </span>
            )}
          </div>
        )}
      </>
    )
  });

  const renderOpenExistingCard = () => hubCard({
    icon: <FolderOpen size={22} />,
    title: 'Open an Existing Universe',
    description: 'From a file, a repository or a link',
    children: hubActions(
      <>
        <PanelIconButton icon={FileText} size={14} label={openBusy ? 'Opening…' : 'File'} variant="outline" onClick={openExistingFile} disabled={openBusy} style={hubButtonStyle} />
        <PanelIconButton icon={Github} size={14} label="Repository" variant="outline" onClick={handleOpenRepository} disabled={openBusy} style={hubButtonStyle} />
        <PanelIconButton icon={Link} size={14} label="Link" variant="outline" onClick={() => setStep('link')} disabled={openBusy} style={hubButtonStyle} />
        {openError && (
          <div style={{ flexBasis: '100%', fontSize: '0.76rem', lineHeight: 1.35, color: statusColors.error, fontFamily: "'EmOne', sans-serif" }}>
            {openError}
          </div>
        )}
      </>
    )
  });

  // Open an Existing Universe → Link: the link box, inside this one.
  const renderLinkStep = () => (
    <ExternalLinkLoadModal
      isOpen
      embedded
      compact={isCompactLayout}
      renderBack={(onBack) => backButton(onBack)}
      onBack={() => setStep('slots')}
      onSaveAsLocalFile={async (storeState, suggestedName) => {
        const result = await saveLinkedAsLocalFile(storeState, suggestedName);
        landOpened({ slug: result.slug, name: result.name, local: result.fileName });
      }}
      onPublishToRepo={async (target) => {
        const result = await publishLinkedToRepo(target);
        landOpened({ slug: result.slug, name: result.name, git: `@${target.repoOwner}/${target.repoName}` });
      }}
      onOpenReadOnly={async (storeState, suggestedName, sourceUrl) => {
        // Just looking: the read-only view takes the screen, and this box
        // waits behind it, back at its start.
        setStep('slots');
        await universeBackend.openReadOnlyUniverse(sourceUrl);
      }}
    />
  );

  // Browser only: the first page. The same header and cards as the hub, for
  // the apps, then Continue on Web to the hub.
  const getAppButtonStyle = { ...hubButtonStyle, padding: '9px 14px' };
  const getAppButton = (icon, label, url) => (
    <PanelIconButton
      icon={icon}
      size={16}
      labelFontSize={14}
      label={label}
      variant="outline"
      onClick={() => openExternalUrl(url)}
      style={getAppButtonStyle}
    />
  );
  const renderGetAppStep = () => (
    <>
      <div style={{ textAlign: 'center', marginBottom: isCompactLayout ? '18px' : '22px', flexShrink: 0 }}>
        <h1 style={{
          margin: '0 0 6px 0',
          color: theme.canvas.brandText,
          fontSize: isCompactLayout ? '1.25rem' : '1.45rem',
          fontWeight: '600',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Welcome to Redstring
        </h1>
        <h2 style={{
          margin: 0,
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '0.85rem' : '1.05rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Get the App
        </h2>
      </div>

      <div style={{ flexShrink: 0 }}>
        {hubCard({
          icon: <Monitor size={22} />,
          title: 'Desktop',
          description: 'Mac, Windows and Linux',
          children: hubActions(getAppButton(Download, 'Download', DESKTOP_DOWNLOAD_URL))
        })}
        {hubCard({
          icon: <Smartphone size={22} />,
          title: 'Mobile',
          description: 'iPhone, iPad and Android',
          children: hubActions(
            <>
              {getAppButton(Download, 'App Store', APP_STORE_URL)}
              {getAppButton(Download, 'Google Play', GOOGLE_PLAY_URL)}
            </>
          )
        })}
      </div>

      <div style={{ marginTop: isCompactLayout ? '14px' : '18px', flexShrink: 0 }}>
        {primaryCta({ label: 'Continue on Web', onClick: () => setStep('slots'), large: true })}
      </div>
    </>
  );

  const renderSlotsStep = () => (
    <>
      <style>{'@keyframes rs-onboarding-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
      {offerGetApp && !anySlotFilled && backButton(() => setStep('get-app'))}
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: isCompactLayout ? '18px' : '22px', flexShrink: 0 }}>
        <h1 style={{
          margin: '0 0 6px 0',
          color: theme.canvas.brandText,
          fontSize: isCompactLayout ? '1.25rem' : '1.45rem',
          fontWeight: '600',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Welcome to Redstring
        </h1>
        <h2 style={{
          margin: 0,
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '0.85rem' : '1.05rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          {anySlotFilled ? 'Add another place to save or get connected' : 'Set up your first Universe'}
        </h2>
      </div>

      {/* Workspace folder (desktop) — global location where local files land */}
      {showWorkspaceRow && (
        <div style={{ marginBottom: '14px', flexShrink: 0 }}>
          <div style={{
            padding: isCompactLayout ? '10px 12px' : '12px 14px',
            backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            borderRadius: 8,
            border: `1px solid ${theme.canvas.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
              {workspaceFolder
                ? <FolderOpen size={22} color={theme.canvas.brandText} />
                : <Folder size={22} color={theme.canvas.textSecondary} />}
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: theme.canvas.textPrimary, fontFamily: "'EmOne', sans-serif" }}>
                  Workspace Folder
                </span>
                <span style={{
                  fontSize: '0.65rem',
                  color: workspaceFolder ? theme.canvas.textPrimary : theme.canvas.textSecondary,
                  ...(workspaceFolder && { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
                  fontFamily: "'EmOne', sans-serif"
                }}>
                  {workspaceFolder || 'Where local files are kept'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
              <PanelIconButton
                icon={workspaceFolder ? FolderOpen : Upload}
                label={workspaceFolder ? 'Change' : 'Choose'}
                title={workspaceFolder ? 'Change workspace folder' : 'Choose workspace folder'}
                variant="outline"
                size={14}
                onClick={handlePickWorkspaceFolder}
              />
              {workspaceFolder && (
                <PanelIconButton
                  icon={X}
                  title="Unlink workspace folder"
                  variant="outline"
                  size={14}
                  onClick={handleClearWorkspaceFolder}
                />
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

      {/* This one universe, and the way in for one that already exists */}
      <div style={{ flexShrink: 0 }}>
        {renderCreateCard()}
        {!anySlotFilled && renderOpenExistingCard()}
      </div>

      {/* Get Connected — always visible, greyed out until a slot is filled */}
      <div style={{ marginTop: isCompactLayout ? '14px' : '18px', flexShrink: 0 }}>
        {primaryCta({ label: 'Get Connected', onClick: () => onFinishOnboarding?.(), disabled: !anySlotFilled, large: true })}

        {/* Escape hatch. Without it, onboarding is a dead end wherever no local
            file can be linked — a browser with no File System Access API, or a
            page served over a non-secure origin, where GitHub becomes the only
            fillable slot. Browser storage is still an explicit choice here, not
            a preloaded universe. */}
        {!anySlotFilled && onBrowserStorageSelected && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
            <button
              type="button"
              onClick={() => onBrowserStorageSelected()}
              style={{
                background: 'none',
                border: 'none',
                padding: '4px 8px',
                cursor: 'pointer',
                color: theme.canvas.textSecondary || theme.canvas.textPrimary,
                fontFamily: "'EmOne', sans-serif",
                fontSize: '0.78rem',
                textDecoration: 'underline',
                opacity: 0.85
              }}
              title="Start now with storage in this browser. You can link GitHub or a local file later."
            >
              Continue Without Linking
            </button>
          </div>
        )}
      </div>
    </>
  );

  // --- GitHub wizard steps ---

  const renderGitConnectStep = () => (
    <>
      {backButton(leaveGitFlow)}
      <GitHubConnectStep
        connection={github}
        compact={isCompactLayout}
        onContinue={() => setStep(afterConnectStep)}
        allowOAuthOnly
      />
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
        <p style={{ color: theme.canvas.textPrimary, opacity: 0.8, margin: 0, fontSize: isCompactLayout ? '0.8rem' : '0.9rem' }}>
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
        {primaryCta({
          label: 'Create Universe Here',
          disabled: !newRepoName.trim(),
          onClick: () => {
            if (!newRepoName.trim()) return;
            setRepoChoice('create');
            setSelectedRepo(null);
            startFinishing();
          }
        })}
      </div>

      {/* Or link an existing repo */}
      <div style={{ ...repoCardStyle(), marginBottom: 0 }}>
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
                <PanelIconButton
                  icon={RefreshCw}
                  label="Retry"
                  variant="ghost"
                  size={14}
                  onClick={loadRepoList}
                  style={{ marginLeft: '4px' }}
                />
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

  // Open an Existing Universe → Repository: the repository, then the universe
  // in it. Repos open in place to show what a scan found there.
  const renderGitOpenStep = () => (
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
          Open From GitHub
        </h2>
        <p style={{ color: theme.canvas.textPrimary, opacity: 0.8, margin: 0, fontSize: isCompactLayout ? '0.8rem' : '0.9rem' }}>
          Choose the repository your universe lives in.
        </p>
      </div>

      <div style={{ ...repoCardStyle(), marginBottom: 0 }}>
        {repoListLoading && (
          <div style={{ textAlign: 'center', padding: '14px', fontSize: '0.85rem', color: theme.canvas.textSecondary }}>
            Loading repositories…
          </div>
        )}
        {repoListError && (
          <div style={{ padding: '10px', fontSize: '0.8rem', color: statusColors.error }}>
            {repoListError}
            <PanelIconButton
              icon={RefreshCw}
              label="Retry"
              variant="ghost"
              size={14}
              onClick={loadRepoList}
              style={{ marginLeft: '4px' }}
            />
          </div>
        )}
        {!repoListLoading && !repoListError && Array.isArray(repoList) && repoList.length === 0 && (
          <div style={{ textAlign: 'center', padding: '14px', fontSize: '0.85rem', color: theme.canvas.textSecondary }}>
            No repositories found on your account.
          </div>
        )}
        {!repoListLoading && Array.isArray(repoList) && repoList.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {repoList.map((repo) => {
              const info = repoKeyOf(repo);
              if (!info) return null;
              const expanded = openRepoKey === info.key;
              const scan = repoUniverses[info.key];
              return (
                <div key={repo.id || info.key}>
                  <div
                    onClick={() => toggleOpenRepo(repo)}
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
                  >
                    {repo.private ? <Lock size={13} /> : <Globe size={13} />}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {repo.full_name || repo.name}
                    </span>
                    <ArrowRight
                      size={14}
                      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
                    />
                  </div>

                  {expanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 0 4px 18px' }}>
                      {scan?.loading && (
                        <div style={{ padding: '6px 4px', fontSize: '0.8rem', color: theme.canvas.textSecondary }}>
                          Looking for universes…
                        </div>
                      )}
                      {scan?.error && (
                        <div style={{ padding: '6px 4px', fontSize: '0.8rem', color: statusColors.error }}>
                          {scan.error}
                        </div>
                      )}
                      {Array.isArray(scan?.list) && scan.list.length === 0 && (
                        <div style={{ padding: '6px 4px', fontSize: '0.8rem', color: theme.canvas.textSecondary }}>
                          No universes in this repository.
                        </div>
                      )}
                      {Array.isArray(scan?.list) && scan.list.map((universe, index) => {
                        const label = universe.name || universe.slug
                          || (universe.fileName || '').replace(/\.redstring$/i, '') || `Universe ${index + 1}`;
                        return (
                          <div
                            key={universe.path || universe.slug || index}
                            onClick={() => startOpening({ universe, user: info.user, repo: info.repo })}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '7px 10px',
                              borderRadius: '6px',
                              border: `1px solid ${theme.canvas.border}`,
                              cursor: 'pointer',
                              fontSize: '0.82rem',
                              color: theme.canvas.textPrimary,
                              fontFamily: "'EmOne', sans-serif"
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.1)' : '#fff'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <FileText size={13} />
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {label}
                            </span>
                            <ArrowRight size={13} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  const renderGitFinishingStep = () => {
    const opening = gitIntent === 'open';
    const tasks = opening ? OPEN_REPO_TASKS : GIT_ONBOARDING_TASKS;
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
            {opening ? 'Opening Your Universe' : 'Setting Up Your Universe'}
          </h2>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          fontFamily: "'EmOne', sans-serif"
        }}>
          {tasks.map((task) => {
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
          <div style={{ marginTop: '16px' }}>
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
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <PanelIconButton
                icon={ArrowLeft}
                label="Back"
                variant="outline"
                onClick={() => setStep(afterConnectStep)}
              />
              <PanelIconButton
                icon={RefreshCw}
                label="Retry"
                labelPosition="right"
                variant="solid"
                onClick={opening ? () => startOpening(openPick, { retry: true }) : startFinishing}
              />
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
      case 'git-open': return renderGitOpenStep();
      case 'git-finishing': return renderGitFinishingStep();
      case 'link': return renderLinkStep();
      case 'get-app': return renderGetAppStep();
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
      contentStyle={{ overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}
      disableBackdrop
      disableEscapeClose
      {...canvasModalProps}
    >
      <div style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden'
      }}>
        {/* Scrollable content area. Sized to the step by the measurement above,
            so this only actually scrolls when the step is taller than the
            viewport allows — clipping is no longer possible either way. */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          padding: `${contentPadTop}px ${contentPadX}px ${contentPadBottom}px`,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* `margin: auto 0` centers the step vertically when it fits and
              simply falls back to top-aligned scrolling when it does not
              (unlike justify-content: center, which clips the overflow). */}
          <div
            ref={contentRef}
            style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', width: '100%' }}
          >
            {renderStep()}
          </div>
        </div>
      </div>
    </CanvasModal>
    </>
  );
};

export default StorageSetupModal;
