/**
 * Formula notation: how a piece of a web reads as a formula, and back.
 *
 * A formula is an expression tree drawn with ordinary Things and connections.
 * An operator is a Thing ("Addition", "+", "Equals") connected to its operands;
 * an operand is any Thing, or another operator, which is how formulas nest.
 * Nothing new is saved: the formula is read off what the web already holds.
 *
 *   readFormula(slice)        web slice   -> tree, or null when it isn't one
 *   linearize(tree)           tree        -> tokens (the formula as text, token by token)
 *   parseFormulaText(text)    "E = m*c^2" -> tree
 *   formulaToText(tree)       tree        -> "E = m × c^2"
 *
 * Operand order comes from the connection's name when it names a side ("left",
 * "base", "numerator"...), otherwise from where the operands sit, left to right.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * notation: 'infix' (a + b + c), 'prefix' (−a), 'sup' (a raised to b), 'fn' (sin(a)).
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
  pow: { symbol: '^', name: 'Exponentiation', notation: 'sup', prec: 5, assoc: 'right', arity: [2, 2],
    aliases: ['^', '**', 'power', 'exponent', 'exponentiation', 'to the power of', 'raised to'] },
  sqrt: { symbol: '√', name: 'Square Root', notation: 'prefix', prec: 6, assoc: 'none', arity: [1, 1],
    aliases: ['√', 'sqrt', 'square root'] },
};

/** Function names that read as f(x) without being declared as functions. */
const KNOWN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'abs', 'max', 'min', 'floor', 'ceil', 'gcd', 'lcm', 'det', 'lim',
]);

/** A Thing typed (Is-a) as one of these reads as an operator of its own name. */
const OPERATOR_TYPE_NAMES = new Set(['operator', 'operation', 'mathematical operation', 'relation']);
const FUNCTION_TYPE_NAMES = new Set(['function', 'mathematical function']);

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

// Connection names that say which side an operand is on.
const FIRST_ROLES = new Set(['left', 'lhs', 'first', '1', '1st', 'base', 'numerator', 'dividend', 'minuend', 'a']);
const SECOND_ROLES = new Set(['right', 'rhs', 'second', '2', '2nd', 'exponent', 'power', 'denominator', 'divisor', 'subtrahend', 'b']);

function roleRank(role) {
  const r = norm(role);
  if (!r) return null;
  if (FIRST_ROLES.has(r)) return 0;
  if (SECOND_ROLES.has(r)) return 1;
  const m = r.match(/^(?:arg(?:ument)?|operand|term|factor)?\s*(\d+)$/);
  return m ? Number(m[1]) - 1 : null;
}

// ---------------------------------------------------------------------------
// Reading a formula off the web
// ---------------------------------------------------------------------------

/**
 * Read a formula from a slice of a web.
 *
 * @param {Object} slice
 * @param {Array<{id, name, x, y, typeName?}>} slice.nodes - the Things in the candidate, with
 *   their prototype's name and (optionally) the name of the prototype that types them.
 * @param {Array<{id, sourceId, destinationId, arrowsToward?: Iterable<string>, role?: string}>} slice.edges
 *   - the connections among them; `role` is the connection's name, if it has one.
 * @returns {Object|null} the tree, or null when the slice is not exactly one formula.
 */
