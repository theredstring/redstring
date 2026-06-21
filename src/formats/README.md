# Redstring Format Specification

**One breath:** `.redstring` is replicated-artifact linked data — a dataset format no one controls, SKOS-fluent, PROV-signed, OWL-dockable, that holds contested and interpretive structure without flattening it to formal logic.

---

## Design Principles

### Progressive enhancement

Strip every `redstring:` term from an export and what remains must still be a good SKOS+PROV dataset. The `redstring:` vocabulary (spatial, visual, cognitive) is the overlay only Redstring interprets — never load-bearing for the semantics underneath.

### Replicated-artifact, not endpoint

Redstring is **replicated-artifact linked data** (git-shaped), not endpoint linked data (DBpedia-shaped):

- **The unit of transmission is the dataset (the file), not the endpoint.**
- **Identity is intrinsic; location is an optional claim.** Entities are named by `urn:` URIs — no domain, no server, no authority, survives any takedown. Published locations attach as *additional* URIs via the sameness ladder.
- **Every file is self-contained.** Context embedded; vocabulary bundled with the app. A `.redstring` file must be interpretable in a world where every server is gone.
- Vocabulary namespace at **w3id.org** (community-run, repointable redirect). A rendezvous point, not a dependency.

### One file (invariant)

The entire universe is, and remains, **a single `.redstring` JSON-LD document**. The RDF 1.1 dataset structure is logical organization *inside* the JSON — never a file split, never sidecars, never a manifest+parts layout. Export codecs (TriG/N-Quads) are alternate full serializations of the same dataset, not components of it.

### Why these standards

| Standard | What it admitted | What Redstring adds |
|----------|-----------------|---------------------|
| **SKOS** | Categories aren't logic (`skos:broader` carries no entailment) | Graph-valued definitions (not literal strings) |
| **RDF 1.1 named graphs** | Quote without asserting — plural contested definitions | Spatial graph = named graph (one-to-one) |
| **PROV** | Who-said-what — the membrane that makes synthesis reversible | Wizard/agent provenance stamps per-entity |
| **RDF-star** | Statement interiors | Redstring edges already have interiors (`rdfStatements`) |
| **OWL `sameAs`** | Logical identity as a docking port | Used per-link, not globally asserted |

---

## v4 File Shape

```json
{
  "@context": { ... },
  "format": "redstring-v4.0.0",
  "metadata": {
    "title": "...",
    "owlVersion": "...",
    "rdfSchemaVersion": "...",
    "semanticWebCompliant": true,
    "formatHistory": [...]
  },
  "prototypeSpace": {
    "@type": "redstring:PrototypeSpace",
    "prototypes": { "<iri>": { "@type": ["redstring:Prototype", "skos:Concept", ...], ... } }
  },
  "spatialGraphs": {
    "<graph-iri>": {
      "@type": "redstring:SpatialGraph",
      "redstring:instances": { "<inst-iri>": { ... } },
      "relationships": {
        "@type": "redstring:RelationshipCollection",
        "edges": { "<edge-iri>": { ... } }
      }
    }
  },
  "userInterface": { "@type": "redstring:UserInterfaceState", ... },
  "graphLayouts": { ... },
  "graphSummaries": { ... },
  "_preserved": { ... }
}
```

**`prototypeSpace`** = the **default named graph** in the RDF 1.1 dataset. Contains every `skos:Concept` / `redstring:Prototype` node.

**Each `spatialGraphs` entry** = one **named graph** (`GRAPH <graphIri> { ... }` in TriG). Contains instance quads and edge quads scoped to that spatial canvas.

**`userInterface`** and **`graphLayouts`** / **`graphSummaries`** are excluded from both hash tiers and from the RDF projection — they carry no semantic weight and are re-derivable.

**`_preserved`** holds alien fields (unknown keys at any level) quarantined on import. They survive re-export without modification.

---

## IRI Minting

One rule, defined in `src/formats/redstringFormat.js` (`toIri`/`fromIri`):

| ID form | IRI |
|---------|-----|
| UUID (`/^[0-9a-f-]{36}$/i`) | `urn:uuid:{id}` |
| Any other string | `urn:redstring:id:{encodeURIComponent(id)}` |

`fromIri` also accepts legacy pseudo-schemes (`prototype:`, `instance:`, `graph:`, `node:`, `group:`, `type:`, `space:`) and bare IDs — forever, for backwards compatibility.

---

## The Sameness Ladder

Cumulative rule: asserting a rung co-emits all rungs below it.

```
redstring edge (associated)
  → skos:relatedMatch
    → skos:closeMatch      ← auto-enrichment links (non-transitive by design)
      → skos:exactMatch    ← user-asserted externalLinks
        → owl:sameAs       ← the OWL docking port (co-emits exactMatch)
```

**Export rule (D8):**
- `semanticMetadata.autoEnriched === true` links → `skos:closeMatch` only
- `prototype.externalLinks` URLs → `skos:exactMatch` + `owl:sameAs` (both emitted)

Redstring does not *speak* OWL (no axioms in its own voice) but *docks* with it deliberately, per-link.

