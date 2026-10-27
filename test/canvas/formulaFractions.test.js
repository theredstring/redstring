import { describe, it, expect } from 'vitest';
import { chainFromText, chainText, tokensOf, rowsOf } from '../../src/components/canvas/formats/formula/formulaChain.js';
import { layoutFormulaLine } from '../../src/components/canvas/formats/formula/formulaObjects.js';

const standard = (t) => tokensOf(chainFromText(t), { standard: true });
/** A row as text: a fraction as [numerator / denominator]. */
const shape = (tokens) => {
  const row = (r) => r.map(e => (typeof e === 'number' ? tokens[e].text : `[${row(e.num)} / ${row(e.den)}]`)).join(' ');
  return row(rowsOf(tokens));
};

describe('division as a fraction', () => {
  it('stacks what the precedence divides, and only that', () => {
    expect(shape(standard('a + b / c'))).toBe('a + [b / c]');
    expect(shape(standard('a b / c'))).toBe('[a b / c]');
    expect(shape(standard('a / b c'))).toBe('[a / b] c');
    expect(shape(standard('a / b / c'))).toBe('[[a / b] / c]');
    expect(shape(standard('a / b^2'))).toBe('[a / b 2]');
  });

  it('drops the parentheses the bar already gives', () => {
    expect(shape(standard('x = (a + b) / (2 c)'))).toBe('x = [a + b / 2 c]');
    // A function's own parentheses stay.
    expect(shape(standard('sin(a / b)'))).toBe('sin ( [a / b] )');
  });

  it('keeps division on the line in an exponent, as a slash', () => {
    expect(shape(standard('k = A e^(-E / (R T))'))).toBe('k = A e − E / ( R T )');
  });

  it('multiplies what follows it side by side: ½at²', () => {
    const tokens = standard('x = 1/2 a t^2');
    expect(shape(tokens)).toBe('x = [1 / 2] a t 2');
    expect(tokens.find(t => t.text === 'a').joined).toBe(true);
  });

  it('is the division token itself, so it still stands for the operation', () => {
    const bar = standard('a / b').find(t => t.bar);
    expect(bar).toMatchObject({ kind: 'operator', realName: 'Division', defined: false });
  });

  it('stays on one line where asked, and in plain text', () => {
    expect(shape(tokensOf(chainFromText('a / b'), { standard: true, stack: false }))).toBe('a / b');
    expect(chainText(chainFromText('(a + b) / c'))).toBe('(a + b) ÷ c');
  });

  it('lays the numerator over the denominator, centred, the line taller for it', () => {
    const plain = layoutFormulaLine(standard('a + b'), 44);
    const tokens = standard('x = (a + b) / c');
    const { boxes, height } = layoutFormulaLine(tokens, 44);
    expect(height).toBeGreaterThan(plain.height * 1.3);
    const at = (text) => boxes[tokens.findIndex(t => t.text === text)];
    const bar = boxes[tokens.findIndex(t => t.bar)].bar;
    expect(at('a').y + at('a').h).toBeLessThan(at('c').y + at('c').h);
    expect(at('a').baseline).toBeLessThan(bar.y);
    expect(at('c').baseline).toBeGreaterThan(bar.y + bar.h);
    // The bar spans the wider row; the narrower one is centred under it.
    expect(bar.x).toBeLessThanOrEqual(at('a').x);
    expect(bar.x + bar.w).toBeGreaterThanOrEqual(at('b').x + at('b').w);
    const cMid = at('c').x + at('c').w / 2;
    expect(Math.abs(cMid - (bar.x + bar.w / 2))).toBeLessThan(1);
  });
});

describe('a square root over what it holds', () => {
  const rootShape = (t) => {
    const tokens = standard(t);
    const row = (r) => r.map(e => (typeof e === 'number' ? tokens[e].text
      : e.kind === 'root' ? `√[${row(e.body)}]` : `[${row(e.num)} / ${row(e.den)}]`)).join(' ');
    return row(rowsOf(tokens));
  };

  it('holds exactly its contents, without the parentheses', () => {
    expect(rootShape('d = sqrt(x^2 + y^2)')).toBe('d = √[x 2 + y 2]');
    expect(rootShape('sqrt(a) + b')).toBe('√[a] + b');
    expect(rootShape('x = (-b + sqrt(b^2 - 4*a*c)) / (2*a)')).toBe('x = [− b + √[b 2 − 4 a c] / 2 a]');
    expect(rootShape('sqrt(a / b)')).toBe('√[[a / b]]');
  });

  it('stays √( ) on one line where asked', () => {
    expect(shape(tokensOf(chainFromText('sqrt(a + b)'), { standard: true, stack: false }))).toBe('√ ( a + b )');
  });

  it('draws its sign as tall as what it holds, its bar over all of it', () => {
    const tokens = standard('sqrt(a + b) + c');
    const { boxes } = layoutFormulaLine(tokens, 44);
    const root = boxes[tokens.findIndex(t => t.radical)].root;
    const at = (text) => boxes[tokens.findIndex(t => t.text === text)];
    expect(root.y).toBeLessThan(at('a').y + at('a').h * 0.3);
    expect(root.x + root.signW).toBeLessThan(at('a').x + 1);
    expect(root.x + root.w).toBeGreaterThan(at('b').x + at('b').w - 1);
    expect(root.x + root.w).toBeLessThan(at('c').x);
    // Taller with a fraction under it.
    const tall = standard('sqrt(a / b)');
    const tallRoot = layoutFormulaLine(tall, 44).boxes[tall.findIndex(t => t.radical)].root;
    expect(tallRoot.h).toBeGreaterThan(root.h * 1.5);
  });
});
