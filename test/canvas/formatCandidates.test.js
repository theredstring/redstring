import { describe, it, expect } from 'vitest';
import { findFormatCandidate } from '../../src/components/canvas/formats/formatCandidates.js';

// (a + b) × c, drawn top-down, plus an unrelated Thing off to the side.
function webState({ withStray = true, grouped = false } = {}) {
  const protos = [
    ['p-times', '×'], ['p-plus', 'Addition'], ['p-a', 'a'], ['p-b', 'b'], ['p-c', 'c'], ['p-cat', 'Cat'],
  ];
  const nodePrototypes = new Map(protos.map(([id, name]) => [id, { id, name, color: '#8B0000' }]));
  const at = (id, prototypeId, x, y) => [id, { id, prototypeId, x, y }];
  const instances = new Map([
    at('times', 'p-times', 200, 0), at('plus', 'p-plus', 100, 200), at('c', 'p-c', 300, 200),
    at('a', 'p-a', 0, 400), at('b', 'p-b', 200, 400),
    ...(withStray ? [at('cat', 'p-cat', 900, 900)] : []),
  ]);
  const edgeList = [['times', 'plus'], ['times', 'c'], ['plus', 'a'], ['plus', 'b']].map(([s, d]) => ({
    id: `${s}-${d}`, sourceId: s, destinationId: d, directionality: { arrowsToward: new Set([d]) },
  }));
  const edges = new Map(edgeList.map(e => [e.id, e]));
  const groups = new Map(grouped ? [['g1', { id: 'g1', name: 'Area', memberInstanceIds: ['times', 'plus', 'c', 'a', 'b'] }]] : []);
  const graphs = new Map([['web', { id: 'web', name: 'Shapes', instances, edgeIds: edgeList.map(e => e.id), groups }]]);
  return { activeGraphId: 'web', graphs, nodePrototypes, edges, edgePrototypes: new Map() };
}

const none = { selectedInstanceIds: new Set(), selectedGroupId: null, dismissed: new Set() };

describe('format candidates', () => {
  it('offers the whole web when it is one formula', () => {
    const c = findFormatCandidate(webState({ withStray: false }), none);
    expect(c?.source).toBe('web');
    expect(c?.text).toBe('(a + b) × c');
  });

  it('does not offer a web with anything else in it', () => {
    expect(findFormatCandidate(webState(), none)).toBe(null);
  });

  it('offers a group that is one formula', () => {
    const c = findFormatCandidate(webState({ grouped: true }), none);
    expect(c?.source).toBe('group');
    expect(c?.label).toBe('Area');
  });

  it('offers a selection, and only the selection while it stands', () => {
    const state = webState();
    const sel = { ...none, selectedInstanceIds: new Set(['plus', 'a', 'b']) };
    expect(findFormatCandidate(state, sel)?.text).toBe('a + b');
    const notOne = { ...none, selectedInstanceIds: new Set(['plus', 'a', 'cat']) };
    expect(findFormatCandidate(webState({ grouped: true }), notOne)).toBe(null);
  });

  it('stays quiet once waved off, until the formula changes', () => {
    const state = webState({ grouped: true });
    const first = findFormatCandidate(state, none);
    expect(findFormatCandidate(state, { ...none, dismissed: new Set([first.key]) })).toBe(null);
    state.nodePrototypes.get('p-c').name = 'd';
    expect(findFormatCandidate(state, { ...none, dismissed: new Set([first.key]) })?.text).toBe('(a + b) × d');
  });

  it('does not offer Things already shown as a formula', () => {
    const state = webState({ grouped: true });
    state.graphs.get('web').groups.get('g1').format = 'formula';
    expect(findFormatCandidate(state, none)).toBe(null);
  });
});
