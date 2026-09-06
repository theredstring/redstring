import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';
import { mergeUniverses } from '../../src/formats/mergeUniverses.js';
import { duplicatePairKey } from '../../src/formats/duplicatePairKey.js';

const resetStore = (patch = {}) => {
  useGraphStore.setState({
    graphs: new Map(),
    nodePrototypes: new Map(),
    edges: new Map(),
    edgePrototypes: new Map(),
    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null,
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    mergeDismissals: {},
    isUniverseLoaded: true,
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
    _isLoadingUniverse: false,
    ...patch,
  }, false, 'test_reset');
};

const proto = (id, name, extras = {}) => [id, {
  id, name, description: '', color: '#800000',
  externalLinks: [], definitionGraphIds: [], ...extras,
}];

describe('duplicatePairKey', () => {
  it('does not depend on argument order', () => {
    expect(duplicatePairKey('b', 'a')).toBe(duplicatePairKey('a', 'b'));
  });

  it('is stable when the survivor choice flips', () => {
    // The scan picks the survivor by use count, which changes as the universe
    // is edited. An unsorted key would rename the pair out from under a
    // dismissal the moment the other side became the more-used one.
    expect(duplicatePairKey('a', 'b')).toBe('a|b');
    expect(duplicatePairKey('b', 'a')).toBe('a|b');
  });
});

describe('dismissing a duplicate pair', () => {
  beforeEach(() => resetStore());

  it('records and restores a pair', () => {
    resetStore({ nodePrototypes: new Map([proto('a', 'Dog'), proto('b', 'Dog')]) });
    const key = duplicatePairKey('a', 'b');

    useGraphStore.getState().dismissDuplicatePair(key);
    expect(useGraphStore.getState().mergeDismissals[key]).toBe(true);

    useGraphStore.getState().restoreDuplicatePair(key);
    expect(useGraphStore.getState().mergeDismissals[key]).toBeUndefined();
  });

  it('survives a save/load round-trip', () => {
    // The whole point: the scan is deterministic, so a dismissal held only in
    // the modal meant the identical pair came back on every reopen.
    resetStore({ nodePrototypes: new Map([proto('a', 'Dog'), proto('b', 'Dog')]) });
    const key = duplicatePairKey('a', 'b');
    useGraphStore.getState().dismissDuplicatePair(key);

    const file = exportToRedstring(useGraphStore.getState());
    const { storeState } = importFromRedstring(file);

    expect(storeState.mergeDismissals[key]).toBe(true);
  });

  it('reads back an empty object from a file that predates the field', () => {
    resetStore({ nodePrototypes: new Map([proto('a', 'Dog')]) });
    const file = exportToRedstring(useGraphStore.getState());
    delete file.userInterface['redstring:mergeDismissals'];

    const { storeState } = importFromRedstring(file);
    expect(storeState.mergeDismissals).toEqual({});
  });

  it('drops dismissals naming a thing that is gone', () => {
    resetStore({
      nodePrototypes: new Map([proto('a', 'Dog'), proto('b', 'Dog'), proto('c', 'Cat')]),
      mergeDismissals: {
        [duplicatePairKey('a', 'b')]: true,
        [duplicatePairKey('a', 'gone')]: true,
      },
    });

    useGraphStore.getState().pruneDuplicateDismissals();

    const kept = useGraphStore.getState().mergeDismissals;
    expect(kept[duplicatePairKey('a', 'b')]).toBe(true);
    expect(kept[duplicatePairKey('a', 'gone')]).toBeUndefined();
  });

  it('a merge leaves the dismissal stale, and pruning clears it', () => {
    resetStore({ nodePrototypes: new Map([proto('a', 'Dog'), proto('b', 'Dog')]) });
    const key = duplicatePairKey('a', 'b');
    useGraphStore.getState().dismissDuplicatePair(key);

    useGraphStore.getState().mergeThings('a', 'b');
    useGraphStore.getState().pruneDuplicateDismissals();

    expect(useGraphStore.getState().mergeDismissals[key]).toBeUndefined();
  });
});

describe('mergeUniverses carries dismissals across', () => {
  const state = (protos, dismissals = {}) => ({
    graphs: new Map(),
    nodePrototypes: new Map(protos),
    edges: new Map(),
    edgePrototypes: new Map(),
    openGraphIds: [],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    mergeDismissals: dismissals,
  });

  it('unions both sides', () => {
    const base = state([proto('a', 'Dog'), proto('b', 'Dog')], { [duplicatePairKey('a', 'b')]: true });
    const incoming = state([proto('c', 'Cat'), proto('d', 'Cat')], { [duplicatePairKey('c', 'd')]: true });

    const { merged } = mergeUniverses(base, incoming);

    expect(merged.mergeDismissals[duplicatePairKey('a', 'b')]).toBe(true);
    expect(merged.mergeDismissals[duplicatePairKey('c', 'd')]).toBe(true);
  });

  it('drops a pair the merge itself collapsed into one thing', () => {
    // Both sides link to the same entity, so foldSameAs merges them. The
    // dismissal said "these two are different"; after the fold there is only
    // one thing, so the ruling has nothing left to refer to.
    const link = 'https://www.wikidata.org/wiki/Q144';
    const base = state([proto('a', 'Dog', { externalLinks: [link] })]);
    const incoming = state(
      [proto('x', 'Dog', { externalLinks: [link] }), proto('y', 'Hound')],
      { [duplicatePairKey('x', 'y')]: true }
    );

    const { merged } = mergeUniverses(base, incoming, { foldSameAs: true });

    // x folded into a, so the pair is re-keyed against a — not dropped, since
    // a and y are still two distinct things.
    expect(merged.mergeDismissals[duplicatePairKey('a', 'y')]).toBe(true);
    expect(merged.mergeDismissals[duplicatePairKey('x', 'y')]).toBeUndefined();
  });

  it('does not mutate the base state it was handed', () => {
    const baseDismissals = { [duplicatePairKey('a', 'b')]: true };
    const base = state([proto('a', 'Dog'), proto('b', 'Dog')], baseDismissals);
    const incoming = state([proto('c', 'Cat'), proto('d', 'Cat')], { [duplicatePairKey('c', 'd')]: true });

    mergeUniverses(base, incoming);

    expect(Object.keys(baseDismissals)).toEqual([duplicatePairKey('a', 'b')]);
  });
});
