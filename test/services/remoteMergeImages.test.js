// @vitest-environment node
//
// primeImageRefs learns each inline picture's content ref (the same SHA-256 the
// sync engine externalizes it under), so a merge sees the canvas's inline
// picture and the repository's ref as the same picture.
import { describe, it, expect } from 'vitest';
import { primeImageRefs } from '../../src/services/remoteMerge.js';
import { computeImageRef } from '../../src/formats/imageRefs.js';
import { documentChanged } from '../../src/formats/syncMerge.js';

// A 1×1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const state = (proto) => ({
  graphs: new Map(),
  nodePrototypes: new Map([['p', { id: 'p', name: 'Pic', ...proto }]]),
  edges: new Map(),
  edgePrototypes: new Map()
});

describe('primeImageRefs', () => {
  it('makes an inline picture equal to its ref', async () => {
    const { ref } = await computeImageRef(PNG);
    const inRepo = state({ imageSrc: null, imageRef: ref, imageRefExt: 'png' });
    const onCanvas = state({ imageSrc: PNG });
    await primeImageRefs(onCanvas);
    expect(documentChanged(inRepo, onCanvas)).toBe(false);
  });

  it('a different picture is still a change', async () => {
    const inRepo = state({ imageSrc: null, imageRef: 'sha256:0000', imageRefExt: 'png' });
    const onCanvas = state({ imageSrc: PNG });
    await primeImageRefs(onCanvas);
    expect(documentChanged(inRepo, onCanvas)).toBe(true);
  });
});
