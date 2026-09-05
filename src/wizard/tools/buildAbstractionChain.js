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

import { resolveNodeSmart } from './utils/resolveNodeSmart.js';
import {
  readEntry,
  findChainOwner,
  buildLadderLevels
} from './utils/abstractionSpec.js';

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
  const ownerProto = findChainOwner(anchorProto.id, dimension, nodePrototypes) || anchorProto;

  // Walk outward from the anchor. Each rung is placed relative to the one before
  // it, so the applier never has to guess where a level belongs.
  const buildSide = (entries, direction) => buildLadderLevels(entries, direction, {
    baseColor: anchorProto.color || '#8B0000',
    protos: nodePrototypes
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
