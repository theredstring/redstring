/**
 * Lens table — maps RDF predicate IRIs to Redstring routing decisions.
 *
 * applyLens(triples) takes an iterable of RDF quad objects (from jsonld.toRDF in
 * dataset form: { subject, predicate, object, graph } each with .termType/.value)
 * and routes them into Redstring's four semantic buckets.
 *
 * P5.1 (FORMAT_REFACTOR_PLAN §5).
 */

const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const DCTERMS = 'http://purl.org/dc/terms/';
const SCHEMA = 'http://schema.org/';
const WDT = 'http://www.wikidata.org/prop/direct/';

/**
 * Predicate IRI → routing decision.
 *   type: 'abstraction' | 'composition' | 'edge'
 *   inverted: true  → swap narrower/broader or whole/part
 *   connectionType: prototype ID to use as edge type (edge entries only)
 */
export const LENS_TABLE = {
  [`${RDFS}subClassOf`]:    { type: 'abstraction' },
  [`${SKOS}broader`]:       { type: 'abstraction' },
  [`${WDT}P279`]:           { type: 'abstraction' },         // Wikidata "subclass of"
  [`${SKOS}narrower`]:      { type: 'abstraction', inverted: true },
  [`${WDT}P527`]:           { type: 'composition' },         // Wikidata "has part"
  [`${DCTERMS}hasPart`]:    { type: 'composition' },
  [`${SCHEMA}hasPart`]:     { type: 'composition' },
  [`${WDT}P361`]:           { type: 'composition', inverted: true }, // Wikidata "part of"
  [`${SCHEMA}isPartOf`]:    { type: 'composition', inverted: true },
  [`${DCTERMS}isPartOf`]:   { type: 'composition', inverted: true },
  [`${SKOS}related`]:       { type: 'edge', connectionType: 'base-connection-prototype' },
  [`${RDFS}seeAlso`]:       { type: 'edge', connectionType: 'base-connection-prototype' },
};

// Extract a human-readable local name from a full IRI.
function localName(iri) {
  // HTTP(S): fragment first, then last path segment
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx !== -1) return decodeURIComponent(iri.slice(hashIdx + 1));
  const slashIdx = iri.lastIndexOf('/');
  if (slashIdx !== -1) return decodeURIComponent(iri.slice(slashIdx + 1));
  // URN or any colon-namespaced IRI: last colon-delimited segment
  const colonIdx = iri.lastIndexOf(':');
  if (colonIdx !== -1) return decodeURIComponent(iri.slice(colonIdx + 1));
  return iri;
}

/**
 * Apply the lens to an iterable of RDF quad objects.
 *
 * Returns:
 *   prototypes      — Map<iri, {id, name}>  all NamedNode subjects encountered
 *   abstractionLinks — [{narrower, broader}]
 *   compositionLinks — [{whole, part}]
 *   edges           — [{sourceIri, predicateIri, targetIri, typePrototypeId}]
 *   mintedPredicates — Map<iri, {id, name}>  auto-minted relation prototypes
 *                       (predicates not in LENS_TABLE that appear as edge types)
 */
export function applyLens(triples) {
  const prototypes = new Map();
  const abstractionLinks = [];
  const compositionLinks = [];
  const edges = [];
  const mintedPredicates = new Map();

  const ensureProto = (iri) => {
    if (!prototypes.has(iri)) {
      prototypes.set(iri, { id: iri, name: localName(iri) });
    }
  };

  for (const triple of triples) {
    const { subject, predicate, object } = triple;
    // Only register subjects that are named nodes (not blank nodes).
    if (subject.termType !== 'NamedNode') continue;
    ensureProto(subject.value);

    // Only route triples between two named nodes — literals can't be Redstring entities.
    if (object.termType !== 'NamedNode') continue;
    ensureProto(object.value);

    const s = subject.value;
    const p = predicate.value;
    const o = object.value;
    const route = LENS_TABLE[p];

    if (!route) {
      // Default: auto-mint a relation prototype from the predicate's local name.
      if (!mintedPredicates.has(p)) {
        mintedPredicates.set(p, { id: p, name: localName(p) });
      }
      edges.push({ sourceIri: s, predicateIri: p, targetIri: o, typePrototypeId: p });
      continue;
    }

    switch (route.type) {
      case 'abstraction': {
        const narrower = route.inverted ? o : s;
        const broader  = route.inverted ? s : o;
        abstractionLinks.push({ narrower, broader });
        break;
      }
      case 'composition': {
        const whole = route.inverted ? o : s;
        const part  = route.inverted ? s : o;
        compositionLinks.push({ whole, part });
        break;
      }
      case 'edge': {
        edges.push({
          sourceIri: s,
          predicateIri: p,
          targetIri: o,
          typePrototypeId: route.connectionType || 'base-connection-prototype',
        });
        break;
      }
    }
  }

  return { prototypes, abstractionLinks, compositionLinks, edges, mintedPredicates };
}
