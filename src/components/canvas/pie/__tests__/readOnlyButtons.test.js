import { describe, it, expect, afterEach } from 'vitest';
import { setReadOnlyUniverse } from '../../../../store/readOnlyUniverse.js';
import { READ_ONLY_HINT, dimEditsWhenReadOnly, dimMenuEditsWhenReadOnly } from '../readOnlyButtons.js';

const open = () => setReadOnlyUniverse({ slug: 'v', name: 'V', sourceUrl: 'https://x/f.redstring' });
const byId = (buttons) => Object.fromEntries(buttons.map((b) => [b.id, b]));

afterEach(() => setReadOnlyUniverse(null));

describe('dimming edits in a read-only universe', () => {
  const buttons = [
    { id: 'decompose-preview', label: 'Decompose' },
    { id: 'decomp-next', label: 'Next Definition' },
    { id: 'decomp-further', label: 'Decompose Further' },
    { id: 'decomp-add', label: 'Add Definition' },
    { id: 'delete', label: 'Delete' },
    { id: 'something-new', label: 'Something New' },
  ];

  it('leaves everything alone otherwise, as the same array', () => {
    expect(dimEditsWhenReadOnly(buttons)).toBe(buttons);
    const options = [{ label: 'Delete' }];
    expect(dimMenuEditsWhenReadOnly(options)).toBe(options);
  });

  it('keeps expanding and flipping through definitions live', () => {
    open();
    const dimmed = byId(dimEditsWhenReadOnly(buttons));
    expect(dimmed['decompose-preview'].disabled).toBeUndefined();
    expect(dimmed['decomp-next'].disabled).toBeUndefined();
  });

  it('dims edits, turning a definition into a Thing-group, and anything not known to only look', () => {
    open();
    const dimmed = byId(dimEditsWhenReadOnly(buttons));
    for (const id of ['decomp-further', 'decomp-add', 'delete', 'something-new']) {
      expect(dimmed[id].disabled).toBe(true);
      expect(dimmed[id].label).toBe(READ_ONLY_HINT);
    }
  });

  it('can dim a looking button that has nothing to look at', () => {
    open();
    const [expand] = dimEditsWhenReadOnly([{ id: 'expand-tab', label: 'Expand' }], () => true);
    expect(expand.disabled).toBe(true);
  });

  it('does the same for context menus', () => {
    open();
    const [look, edit] = dimMenuEditsWhenReadOnly([{ label: 'Open Web' }, { label: 'Delete' }]);
    expect(look.disabled).toBeUndefined();
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe(READ_ONLY_HINT);
  });
});
