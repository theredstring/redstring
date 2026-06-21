/**
 * N-Quads codec (P5.2).
 *
 * toNQuads(storeState) → Promise<string>
 *   Exports the universe as an N-Quads document (RDF 1.1).
 *   All quads are in the default graph in the current v3 export; named-graph
 *   partitioning is added by the TriG codec (see trig.js).
 */

import jsonld from 'jsonld';
import { exportToRedstring } from '../redstringFormat.js';

/**
 * Convert a store state to N-Quads.
 *
 * @param {object} storeState
 * @param {{ emitV4?: boolean }} [opts]
 * @returns {Promise<string>} N-Quads text
 */
export async function toNQuads(storeState, { emitV4 = false } = {}) {
  const doc = exportToRedstring(storeState, null, { emitV4 });
  return jsonld.toRDF(doc, { format: 'application/n-quads', safe: false });
}
