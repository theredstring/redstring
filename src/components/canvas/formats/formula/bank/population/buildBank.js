/**
 * Build the formula bank from a Wikidata snapshot (fetchWikidata.js):
 * each item's defining formula read from its LaTeX (latexToFormula.js), each
 * of its symbols tied to the concept Wikidata says it represents, sorted into
 * disciplines, best known first.
 *
 * Returns the bank (what bank.generated.json holds) and a report: how many
 * got in, by discipline, and every item left out with why. Runs in the app
 * (Settings → Data → Formula Bank) and in scripts/formula-bank/build-bank.mjs.
 * An equation gets in only when:
 *  - it has a title and a description (its Thing's bio);
 *  - its formula reads, as an equation or inequality, in what the notation can write;
 *  - every symbol in it is tied to exactly one concept, and no concept to two
 *    symbols (q₁ and q₂ both electric charge: a Thing is written one way);
 *  - each concept is written the way the rest of the bank writes it (pressure
 *    as p here and P elsewhere would show one of them wrongly).
 */
import { latexToFormula, latexSymbolName } from '../../latex/latexToFormula.js';
import { chainFromText, chainText } from '../../formulaChain.js';
import { DISCIPLINE_ROOTS, KIND_ROOTS } from './disciplines.js';

const WD = 'http://www.wikidata.org/entity/';

