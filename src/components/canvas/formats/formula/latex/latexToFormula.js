/**
 * LaTeX in, formula text out: the subset a formula from Wikidata (or a paper)
 * is written in, turned into the text New Formula reads (formulaNotation.js,
 * convention 'math'), and each of its symbols into the name it is written by
 * there.
 *
 *   latexToFormula('F = G {m_1 m_2 \\over r^2}')  -> 'F = G * ((m_1 * m_2) / (r ^ 2))'
 *   latexSymbolName('m_{\\mathrm f}')               -> 'm_f'
 *
 * What it reads: numbers; letters and Greek letters, with subscripts (v_0,
 * E_{\mathrm H}) and primes; + − ± (refused) × · ÷ / and side by side;
 * = ≠ < > ≤ ≥ ≈; powers; \frac, \over, \sqrt; parentheses and brackets,
 * \left and \right; sin, cos, ln, log with or without a base, exp and the
 * other functions formulas know; spacing and \displaystyle, which change
 * nothing.
 *
 * What it refuses, with a reason it says: sums, integrals, derivatives and
 * differentials, limits, vectors and other accented letters, sets, logic,
 * matrices, units, ± — what the formula notation can't write yet. A refusal
 * is an Error whose message names what was missing ("\\int").
 */
import { KNOWN_FUNCTIONS } from '../formulaNotation.js';

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

// Commands that change nothing a formula means.
const IGNORED = new Set([
  'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', ',', ';', ':', '!', ' ', 'quad', 'qquad',
  'left', 'right', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'big', 'Big', 'mathit', 'mathnormal',
]);
const TIMES = new Set(['cdot', 'times', 'ast']);
const RELATIONS = {
  '=': '=', ne: '!=', neq: '!=', lt: '<', gt: '>', le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=',
  geqslant: '>=', approx: '~=',
};
const RELATION_OPS = new Set(Object.values(RELATIONS));
// Upright text inside these is a name or a subscript, not letters side by side.
const TEXT_FONTS = new Set(['mathrm', 'text', 'textrm', 'rm', 'operatorname', 'mathsf', 'textit', 'mathit']);
// Refused, by what they are.
const REFUSED = {
  sum: 'sums', prod: 'products', int: 'integrals', iint: 'integrals', iiint: 'integrals', oint: 'integrals',
  partial: 'derivatives', nabla: 'derivatives', lim: 'limits', infty: 'infinity',
  boldsymbol: 'vectors', vec: 'vectors', mathbf: 'vectors', bm: 'vectors',
  hat: 'accents', tilde: 'accents', bar: 'accents', dot: 'accents', ddot: 'accents', overline: 'accents',
  widehat: 'accents', widetilde: 'accents', underline: 'accents',
  in: 'sets', notin: 'sets', subset: 'sets', subseteq: 'sets', cup: 'sets', cap: 'sets', setminus: 'sets',
  mathbb: 'sets', emptyset: 'sets', mathcal: 'sets', mathfrak: 'sets',
  forall: 'logic', exists: 'logic', land: 'logic', lor: 'logic', neg: 'logic', implies: 'logic', iff: 'logic',
  wedge: 'logic', vee: 'logic', to: 'arrows', mapsto: 'arrows', rightarrow: 'arrows', Rightarrow: 'arrows',
  begin: 'matrices', pm: '±', mp: '±', mid: 'conditions', colon: 'conditions', langle: 'brackets', rangle: 'brackets',
  otimes: 'products', oplus: 'sums', circ: 'composition', ldots: 'ellipses', dots: 'ellipses', cdots: 'ellipses',
  dotsc: 'ellipses', binom: 'binomials', choose: 'binomials', equiv: 'congruence', propto: 'proportionality',
  sim: 'proportionality', perp: 'geometry', parallel: 'geometry', angle: 'geometry', prime: 'derivatives',
};

function tokenize(tex) {
  const out = [];
  const s = String(tex);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
      if (!m) throw new Error('a lone \\');
      out.push({ cmd: m[1] });
      i += m[0].length;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(i)) || /^[0-9]+/.exec(s.slice(i));
      // 648\,000 and 648{,}000: one number, its thousands set apart.
      const prev = out[out.length - 1];
      if (prev?.num && prev.joinable) prev.num += m[0];
      else out.push({ num: m[0] });
      i += m[0].length;
      const sep = /^(\\,|\{,\})(?=[0-9])/.exec(s.slice(i));
      if (sep) { out[out.length - 1].joinable = true; i += sep[0].length; } else delete out[out.length - 1].joinable;
      continue;
    }
    if (/[A-Za-z]/.test(c)) { out.push({ letter: c }); i++; continue; }
    out.push({ sym: c });
    i++;
  }
  return out;
}

