import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import useCanvasUIStore, { createCanvasUIDefaults, setGroupAnchorLookup } from '../../src/store/canvasUIStore.js';
import { setReplaced } from '../../src/components/canvas/formats/replaced.js';
import { selectionInRect } from '../../src/utils/canvas/canvasHitTest.js';
import { tapFormula, withFormulaParts, withSelectedFormula } from '../../src/components/canvas/formats/formula/formulaSelection.js';

/**
 * A formula among Things: selected as its group's anchor when there are
 * others, as its group when it is alone (formats/formula/formulaSelection).
 *
 * The web: Thing `n` loose; formula F (group `gF`, anchor `aF`) drawing `t1`,
 * `t2`; a Thing-group G (group `gG`, anchor `aG`) that isn't a formula.
 */
const st = () => useCanvasUIStore.getState();
const anchorsToGroups = new Map([['aF', 'gF'], ['aG', 'gG']]);
let unregister;

beforeEach(() => {
  useCanvasUIStore.setState(createCanvasUIDefaults());
  unregister = setGroupAnchorLookup((ids) => new Map([...ids].filter(id => anchorsToGroups.has(id)).map(id => [id, anchorsToGroups.get(id)])));
  setReplaced(
    new Set(['t1', 't2', 'aF']),
    new Set(['gF']),
    new Map(),
    new Map([['aF', { x: 500, y: 0, w: 200, h: 100, groupId: 'gF', memberIds: ['t1', 't2'] }]]),
  );
});

afterEach(() => {
  unregister();
  setReplaced(new Set(), new Set(), new Map(), new Map());
});

describe('a formula in the selection', () => {
  it('alone, is selected as its group', () => {
    st().setSelectedInstanceIds(new Set(['aF']));
    expect(st().selectedGroupId).toBe('gF');
    expect(st().selectedInstanceIds.size).toBe(0);
  });

  it('boxed alone, waits for the box to be let go to be selected as its group, as a Thing waits for its pie', () => {
    st().dispatchPie({ type: 'MARQUEE', active: true });
    st().setSelectedInstanceIds(new Set(['aF']));
    expect(st().selectedGroupId).toBe(null);
    expect([...st().selectedInstanceIds]).toEqual(['aF']);
    expect(st().selectedNodeIdForPieMenu).toBe(null);
    st().setSelectedInstanceIds(new Set(['aF', 'n']));
    st().setSelectedInstanceIds(new Set(['aF']));
    expect(st().selectedGroupId).toBe(null);
    st().dispatchPie({ type: 'MARQUEE', active: false });
    expect(st().selectedGroupId).toBe('gF');
    expect(st().selectedInstanceIds.size).toBe(0);
    expect(st().selectedNodeIdForPieMenu).toBe(null);
  });

  it('among Things, stays as its anchor; its drawn Things and other anchors do not', () => {
    st().setSelectedInstanceIds(new Set(['n', 'aF', 't1', 'aG']));
    expect([...st().selectedInstanceIds].sort()).toEqual(['aF', 'n']);
  });

  it('is boxed whole by a selection box', () => {
    const nodes = []; // no Things to measure: only the formula's box is under test
    expect(selectionInRect({ x: 450, y: 50, width: 100, height: 20 }, nodes, new Set(), null).has('aF')).toBe(true);
    expect(selectionInRect({ x: 900, y: 50, width: 100, height: 20 }, nodes, new Set(), null).has('aF')).toBe(false);
  });

  it('brings its Things along when the selection is dragged', () => {
    expect([...withFormulaParts(new Set(['n', 'aF']))].sort()).toEqual(['aF', 'n', 't1', 't2']);
    const plain = new Set(['n']);
    expect(withFormulaParts(plain)).toBe(plain);
  });
});

describe('tapping a formula', () => {
  it('with nothing selected, selects it alone', () => {
    tapFormula('gF', 'aF');
    expect(st().selectedGroupId).toBe('gF');
  });

  it('with Things selected, joins them, and a second tap takes it back out', () => {
    st().setSelectedInstanceIds(new Set(['n', 'm']));
    tapFormula('gF', 'aF');
    expect([...st().selectedInstanceIds].sort()).toEqual(['aF', 'm', 'n']);
    tapFormula('gF', 'aF');
    expect([...st().selectedInstanceIds].sort()).toEqual(['m', 'n']);
  });

  it("doesn't leave the selection on a token's tap, which switches the token", () => {
    st().setSelectedInstanceIds(new Set(['n', 'aF']));
    tapFormula('gF', 'aF', { keep: true });
    expect(st().selectedInstanceIds.has('aF')).toBe(true);
  });

  it('selected alone, is kept when a Thing is tapped or boxed next to it', () => {
    tapFormula('gF', 'aF');
    expect([...withSelectedFormula(new Set(['n']))].sort()).toEqual(['aF', 'n']);
  });
});
