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
import { MAX_CONNECTIONS_WEB } from '../../../src/formats/ontology/plan.js';

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

  it('takes a class\'s kinds from subclass of, and draws both it and instance of', () => {
    const water = index.terms.get(`${WD}Q283`);
    expect(water.parents).toEqual([`${WD}Q50690`]);
    expect(water.relations).toEqual([
      { property: `${WDT}P279`, target: `${WD}Q50690` },
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

  it('makes webs only for water, and puts every Thing in one', () => {
    const { state, plan } = planImport(index, {});
    const water = [...state.nodePrototypes.values()].find((p) => p.semanticMetadata?.ontology?.iri === `${WD}Q283`);
    // The folder, water's parts and water's connections: no "kinds of Oxide" holding water alone.
    expect(state.graphs.size).toBe(3);
    expect(water.definitionGraphIds).toHaveLength(2);
    const placed = new Set();
    for (const g of state.graphs.values()) for (const i of g.instances.values()) placed.add(i.prototypeId);
    for (const thing of plan.things) expect(placed.has(thing.id)).toBe(true);
  });

  it('groups water\'s connections by relation', () => {
    const { state } = planImport(index, {});
    const connections = [...state.graphs.values()].find((g) => g.description.startsWith('The connections of'));
    const name = (instanceId) => state.nodePrototypes.get(connections.instances.get(instanceId).prototypeId).name;
    const groups = [...connections.groups.values()].map((g) => [g.name, g.memberInstanceIds.map(name).sort()]);
    // Only a relation with two or more ends is a group.
    expect(groups).toEqual([['Has Part(s)', ['Hydrogen', 'Oxygen']]]);
  });

  it('splits a connections web too big to work with into a web per relation', async () => {
    const n = MAX_CONNECTIONS_WEB;
    const items = Array.from({ length: n }, (_, i) => `wd:Q${1000 + i}`);
    const ttl = `@prefix wd: <${WD}> . @prefix wdt: <${WDT}> .
      @prefix wikibase: <http://wikiba.se/ontology#> . @prefix schema: <http://schema.org/> .
      @prefix data: <https://www.wikidata.org/wiki/Special:EntityData/> .
      data:Q1 schema:about wd:Q1 .
      wd:Q1 a wikibase:Item ; wdt:P366 ${items.slice(0, n / 2).join(', ')} ; wdt:P1552 ${items.slice(n / 2).join(', ')} .`;
    const big = await indexOntology({ source: ttl, fileName: 'Q1.ttl' });
    const { plan, state } = planImport(big, {});
    const webs = plan.webs.filter((w) => w.whole === `${WD}Q1`);
    expect(webs.map((w) => w.kind)).toEqual(['relation', 'relation']);
    expect(webs.map((w) => w.members.length)).toEqual([n / 2 + 1, n / 2 + 1]);
    const q1 = state.nodePrototypes.get(plan.things.find((t) => t.iri === `${WD}Q1`).id);
    expect(q1.definitionGraphIds).toEqual(webs.map((w) => w.id));
  });
});
