/**
 * Formulas as webs of operations (Things mode), and their reading (formula mode).
 *
 * In Things mode a formula is a chain of terms joined by connections, and each
 * connection's defining Thing is the operation:  a —Addition→ b —Multiplication→ c.
 * A term is a Thing, or a Thing-group (a node-group) standing for a part in
 * parentheses: the group's Thing is named after its term, its members are the
 * term's own chain, and connections attach to it. The Thing's type (Is-a) says
 * what the part is: typed Square Root, Negation, sin... it reads as that applied
 * to its contents (√(…), −b, sin(x)); typed anything else (Discriminant), or
 * nothing, it reads as parentheses.
 *
 * The chain reads in arrow order (each connection points from the term before to
 * the term after), or left to right on the canvas without arrows. It is the
 * formula's text already, so precedence works as it does in text: a + b × c
 * means a + (b × c), and a part in parentheses is a Thing-group.
 *
 * One shape in between, built from either side:
 *   Chain = { items: [Term, Op, Term, Op, Term, ...] }
 *   Op    = { kind: 'op', symbol, name, protoId?, edgeId? }
 *   Term  = { kind: 'thing', name, realName?, instanceId?, protoId? }
 *         | { kind: 'part', name, apply: null | 'neg' | 'sqrt' | 'fn', fnName?, args: Chain[],
 *             anchorId?, protoId?, typeName?, typeProtoId? }
 *
 * A Thing is written by its label for formulas when it has one (Pressure as P,
 * `prototype.labels.formula`), else by its name: `name` is what the formula
 * shows, `realName` what the Thing is called.
 *
 *   readFormulaGroup(state, view, group) -> Chain | null    (Things mode -> formula)
 *   chainFromText(text)                  -> Chain           (typed text -> what to build)
 *   tokensOf(chain)                      -> tokens          (formula, token by token)
 *   chainText(chain)                     -> "a + b × c"
 */
import { isGroupInsideGroup } from '../../../../services/groupLayout.js';
import { OPERATORS, operatorKeyForName, parseFormulaText, needsParens, KNOWN_FUNCTIONS, GREEK_NAMES } from './formulaNotation.js';

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** How a Thing is written in a formula: its formula label, else its name. */
export const formulaLabelOf = (proto) => {
  const label = proto?.labels?.formula;
  return typeof label === 'string' && label.trim() ? label.trim() : (proto?.name || '');
};
const OPERATOR_TYPE_NAMES = new Set(['operator', 'operation', 'mathematical operation', 'relation']);
const FUNCTION_TYPE_NAMES = new Set(['function', 'mathematical function']);

/** What a part's type makes it: applied as a sign, a root, a function, or plain parentheses. */
export function applicationOf(typeName, typeTypeName) {
  const key = operatorKeyForName(typeName);
  if (key === 'neg') return { apply: 'neg' };
  if (key === 'sqrt') return { apply: 'sqrt' };
  if (KNOWN_FUNCTIONS.has(norm(typeName)) || FUNCTION_TYPE_NAMES.has(norm(typeTypeName))) {
    return { apply: 'fn', fnName: String(typeName).trim() };
  }
  return { apply: null };
}

/** The operation a connection stands for, or null. */
export function operationOf(edge, state) {
  const defProto = edge.definitionNodeIds?.[0] ? state.nodePrototypes.get(edge.definitionNodeIds[0]) : null;
  const edgeProto = !defProto && edge.typeNodeId && edge.typeNodeId !== 'base-connection-prototype'
    ? state.edgePrototypes?.get(edge.typeNodeId) : null;
  const named = defProto || edgeProto;
  const name = named?.name || edge.name || '';
  const key = operatorKeyForName(name);
  if (key) {
    const op = OPERATORS[key];
    if (op.notation !== 'infix') return null;
    return { kind: 'op', key, symbol: op.symbol, name: op.name, protoId: defProto?.id || null, edgeId: edge.id };
  }
  const typeName = defProto?.typeNodeId ? state.nodePrototypes.get(defProto.typeNodeId)?.name : '';
  if (defProto && OPERATOR_TYPE_NAMES.has(norm(typeName))) {
    return { kind: 'op', key: 'custom', symbol: defProto.name.trim(), name: defProto.name, protoId: defProto.id, edgeId: edge.id };
  }
  return null;
}

