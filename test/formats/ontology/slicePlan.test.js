/**
 * Choosing a slice and turning it into an import plan: the deterministic rules.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexOntology } from '../../../src/formats/ontology/importOntology.js';
import { computeSlice, resolveTermRef, searchTerms } from '../../../src/formats/ontology/slice.js';
import { buildImportPlan, importIds, localName, titleCaseName } from '../../../src/formats/ontology/plan.js';
import { compositionalClue } from '../../../src/formats/ontology/vocab.js';

const FIXTURES = path.resolve(__dirname, '../../fixtures/ontology');
const Z = 'http://example.org/zoo/';
const z = (local) => Z + local;

let zoo;
beforeAll(async () => {
  zoo = await indexOntology({ source: fs.readFileSync(path.join(FIXTURES, 'zoo.ttl'), 'utf8'), fileName: 'zoo.ttl' });
});

const plan = (options = {}, planOptions = {}) => buildImportPlan(zoo, computeSlice(zoo, options), { sourceName: 'zoo', ...planOptions });
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

  it('adds the parts of selected wholes, whichever side declares them, and what they relate to', () => {
    const s = computeSlice(zoo, { roots: ['cat'], depth: 0 });
    // has part (declared on Cat) and part of (declared on Whisker), and their ancestors.
    for (const part of ['Tail', 'Paw', 'Whisker', 'BodyPart']) expect(s.iris.has(z(part))).toBe(true);
    // Every relation is drawn, so its other end comes along too, with its ladder.
    expect(s.iris.has(z('Predator'))).toBe(true);
    expect(s.iris.has(z('Role'))).toBe(true);
    // What rode along isn't what was selected.
    expect([...s.selected]).toEqual([z('Cat')]);
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

  it('still brings what the namespace relates to, from any namespace', async () => {
    const mixed = await indexOntology({
      fileName: 'm.ttl',
      source: `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        <http://a.org/locatedIn> a owl:ObjectProperty ; rdfs:label "located in" .
        <http://a.org/x> rdfs:label "x" ; rdfs:subClassOf [ a owl:Restriction ; owl:onProperty <http://a.org/locatedIn> ; owl:someValuesFrom <http://b.org/y> ] .
        <http://b.org/y> rdfs:label "y" .
        <http://b.org/z> rdfs:label "z" .`,
    });
    const s = computeSlice(mixed, { namespaces: ['http://a.org/'] });
    expect([...s.iris].sort()).toEqual(['http://a.org/x', 'http://b.org/y']);
    expect([...s.selected]).toEqual(['http://a.org/x']);
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
    const parts = p.webs.filter((w) => w.kind === 'composition');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ whole: z('Cat'), members: [z('Paw'), z('Tail'), z('Whisker')] });
    expect(thing(p, 'Cat').compositionWebId).toBe(parts[0].id);
  });

  it('draws relations between parts inside the whole\'s web too, but not part of / has part between them', () => {
    const p = plan({ roots: ['cat'], depth: 0 });
    expect(p.webs.find((w) => w.kind === 'composition').connections).toEqual([{ source: z('Paw'), property: z('adjacentTo'), target: z('Tail') }]);
    expect(p.relationTypes).toContainEqual({ iri: z('adjacentTo'), id: importIds.thing(z('adjacentTo')), name: 'Adjacent To' });
  });

  it('keeps on the Thing as data only the relations it can\'t draw', () => {
    // Everything Cat relates to is in this import: nothing is left as data.
    expect(thing(plan(), 'Cat').relations).toEqual([]);
    // Without what rides along, none of it is here, so each relation stays, readable.
    const alone = plan({ roots: ['cat'], depth: 0, includePartners: false });
    expect(thing(alone, 'Cat').relations.map((r) => r.target)).toEqual([z('Paw'), z('Tail'), z('Predator')]);
    expect(thing(alone, 'Cat').relations).toContainEqual({
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

describe('names', () => {
  it('Title Cases names by default and keeps the source\'s label alongside', () => {
    const cat = thing(plan(), 'Cat');
    expect(cat).toMatchObject({ name: 'Cat', label: 'cat' });
    // Already capitalised: nothing to keep.
    expect(thing(plan(), 'Garfield')).toMatchObject({ name: 'Garfield', label: null });
  });

  it('keeps the source\'s own labels when Title Case is off', () => {
    const p = plan({}, { titleCase: false });
    expect(thing(p, 'Cat')).toMatchObject({ name: 'cat', label: null });
    expect(p.relationTypes.find((r) => r.iri === 'http://purl.obolibrary.org/obo/RO_0000087').name).toBe('has role');
  });

  it('changes only words written all in lower case', () => {
    expect(titleCaseName('disease of cellular proliferation')).toBe('Disease of Cellular Proliferation');
    expect(titleCaseName('of mice and men')).toBe('Of Mice and Men');
    expect(titleCaseName('hereditary disease, non-human animal')).toBe('Hereditary Disease, Non-human Animal');
    expect(titleCaseName('BRCA1-related cancer')).toBe('BRCA1-related Cancer');
    expect(titleCaseName('pH indicator')).toBe('pH Indicator');
    expect(titleCaseName('alpha-D-glucose')).toBe('alpha-D-glucose');
    expect(titleCaseName('(2S)-2-aminopropanoic acid')).toBe('(2S)-2-aminopropanoic Acid');
    expect(titleCaseName('')).toBe('');
  });
});

describe('webs of kinds', () => {
  const kindsOf = (p, local) => p.webs.find((w) => w.kind === 'kinds' && w.whole === z(local));

  it('gives each Thing with more specific kinds a web holding all of them', () => {
    const p = plan();
    expect(kindsOf(p, 'Mammal').members).toEqual([z('Cat'), z('Dog')]);
    // Cat's type is Mammal, but it's a kind of Pet too, so it's in both.
    expect(kindsOf(p, 'Pet').members).toEqual([z('Cat')]);
    expect(kindsOf(p, 'Cat').members).toEqual([z('Garfield'), z('Kitten')]);
    expect(kindsOf(p, 'Cat').connections).toEqual([]);
    expect(thing(p, 'Mammal').kindsWebId).toBe(kindsOf(p, 'Mammal').id);
    // A leaf has none.
    expect(thing(p, 'Garfield').kindsWebId).toBe(null);
    expect(kindsOf(p, 'Garfield')).toBeUndefined();
  });

  it('holds only kinds inside the slice', () => {
    const p = plan({ roots: ['dog'], depth: 0 });
    // Mammal arrives as Dog's ancestor; Cat isn't in this slice.
    expect(kindsOf(p, 'Mammal').members).toEqual([z('Dog')]);
  });

  it('derives the web\'s ID from the source and the Thing, like every other ID', () => {
    expect(kindsOf(plan({ roots: ['cat'] }), 'Mammal').id).toBe(kindsOf(plan({ roots: ['dog'] }), 'Mammal').id);
    expect(kindsOf(plan(), 'Mammal').id).toBe(importIds.kindsWeb('http://example.org/zoo.owl', z('Mammal')));
  });

  it('can be left out, keeping kinds on the carousel only', () => {
    const p = plan({}, { kindsWebs: false });
    expect(p.webs.some((w) => w.kind === 'kinds')).toBe(false);
    expect(p.things.every((t) => t.kindsWebId === null)).toBe(true);
    expect(p.report.kindsWebs).toBe(0);
  });

  it('counts every placement in a web, for the size estimate', () => {
    const p = plan();
    const inWebs = p.webs.reduce((n, w) => n + w.members.length, 0);
    expect(p.report.placements).toBe(inWebs + p.source.folderMembers.length);
    expect(plan({}, { kindsWebs: false }).report.placements).toBeLessThan(p.report.placements);
  });
});

describe('compositional clues', () => {
  it('reads which end goes inside from the relation\'s name, in any case or spelling', () => {
    const clue = (name) => compositionalClue('http://e/p', name);
    for (const name of ['part of', 'Part Of', 'regional part of', 'located in', 'Located In', 'disease has location',
      'Disease Has Inflammation Site', 'contained in', 'member of', 'occurs in', 'part_of', 'isPartOf']) {
      expect([name, clue(name)]).toEqual([name, 'in-object']);
    }
    for (const name of ['has part', 'HAS PART', 'has proper part', 'hasPart', 'has_component', 'has member', 'contains',
      'composed primarily of', 'consists of', 'location of']) {
      expect([name, clue(name)]).toEqual([name, 'in-subject']);
    }
    for (const name of ['has participant', 'has role', 'adjacent to', 'in taxon', 'develops from', 'participates in', '', null]) {
      expect([name, clue(name)]).toEqual([name, null]);
    }
  });

  it('knows part of and has part by IRI, whatever they\'re called', () => {
    expect(compositionalClue('http://purl.obolibrary.org/obo/BFO_0000050', 'BFO_0000050')).toBe('in-object');
    expect(compositionalClue('http://purl.obolibrary.org/obo/BFO_0000051', undefined)).toBe('in-subject');
  });

  it('places a Thing located in another in that one\'s web, and draws the connection from it', async () => {
    const dz = await indexOntology({
      fileName: 'd.ttl',
      source: `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        <http://e/hasLocation> a owl:ObjectProperty ; rdfs:label "disease has location" .
        <http://e/hasFeature> a owl:ObjectProperty ; rdfs:label "disease has feature" .
        <http://e/pneumonia> rdfs:label "pneumonia" ;
          rdfs:subClassOf [ a owl:Restriction ; owl:onProperty <http://e/hasLocation> ; owl:someValuesFrom <http://e/lung> ] ;
          rdfs:subClassOf [ a owl:Restriction ; owl:onProperty <http://e/hasFeature> ; owl:someValuesFrom <http://e/cough> ] .
        <http://e/lung> rdfs:label "lung" .
        <http://e/cough> rdfs:label "cough" .`,
    });
    const p = buildImportPlan(dz, computeSlice(dz));
    const lung = p.webs.find((w) => w.kind === 'composition' && w.whole === 'http://e/lung');
    expect(lung.members).toEqual(['http://e/pneumonia']);
    // A feature isn't composition: Cough gets no web of Pneumonia's.
    expect(p.webs.find((w) => w.kind === 'composition' && w.whole === 'http://e/cough')).toBeUndefined();
    const pneumonia = p.webs.find((w) => w.kind === 'connections' && w.whole === 'http://e/pneumonia');
    expect(pneumonia.members).toEqual(['http://e/pneumonia', 'http://e/cough', 'http://e/lung']);
    expect(pneumonia.connections).toEqual([
      { source: 'http://e/pneumonia', property: 'http://e/hasFeature', target: 'http://e/cough' },
      { source: 'http://e/pneumonia', property: 'http://e/hasLocation', target: 'http://e/lung' },
    ]);
  });
});

describe('webs of connections', () => {
  const connectionsOf = (p, local) => p.webs.find((w) => w.kind === 'connections' && w.whole === z(local));

  it('draws every relation, from the Thing, in a web holding the Thing and what it relates to', () => {
    const p = plan();
    const cat = connectionsOf(p, 'Cat');
    expect(cat.members).toEqual([z('Cat'), z('Paw'), z('Predator'), z('Tail')]);
    expect(cat.connections.map((c) => [c.source, localName(c.property), c.target])).toEqual([
      [z('Cat'), 'BFO 0000051', z('Paw')],
      [z('Cat'), 'BFO 0000051', z('Tail')],
      [z('Cat'), 'RO 0000087', z('Predator')],
    ]);
    expect(thing(p, 'Cat').connectionsWebIds).toEqual([cat.id]);
    // Part of is drawn from the part as well as placing it in the whole.
    expect(connectionsOf(p, 'Whisker').connections).toEqual([{ source: z('Whisker'), property: 'http://purl.obolibrary.org/obo/BFO_0000050', target: z('Cat') }]);
    // A relation inside a logical definition is drawn too.
    expect(connectionsOf(p, 'Kitten').connections).toEqual([{ source: z('Kitten'), property: z('hasStage'), target: z('Juvenile') }]);
    // A Thing with no relations has none.
    expect(thing(p, 'Dog').connectionsWebIds).toEqual([]);
  });

  it('counts every relation drawn: one per relation, plus those between parts of a whole', () => {
    const p = plan();
    const relations = [...zoo.terms.values()].filter((t) => p.things.some((th) => th.iri === t.iri)).reduce((n, t) => n + t.relations.length, 0);
    const betweenParts = p.webs.filter((w) => w.kind === 'composition').reduce((n, w) => n + w.connections.length, 0);
    expect(p.report.connections).toBe(relations + betweenParts);
    expect(p.report.relationsKeptAsData).toBe(0);
    expect(p.report.connectionsWebs).toBe(p.webs.filter((w) => w.kind === 'connections').length);
  });

  it('derives the web\'s ID from the source and the Thing', () => {
    expect(connectionsOf(plan(), 'Cat').id).toBe(importIds.connectionsWeb('http://example.org/zoo.owl', z('Cat')));
  });
});

describe('the folder', () => {
  it('holds the source\'s own top kinds, not the Things it only refers to', async () => {
    const mixed = await indexOntology({
      fileName: 'm.ttl',
      source: `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        <http://a.org/inTaxon> a owl:ObjectProperty ; rdfs:label "in taxon" .
        <http://a.org/disease> rdfs:label "disease" .
        <http://a.org/flu> rdfs:label "flu" ; rdfs:subClassOf <http://a.org/disease> ;
          rdfs:subClassOf [ a owl:Restriction ; owl:onProperty <http://a.org/inTaxon> ; owl:someValuesFrom <http://b.org/human> ] .
        <http://a.org/injury> rdfs:label "injury" .
        <http://b.org/human> rdfs:label "human" .`,
    });
    const p = buildImportPlan(mixed, computeSlice(mixed));
    expect(p.source.folderMembers).toEqual(['http://a.org/disease', 'http://a.org/injury']);
    // Human is still imported, and reachable through Flu's connections.
    expect(p.things.some((t) => t.iri === 'http://b.org/human')).toBe(true);
  });
});
