/**
 * Onboarding storage-slot operations.
 *
 * A universe is a single shell with fillable storage slots (a Git repository
 * slot and a local .redstring file slot) plus a source-of-truth pointer —
 * exactly what the Universes panel renders (UniversesList storage slots). The
 * onboarding wizard fills those slots on ONE universe rather than creating a
 * separate universe per storage type.
 *
 * - ensureUniverse()   — create the browser-backed shell once (idempotent via
 *                        reuseSlug); subsequent slot fills attach to it.
 * - fillGitSlot()      — repo → attach → push → promote git (source of truth).
 * - addLocalFileSlot() — link a local .redstring file to the same universe.
 * - openRepoUniverse() — open a universe already in a repo (no push); its
 *                        slug then takes the local-file slot like any other.
 *
 * Safety: git is only promoted to source of truth after a successful initial
 * push — a failed push leaves the universe browser-backed with the repo
 * linked, so an empty repo can never become primary and clobber data.
 * linkLocalFileToUniverse promotes local only when no git link exists, so the
 * two slots compose without one clobbering the other's source-of-truth.
 */
import universeManagerService, { STORAGE_TYPES } from './universeManagerService.js';
import universeBackend from './universeBackend.js';
import universeBackendBridge from './universeBackendBridge.js';
import { createRepository } from './githubRepoService.js';
import { getStorageKey } from '../utils/storageUtils.js';
import { buildUniqueUniverseName } from '../utils/universeNaming.js';
import { isElectron } from '../utils/fileAccessAdapter.js';

const { warn: __nativeWarn } = console;
const goWarn = (...args) => __nativeWarn.call(console, '[GitOnboarding]', ...args);

/**
 * Resolve a local .redstring file handle for the local-file slot. MUST be
 * called from within a user gesture (button click) — the browser requires
 * transient activation for showSaveFilePicker, and any awaited work would
 * otherwise consume it. Tries the linked workspace folder first (no picker),
 * then falls back to a save dialog. Returns the handle/path, or null if none
 * could be obtained.
 */
