import { describe, it, expect } from 'vitest';
import {
  sha256Hex,
  computeImageRef,
  isImageRef,
  isDataUrl,
  parseDataUrl,
  extForMime,
  refToBlobPath,
  blobPathCandidates
} from '../../src/formats/imageRefs.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

const enc = (s) => new TextEncoder().encode(s);

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('sha256Hex', () => {
  // Standard NIST vectors. These matter because the plain-JS implementation is
  // the one that runs wherever crypto.subtle is absent — including, possibly,
  // the packaged Electron app — and a wrong hash there would produce refs that
  // never resolve.
  it('matches the known digest of the empty input', async () => {
    expect(await sha256Hex(new Uint8Array(0)))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex(enc('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches the known digest of the 56-byte vector (two-block padding)', async () => {
    expect(await sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('matches the known digest of a million "a"s (multi-block)', async () => {
    const bytes = new Uint8Array(1000000).fill(0x61);
    expect(await sha256Hex(bytes))
      .toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('hashes only the view, not the underlying buffer', async () => {
    // A Uint8Array over a slice of a larger buffer must hash its own 3 bytes.
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = backing.subarray(2, 5);
    expect(await sha256Hex(view)).toBe(await sha256Hex(new Uint8Array([3, 4, 5])));
  });
});

describe('ref helpers', () => {
  it('recognizes well-formed refs and rejects everything else', () => {
    expect(isImageRef(`sha256:${'a'.repeat(64)}`)).toBe(true);
    expect(isImageRef(`sha256:${'A'.repeat(64)}`)).toBe(false); // uppercase
    expect(isImageRef(`sha256:${'a'.repeat(63)}`)).toBe(false);
    expect(isImageRef('sha1:abc')).toBe(false);
    expect(isImageRef(PNG_1PX)).toBe(false);
    expect(isImageRef(null)).toBe(false);
  });

  it('distinguishes data URLs from refs', () => {
    expect(isDataUrl(PNG_1PX)).toBe(true);
    expect(isDataUrl('https://example.com/a.png')).toBe(false);
    expect(isDataUrl(`sha256:${'a'.repeat(64)}`)).toBe(false);
  });

  it('parses a base64 data URL into mime and bytes', () => {
    const parsed = parseDataUrl(PNG_1PX);
    expect(parsed.mime).toBe('image/png');
    // PNG magic number.
    expect(Array.from(parsed.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('refuses non-base64 and malformed data URLs rather than mangling them', () => {
    // Percent-encoded data URLs are not image payloads; leaving them alone is
    // what keeps a bad parse from silently corrupting content.
    expect(parseDataUrl('data:text/plain,hello')).toBeNull();
    expect(parseDataUrl('data:image/png;base64')).toBeNull();
    expect(parseDataUrl('not a data url')).toBeNull();
  });

  it('maps mime types to browsable extensions', () => {
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/png')).toBe('png');
    expect(extForMime('image/png; charset=binary')).toBe('png');
    expect(extForMime('application/x-weird')).toBe('bin');
  });

  it('builds a blob path beside the universe file', () => {
    const ref = `sha256:${'a'.repeat(64)}`;
    expect(refToBlobPath(ref, 'default', 'jpg'))
      .toBe(`universes/default/images/${'a'.repeat(64)}.jpg`);
    expect(refToBlobPath('garbage', 'default', 'jpg')).toBeNull();
  });

  it('probes plausible extensions only when none was recorded', () => {
    const ref = `sha256:${'b'.repeat(64)}`;
    expect(blobPathCandidates(ref, 'default', 'png')).toHaveLength(1);
    expect(blobPathCandidates(ref, 'default').length).toBeGreaterThan(1);
    expect(blobPathCandidates('garbage', 'default')).toEqual([]);
  });
});

describe('computeImageRef', () => {
  it('addresses an image by its content', async () => {
    const computed = await computeImageRef(PNG_1PX);
    expect(isImageRef(computed.ref)).toBe(true);
    expect(computed.ext).toBe('png');
    expect(computed.mime).toBe('image/png');
  });

  it('gives identical bytes the same address', async () => {
    const a = await computeImageRef(PNG_1PX);
    const b = await computeImageRef(PNG_1PX);
    expect(a.ref).toBe(b.ref);
  });

  it('returns null for values that are not externalizable images', async () => {
    expect(await computeImageRef('https://example.com/a.png')).toBeNull();
    expect(await computeImageRef(null)).toBeNull();
    expect(await computeImageRef('data:text/plain,hi')).toBeNull();
  });
});

// ── Format round-trip ───────────────────────────────────────────────────────

const buildState = (protoOverrides) => ({
  graphs: new Map(),
  nodePrototypes: new Map([
    ['p1', { id: 'p1', name: 'Thing', description: '', definitionGraphIds: [], abstractionChains: {}, ...protoOverrides }]
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

describe('imageRef round-trip through the .redstring format', () => {
  const REF = `sha256:${'c'.repeat(64)}`;

  it('survives export → import', () => {
    const doc = exportToRedstring(buildState({ imageRef: REF, imageRefExt: 'jpg' }));
    const proto = doc.prototypeSpace.prototypes.p1;

    // Top-level, NOT inside visualProperties — that placement is what lets an
    // older build quarantine it instead of dropping it.
    expect(proto['redstring:imageRef']).toBe(REF);
    expect(proto['redstring:visualProperties']['redstring:imageRef']).toBeUndefined();

    const back = importFromRedstring(doc).storeState.nodePrototypes.get('p1');
    expect(back.imageRef).toBe(REF);
    expect(back.imageRefExt).toBe('jpg');
  });

  it('is absent from the document when the prototype has no ref', () => {
    const doc = exportToRedstring(buildState({}));
    expect('redstring:imageRef' in doc.prototypeSpace.prototypes.p1).toBe(false);
  });

  it('still reads an inline base64 imageSrc — both forms stay valid', () => {
    const doc = exportToRedstring(buildState({ imageSrc: PNG_1PX, thumbnailSrc: PNG_1PX }));
    const back = importFromRedstring(doc).storeState.nodePrototypes.get('p1');
    expect(back.imageSrc).toBe(PNG_1PX);
    expect(back.imageRef).toBeUndefined();
  });

  it('recovers a ref that an older build quarantined into _preserved', () => {
    // What a build predating 4.2.0 leaves behind: it did not recognize the
    // top-level field, so quarantineUnknownFields banked it. Recovering it on
    // the way back in is the other half of that protection — without this the
    // ref is lost on the first round trip through an out-of-date client, the
    // blob is orphaned, and the node loses its image for good.
    const doc = exportToRedstring(buildState({}));
    doc.prototypeSpace.prototypes.p1._preserved = {
      '4.1.0': { 'redstring:imageRef': REF, 'redstring:imageRefExt': 'png' }
    };

    const back = importFromRedstring(doc).storeState.nodePrototypes.get('p1');
    expect(back.imageRef).toBe(REF);
    expect(back.imageRefExt).toBe('png');
  });

  it('prefers a live top-level ref over a stale quarantined one', () => {
    const stale = `sha256:${'d'.repeat(64)}`;
    const doc = exportToRedstring(buildState({ imageRef: REF, imageRefExt: 'jpg' }));
    doc.prototypeSpace.prototypes.p1._preserved = { '4.1.0': { 'redstring:imageRef': stale } };

    const back = importFromRedstring(doc).storeState.nodePrototypes.get('p1');
    expect(back.imageRef).toBe(REF);
  });
});
