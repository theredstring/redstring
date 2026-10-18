import { describe, it, expect } from 'vitest';
import {
  readFormula, linearize, parseFormulaText, formulaToText, operatorKeyForName,
} from '../../src/components/canvas/formats/formula/formulaNotation.js';

// A web slice for a tree drawn the way a person would: root on top, operands
// below it left to right, connections pointing from operator to operand.
function sliceFromText(text, { arrows = 'down', flipX = false } = {}) {
  const tree = parseFormulaText(text);
  const nodes = [];
  const edges = [];
  let n = 0;
  let leafX = 0;
  const place = (node, depth) => {
    const id = `n${n++}`;
    const childIds = (node.children || []).map(c => place(c, depth + 1));
    const xs = childIds.map(c => nodes.find(x => x.id === c).x);
    const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : (leafX++) * 100;
    nodes.push({ id, name: node.name, x: flipX ? -x : x, y: depth * 100 });
    for (const c of childIds) {
      edges.push({
        id: `e${id}${c}`, sourceId: id, destinationId: c,
        arrowsToward: arrows === 'down' ? [c] : arrows === 'up' ? [id] : [],
      });
    }
    return id;
  };
  place(tree, 0);
  return { nodes, edges };
}

const roundTrip = (text, opts) => formulaToText(readFormula(sliceFromText(text, opts)));

