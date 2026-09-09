/**
 * abstractionSpec — shared vocabulary for is-a ladders (the abstraction carousel).
 *
 * A ladder can now arrive three ways: the standalone `abstractionChain` tool, an
 * inline `isA` field on any node in a build spec, and a `^Rung` marker in
 * sketchGraph's shorthand. All three land on the same store call, so they have to
 * agree on what a rung is, how a name matches an existing node, and which node owns
 * the chain — otherwise the same ladder built by two routes produces two prototypes
 * and two competing chains.
 *
 * These helpers used to be private to buildAbstractionChain.js. They live here so
 * the applier can reuse them without dragging that tool's resolveNodeSmart →
 * oneShot dependency into the browser bundle's import graph.
 *
 * MCP stdio rule: reachable from redstring-mcp-server.js — console.error only.
 */

import { generateProgressiveColor } from '../../../utils/colorUtils.js';

/** Every inline ladder lands on this axis; only the standalone tool takes a dimension. */
export const DEFAULT_ABSTRACTION_DIMENSION = 'Generalization Axis';

/** The two roots. Neither is ever given a chain of its own. */
export const THING_PROTOTYPE_ID = 'base-thing-prototype';
export const CONNECTION_PROTOTYPE_ID = 'base-connection-prototype';

/**
 * The chain seeding writes for a node: itself, its type, then Thing as the floor.
 *
 * `typeNodeId` and the carousel encode the SAME is-a claim, so assigning a type is
 * transcribed into the axis rather than left to be re-stated by hand. Half the creation
 * sites pass `typeNodeId: null` and half pass Thing (see the audit in graphStore), so
 * both normalize to Thing here — the Panel already displays untyped nodes as Things.
 *
 * Returns null for anything that must not carry a chain, so callers can use it as the
 * "should this be seeded at all?" test.
 */
export function seededChainFor(protoId, typeNodeId) {
  if (!protoId || protoId === THING_PROTOTYPE_ID || protoId === CONNECTION_PROTOTYPE_ID) return null;
  const type = typeNodeId || THING_PROTOTYPE_ID;
  // A self-typed node would otherwise produce [X, X, Thing]. mergeNodePrototypes can
  // create one by re-pointing every typeNodeId naming the secondary onto the primary.
  if (type === protoId || type === THING_PROTOTYPE_ID) return [protoId, THING_PROTOTYPE_ID];
  return [protoId, type, THING_PROTOTYPE_ID];
}

/**
 * True when `chain` is still exactly what seeding would have produced — i.e. nobody has
 * edited it by hand, and retype-sync may safely rewrite it.
 *
 * This is a structural test rather than a stored provenance flag, which is sound here
 * only because a seeded chain always terminates in Thing: a hand-built ladder such as
 * [Ford, Automaker] carries no Thing floor and so reads as authored. The one chain that
 * cannot be told apart is [X, X.type, Thing] — which is precisely what seeding writes,
 * so rewriting it on retype is the same edit either way.
 *
 * An absent or empty chain counts as seeded: legacy universes predate seeding, and
 * `resolveChain` synthesizes their chain rather than writing one.
 */
export function isSeededChain(proto, chain) {
  if (!Array.isArray(chain) || chain.length === 0) return true;
  const expected = seededChainFor(proto?.id, proto?.typeNodeId);
  if (!expected) return false;
  return chain.length === expected.length && chain.every((id, i) => id === expected[i]);
}

/**
 * Which chain to show and edit for a node. The single answer to a question that used to
 * be re-derived by hand in six places.
 *
 *   (a) a hand-authored chain the node owns
 *   (b) else a hand-authored chain the node is a rung of
 *   (c) else the node's own seeded chain, synthesized if it has none yet
 *
 * (b) has to outrank the node's own seeded chain, or the feature breaks the carousel:
 * a rung created by Add Above/Below is born typed Thing, so under an owner-first rule
 * its trivial [rung, Thing] would shadow the very ladder it was just added to. Skipping
 * seeded chains also means Thing — a member of every seeded chain and owner of none —
 * resolves to itself instead of to some arbitrary node's ladder.
 *
 * @param {string} protoId
 * @param {string} dimension
 * @param {Iterable<Object>} protos - prototype OBJECTS (see findByLooseName)
 * @returns {{ownerId: string, chain: string[], seeded: boolean, virtual: boolean}}
 *   `virtual` means nothing is stored yet and `chain` was synthesized.
 */
