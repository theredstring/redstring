# Format Refactor Plan: Redstring as a Standards Extension

**Status:** Planning — not yet started
**Scope:** The `.redstring` format, migration system, multi-slot reconciliation, import/export, and standards alignment (SKOS / PROV / RDF 1.1 datasets / RDF-star / OWL docking)
**Format version target:** One bump, `redstring-v3.0.0` → `redstring-v4.0.0`
**Prime directive:** Zero data loss. Every phase ships behind tests that would catch it failing.

---

## 1. Why

Redstring's thesis — hold contested, interpretive structure without flattening it to formal logic — turns out to be what several W3C standards were each partially reaching for:

- **SKOS** admitted human categories aren't logic (`skos:broader` carries no entailment) — but its `skos:definition` is a literal string. Redstring's definition is a graph.
- **RDF 1.1 named graphs** allow quoting without asserting — exactly the semantics plural contested definitions need.
- **PROV** standardizes who-said-what — the membrane that makes synthesis reversible.
- **RDF-star** gives statements interiors — which Redstring edges already have.

The refactor makes Redstring a *legitimate extension* of these standards rather than a gesture at them. The conformance principle is **progressive enhancement**: strip every `redstring:` term from an export and what remains must still be a good SKOS+PROV dataset on its own. The `redstring:` vocabulary (spatial, visual, cognitive) is the overlay only Redstring interprets — it must never be load-bearing for the semantics underneath.

### Decentralization doctrine

Redstring is **replicated-artifact linked data** (git-shaped), not endpoint linked data (DBpedia-shaped):