export async function resolveLocalFileHandle(universeName) {
  const suggestedName = `${(universeName || 'Universe').trim() || 'Universe'}.redstring`;
  try {
    const { createFileInWorkspace } = await import('./workspaceFolderService.js');
    const { exportToRedstring } = await import('../formats/redstringFormat.js');
    const emptyState = {
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const defaultContent = JSON.stringify(exportToRedstring(emptyState), null, 2);

    // Workspace folder path needs no picker/gesture.
    const inWorkspace = await createFileInWorkspace(suggestedName, defaultContent, { overwrite: false });
    if (inWorkspace) return inWorkspace;

    // No workspace folder — prompt for a location (needs the caller's gesture).
    const { pickSaveLocation, writeFile } = await import('../utils/fileAccessAdapter.js');
    const picked = await pickSaveLocation({ suggestedName });
    if (picked) {
      await writeFile(picked, defaultContent);
      return picked;
    }
  } catch (err) {
    goWarn('Could not resolve a local file location:', err?.message || err);
  }
  return null;
}

/**
 * Create the onboarding universe shell once (browser-backed until a slot's
 * push/link promotes it). Idempotent: given a reuseSlug for an existing
 * universe, returns it without creating a duplicate.
 * @returns {Promise<string>} the universe slug
 */
export async function ensureUniverse(universeName, reuseSlug = null) {
  if (reuseSlug && universeBackend.getUniverse?.(reuseSlug)) {
    return reuseSlug;
  }
  const creationResult = await universeManagerService.createUniverse(universeName, {
    enableLocal: false,
    enableGit: false,
    sourceOfTruth: 'browser'
  });
  const slug = creationResult?.createdUniverse?.slug
    || (creationResult?.universes || []).find((u) => u.name === universeName)?.slug;
  if (!slug) {
    throw new Error('Unable to determine universe slug after creation');
  }
  return slug;
}

export const GIT_ONBOARDING_TASKS = [
  { id: 'repo', label: 'Set up repository' },
  { id: 'universe', label: 'Create universe' },
  { id: 'attach', label: 'Link repository' },
  { id: 'push', label: 'Push initial data' },
  { id: 'promote', label: 'Make GitHub the source of truth' }
];

/**
 * Fill the GitHub repository slot on the onboarding universe.
 *
 * @param {object} opts
 * @param {'create'|'existing'} opts.repoChoice
 * @param {string} [opts.repoName]        — for 'create'
 * @param {boolean} [opts.isPrivate]      — for 'create' (default true)
 * @param {object} [opts.existingRepo]    — GitHub repo object for 'existing'
 * @param {string} opts.universeName
 * @param {'oauth'|'github-app'} [opts.authMethod]
 * @param {string} [opts.reuseSlug]       — slug from a prior attempt; skips re-creating the universe
 * @param {(taskId: string, status: 'running'|'done'|'warning'|'error', detail?: string) => void} [opts.onProgress]
 * @returns {Promise<{ slug: string, owner: string, repo: string, warnings: string[] }>}
 *   Errors thrown after universe creation carry `.slug` so callers can retry without duplicating universes.
 */
export async function fillGitSlot({
  repoChoice,
  repoName,
  isPrivate = true,
  existingRepo,
  universeName,
  authMethod = 'oauth',
  reuseSlug = null,
  onProgress = () => {}
}) {
  const warnings = [];

  // 1. Repository
  onProgress('repo', 'running');
  let owner;
  let repo;
  if (repoChoice === 'create') {
    const { repo: created, existed } = await createRepository({ name: repoName, isPrivate });
    owner = created.owner?.login || created.owner?.name;
    repo = created.name;
    onProgress('repo', 'done', existed
      ? `Repository already existed — linking @${owner}/${repo}`
      : `Created @${owner}/${repo}`);
  } else {
    owner = existingRepo?.owner?.login || existingRepo?.owner?.name || existingRepo?.owner
      || existingRepo?.full_name?.split('/')[0];
    repo = existingRepo?.name || existingRepo?.full_name?.split('/').pop();
    if (!owner || !repo) {
      onProgress('repo', 'error', 'Selected repository is missing owner/name metadata.');
      throw new Error('Selected repository is missing owner/name metadata.');
    }
    onProgress('repo', 'done', `Using @${owner}/${repo}`);
  }

  // 2. Universe shell (browser-backed until the push succeeds). Reused across
  // slot fills so the local-file slot lands on the same universe.
  onProgress('universe', 'running');
  const slug = await ensureUniverse(universeName, reuseSlug);
  onProgress('universe', 'done', universeName);

  // 3. Attach the repo to the universe
  onProgress('attach', 'running');
  try {
    await universeManagerService.attachGitRepository(slug, {
      user: owner,
      repo,
      authMethod,
      universeFolder: slug,
      universeFile: `${slug}.redstring`
    });
  } catch (attachErr) {
    attachErr.slug = slug;
    onProgress('attach', 'error', attachErr.message);
    throw attachErr;
  }
  onProgress('attach', 'done');

  // 4. Initial push. On failure we deliberately do NOT promote git.
  let pushOk = false;
  onProgress('push', 'running');
  try {
    await universeManagerService.forceSave(slug);
    pushOk = true;
    onProgress('push', 'done');
  } catch (pushErr) {
    goWarn('Initial push failed:', pushErr);
    const msg = `Initial push failed: ${pushErr.message}. Redstring will retry on the next save.`;
    warnings.push(msg);
    onProgress('push', 'warning', msg);
  }

  // 5. Promote git to source of truth — only over a repo that has the data.
  if (pushOk) {
    onProgress('promote', 'running');
    try {
      await universeManagerService.setPrimaryStorage(slug, STORAGE_TYPES.GIT);
      onProgress('promote', 'done');
    } catch (promoteErr) {
      goWarn('Failed to promote git to source of truth:', promoteErr);
      const msg = `Could not make GitHub the source of truth: ${promoteErr.message}`;
      warnings.push(msg);
      onProgress('promote', 'warning', msg);
    }
  } else {
    const msg = 'GitHub not promoted to source of truth yet (initial push pending).';
    warnings.push(msg);
    onProgress('promote', 'warning', msg);
  }

  return { slug, owner, repo, warnings };
}

export const OPEN_REPO_TASKS = [
  { id: 'universe', label: 'Create universe' },
  { id: 'attach', label: 'Link repository' },
  { id: 'load', label: 'Load from GitHub' }
];

/** Remember a repository in the Universes panel's list (read there on mount). */
export function rememberManagedRepository({ user, repo }) {
  const key = getStorageKey('redstring-managed-repositories');
  const repoKey = `${user}/${repo}`;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch { list = []; }
  if (list.some((r) => `${r.owner?.login || r.owner}/${r.name}` === repoKey)) return list;
  const next = [...list, {
    name: repo,
    owner: { login: user },
    full_name: repoKey,
    html_url: `https://github.com/${user}/${repo}`,
    id: `discovered-${user}-${repo}`
  }];
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* list is a convenience */ }
  return next;
}

