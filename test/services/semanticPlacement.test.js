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
vi.mock('../../src/services/canvasNavigationService.js', () => ({ navigateToNodes: vi.fn(), navigateToCoordinates: vi.fn() }));

import useGraphStore from '../../src/store/graphStore.js';
import { estimateEdgeLabelWidth, resolveEdgeLabelFontSize } from '../../src/services/layoutGeometry.js';
import {
  findPrototypeForConcept, ensureConceptPrototype, placeConcept, clustersOf, findPlacement, hasConnection
} from '../../src/services/semanticPlacement.js';

// Bringing a semantic-web Thing into a Web: one prototype per subject (found
// again by URI), placed beside its anchor or in open space, joined by the
// statement's connection pointing the way the statement reads.
const st = () => useGraphStore.getState();
const WD = (q) => `http://www.wikidata.org/entity/${q}`;
const concept = (name, q) => ({
  id: WD(q), name, color: '#446688', source: 'wikidata', description: '',
  semanticMetadata: { originalUri: WD(q), externalLinks: [WD(q)] }
});

let graphId;
function setup() {
  useGraphStore.setState({
    graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), openGraphIds: [], activeGraphId: null,
    savedNodeIds: new Set(), savedGraphIds: new Set(), isUniverseLoaded: true, hasUniverseFile: true,
  }, false, 'test_reset');
  st().addNodePrototype({ id: 'p-paris', name: 'Paris', description: '', color: '#111111', typeNodeId: null, definitionGraphIds: [], externalLinks: [WD('Q90')] });
  st().addNodePrototype({ id: 'p-seine', name: 'Seine', description: '', color: '#222222', typeNodeId: null, definitionGraphIds: [] });
  st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
  graphId = st().activeGraphId;
  st().addNodeInstance(graphId, 'p-paris', { x: 0, y: 0 }, 'i-paris');
  st().addNodeInstance(graphId, 'p-seine', { x: 400, y: 0 }, 'i-seine');
  st().addEdge(graphId, { id: 'e-1', sourceId: 'i-paris', destinationId: 'i-seine', name: 'Near' });
}

const boxesOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('semanticPlacement', () => {
  beforeEach(setup);

  it('finds a prototype by any shared URI, whoever made it', () => {
    expect(findPrototypeForConcept(concept('Paris, France', 'Q90'))?.id).toBe('p-paris');
    expect(findPrototypeForConcept(concept('Paris', 'Q167646'))).toBeNull();
  });

  it('makes a saved prototype once, then finds it again', () => {
    const first = ensureConceptPrototype(concept('France', 'Q142'));
    const second = ensureConceptPrototype(concept('France', 'Q142'));
    expect(second).toBe(first);
    expect(st().savedNodeIds.has(first)).toBe(true);
    expect(st().nodePrototypes.get(first).externalLinks).toContain(WD('Q142'));
  });

  it('treats connected Things as one cluster and a lone node as its own', () => {
    st().addNodePrototype({ id: 'p-lone', name: 'Lone', description: '', color: '#333', typeNodeId: null, definitionGraphIds: [] });
    st().addNodeInstance(graphId, 'p-lone', { x: 3000, y: 3000 }, 'i-lone');
    const { clusters } = clustersOf(graphId);
    expect(clusters.map((c) => c.ids.sort())).toEqual(expect.arrayContaining([['i-paris', 'i-seine'], ['i-lone']]));
  });

  it('places beside the anchor with room for the whole label, clear of its neighbours, facing away from them', () => {
    const label = 'Located In The Administrative Territorial Entity';
    const pos = findPlacement({ graphId, mode: 'cluster', anchorInstanceId: 'i-paris', size: { w: 150, h: 60 }, predicateLabel: label });
    const { boxes } = clustersOf(graphId);
    const placed = { ...pos, w: 150, h: 60 };
    boxes.forEach((b) => expect(boxesOverlap(placed, b)).toBe(false));

    // The gap between the two boxes' facing edges holds the label as the canvas draws it.
    const paris = boxes.get('i-paris');
    const s0 = useGraphStore.getState();
    const fontSize = resolveEdgeLabelFontSize(s0.textSettings, s0.connectionLabelSize);
    const gapX = Math.max(placed.x - (paris.x + paris.w), paris.x - (placed.x + placed.w));
    const gapY = Math.max(placed.y - (paris.y + paris.h), paris.y - (placed.y + placed.h));
    expect(Math.hypot(Math.max(0, gapX), Math.max(0, gapY))).toBeGreaterThanOrEqual(estimateEdgeLabelWidth(label, fontSize) * 0.9);

    // Seine is to the right of Paris, so the new Thing goes the other way.
    expect(placed.x + placed.w / 2).toBeLessThan(paris.x + paris.w / 2);
  });

  it('keeps the new connection from running through a neighbour when it can', () => {
    // Paris with neighbours above, left and right.
    st().addNodePrototype({ id: 'p-n', name: 'North', description: '', color: '#333', typeNodeId: null, definitionGraphIds: [] });
    st().addNodePrototype({ id: 'p-w', name: 'West', description: '', color: '#333', typeNodeId: null, definitionGraphIds: [] });
    st().addNodeInstance(graphId, 'p-n', { x: 0, y: -500 }, 'i-n');
    st().addNodeInstance(graphId, 'p-w', { x: -600, y: 0 }, 'i-w');
    const pos = findPlacement({ graphId, mode: 'cluster', anchorInstanceId: 'i-paris', size: { w: 150, h: 60 }, predicateLabel: 'Country' });
    const { boxes } = clustersOf(graphId);
    const paris = boxes.get('i-paris');
    const placed = { ...pos, w: 150, h: 60 };
    const from = { x: paris.x + paris.w / 2, y: paris.y + paris.h / 2 };
    const to = { x: placed.x + 75, y: placed.y + 30 };
    boxes.forEach((b, id) => {
      if (id === 'i-paris') return;
      expect(boxesOverlap(placed, b), `overlaps ${id}`).toBe(false);
      // Sampled along the line between the two nodes: none of it inside a neighbour.
      for (let t = 0; t <= 1; t += 0.02) {
        const x = from.x + (to.x - from.x) * t; const y = from.y + (to.y - from.y) * t;
        expect(x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h, `line runs through ${id}`).toBe(false);
      }
    });
  });

  it('still answers when nothing around the anchor is clear', () => {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 2 * Math.PI;
      st().addNodePrototype({ id: `p-r${i}`, name: `R${i}`, description: '', color: '#333', typeNodeId: null, definitionGraphIds: [] });
      st().addNodeInstance(graphId, `p-r${i}`, { x: Math.cos(a) * 700, y: Math.sin(a) * 700 }, `i-r${i}`);
    }
    const pos = findPlacement({ graphId, mode: 'cluster', anchorInstanceId: 'i-paris', size: { w: 150, h: 60 }, predicateLabel: 'Country' });
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true);
  });

  it('places in open space clear of every cluster', () => {
    const pos = findPlacement({ graphId, mode: 'open', origin: { x: 200, y: 20 }, size: { w: 150, h: 60 } });
    const { clusters } = clustersOf(graphId);
    const placed = { ...pos, w: 150, h: 60 };
    clusters.forEach((c) => {
      const zone = { x: c.minX - 200, y: c.minY - 200, w: c.maxX - c.minX + 400, h: c.maxY - c.minY + 400 };
      expect(boxesOverlap(placed, zone)).toBe(false);
    });
  });

  it('adds the other end connected by the predicate, arrowed the way the statement reads', () => {
    const out = placeConcept({ graphId, concept: concept('France', 'Q142'), anchorInstanceId: 'i-paris', predicate: 'country', direction: 'out' });
    const edgeOut = st().edges.get(out.edgeId);
    expect([edgeOut.sourceId, edgeOut.destinationId]).toEqual(['i-paris', out.instanceId]);
    expect(edgeOut.name).toBe('Country');
    expect(edgeOut.directionality.arrowsToward.has(out.instanceId)).toBe(true);
    expect(st().nodePrototypes.get(edgeOut.definitionNodeIds[0]).name).toBe('Country');

    const inc = placeConcept({ graphId, concept: concept('France', 'Q142'), anchorInstanceId: 'i-paris', predicate: 'capital', direction: 'in' });
    const edgeIn = st().edges.get(inc.edgeId);
    expect([edgeIn.sourceId, edgeIn.destinationId]).toEqual([inc.instanceId, 'i-paris']);
    expect(edgeIn.directionality.arrowsToward.has('i-paris')).toBe(true);
    // Both statements name the same France.
    expect(inc.prototypeId).toBe(out.prototypeId);
  });

  it("knows when the Web already says it", () => {
    expect(hasConnection(graphId, 'i-paris', concept('France', 'Q142'), 'Country')).toBe(false);
    placeConcept({ graphId, concept: concept('France', 'Q142'), anchorInstanceId: 'i-paris', predicate: 'Country' });
    expect(hasConnection(graphId, 'i-paris', concept('France', 'Q142'), 'Country')).toBe(true);
    expect(hasConnection(graphId, 'i-paris', concept('France', 'Q142'), 'Capital')).toBe(false);
  });

  it("joins the anchor's group when placed in its cluster, not when placed in open space", () => {
    st().createGroup(graphId, { name: 'City', memberInstanceIds: ['i-paris', 'i-seine'] });
    const group = [...st().graphs.get(graphId).groups.values()][0];

    const inCluster = placeConcept({ graphId, concept: concept('France', 'Q142'), anchorInstanceId: 'i-paris', predicate: 'Country', mode: 'cluster' });
    const open = placeConcept({ graphId, concept: concept('Europe', 'Q46'), anchorInstanceId: 'i-paris', predicate: 'Continent', mode: 'open' });

    const members = st().graphs.get(graphId).groups.get(group.id).memberInstanceIds;
    expect(members).toContain(inCluster.instanceId);
    expect(members).not.toContain(open.instanceId);
  });

  it('connects to the other end when it is already in the Web, rather than adding a copy', () => {
    // Found by URI: France was brought in once already.
    const first = placeConcept({ graphId, concept: concept('France', 'Q142'), anchorInstanceId: 'i-paris', predicate: 'Country' });
    const instances = st().graphs.get(graphId).instances.size;
    const second = placeConcept({ graphId, concept: concept('France', 'Q142'), anchorInstanceId: 'i-paris', predicate: 'Capital', direction: 'in' });
    expect(second.linked).toBe(true);
    expect(second.instanceId).toBe(first.instanceId);
    expect(st().graphs.get(graphId).instances.size).toBe(instances);
    const edge = st().edges.get(second.edgeId);
    expect([edge.sourceId, edge.destinationId]).toEqual([first.instanceId, 'i-paris']);
  });

  it('connects to a same-named Thing already in this Web, even one made by hand', () => {
    // Seine was made by hand: no links. The river concept is the same Seine.
    const before = st().nodePrototypes.size;
    const res = placeConcept({ graphId, concept: concept('Seine', 'Q1471'), anchorInstanceId: 'i-paris', predicate: 'Located Next To Body Of Water' });
    expect(res.linked).toBe(true);
    expect(res.instanceId).toBe('i-seine');
    // Nothing new made, nothing written onto the hand-made Thing.
    expect(st().nodePrototypes.get('p-seine').externalLinks || []).toEqual([]);
    expect(st().nodePrototypes.size).toBe(before + 1); // only the predicate's defining Thing
  });

  it('never draws the same statement twice', () => {
    placeConcept({ graphId, concept: concept('France', 'Q142'), anchorInstanceId: 'i-paris', predicate: 'Country' });
    const edges = st().edges.size;
    const again = placeConcept({ graphId, concept: concept('France', 'Q142'), anchorInstanceId: 'i-paris', predicate: 'Country' });
    expect(again.linked).toBe(true);
    expect(st().edges.size).toBe(edges);
  });

  it('adds a copy when the other end exists only elsewhere in the universe', () => {
    st().addNodePrototype({ id: 'p-france', name: 'France', description: '', color: '#333', typeNodeId: null, definitionGraphIds: [], externalLinks: [WD('Q142')] });
    const res = placeConcept({ graphId, concept: concept('France', 'Q142'), anchorInstanceId: 'i-paris', predicate: 'Country' });
    expect(res.linked).toBe(false);
    expect(res.prototypeId).toBe('p-france');
    expect(st().graphs.get(graphId).instances.get(res.instanceId).prototypeId).toBe('p-france');
  });

  it('places a lone concept with no anchor and makes no edge', () => {
    const edgesBefore = st().edges.size;
    const res = placeConcept({ graphId, concept: concept('Lyon', 'Q456'), mode: 'open' });
    expect(st().graphs.get(graphId).instances.has(res.instanceId)).toBe(true);
    expect(res.edgeId).toBeNull();
    expect(st().edges.size).toBe(edgesBefore);
  });
});
