import { describe, it, expect } from 'vitest';
import { LENS_TABLE, applyLens } from '../../src/formats/lens.js';

// Helper: build a minimal quad object (same shape as jsonld.toRDF dataset entries).
const namedNode = (value) => ({ termType: 'NamedNode', value });
const literal = (value, lang) => ({
  termType: 'Literal', value,
  ...(lang ? { language: lang } : {}),
  datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#string' },
});
const quad = (s, p, o) => ({
  subject: namedNode(s),
  predicate: namedNode(p),
  object: namedNode(o),
  graph: { termType: 'DefaultGraph', value: '' },
});
const litQuad = (s, p, o) => ({
  subject: namedNode(s),
  predicate: namedNode(p),
  object: literal(o),
  graph: { termType: 'DefaultGraph', value: '' },
});

const DOG    = 'urn:redstring:id:dog';
const ANIMAL = 'urn:redstring:id:animal';
const LIFE   = 'urn:redstring:id:life';
const CELL   = 'urn:redstring:id:cell';

const RDFS   = 'http://www.w3.org/2000/01/rdf-schema#';
const SKOS   = 'http://www.w3.org/2004/02/skos/core#';
const DCTERMS = 'http://purl.org/dc/terms/';
const SCHEMA = 'http://schema.org/';
const WDT    = 'http://www.wikidata.org/prop/direct/';

// ── LENS_TABLE completeness ──────────────────────────────────────────────────

describe('P5.1 — LENS_TABLE', () => {
  it('contains entries for every specified predicate', () => {
    for (const pred of [
      `${RDFS}subClassOf`, `${SKOS}broader`, `${WDT}P279`,
      `${SKOS}narrower`,
      `${DCTERMS}hasPart`, `${SCHEMA}hasPart`, `${WDT}P527`,
      `${DCTERMS}isPartOf`, `${SCHEMA}isPartOf`, `${WDT}P361`,
      `${SKOS}related`, `${RDFS}seeAlso`,
    ]) {
      expect(LENS_TABLE[pred], pred).toBeDefined();
    }
  });

  it('narrower and isPartOf entries are marked inverted', () => {
    expect(LENS_TABLE[`${SKOS}narrower`].inverted).toBe(true);
    expect(LENS_TABLE[`${SCHEMA}isPartOf`].inverted).toBe(true);
    expect(LENS_TABLE[`${DCTERMS}isPartOf`].inverted).toBe(true);
    expect(LENS_TABLE[`${WDT}P361`].inverted).toBe(true);
  });
});

// ── applyLens: abstraction routing ──────────────────────────────────────────