/**
 * Open a universe that already lives in a repository: a new Git-only universe
 * pointed at the discovered file, loaded from GitHub. Never overwrites the
 * active universe, and never pushes — the repo is the data.
 *
 * Shared by the Universes panel's "Load from Repo" and onboarding's
 * Open an Existing Universe → Repository.
 *
 * @param {object} opts
 * @param {object} opts.discovered   — from universeManagerService.discoverUniverses
 * @param {{ user: string, repo: string }} opts.repo
 * @param {'oauth'|'github-app'} [opts.authMethod]
 * @param {Array} [opts.universes]   — existing universes, for the (2), (3) name dedup
 * @param {(taskId: string, status: 'running'|'done'|'warning'|'error', detail?: string) => void} [opts.onProgress]
 * @returns {Promise<{ slug: string, name: string }>}
 */
export async function openRepoUniverse({
  discovered,
  repo,
  authMethod = 'oauth',
  universes = null,
  reuseSlug = null,
  onProgress = () => {}
}) {
  onProgress('universe', 'running');
  let slug;
  let name;
  const prior = reuseSlug ? universeBackend.getUniverse?.(reuseSlug) : null;
  if (prior) {
    // A retry after a failed attach or load: the shell from that attempt.
    slug = reuseSlug;
    name = prior.name;
  } else {
    const baseName = (discovered?.fileName || discovered?.name || 'Universe').replace(/\.redstring$/i, '');
    name = buildUniqueUniverseName(baseName, universes || universeBackend.getAllUniverses?.() || []);
    // Git-only: no local slot, so no conflict detection against an empty file.
    const creationResult = await universeManagerService.createUniverse(name, {
      enableGit: true,
      enableLocal: false,
      sourceOfTruth: 'git'
    });
    slug = creationResult?.createdUniverse?.slug
      || creationResult?.slug
      || (creationResult?.universes || []).find((u) => u.name === name)?.slug;
  }
  if (!slug) {
    onProgress('universe', 'error', 'Unable to determine universe slug after creation');
    throw new Error('Unable to determine universe slug after creation');
  }
  onProgress('universe', 'done', name);

  // Where the file sits in the repo: <folder>/<file>.
  const inferredPath = discovered?.path
    || (discovered?.location && discovered?.fileName ? `${discovered.location}/${discovered.fileName}` : null);
  const inferredFile = discovered?.fileName || (inferredPath ? inferredPath.split('/').pop() : null);
  const parts = (inferredPath || '').split('/').filter(Boolean);
  let folder;
  let file;
  if (parts.length >= 3) {
    folder = parts[parts.length - 2];
    file = parts[parts.length - 1];
  } else if (inferredFile) {
    folder = (parts[parts.length - 1] || '').replace(/\.redstring$/i, '') || slug;
    file = inferredFile;
  } else {
    folder = slug;
    file = `${slug}.redstring`;
  }

  onProgress('attach', 'running');
  try {
    await universeManagerService.attachGitRepository(slug, {
      user: repo.user,
      repo: repo.repo,
      authMethod,
      universeFolder: folder || slug,
      universeFile: file || `${slug}.redstring`
    });
  } catch (err) {
    err.slug = slug;
    onProgress('attach', 'error', err.message);
    throw err;
  }
  rememberManagedRepository(repo);
  onProgress('attach', 'done', `@${repo.user}/${repo.repo}`);

  // Force a load from Git. NOT switchUniverse: createUniverse already made
  // this slug active with the empty placeholder, so switchUniverse would
  // early-return ("already active") and the Git data would never come in —
  // until a refresh, by which point the engine may have saved the empty state
  // OVER the repo. reloadUniverse bypasses the activity guard.
  onProgress('load', 'running');
  try {
    await universeBackendBridge.reloadUniverse(slug);
  } catch (err) {
    err.slug = slug;
    onProgress('load', 'error', err.message);
    throw err;
  }
  // reloadUniverse loads but does not set up the sync engine. Start it now,
  // with the real loaded data as its baseline rather than the placeholder.
  try {
    await universeBackend.ensureGitSyncEngine(slug);
  } catch (engineErr) {
    goWarn('Open from repo: engine setup after load failed:', engineErr?.message || engineErr);
  }
  onProgress('load', 'done');

  return { slug, name };
}

