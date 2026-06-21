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
