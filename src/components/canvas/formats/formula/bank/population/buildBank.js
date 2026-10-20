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
 *  - every symbol in it is tied to exactly one concept.
 * A concept may be written two ways in one equation (q₁ and q₂, both electric
 * charge) or another way than the rest of the bank writes it (P for pressure,
 * where most write p): each concept has one symbol across the bank, the way
 * most of its equations write it, and an equation that writes it otherwise
 * keeps its own symbol on the instance (buildFormula.js).
 */
import { latexToFormula, latexSymbolName } from '../../latex/latexToFormula.js';
import { chainFromText, chainText } from '../../formulaChain.js';
import { DISCIPLINE_ROOTS, KIND_ROOTS, DISCIPLINE_ORDER, isFieldLike, BANK_FORMAT } from './disciplines.js';

const WD = 'http://www.wikidata.org/entity/';
const MIN_MISSING = 3; // a section with no equation yet shows when it knows of this many

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
 *   rejected: { id, label, reason, detail }[] },
 *   known: { sections: { 'discipline/Q': [Q, title, wikipedia, why][] } } }} the bank, the
 *   report, and what each section knows of that the bank doesn't have yet
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
    // What a sum, a limit or an integral runs over (i in ∑ᵢ) is a place holder: it needs no concept.
    const untied = read.names.filter(n => !bound[n] && !read.bound.includes(n));
    if (untied.length) {
      reject(item, chunks.length ? 'symbols tied only as part of a chunk' : 'symbols not tied to a concept', untied.join(', '));
      continue;
    }
    const symbols = Object.fromEntries(read.names.filter(n => bound[n]).map(n => [n, bound[n]]));
    if (Object.values(symbols).some(q => !concepts[q]?.label && !ALWAYS_LABELS[q])) {
      reject(item, 'a concept with no title');
      continue;
    }
    // Reads back the way the app reads it; kept as its plain line when that
    // reads back the same (C = Q ÷ V), else with every bracket it was read with.
    const readAs = { convention: 'math', isKnownName: (n) => read.names.includes(n) };
    let shown;
    try {
      shown = chainText(chainFromText(read.text, readAs));
    } catch (err) { reject(item, 'formula not writable yet', err.message); continue; }
    let formula = read.text;
    try {
      if (chainText(chainFromText(shown, readAs)) === shown) formula = shown;
    } catch { /* keep the bracketed text */ }
    const placeHolders = read.bound.filter(n => !symbols[n]);
    candidates.push({ item, formula, symbols, shown, placeHolders });
  }

  // Pass 2: each concept's symbol across the bank, the way most of its equations write it.
  const uses = {};
  for (const c of candidates) for (const [n, q] of Object.entries(c.symbols)) {
    uses[q] = uses[q] || {};
    uses[q][n] = (uses[q][n] || 0) + (c.item.sitelinks || 0) + 1;
  }
  const symbolOf = {};
  for (const [q, counts] of Object.entries(uses)) {
    symbolOf[q] = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  const accepted = candidates;

  // Disciplines. What an item says of itself decides: the fields it is
  // studied by most, then what kind of thing it is (a physical law, a
  // theorem, a concept in physics), then the fields its Wikipedia categories
  // are about. A field counts by the fields it leads to; a kind of thing by
  // everything it leads to.
  const rootsOf = (classId, kind) => {
    // A field that is a discipline's root is that discipline's alone (probability theory: Statistics).
    if (!kind && DISCIPLINE_ROOTS[classId] && !KIND_ROOTS.has(classId)) return [DISCIPLINE_ROOTS[classId]];
    return [...new Set((classes[classId]?.leadsTo || [])
      .filter(r => kind || !KIND_ROOTS.has(r)).map(r => DISCIPLINE_ROOTS[r]).filter(Boolean))];
  };
  const isField = (id) => !DISCIPLINE_ROOTS[id] && !KIND_ROOTS.has(id) && isFieldLike(classes[id]?.label, classes[id]?.description);
  const scoreOf = (pairs) => {
    const field = {};
    const kind = {};
    for (const [classId, w, isKind] of pairs) {
      const score = isKind ? kind : field;
      rootsOf(classId, isKind).forEach(d => { score[d] = (score[d] || 0) + w; });
      // Mathematics from a kind of thing (a quantity is a mathematical object) is no field's.
    }
    return { field, kind };
  };
  // Quantities and theorems lead up to mathematics as kinds of thing (a
  // quantity is a mathematical object): mathematics from a kind is the
  // discipline only when nothing more particular is; from a field, it counts as any.
  const bestOf = ({ field, kind }) => {
    const total = { ...field };
    for (const [d, n] of Object.entries(kind)) total[d] = (total[d] || 0) + n;
    const particular = Object.entries(total).filter(([d]) => d !== 'Mathematics' || field.Mathematics);
    return (particular.length ? particular : Object.entries(total))
      .sort((a, b) => b[1] - a[1] || DISCIPLINE_ORDER.indexOf(a[0]) - DISCIPLINE_ORDER.indexOf(b[0]))[0]?.[0] || null;
  };
  // A category's topic counts when it is a field (Graph theory), not a thing (Voltage, Albert Einstein).
  const ownDiscipline = (x) => bestOf(scoreOf([
    ...x.studiedBy.map(id => [id, 3, false]),
    ...[...x.instanceOf, ...(x.subclassOf || [])].map(id => [id, 2, true]),
    ...(x.topics || []).filter(isField).map(id => [id, 1, false]),
  ]));
  // An equation that says nothing of itself is where its concepts are.
  const disciplineOf = (c) => {
    const own = ownDiscipline(c.item);
    if (own) return own;
    const pairs = [];
    for (const q of new Set(Object.values(c.symbols))) {
      (concepts[q]?.studiedBy || []).forEach(x => pairs.push([x, 2, false]));
      [...(concepts[q]?.instanceOf || []), ...(concepts[q]?.subclassOf || [])].forEach(x => pairs.push([x, 1, true]));
    }
    return bestOf(scoreOf(pairs)) || 'Mathematics';
  };

  // Sections: the fields a discipline is divided into (Thermodynamics, Graph
  // Theory, Population Genetics), each item in the one of its fields that
  // most of its discipline is in too, so sections gather rather than scatter.
  const fieldsOf = (x, d, extra = []) => {
    const out = new Map();
    const add = (id, w) => {
      if (isField(id) && rootsOf(id, false).includes(d)) out.set(id, Math.max(out.get(id) || 0, w));
    };
    x.studiedBy.forEach(id => add(id, 3));
    (x.topics || []).forEach(id => add(id, 1));
    (x.partOf || []).forEach(id => add(id, 1));
    extra.forEach(id => add(id, 1));
    return out;
  };
  // Everything that has a discipline, in the bank or not: what sections are made of.
  const placed = [];
  const acceptedIds = new Set(accepted.map(c => c.item.id));
  for (const c of accepted) placed.push({ x: c.item, d: disciplineOf(c), c });
  for (const r of rejected) {
    const x = items[r.id];
    const d = x && ownDiscipline(x);
    if (d) placed.push({ x, d, why: r.detail ? `${r.reason}: ${r.detail}` : r.reason });
  }
  for (const k of Object.values(snap.known || {})) {
    if (acceptedIds.has(k.id)) continue;
    const d = ownDiscipline(k);
    if (d) placed.push({ x: k, d, why: k.hasFormula ? 'Wikidata doesn\'t say what its symbols mean' : 'Wikidata has no formula for it' });
  }
  const conceptFields = (c) => [...new Set(Object.values(c.symbols))].flatMap(q => concepts[q]?.studiedBy || []);
  const popular = {};
  for (const p of placed) {
    p.fields = fieldsOf(p.x, p.d, p.c ? conceptFields(p.c) : []);
    const pop = (popular[p.d] = popular[p.d] || {});
    p.fields.forEach((_, f) => { pop[f] = (pop[f] || 0) + 1; });
  }
  for (const p of placed) {
    const pop = popular[p.d];
    p.section = [...p.fields.entries()]
      .sort((a, b) => b[1] * pop[b[0]] - a[1] * pop[a[0]] || String(classes[a[0]].label).localeCompare(classes[b[0]].label))[0]?.[0] || null;
  }
  const sectionName = (id) => titleCase(classes[id].label);

  const disciplines = new Map();
  const disciplineOfId = (name) => {
    if (!disciplines.has(name)) disciplines.set(name, { equations: [], sections: new Map() });
    return disciplines.get(name);
  };
  const sectionIn = (disc, id) => {
    if (!disc.sections.has(id)) disc.sections.set(id, { equations: 0, missing: [] });
    return disc.sections.get(id);
  };
  const usedConcepts = new Set();
  const byFame = (a, b) => (b.x.sitelinks || 0) - (a.x.sitelinks || 0) || String(a.x.label).localeCompare(b.x.label);
  for (const p of placed.filter(q => q.c).sort(byFame)) {
    const { c } = p;
    const disc = disciplineOfId(p.d);
    const selfDefined = Object.values(c.symbols).includes(c.item.id);
    const label = titleCase(c.item.label);
    if (p.section) sectionIn(disc, p.section).equations++;
    disc.equations.push({
      id: c.item.id,
      // An item that is itself one of its concepts (capacitance, C = Q/V) is
      // that concept's definition: its own Thing is the concept's.
      title: selfDefined ? `Definition of ${label}` : label,
      ...(selfDefined ? { defines: c.item.id } : {}),
      description: sentence(c.item.description),
      text: c.formula,
      symbols: c.symbols,
      // Names a sum or an integral runs over that mean nothing of their own (i in ∑ᵢ).
      ...(c.placeHolders.length ? { placeHolders: c.placeHolders } : {}),
      ...(p.section ? { section: sectionName(p.section), sectionId: p.section } : {}),
      ...(c.item.wikipedia ? { wikipedia: c.item.wikipedia } : {}),
      source: `${WD}${c.item.id}`,
    });
    Object.values(c.symbols).forEach(q => usedConcepts.add(q));
  }
  // What each section knows of and the bank doesn't have yet, best known first:
  // what is left to write, and why it isn't written.
  for (const p of placed.filter(q => !q.c && q.section).sort(byFame)) {
    sectionIn(disciplineOfId(p.d), p.section).missing.push([p.x.id, titleCase(p.x.label), p.x.wikipedia || null, p.why]);
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

  // A section shows when it has an equation, or enough known to say what it is missing.
  const shownSection = (sec) => sec.equations > 0 || sec.missing.length >= MIN_MISSING;
  const idOf = (name) => name.toLowerCase().replace(/\s+/g, '-');
  const shown = [...disciplines.entries()]
    .filter(([, disc]) => disc.equations.length || [...disc.sections.values()].some(shownSection))
    .sort((a, b) => b[1].equations.length - a[1].equations.length || a[0].localeCompare(b[0]));
  const bank = {
    format: BANK_FORMAT,
    source: snap.source,
    fetchedAt: snap.fetchedAt,
    disciplines: shown.map(([name, disc]) => ({
      id: idOf(name),
      name,
      sections: [...disc.sections.entries()].filter(([, sec]) => shownSection(sec))
        .sort((a, b) => b[1].equations - a[1].equations || b[1].missing.length - a[1].missing.length || a[0].localeCompare(b[0]))
        .map(([id, sec]) => ({
          id, name: sectionName(id), description: sentence(classes[id].description || ''), equations: sec.equations, missing: sec.missing.length,
        })),
      equations: disc.equations,
    })),
    concepts: conceptTable,
  };
  // What each shown section is missing, kept apart: the bank loads without it.
  const known = { source: snap.source, fetchedAt: snap.fetchedAt, sections: {} };
  for (const [name, disc] of shown) {
    for (const [id, sec] of disc.sections) {
      if (shownSection(sec) && sec.missing.length) known.sections[`${idOf(name)}/${id}`] = sec.missing;
    }
  }
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
  return { bank, report, known };
}
