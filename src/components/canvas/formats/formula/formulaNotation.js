/**
 * Formula notation: the operations a formula is made of, and typed text.
 *
 *   OPERATORS, operatorKeyForName(name)   the vocabulary: "Addition", "+", "plus"...
 *   parseFormulaText("E = mc^2", opts)    typed text -> an expression tree, read as
 *                                         standard math or as programming
 *   needsParens(parent, child, index)     where a line of text needs parentheses
 *
 * How a formula is drawn in Things mode, and read back, is formulaChain.js.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * notation: 'infix' (a + b + c), 'prefix' (−a, √a), or 'applied': an
 *   operation on several things at once, each in its place (the derivative of
 *   m with respect to V; the integral of f over x from a to b), built as a part
 *   whose arguments are those things in order, the way f(x, y) is.
 * prec: binding strength for parentheses. assoc: how equal-strength children nest.
 * arity: [min, max] operands; `counts`, for an applied operation, the numbers
 *   of arguments it takes (a sum of p, over i, or over i from 1 to n).
 * word: a prefix operation written as a function is (ln(x)): by its symbol, its
 *   parentheses always.
 * applied: an infix operation written as a function of its second operand, the
 *   first lowered after its symbol: the logarithm, log_b(x), for b —Logarithm→ x.
 * typed: the word that writes it in a line of text, as a function: an
 *   operation drawn in ways a line can't hold (dm over dV, ∫ with its limits)
 *   is typed derivative(m, V), integral(f, x, a, b).
 * text: the symbol that types it, where the one drawn means something else in
 *   text (· is multiplication; ⋅ is the scalar product, drawn ·).
 */
