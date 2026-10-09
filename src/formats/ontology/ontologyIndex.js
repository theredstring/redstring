/**
 * The ontology index: every term of a source ontology, keyed by IRI.
 *
 * Built in one streaming pass over the quads (or over OBO Graphs JSON) and kept
 * compact: for each term only what the importer uses — its label, definition,
 * synonyms, the Things it sits under, its relations to other terms, its
 * cross-references and whether it's deprecated. Everything else in the file
 * (axiom annotations, provenance strings, disjointness) is counted and dropped.
 *
 * The index is the same whatever serialization it came from: every list is
 * sorted and de-duplicated at the end, so a Turtle file and the RDF/XML file it
 * was converted from produce identical indexes. The tests hold it to that.
 *
 * Two readings worth knowing:
 *  - `rdf:type` to a non-schema class and `rdfs:subClassOf` both become a
 *    parent. Redstring has no class/individual split; a leaf is a Thing with
 *    nothing more specific named yet.
 *  - `SubClassOf P some D` (an OWL existential restriction, OBO's
 *    "relationship:") becomes the relation (P, D). So does a restriction inside
 *    an `equivalentClass` intersection, whose named members also become parents
 *    (A ≡ G ∧ … entails A ⊑ G).
 */

import * as V from './vocab.js';

const LANG_SCORE = (lang) => (!lang ? 3 : /^en(-|$)/i.test(lang) ? 2 : 1);

/** Blank-node predicates worth keeping: enough to read restrictions and RDF lists. */
const BNODE_PREDICATES = new Set([
  V.RDF_TYPE,
  V.OWL_ON_PROPERTY,
  V.OWL_SOME_VALUES_FROM,
  V.OWL_ALL_VALUES_FROM,
  V.OWL_HAS_VALUE,
  `${V.OWL}intersectionOf`,
  `${V.OWL}unionOf`,
  `${V.OWL}complementOf`,
  V.RDF_FIRST,
  V.RDF_REST,
]);

const newTerm = (iri) => ({
  iri,
  label: null,          // { value, rank, lang }
  definition: null,     // { value, rank, lang }
  synonyms: null,       // Map key → {label, scope}
  parents: null,        // Set<iri>
  relations: null,      // Map "p\u0000o" → [p, o]
  equivalents: null,    // Set<iri>
  xrefs: null,          // Set<string>
  types: null,          // Set<iri>
  deprecated: false,
  replacedBy: null,
});

const add = (term, key, value) => {
  if (!term[key]) term[key] = new Set();
  term[key].add(value);
};

/** Better of two literal picks: lower predicate rank first, then language. */
const better = (current, rank, lang) => {
  if (!current) return true;
  if (rank !== current.rank) return rank < current.rank;
  return LANG_SCORE(lang) > LANG_SCORE(current.lang);
};

export class OntologyIndexBuilder {
  constructor() {
    this.terms = new Map();
    this.subjectTypes = new Map(); // iri → Set<type iri>, for every named subject
    this.propertyLabels = new Map();
    this.inverseOf = new Map();
    this.ontology = { iri: null, versionIri: null, version: null, title: null, description: null, license: null, homepage: null, date: null };
    this.ontologyIris = new Set();
    this.bnodes = new Map(); // id → Map<pred, value[]>
    this.pendingSubclass = []; // [subjectIri, bnodeId]
    this.pendingEquivalent = []; // [subjectIri, bnodeId]
    this.headerTriples = []; // [subjectIri, pred, object] seen before the ontology IRI is known
    this.quadCount = 0;
    this.stats = {
      blankNodeAxioms: 0,
      universalRestrictions: 0,
      unionOrComplementClasses: 0,
      unresolvedBlankNodes: 0,
      skippedLiterals: 0,
    };
  }

  term(iri) {
    let t = this.terms.get(iri);
    if (!t) { t = newTerm(iri); this.terms.set(iri, t); }
    return t;
  }

