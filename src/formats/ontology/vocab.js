/**
 * The IRIs the ontology importer reads, in one place.
 *
 * Everything here is a plain string constant: the index matches predicates by
 * exact IRI, never by prefix or local name, so a term from an unrelated
 * vocabulary that happens to be called "label" is never mistaken for one. The
 * one exception is compositionalClue(), which reads a relation's name.
 */

export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
export const OWL = 'http://www.w3.org/2002/07/owl#';
export const SKOS = 'http://www.w3.org/2004/02/skos/core#';
export const DCTERMS = 'http://purl.org/dc/terms/';
export const DC = 'http://purl.org/dc/elements/1.1/';
export const OBO = 'http://purl.obolibrary.org/obo/';
export const OBO_IN_OWL = 'http://www.geneontology.org/formats/oboInOwl#';
export const SCHEMA = 'http://schema.org/';
export const WDT = 'http://www.wikidata.org/prop/direct/';
export const FOAF = 'http://xmlns.com/foaf/0.1/';

export const RDF_TYPE = `${RDF}type`;
export const RDF_FIRST = `${RDF}first`;
export const RDF_REST = `${RDF}rest`;
export const RDF_NIL = `${RDF}nil`;

export const RDFS_LABEL = `${RDFS}label`;
export const RDFS_COMMENT = `${RDFS}comment`;
export const RDFS_SUBCLASS_OF = `${RDFS}subClassOf`;
export const RDFS_SUBPROPERTY_OF = `${RDFS}subPropertyOf`;
export const RDFS_CLASS = `${RDFS}Class`;
export const RDFS_DATATYPE = `${RDFS}Datatype`;
export const RDFS_SEE_ALSO = `${RDFS}seeAlso`;

export const OWL_CLASS = `${OWL}Class`;
export const OWL_THING = `${OWL}Thing`;
export const OWL_NOTHING = `${OWL}Nothing`;
export const OWL_NAMED_INDIVIDUAL = `${OWL}NamedIndividual`;
export const OWL_ONTOLOGY = `${OWL}Ontology`;
export const OWL_RESTRICTION = `${OWL}Restriction`;
export const OWL_AXIOM = `${OWL}Axiom`;
export const OWL_OBJECT_PROPERTY = `${OWL}ObjectProperty`;
export const OWL_DATATYPE_PROPERTY = `${OWL}DatatypeProperty`;
export const OWL_ANNOTATION_PROPERTY = `${OWL}AnnotationProperty`;
export const OWL_TRANSITIVE_PROPERTY = `${OWL}TransitiveProperty`;
export const OWL_ON_PROPERTY = `${OWL}onProperty`;
export const OWL_SOME_VALUES_FROM = `${OWL}someValuesFrom`;
export const OWL_ALL_VALUES_FROM = `${OWL}allValuesFrom`;
export const OWL_HAS_VALUE = `${OWL}hasValue`;
export const OWL_EQUIVALENT_CLASS = `${OWL}equivalentClass`;
export const OWL_SAME_AS = `${OWL}sameAs`;
export const OWL_DEPRECATED = `${OWL}deprecated`;
export const OWL_VERSION_IRI = `${OWL}versionIRI`;
export const OWL_VERSION_INFO = `${OWL}versionInfo`;
export const OWL_INVERSE_OF = `${OWL}inverseOf`;
export const OWL_IMPORTS = `${OWL}imports`;

export const SKOS_CONCEPT = `${SKOS}Concept`;
export const SKOS_CONCEPT_SCHEME = `${SKOS}ConceptScheme`;
export const SKOS_PREF_LABEL = `${SKOS}prefLabel`;
export const SKOS_ALT_LABEL = `${SKOS}altLabel`;
export const SKOS_HIDDEN_LABEL = `${SKOS}hiddenLabel`;
export const SKOS_DEFINITION = `${SKOS}definition`;
export const SKOS_SCOPE_NOTE = `${SKOS}scopeNote`;
export const SKOS_BROADER = `${SKOS}broader`;
export const SKOS_NARROWER = `${SKOS}narrower`;
export const SKOS_RELATED = `${SKOS}related`;
export const SKOS_EXACT_MATCH = `${SKOS}exactMatch`;
export const SKOS_CLOSE_MATCH = `${SKOS}closeMatch`;
export const SKOS_IN_SCHEME = `${SKOS}inScheme`;
export const SKOS_TOP_CONCEPT_OF = `${SKOS}topConceptOf`;

