# Format Refactor Plan: Redstring as a Standards Extension

**Status:** Planning — not yet started
**Scope:** The `.redstring` format, migration system, multi-slot reconciliation, import/export, and standards alignment (SKOS / PROV / RDF 1.1 datasets / RDF-star / OWL docking)
**Format version target:** One bump, `redstring-v3.0.0` → `redstring-v4.0.0`
**Prime directive:** Zero data loss. Every phase ships behind tests that would catch it failing.

---

## 0. Executor protocol (read first)

This document is written so tasks can be executed by any model or contributor **without architectural judgment**. All decisions are pre-made in §3 (Decisions) and in the task text. If a task seems to require a decision not written here, STOP and flag it — do not improvise.

- Do **one task per commit/PR**. Tasks are numbered (P0.1, P0.2, …) and ordered; respect `Depends:` lines.
- After every task run `npm run test:format` plus the task's own `Verify:` command. All green (or explicitly-pinned `it.fails`) before moving on.
- **Never edit a shipped migration ledger entry.** Append only.
- **Never delete or weaken a failing test.** Tests marked `it.fails` are pinned bugs; a later task flips them to passing — only when its text says so.
- Sizes: **S** ≈ under an hour, **M** ≈ a sitting, **L** ≈ a day. Nothing should exceed L; if it does, stop and flag.

---

## 1. Why

Redstring's thesis — hold contested, interpretive structure without flattening it to formal logic — is what several W3C standards were each partially reaching for:

- **SKOS** admitted human categories aren't logic (`skos:broader` carries no entailment) — but its `skos:definition` is a literal string. Redstring's definition is a graph.
- **RDF 1.1 named graphs** allow quoting without asserting — exactly the semantics plural contested definitions need.
- **PROV** standardizes who-said-what — the membrane that makes synthesis reversible.
- **RDF-star** gives statements interiors — which Redstring edges already have.

The conformance principle is **progressive enhancement**: strip every `redstring:` term from an export and what remains must still be a good SKOS+PROV dataset. The `redstring:` vocabulary (spatial, visual, cognitive) is the overlay only Redstring interprets — never load-bearing for the semantics underneath.

### Decentralization doctrine

Redstring is **replicated-artifact linked data** (git-shaped), not endpoint linked data (DBpedia-shaped):

- **The unit of transmission is the dataset (the file), not the endpoint.**
- **Identity is intrinsic; location is an optional claim.** Entities are named by `urn:` URIs — no domain, no server, no authority, survives any takedown. Published locations attach as *additional* URIs via the sameness ladder.
- **Every file is self-contained.** Context embedded; vocabulary bundled with the app. A `.redstring` file must be interpretable in a world where every server is gone.
- Vocabulary namespace at **w3id.org** (community-run, repointable redirect). A rendezvous point, not a dependency.

### One file (invariant)

The entire universe is, and remains, **a single `.redstring` JSON-LD document**. The RDF 1.1 dataset structure is logical organization *inside* the JSON (D10: `prototypeSpace` = default graph; each `spatialGraphs` entry = a named graph) — never a file split, never sidecars, never a manifest+parts layout. Export codecs (TriG/N-Quads/Turtle) are alternate full serializations of the same dataset, not components of it. The only things outside the file: slot/location config (the replication layer, per-install), the public vocabulary document (files stay self-interpretable via the embedded `@context`), backups (copies), and auto-enriched image bytes (URLs are in the file; pixels re-fetched). If a task would move knowledge out of the file, it violates this invariant — stop and flag.

### The sameness ladder (cumulative)

```
redstring edge (associated)
  → skos:relatedMatch
    → skos:closeMatch      (aligned; non-transitive BY DESIGN)
      → skos:exactMatch    (interchangeable for most purposes)
        → owl:sameAs       (logically identical; the docking port to OWL)
```

Asserting a rung exports all rungs below it (`owl:sameAs` always co-emits `skos:exactMatch`). Redstring doesn't *speak* OWL (no axioms in its own voice) but *docks* with it deliberately, per-link.

---

## 2. Current-state audit

