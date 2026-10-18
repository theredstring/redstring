// Every everyday edit, made through the real store, must:
//   1. change what the file holds (or it isn't saved at all),
//   2. change the sync engine's fingerprint (or it never commits on its own),
//   3. change the save fingerprint (or the local save skips it),
//   4. arrive whole on another person's canvas when they pull it,
//   5. survive this person's own merge with a repository that hasn't moved,
//   6. go out as-is when this person saves onto a repository that has.
// Moving Things and auto layout failed 2; a Thing made on the canvas, deleted
// by someone else, failed 4 (both found by hand, 2026-10-18).
import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { generateStateHash as saveHash } from '../../src/services/saveHash.js';
import { bringInRemote, mergeOntoCanvas, planMerge, primeImageRefs } from '../../src/services/remoteMerge.js';
import { ACTIONS, seededRandom, idSource } from './actionCatalog.js';
import { freshUniverse, within, fileText, fromFile, sameDocument, describeDifference, brokenReferences } from './storeDevices.js';

const engineHash = (state) => GitSyncEngine.prototype.generateStateHash.call(null, state);

/** A small universe with a bit of everything, built through the store. */
function fixture() {
  let state = freshUniverse();
  const rng = seededRandom(7);
  const ids = idSource('fx');
  const run = (name, times = 1) => {
    const action = ACTIONS.find((a) => a.name === name);
    for (let i = 0; i < times; i++) state = within(state, () => action.run(rng, ids)).state;
  };
  run('add a Thing', 6);
  run('make a new web');
  run('add a Thing', 3);
  run('connect two Things', 4);
  run('group Things');
  run('give a connection a type');
  run('define a Thing (open its own web)');
  // As after a save to the repository (universeBackend._markSyncedIfShared).
  state = within(state, () => useGraphStore.getState().markDocumentSynced()).state;
  return state;
}

const OTHER = { id: 'other-thing', name: 'Other', color: '#8B0000', createdAt: '2026-01-01T00:00:00.000Z' };
const apply = (state, doc) => within(state, () => useGraphStore.getState().applyRemoteDocument(doc)).state;

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
});

describe('every everyday edit syncs', () => {
  for (const action of ACTIONS) {
    it(action.name, async () => {
      const before = fixture();
      let after, description;
      for (let seed = 11; seed < 60 && !description; seed++) {
        ({ state: after, result: description } = within(before, () => action.run(seededRandom(seed), idSource('ed'))));
      }
      expect(description, `${action.name} found nothing to act on in the fixture`).toBeTruthy();

      if (action.personal) {
        expect(sameDocument(before, after)).toBe(true);
        expect(engineHash(after)).toBe(engineHash(before));
        return;
      }

      // 1-3
      expect(sameDocument(before, after), `${description}: the file doesn't change`).toBe(false);
      expect(engineHash(after), `${description}: the sync fingerprint doesn't see it`).not.toBe(engineHash(before));
      expect(saveHash(after), `${description}: the save fingerprint doesn't see it`).not.toBe(saveHash(before));
      expect(brokenReferences(after), description).toEqual([]);

      const [baseText, afterText] = [fileText(before), fileText(after)];
      await primeImageRefs(before, after, fromFile(baseText), fromFile(afterText));

      // 4: someone else made this edit; it arrives on my canvas whole.
      const pulled = bringInRemote({ baseText, remoteData: JSON.parse(afterText) }, before);
      expect(pulled.ok, `${description}: ${pulled.reason}`).toBe(true);
      const mine = apply(before, pulled.merged);
      expect(sameDocument(mine, after), `${description} didn't arrive whole:\n${describeDifference(mine, after)}`).toBe(true);

      // 5: I made it; a merge with an unmoved repository keeps it.
      const kept = apply(after, mergeOntoCanvas(fromFile(baseText), after, fromFile(baseText)));
      expect(sameDocument(kept, after), `${description} was undone by a no-op merge:\n${describeDifference(kept, after)}`).toBe(true);

      // 6: I made it and save onto a repository someone else moved (with an unrelated edit).
      const other = within(before, () => useGraphStore.getState().addNodePrototype(OTHER)).state;
      const plan = await planMerge({ baseText, localJson: afterText, remoteData: JSON.parse(fileText(other)) });
      expect(plan.ok, `${description}: ${plan.reason}`).toBe(true);
      const saved = fromFile(plan.content);
      const expected = within(after, () => useGraphStore.getState().addNodePrototype(OTHER)).state;
      expect(sameDocument(saved, expected), `${description} didn't go out as made:\n${describeDifference(saved, expected)}`).toBe(true);
    });
  }
});

describe('a picture replaced by another of the same size', () => {
  it('is a change to save', () => {
    const pic = (c) => `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD${c}lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`;
    const a = within(freshUniverse(), () => {
      useGraphStore.getState().addNodePrototype({ id: 'oak', name: 'Oak', imageSrc: pic('A'), thumbnailSrc: pic('A') });
    }).state;
    const b = within(a, () => useGraphStore.getState().updateNodePrototype('oak', (p) => { p.imageSrc = pic('B'); p.thumbnailSrc = pic('B'); })).state;
    expect(a.nodePrototypes.get('oak').imageSrc.length).toBe(b.nodePrototypes.get('oak').imageSrc.length);
    expect(saveHash(b)).not.toBe(saveHash(a));
    expect(engineHash(b)).not.toBe(engineHash(a));
  });
});
