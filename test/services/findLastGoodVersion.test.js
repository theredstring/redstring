/**
 * Finding the last version of a universe that actually held the user's work.
 *
 * This is the recovery primitive behind the restore offer. It has to be both
 * cheap (a universe can be megabytes, and history can be long) and honest — a
 * revision it cannot read is not a candidate, and "I found nothing" must never
 * be confused with "there is nothing".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const storeWith = (n) => {
  const nodePrototypes = new Map([
    ['base-thing-prototype', { id: 'base-thing-prototype', name: 'Thing', definitionGraphIds: [] }]
  ]);
  for (let i = 0; i < n; i++) {
    nodePrototypes.set('p' + i, { id: 'p' + i, name: 'N' + i, color: '#8B0000', definitionGraphIds: [] });
  }
  return {
    graphs: new Map(), nodePrototypes, edges: new Map(),
    openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(), savedGraphIds: new Set()
  };
};

const docWith = (n) => JSON.stringify(exportToRedstring(storeWith(n)));

const universe = {
  slug: 'claude-s-chambers-2',
  name: "Claude's Chambers",
  gitRepo: { enabled: true, linkedRepo: 'grantiguess/Ontologies', universeFolder: 'claude-s-chambers-2', universeFile: 'claude-s-chambers-2.redstring' }
};

/**
 * @param revisions [{sha, date, size, content}] newest first
 */