| # | Finding | Where | Severity |
|---|---------|-------|----------|
| 1 | **Triple redundancy**: prototypes/graphs/edges serialized 3× (`prototypeSpace`/`spatialGraphs`/`relationships`, top-level accessors, `legacy`) | `src/formats/redstringFormat.js` `exportToRedstring` (L535+) | Bloat, drift hazard, 3× duplicate triples via RDF |
| 2 | **Pseudo-scheme IRIs**: `prototype:abc`, `instance:xyz`, `graph:123`, `node:…` | `redstringFormat.js` export | Blocks standards interop |
| 3 | **Directionality → RDF bug**: `arrowsToward={sourceId}` exports the *forward* triple (wrong direction); bidirectional exports only one triple | `redstringFormat.js:825-850` | Exported RDF contradicts canvas in 2 of 4 states |
| 4 | **Migration smeared**: `migrateFormat` (L160) relabels; real shape-shifting hides in `importFromRedstring`'s three-way branch (L963+) | `redstringFormat.js` | Unauditable |
| 5 | **Unknown fields silently dropped** on import/migration | `redstringFormat.js` import paths | Direct data-loss vector |
| 6 | **No local-file backup** before format-upgrading overwrite (git has history; browser keeps 3 versions; local has nothing) | `src/services/universeBackend.js` | Migration bug = unrecoverable loss |
| 7 | **Slot conflict detection is byte/structure-based** (`detectSlotConflict`, universeBackend.js:3563) — same knowledge in different format versions reads as permanent conflict | `universeBackend.js` | Slots + migration don't compose |
| 8 | **No SKOS, no PROV** in `@context`; full OWL axiom toolkit present instead | `redstringFormat.js` `REDSTRING_CONTEXT` (L206+) | Wrong register |
| 9 | Per-adapter improvised predicate mappings; no shared lens | `src/formats/importAdapters.js` | N×M sprawl |

### Edge directionality reference (native model — correct, unchanged)

`edge.directionality.arrowsToward: Set<nodeId>` (`src/core/Edge.js:50-53`):

| Set contents | Meaning | Correct RDF projection |
|---|---|---|
| empty | non-directed | **two** reciprocal triples |
| `{destinationId}` | source → target | one triple s→o |
| `{sourceId}` | target → source | one triple **o→s** |
| both | bidirectional | **two** reciprocal triples |

Predicate resolution: `edge.definitionNodeIds[0]` → its prototype → fallback `edge.typeNodeId` → default `base-connection-prototype`. SKOS degradation target for base connection: `skos:related` (symmetric in SKOS — matches non-directed).

### Existing test assets (build on, don't duplicate)

`test/formats/roundtrip.test.js`, `property.test.js`, `consistency.test.js`, `multiEdgeRoundtrip.test.js` already cover multi-round-trip survival, Unicode, Set/Map preservation, random graphs. Run via `npm run test:format`.

---

## 3. Decisions (pre-made — executors do not revisit)

**D1 — Quarantine bag shape.** Per-entity, keyed by the format version the data came from:
```json
"_preserved": { "2.0.0-semantic": { "someUnknownField": "value" } }
```
Lives on prototypes, instances, edges, graphs, and the file root. Round-trips verbatim. Excluded from RDF projection. `schema-report` counts entries.

**D2 — Ledger API** (new file `src/formats/migrations.js`):
```javascript
export const MIGRATIONS = [
  { from: '1.0.0',          to: '2.0.0-semantic', migrate(data) { /* pure */ } },
  { from: '2.0.0-semantic', to: '3.0.0',          migrate(data) { /* pure */ } },
  // P3.3 appends: { from: '3.0.0', to: '4.0.0', migrate(data) { ... } }
];
// Walks from detected version to CURRENT_FORMAT_VERSION, applying in order.
// Each step: (a) deep-clones input, (b) moves keys it doesn't recognize into
// _preserved[fromVersion] instead of dropping them, (c) returns the new shape.
export function runMigrations(data) { /* returns { data, applied: ['1.0.0→2.0.0-semantic', ...] } */ }
```
Migration functions are pure: no I/O, no Date.now() (timestamps passed in), no store access.