function compareScores(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ---------------------------------------------------------------------------
// Things mode -> Chain
// ---------------------------------------------------------------------------

/**
 * Read a group (or any { memberInstanceIds }) of the viewed web as a formula.
 * @returns {Chain|null} null unless every Thing in it takes part in one formula.
 */
export function readFormulaGroup(state, view, group) {
  const groups = view.groups ? [...view.groups.values()] : [];
  const edges = [];
  for (const edgeId of view.edgeIds || []) {
    const e = view.openView?.edges?.get(edgeId) || state.edges.get(edgeId);
    if (e) edges.push(e);
  }
  let operations = 0;
  const readContent = (container, isPart) => {
    const memberSet = new Set((container.memberInstanceIds || []).filter(id => view.instances.has(id)));
    if (memberSet.size === 0) return null;
    // Parts directly inside: inside this container, and not inside another part of it.
    const inside = groups.filter(g => g.id !== container.id && isGroupInsideGroup(g, container, memberSet));
    if (inside.some(g => !g.linkedNodePrototypeId || !g.anchorInstanceId)) return null; // only Thing-groups nest
    const direct = inside.filter(g => !inside.some(o => o !== g && isGroupInsideGroup(g, o)));
    // Everything inside a part belongs to that part (deeper parts' anchors too);
    // a direct part stands here by its own anchor.
    const covered = new Set();
    for (const g of inside) {
      (g.memberInstanceIds || []).forEach(id => covered.add(id));
      if (!direct.includes(g)) covered.add(g.anchorInstanceId);
    }
    // Terms: the Things not inside a part, and each direct part by its anchor.
    const terms = new Map();
    for (const id of memberSet) {
      if (covered.has(id)) continue;
      const inst = view.instances.get(id);
      if (inst.isGroupAnchor) {
        const part = direct.find(g => g.anchorInstanceId === id);
        if (!part) return null;
        continue;
      }
      const proto = state.nodePrototypes.get(inst.prototypeId);
      if (!proto) return null;
      terms.set(id, { kind: 'thing', name: formulaLabelOf(proto), realName: proto.name, instanceId: id, protoId: proto.id, x: inst.x, y: inst.y });
    }
    for (const g of direct) {
      const term = readPart(g);
      if (!term) return null;
      terms.set(g.anchorInstanceId, term);
    }
    if (terms.size === 0) return null;

    // Connections among the terms: all of them operations, chaining the terms.
    const links = new Map([...terms.keys()].map(id => [id, []]));
    for (const e of edges) {
      const a = terms.has(e.sourceId);
      const b = terms.has(e.destinationId);
      if (!a && !b) continue;
      if (!(a && b)) {
        // One end here, the other inside a part: a part is reached by its Thing.
        if (memberSet.has(e.sourceId) && memberSet.has(e.destinationId)) return null;
        continue; // the other end is outside the formula
      }
      const op = operationOf(e, state);
      if (!op) return null;
      const arrows = e.directionality?.arrowsToward instanceof Set
        ? e.directionality.arrowsToward : new Set(e.directionality?.arrowsToward || []);
      links.get(e.sourceId).push({ to: e.destinationId, op, forward: arrows.has(e.destinationId) && !arrows.has(e.sourceId), back: arrows.has(e.sourceId) && !arrows.has(e.destinationId) });
      links.get(e.destinationId).push({ to: e.sourceId, op, forward: arrows.has(e.sourceId) && !arrows.has(e.destinationId), back: arrows.has(e.destinationId) && !arrows.has(e.sourceId) });
    }

    // Components: each a simple path. A part may hold several (its arguments).
    const seen = new Set();
    const chains = [];
    for (const start of terms.keys()) {
      if (seen.has(start)) continue;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const id = stack.pop();
        comp.push(id);
        for (const l of links.get(id)) if (!seen.has(l.to)) { seen.add(l.to); stack.push(l.to); }
      }
      if (comp.some(id => links.get(id).length > 2)) return null;
      const linkCount = comp.reduce((n, id) => n + links.get(id).length, 0) / 2;
      if (linkCount !== comp.length - 1) return null;
      // Read from the end the arrows point away from; without arrows, the leftmost.
      const walk = (from) => {
        const items = [terms.get(from)];
        let agree = 0;
        let prev = null;
        let at = from;
        for (;;) {
          const next = links.get(at).find(l => l.to !== prev);
          if (!next) break;
          if (next.forward) agree++; else if (next.back) agree--;
          items.push(next.op, terms.get(next.to));
          prev = at;
          at = next.to;
        }
        return { items, agree };
      };
      const placeOf = (id) => view.instances.get(id);
      let best = null;
      for (const end of comp.filter(id => links.get(id).length <= 1)) {
        const w = walk(end);
        const score = [w.agree, -(placeOf(end)?.x ?? 0), -(placeOf(end)?.y ?? 0)];
        if (!best || compareScores(score, best.score) > 0) best = { items: w.items, score, x: placeOf(end)?.x ?? 0 };
      }
      operations += (best.items.length - 1) / 2;
      chains.push({ items: best.items, x: best.x });
    }
    chains.sort((a, b) => a.x - b.x);
    if (!isPart && chains.length !== 1) return null;
    return chains.map(c => ({ items: c.items }));
  };

  const readPart = (g) => {
    const anchor = view.instances.get(g.anchorInstanceId);
    const proto = anchor ? state.nodePrototypes.get(anchor.prototypeId) : null;
    if (!proto) return null;
    const type = proto.typeNodeId ? state.nodePrototypes.get(proto.typeNodeId) : null;
    const typeType = type?.typeNodeId ? state.nodePrototypes.get(type.typeNodeId) : null;
    const { apply, fnName } = applicationOf(type?.name, typeType?.name);
    const args = readContent(g, true);
    if (!args) return null;
    if (apply !== 'fn' && args.length !== 1) return null;
    if (apply) operations++; // an applied part is an operation of its own
    return {
      kind: 'part', name: proto.name, apply, fnName, args,
      anchorId: g.anchorInstanceId, protoId: proto.id, typeName: type?.name || null, typeProtoId: type?.id || null,
    };
  };

  const top = readContent(group, false);
  if (!top || operations === 0) return null;
  return top[0];
}

