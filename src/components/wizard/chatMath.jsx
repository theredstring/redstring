/**
 * The wizard's math in the chat, drawn as formulas are drawn everywhere else
 * (FormulaTokens: exponents raised, fractions stacked, roots over what they
 * hold). Models write math as LaTeX between dollar signs ($F = ma$, $$K =
 * \frac{p^2}{2m}$$); the chat's markdown (LeftAIView's renderMarkdown) takes
 * those out before it reads the rest, and puts each back as HTML from here.
 *
 * Read by the canvas's own reader (latex/latexToFormula.js, then the formula
 * notation), so what reads here is what New Formula would build. What it
 * can't read yet (\dot Q, accents, matrices) still reads as math, not as
 * LaTeX source: its letters, Greek, sub- and superscripts, in the same type.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import FormulaTokens from '../canvas/formats/formula/FormulaTokens.jsx';
import { latexToExpression, latexSymbolName } from '../canvas/formats/formula/latex/latexToFormula.js';
import { chainFromText, tokensOf, subscriptOf, vectorOf } from '../canvas/formats/formula/formulaChain.js';
import useFormatsStore, { selectStandard } from '../canvas/formats/formatsStore.js';
import '../canvas/formats/formats.css';
import './chatMath.css';

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const SYMBOLS = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  approx: '≈', equiv: '≡', propto: '∝', infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', leftrightarrow: '↔', sqrt: '√', ldots: '…', cdots: '⋯',
};
// Operators and relations, which stand apart from what they join.
const SPACED = new Set(['cdot', 'times', 'div', 'pm', 'mp', 'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'approx', 'equiv', 'propto', 'to', 'rightarrow', 'leftarrow', 'Rightarrow', 'leftrightarrow']);
// Accents drawn over their letter as combining marks (Q̇, x̄, v⃗).
const ACCENTS = { dot: '̇', ddot: '̈', hat: '̂', bar: '̄', overline: '̅', tilde: '̃', vec: '⃗' };

/** One {group} or one character after `i`: [content, next index]. */
function argAt(tex, i) {
  while (tex[i] === ' ') i++;
  if (tex[i] !== '{') {
    if (tex[i] === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
      return [m[0], i + m[0].length];
    }
    return [tex[i] || '', i + 1];
  }
  let depth = 0;
  for (let j = i; j < tex.length; j++) {
    if (tex[j] === '{') depth++;
    else if (tex[j] === '}' && --depth === 0) return [tex.slice(i + 1, j), j + 1];
  }
  return [tex.slice(i + 1), tex.length];
}

/** LaTeX the reader refuses, as math in plain HTML: letters italic, Greek, scripts, fractions as a/b. */
function looseHtml(tex) {
  let out = '';
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
      const name = m[1];
      i += m[0].length;
      if (GREEK[name]) out += `<i>${GREEK[name]}</i>`;
      else if (SYMBOLS[name]) out += SPACED.has(name) ? ` ${SYMBOLS[name]} ` : SYMBOLS[name];
      else if (ACCENTS[name]) {
        const [arg, next] = argAt(tex, i);
        i = next;
        out += `${looseHtml(arg)}${ACCENTS[name]}`;
      } else if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [num, a] = argAt(tex, i);
        const [den, b] = argAt(tex, a);
        i = b;
        out += `${looseHtml(num)}/${looseHtml(den)}`;
      } else if (['text', 'mathrm', 'textrm', 'operatorname', 'mathbf', 'boldsymbol', 'mathit', 'mathsf'].includes(name)) {
        const [arg, next] = argAt(tex, i);
        i = next;
        out += name === 'mathbf' || name === 'boldsymbol' ? `<b>${looseHtml(arg)}</b>` : escapeHtml(arg);
      } else if (/^[A-Za-z]+$/.test(name) && !['left', 'right', 'displaystyle', 'quad', 'qquad'].includes(name)) {
        out += escapeHtml(name); // sin, log, lim
      } else if (name === ',' || name === ';' || name === ' ' || name === 'quad') {
        out += ' ';
      }
    } else if (c === '^' || c === '_') {
      const [arg, next] = argAt(tex, i + 1);
      i = next;
      const tag = c === '^' ? 'sup' : 'sub';
      out += `<${tag}>${looseHtml(arg)}</${tag}>`;
    } else if (c === '{' || c === '}') {
      i++;
    } else if (/[A-Za-z]/.test(c)) {
      out += `<i>${c}</i>`;
      i++;
    } else if ('=+-<>'.includes(c)) {
      out += ` ${escapeHtml(c === '-' ? '−' : c)} `;
      i++;
    } else {
      out += escapeHtml(c);
      i++;
    }
  }
  return out.replace(/ {2,}/g, ' ');
}

