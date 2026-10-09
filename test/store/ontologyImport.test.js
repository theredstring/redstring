/**
 * Ontology import into a universe: the built state, merging it into the store,
 * re-importing, overlapping sources, the file round trip, what keeps imported
 * Things alive, and the carousel ladder their linked types make.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import useGraphStore from '../../src/store/graphStore.js';
import { importOntologyText, indexOntology, planImport } from '../../src/formats/ontology/importOntology.js';
import { importIds } from '../../src/formats/ontology/plan.js';
import { applyOntologyImport, createOntologyImportSession } from '../../src/services/ontologyImport.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';
import { canonicalizeLink, resolveLinkState, LINK_STATES } from '../../src/formats/linkState.js';
import { mergeUniverses } from '../../src/formats/mergeUniverses.js';
import { resolveChain, DEFAULT_ABSTRACTION_DIMENSION as DIM, THING_PROTOTYPE_ID as THING } from '../../src/wizard/tools/utils/abstractionSpec.js';

const FIXTURES = path.resolve(__dirname, '../fixtures/ontology');
const ZOO = fs.readFileSync(path.join(FIXTURES, 'zoo.ttl'), 'utf8');
const Z = 'http://example.org/zoo/';
const id = (local) => importIds.thing(Z + local);

/** A second ontology that reuses the zoo's Cat IRI and gives it parts of its own. */
const PETS = `
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix obo: <http://purl.obolibrary.org/obo/> .
@prefix zoo: <http://example.org/zoo/> .
@prefix pets: <http://example.org/pets/> .
<http://example.org/pets.owl> a owl:Ontology ; <http://purl.org/dc/terms/title> "Pet Care" .
obo:BFO_0000051 a owl:ObjectProperty ; rdfs:label "has part" .
pets:Companion a owl:Class ; rdfs:label "companion animal" .
zoo:Cat a owl:Class ; rdfs:label "domestic cat" ; rdfs:subClassOf pets:Companion ;
  rdfs:subClassOf [ a owl:Restriction ; owl:onProperty obo:BFO_0000051 ; owl:someValuesFrom pets:Collar ] .
pets:Collar a owl:Class ; rdfs:label "collar" .
`;

const resetStore = (patch = {}) => {
  useGraphStore.setState({
    graphs: new Map(),
    nodePrototypes: new Map(),
    edges: new Map(),
    edgePrototypes: new Map(),
    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null,
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    isUniverseLoaded: true,
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
    _isLoadingUniverse: false,
    ...patch,
  }, false, 'test_reset');
};

let zooIndex;
beforeAll(async () => {
  zooIndex = await indexOntology({ source: ZOO, fileName: 'zoo.ttl' });
});
const build = (options = {}) => {
  const { state, plan, report } = planImport(zooIndex, options);
  return { state, report, folderWebId: plan.source.folderWebId, sourceId: plan.source.id };
};

