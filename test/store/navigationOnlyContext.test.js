/**
 * The store tells SaveCoordinator when a batch of changes was ONLY navigation
 * (switching, opening, closing or reordering webs), so a Git-backed universe
 * can let it wait instead of rewriting the file on every click.
 *
 * The flag is judged per change, not from the batch's reported `type`, which
 * is the last meaningful type in the batch: an edit that shares a tick with a
 * tab switch must still save as an edit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import saveCoordinator from '../../src/services/SaveCoordinator.js';

const st = () => useGraphStore.getState();

/** Lets the middleware's setTimeout(0) notification fire, then returns its context. */
const nextNotice = async (spy) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return spy.mock.lastCall?.[1];
};

describe('navigationOnly on the save notification', () => {
  let spy;
  let wasEnabled;
  let g1;
  let g2;

  beforeEach(async () => {
    useGraphStore.setState({
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      openGraphIds: [],
      activeGraphId: null,
      expandedGraphIds: new Set(),
      isUniverseLoaded: true,
      isUniverseLoading: false,
      universeLoadingError: null,
      hasUniverseFile: true,
    }, false, 'test_reset');
    g1 = st().createNewGraph({ name: 'One', typeNodeId: null, color: '#333333' });
    g2 = st().createNewGraph({ name: 'Two', typeNodeId: null, color: '#333333' });

    wasEnabled = saveCoordinator.isEnabled;
    saveCoordinator.isEnabled = true;
    spy = vi.spyOn(saveCoordinator, 'onStateChange').mockImplementation(() => {});
    await nextNotice(spy); // drain the setup's own notice
    spy.mockClear();
  });

  afterEach(() => {
    spy.mockRestore();
    saveCoordinator.isEnabled = wasEnabled;
  });

  it('is true for a web switch on its own', async () => {
    st().setActiveGraphTab(g1);
    expect(await nextNotice(spy)).toMatchObject({ type: 'active_graph_change', navigationOnly: true });
  });

  it('is true for opening, reordering and expanding webs together', async () => {
    st().openGraphTab(g1);
    st().moveGraphTab(g1, 1);
    st().toggleGraphExpanded(g2);
    expect((await nextNotice(spy)).navigationOnly).toBe(true);
  });

  it('is false when an edit shares the tick with a web switch', async () => {
    st().addNodePrototype({ id: 'p-dog', name: 'Dog', color: '#800000' });
    st().setActiveGraphTab(g2);
    const context = await nextNotice(spy);
    // The reported type is the switch; the flag is what keeps the edit an edit.
    expect(context.type).toBe('active_graph_change');
    expect(context.navigationOnly).toBe(false);
  });

  it('is false when the edit comes after the switch', async () => {
    st().setActiveGraphTab(g2);
    st().addNodePrototype({ id: 'p-cat', name: 'Cat', color: '#800000' });
    expect((await nextNotice(spy)).navigationOnly).toBe(false);
  });

  it('starts fresh for the next batch', async () => {
    st().addNodePrototype({ id: 'p-owl', name: 'Owl', color: '#800000' });
    await nextNotice(spy);
    st().setActiveGraphTab(g1);
    expect((await nextNotice(spy)).navigationOnly).toBe(true);
  });
});