export function readFormula({ nodes, edges }) {
  if (!Array.isArray(nodes) || nodes.length < 2) return null;
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (byId.size !== nodes.length) return null;

  const adj = new Map(nodes.map(n => [n.id, []]));
  const seenPairs = new Set();
  for (const e of edges || []) {
    if (!byId.has(e.sourceId) || !byId.has(e.destinationId) || e.sourceId === e.destinationId) return null;
    const pair = e.sourceId < e.destinationId ? `${e.sourceId}|${e.destinationId}` : `${e.destinationId}|${e.sourceId}`;
    if (seenPairs.has(pair)) return null;
    seenPairs.add(pair);
    const arrows = new Set(e.arrowsToward || []);
    adj.get(e.sourceId).push({ other: e.destinationId, edge: e, arrows });
    adj.get(e.destinationId).push({ other: e.sourceId, edge: e, arrows });
  }

  // One tree: connected, no cycles.
  if (seenPairs.size !== nodes.length - 1) return null;
  const reach = new Set([nodes[0].id]);
  const stack = [nodes[0].id];
  while (stack.length) {
    for (const { other } of adj.get(stack.pop())) {
      if (!reach.has(other)) { reach.add(other); stack.push(other); }
    }
  }
  if (reach.size !== nodes.length) return null;

  const kindOf = new Map(nodes.map(n => [n.id, classify(n)]));
  if (![...kindOf.values()].some(k => k.op)) return null;

  // Try every operator as the root; keep the readings that work, then pick the
  // one the arrows agree with most (either convention: operator -> operand, or
  // operands flowing into their operator), then the loosest operator (an
  // equation reads from its "="), then the topmost Thing (trees grow downward).
  let best = null;
  for (const root of nodes) {
    if (!kindOf.get(root.id).op && !kindOf.get(root.id).fn) continue;
    const reading = orient(root.id, adj, byId, kindOf);
    if (!reading) continue;
    const score = [
      Math.abs(reading.agree - reading.disagree),
      -(kindOf.get(root.id).op?.prec ?? 9),
      -(root.y ?? 0),
    ];
    if (!best || compareScores(score, best.score) > 0) best = { tree: reading.tree, score };
  }
  return best ? best.tree : null;
}

