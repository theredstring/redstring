import { describe, it, expect, vi, beforeEach } from 'vitest';

// utils.js measures text when it loads; jsdom has no 2D context.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    return { font: '', measureText: (text) => ({ width: text.length * 8 }) };
  };
});
// Enrichment fetches from the network; placement only needs it called.
vi.mock('../../src/services/conceptEnrichment.js', () => ({ enrichPrototypeFromLinks: vi.fn() }));

import useGraphStore from '../../src/store/graphStore.js';
import { placeOrbitCandidate } from '../../src/components/canvas/orbit/orbitActions.js';
import { enrichPrototypeFromLinks } from '../../src/services/conceptEnrichment.js';

// Placing a semantic-orbit candidate (moved out of NodeCanvas): a new saved
// prototype, an instance centred on the drop point, and an edge from the
// focused node named after the predicate.
const st = () => useGraphStore.getState();

function setup() {
  useGraphStore.setState({
    graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), openGraphIds: [], activeGraphId: null,
    savedNodeIds: new Set(), savedGraphIds: new Set(), isUniverseLoaded: true, hasUniverseFile: true,
  }, false, 'test_reset');
  st().addNodePrototype({ id: 'p-focus', name: 'Focus', description: '', color: '#111111', typeNodeId: null, definitionGraphIds: [] });
  st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
  const graphId = st().activeGraphId;
  st().addNodeInstance(graphId, 'p-focus', { x: 0, y: 0 }, 'i-focus');
  return graphId;
}

const candidate = {
  name: 'Ada Lovelace', color: '#8B0000', source: 'wikidata', uri: 'http://www.wikidata.org/entity/Q7259',
  predicate: 'influencedBy', externalLinks: ['http://www.wikidata.org/entity/Q7259'], score: 0.9,
};

describe('placeOrbitCandidate', () => {
  let graphId;
  let exitOrbitMode;
  const ctx = () => ({
    activeGraphId: graphId, exitOrbitMode, gridMode: 'off', nodePrototypesMap: st().nodePrototypes,
    selectedInstanceIds: new Set(['i-focus']), snapToGridAnimated: vi.fn(), storeActions: st(),
  });
  beforeEach(() => {
    graphId = setup();
    exitOrbitMode = vi.fn();
    vi.mocked(enrichPrototypeFromLinks).mockClear();
  });

  it('adds a saved prototype, centres an instance on the point, links it from the focus, and exits orbit', () => {
    placeOrbitCandidate(candidate, 500, 300, null, ctx());

    const proto = [...st().nodePrototypes.values()].find((p) => p.name === 'Ada Lovelace');
    expect(proto).toBeTruthy();
    expect(st().savedNodeIds.has(proto.id)).toBe(true);
    // B-16: and so is the predicate node it created. (addNodePrototype saves a
    // new prototype; a toggle after it used to unsave both.)
    expect(enrichPrototypeFromLinks).toHaveBeenCalledWith(proto.id, expect.anything());

    const inst = [...st().graphs.get(graphId).instances.values()].find((i) => i.prototypeId === proto.id);
    expect(inst).toBeTruthy();
    expect(inst.x).toBeLessThan(500);
    expect(inst.y).toBeLessThan(300);

    const edge = [...st().edges.values()].find((e) => e.destinationId === inst.id);
    expect(edge.sourceId).toBe('i-focus');
    expect(edge.provenance.predicate).toBe('influencedBy');
    const def = st().nodePrototypes.get(edge.definitionNodeIds[0]);
    expect(def.name.toLowerCase()).toBe(edge.name.toLowerCase());
    expect(st().savedNodeIds.has(def.id)).toBe(true);
    expect(exitOrbitMode).toHaveBeenCalledTimes(1);
  });

  it('reuses the prototype and the predicate node the second time', () => {
    placeOrbitCandidate(candidate, 500, 300, null, ctx());
    const protos = st().nodePrototypes.size;
    placeOrbitCandidate(candidate, 900, 300, null, ctx());
    expect(st().nodePrototypes.size).toBe(protos);
    expect([...st().graphs.get(graphId).instances.values()].filter((i) => i.prototypeId !== 'p-focus')).toHaveLength(2);
  });

  it('snaps through the grid when the grid is on', () => {
    const snap = vi.fn(() => ({ x: 400, y: 200 }));
    placeOrbitCandidate(candidate, 500, 300, null, { ...ctx(), gridMode: 'always', snapToGridAnimated: snap });
    expect(snap).toHaveBeenCalledWith(500, 300, expect.any(Number), expect.any(Number), null);
    const inst = [...st().graphs.get(graphId).instances.values()].find((i) => i.prototypeId !== 'p-focus');
    expect([inst.x, inst.y]).toEqual([400, 200]);
  });
});
