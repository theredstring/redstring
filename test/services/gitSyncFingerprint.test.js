import { describe, it, expect, beforeEach } from 'vitest';
import { produce, enableMapSet } from 'immer';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';

enableMapSet();

// The engine commits only when its fingerprint of the document changes. It
// used to stringify webs with plain JSON, where every Map is `{}`: moving
// Things, auto layout, groups and arrow directions never committed.

const universe = () => ({
  graphs: new Map([['web', {
    id: 'web',
    name: 'Forest',
    instances: new Map([
      ['iTree', { id: 'iTree', prototypeId: 'tree', x: 0, y: 0, scale: 1 }],
      ['iBird', { id: 'iBird', prototypeId: 'bird', x: 200, y: 0, scale: 1 }]
    ]),
    groups: new Map(),
    edgeIds: ['e1']
  }]]),
  nodePrototypes: new Map([
    ['tree', { id: 'tree', name: 'Tree' }],
    ['bird', { id: 'bird', name: 'Bird' }]
  ]),
  edges: new Map([['e1', { id: 'e1', sourceId: 'iBird', destinationId: 'iTree', directionality: { arrowsToward: new Set() } }]]),
  edgePrototypes: new Map()
});

let engine, writes;
beforeEach(async () => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
  writes = 0;
  engine = new GitSyncEngine({
    name: 'stub',
    async writeFileRaw() { writes++; return { content: { sha: `sha-${writes}` } }; }
  }, 'git', 'u', 'u', 'u');
  engine.lastKnownRemoteSha = 'sha-0';
});

async function commitsAfter(change) {
  const first = universe();
  await engine.forceCommit(first);
  const before = writes;
  engine.lastCommitTime = 0;
  await engine.forceCommit(produce(first, change));
  return writes - before;
}

describe('the engine fingerprint', () => {
  it('sees a Thing moved', async () => {
    expect(await commitsAfter((s) => { s.graphs.get('web').instances.get('iTree').x = 340; })).toBe(1);
  });

  it('sees an arrow direction', async () => {
    expect(await commitsAfter((s) => { s.edges.get('e1').directionality.arrowsToward.add('iTree'); })).toBe(1);
  });

  it('sees a group', async () => {
    expect(await commitsAfter((s) => { s.graphs.get('web').groups.set('g1', { id: 'g1', name: 'Canopy', memberInstanceIds: ['iBird'] }); })).toBe(1);
  });

  it('still ignores a state with nothing new', async () => {
    expect(await commitsAfter(() => {})).toBe(0);
  });

  it('works unbound, as universeBackend calls it', () => {
    const state = universe();
    expect(GitSyncEngine.prototype.generateStateHash.call(null, state)).toBe(engine.generateStateHash(state));
  });
});
