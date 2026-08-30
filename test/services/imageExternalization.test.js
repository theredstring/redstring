import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { computeImageRef } from '../../src/formats/imageRefs.js';

// A real 1x1 PNG, so the bytes actually decode and hash.
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_1PX_ALT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAj/2wBDAQj/wAARCAABAAEDASIA';

const buildState = (protoOverrides = {}) => {
  const nodePrototypes = new Map();
  nodePrototypes.set('p1', {
    id: 'p1',
    name: 'Photographed Thing',
    description: '',
    definitionGraphIds: [],
    abstractionChains: {},
    ...protoOverrides
  });
  return {
    graphs: new Map(),
    nodePrototypes,
    edges: new Map(),
    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    rightPanelTabs: [],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    showConnectionNames: false
  };
};

/** Provider double: records writes, reports blobs absent unless pre-seeded. */
const makeProvider = ({ existingBlobs = new Set() } = {}) => {
  const written = new Map();
  return {
    name: 'mock',
    written,
    writeFileRaw: vi.fn().mockImplementation(async (path, content) => {
      written.set(path, content);
      return { ok: true };
    }),
    readBinaryFile: vi.fn().mockImplementation(async (path) => {
      if (existingBlobs.has(path)) return new Uint8Array([1, 2, 3]);
      const e = new Error(`File not found: ${path}`);
      e.code = 'FILE_NOT_FOUND';
      throw e;
    }),
    readFileRawWithMeta: vi.fn().mockImplementation(async () => {
      const e = new Error('File not found');
      e.code = 'FILE_NOT_FOUND';
      throw e;
    })
  };
};

/** The .redstring JSON the engine committed, parsed. */
const committedDoc = (provider, slug = 'myslug') =>
  JSON.parse(provider.written.get(`universes/${slug}/universe.redstring`));

const protoOf = (doc) => doc.prototypeSpace.prototypes.p1;

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('GitSyncEngine image externalization', () => {
  it('writes the full-res image to a content-addressed blob and leaves a ref', async () => {
    const provider = makeProvider();
    const engine = new GitSyncEngine(provider, 'local', 'myslug');

    await engine.forceCommit(buildState({ imageSrc: PNG_1PX, thumbnailSrc: THUMB }));

    const { ref, ext } = await computeImageRef(PNG_1PX);
    const blobPath = `universes/myslug/images/${ref.slice('sha256:'.length)}.${ext}`;

    // The blob is written as raw bytes, not as the base64 string.
    expect(provider.written.has(blobPath)).toBe(true);
    expect(provider.written.get(blobPath)).toBeInstanceOf(Uint8Array);

    const proto = protoOf(committedDoc(provider));
    expect(proto['redstring:imageRef']).toBe(ref);
    expect(proto['redstring:imageRefExt']).toBe('png');
    // The inline copy is gone — that is the whole point.
    expect(proto['redstring:visualProperties']['redstring:imageSrc']).toBeNull();
  });

  it('keeps the thumbnail inline so the canvas renders with no network', async () => {
    const provider = makeProvider();
    const engine = new GitSyncEngine(provider, 'local', 'myslug');

    await engine.forceCommit(buildState({ imageSrc: PNG_1PX, thumbnailSrc: THUMB }));

    const proto = protoOf(committedDoc(provider));
    expect(proto['redstring:visualProperties']['redstring:thumbnailSrc']).toBe(THUMB);
  });

  it('does not re-upload a blob that is already in the repo', async () => {
    const { ref, ext } = await computeImageRef(PNG_1PX);
    const blobPath = `universes/myslug/images/${ref.slice('sha256:'.length)}.${ext}`;

    const provider = makeProvider({ existingBlobs: new Set([blobPath]) });
    const engine = new GitSyncEngine(provider, 'local', 'myslug');

    await engine.forceCommit(buildState({ imageSrc: PNG_1PX }));

    // The address IS the content, so an existing blob already holds these bytes.
    expect(provider.written.has(blobPath)).toBe(false);
    expect(protoOf(committedDoc(provider))['redstring:imageRef']).toBe(ref);
  });

  it('is idempotent across commits — the second one uploads nothing', async () => {
    const provider = makeProvider();
    const engine = new GitSyncEngine(provider, 'local', 'myslug');
    const state = buildState({ imageSrc: PNG_1PX });

    await engine.forceCommit(state);
    const blobWritesAfterFirst = provider.writeFileRaw.mock.calls.filter(
      (c) => c[0].includes('/images/')
    ).length;

    // Force a second commit through: a different state hash, past the interval.
    engine.lastCommitTime = 0;
    state.nodePrototypes.get('p1').name = 'Renamed';
    await engine.forceCommit(state);

    const blobWritesTotal = provider.writeFileRaw.mock.calls.filter(
      (c) => c[0].includes('/images/')
    ).length;

    expect(blobWritesAfterFirst).toBe(1);
    expect(blobWritesTotal).toBe(1);
  });

  it('re-externalizes when a new image arrives beside a stale ref', async () => {
    const provider = makeProvider();
    const engine = new GitSyncEngine(provider, 'local', 'myslug');

    const { ref: oldRef } = await computeImageRef(PNG_1PX);
    const { ref: newRef } = await computeImageRef(PNG_1PX_ALT);
    expect(newRef).not.toBe(oldRef);

    // Replacing an image leaves the OLD ref on the prototype next to the NEW
    // base64. The inline copy must win, or the file keeps pointing at the
    // previous picture and the new one is never uploaded.
    await engine.forceCommit(
      buildState({ imageSrc: PNG_1PX_ALT, imageRef: oldRef, imageRefExt: 'png' })
    );

    expect(protoOf(committedDoc(provider))['redstring:imageRef']).toBe(newRef);
  });

  it('keeps the image inline when the blob write fails', async () => {
    const provider = makeProvider();
    provider.writeFileRaw.mockImplementation(async (path, content) => {
      if (path.includes('/images/')) throw new Error('network down');
      provider.written.set(path, content);
      return { ok: true };
    });
    const engine = new GitSyncEngine(provider, 'local', 'myslug');

    await engine.forceCommit(buildState({ imageSrc: PNG_1PX }));

    // Lossless degradation: the commit still succeeds, the image is still in
    // the file, and the next commit will retry.
    const proto = protoOf(committedDoc(provider));
    expect(proto['redstring:imageRef']).toBeUndefined();
    expect(proto['redstring:visualProperties']['redstring:imageSrc']).toBe(PNG_1PX);
  });

  it('leaves auto-enriched Wikipedia images alone', async () => {
    const provider = makeProvider();
    const engine = new GitSyncEngine(provider, 'local', 'myslug');

    await engine.forceCommit(
      buildState({
        imageSrc: PNG_1PX,
        semanticMetadata: {
          autoEnriched: true,
          wikipediaThumbnail: 'https://upload.wikimedia.org/x/500px-y.jpg'
        }
      })
    );

    // Export already strips these as re-fetchable, so there is nothing to
    // externalize and no blob should be written for them.
    const blobWrites = provider.writeFileRaw.mock.calls.filter((c) => c[0].includes('/images/'));
    expect(blobWrites).toHaveLength(0);
    expect(protoOf(committedDoc(provider))['redstring:imageRef']).toBeUndefined();
  });

  it('writes nothing extra for a universe with no images', async () => {
    const provider = makeProvider();
    const engine = new GitSyncEngine(provider, 'local', 'myslug');

    await engine.forceCommit(buildState());

    const paths = provider.writeFileRaw.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(['universes/myslug/universe.redstring']);
  });
});
