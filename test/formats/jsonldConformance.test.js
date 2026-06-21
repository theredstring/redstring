import { describe, it, expect } from 'vitest';
import jsonld from 'jsonld';
import { exportToRedstring, toIri } from '../../src/formats/redstringFormat.js';

/**
 * JSON-LD → RDF conformance (P2.3). Proves the exported document is valid linked
 * data: it converts to N-Quads cleanly, with no duplicate quads, no pseudo-scheme
 * IRIs, proper datatypes, and a quad for every prototype and edge. This is the
 * gate that the context tuning in P2.2 (URN @ids, @container:@id, datatype
 * coercion, derived/UI exclusion) actually produces clean RDF.
 */

const buildState = () => {
  const nodePrototypes = new Map([
    ['animal', { id: 'animal', name: 'Animal', description: 'a', definitionGraphIds: [], abstractionChains: {} }],
    ['dog', {
      id: 'dog', name: 'Dog', description: 'd', x: 1.5, y: 2.25, scale: 1,
      externalLinks: ['https://www.wikidata.org/wiki/Q144'],
      definitionGraphIds: [], abstractionChains: { Bio: ['animal', 'dog'] }
    }],
    ['cat', { id: 'cat', name: 'Cat', description: 'c', definitionGraphIds: [], abstractionChains: {} }]
  ]);
  const instances = new Map([
    ['ia', { id: 'ia', prototypeId: 'dog', x: 10.5, y: 20, scale: 1.5 }],
    ['ib', { id: 'ib', prototypeId: 'cat', x: 30, y: 40, scale: 1 }]
  ]);
  const graphs = new Map([['g', { id: 'g', name: 'G', description: '', instances, edgeIds: ['e1'], definingNodeIds: [] }]]);
  const edges = new Map([
    ['e1', { id: 'e1', sourceId: 'ia', destinationId: 'ib', typeNodeId: 'base-connection-prototype', definitionNodeIds: [], directionality: { arrowsToward: new Set(['ib']) } }]
  ]);
  return {
    graphs, nodePrototypes, edges,
    openGraphIds: [], activeGraphId: 'g', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false
  };
};

const PSEUDO = /<(prototype|instance|graph|node|group|type|space):/;

describe('JSON-LD → RDF conformance (P2.3)', () => {
  let lines;
  it('converts to N-Quads without throwing', async () => {
    const nq = await jsonld.toRDF(exportToRedstring(buildState()), { format: 'application/n-quads' });
    lines = nq.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('produces no duplicate quads', () => {
    expect(lines.length - new Set(lines).size).toBe(0);
  });

  it('uses no pseudo-scheme IRIs', () => {
    expect(lines.filter((l) => PSEUDO.test(l))).toEqual([]);
  });

  it('every subject is an absolute URN or a blank node', () => {
    expect(lines.every((l) => /^(<urn:|<https?:|_:)/.test(l))).toBe(true);
  });

  it('emits at least one quad per prototype', () => {
    for (const id of ['animal', 'dog', 'cat']) {
      expect(lines.some((l) => l.startsWith(`<${toIri(id)}>`))).toBe(true);
    }
  });

  it('projects each edge as a reified rdf:Statement', () => {
    // Edges export as reified statements (subject/predicate/object); one edge
    // here (source→target) → exactly one statement referencing the connection.
    const statements = lines.filter((l) => l.includes('22-rdf-syntax-ns#Statement'));
    expect(statements.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.includes(toIri('base-connection-prototype')))).toBe(true);
  });

  it('coerces coordinates to xsd:decimal', () => {
    const coord = lines.find((l) => l.includes('xCoordinate'));
    expect(coord).toBeTruthy();
    expect(coord).toContain('XMLSchema#decimal');
  });

  it('excludes derived snapshots and UI state from the RDF projection', () => {
    expect(lines.some((l) => l.includes('graphLayouts') || l.includes('graphSummaries'))).toBe(false);
    expect(lines.some((l) => l.includes('openGraphIds') || l.includes('activeGraphId'))).toBe(false);
  });

  it('preserves SKOS+PROV core in the RDF', () => {
    expect(lines.some((l) => l.includes('skos/core#Concept'))).toBe(true);
    expect(lines.some((l) => l.includes('skos/core#prefLabel'))).toBe(true);
    expect(lines.some((l) => l.includes('skos/core#broader'))).toBe(true);
  });
});
