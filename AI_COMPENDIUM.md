# Redstring AI Compendium

This is the primary entry point for any AI agent working in this codebase. It provides a categorized, status-tagged index of all 86+ documentation files, a task-based reading order, and a status taxonomy so you can immediately distinguish current architecture from historical fix notes from unimplemented plans.

**Do not read all 86 files.** Use the task-based reading order below to find exactly what you need, then follow the category dispatch table to the relevant index.

---

## Status Taxonomy

Every document in every category index is tagged with one of four statuses:

| Status | Meaning |
|--------|---------|
| `current` | Describes the system as it exists today. Trust it fully — code matches. |
| `legacy-canonical` | Describes an older version or subsystem that must remain compatible. Trust it **for the version it describes**. Critical for migration and format work — do not dismiss it as outdated. |
| `historical` | A problem was diagnosed and fixed; the code already incorporates the solution. Read for context when working in that area. Do not copy configuration snippets or line numbers verbatim — the code has moved on. |
| `future-intent` | An architectural plan or vision document. Design decisions are recorded here but **no implementation exists yet**. Do not assume any code matches. |

`deprecated` is intentionally absent from this taxonomy. If a document is truly obsolete, its index entry carries a `superseded-by:` note pointing to what replaced it.

---

## Task-Based Reading Order

Find your task below and read only the listed files — in order. This is the fastest path to being productive.

| Task | Files to read (in order) |
|------|--------------------------|
| **Understand core architecture** | `CLAUDE.md`, `README.md` (§Architecture section) |
| **Work with the Wizard / MCP** | `AI_INTEGRATION_GUIDE.md`, `REDSTRING_MCP_SYSTEM_PROMPT.md`, then `AGENTIC_ARCHITECTURE.md` (historical — explains the pipeline shape) |
| **Call MCP tools from an external client** | `MCP_TOOLS_QUICK_REFERENCE.md`, `MCP_SETUP_GUIDE.md` |
| **Use Redstring headless (no browser: CLI, workspaces, universes, GitHub)** | `HEADLESS.md` (current — the CLI, workspace/universe model, `redstring init`, pull/push) |
| **Read or write `.redstring` files** | `redstring-format-spec.md` (legacy-canonical — migration code is derived from this), `REDSTRING_FORMAT_VERSIONING.md` |
| **Migrate data between format versions** | `REDSTRING_FORMAT_VERSIONING.md`, `MIGRATION_GUIDE.md`, `redstring-format-spec.md` (legacy-canonical) |
| **Modify the layout algorithm** | `AUTO_LAYOUT_GUIDE.md`, `REDESIGNED_LAYOUT_SUMMARY.md` (historical — explains why it was rebuilt), `FORCE_SIMULATION_TUNER.md` |
| **Investigate a drag or performance regression** | `DRAG_PERFORMANCE_COMPLETE.md` (historical — contains exact NodeCanvas/utils.js line references from the three-bottleneck analysis) |
| **Deploy or configure infrastructure** | `DEPLOYMENT.md`, `GITHUB_APP_SETUP.md`, `cloudflare/README.md` (if targeting Cloudflare Pages) |
| **Work with SPARQL / semantic web / Wikidata** | `SEMANTIC_WEB_INTEGRATION.md`, `RDF_INTEGRATION_README.md`, `SEMANTIC_DISCOVERY_GUIDE.md` |
| **Set up the save / sync system** | `SAVE_COORDINATOR_README.md`, `GIT_FEDERATION.md` |
| **Understand the v4.0.0 format roadmap** | `FORMAT_REFACTOR_PLAN.md` (future-intent — SKOS/PROV/RDF-star alignment; **no code exists yet**) |
| **Run or write tests** | `TESTING_ONBOARDING.md`, `AI_TESTING_GUIDE.md`, `WIZARD_TESTING_GUIDE.md` |
| **Understand project philosophy / conceptual vocabulary** | `aiinstructions.txt` (plain text, not .md — read via `cat aiinstructions.txt`) |

---

## Category Dispatch Table

| Category | Index file | Read when |
|----------|------------|-----------|
| Core System Reference | [`.compendium/core-system.index.md`](.compendium/core-system.index.md) | Starting any task; foundational architecture |
| AI Agent and MCP | [`.compendium/ai-agent-mcp.index.md`](.compendium/ai-agent-mcp.index.md) | Working with Wizard, MCP server, bridge daemon, prompts |
| Data Format and Migration | [`.compendium/data-format.index.md`](.compendium/data-format.index.md) | Reading/writing `.redstring`; format versioning; migration logic |
| Graph Engine and Layout | [`.compendium/graph-layout.index.md`](.compendium/graph-layout.index.md) | Force simulation, layout algorithms, constraint systems |
| Storage, Sync, and Federation | [`.compendium/storage-federation.index.md`](.compendium/storage-federation.index.md) | Universe management, Git integration, deployment, OAuth |
| Semantic Web and Knowledge Discovery | [`.compendium/semantic-web.index.md`](.compendium/semantic-web.index.md) | RDF, SPARQL, Wikidata/DBpedia, semantic enrichment |
| Development Operations | [`.compendium/dev-ops.index.md`](.compendium/dev-ops.index.md) | Refactoring, testing, audits, UI fixes, performance ops |

---

## Compendium Maintenance Notes

- **Last reviewed**: 2026-06-13
- **File count indexed**: 86 .md files + `aiinstructions.txt`
- **Files intentionally excluded**: `docs/README.md` (Mintlify template placeholder — contains no Redstring content)
- **No existing files were moved or renamed** — all index entries point to files at their original paths
- When adding a new significant .md file to the project, add an entry to the relevant `.compendium/*.index.md` and update this file's task table if warranted
