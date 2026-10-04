/**
 * The world — the Druid's hands on its universe.
 *
 * One adapter over the graph store that every v2 module uses, so none of them
 * reaches into the store's shape directly:
 *
 *   - reading: Things, webs, what is inside what, names
 *   - writing structure through the wizard's own tools (`act`), so names are
 *     resolved, duplicates reused and layout applied exactly as for a person's
 *     Wizard — then checked against the store (verifyWrite) before anything
 *     reports success
 *   - writing the Druid's own bookkeeping onto the Thing it describes
 *     (`semanticMetadata.druid`), which round-trips through .redstring files
 *   - the few webs the Druid keeps for itself (home, working memory, episodes,
 *     revisions), marked as such on their defining Thing
 *
 * `tools` are injected (executeTool, applyToolResult) so the module imports
 * nothing that touches the store at load time.
 */

import { graphStateFromStore } from './graphStateFromStore.js';
import { writeLanded } from './verifyWrite.js';
import { BASE_PROTOTYPE_IDS } from '../formats/userDataCounts.js';

const valuesOf = (c) => (c instanceof Map ? Array.from(c.values()) : Array.isArray(c) ? c : Object.values(c || {}));
const lower = (s) => String(s || '').trim().toLowerCase();

export function createWorld({ store, executeTool, applyToolResult, cid = 'druid' }) {
  const state = () => store.getState();

  const proto = (id) => state().nodePrototypes.get(id) || null;
  const graph = (id) => state().graphs.get(id) || null;
  const nameOf = (id) => proto(id)?.name || '';
  const druidOf = (id) => proto(id)?.semanticMetadata?.druid || {};

  /** Things placed in a web, as prototype ids (each once). */
  const thingsIn = (graphId) => {
    const g = graph(graphId);
    if (!g) return [];
    return [...new Set(valuesOf(g.instances).map(i => i.prototypeId))].filter(id => !BASE_PROTOTYPE_IDS.has(id));
  };

  /** The web that is the inside of a Thing (its first definition), if any. */
  const insideOf = (protoId) => {
    const ids = proto(protoId)?.definitionGraphIds || [];
    return ids.find(id => graph(id)) || null;
  };

  /** The Thing a web is the inside of, if any. */
  const ownerOf = (graphId) => (graph(graphId)?.definingNodeIds || []).find(id => proto(id)) || null;

  /** Webs a Thing is placed in. */
  const websOf = (protoId) => valuesOf(state().graphs)
    .filter(g => valuesOf(g.instances).some(i => i.prototypeId === protoId))
    .map(g => g.id);

  /** Find a Thing by name — the LAST match, so a current one beats an old one. */
  const findThing = (name) => {
    const want = lower(name);
    let hit = null;
    for (const p of state().nodePrototypes.values()) if (lower(p.name) === want) hit = p.id;
    return hit;
  };

  /** Write the Druid's bookkeeping onto a Thing. `patch` is merged; a function patch receives the current value. */
  const setDruid = (protoId, patch) => {
    if (!proto(protoId)) return false;
    store.getState().updateNodePrototype(protoId, (draft) => {
      const sm = draft.semanticMetadata && typeof draft.semanticMetadata === 'object' ? draft.semanticMetadata : {};
      const current = sm.druid && typeof sm.druid === 'object' ? sm.druid : {};
      const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      draft.semanticMetadata = { ...sm, druid: next };
    });
    return true;
  };

  /**
   * Run a wizard tool, apply it, and verify it landed.
   * @returns {{ ok: boolean, result?: Object, error?: string }}
   */
  const act = async (toolName, args) => {
    let result;
    try {
      result = await executeTool(toolName, args, graphStateFromStore(state()), cid, () => {});
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
    if (!result || result.error) return { ok: false, error: result?.error || 'no result', result };
    applyToolResult(toolName, result, `druid-${Date.now()}`, cid);
    if (writeLanded(toolName, result, state()) === false) {
      return { ok: false, error: `${toolName} reported success but nothing changed in the graph`, result };
    }
    return { ok: true, result };
  };

  /** Make a web the active one, so tools that default to it act there. */
  const focusWeb = (graphId) => {
    if (!graphId || !graph(graphId) || state().activeGraphId === graphId) return;
    // setActiveGraph only switches among open webs and otherwise falls back to
    // the first one, so a web not yet open is opened: in the app, the canvas
    // goes where the Druid looks.
    if ((state().openGraphIds || []).includes(graphId) || !state().openGraphTab) state().setActiveGraph(graphId);
    else state().openGraphTab(graphId, ownerOf(graphId) || null);
  };

  /** Place a Thing in a web (no-op if it is already there). Returns the instance id. */
  const place = (graphId, protoId) => {
    const g = graph(graphId);
    if (!g || !proto(protoId)) return null;
    const existing = valuesOf(g.instances).find(i => i.prototypeId === protoId);
    if (existing) return existing.id;
    const n = valuesOf(g.instances).length;
    const id = `druid-inst-${protoId}-${graphId}`.slice(0, 120);
    state().addNodeInstance(graphId, protoId, { x: 120 + (n % 5) * 220, y: 120 + Math.floor(n / 5) * 160 }, id);
    return valuesOf(graph(graphId)?.instances).find(i => i.prototypeId === protoId)?.id || null;
  };

  /** Remove a Thing's placement from a web (the Thing itself stays). */
  const unplace = (graphId, protoId) => {
    const g = graph(graphId);
    if (!g) return;
    for (const inst of valuesOf(g.instances)) {
      if (inst.prototypeId === protoId) state().removeNodeInstance(graphId, inst.id);
    }
  };

  /**
   * A web the Druid keeps for itself, found by its marker and created once.
   * The active web is restored afterwards: making one is not looking at it.
   */
  const systemWeb = (key, name, description = '') => {
    for (const p of state().nodePrototypes.values()) {
      if (p.semanticMetadata?.druid?.system === key) {
        const g = (p.definitionGraphIds || []).find(id => graph(id));
        if (g) return g;
      }
    }
    const before = state().activeGraphId;
    const before2 = [...(state().openGraphIds || [])];
    const graphId = `druid-${key}-${Date.now().toString(36)}`;
    state().createNewGraph({ id: graphId, name, description });
    const owner = ownerOf(graphId);
    if (owner) setDruid(owner, { system: key });
    if (before && graph(before)) state().setActiveGraph(before);
    // Keep the person's tabs as they were.
    if (state().closeGraphTab && !before2.includes(graphId)) state().closeGraphTab(graphId);
    return graphId;
  };

  /** A web marked as one of the Druid's own (not long-term memory content). */
  const isSystemWeb = (graphId) => !!druidOf(ownerOf(graphId) || '').system;

  /** Create a Thing in a web via the wizard tool; returns its prototype id. */
  const createThing = async (graphId, name, { description = '', typeNodeId = null, fresh = false } = {}) => {
    // `fresh`: the caller means a NEW Thing. Same name in the same web would
    // silently reuse the old one ("made Creative network" — again).
    if (fresh) {
      const here = valuesOf(graph(graphId)?.instances).map(i => i.prototypeId).find(pid => lower(nameOf(pid)) === lower(name));
      if (here) return { ok: false, error: `${nameOf(here)} is already here; name the new one differently` };
    }
    // In Redstring the same name is the same Thing, so a new Thing named like
    // one of the Druid's kinds of thought would BE that kind: "open up
    // Connection: Episode" put the Episode role type inside Connection.
    const clash = findThing(name);
    if (clash && (druidOf(clash).roleType || druidOf(clash).system)) {
      return { ok: false, error: `"${name}" is the name of one of your own kinds of thought; choose another name` };
    }
    // Its own webs (episodes, working memory) are written without looking at them.
    if (!isSystemWeb(graphId)) focusWeb(graphId);
    const r = await act('createNode', { name, description, ...(graphId ? { targetGraphId: graphId } : {}), ...(typeNodeId ? { typeNodeId } : {}) });
    if (!r.ok) return { ok: false, error: r.error };
    const id = valuesOf(graph(graphId)?.instances)
      .map(i => i.prototypeId)
      .filter(pid => lower(nameOf(pid)) === lower(name))
      .pop() || findThing(name);
    // Who made it decides what kind of evidence it is: a Thing someone else
    // made is an observation; one the Druid made is its own inference.
    if (id && api.actor && !druidOf(id).madeBy) setDruid(id, { madeBy: api.actor });
    return { ok: !!id, id, error: id ? null : 'created but not found' };
  };

  /** Connect two Things placed in the same web. */
  const connect = async (graphId, aId, bId, relation) => {
    if (!isSystemWeb(graphId)) focusWeb(graphId);
    return act('createEdge', { sourceId: nameOf(aId), targetId: nameOf(bId), type: relation || 'relates to', targetGraphId: graphId });
  };

  /** Give a Thing an inside (empty web) if it has none; returns the web id. */
  const ensureInside = (protoId) => {
    const existing = insideOf(protoId);
    if (existing) return existing;
    const before = state().activeGraphId;
    const id = state().createAndAssignGraphDefinitionWithoutActivation(protoId);
    if (before && graph(before)) state().setActiveGraph(before);
    return id;
  };

  /** Connections in a web, as { a, b, relation } over prototype ids. */
  const linksIn = (graphId) => {
    const g = graph(graphId);
    if (!g) return [];
    const protoOf = new Map(valuesOf(g.instances).map(i => [i.id, i.prototypeId]));
    return (g.edgeIds || []).map(id => state().edges.get(id)).filter(Boolean).map(e => ({
      id: e.id,
      a: protoOf.get(e.sourceId),
      b: protoOf.get(e.destinationId),
      relation: e.name || nameOf((e.definitionNodeIds || [])[0]) || e.type || 'connected'
    })).filter(l => l.a && l.b);
  };

  /** The is-a chain above a Thing, nearest first (stops on cycles). */
  const typeChain = (protoId) => {
    const out = [];
    const seen = new Set([protoId]);
    let t = proto(protoId)?.typeNodeId;
    while (t && !seen.has(t) && proto(t)) {
      out.push(t);
      seen.add(t);
      t = proto(t)?.typeNodeId;
    }
    return out;
  };

  /** Things whose type is `typeId` directly. */
  const membersOf = (typeId) => valuesOf(state().nodePrototypes).filter(p => p.typeNodeId === typeId).map(p => p.id);

  /** All user Things (not base types, not the Druid's system web owners). */
  const allThings = () => valuesOf(state().nodePrototypes)
    .filter(p => !BASE_PROTOTYPE_IDS.has(p.id) && !p.semanticMetadata?.druid?.system && p.name)
    .map(p => p.id);

  /** Every Thing, the Druid's own included (episodes, scratch, role types). */
  const allThingsIncludingSystem = () => valuesOf(state().nodePrototypes)
    .filter(p => !BASE_PROTOTYPE_IDS.has(p.id) && p.name)
    .map(p => p.id);

  const api = {
    /** Set while the Druid is living, so what it makes is marked as its own. */
    actor: null,
    state, proto, graph, nameOf, druidOf, setDruid,
    thingsIn, insideOf, ownerOf, websOf, findThing, linksIn, typeChain, membersOf, allThings, allThingsIncludingSystem,
    act, focusWeb, place, unplace, systemWeb, isSystemWeb, createThing, connect, ensureInside
  };
  return api;
}
