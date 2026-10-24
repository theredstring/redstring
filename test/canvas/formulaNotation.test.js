import { describe, it, expect } from 'vitest';
import { operatorKeyForName } from '../../src/components/canvas/formats/formula/formulaNotation.js';
import { chainFromText, chainText, tokensOf, readFormulaGroup } from '../../src/components/canvas/formats/formula/formulaChain.js';
import { projectGraphView } from '../../src/core/openDefinitions.js';
import { formulaWeb } from './formulaWeb.js';

const read = (state) => {
  const view = projectGraphView(state, 'web');
  const chain = readFormulaGroup(state, view, view.groups.get('top'));
  return chain ? chainText(chain) : null;
};
const text = (t) => chainText(chainFromText(t));

describe('formula vocabulary', () => {
  it('knows operations by symbol and by word', () => {
    expect(operatorKeyForName('+')).toBe('add');
    expect(operatorKeyForName('  Addition ')).toBe('add');
    expect(operatorKeyForName('divided by')).toBe('div');
    expect(operatorKeyForName('Exponentiation')).toBe('pow');
    expect(operatorKeyForName('Mass')).toBe(null);
  });
});

describe('typed text', () => {
  it('reads back token by token, with a part only where precedence needs one', () => {
    expect(text('E = m * c^2')).toBe('E = m × c ^ 2');
    expect(text('(a + b) * c')).toBe('(a + b) × c');
    expect(text('a + b * c')).toBe('a + b × c');
    expect(text('a - (b - c)')).toBe('a − (b − c)');
    expect(text('(a - b) - c')).toBe('a − b − c');
    expect(text('a + b + c')).toBe('a + b + c');
    expect(text('2^3^2')).toBe('2 ^ 3 ^ 2');
    expect(text('(2^3)^2')).toBe('(2 ^ 3) ^ 2');
    expect(text('x = (-b + sqrt(b^2 - 4*a*c)) / (2*a)')).toBe('x = (−b + √(b ^ 2 − 4 × a × c)) ÷ (2 × a)');
    expect(text('sin(x)^2 + cos(x)^2 = 1')).toBe('sin(x) ^ 2 + cos(x) ^ 2 = 1');
    expect(text('2(a+b)')).toBe('2 × (a + b)');
    expect(text('max(a, b) + 1')).toBe('max(a, b) + 1');
  });

  it('makes each part a Thing named after its term, typed by what is applied to it', () => {
    const chain = chainFromText('(a + b) * sqrt(c)');
    const [paren, times, root] = chain.items;
    expect(paren).toMatchObject({ kind: 'part', apply: null, name: 'a + b' });
    expect(times).toMatchObject({ kind: 'op', key: 'mul' });
    expect(root).toMatchObject({ kind: 'part', apply: 'sqrt', typeName: 'Square Root', name: '√c' });
  });

  it('gives exponentiation a token of its own, like every operation', () => {
    const tokens = tokensOf(chainFromText('c^2'));
    expect(tokens.map(t => [t.text, t.kind])).toEqual([['c', 'operand'], ['^', 'operator'], ['2', 'operand']]);
  });

  it('reads standard math: letters side by side multiply, unless they spell something known', () => {
    expect(text('e=mc^2')).toBe('e = m × c ^ 2');
    expect(text('4ac')).toBe('4 × a × c');
    expect(text('sinx + 1')).toBe('sin(x) + 1');
    expect(text('sin x^2')).toBe('sin(x ^ 2)');
    expect(text('2 pi r')).toBe('2 × pi × r');
    expect(text('2pir')).toBe('2 × pi × r');
    expect(text('a(b + c)')).toBe('a × (b + c)');
    expect(text('f(x) = x^2')).toBe('f(x) = x ^ 2');
    expect(text('x1 + x2')).toBe('x1 + x2');
    expect(text('v_max = d / t')).toBe('v_max = d ÷ t');
    expect(text('"speed of light" ^ 2')).toBe('speed of light ^ 2');
    // A Thing the universe already has keeps its name whole.
    expect(chainText(chainFromText('e=mc^2', { isKnownName: (n) => n === 'mc' }))).toBe('e = mc ^ 2');
  });

  it('reads programming: whole-word names, * to multiply, parentheses to call', () => {
    const code = (t) => chainText(chainFromText(t, { convention: 'programming' }));
    expect(code('energy = mass * c**2')).toBe('energy = mass × c ^ 2');
    expect(code('total = price * qty')).toBe('total = price × qty');
    expect(code('y = sin(x)')).toBe('y = sin(x)');
    expect(() => code('e = m c')).toThrow(/\*/);
  });

  it('writes standard notation: multiplication side by side where math does, else the ×', () => {
    const shown = (t) => tokensOf(chainFromText(t), { standard: true }).map(x => x.text).join(' ');
    expect(shown('e=mc^2')).toBe('e = m c 2');
    expect(shown('4ac')).toBe('4 a c');
    expect(shown('2(a+b)')).toBe('2 ( a + b )');
    expect(shown('a*2')).toBe('a × 2');
    expect(shown('2*(-b)')).toBe('2 × − b');
    const code = (t) => tokensOf(chainFromText(t, { convention: 'programming' }), { standard: true }).map(x => x.text).join(' ');
    expect(code('mass * speed')).toBe('mass × speed');
    // Explicit writes every operation.
    expect(tokensOf(chainFromText('e=mc^2')).map(x => x.text).join(' ')).toBe('e = m × c ^ 2');
  });

  it('raises exponents the usual way when asked: no ^, a level up, the raise grouping a part', () => {
    const levels = (t) => tokensOf(chainFromText(t, { convention: 'programming' }), { standard: true }).map(x => [x.text, x.level]);
    expect(levels('c^2')).toEqual([['c', 0], ['2', 1]]);
    expect(levels('2^3^2')).toEqual([['2', 0], ['3', 1], ['2', 2]]);
    expect(levels('b^(n+1)')).toEqual([['b', 0], ['n', 1], ['+', 1], ['1', 1]]);
    expect(levels('a^b*c')).toEqual([['a', 0], ['b', 1], ['c', 0]]);
    expect(levels('a^b*2')).toEqual([['a', 0], ['b', 1], ['×', 0], ['2', 0]]);
    expect(levels('(a+b)^2')).toEqual([['(', 0], ['a', 0], ['+', 0], ['b', 0], [')', 0], ['2', 1]]);
    // Plain text keeps the ^.
    expect(chainText(chainFromText('b^(n+1)'))).toBe('b ^ (n + 1)');
  });

  it('turns down text that is not a formula', () => {
    expect(() => chainFromText('')).toThrow();
    expect(() => chainFromText('x')).toThrow();
    expect(() => chainFromText('a + ')).toThrow();
    expect(() => chainFromText('(a + b')).toThrow();
  });
});

