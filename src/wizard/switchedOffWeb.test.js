import { describe, it, expect } from 'vitest';
import { switchedOffWebId, switchedOffWebRefusal, ADDS_TO_A_WEB } from './switchedOffWeb.js';
import { getToolDefinitions } from './tools/schemas.js';

const graphState = {
  activeGraphId: 'g-body',
  graphs: [{ id: 'g-body', name: 'Body' }, { id: 'g-new', name: 'Jazz' }]
};
const off = [{ type: 'activeGraph', id: 'g-body', enabled: false }];

describe('switchedOffWebId', () => {
  it('is the chip\'s web when it is off, and null when it is on or missing', () => {
    expect(switchedOffWebId(graphState, off)).toBe('g-body');
    expect(switchedOffWebId(graphState, [{ type: 'activeGraph', id: 'g-body', enabled: true }])).toBeNull();
    expect(switchedOffWebId(graphState, [])).toBeNull();
  });
});

describe('switchedOffWebRefusal', () => {
  it('refuses an add with no target that would land in the switched-off web', () => {
    const r = switchedOffWebRefusal('expandGraph', { nodes: [] }, graphState, 'g-body');
    expect(r.locked).toBe(true);
    expect(r.message).toContain('targetGraphId="g-body"');
  });

  it('lets through an add that names a web, one made after moving away, and reads', () => {
    expect(switchedOffWebRefusal('expandGraph', { targetGraphId: 'g-body' }, graphState, 'g-body')).toBeNull();
    expect(switchedOffWebRefusal('createNode', {}, { ...graphState, activeGraphId: 'g-new' }, 'g-body')).toBeNull();
    expect(switchedOffWebRefusal('createPopulatedGraph', {}, graphState, 'g-body')).toBeNull();
    expect(switchedOffWebRefusal('readGraph', {}, graphState, 'g-body')).toBeNull();
    expect(switchedOffWebRefusal('expandGraph', {}, graphState, null)).toBeNull();
  });

  it('names only real tools, each taking targetGraphId', () => {
    const defs = new Map(getToolDefinitions().map(t => [t.name, t]));
    for (const name of ADDS_TO_A_WEB) {
      expect(defs.has(name), name).toBe(true);
      expect(Object.keys(defs.get(name).parameters?.properties || {}), name).toContain('targetGraphId');
    }
  });
});
