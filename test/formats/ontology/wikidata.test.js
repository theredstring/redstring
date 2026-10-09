/**
 * A Wikidata export read as items and their direct claims: Things are the
 * items, relations are the claims between them, and the machinery around them
 * (statements, values, references, sitelinks, images, Wikibase's vocabulary)
 * makes no Things.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexOntology, planImport } from '../../../src/formats/ontology/importOntology.js';

const FIXTURES = path.resolve(__dirname, '../../fixtures/ontology');
const WD = 'http://www.wikidata.org/entity/';
const WDT = 'http://www.wikidata.org/prop/direct/';

let index;
beforeAll(async () => {
  const source = fs.readFileSync(path.join(FIXTURES, 'wikidata-water.ttl'), 'utf8');
  index = await indexOntology({ source, fileName: 'Q283.ttl' });
});

describe('a Wikidata export', () => {
  it('makes Things only of the items that take part in a claim', () => {
    expect([...index.terms.keys()].sort()).toEqual([
      `${WD}Q1074076`, // refrigerant (has use)
      `${WD}Q113145171`, // type of chemical entity (instance of)
      `${WD}Q283`, // water
      `${WD}Q50690`, // oxide (subclass of)
      `${WD}Q556`, // hydrogen (has part)
      `${WD}Q629`, // oxygen (has part)
    ]);
  });

  it('reads the item: label, description, English synonyms, external IDs', () => {
    const water = index.terms.get(`${WD}Q283`);
    expect(water.label).toBe('water');
    expect(water.definition).toMatch(/^chemical compound whose molecules/);
    expect(water.synonyms.map((s) => s.label)).toEqual(['H2O']);
    expect(water.xrefs).toEqual(['http://purl.obolibrary.org/obo/CHEBI_15377']);
    expect(index.terms.get(`${WD}Q629`).label).toBe('oxygen');
  });

  it('takes a class\'s kinds from subclass of and keeps its instance of as a relation', () => {
    const water = index.terms.get(`${WD}Q283`);
    expect(water.parents).toEqual([`${WD}Q50690`]);
    expect(water.relations).toEqual([
      { property: `${WDT}P31`, target: `${WD}Q113145171` },
      { property: `${WDT}P366`, target: `${WD}Q1074076` },
      { property: `${WDT}P527`, target: `${WD}Q556` },
      { property: `${WDT}P527`, target: `${WD}Q629` },
    ]);
  });

  it('names relations by their property\'s label', () => {
    expect(index.properties.get(`${WDT}P527`)?.label).toBe('has part(s)');
    expect(index.properties.get(`${WDT}P366`)?.label).toBe('has use');
  });

  it('reads the dataset node as the source, about the item', () => {
    expect(index.ontology).toMatchObject({
      iri: 'https://www.wikidata.org/wiki/Special:EntityData/Q283',
      title: 'Water (Wikidata)',
      license: 'http://creativecommons.org/publicdomain/zero/1.0/',
      date: '2026-10-05T05:22:30Z',
    });
    expect(index.focus).toEqual([`${WD}Q283`]);
  });

  it('imports water with its parts, opening on water', () => {
    const { state, plan, report } = planImport(index, {});
    expect(report.things).toBe(6);
    expect(plan.source.folderMembers).toEqual([`${WD}Q283`]);
    const names = [...state.nodePrototypes.values()].map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Water', 'Oxygen', 'Hydrogen', 'Oxide', 'Has Part(s)', 'Has Use']));
    for (const junk of ['Article', 'Item', 'Statement', 'BestRank', 'Category:Water', 'Kilogram', 'Water (Wikipedia)']) {
      expect(names).not.toContain(junk);
    }
    const water = [...state.nodePrototypes.values()].find((p) => p.semanticMetadata?.ontology?.iri === `${WD}Q283`);
    expect(state.nodePrototypes.get(water.typeNodeId).name).toBe('Oxide');
    const parts = state.graphs.get(water.definitionGraphIds[0]);
    expect([...parts.instances.values()].map((i) => state.nodePrototypes.get(i.prototypeId).name).sort()).toEqual(['Hydrogen', 'Oxygen']);
  });
});
