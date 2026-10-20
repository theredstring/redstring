/**
 * The formula bank: well-known equations by discipline, each symbol tied to the
 * concept it stands for there. Populated, never written by hand: the
 * equations, their titles and descriptions, and what each symbol means all
 * come from Wikidata and, where Wikidata is thin (models of epidemics, enzyme
 * reactions, materials), from MathModDB on the MaRDI portal
 * (population/fetchWikidata.js and fetchMathModDB.js take a snapshot,
 * population/buildBank.js reads its LaTeX into the bank, with a report of
 * everything it left out and why).
 *
 * Two places it can come from: the bank the app ships with
 * (bank.generated.json, built by scripts/formula-bank), or one this device
 * updated from Wikidata itself (Settings → Data → Formula Bank), which wins
 * while it is kept (population/deviceBank.js).
 *
 * A starting point, not knowledge the app depends on: picking an entry in New
 * Formula builds it fully formed (buildFormula.js), and from then on it is
 * ordinary Things to edit. Nothing ever recognizes typed text as one of these.
 *
 * Each discipline is divided into sections (Thermodynamics, Graph Theory),
 * and each section says what it knows of that the bank doesn't have yet
 * (loadFormulaBankKnown): the results Wikidata names but doesn't write, or
 * writes without saying what its symbols mean.
 *
 * Each concept becomes one Thing, named for what it is (Pressure), written by
 * its symbol in formulas (its formula label, p), and linked to its Wikidata
 * item (or MathModDB's, for a quantity Wikidata doesn't have), so it is the
 * same Thing in every equation that uses it, from either source, and the
 * same Thing an ontology import of that item makes. Loaded on first use, so the
 * bank's data stays out of the app's start.
 */
import { readDeviceBank, writeDeviceBank, clearDeviceBank } from './population/deviceBank.js';
import { BANK_FORMAT } from './population/disciplines.js';
import { itemIri } from './population/sources.js';

export const BANK_AGENT = 'formula-bank';

/** Where a concept's Thing comes from: its item (Wikidata's, or MathModDB's). */
export const conceptOrigin = (id) => itemIri(id);
/** Where an equation's Thing comes from: its item's defining formula. */
export const equationOrigin = (id) => `${itemIri(id)}#formula`;
export const disciplineOrigin = (id) => `${BANK_AGENT}:discipline/${id}`;

let bank = null;
let loading = null;
const listeners = new Set();

function indexBank(data, from) {
  const disciplines = Object.freeze(data.disciplines.map(d => Object.freeze({
    ...d,
    description: `Equations of ${d.name.toLowerCase()}.`,
  })));
  const equations = disciplines.flatMap(discipline => discipline.equations.map(equation => ({ discipline, equation })));
  return Object.freeze({
    source: data.source, fetchedAt: data.fetchedAt, from, disciplines, equations, concepts: data.concepts,
  });
}

const builtIn = () => import('./bank.generated.json').then(m => indexBank(m.default || m, 'built-in'));
const builtInKnown = () => import('./bank.known.json').then(m => m.default || m);

function setBank(next) {
  bank = next;
  loading = Promise.resolve(next);
  listeners.forEach(fn => fn());
}

/**
 * Whether a bank this device kept still stands over the one shipped: built in
 * the shape this app reads (sections and all), and no older than the shipped
 * one. An app update that ships a newer bank, or a newer shape, wins.
 */
const deviceStands = (own, shipped) => !!own?.disciplines && own.format === BANK_FORMAT
  && !(Date.parse(shipped.fetchedAt) > Date.parse(own.fetchedAt));

/** The bank, loading it if it hasn't been: this device's own while it stands, else the one shipped. */
export function loadFormulaBank() {
  if (!loading) {
    loading = Promise.all([readDeviceBank('bank').catch(() => null), builtIn()])
      .then(([own, shipped]) => {
        if (deviceStands(own, shipped)) return indexBank(own, 'device');
        // Set aside for good, so Settings says where the bank came from and the next update starts clean.
        if (own) clearDeviceBank().catch(() => {});
        return shipped;
      })
      .then((b) => { bank = b; listeners.forEach(fn => fn()); return b; });
  }
  return loading;
}

/** The bank once loaded, else null. */
export const formulaBankNow = () => bank;

/** Hear when the bank changes (loaded, updated, or put back to the shipped one). */
export function subscribeFormulaBank(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The report on what the current bank left out and why (loaded on asking). */
export async function loadFormulaBankReport() {
  const current = await loadFormulaBank();
  if (current.from === 'device') {
    const own = await readDeviceBank('report');
    if (own) return own;
  }
  const m = await import('./bank.report.json');
  return m.default || m;
}

/**
 * What each section knows of that the bank doesn't have yet, by
 * 'discipline/Q' (bank.known.json, or this device's): [Q, title, wikipedia,
 * why] each, best known first. Loaded on asking, kept apart from the bank.
 */
export async function loadFormulaBankKnown() {
  const current = await loadFormulaBank();
  if (current.from === 'device') {
    const own = await readDeviceBank('known');
    if (own) return own;
  }
  return builtInKnown();
}

/** Use a bank this device built (population/updateFormulaBank.js), and keep it. */
export async function adoptDeviceFormulaBank({ bank: next, report, known, classes, mathmoddb }) {
  const kept = await writeDeviceBank({ bank: next, report, known, classes, mathmoddb });
  setBank(indexBank(next, 'device'));
  return kept;
}

/** Go back to the bank the app shipped with. */
export async function restoreBuiltInFormulaBank() {
  await clearDeviceBank();
  setBank(await builtIn());
}

/** { name, symbol, description, source } for a concept's Q number, once loaded. */
export function bankConcept(q) {
  return bank?.concepts[q] || null;
}
