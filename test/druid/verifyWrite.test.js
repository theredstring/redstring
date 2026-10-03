// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { writeLanded } from '../../src/druid/verifyWrite.js';

const state = () => ({
  nodePrototypes: new Map([['p1', { id: 'p1', name: 'Awareness' }], ['p2', { id: 'p2', name: 'Memory' }]]),
  graphs: new Map([['g', { id: 'g', name: 'Redstring Universe', instances: new Map([['i1', { id: 'i1', prototypeId: 'p1' }], ['i2', { id: 'i2', prototypeId: 'p2' }]]), edgeIds: ['e1'] }]]),
  edges: new Map([['e1', { id: 'e1', sourceId: 'i1', destinationId: 'i2' }]])
});

describe('writeLanded', () => {
  it('confirms a Thing that is in the web the result named, by name', () => {
    expect(writeLanded('createNode', { action: 'createNode', graphId: 'g', name: 'awareness' }, state())).toBe(true);
  });

  it('catches the run-4 case: success reported for a web id that does not exist', () => {
    expect(writeLanded('createNode', { action: 'createNode', graphId: 'Redstring Universe', name: 'Soul' }, state())).toBe(false);
    expect(writeLanded('createNode', { action: 'createNode', graphId: 'g', name: 'Soul' }, state())).toBe(false);
  });

  it('checks connections by name, because in-turn results carry predicted ids', () => {
    expect(writeLanded('createEdge', { action: 'createEdge', graphId: 'g', sourceName: 'Memory', targetName: 'Awareness', sourceInstanceId: 'inst-predicted-1', targetInstanceId: 'inst-predicted-2' }, state())).toBe(true);
    expect(writeLanded('createEdge', { action: 'createEdge', graphId: 'g', sourceName: 'Memory', targetName: 'Soul' }, state())).toBe(false);
  });

  it('checks connections in either direction, and webs by id or name', () => {
    expect(writeLanded('createEdge', { action: 'createEdge', graphId: 'g', sourceInstanceId: 'i2', targetInstanceId: 'i1' }, state())).toBe(true);
    expect(writeLanded('createEdge', { action: 'createEdge', graphId: 'g', sourceInstanceId: 'i1', targetInstanceId: 'i9' }, state())).toBe(false);
    expect(writeLanded('createGraph', { action: 'createGraph', graphId: 'other', graphName: 'Redstring Universe' }, state())).toBe(true);
  });

  it('cannot tell for writes it does not know how to check', () => {
    expect(writeLanded('updateNode', { action: 'updateNode' }, state())).toBeNull();
  });
});
