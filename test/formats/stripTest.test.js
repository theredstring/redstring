import { describe, it, expect, beforeAll } from 'vitest';
import jsonld from 'jsonld';
import { exportToRedstring, toIri } from '../../src/formats/redstringFormat.js';

/**
 * P3.4 — Progressive-enhancement guarantee (strip test).
 *
 * Export a representative state → jsonld.toRDF → drop every quad whose
 * predicate or subject type starts with the redstring: namespace → assert
 * the remainder is still a valid SKOS+PROV core:
 *
 *   - One skos:ConceptScheme
 *   - Every prototype as a skos:Concept with prefLabel and inScheme
 *   - skos:broader chains where abstraction chains exist
 *   - PROV attribution where wizard provenance exists
 *
 * This test enforces the conformance invariant defined in FORMAT_REFACTOR_PLAN.md §1
 * ("strip every redstring: term … what remains must still be a good SKOS+PROV dataset").
 * It runs against both v3 export (default EMIT_V4=false) and v4 export (emitV4:true).
 */

const PROV = {
  wasAttributedTo: 'redstring-wizard',
  model: 'claude-sonnet-4-6',
  conversationId: 'conv-test',
  generatedAtTime: '2026-06-20T00:00:00.000Z'
};

const buildState = () => {
  const nodePrototypes = new Map([
    ['life', { id: 'life', name: 'Life', description: 'All living things', definitionGraphIds: [], abstractionChains: {} }],
    ['animal', { id: 'animal', name: 'Animal', description: 'Animals', definitionGraphIds: [], abstractionChains: { Bio: ['life', 'animal'] } }],
    ['dog', {
      id: 'dog', name: 'Dog', description: 'Domestic canine', conjugation: 'dogs',
      definitionGraphIds: [], abstractionChains: { Bio: ['life', 'animal', 'dog'] },
      externalLinks: ['https://www.wikidata.org/wiki/Q144'],
      semanticMetadata: { provenance: PROV }
    }]
  ]);
  const instances = new Map([
    ['ia', { id: 'ia', prototypeId: 'dog', x: 0, y: 0, scale: 1 }],
    ['ib', { id: 'ib', prototypeId: 'animal', x: 100, y: 0, scale: 1 }]
  ]);
  const graphs = new Map([
    ['g', { id: 'g', name: 'Main', description: '', instances, edgeIds: ['e1'], definingNodeIds: [] }]
  ]);
  const edges = new Map([
    ['e1', {
      id: 'e1', sourceId: 'ia', destinationId: 'ib',
      typeNodeId: 'base-connection-prototype', definitionNodeIds: [],
      directionality: { arrowsToward: new Set(['ib']) }
    }]
  ]);
  return {
    graphs, nodePrototypes, edges,
    openGraphIds: ['g'], activeGraphId: 'g', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false
  };
};

// Strip quads where the PREDICATE or an rdf:type OBJECT is in the redstring
// vocabulary namespace (https://w3id.org/redstring/). This is the correct
// interpretation of "strip redstring: terms" — entity IRIs (urn:redstring:id:X)
// are identity, not vocabulary, so they survive the strip.
const REDSTRING_VOCAB = 'https://w3id.org/redstring/';
const RDF_TYPE = '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>';

