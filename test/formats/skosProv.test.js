import { describe, it, expect } from 'vitest';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Standards layer (Phase 2): SKOS concept emission, the sameness ladder, and
 * PROV stamping. These assert the redstring: overlay degrades to a clean
 * SKOS+PROV core — the progressive-enhancement guarantee that the P3.4 strip
 * test will enforce on the full RDF projection.
 */

const buildState = (protoOverrides = {}) => {
  const nodePrototypes = new Map([
    ['animal', { id: 'animal', name: 'Animal', description: '', definitionGraphIds: [], abstractionChains: {} }],
    ['mammal', { id: 'mammal', name: 'Mammal', description: '', definitionGraphIds: [], abstractionChains: {} }],
    ['dog', {
      id: 'dog', name: 'Dog', description: 'A domestic canine', conjugation: 'dogs',
      definitionGraphIds: [], abstractionChains: { Bio: ['animal', 'mammal', 'dog'] },
      ...protoOverrides
    }]
  ]);
  const graphs = new Map([['g', { id: 'g', name: 'G', description: '', instances: new Map(), edgeIds: [], definingNodeIds: [] }]]);
  return {
    graphs, nodePrototypes, edges: new Map(),
    openGraphIds: [], activeGraphId: 'g', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false
  };
};

describe('SKOS emission (P2.4)', () => {
  const ex = exportToRedstring(buildState());

  it('types the universe as a skos:ConceptScheme with a scheme IRI', () => {
    expect(ex['@type']).toContain('skos:ConceptScheme');
    expect(ex['@id']).toBe('urn:redstring:scheme');
  });

  it('types each prototype as skos:Concept with prefLabel and inScheme', () => {
    const dog = ex.prototypeSpace.prototypes.dog;
    expect(dog['@type']).toContain('skos:Concept');
    expect(dog['skos:prefLabel']).toBe('Dog');
    expect(dog['skos:inScheme']).toEqual({ '@id': 'urn:redstring:scheme' });
  });

  it('emits skos:altLabel from conjugation when present', () => {
    expect(ex.prototypeSpace.prototypes.dog['skos:altLabel']).toBe('dogs');
    expect(ex.prototypeSpace.prototypes.animal['skos:altLabel']).toBeUndefined();
  });

  it('projects abstraction chains to skos:broader (more-specific → more-general)', () => {
    expect(ex.prototypeSpace.prototypes.dog['skos:broader']).toEqual([{ '@id': 'urn:redstring:id:mammal' }]);
    expect(ex.prototypeSpace.prototypes.mammal['skos:broader']).toEqual([{ '@id': 'urn:redstring:id:animal' }]);
  });

  it('keeps native abstractionChains and round-trips without _preserved pollution', () => {
    const { storeState } = importFromRedstring(ex, {});
    expect(storeState.nodePrototypes.get('dog').abstractionChains).toEqual({ Bio: ['animal', 'mammal', 'dog'] });
    const reExported = exportToRedstring(storeState);
    expect(reExported.prototypeSpace.prototypes.dog._preserved).toBeUndefined();
  });
});

