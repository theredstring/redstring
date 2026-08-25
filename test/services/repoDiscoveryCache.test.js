import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Repository Discovery Cache Tests
 *
 * The cache exists so the repository list paints instantly from disk and so an
 * unchanged universe file is never downloaded twice. These tests pin the two
 * behaviors that make that safe:
 *   - counts are keyed by BLOB SHA, so changed content invalidates itself
 *   - a failed scan keeps the last known list on screen instead of blanking it
 */

const store = new Map();

vi.mock('../../src/utils/storageWrapper.js', () => ({
  storageWrapper: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); }
  }
}));

const freshModule = async () => {
  vi.resetModules();
  return import('../../src/services/repoDiscoveryCache.js');
};

describe('repoDiscoveryCache', () => {
  beforeEach(() => {
    store.clear();
  });

  it('returns an empty entry for an unknown repo', async () => {
    const cache = await freshModule();
    expect(cache.getRepoEntry('me', 'nope')).toEqual({
      items: [], lastScanned: null, error: null, loading: false
    });
  });

  it('survives a module reload by rehydrating from storage', async () => {
    const first = await freshModule();
    first.setRepoItems('me', 'repo', [
      { name: 'alpha', path: 'universes/alpha/alpha.redstring', sha: 'sha-1', nodeCount: 5 }
    ]);

    // Simulates the panel unmounting and the app reloading.
    const second = await freshModule();
    const entry = second.getRepoEntry('me', 'repo');
    expect(entry.items).toHaveLength(1);
    expect(entry.items[0].name).toBe('alpha');
    expect(entry.items[0].nodeCount).toBe(5);
  });

  it('returns cached counts only for the exact sha that produced them', async () => {
    const cache = await freshModule();
    const counts = { nodeCount: 18, graphCount: 6, connectionCount: 7 };
    cache.setCountsForSha('me', 'repo', 'universes/a.redstring', 'sha-1', counts);

    expect(cache.getCountsForSha('me', 'repo', 'universes/a.redstring', 'sha-1')).toEqual(counts);
    // File edited upstream -> new sha -> cache miss -> forces a re-read.
    expect(cache.getCountsForSha('me', 'repo', 'universes/a.redstring', 'sha-2')).toBeNull();
    // Different file, same sha key space.
    expect(cache.getCountsForSha('me', 'repo', 'universes/b.redstring', 'sha-1')).toBeNull();
    // Different repo entirely.
    expect(cache.getCountsForSha('other', 'repo', 'universes/a.redstring', 'sha-1')).toBeNull();
  });

  it('persists counts across a reload so an unchanged file is never re-read', async () => {
    const first = await freshModule();
    const counts = { nodeCount: 3, graphCount: 1, connectionCount: 2 };
    first.setCountsForSha('me', 'repo', 'universes/a.redstring', 'sha-1', counts);
    first.setRepoItems('me', 'repo', [{ name: 'a', path: 'universes/a.redstring', sha: 'sha-1' }]);

    const second = await freshModule();
    expect(second.getCountsForSha('me', 'repo', 'universes/a.redstring', 'sha-1')).toEqual(counts);
  });

  it('drops counts for files no longer listed, so the sha map cannot grow forever', async () => {
    const first = await freshModule();
    first.setCountsForSha('me', 'repo', 'universes/a.redstring', 'old-sha', { nodeCount: 1 });
    first.setCountsForSha('me', 'repo', 'universes/a.redstring', 'new-sha', { nodeCount: 2 });
    // Only the current sha is reachable from the listing.
    first.setRepoItems('me', 'repo', [{ name: 'a', path: 'universes/a.redstring', sha: 'new-sha' }]);

    const second = await freshModule();
    expect(second.getCountsForSha('me', 'repo', 'universes/a.redstring', 'new-sha')).toEqual({ nodeCount: 2 });
    expect(second.getCountsForSha('me', 'repo', 'universes/a.redstring', 'old-sha')).toBeNull();
  });

  it('keeps the last known list when a scan fails', async () => {
    const cache = await freshModule();
    cache.setRepoItems('me', 'repo', [{ name: 'alpha', path: 'universes/alpha.redstring', sha: 'sha-1' }]);
    const scannedAt = cache.getRepoEntry('me', 'repo').lastScanned;

    cache.setRepoItems('me', 'repo', null, { error: 'API rate limit exceeded', scanned: false });

    const entry = cache.getRepoEntry('me', 'repo');
    expect(entry.items).toHaveLength(1);          // NOT blanked to "no universes"
    expect(entry.error).toBe('API rate limit exceeded');
    expect(entry.lastScanned).toBe(scannedAt);    // staleness stays visible
  });

  it('does not clobber items while a refresh is in flight', async () => {
    const cache = await freshModule();
    cache.setRepoItems('me', 'repo', [{ name: 'alpha', path: 'a.redstring', sha: 'sha-1' }]);
    cache.markLoading('me', 'repo', true);

    const entry = cache.getRepoEntry('me', 'repo');
    expect(entry.loading).toBe(true);
    expect(entry.items).toHaveLength(1);
  });

  it('notifies subscribers on write and stops after unsubscribe', async () => {
    const cache = await freshModule();
    const seen = [];
    const unsubscribe = cache.subscribe((repoKey, entry) => seen.push([repoKey, entry.items.length]));

    cache.setRepoItems('me', 'repo', [{ name: 'a', path: 'a.redstring', sha: 's' }]);
    expect(seen).toEqual([['me/repo', 1]]);

    unsubscribe();
    cache.setRepoItems('me', 'repo', []);
    expect(seen).toHaveLength(1);
  });

  it('forgets a repo and its counts when it is removed', async () => {
    const cache = await freshModule();
    cache.setCountsForSha('me', 'repo', 'a.redstring', 'sha-1', { nodeCount: 4 });
    cache.setRepoItems('me', 'repo', [{ name: 'a', path: 'a.redstring', sha: 'sha-1' }]);

    cache.forgetRepo('me/repo');

    expect(cache.getRepoEntry('me', 'repo').items).toEqual([]);
    expect(cache.getCountsForSha('me', 'repo', 'a.redstring', 'sha-1')).toBeNull();
  });

  it('ignores unusable repo keys instead of caching an "undefined/undefined" entry', async () => {
    const cache = await freshModule();

    cache.setRepoItems(undefined, undefined, [{ name: 'ghost', path: 'g.redstring', sha: 's' }]);
    cache.setCountsForSha(null, null, 'g.redstring', 's', { nodeCount: 1 });

    expect(cache.getAllRepoEntries()).toEqual({});
    expect(cache.getRepoEntry(undefined, undefined).items).toEqual([]);
  });

  it('accepts a single "owner/name" key as well as separate args', async () => {
    const cache = await freshModule();
    cache.setRepoItems('me', 'repo', [{ name: 'a', path: 'a.redstring', sha: 's' }]);

    expect(cache.getRepoEntry('me/repo').items).toHaveLength(1);
  });

  it('survives corrupt persisted data without throwing', async () => {
    store.set('redstring-repo-discovery-cache', '{not json');
    const cache = await freshModule();
    expect(cache.getRepoEntry('me', 'repo').items).toEqual([]);
  });
});
