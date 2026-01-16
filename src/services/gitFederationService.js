import universeBackendBridge from './universeBackendBridge.js';
import { persistentAuth } from './persistentAuth.js';
import { oauthUrl } from './bridgeConfig.js';
import { formatUniverseNameFromRepo, buildUniqueUniverseName } from '../utils/universeNaming.js';
const GF_TAG = '[GF-DEBUG]';
const { log: __gfNativeLog, warn: __gfNativeWarn } = console;
const gfLog = (...args) => __gfNativeLog.call(console, GF_TAG, ...args);
const gfWarn = (...args) => __gfNativeWarn.call(console, GF_TAG, ...args);

const STORAGE_TYPES = {
  GIT: 'git',
  LOCAL: 'local',
  BROWSER: 'browser'
};

const slotId = (() => {
  let counter = Date.now();
  return () => `slot_${(counter++).toString(36)}`;
})();

// Throttle noisy slot-building logs without relying on `this`
let __lastSlotLogAt = 0;
// Track last emitted payload per universe to avoid spammy duplicate logs
const __lastSlotLogBySlug = new Map();

function toIsoTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(value).toISOString();
  }
  const date = new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : null;
}

function resolveLocalStatus(localFile = {}) {
  if (!localFile.enabled) {
    return {
      label: 'Disabled',
      hint: 'Local saves are turned off for this universe.',
      tone: '#666',
      state: 'disabled'
    };
  }

  if (localFile.fileHandleStatus === 'needs_reconnect') {
    return {
      label: 'Needs reconnect',
      hint: 'Reconnect this file to resume automatic local saves.',
      tone: '#c62828',
      state: 'needs_reconnect'
    };
  }

  if (localFile.fileHandleStatus === 'permission_needed') {
    return {
      label: 'Permission required',
      hint: 'Grant file permissions to allow local saves.',
      tone: '#ef6c00',
      state: 'permission_needed'
    };
  }

  if (localFile.unavailableReason) {
    return {
      label: 'Unavailable',
      hint: localFile.unavailableReason,
      tone: '#c62828',
      state: 'unavailable'
    };
  }

  if (localFile.hadFileHandle || localFile.hadHandle) {
    return {
      label: 'Connected',
      hint: 'Autosave to this file is active.',
      tone: '#2e7d32',
      state: 'connected'
    };
  }

  return {
    label: 'Configured',
    hint: 'Link a persistent file handle to enable autosave.',
    tone: '#1565c0',
    state: 'configured'
  };
}

function normalizeRepository(linkedRepo) {
  if (!linkedRepo) return null;
  if (typeof linkedRepo === 'string') {
    const [user, repo] = linkedRepo.split('/');
    return user && repo ? { user, repo } : null;
  }
  if (linkedRepo.user && linkedRepo.repo) {
    return {
      user: linkedRepo.user,
      repo: linkedRepo.repo,
      branch: linkedRepo.branch || 'main',
      universeFolder: linkedRepo.universeFolder,
      universeFile: linkedRepo.universeFile
    };
  }
  return null;
}

