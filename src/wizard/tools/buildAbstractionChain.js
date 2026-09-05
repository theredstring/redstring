/**
 * buildAbstractionChain — lay down a whole abstraction ladder in ONE call.
 *
 * The add-one-level-at-a-time path (editAbstractionChain) asks the model to
 * interleave createNode and abstractionChain calls, keep exact names straight
 * across them, and thread `relativeTo` through by hand. In practice it created
 * the nodes and then failed to wire them, leaving the carousel empty and the
 * project littered with orphan prototypes.
 *
 * So this takes the ladder as what it actually is — an ordered list of names —
 * and does the rest: resolve each name to an existing prototype or mint one,
 * order them, and hand the applier a single spec to wire up. Names are matched
 * leniently enough that "Merchants" answers for "Merchant" (a plural is not a
 * different category) but never so leniently that "Company Town" answers for
 * "Company".
 *
 * New levels are born in the shade the carousel would draw them in, so a chain
 * built here looks the same as one built by hand.
 *
 * MCP stdio rule: console.error only, never console.log.
 */

import { generateProgressiveColor } from '../../utils/colorUtils.js';
import { resolveNodeSmart } from './utils/resolveNodeSmart.js';

const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Singularize conservatively — enough to see through the plural that names of
 * categories are so often written in, without mangling words that merely end in
 * "s". "Merchants"→"merchant", "Companies"→"company", "Boxes"→"box", while
 * "Business", "Physics", "Analysis" and "Class" are all left alone.
 */
function singular(s) {
  const w = norm(s);
  if (w.length < 4) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/**
 * Match on the normalized, singularized name. This is an equality test on a
 * looser key — NOT substring containment, which is what used to bind a request
 * for "Company" to an existing "Company Town".
 *
 * Last match wins: Maps iterate oldest-first and stale prototypes accumulate, so
 * the newest node with a given name is the one meant (project convention).
 */
function findByLooseName(name, protos) {
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
function readEntry(entry) {
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
 * @param {Object} args - { nodeName, dimension, moreGeneric?, moreSpecific? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Action spec for UI application
 */
export async function buildAbstractionChain(args, graphState) {
  const { nodeName, dimension, moreGeneric = [], moreSpecific = [] } = args;

  if (!nodeName) throw new Error('nodeName is required');
  if (!dimension) throw new Error('dimension is required (e.g., "Generalization Axis")');

  const genericEntries = (Array.isArray(moreGeneric) ? moreGeneric : []).map(readEntry).filter((e) => e.name);
  const specificEntries = (Array.isArray(moreSpecific) ? moreSpecific : []).map(readEntry).filter((e) => e.name);

  if (genericEntries.length === 0 && specificEntries.length === 0) {
    throw new Error('Provide at least one level in moreGeneric (or moreSpecific). These are the rungs of the ladder, ordered nearest-first.');
  }

  const { nodePrototypes = [] } = graphState;

  // The anchor: the node the ladder is being built around.
  const { match: anchorProto } = await resolveNodeSmart(nodeName, nodePrototypes, {
    callSite: 'buildAbstractionChain:anchor',
    substringMode: 'loose'
  });
  if (!anchorProto) {
    throw new Error(`Node "${nodeName}" not found.`);
  }

  // Whoever already owns a chain containing the anchor owns this one too —
  // writing to the anchor instead would start a second, competing chain rather
  // than extending the one the carousel is showing.
  let ownerProto = anchorProto;
  const anchorOwnsChain = Array.isArray(anchorProto.abstractionChains?.[dimension])
    && anchorProto.abstractionChains[dimension].length > 0;
  if (!anchorOwnsChain) {
    for (const candidate of nodePrototypes) {
      const chain = candidate?.abstractionChains?.[dimension];
      if (Array.isArray(chain) && chain.includes(anchorProto.id)) {
        ownerProto = candidate;
        break;
      }
    }
  }

  const baseColor = anchorProto.color || '#8B0000';

  // Walk outward from the anchor. Each rung is placed relative to the one before
  // it, so the applier never has to guess where a level belongs.
  const buildSide = (entries, direction) => entries.map((entry, index) => {
    const existing = findByLooseName(entry.name, nodePrototypes);
    // Level sign matches the carousel's: positive is more generic (darker),
    // negative more specific (lighter).
    const level = direction === 'below' ? index + 1 : -(index + 1);
    return {
      requestedName: entry.name,
      name: existing?.name || entry.name,
      existingId: existing?.id || null,
      direction,
      level,
      create: existing
        ? null
        : {
          name: entry.name,
          description: entry.description || '',
          color: generateProgressiveColor(baseColor, level)
        }
    };
  });

  const levels = [
    ...buildSide(genericEntries, 'below'),
    ...buildSide(specificEntries, 'above')
  ];

  const reused = levels.filter((l) => l.existingId).length;
  const created = levels.length - reused;
  const ladder = [
    ...buildSide(specificEntries, 'above').map((l) => l.name).reverse(),
    anchorProto.name,
    ...buildSide(genericEntries, 'below').map((l) => l.name)
  ].join(' → ');

  return {
    action: 'buildAbstractionChain',
    nodeId: ownerProto.id,
    anchorId: anchorProto.id,
    anchorName: anchorProto.name,
    dimension,
    levels,
    message:
      `Built the "${dimension}" ladder for "${anchorProto.name}": ${ladder}. ` +
      `(${reused} existing node${reused === 1 ? '' : 's'} reused, ${created} created.)`
  };
}

export default buildAbstractionChain;
