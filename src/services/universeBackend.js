/**
 * Universe Backend Service
 *
 * This is the TRUE backend for universe management that should run independently
 * of any UI components. All universe operations should go through this service.
 *
 * The UI (UniverseManager.jsx) should ONLY display data and call these methods.
 */

import { GitSyncEngine } from '../backend/sync/index.js';
import { persistentAuth } from '../backend/auth/index.js';
import { SemanticProviderFactory } from '../backend/git/index.js';
import startupCoordinator from './startupCoordinator.js';
import { exportToRedstring, importFromRedstring, downloadRedstringFile } from '../formats/redstringFormat.js';
import { v4 as uuidv4 } from 'uuid';
import {
  getCurrentDeviceConfig,
  shouldUseGitOnlyMode,
  getOptimalDeviceConfig,
  hasCapability
} from '../utils/deviceDetection.js';
import { oauthFetch } from './bridgeConfig.js';
import { storageWrapper } from '../utils/storageWrapper.js';
import {
  storeFileHandleMetadata,
  getFileHandleMetadata,
  getAllFileHandleMetadata,
  attemptRestoreFileHandle,
  verifyFileHandleAccess,
  checkFileHandlePermission,
  requestFileHandlePermission,
  touchFileHandle,
  removeFileHandleMetadata
} from './fileHandlePersistence.js';
import {
  isElectron,
  hasFileSystemAccess,
  pickFile,
  pickSaveLocation,
  readFile,
  writeFile,
  fileExists,
  getFileIdentifier,
  getFileName
} from '../utils/fileAccessAdapter.js';

const { log: __umNativeLog, warn: __umNativeWarn, error: __umNativeError } = console;
const umLog = (...args) => __umNativeLog.call(console, '[UniverseBackend]', ...args);
const umWarn = (...args) => __umNativeWarn.call(console, '[UniverseBackend]', ...args);
const umError = (...args) => __umNativeError.call(console, '[UniverseBackend]', ...args);

// Storage keys
const STORAGE_KEYS = {
  UNIVERSES_LIST: 'unified_universes_list',
  ACTIVE_UNIVERSE: 'active_universe_slug',
  UNIVERSE_FILE_HANDLES: 'universe_file_handles'
};

// Source of truth constants
const SOURCE_OF_TRUTH = {
  LOCAL: 'local',
  GIT: 'git',
  BROWSER: 'browser'
};

// Helper functions for universe discovery (inlined from deleted universeDiscovery.js)
const extractSchemaPath = (filePath) => {
  const parts = (filePath || '').split('/').filter(Boolean);
  if (parts.length <= 1) {
    const fileBase = parts[parts.length - 1] || '';
    return fileBase.replace(/\.redstring$/i, '') || 'default';
  }
  parts.pop(); // Remove filename
  const folder = parts.pop();
  return folder || 'default';
};

const createUniverseConfigFromDiscovered = (discoveredUniverse, repoConfig) => {
  const baseFileName = String(discoveredUniverse.fileName || '').replace(/\.redstring$/i, '');
  return {
    slug: discoveredUniverse.slug,
    name: baseFileName || discoveredUniverse.name,
    nodeCount: discoveredUniverse.metadata?.nodeCount,
    connectionCount: discoveredUniverse.metadata?.connectionCount,
    graphCount: discoveredUniverse.metadata?.graphCount,
    sourceOfTruth: 'git',
    localFile: {
      enabled: false,
      unavailableReason: 'Linked to Git repository'
    },
    gitRepo: {
      enabled: true,
      linkedRepo: {
        type: repoConfig.type,
        user: repoConfig.user,
        repo: repoConfig.repo,
        authMethod: repoConfig.authMethod
      },
      schemaPath: 'schema',
      universeFolder: extractSchemaPath(discoveredUniverse.path),
      universeFile: discoveredUniverse.fileName,
      priority: 'primary'
    },
    metadata: {
      ...discoveredUniverse.metadata,
      discoveredAt: new Date().toISOString(),
      originalPath: discoveredUniverse.path
    }
  };
};

const discoverUniversesWithStats = async (provider) => {
  const stats = { scannedDirs: 0, candidates: 0, valid: 0, invalid: 0 };
  const universes = [];

  const normalizePathValue = (value) => {
    if (provider && typeof provider.normalizePathInput === 'function') {
      const normalized = provider.normalizePathInput(value);
      if (typeof normalized === 'string') {
        return normalized.replace(/^\/+/, '').replace(/\/+$/, '');
      }
    }

    if (value == null) {
      return '';
    }

    if (typeof value === 'string') {
      if (value === '[object Object]') {
        return '';
      }
      return value.replace(/^\/+/, '').replace(/\/+$/, '');
    }

    if (Array.isArray(value)) {
      return value.filter(Boolean).join('/');
    }

    if (typeof value === 'object') {
      if (typeof value.path === 'string') return normalizePathValue(value.path);
      if (typeof value.fullPath === 'string') return normalizePathValue(value.fullPath);
      if (typeof value.relativePath === 'string') return normalizePathValue(value.relativePath);
      if (Array.isArray(value.segments)) return normalizePathValue(value.segments);
      if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
        return normalizePathValue(value.toString());
      }
      return '';
    }

    const fallback = String(value);
    return fallback === '[object Object]' ? '' : fallback;
  };

  const joinPaths = (...parts) => parts
    .map(part => normalizePathValue(part))
    .filter(segment => segment.length > 0)
    .join('/');

  const tryParseRedstring = (text) => {
    try {
      const data = JSON.parse(text);
      const storeState = data?.storeState || data; // tolerate plain store dumps

      let nodeCount = 0;
      if (storeState) {
        if (Array.isArray(storeState.nodes)) {
          nodeCount = storeState.nodes.length;
        } else if (storeState.nodePrototypes) {
          nodeCount = (storeState.nodePrototypes instanceof Map
            ? storeState.nodePrototypes.size
            : Object.keys(storeState.nodePrototypes || {}).length);
        }
      }

      const graphsVal = storeState?.graphs;
      const graphCount = graphsVal
        ? (graphsVal instanceof Map ? graphsVal.size : Object.keys(graphsVal || {}).length)
        : null;

      const edgesVal = storeState?.edges;
      const connectionCount = edgesVal
        ? (Array.isArray(edgesVal) ? edgesVal.length : Object.keys(edgesVal || {}).length)
        : 0;

      return { nodeCount, graphCount, connectionCount };
    } catch {
      return { nodeCount: null, graphCount: null, connectionCount: null };
    }
  };

  const collectFromDir = async (dirPath) => {
    stats.scannedDirs += 1;
    const safeDirPath = normalizePathValue(dirPath);
    const items = await provider.listDirectoryContents(safeDirPath);
    for (const item of items) {
      const itemName = typeof item.name === 'string' ? item.name.trim() : '';
      if (itemName === '[object Object]' || itemName === 'object Object') {
        continue;
      }

      if (item.type === 'dir') {
        // Skip backup/archive directories
        const dirName = (item.name || '').toLowerCase();
        if (/^(\.?backups?|\.?archive|\.?old|\.?bak)$/.test(dirName)) {
          continue;
        }
        const nextDirPath = normalizePathValue(item.path) || joinPaths(safeDirPath, item.name);
        if (!nextDirPath) {
          continue;
        }
        await collectFromDir(nextDirPath);
        continue;
      }
      if (item.type === 'file' && /\.redstring$/i.test(item.name)) {
        stats.candidates += 1;
        const base = item.name.replace(/\.redstring$/i, '');
        const itemPath = normalizePathValue(item.path) || joinPaths(safeDirPath, item.name);
        const discovered = {
          name: base,
          slug: base,
          path: itemPath,
          fileName: item.name,
          metadata: {}
        };
        try {
          // Best-effort: extract simple metrics for nicer UI
          const content = await provider.readFileRaw(itemPath);
          const metrics = tryParseRedstring(content);
          if (metrics.nodeCount != null) discovered.metadata.nodeCount = metrics.nodeCount;
          if (metrics.graphCount != null) discovered.metadata.graphCount = metrics.graphCount;
          if (metrics.connectionCount != null) discovered.metadata.connectionCount = metrics.connectionCount;
          stats.valid += 1;
        } catch {
          // File might not be readable (missing or access) — still list it
          stats.invalid += 1;
        }
        universes.push(discovered);
      }
    }
  };

  // Prefer standard location first (GitHub API is case-sensitive, try common variants)
  for (const folder of ['universes', 'Universe', 'Universes']) {
    await collectFromDir(folder).catch(() => { });
    if (universes.length > 0) break;
  }

  // If nothing found under universes/, do a shallow root scan as a fallback
  if (universes.length === 0) {
    try {
      const rootItems = await provider.listDirectoryContents('');
      for (const item of rootItems) {
        const itemName = typeof item.name === 'string' ? item.name.trim() : '';
        if (itemName === '[object Object]' || itemName === 'object Object') {
          continue;
        }

        if (item.type === 'file' && /\.redstring$/i.test(item.name)) {
          stats.candidates += 1;
          const base = item.name.replace(/\.redstring$/i, '');
          universes.push({
            name: base,
            slug: base,
            path: normalizePathValue(item.path) || item.name,
            fileName: item.name,
            metadata: {}
          });
          stats.valid += 1;
        }
      }
    } catch {
      // ignore
    }
  }

  // Deduplicate by slug (keep first occurrence = shallowest path)
  const seen = new Set();
  const deduped = [];
  for (const u of universes) {
    if (!seen.has(u.slug)) {
      seen.add(u.slug);
      deduped.push(u);
    }
  }

  return { universes: deduped, stats };
};

const LOCAL_FILE_ERROR = {
  PERMISSION: 'LOCAL_FILE_PERMISSION',
  MISSING: 'LOCAL_FILE_MISSING',
  NOT_FOUND: 'LOCAL_FILE_NOT_FOUND'
};

function createLocalFileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

class UniverseBackend {
  constructor() {

    // Core universe state (from universeManager)
    this.universes = new Map(); // slug -> universe config
    this.activeUniverseSlug = null;

    // File and Git engine management
    this.fileHandles = new Map(); // slug -> FileSystemFileHandle
    this.gitSyncEngines = new Map(); // slug -> GitSyncEngine

    // Status and initialization
    this.statusHandlers = new Set();
    this.isInitialized = false;
    this.initializationPromise = null;
    this.autoSetupScheduled = false;
    this.authStatus = null;
    this.loggedMergeWarning = false;

    // Background load tracking to prevent race conditions
    this.pendingBackgroundLoadId = null;

    // Device configuration
    this.deviceConfig = null;
    this.isGitOnlyMode = false;

    // Process watchdog
    this.watchdogInterval = null;
    this.watchdogDelay = 60000;

    // Store operations (injected)
    this.storeOperations = null;

    // Git operation tracking for dashboard
    this.gitOperationStatus = new Map();
    this.globalGitStatus = {
      isConnected: false,
      lastConnection: null,
      totalUniverses: 0,
      syncedUniverses: 0,
      pendingOperations: 0,
      lastGlobalSync: null
    };

    this.persistentStorageRequested = false;
    this.lastAuthEngineSetup = 0;
    this.pendingPrimarySelection = new Set();
    this.secondarySyncTimestamps = new Map();
    this.restoreHandlesPromise = null;

    // Load universes from storage

    this.loadFromStorage();


    // Initialize device config after a brief delay
    setTimeout(() => {
      this.initializeDeviceConfig();
    }, 100);

    // Attempt to restore file handles immediately (reduced delay to prevent race conditions)
    // File handles need to be restored before the UI tries to access them
    this.scheduleRestoreFileHandles(10);

  }

  scheduleRestoreFileHandles(delay = 200) {
    if (this.restoreHandlesPromise) {
      return;
    }
    this.restoreHandlesPromise = new Promise((resolve) => {
      setTimeout(() => {
        this.restoreFileHandles()
          .catch(error => {
            umWarn('[UniverseBackend] Delayed restoreFileHandles failed:', error);
          })
          .finally(() => {
            resolve();
          });
      }, delay);
    });
  }

  // ========== CORE UNIVERSE MANAGEMENT METHODS (from universeManager) ==========

  /**
   * Load universes from storage
   */
  loadFromStorage() {
    try {
      const saved = storageWrapper.getItem(STORAGE_KEYS.UNIVERSES_LIST);
      const activeSlug = storageWrapper.getItem(STORAGE_KEYS.ACTIVE_UNIVERSE);

      if (saved) {
        const universesList = JSON.parse(saved);
        universesList.forEach(universe => {
          this.universes.set(universe.slug, this.safeNormalizeUniverse(universe));
        });
      }

      // Load file handles info
      try {
        const fileHandlesInfo = storageWrapper.getItem(STORAGE_KEYS.UNIVERSE_FILE_HANDLES);
        if (fileHandlesInfo) {
          const handlesData = JSON.parse(fileHandlesInfo);
          Object.keys(handlesData).forEach(slug => {
            const universe = this.universes.get(slug);
            if (universe && handlesData[slug]) {
              this.updateUniverse(slug, {
                localFile: {
                  ...universe.localFile,
                  hadFileHandle: true,
                  lastFilePath: handlesData[slug].path || universe.localFile.path,
                  displayPath: handlesData[slug].displayPath || handlesData[slug].path || universe.localFile.displayPath
                }
              });
            }
          });
        }
      } catch (error) {
        umWarn('[UniverseBackend] Failed to load file handles info:', error);
      }

      // Create default universe if none exist
      if (this.universes.size === 0) {
        this.createSafeDefaultUniverse();
      }

      // Set active universe
      this.activeUniverseSlug = activeSlug && this.universes.has(activeSlug)
        ? activeSlug
        : this.universes.keys().next().value;

      umLog('[UniverseBackend] Loaded', this.universes.size, 'universes, active:', this.activeUniverseSlug);
    } catch (error) {
      umError('[UniverseBackend] Failed to load from storage:', error);
      this.createSafeDefaultUniverse();
    }
  }

  /**
   * Save universes to storage
   */
  saveToStorage() {
    try {
      const universesList = Array.from(this.universes.values()).map(universe => {
        const { localFile, ...rest } = universe;
        return {
          ...rest,
          localFile: {
            enabled: localFile.enabled,
            path: localFile.path,
            displayPath: localFile.displayPath,
            hadFileHandle: localFile.hadFileHandle,
            lastFilePath: localFile.lastFilePath,
            lastSaved: localFile.lastSaved,
            fileHandleStatus: localFile.fileHandleStatus,
            unavailableReason: localFile.unavailableReason
          }
        };
      });

      storageWrapper.setItem(STORAGE_KEYS.UNIVERSES_LIST, JSON.stringify(universesList));
      storageWrapper.setItem(STORAGE_KEYS.ACTIVE_UNIVERSE, this.activeUniverseSlug);

      // Save file handles info
      const fileHandlesInfo = {};
      this.fileHandles.forEach((handle, slug) => {
        fileHandlesInfo[slug] = {
          path: handle.name || this.universes.get(slug)?.localFile?.path || `${slug}.redstring`,
          displayPath: this.universes.get(slug)?.localFile?.displayPath || handle.name || `${slug}.redstring`,
          hasHandle: true
        };
      });
      storageWrapper.setItem(STORAGE_KEYS.UNIVERSE_FILE_HANDLES, JSON.stringify(fileHandlesInfo));

      if (storageWrapper.shouldUseMemoryStorage()) {
        storageWrapper.warnAboutDataLoss();
      }
    } catch (error) {
      umError('[UniverseBackend] Failed to save to storage:', error);
    }
  }

  /**
   * Safe universe normalization (prevents startup recursion)
   */
  safeNormalizeUniverse(universe = {}) {
    const {
      raw: incomingRaw,
      localFile: incomingLocalFile = {},
      gitRepo: incomingGitRepo = {},
      browserStorage: incomingBrowserStorage = {},
      metadata: incomingMetadata = {},
      sources: incomingSources,
      created: createdAt,
      lastModified: lastModifiedAt,
      ...rest
    } = universe || {};

    const slug = rest.slug || universe.slug || 'universe';
    const name = rest.name || universe.name || 'Universe';

    const sanitizedLocalPath = this.sanitizeFileName(
      incomingLocalFile?.path || `${name}.redstring`
    );

    const normalizedLocalFile = {
      enabled: incomingLocalFile?.enabled ?? true,
      path: sanitizedLocalPath,
      displayPath: incomingLocalFile?.displayPath || incomingLocalFile?.lastFilePath || incomingLocalFile?.path || sanitizedLocalPath,
      hadFileHandle: incomingLocalFile?.hadFileHandle ?? false,
      lastFilePath: incomingLocalFile?.lastFilePath || sanitizedLocalPath,
      lastSaved: incomingLocalFile?.lastSaved
        ?? rest?.localFile?.lastSaved
        ?? incomingRaw?.localFile?.lastSaved
        ?? null,
      fileHandleStatus: incomingLocalFile?.fileHandleStatus || null,
      unavailableReason: incomingLocalFile?.unavailableReason || null
    };

    const resolvedGitRepo = typeof incomingGitRepo === 'object' && incomingGitRepo !== null
      ? incomingGitRepo
      : {};

    const normalizedGitRepo = {
      ...resolvedGitRepo,
      enabled: resolvedGitRepo.enabled ?? false,
      linkedRepo: resolvedGitRepo.linkedRepo || rest.linkedRepo || null,
      schemaPath: resolvedGitRepo.schemaPath || rest.schemaPath || 'schema',
      universeFolder: resolvedGitRepo.universeFolder !== undefined
        ? resolvedGitRepo.universeFolder
        : rest.universeFolder !== undefined
          ? rest.universeFolder
          : slug,
      universeFile: resolvedGitRepo.universeFile !== undefined
        ? resolvedGitRepo.universeFile
        : rest.universeFile !== undefined
          ? rest.universeFile
          : `${slug}.redstring`,
      priority: resolvedGitRepo.priority || 'secondary'
    };

    const resolvedBrowserStorage = typeof incomingBrowserStorage === 'object' && incomingBrowserStorage !== null
      ? incomingBrowserStorage
      : {};

    const normalizedBrowserStorage = {
      ...resolvedBrowserStorage,
      enabled: resolvedBrowserStorage.enabled ?? true,
      role: resolvedBrowserStorage.role || 'fallback',
      key: resolvedBrowserStorage.key || `universe_${slug}`
    };

    const resolvedMetadata = typeof incomingMetadata === 'object' && incomingMetadata !== null
      ? incomingMetadata
      : {};

    const created = createdAt || resolvedMetadata.created || (incomingRaw?.created) || new Date().toISOString();
    const lastModified = lastModifiedAt || resolvedMetadata.lastModified || (incomingRaw?.lastModified) || created;

    const normalizedMetadata = {
      ...resolvedMetadata,
      created,
      lastModified
    };

    const rawBase = (typeof incomingRaw === 'object' && incomingRaw !== null)
      ? incomingRaw
      : {};

    const mergedRaw = {
      ...rawBase,
      ...rest,
      localFile: {
        ...(rawBase.localFile || {}),
        ...incomingLocalFile,
        ...normalizedLocalFile
      },
      gitRepo: {
        ...(rawBase.gitRepo || {}),
        ...resolvedGitRepo,
        ...normalizedGitRepo
      },
      browserStorage: {
        ...(rawBase.browserStorage || {}),
        ...resolvedBrowserStorage,
        ...normalizedBrowserStorage
      },
      metadata: {
        ...(rawBase.metadata || {}),
        ...resolvedMetadata,
        ...normalizedMetadata
      }
    };
    delete mergedRaw.raw;

    const sources = Array.isArray(incomingSources)
      ? incomingSources
      : Array.isArray(rawBase.sources)
        ? rawBase.sources
        : [];
    mergedRaw.sources = sources;
    mergedRaw.created = created;
    mergedRaw.lastModified = lastModified;
    mergedRaw.sourceOfTruth = rest.sourceOfTruth || rawBase.sourceOfTruth || 'local';

    return {
      slug,
      name,
      sourceOfTruth: rest.sourceOfTruth || rawBase.sourceOfTruth || 'local',
      localFile: normalizedLocalFile,
      gitRepo: normalizedGitRepo,
      browserStorage: normalizedBrowserStorage,
      metadata: normalizedMetadata,
      sources,
      created,
      lastModified,
      raw: mergedRaw
    };
  }

  /**
   * Create safe default universe
   */
  createSafeDefaultUniverse() {
    // Check if we are in an isolated session
    let sessionParam = null;
    if (typeof window !== 'undefined') {
      sessionParam = new URLSearchParams(window.location.search).get('session');
    }

    if (sessionParam) {
      umLog(`[UniverseBackend] Session parameter '${sessionParam}' detected, suppressing default universe auto-load`);
      return;
    }

    const defaultUniverse = {
      slug: 'universe',
      name: 'Universe',
      sourceOfTruth: 'local',
      localFile: { enabled: true, path: 'Universe.redstring' },
      gitRepo: { enabled: false, linkedRepo: null, schemaPath: 'schema' },
      browserStorage: { enabled: true, role: 'fallback' },
      sources: []
    };

    this.universes.set('universe', this.safeNormalizeUniverse(defaultUniverse));
    this.activeUniverseSlug = 'universe';
    this.saveToStorage();

    if (this.storeOperations?.loadUniverseFromFile) {
      const emptyState = this.createEmptyState();
      emptyState._universeSlug = 'universe';
      try {
        this.storeOperations.loadUniverseFromFile(emptyState);
        umLog('[UniverseBackend] Initialized graph store with empty state for safe default universe');
      } catch (error) {
        umWarn('[UniverseBackend] Failed to initialize graph store for safe default universe:', error);
      }
    }

    umLog('[UniverseBackend] Created safe default universe during startup');
  }

