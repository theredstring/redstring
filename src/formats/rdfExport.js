/**
 * RDF Export Handler
 * Handles export of the current graph state to RDF/Turtle format.
 */

import { exportToRedstring } from './redstringFormat';
import jsonld from 'jsonld';
import * as $rdf from 'rdflib';

/**
 * Export current Zustand store state to RDF Turtle format
 * @param {object} storeState - The current state from the Zustand store.
 * @param {string} [userDomain] - User's domain for dynamic URI generation
 * @returns {Promise<string>} A promise that resolves with the RDF data in Turtle format.
 */
export const exportToRdfTurtle = async (storeState, userDomain = null) => {
  try {
    // 1. Get the data in our native JSON-LD format with dynamic URIs
    const redstringData = exportToRedstring(storeState, userDomain);

    // 2. Convert JSON-LD to a canonical RDF dataset (N-Quads format)
    const nquads = await jsonld.toRDF(redstringData, { format: 'application/n-quads' });

    // 3. For now, return the N-Quads format which is valid RDF
    // We can enhance this later with proper Turtle serialization
    return nquads;
  } catch (error) {
    console.error("Error exporting to RDF:", error);
    throw error;
  }
}; 