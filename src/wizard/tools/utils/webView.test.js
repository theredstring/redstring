import { describe, it, expect } from 'vitest';
import { readWeb, findPlace, connectionsBetween } from './webView.js';
import { buildContext } from '../../ContextBuilder.js';
import { deleteEdge } from '../deleteEdge.js';
import { updateEdge } from '../updateEdge.js';

// A pendulum web: Pendulum Length, Gravitational Acceleration and Oscillation
// Period drawn as themselves, and the formula Pendulum Period drawing its own
// symbols for the same Things (T, L, g), one operation between L and g.
const state = () => ({
  activeGraphId: 'w',
  openGraphIds: ['w'],
  graphs: [
    {
      id: 'w', name: 'Clock', edgeIds: ['takes', 'sets', 'swings', 'divide', 'own'],
      instances: [
        { id: 'pend', prototypeId: 'P' },
        { id: 'pL', prototypeId: 'L' }, { id: 'pG', prototypeId: 'G' }, { id: 'pT', prototypeId: 'T' },
        { id: 'anchor', prototypeId: 'F' },
        { id: 'sT', prototypeId: 'T' }, { id: 'sL', prototypeId: 'L' }, { id: 'sG', prototypeId: 'G' },
      ],
    },
    { id: 'law', name: 'Elsewhere', edgeIds: [], instances: [{ id: 'far', prototypeId: 'X' }] },
  ],
  nodePrototypes: [
    { id: 'P', name: 'Pendulum' }, { id: 'L', name: 'Pendulum Length' }, { id: 'G', name: 'Gravitational Acceleration' },
    { id: 'T', name: 'Oscillation Period' }, { id: 'F', name: 'Pendulum Period' }, { id: 'X', name: 'Far Thing' },
    { id: 'tTakes', name: 'Takes Input' }, { id: 'tSets', name: 'Sets' }, { id: 'tSwings', name: 'Swings Under' },
    { id: 'tDiv', name: 'Division' }, { id: 'tRel', name: 'Relates' },
  ],
  edges: [
    { id: 'takes', sourceId: 'anchor', destinationId: 'pL', definitionNodeIds: ['tTakes'] },
    { id: 'sets', sourceId: 'pL', destinationId: 'pT', definitionNodeIds: ['tSets'] },
    { id: 'swings', sourceId: 'pend', destinationId: 'sG', definitionNodeIds: ['tSwings'] },
    { id: 'divide', sourceId: 'sL', destinationId: 'sG', definitionNodeIds: ['tDiv'] },
    { id: 'own', sourceId: 'anchor', destinationId: 'sL', definitionNodeIds: ['tRel'] },
  ],
  formulas: [{
    graphId: 'w', anchorId: 'anchor', title: 'Pendulum Period', text: 'T = L / g', shown: 'formula',
    terms: [
      { symbol: 'T', thing: 'Oscillation Period', instanceId: 'sT', protoId: 'T' },
      { symbol: 'L', thing: 'Pendulum Length', instanceId: 'sL', protoId: 'L' },
      { symbol: 'g', thing: 'Gravitational Acceleration', instanceId: 'sG', protoId: 'G' },
    ],
    memberIds: ['sT', 'sL', 'sG'],
  }],
});

describe('readWeb and findPlace', () => {
  it('reads a bare name as the Thing drawn as itself, a symbol by its full name', () => {
    const web = readWeb(state(), 'w');
    expect(findPlace(web, 'Pendulum Length').instanceId).toBe('pL');
    expect(findPlace(web, 'pendulum  length').instanceId).toBe('pL');
    expect(findPlace(web, 'Pendulum Length (in Pendulum Period)').instanceId).toBe('sL');
    expect(findPlace(web, 'Pendulum Period').instanceId).toBe('anchor');
    expect(findPlace(web, 'L').instanceId).toBe('pL'); // a prototype id: the Thing drawn as itself
    expect(findPlace(web, 'sG').instanceId).toBe('sG');
    expect(findPlace(web, 'Far Thing')).toBeNull(); // another web's Thing is not this web's
  });

  it('reads a bare name as the symbol when no Thing of that name is drawn as itself', () => {
    const s = state();
    s.graphs[0].instances = s.graphs[0].instances.filter(i => i.id !== 'pG');
    expect(findPlace(readWeb(s, 'w'), 'Gravitational Acceleration').instanceId).toBe('sG');
  });

  it('leaves a formula\'s operations, and its connections to its own symbols, out of the web\'s connections', () => {
    expect(readWeb(state(), 'w').connections.map(e => e.id)).toEqual(['takes', 'sets', 'swings']);
  });
});

describe('what the wizard is shown leads back to it', () => {
  it('every connection in the context, read back by its names, is that connection', () => {
    const gs = state();
    const ctx = buildContext(gs);
    const lines = ctx.slice(ctx.indexOf('Connections:')).split('\n').slice(1).filter(l => l.startsWith('  - '));
    const web = readWeb(gs, 'w');
    expect(lines).toHaveLength(web.connections.length);
    for (const line of lines) {
      const [, a, type, b] = line.match(/^ {2}- (.+) --\[(.+)\]--> (.+)$/);
      const found = connectionsBetween(web, a, b);
      expect(found).toHaveLength(1);
      expect(gs.nodePrototypes.find(p => p.id === found[0].definitionNodeIds[0]).name).toBe(type);
    }
    expect(ctx).toContain('Pendulum --[Swings Under]--> Gravitational Acceleration (in Pendulum Period)');
  });
});

describe('connection tools on the shared reading', () => {
  it('deleteEdge never reaches a formula\'s operation, by names or by id', async () => {
    const byNames = await deleteEdge({ sourceName: 'Pendulum Length (in Pendulum Period)', targetName: 'Gravitational Acceleration (in Pendulum Period)' }, state());
    expect(byNames.action).toBeUndefined();
    const byId = await deleteEdge({ edgeId: 'divide' }, state());
    expect(byId.action).toBeUndefined();
    expect(byId.message).toMatch(/operations of the formula "Pendulum Period"/);
  });

  it('deleteEdge and updateEdge find the connection drawn to the symbol by its full name', async () => {
    const del = await deleteEdge({ sourceName: 'Pendulum', targetName: 'Gravitational Acceleration (in Pendulum Period)' }, state());
    expect(del).toMatchObject({ action: 'deleteEdge', edgeId: 'swings' });
    const upd = await updateEdge({ sourceName: 'Pendulum Period', targetName: 'Pendulum Length', type: 'Uses' }, state());
    expect(upd).toMatchObject({ action: 'updateEdge', edgeId: 'takes', targetInstanceId: 'pL' });
  });
});
