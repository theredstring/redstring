import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import useGraphStore from '../../src/store/graphStore.js';
import { projectGraphView } from '../../src/core/openDefinitions.js';
import useHistoryStore from '../../src/store/historyStore.js';
import { applyToolResultToStore } from '../../src/services/toolResultApplier.js';
import { addFormulaForWizard } from '../../src/components/canvas/formats/formula/formulaWizard.js';
import { formulasForWizard } from '../../src/components/canvas/formats/formula/formulaSnapshot.js';

// A layer that uses an equation the universe has goes in as its formula:
// open in place when decomposed, folded when collapsed. Before, it went in as
// a plain node, or a Thing-group that didn't draw as a formula.

const st = () => useGraphStore.getState();
const web = (id) => ({ id, name: id, description: '', instances: new Map(), edgeIds: [], groups: new Map(), definingNodeIds: [] });

const reset = () => {
  useHistoryStore.setState({ history: [], currentIndex: -1 });
  useGraphStore.setState({
    graphs: new Map([['main', web('main')], ['lab', web('lab')]]),
    nodePrototypes: new Map(),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    openDefinitionsInPlace: true,
  });
  // The equation, written in another web: its Thing has a web that reads as it.
  addFormulaForWizard({ graphId: 'lab', text: 'P V = n R T', title: 'Ideal Gas Law', meanings: [{ symbol: 'P', thing: 'Pressure' }] });
};

const formulasIn = (graphId) => formulasForWizard(st()).formulas.filter(f => f.graphId === graphId);
const edgesIn = (graphId) => st().graphs.get(graphId).edgeIds.map(id => st().edges.get(id)).filter(Boolean);
const gasLaw = () => [...st().nodePrototypes.values()].find(p => p.name === 'Ideal Gas Law');

const build = (spec) => applyToolResultToStore('buildComposition', {
  action: 'buildComposition', graphId: 'main', enrich: false, spec,
});

describe('a layer that uses an equation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const k of ['log', 'warn', 'info', 'debug']) vi.spyOn(console, k).mockImplementation(() => {});
    reset();
  });

  it('decomposed: opens in place as its formula, and a connection by name reaches it', () => {
    build({
      nodes: [{ name: 'Gas' }],
      edges: [{ source: 'Gas', target: 'Ideal Gas Law', type: 'obeys' }],
      layers: [{ name: 'Ideal Gas Law', use: 'Ideal Gas Law', display: 'decomposed' }],
    });

    const shown = formulasIn('main');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ shown: 'open', equationProtoId: gasLaw().id, text: 'P × V = n × R × T' });

    const anchor = st().graphs.get('main').instances.get(shown[0].anchorId);
    expect(anchor.format).toBe('formula');
    // One Ideal Gas Law here, not a plain node beside the formula.
    const ofIt = [...st().graphs.get('main').instances.values()].filter(i => i.prototypeId === gasLaw().id && !i.isGroupAnchor);
    expect(ofIt).toHaveLength(1);
    // The reused Thing, not a copy.
    expect([...st().nodePrototypes.values()].filter(p => p.name === 'Ideal Gas Law')).toHaveLength(1);

    const obeys = edgesIn('main').filter(e => e.destinationId === shown[0].anchorId || e.sourceId === shown[0].anchorId);
    expect(obeys).toHaveLength(1);
  });

  it('collapsed: a folded node that opens as its formula', () => {
    build({
      nodes: [{ name: 'Gas' }],
      edges: [{ source: 'Gas', target: 'Ideal Gas Law', type: 'obeys' }],
      layers: [{ name: 'Ideal Gas Law', use: 'Ideal Gas Law', display: 'collapsed' }],
    });

    const shown = formulasIn('main');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ shown: 'folded', equationProtoId: gasLaw().id });

    const obeys = edgesIn('main').filter(e => e.destinationId === shown[0].anchorId || e.sourceId === shown[0].anchorId);
    expect(obeys).toHaveLength(1);
  });

  it('through expandGraph too, without reporting a layer that failed to open', () => {
    const failed = vi.fn();
    window.addEventListener('rs-wizard-tool-failed', failed);
    applyToolResultToStore('expandGraph', {
      action: 'expandGraph', graphId: 'main', enrich: false,
      spec: { nodes: [], edges: [], layers: [{ name: 'Ideal Gas Law', use: 'Ideal Gas Law' }] },
    });
    window.removeEventListener('rs-wizard-tool-failed', failed);

    expect(formulasIn('main')).toEqual([expect.objectContaining({ shown: 'open', equationProtoId: gasLaw().id })]);
    expect(failed).not.toHaveBeenCalled();
  });

  it('a Thing that is not an equation still opens as a Thing-group', () => {
    st().addNodePrototype({ id: 'p-engine', name: 'Engine', color: '#8B0000', definitionGraphIds: [] });
    st().createDefinitionGraphWithId('g-engine', 'p-engine');
    st().addNodeInstance('g-engine', 'p-engine', { x: 0, y: 0 }, 'i-engine-self');
    st().addNodePrototype({ id: 'p-piston', name: 'Piston', color: '#8B0000', definitionGraphIds: [] });
    st().addNodeInstance('g-engine', 'p-piston', { x: 0, y: 0 }, 'i-piston');

    build({ layers: [{ name: 'Engine', use: 'Engine' }] });

    expect(formulasIn('main')).toHaveLength(0);
    // Opened in place on its node: a Thing-group of its definition, as drawn.
    const groups = [...projectGraphView(st(), 'main').groups.values()];
    expect(groups.some(g => g.linkedNodePrototypeId === 'p-engine' && g.isOpenDefinition)).toBe(true);
  });

  it('never resolves to an orbit catalog Thing of the same name', () => {
    st().addNodePrototype({ id: 'p-orbit-gas', name: 'Ideal Gas Law', color: '#888', definitionGraphIds: [], isOrbitCatalog: true });

    build({ layers: [{ name: 'Ideal Gas Law', use: 'Ideal Gas Law', display: 'collapsed' }] });

    expect(formulasIn('main')).toEqual([expect.objectContaining({ shown: 'folded', equationProtoId: gasLaw().id })]);
    const placed = [...st().graphs.get('main').instances.values()].map(i => i.prototypeId);
    expect(placed).not.toContain('p-orbit-gas');
  });
});
