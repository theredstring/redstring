/**
 * The formulas in the wizard's snapshot: graphState.formulas and
 * graphState.equations, read from the store by
 * formats/formula/formulaSnapshot.js and predicted for what this ask made by
 * AgentLoop.updateGraphState. Found by name here, and what of a web's Things
 * and connections they draw over, so the context and readGraph show a
 * formula as one thing (its text) instead of its row of Things.
 *
 * Each formula: { graphId, groupId, anchorId, equationProtoId, title, text,
 *   shown: 'formula' | 'open' | 'folded', terms: [{ symbol, thing, instanceId, protoId }], memberIds }
 */
import { chainFromText, chainText } from '../../../components/canvas/formats/formula/formulaChain.js';

const key = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const compact = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();

export const formulasIn = (graphState, graphId) => (graphState?.formulas || []).filter(f => f.graphId === graphId);

/** A formula of the web by its title, its text, or an id: the last match. */
export function findFormulaIn(graphState, graphId, ref) {
  const inWeb = formulasIn(graphState, graphId);
  if (!ref) return inWeb.length === 1 ? inWeb[0] : null;
  const byId = inWeb.find(f => f.groupId === ref || f.anchorId === ref || f.equationProtoId === ref);
  if (byId) return byId;
  const k = key(ref);
  const named = inWeb.filter(f => key(f.title) === k || compact(f.text) === compact(ref));
  if (named.length) return named[named.length - 1];
  const near = inWeb.filter(f => key(f.title).includes(k) || k.includes(key(f.title)));
  return near.length ? near[near.length - 1] : null;
}

/** An equation anywhere in the universe, by its title or text: { protoId, name, text }, the last match. */
export function findEquation(graphState, ref) {
  const k = key(ref);
  const all = [
    ...(graphState?.equations || []),
    ...(graphState?.formulas || []).map(f => ({ protoId: f.equationProtoId, name: f.title, text: f.text })),
  ].filter(e => e.protoId || e.name);
  const named = all.filter(e => e.protoId === ref || key(e.name) === k || compact(e.text) === compact(ref));
  if (named.length) return named[named.length - 1];
  const near = all.filter(e => key(e.name).includes(k));
  return near.length ? near[near.length - 1] : null;
}

/** What each symbol stands for, where that is more than the symbol: "P = Pressure, V = Volume". */
export function meaningsText(f) {
  return (f.terms || [])
    .filter(t => t.thing && t.thing !== t.symbol)
    .map(t => `${t.symbol} = ${t.thing}`)
    .join(', ');
}

const SHOWN = {
  formula: '',
  open: ' [its Thing placed here, open as its formula]',
  folded: ' [folded into its Thing; opens as its formula]',
};

/** One line for a formula: "Ideal Gas Law: P × V = n × R × T (P = Pressure, ...)". */
export function formulaLine(f) {
  const meanings = meaningsText(f);
  const titled = f.title && compact(f.title) !== compact(f.text) ? `${f.title}: ` : '';
  return `${titled}${f.text}${meanings ? ` (${meanings})` : ''}${SHOWN[f.shown] || ''}`;
}

/**
 * What a web's formulas cover: `of(id)` is the formula an instance is inside
 * or stands for (its anchor), `hides(id)` whether it is drawn as part of one
 * rather than as a Thing, `internal(edge)` whether a connection is one of a
 * formula's own operations. A connection between two formulas, or from
 * outside to a term, is the web's own.
 */
export function formulaCover(formulas) {
  const owner = new Map();
  for (const f of formulas || []) {
    for (const id of f.memberIds || []) owner.set(id, f);
    if (f.anchorId) owner.set(f.anchorId, f);
  }
  const of = (id) => owner.get(id) || null;
  return {
    any: owner.size > 0,
    of,
    hides: (id) => owner.has(id),
    internal: (e) => {
      const a = of(e.sourceId || e.source);
      return !!a && a === of(e.destinationId || e.targetId || e.target);
    },
    /** How an end of a connection reads: a term "Pressure (in Ideal Gas Law)", a formula its title. */
    nameOf: (id, fallback) => {
      const f = of(id);
      if (!f) return fallback;
      if (f.anchorId === id) return f.title;
      const term = (f.terms || []).find(t => t.instanceId === id);
      return `${term?.thing || fallback} (in ${f.title})`;
    },
  };
}

/**
 * Read a formula as the canvas will, so one it can't build is refused before
 * anything is written: its text as it will read, and its terms with what
 * each is given to mean. Throws with what to do instead.
 */
export function readFormulaText(text, { meanings = [], knownNames = [], convention = 'math' } = {}) {
  const meant = new Map((Array.isArray(meanings) ? meanings : [])
    .filter(m => m?.symbol && m?.thing)
    .map(m => [String(m.symbol).trim(), String(m.thing).trim()]));
  const known = new Set([...meant.keys(), ...knownNames.filter(Boolean).map(n => String(n).trim())]);
  let chain;
  try {
    chain = chainFromText(String(text || ''), { convention: convention === 'programming' ? 'programming' : 'math', isKnownName: (n) => known.has(n) });
  } catch (err) {
    throw new Error(`"${text}" is not a formula Redstring can read (${err.message}). Write it as plain text with = + - * / ^ and parentheses, e.g. "F = m * a" or "E = m * c^2".`);
  }
  const terms = [];
  const seen = new Set();
  const walk = (c) => {
    for (const item of c.items) {
      if (item.kind === 'thing' && !seen.has(item.name)) {
        seen.add(item.name);
        terms.push({ symbol: item.name, thing: meant.get(item.name) || item.name });
      } else if (item.kind === 'part') {
        item.args.forEach(walk);
      }
    }
  };
  walk(chain);
  return { text: chainText(chain), terms };
}
