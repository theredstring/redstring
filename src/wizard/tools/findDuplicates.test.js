import { describe, it, expect } from 'vitest';
import { findDuplicates } from './findDuplicates.js';
import { repeatedTermsLines } from './utils/formulas.js';

describe('findDuplicates and formulas', () => {
  // "1 + R" and "1 − R" are parts of a formula: alike in name, different terms.
  const state = () => ({
    activeGraphId: 'w',
    graphs: [{
      id: 'w', name: 'W',
      instances: [
        { id: 'i-plus', prototypeId: 'p-plus' }, { id: 'i-minus', prototypeId: 'p-minus' }, { id: 'i-r', prototypeId: 'p-r' },
        { id: 'i-volt', prototypeId: 'p-volt' }, { id: 'i-volt2', prototypeId: 'p-volt2' }
      ]
    }],
    nodePrototypes: [
      { id: 'p-plus', name: '1 + R' }, { id: 'p-minus', name: '1 − R' }, { id: 'p-r', name: 'Reflectivity' },
      { id: 'p-volt', name: 'Voltage' }, { id: 'p-volt2', name: 'Voltage' }
    ],
    formulas: [{
      graphId: 'w', title: 'Law', text: '(1 + R) = (1 − R)',
      terms: [{ symbol: 'R', thing: 'Reflectivity', instanceId: 'i-r', protoId: 'p-r' }],
      memberIds: ['i-plus', 'i-minus', 'i-r']
    }]
  });

  it('leaves a formula\'s parts out and still finds real duplicates', async () => {
    const result = await findDuplicates({ targetGraphId: 'w' }, state());
    expect(result.duplicateGroups.map(g => g.nodes.map(n => n.name))).toEqual([['Voltage', 'Voltage']]);
  });

  it('scans the Things of a definition opened in place in the web', async () => {
    const s = state();
    s.graphs[0].instances.push({ id: 'i-law', prototypeId: 'p-law', openDefinition: { index: 0 } });
    s.graphs.push({ id: 'law', name: 'Law', instances: [{ id: 'i-mass', prototypeId: 'p-mass' }, { id: 'i-mass2', prototypeId: 'p-mass2' }] });
    s.nodePrototypes.push({ id: 'p-law', name: 'Law', definitionGraphIds: ['law'] }, { id: 'p-mass', name: 'Mass' }, { id: 'p-mass2', name: 'Mass' });
    const result = await findDuplicates({ targetGraphId: 'w' }, s);
    expect(result.duplicateGroups.map(g => g.nodes[0].name)).toContain('Mass');
  });
});

describe('repeatedTermsLines', () => {
  const f = (title, terms) => ({ title, terms });
  it('says a term in two formulas is one Thing, or separate Things of one name', () => {
    const lines = repeatedTermsLines([
      f('Thrust', [{ symbol: 'P', thing: 'Laser Beam Power', protoId: 'p1' }, { symbol: 'c', thing: 'Speed of Light', protoId: 'c1' }, { symbol: '1', thing: '1', protoId: 'n1' }]),
      f('Doppler', [{ symbol: 'P', thing: 'Laser Beam Power', protoId: 'p1' }, { symbol: '1', thing: '1', protoId: 'n1' }]),
      f('Energy', [{ symbol: 'c', thing: 'Speed of Light', protoId: 'c2' }])
    ]);
    expect(lines).toEqual([
      'Terms shared by formulas, one Thing each: Laser Beam Power (Thrust, Doppler)',
      'Same name, separate Things: Speed of Light (Thrust, Energy)'
    ]);
  });
});
