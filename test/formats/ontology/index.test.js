/**
 * Ontology index: every format reads to the same index, and the readings the
 * importer relies on (parents, restrictions, synonyms, deprecation, ...) hold.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexOntology, summarizeIndex, namespaceOf } from '../../../src/formats/ontology/importOntology.js';
import { detectFormat, FORMATS } from '../../../src/formats/ontology/parseRdf.js';
import { OntologyIndexBuilder } from '../../../src/formats/ontology/ontologyIndex.js';
import { BFO_HAS_PART, BFO_PART_OF } from '../../../src/formats/ontology/vocab.js';

const FIXTURES = path.resolve(__dirname, '../../fixtures/ontology');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const Z = 'http://example.org/zoo/';
const HAS_ROLE = 'http://purl.obolibrary.org/obo/RO_0000087';

const ZOO_FILES = ['zoo.ttl', 'zoo.nt', 'zoo.owl', 'zoo.jsonld', 'zoo.obographs.json'];

const indexes = {};
beforeAll(async () => {
  for (const f of ZOO_FILES) indexes[f] = await indexOntology({ source: read(f), fileName: f });
});

/** The parts of an index that must not depend on the serialization. */
const comparable = (index) => {
  const usedProperties = new Set();
  for (const t of index.terms.values()) for (const r of t.relations) usedProperties.add(r.property);
  return {
    ontology: {
      iri: index.ontology.iri,
      title: index.ontology.title,
      description: index.ontology.description,
      license: index.ontology.license,
      version: index.ontology.version,
    },
    terms: [...index.terms.values()],
    relationLabels: [...usedProperties].sort().map((p) => [p, index.properties.get(p)?.label ?? null]),
  };
};

describe('format detection', () => {
  it('picks the parser from the extension', () => {
    expect(detectFormat('a.ttl')).toBe(FORMATS.TURTLE);
    expect(detectFormat('a.nt')).toBe(FORMATS.NTRIPLES);
    expect(detectFormat('a.nq')).toBe(FORMATS.NQUADS);
    expect(detectFormat('a.trig')).toBe(FORMATS.TRIG);
    expect(detectFormat('chebi.owl')).toBe(FORMATS.RDFXML);
    expect(detectFormat('chebi_lite.owl.gz')).toBe(FORMATS.RDFXML);
    expect(detectFormat('a.rdf')).toBe(FORMATS.RDFXML);
    expect(detectFormat('a.jsonld')).toBe(FORMATS.JSONLD);
  });

  it('tells JSON-LD from OBO Graphs JSON by content', () => {
    expect(detectFormat('x.json', '{"@context": {}}')).toBe(FORMATS.JSONLD);
    expect(detectFormat('chebi.json', '{\n "graphs" : [ {')).toBe(FORMATS.OBOGRAPHS);
    expect(detectFormat('chebi.json.gz', '{"graphs":[]}')).toBe(FORMATS.OBOGRAPHS);
  });

  it('sniffs a file with no useful extension', () => {
    expect(detectFormat('download', '<?xml version="1.0"?><rdf:RDF')).toBe(FORMATS.RDFXML);
    expect(detectFormat('download', '@prefix ex: <http://e/> .')).toBe(FORMATS.TURTLE);
    expect(detectFormat('download', '<http://e/a> <http://e/p> <http://e/b> .')).toBe(FORMATS.NTRIPLES);
    expect(detectFormat('download', 'hello')).toBe(null);
  });

  it('refuses a file it cannot place, with the formats it does take', async () => {
    await expect(indexOntology({ source: 'hello', fileName: 'notes.txt' })).rejects.toThrow(/Turtle/);
  });
});

describe('every format reads to the same index', () => {
  it.each(ZOO_FILES.slice(1))('%s matches zoo.ttl', (file) => {
    expect(comparable(indexes[file])).toEqual(comparable(indexes['zoo.ttl']));
  });

  it('finds every term once, with labels', () => {
    const index = indexes['zoo.ttl'];
    expect(index.terms.size).toBe(16);
    for (const term of index.terms.values()) expect(term.label).toBeTruthy();
  });
});