function buildSlotsFromUniverse(universe, syncStatus = null, syncInfo = null) {
  const slots = [];
  const metadataLastSync = toIsoTimestamp(universe.metadata?.lastSync || universe.metadata?.lastSaved);

  if (universe.gitRepo?.linkedRepo) {
    const repo = normalizeRepository(universe.gitRepo.linkedRepo);
    if (repo) {
      const lastCommitIso = toIsoTimestamp(syncStatus?.lastCommitTime);
      const slotStatusLabel = syncInfo?.label || syncStatus?.state || universe.metadata?.syncStatus || 'Unknown';

      // DEBUG: Log status resolution only when it changes (with a periodic refresh)
      const fingerprint = [
        slotStatusLabel,
        syncStatus?.state || 'null',
        syncInfo?.label || 'null',
        syncInfo?.description || 'null',
        syncInfo?.tone || 'null'
      ].join('|');

      const prev = __lastSlotLogBySlug.get(universe.slug);
      const now = Date.now();
      const shouldLog = !prev || prev.fingerprint !== fingerprint || (now - prev.at > 15000);
      if (shouldLog) {
        __lastSlotLogAt = now;
        __lastSlotLogBySlug.set(universe.slug, { fingerprint, at: now });
        console.log(`[gitFederationService] Building Git slot for ${universe.slug}:`, {
          'syncInfo?.label': syncInfo?.label,
          'syncInfo?.tone': syncInfo?.tone,
          'syncInfo?.description': syncInfo?.description,
          'syncStatus?.state': syncStatus?.state,
          'metadata?.syncStatus': universe.metadata?.syncStatus,
          'finalStatus': slotStatusLabel,
          'hasSyncStatus': !!syncStatus,
          'hasAuth': !!syncInfo,
          'syncInfo': syncInfo
        });
      }

      const slot = {
        id: slotId(),
        type: STORAGE_TYPES.GIT,
        label: `@${repo.user}/${repo.repo}`,
        repo: {
          ...repo,
          universeFolder: universe.gitRepo.universeFolder,
          universeFile: universe.gitRepo.universeFile,
          priority: universe.gitRepo.priority || (universe.sourceOfTruth === 'git' ? 'primary' : 'secondary'),
          enabled: !!universe.gitRepo.enabled
        },
        lastSync: lastCommitIso,
        lastCommitTime: lastCommitIso,
        status: slotStatusLabel,
        statusTone: syncInfo?.tone || null,
        statusHint: syncInfo?.description || '',
        statusState: syncStatus?.state || universe.metadata?.syncStatus || 'unknown',
        syncDetails: syncStatus || null
      };
      slots.push(slot);
    }
  }

  if (universe.localFile?.enabled) {
    const localStatus = resolveLocalStatus(universe.localFile);
    slots.push({
      id: slotId(),
      type: STORAGE_TYPES.LOCAL,
      label: universe.localFile.displayPath || universe.localFile.path || `${universe.name || universe.slug}.redstring`,
      local: {
        path: universe.localFile.path,
        displayPath: universe.localFile.displayPath || universe.localFile.path,
        unavailableReason: universe.localFile.unavailableReason || null,
        hadHandle: !!universe.localFile.hadFileHandle
      },
      lastSync: toIsoTimestamp(universe.localFile.lastSaved),
      status: localStatus.label,
      statusTone: localStatus.tone,
      statusHint: localStatus.hint,
      statusState: localStatus.state
    });
  }

  if (universe.browserStorage?.enabled) {
    slots.push({
      id: slotId(),
      type: STORAGE_TYPES.BROWSER,
      label: 'Browser cache',
      browser: {
        key: universe.browserStorage.key,
        role: universe.browserStorage.role || 'fallback'
      },
      lastSync: metadataLastSync,
      status: universe.browserStorage.role === 'fallback' ? 'Fallback cache' : 'Enabled',
      statusTone: '#1565c0',
      statusHint: universe.browserStorage.role === 'fallback'
        ? 'Browser storage provides an offline safety copy.'
        : 'Browser storage enabled.',
      statusState: universe.browserStorage.role || 'browser'
    });
  }

  return slots;
}