const cache = new Map();
const CACHE_MAX = 300;

/**
 * One piece of the wizard's math as HTML: `display` for $$…$$, set on its own line.
 * The source stays on it (title) for whoever wants the LaTeX.
 */
export function chatMathHtml(tex, { display = false } = {}) {
  const source = String(tex || '').trim();
  const standard = selectStandard(useFormatsStore.getState());
  const k = `${display ? 'd' : 'i'}${standard ? 's' : 'e'}:${source}`;
  if (cache.has(k)) return cache.get(k);
  let inner;
  let read = true;
  const symbol = latexSymbolName(source);
  if (symbol) {
    // One symbol ($m$, $R_{th}$): no operation, so no formula, but its token as a formula shows it.
    const sub = subscriptOf(symbol);
    const { letter, vector } = vectorOf(sub ? sub[0] : symbol);
    const shown = vector ? `<span class="formula-vec">${escapeHtml(letter)}</span>` : escapeHtml(letter);
    inner = `<span class="formula-tokens"><span class="formula-token kind-operand">${shown}${sub ? `<sub class="formula-token-sub">${escapeHtml(sub[1])}</sub>` : ''}</span></span>`;
  } else {
    try {
      const { text, names } = latexToExpression(source);
      const known = new Set(names);
      const chain = chainFromText(text, { convention: 'math', isKnownName: (n) => known.has(n) });
      inner = renderToStaticMarkup(<FormulaTokens tokens={tokensOf(chain, { standard })} />);
    } catch {
      read = false;
      inner = `<span class="chat-math-loose">${looseHtml(source)}</span>`;
    }
  }
  const tag = display ? 'div' : 'span';
  const html = `<${tag} class="chat-math${display ? ' is-display' : ''}${read ? '' : ' is-loose'}" title="${escapeHtml(source)}">${inner}</${tag}>`;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, html);
  return html;
}

// Code first, so a dollar sign in code stays code; then $$…$$, \[…\], \(…\), $…$.
// A single $ opens only against what follows and closes only against what
// precedes it, and not before a digit, so prices ($5 and $10) stay prices.
const MATH = /(```[\s\S]*?```|`[^`\n]+`)|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\d$])/g;
// A private-use character: nothing a model writes, and nothing the markdown reads.
const MARK = '\uE000';

/**
 * The math in a message, taken out: `text` with a mark where each was, and
 * `restore(html)`, which puts each back drawn. The marks are plain characters
 * the markdown leaves alone.
 */
export function extractChatMath(text) {
  const pieces = [];
  const out = String(text || '').replace(MATH, (whole, code, dd, bracket, paren, single) => {
    if (code) return code;
    const display = dd !== undefined || bracket !== undefined;
    pieces.push({ tex: dd ?? bracket ?? paren ?? single, display });
    return `${MARK}${pieces.length - 1}${MARK}`;
  });
  const restore = (html) => (pieces.length
    ? html.replace(/\uE000(\d+)\uE000/g, (_, n) => (pieces[n] ? chatMathHtml(pieces[n].tex, { display: pieces[n].display }) : ''))
    : html);
  return { text: out, restore };
}
