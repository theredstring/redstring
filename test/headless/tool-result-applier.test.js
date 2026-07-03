// @vitest-environment node
/**
 * Exercises the extracted toolResultApplier against the REAL store in plain
 * Node (no browser). Proves two things:
 *   1. Tool results actually mutate the store through the extracted code path.
 *   2. The critical resolve-by-name-take-LAST semantics survive extraction
 *      (see MEMORY.md — AgentLoop predictive IDs never match real store IDs,
 *      so handlers resolve by name and MUST take the LAST match, since old
 *      prototypes accumulate in insertion-ordered Maps).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';

let useGraphStore;
let applyToolResultToStore;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  // createHeadlessStore installs the localStorage shim before importing the
  // store. toolResultApplier statically imports graphStore, so it must be
  // dynamic-imported AFTER the shim is in place (ordering is load-bearing).
  ({ useGraphStore } = await createHeadlessStore());
  ({ applyToolResultToStore } = await import('../../src/services/toolResultApplier.js'));
});

describe('toolResultApplier in Node (headless)', () => {
  it('createGraph mutates the store', () => {
    applyToolResultToStore('createGraph', {
      action: 'createGraph',
      graphId: 'g-applier',
      graphName: 'Applier Graph',
      description: 'made by tool result'
    });

    const state = useGraphStore.getState();
    expect(state.graphs.has('g-applier')).toBe(true);
    expect(state.graphs.get('g-applier').name).toBe('Applier Graph');
    // createNewGraph sets it active — subsequent createNode targets it.
    expect(state.activeGraphId).toBe('g-applier');
  });

  it('createNode adds a prototype + instance to the active graph (no browser enrich needed)', () => {
    const before = useGraphStore.getState();
    const instBefore = before.graphs.get('g-applier').instances.size;

    // enrich:false so the no-op enrichment hook is not even scheduled.
    applyToolResultToStore('createNode', {
      action: 'createNode',
      graphId: 'g-applier',
      name: 'Testophon',
      description: 'a test node',
      enrich: false
    });

    const after = useGraphStore.getState();
    expect(after.graphs.get('g-applier').instances.size).toBe(instBefore + 1);
    // A prototype named Testophon now exists.
    const proto = Array.from(after.nodePrototypes.values()).find(p => p.name === 'Testophon');
    expect(proto).toBeTruthy();
  });

  it('updateNode resolves by name and takes the LAST duplicate (not the stale first)', () => {
    const store = useGraphStore.getState();
    // Two prototypes with the SAME name — 'old' inserted first, 'new' last.
    store.addNodePrototype({ id: 'proto-widget-old', name: 'Widget', color: '#111111', description: 'OLD' });
    store.addNodePrototype({ id: 'proto-widget-new', name: 'Widget', color: '#222222', description: 'NEW' });

    applyToolResultToStore('updateNode', {
      action: 'updateNode',
      originalName: 'Widget',
      updates: { description: 'RESOLVED-BY-NAME' }
    });

    const after = useGraphStore.getState();
    // The LAST (newest) prototype must be the one updated.
    expect(after.nodePrototypes.get('proto-widget-new').description).toBe('RESOLVED-BY-NAME');
    // The older duplicate must be untouched — proving we did NOT take the first match.
    expect(after.nodePrototypes.get('proto-widget-old').description).toBe('OLD');
  });

  it('ignores results with an error and does not throw', () => {
    const before = useGraphStore.getState().graphs.size;
    expect(() => applyToolResultToStore('createGraph', { error: 'boom' })).not.toThrow();
    expect(useGraphStore.getState().graphs.size).toBe(before);
  });
});
