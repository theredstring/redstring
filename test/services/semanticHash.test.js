import { describe, it, expect, beforeAll } from 'vitest';
import {
  semanticHash,
  semanticHashFromStore,
  fullHash,
  fullHashFromStore,
  slotsHaveEqualKnowledge,
} from '../../src/services/semanticHash.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';
import { MIGRATIONS } from '../../src/formats/migrations.js';

/**
 * P4.1 — semanticHash module tests (D5).
 *
 * Invariants verified:
 * A) Order-independence: same knowledge, shuffled key order → equal tier-1 hash.
 * B) Coordinate sensitivity: moving a node (changing instance x/y) changes tier-1.
 * C) Viewport isolation: viewport pan/zoom is not exported → never affects tier-1.
 * D) Cross-version equality — KEYSTONE: a state exported as v3 and the same state
 *    exported as v4 both import to identical store states; semanticHashFromStore
 *    on both gives the same tier-1 hash.
 * E) fullHash is also order-independent.
 * F) fullHash changes when knowledge changes (not just presentation).
 * G) slotsHaveEqualKnowledge correctly compares imported store states.
 */

const buildState = ({ xOverride } = {}) => {
  const nodePrototypes = new Map([
    ['life', { id: 'life', name: 'Life', description: 'All living things', definitionGraphIds: [], abstractionChains: {} }],
    ['animal', { id: 'animal', name: 'Animal', description: 'Animals', definitionGraphIds: [], abstractionChains: { Bio: ['life', 'animal'] } }],
    ['dog', { id: 'dog', name: 'Dog', description: 'Dogs', definitionGraphIds: [], abstractionChains: { Bio: ['life', 'animal', 'dog'] } }],
  ]);
  const instances = new Map([
    ['ia', { id: 'ia', prototypeId: 'dog', x: xOverride ?? 10, y: 20, scale: 1 }],
    ['ib', { id: 'ib', prototypeId: 'animal', x: 100, y: 0, scale: 1 }],
  ]);
  const graphs = new Map([
    ['g', { id: 'g', name: 'Main', description: '', instances, edgeIds: ['e1'], definingNodeIds: [] }],
  ]);
  const edges = new Map([
    ['e1', {
      id: 'e1', sourceId: 'ia', destinationId: 'ib',
      typeNodeId: 'base-connection-prototype', definitionNodeIds: [],
      directionality: { arrowsToward: new Set(['ib']) },
    }],
  ]);
  return {
    graphs, nodePrototypes, edges,
    openGraphIds: ['g'], activeGraphId: 'g', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false,
  };
};

// Helper: export as v3 (legacy path, now explicit).
const exportAsV3 = (state) => exportToRedstring(state, null, { emitV4: false });

// ── A: Order-independence (tier-1) ──────────────────────────────────────────

describe('P4.1-A — semanticHash is key-order independent', () => {
  it('two v3 exports of the same state hash equal', async () => {
    const state = buildState();
    const doc1 = exportToRedstring(state);
    const doc2 = exportToRedstring(state);
    expect(await semanticHash(doc1)).toBe(await semanticHash(doc2));
  });

  it('manually-shuffled top-level keys hash equal', async () => {
    const state = buildState();
    const doc = exportToRedstring(state);
    // Rebuild with shuffled top-level key order.
    const shuffled = {};
    const keys = Object.keys(doc).reverse();
    for (const k of keys) shuffled[k] = doc[k];
    expect(await semanticHash(doc)).toBe(await semanticHash(shuffled));
  });
});

// ── B: Coordinate sensitivity ────────────────────────────────────────────────

describe('P4.1-B — tier-1 changes when a node moves', () => {
  let hashAt10, hashAt99;

  beforeAll(async () => {
    hashAt10 = await semanticHashFromStore(buildState({ xOverride: 10 }));
    hashAt99 = await semanticHashFromStore(buildState({ xOverride: 99 }));
  });

  it('hashes differ after moving instance ia from x=10 to x=99', () => {
    expect(hashAt10).not.toBe(hashAt99);
  });
});

// ── C: Viewport isolation ─────────────────────────────────────────────────────