  /**
   * Sanitize file names
   */
  sanitizeFileName(name) {
    return name
      .replace(/[^a-zA-Z0-9-_\.]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .replace(/\.redstring$/, '') + '.redstring';
  }

  /**
   * Generate unique slug
   */
  generateUniqueSlug(name) {
    let baseSlug = String(name || 'universe').toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50) || 'universe';

    const existingLower = new Set();
    for (const key of this.universes.keys()) {
      if (typeof key === 'string') {
        existingLower.add(key.toLowerCase());
      }
    }

    if (!existingLower.has(baseSlug)) {
      return baseSlug;
    }

    let slug = baseSlug;
    let counter = 1;
    while (existingLower.has(slug.toLowerCase())) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  /**
   * Resolve universe entry (case-insensitive)
   */
  resolveUniverseEntry(slug) {
    if (!slug) return null;
    if (this.universes.has(slug)) {
      return { key: slug, universe: this.universes.get(slug) };
    }

    const target = String(slug).toLowerCase();
    for (const [key, value] of this.universes.entries()) {
      if (typeof key === 'string' && key.toLowerCase() === target) {
        return { key, universe: value };
      }
    }
    return null;
  }

  /**
   * Create empty universe state
   */
  createEmptyState() {
    return {
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      openGraphIds: [],
      activeGraphId: null,
      activeDefinitionNodeId: null,
      expandedGraphIds: new Set(),
      rightPanelTabs: [{ type: 'home', isActive: true }],
      savedNodeIds: new Set(),
      savedGraphIds: new Set(),
      showConnectionNames: false
    };
  }

  /**
   * Initialize device configuration
   */
  initializeDeviceConfig() {
    if (this._initializingDeviceConfig) {
      umWarn('[UniverseBackend] Device config initialization already in progress, skipping');
      return;
    }

    this._initializingDeviceConfig = true;

    try {
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const screenWidth = window.screen?.width || 1920;
      const isMobile = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent.toLowerCase());
      const isTablet = /ipad|android(?!.*mobile)|kindle|silk|playbook|bb10/i.test(navigator.userAgent.toLowerCase()) ||
        (/macintosh/i.test(navigator.userAgent.toLowerCase()) && isTouch);
      const isSmallScreen = screenWidth <= 768;
      const isMediumScreen = screenWidth <= 1024;

      const hasFileAccess = isElectron() || hasFileSystemAccess();
      const shouldUseGitOnly = isMobile || isTablet || !hasFileAccess || (isTouch && isMediumScreen);

      this.deviceConfig = {
        gitOnlyMode: shouldUseGitOnly,
        sourceOfTruth: shouldUseGitOnly ? 'git' : 'local',
        enableLocalFileStorage: !shouldUseGitOnly && hasFileAccess,
        touchOptimizedUI: isTouch,
        compactInterface: isMobile,
        autoSaveFrequency: isMobile ? 2000 : 1000,
        deviceInfo: {
          type: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
          isMobile,
          isTablet,
          isTouchDevice: isTouch,
          screenWidth,
          supportsFileSystemAPI: hasFileAccess,
          isElectron: isElectron()
        }
      };

      this.isGitOnlyMode = shouldUseGitOnly;
      this.watchdogDelay = this.deviceConfig.autoSaveFrequency * 60;

      umLog('[UniverseBackend] Device config initialized:', {
        deviceType: this.deviceConfig.deviceInfo.type,
        gitOnlyMode: this.isGitOnlyMode,
        sourceOfTruth: this.deviceConfig.sourceOfTruth
      });
    } catch (error) {
      umError('[UniverseBackend] Device config initialization failed:', error);
      this.deviceConfig = {
        gitOnlyMode: false,
        sourceOfTruth: 'local',
        touchOptimizedUI: false,
        autoSaveFrequency: 1000,
        enableLocalFileStorage: true,
        compactInterface: false,
        deviceInfo: { isMobile: false, isTablet: false, type: 'desktop', isTouchDevice: false, screenWidth: 1920, supportsFileSystemAPI: true }
      };
      this.isGitOnlyMode = false;
    } finally {
      this._initializingDeviceConfig = false;
    }
  }

  /**
   * Initialize background sync
   */
  async initializeBackgroundSync() {
    umLog('[UniverseBackend] ========== INITIALIZE BACKGROUND SYNC CALLED ==========');
    try {
      umLog('[UniverseBackend] Initializing background sync services...');

      // Ensure auth state is fully loaded before proceeding
      await persistentAuth.ensureAuthStateLoaded().catch(err => {
        umWarn('[UniverseBackend] Failed to load auth state in background sync:', err);
      });

      if (!persistentAuth.initializeCalled) {
        umLog('[UniverseBackend] About to call persistentAuth.initialize()...');
        await persistentAuth.initialize();
      } else {
        umLog('[UniverseBackend] PersistentAuth already initialized');
      }

      const authStatus = persistentAuth.getAuthStatus();
      umLog('[UniverseBackend] Auth status:', authStatus);

      const hasAccessToken = persistentAuth.hasValidTokens();
      if (!authStatus.isAuthenticated && !hasAccessToken) {
        umLog('[UniverseBackend] No valid auth token, skipping Git sync setup');
        return;
      }

      const activeUniverse = this.getActiveUniverse();
      umLog('[UniverseBackend] Active universe:', activeUniverse?.slug || 'none');

      if (activeUniverse && activeUniverse.gitRepo?.linkedRepo && activeUniverse.gitRepo?.enabled) {
        umLog('[UniverseBackend] Active universe has Git repo, will set up sync engine');
      }

    } catch (error) {
      umError('[UniverseBackend] Background sync initialization failed:', error);
      throw error;
    }
  }

  async updateLocalFileState(universeOrSlug, patch, options = {}) {
    const slug = typeof universeOrSlug === 'string' ? universeOrSlug : universeOrSlug?.slug;
    if (!slug) return;

    const current = typeof universeOrSlug === 'object' && universeOrSlug
      ? universeOrSlug
      : this.getUniverse(slug);
    if (!current) return;

    const mergedLocal = {
      ...current.localFile,
      ...patch
    };

    const mergedRaw = {
      ...(current.raw || {}),
      localFile: {
        ...(current.raw?.localFile || {}),
        ...mergedLocal
      }
    };

    const updatedUniverse = {
      ...current,
      localFile: mergedLocal,
      raw: mergedRaw
    };

    this.universes.set(slug, this.safeNormalizeUniverse(updatedUniverse));
    this.saveToStorage();

    if (options.notify?.message) {
      this.notifyStatus(options.notify.type || 'info', options.notify.message);
    }
  }

  async ensureLocalFileHandle(universe, options = {}) {
    if (!universe?.slug) {
      return { success: false, message: 'Universe missing slug' };
    }

    const slug = universe.slug;
    const metadataHint = options.metadata || null;

    let existingHandle = this.fileHandles.get(slug);
    if (existingHandle) {
      const access = await verifyFileHandleAccess(existingHandle);
      if (access?.isValid) {
        const displayPath = metadataHint?.displayPath || metadataHint?.fileName || universe.localFile.displayPath;
        await this.updateLocalFileState(universe, {
          fileHandleStatus: access.needsPermissionPrompt ? 'permission_needed' : 'connected',
          displayPath: displayPath || universe.localFile.displayPath,
          reconnectMessage: access.needsPermissionPrompt
            ? 'Grant file access permission to resume saving.'
            : null,
          unavailableReason: access.needsPermissionPrompt
            ? 'Grant file access permission to resume saving.'
            : null,
          hadFileHandle: true,
          lastAccessed: Date.now()
        });

        return {
          success: true,
          handle: existingHandle,
          needsPermission: !!access.needsPermissionPrompt,
          permission: access.permission,
          metadata: metadataHint || null
        };
      }

      if (access?.reason === 'file_missing') {
        await this.updateLocalFileState(universe, {
          hadFileHandle: false,
          fileHandleStatus: 'needs_reconnect',
          reconnectMessage: 'Local file not found. Reconnect the file to continue.',
          unavailableReason: 'Local file not found. Reconnect the file to continue.'
        });
      } else if (access?.reason === 'permission_denied') {
        await this.updateLocalFileState(universe, {
          fileHandleStatus: 'permission_needed',
          reconnectMessage: 'Grant file access permission to resume saving.',
          unavailableReason: 'Grant file access permission to resume saving.'
        });
      } else if (access && !access.isValid && this.isInitialized) {
        // Conservative catch-all: unknown failure reason. Retry once after a short
        // delay to dodge transient IPC/filesystem races. Only classify as
        // needs_reconnect if the second attempt also fails. Gated on
        // isInitialized so startup-time races never flip a working file.
        const retryAccess = await new Promise((resolve) => {
          setTimeout(() => {
            verifyFileHandleAccess(existingHandle).then(resolve).catch(() => resolve(null));
          }, 500);
        });

        if (retryAccess?.isValid) {
          umLog(`[UniverseBackend] Transient verify failure for ${slug} self-healed on retry`);
          // Fall through; the restore path below will re-run and mark connected.
        } else {
          const reason = retryAccess?.reason || access.reason || 'unknown';
          const msg = `Local file unavailable (${reason}). Click Reconnect to locate it.`;
          await this.updateLocalFileState(universe, {
            fileHandleStatus: 'needs_reconnect',
            hadFileHandle: false,
            reconnectMessage: msg,
            unavailableReason: msg
          });
        }
      }

      this.fileHandles.delete(slug);
    }

    // 1. Try to restore specific handle from IndexedDB first (most accurate)
    const restore = await attemptRestoreFileHandle(slug, existingHandle);
    if (restore.success && restore.handle) {
      this.fileHandles.set(slug, restore.handle);

      const displayPath =
        restore.metadata?.displayPath ||
        restore.metadata?.fileName ||
        universe.localFile?.displayPath;

      await this.updateLocalFileState(universe, {
        fileHandleStatus: 'connected',
        hadFileHandle: true,
        reconnectMessage: null,
        unavailableReason: null,
        displayPath: displayPath || universe.localFile.displayPath,
        lastAccessed: Date.now()
      });

      return {
        success: true,
        handle: restore.handle,
        metadata: restore.metadata || null
      };
    }

    // 2. If restore failed, try workspace folder as fallback
    if (!this.fileHandles.get(slug)) {
      const { getFileFromWorkspace } = await import('./workspaceFolderService.js');
      const fileName = universe.localFile?.fileName ||
        universe.localFile?.path?.split(/[/\\]/).pop() ||
        universe.localFile?.displayPath?.split(/[/\\]/).pop() ||
        `${universe.slug}.redstring`;

      const workspaceHandle = await getFileFromWorkspace(fileName);
      if (workspaceHandle) {
        this.fileHandles.set(slug, workspaceHandle);
        await this.updateLocalFileState(universe, {
          fileHandleStatus: 'connected',
          hadFileHandle: true,
          reconnectMessage: null,
          unavailableReason: null,
          lastAccessed: Date.now()
        });

        umLog(`[UniverseBackend] Restored file handle for ${slug} from workspace folder`);
        return { success: true, handle: workspaceHandle, source: 'workspace' };
      }
    }


    if (restore.needsPermission) {
      await this.updateLocalFileState(universe, {
        fileHandleStatus: 'permission_needed',
        reconnectMessage: restore.message || 'Grant file access permission to resume saving.',
        unavailableReason: restore.message || 'Grant file access permission to resume saving.'
      });
    } else if (restore.needsReconnect) {
      const lastKnown = universe.localFile?.displayPath || universe.localFile?.path;
      const fileName = universe.localFile?.fileName ||
        (typeof lastKnown === 'string' ? lastKnown.split(/[/\\]/).pop() : null);
      const fallbackMsg = fileName
        ? `Could not find ${fileName}${lastKnown && lastKnown !== fileName ? ` (last known path: ${lastKnown})` : ''}. Click Reconnect to locate it.`
        : 'Reconnect the local file to continue.';
      await this.updateLocalFileState(universe, {
        fileHandleStatus: 'needs_reconnect',
        reconnectMessage: restore.message || fallbackMsg,
        unavailableReason: restore.message || fallbackMsg,
        hadFileHandle: false
      });
    }

    return restore;
  }

  /**
   * Restore file handles from persistence
   */
  async restoreFileHandles() {
    try {
      umLog('[UniverseBackend] Attempting to restore file handles from persistence...');

      const allMetadata = await getAllFileHandleMetadata();

      if (allMetadata.length === 0) {
        umLog('[FileHandles] No file handle metadata to restore');
        return;
      }

      umLog(`[FileHandles] ▶ Starting restoration of ${allMetadata.length} file handle entries...`);
      let restoredAny = false;

      for (const metadata of allMetadata) {
        const { universeSlug } = metadata;
        const universe = this.getUniverse(universeSlug);
        if (!universe) {
          umLog(`[FileHandles] ⊘ Skipping ${universeSlug}: Universe not found`);
          continue;
        }

        const result = await this.ensureLocalFileHandle(universe, { metadata });
        if (result?.success && result.handle) {
          umLog(`[FileHandles] ✓ Successfully restored file handle for ${universeSlug}: ${result.displayPath || 'unknown'}`);
          restoredAny = true;
        } else if (result?.needsReconnect) {
          umLog(`[FileHandles] ⚠ File handle for ${universeSlug} needs reconnection: ${result.message}`);

          // If file is stored as relative filename, try to locate it
          if (isElectron() && metadata?.displayPath && !metadata.displayPath.includes('/') && !metadata.displayPath.includes('\\') && metadata.fileName) {
            umLog(`[FileHandles] 🔍 Relative filename detected for ${universeSlug}: "${metadata.displayPath}". Attempting to locate...`);

            const { fileExists: checkFileExists } = await import('../utils/fileAccessAdapter.js');
            let foundPath = null;

            // Skip workspace folder service in Electron - it's browser-only (uses IndexedDB)
            // Strategy 1 would be workspace folder, but it doesn't work in Electron

            // Strategy 2: Try common Electron and browser locations
            if (!foundPath) {
              const possiblePaths = [
                metadata.displayPath, // Current directory
              ];

              // Only use Electron APIs if in Electron environment
              if (isElectron() && window.electron?.storage?.getPaths) {
                try {
                  const paths = await window.electron.storage.getPaths();
                  if (paths?.documents) {
                    // Default Redstring documents subdir — where `file:pick`/`file:saveAs`
                    // default to, so the most likely place for relinked files.
                    possiblePaths.push(`${paths.documents}/Redstring/${metadata.displayPath}`);
                    possiblePaths.push(`${paths.documents}/${metadata.displayPath}`);
                  }
                  if (paths?.downloads) {
                    possiblePaths.push(`${paths.downloads}/${metadata.displayPath}`);
                  }
                } catch (pathErr) {
                  umWarn(`[FileHandles] Failed to get Electron paths for ${universeSlug}:`, pathErr.message);
                }
              }

              for (const testPath of possiblePaths) {
                try {
                  const exists = await checkFileExists(testPath);
                  if (exists) {
                    foundPath = testPath;
                    umLog(`[FileHandles] ✓ Found file at: ${testPath}`);
                    break;
                  }
                } catch (err) {
                  // Continue to next path
                }
              }
            }

            if (foundPath) {
              this.fileHandles.set(universeSlug, foundPath);
              // Update metadata to store absolute path (skip store update during initialization to avoid deadlock)
              try {
                const { storeFileHandleMetadata } = await import('./fileHandlePersistence.js');
                await storeFileHandleMetadata(universeSlug, foundPath, {
                  universeSlug,
                  lastAccessed: Date.now(),
                  fileName: foundPath.split(/[/\\]/).pop(),
                  displayPath: foundPath
                });
              } catch (metaErr) {
                umWarn(`[FileHandles] Failed to update metadata for ${universeSlug}:`, metaErr.message);
              }
              this.saveToStorage();
              umLog(`[FileHandles] ✓ Successfully located and reconnected file for ${universeSlug}`);
              restoredAny = true;
            } else {
              umLog(`[FileHandles] ✗ Could not locate file "${metadata.displayPath}" for ${universeSlug}. File may have been moved or deleted.`);
            }
          }
        } else if (result?.needsPermission) {
          umLog(`[FileHandles] ⚠ File handle for ${universeSlug} needs permission refresh: ${result.message || 'Permission required'}`);
        }
      }

      umLog(`[FileHandles] ✓ Restoration complete (${restoredAny ? 'restored some files' : 'no files to restore or all skipped'})`);
      if (restoredAny) {
        await this.ensureSaveCoordinator();
      }
    } catch (error) {
      umError(`[FileHandles] ✗ CRITICAL: Failed to restore file handles:`, error);
      umError(`[FileHandles] Error message: ${error?.message || 'unknown'}`);
      umError(`[FileHandles] Error stack:`, error?.stack);
    }
  }

  // ========== END CORE UNIVERSE MANAGEMENT METHODS ==========

