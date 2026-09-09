/**
 * Seeding the abstraction carousel from a node's type.
 *
 * `typeNodeId` and the carousel encode the same is-a claim, so assigning a type is
 * transcribed onto the axis rather than left for the user to restate by hand. These
 * cover the three things that make that safe: the seed itself, the retype sync only
 * touching chains nobody has edited, and the orphan sweep still working now that every
 * prototype owns a chain naming itself.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import {
  DEFAULT_ABSTRACTION_DIMENSION as DIM,
  THING_PROTOTYPE_ID as THING
} from '../../src/wizard/tools/utils/abstractionSpec.js';

const chainOf = (id) =>
  useGraphStore.getState().nodePrototypes.get(id)?.abstractionChains?.[DIM];

const addProto = (id, extra = {}) =>
  useGraphStore.getState().addNodePrototype({
    id, name: id, color: '#8B0000', definitionGraphIds: [], ...extra
  });

describe('seeding on creation', () => {
  beforeEach(() => { useGraphStore.getState().clearUniverse(); });

  it('gives a new prototype [self, type, Thing]', () => {
    addProto('company');
    addProto('bakery', { typeNodeId: 'company' });
    expect(chainOf('bakery')).toEqual(['bakery', 'company', THING]);
  });

  it('collapses to [self, Thing] for a node born with the default type', () => {
    addProto('bakery', { typeNodeId: THING });
    expect(chainOf('bakery')).toEqual(['bakery', THING]);
  });

  it('treats an untyped node as a Thing, matching how the panel displays it', () => {
    addProto('bakery', { typeNodeId: null });
    expect(chainOf('bakery')).toEqual(['bakery', THING]);
  });

  it('leaves the base Thing prototype without a chain of its own', () => {
    expect(chainOf(THING)).toBeUndefined();
  });

  it('never overwrites a chain the caller supplied', () => {
    addProto('ford', { abstractionChains: { [DIM]: ['ford', 'automaker', THING] } });
    expect(chainOf('ford')).toEqual(['ford', 'automaker', THING]);
  });

  it('gives a duplicate its own chain rather than one naming the original', () => {
    // A verbatim copy would leave the duplicate owning a chain it does not appear in,
    // which the carousel reports as "current node not found" and draws as nothing.
    addProto('company');
    addProto('bakery', { typeNodeId: 'company' });
    const copyId = useGraphStore.getState().duplicateNodePrototype('bakery');
    expect(chainOf(copyId)).toEqual([copyId, 'company', THING]);
  });
});

describe('keeping the chain in step with the type', () => {
  beforeEach(() => {
    useGraphStore.getState().clearUniverse();
    addProto('company');
    addProto('institution');
    addProto('bakery', { typeNodeId: 'company' });
  });

  it('swaps the type rung on retype', () => {
    useGraphStore.getState().setNodeType('bakery', 'institution');
    expect(chainOf('bakery')).toEqual(['bakery', 'institution', THING]);
  });

  it('leaves a hand-extended ladder completely alone', () => {
    useGraphStore.getState().addToAbstractionChain('bakery', DIM, 'below', 'institution', 'company');
    const authored = [...chainOf('bakery')];
    useGraphStore.getState().setNodeType('bakery', 'institution');
    expect(chainOf('bakery')).toEqual(authored);
  });

  it('leaves a hand-built ladder with no Thing floor alone', () => {
    // The case that makes shape inference safe: seeding always lays the floor, so a
    // two-rung ladder somebody wrote is still distinguishable from a seed.
    useGraphStore.getState().updateNodePrototype('bakery', (p) => {
      p.abstractionChains = { [DIM]: ['bakery', 'company'] };
    });
    useGraphStore.getState().setNodeType('bakery', 'institution');
    expect(chainOf('bakery')).toEqual(['bakery', 'company']);
  });

  it('falls back to Thing when the type is cleared', () => {
    useGraphStore.getState().setNodeType('bakery', null);
    expect(chainOf('bakery')).toEqual(['bakery', THING]);
  });
});

describe('chain guards', () => {
  beforeEach(() => {
    useGraphStore.getState().clearUniverse();
    addProto('company');
    addProto('bakery', { typeNodeId: 'company' });
  });

  it('refuses to add anything more general than Thing', () => {
    addProto('cosmos');
    useGraphStore.getState().addToAbstractionChain('bakery', DIM, 'below', 'cosmos', THING);
    expect(chainOf('bakery')).toEqual(['bakery', 'company', THING]);
  });

  it('refuses to insert against an anchor from a different chain', () => {
    // This used to splice both the anchor and the new node in, dragging a rung out of
    // the ladder it belonged to and founding a second chain over the same nodes.
    addProto('ford', { abstractionChains: { [DIM]: ['ford', 'automaker', THING] } });
    addProto('newRung');
    useGraphStore.getState().addToAbstractionChain('bakery', DIM, 'below', 'newRung', 'automaker');
    expect(chainOf('bakery')).toEqual(['bakery', 'company', THING]);
  });
});

describe('deleting a prototype that other chains name', () => {
  beforeEach(() => { useGraphStore.getState().clearUniverse(); });

  it('drops the dead rung and untypes what it typed', () => {
    // A dangling id is skipped when the carousel draws, but levels come from the raw
    // array index — so it leaves a hole the scroll can still settle on.
    addProto('company');
    addProto('bakery', { typeNodeId: 'company' });
    useGraphStore.getState().deleteNodePrototype('company');
    expect(chainOf('bakery')).toEqual(['bakery', THING]);
    expect(useGraphStore.getState().nodePrototypes.get('bakery').typeNodeId).toBe(THING);
  });
});

describe('orphan sweep', () => {
  beforeEach(() => { useGraphStore.getState().clearUniverse(); });

  it('still collects an unreferenced prototype', () => {
    // Every prototype now owns a chain naming itself at index 0. Expanding chains
    // unconditionally would let each one vouch for its own liveness and the sweep
    // would never collect anything again — so reachability starts from live prototypes
    // and runs to a fixpoint.
    addProto('orphan');
    const store = useGraphStore.getState();
    store.setSavedNodeIds?.(new Set());
    useGraphStore.setState({ savedNodeIds: new Set(), rightPanelTabs: [] });
    useGraphStore.getState().cleanupOrphanedData();
    expect(useGraphStore.getState().nodePrototypes.has('orphan')).toBe(false);
  });

  it('keeps a rung of a live prototype\'s ladder', () => {
    addProto('ford');
    addProto('automaker');
    useGraphStore.getState().addToAbstractionChain('ford', DIM, 'below', 'automaker', 'ford');
    useGraphStore.setState({ savedNodeIds: new Set(['ford']), rightPanelTabs: [] });
    useGraphStore.getState().cleanupOrphanedData();
    expect(useGraphStore.getState().nodePrototypes.has('automaker')).toBe(true);
  });
});