/**
 * A parser over LaTeX tokens, producing a tree:
 * { t: 'num'|'name', v } | { t: 'op', op: '+'|'-'|'*'|'/'|'^'|rel, a, b } |
 * { t: 'neg', a } | { t: 'sqrt', a } | { t: 'fn', name, a } | { t: 'log', base, a }
 */
function parser(tex) {
  const toks = tokenize(tex);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const isCmd = (t, ...names) => !!t?.cmd && names.includes(t.cmd);
  const isSym = (t, ...syms) => !!t?.sym && syms.includes(t.sym);
  const skipIgnored = () => { while (peek()?.cmd && IGNORED.has(peek().cmd)) next(); };
  const refuseIf = (t) => {
    if (t?.cmd && REFUSED[t.cmd]) throw new Error(`can't write ${REFUSED[t.cmd]} (\\${t.cmd})`);
  };

  /** Upright text in braces, or one letter: \mathrm{max} -> 'max', \rm g -> 'g'. */
  const readText = () => {
    skipIgnored();
    const t = next();
    if (!t) throw new Error('text ends too soon');
    if (isSym(t, '{')) {
      let text = '';
      let depth = 1;
      while (peek()) {
        const u = next();
        if (isSym(u, '{')) { depth++; continue; }
        if (isSym(u, '}')) { if (--depth === 0) return text; continue; }
        if (u.cmd && IGNORED.has(u.cmd)) continue;
        if (u.cmd && TEXT_FONTS.has(u.cmd)) continue;
        if (u.cmd && GREEK[u.cmd]) { text += GREEK[u.cmd]; continue; }
        if (u.cmd) throw new Error(`can't read \\${u.cmd} in a name`);
        text += u.letter ?? u.num ?? u.sym;
      }
      throw new Error('missing }');
    }
    if (t.letter || t.num) return t.letter ?? t.num;
    if (t.cmd && GREEK[t.cmd]) return GREEK[t.cmd];
    throw new Error('expected text');
  };

  /** A subscript as part of a name: _0, _{\mathrm{H}}, _{\rm g}, _{i,j}. */
  const readSubscript = () => {
    skipIgnored();
    const t = peek();
    if (isSym(t, '{')) {
      next();
      let text = '';
      let depth = 1;
      while (peek()) {
        const u = next();
        if (isSym(u, '{')) { depth++; continue; }
        if (isSym(u, '}')) { if (--depth === 0) break; continue; }
        if (u.cmd && (IGNORED.has(u.cmd) || TEXT_FONTS.has(u.cmd))) continue;
        if (u.cmd && GREEK[u.cmd]) { text += GREEK[u.cmd]; continue; }
        refuseIf(u);
        if (u.cmd) throw new Error(`can't read \\${u.cmd} in a subscript`);
        text += u.letter ?? u.num ?? u.sym;
      }
      if (!text) throw new Error('an empty subscript');
      return text;
    }
    if (t?.cmd && TEXT_FONTS.has(t.cmd)) { next(); return readText(); }
    return readText();
  };

  /** A letter (or Greek letter, or upright name) with its subscripts and primes. */
  const readName = (base) => {
    let name = base;
    // ΔU, Δx: a change in a symbol is written as one.
    if (base === 'Δ') {
      skipIgnored();
      const t = peek();
      if (t?.letter) { next(); name = `Δ${t.letter}`; } else if (t?.cmd && GREEK[t.cmd]) { next(); name = `Δ${GREEK[t.cmd]}`; }
    }
    for (;;) {
      skipIgnored();
      const t = peek();
      if (isSym(t, '_')) {
        next();
        if (name.includes('_')) throw new Error('a subscript on a subscript');
        name += `_${readSubscript()}`;
        continue;
      }
      if (isSym(t, "'")) { next(); name += "'"; continue; }
      break;
    }
    // σ(n): a function applied, or σ times n? Not guessed.
    if (isSym(peek(), '(')) throw new Error(`can't tell if ${name}( multiplies or applies`);
    return { t: 'name', v: name };
  };

  const readGroup = () => {
    skipIgnored();
    const t = peek();
    if (isSym(t, '{')) {
      next();
      const inner = readExpr();
      skipIgnored();
      if (!isSym(next(), '}')) throw new Error('missing }');
      return inner;
    }
    // \frac12: one token per argument.
    const u = next();
    if (!u) throw new Error('missing an argument');
    if (u.num) {
      // \frac12 is ½: each argument one digit, the rest left for the next.
      if (u.num.length > 1) toks.splice(i, 0, { num: u.num.slice(1) });
      return { t: 'num', v: u.num[0] };
    }
    if (u.letter) return { t: 'name', v: u.letter };
    if (u.cmd && GREEK[u.cmd]) return { t: 'name', v: GREEK[u.cmd] };
    throw new Error('expected an argument');
  };

  const applyFunction = (name) => {
    // \log_2 x, \log_{b}(x): the logarithm with a base.
    let base = null;
    skipIgnored();
    if (name === 'log' && isSym(peek(), '_')) {
      next();
      base = readSubscript();
    }
    // \sin^2 θ is (sin θ)², the power written on the name; \sin^{-1} is arcsine, refused.
    let power = null;
    skipIgnored();
    if (isSym(peek(), '^')) {
      next();
      power = isSym(peek(), '{') ? readGroup() : readAtom();
      if (power.t === 'neg') throw new Error('can\'t write inverse functions');
    }
    skipIgnored();
    let arg;
    if (isSym(peek(), '(') || isCmd(peek(), 'left')) arg = readAtom();
    else arg = readPower();
    const applied = base !== null ? { t: 'log', base, a: arg } : { t: 'fn', name, a: arg };
    return power ? { t: 'op', op: '^', a: applied, b: power } : applied;
  };

  const readAtom = () => {
    skipIgnored();
    const t = next();
    if (!t) throw new Error('formula ends too soon');
    refuseIf(t);
    if (t.num) return { t: 'num', v: t.num[0] === '.' ? `0${t.num}` : t.num };
    if (t.letter) return readName(t.letter);
    if (isSym(t, '(') || isSym(t, '[')) {
      const close = t.sym === '(' ? ')' : ']';
      const inner = readExpr();
      skipIgnored();
      if (!isSym(next(), close)) throw new Error(`missing ${close}`);
      return inner;
    }
    if (isSym(t, '{')) {
      i--;
      return readGroup();
    }
    // |x|, \lvert x \rvert: the absolute value.
    if (isSym(t, '|') || isCmd(t, 'lvert', 'vert')) {
      const inner = readExpr();
      skipIgnored();
      const close = next();
      if (!(isSym(close, '|') || isCmd(close, 'rvert', 'vert'))) throw new Error('missing |');
      return { t: 'fn', name: 'abs', a: inner };
    }
    if (t.cmd) {
      if (GREEK[t.cmd]) return readName(GREEK[t.cmd]);
      if (t.cmd === 'hbar') return readName('ħ');
      if (t.cmd === 'ell') return readName('ℓ');
      if (t.cmd === 'frac' || t.cmd === 'dfrac' || t.cmd === 'tfrac') {
        const a = readGroup();
        const b = readGroup();
        return { t: 'op', op: '/', a, b };
      }
      if (t.cmd === 'sqrt') {
        skipIgnored();
        if (isSym(peek(), '[')) throw new Error('can\'t write roots other than square roots');
        return { t: 'sqrt', a: readGroup() };
      }
      if (t.cmd === 'exp' || t.cmd === 'ln' || t.cmd === 'log' || (KNOWN_FUNCTIONS.has(t.cmd) && t.cmd !== 'lim')) {
        return applyFunction(t.cmd);
      }
      if (TEXT_FONTS.has(t.cmd)) {
        const text = readText();
        if (text === 'd') throw new Error("can't write derivatives (d)");
        if (KNOWN_FUNCTIONS.has(text) && text !== 'lim') return applyFunction(text);
        // Upright letters are one name (Re, the Reynolds number); a unit
        // (ft) is one too, and is refused later for meaning nothing tied.
        return readName(text);
      }
      throw new Error(`can't read \\${t.cmd}`);
    }
    throw new Error(`unexpected ${t.sym}`);
  };

  const readPower = () => {
    let base = readAtom();
    skipIgnored();
    while (isSym(peek(), '^')) {
      next();
      skipIgnored();
      if (isSym(peek(), '*') || isCmd(peek(), 'ast', 'dagger', 'prime', 'top', 'intercal')) throw new Error('can\'t write conjugates or transposes');
      const exp = isSym(peek(), '{') ? readGroup() : readAtom();
      base = { t: 'op', op: '^', a: base, b: exp };
      skipIgnored();
    }
    return base;
  };

  const startsFactor = (t) => !!t && (t.num || t.letter || isSym(t, '(', '[', '{')
    || (t.cmd && !TIMES.has(t.cmd) && !RELATIONS[t.cmd] && t.cmd !== 'div' && t.cmd !== 'over' && !isCmd(t, 'right')));

  const readProduct = () => {
    let left = readPower();
    for (;;) {
      skipIgnored();
      const t = peek();
      if (!t) break;
      if ((t.cmd && TIMES.has(t.cmd)) || isSym(t, '*')) {
        next();
        left = { t: 'op', op: '*', a: left, b: readPower() };
        continue;
      }
      if (isSym(t, '/') || isCmd(t, 'div')) {
        next();
        left = { t: 'op', op: '/', a: left, b: readPower() };
        continue;
      }
      if (startsFactor(t)) {
        refuseIf(t);
        left = { t: 'op', op: '*', a: left, b: readPower() };
        continue;
      }
      break;
    }
    return left;
  };

  const readSum = () => {
    skipIgnored();
    let left;
    if (isSym(peek(), '-')) { next(); left = { t: 'neg', a: readProduct() }; }
    else if (isSym(peek(), '+')) { next(); left = readProduct(); }
    else left = readProduct();
    for (;;) {
      skipIgnored();
      const t = peek();
      refuseIf(t);
      if (isSym(t, '+') || isSym(t, '-')) {
        next();
        left = { t: 'op', op: t.sym, a: left, b: readProduct() };
        continue;
      }
      break;
    }
    return left;
  };

  // A relation, or { a \over b }.
  function readExpr() {
    let left = readSum();
    for (;;) {
      skipIgnored();
      const t = peek();
      if (isCmd(t, 'over')) {
        next();
        left = { t: 'op', op: '/', a: left, b: readSum() };
        continue;
      }
      const rel = t?.sym && '=<>'.includes(t.sym) ? RELATIONS[t.sym] || t.sym : t?.cmd ? RELATIONS[t.cmd] : null;
      if (rel) {
        next();
        if (isSym(peek(), '=') && rel !== '=') next(); // <= written as two symbols
        if (left.t === 'op' && RELATION_OPS.has(left.op)) throw new Error('can\'t write chains of equalities');
        left = { t: 'op', op: rel, a: left, b: readSum() };
        continue;
      }
      break;
    }
    return left;
  }

  return {
    readAll() {
      const tree = readExpr();
      skipIgnored();
      while (isSym(peek(), '.') || isSym(peek(), ',')) next(); // a full stop at the end
      if (i < toks.length) {
        const t = peek();
        refuseIf(t);
        throw new Error(`can't read ${t.cmd ? `\\${t.cmd}` : t.sym || t.letter || t.num}`);
      }
      return tree;
    },
    readOneName() {
      const tree = readExpr();
      skipIgnored();
      if (i < toks.length || tree.t !== 'name') return null;
      return tree.v;
    },
  };
}