**D3 — IRI minting.** IDs matching the UUID regex → `urn:uuid:{id}`. All other IDs (e.g. `base-connection-prototype`) → `urn:redstring:id:{encodeURIComponent(id)}`. One helper `toIri(id)` / `fromIri(iri)` in `redstringFormat.js`; `fromIri` also accepts legacy pseudo-schemes (`prototype:`, `instance:`, `graph:`, `node:`, `group:`, `type:`, `space:`) and bare IDs, forever.

**D4 — Backup trigger & destination.** Backup happens at **load time**, before migration runs, preserving the original bytes:
- Electron / live file handle: sibling file `{basename}.v{detectedVersion}.bak.redstring` (skip if it already exists).
- Browser without directory permission: IndexedDB DB `RedstringBackups`, key `{slug}:{detectedVersion}:{isoTimestamp}`, keep max 3 per slug (oldest evicted).

**D5 — Hash tiers.** Tier-1 **semantic hash** = SHA-256 over canonical N-Quads (`jsonld.canonize`, URDNA2015) of the dataset projection — covers default graph + named graphs only. Tier-2 **full hash** = SHA-256 over canonically-ordered JSON minus `userInterface`, viewport fields, `graphLayouts`, `graphSummaries`. Slot reconciliation uses tier-1 for "same knowledge", tier-2 for "same everything".

**D6 — RDF-star placement.** JSON-LD-star is not standardized → the **native file keeps edge interiors as `redstring:` fields** (unchanged). RDF-star annotations appear only in the TriG codec (P5.2), which emits TriG-star plus a plain-TriG fallback option.

**D7 — `graphLayouts` / `graphSummaries`** survive in v4, explicitly marked derived/regenerable, excluded from both hash tiers and from the RDF projection.

**D8 — Ladder defaults.** Auto-enrichment links (`semanticMetadata.autoEnriched`) export as `skos:closeMatch`. Links in a prototype's existing `owl:sameAs`/`externalLinks` arrays export as `skos:exactMatch` + `owl:sameAs` (cumulative rule). The in-memory store model does NOT change in this refactor; rung metadata richer than this is future work.

**D9 — OWL context pruning.** Delete from `REDSTRING_CONTEXT`: `disjointWith`, `inverseOf`, `functionalProperty`, `inverseFunctionalProperty`, `transitiveProperty`, `symmetricProperty`, `equivalentClass`. Keep: `sameAs`. Add prefixes: `"skos": "http://www.w3.org/2004/02/skos/core#"`, `"prov": "http://www.w3.org/ns/prov#"`.

**D10 — v4 native file shape (target of P3.1).** Top level:
```json
{
  "@context": { ... },
  "format": "redstring-v4.0.0",
  "metadata": { ... },
  "prototypeSpace": { ... },        // the DEFAULT GRAPH: prototypes + scheme + graph-level statements
  "spatialGraphs": { ... },          // each entry = a NAMED GRAPH (instances + edges scoped inside it)
  "userInterface": { ... },
  "graphLayouts": { ... },           // derived (D7)
  "graphSummaries": { ... },         // derived (D7)
  "_preserved": { ... }
}
```
No top-level `graphs`/`nodePrototypes`/`edges` duplicates, no `legacy` block. Edges move INSIDE their graph's entry (they are graph-scoped statements). `relationships` section dissolves.

---

## 4. Phases & atomic tasks

### Phase 0 — Safety net (no production behavior changes except P0.5)

**P0.1 — Fixtures drop folder** (S)
Files: `test/fixtures/universes/.gitkeep` (new), `test/formats/fixtures.test.js` (new)
Do: Test that globs `test/fixtures/universes/**/*.redstring`, and for each file: parse JSON → `importFromRedstring` → expect no throw → `exportToRedstring` → `importFromRedstring` again → expect node/edge/graph counts equal between the two imports. Suite passes vacuously when the folder is empty.
Verify: `npx vitest test/formats/fixtures.test.js --run`
Done when: green with empty folder; dropping any `.redstring` file in makes it covered with no code change.