- **The unit of transmission is the dataset (the file), not the endpoint.** Standards govern the format of what's replicated, not where it lives.
- **Identity is intrinsic; location is an optional claim.** Entities are named by `urn:uuid:` URIs — valid RDF, no domain, no server, no authority, survives any takedown. Published locations (a user's domain, repo, pod — wherever they see fit) attach as *additional* URIs via the sameness ladder. Hosting is a statement about a thing, never its name.
- **Every file is self-contained.** The `@context` is embedded (already true); the vocabulary document ships inside every Electron install and is referenced by version from exports. A `.redstring` file must be fully interpretable in a world where every server is gone.
- The vocabulary namespace lives at **w3id.org** (community-run permanent-identifier infra, not ours; redirect target repointable to any mirror). A rendezvous point, not a dependency.

---

## 2. Current-state audit (what we found)

| # | Finding | Where | Severity |
|---|---------|-------|----------|
| 1 | **Triple redundancy**: prototypes/graphs/edges serialized 3× (`prototypeSpace`/`spatialGraphs`/`relationships`, top-level accessors, `legacy`) | `src/formats/redstringFormat.js` | File bloat, drift hazard, 3× duplicate triples through any RDF processor |
| 2 | **Pseudo-scheme URIs**: `prototype:abc`, `instance:xyz`, `graph:123`, `node:...` — invalid as dereferenceable identity, garbage through `jsonld.toRDF` | `redstringFormat.js` export | Blocks all standards interop |
| 3 | **Directionality → RDF projection bug**: 4 native states collapse to 2 RDF shapes; `arrowsToward={sourceId}` (target→source) exports the *forward* triple (wrong direction); bidirectional exports only one triple | `redstringFormat.js:825-850` | Exported RDF contradicts the canvas in 2 of 4 states |
| 4 | **Migration logic smeared**: `migrateFormat()` mostly relabels version strings; real shape-shifting hides in `importFromRedstring`'s three-way branch (semantic / legacy / v1-flat) | `redstringFormat.js:182-199, 966-1007` | Migration correctness unauditable |
| 5 | **Unknown fields silently dropped** on import/migration | `redstringFormat.js` import paths | Direct data-loss vector |
| 6 | **No local-file backup before format-upgrading overwrite** (git slot has commit history; browser keeps 3 versions; local file has nothing) | `src/services/universeBackend.js` | Migration bug = unrecoverable loss for local-only users |
| 7 | **Slot conflict detection is byte/structure-based** (node counts + content SHA) — a v2 file in git vs the same knowledge as v3 local reads as a permanent conflict | `universeBackend.js` `detectSlotConflict()` | Multi-slot + migration don't compose |
| 8 | **No SKOS, no PROV** in the `@context`; full OWL axiom toolkit (`disjointWith`, property characteristics) present instead | `redstringFormat.js` context (~line 280) | Wrong register: speaks the logic vocabulary, missing the organizational + provenance ones |
| 9 | Per-adapter improvised predicate mappings; no shared lens table | `src/formats/importAdapters.js` | N×M converter sprawl |

### Edge directionality reference (native model — this is correct and stays)

`edge.directionality.arrowsToward: Set<nodeId>` (`src/core/Edge.js:50-53`):

| Set contents | Meaning | Correct RDF projection |
|---|---|---|
| empty | non-directed | **two** reciprocal triples (s→o and o→s) |
| `{destinationId}` | source → target | one triple: s→o |
| `{sourceId}` | target → source | one triple: **o→s** |
| both | bidirectional | **two** reciprocal triples |

Predicate resolution: `edge.definitionNodeIds[0]` → its prototype → fallback `edge.typeNodeId` → default `base-connection-prototype`. Degradation target for base connection: `skos:related` (symmetric in SKOS by definition — matches non-directed semantics).

### Universe slot reference (stays as-is; reconciliation changes)

Per-universe config (`universeBackend.js:53-64`): `sourceOfTruth: 'local'|'git'|'browser'`, with `localFile.*`, `gitRepo.*`, `browserStorage.*` slot configs. Saves write to **all enabled slots**; loads read from `sourceOfTruth`.

---

## 3. Target architecture (v4)

### 3.1 The dataset model

A `.redstring` file is a strict **JSON-LD 1.1 profile of an RDF dataset**:

- **Default graph** = the prototype space + scheme metadata + statements *about* the named graphs (labels, SKOS structure, mappings, PROV). Prototypes are dataset-scoped.
- **Each Redstring graph (web/definition graph)** = a **named graph** of instance triples. Instances are graph-scoped — positioned within a context, quoted not globally asserted. The graph's name URI is the same URI `definitionGraphIds` points to: blackboxing in dataset terms.
- Plural contested definitions = multiple named graphs per concept, each with its own provenance. No consistency demanded across them. This is the thesis, expressed in W3C Recommendation semantics.

### 3.2 Identity

- All entities named `urn:uuid:{id}`. No pseudo-schemes, no required domain.
- Published locations attach later as additional URIs (sameness ladder).

### 3.3 JSON-LD profile mechanics

- **One canonical location per entity.** Redundant copies and `legacy` block removed (read-side shim keeps reading old files forever via the ledger).
- **Id maps** (`"@container": "@id"`) — the existing `{ "[id]": {...} }` Map shape becomes valid JSON-LD without restructuring.
- **`@nest`** for `spatialContext` / `visualProperties` / `cognitiveProperties` — cosmetic nesting, no blank-node pollution.
- **Datatype coercions**: coordinates → `xsd:decimal`, timestamps → `xsd:dateTime`.
- CI conformance: `exportToRedstring → jsonld.toRDF → sane, non-duplicated N-Quads` (machinery already exists in `src/formats/rdfExport.js`).

### 3.4 Standards mapping

| Redstring concept | Standard | Term |
|---|---|---|
| Universe | SKOS | `skos:ConceptScheme` |
| Prototype | SKOS | `skos:Concept` + `skos:inScheme` |
| Name / aliases | SKOS | `skos:prefLabel` / `skos:altLabel` |
| Abstraction chain link | SKOS | `skos:broader` / `skos:narrower` (+ dimension via RDF-star annotation) |
| Definition graph | RDF 1.1 | named graph |
| Plural definitions | RDF 1.1 | multiple named graphs per concept |
| Attribution / origin | PROV | `prov:wasAttributedTo`, `prov:wasDerivedFrom`, `prov:generatedAtTime`; Wizard = `prov:SoftwareAgent` |
| Edge interior (name, type, defs) | RDF-star | annotated triple `{| ... |}` |
| Typed edge, degraded | SKOS | `skos:related` |
| Spatial/visual/cognitive | `redstring:` | the published overlay vocabulary |

### 3.5 The sameness ladder (cumulative)

```
redstring edge (associated)
  → skos:relatedMatch
    → skos:closeMatch      (aligned; non-transitive BY DESIGN — prevents drift chains)
      → skos:exactMatch    (interchangeable for most purposes)
        → owl:sameAs       (logically identical; full substitutability)
```

- **Asserting a rung exports all rungs below it.** `owl:sameAs` always co-emits `skos:exactMatch` so SKOS-only consumers see the alignment.
- `owl:sameAs` is the **docking port to OWL**: it pulls the full inferential context of formal ontologies (Wikidata, OBO, domain models) into reach. Redstring doesn't *speak* OWL in its own voice (no disjointness/property axioms; prune those from the context) but it *docks* with OWL deliberately, per-link.
- Default for auto-enrichment links: `skos:closeMatch`. Higher rungs are user/agent-asserted with intent.

### 3.6 Migration system

- **Append-only ledger**: ordered pure functions `v1→v2 → v2→v3 → v3→v4`. Each frozen once shipped. Load = parse → detect → run ledger to current → importer that understands *only* the current version. The three-way import branch dissolves into ledger steps.
- **Unknown-field preservation**: every migration step carries unrecognized keys into a single per-entity quarantine bag `_preserved: { "<sourceVersion>": { ...fields } }`. Visible (schema-report counts them), managed (a future ledger step may graduate or deliberately retire a field — logged decision, never silent). This also protects newer files opened by older installs, which decentralized distribution makes inevitable: preserve what you don't understand; never strip on re-save.
- **Backup invariant**: never overwrite a file whose detected version is older than current without first writing `{name}.v{N}.bak.redstring` beside it (local slot; git and browser slots already have history).

### 3.7 Semantic hashing & slot reconciliation

- Replace byte/structure conflict detection with **canonical RDF dataset hashing**: project each slot's content to canonical N-Quads (`jsonld.canonize()` — already a dependency) and compare hashes. Same knowledge, different format version / key order / serialization → same hash.
- Two tiers: **semantic hash** (the dataset) for "same knowledge"; full hash for "same everything".
- This makes the slot matrix {local, git, browser} × {v1..v4} × {empty, populated, divergent} tractable: every cell reduces to canonical-quad comparison plus existing sourceOfTruth precedence.

### 3.8 Import/export hub

One canonical internal projection (the RDF dataset + overlay); thin codecs on each side. No more N×M converters.

- **Inbound pipeline**: detect → parse → migrate (ledger) → align (shared **lens table** routes foreign predicates: `subClassOf`/`skos:broader`/P279 → abstraction chains; `hasPart`/P527 → definition-graph membership; everything else → typed edges with auto-minted relation prototypes) → provenance-stamp (`prov:wasDerivedFrom` source) → land as provisional → merge.
- **Outbound codecs**: native JSON-LD profile (.redstring), TriG (named graphs preserved — human-readable publishing), N-Quads (streaming/diff), flattened Turtle (naive consumers), GraphML/CSV.
- **Merge = dataset union**: named graphs keep identity (URN names can't collide); prototype alignment in the default graph uses the sameness ladder (`closeMatch` = "probably same, ask"; `exactMatch` = merge candidate). The load-from-link → parse → merge flow gets its formal foundation here.
- Existing adapters (Obsidian, Cytoscape, GraphML — `importAdapters.js`) refactor into inbound codecs and gain migration/provenance/merge for free. Ingestion is **additive**: source fragments ride along as provenance; translation is reversible.

---

## 4. Phases

Each phase is independently shippable. The format version bumps **once**, at the end of Phase 3. Phases 0–3 develop on a branch against the v4 target; Phases 4–6 are post-bump.

### Phase 0 — Safety net (before touching anything)

No corpus collection required. Every test here generates its own data.

- [ ] **Round-trip invariant tests**: `import(export(state))` deep-equals state (modulo Map/Set rehydration); `export(import(file))` fixpoint after one migration; edge cases (empty universe, single node, unicode names, large graph).
- [ ] **Alien-field survival test**: inject unknown fields into a generated file → round-trip → assert preserved in quarantine bag.
- [ ] **Directionality four-state test**: each `arrowsToward` state → exact expected triples (pins audit finding #3 before and after the fix).
- [ ] **Fixtures drop folder**: `test/fixtures/universes/` — auto-discovered by the suite, valid when empty. Any old file that ever causes worry gets dropped in and is covered forever. Passive, not a project.
- [ ] **`schema-report` CLI**: takes any `.redstring` file → prints format version, entity counts, quad count, semantic hash, quarantined-field count, migration path it would take.
- [ ] **Backup invariant** implemented in the local-file save path (audit finding #6) — ships in Phase 0 because it protects against *today's* migration code, not just tomorrow's.

**Done when:** suite green on current v3 behavior (bugs pinned as `.fails` tests where needed); CLI runs on a real universe file.

### Phase 1 — Format hygiene

- [ ] Fix directionality → RDF projection (finding #3); flip the pinned tests to passing.
- [ ] Consolidate migration into the **append-only ledger**; importer reduced to current-version-only.
- [ ] Quarantine-bag unknown-field preservation wired through every ledger step.
- [ ] Kill triple redundancy: one canonical location per entity; `legacy` writing removed (reading stays in the ledger).
- [ ] Replace pseudo-scheme URIs with `urn:uuid:`.

### Phase 2 — Standards layer

- [ ] `@context` rework: SKOS + PROV prefixes in; OWL axiom toolkit pruned (keep `owl:sameAs`); id maps, `@nest`, datatype coercions.
- [ ] SKOS terms emitted: `ConceptScheme`/`Concept`/`inScheme`/`prefLabel`/`altLabel`/`broader`/`related`.
- [ ] Sameness ladder implemented, cumulative export (`sameAs` ⊨ `exactMatch`); enrichment links default to `closeMatch`.
- [ ] PROV stamping: imports get `wasDerivedFrom`; Wizard-created structure gets `wasAttributedTo` a `prov:SoftwareAgent` (model + timestamp). Replaces the ephemeral `setChangeContext` marker as the durable record.

### Phase 3 — Dataset structure (the v4 bump)

- [ ] Default graph = prototype space + scheme + graph-level statements; each web/definition graph = named graph.
- [ ] RDF-star annotations for edge interiors and abstraction-dimension labels.
- [ ] Ledger entry `v3→v4`; version bump; backup invariant exercised on every upgraded file.
- [ ] CI conformance gate: `jsonld.toRDF` round-trip; **strip test** (remove all `redstring:` triples → remains coherent SKOS+PROV).

### Phase 4 — Semantic hashing & slot reconciliation

- [ ] `jsonld.canonize()`-based semantic hash; two-tier comparison.
- [ ] Rebuild `detectSlotConflict()` on semantic hashing; slot-matrix simulation tests ({slot} × {version} × {state}), explicitly covering the empty-primary/populated-secondary trap.

### Phase 5 — Import/export hub

- [ ] Shared lens table; existing adapters refactored to inbound codecs.
- [ ] Outbound codecs: TriG, N-Quads, flattened Turtle (replaces current `rdfExport.js` flattening), GraphML.
- [ ] Merge-as-dataset-union with ladder-based prototype alignment.

### Phase 6 — Vocabulary & evangelism

- [ ] `redstring:` vocabulary as a Turtle document: every term with `rdfs:label`/`rdfs:comment`, typed relations to host standards (`redstring:hasDefinitionGraph` ↔ `skos:definition`, etc.). Bundled in the app; namespace registered at w3id.org; HTML rendering via Pages content negotiation.
- [ ] README + docs rewrite around the one-breath story: *replicated-artifact linked data; a dataset format no one controls; SKOS-fluent, PROV-signed, OWL-dockable.*

---

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Migration bug corrupts old files | Backup invariant (Phase 0) + ledger purity + round-trip tests. Worst case becomes "restore the .bak", not loss. |
| Quarantine bag becomes a landfill | It's inventoried: schema-report counts per version; graduating/retiring is an explicit ledger decision. |
| v4 files reach older installs (decentralized distribution guarantees this) | Older installs preserve unknown structure via the same quarantine rule; never strip on re-save. Document the rule as part of the format spec. |
| Slot false-conflicts during the transition (v3 in git, v4 local) | Semantic hashing lands in Phase 4; until then, version-aware comparison (migrate-then-compare) as a stopgap in `detectSlotConflict()`. |
| jsonld.toRDF performance on large universes | Canonicalization runs on save/sync boundaries, not per-keystroke; cache by store hash (SaveCoordinator already computes one). |
| Scope creep into Wizard/browse-cache work | Out of scope here. This plan is the format/migration/interop layer only. Ghost layer and Wizard provenance UX build *on* Phase 2's PROV stamping later. |

## 6. Non-goals (this refactor)

- No ghost/provisional browse layer (separate effort; depends on this one).
- No SPARQL endpoint, no live dereferencing portals (the format work makes them possible later).
- No OWL axiom authoring. We dock with OWL; we don't speak it.
- No change to the native in-memory store model (prototypes/instances/edges Maps stay as they are — this is a serialization-layer refactor).

## 7. Open questions

- [ ] Exact `_preserved` shape: per-entity vs per-file section? (Leaning per-entity, keyed by source version.)
- [ ] w3id registration timing — needs a public repo URL for the redirect PR; can land any time before Phase 6.
- [ ] TriG-star vs plain TriG + reification fallback for consumers without RDF-star support (likely: emit both behind an export option).
- [ ] Whether `graphLayouts` / `graphSummaries` sections survive v4 or become derived/optional artifacts.
