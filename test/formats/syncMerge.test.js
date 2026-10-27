import { describe, it, expect } from 'vitest';
import { syncMerge, deepEqual, documentChanged, summarizeSide, PERSONAL_KEYS, rememberInlineImageRef } from '../../src/formats/syncMerge.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

// ---------------------------------------------------------------------------
// Building store states by hand

function makeState({ prototypes = {}, graphs = {}, edges = {}, ...rest } = {}) {
  const nodePrototypes = new Map(Object.entries(prototypes).map(([id, p]) => [id, { id, ...p }]));
  const graphMap = new Map(Object.entries(graphs).map(([id, g]) => {
    const { instances = {}, groups, ...fields } = g;
    const graph = {
      id,
      name: id,
      ...fields,
      instances: new Map(Object.entries(instances).map(([iid, inst]) => [iid, { id: iid, x: 0, y: 0, scale: 1, ...inst }]))
    };
    if (groups) graph.groups = new Map(Object.entries(groups).map(([grid, gr]) => [grid, { id: grid, ...gr }]));
    return [id, graph];
  }));
  const edgeMap = new Map(Object.entries(edges).map(([id, e]) => [id, { id, ...e }]));
  return {
    graphs: graphMap,
    nodePrototypes,
    edges: edgeMap,
    edgePrototypes: new Map(),
    openGraphIds: [...graphMap.keys()],
    activeGraphId: graphMap.keys().next().value ?? null,
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    showConnectionNames: false,
    mergeDismissals: {},
    ...rest
  };
}

/** Structured clone that keeps Maps and Sets. */
const clone = (v) => structuredClone(v);

/** The "Forest" universe both people start from. */
const forest = () => makeState({
  prototypes: {
    tree: { name: 'Tree', color: '#8B4513' },
    bird: { name: 'Bird', color: '#3366AA' },
    soil: { name: 'Soil', color: '#553311', description: 'Dirt' }
  },
  graphs: {
    forest: {
      instances: {
        iTree: { prototypeId: 'tree', x: 0, y: 0 },
        iBird: { prototypeId: 'bird', x: 100, y: 0 },
        iSoil: { prototypeId: 'soil', x: 0, y: 100 }
      },
      edgeIds: ['eLives']
    }
  },
  edges: { eLives: { sourceId: 'iBird', destinationId: 'iTree', typeNodeId: null } }
});

// Store-like edits, cascading the way the store does.
function deleteThing(state, protoId) {
  state.nodePrototypes.delete(protoId);
  for (const graph of state.graphs.values()) {
    for (const [iid, inst] of graph.instances) {
      if (inst.prototypeId === protoId) deleteInstance(state, graph.id, iid);
    }
  }
}
function deleteInstance(state, graphId, iid) {
  const graph = state.graphs.get(graphId);
  graph.instances.delete(iid);
  for (const [eid, edge] of state.edges) {
    if (edge.sourceId === iid || edge.destinationId === iid) {
      state.edges.delete(eid);
      for (const g of state.graphs.values()) if (g.edgeIds) g.edgeIds = g.edgeIds.filter((id) => id !== eid);
    }
  }
}
function addThing(state, graphId, protoId, iid, fields = {}) {
  state.nodePrototypes.set(protoId, { id: protoId, name: protoId, ...fields });
  state.graphs.get(graphId).instances.set(iid, { id: iid, prototypeId: protoId, x: 0, y: 0, scale: 1 });
}
function connect(state, graphId, eid, sourceId, destinationId) {
  state.edges.set(eid, { id: eid, sourceId, destinationId, typeNodeId: null });
  const graph = state.graphs.get(graphId);
  graph.edgeIds = [...(graph.edgeIds || []), eid];
}