const makeBackend = (revisions) => {
  const backend = Object.create(UniverseBackend.prototype);
  backend.reads = [];
  backend.notifications = [];
  backend.notifyStatus = (level, message) => backend.notifications.push({ level, message });
  backend.createProviderForUniverse = vi.fn().mockResolvedValue({
    listFileHistory: async () => revisions.map(({ sha, date, size }) => ({ sha, date, size, message: 'Update' })),
    readFileRaw: async (path, { ref } = {}) => {
      backend.reads.push(ref);
      const found = revisions.find((r) => r.sha === ref);
      if (!found || found.content == null) {
        const err = new Error('File not found');
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      return found.content;
    }
  });
  return backend;
};

describe('findLastGoodVersion', () => {
  it('finds the newest revision that holds things, skipping the wipes', async () => {
    // The real incident: two empty revisions on top of the good one.
    const backend = makeBackend([
      { sha: 'd4dc28ce', date: '2026-09-13T03:45:53Z', size: 16488, content: docWith(0) },
      { sha: 'c66c761e', date: '2026-09-12T21:35:29Z', size: 10010, content: docWith(0) },
      { sha: 'c11c2089', date: '2026-09-12T21:16:01Z', size: 6916496, content: docWith(1822) }
    ]);

    const found = await backend.findLastGoodVersion(universe);

    expect(found).toBeTruthy();
    expect(found.sha).toBe('c11c2089');
    expect(found.nodeCount).toBe(1822);
    expect(found.date).toBe('2026-09-12T21:16:01Z');
  });

  it('never opens a revision too small to hold anything', async () => {
    const backend = makeBackend([
      { sha: 'tiny1', date: '2026-09-13T03:45:53Z', size: 400, content: docWith(0) },
      { sha: 'tiny2', date: '2026-09-12T21:35:29Z', size: 900, content: docWith(0) },
      { sha: 'good', date: '2026-09-12T21:16:01Z', size: 6916496, content: docWith(12) }
    ]);

    const found = await backend.findLastGoodVersion(universe);

    expect(found.sha).toBe('good');
    // Size alone ruled the small ones out — only the candidate was downloaded.
    expect(backend.reads).toEqual(['good']);
  });

  it('stops at the first good revision instead of walking the whole history', async () => {
    const backend = makeBackend([
      { sha: 'newest', date: '2026-09-13T03:00:00Z', size: 500000, content: docWith(40) },
      { sha: 'older', date: '2026-09-12T21:16:01Z', size: 6916496, content: docWith(1822) }
    ]);

    const found = await backend.findLastGoodVersion(universe);
    expect(found.sha).toBe('newest');
    expect(backend.reads).toEqual(['newest']);
  });

  it('returns null when every revision is genuinely empty', async () => {
    const backend = makeBackend([
      { sha: 'a', date: '2026-09-13T03:45:53Z', size: 16488, content: docWith(0) },
      { sha: 'b', date: '2026-09-12T21:35:29Z', size: 16488, content: docWith(0) }
    ]);

    await expect(backend.findLastGoodVersion(universe)).resolves.toBe(null);
  });

  it('returns null for a universe with no repository', async () => {
    const backend = makeBackend([]);
    await expect(backend.findLastGoodVersion({ slug: 'local-only' })).resolves.toBe(null);
  });

  it('skips a revision that will not parse rather than offering it', async () => {
    const backend = makeBackend([
      { sha: 'corrupt', date: '2026-09-13T03:45:53Z', size: 900000, content: '{"prototypeSpace": {trunc' },
      { sha: 'good', date: '2026-09-12T21:16:01Z', size: 6916496, content: docWith(7) }
    ]);

    const found = await backend.findLastGoodVersion(universe);
    expect(found.sha).toBe('good');
  });

  it('opens a revision whose size is unknown rather than assuming it is empty', async () => {
    const backend = makeBackend([
      { sha: 'unsized', date: '2026-09-13T03:45:53Z', size: null, content: docWith(3) }
    ]);

    const found = await backend.findLastGoodVersion(universe);
    expect(found.sha).toBe('unsized');
    expect(found.nodeCount).toBe(3);
  });

  it('counts user things only, so a re-seeded base Thing is not a recovery candidate', async () => {
    // docWith(0) still carries base-thing-prototype — the exact shape that
    // read as "1 node" and cleared every guard on 2026-09-12.
    const backend = makeBackend([
      { sha: 'reseeded', date: '2026-09-13T03:45:53Z', size: 900000, content: docWith(0) },
      { sha: 'good', date: '2026-09-12T21:16:01Z', size: 6916496, content: docWith(500) }
    ]);

    const found = await backend.findLastGoodVersion(universe);
    expect(found.sha).toBe('good');
    expect(found.nodeCount).toBe(500);
  });
});

describe('_offerRestoreIfHistoryHasData', () => {
  let events;

  beforeEach(() => {
    events = [];
    vi.spyOn(window, 'dispatchEvent').mockImplementation((event) => {
      if (event?.type === 'redstring:restore-available') events.push(event.detail);
      return true;
    });
  });

  it('raises an offer naming what the earlier version holds', async () => {
    const backend = makeBackend([
      { sha: 'empty', date: '2026-09-13T03:45:53Z', size: 16488, content: docWith(0) },
      { sha: 'c11c2089', date: '2026-09-12T21:16:01Z', size: 6916496, content: docWith(1822) }
    ]);
    backend.pendingRestoreOffer = null;

    await backend._offerRestoreIfHistoryHasData(universe);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      universeSlug: 'claude-s-chambers-2',
      universeName: "Claude's Chambers",
      sha: 'c11c2089',
      nodeCount: 1822
    });
    expect(backend.notifications[0].message).toMatch(/1822 things/);
  });

  it('stays quiet when history has nothing better to offer', async () => {
    const backend = makeBackend([
      { sha: 'a', date: '2026-09-13T03:45:53Z', size: 16488, content: docWith(0) }
    ]);
    backend.pendingRestoreOffer = null;

    await backend._offerRestoreIfHistoryHasData(universe);
    expect(events).toHaveLength(0);
  });

  it('does not ask twice for the same universe', async () => {
    const backend = makeBackend([
      { sha: 'good', date: '2026-09-12T21:16:01Z', size: 6916496, content: docWith(9) }
    ]);
    backend.pendingRestoreOffer = null;

    await backend._offerRestoreIfHistoryHasData(universe);
    await backend._offerRestoreIfHistoryHasData(universe);
    expect(events).toHaveLength(1);
  });

  it('never lets a failed lookup break the load it is advising on', async () => {
    const backend = makeBackend([]);
    backend.pendingRestoreOffer = null;
    backend.createProviderForUniverse = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(backend._offerRestoreIfHistoryHasData(universe)).resolves.toBeUndefined();
    expect(events).toHaveLength(0);
  });
});