**P0.2 — Alien-field survival test (pinned failing)** (S)
Files: `test/formats/alienFields.test.js` (new)
Do: Build a minimal store state (reuse helpers from `roundtrip.test.js`), export it, then inject unknown keys into the JSON at four levels: file root, one prototype, one instance, one edge (e.g. `"xFutureField": {"nested": true}`). Import → export → assert the keys survive (location per D1: in `_preserved` after Phase 1; for now assert presence *anywhere* in output). Mark each case `it.fails` — they pin audit finding #5.
Verify: `npx vitest test/formats/alienFields.test.js --run`
Done when: all cases fail-as-expected (`it.fails` green).

**P0.3 — Directionality four-state test (2 cases pinned failing)** (S)
Files: `test/formats/directionalityRdf.test.js` (new)
Do: Build a state with two prototypes, one graph, two instances, one edge with `typeNodeId: 'base-connection-prototype'`. For each of the four `arrowsToward` states, export and inspect the edge's `rdfStatements`: non-directed → 2 reciprocal statements (plain `it`, currently passes); source→target → 1 forward (plain `it`, passes); target→source → expect 1 statement `dest→source` (`it.fails`); bidirectional → expect 2 reciprocal (`it.fails`).
Verify: `npx vitest test/formats/directionalityRdf.test.js --run`

**P0.4 — `schema-report` CLI** (M)
Files: `scripts/schema-report.js` (new), `package.json` (add `"schema:report": "node scripts/schema-report.js"`)
Do: Node script, usage `node scripts/schema-report.js <file.redstring>`. Reads the file, prints: detected format version (via `validateFormatVersion`), migration path it would take (list of ledger steps; until P1.1 exists, print "legacy migrateFormat"), counts (prototypes, graphs, instances, edges), `_preserved` entry count, duplicate-section presence (does the file contain top-level `nodePrototypes`/`legacy`?), and file size. Import `redstringFormat.js` directly; this runs in Node, so guard any browser-only references.
Verify: run it against a real exported universe file.
Done when: readable one-screen report on any v1/v2/v3 file without throwing.

**P0.5 — Backup invariant** (M)
Files: `src/services/universeBackend.js` (loadUniverseData path, ~L3274+), possibly `src/services/fileHandlePersistence.js`
Do: Implement D4. In the load flow, after reading raw bytes and detecting `version < CURRENT_FORMAT_VERSION` but **before** import/migration: write the backup (sibling file when a writable handle/Electron path exists; otherwise IndexedDB `RedstringBackups` with 3-per-slug eviction). Log one `[FormatBackup]` line on success/failure; backup failure must NOT block loading (warn and continue).
Verify: manually load a v2-era file (or hand-edit a file's `format` field down) and confirm the `.bak` / IndexedDB entry appears.
Done when: older-version load produces exactly one backup; repeat loads don't duplicate it.

### Phase 1 — Format hygiene

**P1.1 — Create the migration ledger** (M)
Files: `src/formats/migrations.js` (new), `src/formats/redstringFormat.js`
Do: Implement D2. Move the body of `migrateFormat` (redstringFormat.js:160-199) into ledger entries `1.0.0→2.0.0-semantic` and `2.0.0-semantic→3.0.0`. Move the v1-flat and `legacy` reading logic out of `importFromRedstring`'s branches into those same ledger steps (each step reshapes data toward the next version's canonical shape, so `importFromRedstring` keeps ONLY its current-version path). Keep `migrateFormat` as a thin deprecated wrapper around `runMigrations`. `importFromRedstring` calls `runMigrations` first, then imports assuming current shape.
Verify: `npm run test:format` (all existing suites stay green), plus P0.1 fixtures.
Done when: `importFromRedstring` has a single shape-branch; ledger unit-testable in isolation.

**P1.2 — Quarantine unknown fields in the ledger** (M) — Depends: P1.1
Files: `src/formats/migrations.js`, `test/formats/alienFields.test.js`
Do: In `migrations.js`, define known-key whitelists per entity type (`KNOWN_PROTOTYPE_KEYS`, `KNOWN_INSTANCE_KEYS`, `KNOWN_EDGE_KEYS`, `KNOWN_GRAPH_KEYS`, `KNOWN_ROOT_KEYS`) matching the current importer's consumed fields. `runMigrations` final pass: any key not whitelisted moves to `_preserved[detectedVersion]` per D1.
Done when: root/prototype/edge `it.fails` cases in P0.2 flip to passing `it` (instance case may flip in P1.3).

