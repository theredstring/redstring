/**
 * A real ontology: a ChEBI LITE slice (release 256), cut verbatim from the
 * published OWL. See test/fixtures/ontology/README.md for its licence.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexOntology, planImport } from '../../../src/formats/ontology/importOntology.js';
import { importIds } from '../../../src/formats/ontology/plan.js';
import { mergeUniverses } from '../../../src/formats/mergeUniverses.js';
import { resolveLinkState, LINK_STATES } from '../../../src/formats/linkState.js';

const FILE = path.resolve(__dirname, '../../fixtures/ontology/chebi-lite-water-ethanol.owl');
const OBO = 'http://purl.obolibrary.org/obo/';
const WATER = `${OBO}CHEBI_15377`;
const ETHANOL = `${OBO}CHEBI_16236`;
const HAS_ROLE = `${OBO}RO_0000087`;

let index;
beforeAll(async () => {
  index = await indexOntology({ source: fs.createReadStream(FILE, { encoding: 'utf8' }), fileName: 'chebi_lite.owl' });
});

const empty = () => ({
  nodePrototypes: new Map(), graphs: new Map(), edges: new Map(), edgePrototypes: new Map(),
  openGraphIds: [], expandedGraphIds: new Set(), savedNodeIds: new Set(), savedGraphIds: new Set(),
});

describe('ChEBI LITE slice', () => {
  it('reads the release header', () => {
    expect(index.ontology).toMatchObject({
      iri: 'http://purl.obolibrary.org/obo/chebi_lite.owl',
      title: 'ChEBI Ontology',
      license: 'https://creativecommons.org/licenses/by/4.0/',
      version: '256',
    });
  });

  it('reads water as ChEBI says it', () => {
    const water = index.terms.get(WATER);
    expect(water.label).toBe('water');
    expect(water.definition).toMatch(/^An oxygen hydride/);
    expect(water.parents).toEqual([`${OBO}CHEBI_33693`, `${OBO}CHEBI_37176`, `${OBO}CHEBI_52625`]);
    expect(water.relations.filter((r) => r.property === HAS_ROLE).length).toBe(6);
  });

  it('imports with every IRI preserved as an exact link', () => {
    const { state, plan } = planImport(index, { roots: ['CHEBI:15377'], depth: 1 });
    for (const thing of plan.things) {
      const proto = state.nodePrototypes.get(thing.id);
      expect(proto.id).toBe(importIds.thing(thing.iri));
      expect(proto.externalLinks).toEqual([thing.iri]);
      expect(resolveLinkState(thing.iri, proto.semanticMetadata)).toBe(LINK_STATES.EXACT);
      expect(proto.semanticMetadata.ontology.iri).toBe(thing.iri);
    }
  });

  it('builds water\'s ladder from linked types, up to the top of ChEBI', () => {
    const { state } = planImport(index, { roots: ['water'], depth: 0 });
    const names = [];
    let cur = state.nodePrototypes.get(importIds.thing(WATER));
    while (cur) { names.push(cur.name); cur = state.nodePrototypes.get(cur.typeNodeId); }
    expect(names[0]).toBe('water');
    expect(names[1]).toBe('oxygen hydride');
    expect(names[names.length - 1]).toBe('chemical entity');
  });

  it('importing the same slice twice produces no duplicates', () => {
    const { state } = planImport(index, { roots: ['CHEBI:15377'], depth: 1 });
    const once = mergeUniverses(empty(), state);
    const twice = mergeUniverses(once.merged, planImport(index, { roots: ['CHEBI:15377'], depth: 1 }).state);
    expect(twice.report.addedPrototypeIds).toEqual([]);
    expect(twice.report.addedGraphIds).toEqual([]);
    expect(twice.report.addedEdgeIds).toEqual([]);
    expect(twice.merged.nodePrototypes.size).toBe(once.merged.nodePrototypes.size);
    const names = [...twice.merged.nodePrototypes.values()].map((p) => p.semanticMetadata?.ontology?.iri).filter(Boolean);
    expect(new Set(names).size).toBe(names.length);
  });

  it('two overlapping slices merge the Things they share by IRI', () => {
    const water = planImport(index, { roots: ['water'], depth: 0 }).state;
    const ethanol = planImport(index, { roots: ['ethanol'], depth: 0 }).state;
    const first = mergeUniverses(empty(), water).merged;
    const { merged, report } = mergeUniverses(first, ethanol);
    // Both are molecular entities: the shared top of the ladder arrives once.
    const chemicalEntity = importIds.thing(`${OBO}CHEBI_24431`);
    expect(report.dedupedIds).toContain(chemicalEntity);
    expect(merged.nodePrototypes.has(importIds.thing(WATER))).toBe(true);
    expect(merged.nodePrototypes.has(importIds.thing(ETHANOL))).toBe(true);
    const iris = [...merged.nodePrototypes.values()].map((p) => p.semanticMetadata?.ontology?.iri).filter(Boolean);
    expect(new Set(iris).size).toBe(iris.length);
  });
});
