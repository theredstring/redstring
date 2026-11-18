import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import useGraphStore from '../../src/store/graphStore.js';
import { formulaEditOf, saveFormulaEdit } from '../../src/components/canvas/formats/formula/editFormula.js';
import { symbolsOf } from '../../src/components/canvas/formats/formula/formulaEquations.js';
import { formulaWeb } from './formulaWeb.js';

/**
 * Edit Formula (formula/editFormula.js): the New Formula box opened on an
 * equation as it was made, and saving it writes the equation over in place.
 */
const readOptions = { convention: 'math', isKnownName: () => false };

// P = F / A, the equation's Thing `p-eq`: P tied to Pressure, F and A bare letters.
const pressure = (name = 'P = F ÷ A') => {
  const state = formulaWeb({
    things: [['p', 'Pressure', 0], ['f', 'F', 300], ['a', 'A', 600]],
    ops: [['p', 'f', 'Equality'], ['f', 'a', 'Division']],
    top: ['p', 'f', 'a'],
    labels: { Pressure: 'P' },
    format: 'formula',
  });
  state.nodePrototypes.set('p-eq', { id: 'p-eq', name, color: '#8B0000', typeNodeId: null });
  state.graphs.get('web').groups.get('top').linkedNodePrototypeId = 'p-eq';
  return state;
};
const symbols = () => symbolsOf(useGraphStore.getState(), 'p-eq').map(r => [r.symbol, useGraphStore.getState().nodePrototypes.get(r.protoId)?.name, r.bare]);

describe('Edit Formula', () => {
  beforeEach(() => { useGraphStore.setState(pressure()); });

  it('opens on the equation as it was typed, unnamed when named by its text', () => {
    expect(formulaEditOf(useGraphStore.getState(), 'web', 'top')).toEqual({ groupId: 'top', equationProtoId: 'p-eq', text: 'P = F ÷ A', title: '' });
    useGraphStore.setState(pressure('Pressure Law'));
    expect(formulaEditOf(useGraphStore.getState(), 'web', 'top').title).toBe('Pressure Law');
    expect(formulaEditOf(useGraphStore.getState(), 'web', 'nothing')).toBe(null);
  });

  it('writes it over, keeping a tied letter tied and dropping loose letters it no longer has', () => {
    const edit = formulaEditOf(useGraphStore.getState(), 'web', 'top');
    saveFormulaEdit('web', edit, 'P = F / S', 'Pressure Law', readOptions);
    const st = useGraphStore.getState();
    expect(st.nodePrototypes.get('p-eq').name).toBe('Pressure Law');
    expect(symbols()).toEqual([['P', 'Pressure', false], ['F', 'F', true], ['S', 'S', true]]);
    expect([...st.nodePrototypes.values()].some(p => p.name === 'A')).toBe(false);
    expect(st.graphs.get('web').groups.get('top').linkedNodePrototypeId).toBe('p-eq');
  });

  it('names it by its new text when the name is left empty', () => {
    saveFormulaEdit('web', formulaEditOf(useGraphStore.getState(), 'web', 'top'), 'P = F / S', '', readOptions);
    expect(useGraphStore.getState().nodePrototypes.get('p-eq').name).toBe('P = F ÷ S');
  });
});