---

## Prototype Export (v4)

Each prototype exports as a `skos:Concept`:

```json
{
  "@type": ["redstring:Prototype", "rdfs:Class", "schema:Thing", "skos:Concept"],
  "skos:prefLabel": "...",
  "skos:definition": "...",
  "skos:inScheme": { "@id": "<universe-iri>" },
  "skos:broader": [{ "@id": "<abstraction-chain-iri>" }],
  "skos:exactMatch": [{ "@id": "https://www.wikidata.org/entity/..." }],
  "owl:sameAs": ["https://www.wikidata.org/entity/..."],
  "prov:wasAttributedTo": { "@id": "..." },
  "redstring:visualProperties": { ... },
  "redstring:spatialContext": { ... },
  "redstring:cognitiveProperties": { ... }
}
```

---

## Edge Export (v4)

Edges are scoped inside their spatial graph. Each edge exports with an `rdfStatements` array (rdf:Statement reification) and a `directionality` object:

```json
{
  "@type": "redstring:Edge",
  "redstring:sourceId": "<inst-iri>",
  "redstring:destinationId": "<inst-iri>",
  "redstring:typeNodeId": "<prototype-iri>",
  "rdfStatements": [{
    "@type": "rdf:Statement",
    "rdf:subject":   { "@id": "<source-prototype-iri>" },
    "rdf:predicate": { "@id": "<edge-type-prototype-iri>" },
    "rdf:object":    { "@id": "<dest-prototype-iri>" }
  }],
  "redstring:directionality": {
    "redstring:arrowsToward": ["<inst-iri>"]
  }
}
```

RDF-star annotations (`{| |}`) are emitted by the TriG codec only (`rdfStar: true` option) — not in the native JSON-LD file (JSON-LD-star is not yet standardized).

---

## Migration Ledger

All version-to-version migrations are pure functions registered in `src/formats/migrations.js`. The ledger is append-only — existing entries are never edited.

```
v1.0.0 → v2.0.0-semantic  (pseudo-scheme IRI normalization)
v2.0.0-semantic → v3.0.0  (schema restructure)
v3.0.0 → v4.0.0           (D10 shape: prototypeSpace/spatialGraphs, edge scoping)
```

Backup happens at **load time**, before migration, preserving original bytes:
- Electron / writable file handle: sibling `{basename}.v{version}.bak.redstring`
- Browser: IndexedDB `RedstringBackups`, max 3 per slug (oldest evicted)

---

## Export Codecs

| Codec | File | Output |
|-------|------|--------|
| Native JSON-LD | `redstringFormat.js` | `.redstring` (the canonical format) |
| N-Quads | `codecs/nquads.js` | All quads, default graph, no named-graph partitioning |
| TriG | `codecs/trig.js` | Named-graph partitioned: one `GRAPH` block per spatial graph |

TriG invariant: named-graph count equals Redstring graph count (tested in `test/formats/codecs.test.js`).

---

## Import Adapters

| Format | Adapter | Provenance stamp |
|--------|---------|-----------------|
| JSON-LD | `importJSONLD` (async) | `semanticMetadata.provenance.wasDerivedFrom: 'JSON-LD Import'` |
| Obsidian | `importObsidian` | `wasDerivedFrom: 'Obsidian Import'` |
| Cytoscape | `importCytoscape` | `wasDerivedFrom: 'Cytoscape Import'` |
| GraphML | `importGraphML` (async) | `wasDerivedFrom: 'GraphML Import'` |

`importJSONLD` routes through the lens table (`src/formats/lens.js`): `jsonld.toRDF` → `applyLens` → `{prototypes, abstractionLinks, compositionLinks, edges, mintedPredicates}`.

---

## Merge

`src/formats/mergeUniverses.js` provides `mergeUniverses(base, incoming) → {merged, report}` — a pure function (no store access) with three prototype alignment classes:

1. **Exact ID match** → deduplicate; scalar conflicts banked to `_preserved.merge`
2. **`externalLinks` intersection** (owl:sameAs / skos:exactMatch equivalence) → merge
3. **Case-insensitive name match** → both survive; listed in `report.closeMatchCandidates` for the UI

---

## Vocabulary

The full vocabulary is at `public/vocab/redstring.ttl` (bundled with the app, always available offline). Every `redstring:` IRI used by the exporter is declared there.

A CI test (`test/formats/vocab.test.js`) asserts that every `redstring.io/vocab/` IRI emitted by `exportToRedstring` appears in the TTL.

Stable namespace: `https://w3id.org/redstring/` (pending w3id PR — see `src/formats/w3id-registration.md`). Current namespace: `https://redstring.io/vocab/`.

---

## Version Flag

`EMIT_V4` in `src/formats/redstringFormat.js` gates the v4 file shape. It is `false` until all phases 3–6 are complete and smoke-tested against real universes. The final flip — `EMIT_V4 = true`, `CURRENT_FORMAT_VERSION = '4.0.0'`, ledger entry promoted from `STAGED_MIGRATIONS` to `MIGRATIONS` — is the very last step before release.