describe('P4.1-C — tier-1 is unaffected by viewport state', () => {
  it('viewport pan/zoom is not exported → identical hash regardless', async () => {
    // exportToRedstring never includes viewport state — both states export identically.
    const base = buildState();
    const h1 = await semanticHashFromStore(base);
    // Simulate a "different viewport" by adding viewport fields that exportToRedstring ignores.
    const withViewport = { ...base, viewportX: 9999, viewportY: 8888, viewportScale: 0.1 };
    const h2 = await semanticHashFromStore(withViewport);
    expect(h1).toBe(h2);
  });
});

// ── D: Cross-version equality (KEYSTONE) ────────────────────────────────────

describe('P4.1-D — KEYSTONE: v3 and v4 representations of same knowledge hash equal', () => {
  let hashFromV3Store, hashFromV4Store;

  beforeAll(async () => {
    const state = buildState();

    // v3 round-trip: explicit emitV4:false → import (triggers 3→4 migration) → hash
    const v3doc = exportAsV3(state);
    const { storeState: fromV3 } = importFromRedstring(v3doc, {});
    hashFromV3Store = await semanticHashFromStore(fromV3);

    // v4 round-trip: default export (EMIT_V4=true) → import (no migration needed) → hash
    const v4doc = exportToRedstring(state);
    const { storeState: fromV4 } = importFromRedstring(v4doc, {});
    hashFromV4Store = await semanticHashFromStore(fromV4);
  });

  it('v3-imported store state and v4-imported store state have the same tier-1 hash', () => {
    expect(hashFromV3Store).toBe(hashFromV4Store);
  });

  it('MIGRATIONS 3.0.0→4.0.0 result also hashes equal after import', async () => {
    const state = buildState();
    const migrate = MIGRATIONS.find((m) => m.from === '3.0.0' && m.to === '4.0.0');

    // Start from an explicit v3 doc, run the migration, import as v4.
    const v3doc = exportAsV3(state);
    const migratedV4 = migrate.migrate(v3doc);
    const v4Doc = { ...migratedV4, format: 'redstring-v4.0.0', metadata: { ...(migratedV4.metadata || {}), version: '4.0.0' } };
    const { storeState: fromMigrated } = importFromRedstring(v4Doc, {});

    // Fresh v4 export of the same state for reference.
    const { storeState: fromOriginal } = importFromRedstring(exportToRedstring(state), {});

    expect(await semanticHashFromStore(fromMigrated)).toBe(await semanticHashFromStore(fromOriginal));
  });
});

// ── E: fullHash order-independence ──────────────────────────────────────────

describe('P4.1-E — fullHash is key-order independent', () => {
  it('same doc, shuffled keys → equal fullHash', async () => {
    const doc = exportToRedstring(buildState());
    const shuffled = Object.fromEntries(Object.entries(doc).reverse());
    expect(await fullHash(doc)).toBe(await fullHash(shuffled));
  });

  it('fullHashFromStore returns consistent value for same state', async () => {
    const state = buildState();
    const h1 = await fullHashFromStore(state);
    const h2 = await fullHashFromStore(state);
    expect(h1).toBe(h2);
  });
});

// ── F: fullHash changes with knowledge ──────────────────────────────────────

describe('P4.1-F — fullHash changes when knowledge changes', () => {
  it('adding a prototype changes fullHash', async () => {
    const s1 = buildState();
    const s2 = buildState();
    s2.nodePrototypes.set('bird', { id: 'bird', name: 'Bird', description: '', definitionGraphIds: [], abstractionChains: {} });
    expect(await fullHashFromStore(s1)).not.toBe(await fullHashFromStore(s2));
  });
});

// ── G: slotsHaveEqualKnowledge ───────────────────────────────────────────────

describe('P4.1-G — slotsHaveEqualKnowledge', () => {
  it('identical states → true', async () => {
    const state = buildState();
    expect(await slotsHaveEqualKnowledge(state, state)).toBe(true);
  });

  it('different prototype names → false', async () => {
    const s1 = buildState();
    const s2 = buildState();
    s2.nodePrototypes.get('dog').name = 'Wolf';
    expect(await slotsHaveEqualKnowledge(s1, s2)).toBe(false);
  });

  it('removing an edge changes hash', async () => {
    const s1 = buildState();
    const s2 = buildState();
    s2.edges = new Map(); // topology differs: s1 has e1, s2 has none
    expect(await slotsHaveEqualKnowledge(s1, s2)).toBe(false);
  });
});
