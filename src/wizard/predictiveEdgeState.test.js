import { describe, it, expect } from 'vitest';
import { updateGraphState } from './AgentLoop.js';
import { readGraph } from './tools/readGraph.js';

// The agent's picture of the graph has to follow edge edits within a turn, or a
// delete followed by an update on the same pair reads as success to the model
// and fails at the store.
function makeState() {
  return {
    activeGraphId: 'g1',
    nodePrototypes: [
      { id: 'p-turn', name: 'Worker Turnover & Job Vacancies' },
      { id: 'p-emp', name: 'Overall Low-Wage Employment' },
      { id: 'p-wage', name: 'Statutory Minimum Wage Rate' },
    ],
    graphs: [{
      id: 'g1',
      name: 'Minimum Wage',
      instances: [
        { id: 'i-turn', prototypeId: 'p-turn' },
        { id: 'i-emp', prototypeId: 'p-emp' },
        { id: 'i-wage', prototypeId: 'p-wage' },
      ],
      edgeIds: ['e1'],
    }],
    edges: [{ id: 'e1', sourceId: 'i-turn', destinationId: 'i-emp', type: 'Affects', definitionNodeIds: [] }],
  };
}

const triplets = async (state) => (await readGraph({}, state)).edges.map(e => e.triplet);

describe('predictive edge state', () => {
  it('deleteEdge by names removes the edge from what the model reads back', async () => {
    const state = makeState();
    updateGraphState(state, 'deleteEdge', {}, {
      action: 'deleteEdge', graphId: 'g1', edgeId: null,
      sourceName: 'Worker Turnover & Job Vacancies', targetName: 'Overall Low-Wage Employment',
    });
    expect(await triplets(state)).toEqual([]);
  });

  it('updateEdge on a deleted pair recreates it, as the applier does', async () => {
    const state = makeState();
    updateGraphState(state, 'deleteEdge', {}, {
      action: 'deleteEdge', graphId: 'g1',
      sourceName: 'Worker Turnover & Job Vacancies', targetName: 'Overall Low-Wage Employment',
    });
    updateGraphState(state, 'updateEdge', {}, {
      action: 'updateEdge', graphId: 'g1',
      sourceName: 'Worker Turnover & Job Vacancies', targetName: 'Overall Low-Wage Employment',
      sourceInstanceId: 'i-turn', targetInstanceId: 'i-emp',
      updates: { type: 'Moderates Losses In' },
    });
    expect(await triplets(state)).toEqual([
      'Worker Turnover & Job Vacancies --[Moderates Losses In]--> Overall Low-Wage Employment',
    ]);
  });

  it('updateEdge retypes an existing edge in either direction', async () => {
    const state = makeState();
    updateGraphState(state, 'updateEdge', {}, {
      action: 'updateEdge', graphId: 'g1',
      sourceName: 'Overall Low-Wage Employment', targetName: 'Worker Turnover & Job Vacancies',
      updates: { type: 'Reduces Separation Rates & Vacancy Duration' },
    });
    expect(await triplets(state)).toEqual([
      'Worker Turnover & Job Vacancies --[Reduces Separation Rates & Vacancy Duration]--> Overall Low-Wage Employment',
    ]);
  });

  it('createEdge and replaceEdges show up in the model\'s read-back', async () => {
    const state = makeState();
    updateGraphState(state, 'createEdge', {}, {
      action: 'createEdge', graphId: 'g1', type: 'Raises',
      sourceName: 'Statutory Minimum Wage Rate', targetName: 'Overall Low-Wage Employment',
      sourceInstanceId: 'i-wage', targetInstanceId: 'i-emp',
    });
    updateGraphState(state, 'replaceEdges', {}, {
      action: 'replaceEdges', graphId: 'g1',
      replacements: [
        { source: 'Worker Turnover & Job Vacancies', target: 'Overall Low-Wage Employment', type: 'Stabilizes' },
        { source: 'Statutory Minimum Wage Rate', target: 'Worker Turnover & Job Vacancies', type: 'Reduces' },
      ],
    });
    expect((await triplets(state)).sort()).toEqual([
      'Statutory Minimum Wage Rate --[Raises]--> Overall Low-Wage Employment',
      'Statutory Minimum Wage Rate --[Reduces]--> Worker Turnover & Job Vacancies',
      'Worker Turnover & Job Vacancies --[Stabilizes]--> Overall Low-Wage Employment',
    ]);
  });
});
