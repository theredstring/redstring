// Orphan cleanup decides what is live from this device's open webs,
// bookmarks and tabs. In a universe others edit too, what the repository
// holds belongs to everyone: closing a tab must not delete a web or a Thing
// someone else made that this device never opened.
import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { makeHost, makeDevice, fromFile, within } from './storeDevices.js';

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
});

const closeAndClean = (graphId) => () => {
  const s = useGraphStore.getState();
  const remaining = s.openGraphIds.filter((g) => g !== graphId);
  useGraphStore.setState({ openGraphIds: remaining, activeGraphId: remaining[0] ?? null });
  useGraphStore.getState().cleanupOrphanedData();
};

describe('orphan cleanup in a shared universe', () => {
  it('keeps a web and a Thing someone else made, when this device closes a tab', async () => {
    const host = makeHost();
    const [ana, ben] = ['ana', 'ben'].map((w) => makeDevice(host, w));
    ana.start();
    ana.act(() => useGraphStore.getState().createNewGraph({ id: 'notes', name: 'Notes' }));
    await ana.save();
    await ben.open();

    // Ben: a web of his own, and a Thing he keeps only as a bookmark.
    ben.act(() => {
      const s = useGraphStore.getState();
      s.createNewGraph({ id: 'bens-web', name: 'Underground' });
      useGraphStore.getState().addNodePrototype({ id: 'loose', name: 'Loose idea' });
      useGraphStore.getState().toggleSavedNode('loose');
    });
    await ben.save();
    await ana.check();
    expect(ana.state.graphs.has('bens-web')).toBe(true);

    ana.act(closeAndClean('notes'));
    expect(ana.state.graphs.has('bens-web')).toBe(true);
    expect(ana.state.nodePrototypes.has('loose')).toBe(true);
    await ana.save();
    const repo = fromFile(host.current().content);
    expect(repo.graphs.has('bens-web')).toBe(true);
    expect(repo.nodePrototypes.has('loose')).toBe(true);
  });

  it('still discards what this device made and let go before it was ever saved', () => {
    const host = makeHost();
    const ana = makeDevice(host, 'ana');
    ana.start();
    ana.state = within(ana.state, () => useGraphStore.getState().markDocumentSynced()).state;
    // A Thing made after the last save, in no web, then un-bookmarked.
    ana.act(() => {
      useGraphStore.getState().addNodePrototype({ id: 'temp', name: 'Temp' });
      const saved = new Set(useGraphStore.getState().savedNodeIds);
      saved.delete('temp');
      useGraphStore.setState({ savedNodeIds: saved });
      useGraphStore.getState().cleanupOrphanedData();
    });
    expect(ana.state.nodePrototypes.has('temp')).toBe(false);
  });
});
