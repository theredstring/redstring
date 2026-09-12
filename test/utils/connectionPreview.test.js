import { describe, it, expect, beforeEach } from 'vitest';

import { withoutImage, buildConnectionPreviewNodes, CONNECTION_PREVIEW_FLOORS } from '../../src/utils/connectionPreview.js';

/**
 * The preview representations — the hover vision aid, the connection control
 * panel, the right panel's Connections list — exist to make a node's NAME
 * legible. These cover the one property that fights that hardest.
 */

// jsdom has no 2D context and the measurement layer needs one. A fixed
// per-character advance is enough: nothing here asserts exact glyph widths.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    let font = '';
    return {
      get font() { return font; },
      set font(v) { font = v; },
      measureText: (text) => ({
        width: text.length * (Number((font.match(/(\d+(?:\.\d+)?)px/) || [])[1]) || 16) * 0.55,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 4,
      }),
    };
  };
});

describe('withoutImage', () => {
  it('drops every field that makes a node an image node', () => {
    const stripped = withoutImage({
      id: 'n1',
      name: 'Ada Lovelace',
      color: '#8B0000',
      imageSrc: 'data:image/png;base64,AAAA',
      thumbnailSrc: 'https://upload.wikimedia.org/500px-ada.jpg',
      imageAspectRatio: 1.6,
      imageLoading: true,
      imageMissing: true,
    });

    expect(stripped).toEqual({ id: 'n1', name: 'Ada Lovelace', color: '#8B0000' });
  });

  it('sheds the getters getNodeDimensions prefers over the plain fields', () => {
    // A Node instance answers through getThumbnailSrc, which lives on the
    // prototype — so a strip that only deleted own properties would leave the
    // node still reporting an image.
    class NodeLike {
      constructor() { this.id = 'n1'; this.name = 'Ada'; }
      getThumbnailSrc() { return 'https://example.test/ada.jpg'; }
    }
    const stripped = withoutImage(new NodeLike());
    expect(stripped.getThumbnailSrc).toBeUndefined();
  });

  it('passes a nullish node straight through', () => {
    expect(withoutImage(null)).toBe(null);
    expect(withoutImage(undefined)).toBe(undefined);
  });
});

describe('preview sizing', () => {
  const floors = CONNECTION_PREVIEW_FLOORS.hover;
  const name = 'Ada Lovelace';

  it('sizes an image node exactly as the same node without one', () => {
    // getNodeDimensions gives an image node the EXPANDED width and adds the
    // image's own aspect to its height. A preview that inherited that came out
    // as a tall box sized by a photograph rather than by the name in it.
    const [plain] = buildConnectionPreviewNodes([{ id: 'a', name }], floors);
    const [withPicture] = buildConnectionPreviewNodes(
      [withoutImage({ id: 'a', name, thumbnailSrc: 'https://example.test/ada.jpg', imageAspectRatio: 2.2 })],
      floors
    );

    expect(withPicture.width).toBe(plain.width);
    expect(withPicture.height).toBe(plain.height);
  });

  it('would otherwise size it differently — the strip is doing real work', () => {
    // Guards the test above against passing for the wrong reason: if image
    // nodes ever stopped resizing, both halves of it would be trivially equal.
    const [plain] = buildConnectionPreviewNodes([{ id: 'a', name }], floors);
    const [unstripped] = buildConnectionPreviewNodes(
      [{ id: 'a', name, thumbnailSrc: 'https://example.test/ada.jpg', imageAspectRatio: 2.2 }],
      floors
    );

    expect(unstripped.height).toBeGreaterThan(plain.height);
  });
});
