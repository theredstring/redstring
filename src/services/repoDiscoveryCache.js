/**
 * Repository Discovery Cache
 *
 * Universe discovery costs two very different things:
 *   - Listing directories (cheap: a few requests, and GitHub hands back the
 *     blob `sha` for every file for free).
 *   - Reading each .redstring file to count its webs/things/connections
 *     (expensive: a full file download each).
 *
 * This module makes the second cost disappear on repeat visits. Counts are
 * keyed by the file's blob sha — a content hash — so an unchanged file is never
 * downloaded twice, and a changed file invalidates itself with no TTL guessing.
 *
 * It also holds the discovery RESULTS, so the repository list paints instantly
 * from cache on mount instead of starting empty behind a spinner. Discovery
 * state used to live in `useState` inside UniverseManager, which meant it died
 * on every unmount and every panel open began with nothing on screen.
 *
 * Module-level state: survives component unmount, shared by the backend (which
 * writes) and the UI (which reads + subscribes).
 */

import { storageWrapper } from '../utils/storageWrapper.js';

const STORAGE_KEY = 'redstring-repo-discovery-cache';
const STORAGE_VERSION = 1;

// Bound the persisted payload. Counts are tiny, but a user with many repos over
// a long time shouldn't grow this without limit.
const MAX_REPOS = 50;
const MAX_FILES_PER_REPO = 100;

/**
 * repoKey ("owner/name") -> {
 *   items: Array<discoveredUniverse>,   // last known file list, counts included
 *   lastScanned: number|null,           // ms epoch of last successful listing
 *   error: string|null,                 // last failure, kept ALONGSIDE items
 *   loading: boolean                    // transient, never persisted
 * }
 */
const repos = new Map();

/** `${repoKey}::${path}::${sha}` -> { nodeCount, graphCount, connectionCount, instanceCount } */
const countsBySha = new Map();

const subscribers = new Set();

let hydrated = false;

// Accepts either ('owner', 'name') or a single 'owner/name' key. Returns null
// for anything unusable so callers with a partially-built repo object read as
// "unknown" instead of poisoning the cache with an "undefined/undefined" entry.
const normalizeKey = (user, repo) => {
  if (repo === undefined) return typeof user === 'string' && user.includes('/') ? user : null;
  if (!user || !repo) return null;
  return `${user}/${repo}`;
};

const shaKey = (repoKey, path, sha) => `${repoKey}::${path}::${sha}`;

function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = storageWrapper.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STORAGE_VERSION) return;

    for (const [repoKey, entry] of Object.entries(parsed.repos || {})) {
      repos.set(repoKey, {
        items: Array.isArray(entry.items) ? entry.items : [],
        lastScanned: entry.lastScanned || null,
        // A persisted error is stale by definition — the next scan decides.
        error: null,
        loading: false
      });
    }
    for (const [key, counts] of Object.entries(parsed.counts || {})) {
      countsBySha.set(key, counts);
    }
  } catch (error) {
    console.warn('[RepoDiscoveryCache] Failed to hydrate cache:', error);
  }
}

function persist() {
  try {
    const repoEntries = Array.from(repos.entries())
      .sort((a, b) => (b[1].lastScanned || 0) - (a[1].lastScanned || 0))
      .slice(0, MAX_REPOS);

    const serializedRepos = {};
    const liveShaKeys = new Set();

    for (const [repoKey, entry] of repoEntries) {
      const items = (entry.items || []).slice(0, MAX_FILES_PER_REPO);
      serializedRepos[repoKey] = {
        items,
        lastScanned: entry.lastScanned || null
      };
      for (const item of items) {
        if (item?.sha && item?.path) liveShaKeys.add(shaKey(repoKey, item.path, item.sha));
      }
    }

    // Only keep counts still reachable from a listed file — this is what stops
    // the sha map from accumulating an entry per historical file version.
    const serializedCounts = {};
    for (const key of liveShaKeys) {
      const counts = countsBySha.get(key);
      if (counts) serializedCounts[key] = counts;
    }

    storageWrapper.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      repos: serializedRepos,
      counts: serializedCounts
    }));
  } catch (error) {
    console.warn('[RepoDiscoveryCache] Failed to persist cache:', error);
  }
}