describe('typed derivatives (Leibniz notation)', () => {
  const known = (...names) => ({ isKnownName: (n) => names.includes(n) });

  it('reads dX/dY, d²X/dY², ∂u/∂t and d/dY X as the derivative', () => {
    expect(text('dI/dt = x')).toBe('derivative(I, t) = x');
    expect(text('V = L dI/dt')).toBe('V = L × derivative(I, t)');
    expect(text('F = dp/dt')).toBe('F = derivative(p, t)');
    expect(text('d^2x/dt^2 = a')).toBe('derivative(derivative(x, t), t) = a');
    expect(text('d²x/dt² = a')).toBe('derivative(derivative(x, t), t) = a');
    expect(text('y = d/dt(x)')).toBe('y = derivative(x, t)');
    expect(text('y = d/dt x^2')).toBe('y = derivative(x ^ 2, t)');
    expect(text('y = d(x^2)/dt')).toBe('y = derivative(x ^ 2, t)');
    expect(text('a = ∂u/∂t')).toBe('a = partial(u, t)');
    expect(text('a = ∂²u/∂t²')).toBe('a = partial(partial(u, t), t)');
    expect(text('a = dv_x/dt')).toBe('a = derivative(v_x, t)');
    expect(text('w = dθ/dt')).toBe('w = derivative(θ, t)');
    expect(text('w = dtheta/dt')).toBe('w = derivative(theta, t)');
  });

  it('leaves a d that is not one: a name, a number over d, a word', () => {
    expect(text('d = v t')).toBe('d = v × t');
    expect(text('x = d/2')).toBe('x = d ÷ 2');
    expect(text('v_max = d / t')).toBe('v_max = d ÷ t');
    expect(text('y = 2 d x')).toBe('y = 2 × d × x');
    expect(text('y = d(a + b)/2')).toBe('y = d × (a + b) ÷ 2');
    expect(text('y = density/dt')).toBe('y = d × e × n × s × i × t × y ÷ d × t');
    // A Thing the universe has by that name stays that Thing.
    expect(chainText(chainFromText('y = dx/dt', known('dx')))).toBe('y = dx ÷ d × t');
    expect(chainText(chainFromText('y = dx/dt', known('dt')))).toBe('y = d × x ÷ dt');
    expect(text('y = "dx"/dt')).toBe('y = dx ÷ d × t');
    // Code reads names whole.
    expect(chainText(chainFromText('y = dx/dt', { convention: 'programming' }))).toBe('y = dx ÷ dt');
  });

  it('says what a derivative is missing', () => {
    expect(() => chainFromText('y = d/dt')).toThrow('d/dt needs what it is of');
    expect(() => chainFromText('y = ∂ x')).toThrow('Write ∂u/∂t, or partial(u, t)');
    expect(() => chainFromText('y = ∂u/∂x∂y')).toThrow('Write ∂u/∂t, or partial(u, t)');
  });
});

