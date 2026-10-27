/**
 * Tests for addFormula's choice of web
 */

import { describe, it, expect } from 'vitest';
import { addFormula } from './addFormula.js';

const webs = [
  { id: 'w-1', name: 'Mechanics' },
  { id: 'w-2', name: 'Optics' },
  { id: 'w-3', name: 'Thermo' }
];

describe('addFormula web', () => {
  it('writes into the active web by default', async () => {
    const result = await addFormula({ text: 'F = m * a' }, { graphs: webs, nodePrototypes: [], activeGraphId: 'w-2' });
    expect(result.graphId).toBe('w-2');
  });

  it('takes a web by name', async () => {
    const result = await addFormula({ text: 'F = m * a', targetGraphId: 'thermo' }, { graphs: webs, nodePrototypes: [], activeGraphId: 'w-1' });
    expect(result.graphId).toBe('w-3');
  });

  it('with no active web, says to pass targetGraphId and lists the webs, open ones first', async () => {
    await expect(
      addFormula({ text: 'F = m * a' }, { graphs: webs, nodePrototypes: [], activeGraphId: null, openGraphIds: ['w-3'] })
    ).rejects.toThrow('No web is active to add the formula to. Pass targetGraphId (a web\'s name or id): "Thermo", "Mechanics", "Optics". Or create one with createGraph.');
  });

  it('says so when the named web does not exist, instead of passing the name through as an id', async () => {
    await expect(
      addFormula({ text: 'F = m * a', targetGraphId: 'Acoustics' }, { graphs: webs, nodePrototypes: [], activeGraphId: 'w-1' })
    ).rejects.toThrow('No web named or with id "Acoustics"');
  });

  it('points at createGraph when there are no webs at all', async () => {
    await expect(
      addFormula({ text: 'F = m * a' }, { graphs: [], nodePrototypes: [] })
    ).rejects.toThrow('create one with createGraph');
  });
});