function notify(repoKey) {
  for (const fn of subscribers) {
    try {
      fn(repoKey, getRepoEntry(repoKey));
    } catch (error) {
      console.warn('[RepoDiscoveryCache] Subscriber threw:', error);
    }
  }
}

/**
 * Read a repo's last-known discovery result. Synchronous and safe to call
 * during render — this is what lets the list paint before any network work.
 */
export function getRepoEntry(user, repo) {
  hydrateFromStorage();
  const key = normalizeKey(user, repo);
  const entry = key ? repos.get(key) : null;
  if (!entry) return { items: [], lastScanned: null, error: null, loading: false };
  return { ...entry, items: entry.items || [] };
}

/** Every cached repo, as a plain `{ repoKey: entry }` map. */
export function getAllRepoEntries() {
  hydrateFromStorage();
  const out = {};
  for (const key of repos.keys()) out[key] = getRepoEntry(key);
  return out;
}

/** Mark a scan as in-flight without disturbing the items already on screen. */
export function markLoading(user, repo, loading = true) {
  hydrateFromStorage();
  const key = normalizeKey(user, repo);
  if (!key) return;
  const entry = repos.get(key) || { items: [], lastScanned: null, error: null };
  repos.set(key, { ...entry, loading, ...(loading ? { error: null } : {}) });
  notify(key);
}

/**
 * Store a scan result. `error` is recorded alongside the items rather than
 * replacing them: a rate-limited or unauthorized scan should leave the last
 * known list on screen with a staleness marker, not blank it to something that
 * reads as "this repository is empty".
 */
export function setRepoItems(user, repo, items, { error = null, scanned = true } = {}) {
  hydrateFromStorage();
  const key = normalizeKey(user, repo);
  if (!key) return;
  const previous = repos.get(key) || { items: [], lastScanned: null };
  const nextItems = Array.isArray(items) ? items : previous.items || [];

  repos.set(key, {
    items: nextItems,
    lastScanned: scanned && !error ? Date.now() : previous.lastScanned || null,
    error: error || null,
    loading: false
  });

  persist();
  notify(key);
}

/** Forget a repo entirely (used when a repo is removed from the list). */
export function forgetRepo(user, repo) {
  hydrateFromStorage();
  const key = normalizeKey(user, repo);
  if (!key || !repos.delete(key)) return;
  for (const cacheKey of Array.from(countsBySha.keys())) {
    if (cacheKey.startsWith(`${key}::`)) countsBySha.delete(cacheKey);
  }
  persist();
  notify(key);
}

/**
 * Counts for a file at a specific content sha, or null if we've never read
 * that exact content. A null here is the ONLY reason to download the file.
 */
export function getCountsForSha(user, repo, path, sha) {
  hydrateFromStorage();
  const key = normalizeKey(user, repo);
  if (!key || !sha || !path) return null;
  return countsBySha.get(shaKey(key, path, sha)) || null;
}

export function setCountsForSha(user, repo, path, sha, counts) {
  hydrateFromStorage();
  const key = normalizeKey(user, repo);
  if (!key || !sha || !path || !counts) return;
  countsBySha.set(shaKey(key, path, sha), counts);
}

/**
 * Subscribe to cache changes. Returns an unsubscribe function.
 * Callback signature: (repoKey, entry) => void
 */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Flush pending count writes to storage (called after a hydration pass). */
export function flush() {
  persist();
}

export default {
  getRepoEntry,
  getAllRepoEntries,
  markLoading,
  setRepoItems,
  forgetRepo,
  getCountsForSha,
  setCountsForSha,
  subscribe,
  flush
};
