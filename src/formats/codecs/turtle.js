/**
 * Turtle codec.
 *
 * toTurtle(storeState, opts) → Promise<string>
 *   Exports the universe as a Turtle (.ttl) document. All quads are projected
 *   to the default graph — named-graph membership is discarded. Subjects are
 *   grouped and predicates sharing the same subject are joined with `;`.
 *
 *   For named-graph-partitioned output, use the TriG codec (trig.js).
 */

import jsonld from 'jsonld';
import { exportToRedstring } from '../redstringFormat.js';

const PREFIXES = [
  ['rdf',       'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['rdfs',      'http://www.w3.org/2000/01/rdf-schema#'],
  ['xsd',       'http://www.w3.org/2001/XMLSchema#'],
  ['owl',       'http://www.w3.org/2002/07/owl#'],
  ['skos',      'http://www.w3.org/2004/02/skos/core#'],
  ['schema',    'https://schema.org/'],
  ['redstring', 'https://redstring.io/vocab/'],
];

// Try to abbreviate an IRI using known prefixes; fall back to <iri> form.
function abbrev(iri) {
  for (const [prefix, ns] of PREFIXES) {
    if (iri.startsWith(ns)) {
      const local = iri.slice(ns.length);
      if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(local)) return `${prefix}:${local}`;
    }
  }
  return `<${iri}>`;
}

// Serialize an RDF term to its Turtle string representation.
function termStr(term) {
  if (term.termType === 'NamedNode') return abbrev(term.value);
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
      return `"${esc}"^^${abbrev(dt)}`;
    }
    return `"${esc}"`;
  }
  return `<${term.value}>`;
}

/**
 * Convert a store state to Turtle.
 *
 * All quads are projected to the default graph (named-graph partitioning is
 * discarded). Subjects are grouped; predicates sharing the same subject are
 * joined with `;` for human readability.
 *
 * @param {object} storeState
 * @param {{ emitV4?: boolean }} [opts]
 * @returns {Promise<string>} Turtle text
 */
export async function toTurtle(storeState, { emitV4 = false } = {}) {
  const doc = exportToRedstring(storeState, null, { emitV4 });
  const dataset = await jsonld.toRDF(doc, { safe: false });

  // Group triples: subject → predicate → object[]  (insertion-order preserved).
  const subjectMap = new Map();
  for (const quad of dataset) {
    const s = termStr(quad.subject);
    const p = termStr(quad.predicate);
    const o = termStr(quad.object);
    if (!subjectMap.has(s)) subjectMap.set(s, new Map());
    const predMap = subjectMap.get(s);
    if (!predMap.has(p)) predMap.set(p, []);
    predMap.get(p).push(o);
  }

  const lines = PREFIXES.map(([prefix, ns]) => `@prefix ${prefix}: <${ns}> .`);
  lines.push('');

  for (const [subject, predMap] of subjectMap) {
    const predicates = [...predMap.entries()];
    if (predicates.length === 1) {
      const [pred, objects] = predicates[0];
      lines.push(`${subject} ${pred} ${objects.join(', ')} .`);
    } else {
      lines.push(`${subject}`);
      predicates.forEach(([pred, objects], i) => {
        const sep = i < predicates.length - 1 ? ' ;' : ' .';
        lines.push(`  ${pred} ${objects.join(', ')}${sep}`);
      });
    }
    lines.push('');
  }

  return lines.join('\n');
}
