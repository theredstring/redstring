import { describe, it, expect } from 'vitest';
import { slotsHaveEqualKnowledge } from '../../src/services/semanticHash.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';
import { MIGRATIONS } from '../../src/formats/migrations.js';

/**
 * P4.3 — Slot matrix tests.
 *
 * detectSlotConflict uses slotsHaveEqualKnowledge(localStoreState, gitStoreState)
 * as its verdict function. These tests enumerate the cross-version matrix and
 * edge cases to prove the verdict is correct in each cell.
 *
 * Matrix dimensions:
 *   Format:    v3 bytes  |  v4 bytes
 *   Knowledge: same  |  divergent
 *   Primary:   populated  |  empty
 *
 * After importing, both v3 and v4 bytes produce equal store states for the
 * same knowledge (the keystone from P4.1). This test suite proves the
 * DETECTION layer is correct — the conflict-prompt and auto-sync decision
 * branches in detectSlotConflict are unchanged (only isDifferent is replaced).
 */

// ── State builders ───────────────────────────────────────────────────────────

const buildState = (names = ['dog', 'cat']) => {
  const nodePrototypes = new Map(
    names.map((n) => [n, { id: n, name: n, description: '', definitionGraphIds: [], abstractionChains: {} }]),
  );
  // Only create an instance when there are prototypes to reference.
  const instances = names.length > 0
    ? new Map([['i1', { id: 'i1', prototypeId: names[0], x: 10, y: 20, scale: 1 }]])
    : new Map();
  const graphs = new Map([
    ['g1', { id: 'g1', name: 'Main', description: '', instances, edgeIds: [], definingNodeIds: [] }],
  ]);
  return {
    graphs, nodePrototypes, edges: new Map(),
    openGraphIds: ['g1'], activeGraphId: 'g1', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false,
  };
};

// Simulate loading a state that was stored as a v3 file (explicit emitV4:false).
const storeStateFromV3 = (state) => {
  const doc = exportToRedstring(state, null, { emitV4: false });
  return importFromRedstring(doc, {}).storeState;
};

// Simulate loading a state that was stored as a v4 file (default — EMIT_V4=true).
const storeStateFromV4 = (state) => {
  const v4doc = exportToRedstring(state);
  return importFromRedstring(v4doc, {}).storeState;
};

// Simulate the 3→4 migration path (now live in MIGRATIONS).
const storeStateFromMigrated = (state) => {
  const v3doc = exportToRedstring(state, null, { emitV4: false });
  const migrate = MIGRATIONS.find((m) => m.from === '3.0.0' && m.to === '4.0.0');
  const v4 = migrate.migrate(v3doc);
  const v4Doc = { ...v4, format: 'redstring-v4.0.0', metadata: { ...(v4.metadata || {}), version: '4.0.0' } };
  return importFromRedstring(v4Doc, {}).storeState;
};

// ── Matrix: same knowledge ────────────────────────────────────────────────────

describe('P4.3 — slot matrix: same knowledge (→ in-sync)', () => {
  it('v3 git / v3 local — identical bytes → in-sync', async () => {
    const state = buildState();
    const local = storeStateFromV3(state);
    const git = storeStateFromV3(state);
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(true);
  });

  it('v3 git / v4 local — same knowledge → in-sync (the core false-conflict fix)', async () => {
    const state = buildState();
    const git = storeStateFromV3(state);
    const local = storeStateFromV4(state);
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(true);
  });

  it('v4 git / v3 local — same knowledge → in-sync', async () => {
    const state = buildState();
    const git = storeStateFromV4(state);
    const local = storeStateFromV3(state);
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(true);
  });

  it('v4 git / v4 local — same knowledge → in-sync', async () => {
    const state = buildState();
    const git = storeStateFromV4(state);
    const local = storeStateFromV4(state);
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(true);
  });

  it('v3 git / migrated-v4 local — same knowledge (now live migration path) → in-sync', async () => {
    const state = buildState();
    const git = storeStateFromV3(state);
    const local = storeStateFromMigrated(state);
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(true);
  });
});

// ── Matrix: divergent knowledge ──────────────────────────────────────────────