/** Document part of a state with set-like arrays sorted, for order-free comparison. */
function docOf(state) {
  const out = {};
  for (const key of ['graphs', 'nodePrototypes', 'edges', 'edgePrototypes', 'savedNodeIds', 'savedGraphIds', 'mergeDismissals']) {
    out[key] = sortSetLike(state[key]);
  }
  return out;
}
function sortSetLike(v, field) {
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, sortSetLike(x)]));
  if (v instanceof Set) return new Set(v);
  if (Array.isArray(v)) {
    const arr = v.map((x) => sortSetLike(x));
    return ['edgeIds', 'definitionGraphIds', 'definingNodeIds', 'externalLinks', 'memberInstanceIds'].includes(field)
      ? arr.sort() : arr;
  }
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = sortSetLike(x, k);
    return o;
  }
  return v;
}

/** References that point nowhere. */
function danglingRefs(state) {
  const out = [];
  const instanceIds = new Set();
  for (const g of state.graphs.values()) for (const iid of g.instances.keys()) instanceIds.add(iid);
  for (const g of state.graphs.values()) {
    for (const inst of g.instances.values()) {
      if (inst.prototypeId && !state.nodePrototypes.has(inst.prototypeId)) out.push(`instance ${inst.id} → prototype ${inst.prototypeId}`);
    }
    for (const eid of g.edgeIds || []) if (!state.edges.has(eid)) out.push(`graph ${g.id} → edge ${eid}`);
  }
  for (const e of state.edges.values()) {
    if (!instanceIds.has(e.sourceId)) out.push(`edge ${e.id} → source ${e.sourceId}`);
    if (!instanceIds.has(e.destinationId)) out.push(`edge ${e.id} → destination ${e.destinationId}`);
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('syncMerge: one side changed', () => {
  it('takes theirs when only they changed anything', () => {
    const base = forest();
    const theirs = clone(base);
    theirs.nodePrototypes.get('tree').name = 'Oak';
    addThing(theirs, 'forest', 'fungus', 'iFungus');
    const { merged, safe } = syncMerge(base, clone(base), theirs);
    expect(safe).toBe(true);
    expect(deepEqual(docOf(merged), docOf(theirs))).toBe(true);
  });

  it('takes ours when only we changed anything', () => {
    const base = forest();
    const ours = clone(base);
    deleteThing(ours, 'soil');
    const { merged } = syncMerge(base, ours, clone(base));
    expect(deepEqual(docOf(merged), docOf(ours))).toBe(true);
  });

  it('a merge with no changes anywhere is the base', () => {
    const base = forest();
    const { merged, report } = syncMerge(base, clone(base), clone(base));
    expect(deepEqual(docOf(merged), docOf(base))).toBe(true);
    expect(report.conflicts).toHaveLength(0);
    expect(report.restored).toHaveLength(0);
  });
});

describe('syncMerge: both sides changed', () => {
  it('keeps additions from both sides', () => {
    const base = forest();
    const ours = clone(base);
    const theirs = clone(base);
    addThing(ours, 'forest', 'fungus', 'iFungus');
    addThing(theirs, 'forest', 'squirrel', 'iSquirrel');
    const { merged } = syncMerge(base, ours, theirs);
    expect(merged.nodePrototypes.has('fungus')).toBe(true);
    expect(merged.nodePrototypes.has('squirrel')).toBe(true);
    const placed = merged.graphs.get('forest').instances;
    expect(placed.has('iFungus') && placed.has('iSquirrel') && placed.has('iTree')).toBe(true);
  });

  it('combines different fields of the same Thing with no conflict', () => {
    const base = forest();
    const ours = clone(base);
    const theirs = clone(base);
    ours.nodePrototypes.get('tree').name = 'Oak';
    theirs.nodePrototypes.get('tree').color = '#00AA00';
    const { merged, report } = syncMerge(base, ours, theirs);
    expect(merged.nodePrototypes.get('tree')).toMatchObject({ name: 'Oak', color: '#00AA00' });
    expect(report.conflicts).toHaveLength(0);
  });

  it('same field, two values: theirs wins and ours is banked', () => {
    const base = forest();
    const ours = clone(base);
    const theirs = clone(base);
    ours.nodePrototypes.get('bird').name = 'Sparrow';
    theirs.nodePrototypes.get('bird').name = 'Robin';
    const { merged, report } = syncMerge(base, ours, theirs);
    const bird = merged.nodePrototypes.get('bird');
    expect(bird.name).toBe('Robin');
    expect(bird._preserved.merge.name).toBe('Sparrow');
    expect(report.conflicts).toEqual([
      expect.objectContaining({ kind: 'prototype', id: 'bird', field: 'name', kept: 'theirs', banked: true })
    ]);
  });

  it('conflictWinner: ours flips who wins, and the loser is still banked', () => {
    const base = forest();
    const ours = clone(base);
    const theirs = clone(base);
    ours.nodePrototypes.get('bird').name = 'Sparrow';
    theirs.nodePrototypes.get('bird').name = 'Robin';
    const { merged } = syncMerge(base, ours, theirs, { conflictWinner: 'ours' });
    expect(merged.nodePrototypes.get('bird').name).toBe('Sparrow');
    expect(merged.nodePrototypes.get('bird')._preserved.merge.name).toBe('Robin');
  });

  it('does not bank lost positions', () => {
    const base = forest();
    const ours = clone(base);
    const theirs = clone(base);
    ours.graphs.get('forest').instances.get('iBird').x = 500;
    theirs.graphs.get('forest').instances.get('iBird').x = 900;
    const { merged, report } = syncMerge(base, ours, theirs);
    const bird = merged.graphs.get('forest').instances.get('iBird');
    expect(bird.x).toBe(900);
    expect(bird._preserved).toBeUndefined();
    expect(report.conflicts[0]).toMatchObject({ kind: 'instance', field: 'x', banked: false });
  });

  it('two people moving different nodes in one web both land', () => {
    const base = forest();
    const ours = clone(base);
    const theirs = clone(base);
    ours.graphs.get('forest').instances.get('iBird').x = 500;
    theirs.graphs.get('forest').instances.get('iTree').y = -40;
    const { merged, report } = syncMerge(base, ours, theirs);
    const placed = merged.graphs.get('forest').instances;
    expect(placed.get('iBird').x).toBe(500);
    expect(placed.get('iTree').y).toBe(-40);
    expect(report.conflicts).toHaveLength(0);
  });
});

describe('syncMerge: deletions', () => {
  // The file leaves a web's groups out once it has none, so the other side
  // reads them as a missing field. That used to make the side that added a
  // group "change" the field and win: the deleted group came back.
  it('deleting a web\'s last group stands against a group made on the other side', () => {
    const base = forest();
    base.graphs.get('forest').groups = new Map([['gOld', { id: 'gOld', name: 'Old', memberInstanceIds: ['iTree', 'iBird'] }]]);
    const theirs = clone(base);
    delete theirs.graphs.get('forest').groups;
    const ours = clone(base);
    ours.graphs.get('forest').groups.set('gNew', { id: 'gNew', name: 'New', memberInstanceIds: ['iSoil'] });
    const { merged } = syncMerge(base, ours, theirs);
    expect([...merged.graphs.get('forest').groups.keys()]).toEqual(['gNew']);
    // And the other way round.
    const back = syncMerge(base, theirs, ours).merged;
    expect([...back.graphs.get('forest').groups.keys()]).toEqual(['gNew']);
  });

  it('a deletion on one side wins over an untouched copy', () => {
    const base = forest();
    const ours = clone(base);
    deleteThing(ours, 'bird');
    const theirs = clone(base);
    theirs.nodePrototypes.get('tree').name = 'Oak';
    const { merged } = syncMerge(base, ours, theirs);
    expect(merged.nodePrototypes.has('bird')).toBe(false);
    expect(merged.graphs.get('forest').instances.has('iBird')).toBe(false);
    expect(merged.edges.has('eLives')).toBe(false);
    expect(merged.graphs.get('forest').edgeIds).toEqual([]);
    expect(merged.nodePrototypes.get('tree').name).toBe('Oak');
  });

  it('delete vs edit: the edit wins and the Thing comes back', () => {
    const base = forest();
    const ours = clone(base);
    deleteThing(ours, 'soil');
    const theirs = clone(base);
    theirs.nodePrototypes.get('soil').description = 'Rich loam';
    const { merged, report } = syncMerge(base, ours, theirs);
    expect(merged.nodePrototypes.get('soil').description).toBe('Rich loam');
    expect(report.restored).toContainEqual(expect.objectContaining({ kind: 'prototype', id: 'soil', deletedBy: 'ours' }));
  });

  it('both deleting the same thing deletes it', () => {
    const base = forest();
    const ours = clone(base);
    const theirs = clone(base);
    deleteThing(ours, 'soil');
    deleteThing(theirs, 'soil');
    const { merged } = syncMerge(base, ours, theirs);
    expect(merged.nodePrototypes.has('soil')).toBe(false);
  });

  it('a new connection to a placement the other side deleted brings the placement back', () => {
    // Ana (ours) deletes Soil. Ben (theirs) adds Squirrel and connects it to Soil.
    const base = forest();
    const ours = clone(base);
    deleteThing(ours, 'soil');
    const theirs = clone(base);
    addThing(theirs, 'forest', 'squirrel', 'iSquirrel');
    connect(theirs, 'forest', 'eBuries', 'iSquirrel', 'iSoil');
    const { merged, report } = syncMerge(base, ours, theirs);
    expect(merged.edges.has('eBuries')).toBe(true);
    expect(merged.graphs.get('forest').instances.has('iSoil')).toBe(true);
    expect(merged.nodePrototypes.has('soil')).toBe(true);
    expect(danglingRefs(merged)).toEqual([]);
    expect(report.restored.map((r) => r.id)).toEqual(expect.arrayContaining(['iSoil', 'soil']));
  });

  it('an untouched connection does not resurrect what it pointed at', () => {
    const base = forest();
    const ours = clone(base);
    deleteThing(ours, 'tree'); // also removes eLives (Bird → Tree)
    const theirs = clone(base);
    theirs.nodePrototypes.get('soil').color = '#000000';
    const { merged, report } = syncMerge(base, ours, theirs);
    expect(merged.nodePrototypes.has('tree')).toBe(false);
    expect(merged.edges.has('eLives')).toBe(false);
    expect(report.restored).toHaveLength(0);
    expect(danglingRefs(merged)).toEqual([]);
  });
});

describe('syncMerge: webs and sets', () => {
  it('merges set-like id lists as sets', () => {
    const base = forest();
    base.nodePrototypes.get('tree').definitionGraphIds = ['forest'];
    const ours = clone(base);
    const theirs = clone(base);
    ours.graphs.set('roots', { id: 'roots', name: 'Roots', instances: new Map() });
    ours.nodePrototypes.get('tree').definitionGraphIds.push('roots');
    theirs.graphs.set('canopy', { id: 'canopy', name: 'Canopy', instances: new Map() });
    theirs.nodePrototypes.get('tree').definitionGraphIds.push('canopy');
    const { merged, report } = syncMerge(base, ours, theirs);
    expect(merged.nodePrototypes.get('tree').definitionGraphIds).toEqual(['forest', 'roots', 'canopy']);
    expect(report.conflicts).toHaveLength(0);
  });

  it('merges saved sets', () => {
    const base = forest();
    base.savedNodeIds = new Set(['tree']);
    const ours = clone(base);
    const theirs = clone(base);
    ours.savedNodeIds.add('bird');
    theirs.savedNodeIds.delete('tree');
    theirs.savedNodeIds.add('soil');
    const { merged } = syncMerge(base, ours, theirs);
    expect([...merged.savedNodeIds].sort()).toEqual(['bird', 'soil']);
  });

  it('prunes group members that were deleted', () => {
    const base = forest();
    base.graphs.get('forest').groups = new Map([['g1', { id: 'g1', name: 'Life', memberInstanceIds: ['iTree', 'iBird'] }]]);
    const ours = clone(base);
    deleteThing(ours, 'bird');
    const theirs = clone(base);
    theirs.graphs.get('forest').groups.get('g1').name = 'Living things';
    const { merged } = syncMerge(base, ours, theirs);
    const group = merged.graphs.get('forest').groups.get('g1');
    expect(group.name).toBe('Living things');
    expect(group.memberInstanceIds).toEqual(['iTree']);
  });

  it('ignores stamp-only differences', () => {
    const base = forest();
    base.graphs.get('forest').groups = new Map([['g1', { id: 'g1', name: 'Life', memberInstanceIds: [], semanticMetadata: { lastModified: '2026-01-01' } }]]);
    const theirs = clone(base);
    theirs.graphs.get('forest').groups.get('g1').semanticMetadata.lastModified = '2026-10-16';
    expect(documentChanged(base, theirs)).toBe(false);
  });
});

describe('syncMerge: images are one unit, compared by the picture', () => {
  // The canvas holds a picture inline; the repository holds the same picture
  // as a ref with the inline copy cleared. Review finding: field by field,
  // that read as an edit everywhere.
  const INLINE = 'data:image/png;base64,AAAA';
  const withPicture = (state, id, fields) => Object.assign(state.nodePrototypes.get(id), fields);

  it('an inline picture and the same picture as a ref are no change', () => {
    rememberInlineImageRef(INLINE, 'sha256:aaaa');
    const base = forest();
    withPicture(base, 'tree', { imageSrc: null, imageRef: 'sha256:aaaa', imageRefExt: 'png' });
    const ours = clone(base);
    withPicture(ours, 'tree', { imageSrc: INLINE, imageRef: undefined, imageRefExt: undefined });
    expect(documentChanged(base, ours)).toBe(false);
  });

  it('a collaborator\'s delete is not undone by a picture held inline', () => {
    rememberInlineImageRef(INLINE, 'sha256:aaaa');
    const base = forest();
    withPicture(base, 'tree', { imageSrc: null, imageRef: 'sha256:aaaa' });
    const ours = clone(base);
    withPicture(ours, 'tree', { imageSrc: INLINE });
    const theirs = clone(base);
    deleteThing(theirs, 'tree');
    const { merged } = syncMerge(base, ours, theirs);
    expect(merged.nodePrototypes.has('tree')).toBe(false);
  });

  it('a collaborator\'s new picture replaces the old one whole', () => {
    rememberInlineImageRef(INLINE, 'sha256:aaaa');
    const base = forest();
    withPicture(base, 'tree', { imageSrc: null, imageRef: 'sha256:aaaa', imageRefExt: 'png' });
    const ours = clone(base);
    withPicture(ours, 'tree', { imageSrc: INLINE, name: 'Oak' });
    const theirs = clone(base);
    withPicture(theirs, 'tree', { imageSrc: null, imageRef: 'sha256:bbbb', imageRefExt: 'jpg' });
    const tree = syncMerge(base, ours, theirs).merged.nodePrototypes.get('tree');
    expect(tree).toMatchObject({ name: 'Oak', imageRef: 'sha256:bbbb', imageRefExt: 'jpg' });
    expect(tree.imageSrc ?? null).toBeNull(); // never the old inline copy beside the new ref
  });

  it('a picture this device added stays inline', () => {
    const base = forest();
    const ours = clone(base);
    withPicture(ours, 'bird', { imageSrc: 'data:image/png;base64,BBBB' });
    const theirs = clone(base);
    theirs.nodePrototypes.get('bird').name = 'Robin';
    const bird = syncMerge(base, ours, theirs).merged.nodePrototypes.get('bird');
    expect(bird).toMatchObject({ name: 'Robin', imageSrc: 'data:image/png;base64,BBBB' });
  });
});

describe('syncMerge: lists of objects merge by key', () => {
  it('equivalentClasses entries are matched by @id, not by reference', () => {
    // Review finding: [A,B] / [A,B,C] / [A] gave [A,B,C,A].
    const cls = (id) => ({ '@id': id, source: 'wikidata' });
    const base = forest();
    base.nodePrototypes.get('tree').equivalentClasses = [cls('Q1'), cls('Q2')];
    const ours = clone(base);
    ours.nodePrototypes.get('tree').equivalentClasses.push(cls('Q3'));
    const theirs = clone(base);
    theirs.nodePrototypes.get('tree').equivalentClasses = [cls('Q1')];
    const got = syncMerge(base, ours, theirs).merged.nodePrototypes.get('tree').equivalentClasses;
    expect(got.map((c) => c['@id'])).toEqual(['Q1', 'Q3']);
  });
});

describe('syncMerge: personal state', () => {
  it('keeps our open webs and tabs, pruned of what the merge removed', () => {
    const base = forest();
    base.graphs.set('scratch', { id: 'scratch', name: 'Scratch', instances: new Map() });
    const ours = clone(base);
    ours.openGraphIds = ['scratch', 'forest'];
    ours.activeGraphId = 'scratch';
    ours.rightPanelTabs = [{ type: 'home', isActive: false }, { type: 'node', nodeId: 'bird', isActive: true }];
    const theirs = clone(base);
    theirs.graphs.delete('scratch');
    deleteThing(theirs, 'bird');
    theirs.openGraphIds = ['forest'];
    theirs.rightPanelTabs = [{ type: 'home', isActive: true }];
    const { merged } = syncMerge(base, ours, theirs);
    expect(merged.openGraphIds).toEqual(['forest']);
    expect(merged.activeGraphId).toBe('forest');
    expect(merged.rightPanelTabs).toEqual([{ type: 'home', isActive: true }]);
  });

  it('never takes their open tabs', () => {
    const base = forest();
    base.graphs.set('b', { id: 'b', name: 'B', instances: new Map() });
    const ours = clone(base);
    ours.openGraphIds = ['forest'];
    const theirs = clone(base);
    theirs.openGraphIds = ['b', 'forest'];
    const { merged } = syncMerge(base, ours, theirs);
    expect(merged.openGraphIds).toEqual(['forest']);
    for (const key of PERSONAL_KEYS) expect(key in merged).toBe(true);
  });
});

describe('syncMerge: safety', () => {
  function bigBase(n) {
    const prototypes = {};
    const instances = {};
    for (let i = 0; i < n; i++) {
      prototypes[`p${i}`] = { name: `Thing ${i}` };
      instances[`i${i}`] = { prototypeId: `p${i}` };
    }
    return makeState({ prototypes, graphs: { web: { instances } } });
  }

  it('refuses to auto-merge when a side deleted most of the universe', () => {
    const base = bigBase(100);
    const ours = clone(base);
    for (let i = 0; i < 80; i++) deleteThing(ours, `p${i}`);
    const { merged, safe, reason, report } = syncMerge(base, ours, clone(base));
    expect(safe).toBe(false);
    expect(merged).toBeNull();
    expect(report.massDeletion).toMatchObject({ side: 'ours', deleted: 80 });
    expect(reason).toMatch(/This device removed 80/);
  });

  it('refuses a mass deletion arriving from the repository too', () => {
    const base = bigBase(100);
    const theirs = clone(base);
    for (let i = 0; i < 50; i++) deleteThing(theirs, `p${i}`);
    expect(syncMerge(base, clone(base), theirs).safe).toBe(false);
  });

  it('allows ordinary deletions in a big universe', () => {
    const base = bigBase(100);
    const ours = clone(base);
    for (let i = 0; i < 10; i++) deleteThing(ours, `p${i}`);
    expect(syncMerge(base, ours, clone(base)).safe).toBe(true);
  });

  it('refuses a collapse even in a small universe (a failed load, not an edit)', () => {
    const base = bigBase(15);
    const ours = clone(base);
    for (let i = 1; i < 15; i++) deleteThing(ours, `p${i}`); // one Thing left
    expect(syncMerge(base, ours, clone(base)).safe).toBe(false);
  });

  it('refuses losing every web', () => {
    const base = forest();
    const ours = clone(base);
    ours.graphs.clear();
    expect(syncMerge(base, ours, clone(base)).safe).toBe(false);
  });

  it('allows a small universe to change a lot', () => {
    const base = forest();
    const ours = clone(base);
    deleteThing(ours, 'tree');
    deleteThing(ours, 'bird');
    expect(syncMerge(base, ours, clone(base)).safe).toBe(true);
  });

  it('never mutates its inputs', () => {
    const base = forest();
    const ours = clone(base);
    deleteThing(ours, 'soil');
    const theirs = clone(base);
    addThing(theirs, 'forest', 'squirrel', 'iSquirrel');
    connect(theirs, 'forest', 'eBuries', 'iSquirrel', 'iSoil');
    theirs.nodePrototypes.get('bird').name = 'Robin';
    ours.nodePrototypes.get('bird').name = 'Sparrow';
    const snapshots = [clone(base), clone(ours), clone(theirs)];
    syncMerge(base, ours, theirs);
    expect(deepEqual(base, snapshots[0])).toBe(true);
    expect(deepEqual(ours, snapshots[1])).toBe(true);
    expect(deepEqual(theirs, snapshots[2])).toBe(true);
  });
});

describe('syncMerge: report', () => {
  it('summarizes what the other side did', () => {
    const base = forest();
    const theirs = clone(base);
    theirs.nodePrototypes.get('tree').name = 'Oak';
    addThing(theirs, 'forest', 'fungus', 'iFungus');
    connect(theirs, 'forest', 'eFeeds', 'iFungus', 'iTree');
    const { report } = syncMerge(base, clone(base), theirs);
    expect(summarizeSide(report.theirs)).toEqual({ things: 2, webs: 1, connections: 1 });
    expect(summarizeSide(report.ours)).toEqual({ things: 0, webs: 0, connections: 0 });
  });
});

// ---------------------------------------------------------------------------
// Properties over random edits

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomUniverse(rand, n = 12) {
  const prototypes = {};
  const instances = {};
  for (let i = 0; i < n; i++) {
    prototypes[`p${i}`] = { name: `Thing ${i}`, color: '#111111', definitionGraphIds: [] };
    instances[`i${i}`] = { prototypeId: `p${i}`, x: i * 10, y: 0 };
  }
  const state = makeState({ prototypes, graphs: { web: { instances, edgeIds: [] } } });
  for (let i = 0; i < n; i++) {
    const a = `i${Math.floor(rand() * n)}`;
    const b = `i${Math.floor(rand() * n)}`;
    if (a !== b) connect(state, 'web', `e${i}`, a, b);
  }
  return state;
}

function randomEdits(state, rand, tag, count = 8) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  for (let k = 0; k < count; k++) {
    const protoIds = [...state.nodePrototypes.keys()];
    const web = state.graphs.get('web');
    const instIds = [...web.instances.keys()];
    const op = Math.floor(rand() * 7);
    if (op === 0 && protoIds.length) state.nodePrototypes.get(pick(protoIds)).name = `${tag} name ${k}`;
    else if (op === 1 && protoIds.length) state.nodePrototypes.get(pick(protoIds)).color = `#${tag === 'A' ? 'AA' : 'BB'}00${k}0`;
    else if (op === 2 && protoIds.length > 2) deleteThing(state, pick(protoIds));
    else if (op === 3) addThing(state, 'web', `${tag}p${k}`, `${tag}i${k}`);
    else if (op === 4 && instIds.length) web.instances.get(pick(instIds)).x = Math.floor(rand() * 1000);
    else if (op === 5 && instIds.length > 1) {
      const a = pick(instIds);
      const b = pick(instIds);
      if (a !== b) connect(state, 'web', `${tag}e${k}`, a, b);
    } else if (op === 6 && state.edges.size) {
      const eid = pick([...state.edges.keys()]);
      state.edges.delete(eid);
      web.edgeIds = web.edgeIds.filter((id) => id !== eid);
    }
  }
}

describe('syncMerge: properties over random edits', () => {
  const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

  it('leaves no dangling references', () => {
    for (const seed of SEEDS) {
      const rand = rng(seed);
      const base = randomUniverse(rand);
      const ours = clone(base);
      const theirs = clone(base);
      randomEdits(ours, rand, 'A');
      randomEdits(theirs, rand, 'B');
      const { merged, safe } = syncMerge(base, ours, theirs);
      if (!safe) continue;
      expect(danglingRefs(merged), `seed ${seed}`).toEqual([]);
    }
  });

  it('gives the same document whichever side is "ours" (with the winner flipped)', () => {
    for (const seed of SEEDS) {
      const rand = rng(seed);
      const base = randomUniverse(rand);
      const a = clone(base);
      const b = clone(base);
      randomEdits(a, rand, 'A');
      randomEdits(b, rand, 'B');
      const one = syncMerge(base, a, b, { conflictWinner: 'theirs' });
      const two = syncMerge(base, b, a, { conflictWinner: 'ours' });
      expect(one.safe).toBe(two.safe);
      if (!one.safe) continue;
      expect(deepEqual(docOf(one.merged), docOf(two.merged)), `seed ${seed}`).toBe(true);
    }
  });

  it('merging with an unchanged side returns the changed side', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const rand = rng(seed);
      const base = randomUniverse(rand);
      const changed = clone(base);
      randomEdits(changed, rand, 'A');
      const left = syncMerge(base, changed, clone(base));
      const right = syncMerge(base, clone(base), changed);
      if (!left.safe) continue;
      expect(deepEqual(docOf(left.merged), docOf(changed)), `seed ${seed}`).toBe(true);
      expect(deepEqual(docOf(right.merged), docOf(changed)), `seed ${seed}`).toBe(true);
    }
  });

  it('keeps every edit that did not collide', () => {
    for (const seed of SEEDS) {
      const rand = rng(seed);
      const base = randomUniverse(rand);
      const ours = clone(base);
      const theirs = clone(base);
      randomEdits(ours, rand, 'A');
      randomEdits(theirs, rand, 'B');
      const { merged, safe } = syncMerge(base, ours, theirs);
      if (!safe) continue;
      // Every Thing either side added is present.
      for (const side of [ours, theirs]) {
        for (const id of side.nodePrototypes.keys()) {
          if (!base.nodePrototypes.has(id)) expect(merged.nodePrototypes.has(id), `seed ${seed}: added ${id}`).toBe(true);
        }
      }
      // A Thing deleted by one side and untouched by the other is gone.
      for (const [id, proto] of base.nodePrototypes) {
        const inOurs = ours.nodePrototypes.get(id);
        const inTheirs = theirs.nodePrototypes.get(id);
        if (!inOurs && inTheirs && deepEqual(inTheirs, proto) && !merged.nodePrototypes.has(id)) continue;
        if (!inOurs && !inTheirs) expect(merged.nodePrototypes.has(id), `seed ${seed}: both deleted ${id}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Through the real file format

describe('syncMerge: through the file format', () => {
  const roundTrip = (state) => importFromRedstring(JSON.parse(JSON.stringify(exportToRedstring(state)))).storeState;

  it('an export → import round trip is not seen as a change', () => {
    const base = roundTrip(forest());
    const again = roundTrip(base);
    expect(documentChanged(base, again)).toBe(false);
  });

  it('the merged state exports and re-imports cleanly', () => {
    const base = roundTrip(forest());
    const ours = clone(base);
    deleteThing(ours, 'soil');
    ours.nodePrototypes.get('bird').name = 'Sparrow';
    const theirs = clone(base);
    addThing(theirs, 'forest', 'squirrel', 'iSquirrel');
    connect(theirs, 'forest', 'eBuries', 'iSquirrel', 'iSoil');
    theirs.nodePrototypes.get('bird').name = 'Robin';
    const { merged } = syncMerge(base, roundTrip(ours), roundTrip(theirs));
    const back = roundTrip(merged);
    expect(documentChanged(merged, back)).toBe(false);
    expect(back.nodePrototypes.get('bird').name).toBe('Robin');
    expect(back.nodePrototypes.get('bird')._preserved.merge.name).toBe('Sparrow');
    expect(back.edges.has('eBuries')).toBe(true);
  });
});
