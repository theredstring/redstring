/**
 * Updating the formula bank from Wikidata, from inside the app: fetch the
 * snapshot (fetchWikidata.js), build the bank from it (buildBank.js), and use
 * it from then on (formulaBank.adoptDeviceFormulaBank). One update at a time,
 * held here rather than in the settings page that starts it, so closing
 * Settings doesn't stop it; the page reads its progress through
 * useSyncExternalStore.
 */
import { fetchFormulaSnapshot } from './fetchWikidata.js';
import { buildBank } from './buildBank.js';
import { readDeviceBank } from './deviceBank.js';
import { adoptDeviceFormulaBank } from '../formulaBank.js';

const IDLE = Object.freeze({ running: false, stage: null, done: 0, total: 0, error: null, result: null });
let state = IDLE;
let controller = null;
const listeners = new Set();

function set(next) {
  state = Object.freeze({ ...state, ...next });
  listeners.forEach(fn => fn());
}

export const getFormulaBankUpdate = () => state;
export function subscribeFormulaBankUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Start an update; resolves when it ends (its outcome is also in the state). */
export async function updateFormulaBankFromWikidata() {
  if (state.running) return;
  controller = new AbortController();
  set({ ...IDLE, running: true, stage: 'Starting' });
  try {
    // Classes traced before keep their disciplines (the slow part, skipped):
    // this device's last update's, else the ones the app shipped with.
    const classes = await readDeviceBank('classes') || await shippedClasses();
    // MathModDB, read down from the items the app shipped with and the last update found.
    const seeds = [...new Set([...(await shippedMathModDB()), ...((await readDeviceBank('mathmoddb')) || [])])];
    const snapshot = await fetchFormulaSnapshot({
      previous: classes ? { classes } : null,
      mathModDBSeeds: seeds,
      signal: controller.signal,
      onProgress: ({ stage, done = 0, total = 0 }) => set({ stage, done, total }),
    });
    set({ stage: 'Building the bank', done: 0, total: 0 });
    const { bank, report, known } = buildBank(snapshot);
    const traced = {};
    for (const [id, c] of Object.entries(snapshot.classes)) traced[id] = { leadsTo: c.leadsTo, marks: c.marks, ...(c.byInstance ? { byInstance: true } : {}) };
    const m = snapshot.mathmoddb;
    const mathmoddb = m ? [m.disciplines, m.problems, m.models, m.formulas].flatMap(Object.keys) : seeds;
    const kept = await adoptDeviceFormulaBank({ bank, report, known, classes: traced, mathmoddb });
    set({
      running: false, stage: null,
      result: { accepted: report.accepted, total: report.total, kept },
    });
  } catch (error) {
    set({ running: false, stage: null, error: controller?.signal.aborted ? 'Stopped' : (error?.message || 'The update did not finish') });
  } finally {
    controller = null;
  }
}

async function shippedMathModDB() {
  try {
    const m = await import('../bank.classes.json');
    return (m.default || m).mathmoddb || [];
  } catch {
    return [];
  }
}

async function shippedClasses() {
  try {
    const m = await import('../bank.classes.json');
    const { traced, leads, byInstance = [] } = m.default || m;
    const classes = {};
    for (const id of traced) classes[id] = { leadsTo: leads[id]?.[0] || [], marks: leads[id]?.[1] || [] };
    for (const id of byInstance) if (classes[id]) classes[id].byInstance = true;
    return classes;
  } catch {
    return null;
  }
}

export function stopFormulaBankUpdate() {
  controller?.abort();
}