function compareScores(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function classify(node) {
  const key = operatorKeyForName(node.name);
  if (key) return { op: { key, ...OPERATORS[key] } };
  const typeName = norm(node.typeName);
  if (OPERATOR_TYPE_NAMES.has(typeName)) {
    return { op: { key: 'custom', symbol: String(node.name).trim(), name: node.name, notation: 'infix', prec: 2.5, assoc: 'none', arity: [2, Infinity] } };
  }
  if (FUNCTION_TYPE_NAMES.has(typeName) || KNOWN_FUNCTIONS.has(norm(node.name))) return { fn: true };
  return {};
}

function orient(rootId, adj, byId, kindOf) {
  let agree = 0;
  let disagree = 0;
  const build = (id, parentId) => {
    const node = byId.get(id);
    const kind = kindOf.get(id);
    const links = adj.get(id).filter(l => l.other !== parentId);
    // Order operands: named sides first, then left to right on the canvas.
    const ordered = links
      .map(l => ({ ...l, rank: roleRank(l.edge.role) }))
      .sort((a, b) => {
        if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
        if (a.rank !== null && b.rank === null) return -1;
        if (a.rank === null && b.rank !== null) return 1;
        const na = byId.get(a.other);
        const nb = byId.get(b.other);
        return (na.x - nb.x) || (na.y - nb.y);
      });
    for (const l of ordered) {
      if (l.arrows.has(l.other) && !l.arrows.has(id)) agree++;
      else if (l.arrows.has(id) && !l.arrows.has(l.other)) disagree++;
    }
    const children = [];
    for (const l of ordered) {
      const child = build(l.other, id);
      if (!child) return null;
      children.push(child);
    }
    if (kind.op) {
      let op = kind.op;
      // "Minus" with one operand is negation.
      if (op.key === 'sub' && children.length === 1) op = { key: 'neg', ...OPERATORS.neg };
      if (children.length < op.arity[0] || children.length > op.arity[1]) return null;
      return { kind: 'op', id, name: node.name, op, children };
    }
    if (children.length > 0) return { kind: 'fn', id, name: node.name, children };
    return { kind: 'leaf', id, name: node.name };
  };
  const tree = build(rootId, null);
  return tree ? { tree, agree, disagree } : null;
}

// ---------------------------------------------------------------------------
// Writing a formula out, token by token
// ---------------------------------------------------------------------------

/**
 * The formula as tokens, in reading order.
 *
 * Each token: { key, text, kind: 'operand'|'operator'|'function'|'paren'|'comma',
 * nodeId (the Thing it shows, for operands/operators/functions), ownerId (the
 * operator or function a paren or comma belongs to), level (superscript depth) }.
 *
 * `spans` maps every tree node id to [first, last] token index of its whole
 * subexpression, which is contiguous in reading order.
 */
export function linearize(tree) {
  const tokens = [];
  const spans = new Map();
  let k = 0;
  const push = (t) => { tokens.push({ key: `t${k++}`, ...t }); return tokens.length - 1; };

  const emit = (node, level, parentWraps) => {
    const start = tokens.length;
    const wrap = parentWraps;
    if (wrap) push({ text: '(', kind: 'paren', ownerId: node.id, level });

    if (node.kind === 'leaf') {
      push({ text: String(node.name), kind: 'operand', nodeId: node.id, level, numeric: isNumeric(node.name) });
    } else if (node.kind === 'fn') {
      push({ text: String(node.name), kind: 'function', nodeId: node.id, level });
      push({ text: '(', kind: 'paren', ownerId: node.id, level });
      node.children.forEach((c, i) => {
        if (i > 0) push({ text: ',', kind: 'comma', ownerId: node.id, level });
        emit(c, level, false);
      });
      push({ text: ')', kind: 'paren', ownerId: node.id, level });
    } else {
      const { op } = node;
      if (op.notation === 'prefix') {
        push({ text: op.symbol, kind: 'operator', nodeId: node.id, level, prefix: true });
        const c = node.children[0];
        emit(c, level, needsParens(node, c, 0) || (op.key === 'sqrt' && c.kind === 'op'));
      } else if (op.notation === 'sup') {
        const [base, exp] = node.children;
        emit(base, level, needsParens(node, base, 0));
        // The exponent's raise is the operator's token; it carries no glyph of its own.
        push({ text: '', kind: 'operator', nodeId: node.id, level, raise: true });
        emit(exp, level + 1, false);
      } else {
        node.children.forEach((c, i) => {
          if (i > 0) push({ text: op.symbol, kind: 'operator', nodeId: node.id, level });
          emit(c, level, needsParens(node, c, i));
        });
      }
    }

    if (wrap) push({ text: ')', kind: 'paren', ownerId: node.id, level });
    spans.set(node.id, [start, tokens.length - 1]);
  };

  emit(tree, 0, false);
  return { tokens, spans };
}

function precOf(node) {
  if (node.kind === 'op') return node.op.prec;
  return 10; // leaves and f(x) bind tightest
}

function needsParens(parent, child, index) {
  if (child.kind !== 'op') return false;
  const pp = parent.op.prec;
  const cp = precOf(child);
  if (parent.op.notation === 'sup' && index === 1) return false; // the raise groups the exponent
  if (cp < pp) return true;
  if (cp > pp) return false;
  // Equal strength.
  if (parent.op.assoc === 'all' && child.op.key === parent.op.key) return false;
  if (parent.op.assoc === 'left') return index > 0;
  if (parent.op.assoc === 'right') return index === 0;
  if (parent.op.assoc === 'all') return index > 0;
  return true;
}

const isNumeric = (s) => /^\s*-?\d+(\.\d+)?\s*$/.test(String(s));

/** The formula as one line of plain text, with ^ for raises. */
export function formulaToText(tree) {
  const text = (node, wrap) => {
    let out;
    if (node.kind === 'leaf') out = String(node.name);
    else if (node.kind === 'fn') out = `${node.name}(${node.children.map(c => text(c, false)).join(', ')})`;
    else {
      const { op } = node;
      if (op.notation === 'prefix') {
        const c = node.children[0];
        out = op.symbol + text(c, needsParens(node, c, 0) || (op.key === 'sqrt' && c.kind === 'op'));
      } else if (op.notation === 'sup') {
        const [base, exp] = node.children;
        // Raises group to the right, so a raised raise or a sign needs no parentheses.
        const bare = exp.kind !== 'op' || exp.op.key === 'pow' || exp.op.notation === 'prefix';
        out = `${text(base, needsParens(node, base, 0))}^${text(exp, !bare)}`;
      } else {
        out = node.children.map((c, i) => text(c, needsParens(node, c, i))).join(` ${op.symbol} `);
      }
    }
    return wrap ? `(${out})` : out;
  };
  return text(tree, false);
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

/** Every node of a tree, root first. */
export function walkFormula(tree, visit, depth = 0, parent = null, index = 0) {
  visit(tree, depth, parent, index);
  (tree.children || []).forEach((c, i) => walkFormula(c, visit, depth + 1, tree, i));
}
