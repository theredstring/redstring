// A universe's custom connection types stay in that universe: loading another
// layered them into it (and into its file, and for a shared one, onto
// everyone's), and nothing could remove them.
import { describe, it, expect } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';

const universeWith = (edgeTypes) => {
  useGraphStore.getState().clearUniverse();
  useGraphStore.getState().createNewGraph({ id: 'web', name: 'Web' });
  for (const t of edgeTypes) useGraphStore.getState().addEdgePrototype(t);
  return JSON.parse(JSON.stringify(exportToRedstring(useGraphStore.getState())));
};

describe('connection types per universe', () => {
  it('loading a universe does not bring the previous one\'s types', () => {
    const shared = universeWith([]);
    const privateOne = universeWith([{ id: 'eats', name: 'eats', color: '#8B0000' }]);

    useGraphStore.getState().loadUniverseFromFile(privateOne);
    expect(useGraphStore.getState().edgePrototypes.has('eats')).toBe(true);

    useGraphStore.getState().loadUniverseFromFile(shared);
    const types = useGraphStore.getState().edgePrototypes;
    expect(types.has('eats')).toBe(false);
    expect(types.has('base-connection-prototype')).toBe(true);
  });

  it('a file without connection types still gets the built-in ones', () => {
    const file = universeWith([]);
    delete file.edgePrototypes;
    if (file.edgeSpace) delete file.edgeSpace.edgePrototypes;
    useGraphStore.getState().loadUniverseFromFile(file);
    expect(useGraphStore.getState().edgePrototypes.has('base-connection-prototype')).toBe(true);
    expect(useGraphStore.getState().edgePrototypes.has('agent-delegates-to')).toBe(true);
  });
});