function buildSyncInfo(universe, syncStatus) {
  const gitLinked = !!(universe.gitRepo?.linkedRepo);
  const gitEnabled = !!(universe.gitRepo?.enabled);
  const metadataLastSync = toIsoTimestamp(universe.metadata?.lastSync || universe.metadata?.lastSaved);
  const commitIso = toIsoTimestamp(syncStatus?.lastCommitTime);
  const lastSync = commitIso || metadataLastSync;

  if (!gitLinked || !gitEnabled) {
    return {
      state: 'disconnected',
      label: 'Git disconnected',
      tone: '#c62828',
      description: gitLinked ? 'Git slot disabled. Enable sync to resume automatic commits.' : 'Link a Git repository to enable automatic synchronization.',
      engine: null,
      hasGitLink: gitLinked,
      lastSync,
      pendingCommits: 0,
      isRunning: false,
      isHealthy: null,
      isInBackoff: false,
      consecutiveErrors: 0,
      lastCommitTime: null,
      lastErrorTime: null,
      sourceOfTruth: universe.sourceOfTruth
    };
  }

  if (!syncStatus) {
    // Check if auth is available
    const authStatus = persistentAuth.getAuthStatus();
    const hasAuth = authStatus?.isAuthenticated;

    return {
      state: 'standby',
      label: hasAuth ? 'Awaiting sync engine' : 'Connect GitHub to sync',
      tone: hasAuth ? '#ef6c00' : '#c62828',
      description: hasAuth
        ? 'Sync engine not initialized yet. It will start automatically once activity is detected.'
        : 'GitHub authentication required. Click "Connect GitHub" in Accounts & Access to enable sync.',
      engine: null,
      hasGitLink: true,
      lastSync,
      pendingCommits: 0,
      isRunning: false,
      isHealthy: null,
      isInBackoff: false,
      consecutiveErrors: 0,
      lastCommitTime: lastSync,
      lastErrorTime: null,
      sourceOfTruth: universe.sourceOfTruth
    };
  }

  const {
    isRunning = false,
    isPaused = false,
    pendingCommits = 0,
    isHealthy = true,
    isInErrorBackoff = false,
    consecutiveErrors = 0,
    lastCommitTime: rawLastCommitTime = null,
    lastErrorTime = null
  } = syncStatus;

  const hasChanges = !!syncStatus.hasChanges;
  const commitTimeIso = toIsoTimestamp(rawLastCommitTime);

  let state = 'idle';
  let label = 'All changes saved';
  let tone = '#2e7d32';
  let description = '';

  if (isInErrorBackoff || !isHealthy) {
    state = 'error';
    label = 'Unable to save changes';
    tone = '#c62828';
    description = 'Please check your connection and try again.';
  } else if (isRunning || pendingCommits > 0) {
    state = 'saving';
    label = 'Saving...';
    tone = '#666';
    description = '';
  } else if (isPaused) {
    state = 'paused';
    label = 'Sync paused';
    tone = '#ef6c00';
    description = 'Resume to save changes.';
  } else if (hasChanges) {
    state = 'unsaved';
    label = 'Unsaved changes';
    tone = '#ef6c00';
    description = '';
  }

  return {
    state,
    label,
    tone,
    description,
    engine: syncStatus,
    hasGitLink: true,
    lastSync,
    pendingCommits,
    hasChanges,
    hasUnsavedChanges: hasChanges || pendingCommits > 0,
    isRunning,
    isHealthy,
    isInBackoff: isInErrorBackoff,
    consecutiveErrors,
    lastCommitTime: commitTimeIso || rawLastCommitTime || lastSync,
    lastErrorTime,
    sourceOfTruth: universe.sourceOfTruth
  };
}

function mapUniverse(universe, activeSlug, syncStatusMap = {}) {
  const syncStatus = syncStatusMap?.[universe.slug] || null;
  const syncInfo = buildSyncInfo(universe, syncStatus);
  const slots = buildSlotsFromUniverse(universe, syncStatus, syncInfo);
  const primaryType = universe.sourceOfTruth === 'git'
    ? STORAGE_TYPES.GIT
    : universe.sourceOfTruth === 'local'
      ? STORAGE_TYPES.LOCAL
      : STORAGE_TYPES.BROWSER;

  const primarySlot = slots.find(slot => slot.type === primaryType) || slots[0] || null;
  const browserSlot = slots.find(slot => slot.type === STORAGE_TYPES.BROWSER) || null;

  if (!primarySlot) {
    gfWarn('[gitFederationService] mapUniverse: No primary slot resolved', {
      slug: universe.slug,
      sourceOfTruth: universe.sourceOfTruth,
      availableSlots: slots.map(s => s.type)
    });
  }

  return {
    slug: universe.slug,
    name: universe.name || universe.slug,
    sourceOfTruth: universe.sourceOfTruth,
    createdAt: universe.metadata?.created || universe.created || null,
    updatedAt: universe.metadata?.lastModified || universe.lastModified || null,
    lastOpenedAt: universe.metadata?.lastOpened || null,
    nodeCount: universe.metadata?.nodeCount || null,
    storage: {
      primary: primarySlot,
      backups: slots.filter(slot => slot !== primarySlot)
    },
    hasBrowserFallback: !!browserSlot,
    browserSlot,
    sources: Array.isArray(universe.sources) ? universe.sources : [],
    isActive: universe.slug === activeSlug,
    sync: syncInfo,
    raw: universe
  };
}

async function buildSyncStatusMap(universes) {
  if (typeof window === 'undefined') {
    return {};
  }

  if (!Array.isArray(universes) || universes.length === 0) {
    return {};
  }

  // Optimize: Only fetch sync status for universes that have Git enabled or linked
  const relevantUniverses = universes.filter(u => u.gitRepo?.enabled || u.gitRepo?.linkedRepo);

  if (relevantUniverses.length === 0) {
    return {};
  }

  console.time('[GF-DEBUG] buildSyncStatusMap');
  const entries = await Promise.all(universes.map(async (universe) => {
    if (!universe?.slug) {
      return [null, null];
    }

    // Skip sync status check if git is not relevant to avoid IPC overhead
    if (!universe.gitRepo?.enabled && !universe.gitRepo?.linkedRepo) {
      return [universe.slug, null];
    }

    try {
      const status = await universeBackendBridge.getSyncStatus(universe.slug);
      return [universe.slug, status];
    } catch (error) {
      gfWarn('[gitFederationService] Failed to load sync status for', universe.slug, error);
      return [universe.slug, null];
    }
  }));
  console.timeEnd('[GF-DEBUG] buildSyncStatusMap');

  return entries.reduce((acc, [slug, status]) => {
    if (slug) acc[slug] = status;
    return acc;
  }, {});
}