  /** Feed one RDF/JS quad. */
  addQuad(quad) {
    this.quadCount++;
    const { subject, predicate, object } = quad;
    const p = predicate.value;

    if (subject.termType === 'BlankNode') {
      if (!BNODE_PREDICATES.has(p)) {
        if (p === V.RDF_TYPE || p.startsWith(V.OWL)) this.stats.blankNodeAxioms++;
        return;
      }
      let props = this.bnodes.get(subject.value);
      if (!props) { props = new Map(); this.bnodes.set(subject.value, props); }
      const list = props.get(p);
      const value = object.termType === 'BlankNode' ? { bnode: object.value } : object.value;
      if (list) list.push(value); else props.set(p, [value]);
      return;
    }
    if (subject.termType !== 'NamedNode') return;
    const s = subject.value;

    if (p === V.RDF_TYPE) {
      if (object.termType !== 'NamedNode') return;
      let set = this.subjectTypes.get(s);
      if (!set) { set = new Set(); this.subjectTypes.set(s, set); }
      set.add(object.value);
      if (object.value === V.OWL_ONTOLOGY || object.value === V.SKOS_CONCEPT_SCHEME) this.ontologyIris.add(s);
      return;
    }

    if (object.termType === 'Literal') {
      this.addLiteral(s, p, object);
      return;
    }

    if (object.termType === 'BlankNode') {
      if (p === V.RDFS_SUBCLASS_OF) this.pendingSubclass.push([s, object.value]);
      else if (p === V.OWL_EQUIVALENT_CLASS) this.pendingEquivalent.push([s, object.value]);
      else this.stats.blankNodeAxioms++;
      return;
    }

    const o = object.value;
    if (p === V.OWL_INVERSE_OF) { this.inverseOf.set(s, o); return; }
    if (p === V.OWL_VERSION_IRI || p === `${V.DCTERMS}license` || p === `${V.FOAF}homepage`) {
      this.headerTriples.push([s, p, o]);
      return;
    }
    if (V.BROADER_PREDICATES.has(p)) { if (s !== o) add(this.term(s), 'parents', o); this.term(o); return; }
    if (V.NARROWER_PREDICATES.has(p)) { if (s !== o) add(this.term(o), 'parents', s); this.term(s); return; }
    if (p === V.OWL_EQUIVALENT_CLASS) { if (s !== o) add(this.term(s), 'equivalents', o); return; }
    if (p === V.IAO_REPLACED_BY) { this.term(s).replacedBy = o; return; }
    if (V.NON_RELATION_PREDICATES.has(p)) return;

    const t = this.term(s);
    if (!t.relations) t.relations = new Map();
    t.relations.set(`${p}\u0000${o}`, [p, o]);
  }

  addLiteral(s, p, object) {
    const value = String(object.value ?? '').trim();
    const lang = object.language || '';

    // Ontology header literals are collected separately; the subject may not be
    // known to be the ontology yet, so they're resolved at finish().
    if (p === `${V.DCTERMS}title` || p === `${V.DC}title` || p === `${V.DCTERMS}description` || p === `${V.DC}description`
      || p === V.OWL_VERSION_INFO || p === V.OBO_DATE || p === `${V.DCTERMS}license` || p === `${V.FOAF}homepage`) {
      this.headerTriples.push([s, p, value]);
    }

    if (!value) return;

    const labelRank = V.LABEL_PREDICATES.indexOf(p);
    if (labelRank !== -1) {
      const t = this.term(s);
      if (better(t.label, labelRank, lang)) t.label = { value, rank: labelRank, lang };
      return;
    }
    const defRank = V.DEFINITION_PREDICATES.indexOf(p);
    if (defRank !== -1) {
      const t = this.term(s);
      if (better(t.definition, defRank, lang)) t.definition = { value, rank: defRank, lang };
      return;
    }
    const scope = V.SYNONYM_SCOPES.get(p);
    if (scope) {
      if (lang && LANG_SCORE(lang) < 2) return;
      const t = this.term(s);
      if (!t.synonyms) t.synonyms = new Map();
      t.synonyms.set(`${value}\u0000${scope}`, { label: value, scope });
      return;
    }
    if (p === V.OBO_HAS_DB_XREF) { add(this.term(s), 'xrefs', value); return; }
    if (p === V.OWL_DEPRECATED) {
      if (value === 'true' || value === '1') this.term(s).deprecated = true;
      return;
    }
    this.stats.skippedLiterals++;
  }