// ---------------------------------------------------------------------------
// Text -> Chain (what New Formula builds)
// ---------------------------------------------------------------------------

/**
 * Parse typed text into the chain to build. Options as parseFormulaText
 * ({ convention: 'math' | 'programming', isKnownName }). Throws a short message
 * when it isn't a formula.
 */
export function chainFromText(text, options) {
  return chainOfNode(parseFormulaText(text, options));
}

const opItem = (key) => ({ kind: 'op', key, symbol: OPERATORS[key].symbol, name: OPERATORS[key].name });

function termOfNode(node, parent, index) {
  if (node.kind === 'leaf') return { kind: 'thing', name: String(node.name) };
  if (node.kind === 'fn') {
    const args = node.children.map(chainOfNode);
    const part = { kind: 'part', apply: 'fn', fnName: node.name, typeName: node.name, args };
    return { ...part, name: chainText({ items: [part] }) };
  }
  if (node.op.notation === 'prefix') {
    const part = { kind: 'part', apply: node.op.key, typeName: node.op.name, args: [chainOfNode(node.children[0])] };
    return { ...part, name: chainText({ items: [part] }) };
  }
  // An operation as an operand: inline when precedence already groups it, else a part.
  if (parent && !needsParens(parent, node, index)) return null;
  const part = { kind: 'part', apply: null, args: [chainOfNode(node)] };
  return { ...part, name: chainText(part.args[0]) };
}

function chainOfNode(node) {
  if (node.kind !== 'op' || node.op.notation !== 'infix') return { items: [termOfNode(node, null, 0)] };
  const items = [];
  node.children.forEach((child, i) => {
    if (i > 0) items.push(opItem(node.op.key));
    const term = termOfNode(child, node, i);
    if (term) items.push(term);
    else items.push(...chainOfNode(child).items); // same reading inline
  });
  return { items };
}

// ---------------------------------------------------------------------------
// Chain -> tokens, text
// ---------------------------------------------------------------------------

const termCount = (chain) => (chain.items.length + 1) / 2;