describe('P4.3 — slot matrix: divergent knowledge (→ conflict-prompt)', () => {
  it('v3 git / v3 local — different prototypes → conflict', async () => {
    const git = storeStateFromV3(buildState(['dog', 'cat']));
    const local = storeStateFromV3(buildState(['dog', 'fish']));
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(false);
  });

  it('v3 git / v4 local — different prototypes → conflict', async () => {
    const git = storeStateFromV3(buildState(['dog', 'cat']));
    const local = storeStateFromV4(buildState(['dog', 'fish']));
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(false);
  });

  it('divergence in node count only (not format) → conflict', async () => {
    const git = storeStateFromV3(buildState(['dog', 'cat', 'bird']));
    const local = storeStateFromV3(buildState(['dog', 'cat']));
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(false);
  });

  it('same prototype names but different abstractions → conflict', async () => {
    const s1 = buildState(['life', 'animal', 'dog']);
    s1.nodePrototypes.get('dog').abstractionChains = { Bio: ['life', 'animal', 'dog'] };
    const s2 = buildState(['life', 'animal', 'dog']);
    // s2 has no abstraction chains
    const git = storeStateFromV3(s1);
    const local = storeStateFromV3(s2);
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(false);
  });
});

// ── Matrix: primary-empty / populated-secondary trap ────────────────────────

describe('P4.3 — slot matrix: empty-primary / populated-secondary trap', () => {
  it('empty local vs populated git → slotsHaveEqualKnowledge reports NOT equal', async () => {
    const emptyLocal = buildState([]); // no prototypes
    const populatedGit = buildState(['dog', 'cat']);
    const local = storeStateFromV3(emptyLocal);
    const git = storeStateFromV3(populatedGit);
    // detectSlotConflict would catch this via nodeCount===0 pre-check and
    // return null (no conflict, non-empty side wins). But for completeness:
    // the semantic hash does see them as different.
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(false);
  });

  it('populated local vs empty git → slotsHaveEqualKnowledge reports NOT equal', async () => {
    const populatedLocal = buildState(['dog', 'cat']);
    const emptyGit = buildState([]);
    const local = storeStateFromV3(populatedLocal);
    const git = storeStateFromV3(emptyGit);
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(false);
  });

  it('both empty → slotsHaveEqualKnowledge reports equal (caught by pre-check in detectSlotConflict)', async () => {
    const local = storeStateFromV3(buildState([]));
    const git = storeStateFromV3(buildState([]));
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(true);
  });
});

// ── Cross-version with non-trivial content ───────────────────────────────────

describe('P4.3 — cross-version with richer content', () => {
  const buildRich = () => {
    const state = buildState(['life', 'animal', 'dog']);
    state.nodePrototypes.get('dog').abstractionChains = { Bio: ['life', 'animal', 'dog'] };
    state.nodePrototypes.get('animal').abstractionChains = { Bio: ['life', 'animal'] };
    const instances = new Map([
      ['i1', { id: 'i1', prototypeId: 'dog', x: 10, y: 20, scale: 1 }],
      ['i2', { id: 'i2', prototypeId: 'animal', x: 50, y: 20, scale: 1 }],
    ]);
    state.graphs.get('g1').instances = instances;
    state.graphs.get('g1').edgeIds = ['e1'];
    state.edges = new Map([
      ['e1', {
        id: 'e1', sourceId: 'i1', destinationId: 'i2',
        typeNodeId: 'base-connection-prototype', definitionNodeIds: [],
        directionality: { arrowsToward: new Set(['i2']) },
      }],
    ]);
    return state;
  };

  it('rich state: v3 git / v4 local with same content → in-sync', async () => {
    const rich = buildRich();
    const git = storeStateFromV3(rich);
    const local = storeStateFromV4(rich);
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(true);
  });

  it('rich state: adding a prototype in local only → conflict', async () => {
    const rich = buildRich();
    const richPlus = buildRich();
    richPlus.nodePrototypes.set('cat', { id: 'cat', name: 'Cat', description: '', definitionGraphIds: [], abstractionChains: {} });
    const git = storeStateFromV3(rich);
    const local = storeStateFromV4(richPlus);
    expect(await slotsHaveEqualKnowledge(local, git)).toBe(false);
  });
});
