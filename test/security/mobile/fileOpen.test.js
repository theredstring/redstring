/**
 * S-82: a .redstring opened into the iOS app (Files, Mail, AirDrop) is read
 * with a size cap and imported as a NEW universe through the ordinary,
 * sanitizing import. Only local file URLs ending in .redstring are handled.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isOpenableUniverseUrl,
  fileNameFromUrl,
  handleOpenedUrl,
  registerCapacitorFileOpen,
  OPEN_FILE_CAP_BYTES
} from '../../../src/services/capacitorFileOpen.js';
import { universeBackend } from '../../../src/services/universeBackend.js';

const fsModule = (text, size = text.length) => ({
  Filesystem: {
    stat: vi.fn(async () => ({ size })),
    readFile: vi.fn(async () => ({ data: text }))
  },
  Encoding: { UTF8: 'utf8' }
});

const URL_OK = 'file:///private/var/mobile/tmp/Opened/ABC/My%20Ideas.redstring';

describe('which URLs are handled', () => {
  it.each([
    [URL_OK, true],
    ['file:///x/y.REDSTRING', true],
    ['file:///x/y.json', false],
    ['https://evil.example/x.redstring', false],
    ['redstring://open?file=x.redstring', false],
    ['javascript:alert(1)//x.redstring', false],
    ['not a url', false],
    [null, false]
  ])('%s → %s', (url, expected) => {
    expect(isOpenableUniverseUrl(url)).toBe(expected);
  });

  it('decodes the display name', () => {
    expect(fileNameFromUrl(URL_OK)).toBe('My Ideas.redstring');
  });
});

describe('handleOpenedUrl', () => {
  it('reads the file and hands it to the importer', async () => {
    const importText = vi.fn(async () => ({ slug: 'my-ideas', nodeCount: 3 }));
    const result = await handleOpenedUrl(URL_OK, { importText, fsModule: fsModule('{"x":1}') });
    expect(importText).toHaveBeenCalledWith('{"x":1}', 'My Ideas.redstring');
    expect(result).toMatchObject({ handled: true, slug: 'my-ideas' });
  });

  it('refuses an oversized file before reading it', async () => {
    const fs = fsModule('{}', OPEN_FILE_CAP_BYTES + 1);
    const importText = vi.fn();
    const notify = vi.fn();
    const result = await handleOpenedUrl(URL_OK, { importText, notify, fsModule: fs });
    expect(result.error.code).toBe('FILE_TOO_LARGE');
    expect(fs.Filesystem.readFile).not.toHaveBeenCalled();
    expect(importText).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('My Ideas.redstring'));
  });

  it('ignores URLs that are not ours', async () => {
    const importText = vi.fn();
    expect(await handleOpenedUrl('https://x/y.redstring', { importText })).toEqual({ handled: false });
    expect(importText).not.toHaveBeenCalled();
  });
});

describe('registerCapacitorFileOpen', () => {
  it('handles the launch URL and later opens, each URL once', async () => {
    let listener;
    const App = {
      addListener: vi.fn(async (_event, cb) => { listener = cb; return { remove: vi.fn() }; }),
      getLaunchUrl: vi.fn(async () => ({ url: 'https://example.com/not-a-file' }))
    };
    const importText = vi.fn(async () => ({}));
    await registerCapacitorFileOpen({ importText, appModule: { App } });
    expect(App.addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));
    // The launch URL wasn't a document: nothing imported.
    expect(importText).not.toHaveBeenCalled();
    listener({ url: 'https://example.com/other' });
    listener({ url: 'https://example.com/other' });
    expect(importText).not.toHaveBeenCalled();
  });
});

describe('importUniverseFromText always creates a new universe', () => {
  const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;
  const makeBackend = () => {
    const backend = Object.create(UniverseBackend.prototype);
    backend.isInitialized = true;
    backend.universes = new Map([['ideas', { slug: 'ideas', name: 'Ideas' }]]);
    backend.notifyStatus = vi.fn();
    backend.storeOperations = { loadUniverseFromFile: vi.fn() };
    backend.createUniverse = vi.fn(async (name) => ({ slug: backend.generateUniqueSlug(name), name }));
    backend.forceSave = vi.fn(async () => ({}));
    return backend;
  };

  const doc = {
    format: 'redstring-v4.0.0-semantic',
    '@context': 'https://redstring.io/contexts/v1.jsonld',
    '@type': 'redstring:CognitiveSpace',
    prototypeSpace: { prototypes: { p1: { id: 'p1', name: 'Thing A', color: '#800000' } } },
    spatialGraphs: { graphs: {} },
    relationships: { edges: {} }
  };

  it('creates a uniquely named universe and never touches the existing one', async () => {
    const backend = makeBackend();
    const result = await backend.importUniverseFromText(JSON.stringify(doc), 'ideas.redstring');
    expect(backend.createUniverse).toHaveBeenCalledWith('ideas', { enableGit: false, enableLocal: true });
    expect(result.slug).not.toBe('ideas');
    const loaded = backend.storeOperations.loadUniverseFromFile.mock.calls[0][0];
    expect(loaded._universeSlug).toBe(result.slug);
  });

  it('refuses garbage and empty documents without creating anything', async () => {
    const backend = makeBackend();
    await expect(backend.importUniverseFromText('not json', 'x.redstring')).rejects.toThrow(/not a valid/);
    await expect(backend.importUniverseFromText(JSON.stringify({ format: 'redstring-v4.0.0-semantic', prototypeSpace: { prototypes: {} }, spatialGraphs: { graphs: {} } }), 'x.redstring'))
      .rejects.toThrow();
    expect(backend.createUniverse).not.toHaveBeenCalled();
  });
});
