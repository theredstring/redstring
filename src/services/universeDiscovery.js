/**
 * Universe Discovery
 *
 * Finding the .redstring files in a Git repository, and counting what's inside
 * them, are two very different costs:
 *
 *   listUniverseFiles      - directory listings only. A handful of requests,
 *                            no file contents. Cheap enough to run on every
 *                            panel open. GitHub returns each file's blob `sha`
 *                            here for free.
 *   hydrateUniverseCounts  - reads files to count webs/things/connections.
 *                            A full download per file, so it is gated on that
 *                            sha: content we've already read is never fetched
 *                            twice.
 *
 * Split out of universeBackend so both halves can be exercised directly.
 */

import { getRedstringStats } from '../formats/redstringFormat.js';
import repoDiscoveryCache from './repoDiscoveryCache.js';

const { warn: __udNativeWarn } = console;
const udWarn = (...args) => __udNativeWarn.call(console, '[UniverseDiscovery]', ...args);

export const extractSchemaPath = (filePath) => {
  const parts = (filePath || '').split('/').filter(Boolean);
  if (parts.length <= 1) {
    const fileBase = parts[parts.length - 1] || '';
    return fileBase.replace(/\.redstring$/i, '') || 'default';
  }
  parts.pop(); // Remove filename
  const folder = parts.pop();
  return folder || 'default';
};

export const createUniverseConfigFromDiscovered = (discoveredUniverse, repoConfig) => {
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

/**
 * Phase 1 of discovery: find the .redstring files. Listing only — no file
 * contents are downloaded here, so this stays cheap enough to run on every
 * panel open. GitHub hands back each file's blob `sha` for free, which is what
 * phase 2 uses to skip downloads.
 */
export const listUniverseFiles = async (provider) => {
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
        stats.valid += 1;
        const base = item.name.replace(/\.redstring$/i, '');
        const itemPath = normalizePathValue(item.path) || joinPaths(safeDirPath, item.name);
        universes.push({
          name: base,
          slug: base,
          path: itemPath,
          fileName: item.name,
          sha: item.sha || null,
          size: typeof item.size === 'number' ? item.size : null,
          metadata: {}
        });
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
            sha: item.sha || null,
            size: typeof item.size === 'number' ? item.size : null,
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

const COUNT_KEYS = ['nodeCount', 'graphCount', 'connectionCount', 'instanceCount'];

/**
 * Attach counts to a listed file. Mirrored flat + nested because some selectors
 * read `file.nodeCount` and others `file.metadata.nodeCount` — writing only the
 * nested copy is why the import list rendered no counts at all.
 */
export const withCounts = (file, counts) => {
  const next = { ...file, metadata: { ...file.metadata } };
  for (const key of COUNT_KEYS) {
    if (counts?.[key] != null) {
      next[key] = counts[key];
      next.metadata[key] = counts[key];
    }
  }
  return next;
};

/**
 * Phase 2 of discovery: fill in webs/things/connections.
 *
 * Only files whose blob sha we've never read get downloaded — everything else
 * comes straight from the cache. A user who opens the panel repeatedly without
 * changing anything pays zero downloads after the first pass.
 *
 * `onProgress` fires after each file resolves so the UI can replace "?" one row
 * at a time rather than waiting for the whole batch.
 */
export const hydrateUniverseCounts = async (provider, repoConfig, files, onProgress) => {
  const { user, repo } = repoConfig;
  const resolved = [...files];
  let downloads = 0;
  let cacheHits = 0;

  for (let i = 0; i < resolved.length; i += 1) {
    const file = resolved[i];

    const cached = repoDiscoveryCache.getCountsForSha(user, repo, file.path, file.sha);
    if (cached) {
      cacheHits += 1;
      resolved[i] = withCounts(file, cached);
      onProgress?.(resolved, { done: i + 1, total: resolved.length });
      continue;
    }

    try {
      const content = await provider.readFileRaw(file.path);
      downloads += 1;
      const counts = getRedstringStats(JSON.parse(content));
      resolved[i] = withCounts(file, counts);
      // No sha means no safe cache key (the root-scan fallback can hit this) —
      // counts still display, they just aren't reused next time.
      if (file.sha) {
        repoDiscoveryCache.setCountsForSha(user, repo, file.path, file.sha, counts);
      }
    } catch (error) {
      // Unreadable or unparseable: leave counts absent so the UI shows "?"
      // rather than claiming zero.
      udWarn(`Could not read counts for ${file.path}:`, error?.message || error);
    }

    onProgress?.(resolved, { done: i + 1, total: resolved.length });
  }

  repoDiscoveryCache.flush();
  return { files: resolved, downloads, cacheHits };
};