export const IAO_DEFINITION = `${OBO}IAO_0000115`;
export const IAO_REPLACED_BY = `${OBO}IAO_0100001`;
export const OBO_HAS_EXACT_SYNONYM = `${OBO_IN_OWL}hasExactSynonym`;
export const OBO_HAS_RELATED_SYNONYM = `${OBO_IN_OWL}hasRelatedSynonym`;
export const OBO_HAS_BROAD_SYNONYM = `${OBO_IN_OWL}hasBroadSynonym`;
export const OBO_HAS_NARROW_SYNONYM = `${OBO_IN_OWL}hasNarrowSynonym`;
export const OBO_HAS_DB_XREF = `${OBO_IN_OWL}hasDbXref`;
export const OBO_HAS_ALTERNATIVE_ID = `${OBO_IN_OWL}hasAlternativeId`;
export const OBO_ID = `${OBO_IN_OWL}id`;
export const OBO_DATE = `${OBO_IN_OWL}date`;

/** part of / has part, as BFO and RO write them. */
export const BFO_PART_OF = `${OBO}BFO_0000050`;
export const BFO_HAS_PART = `${OBO}BFO_0000051`;

/**
 * Predicates that make the subject one step more specific than the object.
 *
 * `rdf:type` (instance of) and `rdfs:subClassOf` (subclass of) are both here on
 * purpose. Redstring has one sort of thing, not two: Garfield sits under Cat the
 * same way Cat sits under Mammal, so both land on the same specificity ladder.
 */
export const BROADER_PREDICATES = new Set([
  RDFS_SUBCLASS_OF,
  SKOS_BROADER,
  `${WDT}P279`, // Wikidata "subclass of"
  `${WDT}P31`,  // Wikidata "instance of"
]);

/** The same relation written from the other end (object is more specific). */
export const NARROWER_PREDICATES = new Set([SKOS_NARROWER]);

/** Subject has the object as a part. */
export const HAS_PART_PREDICATES = new Set([
  BFO_HAS_PART,
  `${DCTERMS}hasPart`,
  `${SCHEMA}hasPart`,
  `${WDT}P527`,
]);

/** Subject is a part of the object. */
export const PART_OF_PREDICATES = new Set([
  BFO_PART_OF,
  `${DCTERMS}isPartOf`,
  `${SCHEMA}isPartOf`,
  `${WDT}P361`,
]);

/**
 * Compositional clues: relation names that say one end is inside the other.
 *
 * The one place the importer reads a relation by its name rather than its IRI.
 * Every ontology names these its own way ("disease has location", "located
 * in", "has proper part", "composed primarily of"), and a relation that says
 * where something is, or what it is made of, is composition in Redstring's
 * terms. Matched case-insensitively on whole words, so "has part" never
 * matches "has participant".
 */
const IN_SUBJECT_CLUES = [ // the object goes inside the subject
  /\bhas (?:\w+ )?(?:part|component|member|constituent)s?\b/,
  /\bcontains\b/,
  /\b(?:composed|consists?|made) (?:\w+ )?of\b/,
  /\blocation of\b/,
];
const IN_OBJECT_CLUES = [ // the subject goes inside the object
  /\b(?:part|component|member|constituent) of\b/,
  /\b(?:contained|located|occurs) in\b/,
  /\bhas (?:\w+ )*(?:location|site)\b/,
];