**P1.3 — Carry `_preserved` through import/export** (M) — Depends: P1.2
Files: `src/formats/redstringFormat.js` (`importFromRedstring`, `exportToRedstring`)
Do: Import copies `_preserved` from each serialized entity onto the corresponding store object; export writes it back out at the same level. Store code never reads it — it's opaque cargo.
Done when: ALL P0.2 cases pass as plain `it`; full round trip through the live store preserves alien fields.

**P1.4 — Fix the directionality projection** (S)
Files: `src/formats/redstringFormat.js:825-850`
Do: Replace the `rdfStatements` IIFE with:
```javascript
const buildEdgeStatements = (edge, sourceProtoId, destProtoId, predicateProtoId) => {
  if (!sourceProtoId || !destProtoId || !predicateProtoId) return null;
  const arrows = edge.directionality?.arrowsToward;
  const has = (id) => arrows instanceof Set ? arrows.has(id)
    : Array.isArray(arrows) ? arrows.includes(id) : false;
  const toDest = has(edge.destinationId);
  const toSource = has(edge.sourceId);
  const triple = (s, o) => ({ '@type': 'Statement',
    subject: { '@id': toIri(s) }, predicate: { '@id': toIri(predicateProtoId) },
    object: { '@id': toIri(o) } });
  if (toDest && !toSource) return [triple(sourceProtoId, destProtoId)];
  if (toSource && !toDest) return [triple(destProtoId, sourceProtoId)];
  return [triple(sourceProtoId, destProtoId), triple(destProtoId, sourceProtoId)]; // none or both
};
```
(`toIri` may be a passthrough using the current `node:` prefix until P1.6 lands.)
Done when: both P0.3 `it.fails` cases flip to passing.

**P1.5 — Single-source serialization** (M) — Depends: P1.1
Files: `src/formats/redstringFormat.js` (`exportToRedstring`)
Do: Stop writing top-level `graphs`/`nodePrototypes`/`edges` mirrors and the entire `legacy` block. Reading them stays supported forever via the ledger. Update `schema-report` duplicate-section check expectations.
Verify: `npm run test:format`; export a universe and confirm file size drops roughly 3×.
Done when: output contains each entity exactly once; all suites green.

**P1.6 — URN identity** (M) — Depends: P1.4
Files: `src/formats/redstringFormat.js`
Do: Implement D3's `toIri`/`fromIri`. Sweep `exportToRedstring` for every template-literal IRI (`prototype:${…}`, `instance:${…}`, `graph:${…}`, `node:${…}`, `group:${…}`, `type:${…}`, `space:…`) → `toIri(...)`. Sweep `importFromRedstring` ID-parsing for the inverse → `fromIri(...)`. Remove the now-unused pseudo-prefix declarations from the context.
Done when: exported file contains zero pseudo-scheme IRIs (add this assertion to `test/formats/consistency.test.js`); old files still import (fixtures + existing suites green).

### Phase 2 — Standards layer

**P2.1 — Context: prune OWL, add SKOS+PROV prefixes** (S)
Files: `src/formats/redstringFormat.js` (`REDSTRING_CONTEXT`, L206+)
Do: Exactly D9. Nothing else changes yet.
Verify: `npm run test:format`.

**P2.2 — Context: id maps, @nest, datatypes** (M) — Depends: P1.5
Files: `src/formats/redstringFormat.js`
Do: Declare `prototypes`/`instances` map containers as `{"@container": "@id"}`; declare `spatialContext`/`visualProperties`/`cognitiveProperties` as `"@nest"` groupings; coerce `xCoordinate`/`yCoordinate`/`spatialScale` → `xsd:decimal`, `created`/`modified`/`lastViewed` → `xsd:dateTime`.
Done when: P2.3's conformance test passes.

**P2.3 — jsonld.toRDF conformance test** (M) — Depends: P2.2
Files: `test/formats/jsonldConformance.test.js` (new)
Do: Export a representative state → `jsonld.toRDF(data, {format: 'application/n-quads'})` (dependency already present; see `src/formats/rdfExport.js`). Assert: parse succeeds; no quad appears twice; no IRI uses a pseudo scheme; at least one quad per prototype and per edge exists.
Done when: green, and added to `test:format` glob (automatic — file lives in `test/formats/`).

