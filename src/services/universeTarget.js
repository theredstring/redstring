/**
 * Universe TARGET identity — which file a universe actually writes.
 *
 * A universe's slug is its identity in the app. The file it writes is a
 * different thing entirely: for git it is
 * `universes/${universeFolder}/${fileBaseName}.redstring`, where
 * `universeFolder` is stored config that may have come from a folder discovered
 * in the repo. `generateUniqueSlug` keeps slugs unique; nothing kept TARGETS
 * unique, so linking a universe to a folder another universe already owned made
 * two writers for one file — each with its own guard state, neither aware of
 * the other. That is how a 2.1 MB universe was overwritten with an empty one.
 *
 * These helpers are pure and live outside universeBackend so both the backend
 * and the sync engine can key their guard state to the file rather than to the
 * slot, and so this is testable without standing up a backend.
 */

import { sanitizeGitFileBaseName } from './gitSyncEngine.js';

/**
 * The repo-relative path a git-backed universe writes.
 *
 * Uses `sanitizeGitFileBaseName` so the key matches the path the engine
 * ACTUALLY writes — the raw configured file name and the sanitized one are the
 * same target, and treating them as two would let the collision back in through
 * a rename.
 */
export function gitUniversePath(universeFolder, universeFile) {
  const folder = String(universeFolder || '').trim() || 'universe';
  return `universes/${folder}/${sanitizeGitFileBaseName(universeFile)}.redstring`;
}

/** Case- and separator-normalized local path, so `./a/b` and `a\b` agree. */
function normalizeLocalPath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

/**
 * A stable key for the file a universe writes, or `null` when it writes none.
 *
 * Git wins when both are configured: `sourceOfTruth: 'git'` universes are the
 * ones that share a remote, and the remote is the one that loses data
 * irrecoverably to another device.
 *
 * @param {Object} universe - Universe config (normalized shape).
 * @returns {string|null} e.g. `git:user/repo:universes/ii/ii.redstring`
 */
export function universeTargetKey(universe) {
  if (!universe || typeof universe !== 'object') return null;

  const git = universe.gitRepo;
  const linked = git?.linkedRepo;
  if (git?.enabled && linked) {
    // linkedRepo is `{user, repo}` in current configs but has been a bare
    // "user/repo" string in older ones.
    const user = typeof linked === 'string' ? linked.split('/')[0] : linked.user;
    const repo = typeof linked === 'string' ? linked.split('/')[1] : linked.repo;
    if (user && repo) {
      const folder = git.universeFolder || universe.slug;
      const file = git.universeFile || `${universe.slug}.redstring`;
      return `git:${user}/${repo}:${gitUniversePath(folder, file)}`;
    }
  }

  const local = universe.localFile;
  if (local?.enabled) {
    const path = local.path || local.displayPath;
    if (path) return `local:${normalizeLocalPath(path)}`;
  }

  return null;
}

/**
 * Find targets claimed by more than one universe.
 *
 * @param {Iterable<Object>} universes
 * @returns {Map<string, string[]>} targetKey → slugs, only where slugs.length > 1
 */
export function findTargetCollisions(universes) {
  const byTarget = new Map();
  for (const universe of universes || []) {
    const key = universeTargetKey(universe);
    if (!key) continue;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(universe.slug);
  }
  const collisions = new Map();
  for (const [key, slugs] of byTarget) {
    if (slugs.length > 1) collisions.set(key, slugs);
  }
  return collisions;
}

/**
 * Pick a universe folder that no OTHER universe already writes.
 *
 * Mirrors `generateUniqueSlug`'s counter loop, but on the folder — the piece
 * that actually decides the path. Linking to a repo folder another universe
 * owns now forks into `ii`, `ii-2`, … instead of silently sharing a file.
 *
 * @param {Object} params
 * @param {string} params.folder - Desired folder (usually discovered in the repo).
 * @param {string} params.file - Configured file name.
 * @param {Object} params.linkedRepo - `{user, repo}`.
 * @param {Iterable<Object>} params.existingUniverses
 * @param {string} [params.selfSlug] - Universe being configured; its own claim
 *   on the target is not a collision (re-linking must be idempotent).
 * @returns {string} A free folder name.
 */
export function resolveUniqueUniverseFolder({
  folder,
  file,
  linkedRepo,
  existingUniverses,
  selfSlug = null
}) {
  const base = String(folder || '').trim() || 'universe';
  const claimed = new Set();
  for (const universe of existingUniverses || []) {
    if (selfSlug && universe.slug === selfSlug) continue;
    const key = universeTargetKey(universe);
    if (key) claimed.add(key);
  }

  const keyFor = (candidateFolder) => universeTargetKey({
    slug: selfSlug || candidateFolder,
    gitRepo: {
      enabled: true,
      linkedRepo,
      universeFolder: candidateFolder,
      universeFile: file
    }
  });

  if (!claimed.has(keyFor(base))) return base;

  let counter = 2;
  let candidate = `${base}-${counter}`;
  while (claimed.has(keyFor(candidate))) {
    counter += 1;
    candidate = `${base}-${counter}`;
  }
  return candidate;
}
