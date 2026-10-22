import { describe, it, expect } from 'vitest';
import { findFormatCandidate } from '../../src/components/canvas/formats/formatCandidates.js';
import { formulaWeb } from './formulaWeb.js';

// (a + b) × c, its part a nested Thing-group, plus an unrelated Thing.
function webState({ withStray = true, grouped = false } = {}) {
  return formulaWeb({
    things: [['a', 'a', 0], ['b', 'b', 300], ['c', 'c', 700]],
    parts: [{ id: 'g', anchor: 'pa', name: 'a + b', members: ['a', 'b'], x: 150 }],
    ops: [['a', 'b', 'Addition'], ['pa', 'c', 'Multiplication']],
    top: grouped ? ['a', 'b', 'pa', 'c'] : null,
    extra: withStray ? [['cat', 'Cat', 1500, 900]] : [],
  });
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

  it('offers the outermost group that is one formula, not its parts', () => {
    const c = findFormatCandidate(webState({ grouped: true }), none);
    expect(c?.source).toBe('group');
    expect(c?.sourceId).toBe('top');
    expect(c?.text).toBe('(a + b) × c');
  });

  it('offers a selection, and only the selection while it stands', () => {
    const state = webState();
    const sel = { ...none, selectedInstanceIds: new Set(['a', 'b']) };
    expect(findFormatCandidate(state, sel)?.text).toBe('a + b');
    const notOne = { ...none, selectedInstanceIds: new Set(['a', 'cat']) };
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
    state.graphs.get('web').groups.get('top').format = 'formula';
    expect(findFormatCandidate(state, none)).toBe(null);
  });

  it('does not offer an equation\'s own Thing-group shown as its Things', () => {
    const state = webState({ grouped: true });
    const top = state.graphs.get('web').groups.get('top');
    top.linkedNodePrototypeId = 'p-a';
    expect(findFormatCandidate(state, none)).toBe(null);
    expect(findFormatCandidate(state, { ...none, selectedInstanceIds: new Set(['a', 'b', 'pa', 'c']) })).toBe(null);
  });

  it('does not offer the web that defines an equation\'s Thing, only a piece of it', () => {
    const state = webState({ withStray: false });
    expect(findFormatCandidate(state, none)?.source).toBe('web');
    state.graphs.get('web').definingNodeIds = ['eq'];
    state.graphs.set('elsewhere', { id: 'elsewhere', instances: new Map(), edgeIds: [],
      groups: new Map([['shown', { id: 'shown', memberInstanceIds: [], linkedNodePrototypeId: 'eq', linkedFormat: 'formula' }]]) });
    expect(findFormatCandidate(state, none)).toBe(null);
    expect(findFormatCandidate(state, { ...none, selectedInstanceIds: new Set(['a', 'b']) })?.text).toBe('a + b');
  });
});
