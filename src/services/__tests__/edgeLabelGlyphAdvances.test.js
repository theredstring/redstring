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

import { describe, it, expect } from 'vitest';
import { edgeLabelGlyphAdvances } from '../textMeasurement.js';
import { edgeLabelGlyphAdvancesEm } from '../layoutGeometry.js';

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
