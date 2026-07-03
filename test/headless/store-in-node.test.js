// @vitest-environment node
//
// Phase 1 gate: the real Redstring Zustand store must boot and function in a
// plain Node runtime (no jsdom, no browser globals) via the headless bootstrap.

import { describe, it, expect, beforeAll } from 'vitest';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

describe('headless store in Node', () => {
  let useGraphStore;

  beforeAll(async () => {
    __resetHeadlessStoreCache();
    ({ useGraphStore } = await createHeadlessStore());
  });

  it('installs a localStorage shim and boots the store singleton', () => {
    expect(typeof globalThis.localStorage).toBe('object');
    const st = useGraphStore.getState();
    expect(st.graphs instanceof Map).toBe(true);
    expect(st.nodePrototypes instanceof Map).toBe(true);
    expect(st.edges instanceof Map).toBe(true);
  });

  it('runs real graph/prototype/instance/edge actions', () => {
    const st = useGraphStore.getState();

    st.createNewGraph({ id: 'g-test', name: 'Test Graph' });
    expect(useGraphStore.getState().graphs.has('g-test')).toBe(true);
    expect(useGraphStore.getState().activeGraphId).toBe('g-test');

    st.addNodePrototype({ id: 'proto-a', name: 'Alpha', color: '#800000' });
    st.addNodePrototype({ id: 'proto-b', name: 'Beta', color: '#000080' });
    expect(useGraphStore.getState().nodePrototypes.has('proto-a')).toBe(true);

    const instA = st.addNodeInstance('g-test', 'proto-a', { x: 0, y: 0 }, 'inst-a');
    const instB = st.addNodeInstance('g-test', 'proto-b', { x: 200, y: 0 }, 'inst-b');
    const graph = useGraphStore.getState().graphs.get('g-test');
    expect(graph.instances.has('inst-a')).toBe(true);
    expect(graph.instances.has('inst-b')).toBe(true);

    st.addEdge('g-test', {
      id: 'edge-ab',
      sourceId: 'inst-a',
      destinationId: 'inst-b',
    });
    expect(useGraphStore.getState().edges.has('edge-ab')).toBe(true);
  });

  it('round-trips through exportToRedstring → importFromRedstring → loadUniverseFromFile', () => {
    const before = useGraphStore.getState();
    const exported = exportToRedstring(before);
    expect(exported).toBeTruthy();
    expect(exported.format || exported['@type'] || exported.metadata).toBeTruthy();

    // Import back to a fresh state object (Maps), independent of the live store.
    const { storeState } = importFromRedstring(exported);
    expect(storeState.graphs instanceof Map).toBe(true);
    expect(storeState.graphs.has('g-test')).toBe(true);
    expect(storeState.edges.has('edge-ab')).toBe(true);

    // Feed the raw exported JSON back through the store's own load path.
    const ok = useGraphStore.getState().loadUniverseFromFile(exported);
    expect(ok).not.toBe(false);
    const reloaded = useGraphStore.getState();
    expect(reloaded.graphs.has('g-test')).toBe(true);
    expect(reloaded.edges.has('edge-ab')).toBe(true);
  });
});
