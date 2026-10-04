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
import { DEFAULT_ABSTRACTION_DIMENSION, THING_PROTOTYPE_ID, isSeededChain, seededChainFor } from '../wizard/tools/utils/abstractionSpec.js';
import { shortName, normalizeName, wordsIn, readsAsName, hasVerb, MAX_NAME_WORDS, aboutTheMedium, looksLikeQuality, isAspect } from './names.js';

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
    // Never enriched from Wikipedia: the Wizard's apply path fills a Thing that
    // has no description yet with an article's text and picture, which landed
    // before the Druid wrote its own and pulled names off toward the article.
    applyToolResult(toolName, { ...result, enrich: false }, `druid-${Date.now()}`, cid);
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
        if (g) { shelve(g); return g; }
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
    shelve(graphId);
    return graphId;
  };

  /** The Druid's Home web, found by its marker (roles.js makes it). */
  const homeWeb = () => {
    for (const p of state().nodePrototypes.values()) {
      if (p.semanticMetadata?.druid?.homeOf) {
        const g = (p.definitionGraphIds || []).find(id => graph(id));
        if (g) return g;
      }
    }
    return null;
  };

  /**
   * Where a web the Druid keeps hangs, so it can be found by opening Home: a
   * day's episodes in the Diary, the Diary and its other own webs in Home, and
   * the webs it starts in Home too. A web whose Thing sits in no web can only
   * be found through a tab; in a person's DruidTest universe 9 of 15 webs could
   * not be reached from Home, Working Memory and the episodes among them.
   */
  const shelfFor = (graphId) => {
    const d = druidOf(ownerOf(graphId) || '');
    if (d.homeOf) return null;
    if (String(d.system || '').startsWith('episodes-')) return systemWeb('diary', 'Diary', 'Each day the Druid has lived, and what happened in it.');
    return homeWeb();
  };

  /** Put a web's Thing on its shelf if it sits nowhere yet. Returns whether it moved. */
  const shelve = (graphId) => {
    const owner = ownerOf(graphId);
    if (!owner || websOf(owner).length) return false;
    const shelf = shelfFor(graphId);
    if (!shelf || shelf === graphId) return false;
    return !!place(shelf, owner);
  };

  /** Shelve every web the Druid keeps or started that sits nowhere. Returns how many moved. */
  const shelveAll = () => {
    let n = 0;
    for (const g of valuesOf(state().graphs)) {
      const d = druidOf(ownerOf(g.id) || '');
      if ((d.system || d.topic || d.madeBy === 'druid') && shelve(g.id)) n++;
    }
    return n;
  };

  /** A web marked as one of the Druid's own (not long-term memory content). */
  const isSystemWeb = (graphId) => !!druidOf(ownerOf(graphId) || '').system;

  /** Create a Thing in a web via the wizard tool; returns its prototype id. */
  const createThing = async (givenGraphId, givenName, { description: givenDescription = '', typeNodeId = null, fresh = false, asPart = true, reuse = true } = {}) => {
    let graphId = givenGraphId;
    // A name is a handle; a sentence given as one keeps its words in the
    // description (names.js). Every way of making a Thing comes through here.
    // A long one is put to the name gate, a contextless helper call
    // (mind/helpers.js), when there is one; code decides when it has nothing.
    let name = shortName(givenName);
    // A sentence passing as a name is put to the gate too, long or not:
    // "Volcanoes are fireholes in the earth." was kept as a Thing's name.
    // So is a short one with a verb in it: "Gluons are particles".
    const sentenceLike = (/[.!?]$/.test(String(givenName || '').trim()) && wordsIn(givenName).length >= 4)
      || (wordsIn(givenName).length >= 3 && hasVerb(givenName) && !readsAsName(givenName));
    if (api.nameGate && (wordsIn(givenName).length > MAX_NAME_WORDS || sentenceLike)) {
      const verdict = await api.nameGate(String(givenName).trim()).catch(() => null);
      if (verdict?.kind === 'name') name = wordsIn(givenName).join(' ');
      else if (verdict?.kind === 'sentence') name = verdict.short;
    }
    const description = name === String(givenName || '').trim()
      ? givenDescription
      : [`${String(givenName).trim().replace(/[.!?]*$/, '.')}`, givenDescription].filter(Boolean).join(' ');
    // `fresh`: the caller means a NEW Thing. Same name in the same web would
    // silently reuse the old one ("made Creative network" — again).
    if (fresh) {
      const here = valuesOf(graph(graphId)?.instances).map(i => i.prototypeId).find(pid => normalizeName(nameOf(pid)) === normalizeName(name));
      if (here) return { ok: false, error: `${nameOf(here)} is already here; name the new one differently` };
    }
    // In Redstring the same name is the same Thing, so a new Thing named like
    // one of the Druid's kinds of thought would BE that kind: "open up
    // Connection: Episode" put the Episode role type inside Connection.
    // Not about this place itself, unless the person asked about it (names.js).
    if (api.actor && !isSystemWeb(graphId) && aboutTheMedium(name, api.personWords)) {
      return { ok: false, error: `"${name}" is about this place itself, not the world; name something in the world` };
    }
    // A Thing, not an aspect of one: "Composition", "Role of outer layers".
    if (api.actor && !typeNodeId && !isSystemWeb(graphId) && isAspect(name)) {
      return { ok: false, error: `"${name}" is an aspect of something, not a Thing; name the Thing itself` };
    }
    // A thing, not a quality: "Dark", "Gravitational" as parts of dark matter.
    if (api.actor && !typeNodeId && !isSystemWeb(graphId) && looksLikeQuality(name) && !sameNamed(name)) {
      const quality = api.isQuality ? await api.isQuality(name).catch(() => null) : null;
      if (quality === true) return { ok: false, error: `"${name}" describes a quality; name the thing it describes` };
    }
    // Not about knowing in general, in a web about something (mind/helpers.js aboutKnowing).
    if (api.actor && api.aboutKnowing && !typeNodeId && !isSystemWeb(graphId)) {
      const subject = topicOf(graphId);
      const said = wordsIn(lower(name)).some(w => api.personWords?.has(w));
      if (subject && lower(subject) !== lower(name) && !said && (await api.aboutKnowing(name, subject).catch(() => null)) === true) {
        return { ok: false, error: `"${name}" is about knowing in general, not about ${subject}; keep to ${subject}` };
      }
    }
    const clash = findThing(name);
    if (clash && (druidOf(clash).roleType || druidOf(clash).system)) {
      return { ok: false, error: `"${name}" is the name of one of your own kinds of thought; choose another name` };
    }
    // An inside holds what its Thing is made of. Asked "is Footwear a part of
    // Floor?" before placing it there; if not, it goes one level out, into a
    // web the Thing itself sits in. Left alone, a Druid's insides filled with
    // whatever it was thinking about while standing in them.
    let movedOut = false;
    const owner = ownerOf(graphId);
    // Nothing goes inside itself: in Redstring the same name is the same
    // Thing, so "keep Tutorial" while standing inside Tutorial placed it there.
    if (owner && lower(nameOf(owner)) === lower(name)) return { ok: false, error: `${name} cannot go inside itself` };
    // Nor inside its own parts: "Pluto" was kept inside Pluto › Ice › Oxygen.
    const topic = api.actor && !isSystemWeb(graphId) && owner && !druidOf(owner).topic ? topicOf(graphId) : null;
    if (topic && normalizeName(topic) === normalizeName(name)) return { ok: false, error: `${name} is what this whole web is about; it does not go inside one of its parts` };
    if (asPart && (api.isPart || api.check) && owner && !isOwnThinking(owner) && !druidOf(owner).topic && !(typeNodeId && isOwnThinking(typeNodeId))) {
      // Out only to a web of content: not Home, nor a goal's or plan's inside.
      const outer = websOf(owner).find(w => w !== graphId && !isSystemWeb(w) && !isOwnWeb(w));
      if (lower(name) !== lower(nameOf(owner))) {
        const verdict = await isPartOf(name, nameOf(owner));
        if (verdict === false && outer) { graphId = outer; movedOut = true; }
        else if (verdict === false) return { ok: false, error: `${name} is not a part of ${nameOf(owner)}` };
      }
    }
    // Its own webs (episodes, working memory) are written without looking at them.
    if (!isSystemWeb(graphId)) focusWeb(graphId);
    // The same name is the same Thing: one already in the universe is placed
    // here, not made again. Made again, "Water droplets" inside Clouds and
    // inside Cloud were two Things, and the structures never met.
    // A new Thing ("fresh") is still the one of that name elsewhere: made
    // again, Proton and Protons were two Things. Only here is it refused.
    const known = api.actor && reuse && !typeNodeId && !isSystemWeb(graphId) ? sameNamed(name) : null;
    if (known) {
      if (owner && containsThing(known, owner)) return { ok: false, error: `${nameOf(known)} cannot go inside ${nameOf(owner)}: ${nameOf(owner)} is already inside it` };
      place(graphId, known);
      if (api.actor && !druidOf(known).madeBy && !proto(known)?.description && description) await act('updateNode', { nodeName: nameOf(known), description, targetGraphId: graphId });
      return { ok: true, id: known, web: graphId, movedOut, reused: true };
    }
    const r = await act('createNode', { name, description, ...(graphId ? { targetGraphId: graphId } : {}), ...(typeNodeId ? { typeNodeId } : {}) });
    if (!r.ok) return { ok: false, error: r.error };
    const id = valuesOf(graph(graphId)?.instances)
      .map(i => i.prototypeId)
      .filter(pid => lower(nameOf(pid)) === lower(name))
      .pop() || findThing(name);
    // Who made it decides what kind of evidence it is: a Thing someone else
    // made is an observation; one the Druid made is its own inference.
    if (id && api.actor && !druidOf(id).madeBy) setDruid(id, { madeBy: api.actor });
    return { ok: !!id, id, web: graphId, movedOut, error: id ? null : 'created but not found' };
  };

  /**
   * What a web is about: the name of the web it hangs from at the top (a web
   * the Druid started, or any web not inside another), walking up through
   * insides. Null for Home and its own places.
   */
  const topicOf = (graphId, seen = new Set()) => {
    if (!graphId || seen.has(graphId) || isSystemWeb(graphId)) return null;
    seen.add(graphId);
    const owner = ownerOf(graphId);
    const d = druidOf(owner || '');
    if (!owner || d.topic) return graph(graphId)?.name || null;
    if (d.homeOf || d.roleType || isOwnThinking(owner)) return null;
    const up = websOf(owner).find(w => w !== graphId && !isSystemWeb(w) && !druidOf(ownerOf(w) || '').homeOf);
    return up ? topicOf(up, seen) : graph(graphId)?.name || null;
  };

  /**
   * X is a kind of K, kept as a ladder: the carousel shows a Thing's kinds as
   * one chain from specific to general (Up quark › Quarks › Particles), and a
   * Thing has one type, so a second kind used to replace the first. A more
   * general kind goes above the one it has, a more specific one in between,
   * each where the check agrees; unrelated kinds are refused, not overwritten.
   * Without a check (tests, scripts), the new kind replaces the old.
   */
  const addKind = async (x, k) => {
    if (!proto(x) || !proto(k) || x === k) return { ok: false, error: `${nameOf(x)} is not a kind of itself` };
    if (typeChain(k).includes(x)) return { ok: false, error: `${nameOf(k)} is already a kind of ${nameOf(x)}` };
    if (typeChain(x).includes(k)) return { ok: false, already: true, error: `${nameOf(x)} is already a kind of ${nameOf(k)}` };
    const t = proto(x)?.typeNodeId;
    if (!t || BASE_PROTOTYPE_IDS.has(t) || !proto(t) || !api.check) {
      state().setNodeType(x, k);
    } else {
      const says = async (a, b) => (await isKindOf(nameOf(a), nameOf(b))) === true;
      if (await says(t, k)) {
        const r = await addKind(t, k);
        if (!r.ok && !r.already) return r;
      } else if (await says(k, t)) {
        const r = await addKind(k, t);
        if (!r.ok && !r.already) return r;
        state().setNodeType(x, k);
      } else {
        return { ok: false, error: `${nameOf(x)} is already a kind of ${nameOf(t)}, and ${nameOf(k)} is neither above nor below ${nameOf(t)}` };
      }
    }
    writeLadders();
    return { ok: true };
  };

  /**
   * Each Thing with a ladder of two kinds or more gets it as its carousel
   * chain ([Thing, its kind, that one's kind, …, Thing]). Only chains still as
   * seeding wrote them, or as the Druid wrote them: a chain a person built is theirs.
   */
  const writeLadders = () => {
    // Only the most specific Thing owns a ladder: a rung that owned its own
    // shorter one would be shown that instead (the carousel prefers a Thing's
    // own chain to one it is a rung of).
    const rungs = new Set();
    for (const p of valuesOf(state().nodePrototypes)) for (const t of typeChain(p.id)) rungs.add(t);
    for (const p of valuesOf(state().nodePrototypes)) {
      if (BASE_PROTOTYPE_IDS.has(p.id)) continue;
      if (rungs.has(p.id)) {
        if (druidOf(p.id).ladder) {
          state().updateNodePrototype(p.id, (draft) => {
            const seeded = seededChainFor(p.id, draft.typeNodeId);
            draft.abstractionChains = { ...(draft.abstractionChains || {}), [DEFAULT_ABSTRACTION_DIMENSION]: seeded || [p.id] };
          });
          setDruid(p.id, { ladder: false });
        }
        continue;
      }
      const kinds = typeChain(p.id).filter(t => !BASE_PROTOTYPE_IDS.has(t));
      if (kinds.length < 2) continue;
      const ladder = [p.id, ...kinds, THING_PROTOTYPE_ID];
      const current = p.abstractionChains?.[DEFAULT_ABSTRACTION_DIMENSION];
      if (current && current.join() === ladder.join()) continue;
      if (current && !isSeededChain(p, current) && !druidOf(p.id).ladder) continue;
      state().updateNodePrototype(p.id, (draft) => {
        draft.abstractionChains = { ...(draft.abstractionChains || {}), [DEFAULT_ABSTRACTION_DIMENSION]: ladder };
      });
      setDruid(p.id, { ladder: true });
    }
  };

  /** Home, or the inside of one of its goals, plans or role types. */
  const isOwnWeb = (graphId) => {
    const o = ownerOf(graphId);
    if (!o) return false;
    const d = druidOf(o);
    return !!(d.homeOf || d.step || isOwnThinking(o));
  };

  /**
   * How deep a web sits below the web it hangs from: 0 for a web it started,
   * 1 for the inside of a Thing in it, and so on. The path a Druid walked does
   * not say this (going to a Thing resets it); the nesting does.
   */
  const depthOf = (graphId, seen = new Set()) => {
    if (!graphId || seen.has(graphId)) return 0;
    seen.add(graphId);
    const owner = ownerOf(graphId);
    if (!owner || druidOf(owner).topic || druidOf(owner).homeOf) return 0;
    const up = websOf(owner).filter(w => w !== graphId && !isSystemWeb(w) && !isOwnWeb(w));
    return up.length ? 1 + Math.min(...up.map(w => depthOf(w, new Set(seen)))) : 0;
  };

  /** Is `a` a kind of `b`? The kind helper when there is one (mind/helpers.js kindOf), else the general check. */
  const isKindOf = async (a, b) => {
    if (api.isKind) return api.isKind(a, b).catch(() => null);
    if (api.check) return api.check(`${a} is a kind of ${b}`).catch(() => null);
    return null;
  };

  /** Is `part` a part of `whole`? The made-of helper when there is one (mind/helpers.js madeOf), else the general check. */
  const isPartOf = async (part, whole) => {
    if (api.isPart) return api.isPart(part, whole).catch(() => null);
    if (api.check) return api.check(`${part} is a part of ${whole}`).catch(() => null);
    return null;
  };

  /** A Thing to think with already named like this (plural and case aside): never its own apparatus. */
  const sameNamed = (name) => {
    const want = normalizeName(name);
    let hit = null;
    for (const p of state().nodePrototypes.values()) {
      if (BASE_PROTOTYPE_IDS.has(p.id) || !p.name || normalizeName(p.name) !== want) continue;
      const d = p.semanticMetadata?.druid || {};
      if (d.system || d.homeOf || d.roleType || d.topic || d.relation || isOwnThinking(p.id)) continue;
      hit = p.id;
    }
    return hit;
  };

  /** Whether `inner` sits somewhere inside `outer`'s inside, at any depth. */
  const containsThing = (outer, inner, seen = new Set()) => {
    if (outer === inner) return true;
    if (seen.has(outer)) return false;
    seen.add(outer);
    const ins = insideOf(outer);
    return !!ins && thingsIn(ins).some(t => containsThing(t, inner, seen));
  };

  /** The Druid's own apparatus (role types, goals, plans, beliefs, episodes, its system webs), not a Thing it thinks about. */
  const isOwnThinking = (id) => {
    const d = druidOf(id);
    return !!(d.roleType || d.system || d.homeOf || typeChain(id).some(t => druidOf(t).roleType));
  };

  /** Connect two Things placed in the same web. */
  /**
   * @param {Object} [opts]
   * @param {boolean} [opts.fromSentence]  the relation came out of a whole sentence the Druid wrote
   *   ("Bones support the feet"): it meant something, so the sense check is skipped. Checked
   *   alone, good sentences were refused two times in five.
   */
  const connect = async (graphId, aId, bId, relation, { fromSentence = false } = {}) => {
    if (aId === bId) return { ok: false, error: `${nameOf(aId)} is not connected to itself` };
    if (!isSystemWeb(graphId)) focusWeb(graphId);
    let rel = sameRelation(relation || 'relates to');
    // Asked before writing: does "Floor sit Footwear" make sense? (A helper
    // asked this one question got 12 of 12 from one Druid's own links.) And
    // is it a relation already in use under other words ("composed of" →
    // "made of")? Its own bookkeeping ("then", "is about") is not asked.
    if (api.check && !isOwnThinking(aId) && !isOwnThinking(bId)) {
      const sense = fromSentence ? true : await api.check(`${nameOf(aId)} ${rel} ${nameOf(bId)}`).catch(() => null);
      if (sense === false) return { ok: false, error: `"${nameOf(aId)} ${rel} ${nameOf(bId)}" does not make sense, so nothing was connected` };
      if (api.sameRelationAs && rel === (relation || 'relates to')) {
        const same = await api.sameRelationAs(rel, relationsInUse()).catch(() => null);
        if (same) rel = relationsInUse().find(r => lower(r) === lower(same)) || same;
      }
    }
    const typesBefore = relationTypeIds();
    const r = await act('createEdge', { sourceId: nameOf(aId), targetId: nameOf(bId), type: rel, targetGraphId: graphId });
    // A relation type this made is the Druid's, so sleep may prune it once nothing uses it.
    if (r.ok) for (const id of relationTypeIds()) if (!typesBefore.has(id) && proto(id)) setDruid(id, { relation: true, ...(api.actor ? { madeBy: api.actor } : {}) });
    return r.ok ? { ...r, relation: rel } : r;
  };

  /** Prototypes that connections are made of (their relation types). */
  const relationTypeIds = () => new Set([...state().edges.values()].flatMap(e => e.definitionNodeIds || []));

  /** Every relation in use, by how often, most used first. */
  const relationsInUse = () => {
    const count = new Map();
    for (const e of state().edges.values()) {
      const r = e.name || nameOf((e.definitionNodeIds || [])[0]) || '';
      if (r) count.set(r, (count.get(r) || 0) + 1);
    }
    return [...count.entries()].sort((x, y) => y[1] - x[1]).map(([r]) => r);
  };

  /**
   * A relation already in use under another spelling ("Connects" for
   * "connect"), so the vocabulary does not drift: one long run made Connect,
   * Connects, Contains and Includes, each its own type.
   */
  const sameRelation = (relation) => {
    const want = normalizeName(relation);
    return relationsInUse().find(r => normalizeName(r) === want) || relation;
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

  /**
   * Delete a Thing the Druid no longer needs, with the Things inside it that
   * live nowhere else. Deleting a Thing deletes its inside web, but the Things
   * placed there would be left in no web at all.
   */
  const forget = (protoId) => {
    if (!proto(protoId)) return false;
    const inside = insideOf(protoId);
    if (inside) {
      for (const id of thingsIn(inside)) {
        if (id !== protoId && websOf(id).every(w => w === inside)) forget(id);
      }
    }
    state().deleteNodePrototype(protoId);
    return !proto(protoId);
  };

  /**
   * Move a Thing from one web to another, taking along each connection whose
   * other end is also in the destination; the rest cannot be drawn there and
   * are dropped. Returns { kept, dropped }. Unplacing alone silently took a
   * moved Thing's connections with it.
   */
  const move = async (fromWeb, toWeb, protoId) => {
    const links = linksIn(fromWeb).filter(l => l.a === protoId || l.b === protoId);
    place(toWeb, protoId);
    const there = new Set(thingsIn(toWeb));
    const already = new Set(linksIn(toWeb).map(l => `${l.a}|${lower(l.relation)}|${l.b}`));
    let kept = 0;
    for (const l of links) {
      const other = l.a === protoId ? l.b : l.a;
      if (!there.has(other) || already.has(`${l.a}|${lower(l.relation)}|${l.b}`)) continue;
      const r = await act('createEdge', { sourceId: nameOf(l.a), targetId: nameOf(l.b), type: l.relation, targetGraphId: toWeb });
      if (r.ok) kept++;
    }
    unplace(fromWeb, protoId);
    return { kept, dropped: links.length - kept };
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
    /** Words the person seeded or said (lowercased): what they ask about is never refused as being about this place. */
    personWords: new Set(),
    /** async (longName) → { kind: 'name' } | { kind: 'sentence', short } | null (mind/helpers.js nameGate). */
    nameGate: null,
    /** async (statement) → true | false | null: does it make sense? (mind/helpers.js plausible). */
    check: null,
    /** async (part, whole) → true | false | null: is the whole made of it? (mind/helpers.js madeOf). */
    isPart: null,
    /** async (a, b) → true | false | null: is a a kind of b? (mind/helpers.js kindOf). */
    isKind: null,
    /** async (term, subject) → true when the term is about knowing in general (mind/helpers.js aboutKnowing). */
    aboutKnowing: null,
    /** async (word) → true when a one-word name is a quality, not a thing (mind/helpers.js isQuality). */
    isQuality: null,
    /** async (relation, inUse) → an existing relation meaning the same | null (mind/helpers.js sameRelation). */
    sameRelationAs: null,
    state, proto, graph, nameOf, druidOf, setDruid,
    thingsIn, insideOf, ownerOf, websOf, findThing, linksIn, typeChain, membersOf, allThings, allThingsIncludingSystem,
    act, focusWeb, place, unplace, isPartOf, isKindOf, topicOf, depthOf, addKind, writeLadders, systemWeb, isSystemWeb, homeWeb, shelve, shelveAll, createThing, connect, ensureInside, relationsInUse, relationTypeIds, forget, isOwnThinking, move
  };
  return api;
}