const GREEK_LETTERS = /^[\u0370-\u03FF]$/;
const isNumberTerm = (t) => t?.kind === 'thing' && /^\d+(\.\d+)?$/.test(t.name);
// A variable written the textbook way: one letter (x, θ), a letter with its index (x1, v_0), or a Greek name (theta).
// A change in one (ΔT, Δx) is written like one.
export const isSymbolText = (text) => /^[A-Za-z\u0370-\u03FF][0-9]*'*$/.test(text) || /^[A-Za-z\u0370-\u03FF]_[A-Za-z0-9]+$/.test(text)
  || GREEK_LETTERS.test(text) || GREEK_NAMES.has(text) || (text.length > 1 && text.startsWith('Δ') && isSymbolText(text.slice(1)));
const isGroupedTerm = (t) => t?.kind === 'part' && t.apply !== 'neg';
const compact = (s) => String(s ?? '').replace(/\s+/g, '');

/** Whether a part's Thing has a name of its own ("Discriminant"), not just its term's text ("b ^ 2 − 4 × a × c"). */
export function partIsNamed(part) {
  if (!part?.name) return false;
  const own = compact(part.name);
  return own !== compact(chainText({ items: [part] })) && own !== compact(chainText(part.args[0]));
}

/** A symbol with a subscript (v_0, T_c, log_2): [base, subscript], else null. */
export function subscriptOf(text) {
  const m = /^([^_\s]+)_([^_\s]+)$/.exec(String(text || ''));
  return m ? [m[1], m[2]] : null;
}

/** Whether a token's Thing means more than what is written (Pressure behind P, Addition behind +). */
const means = (realName, text) => !!realName && norm(realName) !== norm(text);

/**
 * The formula token by token. Each token:
 * { key (stable while the formula is the same: what it stands for, not where it is),
 *   text, kind: 'operand'|'operator'|'paren'|'function'|'comma',
 *   target (what it stands for: an instance id, or `edge:<id>` for an operation),
 *   protoId (the Thing it shows), realName (that Thing's name),
 *   defined (its Thing means more than what is written: Pressure behind P),
 *   flip (what switches it between its symbol and its name, when it is defined),
 *   expanded? (written by its name), prefix?, level (how many times it is raised),
 *   joined? (written right against the token before: multiplied side by side) }
 *
 * With `standard`, it is written the way math usually is: exponentiation with
 * no ^, the exponent raised a level (a plain part as an exponent losing its
 * parentheses, since the raise already groups it; a ^ b ^ c raising twice, which
 * is how ^ groups), and multiplication unwritten between a number or a letter and
 * the letter or part after it (mc², 4ac, 2(a + b)). Between whole-word names, or
 * before a number, the × stays.
 *
 * `expand(flip, kind)` says which defined tokens are written by name instead
 * ('operand', 'operator', 'apply' for a sign, root or function, 'part' for a
 * named part, which is then written as its name alone: Discriminant).
 */