describe('the built universe', () => {
  it('has one Thing per term plus the source, keyed by IRI-derived IDs', () => {
    const { state } = build();
    expect(state.nodePrototypes.get(id('Cat'))).toMatchObject({ name: 'cat', typeNodeId: id('Mammal') });
    expect(state.nodePrototypes.get(id('Garfield'))).toMatchObject({ name: 'Garfield', typeNodeId: id('Cat') });
  });

  it('keeps each term\'s IRI as an exact link, recorded as made by the import', () => {
    const cat = build().state.nodePrototypes.get(id('Cat'));
    expect(cat.externalLinks).toEqual([Z + 'Cat']);
    expect(resolveLinkState(Z + 'Cat', cat.semanticMetadata)).toBe(LINK_STATES.EXACT);
    expect(cat.semanticMetadata.linkConfirmations[canonicalizeLink(Z + 'Cat')].by).toBe('import');
  });

  it('records where each Thing came from, readably', () => {
    const { state, sourceId } = build();
    const cat = state.nodePrototypes.get(id('Cat'));
    expect(cat.semanticMetadata.origin).toEqual({ label: 'Zoo Ontology', href: Z + 'Cat', isLocal: false });
    expect(cat.semanticMetadata.ontology).toMatchObject({
      iri: Z + 'Cat',
      source: sourceId,
      synonyms: [{ label: 'house cat', scope: 'exact' }, { label: 'kitty', scope: 'related' }],
      xrefs: ['WIKIDATA:Q146'],
      otherParents: [{ iri: Z + 'Pet', label: 'pet' }],
    });
  });

  it('saves only the source Thing and opens only its folder web', () => {
    const { state, sourceId, folderWebId } = build();
    expect([...state.savedNodeIds]).toEqual([sourceId]);
    expect(state.openGraphIds).toEqual([folderWebId]);
    expect(state.nodePrototypes.get(sourceId)).toMatchObject({ name: 'Zoo Ontology', definitionGraphIds: [folderWebId] });
    expect(state.graphs.get(folderWebId).description).toMatch(/^Folder:/);
  });

  it('draws composition as the whole\'s web, with relations between parts as connections', () => {
    const { state } = build({ roots: ['cat'], depth: 0 });
    const cat = state.nodePrototypes.get(id('Cat'));
    const web = state.graphs.get(cat.definitionGraphIds[0]);
    expect(web.definingNodeIds).toEqual([id('Cat')]);
    const members = [...web.instances.values()].map((i) => state.nodePrototypes.get(i.prototypeId).name).sort();
    expect(members).toEqual(['paw', 'tail', 'whisker']);
    expect(web.edgeIds).toHaveLength(1);
    const edge = state.edges.get(web.edgeIds[0]);
    expect(edge).toMatchObject({ name: 'Adjacent To', definitionNodeIds: [importIds.thing(Z + 'adjacentTo')] });
    expect(edge.directionality.arrowsToward.has(edge.destinationId)).toBe(true);
  });

  it('is identical every time it is built from the same input', () => {
    // Compared as built: the exporter stamps save-time fields (lastViewed) of its own.
    expect(build({ roots: ['cat'] }).state).toEqual(build({ roots: ['cat'] }).state);
  });

  it('survives the .redstring round trip without losing anything', () => {
    const { state } = build();
    const back = importFromRedstring(JSON.parse(JSON.stringify(exportToRedstring(state)))).storeState;
    for (const [pid, p] of state.nodePrototypes) {
      const q = back.nodePrototypes.get(pid);
      expect(q, p.name).toBeTruthy();
      expect(q.name).toBe(p.name);
      expect(q.typeNodeId ?? null).toBe(p.typeNodeId ?? null);
      expect(q.externalLinks).toEqual(p.externalLinks);
      expect(q.semanticMetadata).toEqual(p.semanticMetadata);
      expect(q.definitionGraphIds).toEqual(p.definitionGraphIds);
    }
    for (const [gid, g] of state.graphs) expect(back.graphs.get(gid).instances.size).toBe(g.instances.size);
    expect(back.edges.size).toBe(state.edges.size);
    expect([...back.savedNodeIds]).toEqual([...state.savedNodeIds]);
  });
});