let _pendingLoadPromise = null;
let _loadCounter = 0;

async function loadBackendState() {
  // Deduplicate requests: if a load is already in progress, reuse the existing promise
  if (_pendingLoadPromise) {
    // console.log('[Perf] Reusing in-flight loadBackendState promise');
    return _pendingLoadPromise;
  }

  const loadId = ++_loadCounter;
  const label = `[GF-DEBUG:${loadId}]`;

  _pendingLoadPromise = (async () => {
    // console.log(`[Perf] loadBackendState #${loadId} Start at ${(performance.now() / 1000).toFixed(3)}s`);
    console.time(`${label} loadBackendState`);

    try {
      const [universes = [], activeUniverse, gitDashboard] = await Promise.all([
        (async () => {
          console.time(`${label} getAllUniverses`);
          const res = await universeBackendBridge.getAllUniverses();
          console.timeEnd(`${label} getAllUniverses`);
          return res;
        })(),
        (async () => {
          console.time(`${label} getActiveUniverse`);
          const res = await universeBackendBridge.getActiveUniverse();
          console.timeEnd(`${label} getActiveUniverse`);
          return res;
        })(),
        (async () => {
          if (!universeBackendBridge.getGitStatusDashboard) return null;
          console.time(`${label} getGitStatusDashboard`);
          const res = await universeBackendBridge.getGitStatusDashboard();
          console.timeEnd(`${label} getGitStatusDashboard`);
          return res;
        })()
      ]);

      const syncStatusMap = await buildSyncStatusMap(universes);
      const activeSlug = activeUniverse?.slug || null;

      const mapped = {
        universes: universes.map(universe => mapUniverse(universe, activeSlug, syncStatusMap)),
        activeUniverseSlug: activeSlug,
        activeUniverse: activeSlug ? universes.find(u => u.slug === activeSlug) : null,
        syncStatuses: syncStatusMap,
        gitDashboard: gitDashboard || null
      };

      console.timeEnd(`${label} loadBackendState`);
      // console.log(`[Perf] loadBackendState #${loadId} End at ${(performance.now() / 1000).toFixed(3)}s`);

      // DEBUG: Inspect what we are returning to the UI
      if (mapped.universes.length === 0) {
        console.warn(`${label} loadBackendState returning 0 universes!`);
      } else {
        console.log(`${label} loadBackendState loaded ${mapped.universes.length} universes`);
      }

      return mapped;
    } finally {
      _pendingLoadPromise = null;
    }
  })();

  return _pendingLoadPromise;
}

async function fetchAuthState() {
  const status = await universeBackendBridge.getAuthStatus();
  const appInstallation = persistentAuth.getAppInstallation();

  return {
    authStatus: status,
    githubAppInstallation: appInstallation
  };
}

async function ensureUniverseName(name, universes, currentSlug) {
  const safe = name?.trim() || 'Universe';
  return buildUniqueUniverseName(safe, universes.map(u => u.raw || u), currentSlug);
}

