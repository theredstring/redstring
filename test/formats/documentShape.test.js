import { describe, it, expect } from 'vitest';
import { hasRedstringMarkers, notARedstringDocument } from '../../src/formats/documentShape.js';
import { validateFormatVersion, importFromRedstring, exportToRedstring } from '../../src/formats/redstringFormat.js';
import { runMigrations } from '../../src/formats/migrations.js';

/**
 * The exact GitHub contents-API envelope that GitHub returns for a file over
 * 1 MB, and that Chromium's HTTP cache handed to the raw-media-type fallback
 * fetch on 2026-09-12. Importing it produced an empty universe that was then
 * written over the real 6.9 MB file.
 */
const ENVELOPE = {
  name: 'claude-s-chambers-2.redstring',
  path: 'universes/claude-s-chambers-2/claude-s-chambers-2.redstring',
  sha: 'd2e961555ac8180c4e4332de0d453ec29c47184d',
  size: 6916496,
  url: 'https://api.github.com/repos/x/y/contents/z?ref=main',
  html_url: 'https://github.com/x/y/blob/main/z',
  git_url: 'https://api.github.com/repos/x/y/git/blobs/d2e9',
  download_url: 'https://raw.githubusercontent.com/x/y/main/z?token=abc',
  type: 'file',
  content: '',
  encoding: 'none',
  _links: { self: '', git: '', html: '' }
};

describe('hasRedstringMarkers', () => {
  it('accepts a declared version', () => {
    expect(hasRedstringMarkers({ format: 'redstring-v4.1.0' })).toBe(true);
    expect(hasRedstringMarkers({ metadata: { version: '3.0.0' } })).toBe(true);
  });

  it('accepts a v1 flat file that declares no version but carries sections', () => {
    expect(hasRedstringMarkers({ nodePrototypes: {}, graphs: {} })).toBe(true);
    expect(hasRedstringMarkers({ nodes: [] })).toBe(true);
  });

  it('accepts v3 legacy and v4 canonical shapes', () => {
    expect(hasRedstringMarkers({ legacy: { nodePrototypes: {} } })).toBe(true);
    expect(hasRedstringMarkers({ prototypeSpace: { prototypes: {} } })).toBe(true);
    expect(hasRedstringMarkers({ spatialGraphs: { graphs: {} } })).toBe(true);
  });

  it('rejects the contents-API envelope and other non-documents', () => {
    expect(hasRedstringMarkers(ENVELOPE)).toBe(false);
    expect(hasRedstringMarkers({})).toBe(false);
    expect(hasRedstringMarkers(null)).toBe(false);
    expect(hasRedstringMarkers([])).toBe(false);
    expect(hasRedstringMarkers('{"format":"redstring-v4"}')).toBe(false);
  });

  it('rejects a section key whose value is not an object', () => {
    expect(hasRedstringMarkers({ graphs: 'many' })).toBe(false);
    expect(hasRedstringMarkers({ nodes: 12 })).toBe(false);
  });

  it('notARedstringDocument carries a machine-readable code', () => {
    const error = notARedstringDocument(ENVELOPE);
    expect(error.code).toBe('NOT_A_REDSTRING_DOCUMENT');
    expect(error.message).toMatch(/encoding/); // names some keys it did see
  });
});

describe('the envelope is refused at every gate', () => {
  it('validateFormatVersion', () => {
    const result = validateFormatVersion(ENVELOPE);
    expect(result.valid).toBe(false);
    expect(result.code).toBe('NOT_A_REDSTRING_DOCUMENT');
    expect(result.needsMigration).toBe(false);
  });

  it('runMigrations', () => {
    expect(() => runMigrations(ENVELOPE)).toThrow(/Not a Redstring document/);
  });

  it('importFromRedstring throws with the code preserved through the wrap', () => {
    expect(() => importFromRedstring(ENVELOPE)).toThrow();
    try {
      importFromRedstring(ENVELOPE);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.code).toBe('NOT_A_REDSTRING_DOCUMENT');
      expect(error.cause).toBeDefined();
    }
  });
});

describe('version inference', () => {
  it('a flat file with no format imports but is not reported as migrated', () => {
    const flat = {
      nodePrototypes: { p1: { id: 'p1', name: 'One', color: '#8B0000', definitionGraphIds: [] } },
      graphs: {},
      edges: {}
    };
    const result = importFromRedstring(flat);
    expect(result.version.versionInferred).toBe(true);
    expect(result.version.migrated).toBe(false);
  });

  it('a file that declares an old version IS reported as migrated', () => {
    const declared = {
      format: 'redstring-v3.0.0',
      legacy: { nodePrototypes: {}, graphs: {}, edges: {} }
    };
    const result = importFromRedstring(declared);
    expect(result.version.versionInferred).toBe(false);
    expect(result.version.migrated).toBe(true);
  });

  it('a current-version round-trip is neither inferred nor migrated', () => {
    const state = {
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      openGraphIds: [],
      activeGraphId: null,
      activeDefinitionNodeId: null,
      expandedGraphIds: new Set(),
      rightPanelTabs: [{ type: 'home', isActive: true }],
      savedNodeIds: new Set(),
      savedGraphIds: new Set()
    };
    const result = importFromRedstring(exportToRedstring(state));
    expect(result.version.versionInferred).toBe(false);
    expect(result.version.migrated).toBe(false);
  });
});
