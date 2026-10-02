/**
 * Recall — what surfaces from the graph on its own.
 *
 * The Druid can search its graph deliberately with tools, but deliberate
 * search only finds what it already knows to look for. Each cycle this module
 * also hands it a few memories it did not ask for: Things associated with what
 * it is currently thinking about, by spreading activation over the graph.
 *
 *   1. The cue (working memory + last thought) activates the Things whose names
 *      and descriptions it mentions.
 *   2. Activation spreads one step along the graph's own structure: across
 *      connections, from a Thing to the web that defines it, and from a web to
 *      the Thing it is the inside of.
 *   3. What the cue named outright is already in mind, so it is a SOURCE of
 *      activation but is not handed back. What comes back is adjacent to it.
 *
 * Nothing here knows any category. The graph's shape is whatever the Druid
 * made it, and recall follows that shape, so a better-organized memory recalls
 * better without this module changing.
 *
 * `wander` is the other half: when the Druid has been going in circles, one
 * memory surfaces at random — a perturbation from outside its current train of
 * thought, the only kind a loop with no person in it can get.
 *
 * Pure functions over the store's state; Maps or arrays both accepted.
 */

import { BASE_PROTOTYPE_IDS } from '../formats/userDataCounts.js';

const STOP = new Set(('the and for are but not you all any can had her was one our out day get has him his how '
  + 'its may new now old see two way who did let put say she too use that this with have from they will would '
  + 'there their what about which when your into than then them these some could other more also just like '
  + 'been were being only over such very what where while each most much must should here thing things '
  + 'think thought want next still already because something nothing').split(' '));

/** Lower-case content words of three or more letters. */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9À-ɏ]+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
}

const valuesOf = (c) => (c instanceof Map ? Array.from(c.values()) : Array.isArray(c) ? c : Object.values(c || {}));
const getFrom = (c, id) => (c instanceof Map ? c.get(id) : Array.isArray(c) ? c.find(x => x?.id === id) : c?.[id]);

/**
 * Index the graph for recall. Cheap enough to rebuild every cycle at the sizes
 * a single universe reaches; rebuilding means recall always sees the graph the
 * Druid just wrote.
 *
 * @param {Object} state  graph store state (graphs, nodePrototypes, edges)
 * @returns {{ nodes: Map, links: Map }}
 */
