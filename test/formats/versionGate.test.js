import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateFormatVersion,
  importFromRedstring,
  exportToRedstring,
  CURRENT_FORMAT_VERSION
} from '../../src/formats/redstringFormat.js';

/**
 * The compatibility gate in validateFormatVersion.
 *
 * It had no coverage, and that cost real data access: a build that briefly
 * stamped a higher minor wrote files its own successor then refused to open,
 * with every byte in them perfectly understood. These tests pin the contract —
 * newer MAJOR is fatal, newer minor is readable — so that trap cannot come back.
 */

const docAt = (version) => ({
  format: `redstring-v${version}`,
  metadata: { version }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateFormatVersion — compatibility gate', () => {
  it('accepts the current version', () => {
    const result = validateFormatVersion(docAt(CURRENT_FORMAT_VERSION));
    expect(result.valid).toBe(true);
    expect(result.needsMigration).toBe(false);
  });

  it('accepts an older version and flags it for migration', () => {
    const result = validateFormatVersion(docAt('3.0.0'));
    expect(result.valid).toBe(true);
    expect(result.needsMigration).toBe(true);
    expect(result.canAutoMigrate).toBe(true);
  });

  it('reads a newer MINOR within the same major', () => {
    // The case that locked a real universe out of the app. Within a major the
    // format is additive-and-optional, so a higher minor is always readable.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = validateFormatVersion(docAt('4.2.0'));
    expect(result.valid).toBe(true);
    expect(result.newerMinor).toBe(true);
    expect(result.tooNew).toBeUndefined();
    // Nothing to migrate — the ledger keys on major, which is unchanged.
    expect(result.needsMigration).toBe(false);
  });

  it('reads a newer PATCH within the same major', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateFormatVersion(docAt('4.1.9')).valid).toBe(true);
  });

  it('says so on the console when it reads a newer minor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateFormatVersion(docAt('4.5.0'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('4.5.0');
  });

  it('still refuses a newer MAJOR', () => {
    // Structural change lives at the major boundary; guessing there would be
    // worse than refusing.
    const result = validateFormatVersion(docAt('5.0.0'));
    expect(result.valid).toBe(false);
    expect(result.tooNew).toBe(true);
  });

  it('still refuses a version below the supported floor', () => {
    const result = validateFormatVersion(docAt('0.9.0'));
    expect(result.valid).toBe(false);
    expect(result.tooOld).toBe(true);
  });

  it('rejects an unparseable version rather than guessing', () => {
    const result = validateFormatVersion({ format: 'redstring-vbanana' });
    expect(result.valid).toBe(false);
  });
});

describe('importFromRedstring — newer-minor documents', () => {
  const buildState = () => ({
    graphs: new Map(),
    nodePrototypes: new Map([
      ['p1', { id: 'p1', name: 'Thing', description: '', definitionGraphIds: [], abstractionChains: {} }]
    ]),
    edges: new Map(),
    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    rightPanelTabs: [],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    showConnectionNames: false
  });

  it('imports a document stamped a minor ahead without throwing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = exportToRedstring(buildState());
    // Restamp as though written by a build one minor ahead.
    doc.format = 'redstring-v4.2.0';
    doc.metadata = { ...doc.metadata, version: '4.2.0' };

    const { storeState } = importFromRedstring(doc);
    expect(storeState.nodePrototypes.get('p1').name).toBe('Thing');
  });

  it('throws on a document stamped a major ahead', () => {
    const doc = exportToRedstring(buildState());
    doc.format = 'redstring-v5.0.0';
    doc.metadata = { ...doc.metadata, version: '5.0.0' };

    expect(() => importFromRedstring(doc)).toThrow(/newer than/);
  });
});
