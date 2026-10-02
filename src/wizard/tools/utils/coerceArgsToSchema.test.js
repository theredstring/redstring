import { describe, it, expect } from 'vitest';
import { coerceArgsToSchema } from './coerceArgsToSchema.js';
import { executeTool } from '../index.js';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    groups: { type: 'array', items: { type: 'string' } },
    nodes: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } }
    },
    layers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          definition: {
            type: 'object',
            properties: { groups: { type: 'array', items: { type: 'string' } } }
          }
        }
      }
    }
  }
};

describe('coerceArgsToSchema', () => {
  it('wraps a lone string where an array of strings is expected', () => {
    expect(coerceArgsToSchema({ groups: 'Deities:: Tlaloc, Xolotl' }, schema).groups)
      .toEqual(['Deities:: Tlaloc, Xolotl']);
  });

  it('wraps a lone object where an array of objects is expected, and walks into it', () => {
    expect(coerceArgsToSchema({ nodes: { name: 'Sun', tags: 'star' } }, schema).nodes)
      .toEqual([{ name: 'Sun', tags: ['star'] }]);
  });

  it('parses a JSON array written as a string', () => {
    expect(coerceArgsToSchema({ groups: '["A: x", "B: y"]' }, schema).groups).toEqual(['A: x', 'B: y']);
  });

  it('repairs nested specs', () => {
    const out = coerceArgsToSchema({ layers: [{ definition: { groups: 'Core: a, b' } }] }, schema);
    expect(out.layers[0].definition.groups).toEqual(['Core: a, b']);
  });

  it('leaves what it cannot repair for the tool, and does not mutate its input', () => {
    const args = { name: 'X', groups: 42, nodes: 'Sun' };
    const out = coerceArgsToSchema(args, schema);
    expect(out).toEqual({ name: 'X', groups: 42, nodes: 'Sun' });
    expect(out).not.toBe(args);
  });

  it('passes well-formed args through unchanged', () => {
    const args = { name: 'X', groups: ['A: b'], nodes: [{ name: 'Sun' }] };
    expect(coerceArgsToSchema(args, schema)).toEqual(args);
  });
});

describe('executeTool with a small model\'s malformed list', () => {
  // The call qwen3-4b made: groups as one shorthand string instead of an array.
  // It used to fail with "(i || []).map is not a function".
  it('runs sketchGraph when groups arrives as a single string', async () => {
    const result = await executeTool('sketchGraph', {
      name: 'Mesoamerican Deities',
      nodes: ['Quetzalcoatl', 'Tezcatlipoca', 'Tlaloc', 'Xolotl'],
      edges: ['Quetzalcoatl -> Opposes -> Tezcatlipoca'],
      groups: 'Wind Deities: Quetzalcoatl, Tezcatlipoca'
    }, { graphs: [], nodePrototypes: [] });
    expect(result.expandedSpec.groups.map(g => g.name)).toContain('Wind Deities');
  });
});
