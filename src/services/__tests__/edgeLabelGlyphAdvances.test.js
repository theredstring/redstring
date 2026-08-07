/**
 * Per-glyph advances for curved connection labels.
 *
 * The load-bearing property is the COUNT: SVG's x/y/rotate lists are positional,
 * so one advance per character is what keeps every glyph on the attribute slot
 * that belongs to it. A short list silently leaves the tail of a label
 * unrotated; a long one shifts everything after the extra entry.
 *
 * These run without a canvas, which is also the fallback path worth pinning —
 * the measurement engine throws rather than declining when there's nothing to
 * measure with, and a connection label must not take the canvas down with it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { edgeLabelGlyphAdvances, edgeLabelFontLoaded } from '../textMeasurement.js';
import { edgeLabelGlyphAdvancesEm } from '../layoutGeometry.js';

// jsdom ships no FontFaceSet at all, so this is defined rather than spied on.
const hadFonts = Object.prototype.hasOwnProperty.call(document, 'fonts');
const stubFonts = (value) => {
  Object.defineProperty(document, 'fonts', { value, configurable: true, writable: true });
};
const restoreFonts = () => {
  if (hadFonts) return;
  delete document.fonts;
};

describe('edgeLabelFontLoaded', () => {
  afterEach(restoreFonts);

  it('asks about EmOne alone, never a spec a fallback could satisfy', () => {
    // The bug this guards: `check()` answers "can you render this spec", so a
    // spec ending in `sans-serif` is ALWAYS satisfiable and would report the
    // font ready while EmOne was still loading.
    const check = vi.fn(() => true);
    stubFonts({ check, ready: Promise.resolve() });

    edgeLabelFontLoaded(59.4);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0][0]).toContain('EmOne');
    expect(check.mock.calls[0][0]).not.toContain('sans-serif');
  });

  it('reports not-ready rather than throwing when fonts are unavailable', () => {
    stubFonts(undefined);
    expect(edgeLabelFontLoaded(59.4)).toBe(false);

    stubFonts({ check: () => { throw new Error('nope'); } });
    expect(edgeLabelFontLoaded(59.4)).toBe(false);
  });

  it('reports ready only when the check passes', () => {
    stubFonts({ check: () => true, ready: Promise.resolve() });
    expect(edgeLabelFontLoaded(59.4)).toBe(true);

    stubFonts({ check: () => false, ready: Promise.resolve() });
    expect(edgeLabelFontLoaded(59.4)).toBe(false);
  });
});

describe('edgeLabelGlyphAdvances', () => {
  it('returns one advance per character', () => {
    expect(edgeLabelGlyphAdvances('is a', 40)).toHaveLength(4);
    expect(edgeLabelGlyphAdvances('compound modifier', 40)).toHaveLength(17);
  });

  it('survives a measurement engine that cannot measure', () => {
    // No canvas here, so the normalization step is unavailable. The buckets
    // alone must still produce a usable label rather than throwing.
    const advances = edgeLabelGlyphAdvances('is a kind of', 40);
    expect(advances).not.toBeNull();
    expect(advances.every((w) => Number.isFinite(w) && w > 0)).toBe(true);
  });

  it('ignores a measurement taken before the real font loaded', () => {
    // The scrambled-label bug. With EmOne still in flight, measuring resolves
    // against some fallback face, and normalizing to that total rescales every
    // advance by a ratio between two unrelated fonts. Because each glyph's
    // ANGLE is derived from its position along the arc, wrong widths don't just
    // space the label badly — they rotate its characters to angles belonging to
    // a label of a different length, which is what came out visibly jumbled.
    const em = edgeLabelGlyphAdvancesEm('is a kind of');
    const rawTotal = em.reduce((s, e) => s + e, 0) * 40;

    // Font absent: must fall back to unscaled buckets, whatever measurement says.
    stubFonts({ check: () => false, ready: Promise.resolve() });
    const beforeLoad = edgeLabelGlyphAdvances('is a kind of', 40);
    expect(beforeLoad.reduce((s, w) => s + w, 0)).toBeCloseTo(rawTotal, 6);

    restoreFonts();
  });

  it('scales with font size', () => {
    const small = edgeLabelGlyphAdvances('abc', 20);
    const large = edgeLabelGlyphAdvances('abc', 40);
    for (let i = 0; i < small.length; i++) {
      expect(large[i]).toBeCloseTo(small[i] * 2, 6);
    }
  });

  it('keeps the em ratios between characters', () => {
    const em = edgeLabelGlyphAdvancesEm('Wil');
    const px = edgeLabelGlyphAdvances('Wil', 40);
    expect(px[0] / px[1]).toBeCloseTo(em[0] / em[1], 6);
    expect(px[1] / px[2]).toBeCloseTo(em[1] / em[2], 6);
  });

  it('declines text it must not split, and nonsense font sizes', () => {
    expect(edgeLabelGlyphAdvances('\u{1F600}', 40)).toBeNull();
    expect(edgeLabelGlyphAdvances('cafe\u0301', 40)).toBeNull();  // combining acute
    expect(edgeLabelGlyphAdvances('caf\u00E9', 40)).toHaveLength(4); // precomposed: fine
    expect(edgeLabelGlyphAdvances('', 40)).toBeNull();
    expect(edgeLabelGlyphAdvances('ok', 0)).toBeNull();
    expect(edgeLabelGlyphAdvances('ok', NaN)).toBeNull();
  });
});