describe('Sameness ladder (P2.5)', () => {
  const LINKS = ['https://www.wikidata.org/wiki/Q144', 'https://dbpedia.org/page/Dog'];

  it('user links export owl:sameAs AND skos:exactMatch (cumulative rule)', () => {
    const ex = exportToRedstring(buildState({ externalLinks: LINKS }));
    const dog = ex.prototypeSpace.prototypes.dog;
    expect(dog['owl:sameAs']).toEqual(LINKS);
    expect(dog['skos:exactMatch']).toEqual(LINKS.map((u) => ({ '@id': u })));
    expect(dog['skos:closeMatch']).toBeUndefined();
  });

  it('auto-enriched links export skos:closeMatch only (alignment, not identity)', () => {
    const ex = exportToRedstring(buildState({
      externalLinks: ['https://en.wikipedia.org/wiki/Dog'],
      semanticMetadata: { autoEnriched: true }
    }));
    const dog = ex.prototypeSpace.prototypes.dog;
    expect(dog['skos:closeMatch']).toEqual([{ '@id': 'https://en.wikipedia.org/wiki/Dog' }]);
    expect(dog['owl:sameAs']).toBeUndefined();
    expect(dog['skos:exactMatch']).toBeUndefined();
  });

  it('round-trips external links from either rung back into the flat store list', () => {
    const userRt = importFromRedstring(exportToRedstring(buildState({ externalLinks: LINKS })), {});
    expect(userRt.storeState.nodePrototypes.get('dog').externalLinks).toEqual(LINKS);

    const enrichedState = buildState({
      externalLinks: ['https://en.wikipedia.org/wiki/Dog'],
      semanticMetadata: { autoEnriched: true }
    });
    const enrichedRt = importFromRedstring(exportToRedstring(enrichedState), {});
    expect(enrichedRt.storeState.nodePrototypes.get('dog').externalLinks)
      .toEqual(['https://en.wikipedia.org/wiki/Dog']);
  });
});

describe('PROV stamping (P2.6)', () => {
  const PROV = {
    wasAttributedTo: 'redstring-wizard',
    model: 'claude-opus-4-8',
    conversationId: 'conv-123',
    generatedAtTime: '2026-06-18T00:00:00.000Z'
  };

  it('wizard-authored prototypes export PROV; user-authored do not', () => {
    const ex = exportToRedstring(buildState({ semanticMetadata: { provenance: PROV } }));
    const dog = ex.prototypeSpace.prototypes.dog;
    expect(dog['prov:wasAttributedTo']).toEqual({ '@id': 'urn:redstring:agent:redstring-wizard' });
    expect(dog['prov:generatedAtTime']).toBe('2026-06-18T00:00:00.000Z');
    // user-authored prototype (animal) has no provenance
    expect(ex.prototypeSpace.prototypes.animal['prov:wasAttributedTo']).toBeUndefined();
  });

  it('round-trips provenance through semanticMetadata', () => {
    const { storeState } = importFromRedstring(
      exportToRedstring(buildState({ semanticMetadata: { provenance: PROV } })), {}
    );
    expect(storeState.nodePrototypes.get('dog').semanticMetadata.provenance).toEqual(PROV);
  });

  it('wizard-authored edges export PROV and round-trip semanticMetadata', () => {
    const state = buildState();
    state.nodePrototypes.set('cat', { id: 'cat', name: 'Cat', description: '', definitionGraphIds: [], abstractionChains: {} });
    const instances = new Map([
      ['i1', { id: 'i1', prototypeId: 'dog', x: 0, y: 0, scale: 1 }],
      ['i2', { id: 'i2', prototypeId: 'cat', x: 10, y: 0, scale: 1 }]
    ]);
    state.graphs.set('g', { id: 'g', name: 'G', description: '', instances, edgeIds: ['e1'], definingNodeIds: [] });
    state.edges.set('e1', {
      id: 'e1', sourceId: 'i1', destinationId: 'i2',
      typeNodeId: 'base-connection-prototype', definitionNodeIds: [],
      directionality: { arrowsToward: new Set(['i2']) },
      semanticMetadata: { provenance: PROV }
    });
    const ex = exportToRedstring(state);
    // v4: edges live inside spatialGraphs, not relationships.edges.
    const exportedEdge = ex.spatialGraphs?.graphs?.g?.['redstring:edges']?.e1 || {};
    expect(exportedEdge['prov:wasAttributedTo']).toEqual({ '@id': 'urn:redstring:agent:redstring-wizard' });

    const { storeState } = importFromRedstring(ex, {});
    expect(storeState.edges.get('e1').semanticMetadata.provenance).toEqual(PROV);
  });
});