export const OPERATORS = {
  eq: { symbol: '=', name: 'Equality', notation: 'infix', prec: 1, assoc: 'none', arity: [2, 2],
    aliases: ['=', '==', 'equals', 'equal', 'equal to', 'is equal to', 'equality'] },
  ne: { symbol: '≠', name: 'Inequality', notation: 'infix', prec: 1, assoc: 'none', arity: [2, 2],
    aliases: ['≠', '!=', 'not equal', 'not equal to', 'is not equal to', 'inequality'] },
  lt: { symbol: '<', name: 'Less Than', notation: 'infix', prec: 1, assoc: 'none', arity: [2, 2],
    aliases: ['<', 'less than', 'is less than'] },
  gt: { symbol: '>', name: 'Greater Than', notation: 'infix', prec: 1, assoc: 'none', arity: [2, 2],
    aliases: ['>', 'greater than', 'is greater than'] },
  le: { symbol: '≤', name: 'At Most', notation: 'infix', prec: 1, assoc: 'none', arity: [2, 2],
    aliases: ['≤', '<=', 'at most', 'less than or equal to'] },
  ge: { symbol: '≥', name: 'At Least', notation: 'infix', prec: 1, assoc: 'none', arity: [2, 2],
    aliases: ['≥', '>=', 'at least', 'greater than or equal to'] },
  approx: { symbol: '≈', name: 'Approximately', notation: 'infix', prec: 1, assoc: 'none', arity: [2, 2],
    aliases: ['≈', '~=', 'approximately', 'approximately equal to', 'approximation'] },
  add: { symbol: '+', name: 'Addition', notation: 'infix', prec: 2, assoc: 'all', arity: [2, Infinity],
    aliases: ['+', 'plus', 'add', 'addition', 'sum'] },
  sub: { symbol: '−', name: 'Subtraction', notation: 'infix', prec: 2, assoc: 'left', arity: [2, 2],
    aliases: ['−', '-', 'minus', 'subtract', 'subtraction', 'difference'] },
  mul: { symbol: '×', name: 'Multiplication', notation: 'infix', prec: 3, assoc: 'all', arity: [2, Infinity],
    aliases: ['×', '*', '·', 'times', 'multiply', 'multiplication', 'product', 'multiplied by'] },
  div: { symbol: '÷', name: 'Division', notation: 'infix', prec: 3, assoc: 'left', arity: [2, 2],
    aliases: ['÷', '/', 'divide', 'division', 'divided by', 'quotient'] },
  neg: { symbol: '−', name: 'Negation', notation: 'prefix', prec: 4, assoc: 'none', arity: [1, 1],
    aliases: ['negation', 'negative', 'opposite'] },
  // Of two vectors: the number (a⃗ · b⃗) and the vector (a⃗ × b⃗) they make.
  // Drawn as multiplication is; typed ⋅ and ⨯, since · and × type it.
  dot: { symbol: '·', text: '⋅', name: 'Scalar Product', notation: 'infix', prec: 3, assoc: 'left', arity: [2, 2],
    aliases: ['⋅', 'scalar product', 'dot product', 'inner product'] },
  cross: { symbol: '×', text: '⨯', name: 'Vector Product', notation: 'infix', prec: 3, assoc: 'left', arity: [2, 2],
    aliases: ['⨯', 'vector product', 'cross product'] },
  pow: { symbol: '^', name: 'Exponentiation', notation: 'infix', prec: 5, assoc: 'right', arity: [2, 2],
    aliases: ['^', '**', 'power', 'exponent', 'exponentiation', 'to the power of', 'raised to'] },
  sqrt: { symbol: '√', name: 'Square Root', notation: 'prefix', prec: 6, assoc: 'none', arity: [1, 1],
    aliases: ['√', 'sqrt', 'square root'] },
  // Exponentiation's inverse, so built the same way: base, then what it is taken of.
  log: { symbol: 'log', name: 'Logarithm', notation: 'infix', applied: true, prec: 7, assoc: 'none', arity: [2, 2],
    aliases: ['logarithm', 'log base', 'logarithm base'] },
  ln: { symbol: 'ln', name: 'Natural Logarithm', notation: 'prefix', word: true, prec: 6, assoc: 'none', arity: [1, 1],
    aliases: ['ln', 'natural logarithm', 'natural log'] },
  // log with no base: base 10, as the sciences write it (pH = −log[H⁺]).
  log10: { symbol: 'log', name: 'Common Logarithm', notation: 'prefix', word: true, prec: 6, assoc: 'none', arity: [1, 1],
    aliases: ['log', 'common logarithm', 'common log'] },
  // dQ: an amount of Q too small to see, written against it.
  diff: { symbol: 'd', name: 'Differential', notation: 'prefix', typed: 'differential', prec: 6, assoc: 'none', arity: [1, 1],
    aliases: ['differential'] },
  // What calculus does to a thing, each written over or around what it takes.
  deriv: { symbol: 'd', name: 'Derivative', notation: 'applied', typed: 'derivative', counts: [2], prec: 10, assoc: 'none', arity: [2, 2],
    aliases: ['derivative'], roles: ['of', 'with respect to'] },
  pderiv: { symbol: '∂', name: 'Partial Derivative', notation: 'applied', typed: 'partial', counts: [2], prec: 10, assoc: 'none', arity: [2, 2],
    aliases: ['partial derivative'], roles: ['of', 'with respect to'] },
  integral: { symbol: '∫', name: 'Integral', notation: 'applied', typed: 'integral', counts: [2, 3, 4], prec: 10, assoc: 'none', arity: [2, 4],
    aliases: ['integral', 'integration'], roles: ['of', 'over', 'from', 'to'] },
  // ∫ F⃗ · dr⃗: along a path, what a field does in the direction of each step (work, voltage).
  lineint: { symbol: '∫', name: 'Line Integral', notation: 'applied', typed: 'lineintegral', counts: [2, 3, 4], prec: 10, assoc: 'none', arity: [2, 4],
    aliases: ['line integral', 'path integral'], roles: ['of', 'along', 'from', 'to'] },
  sum: { symbol: '∑', name: 'Summation', notation: 'applied', typed: 'sum', counts: [1, 2, 4], prec: 10, assoc: 'none', arity: [1, 4],
    aliases: ['summation', 'sigma notation'], roles: ['of', 'over', 'from', 'to'] },
  lim: { symbol: 'lim', name: 'Limit', notation: 'applied', typed: 'lim', counts: [3], prec: 10, assoc: 'none', arity: [3, 3],
    aliases: ['limit'], roles: ['of', 'as', 'approaches'] },
};