**P2.4 — Emit SKOS terms** (M) — Depends: P2.1
Files: `src/formats/redstringFormat.js` (`exportToRedstring`)
Do: Prototypes: add `"skos:Concept"` to `@type` array, `skos:prefLabel` = name, `skos:altLabel` = aliases/conjugation when present, `skos:inScheme` → the file's scheme IRI. File metadata: type the universe as `skos:ConceptScheme`. Abstraction chains: KEEP `redstring:abstractionChains` as-is AND additionally emit `skos:broader` links for each adjacent pair (more-specific → more-general), replacing the current `rdfs:subClassOf` generation (L731-751) — `subClassOf` was the wrong register (audit #8).
Done when: strip-test prototype assertions (P3.4) are satisfiable; existing suites green.

**P2.5 — Sameness ladder export** (S) — Depends: P2.1
Files: `src/formats/redstringFormat.js`
Do: Implement D8. Enrichment-derived external links → `skos:closeMatch`. Anything in the prototype's `owl:sameAs` list → emit BOTH `owl:sameAs` and `skos:exactMatch`.
Done when: unit test asserting a sameAs-bearing prototype exports both properties.

**P2.6 — PROV stamping for Wizard output** (M)
Files: `src/components/panel/views/LeftAIView.jsx` (`applyToolResultToStore`, ~L387-397), `src/formats/redstringFormat.js`
Do: When applying wizard tool results that create prototypes/edges, write `provenance: { wasAttributedTo: 'redstring-wizard', model: <active model id>, conversationId, generatedAtTime: <ISO> }` into the entity's `semanticMetadata` (no store-model change — `semanticMetadata` already round-trips). Export maps it to `prov:wasAttributedTo` / `prov:generatedAtTime` on the entity. Import preserves it.
Done when: a wizard-created node exports with PROV properties; user-created nodes export without them.

### Phase 3 — Dataset structure (the v4 bump)

**P3.1 — Restructure export to D10's shape** (L)
Files: `src/formats/redstringFormat.js` (`exportToRedstring`)
Do: Move each graph's edges from the global `relationships` section into that graph's own entry (`redstring:edges` map inside the `spatialGraphs` entry — edges are graph-scoped statements). `prototypeSpace` additionally carries the graph-level statements (labels, defining-node links, PROV) so it is the default graph. Write `format: "redstring-v4.0.0"` only in P3.3 — until then keep emitting 3.0.0 from a branch flag so dev builds stay loadable. (Branch flag: `const EMIT_V4 = false` constant, flipped in P3.3.)
Done when: with `EMIT_V4=true` locally, fixtures + round-trip + conformance suites green against the new shape.

**P3.2 — Importer for v4 shape** (M) — Depends: P3.1
Files: `src/formats/redstringFormat.js` (`importFromRedstring`)
Do: Teach the current-version import path to read D10's shape (graph-scoped edges, default-graph statements). Pre-v4 shapes arrive via the ledger, so no branching in the importer itself.
Done when: import(export(state)) green under `EMIT_V4=true`.

