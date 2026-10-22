/**
 * The formula starter: the bank's equations put into a universe, as ordinary
 * Things it owns from then on (Settings → Data → Formula Starter). Until then
 * nothing from the bank is offered: New Formula lists the universe's own
 * equations (universeEquations.js). The wizard still builds one from the bank
 * when asked for it.
 *
 * Each equation is built where the bank files it, shown as its formula in
 * its section's web, the section placed in its discipline's web, and every
 * discipline in one web of their own, Formulas. An equation the universe has
 * already (from the bank, by where it came from) is left as it is.
 *
 * Built in a store of its own (formulaStarter.worker.js), where every write
 * is cheap however large the open universe is, then folded in with one merge,
 * as an ontology import is (services/ontologyImport.js). Before the merge its
 * Things are matched to the universe's by the builder's own rules, so nothing
 * comes in twice: a bank Thing by where it came from, a number, word or
 * operation by its name. Like any merge, it can't be undone.
 */
import useGraphStore from '../../../../../store/graphStore.js';
import {
  buildBankEquation, bankEquationThing, bankHomeOf, formulaStarterRoot, placeIn, bankOriginOf, reusedNameKey,
} from '../buildFormula.js';
import { spotBelow } from '../formulaPlacement.js';
import { equationOf } from '../formulaSnapshot.js';
import { formulaBankNow, loadFormulaBank } from './formulaBank.js';

// Between formulas stacked in a web, canvas units: a formula's band and title with room around.
const ROW = 520;

/**
 * What adding these disciplines would add to the open universe: the
 * equations of theirs it doesn't have yet, and how many concepts their
 * symbols stand for.
 * @returns {{ equations: number, already: number, concepts: number, entries: Array }}
 */
export function starterPlan(bank, disciplineIds) {
  if (!bank) return { equations: 0, already: 0, concepts: 0, entries: [] };
  const chosen = new Set(disciplineIds);
  const entries = bank.equations.filter(({ discipline }) => chosen.has(discipline.id));
  // Here already: its Thing is here, and reads as its formula (a Thing an import
  // linked to the same item, with no formula in it, gets one).
  const state = useGraphStore.getState();
  const fresh = entries.filter(({ equation }) => {
    const thing = bankEquationThing(equation);
    return !(thing && equationOf(state, thing));
  });
  const concepts = new Set(fresh.flatMap(({ equation }) => Object.values(equation.symbols || {})));
  return { equations: fresh.length, already: entries.length - fresh.length, concepts: concepts.size, entries: fresh };
}

/** Build these entries into the store this module's builder writes to. */
function buildEntries(entries, onProgress) {
  const skipped = [];
  let added = 0;
  const root = formulaStarterRoot();
  const next = new Map(); // web -> where its next formula goes
  entries.forEach(({ discipline, equation }, i) => {
    const { webId, disciplineProtoId } = bankHomeOf(discipline, equation);
    placeIn(root.protoId, disciplineProtoId);
    if (!next.has(webId)) next.set(webId, spotBelow(useGraphStore.getState(), webId));
    const at = next.get(webId);
    try {
      buildBankEquation(discipline, equation, webId, at);
      added++;
      next.set(webId, { x: at.x, y: at.y + ROW });
    } catch (err) {
      skipped.push({ title: equation.title, reason: err?.message || String(err) });
    }
    onProgress?.(i + 1, entries.length);
  });
  return { added, skipped, rootWebId: root.webId };
}

/**
 * Build these bank equations in this realm's store, which holds nothing else
 * (the worker's; a test's), and hand back its universe to be merged.
 * @returns {{ state: Object, added: number, skipped: Array, rootWebId: string }}
 */
export function buildStarterState(bank, equationIds, onProgress = null) {
  useGraphStore.getState().clearUniverse?.();
  const ids = new Set(equationIds);
  const result = buildEntries(bank.equations.filter(({ equation }) => ids.has(equation.id)), onProgress);
  const s = useGraphStore.getState();
  return {
    ...result,
    state: {
      graphs: s.graphs,
      nodePrototypes: s.nodePrototypes,
      edges: s.edges,
      edgePrototypes: s.edgePrototypes,
      // Only what it holds: none of its webs open, expanded or saved.
      openGraphIds: [],
      expandedGraphIds: new Set(),
      savedNodeIds: new Set(),
      savedGraphIds: new Set(),
      rightPanelTabs: [],
    },
  };
}