/** The operation a typed word writes (derivative, integral, sum...), by that word. */
const TYPED = Object.fromEntries(Object.entries(OPERATORS).filter(([, op]) => op.typed).map(([key, op]) => [op.typed, key]));

/** What a line of text writes an operation's symbol as: ⋅ for the scalar product, which is drawn ·. */
export const textSymbolOf = (key) => OPERATORS[key]?.text || OPERATORS[key]?.symbol;

/** Function names that read as f(x) without being declared as functions. */
export const KNOWN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'abs', 'max', 'min', 'floor', 'ceil', 'gcd', 'lcm', 'det', 'lim',
  'coth', 'sech', 'csch', 'arcsinh', 'arccosh', 'arctanh', 'tr', 'Tr', 'sgn', 'erf', 'erfc', 'arg',
  // Not Re and Im: upright Re is the Reynolds number (latexToFormula.js).
  // Formulas built before the logarithm had a base of its own typed their parts by these.
  'log_2', 'log_10',
]);

/** A Thing typed (Is-a) as one of these reads as an operator of its own name. */

const ALIAS_INDEX = (() => {
  const index = new Map();
  for (const [key, op] of Object.entries(OPERATORS)) {
    for (const alias of op.aliases) if (!index.has(alias)) index.set(alias, key);
  }
  return index;
})();

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The operator key a Thing's name stands for, or null. */
export function operatorKeyForName(name) {
  return ALIAS_INDEX.get(norm(name)) || null;
}

/** The operation a word applies to what follows it (sqrt, ln, log), or null. */
function appliedWordKey(word) {
  const key = operatorKeyForName(word);
  return key && key !== 'neg' && OPERATORS[key].notation === 'prefix' ? key : null;
}

/** The base a written logarithm names (log_2 and log2 -> '2', log_b -> 'b'), or null. */
export function logBaseOf(word) {
  const w = String(word ?? '');
  const m = /^log_(.+)$/.exec(w) || /^log(2|10)$/.exec(w);
  return m ? m[1] : null;
}

/** Whether a word is applied to what follows it: a function, sqrt, ln, log with its base, or an operation's typed word. */
const isAppliedWord = (word) => KNOWN_FUNCTIONS.has(word) || !!appliedWordKey(word) || logBaseOf(word) !== null || !!TYPED[word];

function precOf(node) {
  if (node.kind === 'op' && node.op.notation !== 'applied') return node.op.prec;
  return 10; // leaves and f(x) bind tightest
}

/** Whether `child`, operand `index` of infix `parent`, needs parentheses in a line of text. */
export function needsParens(parent, child, index) {
  if (child.kind !== 'op') return false;
  const pp = parent.op.prec;
  const cp = precOf(child);
  if (cp < pp) return true;
  if (cp > pp) return false;
  // Equal strength.
  if (parent.op.assoc === 'all' && child.op.key === parent.op.key) return false;
  if (parent.op.assoc === 'left') return index > 0;
  if (parent.op.assoc === 'right') return index === 0;
  if (parent.op.assoc === 'all') return index > 0;
  return true;
}

// ---------------------------------------------------------------------------
// Parsing text into a tree (to build a formula from what someone types)
// ---------------------------------------------------------------------------

