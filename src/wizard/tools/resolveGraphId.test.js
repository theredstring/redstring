import { describe, it, expect } from 'vitest';
import { resolveGraphId, describeGraphAmbiguity } from './resolveGraphId.js';

const g = (id, name, extra = {}) => ({ id, name, instances: [], ...extra });

describe('resolveGraphId', () => {
  it('returns an exact ID untouched', () => {
    const graphs = [g('id-1', 'Alpha'), g('id-2', 'Beta')];
    expect(resolveGraphId('id-2', graphs)).toBe('id-2');
  });

  it('prefers the active graph when its name matches', () => {
    const graphs = [g('old', 'Physics'), g('current', 'Physics')];
    expect(resolveGraphId('Physics', graphs, { activeGraphId: 'current' })).toBe('current');
  });

  it('prefers the parent graph that contains the active graph\'s defining node', () => {
    const graphs = [
      g('unrelated', 'Systems'),
      g('parent', 'Systems', { instances: [{ id: 'i1', prototypeId: 'defining-proto' }] }),
      g('active', 'Inner', { definingNodeIds: ['defining-proto'] })
    ];
    expect(resolveGraphId('Systems', graphs, { activeGraphId: 'active' })).toBe('parent');
  });

  it('picks the MOST RECENT same-named graph, not the oldest', () => {
    // The reported bug. Graph collections iterate in insertion order, so a
    // long-lived universe accumulates same-named graphs from old sessions and
    // taking the first match reliably resolved to a stale one the user has not
    // touched in weeks — "readGraph opened a random graph".
    const graphs = [
      g('from-january', 'Web Application'),
      g('from-march', 'Web Application'),
      g('built-just-now', 'Web Application')
    ];
    expect(resolveGraphId('Web Application', graphs, {})).toBe('built-just-now');
  });

  it('prefers an open tab over a more recent archived graph', () => {
    const graphs = [
      g('open-one', 'Notes'),
      g('archived-newer', 'Notes')
    ];
    const resolved = resolveGraphId('Notes', graphs, {
      activeGraphId: 'somewhere-else',
      openGraphIds: ['somewhere-else', 'open-one']
    });
    expect(resolved).toBe('open-one');
  });

  it('picks the open tab nearest the active one', () => {
    const graphs = [g('far', 'Notes'), g('near', 'Notes')];
    const resolved = resolveGraphId('Notes', graphs, {
      activeGraphId: 'active',
      openGraphIds: ['far', 'x', 'y', 'active', 'near']
    });
    expect(resolved).toBe('near');
  });

  it('falls back to most-recent when no match is open', () => {
    const graphs = [g('a', 'Notes'), g('b', 'Notes')];
    const resolved = resolveGraphId('Notes', graphs, {
      activeGraphId: 'active',
      openGraphIds: ['active', 'unrelated']
    });
    expect(resolved).toBe('b');
  });

  it('still resolves partial matches, most recent first', () => {
    const graphs = [g('old', 'Cell Biology Notes'), g('new', 'Cell Biology Draft')];
    expect(resolveGraphId('Cell Biology', graphs, {})).toBe('new');
  });

  it('treats "active" and "current" as sentinels for the active graph', () => {
    const graphs = [g('a', 'Alpha')];
    expect(resolveGraphId('active', graphs, { activeGraphId: 'a' })).toBe('a');
    expect(resolveGraphId('current', graphs, { activeGraphId: 'a' })).toBe('a');
  });

  it('returns the input unchanged when nothing matches', () => {
    expect(resolveGraphId('Nonexistent', [g('a', 'Alpha')], {})).toBe('Nonexistent');
  });
});

describe('describeGraphAmbiguity', () => {
  it('reports when a name matched several graphs', () => {
    const graphs = [g('one', 'Physics'), g('two', 'Physics')];
    const note = describeGraphAmbiguity('Physics', graphs, 'two');

    expect(note).toContain('matches 2 graphs');
    expect(note).toContain('two');
    expect(note).toContain('one');
  });

  it('stays quiet for an unambiguous name', () => {
    const graphs = [g('one', 'Physics'), g('two', 'Chemistry')];
    expect(describeGraphAmbiguity('Physics', graphs, 'one')).toBeNull();
  });

  it('stays quiet when an explicit ID was given', () => {
    const graphs = [g('one', 'Physics'), g('two', 'Physics')];
    expect(describeGraphAmbiguity('one', graphs, 'one')).toBeNull();
  });
});