describe('what the index reads', () => {
  const term = (local) => indexes['zoo.ttl'].terms.get(Z + local);

  it('reads the ontology header', () => {
    expect(indexes['zoo.owl'].ontology).toMatchObject({
      iri: 'http://example.org/zoo.owl',
      title: 'Zoo Ontology',
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      version: '1.0',
    });
  });

  it('keeps every named parent, sorted', () => {
    expect(term('Cat').parents).toEqual([Z + 'Mammal', Z + 'Pet']);
  });

  it('drops owl:Thing as a parent: every Thing is already a Thing', () => {
    expect(term('Animal').parents).toEqual([]);
    expect(indexes['zoo.ttl'].terms.has('http://www.w3.org/2002/07/owl#Thing')).toBe(false);
  });

  it('treats rdf:type to one of the ontology\'s classes as a parent (an individual is a leaf)', () => {
    expect(term('Garfield')).toMatchObject({ kind: 'individual', parents: [Z + 'Cat'] });
  });

  it('reads existential restrictions as relations', () => {
    expect(term('Cat').relations).toEqual([
      { property: BFO_HAS_PART, target: Z + 'Paw' },
      { property: BFO_HAS_PART, target: Z + 'Tail' },
      { property: HAS_ROLE, target: Z + 'Predator' },
    ]);
    expect(term('Whisker').relations).toEqual([{ property: BFO_PART_OF, target: Z + 'Cat' }]);
  });

  it('reads an equivalentClass intersection as its genus parent plus its restrictions', () => {
    expect(term('Kitten').parents).toEqual([Z + 'Cat']);
    expect(term('Kitten').relations).toEqual([{ property: Z + 'hasStage', target: Z + 'Juvenile' }]);
  });

  it('keeps synonyms with their scope, cross-references and definitions', () => {
    expect(term('Cat').synonyms).toEqual([
      { label: 'house cat', scope: 'exact' },
      { label: 'kitty', scope: 'related' },
    ]);
    expect(term('Cat').xrefs).toEqual(['WIKIDATA:Q146']);
    expect(term('Cat').definition).toBe('A small domesticated carnivorous mammal.');
  });

  it('prefers an untagged or English label over another language', () => {
    expect(term('Mammal').label).toBe('mammal');
  });

  it('marks deprecated terms and their replacement', () => {
    expect(term('OldCat')).toMatchObject({ deprecated: true, replacedBy: Z + 'Cat' });
  });

  it('never makes a term of a property, and labels the relations', () => {
    const index = indexes['zoo.ttl'];
    expect(index.terms.has(BFO_HAS_PART)).toBe(false);
    expect(index.properties.get(BFO_HAS_PART).label).toBe('has part');
    expect(index.properties.get(HAS_ROLE).label).toBe('has role');
  });

  it('does not read an annotation property pointing at an IRI as a relation', async () => {
    const ttl = `
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix ex: <http://e.org/> .
      ex:seeWiki a owl:AnnotationProperty .
      ex:A a owl:Class ; rdfs:label "a" ; ex:seeWiki ex:B .
      ex:B a owl:Class ; rdfs:label "b" .`;
    const index = await indexOntology({ source: ttl, fileName: 'x.ttl' });
    expect(index.terms.get('http://e.org/A').relations).toEqual([]);
  });

  it('reads SKOS: broader and narrower are parents, related is a relation', async () => {
    const ttl = `
      @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
      @prefix ex: <http://e.org/> .
      ex:scheme a skos:ConceptScheme .
      ex:Fruit a skos:Concept ; skos:prefLabel "fruit"@en ; skos:narrower ex:Apple .
      ex:Apple a skos:Concept ; skos:prefLabel "apple"@en ; skos:altLabel "pomme"@en ; skos:related ex:Tree .
      ex:Pear a skos:Concept ; skos:prefLabel "pear" ; skos:broader ex:Fruit ; skos:definition "A fruit." .
      ex:Tree a skos:Concept ; skos:prefLabel "tree" .`;
    const index = await indexOntology({ source: ttl, fileName: 'x.ttl' });
    expect(index.terms.get('http://e.org/Apple')).toMatchObject({
      kind: 'concept',
      parents: ['http://e.org/Fruit'],
      synonyms: [{ label: 'pomme', scope: 'exact' }],
      relations: [{ property: 'http://www.w3.org/2004/02/skos/core#related', target: 'http://e.org/Tree' }],
    });
    expect(index.terms.get('http://e.org/Pear')).toMatchObject({ parents: ['http://e.org/Fruit'], definition: 'A fruit.' });
    expect(index.ontology.iri).toBe('http://e.org/scheme');
  });

  it('counts what it skips instead of failing on it', async () => {
    const ttl = `
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix ex: <http://e.org/> .
      ex:A a owl:Class ; rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:p ; owl:allValuesFrom ex:B ] .
      ex:C a owl:Class ; owl:equivalentClass [ owl:unionOf ( ex:A ex:B ) ] .
      ex:B a owl:Class .`;
    const index = await indexOntology({ source: ttl, fileName: 'x.ttl' });
    expect(index.stats.universalRestrictions).toBe(1);
    expect(index.stats.unionOrComplementClasses).toBe(1);
    expect(index.terms.get('http://e.org/A').relations).toEqual([]);
  });

  it('accepts quads chunk by chunk, the way a stream delivers them', async () => {
    const text = read('zoo.nt');
    async function* chunks() { for (let i = 0; i < text.length; i += 97) yield text.slice(i, i + 97); }
    const index = await indexOntology({ source: chunks(), fileName: 'zoo.nt' });
    expect(comparable(index)).toEqual(comparable(indexes['zoo.ttl']));
  });

  it('builds the index from raw quads without a file', () => {
    const b = new OntologyIndexBuilder();
    const nn = (value) => ({ termType: 'NamedNode', value });
    const lit = (value) => ({ termType: 'Literal', value, language: '' });
    b.addQuad({ subject: nn('http://e/a'), predicate: nn('http://www.w3.org/2000/01/rdf-schema#label'), object: lit('a') });
    b.addQuad({ subject: nn('http://e/a'), predicate: nn('http://www.w3.org/2000/01/rdf-schema#subClassOf'), object: nn('http://e/b') });
    const index = b.finish();
    expect(index.terms.get('http://e/a')).toMatchObject({ label: 'a', parents: ['http://e/b'] });
    expect(index.terms.has('http://e/b')).toBe(true);
  });
});

describe('summary', () => {
  it('summarizes what an index holds', () => {
    const s = summarizeIndex(indexes['zoo.owl']);
    expect(s).toMatchObject({ terms: 16, deprecated: 1, format: 'rdfxml' });
    expect(s.namespaces[0]).toEqual({ prefix: Z, count: 16 });
  });

  it('splits OBO IRIs at the underscore and others at / or #', () => {
    expect(namespaceOf('http://purl.obolibrary.org/obo/CHEBI_15377')).toBe('http://purl.obolibrary.org/obo/CHEBI_');
    expect(namespaceOf('http://example.org/zoo/Cat')).toBe('http://example.org/zoo/');
    expect(namespaceOf('http://www.w3.org/2004/02/skos/core#Concept')).toBe('http://www.w3.org/2004/02/skos/core#');
  });
});