/**
 * The built starter, its Things matched to the open universe's: a bank Thing
 * by where it came from, a Thing the builder reuses by name (2, Multiplication,
 * sin) by that name. A web of a matched Thing (Thermodynamics, Physics,
 * Formulas) is that Thing's web here: what comes in goes under what is there,
 * and what is placed there already isn't placed twice.
 */
export function reconcileStarterState(incoming, live) {
  const liveByOrigin = new Map();
  const liveByName = new Map();
  for (const p of live.nodePrototypes.values()) {
    const origin = bankOriginOf(p);
    if (origin) liveByOrigin.set(origin, p.id);
    if (p.isOrbitCatalog) continue;
    const key = reusedNameKey(p.name || '');
    if (key && !liveByName.has(key)) liveByName.set(key, p.id);
  }
  // A Thing-group's Thing (an equation, a part in parentheses) is its own, whatever it is named.
  const grouped = new Set();
  for (const g of incoming.graphs.values()) for (const gr of g.groups?.values() || []) if (gr.linkedNodePrototypeId) grouped.add(gr.linkedNodePrototypeId);

  const protoMap = new Map();
  for (const p of incoming.nodePrototypes.values()) {
    if (live.nodePrototypes.has(p.id)) continue; // the same Thing already (the base Thing)
    const origin = bankOriginOf(p);
    if (origin) {
      if (liveByOrigin.has(origin)) protoMap.set(p.id, liveByOrigin.get(origin));
      continue;
    }
    if (grouped.has(p.id)) continue;
    const key = reusedNameKey(p.name || '');
    if (key && liveByName.has(key)) protoMap.set(p.id, liveByName.get(key));
  }
  const P = (id) => protoMap.get(id) || id;

  const graphMap = new Map();
  for (const [inId, liveId] of protoMap) {
    const inWeb = (incoming.nodePrototypes.get(inId)?.definitionGraphIds || []).find(id => incoming.graphs.has(id));
    const liveWeb = (live.nodePrototypes.get(liveId)?.definitionGraphIds || []).find(id => live.graphs.has(id));
    if (inWeb && liveWeb) graphMap.set(inWeb, liveWeb);
  }
  const G = (id) => graphMap.get(id) || id;

  const nodePrototypes = new Map();
  for (const p of incoming.nodePrototypes.values()) {
    const id = P(p.id);
    if (nodePrototypes.has(id)) continue;
    const chains = p.abstractionChains
      ? Object.fromEntries(Object.entries(p.abstractionChains).map(([dim, chain]) => [dim, Array.isArray(chain) ? chain.map(P) : chain]))
      : p.abstractionChains;
    nodePrototypes.set(id, {
      ...p, id,
      ...(p.typeNodeId ? { typeNodeId: P(p.typeNodeId) } : {}),
      definitionGraphIds: (p.definitionGraphIds || []).map(G),
      ...(chains ? { abstractionChains: chains } : {}),
    });
  }

  const dropped = new Set();
  const graphs = new Map();
  for (const g of incoming.graphs.values()) {
    const id = G(g.id);
    const here = live.graphs.get(id);
    const instances = new Map();
    for (const inst of g.instances?.values() || []) instances.set(inst.id, { ...inst, prototypeId: P(inst.prototypeId) });
    if (here) {
      // Placed there already: not again. Then under what is there.
      const placed = new Set([...here.instances.values()].filter(i => !i.isGroupAnchor).map(i => i.prototypeId));
      const inGroups = new Set([...(g.groups?.values() || [])].flatMap(gr => [...(gr.memberInstanceIds || []), gr.anchorInstanceId]));
      for (const inst of [...instances.values()]) {
        if (!inst.isGroupAnchor && !inGroups.has(inst.id) && placed.has(inst.prototypeId)) { instances.delete(inst.id); dropped.add(inst.id); }
      }
      if (instances.size) {
        const spot = spotBelow(live, id);
        let minX = Infinity, maxX = -Infinity, minY = Infinity;
        for (const inst of instances.values()) { minX = Math.min(minX, inst.x); maxX = Math.max(maxX, inst.x); minY = Math.min(minY, inst.y); }
        const dx = spot.x - (minX + maxX) / 2;
        const dy = spot.y - minY;
        for (const inst of instances.values()) { inst.x += dx; inst.y += dy; }
      }
    }
    const groups = new Map();
    for (const gr of g.groups?.values() || []) {
      groups.set(gr.id, {
        ...gr,
        ...(gr.linkedNodePrototypeId ? { linkedNodePrototypeId: P(gr.linkedNodePrototypeId) } : {}),
        memberInstanceIds: (gr.memberInstanceIds || []).filter(m => !dropped.has(m)),
      });
    }
    graphs.set(id, {
      ...g, id, instances, groups,
      definingNodeIds: (g.definingNodeIds || []).map(P),
      edgeIds: (g.edgeIds || []).filter(eid => {
        const e = incoming.edges.get(eid);
        return e && !dropped.has(e.sourceId) && !dropped.has(e.destinationId);
      }),
    });
  }

  const edges = new Map();
  for (const e of incoming.edges.values()) {
    if (dropped.has(e.sourceId) || dropped.has(e.destinationId)) continue;
    edges.set(e.id, { ...e, definitionNodeIds: (e.definitionNodeIds || []).map(P) });
  }

  return { ...incoming, nodePrototypes, graphs, edges, rootWebIdOf: G };
}