  /** Read an RDF list hanging off a blank node into its members. */
  readList(head) {
    const out = [];
    const seen = new Set();
    let node = head;
    while (node && typeof node === 'object' && node.bnode && !seen.has(node.bnode)) {
      seen.add(node.bnode);
      const props = this.bnodes.get(node.bnode);
      if (!props) break;
      const first = props.get(V.RDF_FIRST)?.[0];
      if (first !== undefined) out.push(first);
      node = props.get(V.RDF_REST)?.[0];
    }
    return out;
  }

  /**
   * Read one class expression into parents and relations for `subjectIri`.
   * `asEquivalent` marks the equivalentClass reading, where only intersections
   * contribute (A ≡ G ∧ R entails A ⊑ G and A ⊑ R; a union entails nothing).
   */
  readClassExpression(subjectIri, value, asEquivalent) {
    if (typeof value === 'string') {
      if (!asEquivalent) add(this.term(subjectIri), 'parents', value);
      return;
    }
    const props = value?.bnode ? this.bnodes.get(value.bnode) : null;
    if (!props) { this.stats.unresolvedBlankNodes++; return; }

    const intersection = props.get(`${V.OWL}intersectionOf`)?.[0];
    if (intersection) {
      for (const member of this.readList(intersection)) {
        if (typeof member === 'string') add(this.term(subjectIri), 'parents', member);
        else this.readRestriction(subjectIri, member);
      }
      return;
    }
    if (props.has(`${V.OWL}unionOf`) || props.has(`${V.OWL}complementOf`)) {
      this.stats.unionOrComplementClasses++;
      return;
    }
    if (asEquivalent) { this.stats.unresolvedBlankNodes++; return; }
    this.readRestriction(subjectIri, value);
  }

  readRestriction(subjectIri, value) {
    const props = value?.bnode ? this.bnodes.get(value.bnode) : null;
    const property = props?.get(V.OWL_ON_PROPERTY)?.[0];
    if (!props || typeof property !== 'string') { this.stats.unresolvedBlankNodes++; return; }
    const filler = props.get(V.OWL_SOME_VALUES_FROM)?.[0] ?? props.get(V.OWL_HAS_VALUE)?.[0];
    if (typeof filler === 'string') {
      const t = this.term(subjectIri);
      if (!t.relations) t.relations = new Map();
      t.relations.set(`${property}\u0000${filler}`, [property, filler]);
      this.term(filler);
      return;
    }
    if (props.has(V.OWL_ALL_VALUES_FROM)) this.stats.universalRestrictions++;
    else this.stats.unresolvedBlankNodes++;
  }

