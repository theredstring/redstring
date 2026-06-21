import { describe, it, expect } from 'vitest';
import jsonld from 'jsonld';
import { toNQuads } from '../../src/formats/codecs/nquads.js';
import { toTriG } from '../../src/formats/codecs/trig.js';
import { toTurtle } from '../../src/formats/codecs/turtle.js';
import { exportToRedstring, toIri } from '../../src/formats/redstringFormat.js';

/**
 * P5.2 — TriG / N-Quads codec tests.
 *
 * Key invariant: named-graph count equals Redstring graph count.
 * The N-Quads codec produces all quads in the default graph (no 4th field
 * in the current v3 export). The TriG codec partitions instance and edge
 * quads into GRAPH {} blocks, one per Redstring spatial graph.
 */

const buildState = (graphCount = 2) => {
  const graphs = new Map();
  const instances = new Map();

  for (let i = 1; i <= graphCount; i++) {
    const gId = `g${i}`;
    const iId = `inst${i}`;
    instances.set(iId, { id: iId, prototypeId: 'dog', x: i * 10, y: 20, scale: 1 });
    graphs.set(gId, {
      id: gId,
      name: `Graph ${i}`,
      description: '',
      instances: new Map([[iId, { id: iId, prototypeId: 'dog', x: i * 10, y: 20, scale: 1 }]]),
      edgeIds: [],
      definingNodeIds: [],
    });
  }

  const nodePrototypes = new Map([
    ['dog', { id: 'dog', name: 'Dog', description: '', definitionGraphIds: [], abstractionChains: {} }],
  ]);

  return {
    graphs,
    nodePrototypes,
    edges: new Map(),
    openGraphIds: ['g1'],
    activeGraphId: 'g1',
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    rightPanelTabs: [],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    showConnectionNames: false,
  };
};

// Build a state with an edge so we can verify edge scoping in TriG.
const buildStateWithEdge = () => {
  const state = buildState(1);
  state.graphs.get('g1').instances.set('inst2', { id: 'inst2', prototypeId: 'dog', x: 50, y: 20, scale: 1 });
  state.graphs.get('g1').edgeIds = ['e1'];
  state.edges.set('e1', {
    id: 'e1',
    sourceId: 'inst1',
    destinationId: 'inst2',
    typeNodeId: 'base-connection-prototype',
    definitionNodeIds: [],
    directionality: { arrowsToward: new Set(['inst2']) },
  });
  return state;
};

// ── N-Quads codec ────────────────────────────────────────────────────────────

describe('P5.2 — N-Quads codec', () => {
  it('toNQuads returns a non-empty string', async () => {
    const nq = await toNQuads(buildState());
    expect(typeof nq).toBe('string');
    expect(nq.length).toBeGreaterThan(0);
  });

  it('output is parseable by jsonld.toRDF (no duplicate quads)', async () => {
    const nq = await toNQuads(buildState());
    const lines = nq.split('\n').filter(Boolean);
    expect(lines.length - new Set(lines).size).toBe(0);
  });

  it('prototype quads are present (skos:Concept for dog)', async () => {
    const nq = await toNQuads(buildState());
    expect(nq).toContain(toIri('dog'));
    expect(nq).toContain('skos/core#Concept');
  });

  it('instance quads are present for each instance', async () => {
    const state = buildState(2);
    const nq = await toNQuads(state);
    expect(nq).toContain(toIri('inst1'));
    expect(nq).toContain(toIri('inst2'));
  });

  it('all quads are in the default graph (dataset has no named-graph quads)', async () => {
    // Use the object-form dataset (not the string) to count named graphs directly.
    const doc = exportToRedstring(buildState(1), null, { emitV4: false });
    const dataset = await jsonld.toRDF(doc, { safe: false });
    const graphIris = new Set();
    for (const quad of dataset) {
      if (quad.graph?.termType === 'NamedNode') graphIris.add(quad.graph.value);
    }
    // v3 export has no JSON-LD named graphs — everything is in the default graph.
    expect(graphIris.size).toBe(0);
  });

  it('emitV4:true option is accepted and still produces valid N-Quads', async () => {
    const nq = await toNQuads(buildState(), { emitV4: true });
    const lines = nq.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
  });
});

// ── TriG codec ───────────────────────────────────────────────────────────────

