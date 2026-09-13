/**
 * How a storage slot header behaves as the panel narrows.
 *
 * The repository slot carries four buttons now — copy, download, history,
 * unlink — and at phone widths they stop fitting beside the repository name.
 * The rule being fixed here is that the buttons take a row of their own before
 * the name is squeezed out of the box that is supposed to be naming it, and
 * that having their own row makes them bigger rather than smaller.
 */
import { describe, it, expect } from 'vitest';
import { slotLayout } from '../../src/components/universe-manager/shared/slotLayout.js';

const theme = { canvas: { textPrimary: '#260000' } };
const wide = slotLayout({ isSlim: false, isVerySlim: false, theme });
const slim = slotLayout({ isSlim: true, isVerySlim: false, theme });
const verySlim = slotLayout({ isSlim: true, isVerySlim: true, theme });

describe('slotLayout', () => {
  it('keeps the name and the buttons on one line while they both fit', () => {
    expect(wide.buttonsOwnRow).toBe(false);
    expect(wide.headerStyle.flexDirection).toBe('row');
    expect(slim.buttonsOwnRow).toBe(false);
    expect(slim.headerStyle.flexDirection).toBe('row');
  });

  it('gives the buttons their own row once they stop fitting', () => {
    expect(verySlim.buttonsOwnRow).toBe(true);
    expect(verySlim.headerStyle.flexDirection).toBe('column');
  });

  it('makes the buttons BIGGER on their own row, not smaller', () => {
    // The trap this replaces: shrinking to 14px with a 1px gap to stay inline
    // for a few more pixels, which produced the smallest targets at exactly
    // the width where they are hardest to hit.
    expect(verySlim.buttonSize).toBeGreaterThan(slim.buttonSize);
    expect(verySlim.buttonSize).toBe(wide.buttonSize);
    expect(verySlim.buttonStyle.padding).toBe('6px');
  });

  it('opens the gaps between them once there is room for it', () => {
    expect(verySlim.buttonRowStyle.gap).toBeGreaterThan(slim.buttonRowStyle.gap);
    expect(verySlim.buttonRowStyle.gap).toBeGreaterThan(wide.buttonRowStyle.gap);
  });

  it('reads as a toolbar on its own row and stays pinned right when inline', () => {
    expect(verySlim.buttonRowStyle.justifyContent).toBe('flex-start');
    expect(wide.buttonRowStyle.justifyContent).toBe('flex-end');
  });

  it('lets a long repository name give way instead of pushing the buttons out', () => {
    // Both are required: the flex child must be allowed to shrink below its
    // content, and the text must have somewhere to go when it does.
    for (const layout of [wide, slim, verySlim]) {
      expect(layout.labelStyle.minWidth).toBe(0);
      expect(layout.headerStyle.minWidth).toBe(0);
      expect(layout.labelTextStyle.overflow).toBe('hidden');
      expect(layout.labelTextStyle.textOverflow).toBe('ellipsis');
      expect(layout.labelTextStyle.whiteSpace).toBe('nowrap');
    }
  });

  it('never lets the buttons themselves be the thing that shrinks', () => {
    for (const layout of [wide, slim, verySlim]) {
      expect(layout.buttonRowStyle.flexShrink).toBe(0);
    }
  });

  it('takes its label colour from the theme rather than hard-coding one', () => {
    expect(wide.labelTextStyle.color).toBe('#260000');
    expect(slotLayout({ theme: undefined }).labelTextStyle.color).toBeUndefined();
  });
});
