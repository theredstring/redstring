---
compendium_version: 1
category: data-format
last_reviewed: 2026-06-13
---

# Data Format and Migration — Document Index

## Summary

These documents define the `.redstring` file format (JSON with JSON-LD semantic overlay), its version history, and the migration system that keeps old files readable. The current format is **v3.0.0**. The migration code in `src/services/formatMigration.js` (or equivalent) was written directly from `redstring-format-spec.md` — that spec is legacy-canonical and must remain consistent with the migration logic even as the format evolves. Key code paths: format spec, `formatMigration.js`, `SaveCoordinator.js` (serialization), `graphStore.jsx` (deserialization on file load).

---

## Legacy-Canonical Documents

These describe older format versions that the system must remain capable of reading. They are not outdated — they are the authoritative specification for their version and the migration code depends on them.

| File | Covers | Why It Matters |
|------|--------|----------------|
| [redstring-format-spec.md](../redstring-format-spec.md) | v1.0.0 (flat), v2.0.0-semantic (JSON-LD), v3.0.0 (current with RDF context) | **Migration code is derived from this spec.** Any file saved before v3.0.0 goes through this spec's definitions to be upgraded. If you change the migration logic, check it against this document first. |

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [REDSTRING_FORMAT_VERSIONING.md](../REDSTRING_FORMAT_VERSIONING.md) | Version history, ledger-based migration system, auto-upgrade on file load, compatibility guarantees | Understanding how old files get upgraded; adding a new version |
| [MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md) | How to migrate semantic query API usage between versions; documents the additive API approach (no breaking changes) | Updating call sites when semantic API changes |

---

## Future-Intent Documents

| File | Summary | Note |
|------|---------|------|
| [FORMAT_REFACTOR_PLAN.md](../FORMAT_REFACTOR_PLAN.md) | v4.0.0 planning: SKOS vocabulary alignment, PROV-O provenance tracking, RDF-star for edge metadata, removing legacy format blocks | **No code exists yet.** Design decisions are recorded here. Do not assume any implementation. When v4.0.0 work begins, this document becomes the authoritative plan. |
