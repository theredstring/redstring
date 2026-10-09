/**
 * Choosing a slice and turning it into an import plan: the deterministic rules.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexOntology } from '../../../src/formats/ontology/importOntology.js';
import { computeSlice, resolveTermRef, searchTerms } from '../../../src/formats/ontology/slice.js';
import { buildImportPlan, importIds, localName } from '../../../src/formats/ontology/plan.js';

const FIXTURES = path.resolve(__dirname, '../../fixtures/ontology');
const Z = 'http://example.org/zoo/';
const z = (local) => Z + local;

let zoo;
beforeAll(async () => {
  zoo = await indexOntology({ source: fs.readFileSync(path.join(FIXTURES, 'zoo.ttl'), 'utf8'), fileName: 'zoo.ttl' });
});

const plan = (options = {}) => buildImportPlan(zoo, computeSlice(zoo, options), { sourceName: 'zoo' });
const thing = (p, local) => p.things.find((t) => t.iri === z(local));

describe('finding the roots', () => {
  it('resolves an IRI, an OBO CURIE or a label', async () => {
    expect(resolveTermRef(zoo, z('Cat'))).toEqual([z('Cat')]);
    expect(resolveTermRef(zoo, 'CAT')).toEqual([z('Cat')]);
    expect(resolveTermRef(zoo, 'nothing like this')).toEqual([]);
    const obo = await indexOntology({
      source: '<http://purl.obolibrary.org/obo/CHEBI_15377> <http://www.w3.org/2000/01/rdf-schema#label> "water" .',
      fileName: 'w.nt',
    });
    expect(resolveTermRef(obo, 'CHEBI:15377')).toEqual(['http://purl.obolibrary.org/obo/CHEBI_15377']);
  });

  it('searches exact, then prefix, then contains; deprecated terms are not offered', () => {
    const hits = searchTerms(zoo, 'cat').map((h) => h.label);
    expect(hits[0]).toBe('cat');
    expect(hits).not.toContain('obsolete cat');
    // A prefix match ranks above a match inside a word.
    expect(searchTerms(zoo, 'pa').map((h) => h.label)).toEqual(['paw', 'body part']);
  });
});

describe('the slice', () => {
  it('takes a root and everything more specific, to the depth asked', () => {
    const d0 = computeSlice(zoo, { roots: ['mammal'], depth: 0, includeAncestors: false, includePartners: false });
    expect([...d0.iris]).toEqual([z('Mammal')]);
    const d1 = computeSlice(zoo, { roots: ['mammal'], depth: 1, includeAncestors: false, includePartners: false });
    expect([...d1.iris].sort()).toEqual([z('Cat'), z('Dog'), z('Mammal')]);
    const all = computeSlice(zoo, { roots: ['mammal'], includeAncestors: false, includePartners: false });
    expect([...all.iris].sort()).toEqual([z('Cat'), z('Dog'), z('Garfield'), z('Kitten'), z('Mammal')]);
  });

  it('adds ancestors so ladders reach the top', () => {
    const s = computeSlice(zoo, { roots: ['cat'], depth: 0, includePartners: false });
    expect([...s.iris].sort()).toEqual([z('Animal'), z('Cat'), z('Mammal'), z('Pet')]);
    expect(s.counts.ancestors).toBe(3);
  });

  it('adds the parts of selected wholes, whichever side declares them', () => {
    const s = computeSlice(zoo, { roots: ['cat'], depth: 0 });
    // has part (declared on Cat) and part of (declared on Whisker), and their ancestors.
    for (const part of ['Tail', 'Paw', 'Whisker', 'BodyPart']) expect(s.iris.has(z(part))).toBe(true);
    // A relation that isn't composition does not pull its target in.
    expect(s.iris.has(z('Predator'))).toBe(false);
  });

  it('leaves deprecated terms out unless asked', () => {
    expect(computeSlice(zoo).iris.has(z('OldCat'))).toBe(false);
    expect(computeSlice(zoo, { includeDeprecated: true }).iris.has(z('OldCat'))).toBe(true);
  });

  it('can keep only one namespace', async () => {
    const mixed = await indexOntology({
      fileName: 'm.ttl',
      source: `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        <http://a.org/x> rdfs:label "x" ; rdfs:subClassOf <http://b.org/y> .
        <http://b.org/y> rdfs:label "y" .`,
    });
    expect([...computeSlice(mixed, { namespaces: ['http://a.org/'] }).iris]).toEqual(['http://a.org/x']);
  });

  it('reports roots it could not find', () => {
    const s = computeSlice(zoo, { roots: ['cat', 'unicorn'] });
    expect(s.missingRoots).toEqual(['unicorn']);
    expect(s.roots).toEqual([z('Cat')]);
  });
});

describe('the plan', () => {
  it('types each Thing by its most specific parent in the slice', () => {
    const p = plan();
    // Cat sits under Mammal (depth 1) and Pet (depth 0): Mammal is the nearer lens.
    expect(thing(p, 'Cat').typeIri).toBe(z('Mammal'));
    expect(thing(p, 'Cat').otherParents).toEqual([{ iri: z('Pet'), label: 'pet' }]);
    expect(thing(p, 'Garfield').typeIri).toBe(z('Cat'));
    expect(thing(p, 'Animal').typeIri).toBe(null);
  });

  it('breaks a depth tie by IRI, so the choice never depends on file order', async () => {
    const tie = await indexOntology({
      fileName: 't.ttl',
      source: `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        <http://e/x> rdfs:label "x" ; rdfs:subClassOf <http://e/b> , <http://e/a> .
        <http://e/a> rdfs:label "a" . <http://e/b> rdfs:label "b" .`,
    });
    const p = buildImportPlan(tie, computeSlice(tie));
    expect(p.things.find((t) => t.iri === 'http://e/x').typeIri).toBe('http://e/a');
  });

  it('never types in a loop, even when the ontology has one', async () => {
    const loop = await indexOntology({
      fileName: 'l.ttl',
      source: `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        <http://e/a> rdfs:label "a" ; rdfs:subClassOf <http://e/b> .
        <http://e/b> rdfs:label "b" ; rdfs:subClassOf <http://e/c> .
        <http://e/c> rdfs:label "c" ; rdfs:subClassOf <http://e/a> .`,
    });
    const p = buildImportPlan(loop, computeSlice(loop));
    const typeOf = new Map(p.things.map((t) => [t.iri, t.typeIri]));
    for (const start of typeOf.keys()) {
      const seen = new Set();
      let cur = start;
      while (cur) { expect(seen.has(cur)).toBe(false); seen.add(cur); cur = typeOf.get(cur); }
    }
  });

  it('makes a composition web for each whole, holding its parts', () => {
    const p = plan({ roots: ['cat'], depth: 0 });
    expect(p.webs).toHaveLength(1);
    expect(p.webs[0]).toMatchObject({ whole: z('Cat'), members: [z('Paw'), z('Tail'), z('Whisker')] });
    expect(thing(p, 'Cat').compositionWebId).toBe(p.webs[0].id);
  });

  it('draws only relations between parts, inside the whole\'s web', () => {
    const p = plan({ roots: ['cat'], depth: 0 });
    expect(p.webs[0].connections).toEqual([{ source: z('Paw'), property: z('adjacentTo'), target: z('Tail') }]);
    expect(p.relationTypes).toEqual([{ iri: z('adjacentTo'), id: importIds.thing(z('adjacentTo')), name: 'Adjacent To' }]);
  });

  it('keeps every relation on the Thing as readable data', () => {
    const cat = thing(plan(), 'Cat');
    expect(cat.relations).toContainEqual({
      property: 'http://purl.obolibrary.org/obo/RO_0000087',
      propertyLabel: 'Has Role',
      target: z('Predator'),
      targetLabel: 'predator',
    });
  });

  it('puts the requested roots in the folder web, or the top kinds when there are none', () => {
    expect(plan({ roots: ['cat', 'dog'] }).source.folderMembers).toEqual([z('Cat'), z('Dog')]);
    const tops = plan().source.folderMembers;
    expect(tops).toContain(z('Animal'));
    expect(tops).toContain(z('Role'));
    expect(tops).not.toContain(z('Cat'));
  });

  it('derives every ID from IRIs: the same input gives the same plan', () => {
    const a = plan({ roots: ['cat'] });
    const b = plan({ roots: ['cat'] });
    expect(a).toEqual(b);
    expect(thing(a, 'Cat').id).toBe(importIds.thing(z('Cat')));
    // A Thing's ID depends on its IRI alone, not on the slice it arrived in.
    expect(thing(plan({ roots: ['mammal'] }), 'Cat').id).toBe(thing(a, 'Cat').id);
  });

  it('names the source after the ontology', () => {
    const p = plan();
    expect(p.source).toMatchObject({ title: 'Zoo Ontology', iri: 'http://example.org/zoo.owl', license: 'https://creativecommons.org/publicdomain/zero/1.0/' });
    expect(p.source.id).toBe(importIds.source('http://example.org/zoo.owl'));
  });

  it('uses the IRI\'s local name when a term has no label', () => {
    expect(localName('http://e.org/some_thing')).toBe('some thing');
    expect(localName('http://e.org/x#Frag')).toBe('Frag');
  });
});
