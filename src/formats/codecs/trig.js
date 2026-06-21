/**
 * TriG codec (P5.2).
 *
 * toTriG(storeState, opts) → Promise<string>
 *   Exports the universe as a TriG document. Prototype-space quads go to
 *   the default graph; instance and edge quads are partitioned into named
 *   graphs — one per Redstring spatial graph — using the store's instance
 *   membership to route quads by subject IRI.
 *
 * Options:
 *   rdfStar  (boolean, default true)  — accepted but currently emits plain TriG;
 *                                       RDF-star annotations are future work (D6).
 *   emitV4   (boolean, default false) — passed through to exportToRedstring.
 */

import jsonld from 'jsonld';
import { exportToRedstring, toIri } from '../redstringFormat.js';

// When a map entry lacks an explicit "@id", JSON-LD @container:@id expands the
// map key via @vocab. Instances carry an explicit "@id": toIri(id) so they use
// the urn:redstring:id: form; edges do NOT have an explicit "@id" in the export,
// so their subject IRI is the vocab-prefixed key instead.
const REDSTRING_VOCAB = 'https://redstring.io/vocab/';

// Serialize an RDF term to its TriG/Turtle string representation.
function termStr(term) {
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.termType === 'Literal') {
    const esc = term.value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
    if (term.language) return `"${esc}"@${term.language}`;
    const dt = term.datatype?.value;
    if (dt && dt !== 'http://www.w3.org/2001/XMLSchema#string') {
      return `"${esc}"^^<${dt}>`;
    }
    return `"${esc}"`;
  }
  return `<${term.value}>`;
}

/**
 * Convert a store state to TriG with named-graph partitioning.
 *
 * Default graph: all quads whose subjects are NOT spatial instances or edges.
 * Named graphs:  one GRAPH <graphIri> { } block per Redstring spatial graph,
 *                containing quads about instances and edges belonging to it.
 *
 * @param {object} storeState
 * @param {{ rdfStar?: boolean, emitV4?: boolean }} [opts]
 * @returns {Promise<string>} TriG text
 */
export async function toTriG(storeState, { rdfStar = true, emitV4 = false } = {}) {
  const doc = exportToRedstring(storeState, null, { emitV4 });

  // Build subject-IRI → named-graph-IRI map from the store structure.
  const subjectToGraph = new Map();
  storeState.graphs.forEach((graph, graphId) => {
    const graphIri = toIri(graphId);
    if (graph.instances) {
      graph.instances.forEach((_, instanceId) => {
        subjectToGraph.set(toIri(instanceId), graphIri);
      });
    }
    // Edge nodes may or may not have an explicit @id. Cover both possibilities:
    // - If the export adds "@id": toIri(edgeId) → urn:redstring:id: form
    // - If not (current v3 export), @container:@id expands the map key via
    //   @vocab → "https://redstring.io/vocab/{edgeId}"
    (graph.edgeIds || []).forEach((edgeId) => {
      subjectToGraph.set(toIri(edgeId), graphIri);
      subjectToGraph.set(REDSTRING_VOCAB + edgeId, graphIri);
    });
  });

  // Get quads as an iterable dataset (RDF.js Quad objects).
  const dataset = await jsonld.toRDF(doc, { safe: false });

  // Partition quads by subject membership.
  const defaultQuads = [];
  const namedGraphQuads = new Map(); // graphIri → Quad[]

  for (const quad of dataset) {
    const subjectIri = quad.subject.termType === 'NamedNode' ? quad.subject.value : null;
    const graphIri = subjectIri ? subjectToGraph.get(subjectIri) : null;

    if (graphIri) {
      if (!namedGraphQuads.has(graphIri)) namedGraphQuads.set(graphIri, []);
      namedGraphQuads.get(graphIri).push(quad);
    } else {
      defaultQuads.push(quad);
    }
  }

  // Serialize: default graph triples first, then named graph blocks.
  const lines = [];

  for (const quad of defaultQuads) {
    lines.push(`${termStr(quad.subject)} ${termStr(quad.predicate)} ${termStr(quad.object)} .`);
  }

  for (const [graphIri, quads] of namedGraphQuads) {
    lines.push(`\nGRAPH <${graphIri}> {`);
    for (const quad of quads) {
      lines.push(`  ${termStr(quad.subject)} ${termStr(quad.predicate)} ${termStr(quad.object)} .`);
    }
    lines.push('}');
  }

  return lines.join('\n') + '\n';
}