**P3.3 — The v3→v4 ledger entry + bump** (M) — Depends: P3.1, P3.2, all of Phase 1–2
Files: `src/formats/migrations.js`, `src/formats/redstringFormat.js`
Do: Append ledger entry `3.0.0→4.0.0`: relocate global edges into their graphs (a v3 edge's graph is the one listing it in `edgeIds`), normalize pseudo-IRIs to URNs, drop duplicate sections into the canonical ones (preferring `prototypeSpace`/`spatialGraphs` copies; differences between duplicate copies go to `_preserved['3.0.0']._conflicts`), quarantine unknowns. Set `CURRENT_FORMAT_VERSION = '4.0.0'`, update `VERSION_HISTORY`, flip `EMIT_V4`.
Verify: `npm run test:format` + `npm run schema:report` on a v3 file shows the full migration path.
Done when: every suite green; loading a v3 file produces a backup (P0.5) and a clean v4 state.

**P3.4 — The strip test** (M) — Depends: P3.3
Files: `test/formats/stripTest.test.js` (new)
Do: Export → `jsonld.toRDF` → drop every quad whose predicate or type IRI starts with the `redstring:` namespace → assert the remainder still contains: one `skos:ConceptScheme`; every prototype as a `skos:Concept` with `skos:prefLabel` and `skos:inScheme`; `skos:broader` chains where abstraction chains exist; PROV attribution where wizard provenance exists.
Done when: green. This is the progressive-enhancement guarantee, enforced forever.

### Phase 4 — Semantic hashing & slot reconciliation

**P4.1 — `semanticHash` module** (M) — Depends: P2.3
Files: `src/services/semanticHash.js` (new), `test/services/semanticHash.test.js` (new)
Do: Implement D5. `semanticHash(redstringData)` → canonize → SHA-256 hex; `fullHash(redstringData)` → canonical-JSON minus excluded sections → SHA-256. Test: two exports of the same state with shuffled key order hash equal; moving a node changes tier-1 (coordinates are in the quads) but a viewport change does not; a v3 file and its migrated v4 form hash tier-1 equal.
Done when: that last assertion — *cross-version semantic equality* — passes. It is the keystone test of the whole plan.

**P4.2 — Rebuild `detectSlotConflict` on semantic hashing** (L) — Depends: P4.1
Files: `src/services/universeBackend.js` (`detectSlotConflict`, L3563)
Do: Keep cheap pre-checks (counts) as a fast path, but the verdict becomes: migrate both slots' raw content in memory (`runMigrations`, no writes) → compare tier-1 hashes → equal = in-sync regardless of format version; unequal = real divergence → existing sourceOfTruth precedence and prompt flow unchanged.
Done when: a v3-in-git / v4-local pair with identical knowledge no longer reports conflict (covered by P4.3).

**P4.3 — Slot matrix tests** (M) — Depends: P4.2
Files: `test/services/slotConflict.test.js` (new)
Do: Mock slot reads (no real FS/git/IndexedDB). Enumerate {local, git, browser} × {v3 bytes, v4 bytes} × {same knowledge, divergent, primary-empty}. Assert per cell: in-sync, conflict-prompt, or auto-sync — explicitly covering the empty-primary/populated-secondary trap (universeBackend.js:3300-3333 behavior preserved).
Done when: every cell asserted; suite green.

### Phase 5 — Import/export hub

**P5.1 — Lens table** (M)
Files: `src/formats/lens.js` (new), `test/formats/lens.test.js` (new)
Do: Export `LENS_TABLE`: predicate IRI → routing, seeded with: `rdfs:subClassOf`, `skos:broader`, `wdt:P279` → `abstraction`; `skos:narrower` → `abstraction` (inverted); `wdt:P527`, `dcterms:hasPart`, `schema:hasPart` → `composition`; `wdt:P361`, `schema:isPartOf`, `dcterms:isPartOf` → `composition` (inverted); `skos:related`, `rdfs:seeAlso` → `edge` with base connection; default → `edge` with auto-minted relation prototype named from the predicate's local name. `applyLens(triples)` → `{prototypes, abstractionLinks, compositionLinks, edges}`.
Done when: unit tests cover each routing class + the default mint path.

**P5.2 — TriG / N-Quads codecs** (L) — Depends: P3.3
Files: `src/formats/codecs/trig.js` (new), `src/formats/codecs/nquads.js` (new), `test/formats/codecs.test.js` (new)
Do: From a v4 file: default graph = prototype space (SKOS/PROV/redstring overlay), each spatial graph = named graph (name = `toIri(graphId)`). TriG codec emits TriG-star annotations `{| |}` for edge name/description/definition links, with `{ rdfStar: false }` option that omits them (D6). N-Quads codec = same dataset, line-per-quad, no star. Validate output by re-parsing with an existing dependency (`rdflib` is already in package.json — see `src/formats/rdfExport.js` imports) or string-level assertions if rdflib lacks TriG-star (then only the non-star output gets re-parse validation).
Done when: graph boundaries provably survive (named-graph count equals Redstring graph count on re-parse).

**P5.3 — Adapters through the lens + provenance** (M) — Depends: P5.1
Files: `src/formats/importAdapters.js`
Do: Refactor `importJSONLD` to: parse → `jsonld.toRDF` → `applyLens` → entities, each stamped `semanticMetadata.provenance.wasDerivedFrom = <source filename/URL>`. Obsidian/Cytoscape/GraphML adapters keep their parsers but emit through the same entity-construction + provenance path (kill per-adapter mapping improvisation; keep their structural heuristics).
Done when: importing any sample file yields provenance-stamped entities; existing adapter behavior otherwise unchanged.

**P5.4 — Merge as dataset union** (L) — Depends: P4.1
Files: `src/formats/mergeUniverses.js` (new), `test/formats/merge.test.js` (new)
Do: `mergeUniverses(base, incoming)` → `{merged, report}`. Named graphs: union (URN names can't collide; identical graph IDs with equal tier-1 subgraph hashes dedupe silently). Prototypes: exact-ID match → same entity; `owl:sameAs`/`skos:exactMatch` overlap → merge (union fields; conflicting scalars keep base's value, incoming's goes to `_preserved.merge`); name-equality (case-insensitive) → NOT merged, listed in `report.closeMatchCandidates` for the UI/user to decide. Pure function; no store access.
Done when: unit tests cover all three alignment classes + the no-silent-loss rule (every dropped-on-conflict value lands in `_preserved.merge`).

**P5.5 — Replace `rdfExport.js` flattening** (S) — Depends: P5.2
Files: `src/formats/rdfExport.js`
Do: `exportToRdfTurtle` → delegate to the N-Quads codec; add `exportToTrig`. Wire any UI menu entry that called the old function.
Done when: exports preserve named-graph boundaries (assert via codecs.test).

### Phase 6 — Vocabulary & evangelism

**P6.1 — The vocabulary document** (M) — Depends: P3.3
Files: `public/vocab/redstring.ttl` (new), bundled by the existing build
Do: Every `redstring:` term used by the v4 exporter, each with `rdfs:label`, `rdfs:comment`, and typed relations to host standards (`redstring:hasDefinitionGraph rdfs:seeAlso skos:definition` with a comment explaining graph-valued definitions vs literal ones; spatial/visual terms annotated as presentation-layer). Add a CI test that every `redstring:` IRI emitted by `exportToRedstring` appears in the ttl (no undocumented terms).
**P6.2 — w3id registration** (S): PR to w3id.org redirecting `https://w3id.org/redstring/` → wherever the vocab is hosted; update the namespace IRI in `REDSTRING_CONTEXT` once merged.
**P6.3 — README + docs rewrite** (L): the one-breath story — *replicated-artifact linked data; a dataset format no one controls; SKOS-fluent, PROV-signed, OWL-dockable* — plus the format spec generated from §3/D10 and the vocab doc. Last, on purpose.

---

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Migration bug corrupts old files | Backup-on-load (P0.5) + pure ledger + fixtures. Worst case = restore the .bak. |
| Quarantine bag becomes a landfill | Inventoried by `schema-report`; graduating/retiring a field is an explicit ledger decision. |
| v4 files reach older installs (decentralization guarantees it) | Same quarantine rule on every version: preserve what you don't understand, never strip on re-save. Documented as part of the format spec. |
| Slot false-conflicts during transition (v3 git / v4 local) | P4.2 migrate-then-compare. Until Phase 4 lands, conflicts over-prompt rather than auto-resolve — annoying, not lossy. |
| `jsonld.canonize` performance on large universes | Hash on save/sync boundaries only; cache keyed by SaveCoordinator's existing FNV-1a state hash. |
| Cheap-executor drift | §0 protocol; decisions centralized in §3; every task has Done-when; no task requires choosing between designs. |

## 6. Non-goals (this refactor)

- No ghost/provisional browse layer (separate effort; builds on this one).
- No SPARQL endpoint or live dereferencing portals (this work makes them possible later).
- No OWL axiom authoring — dock, don't speak.
- No change to the in-memory store model (prototypes/instances/edges Maps unchanged; provenance rides in `semanticMetadata`).
- No Wizard behavior changes beyond the provenance stamp (P2.6).
