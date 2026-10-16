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
  it('holds every picture of a universe with many of them (no cap evicting old ones)', async () => {
    // Second review: a 512-entry memo let the first pictures of a large
    // universe read as edits again, undoing a collaborator's delete.
    const { syncMerge } = await import('../../src/formats/syncMerge.js');
    const N = 700;
    const inline = (i) => `data:image/png;base64,${Buffer.from([i & 255, i >> 8, 7, 7]).toString('base64')}`;
    const refs = await Promise.all(Array.from({ length: N }, (_, i) => computeImageRef(inline(i))));
    const make = (form) => ({
      graphs: new Map(),
      nodePrototypes: new Map(Array.from({ length: N }, (_, i) => [`p${i}`, { id: `p${i}`, name: `P${i}`, ...(form === 'inline' ? { imageSrc: inline(i) } : { imageSrc: null, imageRef: refs[i].ref }) }])),
      edges: new Map(),
      edgePrototypes: new Map()
    });
    const base = make('ref');
    const ours = make('inline');
    const theirs = make('ref');
    theirs.nodePrototypes.delete('p0');
    await primeImageRefs(base, ours, theirs);
    const { merged, report } = syncMerge(base, ours, theirs);
    expect(merged.nodePrototypes.has('p0')).toBe(false);
    expect(report.ours.changed).toHaveLength(0);
  });

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