export function resolveChain(protoId, dimension, protos) {
  const list = Array.isArray(protos) ? protos : [...protos];

  let self = null;
  let owned = null;      // { chain, seeded } for the node's own chain
  let memberOf = null;   // { ownerId, chain } — last match wins, per project convention

  for (const p of list) {
    if (!p) continue;
    if (p.id === protoId) self = p;
    const chain = p.abstractionChains?.[dimension];
    if (!Array.isArray(chain) || chain.length === 0) continue;
    const seeded = isSeededChain(p, chain);
    if (p.id === protoId) owned = { chain, seeded };
    else if (!seeded && chain.includes(protoId)) memberOf = { ownerId: p.id, chain };
  }

  if (owned && !owned.seeded) return { ownerId: protoId, chain: owned.chain, seeded: false, virtual: false };
  if (memberOf) return { ownerId: memberOf.ownerId, chain: memberOf.chain, seeded: false, virtual: false };
  if (owned) return { ownerId: protoId, chain: owned.chain, seeded: true, virtual: false };

  return {
    ownerId: protoId,
    chain: seededChainFor(protoId, self?.typeNodeId) || [protoId],
    seeded: true,
    virtual: true
  };
}

/**
 * Past this many laddered nodes in one build we keep the first few and warn.
 * Told "you may add ladders", models add them to everything — and a ladder on every
 * node is noise that buries the two or three that carry real meaning. A prompt asks;
 * this enforces.
 */
export const MAX_LADDERS_PER_BUILD = 5;

const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Words that end in "s" but are not plurals of anything. Left whole, because the
 * general rules below would otherwise produce "physic", "sery" and "specy" — and a
 * mangled key silently fails to match the node it was meant to find.
 * The -ics ending covers physics/mathematics/economics/politics/ethics/statistics.
 */
const INVARIANT_PLURALS = new Set(['series', 'species', 'news', 'means']);

/**
 * Singularize conservatively — enough to see through the plural that names of
 * categories are so often written in, without mangling words that merely end in
 * "s". "Merchants"→"merchant", "Companies"→"company", "Boxes"→"box", while
 * "Business", "Physics", "Analysis", "Series" and "Class" are all left alone.
 *
 * Only the LAST word is inspected: English category names are head-final, so
 * "Manufacturing Companies" turns on "Companies".
 */
export function singular(s) {
  const w = norm(s);
  if (w.length < 4) return w;

  const cut = w.lastIndexOf(' ');
  const head = cut === -1 ? w : w.slice(cut + 1);
  const prefix = cut === -1 ? '' : w.slice(0, cut + 1);
  if (head.length < 4) return w;

  const singularHead = (() => {
    if (INVARIANT_PLURALS.has(head) || head.endsWith('ics')) return head;
    if (head.endsWith('ies')) return `${head.slice(0, -3)}y`;
    if (/(s|x|z|ch|sh)es$/.test(head)) return head.slice(0, -2);
    if (head.endsWith('ss') || head.endsWith('us') || head.endsWith('is')) return head;
    if (head.endsWith('s')) return head.slice(0, -1);
    return head;
  })();

  return prefix + singularHead;
}

/**
 * Match on the normalized, singularized name. This is an equality test on a
 * looser key — NOT substring containment, which is what used to bind a request
 * for "Company" to an existing "Company Town".
 *
 * Last match wins: Maps iterate oldest-first and stale prototypes accumulate, so
 * the newest node with a given name is the one meant (project convention).
 *
 * @param {string} name
 * @param {Iterable<{id?:string,name?:string}>} protos - an iterable of prototype
 *   OBJECTS. Passing a Map directly yields [id, proto] pairs, whose `.name` is
 *   undefined, so nothing matches and every rung gets recreated — silently. Callers
 *   holding the store Map must pass `.values()`.
 */
export function findByLooseName(name, protos) {
  const key = singular(name);
  if (!key) return null;
  let match = null;
  for (const p of protos) {
    const pName = p?.name;
    if (!pName) continue;
    if (norm(pName) === norm(name) || singular(pName) === key) match = p;
  }
  return match;
}

/** Accept either "Name" or { name, description }. */
export function readEntry(entry) {
  if (typeof entry === 'string') return { name: entry.trim(), description: '' };
  if (entry && typeof entry === 'object') {
    return {
      name: String(entry.name || '').trim(),
      description: String(entry.description || '').trim()
    };
  }
  return { name: '', description: '' };
}

/**
 * Read an inline `isA` value into ladder entries, nearest-first.
 *
 * The schema advertises a flat array of strings, because that is what survives
 * LLMClient's flattenDeepNesting intact. But models that have read the
 * abstractionChain docs send `{name, description}` objects, and models writing prose
 * send a single delimited string — so all three are accepted rather than dropped.
 */
export function readIsAList(value) {
  if (value == null) return [];
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/\s*(?:,|→|->|>|\/)\s*/) : [value]);
  return raw.map(readEntry).filter((e) => e.name);
}

/**
 * `<Automaker, Company>` stripped out of a sketchGraph node string.
 *
 * Mirrors parseSizeShorthand's contract — returns the bare text plus what it found —
 * because both markers have to come off before the `[Type]` regex, which is anchored
 * to end-of-string.
 */