// Symbols every formula means the same way, when Wikidata leaves them untied.
const ALWAYS = { π: 'Q167' };
// Titles for the symbols tied by ALWAYS when the snapshot lacks their concept.
const ALWAYS_LABELS = { Q167: 'pi' };

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'over', 'per', 'the', 'to', 'with', 'vs']);
/** Wikidata labels are lower case ("ideal gas law"); Things are titled ("Ideal Gas Law"). */
function titleCase(label) {
  return String(label).split(/(\s+|-|–)/).map((w, i) => {
    if (!w.trim() || w === '-' || w === '–') return w;
    if (/[A-Z]/.test(w.slice(1)) || /^[^a-z]/.test(w)) return w; // pH, SI, Coulomb's, 2D
    if (i > 0 && SMALL_WORDS.has(w)) return w;
    return w[0].toUpperCase() + w.slice(1);
  }).join('');
}
/** A description as a bio: a sentence. */
function sentence(text) {
  const t = String(text).trim();
  if (!t) return '';
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/**
 * @param {object} snap - a snapshot from fetchFormulaSnapshot
 * @returns {{ bank: object, report: { source, fetchedAt, total, accepted, concepts,
 *   byDiscipline: [string, number][], byReason: [string, number][], whyNot: [string, number][],
 *   rejected: { id, label, reason, detail }[] } }}
 */
export function buildBank(snap) {
  const { items, concepts, classes } = snap;
  const rejected = [];
  const reject = (item, reason, detail = '') => rejected.push({ id: item.id, label: item.label, reason, detail });

  // A unit's definition (1 N = 1 kg·m/s²) relates units, not quantities.
  const isUnitClass = (id) => (classes[id]?.marks || []).includes('unit');
  const isUnit = (x) => [...(x?.instanceOf || []), ...(x?.subclassOf || [])].some(isUnitClass);

  // Pass 1: what each item's formula reads as, and what its symbols mean.
  const candidates = [];
  for (const item of Object.values(items)) {
    if (!item.label) { reject(item, 'no title'); continue; }
    // Only the item itself: constants (c, h, even π) are units too in some vocabularies.
    if (isUnit(item)) {
      reject(item, 'a unit\'s definition');
      continue;
    }
    if (!item.description) { reject(item, 'no description'); continue; }
    let read = null;
    let why = null;
    for (const tex of item.formulas) {
      try { read = { tex, ...latexToFormula(tex) }; break; } catch (err) { why = why || err.message; }
    }
    if (!read) { reject(item, 'formula not writable yet', why || 'no formula'); continue; }

    // Symbol -> concept, from "symbol represents"; a chunk (1/(4πε₀)) ties a whole part.
    const bound = {};
    const chunks = [];
    let problem = null;
    for (const sym of item.symbols) {
      const name = latexSymbolName(sym.tex);
      if (!name) { chunks.push(sym.tex); continue; }
      if (sym.represents.length !== 1) continue;
      const concept = sym.represents[0];
      if (bound[name] && bound[name] !== concept) { problem = ['one symbol, two concepts', name]; break; }
      bound[name] = concept;
    }
    if (problem) { reject(item, problem[0], problem[1]); continue; }
    for (const [name, q] of Object.entries(ALWAYS)) if (read.names.includes(name) && !bound[name]) bound[name] = q;
    const untied = read.names.filter(n => !bound[n]);
    if (untied.length) {
      reject(item, chunks.length ? 'symbols tied only as part of a chunk' : 'symbols not tied to a concept', untied.join(', '));
      continue;
    }
    const symbols = Object.fromEntries(read.names.map(n => [n, bound[n]]));
    const byConcept = {};
    for (const [n, q] of Object.entries(symbols)) (byConcept[q] = byConcept[q] || []).push(n);
    const shared = Object.entries(byConcept).find(([, ns]) => ns.length > 1);
    if (shared) {
      reject(item, 'two symbols for one concept', `${shared[1].join(', ')} → ${concepts[shared[0]]?.label || shared[0]}`);
      continue;
    }
    if (Object.values(symbols).some(q => !concepts[q]?.label && !ALWAYS_LABELS[q])) {
      reject(item, 'a concept with no title');
      continue;
    }
    // Reads back the way the app reads it; kept as its plain line when that
    // reads back the same (C = Q ÷ V), else with every bracket it was read with.
    const readAs = { convention: 'math', isKnownName: (n) => n in symbols };
    let shown;
    try {
      shown = chainText(chainFromText(read.text, readAs));
    } catch (err) { reject(item, 'formula not writable yet', err.message); continue; }
    let formula = read.text;
    try {
      if (chainText(chainFromText(shown, readAs)) === shown) formula = shown;
    } catch { /* keep the bracketed text */ }
    candidates.push({ item, formula, symbols, shown });
  }

  // Pass 2: each concept written one way across the bank, the way most of its equations write it.
  const uses = {};
  for (const c of candidates) for (const [n, q] of Object.entries(c.symbols)) {
    uses[q] = uses[q] || {};
    uses[q][n] = (uses[q][n] || 0) + (c.item.sitelinks || 0) + 1;
  }
  const symbolOf = {};
  for (const [q, counts] of Object.entries(uses)) {
    symbolOf[q] = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  const accepted = [];
  for (const c of candidates) {
    const off = Object.entries(c.symbols).find(([n, q]) => symbolOf[q] !== n);
    if (off) {
      reject(c.item, 'writes a concept another way than the bank', `${off[0]} for ${concepts[off[1]]?.label}, the bank writes ${symbolOf[off[1]]}`);
      continue;
    }
    accepted.push(c);
  }

  // Disciplines: the item's own field counts most, then what kind of thing it is, then its concepts'.
  // A field (studied by) leads to fields; a kind of thing (instance or subclass of) to kinds.
  const rootsOf = (classId, kind) => (classes[classId]?.leadsTo || [])
    .filter(r => KIND_ROOTS.has(r) === kind).map(r => DISCIPLINE_ROOTS[r]).filter(Boolean);
  const order = [...new Set(Object.values(DISCIPLINE_ROOTS))];
  const scoreOf = (pairs) => {
    const score = {};
    for (const [classId, w, kind] of pairs) new Set(rootsOf(classId, kind)).forEach(d => { score[d] = (score[d] || 0) + w; });
    return score;
  };
  // Quantities lead up to mathematics too (a quantity is a mathematical
  // object): it is the discipline only when nothing more particular is.
  const bestOf = (score) => {
    const particular = Object.entries(score).filter(([d]) => d !== 'Mathematics');
    return (particular.length ? particular : Object.entries(score))
      .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0]?.[0] || null;
  };
  // What the item says of itself (its field, what kind of thing it is)
  // decides; what its concepts say, only when it says nothing.
  const disciplineOf = (c) => {
    const own = bestOf(scoreOf([
      ...c.item.studiedBy.map(x => [x, 2, false]),
      ...[...c.item.instanceOf, ...(c.item.subclassOf || [])].map(x => [x, 1, true]),
    ]));
    if (own) return own;
    const pairs = [];
    for (const q of new Set(Object.values(c.symbols))) {
      (concepts[q]?.studiedBy || []).forEach(x => pairs.push([x, 2, false]));
      [...(concepts[q]?.instanceOf || []), ...(concepts[q]?.subclassOf || [])].forEach(x => pairs.push([x, 1, true]));
    }
    return bestOf(scoreOf(pairs)) || 'Mathematics';
  };
  const fieldOf = (c) => {
    const own = c.item.studiedBy.map(x => classes[x]?.label).filter(Boolean);
    return own.length ? titleCase(own[0]) : null;
  };

  const disciplines = new Map();
  const usedConcepts = new Set();
  for (const c of accepted.sort((a, b) => (b.item.sitelinks || 0) - (a.item.sitelinks || 0) || a.item.label.localeCompare(b.item.label))) {
    const name = disciplineOf(c);
    if (!disciplines.has(name)) disciplines.set(name, []);
    const selfDefined = Object.values(c.symbols).includes(c.item.id);
    const label = titleCase(c.item.label);
    disciplines.get(name).push({
      id: c.item.id,
      // An item that is itself one of its concepts (capacitance, C = Q/V) is
      // that concept's definition: its own Thing is the concept's.
      title: selfDefined ? `Definition of ${label}` : label,
      ...(selfDefined ? { defines: c.item.id } : {}),
      description: sentence(c.item.description),
      text: c.formula,
      symbols: c.symbols,
      ...(fieldOf(c) ? { field: fieldOf(c) } : {}),
      ...(c.item.wikipedia ? { wikipedia: c.item.wikipedia } : {}),
      source: `${WD}${c.item.id}`,
    });
    Object.values(c.symbols).forEach(q => usedConcepts.add(q));
  }

  const conceptTable = {};
  for (const q of [...usedConcepts].sort()) {
    const c = concepts[q];
    conceptTable[q] = {
      name: titleCase(c?.label || ALWAYS_LABELS[q]),
      symbol: symbolOf[q],
      description: sentence(c?.description || ''),
      source: `${WD}${q}`,
    };
  }

  const bank = {
    source: snap.source,
    fetchedAt: snap.fetchedAt,
    disciplines: [...disciplines.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, equations]) => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name, equations })),
    concepts: conceptTable,
  };
  // The report: what got in, and every item left out with why.
  const byReason = {};
  for (const r of rejected) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  const whyNot = {};
  for (const r of rejected.filter(x => x.reason === 'formula not writable yet')) {
    const key = r.detail.replace(/ \(.*\)$/, '');
    whyNot[key] = (whyNot[key] || 0) + 1;
  }
  const report = {
    source: snap.source,
    fetchedAt: snap.fetchedAt,
    total: Object.keys(items).length,
    accepted: accepted.length,
    concepts: Object.keys(conceptTable).length,
    byDiscipline: bank.disciplines.map(d => [d.name, d.equations.length]),
    byReason: Object.entries(byReason).sort((a, b) => b[1] - a[1]),
    whyNot: Object.entries(whyNot).sort((a, b) => b[1] - a[1]),
    rejected: rejected.sort((a, b) => a.reason.localeCompare(b.reason) || a.id.localeCompare(b.id)),
  };
  return { bank, report };
}