// A name is letters in any script with their marks (F⃗, x̂, ẋ), digits,
// subscript digits (x₀) and primes (f′); ∞ is a name of its own, and ∂ starts
// one (∂u, read as a derivative below). Superscript digits (x², x⁻¹) raise
// what comes before them. ∇ ∑ ∫ are read only to say how to write them.
const TOKEN_RE = /\s*(?:"([^"]*)"|(\d+(?:\.\d+)?)|([\p{L}_∞∂][\p{L}\p{M}\p{Nd}_'′″₀-₉]*)|(⁻?[⁰¹²³⁴-⁹]+)|(<=|>=|!=|==|~=|\*\*|[-+*/^=<>(),×÷·−≠≤≥≈√⋅⨯∇∑∫]))/uy;
// Typed for a letter they look like: micro sign, increment, h-bar.
const SAME_LETTER = { '\u00B5': 'μ', '\u2206': 'Δ', '\u210F': 'ħ' };
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function tokenize(text) {
  const out = [];
  TOKEN_RE.lastIndex = 0;
  const src = String(text).replace(/[\u00B5\u2206\u210F]/g, c => SAME_LETTER[c]);
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw new Error(`Can't read "${src.slice(pos).trim().slice(0, 12)}"`);
    if (m[1] !== undefined) {
      if (!m[1].trim()) throw new Error('Empty name in quotes');
      out.push({ type: 'name', value: m[1].trim(), quoted: true });
    } else if (m[2] !== undefined) out.push({ type: 'num', value: m[2] });
    else if (m[3] !== undefined) out.push({ type: 'name', value: m[3] });
    else if (m[4] !== undefined) {
      // x², x⁻¹: raised, as ^ writes it.
      const digits = [...m[4].replace('⁻', '')].map(c => SUPERSCRIPT.indexOf(c)).join('');
      out.push({ type: 'sym', value: '^' });
      if (m[4].startsWith('⁻')) out.push({ type: 'sym', value: '(' }, { type: 'sym', value: '-' }, { type: 'num', value: digits }, { type: 'sym', value: ')' });
      else out.push({ type: 'num', value: digits });
    } else out.push({ type: 'sym', value: m[5] });
    pos = TOKEN_RE.lastIndex;
  }
  return out;
}

/** Greek letters by name: one variable each in math, however many letters they take. */
export const GREEK_NAMES = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
  'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega',
]);

// Letters conventionally used as function names, so f(x) calls rather than multiplies.
const FUNCTION_LETTERS = new Set(['f', 'g', 'h']);

/**
 * Standard math writing: letters side by side are separate variables multiplied
 * together (mc is m × c), except where they spell something known: a function
 * (sin, log), a Greek letter (theta), or a name the universe already has (a
 * Thing called "mc"). Longest known match first, else one letter. A name with
 * an underscore (v_max) or in quotes is kept whole.
 */