export const gitFederationService = {
  STORAGE_TYPES,

  async getState() {
    const [backendState, authState] = await Promise.all([
      loadBackendState(),
      fetchAuthState()
    ]);
    return {
      ...backendState,
      ...authState
    };
  },

  async refreshUniverses() {
    return loadBackendState();
  },

  async refreshAuth() {
    return fetchAuthState();
  },

  async createUniverse(name, options = {}) {
    const state = await loadBackendState();
    const uniqueName = await ensureUniverseName(name, state.universes, null);

    const createdUniverse = await universeBackendBridge.createUniverse(uniqueName, {
      enableGit: options.enableGit ?? false,
      enableLocal: options.enableLocal ?? true,
      sourceOfTruth: options.sourceOfTruth
    });
    const nextState = await this.refreshUniverses();
    return {
      ...nextState,
      createdUniverse
    };
  },

  async deleteUniverse(slug) {
    await universeBackendBridge.deleteUniverse(slug);
    return this.refreshUniverses();
  },

  async switchUniverse(slug, { saveCurrent = true } = {}) {
    await universeBackendBridge.switchActiveUniverse(slug, { saveCurrent });
    return this.getState();
  },

  async renameUniverse(slug, nextName) {
    const state = await this.refreshUniverses();
    const universe = state.universes.find(u => u.slug === slug);
    if (!universe) {
      throw new Error(`Universe not found: ${slug}`);
    }
    const uniqueName = await ensureUniverseName(nextName, state.universes, slug);
    await universeBackendBridge.updateUniverse(slug, { name: uniqueName });
    return this.refreshUniverses();
  },

  async setPrimaryStorage(slug, type, extra = {}) {
    const state = await this.refreshUniverses();
    const universe = state.universes.find(u => u.slug === slug);
    if (!universe) {
      throw new Error(`Universe not found: ${slug}`);
    }

    gfLog('[gitFederationService] setPrimaryStorage requested:', {
      slug,
      type,
      extra,
      currentSourceOfTruth: universe.raw?.sourceOfTruth,
      availableSlots: universe.storage
    });

    const payload = {};

    if (type === STORAGE_TYPES.GIT) {
      payload.sourceOfTruth = 'git';
      if (extra.gitRepo) {
        payload.gitRepo = {
          ...universe.raw.gitRepo,
          ...extra.gitRepo,
          enabled: true
        };
      } else if (universe.raw.gitRepo) {
        payload.gitRepo = { ...universe.raw.gitRepo, enabled: true };
      }
    } else if (type === STORAGE_TYPES.LOCAL) {
      payload.sourceOfTruth = 'local';
      payload.gitRepo = { ...universe.raw.gitRepo, enabled: false };
      payload.localFile = { ...universe.raw.localFile, enabled: true };
    } else if (type === STORAGE_TYPES.BROWSER) {
      payload.sourceOfTruth = 'browser';
      payload.browserStorage = { ...universe.raw.browserStorage, enabled: true };
    }

    gfLog('[gitFederationService] setPrimaryStorage payload:', payload);

    await universeBackendBridge.updateUniverse(slug, payload);
    gfLog('[gitFederationService] setPrimaryStorage update sent');
    return this.refreshUniverses();
  },

  /**
   * Attach Git repository to an existing universe
   * 
   * IMPORTANT: This implements the 2-SLOT STORAGE SYSTEM
   * - Universes can have BOTH local file AND Git storage simultaneously
   * - sourceOfTruth determines which is PRIMARY (authoritative)
   * - The other slot serves as BACKUP/SECONDARY storage
   * 
   * This function preserves the existing sourceOfTruth to avoid data loss:
   * - If universe has local file enabled → keeps 'local' as primary, Git becomes backup
   * - If universe has no sourceOfTruth set → defaults to 'git'
   * - User can explicitly change primary via setPrimaryStorage()
   */
  async attachGitRepository(slug, repoConfig) {
    const state = await this.refreshUniverses();
    const universe = state.universes.find(u => u.slug === slug);
    if (!universe) {
      throw new Error(`Universe not found: ${slug}`);
    }

    const repo = {
      type: 'github',
      user: repoConfig.user,
      repo: repoConfig.repo
    };

    const linkedRepo = {
      type: 'github',
      user: repoConfig.user,
      repo: repoConfig.repo,
      authMethod: repoConfig.authMethod || 'oauth'
    };

    // CRITICAL: Respect existing sourceOfTruth to support 2-slot system
    // Only default to 'git' if there's no existing sourceOfTruth preference
    // This allows local-file-only universes to add Git as backup without losing local data
    const preservedSourceOfTruth = universe.raw.sourceOfTruth ||
      (universe.raw.localFile?.enabled ? 'local' : 'git');

    await universeBackendBridge.updateUniverse(slug, {
      gitRepo: {
        ...universe.raw.gitRepo,
        enabled: true,
        linkedRepo,
        universeFolder: repoConfig.universeFolder || universe.raw.gitRepo?.universeFolder || slug,
        universeFile: repoConfig.universeFile || universe.raw.gitRepo?.universeFile || `${slug}.redstring`
      },
      sourceOfTruth: preservedSourceOfTruth
    });

    await universeBackendBridge.updateUniverse(slug, {
      sources: this.mergeSources(universe.raw.sources, {
        id: `src_${Date.now().toString(36)}`,
        type: 'github',
        user: repo.user,
        repo: repo.repo,
        name: `@${repo.user}/${repo.repo}`,
        addedAt: new Date().toISOString()
      })
    });

    return this.refreshUniverses();
  },

  async detachGitRepository(slug, repo) {
    const state = await this.refreshUniverses();
    const universe = state.universes.find(u => u.slug === slug);
    if (!universe) {
      throw new Error(`Universe not found: ${slug}`);
    }

    const sources = (universe.raw.sources || []).filter(src => {
      if (src.type !== 'github') return true;
      const sameUser = src.user?.toLowerCase() === repo.user.toLowerCase();
      const sameRepo = src.repo?.toLowerCase() === repo.repo.toLowerCase();
      return !(sameUser && sameRepo);
    });

    const payload = {
      sources
    };

    const linkedRepo = normalizeRepository(universe.raw.gitRepo?.linkedRepo);
    const wasLinkedRepo = linkedRepo && linkedRepo.user.toLowerCase() === repo.user.toLowerCase() && linkedRepo.repo.toLowerCase() === repo.repo.toLowerCase();

    if (wasLinkedRepo) {
      payload.gitRepo = {
        ...universe.raw.gitRepo,
        enabled: false,
        linkedRepo: null
      };
      payload.sourceOfTruth = universe.raw.localFile?.fileHandle ? 'local' : 'browser';
    }

    await universeBackendBridge.updateUniverse(slug, payload);

    // If this was the active linked repo, reload the universe from the new source of truth
    if (wasLinkedRepo) {
      gfLog(`[GitFederationService] Reloading universe ${slug} from new source: ${payload.sourceOfTruth}`);
      try {
        await universeBackendBridge.reloadUniverse(slug);
      } catch (error) {
        gfWarn(`[GitFederationService] Failed to reload universe after detach:`, error);
      }
    }

    return this.refreshUniverses();
  },

  mergeSources(existing = [], next) {
    const dedupeKey = src => src.type === 'github' ? `${src.type}:${src.user?.toLowerCase()}/${src.repo?.toLowerCase()}` : `${src.type}:${src.id}`;
    const map = new Map();
    existing.forEach(item => {
      const key = dedupeKey(item);
      if (!map.has(key)) map.set(key, item);
    });
    const nextKey = dedupeKey(next);
    map.set(nextKey, next);
    return Array.from(map.values());
  },

  async discoverUniverses(repoConfig) {
    const discovered = await universeBackendBridge.discoverUniversesInRepository({
      type: 'github',
      user: repoConfig.user,
      repo: repoConfig.repo,
      authMethod: repoConfig.authMethod || 'oauth'
    });
    return discovered;
  },

  async linkDiscoveredUniverse(discovered, repoConfig) {
    await universeBackendBridge.linkToDiscoveredUniverse(discovered, {
      type: 'github',
      user: repoConfig.user,
      repo: repoConfig.repo,
      authMethod: repoConfig.authMethod || 'oauth'
    });
    return this.getState();
  },

  async forceSave(slug, options) {
    await universeBackendBridge.forceSave(slug, undefined, options);
    return this.refreshUniverses();
  },

  async reloadActiveUniverse() {
    await universeBackendBridge.reloadActiveUniverse?.();
    return this.refreshUniverses();
  },

  async downloadLocalFile(slug) {
    await universeBackendBridge.downloadLocalFile(slug);
    return this.refreshUniverses();
  },

  async downloadGitUniverse(slug) {
    await universeBackendBridge.downloadGitUniverse(slug);
    return this.refreshUniverses();
  },

  async requestLocalFilePermission(slug) {
    const result = await universeBackendBridge.requestLocalFilePermission(slug);
    await this.refreshUniverses();
    return result;
  },

  async removeLocalFile(slug) {
    await universeBackendBridge.removeLocalFileLink(slug);
    return this.refreshUniverses();
  },

  async uploadLocalFile(file, slug) {
    const result = await universeBackendBridge.uploadLocalFile(file, slug);
    await this.refreshUniverses();
    return result; // Return the upload result so caller can check needsFileHandle flag
  },

  getOAuthRedirectUri() {
    return oauthUrl('/oauth/callback');
  },

  ensureAppInstallation() {
    return persistentAuth.getAppInstallation();
  }
};

export default gitFederationService;
export { STORAGE_TYPES };