/** Fold a built starter into the open universe. Returns the merge's report, and where Formulas is. */
export function mergeFormulaStarter(built) {
  const st = useGraphStore.getState();
  const { rootWebIdOf, ...state } = reconcileStarterState(built.state, st);
  const report = st.mergeUniverseState(state, { foldSameAs: true });
  if (!report) throw new Error('The formula starter could not be added to this universe.');
  return { ...report, added: built.added, skipped: built.skipped, rootWebId: rootWebIdOf(built.rootWebId) };
}

const canUseWorker = () => typeof window !== 'undefined' && typeof Worker === 'function';

/** Build in the worker: { state, added, skipped, rootWebId }. */
function buildInWorker(bank, equationIds, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./formulaStarter.worker.js', import.meta.url), { type: 'module' });
    const done = (fn, value) => { worker.terminate(); fn(value); };
    worker.onmessage = ({ data }) => {
      if (data?.progress) onProgress?.(data.progress.done, data.progress.total);
      else if (data?.ok) done(resolve, data.built);
      else done(reject, new Error(data?.error || 'The formula starter could not be built.'));
    };
    worker.onerror = (e) => done(reject, new Error(e?.message || 'The formula starter could not be built.'));
    const { source, fetchedAt, from, disciplines, concepts } = bank;
    worker.postMessage({ bank: { source, fetchedAt, from, disciplines, concepts }, equationIds });
  });
}

/**
 * Add these disciplines' equations to the open universe: built in the worker,
 * then merged. Without a worker (Node, a test), built right in the store, as
 * one undo step. `save` saves the universe before and after, as an import does.
 * @returns {Promise<{ added: number, skipped: Array, rootWebId: string|null }>}
 */
export async function addFormulaStarter(disciplineIds, { onProgress = null, save = null } = {}) {
  const bank = formulaBankNow() || await loadFormulaBank();
  const plan = starterPlan(bank, disciplineIds);
  if (plan.entries.length === 0) return { added: 0, skipped: [], rootWebId: null };
  if (!canUseWorker()) {
    let result = null;
    useGraphStore.getState().withHistoryTransaction('Added the formula starter', () => { result = buildEntries(plan.entries, onProgress); });
    return result;
  }
  if (save) {
    try { await save(); } catch (e) { console.warn('[FormulaStarter] Save before adding failed (continuing):', e); }
  }
  const built = await buildInWorker(bank, plan.entries.map(({ equation }) => equation.id), onProgress);
  const result = mergeFormulaStarter(built);
  if (save) {
    try { await save(); } catch (e) { console.warn('[FormulaStarter] Save after adding failed:', e); }
  }
  return result;
}