/**
 * Fill the local .redstring file slot on the onboarding universe. Attaches to
 * the same universe as the git slot (via reuseSlug) rather than creating a new
 * one. Source of truth is left to linkLocalFileToUniverse: local is promoted
 * only when the universe has no git link, so a git-backed universe keeps git
 * primary and just gains a local copy.
 *
 * @param {object} opts
 * @param {string} opts.universeName
 * @param {FileSystemFileHandle|string} opts.localFileHandle — pre-resolved inside the user gesture
 * @param {string} [opts.reuseSlug]
 * @param {(status: 'running'|'done'|'warning'|'error', detail?: string) => void} [opts.onProgress]
 * @returns {Promise<{ slug: string, warnings: string[] }>}
 */
export async function addLocalFileSlot({
  universeName,
  localFileHandle,
  reuseSlug = null,
  onProgress = () => {}
}) {
  const warnings = [];
  onProgress('running');

  const slug = await ensureUniverse(universeName, reuseSlug);

  try {
    const suggestedName = `${slug}.redstring`;
    const fileHandle = localFileHandle;
    const fileName = isElectron() && typeof fileHandle === 'string'
      ? fileHandle.split(/[/\\]/).pop()
      : (fileHandle?.name || suggestedName);
    const displayPath = isElectron() && typeof fileHandle === 'string' ? fileHandle : fileName;

    await universeBackend.setFileHandle(slug, fileHandle, {
      displayPath,
      fileName,
      suppressNotification: true
    });
    // Records the local slot; promotes local to source of truth only when the
    // universe has no git link (see universeBackend.linkLocalFileToUniverse).
    await universeBackend.linkLocalFileToUniverse(slug, displayPath, { displayPath });
    // Write real universe content into the file.
    try {
      await universeManagerService.forceSave(slug);
    } catch (saveErr) {
      goWarn('Post-link local save failed:', saveErr);
    }
    onProgress('done', fileName);
  } catch (fileErr) {
    fileErr.slug = slug;
    goWarn('Local file setup failed:', fileErr);
    onProgress('error', `Local file not linked: ${fileErr.message}`);
    throw fileErr;
  }

  return { slug, warnings };
}