  /**
   * Initialize the backend service
   */
  async initialize() {
    if (this.isInitialized) {
      umLog('[UniverseBackend] Backend already initialized, skipping...');
      return;
    }

    if (this.initializationPromise) {
      umLog('[UniverseBackend] Initialization already in progress, waiting...');
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  async _doInitialize() {
    umLog('[UniverseBackend] Initializing backend service...');


    try {
      umLog('[UniverseBackend] Ensuring auth state is loaded...');

      await persistentAuth.ensureAuthStateLoaded().catch(err => {
        umWarn('[UniverseBackend] Failed to load auth state:', err);
      });


      umLog('[UniverseBackend] Getting authentication status...');
      this.authStatus = persistentAuth.getAuthStatus();

      umLog('[UniverseBackend] Setting up store operations...');

      await this.setupStoreOperations();


      umLog('[UniverseBackend] Setting up event listeners...');
      this.setupAuthEvents();

      umLog('[UniverseBackend] Initializing background sync (auth + active universe)...');
      const syncStartTime = Date.now();

      // Add timeout to prevent hanging
      try {

        await Promise.race([
          this.initializeBackgroundSync(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Background sync timeout after 8s')), 8000)
          )
        ]);

        const syncEndTime = Date.now();
        umLog(`[UniverseBackend] Background sync completed in ${syncEndTime - syncStartTime}ms`);
      } catch (error) {
        umWarn('[UniverseBackend] Background sync failed or timed out:', error.message);
        umLog('[UniverseBackend] Continuing with backend initialization...');
      }

      umLog('[UniverseBackend] Skipping auto-setup of ALL existing universes to avoid hanging...');
      // await this.autoSetupExistingUniverses(); // DISABLED - can hang during initialization

      // CRITICAL: Load active universe data into store
      const activeUniverse = this.getActiveUniverse();

      if (activeUniverse) {
        umLog(`[UniverseBackend] Loading active universe into store: ${activeUniverse.name || activeUniverse.slug}`);
        try {
          if (this.restoreHandlesPromise) {
            try {
              await this.restoreHandlesPromise;
            } catch (restoreError) {
              umWarn('[UniverseBackend] Waiting for file handle restoration failed:', restoreError);
            }
          }
          // Try to load (will fall back to browser storage if Git fails due to auth)
          // Timebox the initial load to avoid UI spinner deadlocks; continue in background on timeout
          const LOAD_TIMEOUT_MS = 5000;
          const TIMEOUT_TOKEN = Symbol('LOAD_TIMEOUT');
          const timedResult = await Promise.race([
            this.loadUniverseData(activeUniverse, { allowPermissionPrompt: false }),
            new Promise((resolve) => setTimeout(() => resolve(TIMEOUT_TOKEN), LOAD_TIMEOUT_MS))
          ]);

          if (timedResult === TIMEOUT_TOKEN) {
            umWarn('[UniverseBackend] Active universe load timed out; marking UI loaded and continuing in background');
            // Release UI spinner immediately
            this.storeOperations?.setUniverseLoaded(true, true);

            // CRITICAL: Track background load to cancel if needed
            const bgLoadId = Date.now();
            this.pendingBackgroundLoadId = bgLoadId;

            // Continue loading in background and apply when ready
            this.loadUniverseData(activeUniverse, { allowPermissionPrompt: false })
              .then((bgState) => {
                // CRITICAL: Check if this background load has been superseded
                if (this.pendingBackgroundLoadId !== bgLoadId) {
                  umLog('[UniverseBackend] Background load superseded by newer load, discarding');
                  return;
                }

                if (bgState && this.storeOperations?.loadUniverseFromFile) {
                  try {
                    // CRITICAL: Check if a load is already in progress before applying
                    const currentState = this.storeOperations.getState?.();
                    if (currentState?._isLoadingUniverse) {
                      umWarn('[UniverseBackend] Another load in progress, skipping background load');
                      return;
                    }

                    // Preserve current viewport (panOffset, zoomLevel) to avoid jarring resets after background load
                    try {
                      const current = this.storeOperations.getState?.();
                      const activeGraphId = current?.activeGraphId;
                      const currentGraphs = current?.graphs;
                      if (activeGraphId && currentGraphs && (currentGraphs instanceof Map ? currentGraphs.has(activeGraphId) : currentGraphs[activeGraphId])) {
                        const currentGraph = currentGraphs instanceof Map ? currentGraphs.get(activeGraphId) : currentGraphs[activeGraphId];
                        const prevPan = currentGraph?.panOffset;
                        const prevZoom = currentGraph?.zoomLevel;
                        if (prevPan && typeof prevZoom === 'number') {
                          const nextGraphs = bgState.graphs;
                          if (nextGraphs) {
                            if (nextGraphs instanceof Map) {
                              const g = nextGraphs.get(activeGraphId);
                              if (g) {
                                g.panOffset = prevPan;
                                g.zoomLevel = prevZoom;
                              }
                            } else if (typeof nextGraphs === 'object' && nextGraphs[activeGraphId]) {
                              nextGraphs[activeGraphId].panOffset = prevPan;
                              nextGraphs[activeGraphId].zoomLevel = prevZoom;
                            }
                          }
                        }
                      }
                    } catch (_) {
                      // Best-effort viewport preservation; ignore if unavailable
                    }

                    const success = this.storeOperations.loadUniverseFromFile(bgState);
                    if (!success) {
                      umWarn('[UniverseBackend] Background load rejected by store (concurrent load in progress)');
                    } else {
                      umLog('[UniverseBackend] Background load completed successfully');
                    }
                  } catch (e) {
                    umWarn('[UniverseBackend] Background universe load failed to apply:', e);
                  }
                }
              })
              .catch((e) => umWarn('[UniverseBackend] Background universe load failed:', e));
            // Proceed with init; status already updated
          } else if (timedResult && this.storeOperations?.loadUniverseFromFile) {
            const storeState = timedResult;
            const success = this.storeOperations.loadUniverseFromFile(storeState);
            if (success) {
              const loadedState = this.storeOperations.getState();
              const nodeCount = loadedState?.nodePrototypes ? (loadedState.nodePrototypes instanceof Map ? loadedState.nodePrototypes.size : Object.keys(loadedState.nodePrototypes).length) : 0;
              const graphCount = loadedState?.graphs ? (loadedState.graphs instanceof Map ? loadedState.graphs.size : Object.keys(loadedState.graphs).length) : 0;

              umLog(`[UniverseBackend] Active universe loaded: ${nodeCount} nodes, ${graphCount} graphs`);

              // Check if we loaded from cache due to missing auth
              const authStatus = this.getAuthStatus();
              if (!authStatus?.isAuthenticated && activeUniverse.gitRepo?.enabled) {
                this.notifyStatus('info', `Loaded ${activeUniverse.name} from cache. Connect GitHub to sync latest.`);
              } else {
                this.notifyStatus('success', `Loaded ${activeUniverse.name}: ${nodeCount} nodes, ${graphCount} graphs`);
              }
            } else {
              umWarn('[UniverseBackend] Failed to load active universe into store');
              // Ensure UI is not stuck in loading state
              this.storeOperations?.setUniverseLoaded(true, false);
            }
          }
        } catch (error) {
          umWarn('[UniverseBackend] Failed to load active universe data:', error);
          if (
            error?.code === LOCAL_FILE_ERROR.PERMISSION ||
            error?.code === LOCAL_FILE_ERROR.MISSING ||
            error?.code === LOCAL_FILE_ERROR.NOT_FOUND
          ) {
            this.notifyStatus('warning', error.message);
            // Mark universe as loaded with error so UI remains interactive
            this.storeOperations?.setUniverseError(error.message);
          } else {
            // Any other failure should also release loading gate
            this.storeOperations?.setUniverseError(error?.message || 'Failed to load universe');
          }
        }
      } else {
        umLog('[UniverseBackend] No active universe to load');
        // Ensure UI isn't stuck in loading state when there is no active universe yet
        this.storeOperations?.setUniverseLoaded(true, false);
      }

      this.isInitialized = true;
      this.notifyStatus('info', 'Universe backend initialized');

      umLog('[UniverseBackend] Backend service initialized successfully');

      // After successful init, attempt to auto-setup sync engine for the active universe (non-blocking)
      // Only do this once, avoid duplicate engine creation
      if (!this.autoSetupScheduled) {
        this.autoSetupScheduled = true;
        try {
          setTimeout(() => {
            this.autoSetupEnginesForActiveUniverse().catch(err => {
              umWarn('[UniverseBackend] Auto-setup for active universe failed:', err?.message || err);
            });
          }, 150);
        } catch (_) { }
      }
    } catch (error) {
      umError('[UniverseBackend] Failed to initialize backend:', error);
      this.notifyStatus('error', `Backend initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Set up store operations to avoid circular dependencies
   */
  async setupStoreOperations() {
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        // Dynamically import graphStore from backend (outside the circular dependency)
        const { default: useGraphStore } = await import('../store/graphStore.jsx');

        // Validate that the store is properly initialized
        const testState = useGraphStore.getState();
        if (!testState || typeof testState.loadUniverseFromFile !== 'function') {
          throw new Error('GraphStore not properly initialized - missing loadUniverseFromFile method');
        }

        this.storeOperations = {
          getState: () => useGraphStore.getState(),
          // Mark the UI as loaded with an error so spinners stop and UI remains usable
          setUniverseError: (message) => {
            try {
              const store = useGraphStore.getState();
              if (typeof store.setUniverseError === 'function') {
                store.setUniverseError(message);
              }
            } catch (_) { }
          },
          // Explicitly flip loading flags when we fall back to empty state
          setUniverseLoaded: (loaded = true, hasFile = false) => {
            try {
              const store = useGraphStore.getState();
              if (typeof store.setUniverseLoaded === 'function') {
                store.setUniverseLoaded(loaded, hasFile);
              }
            } catch (_) { }
          },
          loadUniverseFromFile: (storeState) => {
            try {
              const store = useGraphStore.getState();
              umLog('[UniverseBackend] Loading universe data into store:', {
                hasStoreState: !!storeState,
                storeStateType: typeof storeState,
                hasGraphs: storeState?.graphs ? (storeState.graphs instanceof Map ? storeState.graphs.size : Object.keys(storeState.graphs).length) : 0,
                hasNodes: storeState?.nodePrototypes ? (storeState.nodePrototypes instanceof Map ? storeState.nodePrototypes.size : Object.keys(storeState.nodePrototypes).length) : 0
              });

              store.loadUniverseFromFile(storeState);
              umLog('[UniverseBackend] Successfully loaded universe data into store');
              return true;
            } catch (error) {
              umError('[UniverseBackend] Failed to load universe data into store:', error);
              this.notifyStatus('error', `Failed to load universe data: ${error.message}`);
              throw error;
            }
          }
        };

        umLog('[UniverseBackend] Store operations set up successfully for backend');
        return; // Success, exit retry loop

      } catch (error) {
        retryCount++;
        umWarn(`[UniverseBackend] Failed to set up store operations (attempt ${retryCount}/${maxRetries}):`, error);

        if (retryCount >= maxRetries) {
          umError('[UniverseBackend] CRITICAL: Failed to set up store operations after all retries. Universe data loading will not work properly.');
          this.notifyStatus('error', 'Critical system error: Store operations failed to initialize');
          // Don't throw here - let the system continue but mark as degraded
          this.storeOperations = null;
          return;
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }
  }

  /**
   * Set up authentication event listeners
   */
  setupAuthEvents() {
    // Listen for auth changes and update status
    if (typeof window !== 'undefined') {
      let lastAuthProcessTime = 0;
      let authDebounceTimer = null;
      const authDebounceDelay = 5000; // 5 second debounce to prevent rapid auth processing

      const processAuthEvent = async (trigger = 'immediate') => {
        if (authDebounceTimer) {
          clearTimeout(authDebounceTimer);
          authDebounceTimer = null;
        }

        lastAuthProcessTime = Date.now();
        umLog(`[UniverseBackend] Processing auth event (${trigger})`);

        this.authStatus = persistentAuth.getAuthStatus();
        this.notifyStatus('success', 'Authentication updated');

        // CRITICAL: Reload active universe from Git now that auth is ready
        const activeUniverse = this.getActiveUniverse();
        if (activeUniverse?.gitRepo?.enabled) {
          umLog('[UniverseBackend] Auth connected, checking Git for latest data...');
          try {
            // Get current store state before loading
            const currentState = this.storeOperations?.getState();
            const currentNodeCount = currentState?.nodePrototypes ? (currentState.nodePrototypes instanceof Map ? currentState.nodePrototypes.size : Object.keys(currentState.nodePrototypes).length) : 0;
            const currentGraphCount = currentState?.graphs ? (currentState.graphs instanceof Map ? currentState.graphs.size : Object.keys(currentState.graphs).length) : 0;

            const storeState = await this.loadUniverseData(activeUniverse);
            if (storeState && this.storeOperations?.loadUniverseFromFile) {
              // Count what Git has
              const gitNodeCount = storeState?.nodePrototypes ? (storeState.nodePrototypes instanceof Map ? storeState.nodePrototypes.size : Object.keys(storeState.nodePrototypes || {}).length) : 0;
              const gitGraphCount = storeState?.graphs ? (storeState.graphs instanceof Map ? storeState.graphs.size : Object.keys(storeState.graphs || {}).length) : 0;

              // Smart merge: don't overwrite local work with empty Git data
              if (gitNodeCount === 0 && gitGraphCount === 0 && (currentNodeCount > 0 || currentGraphCount > 0)) {
                // Only log this warning once per session to avoid spam
                if (!this.loggedMergeWarning) {
                  umWarn(`[UniverseBackend] Git has no data, but you have ${currentNodeCount} nodes and ${currentGraphCount} graphs locally`);
                  this.notifyStatus('warning', `Using browser storage backup (${currentNodeCount} nodes). Push to Git to sync.`);
                  this.loggedMergeWarning = true;
                }
                // Don't overwrite! User's local work is preserved
              } else {
                // Git has data or both are empty - safe to load
                // CRITICAL: Cancel any pending background loads before loading
                this.pendingBackgroundLoadId = null;

                const success = this.storeOperations.loadUniverseFromFile(storeState);
                if (!success) {
                  umWarn('[UniverseBackend] Failed to reload from Git - concurrent load in progress');
                  return;
                }

                const loadedState = this.storeOperations.getState();
                const nodeCount = loadedState?.nodePrototypes ? (loadedState.nodePrototypes instanceof Map ? loadedState.nodePrototypes.size : Object.keys(loadedState.nodePrototypes).length) : 0;
                umLog(`[UniverseBackend] Reloaded from Git after auth: ${nodeCount} nodes`);

                if (nodeCount === 0) {
                  this.notifyStatus('info', `Connected to GitHub. Universe is empty - create some nodes!`);
                } else {
                  this.notifyStatus('success', `Synced ${activeUniverse.name} from GitHub (${nodeCount} nodes)`);
                }
              }
            }
          } catch (error) {
            umWarn('[UniverseBackend] Failed to reload from Git after auth:', error);
          }
        }

        // Ensure Git sync engine is active now that auth is ready
        if (activeUniverse?.gitRepo?.enabled && activeUniverse?.gitRepo?.linkedRepo) {
          const now = Date.now();
          const recentlyScheduled = now - this.lastAuthEngineSetup < authDebounceDelay;
          if (!this.gitSyncEngines.has(activeUniverse.slug) && !recentlyScheduled) {
            this.lastAuthEngineSetup = now;
            setTimeout(() => {
              umLog('[UniverseBackend] Auth ready, ensuring Git engine for active universe');
              this.ensureGitSyncEngine(activeUniverse.slug).catch(error => {
                umWarn('[UniverseBackend] Git engine setup after auth failed:', error);
                this.notifyStatus('warning', `Git sync setup failed: ${error.message}`);
              });
            }, 250);
          }
        }
      };

      const scheduleAuthEvent = (delayMs) => {
        if (authDebounceTimer) {
          clearTimeout(authDebounceTimer);
        }
        authDebounceTimer = setTimeout(() => {
          processAuthEvent('deferred').catch(error => {
            umWarn('[UniverseBackend] Deferred auth processing failed:', error);
          });
        }, delayMs);
      };

      window.addEventListener('redstring:auth-token-stored', () => {
        const now = Date.now();
        const elapsed = now - lastAuthProcessTime;

        if (elapsed < authDebounceDelay) {
          const waitMs = authDebounceDelay - elapsed;
          umLog(`[UniverseBackend] Auth event debounced - scheduling in ${waitMs}ms`);
          scheduleAuthEvent(waitMs);
          return;
        }

        processAuthEvent('immediate').catch(error => {
          umWarn('[UniverseBackend] Auth processing failed:', error);
        });
      });
    }
  }

  /**
   * Auto-setup Git sync engines for existing universes
   */
  async autoSetupExistingUniverses() {
    // Check if authentication is ready before attempting Git sync setup
    const authStatus = this.getAuthStatus();
    if (!authStatus?.isAuthenticated) {
      umLog('[UniverseBackend] Skipping auto-setup for existing universes: authentication not ready');
      return;
    }

    const universes = this.getAllUniverses();

    for (const universe of universes) {
      if (universe.gitRepo?.enabled && universe.gitRepo?.linkedRepo) {
        try {
          await this.ensureGitSyncEngine(universe.slug);
        } catch (error) {
          // Don't block initialization if one universe fails
          umWarn(`[UniverseBackend] Failed to setup engine for ${universe.slug}:`, error.message);
        }
      }
    }
  }

  /**
   * Auto-setup engine for currently active universe
   */
  async autoSetupEnginesForActiveUniverse() {
    // Check if authentication is ready before attempting Git sync setup
    const authStatus = this.getAuthStatus();
    if (!authStatus?.isAuthenticated) {
      umLog('[UniverseBackend] Skipping auto-setup: authentication not ready');
      return;
    }

    const activeUniverse = this.getActiveUniverse();
    if (activeUniverse?.gitRepo?.enabled && activeUniverse?.gitRepo?.linkedRepo) {
      try {
        umLog('[UniverseBackend] Auto-setting up Git sync for active universe:', activeUniverse.slug);
        await this.ensureGitSyncEngine(activeUniverse.slug);
      } catch (error) {
        // Don't throw - just log and continue. User can manually retry.
        umWarn(`[UniverseBackend] Failed to auto-setup engine for active universe:`, error.message);
        // Notify user but don't block
        this.notifyStatus('warning', `Git sync setup skipped: ${error.message}. You can enable it manually.`);
      }
    }
  }

  /**
   * Ensure a Git sync engine exists for a universe
   */
  async ensureGitSyncEngine(universeSlug) {
    umLog(`[UniverseBackend] Ensuring Git sync engine for universe: ${universeSlug}`);

    // Check if engine already exists and is healthy
    if (this.gitSyncEngines.has(universeSlug)) {
      const existingEngine = this.gitSyncEngines.get(universeSlug);
      if (existingEngine && existingEngine.provider) {
        umLog(`[UniverseBackend] Using existing healthy engine for ${universeSlug}`);
        return existingEngine;
      } else {
        umLog(`[UniverseBackend] Existing engine for ${universeSlug} is unhealthy, removing`);
        this.gitSyncEngines.delete(universeSlug);
      }
    }

    const universe = this.getUniverse(universeSlug);
    if (!universe) {
      throw new Error(`Universe ${universeSlug} not found`);
    }

    if (!universe?.gitRepo?.enabled) {
      throw new Error(`Universe ${universeSlug} does not have Git repo enabled`);
    }

    if (!universe?.gitRepo?.linkedRepo) {
      throw new Error(`Universe ${universeSlug} does not have a linked repository`);
    }

    umLog(`[UniverseBackend] Creating new Git sync engine for ${universeSlug}`, {
      linkedRepo: universe.gitRepo.linkedRepo,
      sourceOfTruth: universe.sourceOfTruth,
      schemaPath: universe.gitRepo.schemaPath
    });

    if (this.requiresPrimarySelection(universe)) {
      umWarn(`[UniverseBackend] Source of truth not set for ${universeSlug}. Prompting user selection before enabling sync.`);
      await this.promptForPrimarySelection(universe);
      throw new Error('Primary storage must be selected before enabling Git sync');
    }

    // Create provider with validation
    let provider;
    try {
      provider = await this.createProviderForUniverse(universe);
      if (!provider) {
        throw new Error(`Failed to create provider for universe ${universeSlug}`);
      }

      // Test provider availability with retry logic for transient network errors
      let isAvailable = false;
      let lastError = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          isAvailable = await provider.isAvailable();
          if (isAvailable) break;

          // If not available but no error, wait and retry
          if (attempt < 3) {
            umLog(`[UniverseBackend] Provider check attempt ${attempt} returned false, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        } catch (error) {
          lastError = error;
          // Network errors are often transient, retry
          if (error.message?.includes('network') || error.message?.includes('fetch') || attempt < 3) {
            umLog(`[UniverseBackend] Provider check attempt ${attempt} failed (${error.message}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          throw error;
        }
      }

      if (!isAvailable) {
        throw new Error(`Provider for ${universeSlug} is not available after 3 attempts - check authentication and repository access${lastError ? `: ${lastError.message}` : ''}`);
      }

      umLog(`[UniverseBackend] Provider created and validated for ${universeSlug}`);
    } catch (error) {
      umError(`[UniverseBackend] Failed to create/validate provider for ${universeSlug}:`, error);
      this.notifyStatus('error', `Git sync setup failed: ${error.message}`);
      throw error;
    }

    // Create and configure engine
    // CRITICAL: Pass actual sourceOfTruth from universe, don't default to 'git'
    // This prevents Git from overriding local files when local is source of truth
    const sourceOfTruth = universe.sourceOfTruth || 'local';
    const fileName = universe.gitRepo.universeFile || `${universeSlug}.redstring`;
    const universeFolder = universe.gitRepo.universeFolder || universeSlug;
    // GitSyncEngine signature: (provider, sourceOfTruth, universeSlug, fileBaseName, universeFolder)
    const engine = new GitSyncEngine(provider, sourceOfTruth, universeSlug, fileName, universeFolder);

    // Set up event handlers
    engine.onStatusChange((status) => {
      const universeName = universe.name || universeSlug;
      this.notifyStatus(status.type, `${universeName}: ${status.status}`);
    });

    // Register engine
    this.gitSyncEngines.set(universeSlug, engine);

    // Start engine
    try {
      engine.start();
      umLog(`[UniverseBackend] Git sync engine started for universe: ${universeSlug}`);
      this.notifyStatus('success', `Git sync enabled for ${universe.name || universeSlug}`);

      await this.ensureSaveCoordinator(engine);

      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('redstring:git-engine-ready', {
            detail: { slug: universeSlug }
          }));
        }
      } catch (eventError) {
        umWarn('[UniverseBackend] Failed to dispatch git-engine-ready event:', eventError);
      }
    } catch (startError) {
      umError(`[UniverseBackend] Failed to start engine for ${universeSlug}:`, startError);
      this.notifyStatus('error', `Failed to start Git sync: ${startError.message}`);
      throw startError;
    }

    return engine;
  }

  async ensureSaveCoordinator(engine = null) {
    try {
      const { saveCoordinator } = await import('../backend/sync/index.js');
      if (!saveCoordinator) {
        return null;
      }

      const fileStorage = await import('../store/fileStorage.js');
      const resolvedEngine = engine || saveCoordinator.gitSyncEngine || null;

      const localSaveAdapter = {
        saveToFile: async (state, showSuccess = true) => {
          const slug = this.activeUniverseSlug;

          // GUARD: Reject stale saves from a different universe
          if (state?._universeSlug && slug && state._universeSlug !== slug) {
            umWarn(`[UniverseBackend] Rejected stale save: state belongs to "${state._universeSlug}" but active is "${slug}"`);
            return false;
          }

          const universe = slug ? this.getUniverse(slug) : null;

          if (universe?.localFile?.enabled) {
            if (!this.fileHandles.has(slug)) {
              // Gracefully handle disconnected file - log warning but don't crash
              umWarn(`[UniverseBackend] Local file disconnected for ${slug}. Skipping local save.`);
              return false;
            }

            return this.saveToLinkedLocalFile(slug, state, {
              suppressNotification: showSuccess === false
            });
          }

          if (typeof fileStorage?.saveToFile === 'function') {
            return fileStorage.saveToFile(state, showSuccess);
          }

          return false;
        }
      };

      if (!saveCoordinator.isEnabled) {
        saveCoordinator.initialize(localSaveAdapter, resolvedEngine);
        umLog('[UniverseBackend] SaveCoordinator initialized', {
          hasGitEngine: !!resolvedEngine
        });
      } else {
        saveCoordinator.fileStorage = localSaveAdapter;
        saveCoordinator.setGitSyncEngine(resolvedEngine);

        umLog('[UniverseBackend] SaveCoordinator dependencies refreshed', {
          hasGitEngine: !!resolvedEngine
        });
      }

      return saveCoordinator;
    } catch (error) {
      umWarn('[UniverseBackend] ensureSaveCoordinator failed:', error);
      return null;
    }
  }

  /**
   * Create a Git provider for a universe
   */
  async createProviderForUniverse(universe) {
    const linkedRepo = universe.gitRepo.linkedRepo;
    let user, repo;

    if (typeof linkedRepo === 'string') {
      const parts = linkedRepo.split('/');
      user = parts[0];
      repo = parts[1];
    } else if (linkedRepo && typeof linkedRepo === 'object') {
      user = linkedRepo.user;
      repo = linkedRepo.repo;
    }

    if (!user || !repo) {
      throw new Error('Invalid repository configuration');
    }

    // Get authentication with better error handling
    let token, authMethod, installationId;

    try {
      // Try GitHub App first (preferred)
      const app = persistentAuth.getAppInstallation?.();
      if (app?.installationId) {
        // Check if cached token is still valid (expires in 1 hour, refresh if < 5 min remaining)
        const tokenExpiresAt = app.tokenExpiresAt ? new Date(app.tokenExpiresAt) : null;
        const now = new Date();
        const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
        const needsRefresh = !app.accessToken || !tokenExpiresAt || tokenExpiresAt < fiveMinutesFromNow;

        if (needsRefresh) {
          umLog('[UniverseBackend] Refreshing GitHub App token...');
          const { oauthFetch } = await import('./bridgeConfig.js');
          const tokenResp = await oauthFetch('/api/github/app/installation-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ installation_id: app.installationId })
          });

          if (tokenResp.ok) {
            const tokenData = await tokenResp.json();
            token = tokenData.token;
            authMethod = 'github-app';
            installationId = app.installationId;

            // Calculate expiry time (1 hour from now)
            const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

            // Update stored installation with fresh token and expiry
            const updatedApp = { ...app, accessToken: token, tokenExpiresAt: expiresAt.toISOString() };
            await persistentAuth.storeAppInstallation(updatedApp);
            umLog('[UniverseBackend] GitHub App token refreshed');
          } else {
            const errorText = await tokenResp.text();
            umWarn(`[UniverseBackend] Failed to get GitHub App token (${tokenResp.status}), falling back to OAuth`);
          }
        } else {
          // Use cached token (no log spam)
          token = app.accessToken;
          authMethod = 'github-app';
          installationId = app.installationId;
        }
      }

      // Fallback to OAuth if GitHub App failed
      if (!token) {
        umLog(`[UniverseBackend] Using OAuth authentication for ${user}/${repo}`);
        token = await persistentAuth.getAccessToken();
        authMethod = 'oauth';

        if (!token) {
          throw new Error('No valid authentication token available');
        }
      }
    } catch (error) {
      umError('[UniverseBackend] Authentication failed:', error);
      throw new Error(`Authentication required for Git operations: ${error.message}`);
    }

    if (!token) {
      throw new Error('No valid authentication token available');
    }

    const providerConfig = {
      type: 'github',
      user,
      repo,
      token,
      authMethod,
      semanticPath: universe.gitRepo.schemaPath || 'schema'
    };

    if (installationId) {
      providerConfig.installationId = installationId;
    }

    return SemanticProviderFactory.createProvider(providerConfig);
  }

  /**
   * Stop and remove Git sync engine for a universe
   */
  async removeGitSyncEngine(universeSlug) {
    const engine = this.gitSyncEngines.get(universeSlug);
    if (engine) {
      engine.stop();
      this.gitSyncEngines.delete(universeSlug);
      umLog(`[UniverseBackend] Removed Git sync engine for universe: ${universeSlug}`);
    }
  }

  /**
   * Set Git sync engine for universe with STRICT singleton protection
   */
  setGitSyncEngine(slug, gitSyncEngine) {
    // Check if we already have an engine for this universe
    const existingEngine = this.gitSyncEngines.get(slug);
    // If it's the same engine instance, do nothing to avoid log spam
    if (existingEngine && existingEngine === gitSyncEngine) {
      return true;
    }
    if (existingEngine && existingEngine !== gitSyncEngine) {
      // STRICT: Never allow replacement during startup to prevent loops
      umWarn(`[UniverseBackend] STRICTLY REJECTING duplicate engine for ${slug} - one already exists`);
      gitSyncEngine.stop(); // Stop the duplicate engine immediately
      return false;
    }

    this.gitSyncEngines.set(slug, gitSyncEngine);
    umLog(`[UniverseBackend] Git sync engine registered for universe: ${slug}`);
    return true;
  }

  /**
   * Get Git sync engine for universe
   */
  getGitSyncEngine(slug) {
    return this.gitSyncEngines.get(slug);
  }

  /**
   * Get file handle for universe
   */
  getFileHandle(slug) {
    return this.fileHandles.get(slug);
  }

  /**
   * Ensure GitHub App access token (with refresh)
   */
  async ensureGitHubAppAccessToken(forceRefresh = false) {
    if (!persistentAuth?.getAppInstallation) {
      return null;
    }

    const installation = persistentAuth.getAppInstallation();
    if (!installation?.installationId) {
      return null;
    }

    const { installationId } = installation;
    let token = installation.accessToken || null;
    const lastUpdated = installation.lastUpdated || 0;
    const TOKEN_STALE_AFTER_MS = 45 * 60 * 1000; // refresh 15 minutes before expiry
    const tokenStale = forceRefresh || !token || (Date.now() - lastUpdated) > TOKEN_STALE_AFTER_MS;

    if (!tokenStale && token) {
      return { token, installationId };
    }

    try {
      const response = await oauthFetch('/api/github/app/installation-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installation_id: installationId })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`status ${response.status} ${errorText}`);
      }

      const data = await response.json();
      token = data?.token || null;

      if (token) {
        const updated = {
          ...installation,
          accessToken: token,
          lastUpdated: Date.now()
        };
        try {
          await persistentAuth.storeAppInstallation(updated);
        } catch (error) {
          umWarn('[UniverseBackend] Failed to persist refreshed GitHub App token:', error);
        }
        return { token, installationId };
      }
    } catch (error) {
      umWarn('[UniverseBackend] GitHub App token refresh failed:', error);
    }

    return token ? { token, installationId } : null;
  }

  /**
   * Ensure OAuth access token (with refresh)
   */
  async ensureOAuthAccessToken(forceRefresh = false) {
    if (!persistentAuth?.getAccessToken) {
      return null;
    }

    try {
      if (forceRefresh && typeof persistentAuth.refreshAccessToken === 'function') {
        await persistentAuth.refreshAccessToken();
      }

      let token = await persistentAuth.getAccessToken();
      if (!token && typeof persistentAuth.refreshAccessToken === 'function') {
        await persistentAuth.refreshAccessToken();
        token = await persistentAuth.getAccessToken();
      }
      return token || null;
    } catch (error) {
      umWarn('[UniverseBackend] OAuth token retrieval failed:', error);
      return null;
    }
  }

  /**
   * Discover universes in a repository
   */
  async discoverUniversesInRepository(repoConfig) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      umLog(`[UniverseBackend] Discovering universes in ${repoConfig.user}/${repoConfig.repo}...`);

      const resolveDiscoveryAuth = async (preferredMethod = null) => {
        if (!preferredMethod || preferredMethod === 'github-app') {
          const appToken = await this.ensureGitHubAppAccessToken(preferredMethod === 'github-app');
          if (appToken?.token) {
            return { token: appToken.token, authMethod: 'github-app', installationId: appToken.installationId };
          }
        }
        const oauthToken = await this.ensureOAuthAccessToken(false);
        if (oauthToken) {
          return { token: oauthToken, authMethod: 'oauth' };
        }
        return { token: null, authMethod: null };
      };

      const refreshDiscoveryAuth = async (currentContext) => {
        if (!currentContext) return null;
        if (currentContext.authMethod === 'github-app') {
          const refreshed = await this.ensureGitHubAppAccessToken(true);
          if (refreshed?.token) {
            return { token: refreshed.token, authMethod: 'github-app', installationId: refreshed.installationId };
          }
          const fallback = await this.ensureOAuthAccessToken(true);
          if (fallback) {
            return { token: fallback, authMethod: 'oauth' };
          }
          return null;
        }
        const refreshedOAuth = await this.ensureOAuthAccessToken(true);
        return refreshedOAuth ? { token: refreshedOAuth, authMethod: 'oauth' } : null;
      };

      const authContext = await resolveDiscoveryAuth(repoConfig.authMethod || null);
      if (!authContext?.token) {
        throw new Error('Authentication required to discover universes');
      }

      const providerBaseConfig = {
        type: repoConfig.type || 'github',
        user: repoConfig.user,
        repo: repoConfig.repo,
        semanticPath: repoConfig.semanticPath || 'schema'
      };

      const runDiscovery = async (context, allowRetry = true) => {
        const providerConfig = { ...providerBaseConfig, token: context.token, authMethod: context.authMethod || 'oauth' };
        if (context.installationId) {
          providerConfig.installationId = context.installationId;
        }
        const provider = SemanticProviderFactory.createProvider(providerConfig);
        try {
          return await discoverUniversesWithStats(provider);
        } catch (error) {
          const message = error?.message || '';
          const isAuthError = message.includes('401') || message.toLowerCase().includes('unauthorized');
          if (allowRetry && isAuthError) {
            const refreshedContext = await refreshDiscoveryAuth(context);
            if (refreshedContext?.token && refreshedContext.token !== context.token) {
              umLog('[UniverseBackend] Retrying universe discovery with refreshed credentials');
              return runDiscovery(refreshedContext, false);
            }
          }
          throw error;
        }
      };

      const { universes: discovered, stats } = await runDiscovery(authContext, true);
      umLog(`[UniverseBackend] Discovered ${discovered.length} universes in repository`);
      this.notifyStatus('info', `Discovery: ${discovered.length} found • scanned ${stats.scannedDirs} dirs • ${stats.valid} valid • ${stats.invalid} invalid`);

      if (discovered.length === 0) {
        this.notifyStatus('info', `No universes found in ${repoConfig.user}/${repoConfig.repo}`);
      }
      return discovered;
    } catch (error) {
      umError('[UniverseBackend] Universe discovery failed:', error);
      throw error;
    }
  }

  /**
   * Link to a discovered universe
   */
  async linkToDiscoveredUniverse(discoveredUniverse, repoConfig) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // If this is a brand new universe (from creating a new repo), create it locally first
      if (discoveredUniverse.isNew) {
        umLog(`[UniverseBackend] Creating new universe from new repository: ${discoveredUniverse.name}`);

        // Create the universe locally
        const result = await this.createUniverse(discoveredUniverse.name, {
          enableGit: true,
          enableLocal: false
        });

        const slug = result.createdUniverse?.slug || discoveredUniverse.slug;

        // Now link it to the repository
        const universeConfig = createUniverseConfigFromDiscovered({
          ...discoveredUniverse,
          slug: slug
        }, repoConfig);

        // Update the universe with git config
        const existing = this.universes.get(slug);
        if (existing) {
          const updated = {
            ...existing,
            ...universeConfig,
            sourceOfTruth: 'git',
            metadata: {
              ...existing.metadata,
              ...universeConfig.metadata,
              createdWithRepo: new Date().toISOString()
            }
          };
          this.universes.set(slug, this.safeNormalizeUniverse(updated));
          this.saveToStorage();

          // Setup Git sync engine
          try {
            await this.ensureGitSyncEngine(slug);
          } catch (error) {
            umWarn(`[UniverseBackend] Failed to setup engine for new universe ${slug}:`, error);
          }

          // Switch to the new universe
          await this.switchActiveUniverse(slug);

          this.notifyStatus('success', `Created universe "${discoveredUniverse.name}" linked to repository`);
          return slug;
        }
      }

      umLog(`[UniverseBackend] Linking to discovered universe: ${discoveredUniverse.name}`);
      const universeConfig = createUniverseConfigFromDiscovered(discoveredUniverse, repoConfig);

      const existingEntry = this.resolveUniverseEntry(universeConfig.slug);
      if (existingEntry) {
        const { key, universe: existing } = existingEntry;
        const updated = {
          ...existing,
          ...universeConfig,
          metadata: {
            ...existing.metadata,
            ...universeConfig.metadata,
            relinked: new Date().toISOString()
          }
        };
        this.universes.set(key, this.safeNormalizeUniverse(updated));
        this.saveToStorage();
        this.notifyStatus('info', `Updated universe link: ${universeConfig.name}`);

        // Remove old engine and create new one with updated config
        if (this.gitSyncEngines.has(key)) {
          umLog(`[UniverseBackend] Removing old Git sync engine for relinked universe: ${key}`);
          await this.removeGitSyncEngine(key);
        }

        // Ensure Git sync engine is set up for the updated universe
        try {
          await this.ensureGitSyncEngine(key);
        } catch (error) {
          umWarn(`[UniverseBackend] Failed to setup engine for updated universe ${key}:`, error);
        }

        return key;
      }

      const slug = universeConfig.slug;
      this.universes.set(slug, this.safeNormalizeUniverse(universeConfig));
      this.saveToStorage();
      this.notifyStatus('success', `Linked universe: ${universeConfig.name}`);

      // Auto-setup Git sync engine
      try {
        await this.ensureGitSyncEngine(slug);
      } catch (error) {
        umWarn(`[UniverseBackend] Failed to setup engine for new universe ${slug}:`, error);
      }

      return slug;
    } catch (error) {
      umError('[UniverseBackend] Failed to link discovered universe:', error);
      throw error;
    }
  }

  /**
   * Switch active universe
   */
  async switchActiveUniverse(slug, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    umLog(`[UniverseBackend] Switching to universe: ${slug}`);

    const resolved = this.resolveUniverseEntry(slug);
    if (!resolved) {
      throw new Error(`Universe not found: ${slug}`);
    }
    const { key, universe } = resolved;

    if (this.activeUniverseSlug === key) {
      return { universe, storeState: null }; // Already active
    }

    // Save current universe before switching (unless explicitly disabled)
    // Check if active universe actually exists before trying to save (it might have been deleted)
    if (options.saveCurrent !== false && this.activeUniverseSlug && this.universes.has(this.activeUniverseSlug)) {
      try {
        await this.saveActiveUniverse();
        umLog('[UniverseBackend] Saved current universe before switching');
      } catch (error) {
        umWarn('[UniverseBackend] Failed to save current universe before switch:', error);
      }
    }

    this.activeUniverseSlug = key;
    this.saveToStorage();

    // CRITICAL: Cancel any pending background loads to prevent overwriting
    this.pendingBackgroundLoadId = null;

    this.notifyStatus('info', `Switched to universe: ${universe.name}`);

    // Load the universe data based on source of truth
    let storeState;
    try {
      storeState = await this.loadUniverseData(universe);

      // Update universe metadata with current metrics after loading
      if (storeState) {
        const nodeCount = storeState.nodePrototypes
          ? (storeState.nodePrototypes instanceof Map ? storeState.nodePrototypes.size : Object.keys(storeState.nodePrototypes).length)
          : 0;

        const graphCount = storeState.graphs
          ? (storeState.graphs instanceof Map ? storeState.graphs.size : Object.keys(storeState.graphs).length)
          : 0;

        let connectionCount = 0;
        if (storeState.edges) {
          connectionCount = storeState.edges instanceof Map ? storeState.edges.size : Object.keys(storeState.edges).length;
        } else if (storeState.graphs) {
          const graphs = storeState.graphs instanceof Map ? Array.from(storeState.graphs.values()) : Object.values(storeState.graphs || {});
          connectionCount = graphs.reduce((total, g) => total + (Array.isArray(g?.edgeIds) ? g.edgeIds.length : 0), 0);
        }

        this.updateUniverse(key, {
          nodeCount,
          connectionCount,
          graphCount,
          metadata: {
            ...universe.metadata,
            nodeCount,
            connectionCount,
            graphCount,
            lastOpened: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      umError('[UniverseBackend] Failed to load universe data:', error);
      this.notifyStatus('error', `Failed to load universe: ${error.message}`);
      this.storeOperations?.setUniverseError(error.message || 'Failed to load universe');
      throw error;
    }

    const result = { universe, storeState };

    // CRITICAL: Load the new universe data into the graph store
    if (result?.storeState) {
      if (this.storeOperations?.loadUniverseFromFile) {
        umLog('[UniverseBackend] Loading new universe data into graph store...');
        result.storeState._universeSlug = key;
        try {
          const success = this.storeOperations.loadUniverseFromFile(result.storeState);
          if (success) {
            // Validate that data was actually loaded
            const storeState = this.storeOperations.getState();
            const nodeCount = storeState?.nodePrototypes ? (storeState.nodePrototypes instanceof Map ? storeState.nodePrototypes.size : Object.keys(storeState.nodePrototypes).length) : 0;
            const graphCount = storeState?.graphs ? (storeState.graphs instanceof Map ? storeState.graphs.size : Object.keys(storeState.graphs).length) : 0;

            umLog('[UniverseBackend] Successfully loaded universe data into graph store:', {
              nodeCount,
              graphCount,
              isUniverseLoaded: storeState?.isUniverseLoaded,
              hasUniverseFile: storeState?.hasUniverseFile
            });

            const universeName = result.universe?.name || slug;
            if (nodeCount > 0 || graphCount > 0) {
              this.notifyStatus('success', `Loaded ${universeName}: ${nodeCount} nodes, ${graphCount} graphs`);
            } else {
              this.notifyStatus('info', `Switched to empty universe: ${universeName}`);
            }
          } else {
            throw new Error('Store loading returned false');
          }
        } catch (error) {
          umError('[UniverseBackend] Failed to load universe data into graph store:', error);
          this.notifyStatus('error', `Failed to load universe data: ${error.message}`);
          throw error; // Re-throw to surface the error to UI
        }
      } else {
        umError('[UniverseBackend] CRITICAL: Cannot load universe data - store operations not available');
        this.notifyStatus('error', 'Critical error: Store operations not initialized. Please refresh the page.');

        // Try to re-setup store operations
        try {
          await this.setupStoreOperations();
          if (this.storeOperations?.loadUniverseFromFile) {
            umLog('[UniverseBackend] Store operations recovered, retrying data load...');
            this.storeOperations.loadUniverseFromFile(result.storeState);
            this.notifyStatus('success', `Universe switched after recovery: ${result.universe?.name || slug}`);
          }
        } catch (recoveryError) {
          umError('[UniverseBackend] Failed to recover store operations:', recoveryError);
          throw new Error(`Universe data loading failed: Store operations unavailable. Please refresh the page.`);
        }
      }
    } else {
      umWarn('[UniverseBackend] No storeState returned from universe switch - universe may be empty');
      this.notifyStatus('info', `Switched to empty universe: ${slug}`);
    }

    // Ensure engine is set up for the new active universe if Git is enabled
    const switchedUniverse = this.getUniverse(slug);
    if (switchedUniverse?.gitRepo?.enabled && switchedUniverse?.gitRepo?.linkedRepo) {
      try {
        await this.ensureGitSyncEngine(slug);
      } catch (error) {
        umWarn(`[UniverseBackend] Failed to setup engine after universe switch:`, error);
      }
    }

    return result;
  }

  /**
   * Save active universe
   */
  async saveActiveUniverse(storeState = null, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Get current store state if not provided
    if (!storeState && this.storeOperations?.getState) {
      storeState = this.storeOperations.getState();
    }

    umLog('[UniverseBackend] Saving active universe with store state:', {
      hasStoreState: !!storeState,
      hasGraphs: storeState?.graphs ? (storeState.graphs instanceof Map ? storeState.graphs.size : Object.keys(storeState.graphs).length) : 0,
      hasNodes: storeState?.nodePrototypes ? (storeState.nodePrototypes instanceof Map ? storeState.nodePrototypes.size : Object.keys(storeState.nodePrototypes).length) : 0
    });

    // Implementation is below - calling the full saveActiveUniverse implementation
    return this.saveActiveUniverseInternal(storeState, options);
  }

  /**
   * Internal save implementation
   */
  async saveActiveUniverseInternal(storeState, options = {}) {
    let universe = this.getActiveUniverse();
    if (!universe) {
      throw new Error('No active universe to save');
    }

    // Don't auto-save while a slot conflict is pending user resolution.
    // The store may contain temporary safe-fallback data that should not
    // be persisted until the user resolves the conflict.
    // Allow explicit conflict resolution saves via isConflictResolution flag.
    if (this.pendingConflict?.universeSlug === universe.slug && !options.isConflictResolution) {
      umLog('[UniverseBackend] Save suppressed: slot conflict pending for', universe.slug);
      return { results: [], errors: ['Save suppressed: conflict pending'] };
    }

    // Get store state if not provided
    if (!storeState) {
      if (this.storeOperations?.getState) {
        storeState = this.storeOperations.getState();
      } else {
        throw new Error('No store state provided and store operations not available');
      }
    }

    // Export data asynchronously to prevent UI blocking
    const redstringData = await new Promise((resolve) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
          resolve(exportToRedstring(storeState));
        });
      } else {
        setTimeout(() => {
          resolve(exportToRedstring(storeState));
        }, 0);
      }
    });

    const results = [];
    const errors = [];
    const {
      skipGit = false,
      skipLocal = false,
      skipBrowser = false,
      suppressNotification = false
    } = options || {};

    umLog('[UniverseBackend] saveActiveUniverseInternal options:', {
      skipGit,
      skipLocal,
      skipBrowser,
      suppressNotification
    });

    if (!skipLocal) {
      if (universe.localFile.enabled && this.fileHandles.has(universe.slug)) {
        try {
          umLog('[UniverseBackend] Saving to linked local file (autosave)');
          await this.saveToLinkedLocalFile(universe.slug, storeState, { suppressNotification });
          results.push('local');
        } catch (error) {
          umWarn('[UniverseBackend] Local file save failed during autosave:', error);
          errors.push(`Local: ${error.message}`);
        }
      } else if (universe.localFile.enabled) {
        umWarn('[UniverseBackend] Local file enabled but missing handle during autosave');
      }
    } else {
      umLog('[UniverseBackend] Local file save skipped by options');
    }

    // Save to Git if enabled and sync engine is available
    if (!skipGit && universe.gitRepo.enabled && this.gitSyncEngines.has(universe.slug)) {
      try {
        await this.saveToGit(universe, redstringData);
        results.push('git');
      } catch (error) {
        umError('[UniverseBackend] Git save failed:', error);
        errors.push(`Git: ${error.message}`);
      }
    } else if (skipGit && universe.gitRepo.enabled) {
      umLog('[UniverseBackend] Git save skipped by options');
    } else if (universe.gitRepo.enabled && !this.gitSyncEngines.has(universe.slug)) {
      umLog('[UniverseBackend] Git enabled but sync engine not configured yet - skipping Git save');
      errors.push('Git: Sync engine not ready');
    }

    // Save to browser storage if enabled (always try as fallback)
    if (!skipBrowser && (universe.browserStorage.enabled || results.length === 0)) {
      try {
        await this.saveToBrowserStorage(universe, redstringData);
        results.push('browser');
      } catch (error) {
        umError('[UniverseBackend] Browser storage save failed:', error);
        errors.push(`Browser: ${error.message}`);
      }
    } else if (skipBrowser) {
      umLog('[UniverseBackend] Browser save skipped by options');
    }

    if (results.length > 0) {
      if (errors.length > 0) {
        if (!suppressNotification) {
          this.notifyStatus('warning', `Saved to: ${results.join(', ')} (${errors.length} failed)`);
        } else {
          umWarn('[UniverseBackend] Silent save completed with warnings', {
            results,
            errors
          });
        }
      } else if (!suppressNotification) {
        this.notifyStatus('success', `Saved to: ${results.join(', ')}`);
      } else {
        umLog('[UniverseBackend] Silent save completed successfully', { results });
      }
    } else {
      // Always surface total failure
      this.notifyStatus('error', `All save methods failed: ${errors.join('; ')}`);
      throw new Error(`All save methods failed: ${errors.join('; ')}`);
    }

    return results;
  }

  /**
   * Save to Git repository
   */
  async saveToGit(universe, redstringData) {
    const gitSyncEngine = this.gitSyncEngines.get(universe.slug);
    if (!gitSyncEngine) {
      throw new Error('Git sync engine not configured for this universe');
    }

    umLog('[UniverseBackend] Saving to Git via existing sync engine (no restart)');

    try {
      // Use the GitSyncEngine's existing export logic
      if (this.storeOperations?.getState) {
        const storeState = this.storeOperations.getState();
        // Force commit through the existing GitSyncEngine which handles SHA conflicts properly
        await gitSyncEngine.forceCommit(storeState);
      } else {
        throw new Error('Store operations not available for Git sync');
      }
    } catch (error) {
      // If force commit fails with 409, try conflict resolution
      if (error.message && error.message.includes('409')) {
        umLog('[UniverseBackend] 409 conflict detected, attempting resolution');

        if (universe.sourceOfTruth === 'git') {
          // Git is source of truth, try to reload from Git first
          try {
            const gitData = await gitSyncEngine.loadFromGit();
            if (gitData) {
              const { storeState: newState } = importFromRedstring(gitData);
              if (this.storeOperations?.loadUniverseFromFile) {
                this.storeOperations.loadUniverseFromFile(newState);
              }

              this.notifyStatus('info', 'Loaded latest changes from Git repository');
              return; // Successfully resolved by loading Git data
            }
          } catch (loadError) {
            umWarn('[UniverseBackend] Could not load from Git for conflict resolution:', loadError);
          }
        }

        // If Git load failed or local is source of truth, wait and retry
        umLog('[UniverseBackend] Waiting 2 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
          if (this.storeOperations?.getState) {
            const storeState = this.storeOperations.getState();
            await gitSyncEngine.forceCommit(storeState);
            this.notifyStatus('success', 'Conflict resolved with retry');
          } else {
            throw new Error('Store operations not available for retry');
          }
        } catch (retryError) {
          throw new Error(`Persistent 409 conflict: ${retryError.message}`);
        }
      } else {
        throw error; // Re-throw non-409 errors
      }
    }
  }

  /**
   * Save to local file
   */
  async saveToLocalFile(universe, redstringData) {
    let fileHandle = this.fileHandles.get(universe.slug);

    if (!fileHandle) {
      // If no file handle but local storage is enabled, auto-prompt to set one up
      if (universe.localFile.enabled && (isElectron() || hasFileSystemAccess())) {
        try {
          umLog('[UniverseBackend] No file handle for local save, prompting user to select file location');

          const suggestedName = universe.localFile.lastFilePath || universe.localFile.path;
          const hadPreviousHandle = universe.localFile.hadFileHandle;

          const message = hadPreviousHandle
            ? `Re-establish file connection for ${universe.name} (previously: ${suggestedName})`
            : `Set up local file for ${universe.name}`;

          this.notifyStatus('info', message);

          fileHandle = await pickSaveLocation({
            suggestedName: suggestedName
          });

          // Store the file handle
          this.setFileHandle(universe.slug, fileHandle);

          const fileName = isElectron() ? fileHandle.split(/[/\\]/).pop() : (await getFileName(fileHandle));
          this.notifyStatus('success', `Local file ${hadPreviousHandle ? 're-' : ''}connected: ${fileName}`);

        } catch (error) {
          if (error.message?.includes('cancelled') || error.name === 'AbortError') {
            throw new Error('Local file setup cancelled by user');
          } else {
            throw new Error(`Failed to set up local file: ${error.message}`);
          }
        }
      } else if (universe.localFile.enabled) {
        throw new Error('No local file selected. Use the Universe Manager to pick a file location.');
      } else {
        throw new Error('Local file storage not enabled for this universe');
      }
    }

    // Electron: fileHandle is a string path, Browser: fileHandle is a FileHandle object
    const ensurePermission = async () => {
      if (isElectron()) {
        // Electron doesn't need permission checks - file path is already granted
        return;
      }
      const permission = await checkFileHandlePermission(fileHandle);
      if (permission === 'granted') return;
      const granted = await requestFileHandlePermission(fileHandle);
      if (granted !== 'granted') {
        throw new Error('Permission denied for local file access');
      }
    };

    const isPermissionError = (error) => {
      if (!error) return false;
      const name = String(error.name || '');
      const message = String(error.message || '').toLowerCase();
      return name === 'NotAllowedError' ||
        name === 'SecurityError' ||
        message.includes('permission') ||
        message.includes('denied');
    };

    const jsonString = JSON.stringify(redstringData, null, 2);
    try {
      await ensurePermission();
      await writeFile(fileHandle, jsonString);

      try {
        // Only touch metadata for browser FileHandles, Electron uses path-based tracking
        if (!isElectron()) {
          await touchFileHandle(universe.slug, fileHandle);
        }
      } catch (error) {
        umWarn('[UniverseBackend] Failed to touch file handle after save:', error);
      }
    } catch (error) {
      if (isPermissionError(error)) {
        this.notifyStatus('warning', 'Reauthorize local file access to continue saving this universe');
        throw new Error('Local file access was denied');
      }

      throw error;
    }
  }

  /**
   * Save to browser storage with size limits
   */
  async saveToBrowserStorage(universe, redstringData) {
    try {
      const db = await this.openBrowserDB();

      // Check storage quota before saving
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const dataSize = JSON.stringify(redstringData).length;
        const availableSpace = estimate.quota - estimate.usage;

        if (dataSize > availableSpace) {
          // Try to clean up old data first
          await this.cleanupBrowserStorage(db);

          // Check again
          const newEstimate = await navigator.storage.estimate();
          const newAvailableSpace = newEstimate.quota - newEstimate.usage;

          if (dataSize > newAvailableSpace) {
            throw new Error(`Data too large for browser storage: ${Math.round(dataSize / 1024)}KB needed, ${Math.round(newAvailableSpace / 1024)}KB available`);
          }
        }
      }

      const tx = db.transaction(['universes'], 'readwrite');
      const store = tx.objectStore('universes');

      store.put({
        id: universe.browserStorage.key,
        data: redstringData,
        savedAt: Date.now()
      });

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      db.close();
    } catch (error) {
      umError('[UniverseBackend] Browser storage save failed:', error);
      throw error;
    }
  }

  /**
   * Clean up old browser storage data
   */
  async cleanupBrowserStorage(db) {
    try {
      const tx = db.transaction(['universes'], 'readwrite');
      const store = tx.objectStore('universes');
      const request = store.getAll();

      const allData = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      // Sort by savedAt and keep only the 3 most recent
      allData.sort((a, b) => b.savedAt - a.savedAt);
      const toDelete = allData.slice(3);

      if (toDelete.length > 0) {
        const deleteTx = db.transaction(['universes'], 'readwrite');
        const deleteStore = deleteTx.objectStore('universes');

        toDelete.forEach(item => {
          deleteStore.delete(item.id);
        });

        await new Promise((resolve, reject) => {
          deleteTx.oncomplete = () => resolve();
          deleteTx.onerror = () => reject(deleteTx.error);
        });

        umLog(`[UniverseBackend] Cleaned up ${toDelete.length} old browser storage entries`);
      }
    } catch (error) {
      umWarn('[UniverseBackend] Browser storage cleanup failed:', error);
    }
  }

  /**
   * Delete a specific browser storage entry by key (cleanup on universe deletion)
   */
  async deleteBrowserStorageEntry(storageKey) {
    try {
      const db = await this.openBrowserDB();
      const tx = db.transaction(['universes'], 'readwrite');
      tx.objectStore('universes').delete(storageKey);
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      umLog(`[UniverseBackend] Cleaned up browser storage entry: ${storageKey}`);
    } catch (error) {
      umWarn('[UniverseBackend] Failed to clean up browser storage entry:', error);
    }
  }

  /**
   * Open browser storage database
   */
  openBrowserDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('RedstringUniverses', 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('universes')) {
          db.createObjectStore('universes', { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Set file handle for a universe
   */
  async setFileHandle(slug, fileHandle, options = {}) {
    this.fileHandles.set(slug, fileHandle);

    let displayPath = options.displayPath || options.originalPath || null;
    let fileName = options.fileName || null;

    // Handle Electron file paths (strings) vs browser FileHandles
    if (isElectron() && typeof fileHandle === 'string') {
      // Electron: fileHandle is a full path string
      displayPath = displayPath || fileHandle;
      fileName = fileName || fileHandle.split(/[/\\]/).pop();
      umLog(`[UniverseBackend] Setting Electron file handle for ${slug}: ${displayPath}`);
    } else if (fileHandle?.name) {
      // Browser: fileHandle is a FileSystemFileHandle
      fileName = fileName || fileHandle.name;

      if (!displayPath && fileHandle?.getFile) {
        try {
          const fileForPath = await fileHandle.getFile();
          displayPath = fileForPath?.path || fileForPath?.webkitRelativePath || fileForPath?.name || fileHandle?.name || null;
        } catch (error) {
          umLog('[UniverseBackend] Unable to derive display path from file handle:', error);
          displayPath = fileHandle?.name || null;
        }
      }
    }

    if (!displayPath) {
      displayPath = fileName || null;
    }

    // Request persistent storage (browser only)
    if (!isElectron() && typeof navigator !== 'undefined' && navigator.storage?.persist && !this.persistentStorageRequested) {
      try {
        const granted = await navigator.storage.persist();
        umLog(`[UniverseBackend] Persistent storage ${granted ? 'enabled' : 'already granted'} for file handles`);
      } catch (error) {
        umWarn('[UniverseBackend] Failed to request persistent storage:', error);
      } finally {
        this.persistentStorageRequested = true;
      }
    }

    // Store file handle metadata for persistence
    let metadataStored = false;
    try {
      await storeFileHandleMetadata(slug, fileHandle, {
        universeSlug: slug,
        lastAccessed: Date.now(),
        fileName,
        displayPath
      });
      umLog(`[UniverseBackend] Stored file handle metadata for ${slug}${isElectron() ? ' (Electron)' : ''}`);
      metadataStored = true;
    } catch (error) {
      // Log the error but don't fail the operation - file was created successfully
      umError(`[UniverseBackend] Failed to store file handle metadata for ${slug}:`, {
        error: error.message,
        fileName,
        displayPath,
        isElectron: isElectron()
      });
      // Continue anyway - we'll retry on next access
    }

    // Also update the universe configuration
    const universe = this.getUniverse(slug);
    if (universe) {
      const hasActiveGitLink = !!(universe.gitRepo?.enabled && universe.gitRepo?.linkedRepo);
      const shouldPromoteLocal = !hasActiveGitLink && universe.sourceOfTruth !== SOURCE_OF_TRUTH.LOCAL;
      await this.updateUniverse(slug, {
        localFile: {
          ...universe.localFile,
          enabled: true,
          path: isElectron() ? displayPath : this.sanitizeFileName(fileName || universe.localFile.path || slug),
          displayPath: displayPath || universe.localFile.displayPath || fileName || universe.localFile.path,
          hadFileHandle: true,
          lastFilePath: isElectron() ? displayPath : (fileName || universe.localFile.path),
          fileHandleStatus: 'connected',
          unavailableReason: null
        },
        ...(shouldPromoteLocal ? { sourceOfTruth: SOURCE_OF_TRUTH.LOCAL } : {})
      });
    }

    // Persist file handle information to storage
    this.saveToStorage();
    await this.ensureSaveCoordinator();

    if (!options.suppressNotification) {
      const universe = this.getUniverse(slug);
      const displayLabel = displayPath || fileName || universe?.localFile?.displayPath || universe?.localFile?.path || slug;
      this.notifyStatus('success', `Linked local file: ${displayLabel}`);
    }

    return { success: true, fileName, displayPath, metadataStored };
  }

  /**
   * Setup file handle for universe (user picks file)
   */
  async setupFileHandle(slug) {
    try {
      // Get metadata to suggest the last known file name
      const metadata = await getFileHandleMetadata(slug);
      const universe = this.getUniverse(slug);
      const suggestedName = metadata?.fileName || universe?.localFile?.lastFilePath || `${slug}.redstring`;

      // Use the file access adapter (works in both browser and Electron)
      const fileHandle = await pickFile({
        suggestedName
      });

      await this.setFileHandle(slug, fileHandle);

      // Get filename for display
      const fileName = isElectron() ?
        (typeof fileHandle === 'string' ? fileHandle.split(/[/\\]/).pop() : suggestedName) :
        fileHandle?.name || suggestedName;

      const wasReconnecting = metadata?.fileName && !this.fileHandles.has(slug);
      this.notifyStatus('success', `${wasReconnecting ? 'Reconnected' : 'Linked'} local file: ${fileName}`);
      return fileHandle;
    } catch (error) {
      if (error.name !== 'AbortError' && !error.message?.includes('cancelled')) {
        this.notifyStatus('error', `Failed to setup file handle: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * Reload active universe
   */
  async reloadActiveUniverse() {
    try {
      const universe = this.getActiveUniverse();
      if (!universe) return false;

      umLog('[UniverseBackend] Reloading active universe:', universe.name);

      let storeState = null;
      let loadMethod = 'unknown';

      try {
        storeState = await this.loadUniverseData(universe);
        loadMethod = universe.sourceOfTruth;
      } catch (primaryError) {
        umWarn('[UniverseBackend] Primary load failed:', primaryError);
        if (
          primaryError?.code === LOCAL_FILE_ERROR.PERMISSION ||
          primaryError?.code === LOCAL_FILE_ERROR.MISSING ||
          primaryError?.code === LOCAL_FILE_ERROR.NOT_FOUND
        ) {
          this.notifyStatus('warning', primaryError.message);
          return false;
        }
      }

      if (storeState) {
        if (this.storeOperations?.loadUniverseFromFile) {
          this.storeOperations.loadUniverseFromFile(storeState);
        }

        this.notifyStatus('success', `Reloaded universe from ${loadMethod}`);
        return true;
      }

      this.notifyStatus('warning', 'Could not reload universe from any source');
      return false;
    } catch (error) {
      umError('[UniverseBackend] Failed to reload active universe:', error);
      this.notifyStatus('error', `Reload failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all universes
   */
  getAllUniverses() {
    return Array.from(this.universes.values());
  }

  /**
   * Get active universe
   */
  getActiveUniverse() {
    const resolved = this.resolveUniverseEntry(this.activeUniverseSlug);
    return resolved ? resolved.universe : null;
  }

  /**
   * Get universe by slug
   */
  getUniverse(slug) {
    const resolved = this.resolveUniverseEntry(slug);
    return resolved ? resolved.universe : null;
  }

  /**
   * Load universe data based on source of truth priority
   * Now with proactive conflict detection between slots
   */
  async loadUniverseData(universe, options = {}) {
    const { sourceOfTruth } = universe;
    const {
      skipConflictDetection = false,
      allowPermissionPrompt = true
    } = options;

    const hasLocal = universe.localFile?.enabled;
    const hasGit = universe.gitRepo?.enabled;
    const primaryDefined = sourceOfTruth === SOURCE_OF_TRUTH.LOCAL || sourceOfTruth === SOURCE_OF_TRUTH.GIT;

    // If both local and Git are enabled, check for conflicts or missing primary selection
    if (!skipConflictDetection && hasLocal && hasGit) {
      try {
        let conflict = await this.detectSlotConflict(universe, {
          forcePrompt: !primaryDefined
        });
        if (conflict) {
          // Auto-resolve when source of truth is defined AND has data.
          // Only show conflict dialog when:
          //   - No source of truth defined, OR
          //   - Source of truth slot is empty but the other slot has data
          const primaryHasData = sourceOfTruth === SOURCE_OF_TRUTH.GIT
            ? conflict.gitData.nodeCount > 0
            : conflict.localData.nodeCount > 0;

          const canAutoResolve = primaryDefined && !conflict.riskOverwriteEmptyPrimary && (
            conflict.areIdentical === true || primaryHasData
          );
          if (canAutoResolve) {
            const primaryState = sourceOfTruth === SOURCE_OF_TRUTH.GIT
              ? conflict.gitData?.storeState
              : conflict.localData?.storeState;

            if (primaryState) {
              try {
                umLog('[UniverseBackend] Auto-resolving slot conflict using source of truth', {
                  sourceOfTruth,
                  areIdentical: conflict.areIdentical,
                  primaryNodeCount: sourceOfTruth === SOURCE_OF_TRUTH.GIT ? conflict.gitData.nodeCount : conflict.localData.nodeCount,
                  secondaryNodeCount: sourceOfTruth === SOURCE_OF_TRUTH.GIT ? conflict.localData.nodeCount : conflict.gitData.nodeCount
                });
                await this.syncSecondaryStorage(universe, primaryState, {
                  source: sourceOfTruth,
                  force: true,
                  throttleMs: 0
                });

                const recheck = await this.detectSlotConflict(universe, { forcePrompt: false });
                if (!recheck) {
                  this.pendingConflict = null;
                  this.pendingPrimarySelection.delete(universe.slug);
                  umLog('[UniverseBackend] Conflict resolved automatically');
                  return primaryState;
                }
                conflict = recheck;
              } catch (autoError) {
                umWarn('[UniverseBackend] Auto-resolution of slot conflict failed:', autoError);
              }
            }
          }

          umLog('[UniverseBackend] Slot conflict detected, notifying UI');
          // Store conflict for UI to handle
          this.pendingConflict = conflict;
          if (conflict.requiresPrimarySelection) {
            const alreadyPrompted = this.pendingPrimarySelection.has(universe.slug);
            this.pendingPrimarySelection.add(universe.slug);
            if (!alreadyPrompted) {
              const needsConsent = conflict.areIdentical !== true;
              const extra = conflict.riskOverwriteEmptyPrimary ? ' The selected source appears empty and would overwrite existing data.' : '';
              this.notifyStatus('warning', `${needsConsent ? 'Review required: potential overwrite.' : 'Select a primary storage'} for ${universe.name || universe.slug} to continue.${extra}`);

              // Only emit event if not already prompted to prevent duplicate modals
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('redstring:slot-conflict', {
                  detail: conflict
                }));
              }
            }
          } else {
            // Non-primary selection conflicts should always show modal
            if (typeof window !== 'undefined') {
              const alreadyPrompted = this.pendingPrimarySelection.has(universe.slug);
              if (!alreadyPrompted) {
                this.pendingPrimarySelection.add(universe.slug);
                window.dispatchEvent(new CustomEvent('redstring:slot-conflict', {
                  detail: conflict
                }));
              }
            }
          }

          // Return safe data while conflict dialog is pending.
          // If primary is empty but secondary has data, use the non-empty
          // slot to prevent loading empty state (which auto-save could propagate).
          if (conflict.riskOverwriteEmptyPrimary) {
            const safeData = sourceOfTruth === SOURCE_OF_TRUTH.GIT
              ? conflict.localData.storeState
              : conflict.gitData.storeState;
            if (safeData) {
              umLog('[UniverseBackend] Returning non-empty secondary data as safe temporary state during conflict');
              return safeData;
            }
          }
          return conflict.primaryData;
        }
      } catch (error) {
        umWarn('[UniverseBackend] Conflict detection failed:', error);
        // Continue with normal load if conflict detection fails
      }
    }

    // Race loading strategies for maximum speed
    // Strategy:
    // 1. If Local is enabled and has handle, try it immediately (fastest path)
    // 2. Concurrently try Git if enabled
    // 3. Concurrently try Browser Storage as backup
    // 4. Return the first successful 'authoritative' result if possible, or best available

    const loadPromies = [];

    // 1. Local Load (High Priority)
    if (universe.localFile?.enabled) {
      loadPromies.push(
        this.loadFromLocalFile(universe, { allowPermissionPrompt })
          .then(data => ({ source: SOURCE_OF_TRUTH.LOCAL, data, error: null }))
          .catch(error => ({ source: SOURCE_OF_TRUTH.LOCAL, data: null, error }))
      );
    }

    // 2. Git Load (Medium Priority - Network bound)
    // Only fetch if Git is explicitly enabled AND has a linked repository
    const hasLinkedGitRepo = universe.gitRepo?.enabled && universe.gitRepo?.linkedRepo;

    if (hasLinkedGitRepo) {
      const gitPromise = this.loadFromGit(universe)
        .catch(() => this.loadFromGitDirect(universe)) // Try direct fallback
        .then(data => ({ source: SOURCE_OF_TRUTH.GIT, data, error: null }))
        .catch(error => ({ source: SOURCE_OF_TRUTH.GIT, data: null, error }));
      loadPromies.push(gitPromise);
    }

    // 3. Browser Storage (Low Priority / Backup)
    if (universe.browserStorage?.enabled) {
      loadPromies.push(
        this.loadFromBrowserStorage(universe)
          .then(data => ({ source: SOURCE_OF_TRUTH.BROWSER, data, error: null }))
          .catch(error => ({ source: SOURCE_OF_TRUTH.BROWSER, data: null, error }))
      );
    }

    if (loadPromies.length === 0) {
      umWarn('[UniverseBackend] No storage methods enabled, creating empty state');
      return this.createEmptyState();
    }

    // Wait for all attempts to settle, but we can be smart about which one we pick
    // (In a future iteration we could use Promise.race for even faster UI, but we need to respect Source of Truth)
    const results = await Promise.all(loadPromies);
    const resultsMap = new Map(results.map(r => [r.source, r]));

    // Decision Logic:

    // A. If Source of Truth is LOCAL and it succeeded, use it directly.
    if (sourceOfTruth === SOURCE_OF_TRUTH.LOCAL) {
      const localRes = resultsMap.get(SOURCE_OF_TRUTH.LOCAL);
      if (localRes?.data) {
        return this.syncAndReturn(universe, localRes.data, {
          force: true,
          source: SOURCE_OF_TRUTH.LOCAL,
          allowPermissionPrompt
        });
      } else if (localRes?.error) {
        // If local failed with specific permission/missing error, rethrow to trigger UI prompt
        if (
          localRes.error?.code === LOCAL_FILE_ERROR.PERMISSION ||
          localRes.error?.code === LOCAL_FILE_ERROR.MISSING ||
          localRes.error?.code === LOCAL_FILE_ERROR.NOT_FOUND
        ) {
          umWarn('[UniverseBackend] Primary Local load blocked:', localRes.error.message);
          throw localRes.error;
        }
      }
    }

    // B. If Source of Truth is GIT and it succeeded, use it.
    if (sourceOfTruth === SOURCE_OF_TRUTH.GIT) {
      const gitRes = resultsMap.get(SOURCE_OF_TRUTH.GIT);
      if (gitRes?.data) {
        return this.syncAndReturn(universe, gitRes.data, {
          force: true,
          source: SOURCE_OF_TRUTH.GIT,
          allowPermissionPrompt
        });
      }
    }

    // C. Fallbacks (Cross-Loading):
    // If Source of Truth failed, try the backups in order of speed/reliability: Local > Git > Browser

    // Try Local fallback
    const localRes = resultsMap.get(SOURCE_OF_TRUTH.LOCAL);
    if (localRes?.data) {
      umLog('[UniverseBackend] Using Local fallback (Primary unavailable)');
      this.notifyStatus('warning', 'Primary storage unavailable. Loaded from local backup.');
      // If dual-connected but no source of truth set, adopt this source
      if (!primaryDefined && hasLocal && hasGit) {
        umLog('[UniverseBackend] Auto-setting source of truth to local (loaded from local fallback)');
        await this.updateUniverse(universe.slug, { sourceOfTruth: SOURCE_OF_TRUTH.LOCAL });
      }
      return this.syncAndReturn(universe, localRes.data, {
        source: SOURCE_OF_TRUTH.LOCAL,
        allowPermissionPrompt
      });
    }

    // Try Git fallback
    const gitRes = resultsMap.get(SOURCE_OF_TRUTH.GIT);
    if (gitRes?.data) {
      umLog('[UniverseBackend] Using Git fallback (Primary unavailable)');
      this.notifyStatus('warning', 'Primary storage unavailable. Loaded from Git backup.');
      // If dual-connected but no source of truth set, adopt this source
      if (!primaryDefined && hasLocal && hasGit) {
        umLog('[UniverseBackend] Auto-setting source of truth to git (loaded from git fallback)');
        await this.updateUniverse(universe.slug, { sourceOfTruth: SOURCE_OF_TRUTH.GIT });
      }
      return this.syncAndReturn(universe, gitRes.data, {
        source: SOURCE_OF_TRUTH.GIT,
        allowPermissionPrompt
      });
    }

    // Try Browser fallback
    const browserRes = resultsMap.get(SOURCE_OF_TRUTH.BROWSER);
    if (browserRes?.data) {
      umLog('[UniverseBackend] Using Browser Storage fallback');
      this.notifyStatus('warning', 'Primary storage unavailable. Loaded from browser backup.');
      return this.syncAndReturn(universe, browserRes.data, {
        source: SOURCE_OF_TRUTH.BROWSER,
        allowPermissionPrompt
      });
    }

    // Return empty state if absolutely everything failed
    umWarn('[UniverseBackend] All parallel load methods failed, creating empty state');
    return this.createEmptyState();
  }

  /**
   * Detect conflicts between local file and Git repository slots
   * Returns conflict data if slots have diverged, null if they match or one is missing
   */
  async detectSlotConflict(universe, options = {}) {
    const { forcePrompt = false } = options;
    umLog('[UniverseBackend] Checking for slot conflicts...');

    // Load data from both slots in parallel
    const [localResult, gitResult] = await Promise.allSettled([
      this.loadFromLocalFile(universe, { allowPermissionPrompt: false }).catch(() => null),
      this.loadFromGit(universe).catch(() => null)
    ]);

    const localData = localResult.status === 'fulfilled' ? localResult.value : null;
    const gitData = gitResult.status === 'fulfilled' ? gitResult.value : null;

    // If either slot is missing, no conflict
    if (!localData || !gitData) {
      umLog('[UniverseBackend] No conflict - one or both slots empty');
      return null;
    }

    // Compare data to detect divergence
    const localInfo = this.analyzeStoreData(localData);
    const gitInfo = this.analyzeStoreData(gitData);

    // If one side has no nodes, it's effectively empty — no real conflict.
    // The non-empty side should just be used without prompting.
    if (localInfo.nodeCount === 0 || gitInfo.nodeCount === 0) {
      umLog('[UniverseBackend] No conflict - one side is effectively empty', {
        localNodes: localInfo.nodeCount, gitNodes: gitInfo.nodeCount
      });
      return null;
    }

    // Check if data is significantly different
    const isDifferent = (
      localInfo.nodeCount !== gitInfo.nodeCount ||
      localInfo.graphCount !== gitInfo.graphCount ||
      Math.abs(localInfo.nodeCount - gitInfo.nodeCount) > 5 || // More than 5 node difference
      Math.abs(localInfo.graphCount - gitInfo.graphCount) > 1  // More than 1 graph difference
    );

    const requiresPrimarySelection = forcePrompt && !isDifferent;

    if (!isDifferent && !forcePrompt) {
      umLog('[UniverseBackend] Slots match, no conflict');
      return null;
    }

    umLog('[UniverseBackend] Conflict detected:', {
      local: localInfo,
      git: gitInfo
    });

    // Build conflict object
    let primaryData;
    if (universe.sourceOfTruth === SOURCE_OF_TRUTH.LOCAL) {
      primaryData = localData;
    } else if (universe.sourceOfTruth === SOURCE_OF_TRUTH.GIT) {
      primaryData = gitData;
    } else {
      primaryData = (gitInfo.timestamp || 0) >= (localInfo.timestamp || 0) ? gitData : localData;
    }

    // Determine if data are identical and whether choosing an empty primary risks data loss
    const areIdentical = !isDifferent;
    const isLocalEmpty = localInfo.nodeCount === 0 && localInfo.graphCount === 0;
    const isGitEmpty = gitInfo.nodeCount === 0 && gitInfo.graphCount === 0;
    const riskOverwriteEmptyPrimary = (
      (universe.sourceOfTruth === SOURCE_OF_TRUTH.LOCAL && isLocalEmpty && !isGitEmpty) ||
      (universe.sourceOfTruth === SOURCE_OF_TRUTH.GIT && isGitEmpty && !isLocalEmpty)
    );

    return {
      universeSlug: universe.slug,
      universeName: universe.name || universe.slug,
      sourceOfTruth: universe.sourceOfTruth,
      localData: {
        storeState: localData,
        nodeCount: localInfo.nodeCount,
        graphCount: localInfo.graphCount,
        timestamp: localInfo.timestamp
      },
      gitData: {
        storeState: gitData,
        nodeCount: gitInfo.nodeCount,
        graphCount: gitInfo.graphCount,
        timestamp: gitInfo.timestamp
      },
      primaryData,
      requiresPrimarySelection,
      areIdentical,
      riskOverwriteEmptyPrimary
    };
  }

  requiresPrimarySelection(universe) {
    if (!universe) return false;
    const localEnabled = !!universe.localFile?.enabled;
    const gitEnabled = !!universe.gitRepo?.enabled;
    const source = universe.sourceOfTruth;
    const hasValidSource = source === SOURCE_OF_TRUTH.LOCAL || source === SOURCE_OF_TRUTH.GIT;
    return localEnabled && gitEnabled && !hasValidSource;
  }

  async promptForPrimarySelection(universe) {
    if (!universe) return null;

    try {
      const conflict = await this.detectSlotConflict(universe, { forcePrompt: true });
      if (conflict) {
        this.pendingConflict = conflict;
        const alreadyPrompted = this.pendingPrimarySelection.has(universe.slug);

        // Only dispatch event and notify if not already prompted to prevent duplicates
        if (!alreadyPrompted) {
          this.pendingPrimarySelection.add(universe.slug);

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('redstring:slot-conflict', {
              detail: conflict
            }));
          }

          this.notifyStatus('warning', `Select a primary storage for ${universe.name || universe.slug} to continue syncing.`);
        }
      }
      return conflict;
    } catch (error) {
      umWarn('[UniverseBackend] Failed to prompt for primary selection:', error);
      return null;
    }
  }

  getSecondarySyncState(slug) {
    return this.secondarySyncTimestamps.get(slug) || { local: 0, browser: 0 };
  }

  setSecondarySyncState(slug, next) {
    this.secondarySyncTimestamps.set(slug, next);
  }

  async syncSecondaryStorage(universe, storeState, options = {}) {
    if (!universe || !storeState) return;

    const slug = universe.slug;

    // Don't sync secondary storage while a slot conflict is pending resolution
    if (this.pendingConflict?.universeSlug === slug) {
      umLog('[UniverseBackend] Secondary sync suppressed: conflict pending for', slug);
      return;
    }
    const now = Date.now();
    const {
      force = false,
      throttleMs = 0,
      source = universe.sourceOfTruth,
      allowPermissionPrompt = true
    } = options;

    const syncState = this.getSecondarySyncState(slug);
    let updated = false;
    const nextState = { ...syncState };

    const shouldSync = (last) => force || throttleMs <= 0 || !last || (now - last) >= throttleMs;

    // Never propagate an empty/near-empty state to secondary slots implicitly.
    // A state with graphs but no nodes is effectively empty from the user's perspective.
    const { nodeCount: srcNodeCount, graphCount: srcGraphCount } = this.analyzeStoreData(storeState);
    const isSourceEmpty = (srcNodeCount === 0);

    const handle = this.fileHandles.get(slug);

    if (universe.localFile?.enabled && handle && source !== SOURCE_OF_TRUTH.LOCAL) {
      if (isSourceEmpty) {
        umLog('[UniverseBackend] Secondary sync skipped: source state is empty, not overwriting local file implicitly');
      } else if (shouldSync(syncState.local)) {
        let saved = false;
        if (!allowPermissionPrompt) {
          try {
            const permission = await checkFileHandlePermission(handle);
            if (permission !== 'granted') {
              umLog('[UniverseBackend] Secondary local sync skipped: permission not granted and prompts disabled');
              saved = false;
            } else {
              await this.saveToLinkedLocalFile(slug, storeState, { suppressNotification: true });
              saved = true;
            }
          } catch (permError) {
            umWarn('[UniverseBackend] Permission check failed for secondary local sync:', permError);
          }
        } else {
          try {
            await this.saveToLinkedLocalFile(slug, storeState, { suppressNotification: true });
            saved = true;
          } catch (error) {
            umWarn('[UniverseBackend] Secondary local sync failed:', error);
          }
        }

        if (saved) {
          nextState.local = now;
          updated = true;
          umLog(`[UniverseBackend] Secondary sync: updated local file for ${slug}`);
        }
      }
    }

    if (universe.browserStorage?.enabled && source !== SOURCE_OF_TRUTH.BROWSER) {
      if (isSourceEmpty) {
        umLog('[UniverseBackend] Secondary sync skipped: source state is empty, not overwriting browser cache implicitly');
      } else if (shouldSync(syncState.browser)) {
        try {
          const redstringData = exportToRedstring(storeState);
          await this.saveToBrowserStorage(universe, redstringData);
          nextState.browser = now;
          updated = true;
          umLog(`[UniverseBackend] Secondary sync: updated browser cache for ${slug}`);
        } catch (error) {
          umWarn('[UniverseBackend] Secondary browser sync failed:', error);
        }
      }
    }

    if (updated) {
      this.setSecondarySyncState(slug, nextState);
    }
  }

  async syncAndReturn(universe, storeState, options = {}) {
    await this.syncSecondaryStorage(universe, storeState, options);
    return storeState;
  }

  /**
   * Analyze store data to extract metadata
   */
  analyzeStoreData(storeState) {
    if (!storeState) {
      return { nodeCount: 0, graphCount: 0, timestamp: null };
    }

    const nodeCount = storeState.nodePrototypes
      ? (storeState.nodePrototypes instanceof Map
        ? storeState.nodePrototypes.size
        : Object.keys(storeState.nodePrototypes || {}).length)
      : 0;

    const graphCount = storeState.graphs
      ? (storeState.graphs instanceof Map
        ? storeState.graphs.size
        : Object.keys(storeState.graphs || {}).length)
      : 0;

    // Try to extract timestamp from metadata
    const timestamp = storeState.metadata?.lastModified ||
      storeState.metadata?.lastSaved ||
      storeState.lastModified ||
      Date.now();

    return { nodeCount, graphCount, timestamp };
  }

  /**
   * Resolve a conflict by choosing which slot to use
   */
  async resolveConflict(universeSlug, chosenSource) {
    const universe = this.universes.get(universeSlug);
    if (!universe) {
      throw new Error(`Universe not found: ${universeSlug}`);
    }

    const conflict = this.pendingConflict;
    if (!conflict || conflict.universeSlug !== universeSlug) {
      throw new Error('No pending conflict for this universe');
    }

    umLog('[UniverseBackend] Resolving conflict, chosen source:', chosenSource);

    // Get the chosen data
    const chosenData = chosenSource === 'local'
      ? conflict.localData.storeState
      : conflict.gitData.storeState;

    // Always set source of truth to the user's explicit choice
    umLog('[UniverseBackend] Setting source of truth to:', chosenSource);
    await this.updateUniverse(universeSlug, {
      sourceOfTruth: chosenSource
    });

    // Load chosen data into store
    if (this.storeOperations?.loadUniverseFromFile) {
      this.storeOperations.loadUniverseFromFile(chosenData);
    }

    // Save to both slots to sync them.
    // Pass isConflictResolution to bypass the pending-conflict save guard.
    await this.saveActiveUniverse(null, { isConflictResolution: true });

    // Clear pending conflict
    if (this.pendingConflict?.universeSlug === universeSlug) {
      this.pendingConflict = null;
    }
    this.pendingPrimarySelection.delete(universeSlug);

    this.notifyStatus('success', `Conflict resolved using ${chosenSource} data`);

    return chosenData;
  }

  /**
   * Cancel a pending conflict without choosing a side.
   * Re-enables saves that were suppressed while the conflict dialog was open.
   */
  cancelPendingConflict(universeSlug) {
    if (this.pendingConflict?.universeSlug === universeSlug) {
      this.pendingConflict = null;
      umLog('[UniverseBackend] Pending conflict cancelled for', universeSlug);
    }
    this.pendingPrimarySelection.delete(universeSlug);
  }

  /**
   * Load from Git repository
   */
  async loadFromGit(universe) {
    const gitSyncEngine = this.gitSyncEngines.get(universe.slug);
    if (!gitSyncEngine) {
      // Try a provider-backed direct read before giving up
      const direct = await this.loadFromGitDirect(universe);
      if (direct) return direct;
      throw new Error('Git sync engine not configured for this universe');
    }

    const redstringData = await gitSyncEngine.loadFromGit();
    if (!redstringData) return null;

    const { storeState } = importFromRedstring(redstringData);
    return storeState;
  }

  /**
   * Direct Git read without requiring a registered GitSyncEngine
   */
  async loadFromGitDirect(universe) {
    try {
      const linked = universe?.gitRepo?.linkedRepo;
      if (!linked) return null;

      let user, repo;
      if (typeof linked === 'string') {
        const parts = linked.split('/');
        user = parts[0];
        repo = parts[1];
      } else if (linked && typeof linked === 'object') {
        user = linked.user;
        repo = linked.repo;
      }
      if (!user || !repo) return null;

      // Prefer GitHub App installation token when available; fall back to OAuth
      let token;
      let authMethod = 'oauth';
      try {
        const app = persistentAuth.getAppInstallation?.();
        if (app?.installationId) {
          const tokenExpiresAt = app.tokenExpiresAt ? new Date(app.tokenExpiresAt) : null;
          const now = new Date();
          const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
          const needsRefresh = !app.accessToken || !tokenExpiresAt || tokenExpiresAt < fiveMinutesFromNow;

          if (needsRefresh) {
            const tokenResp = await oauthFetch('/api/github/app/installation-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ installation_id: app.installationId })
            });

            if (tokenResp.ok) {
              const tokenData = await tokenResp.json();
              token = tokenData.token;
              authMethod = 'github-app';

              const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
              const updatedApp = { ...app, accessToken: token, tokenExpiresAt: expiresAt.toISOString() };
              await persistentAuth.storeAppInstallation(updatedApp);
            } else {
              token = await persistentAuth.getAccessToken();
              authMethod = token ? 'oauth' : authMethod;
            }
          } else {
            token = app.accessToken;
            authMethod = 'github-app';
          }
        } else {
          token = await persistentAuth.getAccessToken();
          authMethod = token ? 'oauth' : authMethod;
        }
      } catch (_) {
        try {
          token = await persistentAuth.getAccessToken();
          authMethod = token ? 'oauth' : authMethod;
        } catch (__) { }
      }
      if (!token) {
        this.notifyStatus('error', 'Git authentication required to access repository');
        return null;
      }

      const provider = SemanticProviderFactory.createProvider({
        type: 'github',
        user,
        repo,
        token,
        authMethod,
        semanticPath: universe?.gitRepo?.schemaPath || 'schema'
      });

      try {
        const ok = await provider.isAvailable();
        if (!ok) {
          umWarn('[UniverseBackend] Provider unavailable or unauthorized; skipping direct Git access');
          return null;
        }
      } catch (e) {
        umWarn('[UniverseBackend] Provider availability check failed; skipping direct Git access:', e?.message || e);
        return null;
      }

      // universeFolder is just the folder name (e.g., "default"), not the full path
      const universeFolder = universe?.gitRepo?.universeFolder || universe.slug;
      const fileName = universe?.gitRepo?.universeFile || `${universe.slug}.redstring`;

      // Construct full path: universes/{folder}/{file}
      const filePath = `universes/${universeFolder}/${fileName}`;

      let content;
      try {
        content = await provider.readFileRaw(filePath);
      } catch (readError) {
        content = null;
      }

      if (!content || typeof content !== 'string' || content.trim() === '') {
        try {
          const initialStoreState = this.createEmptyState();
          const initialRedstring = await new Promise((resolve) => {
            if (typeof requestIdleCallback !== 'undefined') {
              requestIdleCallback(() => resolve(exportToRedstring(initialStoreState)));
            } else {
              setTimeout(() => resolve(exportToRedstring(initialStoreState)), 0);
            }
          });
          await provider.writeFileRaw(filePath, JSON.stringify(initialRedstring, null, 2));
          this.notifyStatus('success', `Created new universe file at ${filePath}`);
          const { storeState } = importFromRedstring(initialRedstring);
          return storeState;
        } catch (createErr) {
          umWarn('[UniverseBackend] Failed to create initial universe file on Git:', createErr);
          return null;
        }
      }

      let redstringData;
      try {
        redstringData = JSON.parse(content);
      } catch (e) {
        umWarn('[UniverseBackend] Direct Git read parse failed:', e.message);
        return null;
      }

      const { storeState } = importFromRedstring(redstringData);
      return storeState;
    } catch (error) {
      umWarn('[UniverseBackend] Direct Git read failed:', error);
      return null;
    }
  }

  /**
   * Load from local file
   */
  async loadFromLocalFile(universe, options = {}) {
    const { allowPermissionPrompt = true } = options;
    const slug = universe.slug;
    const ensureResult = await this.ensureLocalFileHandle(universe);
    const fileHandle = this.fileHandles.get(slug);

    if (!fileHandle) {
      const message = ensureResult?.message || 'Local file connection not available. Reconnect the file to continue.';
      const code = ensureResult?.needsPermission ? LOCAL_FILE_ERROR.PERMISSION : LOCAL_FILE_ERROR.MISSING;
      throw createLocalFileError(code, message);
    }

    // Electron doesn't need permission checks - file paths are already granted
    if (ensureResult?.needsPermission && !isElectron()) {
      const message = ensureResult?.message || 'Grant file access permission to resume saving.';

      if (!allowPermissionPrompt) {
        throw createLocalFileError(LOCAL_FILE_ERROR.PERMISSION, message);
      }

      if (typeof fileHandle.requestPermission !== 'function') {
        throw createLocalFileError(LOCAL_FILE_ERROR.PERMISSION, message);
      }

      let permission = 'denied';
      try {
        permission = await requestFileHandlePermission(fileHandle);
      } catch (error) {
        umWarn('[UniverseBackend] Permission request failed for local file:', error);
        throw createLocalFileError(LOCAL_FILE_ERROR.PERMISSION, error?.message || message);
      }

      if (permission !== 'granted') {
        await this.updateLocalFileState(universe, {
          fileHandleStatus: 'permission_needed',
          reconnectMessage: message,
          unavailableReason: message
        });
        throw createLocalFileError(LOCAL_FILE_ERROR.PERMISSION, message);
      }

      await this.updateLocalFileState(universe, {
        fileHandleStatus: 'connected',
        reconnectMessage: null,
        unavailableReason: null,
        hadFileHandle: true,
        lastAccessed: Date.now()
      });

      try {
        await storeFileHandleMetadata(slug, fileHandle, {
          lastAccessed: Date.now()
        });
      } catch (metadataError) {
        umWarn('[UniverseBackend] Failed to persist metadata after permission grant:', metadataError);
      }
    }

    // Electron: fileHandle is a string path, Browser: fileHandle is a FileHandle object
    let text;
    try {
      if (isElectron()) {
        // Check if file exists first
        const exists = await fileExists(fileHandle);
        if (!exists) {
          await this.updateLocalFileState(universe, {
            hadFileHandle: false,
            fileHandleStatus: 'needs_reconnect',
            reconnectMessage: 'Local file not found. Reconnect the file to continue.',
            unavailableReason: 'Local file not found. Reconnect the file to continue.'
          });
          throw createLocalFileError(LOCAL_FILE_ERROR.NOT_FOUND, 'Local file not found. Reconnect the file to continue.');
        }
      }

      text = await readFile(fileHandle);
    } catch (error) {
      const name = String(error?.name || '');
      const message = String(error?.message || '');

      if (name === 'NotAllowedError' || name === 'SecurityError' || message.includes('Permission')) {
        await this.updateLocalFileState(universe, {
          fileHandleStatus: 'permission_needed',
          reconnectMessage: 'Grant file access permission to resume saving.',
          unavailableReason: 'Grant file access permission to resume saving.'
        });
        throw createLocalFileError(LOCAL_FILE_ERROR.PERMISSION, 'Permission denied for local file access.');
      }
      if (name === 'NotFoundError' || message.includes('not found')) {
        await this.updateLocalFileState(universe, {
          hadFileHandle: false,
          fileHandleStatus: 'needs_reconnect',
          reconnectMessage: 'Local file not found. Reconnect the file to continue.',
          unavailableReason: 'Local file not found. Reconnect the file to continue.'
        });
        throw createLocalFileError(LOCAL_FILE_ERROR.NOT_FOUND, 'Local file not found. Reconnect the file to continue.');
      }
      umWarn('[UniverseBackend] Failed to read local file contents:', error);
      throw createLocalFileError(LOCAL_FILE_ERROR.MISSING, 'Failed to read the linked local file.');
    }

    if (!text || text.trim() === '') {
      return null;
    }

    try {
      const redstringData = JSON.parse(text);
      const { storeState } = importFromRedstring(redstringData);
      try {
        // Update file handle metadata after successful load
        await touchFileHandle(slug, fileHandle);
      } catch (touchError) {
        umWarn('[UniverseBackend] Failed to update file handle metadata after load:', touchError);
      }
      return storeState;
    } catch (error) {
      umWarn('[UniverseBackend] Failed to parse local file JSON:', error);
      throw new Error(`Invalid local file format: ${error.message}`);
    }
  }

  /**
   * Load from browser storage
   */
  async loadFromBrowserStorage(universe) {
    try {
      const db = await this.openBrowserDB();
      const tx = db.transaction(['universes'], 'readonly');
      const store = tx.objectStore('universes');
      const req = store.get(universe.browserStorage.key);

      const result = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });

      db.close();

      if (!result) return null;

      const { storeState } = importFromRedstring(result.data);
      return storeState;
    } catch (error) {
      umError('[UniverseBackend] Browser storage load failed:', error);
      return null;
    }
  }

  /**
   * Create new universe
   */
  async createUniverse(name, options = {}) {
    umLog(`[UniverseBackend] createUniverse called with name: "${name}", options:`, options);

    try {
      if (!this.isInitialized) {
        umLog('[UniverseBackend] Backend not initialized, initializing now...');
        await this.initialize();
        umLog('[UniverseBackend] Backend initialization completed');
      }
    } catch (error) {
      umWarn('[UniverseBackend] Initialization failed, continuing anyway:', error);
    }

    umLog('[UniverseBackend] Creating universe via direct implementation...');

    const slug = this.generateUniqueSlug(name);
    const safeName = (typeof name === 'string' && name.trim().length > 0) ? name : slug;
    const universe = this.safeNormalizeUniverse({
      slug,
      name: safeName,
      sourceOfTruth: options.sourceOfTruth || (this.isGitOnlyMode ? SOURCE_OF_TRUTH.GIT : SOURCE_OF_TRUTH.LOCAL),
      localFile: {
        enabled: options.enableLocal ?? true,
        path: this.sanitizeFileName(safeName)
      },
      gitRepo: {
        enabled: options.enableGit ?? false,
        linkedRepo: options.linkedRepo || null,
        schemaPath: options.schemaPath || 'schema'
      }
    });

    this.universes.set(slug, universe);
    this.saveToStorage();

    umLog('[UniverseBackend] Universe created:', universe.slug);

    // Set as active universe and ensure store is updated
    try {
      umLog('[UniverseBackend] Setting new universe as active...');
      this.activeUniverseSlug = slug;
      this.saveToStorage();

      // Ensure the graph store is properly initialized with empty state
      if (this.storeOperations?.loadUniverseFromFile) {
        const emptyState = this.createEmptyState();
        emptyState._universeSlug = slug;
        this.storeOperations.loadUniverseFromFile(emptyState);
        umLog('[UniverseBackend] Graph store initialized with empty state for new active universe');
      }
    } catch (error) {
      umWarn('[UniverseBackend] Failed to activate new universe:', error);
    }

    this.notifyStatus('success', `Created universe: ${name}`);

    // Auto-setup engine if Git is enabled
    if (universe.gitRepo?.enabled && universe.gitRepo?.linkedRepo) {
      umLog('[UniverseBackend] Setting up Git sync engine for new universe...');
      try {
        await this.ensureGitSyncEngine(universe.slug);
      } catch (error) {
        umWarn(`[UniverseBackend] Failed to auto-setup engine for new universe:`, error);
      }
    }

    umLog('[UniverseBackend] createUniverse completed successfully, returning universe');
    return universe;
  }

  /**
   * Delete linked local file for a universe (before deleting the universe entry)
   */
  async deleteLinkedFile(slug) {
    const resolved = this.resolveUniverseEntry(slug);
    if (!resolved) {
      umWarn('[UniverseBackend] deleteLinkedFile: universe not found:', slug);
      return;
    }
    const { key, universe } = resolved;

    // Try to get the file handle (absolute path in Electron)
    const fileHandle = this.fileHandles.get(key);
    const localPath = universe.localFile?.path;
    const filePath = fileHandle || localPath;

    if (!filePath || typeof filePath !== 'string') {
      umWarn('[UniverseBackend] deleteLinkedFile: no file path available for', key);
      return;
    }

    // Electron: use IPC to delete file
    if (typeof window !== 'undefined' && window.electron?.fileSystem?.deleteFile) {
      try {
        await window.electron.fileSystem.deleteFile(filePath);
        umLog(`[UniverseBackend] Deleted linked file: ${filePath}`);
      } catch (err) {
        umWarn(`[UniverseBackend] Failed to delete file ${filePath}:`, err);
        throw err;
      }
    } else {
      umWarn('[UniverseBackend] File deletion not available in this environment (browser)');
    }
  }

  /**
   * Delete universe
   */
  async deleteUniverse(slug) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const resolved = this.resolveUniverseEntry(slug);
    if (!resolved) {
      throw new Error(`Universe not found: ${slug}`);
    }
    const { key, universe } = resolved;

    const isDeletingActive = (this.activeUniverseSlug === key);

    // Remove engine first
    this.removeGitSyncEngine(slug);

    // CRITICAL: Cancel pending saves BEFORE deletion to prevent stale data
    // from being written to the next universe's file during the async switch gap
    if (isDeletingActive) {
      try {
        const { saveCoordinator } = await import('../backend/sync/index.js');
        if (saveCoordinator) {
          saveCoordinator.cancelPendingSaves();
        }
      } catch (e) {
        umWarn('[UniverseBackend] Could not cancel pending saves:', e);
      }
    }

    // Delete from universes
    this.universes.delete(key);
    this.fileHandles.delete(key);

    this.saveToStorage();
    this.notifyStatus('info', `Deleted universe: ${universe.name}`);

    // Clean up browser storage for deleted universe
    if (universe.browserStorage?.key) {
      this.deleteBrowserStorageEntry(universe.browserStorage.key).catch(err => {
        umWarn('[UniverseBackend] Browser storage cleanup failed:', err);
      });
    }

    // If we deleted the active universe, switch to another or create a fresh one
    if (isDeletingActive) {
      if (this.universes.size > 0) {
        const nextSlug = Array.from(this.universes.keys())[0];
        umLog(`[UniverseBackend] Active universe deleted, switching to: ${nextSlug}`);
        await this.switchActiveUniverse(nextSlug, { saveCurrent: false });
      } else {
        umLog('[UniverseBackend] Last universe deleted, creating fresh blank universe');
        await this.createUniverse('Untitled Universe');
      }
    }
  }

  /**
   * Update universe
   */
  async updateUniverse(slug, updates) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    umLog(`[UniverseBackend] Updating universe ${slug}:`, updates);

    const resolved = this.resolveUniverseEntry(slug);
    if (!resolved) {
      throw new Error(`Universe not found: ${slug}`);
    }
    const { key, universe } = resolved;

    const updated = {
      ...universe,
      ...updates,
      lastModified: new Date().toISOString()
    };

    this.universes.set(key, this.safeNormalizeUniverse(updated));
    this.saveToStorage();

    this.notifyStatus('info', `Updated universe: ${universe.name}`);

    const result = updated;

    // Get universe for potential use below
    const updatedUniverse = this.getUniverse(slug);

    // If Git repo was enabled or linked repo was updated, ensure sync engine is set up
    if (updates.gitRepo) {
      if (updatedUniverse?.gitRepo?.enabled && updatedUniverse?.gitRepo?.linkedRepo) {
        umLog(`[UniverseBackend] Git repo updated for ${slug}, ensuring sync engine is set up`);
        setTimeout(() => {
          this.ensureGitSyncEngine(slug).catch(error => {
            umWarn(`[UniverseBackend] Failed to setup engine after repo update:`, error);
            this.notifyStatus('warning', `Git sync setup failed: ${error.message}`);
          });
        }, 100);
      } else if (updates.gitRepo.enabled === false) {
        // Git was disabled, remove the engine
        umLog(`[UniverseBackend] Git disabled for ${slug}, removing sync engine`);
        this.removeGitSyncEngine(slug);
      }
    }

    // If sources were updated, notify about the change
    if (updates.sources) {
      this.notifyStatus('info', `Data sources updated for universe: ${updatedUniverse?.name || slug}`);
    }

    // Signal update to UI components (e.g. SaveStatusDisplay)
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('redstring:universe-updated', {
          detail: { slug, action: 'update' }
        }));
      } catch (_) { }
    }

    return result;
  }

  /**
   * Get authentication status
   */
  getAuthStatus() {
    if (!this.isInitialized) {
      this.initialize();
    }
    // Always read fresh auth status from persistentAuth to avoid stale cache
    const freshStatus = persistentAuth.getAuthStatus();
    this.authStatus = freshStatus;
    return freshStatus;
  }

  /**
   * Get sync engine status for a universe
   */
  getSyncStatus(universeSlug) {
    const engine = this.gitSyncEngines.get(universeSlug);
    return engine ? engine.getStatus() : null;
  }

  /**
   * Force save for a universe
   */
  async forceSave(universeSlug, storeState, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Use active universe if no slug provided
    if (!universeSlug) {
      const activeUniverse = this.getActiveUniverse();
      universeSlug = activeUniverse?.slug;
      if (!universeSlug) {
        throw new Error('No active universe to save');
      }
    }

    // Get store state if not provided
    if (!storeState && this.storeOperations?.getState) {
      storeState = this.storeOperations.getState();
    }

    if (!storeState) {
      throw new Error('No store state available for saving');
    }

    umLog(`[UniverseBackend] Force saving universe ${universeSlug}`);

    let universe = this.getUniverse(universeSlug);
    if (!universe) {
      throw new Error(`Universe ${universeSlug} not found`);
    }
    if (this.requiresPrimarySelection(universe)) {
      umWarn(`[UniverseBackend] Force save blocked - primary storage not selected for ${universeSlug}`);
      await this.promptForPrimarySelection(universe);
      throw new Error('Select a primary storage before saving changes');
    }

    // Check what storage is enabled (local-first approach)
    let localConfig = universe.localFile || universe.raw?.localFile || {};
    let hasLocalHandle = this.fileHandles.has(universeSlug);
    let hasLocalFileEnabled = localConfig?.enabled !== false;
    let hasLocalFile = hasLocalFileEnabled && hasLocalHandle;
    const skipGit = options?.skipGit === true;
    const hasGitRepo = universe.raw?.gitRepo?.enabled && (universe.raw?.gitRepo?.linkedRepo || universe.gitRepo?.linkedRepo);
    const sourceOfTruth = universe.sourceOfTruth || 'browser';

    umLog(`[UniverseBackend] Save options for ${universeSlug}:`, {
      sourceOfTruth,
      hasLocalFile,
      hasGitRepo,
      localFilePath: universe.raw?.localFile?.path
    });

    if (hasLocalFileEnabled && !hasLocalHandle && localConfig?.hadFileHandle) {
      umWarn(`[UniverseBackend] Local file handle missing for ${universeSlug}; marking as needs reconnection`);
      try {
        await this.updateUniverse(universeSlug, {
          localFile: {
            ...localConfig,
            hadFileHandle: false,
            fileHandleStatus: 'needs_reconnect',
            unavailableReason: 'Reauthorize file access to continue saving locally.'
          }
        });
        this.notifyStatus('warning', 'Reconnect local file to continue saving changes locally');
      } catch (updateError) {
        umWarn('[UniverseBackend] Failed to mark local file for reconnection:', updateError);
      }
      universe = this.getUniverse(universeSlug) || universe;
      localConfig = universe.localFile || universe.raw?.localFile || {};
      hasLocalHandle = this.fileHandles.has(universeSlug);
      hasLocalFileEnabled = localConfig?.enabled !== false;
      hasLocalFile = hasLocalFileEnabled && hasLocalHandle;
    }

    try {
      const results = {
        localFile: null,
        git: null,
        browser: null
      };
      let hasAnySuccess = false;

      // Save to local file if enabled and has handle
      if (hasLocalFile && this.fileHandles.has(universeSlug)) {
        umLog(`[UniverseBackend] Saving to local file`);
        try {
          const result = await this.saveToLinkedLocalFile(universeSlug, storeState);
          results.localFile = { success: true, fileName: result.fileName };
          hasAnySuccess = true;
          umLog(`[UniverseBackend] ✓ Local file saved: ${result.fileName}`);
        } catch (error) {
          umWarn(`[UniverseBackend] ✗ Local file save failed:`, error);
          results.localFile = { success: false, error: error.message };
        }
      } else if (hasLocalFileEnabled) {
        results.localFile = {
          success: false,
          error: 'file_handle_missing'
        };
      }

      // Save to Git if enabled (regardless of source of truth)
      if (hasGitRepo && !skipGit) {
        umLog(`[UniverseBackend] Saving to Git repository`);

        // Track operation start for Git
        this.trackGitOperationStart(universeSlug, 'force-save', {
          isConnected: !!this.authStatus?.isAuthenticated,
          hasUnsavedChanges: true
        });

        try {
          let engine = this.gitSyncEngines.get(universeSlug);
          if (!engine) {
            umLog(`[UniverseBackend] Creating Git engine for ${universeSlug}`);
            engine = await this.ensureGitSyncEngine(universeSlug);
          }

          if (engine) {
            const result = await engine.forceCommit(storeState);

            // Track successful completion
            this.trackGitOperationComplete(universeSlug, 'force-save', true, {
              commitHash: result?.commitHash,
              bytesWritten: result?.bytesWritten,
              fileName: `universes/${engine.universeFolder}/${engine.fileBaseName}.redstring`
            });

            results.git = { success: true, commitHash: result?.commitHash };
            hasAnySuccess = true;
            umLog(`[UniverseBackend] ✓ Git saved: ${result?.commitHash}`);
          }
        } catch (error) {
          umWarn(`[UniverseBackend] ✗ Git save failed:`, error);
          this.trackGitOperationComplete(universeSlug, 'force-save', false, {
            error: error.message
          });
          results.git = { success: false, error: error.message };
        }
      } else if (hasGitRepo && skipGit) {
        umLog('[UniverseBackend] Skipping Git save (skipGit flag set)');
      }

      // Always save to browser storage as backup/cache (skip local/git to avoid duplicate writes)
      umLog(`[UniverseBackend] Saving to browser storage`);
      try {
        await this.saveActiveUniverse(storeState, { skipLocal: true, skipGit: true });
        results.browser = { success: true };
        hasAnySuccess = true;
        umLog(`[UniverseBackend] ✓ Browser storage saved`);
      } catch (error) {
        umWarn(`[UniverseBackend] ✗ Browser storage save failed:`, error);
        results.browser = { success: false, error: error.message };
      }

      // Build success message
      const savedTo = [];
      if (results.localFile?.success) savedTo.push(`local file (${results.localFile.fileName})`);
      if (results.git?.success) savedTo.push('Git repository');
      if (results.browser?.success && savedTo.length === 0) savedTo.push('browser storage');

      if (hasAnySuccess) {
        try {
          await this.syncSecondaryStorage(universe, storeState, {
            source: sourceOfTruth,
            throttleMs: 0
          });
        } catch (syncError) {
          umWarn('[UniverseBackend] Secondary sync after save failed:', syncError);
        }

        try {
          const timestamp = new Date().toISOString();
          await this.updateUniverse(universeSlug, {
            metadata: {
              ...(universe.metadata || {}),
              lastSync: timestamp,
              lastSaved: timestamp
            }
          });
        } catch (metaError) {
          umWarn('[UniverseBackend] Failed to update last sync metadata:', metaError);
        }

        const message = savedTo.length > 0
          ? `Saved to ${savedTo.join(' and ')}`
          : 'Saved successfully';
        this.notifyStatus('success', message);
        return {
          success: true,
          savedTo: results,
          sourceOfTruth // For reference on which one is authoritative
        };
      } else {
        throw new Error('All save methods failed');
      }

    } catch (error) {
      umError(`[UniverseBackend] All save methods failed for ${universeSlug}:`, error);
      this.notifyStatus('error', `Save failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reload universe from its source of truth
   */
  async reloadUniverse(universeSlug) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    umLog(`[UniverseBackend] Reloading universe: ${universeSlug}`);

    // CRITICAL: Cancel any pending background loads to prevent overwriting
    this.pendingBackgroundLoadId = null;

    const universe = this.getUniverse(universeSlug);
    if (!universe) {
      throw new Error(`Universe ${universeSlug} not found`);
    }

    // Determine the source of truth
    const sourceOfTruth = universe.sourceOfTruth || 'browser';
    umLog(`[UniverseBackend] Reloading from source of truth: ${sourceOfTruth}`);

    try {
      // Use loadUniverseData method which handles all sources
      const data = await this.loadUniverseData(universe);

      if (data) {
        umLog(`[UniverseBackend] Loading universe data into store:`, {
          nodeCount: data.nodePrototypes ? (data.nodePrototypes instanceof Map ? data.nodePrototypes.size : Object.keys(data.nodePrototypes).length) : 0,
          graphCount: data.graphs ? (data.graphs instanceof Map ? data.graphs.size : Object.keys(data.graphs).length) : 0
        });

        if (this.storeOperations?.loadUniverseFromFile) {
          // Prefer the same pathway used on universe switch
          this.storeOperations.loadUniverseFromFile(data);
        } else if (this.storeOperations?.loadState) {
          await this.storeOperations.loadState(data);
        } else {
          throw new Error('Store operations not available');
        }

        umLog(`[UniverseBackend] Universe reloaded successfully from ${sourceOfTruth}`);
        this.notifyStatus('success', `Universe reloaded from ${sourceOfTruth}`);
        return { success: true, source: sourceOfTruth };
      } else {
        umWarn(`[UniverseBackend] No data found`);
        return { success: false, source: sourceOfTruth };
      }
    } catch (error) {
      umError(`[UniverseBackend] Failed to reload universe:`, error);
      this.notifyStatus('error', `Failed to reload universe: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download universe as local .redstring file
   */
  async downloadLocalFile(universeSlug, storeState = null) {
    umLog(`[UniverseBackend] Downloading local file for universe: ${universeSlug}`);

    const universe = this.getUniverse(universeSlug);
    if (!universe) {
      throw new Error(`Universe ${universeSlug} not found`);
    }

    // Get store state if not provided
    if (!storeState) {
      // Try to get from store operations if available
      const useGraphStore = (await import('../store/graphStore.jsx')).default;
      storeState = useGraphStore.getState();
    }

    const fileName = `${universe.name || universeSlug}.redstring`;

    try {
      downloadRedstringFile(storeState, fileName);
      this.notifyStatus('success', `Downloaded ${fileName}`);
      return { success: true, fileName };
    } catch (error) {
      umError(`[UniverseBackend] Failed to download ${fileName}:`, error);
      this.notifyStatus('error', `Download failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download universe data directly from linked Git repository
   */
  async downloadGitUniverse(universeSlug) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const universe = this.getUniverse(universeSlug);
    if (!universe) {
      throw new Error(`Universe ${universeSlug} not found`);
    }

    if (!universe.gitRepo?.enabled || !universe.gitRepo?.linkedRepo) {
      throw new Error('No linked Git repository available for this universe');
    }

    const fileName = universe.gitRepo?.universeFile || `${universeSlug}.redstring`;
    let storeState = null;

    try {
      storeState = await this.loadFromGitDirect(universe);
    } catch (error) {
      umWarn('[UniverseBackend] Direct Git download failed, attempting via sync engine:', error);
    }

    if (!storeState) {
      try {
        await this.ensureGitSyncEngine(universeSlug);
        storeState = await this.loadFromGit(universe);
      } catch (error) {
        umError('[UniverseBackend] Unable to load universe from Git sync engine:', error);
        throw new Error(`Failed to load data from Git repository: ${error.message}`);
      }
    }

    if (!storeState) {
      throw new Error('Git repository did not return any universe data');
    }

    try {
      downloadRedstringFile(storeState, fileName);
      this.notifyStatus('success', `Downloaded ${fileName} from Git`);
      return { success: true, fileName };
    } catch (error) {
      umError(`[UniverseBackend] Failed to download ${fileName} from Git:`, error);
      this.notifyStatus('error', `Download failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload/Import universe from local .redstring file
   */
  async uploadLocalFile(file, targetUniverseSlug = null) {
    umLog(`[UniverseBackend] Uploading local file: ${file.name}`);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const jsonData = JSON.parse(e.target.result);

          // Get store actions
          const useGraphStore = (await import('../store/graphStore.jsx')).default;
          const storeActions = useGraphStore.getState();

          // Import the data
          importFromRedstring(jsonData, storeActions);

          this.notifyStatus('success', `Imported ${file.name}`);
          resolve({ success: true, fileName: file.name });
        } catch (error) {
          umError(`[UniverseBackend] Failed to import ${file.name}:`, error);
          this.notifyStatus('error', `Import failed: ${error.message}`);
          reject(error);
        }
      };

      reader.onerror = () => {
        const error = new Error('Failed to read file');
        this.notifyStatus('error', error.message);
        reject(error);
      };

      reader.readAsText(file);
    });
  }

  /**
   * Prompt user to select a file handle and store it (pick or saveAs)
   */
  async setupLocalFileHandle(universeSlug, options = {}) {
    const mode = options?.mode === 'saveAs' ? 'saveAs' : 'pick';
    const universe = this.getUniverse(universeSlug);

    // Get metadata to suggest the last known file name
    const metadata = await getFileHandleMetadata(universeSlug);
    const suggestedName = options?.suggestedName || metadata?.fileName || universe?.localFile?.path || `${universe?.name || universeSlug}.redstring`;

    let handle;
    if (mode === 'pick') {
      handle = await pickFile({
        types: [{ description: 'Redstring Files', accept: { 'application/json': ['.redstring'] } }],
        multiple: false
      });
    } else {
      handle = await pickSaveLocation({
        suggestedName,
        types: [{ description: 'Redstring Files', accept: { 'application/json': ['.redstring'] } }]
      });
    }
    return this.setFileHandle(universeSlug, handle);
  }

  /**
   * Request permission for an existing local file handle without relinking
   */
  async requestLocalFilePermission(universeSlug) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    let handle = this.fileHandles.get(universeSlug);
    if (!handle) {
      const restore = await attemptRestoreFileHandle(universeSlug);
      if (restore?.success && restore.handle) {
        handle = restore.handle;
        this.fileHandles.set(universeSlug, handle);
      }
    }

    if (!handle) {
      throw new Error('No linked local file handle found. Reconnect the file to continue.');
    }

    let permission = await checkFileHandlePermission(handle);
    if (permission !== 'granted') {
      permission = await requestFileHandlePermission(handle);
    }

    if (permission !== 'granted') {
      throw new Error('File access permission was denied.');
    }

    try {
      await handle.getFile();
    } catch (error) {
      const name = String(error?.name || '');
      if (name === 'NotFoundError') {
        throw new Error('The linked file could not be found. Reconnect the file to continue.');
      }
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('Permission was not granted for the linked file.');
      }
      throw error;
    }

    const metadata = await getFileHandleMetadata(universeSlug);
    try {
      await storeFileHandleMetadata(universeSlug, handle, {
        ...(metadata || {}),
        lastAccessed: Date.now()
      });
    } catch (error) {
      umWarn('[UniverseBackend] Failed to update file handle metadata after permission grant:', error);
    }

    const universe = this.getUniverse(universeSlug);
    if (universe) {
      await this.ensureLocalFileHandle(universe);
    }

    // Proactively reload universe data now that permission is granted
    try {
      if (universe) {
        const storeState = await this.loadUniverseData(universe);
        if (storeState && this.storeOperations?.loadUniverseFromFile) {
          this.storeOperations.loadUniverseFromFile(storeState);
        } else {
          // Ensure UI becomes interactive even if no data is returned
          this.storeOperations?.setUniverseLoaded(true, true);
        }
      } else {
        this.storeOperations?.setUniverseLoaded(true, true);
      }
      // Signal success to user and any listeners
      this.notifyStatus('success', 'Local file access restored. Universe loaded.');
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('redstring:universe-reloaded', { detail: { source: 'local-permission' } }));
        } catch (_) { }
      }
    } catch (error) {
      // Do not block UI; mark as loaded with file present and surface message
      umWarn('[UniverseBackend] Reload after permission grant failed:', error);
      this.storeOperations?.setUniverseLoaded(true, true);
      this.notifyStatus('warning', `File access restored, but load failed: ${error.message}`);
    }

    return { granted: true };
  }

  /**
   * Save current universe store state to the previously linked file handle
  */
  async saveToLinkedLocalFile(universeSlug, storeState = null, options = {}) {
    const {
      suppressNotification = false
    } = options || {};

    // 1. Prepare data first (needed for potential file creation)
    if (!storeState && this.storeOperations?.getState) {
      storeState = this.storeOperations.getState();
    }
    if (!storeState) {
      throw new Error('No store state available to save');
    }
    const redstringData = exportToRedstring(storeState);
    const jsonString = JSON.stringify(redstringData, null, 2);

    // 2. Get file handle
    let handle = this.fileHandles.get(universeSlug);

    if (handle) {
      umLog(`[FileHandles] ✓ Found existing file handle for ${universeSlug}: ${typeof handle === 'string' ? handle : handle?.name || 'FileHandle'}`);
    } else {
      umLog(`[FileHandles] 🔍 No file handle in registry for ${universeSlug}, attempting to locate/create...`);
    }

    // Fallback: try workspace folder if no individual handle
    if (!handle) {
      const universe = this.getUniverse(universeSlug);
      const fileName = universe?.localFile?.fileName ||
        universe?.localFile?.path?.split(/[/\\]/).pop() ||
        universe?.localFile?.displayPath?.split(/[/\\]/).pop() ||
        `${universeSlug}.redstring`;

      umLog(`[FileHandles] Attempting workspace lookup for: ${fileName}`);

      try {
        const { getFileFromWorkspace, createFileInWorkspace } = await import('./workspaceFolderService.js');

        // Try getting existing file first
        handle = await getFileFromWorkspace(fileName);

        // If not found but we have workspace access, create it!
        if (!handle) {
          umLog(`[FileHandles] Creating file in workspace: ${fileName}`);
          // Use overwrite: false to prevent clobbering if our previous check failed falsely
          handle = await createFileInWorkspace(fileName, jsonString, { overwrite: false });
          // createFileInWorkspace already wrote the content
          umLog(`[FileHandles] ✓ Created file in workspace: ${fileName}`);
        } else {
          // We found existing file, so we need to write to it below
          umLog(`[FileHandles] ✓ Found existing workspace file: ${fileName}`);
        }

        if (handle) {
          this.fileHandles.set(universeSlug, handle);
          umLog(`[FileHandles] ✓ Registered file handle for ${universeSlug}`);
        }
      } catch (wsError) {
        umWarn(`[FileHandles] ⚠ Workspace folder fallback failed: ${wsError.message}`);
      }
    }

    if (!handle) {
      umError(`[FileHandles] ✗ No linked local file found or created for ${universeSlug}`);
      throw new Error('No linked local file. Pick a file first.');
    }

    // Get filename for display/storage
    const fileName = isElectron() ?
      (typeof handle === 'string' ? handle.split(/[/\\]/).pop() : 'unknown') :
      (handle?.name || 'unknown');

    const isPermissionError = (error) => {
      if (!error) return false;
      const name = String(error.name || '');
      const message = String(error.message || '').toLowerCase();
      return name === 'NotAllowedError' ||
        name === 'SecurityError' ||
        message.includes('permission') ||
        message.includes('denied');
    };

    try {
      // Use the unified file access adapter
      await writeFile(handle, jsonString);

      // Update last accessed time in persistence
      try {
        await touchFileHandle(universeSlug, handle);
      } catch (error) {
        umWarn('[UniverseBackend] Failed to touch file handle after save:', error);
      }
    } catch (error) {
      if (isPermissionError(error)) {
        umWarn('[UniverseBackend] Local file permission denied during save, flagging reconnect requirement');
        const universe = this.getUniverse(universeSlug);
        if (universe) {
          await this.updateUniverse(universeSlug, {
            localFile: {
              ...universe.localFile,
              hadFileHandle: true,
              fileHandleStatus: 'permission_needed',
              reconnectMessage: 'Permission denied. Grant access to continue saving.',
              unavailableReason: 'Permission denied. Allow access to resume automatic saves.'
            }
          });
        }
        this.notifyStatus('warning', 'Reauthorize local file access to continue saving this universe');
      }

      throw error;
    }

    const universe = this.getUniverse(universeSlug);
    if (universe) {
      await this.updateUniverse(universeSlug, {
        localFile: {
          ...universe.localFile,
          hadFileHandle: true,
          lastFilePath: isElectron() ? handle : fileName,
          lastSaved: new Date().toISOString(),
          fileHandleStatus: 'connected',
          unavailableReason: null
        }
      });
    }

    if (!suppressNotification) {
      this.notifyStatus('success', `Saved to ${fileName}`);
    } else {
      umLog('[UniverseBackend] Local file save completed without user notification');
    }
    return { success: true, fileName };
  }



  /**
   * Link local file to universe (for future saves/loads)
   */
  async linkLocalFileToUniverse(universeSlug, filePath, options = {}) {
    umLog(`[UniverseBackend] Linking local file to universe ${universeSlug}: ${filePath}`);

    const universe = this.getUniverse(universeSlug);
    if (!universe) {
      throw new Error(`Universe ${universeSlug} not found`);
    }

    // Update universe with local file configuration (preserving existing localFile properties)
    const hasActiveGitLink = !!(universe.gitRepo?.enabled && universe.gitRepo?.linkedRepo);
    const shouldPromoteLocal = !hasActiveGitLink && universe.sourceOfTruth !== SOURCE_OF_TRUTH.LOCAL;
    const displayPath = options.displayPath || universe.localFile?.displayPath || filePath;

    await this.updateUniverse(universeSlug, {
      localFile: {
        ...universe.localFile, // Preserve existing properties like hadFileHandle
        enabled: true,
        path: filePath,
        displayPath,
        lastFilePath: filePath,
        lastSaved: universe.localFile?.lastSaved || null
      },
      ...(shouldPromoteLocal ? { sourceOfTruth: SOURCE_OF_TRUTH.LOCAL } : {})
    });

    this.notifyStatus('success', `Linked local file to ${universe.name || universeSlug}`);
    return { success: true, filePath };
  }

  /**
   * Remove linked local file from a universe
   */
  async removeLocalFileLink(universeSlug) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const universe = this.getUniverse(universeSlug);
    if (!universe) {
      throw new Error(`Universe ${universeSlug} not found`);
    }

    this.fileHandles.delete(universeSlug);

    try {
      await removeFileHandleMetadata(universeSlug);
      umLog(`[UniverseBackend] Removed file handle metadata for ${universeSlug}`);
    } catch (error) {
      umWarn(`[UniverseBackend] Failed to remove file handle metadata:`, error);
    }

    const updates = {
      localFile: {
        ...universe.localFile,
        enabled: false,
        hadFileHandle: false,
        displayPath: null,
        lastFilePath: null,
        lastSaved: null,
        fileHandleStatus: 'disconnected',
        unavailableReason: 'Local file unlinked'
      }
    };

    if (universe.sourceOfTruth === SOURCE_OF_TRUTH.LOCAL) {
      if (universe.gitRepo?.enabled && universe.gitRepo?.linkedRepo) {
        updates.sourceOfTruth = SOURCE_OF_TRUTH.GIT;
      } else {
        updates.sourceOfTruth = SOURCE_OF_TRUTH.BROWSER;
      }
    }

    await this.updateUniverse(universeSlug, updates);
    this.saveToStorage();
    this.notifyStatus('info', `Unlinked local file from ${universe.name || universeSlug}`);
    return { success: true };
  }

  /**
   * Upload and import a local .redstring file to a universe
   */
  async uploadLocalFile(file, targetUniverseSlug) {
    await this.initialize();

    if (!file || !file.name) {
      throw new Error('Please select a file to import');
    }

    if (!file.name.endsWith('.redstring')) {
      umWarn(`[UniverseBackend] Importing non-.redstring file: ${file.name}`);
    }

    umLog(`[UniverseBackend] Uploading local file ${file.name} to universe ${targetUniverseSlug}`);

    // Read the file content
    const fileContent = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });

    // Parse and import the redstring data
    let storeState;
    try {
      const parsedData = JSON.parse(fileContent);
      storeState = importFromRedstring(parsedData);
    } catch (error) {
      throw new Error(`Invalid .redstring file format: ${error.message}`);
    }

    // Load the imported data into the target universe
    if (this.storeOperations?.loadUniverseFromFile) {
      // Switch to target universe first if needed
      const currentActiveSlug = this.getActiveUniverse()?.slug;
      if (currentActiveSlug !== targetUniverseSlug) {
        await this.switchActiveUniverse(targetUniverseSlug);
      }

      // Load the imported state
      this.storeOperations.loadUniverseFromFile(storeState);

      // DON'T enable local file storage yet - we don't have a persistent handle
      // Just track that we imported from this file (informational only)
      await this.updateUniverse(targetUniverseSlug, {
        localFile: {
          ...this.getUniverse(targetUniverseSlug)?.localFile,
          enabled: false,  // NOT enabled until we have an actual handle
          pendingConnect: true, // Flag that a handle is needed
          displayPath: file.path || file.name,
          lastImportedFile: file.name
        }
      });


      const nodeCount = storeState?.nodePrototypes ?
        (storeState.nodePrototypes instanceof Map ? storeState.nodePrototypes.size : Object.keys(storeState.nodePrototypes || {}).length) : 0;

      // Note: File input gives us a one-time File object, not a persistent FileSystemFileHandle
      // User needs to use "Pick File" or "Save As" to establish persistent file connection for auto-save
      umLog(`[UniverseBackend] File imported. To enable auto-save, use "Pick File" to establish persistent connection.`);

      this.notifyStatus('success', `Imported ${file.name} with ${nodeCount} nodes. Use "Pick File" to enable auto-save.`);

      return { success: true, nodeCount, fileName: file.name, needsFileHandle: true };
    } else {
      throw new Error('Store operations not initialized');
    }
  }

  /**
   * Set the source of truth for a universe (git or local)
   */
  async setSourceOfTruth(universeSlug, sourceType) {
    await this.initialize();

    const universe = this.getUniverse(universeSlug);
    if (!universe) {
      throw new Error(`Universe ${universeSlug} not found`);
    }

    umLog('[UniverseBackend] setSourceOfTruth - universe structure:', {
      hasRaw: !!universe.raw,
      hasGitRepo: !!universe.gitRepo,
      hasRawGitRepo: !!universe.raw?.gitRepo,
      rawGitRepoEnabled: universe.raw?.gitRepo?.enabled,
      gitRepoEnabled: universe.gitRepo?.enabled,
      hasLinkedRepo: !!universe.gitRepo?.linkedRepo,
      hasRawLinkedRepo: !!universe.raw?.gitRepo?.linkedRepo,
      linkedRepo: universe.gitRepo?.linkedRepo,
      rawLinkedRepo: universe.raw?.gitRepo?.linkedRepo
    });

    // Validate source type
    if (sourceType !== 'git' && sourceType !== 'local') {
      throw new Error('Source type must be "git" or "local"');
    }

    // Check if the requested source is available - check both universe and universe.raw
    const hasGitRepo = universe.gitRepo?.linkedRepo || universe.raw?.gitRepo?.linkedRepo;
    if (sourceType === 'git' && !hasGitRepo) {
      throw new Error('Cannot set git as source of truth - no repository linked');
    }

    const localConfig = universe.raw?.localFile || universe.localFile || {};
    if (sourceType === 'local' && !localConfig.enabled) {
      throw new Error('Cannot set local as source of truth - local storage slot is disabled');
    }

    // ── Pre-swap migration: save current data TO the new source before flipping ──
    // This prevents data loss when the new source is empty (e.g. newly linked Git repo).
    const oldSource = universe.sourceOfTruth || universe.raw?.sourceOfTruth;
    if (oldSource && oldSource !== sourceType && this.storeOperations?.getState) {
      const currentState = this.storeOperations.getState();
      const { nodeCount, graphCount } = this.analyzeStoreData(currentState);
      const hasData = nodeCount > 0 || graphCount > 0;

      if (hasData) {
        umLog('[UniverseBackend] Pre-swap migration: saving current data to new source before switching', {
          from: oldSource, to: sourceType, nodeCount, graphCount
        });

        try {
          if (sourceType === 'git') {
            // Switching local → git: push current data to Git first
            let engine = this.gitSyncEngines.get(universeSlug) || null;
            if (!engine) {
              engine = await this.ensureGitSyncEngine(universeSlug);
            }
            if (engine) {
              await engine.forceCommit(currentState);
              umLog('[UniverseBackend] Pre-swap migration: successfully saved current data to Git');
            } else {
              umWarn('[UniverseBackend] Pre-swap migration: no Git engine available, skipping Git save');
            }
          } else if (sourceType === 'local') {
            // Switching git → local: save current data to local file first
            await this.saveToLinkedLocalFile(universeSlug, currentState, { suppressNotification: true });
            umLog('[UniverseBackend] Pre-swap migration: successfully saved current data to local file');
          }
        } catch (migrationErr) {
          umWarn('[UniverseBackend] Pre-swap migration failed (proceeding with swap anyway):', migrationErr);
          // Don't block the swap — the user explicitly chose to switch.
          // But the data is preserved in the old source still.
        }
      } else {
        umLog('[UniverseBackend] Pre-swap migration: current state is empty, no migration needed');
      }
    }

    // Update the universe configuration
    await this.updateUniverse(universeSlug, {
      sourceOfTruth: sourceType
    });
    this.authStatus = persistentAuth.getAuthStatus();
    const updatedUniverse = this.getUniverse(universeSlug);
    umLog('[UniverseBackend] Source of truth updated:', {
      slug: universeSlug,
      sourceType,
      storedSource: updatedUniverse?.sourceOfTruth,
      rawSource: updatedUniverse?.raw?.sourceOfTruth,
      authStatus: this.authStatus,
      timestamp: new Date().toISOString()
    });

    // Ensure Git engine state aligns with the new source of truth
    try {
      let engine = this.gitSyncEngines.get(universeSlug) || null;

      if (sourceType === 'git' && hasGitRepo && !engine) {
        // If Git just became primary and no engine exists yet, create it
        try {
          engine = await this.ensureGitSyncEngine(universeSlug);
        } catch (engineErr) {
          umWarn('[UniverseBackend] Failed to ensure Git engine after source-of-truth switch to git:', engineErr);
        }
      }

      if (engine && typeof engine.setSourceOfTruth === 'function') {
        try {
          engine.setSourceOfTruth(sourceType === 'git' ? SOURCE_OF_TRUTH.GIT : SOURCE_OF_TRUTH.LOCAL);
        } catch (modeErr) {
          umWarn('[UniverseBackend] Failed to set Git engine source-of-truth mode:', modeErr);
        }
      }
    } catch (syncAlignErr) {
      umWarn('[UniverseBackend] Engine alignment after source-of-truth change failed:', syncAlignErr);
    }

    this.notifyStatus('success', `Set ${sourceType === 'git' ? 'repository' : 'local file'} as primary source for ${universe.name || universeSlug}`);

    if (sourceType === 'local' && !localConfig.hadFileHandle) {
      this.notifyStatus('warning', 'Local file is primary but no persistent file handle is linked. Use "Pick File" to enable auto-save.');
    }

    if (this.pendingConflict?.universeSlug === universeSlug) {
      this.pendingConflict = null;
    }
    this.pendingPrimarySelection.delete(universeSlug);

    return { success: true, sourceOfTruth: sourceType };
  }

  /**
   * Update git operation status for a universe
   */
  updateGitOperationStatus(universeSlug, status) {
    const timestamp = Date.now();
    const existingStatus = this.gitOperationStatus.get(universeSlug) || {};

    const newStatus = {
      ...existingStatus,
      ...status,
      lastUpdated: timestamp,
      universeSlug
    };

    this.gitOperationStatus.set(universeSlug, newStatus);

    // Update global status
    this.updateGlobalGitStatus();

    // Notify status handlers
    this.notifyGitStatus(universeSlug, newStatus);
  }

  /**
   * Update global git status summary
   */
  updateGlobalGitStatus() {
    const allStatuses = Array.from(this.gitOperationStatus.values());
    const connectedUniverses = allStatuses.filter(s => s.isConnected);
    const syncedUniverses = allStatuses.filter(s => s.isSynced && !s.hasUnsavedChanges);
    const pendingOps = allStatuses.filter(s => s.isOperationInProgress).length;

    this.globalGitStatus = {
      ...this.globalGitStatus,
      isConnected: this.authStatus?.isAuthenticated || false,
      totalUniverses: allStatuses.length,
      syncedUniverses: syncedUniverses.length,
      pendingOperations: pendingOps,
      lastGlobalSync: Math.max(...allStatuses.map(s => s.lastSyncTime || 0), 0) || null
    };
  }

  /**
   * Get comprehensive git status for dashboard
   */
  getGitStatusDashboard() {
    return {
      global: this.globalGitStatus,
      universes: Object.fromEntries(this.gitOperationStatus),
      timestamp: Date.now()
    };
  }

  /**
   * Get git status for a specific universe
   */
  getUniverseGitStatus(universeSlug) {
    return this.gitOperationStatus.get(universeSlug) || {
      universeSlug,
      isConnected: false,
      isSynced: false,
      isOperationInProgress: false,
      hasUnsavedChanges: true,
      lastSyncTime: null,
      lastSaveAttempt: null,
      currentOperation: null,
      error: null,
      fileName: `universes/${universeSlug}/${universeSlug}.redstring`,
      commitCount: 0,
      lastCommitHash: null
    };
  }

  /**
   * Track start of git operation
   */
  trackGitOperationStart(universeSlug, operation, details = {}) {
    umLog(`[UniverseBackend] Starting ${operation} for ${universeSlug}`);
    this.updateGitOperationStatus(universeSlug, {
      isOperationInProgress: true,
      currentOperation: operation,
      operationStartTime: Date.now(),
      lastSaveAttempt: Date.now(),
      error: null,
      ...details
    });
  }

  /**
   * Track completion of git operation
   */
  trackGitOperationComplete(universeSlug, operation, success, details = {}) {
    const timestamp = Date.now();
    const status = this.getUniverseGitStatus(universeSlug);
    const duration = status.operationStartTime ? timestamp - status.operationStartTime : null;

    umLog(`[UniverseBackend] ${success ? 'Completed' : 'Failed'} ${operation} for ${universeSlug} ${duration ? `in ${duration}ms` : ''}`);

    this.updateGitOperationStatus(universeSlug, {
      isOperationInProgress: false,
      currentOperation: null,
      operationStartTime: null,
      lastSyncTime: success ? timestamp : status.lastSyncTime,
      isSynced: success,
      hasUnsavedChanges: !success,
      error: success ? null : details.error,
      commitCount: success ? (status.commitCount || 0) + 1 : status.commitCount,
      lastCommitHash: details.commitHash || status.lastCommitHash,
      operationDuration: duration,
      ...details
    });
  }

  /**
   * Event system for git status updates
   */
  notifyGitStatus(universeSlug, status) {
    this.statusHandlers.forEach(handler => {
      try {
        handler({
          type: 'git-status',
          universeSlug,
          status,
          global: this.globalGitStatus
        });
      } catch (error) {
        umWarn('[UniverseBackend] Git status handler error:', error);
      }
    });
  }

  /**
   * Event system for status updates
   */
  onStatusChange(handler) {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  notifyStatus(type, message) {
    this.statusHandlers.forEach(handler => {
      try {
        handler({ type, status: message });
      } catch (error) {
        umWarn('[UniverseBackend] Status handler error:', error);
      }
    });
  }

  /**
   * Cleanup - stop all engines
   */
  async cleanup() {
    umLog('[UniverseBackend] Cleaning up backend service...');

    for (const [slug, engine] of this.gitSyncEngines) {
      try {
        engine.stop();
      } catch (error) {
        umWarn(`[UniverseBackend] Failed to stop engine for ${slug}:`, error);
      }
    }

    this.gitSyncEngines.clear();
    this.statusHandlers.clear();
    this.isInitialized = false;
  }
}

// Export singleton instance
export const universeBackend = new UniverseBackend();
export default universeBackend;
