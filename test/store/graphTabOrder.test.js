const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');

// Opening a web is a step SIDEWAYS from the one you are standing in, not a jump
// to the front of the strip. Every "open this" path — the Expand button, a
// search result, a freshly created definition — lands immediately to the right
// of the active web, and a web that is already open MOVES there rather than
// being left where it was. The strip then reads as the trail you walked instead
// of a most-recently-touched stack that reshuffles under you.
//
// `openGraphIds` is the single source of that order: the header strip and the
// left panel's "Open Things" list both render it straight through.
describe('graph tab ordering', () => {
  const st = () => useGraphStore.getState();

  const resetStore = () => {
    useGraphStore.setState({
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      openGraphIds: [],
      activeGraphId: null,
      activeDefinitionNodeId: null,
      rightPanelTabs: [{ type: 'home', isActive: true }],
      expandedGraphIds: new Set(),
      savedNodeIds: new Set(),
      savedGraphIds: new Set(),
      isUniverseLoaded: true,
      isUniverseLoading: false,
      universeLoadingError: null,
      hasUniverseFile: true,
    }, false, 'test_reset');
  };

  /** Makes `count` webs, returning their ids in creation order. */
  const makeGraphs = (count) => {
    const ids = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(st().createNewGraph({ name: `G${i}`, typeNodeId: null, color: '#333333' }));
    }
    return ids;
  };

  const order = () => st().openGraphIds.slice();

  it('creating webs in a row lays them left to right', () => {
    resetStore();
    const [a, b, c] = makeGraphs(3);
    // Each was created while the previous one was active, so each landed to its
    // right — the opposite of the old unshift, which built the list backwards.
    assert.deepStrictEqual(order(), [a, b, c]);
    assert.strictEqual(st().activeGraphId, c);
  });

  it('openGraphTab slots an unopened web in right of the active one', () => {
    resetStore();
    const [a, b, c] = makeGraphs(3);
    st().closeGraphTab(c);
    st().setActiveGraphTab(a);

    st().openGraphTab(c);

    assert.deepStrictEqual(order(), [a, c, b]);
    assert.strictEqual(st().activeGraphId, c);
  });

  it('openGraphTab MOVES an already-open web rather than duplicating it', () => {
    resetStore();
    const [a, b, c] = makeGraphs(3);
    st().setActiveGraphTab(a);

    st().openGraphTab(c);

    assert.deepStrictEqual(order(), [a, c, b]);
  });

  it('openGraphTabAndBringToTop lands beside the active web, not at the front', () => {
    resetStore();
    const [a, b, c] = makeGraphs(3);
    st().setActiveGraphTab(b);

    // This is the action the Expand button's hurtle animation finishes with.
    st().openGraphTabAndBringToTop(a);

    assert.deepStrictEqual(order(), [b, a, c]);
    assert.strictEqual(st().activeGraphId, a);
  });

  it('re-opening the web you are already in leaves the order alone', () => {
    resetStore();
    const [a, b, c] = makeGraphs(3);
    st().setActiveGraphTab(b);

    st().openGraphTabAndBringToTop(b);

    assert.deepStrictEqual(order(), [a, b, c]);
  });

  it('opens at the front when no web is active', () => {
    resetStore();
    const [a, b] = makeGraphs(2);
    st().closeGraphTab(a);
    st().closeGraphTab(b);
    useGraphStore.setState({ activeGraphId: null }, false, 'test_clear_active');

    st().openGraphTab(b);

    assert.deepStrictEqual(order(), [b]);
  });

  it('opens a web whose id is active but which is not in the strip', () => {
    // Recovery paths (and the older tests) leave activeGraphId naming a web that
    // has been closed. It still has to be inserted, not silently skipped.
    resetStore();
    const [a] = makeGraphs(1);
    st().closeGraphTab(a);
    useGraphStore.setState({ activeGraphId: a }, false, 'test_active_but_closed');

    st().openGraphTab(a);

    assert.deepStrictEqual(order(), [a]);
  });

  describe('reordering', () => {
    it('moveGraphTab walks a tab one slot at a time', () => {
      resetStore();
      const [a, b, c] = makeGraphs(3);

      st().moveGraphTab(c, 1);
      assert.deepStrictEqual(order(), [a, c, b]);

      st().moveGraphTab(c, 0);
      assert.deepStrictEqual(order(), [c, a, b]);
    });

    it('moveGraphTab clamps rather than dropping the tab off either end', () => {
      resetStore();
      const [a, b, c] = makeGraphs(3);

      st().moveGraphTab(a, -5);
      assert.deepStrictEqual(order(), [a, b, c]);

      st().moveGraphTab(a, 99);
      assert.deepStrictEqual(order(), [b, c, a]);
    });

    it('moveGraphTab ignores a web that is not open', () => {
      resetStore();
      const [a, b] = makeGraphs(2);
      st().closeGraphTab(a);

      st().moveGraphTab(a, 0);

      assert.deepStrictEqual(order(), [b]);
    });

    it('moveGraphTabBefore drops a tab in front of the one named', () => {
      resetStore();
      const [a, b, c] = makeGraphs(3);

      st().moveGraphTabBefore(c, a);
      assert.deepStrictEqual(order(), [c, a, b]);
    });

    it('moveGraphTabBefore with no anchor appends to the far right slot', () => {
      resetStore();
      const [a, b, c] = makeGraphs(3);

      st().moveGraphTabBefore(a, null);
      assert.deepStrictEqual(order(), [b, c, a]);
    });

    it('moveGraphTabBefore is a no-op when the anchor is the tab itself', () => {
      resetStore();
      const [a, b, c] = makeGraphs(3);

      st().moveGraphTabBefore(b, b);
      assert.deepStrictEqual(order(), [a, b, c]);
    });

    it('reordering does not change which web is active', () => {
      resetStore();
      const [a, b, c] = makeGraphs(3);
      st().setActiveGraphTab(a);

      st().moveGraphTabBefore(c, a);

      assert.strictEqual(st().activeGraphId, a);
      assert.deepStrictEqual(order(), [c, a, b]);
    });
  });
});
