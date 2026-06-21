/**
 * RDF Export — delegates to codecs (P5.5).
 *
 * exportToRdfTurtle → N-Quads via the N-Quads codec (all quads, no named graphs).
 * exportToTrig      → TriG via the TriG codec (named-graph-partitioned).
 */

import { toNQuads } from './codecs/nquads.js';
import { toTriG }   from './codecs/trig.js';

/**
 * Export store state as N-Quads (flat, no named-graph partitioning).
 * The function name is kept for backwards compatibility; output is N-Quads,
 * not Turtle (the original implementation also returned N-Quads, mislabeled).
 *
 * @param {object} storeState
 * @param {string|null} [_userDomain] - unused; kept for call-site compatibility
 * @returns {Promise<string>} N-Quads text
 */
export const exportToRdfTurtle = async (storeState, _userDomain = null) => {
  return toNQuads(storeState);
};

/**
 * Export store state as TriG with named-graph partitioning.
 * One GRAPH block per Redstring spatial graph; prototype-space quads go to
 * the default graph.
 *
 * @param {object} storeState
 * @param {{ rdfStar?: boolean }} [opts]
 * @returns {Promise<string>} TriG text
 */
export const exportToTrig = async (storeState, opts = {}) => {
  return toTriG(storeState, opts);
};