  /** Resolve what was deferred and produce the index. */
  finish({ format = null, sourceName = null } = {}) {
    for (const [s, b] of this.pendingSubclass) this.readClassExpression(s, { bnode: b }, false);
    for (const [s, b] of this.pendingEquivalent) this.readClassExpression(s, { bnode: b }, true);
    this.bnodes.clear();

    // Ontology header. The subject typed owl:Ontology (or skos:ConceptScheme) is
    // the ontology; when a file declares none, header literals are ignored.
    const ontologyIri = [...this.ontologyIris].sort()[0] || null;
    const ontology = { ...this.ontology, iri: ontologyIri };
    for (const [s, p, v] of this.headerTriples) {
      if (!ontologyIri || s !== ontologyIri) continue;
      if ((p === `${V.DCTERMS}title` || p === `${V.DC}title`) && !ontology.title) ontology.title = v;
      else if ((p === `${V.DCTERMS}description` || p === `${V.DC}description`) && !ontology.description) ontology.description = v;
      else if (p === V.OWL_VERSION_INFO && !ontology.version) ontology.version = v;
      else if (p === V.OBO_DATE && !ontology.date) ontology.date = v;
      else if (p === `${V.DCTERMS}license` && !ontology.license) ontology.license = v;
      else if (p === `${V.FOAF}homepage` && !ontology.homepage) ontology.homepage = v;
      else if (p === V.OWL_VERSION_IRI && !ontology.versionIri) ontology.versionIri = v;
    }

    // Which named subjects are relations, not terms.
    const propertyIris = new Set();
    const annotationProperties = new Set();
    for (const [iri, types] of this.subjectTypes) {
      for (const type of types) {
        if (V.PROPERTY_TYPES.has(type)) propertyIris.add(iri);
        if (type === V.OWL_ANNOTATION_PROPERTY) annotationProperties.add(iri);
        if (type === V.RDFS_DATATYPE) propertyIris.add(iri);
      }
    }

    const properties = new Map();
    for (const iri of propertyIris) {
      const t = this.terms.get(iri);
      properties.set(iri, {
        iri,
        label: t?.label?.value || null,
        inverseOf: this.inverseOf.get(iri) || null,
        annotation: annotationProperties.has(iri),
      });
    }

    const isTermIri = (iri) => (
      !!iri
      && !propertyIris.has(iri)
      && !this.ontologyIris.has(iri)
      && !V.isSchemaIri(iri)
    );

    // A relation is kept when its predicate is a real relation: declared an
    // object property, or not declared at all (SKOS, schema.org, Wikidata). An
    // annotation property pointing at an IRI is metadata, not a relation.
    const isRelationPredicate = (p) => !annotationProperties.has(p);

    const terms = new Map();
    for (const [iri, t] of this.terms) {
      if (!isTermIri(iri)) continue;
      const types = this.subjectTypes.get(iri);
      let kind = 'class';
      const parents = new Set(t.parents || []);
      if (types) {
        const isClass = types.has(V.OWL_CLASS) || types.has(V.RDFS_CLASS);
        const isConcept = types.has(V.SKOS_CONCEPT);
        if (isConcept && !isClass) kind = 'concept';
        for (const type of types) {
          if (V.isSchemaIri(type) || V.TERM_TYPES.has(type) || V.PROPERTY_TYPES.has(type)) continue;
          if (type === V.SKOS_CONCEPT_SCHEME || type === V.OWL_ONTOLOGY) continue;
          // Typed by one of the ontology's own classes: an individual, one step
          // more specific than that class.
          parents.add(type);
          if (!isClass) kind = 'individual';
        }
        if (!isClass && !isConcept && types.has(V.OWL_NAMED_INDIVIDUAL)) kind = 'individual';
      }
      for (const parent of parents) {
        if (parent === iri || !isTermIri(parent)) parents.delete(parent);
      }
      const relations = [];
      if (t.relations) {
        for (const [p, o] of t.relations.values()) {
          if (o === iri || !isTermIri(o) || !isRelationPredicate(p)) continue;
          relations.push({ property: p, target: o });
        }
      }
      relations.sort((a, b) => (a.property === b.property ? cmp(a.target, b.target) : cmp(a.property, b.property)));

      terms.set(iri, {
        iri,
        kind,
        label: t.label?.value || null,
        definition: t.definition?.value || null,
        synonyms: t.synonyms
          ? [...t.synonyms.values()].sort((a, b) => cmp(a.label, b.label) || cmp(a.scope, b.scope))
          : [],
        parents: [...parents].sort(),
        relations,
        equivalents: t.equivalents ? [...t.equivalents].filter((e) => e !== iri && isTermIri(e)).sort() : [],
        xrefs: t.xrefs ? [...t.xrefs].sort() : [],
        deprecated: !!t.deprecated,
        replacedBy: t.replacedBy || null,
      });
    }

    // A term mentioned only as somebody's parent or target, with nothing said
    // about it, still exists (it may carry a label elsewhere). Make sure every
    // reference resolves to an index entry.
    for (const term of [...terms.values()]) {
      for (const ref of [...term.parents, ...term.relations.map((r) => r.target)]) {
        if (!terms.has(ref)) terms.set(ref, emptyTerm(ref));
      }
    }

    return finalizeIndex({
      format,
      sourceName,
      ontology,
      terms,
      properties,
      stats: { quads: this.quadCount, ...this.stats },
    });
  }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const emptyTerm = (iri) => ({
  iri, kind: 'class', label: null, definition: null, synonyms: [], parents: [], relations: [], equivalents: [], xrefs: [], deprecated: false, replacedBy: null,
});

/** Sort terms by IRI so iteration order never depends on the source file's order. */
function finalizeIndex(index) {
  const sorted = new Map([...index.terms.entries()].sort((a, b) => cmp(a[0], b[0])));
  const props = new Map([...index.properties.entries()].sort((a, b) => cmp(a[0], b[0])));
  return { ...index, terms: sorted, properties: props, stats: { ...index.stats, terms: sorted.size } };
}

// ─── OBO Graphs JSON ─────────────────────────────────────────────────────────

const OBOGRAPH_SYNONYM_SCOPES = {
  hasExactSynonym: 'exact',
  hasRelatedSynonym: 'related',
  hasBroadSynonym: 'broad',
  hasNarrowSynonym: 'narrow',
};

const OBOGRAPH_PARENT_PREDICATES = new Set(['is_a', 'type', 'instance_of', V.RDFS_SUBCLASS_OF, V.RDF_TYPE]);

/**
 * Index an OBO Graphs JSON document (https://github.com/geneontology/obographs).
 *
 * Its edges are already the reading the RDF path works out: `is_a` is the
 * parent, any other predicate IRI is the existential restriction `sub ⊑ pred
 * some obj`. Logical definition axioms add genus parents and restrictions, as
 * an equivalentClass intersection does on the RDF side.
 *
 * @param {Object} doc - parsed JSON
 */
export function indexOboGraphs(doc, { sourceName = null } = {}) {
  const graphs = Array.isArray(doc?.graphs) ? doc.graphs : (doc?.nodes ? [doc] : []);
  if (graphs.length === 0) throw new Error('Not an OBO Graphs document: no "graphs" array.');

  const builder = new OntologyIndexBuilder();
  const terms = builder.terms;
  const kinds = new Map();
  const propertyNodes = new Map();
  let ontology = { iri: null, versionIri: null, version: null, title: null, description: null, license: null, homepage: null, date: null };
  let edgeCount = 0;

  for (const g of graphs) {
    if (!ontology.iri && g.id) {
      ontology.iri = g.id;
      ontology.version = g.meta?.version || null;
      for (const bpv of g.meta?.basicPropertyValues || []) {
        const v = bpv?.val;
        if (bpv.pred === `${V.DCTERMS}title` && !ontology.title) ontology.title = v;
        else if (bpv.pred === `${V.DCTERMS}description` && !ontology.description) ontology.description = v;
        else if (bpv.pred === `${V.DCTERMS}license` && !ontology.license) ontology.license = v;
        else if (bpv.pred === V.OWL_VERSION_INFO && !ontology.version) ontology.version = v;
        else if (bpv.pred === V.OBO_DATE && !ontology.date) ontology.date = v;
        else if (bpv.pred === `${V.FOAF}homepage` && !ontology.homepage) ontology.homepage = v;
        else if (bpv.pred === V.OWL_VERSION_IRI && !ontology.versionIri) ontology.versionIri = v;
      }
    }

    for (const n of g.nodes || []) {
      if (!n?.id) continue;
      if (n.type === 'PROPERTY') {
        propertyNodes.set(n.id, n);
        continue;
      }
      const t = builder.term(n.id);
      if (n.lbl && !t.label) t.label = { value: String(n.lbl).trim(), rank: 0, lang: '' };
      const meta = n.meta || {};
      if (meta.definition?.val && !t.definition) t.definition = { value: String(meta.definition.val).trim(), rank: 0, lang: '' };
      for (const syn of meta.synonyms || []) {
        const scope = OBOGRAPH_SYNONYM_SCOPES[syn?.pred] || V.SYNONYM_SCOPES.get(syn?.pred);
        if (!scope || !syn.val) continue;
        if (!t.synonyms) t.synonyms = new Map();
        t.synonyms.set(`${syn.val}\u0000${scope}`, { label: String(syn.val).trim(), scope });
      }
      for (const x of meta.xrefs || []) if (x?.val) add(t, 'xrefs', String(x.val));
      if (meta.deprecated) t.deprecated = true;
      for (const bpv of meta.basicPropertyValues || []) {
        if (bpv?.pred === V.IAO_REPLACED_BY && bpv.val) t.replacedBy = bpv.val;
        if (bpv?.pred === V.OBO_HAS_DB_XREF && bpv.val) add(t, 'xrefs', String(bpv.val));
      }
      if (n.type === 'INDIVIDUAL') kinds.set(n.id, 'individual');
    }

    for (const e of g.edges || []) {
      if (!e?.sub || !e?.obj || !e?.pred) continue;
      edgeCount++;
      if (propertyNodes.has(e.sub)) continue; // subPropertyOf / inverseOf between relations
      if (e.pred === 'inverseOf' || e.pred === 'subPropertyOf') continue;
      if (OBOGRAPH_PARENT_PREDICATES.has(e.pred) || V.BROADER_PREDICATES.has(e.pred)) {
        if (e.sub !== e.obj) add(builder.term(e.sub), 'parents', e.obj);
        builder.term(e.obj);
        continue;
      }
      if (V.NARROWER_PREDICATES.has(e.pred)) {
        if (e.sub !== e.obj) add(builder.term(e.obj), 'parents', e.sub);
        continue;
      }
      if (V.NON_RELATION_PREDICATES.has(e.pred)) continue;
      const t = builder.term(e.sub);
      if (!t.relations) t.relations = new Map();
      t.relations.set(`${e.pred}\u0000${e.obj}`, [e.pred, e.obj]);
      builder.term(e.obj);
    }

    for (const lda of g.logicalDefinitionAxioms || []) {
      const defined = lda?.definedClassId;
      if (!defined) continue;
      for (const genus of lda.genusIds || []) if (genus !== defined) add(builder.term(defined), 'parents', genus);
      for (const r of lda.restrictions || []) {
        if (!r?.propertyId || !r?.fillerId) continue;
        const t = builder.term(defined);
        if (!t.relations) t.relations = new Map();
        t.relations.set(`${r.propertyId}\u0000${r.fillerId}`, [r.propertyId, r.fillerId]);
      }
    }

    for (const set of g.equivalentNodesSets || []) {
      const ids = (set?.nodeIds || []).filter(Boolean);
      for (const a of ids) for (const b of ids) if (a !== b) add(builder.term(a), 'equivalents', b);
    }
  }

  // Hand the collected pieces to the same finalization the RDF path uses.
  for (const [iri, n] of propertyNodes) {
    builder.subjectTypes.set(iri, new Set([n.propertyType === 'ANNOTATION' ? V.OWL_ANNOTATION_PROPERTY : V.OWL_OBJECT_PROPERTY]));
    if (n.lbl) builder.term(iri).label = { value: String(n.lbl).trim(), rank: 0, lang: '' };
  }
  for (const [iri, kind] of kinds) {
    if (kind === 'individual') builder.subjectTypes.set(iri, new Set([V.OWL_NAMED_INDIVIDUAL]));
  }
  for (const [iri, t] of terms) {
    if (!builder.subjectTypes.has(iri) && !propertyNodes.has(iri) && (t.label || t.parents)) {
      builder.subjectTypes.set(iri, new Set([V.OWL_CLASS]));
    }
  }
  if (ontology.iri) {
    builder.ontologyIris.add(ontology.iri);
    builder.ontology = ontology;
  }

  const index = builder.finish({ format: 'obographs', sourceName });
  // finish() resolves the header from triples, of which OBO Graphs has none.
  return { ...index, ontology: { ...ontology }, stats: { ...index.stats, quads: 0, oboGraphEdges: edgeCount } };
}