describe('typed Unicode', () => {
  it('reads letters in any script, with their marks, lowered digits and primes, as one symbol', () => {
    expect(text('E = ħ ω')).toBe('E = ħ × ω');
    expect(text('E = ℏ ω')).toBe('E = ħ × ω');
    expect(text('y = µ x')).toBe('y = μ × x');
    expect(text('y = ℓ x')).toBe('y = ℓ × x');
    expect(text('y = x₀')).toBe('y = x₀');
    expect(text('P₁V₁/T₁ = P₂V₂/T₂')).toBe('P₁ × V₁ ÷ T₁ = P₂ × V₂ ÷ T₂');
    expect(text('y = x̂ + ẋ')).toBe('y = x̂ + ẋ');
    expect(text('y = f′ x')).toBe('y = f′ × x');
    expect(text('E = ħ * derivative(psi, t)')).toBe('E = ħ × derivative(psi, t)');
  });

  it('keeps a change in a symbol whole: Δx', () => {
    expect(text('y = Δx')).toBe('y = Δx');
    expect(text('y = ∆x')).toBe('y = Δx');
    expect(text('y = ΔU + Δtheta')).toBe('y = ΔU + Δtheta');
    expect(text('y = Δ')).toBe('y = Δ');
  });

  it('raises what superscript digits follow', () => {
    expect(text('y = x²')).toBe('y = x ^ 2');
    expect(text('y = x⁻¹')).toBe('y = x ^ −1');
    expect(text('y = x²y')).toBe('y = x ^ 2 × y');
    expect(text('y = (a + b)²')).toBe('y = (a + b) ^ 2');
  });

  it('says how to write ∑ and ∫, and that ∇ can\'t be yet', () => {
    expect(() => chainFromText('y = ∑ x')).toThrow('Write ∑ as sum(f, i, 1, n)');
    expect(() => chainFromText('y = ∫ x')).toThrow('Write ∫ as integral(f, x, a, b)');
    expect(() => chainFromText('y = ∇ f')).toThrow('Can\'t write ∇ yet');
  });
});

describe('typed functions', () => {
  it('knows the hyperbolic and inverse hyperbolic functions, trace, sign, erf and arg', () => {
    expect(text('y = coth(x)')).toBe('y = coth(x)');
    expect(text('y = sech x + csch x')).toBe('y = sech(x) + csch(x)');
    expect(text('y = arctanh(x) + arccosh(x)')).toBe('y = arctanh(x) + arccosh(x)');
    expect(text('y = erf(x) + erfc x')).toBe('y = erf(x) + erfc(x)');
    expect(text('y = sgn(x)')).toBe('y = sgn(x)');
    expect(text('y = arg(z)')).toBe('y = arg(z)');
    expect(text('S = −tr(ρ log ρ)')).toBe('S = −tr(ρ × log(ρ))');
    expect(text('y = Tr(A)')).toBe('y = Tr(A)');
  });

  it('splits letters by the longest function they spell: arcsinh, not arcsin of h', () => {
    expect(text('y = arcsinhx')).toBe('y = arcsinh(x)');
    expect(text('y = cothx')).toBe('y = coth(x)');
    expect(text('y = arcsinx')).toBe('y = arcsin(x)');
  });
});