/** How a name is written in formula text: whole, quoted when the reader would split it. */
function nameText(name) {
  if (/^[A-Za-zͰ-Ͽ]'*$/.test(name)) return name;
  if (/^[A-Za-zͰ-Ͽ]_[A-Za-z0-9Ͱ-Ͽ]+$/.test(name)) return name;
  return `"${name}"`;
}

function textOf(node) {
  switch (node.t) {
    case 'num': return node.v;
    case 'name': return nameText(node.v);
    case 'neg': return `-(${textOf(node.a)})`;
    case 'sqrt': return `sqrt(${textOf(node.a)})`;
    case 'fn': return `${node.name}(${textOf(node.a)})`;
    case 'log': {
      if (!/^[A-Za-z0-9Ͱ-Ͽ]+$/.test(node.base)) throw new Error('a logarithm whose base is not a name or a number');
      return `log_${node.base}(${textOf(node.a)})`;
    }
    case 'op': return `(${textOf(node.a)}) ${node.op} (${textOf(node.b)})`;
    default: throw new Error('unknown');
  }
}

/** Every name a tree uses, in order. */
function namesOf(node, out = []) {
  if (node.t === 'name') out.push(node.v);
  for (const k of ['a', 'b']) if (node[k]) namesOf(node[k], out);
  if (node.t === 'log' && !/^\d+$/.test(node.base)) out.push(node.base);
  return out;
}

/**
 * @param {string} tex
 * @returns {{ text: string, names: string[] }} the formula as New Formula
 *   reads it (convention 'math', its names kept whole), and its names
 * @throws {Error} what it can't write, as a short reason
 */
export function latexToFormula(tex) {
  const tree = parser(tex).readAll();
  if (tree.t !== 'op' || !['=', '!=', '<', '>', '<=', '>=', '~='].includes(tree.op)) {
    throw new Error('not an equation or inequality');
  }
  return { text: textOf(tree), names: [...new Set(namesOf(tree))] };
}

/** The name a symbol is written by (m_{\mathrm f} -> 'm_f'), or null when it isn't one symbol. */
export function latexSymbolName(tex) {
  try {
    return parser(tex).readOneName();
  } catch {
    return null;
  }
}
