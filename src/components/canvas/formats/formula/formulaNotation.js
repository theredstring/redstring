/**
 * Formula notation: the operations a formula is made of, and typed text.
 *
 *   OPERATORS, operatorKeyForName(name)   the vocabulary: "Addition", "+", "plus"...
 *   parseFormulaText("E = m*c^2")         typed text -> an expression tree
 *   needsParens(parent, child, index)     where a line of text needs parentheses
 *
 * How a formula is drawn in Things mode, and read back, is formulaChain.js.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * notation: 'infix' (a + b + c) or 'prefix' (−a, √a).
 * prec: binding strength for parentheses. assoc: how equal-strength children nest.
 * arity: [min, max] operands.
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
  pow: { symbol: '^', name: 'Exponentiation', notation: 'infix', prec: 5, assoc: 'right', arity: [2, 2],
    aliases: ['^', '**', 'power', 'exponent', 'exponentiation', 'to the power of', 'raised to'] },
  sqrt: { symbol: '√', name: 'Square Root', notation: 'prefix', prec: 6, assoc: 'none', arity: [1, 1],
    aliases: ['√', 'sqrt', 'square root'] },
};

/** Function names that read as f(x) without being declared as functions. */
export const KNOWN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'abs', 'max', 'min', 'floor', 'ceil', 'gcd', 'lcm', 'det', 'lim',
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

function precOf(node) {
  if (node.kind === 'op') return node.op.prec;
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

const TOKEN_RE = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_Ͱ-Ͽ⁰-₟][A-Za-z0-9_Ͱ-Ͽ']*)|(<=|>=|!=|==|~=|\*\*|[-+*/^=<>(),×÷·−≠≤≥≈√]))/y;

function tokenize(text) {
  const out = [];
  TOKEN_RE.lastIndex = 0;
  const src = String(text);
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw new Error(`Can't read "${src.slice(pos).trim().slice(0, 12)}"`);
    if (m[1] !== undefined) out.push({ type: 'num', value: m[1] });
    else if (m[2] !== undefined) out.push({ type: 'name', value: m[2] });
    else out.push({ type: 'sym', value: m[3] });
    pos = TOKEN_RE.lastIndex;
  }
  return out;
}

const INFIX_BY_SYMBOL = {
  '=': 'eq', '==': 'eq', '≠': 'ne', '!=': 'ne', '<': 'lt', '>': 'gt', '≤': 'le', '<=': 'le', '≥': 'ge', '>=': 'ge',
  '≈': 'approx', '~=': 'approx', '+': 'add', '-': 'sub', '−': 'sub', '*': 'mul', '×': 'mul', '·': 'mul',
  '/': 'div', '÷': 'div', '^': 'pow', '**': 'pow',
};

/**
 * Parse "E = m * c^2" into a tree of { kind: 'op'|'fn'|'leaf', name, op?, children? }.
 * Throws an Error with a short message when the text isn't a formula.
 */
export function parseFormulaText(text) {
  const toks = tokenize(text);
  if (toks.length === 0) throw new Error('Type a formula');
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  const startsAtom = (t) => t && (t.type === 'num' || t.type === 'name' || (t.type === 'sym' && (t.value === '(' || t.value === '√')));

  const parseExpr = (minPrec) => {
    let left = parsePrefix();
    for (;;) {
      const t = peek();
      let key = t && t.type === 'sym' ? INFIX_BY_SYMBOL[t.value] : null;
      // Side by side means multiply: 2x, 2(a + b).
      const implicit = !key && startsAtom(t);
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
    if (t.type === 'name') {
      if (peek() && peek().type === 'sym' && peek().value === '(') {
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
        const sqrtKey = operatorKeyForName(t.value) === 'sqrt';
        if (sqrtKey && args.length === 1) {
          return { kind: 'op', name: OPERATORS.sqrt.name, op: { key: 'sqrt', ...OPERATORS.sqrt }, children: args };
        }
        if (args.length === 0) return { kind: 'leaf', name: `${t.value}()` };
        return { kind: 'fn', name: t.value, children: args };
      }
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