export function tokensOf(chain, { standard = false, expand = null, plain = false } = {}) {
  const expanded = (flip, kind) => !plain && !!expand && !!flip && expand(flip, kind);
  const operandShown = (term) => !!term.protoId && means(term.realName, term.name) && expanded(term.instanceId, 'operand');
  const partShown = (term) => term.kind === 'part' && !plain && !!term.protoId && !!term.anchorId
    && partIsNamed(term) && expanded(term.anchorId, 'part');
  const isLetterTerm = (t) => t?.kind === 'thing' && !operandShown(t) && isSymbolText(t.name);
  const isGrouped = (t) => isGroupedTerm(t) && !partShown(t);
  /** Whether multiplication between these two terms goes unwritten in standard notation (2a, mc, 4ac, 2(a + b)). */
  const multipliesSideBySide = (left, right) => {
    if (!left || !right || isNumberTerm(right)) return false;
    if (!(isLetterTerm(right) || isGrouped(right))) return false;
    return isNumberTerm(left) || isLetterTerm(left) || isGrouped(left);
  };
  const tokens = [];
  const seen = new Map();
  let k = 0;
  let joinNext = false;
  const push = (t, level) => {
    // Keyed by what it stands for, so it keeps its key when the tokens around it change.
    const role = t.kind === 'paren' ? t.text : t.kind === 'comma' ? ',' : t.kind;
    const base = t.target ? `${t.target}|${role}` : `n${k}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    k++;
    tokens.push({ key: n ? `${base}#${n}` : base, level, ...t, ...(joinNext ? { joined: true } : {}) });
    joinNext = false;
  };
  const emitChain = (c, level) => {
    let termLevel = level;
    c.items.forEach((item, idx) => {
      if (item.kind === 'op') {
        if (standard && item.key === 'pow') { termLevel += 1; return; }
        termLevel = level;
        if (standard && item.key === 'mul' && multipliesSideBySide(c.items[idx - 1], c.items[idx + 1])) {
          joinNext = true;
          return;
        }
        const target = item.edgeId ? `edge:${item.edgeId}` : null;
        // The standard operations (+, =, ×...) mean the same everywhere: only
        // an operation of one's own has more to show.
        const defined = item.key === 'custom' && !!item.protoId && means(item.name, item.symbol);
        const named = defined && expanded(target, 'operator');
        push({
          text: named ? item.name : item.symbol, kind: 'operator', target, protoId: item.protoId || null,
          realName: item.name, defined, flip: defined ? target : null, ...(named ? { expanded: true } : {}),
        }, level);
      } else emitTerm(item, termLevel, termLevel > level);
    });
  };
  const emitTerm = (term, level, isExponent) => {
    if (term.kind === 'thing') {
      const defined = !!term.protoId && means(term.realName, term.name);
      const named = operandShown(term);
      push({
        text: named ? term.realName : term.name, kind: 'operand', target: term.instanceId || null, protoId: term.protoId || null,
        realName: term.realName || null, defined, flip: defined ? term.instanceId : null, ...(named ? { expanded: true } : {}),
      }, level);
      return;
    }
    const partDefined = !plain && !!term.protoId && partIsNamed(term);
    const own = { target: term.anchorId || null, protoId: term.protoId || null, realName: term.name, defined: partDefined, flip: partDefined ? term.anchorId : null };
    if (partShown(term)) {
      // A named part, written as its name: the chunk it is (Discriminant).
      push({ text: term.name, kind: 'operand', ...own, expanded: true }, level);
      return;
    }
    // A sign, root or function name stands for what is applied: the part's type
    // (Square Root, sin). A sign or a root is standard, as the operations are.
    const applied = (text) => {
      const defined = term.apply === 'fn' && !!term.typeProtoId && means(term.typeName, text);
      const flip = defined && term.anchorId ? `apply:${term.anchorId}` : null;
      const named = defined && expanded(flip, 'apply');
      return {
        text: named ? term.typeName : text,
        target: term.anchorId || null, protoId: term.typeProtoId || term.protoId || null,
        realName: term.typeName || null, defined, flip, ...(named ? { expanded: true } : {}),
      };
    };
    if (term.apply === 'neg' || term.apply === 'sqrt') {
      const inner = term.args[0];
      const sign = term.apply === 'neg' ? '−' : '√';
      push({ kind: 'operator', prefix: true, ...applied(sign) }, level);
      const wrap = termCount(inner) > 1;
      if (wrap) push({ text: '(', kind: 'paren', ...own }, level);
      emitChain(inner, level);
      if (wrap) push({ text: ')', kind: 'paren', ...own }, level);
      return;
    }
    if (term.apply === 'fn') {
      push({ kind: 'function', ...applied(term.fnName) }, level);
      push({ text: '(', kind: 'paren', ...own }, level);
      term.args.forEach((a, i) => {
        if (i > 0) push({ text: ',', kind: 'comma', ...own }, level);
        emitChain(a, level);
      });
      push({ text: ')', kind: 'paren', ...own }, level);
      return;
    }
    if (isExponent) { emitChain(term.args[0], level); return; }
    push({ text: '(', kind: 'paren', ...own }, level);
    emitChain(term.args[0], level);
    push({ text: ')', kind: 'paren', ...own }, level);
  };
  emitChain(chain, 0);
  return tokens;
}

/**
 * What a formula's display state expands: every defined operand while its
 * names are shown, and whatever was switched on its own (switching one back
 * while names are shown writes that one by its symbol again).
 */
export function expandFor(namesShown, flipped) {
  if (!namesShown && !flipped?.size) return null;
  return (flip, kind) => ((namesShown && kind === 'operand') !== !!flipped?.has(flip));
}

/** The formula as one line of plain text. */
export function chainText(chain) {
  let out = '';
  for (const t of tokensOf(chain, { plain: true })) {
    if (t.kind === 'operator' && !t.prefix) out += ` ${t.text} `;
    else if (t.kind === 'comma') out += ', ';
    else out += t.text;
  }
  return out.replace(/\s+/g, ' ').trim();
}