export function buildMemoryIndex(state) {
  const nodes = new Map();
  const links = new Map();

  const ensure = (proto) => {
    if (!proto || BASE_PROTOTYPE_IDS.has(proto.id)) return null;
    let n = nodes.get(proto.id);
    if (!n) {
      const name = String(proto.name || '').trim();
      if (!name) return null;
      const description = String(proto.description || '').trim();
      n = {
        id: proto.id,
        name,
        description,
        nameTokens: new Set(tokenize(name)),
        descTokens: new Set(tokenize(description)),
        webs: new Set()
      };
      nodes.set(proto.id, n);
    }
    return n;
  };
  const link = (a, b, via) => {
    if (!a || !b || a === b) return;
    if (!links.has(a)) links.set(a, new Map());
    if (!links.has(b)) links.set(b, new Map());
    if (!links.get(a).has(b)) links.get(a).set(b, via);
    if (!links.get(b).has(a)) links.get(b).set(a, via);
  };

  for (const graph of valuesOf(state?.graphs)) {
    const protoOfInstance = new Map();
    const members = [];
    for (const inst of valuesOf(graph.instances)) {
      const n = ensure(getFrom(state.nodePrototypes, inst.prototypeId));
      if (!n) continue;
      protoOfInstance.set(inst.id, n.id);
      members.push(n.id);
      if (graph.name) n.webs.add(graph.name);
    }

    // A web's defining Thing is linked to everything inside it: the whole
    // recalls its parts and a part recalls its whole.
    for (const definingId of graph.definingNodeIds || []) {
      const whole = ensure(getFrom(state.nodePrototypes, definingId));
      if (!whole) continue;
      for (const part of members) link(whole.id, part, `inside ${whole.name}`);
    }

    for (const edgeId of graph.edgeIds || []) {
      const edge = getFrom(state.edges, edgeId);
      if (!edge) continue;
      const a = protoOfInstance.get(edge.sourceId);
      const b = protoOfInstance.get(edge.destinationId);
      const relation = edge.name
        || getFrom(state.nodePrototypes, (edge.definitionNodeIds || [])[0])?.name
        || edge.type
        || 'connected';
      link(a, b, relation);
    }
  }

  return { nodes, links };
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/**
 * Spreading-activation recall.
 *
 * @param {{ nodes: Map, links: Map }} index
 * @param {string} cue
 * @param {Object} [opts]
 * @param {number} [opts.k=6]               how many memories to return
 * @param {number} [opts.spread=0.6]        share of activation passed to a neighbour
 * @param {Set<string>} [opts.habituated]   ids surfaced recently; damped, not barred
 * @returns {Array<{ id, name, description, via, score }>}
 */
export function recall(index, cue, { k = 6, spread = 0.6, habituated = new Set() } = {}) {
  const cueText = String(cue || '').toLowerCase();
  const cueTokens = new Set(tokenize(cueText));
  if (cueTokens.size === 0 || index.nodes.size === 0) return [];

  const direct = new Map();
  const inMind = new Set();
  for (const n of index.nodes.values()) {
    let a = 0;
    for (const t of n.nameTokens) if (cueTokens.has(t)) a += 3;
    let d = 0;
    for (const t of n.descTokens) if (cueTokens.has(t)) d += 1;
    a += Math.min(d, 4);
    if (n.name.length >= 3 && cueText.includes(n.name.toLowerCase())) {
      a += 4;
      inMind.add(n.id);
    }
    if (a > 0) direct.set(n.id, a);
  }

  const activation = new Map();
  const via = new Map();
  const strongest = new Map();
  const credit = (id, amount, route) => {
    activation.set(id, (activation.get(id) || 0) + amount);
    // The strongest single source names the route.
    if (amount > (strongest.get(id) || 0)) {
      strongest.set(id, amount);
      via.set(id, route);
    }
  };
  for (const [id, a] of direct) {
    if (!inMind.has(id)) credit(id, a, 'matches what you are thinking');
    for (const [neighbour, relation] of index.links.get(id) || []) {
      if (inMind.has(neighbour)) continue;
      credit(neighbour, a * spread, `${relation} — via ${index.nodes.get(id).name}`);
    }
  }

  return [...activation.entries()]
    .map(([id, a]) => [id, habituated.has(id) ? a * 0.3 : a])
    .sort((x, y) => y[1] - x[1])
    .slice(0, k)
    .map(([id, score]) => {
      const n = index.nodes.get(id);
      return { id, name: n.name, description: clip(n.description, 160), via: via.get(id), score: Math.round(score * 10) / 10 };
    });
}

/**
 * One memory from anywhere, preferring the ones not surfaced lately.
 * @param {{ nodes: Map }} index
 * @param {() => number} [rng]
 * @param {Set<string>} [habituated]
 */
export function wander(index, rng = Math.random, habituated = new Set()) {
  const all = [...index.nodes.values()];
  if (all.length === 0) return null;
  const fresh = all.filter(n => !habituated.has(n.id));
  const pool = fresh.length > 0 ? fresh : all;
  const n = pool[Math.floor(rng() * pool.length) % pool.length];
  const web = [...n.webs][0];
  return { id: n.id, name: n.name, description: clip(n.description, 160), via: web ? `drifted up from ${web}` : 'drifted up', score: 0 };
}

const NOT_NAMES = new Set(['next', 'redstring', 'thing', 'things', 'web', 'webs', 'graph', 'graphs', 'note', 'notes',
  'working', 'memory', 'context', 'current', 'final', 'action', 'step', 'result', 'added', 'created', 'node', 'nodes',
  'edge', 'edges', 'connection', 'connections', 'definition', 'this', 'that', 'these', 'those', 'then', 'also']);

/**
 * Names a note leans on that the graph does not hold.
 *
 * A note is written from memory of the epoch, and on its second real run a
 * 4B model's note said a Rock was "composed of Quartz, Feldspar" — neither was
 * ever written to the graph. The working memory had confabulated what the
 * long-term memory never received. The graph is ground truth, so this checks
 * the note against it: a capitalized word (not opening a sentence or line)
 * that no Thing's name contains is reported back.
 *
 * @param {{ nodes: Map }} index
 * @param {string} note
 * @returns {string[]} up to five missing names, in note order
 */
export function ungroundedNames(index, note) {
  const known = [...index.nodes.values()].map(n => n.name.toLowerCase());
  const found = [];
  const seen = new Set();
  const re = /(^|[^.!?:\n\s]\s+|\(\s*|\*\*)([A-Z][a-zA-Z\u00c0-\u024f-]{2,})/g;
  let m;
  while ((m = re.exec(String(note || ''))) && found.length < 5) {
    const word = m[2];
    const lower = word.toLowerCase();
    if (m[1] === '' || seen.has(lower) || NOT_NAMES.has(lower) || STOP.has(lower)) continue;
    seen.add(lower);
    const stem = lower.replace(/s$/, '');
    if (!known.some(name => name.includes(lower) || name.includes(stem))) found.push(word);
  }
  return found;
}
