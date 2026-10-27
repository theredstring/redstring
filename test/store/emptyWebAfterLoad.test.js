import { describe, it, expect, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import useGraphStore from '../../src/store/graphStore.js';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';
import { buildFormulaInWeb } from '../../src/components/canvas/formats/formula/buildFormula.js';

// A web with no connections is written without any, and read back with no
// connection list at all. Writing a formula into it after reopening threw
// (pasteNodesAndEdges pushed onto the missing list); the same for others'
// changes applied in a shared universe.
describe('an empty web after the universe is reopened', () => {
  const reopened = () => {
    useGraphStore.getState().clearUniverse();
    useGraphStore.getState().createNewGraph({ id: 'empty', name: 'Empty' });
    const file = JSON.parse(JSON.stringify(exportToRedstring(useGraphStore.getState())));
    expect(useGraphStore.getState().loadUniverseFromFile(file)).toBe(true);
  };

  it('has a connection list', () => {
    reopened();
    expect(useGraphStore.getState().graphs.get('empty').edgeIds).toEqual([]);
  });

  it('takes a formula', () => {
    reopened();
    expect(() => buildFormulaInWeb('a + b', 'empty', { x: 0, y: 0 }, { convention: 'math', isKnownName: () => false })).not.toThrow();
    expect(useGraphStore.getState().edges.size).toBeGreaterThan(0);
  });
});