describe('importing into a universe', () => {
  beforeEach(() => resetStore());

  it('adds everything, lays the new webs out and reports it', async () => {
    const built = build({ roots: ['cat'], depth: 0 });
    const result = await applyOntologyImport(built);
    const st = useGraphStore.getState();
    expect(result.addedPrototypeIds.length).toBe(built.state.nodePrototypes.size);
    expect(result.laidOut).toBe(built.state.graphs.size);
    expect(st.nodePrototypes.get(id('Cat')).name).toBe('cat');
    expect(st.openGraphIds).toContain(built.folderWebId);
    expect(st.savedNodeIds.has(built.sourceId)).toBe(true);
  });

  it('importing the same slice twice adds nothing the second time', async () => {
    await applyOntologyImport(build({ roots: ['cat'] }));
    const before = useGraphStore.getState();
    const counts = [before.nodePrototypes.size, before.graphs.size, before.edges.size];
    const second = await applyOntologyImport(build({ roots: ['cat'] }));
    const after = useGraphStore.getState();
    expect([after.nodePrototypes.size, after.graphs.size, after.edges.size]).toEqual(counts);
    expect(second.addedPrototypeIds).toHaveLength(0);
    expect(second.addedGraphIds).toHaveLength(0);
    expect(second.addedEdgeIds).toHaveLength(0);
    for (const g of after.graphs.values()) {
      const protos = [...g.instances.values()].map((i) => i.prototypeId);
      expect(new Set(protos).size).toBe(protos.length);
    }
  });

  it('a second, overlapping slice shares the Things both slices hold', async () => {
    await applyOntologyImport(build({ roots: ['cat'], depth: 0 }));
    const report = await applyOntologyImport(build({ roots: ['dog'], depth: 0 }));
    // Mammal and Animal arrived with Cat already; Dog brings only itself.
    expect(report.dedupedIds).toEqual(expect.arrayContaining([id('Mammal'), id('Animal')]));
    expect(report.addedPrototypeIds).toEqual([id('Dog')]);
    const st = useGraphStore.getState();
    const names = [...st.nodePrototypes.values()].map((p) => p.name);
    expect(names.filter((n) => n === 'mammal')).toHaveLength(1);
    // Both roots now sit in the one folder web.
    const folder = st.graphs.get(build().folderWebId);
    const members = [...folder.instances.values()].map((i) => st.nodePrototypes.get(i.prototypeId).name).sort();
    expect(members).toEqual(['cat', 'dog']);
  });

  it('two different sources merge on the IRI they share', async () => {
    await applyOntologyImport(build({ roots: ['cat'], depth: 0 }));
    const pets = await importOntologyText(PETS, 'pets.ttl', { roots: [Z + 'Cat'], depth: 0 });
    const report = await applyOntologyImport({ state: pets.state, folderWebId: pets.plan.source.folderWebId, sourceId: pets.plan.source.id });
    expect(report.dedupedIds).toContain(id('Cat'));
    const cat = useGraphStore.getState().nodePrototypes.get(id('Cat'));
    // The universe it landed in keeps its name for the Thing; the other source's is kept too.
    expect(cat.name).toBe('cat');
    expect(cat._preserved.merge.name).toBe('domestic cat');
    // Each source's account of what a cat is made of survives, as two definitions.
    expect(cat.definitionGraphIds).toHaveLength(2);
  });

  it('a Thing someone already linked to the same IRI is folded in, not duplicated', async () => {
    const mine = {
      id: 'my-cat', name: 'Cat', description: 'Mine.', color: '#800000', definitionGraphIds: [],
      externalLinks: [Z + 'Cat'],
      semanticMetadata: { linkConfirmations: { [canonicalizeLink(Z + 'Cat')]: { state: 'exact', by: 'user' } } },
    };
    resetStore({ nodePrototypes: new Map([['my-cat', mine]]) });
    const report = await applyOntologyImport(build({ roots: ['cat'], depth: 0 }));
    expect(report.mergedIds).toEqual([{ baseId: 'my-cat', incomingId: id('Cat') }]);
    const st = useGraphStore.getState();
    expect(st.nodePrototypes.has(id('Cat'))).toBe(false);
    expect(st.nodePrototypes.get('my-cat').description).toBe('Mine.');
    // Garfield's type and the composition web both now point at the user's Thing.
    expect(st.nodePrototypes.get(id('Paw'))).toBeTruthy();
    const web = [...st.graphs.values()].find((g) => g.name === 'cat');
    expect(web.definingNodeIds).toEqual(['my-cat']);
  });

  it('merges cleanly through the pure engine as well', () => {
    const { state } = build();
    const empty = { nodePrototypes: new Map(), graphs: new Map(), edges: new Map(), openGraphIds: [], expandedGraphIds: new Set(), savedNodeIds: new Set(), savedGraphIds: new Set() };
    const once = mergeUniverses(empty, state).merged;
    const twice = mergeUniverses(once, state);
    expect(twice.report.addedPrototypeIds).toHaveLength(0);
    expect(twice.merged.nodePrototypes.size).toBe(once.nodePrototypes.size);
  });
});

