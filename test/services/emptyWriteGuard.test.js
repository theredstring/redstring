import { describe, it, expect } from 'vitest';
import {
  isEmptyStoreState,
  checkDestinationBeforeEmptyWrite
} from '../../src/services/emptyWriteGuard.js';

const storeState = (nodes = 0, graphs = 0) => ({
  nodePrototypes: new Map(Array.from({ length: nodes }, (_, i) => [`p${i}`, { id: `p${i}` }])),
  graphs: new Map(Array.from({ length: graphs }, (_, i) => [`g${i}`, { id: `g${i}`, instances: new Map() }])),
  edges: new Map(),
});

/** A .redstring document as it actually appears on disk / in the repo. */
const fileDoc = (nodes = 0, graphs = 0) => ({
  format: 'redstring-v4',
  prototypeSpace: {
    prototypes: Object.fromEntries(Array.from({ length: nodes }, (_, i) => [`p${i}`, { id: `p${i}` }]))
  },
  spatialGraphs: {
    graphs: Object.fromEntries(Array.from({ length: graphs }, (_, i) => [`g${i}`, { id: `g${i}` }]))
  }
});

const notFound = () => Object.assign(new Error('File not found'), { code: 'FILE_NOT_FOUND' });

describe('isEmptyStoreState', () => {
  it('is true when there are no user-made things', () => {
    expect(isEmptyStoreState(storeState(0, 0))).toBe(true);
    expect(isEmptyStoreState(storeState(1, 0))).toBe(false);
    // Webs but no things: a wiped store that the UI has re-seeded often looks
    // exactly like this. Firing here costs one destination read, and the read
    // is what decides — so being strict is free.
    expect(isEmptyStoreState(storeState(0, 1))).toBe(true);
  });

  it('ignores the seeded base Thing and Connection prototypes', () => {
    // The 2026-09-12 shape: the universe was wiped, the UI re-added Thing,
    // and every `nodeCount === 0` check downstream reported "not empty".
    const reSeeded = {
      nodePrototypes: new Map([
        ['base-thing-prototype', { id: 'base-thing-prototype' }],
        ['base-connection-prototype', { id: 'base-connection-prototype' }]
      ]),
      graphs: new Map()
    };
    expect(isEmptyStoreState(reSeeded)).toBe(true);
  });

  it('reads a .redstring document as well as a store snapshot', () => {
    expect(isEmptyStoreState(fileDoc(0, 0))).toBe(true);
    expect(isEmptyStoreState(fileDoc(3, 1))).toBe(false);
  });

  it('does not call an unrecognizable object empty', () => {
    // Null counts mean "cannot tell", which must not read as "nothing there".
    expect(isEmptyStoreState({ something: 'else' })).toBe(false);
    expect(isEmptyStoreState(null)).toBe(false);
  });
});

describe('checkDestinationBeforeEmptyWrite', () => {
  it('refuses when the destination is present but not a Redstring document', async () => {
    // The 2026-09-12 shape: a GitHub contents-API envelope sitting where the
    // universe should be. getRedstringStats reports nulls for it, which the
    // old code read as "zero things, safe to clear".
    const envelope = {
      name: 'x.redstring', path: 'universes/x/x.redstring', sha: 'd2e9',
      size: 6916496, type: 'file', content: '', encoding: 'none'
    };
    const result = await checkDestinationBeforeEmptyWrite({
      readDestination: async () => JSON.stringify(envelope),
      label: 'universes/x/x.redstring'
    });

    expect(result.safe).toBe(false);
    expect(result.reason).toBe('destination-unrecognized');
  });

  it('refuses when the destination holds data', async () => {
    // The 2026-09-06 case: an empty store about to land on 518 things.
    const result = await checkDestinationBeforeEmptyWrite({
      readDestination: async () => JSON.stringify(fileDoc(518, 59)),
      label: 'universes/ii/ii.redstring'
    });

    expect(result.safe).toBe(false);
    expect(result.reason).toBe('destination-has-data');
    expect(result.destination.nodeCount).toBe(518);
    expect(result.destination.graphCount).toBe(59);
  });

  it('allows the write when the destination is absent', async () => {
    const result = await checkDestinationBeforeEmptyWrite({
      readDestination: async () => { throw notFound(); }
    });
    expect(result).toEqual({ safe: true, reason: 'destination-absent' });
  });

  it('allows the write when the destination is itself empty', async () => {
    for (const content of ['', '   ', JSON.stringify(fileDoc(0, 0))]) {
      const result = await checkDestinationBeforeEmptyWrite({ readDestination: async () => content });
      expect(result.safe).toBe(true);
    }
  });

  it('refuses an AMBIGUOUS read rather than assuming absent', async () => {
    // The mobile-git wipe shape: an auth race or 5xx is not a 404, and reading
    // it as "nothing there" is what let an empty state overwrite a real repo.
    for (const error of [
      new Error('403 Forbidden'),
      Object.assign(new Error('probe failed'), { code: 'FILE_INFO_UNKNOWN' }),
      new Error('network timeout'),
    ]) {
      const result = await checkDestinationBeforeEmptyWrite({ readDestination: async () => { throw error; } });
      expect(result.safe).toBe(false);
      expect(result.reason).toBe('destination-unreadable');
    }
  });

  it('refuses when the destination is present but unparseable', async () => {
    // Something is there. Clobbering it with nothing is the exact loss this
    // guard exists to prevent, and a local file has no history to fall back on.
    const result = await checkDestinationBeforeEmptyWrite({ readDestination: async () => '{ truncated' });
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('destination-unparseable');
  });

  it('refuses when the caller cannot read its own destination', async () => {
    const result = await checkDestinationBeforeEmptyWrite({});
    expect(result).toEqual({ safe: false, reason: 'no-destination-reader' });
  });

  it('honours a caller-supplied not-found predicate', async () => {
    const backendSpecific = Object.assign(new Error('no such blob'), { status: 404 });
    const result = await checkDestinationBeforeEmptyWrite({
      readDestination: async () => { throw backendSpecific; },
      isNotFound: (e) => e?.status === 404
    });
    expect(result).toEqual({ safe: true, reason: 'destination-absent' });
  });
});