function splitMathName(token, isKnownName) {
  const word = token.value;
  if (token.quoted || word.includes('_') || isKnownName(word) || GREEK_NAMES.has(word) || isAppliedWord(word)) {
    return [{ ...token, fn: isAppliedWord(word) }];
  }
  const pieces = [];
  let i = 0;
  while (i < word.length) {
    let found = null;
    for (let end = word.length; end > i + 1; end--) {
      const piece = word.slice(i, end);
      if (KNOWN_FUNCTIONS.has(piece) || GREEK_NAMES.has(piece) || isKnownName(piece)) { found = piece; break; }
    }
    // ΔU, Δx, Δtheta: a change in a symbol is written as one.
    if (!found && word[i] === 'Δ') {
      const greek = [...GREEK_NAMES].filter(g => word.startsWith(g, i + 1)).sort((a, b) => b.length - a.length)[0];
      found = greek ? `Δ${greek}` : /^Δ\p{L}\p{M}*[0-9₀-₉]*['′″]*/u.exec(word.slice(i))?.[0] || null;
    }
    if (!found) {
      // One letter, keeping its marks (F⃗, x̂), digits right after it (x₁,
      // and x1 written for it) and primes (f', f′).
      found = /^[^0-9'′″\p{M}]\p{M}*[0-9₀-₉]*['′″]*/u.exec(word.slice(i))[0];
    }
    pieces.push({ type: 'name', value: found, fn: KNOWN_FUNCTIONS.has(found) });
    i += found.length;
  }
  return pieces;
}

const INFIX_BY_SYMBOL = {
  '=': 'eq', '==': 'eq', '≠': 'ne', '!=': 'ne', '<': 'lt', '>': 'gt', '≤': 'le', '<=': 'le', '≥': 'ge', '>=': 'ge',
  '≈': 'approx', '~=': 'approx', '+': 'add', '-': 'sub', '−': 'sub', '*': 'mul', '×': 'mul', '·': 'mul',
  '/': 'div', '÷': 'div', '^': 'pow', '**': 'pow', '⋅': 'dot', '⨯': 'cross',
};

/** One symbol, as a derivative is of or taken with respect to: x, x₀, x2, v_x, θ. */
const ONE_SYMBOL = /^\p{L}\p{M}*(?:[0-9₀-₉]*|_[\p{L}\p{N}]+)['′″]*$/u;

/**
 * Leibniz notation, in math: dI/dt, d²x/dt², ∂u/∂t, d(x²)/dt and d/dt X,
 * read as the derivative. Only where the d is joined to one symbol on both
 * sides of the slash (d/2, d = v t and density/dt stay what they are), the
 * marks and the orders agree, and neither side is a Thing the universe has by
 * that name (dB).
 */
function readLeibniz(toks, isKnownName) {
  const out = [];
  const isName = (t) => t?.type === 'name' && !t.quoted;
  const isSym = (t, v) => t?.type === 'sym' && t.value === v;
  const isSymbol = (name) => ONE_SYMBOL.test(name) || GREEK_NAMES.has(name) || isKnownName(name);
  // d, dx, ∂u: its mark and the symbol joined to it ('' for none), else null.
  const marked = (t) => {
    if (!isName(t) || isKnownName(t.value)) return null;
    const m = /^([d∂])(.*)$/u.exec(t.value);
    if (!m || (m[2] && !isSymbol(m[2]))) return null;
    return { mark: m[1], rest: m[2] };
  };
  // ^n at j: n, else null.
  const raisedAt = (j) => (isSym(toks[j], '^') && /^\d+$/.test(toks[j + 1]?.type === 'num' ? toks[j + 1].value : '') ? Number(toks[j + 1].value) : null);
  // The ) closing the ( at j, else -1.
  const closing = (j) => {
    for (let depth = 0; j < toks.length; j++) {
      if (isSym(toks[j], '(')) depth++;
      else if (isSym(toks[j], ')') && --depth === 0) return j;
    }
    return -1;
  };
  for (let k = 0; k < toks.length; k++) {
    const top = marked(toks[k]);
    if (!top) { out.push(toks[k]); continue; }
    let j = k + 1;
    let order = 1;
    let of = top.rest || null;
    let group = null; // d(x²)/dt: the parentheses it is of
    if (!of) {
      // d²x: the order raised on the d, then what it is of.
      const n = raisedAt(j);
      if (n !== null) { order = n; j += 2; }
      if (n !== null && isName(toks[j]) && isSymbol(toks[j].value)) of = toks[j++].value;
      else if (isSym(toks[j], '(') && closing(j) > 0) { group = [j, closing(j)]; j = group[1] + 1; }
    }
    const bottom = isSym(toks[j], '/') ? marked(toks[j + 1]) : null;
    if (!bottom || bottom.mark !== top.mark || !bottom.rest) { out.push(toks[k]); continue; }
    j += 2;
    if (order > 1) {
      if (raisedAt(j) !== order) { out.push(toks[k]); continue; }
      j += 2;
    }
    const key = top.mark === '∂' ? 'pderiv' : 'deriv';
    out.push({ type: 'deriv', key, of, wrt: bottom.rest, order, value: `${top.mark}/${top.mark}${bottom.rest}` });
    if (group) out.push(...readLeibniz(toks.slice(group[0], group[1] + 1), isKnownName));
    k = j - 1;
  }
  return out;
}

/** How typed text is read: 'math' (standard equations) or 'programming' (code-style names). */
export const CONVENTIONS = ['math', 'programming'];

/**
 * Parse "E = mc^2" into a tree of { kind: 'op'|'fn'|'leaf', name, op?, children? }.
 *
 * convention 'math' (the default): letters side by side multiply (see
 *   splitMathName), side by side means multiply generally (2a, 2(a + b)), and a
 *   function takes what follows it with or without parentheses (sin x).
 * convention 'programming': a name is the whole word (mass, speedOfLight),
 *   multiplying needs *, and a function always takes parentheses.
 * isKnownName(name): whether the universe has a Thing by that name, which math
 *   keeps whole.
 *
 * Throws an Error with a short message when the text isn't a formula.
 */
export function parseFormulaText(text, { convention = 'math', isKnownName = () => false } = {}) {
  const math = convention !== 'programming';
  let toks = tokenize(text);
  if (math) toks = readLeibniz(toks, isKnownName);
  if (math) toks = toks.flatMap(t => (t.type === 'name' ? splitMathName(t, isKnownName) : [t]));
  if (toks.length === 0) throw new Error('Type a formula');
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  const startsAtom = (t) => t && (t.type === 'num' || t.type === 'name' || t.type === 'deriv' || (t.type === 'sym' && (t.value === '(' || t.value === '√')));

  const parseExpr = (minPrec) => {
    let left = parsePrefix();
    for (;;) {
      const t = peek();
      let key = t && t.type === 'sym' ? INFIX_BY_SYMBOL[t.value] : null;
      // Side by side means multiply: 2x, 2(a + b). Code says so with *.
      const implicit = !key && startsAtom(t);
      if (implicit && !math) throw new Error(`Use * to multiply by "${t.value}"`);
      if (implicit) key = 'mul';
      if (!key) break;
      const op = OPERATORS[key];
      if (op.prec < minPrec) break;
      if (!implicit) next();
      const right = parseExpr(op.assoc === 'right' ? op.prec : op.prec + 0.5);
      if (op.assoc === 'none' && op.prec === 1 && left.kind === 'op' && left.op.prec === 1 && !left.grouped) {
        throw new Error('Chain comparisons with parentheses');
      }
      // a + b + c is one Addition with three operands.
      if (op.assoc === 'all' && left.kind === 'op' && left.op.key === key && !left.grouped) {
        left = { ...left, children: [...left.children, right] };
      } else {
        left = { kind: 'op', name: op.name, op: { key, ...op }, children: [left, right] };
      }
    }
    return left;
  };

  const opNode = (key, children) => ({ kind: 'op', name: OPERATORS[key].name, op: { key, ...OPERATORS[key] }, children });
  const applyTo = (name, args) => {
    // log_b(x): the Logarithm of x, base b. Code writes the base second,
    // log(x, b), and log(x) alone is the natural logarithm there.
    const base = logBaseOf(name);
    if (base !== null && args.length === 1) {
      return opNode('log', [{ kind: 'leaf', name: base }, args[0]]);
    }
    if (!math && name === 'log' && args.length === 2) return opNode('log', [args[1], args[0]]);
    if (!math && name === 'log' && args.length === 1) return opNode('ln', args);
    // derivative(m, V), integral(f, x, a, b), sum(a_i, i, 1, n), lim(f, n, ∞), differential(Q).
    const typed = TYPED[name];
    if (typed && OPERATORS[typed].notation === 'applied') {
      if (OPERATORS[typed].counts.includes(args.length)) return opNode(typed, args);
      if (name !== 'lim') throw new Error(`${name}() takes ${OPERATORS[typed].counts.join(' or ')} things (${OPERATORS[typed].roles.slice(0, Math.max(...OPERATORS[typed].counts)).join(', ')})`);
    }
    const key = typed && OPERATORS[typed].notation === 'prefix' ? typed : appliedWordKey(name);
    if (key && args.length === 1) return opNode(key, args);
    return { kind: 'fn', name, children: args };
  };

  const parsePrefix = () => {
    const t = next();
    if (!t) throw new Error('Formula ends too soon');
    if (t.type === 'sym' && (t.value === '-' || t.value === '−')) {
      const operand = parseExpr(OPERATORS.neg.prec);
      return { kind: 'op', name: OPERATORS.neg.name, op: { key: 'neg', ...OPERATORS.neg }, children: [operand] };
    }
    if (t.type === 'sym' && t.value === '+') return parseExpr(OPERATORS.neg.prec);
    if (t.type === 'sym' && t.value === '√') {
      const operand = parseExpr(OPERATORS.sqrt.prec);
      return { kind: 'op', name: OPERATORS.sqrt.name, op: { key: 'sqrt', ...OPERATORS.sqrt }, children: [operand] };
    }
    if (t.type === 'sym' && t.value === '(') {
      const inner = parseExpr(0);
      const close = next();
      if (!close || close.value !== ')') throw new Error('Missing )');
      return { ...inner, grouped: true };
    }
    if (t.type === 'num') return { kind: 'leaf', name: t.value };
    if (t.type === 'deriv') {
      // d/dt X: of what follows it, as sin x takes it.
      if (!t.of && !startsAtom(peek())) throw new Error(`${t.value} needs what it is of`);
      let node = t.of ? { kind: 'leaf', name: t.of } : parseExpr(OPERATORS.pow.prec);
      for (let n = 0; n < t.order; n++) node = opNode(t.key, [node, { kind: 'leaf', name: t.wrt }]);
      return node;
    }
    if (t.type === 'sym' && (t.value === '∑' || t.value === '∫' || t.value === '∇')) {
      throw new Error(t.value === '∑' ? 'Write ∑ as sum(f, i, 1, n)' : t.value === '∫' ? 'Write ∫ as integral(f, x, a, b)' : 'Can\'t write ∇ yet');
    }
    if (t.type === 'name') {
      const opensParen = peek() && peek().type === 'sym' && peek().value === '(';
      // In math, a lone letter before parentheses multiplies them (a(b + c)),
      // unless it is a function's letter (f, g, h) or a function's name.
      const calls = opensParen && (!math || t.fn || t.quoted || FUNCTION_LETTERS.has(t.value) || t.value.length > 1);
      if (calls) {
        next();
        const args = [];
        if (!(peek() && peek().value === ')')) {
          for (;;) {
            args.push(parseExpr(0));
            if (peek() && peek().value === ',') { next(); continue; }
            break;
          }
        }
        const close = next();
        if (!close || close.value !== ')') throw new Error('Missing )');
        if (args.length === 0) return { kind: 'leaf', name: `${t.value}()` };
        return applyTo(t.value, args);
      }
      // sin x, sin x^2: in math a function takes what follows it.
      if (math && t.fn && startsAtom(peek())) return applyTo(t.value, [parseExpr(OPERATORS.pow.prec)]);
      if (t.value.startsWith('∂')) throw new Error('Write ∂u/∂t, or partial(u, t)');
      return { kind: 'leaf', name: t.value };
    }
    throw new Error(`Unexpected "${t.value}"`);
  };

  const tree = parseExpr(0);
  if (i < toks.length) throw new Error(`Unexpected "${toks[i].value}"`);
  if (tree.kind === 'leaf') throw new Error('A formula needs an operation');
  return stripGrouped(tree);
}

function stripGrouped(node) {
  const rest = { ...node };
  delete rest.grouped;
  return rest.children ? { ...rest, children: rest.children.map(stripGrouped) } : rest;
}