describe('what keeps imported Things alive', () => {
  beforeEach(() => resetStore());

  it('every imported Thing survives cleanup while its source Thing is live', async () => {
    const built = build();
    await applyOntologyImport(built);
    useGraphStore.getState().cleanupOrphanedData();
    const st = useGraphStore.getState();
    for (const pid of built.state.nodePrototypes.keys()) expect(st.nodePrototypes.has(pid)).toBe(true);
    for (const gid of built.state.graphs.keys()) expect(st.graphs.has(gid)).toBe(true);
  });

  it('removing the source lets its unused Things go, but not one someone put in their own web', async () => {
    const built = build({ roots: ['cat'], depth: 0 });
    await applyOntologyImport(built);
    // The user drops the imported Dog-free "tail" into a web of their own.
    useGraphStore.setState((s) => {
      const graphs = new Map(s.graphs);
      graphs.set('mine', {
        id: 'mine', name: 'Mine', description: '', instances: new Map([['i', { id: 'i', prototypeId: id('Tail'), x: 0, y: 0, scale: 1 }]]),
        groups: new Map(), edgeIds: [], definingNodeIds: [],
      });
      return { graphs, openGraphIds: ['mine'] };
    });
    useGraphStore.setState((s) => {
      const saved = new Set(s.savedNodeIds);
      saved.delete(built.sourceId);
      return { savedNodeIds: saved };
    });
    useGraphStore.getState().cleanupOrphanedData();
    const st = useGraphStore.getState();
    expect(st.nodePrototypes.has(built.sourceId)).toBe(false);
    expect(st.nodePrototypes.has(id('Cat'))).toBe(false);
    expect(st.nodePrototypes.has(id('Tail'))).toBe(true);
    // Tail's type is kept because Tail uses it.
    expect(st.nodePrototypes.has(id('BodyPart'))).toBe(true);
  });
});

describe('the carousel ladder linked types make', () => {
  beforeEach(() => resetStore());

  it('shows the whole specificity stack without storing it', async () => {
    await applyOntologyImport(build());
    const protos = useGraphStore.getState().nodePrototypes.values();
    const r = resolveChain(id('Garfield'), DIM, protos);
    expect(r.chain).toEqual([id('Garfield'), id('Cat'), id('Mammal'), id('Animal'), THING]);
    expect(r.seeded).toBe(true);
  });

  it('lets a rung be added next to any rung of that stack', async () => {
    await applyOntologyImport(build());
    const st = useGraphStore.getState();
    st.addNodePrototype({ id: 'vertebrate', name: 'vertebrate', color: '#800000', typeNodeId: null, definitionGraphIds: [] });
    // Below Mammal (more general), on Garfield's ladder: Mammal is only there through linked types.
    useGraphStore.getState().addToAbstractionChain(id('Garfield'), DIM, 'below', 'vertebrate', id('Mammal'));
    const chain = useGraphStore.getState().nodePrototypes.get(id('Garfield')).abstractionChains[DIM];
    expect(chain).toEqual([id('Garfield'), id('Cat'), id('Mammal'), 'vertebrate', id('Animal'), THING]);
  });

  it('lets a rung that comes from linked types be taken out', async () => {
    await applyOntologyImport(build());
    useGraphStore.getState().removeFromAbstractionChain(id('Garfield'), DIM, id('Mammal'));
    const chain = useGraphStore.getState().nodePrototypes.get(id('Garfield')).abstractionChains[DIM];
    expect(chain).toEqual([id('Garfield'), id('Cat'), id('Animal'), THING]);
  });
});

describe('the import session without a worker', () => {
  it('reads, searches, previews and builds in-process with the same results', async () => {
    const session = createOntologyImportSession();
    const summary = await session.indexText(ZOO, 'zoo.ttl');
    expect(summary).toMatchObject({ terms: 16 });
    const hits = await session.search('garf');
    expect(hits.map((h) => h.label)).toEqual(['Garfield']);
    const preview = await session.preview({ roots: [Z + 'Cat'], depth: 0 });
    expect(preview.things).toBe(build({ roots: [Z + 'Cat'], depth: 0 }).report.things);
    const built = await session.build({ roots: [Z + 'Cat'], depth: 0 });
    expect(built.state.nodePrototypes.has(id('Cat'))).toBe(true);
    expect(built.state.nodePrototypes.get(built.sourceId).semanticMetadata.ontologySource.importedAt).toBeTruthy();
    session.dispose();
  });
});
