/**
 * The save worker's cache of finished pieces (exportCache.js) must never
 * change what's written. Through long runs of random edits, including the
 * ones whose effects cross from one entry into another (a rename shows up in
 * other webs' summaries, a chain in other Things' broader links, an instance's
 * Thing in its connections' statements), a file built with the cache must be
 * byte for byte the file built without it.
 *
 * The clock is frozen: a reused piece keeps the time it was built at, so with
 * a moving clock the two differ in those timestamps, and only there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';
import { serializeRedstring } from '../../src/formats/universeBytes.js';
import { createExportCache } from '../../src/formats/exportCache.js';
import { generateStateHash, createStateHashCache } from '../../src/services/saveHash.js';
import { randomUniverse, randomEdit, rng } from '../helpers/randomUniverse.js';

const decode = (bytes) => new TextDecoder().decode(bytes);
const full = (state) => decode(serializeRedstring(exportToRedstring(state), { compact: true }));
const cached = (state, cache) => decode(serializeRedstring(exportToRedstring(state, null, { cache }), { compact: true }));

describe('the export cache, clock frozen', () => {
  beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z'), toFake: ['Date'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('writes exactly what a full build writes, through long runs of random edits', () => {
    let reusedSomewhere = false;
    for (let seed = 1; seed <= 60; seed++) {
      let state = randomUniverse(seed, { prototypes: 10 + (seed % 30), graphs: 3 + (seed % 7), edges: seed % 25 });
      const cache = createExportCache();
      const r = rng(seed * 31);
      for (let step = 0; step < 40; step++) {
        const got = cached(state, cache);
        const expected = full(state);
        if (got !== expected) throw new Error(`seed ${seed}, step ${step}: the cached file differs from a full build`);
        if (cache.stats.reused > 0) reusedSomewhere = true;
        state = randomEdit(state, r);
      }
    }
    expect(reusedSomewhere).toBe(true);
  }, 60000); // 2,400 full builds: seconds alone, more beside the rest of the suite

  it('reuses what didn\'t change and rebuilds only what did', () => {
    const state = randomUniverse(7, { prototypes: 40, graphs: 6, edges: 10 });
    const cache = createExportCache();
    cached(state, cache);
    const first = cache.stats;
    expect(first.reused).toBe(0);
    cached(state, cache);
    expect(cache.stats.built).toBe(0);
    expect(cache.stats.reused).toBe(first.built);

    // One Thing renamed: it, and the summaries of webs that show it, are rebuilt.
    const [id, proto] = [...state.nodePrototypes.entries()][2];
    const nodePrototypes = new Map(state.nodePrototypes);
    nodePrototypes.set(id, { ...proto, name: 'Renamed' });
    const next = { ...state, nodePrototypes };
    expect(cached(next, cache)).toBe(full(next));
    const showing = [...state.graphs.values()].filter((g) => [...g.instances.values()].some((i) => i.prototypeId === id)).length;
    expect(cache.stats.built).toBe(1 + showing);
  });

  it('a verifying save checks every kept piece, writes the rebuild, and finds nothing wrong', () => {
    let state = randomUniverse(11, { prototypes: 30, graphs: 6, edges: 15 });
    const cache = createExportCache();
    const r = rng(5);
    for (let step = 0; step < 20; step++) {
      cache.setVerify(step % 3 === 2);
      expect(cached(state, cache)).toBe(full(state));
      expect(cache.mismatches).toEqual([]);
      state = randomEdit(state, r);
    }
  });

  it('catches a piece gone stale (an entry edited in place), and writes the right bytes anyway', () => {
    const state = randomUniverse(3, { prototypes: 20, graphs: 4, edges: 5 });
    const cache = createExportCache();
    cached(state, cache);
    // What the store never does: change a Thing without replacing it.
    const [id, proto] = [...state.nodePrototypes.entries()][1];
    proto.name = 'Changed in place';
    // An ordinary save can't see it: this is what verification is for.
    expect(cached(state, cache)).not.toBe(full(state));
    cache.setVerify(true);
    expect(cached(state, cache)).toBe(full(state));
    expect(cache.mismatches).toContainEqual({ kind: 'prototype', id: String(id) });
  });

  it('drops the pieces of removed entries, and keeps everything when an export fails', () => {
    const state = randomUniverse(9, { prototypes: 10, graphs: 3, edges: 0 });
    const cache = createExportCache();
    cached(state, cache);
    const pieces = cache.stats.pieces;
    const nodePrototypes = new Map(state.nodePrototypes);
    nodePrototypes.delete([...nodePrototypes.keys()][0]);
    cached({ ...state, nodePrototypes }, cache);
    expect(cache.stats.pieces).toBe(pieces - 1);

    expect(() => exportToRedstring({ ...state, graphs: new Map([['bad', null]]) }, null, { cache })).toThrow();
    expect(cache.stats.pieces).toBe(pieces - 1);
  });

  it('is never used for a pretty-printed file', () => {
    const state = randomUniverse(2, { prototypes: 5, graphs: 2, edges: 0 });
    const data = exportToRedstring(state, null, { cache: createExportCache() });
    expect(() => serializeRedstring(data, { compact: false })).toThrow(/compact/);
    expect(() => JSON.stringify(data)).toThrow(/RawJson/);
  });
});

describe('the export cache, clock running', () => {
  it('a kept piece keeps the time it was built; a rebuilt one gets the new time', () => {
    vi.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z'), toFake: ['Date'] });
    try {
      const state = randomUniverse(4, { prototypes: 6, graphs: 2, edges: 0 });
      const cache = createExportCache();
      cached(state, cache);
      vi.setSystemTime(new Date('2026-10-09T13:00:00Z'));
      const [changedId, proto] = [...state.nodePrototypes.entries()][0];
      const nodePrototypes = new Map(state.nodePrototypes);
      nodePrototypes.set(changedId, { ...proto, description: 'new' });
      const out = JSON.parse(cached({ ...state, nodePrototypes }, cache));
      const viewed = (id) => out.prototypeSpace.prototypes[id]['redstring:cognitiveProperties']['redstring:lastViewed'];
      expect(viewed(changedId)).toBe('2026-10-09T13:00:00.000Z');
      expect(viewed([...state.nodePrototypes.keys()][1])).toBe('2026-10-09T12:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the save hash with kept entry hashes', () => {
  it('gives the same hash as hashing everything, through long runs of random edits', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let state = randomUniverse(seed, { prototypes: 15, graphs: 5, edges: 12 });
      const cache = createStateHashCache();
      const r = rng(seed);
      for (let step = 0; step < 30; step++) {
        expect(generateStateHash(state, { cache })).toBe(generateStateHash(state));
        state = randomEdit(state, r);
      }
    }
  });

  it('changes when any covered part changes', () => {
    const state = randomUniverse(21, { prototypes: 10, graphs: 4, edges: 6 });
    const cache = createStateHashCache();
    const base = generateStateHash(state, { cache });
    const [pid, proto] = [...state.nodePrototypes.entries()][0];
    const renamed = new Map(state.nodePrototypes); renamed.set(pid, { ...proto, name: 'x' });
    expect(generateStateHash({ ...state, nodePrototypes: renamed }, { cache })).not.toBe(base);
    expect(generateStateHash({ ...state, savedNodeIds: new Set(['zzz']) }, { cache })).not.toBe(base);
    const reordered = new Map([...state.nodePrototypes.entries()].reverse());
    expect(generateStateHash({ ...state, nodePrototypes: reordered }, { cache })).not.toBe(base);
    // A viewport move is not a change.
    const [gid, graph] = [...state.graphs.entries()][0];
    const panned = new Map(state.graphs); panned.set(gid, { ...graph, panOffset: { x: 999, y: 1 }, zoomLevel: 4 });
    expect(generateStateHash({ ...state, graphs: panned }, { cache })).toBe(base);
  });
});
