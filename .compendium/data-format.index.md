---
compendium_version: 1
category: data-format
last_reviewed: 2026-08-27
---

# Data Format and Migration — Document Index

## Summary

These documents define the `.redstring` file format (JSON with JSON-LD semantic overlay), its version history, and the migration system that keeps old files readable. The current format is **v3.0.0**. The migration code in `src/formats/migrations.js` was written directly from `../documentation/data-format/redstring-format-spec.md` — that spec is legacy-canonical and must remain consistent with the migration logic even as the format evolves. Key code paths: format spec, `src/formats/migrations.js` (the append-only migration ledger), `src/formats/redstringFormat.js` (import/export), `SaveCoordinator.js` (serialization), `graphStore.js` (deserialization on file load).

---

## Legacy-Canonical Documents

These describe older format versions that the system must remain capable of reading. They are not outdated — they are the authoritative specification for their version and the migration code depends on them.

| File | Covers | Why It Matters |
|------|--------|----------------|
| [redstring-format-spec.md](../documentation/data-format/redstring-format-spec.md) | v1.0.0 (flat), v2.0.0-semantic (JSON-LD), v3.0.0 (current with RDF context) | **Migration code is derived from this spec.** Any file saved before v3.0.0 goes through this spec's definitions to be upgraded. If you change the migration logic, check it against this document first. |

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [REDSTRING_FORMAT_VERSIONING.md](../documentation/data-format/REDSTRING_FORMAT_VERSIONING.md) | Version history, ledger-based migration system, auto-upgrade on file load, compatibility guarantees | Understanding how old files get upgraded; adding a new version |
| [MIGRATION_GUIDE.md](../documentation/data-format/MIGRATION_GUIDE.md) | How to migrate semantic query API usage between versions; documents the additive API approach (no breaking changes) | Updating call sites when semantic API changes |
| [ONTOLOGY_IMPORT.md](../documentation/data-format/ONTOLOGY_IMPORT.md) | Importing OWL / Turtle / N-Triples / JSON-LD / OBO Graphs into a universe: the pipeline (`src/formats/ontology/`), the deterministic mapping rules (term → Thing, parent → type, composition → webs), IRI identity and merging, what keeps imported Things alive, scale numbers, the CLI | Any work on ontology import, starter packs, or the smart planner that will sit on the plan |

---

## Future-Intent Documents

| File | Summary | Note |
|------|---------|------|
| [FORMAT_REFACTOR_PLAN.md](../documentation/data-format/FORMAT_REFACTOR_PLAN.md) | v4.0.0 planning: SKOS vocabulary alignment, PROV-O provenance tracking, RDF-star for edge metadata, removing legacy format blocks | **No code exists yet.** Design decisions are recorded here. Do not assume any implementation. When v4.0.0 work begins, this document becomes the authoritative plan. |