describe('P5.1 — abstraction routing', () => {
  it('skos:broader → abstractionLinks with correct narrower/broader', () => {
    const { abstractionLinks, compositionLinks, edges } = applyLens([
      quad(DOG, `${SKOS}broader`, ANIMAL),
    ]);
    expect(abstractionLinks).toHaveLength(1);
    expect(abstractionLinks[0]).toEqual({ narrower: DOG, broader: ANIMAL });
    expect(compositionLinks).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('rdfs:subClassOf → abstraction', () => {
    const { abstractionLinks } = applyLens([
      quad(DOG, `${RDFS}subClassOf`, ANIMAL),
    ]);
    expect(abstractionLinks[0]).toEqual({ narrower: DOG, broader: ANIMAL });
  });

  it('wdt:P279 (Wikidata subclass of) → abstraction', () => {
    const { abstractionLinks } = applyLens([
      quad(DOG, `${WDT}P279`, ANIMAL),
    ]);
    expect(abstractionLinks[0]).toEqual({ narrower: DOG, broader: ANIMAL });
  });

  it('skos:narrower → abstraction (inverted: object is narrower)', () => {
    const { abstractionLinks } = applyLens([
      quad(ANIMAL, `${SKOS}narrower`, DOG),
    ]);
    expect(abstractionLinks).toHaveLength(1);
    expect(abstractionLinks[0]).toEqual({ narrower: DOG, broader: ANIMAL });
  });

  it('chain: dog broader animal, animal broader life → two links', () => {
    const { abstractionLinks } = applyLens([
      quad(DOG, `${SKOS}broader`, ANIMAL),
      quad(ANIMAL, `${SKOS}broader`, LIFE),
    ]);
    expect(abstractionLinks).toHaveLength(2);
    expect(abstractionLinks[0]).toEqual({ narrower: DOG, broader: ANIMAL });
    expect(abstractionLinks[1]).toEqual({ narrower: ANIMAL, broader: LIFE });
  });
});

// ── applyLens: composition routing ──────────────────────────────────────────

describe('P5.1 — composition routing', () => {
  it('dcterms:hasPart → compositionLinks with correct whole/part', () => {
    const { compositionLinks, abstractionLinks, edges } = applyLens([
      quad(ANIMAL, `${DCTERMS}hasPart`, CELL),
    ]);
    expect(compositionLinks).toHaveLength(1);
    expect(compositionLinks[0]).toEqual({ whole: ANIMAL, part: CELL });
    expect(abstractionLinks).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('schema:hasPart → composition', () => {
    const { compositionLinks } = applyLens([
      quad(ANIMAL, `${SCHEMA}hasPart`, CELL),
    ]);
    expect(compositionLinks[0]).toEqual({ whole: ANIMAL, part: CELL });
  });

  it('wdt:P527 → composition', () => {
    const { compositionLinks } = applyLens([
      quad(ANIMAL, `${WDT}P527`, CELL),
    ]);
    expect(compositionLinks[0]).toEqual({ whole: ANIMAL, part: CELL });
  });

  it('schema:isPartOf → composition inverted (subject is part)', () => {
    const { compositionLinks } = applyLens([
      quad(CELL, `${SCHEMA}isPartOf`, ANIMAL),
    ]);
    expect(compositionLinks[0]).toEqual({ whole: ANIMAL, part: CELL });
  });

  it('dcterms:isPartOf → composition inverted', () => {
    const { compositionLinks } = applyLens([
      quad(CELL, `${DCTERMS}isPartOf`, ANIMAL),
    ]);
    expect(compositionLinks[0]).toEqual({ whole: ANIMAL, part: CELL });
  });

  it('wdt:P361 → composition inverted', () => {
    const { compositionLinks } = applyLens([
      quad(CELL, `${WDT}P361`, ANIMAL),
    ]);
    expect(compositionLinks[0]).toEqual({ whole: ANIMAL, part: CELL });
  });
});

// ── applyLens: edge routing ──────────────────────────────────────────────────

describe('P5.1 — edge routing', () => {
  it('skos:related → edge with base-connection-prototype', () => {
    const { edges, abstractionLinks, compositionLinks } = applyLens([
      quad(DOG, `${SKOS}related`, ANIMAL),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].typePrototypeId).toBe('base-connection-prototype');
    expect(edges[0].sourceIri).toBe(DOG);
    expect(edges[0].targetIri).toBe(ANIMAL);
    expect(abstractionLinks).toHaveLength(0);
    expect(compositionLinks).toHaveLength(0);
  });

  it('rdfs:seeAlso → edge with base-connection-prototype', () => {
    const { edges } = applyLens([
      quad(DOG, `${RDFS}seeAlso`, ANIMAL),
    ]);
    expect(edges[0].typePrototypeId).toBe('base-connection-prototype');
  });
});

// ── applyLens: default mint path ─────────────────────────────────────────────

describe('P5.1 — default mint path', () => {
  it('unknown predicate → edges + mintedPredicates entry with local name', () => {
    const CUSTOM = 'http://example.org/vocab/inspiredBy';
    const { edges, mintedPredicates } = applyLens([
      quad(DOG, CUSTOM, ANIMAL),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].typePrototypeId).toBe(CUSTOM);
    expect(mintedPredicates.has(CUSTOM)).toBe(true);
    expect(mintedPredicates.get(CUSTOM).name).toBe('inspiredBy');
  });

  it('same unknown predicate twice → only one minted entry', () => {
    const CUSTOM = 'http://example.org/vocab/inspiredBy';
    const { edges, mintedPredicates } = applyLens([
      quad(DOG, CUSTOM, ANIMAL),
      quad(ANIMAL, CUSTOM, LIFE),
    ]);
    expect(edges).toHaveLength(2);
    expect(mintedPredicates.size).toBe(1);
  });

  it('fragment-based local name: http://example.org/ns#relatedTo → relatedTo', () => {
    const FRAG = 'http://example.org/ns#relatedTo';
    const { mintedPredicates } = applyLens([quad(DOG, FRAG, ANIMAL)]);
    expect(mintedPredicates.get(FRAG).name).toBe('relatedTo');
  });

  it('URN local name: urn:redstring:id:myRelation → myRelation', () => {
    const URN = 'urn:redstring:id:myRelation';
    const { mintedPredicates } = applyLens([quad(DOG, URN, ANIMAL)]);
    expect(mintedPredicates.get(URN).name).toBe('myRelation');
  });
});

// ── applyLens: prototype collection ─────────────────────────────────────────

describe('P5.1 — prototype collection', () => {
  it('collects both subject and object as prototypes', () => {
    const { prototypes } = applyLens([
      quad(DOG, `${SKOS}broader`, ANIMAL),
      quad(ANIMAL, `${SKOS}broader`, LIFE),
    ]);
    expect(prototypes.has(DOG)).toBe(true);
    expect(prototypes.has(ANIMAL)).toBe(true);
    expect(prototypes.has(LIFE)).toBe(true);
  });

  it('prototype name is derived from IRI local name', () => {
    const { prototypes } = applyLens([quad(DOG, `${SKOS}broader`, ANIMAL)]);
    expect(prototypes.get(DOG).name).toBe('dog');
    expect(prototypes.get(ANIMAL).name).toBe('animal');
  });

  it('triples with literal objects skip routing but still register subject', () => {
    const { edges, abstractionLinks, compositionLinks } = applyLens([
      litQuad(DOG, `${SKOS}prefLabel`, 'Dog'),
    ]);
    // No routing (object is not a NamedNode)
    expect(edges).toHaveLength(0);
    expect(abstractionLinks).toHaveLength(0);
    expect(compositionLinks).toHaveLength(0);
  });

  it('blank node subjects are skipped entirely', () => {
    const { prototypes } = applyLens([{
      subject: { termType: 'BlankNode', value: 'b0' },
      predicate: namedNode(`${SKOS}broader`),
      object: namedNode(ANIMAL),
      graph: { termType: 'DefaultGraph', value: '' },
    }]);
    expect(prototypes.size).toBe(0);
  });

  it('de-duplicates prototypes across multiple triples', () => {
    const { prototypes } = applyLens([
      quad(DOG, `${SKOS}broader`, ANIMAL),
      quad(DOG, `${SKOS}related`, LIFE),
    ]);
    expect(prototypes.size).toBe(3); // DOG, ANIMAL, LIFE — DOG appears once
  });
});

// ── applyLens: mixed routing ─────────────────────────────────────────────────

describe('P5.1 — mixed routing in one call', () => {
  it('routes three predicate types correctly in a single applyLens call', () => {
    const { abstractionLinks, compositionLinks, edges } = applyLens([
      quad(DOG, `${SKOS}broader`, ANIMAL),
      quad(ANIMAL, `${DCTERMS}hasPart`, CELL),
      quad(DOG, `${SKOS}related`, LIFE),
    ]);
    expect(abstractionLinks).toHaveLength(1);
    expect(compositionLinks).toHaveLength(1);
    expect(edges).toHaveLength(1);
  });
});