const isRedstringQuad = (line) => {
  // N-Quads: subject SP predicate SP object [SP graph] SP .
  const m = line.match(/^(\S+)\s+(<[^>]+>)\s+(\S+(?:\s+"[^"]*"[^\s]*)?)\s/);
  if (!m) return false;
  const pred = m[2];
  const obj = m[3];
  // Predicate is in the redstring vocab namespace.
  if (pred.startsWith(`<${REDSTRING_VOCAB}`)) return true;
  // rdf:type whose object class is in the redstring vocab.
  if (pred === RDF_TYPE && obj.startsWith(`<${REDSTRING_VOCAB}`)) return true;
  return false;
};

const runStripTest = async (doc) => {
  const nq = await jsonld.toRDF(doc, { format: 'application/n-quads' });
  const all = nq.split('\n').filter(Boolean);
  const stripped = all.filter((l) => !isRedstringQuad(l));
  return { all, stripped };
};

// ── v3 export (default, EMIT_V4=false) ──────────────────────────────────────

describe('P3.4 strip test — v3 export', () => {
  let stripped;
  let all;

  beforeAll(async () => {
    const doc = exportToRedstring(buildState());
    ({ all, stripped } = await runStripTest(doc));
  });

  it('stripping redstring: quads leaves a non-empty dataset', () => {
    expect(all.length).toBeGreaterThan(0);
    expect(stripped.length).toBeGreaterThan(0);
  });

  it('remainder contains a skos:ConceptScheme', () => {
    expect(stripped.some((l) => l.includes('skos/core#ConceptScheme'))).toBe(true);
  });

  it('every prototype appears as a skos:Concept', () => {
    for (const id of ['life', 'animal', 'dog']) {
      const iri = toIri(id);
      const isConcept = stripped.some(
        (l) => l.startsWith(`<${iri}>`) && l.includes('skos/core#Concept')
      );
      expect(isConcept, `${id} should be a skos:Concept`).toBe(true);
    }
  });

  it('every prototype has skos:prefLabel', () => {
    for (const [id, name] of [['life', 'Life'], ['animal', 'Animal'], ['dog', 'Dog']]) {
      const iri = toIri(id);
      const hasLabel = stripped.some(
        (l) => l.includes(`<${iri}>`) && l.includes('skos/core#prefLabel')
      );
      expect(hasLabel, `${id} should have skos:prefLabel`).toBe(true);
    }
  });

  it('every prototype has skos:inScheme', () => {
    for (const id of ['life', 'animal', 'dog']) {
      const iri = toIri(id);
      expect(stripped.some(
        (l) => l.includes(`<${iri}>`) && l.includes('skos/core#inScheme')
      ), `${id} should have skos:inScheme`).toBe(true);
    }
  });

  it('abstraction chains emit skos:broader links', () => {
    // dog → animal (more-specific → more-general), animal → life
    const dogIri = toIri('dog');
    const animalIri = toIri('animal');
    const lifeIri = toIri('life');
    expect(stripped.some(
      (l) => l.includes(`<${dogIri}>`) && l.includes('skos/core#broader') && l.includes(`<${animalIri}>`)
    )).toBe(true);
    expect(stripped.some(
      (l) => l.includes(`<${animalIri}>`) && l.includes('skos/core#broader') && l.includes(`<${lifeIri}>`)
    )).toBe(true);
  });

  it('PROV attribution survives the strip', () => {
    const dogIri = toIri('dog');
    expect(stripped.some(
      (l) => l.includes(`<${dogIri}>`) && l.includes('prov#wasAttributedTo')
    )).toBe(true);
    expect(stripped.some(
      (l) => l.includes(`<${dogIri}>`) && l.includes('prov#generatedAtTime')
    )).toBe(true);
  });

  it('wizard-authored node has prov:generatedAtTime value', () => {
    expect(stripped.some((l) => l.includes('2026-06-20T00:00:00.000Z'))).toBe(true);
  });
});

// ── v4 export (emitV4: true) ─────────────────────────────────────────────────

describe('P3.4 strip test — v4 export', () => {
  let stripped;
  let all;

  beforeAll(async () => {
    const doc = exportToRedstring(buildState(), null, { emitV4: true });
    ({ all, stripped } = await runStripTest(doc));
  });

  it('v4 export also strips cleanly to a non-empty SKOS+PROV dataset', () => {
    expect(stripped.length).toBeGreaterThan(0);
  });

  it('v4: skos:ConceptScheme survives', () => {
    expect(stripped.some((l) => l.includes('skos/core#ConceptScheme'))).toBe(true);
  });

  it('v4: every prototype is a skos:Concept with prefLabel', () => {
    for (const [id] of [['life'], ['animal'], ['dog']]) {
      const iri = toIri(id);
      expect(stripped.some(
        (l) => l.startsWith(`<${iri}>`) && l.includes('skos/core#Concept')
      ), `v4 ${id} should be a skos:Concept`).toBe(true);
      expect(stripped.some(
        (l) => l.includes(`<${iri}>`) && l.includes('skos/core#prefLabel')
      ), `v4 ${id} should have skos:prefLabel`).toBe(true);
    }
  });

  it('v4: skos:broader chains survive the strip', () => {
    const dogIri = toIri('dog');
    const animalIri = toIri('animal');
    expect(stripped.some(
      (l) => l.includes(`<${dogIri}>`) && l.includes('skos/core#broader') && l.includes(`<${animalIri}>`)
    )).toBe(true);
  });

  it('v4: PROV attribution survives the strip', () => {
    const dogIri = toIri('dog');
    expect(stripped.some(
      (l) => l.includes(`<${dogIri}>`) && l.includes('prov#wasAttributedTo')
    )).toBe(true);
  });
});
