import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { projectGraphView, openGroupId } from '../../src/core/openDefinitions.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';
import { formulaWeb } from './formulaWeb.js';

/**
 * An equation's size is its node's: folded it is that Size of Thing, open that
 * Size of equation (graphStore moveFormat).
 */
const setUp = (box) => {
  const defWeb = formulaWeb({ things: [['a', 'a', 0], ['b', 'b', 200]], ops: [['a', 'b', 'Addition']] });
  const def = { ...defWeb.graphs.get('web'), id: 'def' };
  const nodePrototypes = new Map(defWeb.nodePrototypes);
  nodePrototypes.set('eq', { id: 'eq', name: 'Sum', color: '#8B0000', definitionGraphIds: ['def'] });
  useGraphStore.setState({
    activeGraphId: 'web',
    graphs: new Map([
      ['web', { id: 'web', name: 'Web', instances: new Map([['box', { id: 'box', prototypeId: 'eq', x: 100, y: 100, ...box }]]), edgeIds: [], groups: new Map() }],
      ['def', def],
    ]),
    nodePrototypes,
    edges: defWeb.edges,
  });
};
const OPEN = { format: 'formula', openDefinition: { index: 0, offset: { x: 0, y: 0 } } };
const box = () => useGraphStore.getState().graphs.get('web').instances.get('box');

describe('an equation opened in place', () => {
  beforeEach(() => setUp({ ...OPEN, sizeMul: 1.5 }));

  it('is drawn at its node\'s size', () => {
    expect(projectGraphView(useGraphStore.getState(), 'web').groups.get(openGroupId('box')).formulaSize).toBe(1.5);
  });

  it('sizes its node when it is sized', () => {
    useGraphStore.getState().updateGroup('web', openGroupId('box'), (g) => { g.formulaSize = 2; });
    expect(box().sizeMul).toBe(2);
    expect(box().formulaSize).toBeUndefined();
    useGraphStore.getState().updateGroup('web', openGroupId('box'), (g) => { delete g.formulaSize; });
    expect(box().sizeMul).toBeUndefined();
    expect(box().format).toBe('formula');
  });
});

describe('a file from before', () => {
  const saved = (instance) => {
    setUp(instance);
    return exportToRedstring(useGraphStore.getState());
  };
  const withOldSize = (exported, size) => {
    const text = JSON.stringify(exported);
    // An instance as an older build wrote it, with its formula's own size.
    return JSON.parse(text.replace('"redstring:format":"formula"', `"redstring:format":"formula","redstring:formulaSize":${size}`));
  };

  it('writes no size of its own for an equation', () => {
    const exported = saved({ ...OPEN, sizeMul: 2 });
    const written = exported.spatialGraphs.graphs.web['redstring:instances'].box;
    expect(written['redstring:formulaSize']).toBeUndefined();
    expect(written['redstring:visualProperties']['redstring:sizeMultiplier']).toBe(2);
  });

  it('gives an open equation\'s own size to its node', () => {
    const exported = saved({ ...OPEN });
    const read = importFromRedstring(withOldSize(exported, 2)).storeState.graphs.get('web').instances.get('box');
    expect(read.sizeMul).toBe(2);
    expect(read.formulaSize).toBeUndefined();
  });

  it('keeps a folded node\'s size over its formula\'s', () => {
    const exported = saved({ format: 'formula', sizeMul: 0.75 });
    const read = importFromRedstring(withOldSize(exported, 2)).storeState.graphs.get('web').instances.get('box');
    expect(read.sizeMul).toBe(0.75);
    expect(read.formulaSize).toBeUndefined();
  });
});