describe('formula notation', () => {
  it('knows operators by symbol and by word', () => {
    expect(operatorKeyForName('+')).toBe('add');
    expect(operatorKeyForName('  Addition ')).toBe('add');
    expect(operatorKeyForName('divided by')).toBe('div');
    expect(operatorKeyForName('Mass')).toBe(null);
  });

  it('parses and writes back with the fewest parentheses', () => {
    expect(formulaToText(parseFormulaText('E = m * c^2'))).toBe('E = m × c^2');
    expect(formulaToText(parseFormulaText('(a + b) * c'))).toBe('(a + b) × c');
    expect(formulaToText(parseFormulaText('a - (b - c)'))).toBe('a − (b − c)');
    expect(formulaToText(parseFormulaText('(a - b) - c'))).toBe('a − b − c');
    expect(formulaToText(parseFormulaText('a + b + c'))).toBe('a + b + c');
    expect(formulaToText(parseFormulaText('2^3^2'))).toBe('2^3^2');
    expect(formulaToText(parseFormulaText('(2^3)^2'))).toBe('(2^3)^2');
    expect(formulaToText(parseFormulaText('x = (-b + sqrt(b^2 - 4*a*c)) / (2*a)')))
      .toBe('x = (−b + √(b^2 − 4 × a × c)) ÷ (2 × a)');
    expect(formulaToText(parseFormulaText('sin(x)^2 + cos(x)^2 = 1'))).toBe('sin(x)^2 + cos(x)^2 = 1');
    expect(formulaToText(parseFormulaText('2(a+b)'))).toBe('2 × (a + b)');
  });

  it('flattens repeated addition into one operator', () => {
    const tree = parseFormulaText('a + b + c');
    expect(tree.op.key).toBe('add');
    expect(tree.children).toHaveLength(3);
  });

  it('rejects text that is not a formula', () => {
    expect(() => parseFormulaText('')).toThrow();
    expect(() => parseFormulaText('x')).toThrow();
    expect(() => parseFormulaText('a + ')).toThrow();
    expect(() => parseFormulaText('(a + b')).toThrow();
  });

  it('reads a formula off a web drawn top-down', () => {
    expect(roundTrip('E = m * c^2')).toBe('E = m × c^2');
    expect(roundTrip('x = (-b + sqrt(b^2 - 4*a*c)) / (2*a)'))
      .toBe('x = (−b + √(b^2 − 4 × a × c)) ÷ (2 × a)');
  });

  it('reads either arrow convention, or none', () => {
    expect(roundTrip('(a + b) * c', { arrows: 'up' })).toBe('(a + b) × c');
    expect(roundTrip('(a + b) * c', { arrows: 'none' })).toBe('(a + b) × c');
  });

  it('orders operands left to right on the canvas', () => {
    expect(roundTrip('a - b', { flipX: true })).toBe('b − a');
  });

  it('lets a connection name the side', () => {
    const slice = sliceFromText('a - b', { flipX: true });
    for (const e of slice.edges) {
      const dest = slice.nodes.find(n => n.id === e.destinationId);
      e.role = dest.name === 'a' ? 'left' : 'right';
    }
    expect(formulaToText(readFormula(slice))).toBe('a − b');
  });

  it('turns down what is not one formula', () => {
    // No operator.
    expect(readFormula({
      nodes: [{ id: 'a', name: 'Cat', x: 0, y: 0 }, { id: 'b', name: 'Dog', x: 1, y: 0 }],
      edges: [{ sourceId: 'a', destinationId: 'b' }],
    })).toBe(null);
    // Two pieces.
    expect(readFormula({
      nodes: [{ id: 'p', name: '+', x: 0, y: 0 }, { id: 'a', name: 'a', x: 0, y: 1 }, { id: 'b', name: 'b', x: 1, y: 1 }],
      edges: [{ sourceId: 'p', destinationId: 'a' }],
    })).toBe(null);
    // A cycle.
    expect(readFormula({
      nodes: [{ id: 'p', name: '+', x: 0, y: 0 }, { id: 'a', name: 'a', x: 0, y: 1 }, { id: 'b', name: 'b', x: 1, y: 1 }],
      edges: [{ sourceId: 'p', destinationId: 'a' }, { sourceId: 'p', destinationId: 'b' }, { sourceId: 'a', destinationId: 'b' }],
    })).toBe(null);
    // Division with three operands.
    expect(readFormula({
      nodes: [{ id: 'd', name: '÷', x: 1, y: 0 }, { id: 'a', name: 'a', x: 0, y: 1 }, { id: 'b', name: 'b', x: 1, y: 1 }, { id: 'c', name: 'c', x: 2, y: 1 }],
      edges: [{ sourceId: 'd', destinationId: 'a' }, { sourceId: 'd', destinationId: 'b' }, { sourceId: 'd', destinationId: 'c' }],
    })).toBe(null);
  });

  it('reads minus with one operand as negation', () => {
    const tree = readFormula({
      nodes: [{ id: 'm', name: 'Minus', x: 0, y: 0 }, { id: 'x', name: 'x', x: 0, y: 1 }],
      edges: [{ sourceId: 'm', destinationId: 'x', arrowsToward: ['x'] }],
    });
    expect(formulaToText(tree)).toBe('−x');
  });

  it('reads a Thing typed as an operator by its own name', () => {
    const tree = readFormula({
      nodes: [
        { id: 'o', name: '⊕', typeName: 'Operator', x: 1, y: 0 },
        { id: 'a', name: 'p', x: 0, y: 1 }, { id: 'b', name: 'q', x: 2, y: 1 },
      ],
      edges: [{ sourceId: 'o', destinationId: 'a' }, { sourceId: 'o', destinationId: 'b' }],
    });
    expect(formulaToText(tree)).toBe('p ⊕ q');
  });

  it('linearizes into tokens whose subexpressions are contiguous spans', () => {
    const tree = readFormula(sliceFromText('(a + b) * c'));
    const { tokens, spans } = linearize(tree);
    expect(tokens.map(t => t.text)).toEqual(['(', 'a', '+', 'b', ')', '×', 'c']);
    const plus = tokens[2].nodeId;
    expect(spans.get(plus)).toEqual([0, 4]);
    expect(spans.get(tree.id)).toEqual([0, 6]);
  });

  it('raises an exponent a level', () => {
    const tree = readFormula(sliceFromText('m * c^2'));
    const { tokens } = linearize(tree);
    const two = tokens.find(t => t.text === '2');
    expect(two.level).toBe(1);
    expect(tokens.find(t => t.text === 'c').level).toBe(0);
  });
});
