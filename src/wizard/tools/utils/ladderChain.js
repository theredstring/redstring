/**
 * ladderChain — ordering half of the `ladder` shape build.
 *
 * A `ladder` is an is-a chain (poodle → dog → mammal → animal). It routes to the
 * ABSTRACTION AXIS, not canvas edges. This helper decides the ORDER (most
 * specific → most general); the applier resolves names to prototypes and calls
 * addToAbstractionChain to actually wire the axis.
 *
 * Default order is the order the model already produced. One oneShotChoice
 * disambiguates direction when the model may have listed general → specific.
 * Null model → keep the produced order (identical to before).
 *
 * MCP stdio rule: reachable from redstring-mcp-server.js — console.error only.
 */

import { oneShotChoice } from '../../../services/oneShot.js';

/**
 * Order ladder node names most-specific → most-general.
 * @param {Object} p
 * @param {string[]} p.nodeNames - the node names in the order the model produced
 * @param {string} [p.buildId]
 * @returns {Promise<string[]|null>} ordered names, or null if fewer than 2.
 */
export async function orderLadder({ nodeNames = [], buildId } = {}) {
  const names = nodeNames.filter(Boolean);
  if (names.length < 2) return null;

  const res = await oneShotChoice({
    callSite: 'orderLadder',
    buildId,
    meta: { names: names.slice(0, 12) },
    instruction:
      'These items form an is-a ladder (each is a kind of the next). ' +
      'Reading them in the order listed, are they most SPECIFIC to most GENERAL, or the reverse?',
    input: names.join(' → '),
    options: [
      'most specific → most general (as listed)',
      'most general → most specific (reverse the order)'
    ]
  });

  // index 1 → reverse; index 0 / none / null → keep as produced.
  if (res && !res.none && res.index === 1) return [...names].reverse();
  return names;
}