/** "hasPart", "part_of", "Disease Has Location" → "has part", "part of", "disease has location" */
const clueText = (name) => String(name || '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .toLowerCase()
  .replace(/[_\-#/]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Which end of a relation goes inside the other, if either does.
 *
 * @param {string} property - the relation's IRI
 * @param {string} [name] - its label, or its local name when it has none
 * @returns {'in-subject'|'in-object'|null} 'in-subject': the object is placed
 *   in the subject's web (has part); 'in-object': the subject is placed in the
 *   object's web (part of, located in); null: neither
 */
export function compositionalClue(property, name) {
  if (HAS_PART_PREDICATES.has(property)) return 'in-subject';
  if (PART_OF_PREDICATES.has(property)) return 'in-object';
  const text = clueText(name);
  if (!text) return null;
  if (IN_SUBJECT_CLUES.some((re) => re.test(text))) return 'in-subject';
  if (IN_OBJECT_CLUES.some((re) => re.test(text))) return 'in-object';
  return null;
}

/**
 * The namespace part of an IRI: up to the last `#` or `/`, or for OBO-style
 * IRIs (`.../obo/CHEBI_15377`) up to and including the `_`.
 */
export function namespaceOf(iri) {
  const s = String(iri);
  const obo = s.match(/^(.*\/obo\/[A-Za-z]+_)\d/);
  if (obo) return obo[1];
  const cut = Math.max(s.lastIndexOf('#'), s.lastIndexOf('/'));
  return cut > 0 ? s.slice(0, cut + 1) : s;
}

/** Literal predicates that name a term. The first one found wins over later ones. */
export const LABEL_PREDICATES = [SKOS_PREF_LABEL, RDFS_LABEL, `${SCHEMA}name`, `${FOAF}name`, `${DCTERMS}title`];

/** Literal predicates that define a term, in priority order. */
export const DEFINITION_PREDICATES = [IAO_DEFINITION, SKOS_DEFINITION, `${SCHEMA}description`, `${DCTERMS}description`, RDFS_COMMENT, SKOS_SCOPE_NOTE];

/** Synonym predicate → OBO synonym scope. */
export const SYNONYM_SCOPES = new Map([
  [OBO_HAS_EXACT_SYNONYM, 'exact'],
  [OBO_HAS_RELATED_SYNONYM, 'related'],
  [OBO_HAS_BROAD_SYNONYM, 'broad'],
  [OBO_HAS_NARROW_SYNONYM, 'narrow'],
  [SKOS_ALT_LABEL, 'exact'],
  [SKOS_HIDDEN_LABEL, 'related'],
]);

/** rdf:type objects that say "this subject is a term" without placing it anywhere. */
export const TERM_TYPES = new Set([OWL_CLASS, RDFS_CLASS, SKOS_CONCEPT, OWL_NAMED_INDIVIDUAL]);

/** rdf:type objects that say "this subject is a relation, not a term". */
export const PROPERTY_TYPES = new Set([
  OWL_OBJECT_PROPERTY,
  OWL_DATATYPE_PROPERTY,
  OWL_ANNOTATION_PROPERTY,
  OWL_TRANSITIVE_PROPERTY,
  `${OWL}SymmetricProperty`,
  `${OWL}FunctionalProperty`,
  `${OWL}InverseFunctionalProperty`,
  `${OWL}ReflexiveProperty`,
  `${OWL}IrreflexiveProperty`,
  `${OWL}AsymmetricProperty`,
  `${RDF}Property`,
]);

/**
 * Vocabulary-level IRIs that are never terms of the ontology being imported:
 * the schema languages themselves. A `subClassOf owl:Thing` says nothing a
 * Redstring Thing doesn't already say, so those parents are dropped.
 */
export const isSchemaIri = (iri) => (
  iri.startsWith(RDF) || iri.startsWith(RDFS) || iri.startsWith(OWL)
  || iri.startsWith('http://www.w3.org/2001/XMLSchema#')
);

/** Predicates whose objects are never relations between terms. */
export const NON_RELATION_PREDICATES = new Set([
  RDF_TYPE,
  OWL_EQUIVALENT_CLASS,
  OWL_SAME_AS,
  SKOS_EXACT_MATCH,
  SKOS_CLOSE_MATCH,
  SKOS_IN_SCHEME,
  SKOS_TOP_CONCEPT_OF,
  RDFS_SEE_ALSO,
  RDFS_SUBPROPERTY_OF,
  OWL_INVERSE_OF,
  OWL_IMPORTS,
  IAO_REPLACED_BY,
  `${RDFS}isDefinedBy`,
  `${RDFS}domain`,
  `${RDFS}range`,
  `${DCTERMS}license`,
  `${DCTERMS}source`,
  `${DCTERMS}creator`,
  `${DCTERMS}contributor`,
  `${FOAF}homepage`,
  `${FOAF}depiction`,
  `${OBO_IN_OWL}inSubset`,
  `${OBO_IN_OWL}hasOBONamespace`,
]);