describe('a formula in Things mode', () => {
  const abc = (opts = {}) => formulaWeb({
    things: [['a', 'a', 0], ['b', 'b', 300], ['c', 'c', 600]],
    ops: [['a', 'b', 'Addition'], ['b', 'c', 'Multiplication']],
    top: ['a', 'b', 'c'],
    ...opts,
  });

  it('reads a chain of operations, as text reads', () => {
    expect(read(abc())).toBe('a + b × c');
  });

  it('reads in the direction the connections point', () => {
    expect(read(abc({ arrows: 'back' }))).toBe('c × b + a');
  });

  it('reads left to right when the connections have no arrows', () => {
    expect(read(abc({ arrows: 'none' }))).toBe('a + b × c');
  });

  it('reads a nested Thing-group as a part in parentheses', () => {
    const state = formulaWeb({
      things: [['a', 'a', 0], ['b', 'b', 300], ['c', 'c', 700]],
      parts: [{ id: 'g', anchor: 'pa', name: 'a + b', members: ['a', 'b'], x: 150 }],
      ops: [['a', 'b', 'Addition'], ['pa', 'c', 'Multiplication']],
      top: ['a', 'b', 'pa', 'c'],
    });
    expect(read(state)).toBe('(a + b) × c');
  });

  it('reads a part by its type: a root, a sign, a function', () => {
    const typed = (type, members, ops) => read(formulaWeb({
      things: [['x', 'x', 0], ['y', 'y', 300], ['z', 'z', 800]],
      parts: [{ id: 'g', anchor: 'pa', name: 'part', type, members, x: 150 }],
      ops: [...ops, ['pa', 'z', 'Addition']],
      top: [...members, 'pa', 'z'],
    }));
    expect(typed('Square Root', ['x', 'y'], [['x', 'y', 'Subtraction']])).toBe('√(x − y) + z');
    expect(typed('Negation', ['x'], [])).toBe('−x + z');
    expect(typed('sin', ['x'], [])).toBe('sin(x) + z');
    expect(typed('Discriminant', ['x', 'y'], [['x', 'y', 'Subtraction']])).toBe('(x − y) + z');
  });

  it('ignores connections to Things outside the formula', () => {
    const state = abc({ extra: [['cat', 'Cat', 900]] });
    state.edges.set('out', { id: 'out', sourceId: 'cat', destinationId: 'a', definitionNodeIds: [], directionality: { arrowsToward: new Set() } });
    state.graphs.get('web').edgeIds.push('out');
    expect(read(state)).toBe('a + b × c');
  });

  it('turns down what is not one formula', () => {
    // A connection that isn't an operation.
    expect(read(formulaWeb({ things: [['a', 'a', 0], ['b', 'b', 300]], ops: [['a', 'b', null]], top: ['a', 'b'] }))).toBe(null);
    // Two pieces.
    expect(read(formulaWeb({
      things: [['a', 'a', 0], ['b', 'b', 300], ['c', 'c', 600]], ops: [['a', 'b', 'Addition']], top: ['a', 'b', 'c'],
    }))).toBe(null);
    // A branch: a chain can't fork.
    expect(read(formulaWeb({
      things: [['a', 'a', 0], ['b', 'b', 300], ['c', 'c', 600], ['d', 'd', 900]],
      ops: [['a', 'b', 'Addition'], ['a', 'c', 'Addition'], ['a', 'd', 'Addition']], top: ['a', 'b', 'c', 'd'],
    }))).toBe(null);
    // A cycle.
    expect(read(formulaWeb({
      things: [['a', 'a', 0], ['b', 'b', 300], ['c', 'c', 600]],
      ops: [['a', 'b', 'Addition'], ['b', 'c', 'Addition'], ['c', 'a', 'Addition']], top: ['a', 'b', 'c'],
    }))).toBe(null);
    // No operation at all.
    expect(read(formulaWeb({ things: [['a', 'a', 0]], top: ['a'] }))).toBe(null);
  });
});
