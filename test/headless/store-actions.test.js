// @vitest-environment node
/**
 * Exercises the extracted createStoreActions against the REAL store in plain
 * Node. Proves the handlers mutate the store with the injected-deps design
 * (no browser), that the stale-state bug is fixed (each handler reads fresh),
 * that priority() orders pending actions, and that UI-only handlers degrade to
 * a clear error when no uiCallbacks are wired (the headless "requires-ui" case).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';

let useGraphStore;
let createStoreActions;
let normalizeId;
let priority;
let actions;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  // Dynamic import AFTER the shim is installed (storeActions imports graphStore).
  ({ createStoreActions, normalizeId, priority } = await import('../../src/services/storeActions.js'));
  actions = createStoreActions({ useGraphStore }); // no browser deps → all default no-ops
});

describe('normalizeId', () => {
  it('coerces strings and id-bearing objects', () => {
    expect(normalizeId('abc')).toBe('abc');
    expect(normalizeId({ id: 'x' })).toBe('x');
    expect(normalizeId({ graphId: 'g' }, 'graphId')).toBe('g');
    expect(normalizeId(null)).toBe(null);
  });
});

describe('priority (pending-action ordering)', () => {
  it('orders graph creation before prototypes before the rest', () => {
    expect(priority({ action: 'createNewGraph' })).toBe(0);
    expect(priority({ action: 'addNodePrototype' })).toBe(1);
    expect(priority({ action: 'openGraph' })).toBe(2);
    expect(priority({ action: 'setActiveGraph' })).toBe(3);
    expect(priority({ action: 'addEdge' })).toBe(5);
    // applyMutations with a createNewGraph op sorts early (1), otherwise late (4).
    expect(priority({ action: 'applyMutations', params: [[{ type: 'createNewGraph' }]] })).toBe(1);
    expect(priority({ action: 'applyMutations', params: [[{ type: 'addEdge' }]] })).toBe(4);
  });
});

describe('createStoreActions handlers in Node (headless)', () => {
  it('ensureGraph / createNewGraph create graphs against the live store', async () => {
    await actions.ensureGraph('g-ensure', { name: 'Ensured' });
    expect(useGraphStore.getState().graphs.has('g-ensure')).toBe(true);

    await actions.createNewGraph({ id: 'g-created', name: 'Created' });
    const st = useGraphStore.getState();
    expect(st.graphs.has('g-created')).toBe(true);
    expect(st.activeGraphId).toBe('g-created');
  });

  it('addNodePrototype + addNodeInstance + addEdge mutate the store', async () => {
    await actions.addNodePrototype({ id: 'p-a', name: 'Alpha', color: '#111' });
    await actions.addNodePrototype({ id: 'p-b', name: 'Beta', color: '#222' });
    await actions.addNodeInstance('g-created', 'p-a', { x: 0, y: 0 }, 'i-a');
    await actions.addNodeInstance('g-created', 'p-b', { x: 100, y: 0 }, 'i-b');
    await actions.addEdge('g-created', { id: 'e-1', sourceId: 'i-a', destinationId: 'i-b' });

    const g = useGraphStore.getState().graphs.get('g-created');
    expect(g.instances.has('i-a')).toBe(true);
    expect(g.instances.has('i-b')).toBe(true);
    expect(g.edgeIds).toContain('e-1');
  });

  it('applyMutations executes a batch in one call', async () => {
    const before = useGraphStore.getState().graphs.get('g-created').instances.size;
    const res = await actions.applyMutations([
      { type: 'addNodePrototype', prototypeData: { id: 'p-c', name: 'Gamma' } },
      { type: 'addNodeInstance', graphId: 'g-created', prototypeId: 'p-c', position: { x: 200, y: 0 }, instanceId: 'i-c' }
    ]);
    expect(res.success).toBe(true);
    const g = useGraphStore.getState().graphs.get('g-created');
    expect(g.instances.size).toBe(before + 1);
    expect(useGraphStore.getState().nodePrototypes.has('p-c')).toBe(true);
  });

  it('UI-only handlers report unavailability when no uiCallbacks are wired', async () => {
    const tabs = await actions.getWizardTabs();
    expect(tabs.success).toBeUndefined();
    expect(tabs.error).toBeTruthy();
    // sendWizardMessage just emits an event (no-op emit) and succeeds without a UI.
    const sent = await actions.sendWizardMessage('hi');
    expect(sent.success).toBe(true);
  });
});
