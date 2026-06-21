import { describe, it, expect } from 'vitest';
import {
  runMigrations,
  ensureCanonicalSections,
  quarantineUnknownFields,
  detectFormatVersion,
  MIGRATIONS
} from '../../src/formats/migrations.js';

/**
 * Migration ledger unit tests (P1.1).
 *
 * The ledger is pure and testable in isolation — no store, no I/O, timestamp
 * injected. These tests pin: version walking, section canonicalization, metadata
 * stamping, input immutability, and determinism.
 */

const NOW = '2026-06-14T00:00:00.000Z';

const v1FlatFile = () => ({
  format: 'redstring-v1.0.0',
  metadata: { version: '1.0.0' },
  graphs: { g1: { id: 'g1', name: 'G', instances: { i1: { id: 'i1', prototypeId: 'p1' } }, edgeIds: ['e1'] } },
  nodePrototypes: { p1: { id: 'p1', name: 'P' } },
  edges: { e1: { id: 'e1', sourceId: 'i1', destinationId: 'i1' } }
});

const v2CanonicalFile = () => ({
  format: 'redstring-v2.0.0-semantic',
  metadata: { version: '2.0.0-semantic' },
  prototypeSpace: { prototypes: { p1: { id: 'p1', name: 'P' } } },
  spatialGraphs: { graphs: { g1: { id: 'g1', name: 'G' } } },
  relationships: { edges: { e1: { id: 'e1' } } },
  legacy: { nodePrototypes: { p1: {} }, graphs: { g1: {} }, edges: { e1: {} } }
});

const v3File = () => ({
  format: 'redstring-v3.0.0',
  metadata: { version: '3.0.0' },
  prototypeSpace: { prototypes: { p1: { id: 'p1' } } },
  spatialGraphs: { graphs: { g1: { id: 'g1' } } },
  relationships: { edges: {} }
});

describe('Migration ledger', () => {
  it('detects version from format string and metadata fallback', () => {
    expect(detectFormatVersion({ format: 'redstring-v2.0.0-semantic' })).toBe('2.0.0-semantic');
    expect(detectFormatVersion({ metadata: { version: '3.0.0' } })).toBe('3.0.0');
    expect(detectFormatVersion({})).toBe('1.0.0');
  });

  it('is an append-only ordered ledger of the known steps', () => {
    expect(MIGRATIONS.map((m) => `${m.from}→${m.to}`)).toEqual([
      '1.0.0→2.0.0-semantic',
      '2.0.0-semantic→3.0.0'
    ]);
  });

  it('walks v1 flat → canonical v3 shape, applying both steps', () => {
    const { data, applied } = runMigrations(v1FlatFile(), { now: NOW });
    expect(applied).toEqual(['1.0.0→2.0.0-semantic', '2.0.0-semantic→3.0.0']);
    expect(data.prototypeSpace.prototypes.p1).toBeTruthy();
    expect(data.spatialGraphs.graphs.g1).toBeTruthy();
    expect(data.relationships.edges.e1).toBeTruthy();
    expect(data.format).toBe('redstring-v3.0.0');
    expect(data.metadata.version).toBe('3.0.0');
    expect(data.metadata.originalVersion).toBe('1.0.0');
    expect(data.metadata.migrationDate).toBe(NOW);
    expect(data.metadata.migrationsApplied).toEqual(applied);
  });

  it('walks v2 → v3 applying only the second step, preserving canonical sections', () => {
    const { data, applied } = runMigrations(v2CanonicalFile(), { now: NOW });
    expect(applied).toEqual(['2.0.0-semantic→3.0.0']);
    expect(data.prototypeSpace.prototypes.p1.name).toBe('P');
    expect(data.format).toBe('redstring-v3.0.0');
    expect(data.metadata.migrated).toBe(true);
  });

  it('is a no-op for a current v3 file (no steps applied, no migrated stamp)', () => {
    const { data, applied } = runMigrations(v3File(), { now: NOW });
    expect(applied).toEqual([]);
    expect(data.metadata.migrated).toBeUndefined();
    expect(data.prototypeSpace.prototypes.p1).toBeTruthy();
  });

  it('canonicalizes a legacy-only file (no prototypeSpace) from the legacy block', () => {
    const legacyOnly = {
      format: 'redstring-v2.0.0-semantic',
      metadata: { version: '2.0.0-semantic' },
      legacy: {
        nodePrototypes: { p9: { id: 'p9', name: 'Legacy' } },
        graphs: { g9: { id: 'g9' } },
        edges: { e9: { id: 'e9' } }
      }
    };
    const { data } = runMigrations(legacyOnly, { now: NOW });
    expect(data.prototypeSpace.prototypes.p9.name).toBe('Legacy');
    expect(data.spatialGraphs.graphs.g9).toBeTruthy();
    expect(data.relationships.edges.e9).toBeTruthy();
  });

  it('does not mutate its input (pure)', () => {
    const input = v1FlatFile();
    const snapshot = JSON.stringify(input);
    runMigrations(input, { now: NOW });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('quarantines unknown keys at root, prototype, instance, and edge levels', () => {
    const doc = {
      format: 'redstring-v3.0.0',
      metadata: { version: '3.0.0' },
      xFutureRoot: { nested: true },
      prototypeSpace: { prototypes: { p1: { id: 'p1', name: 'P', xFutureProto: 1 } } },
      spatialGraphs: {
        graphs: {
          g1: {
            id: 'g1',
            'redstring:instances': { i1: { id: 'i1', prototypeId: 'p1', xFutureInst: 'x' } }
          }
        }
      },
      relationships: { edges: { e1: { id: 'e1', sourceId: 'i1', destinationId: 'i1', xFutureEdge: [9] } } }
    };
    const out = quarantineUnknownFields(doc, '3.0.0');
    expect(out._preserved['3.0.0'].xFutureRoot).toEqual({ nested: true });
    expect(out.prototypeSpace.prototypes.p1._preserved['3.0.0'].xFutureProto).toBe(1);
    expect(out.spatialGraphs.graphs.g1['redstring:instances'].i1._preserved['3.0.0'].xFutureInst).toBe('x');
    expect(out.relationships.edges.e1._preserved['3.0.0'].xFutureEdge).toEqual([9]);
    // known keys stay put
    expect(out.prototypeSpace.prototypes.p1.name).toBe('P');
    expect(out.prototypeSpace.prototypes.p1.xFutureProto).toBeUndefined();
  });

  it('quarantine leaves a clean document untouched and never mutates input', () => {
    const clean = v3File();
    const snapshot = JSON.stringify(clean);
    const out = quarantineUnknownFields(clean, '3.0.0');
    expect(JSON.stringify(clean)).toBe(snapshot); // input unchanged
    expect(out.prototypeSpace.prototypes.p1._preserved).toBeUndefined(); // nothing quarantined
  });

  it('ensureCanonicalSections is idempotent and leaves a canonical doc unchanged', () => {
    const canonical = v3File();
    expect(ensureCanonicalSections(canonical)).toBe(canonical); // same reference (early return)
    const once = ensureCanonicalSections(v1FlatFile());
    const twice = ensureCanonicalSections(once);
    expect(twice).toEqual(once);
  });
});