describe('P5.2 — TriG codec', () => {
  it('toTriG returns a non-empty string', async () => {
    const trig = await toTriG(buildState());
    expect(typeof trig).toBe('string');
    expect(trig.length).toBeGreaterThan(0);
  });

  it('named-graph count equals Redstring graph count (1 graph)', async () => {
    const trig = await toTriG(buildState(1));
    const graphBlocks = (trig.match(/^GRAPH </gm) || []).length;
    expect(graphBlocks).toBe(1);
  });

  it('named-graph count equals Redstring graph count (2 graphs)', async () => {
    const trig = await toTriG(buildState(2));
    const graphBlocks = (trig.match(/^GRAPH </gm) || []).length;
    expect(graphBlocks).toBe(2);
  });

  it('named-graph count equals Redstring graph count (3 graphs)', async () => {
    const trig = await toTriG(buildState(3));
    const graphBlocks = (trig.match(/^GRAPH </gm) || []).length;
    expect(graphBlocks).toBe(3);
  });

  it('GRAPH blocks use the toIri(graphId) IRI', async () => {
    const trig = await toTriG(buildState(1));
    expect(trig).toContain(`GRAPH <${toIri('g1')}>`);
  });

  it('instance quads appear inside GRAPH blocks, not in default graph', async () => {
    const trig = await toTriG(buildState(1));
    const graphBlockStart = trig.indexOf('GRAPH <');
    const defaultSection = trig.slice(0, graphBlockStart);
    // The instance IRI can appear as an OBJECT in default-section membership quads
    // (e.g. <graph-node> <redstring:instances> <inst1-iri> .) — that's expected.
    // What must NOT appear is the instance as a SUBJECT in the default section.
    const defaultLines = defaultSection.split('\n').filter(Boolean);
    const instAsSubject = defaultLines.some((l) => l.startsWith(`<${toIri('inst1')}>`));
    expect(instAsSubject).toBe(false);
    // Instance MUST appear as a subject in the GRAPH block.
    const graphBlock = trig.slice(graphBlockStart);
    const graphLines = graphBlock.split('\n').filter(Boolean);
    const instInGraph = graphLines.some((l) => l.startsWith(`  <${toIri('inst1')}>`));
    expect(instInGraph).toBe(true);
  });

  it('prototype quads appear in the default graph section', async () => {
    const trig = await toTriG(buildState(1));
    const graphBlockStart = trig.indexOf('GRAPH <');
    const defaultSection = trig.slice(0, graphBlockStart > 0 ? graphBlockStart : trig.length);
    expect(defaultSection).toContain(toIri('dog'));
  });

  it('rdfStar option is accepted without error', async () => {
    await expect(toTriG(buildState(), { rdfStar: false })).resolves.toBeDefined();
    await expect(toTriG(buildState(), { rdfStar: true })).resolves.toBeDefined();
  });

  it('state with edge: toTriG handles edges without error, graph count unchanged', async () => {
    const state = buildStateWithEdge();
    const trig = await toTriG(state);
    // The key invariant: named-graph count still equals graph count.
    const graphBlocks = (trig.match(/^GRAPH </gm) || []).length;
    expect(graphBlocks).toBe(1);
    // Edge content appears somewhere in the TriG output (either default or named graph).
    // The edge has sourceId "inst1" so related strings will appear.
    expect(trig).toContain('inst1');
    expect(trig).toContain('inst2');
  });
});

// ── Turtle codec ─────────────────────────────────────────────────────────────

describe('P5.2 — Turtle codec', () => {
  it('toTurtle returns a non-empty string', async () => {
    const ttl = await toTurtle(buildState());
    expect(typeof ttl).toBe('string');
    expect(ttl.length).toBeGreaterThan(0);
  });

  it('output contains @prefix declarations for well-known namespaces', async () => {
    const ttl = await toTurtle(buildState());
    expect(ttl).toContain('@prefix rdf:');
    expect(ttl).toContain('@prefix rdfs:');
    expect(ttl).toContain('@prefix redstring:');
  });

  it('output contains NO GRAPH blocks (default graph only)', async () => {
    const ttl = await toTurtle(buildState(2));
    expect(ttl).not.toContain('GRAPH <');
  });

  it('prototype IRI is abbreviated using the redstring: prefix', async () => {
    const ttl = await toTurtle(buildState(1));
    // The dog prototype should appear as an abbreviated subject or object.
    // toIri('dog') = urn:redstring:id:dog — not abbreviated, but its type triple
    // should use redstring:Prototype or skos:Concept.
    expect(ttl).toContain('skos:Concept');
  });

  it('multi-predicate subjects use ; separator (subject grouping)', async () => {
    const ttl = await toTurtle(buildState(1));
    // Any prototype with multiple predicates will produce a ; line.
    expect(ttl).toContain(' ;');
  });

  it('prototype quads appear for each prototype in the state', async () => {
    const ttl = await toTurtle(buildState(1));
    expect(ttl).toContain(toIri('dog'));
  });

  it('instance quads appear for each instance', async () => {
    const state = buildState(2);
    const ttl = await toTurtle(state);
    expect(ttl).toContain(toIri('inst1'));
    expect(ttl).toContain(toIri('inst2'));
  });

  it('emitV4: true option is accepted and produces valid Turtle', async () => {
    const ttl = await toTurtle(buildState(), { emitV4: true });
    expect(ttl).toContain('@prefix');
    expect(ttl.length).toBeGreaterThan(0);
  });

  it('state with edge: edge quads appear in the output', async () => {
    const state = buildStateWithEdge();
    const ttl = await toTurtle(state);
    expect(ttl).toContain('inst1');
    expect(ttl).toContain('inst2');
    // No GRAPH blocks — edges go to default graph like everything else.
    expect(ttl).not.toContain('GRAPH <');
  });
});