export function parseLadderShorthand(str) {
  const text = String(str ?? '');
  const rungs = [];
  const stripped = text.replace(/\^([^^]+)/g, (_, rung) => {
    const name = rung.trim();
    if (name) rungs.push(name);
    return ' ';
  });
  return { text: stripped.replace(/\s+/g, ' ').trim(), isA: rungs };
}

/**
 * Which node owns the chain this ladder belongs to.
 *
 * If the anchor is already a rung on somebody else's ladder, that somebody owns this
 * one too. Writing to the anchor instead founds a second chain over the same nodes,
 * and the carousel then shows a different ladder depending on which node you opened
 * it from.
 *
 * @param {string} anchorId
 * @param {string} dimension
 * @param {Iterable<Object>} protos - prototype OBJECTS (see findByLooseName)
 */
export function findChainOwner(anchorId, dimension, protos) {
  const list = Array.isArray(protos) ? protos : [...protos];
  // Delegates so the "an anchor owns its own chain" shortcut can't fire on a merely
  // seeded chain. Every node carries one of those, so a naive owner-first test would
  // return the anchor unconditionally and every ladder built onto an existing rung
  // would found a competing chain instead of extending the visible one.
  const { ownerId, virtual } = resolveChain(anchorId, dimension, list);
  if (virtual) return null;   // nothing stored yet — callers fall back to the anchor
  return list.find((p) => p?.id === ownerId) || null;
}

/**
 * Turn ladder entries into the level specs the wiring step consumes: each rung
 * resolved to an existing prototype or marked for creation, in the shade the
 * carousel would draw it (lighter toward specific, darker toward generic).
 *
 * @param {Array} entries - from readIsAList
 * @param {'below'|'above'} direction - 'below' is more generic
 * @param {Object} opts
 * @param {string} opts.baseColor - the anchor's color, which the shading derives from
 * @param {Iterable<Object>} opts.protos - prototype OBJECTS (see findByLooseName)
 */
export function buildLadderLevels(entries, direction, { baseColor = '#8B0000', protos = [] } = {}) {
  const list = Array.isArray(protos) ? protos : [...protos];
  return entries.map((entry, index) => {
    const existing = findByLooseName(entry.name, list);
    // Level sign matches the carousel's: positive is more generic (darker),
    // negative more specific (lighter).
    const level = direction === 'below' ? index + 1 : -(index + 1);
    return {
      requestedName: entry.name,
      name: existing?.name || entry.name,
      existingId: existing?.id || null,
      direction,
      level,
      // Carried for reused rungs too: one that exists but was never described
      // still shows up blank in the carousel, and the applier fills that gap in
      // without ever overwriting a description someone already wrote.
      description: entry.description || '',
      create: existing
        ? null
        : {
          name: entry.name,
          description: entry.description || '',
          color: generateProgressiveColor(baseColor, level)
        }
    };
  });
}

/**
 * Cap how many nodes in one build get a ladder, stripping `isA` from the excess.
 *
 * A deterministic backstop for a prompt instruction. Told ladders are available,
 * models put one on everything — and a ladder on every node is noise that buries the
 * two or three carrying real meaning. Returns new specs; never mutates.
 */
export function applyLadderCap(nodeSpecs, max = MAX_LADDERS_PER_BUILD) {
  const laddered = nodeSpecs.filter((n) => n?.isA?.length);
  if (laddered.length <= max) return { nodeSpecs, warning: null };

  const keep = new Set(laddered.slice(0, max).map((n) => n.name));
  const dropped = laddered.slice(max).map((n) => n.name);
  return {
    nodeSpecs: nodeSpecs.map((n) => {
      if (!n?.isA?.length || keep.has(n.name)) return n;
      const { isA, ...rest } = n;
      return rest;
    }),
    warning:
      `${laddered.length} nodes carried an is-a ladder — kept ${[...keep].join(', ')}, dropped ` +
      `${dropped.join(', ')}. Ladders are for the few nodes whose generalization is uncontested, ` +
      `not for every node.`
  };
}

/**
 * The ladders a build requested, as top-level result fields.
 *
 * sanitizeResultForLLM strips `result.spec` before the model sees it, so without this
 * the ladders are invisible in the response — and a model that sees no evidence its
 * ladder landed fires a redundant abstractionChain call to "fix" it.
 */
export function summarizeLadders(nodeSpecs) {
  const laddered = (nodeSpecs || []).filter((n) => n?.isA?.length);
  if (laddered.length === 0) return { abstractionChains: null, abstractionNote: null };
  return {
    abstractionChains: laddered.slice(0, 12).map(
      (n) => `${n.name} → ${n.isA.map((e) => e.name).join(' → ')}`
    ),
    abstractionNote:
      `${laddered.length} node(s) got an is-a ladder on the abstraction axis (the carousel), ` +
      `not canvas edges — so they will not show up in the node/edge counts. Do not call ` +
      `abstractionChain again for these.`
  };
}
