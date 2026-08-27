# Redstring AI Compendium

This is the primary entry point for any AI agent working in this codebase. It provides a categorized, status-tagged index of the project's documentation, a task-based reading order, and a status taxonomy so you can immediately distinguish current architecture from historical fix notes from unimplemented plans.

**Do not read every file.** Use the task-based reading order below to find exactly what you need, then follow the category dispatch table to the relevant index.

**Two things that are not part of this repo**, despite sitting in the working tree — do not grep them for current behavior:

- `docs/` — a separate, nested git repository, gitignored here. Holds a Mintlify site plus ~45 archived fix-notes. Only `docs/COLLABORATION_PLAN.md` is indexed (core-system).
- `CHANGELOG.md` — gitignored, local-only.

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
| **Work with the Wizard / MCP** | `documentation/ai-agent-mcp/AI_INTEGRATION_GUIDE.md`, `documentation/ai-agent-mcp/REDSTRING_MCP_SYSTEM_PROMPT.md`, then `documentation/ai-agent-mcp/AGENTIC_ARCHITECTURE.md` (historical — explains the pipeline shape) |
| **Replace a heuristic with a small constrained model call** | `documentation/ai-agent-mcp/ONE_SHOT_CALLS.md` (current — the design contract and every wired call site), then `documentation/ai-agent-mcp/SMALL_MODEL_ROADMAP.md` (future-intent — the remaining backlog). Note this is *not* the Wizard's agent loop |
| **Call MCP tools from an external client** | `documentation/ai-agent-mcp/MCP_TOOLS_QUICK_REFERENCE.md`, `documentation/ai-agent-mcp/MCP_SETUP_GUIDE.md` |
| **Use Redstring headless (no browser: CLI, workspaces, universes, GitHub)** | `documentation/core-system/HEADLESS.md` (current — the CLI, workspace/universe model, `redstring init`, pull/push) |
| **Read or write `.redstring` files** | `documentation/data-format/redstring-format-spec.md` (legacy-canonical — migration code is derived from this), `documentation/data-format/REDSTRING_FORMAT_VERSIONING.md` |
| **Migrate data between format versions** | `documentation/data-format/REDSTRING_FORMAT_VERSIONING.md`, `documentation/data-format/MIGRATION_GUIDE.md`, `documentation/data-format/redstring-format-spec.md` (legacy-canonical) |
| **Modify the layout algorithm** | `documentation/graph-layout/AUTO_LAYOUT_GUIDE.md`, `documentation/graph-layout/LAYOUT_HISTORY.md` (historical — why it is shaped this way; **read before renaming any parameter**, aliases are mandatory), `documentation/graph-layout/FORCE_SIMULATION_TUNER.md`. Take current values from `FORCE_LAYOUT_DEFAULTS` in code, never from a doc |
| **Investigate a *drag* performance regression** | `documentation/graph-layout/DRAG_PERFORMANCE_COMPLETE.md` (historical — exact NodeCanvas/utils.js line references from the three-bottleneck analysis) |
| **Investigate a *zoom* performance regression** | `documentation/graph-layout/ZOOM_PERF_DIAGNOSIS.md` (**current — mechanisms 1–4 are still live**, incl. viewport culling disabled since April). A different problem from drag; do not substitute the drag doc |
| **Deploy or configure infrastructure** | `documentation/storage-federation/DEPLOYMENT.md`, `documentation/storage-federation/GITHUB_APP_SETUP.md`, `cloudflare/README.md` (if targeting Cloudflare Pages) |
| **Build or debug the iOS app** | `documentation/storage-federation/CAPACITOR_IOS_SETUP.md` (current — Capacitor build, app-managed universe files, device-flow auth), `documentation/storage-federation/ELECTRON_SETUP.md` (the desktop analogue this was modeled on) |
| **Change file-handle resolution or universe loading** | `documentation/storage-federation/CAPACITOR_IOS_SETUP.md` + `documentation/storage-federation/ELECTRON_SETUP.md` + `documentation/core-system/HEADLESS.md` — three handle shapes (browser FS handle, absolute path, `capacitor://` prefixed string) share one code path in `universeBackend.js`. All three must keep working |
| **Work with SPARQL / semantic web / Wikidata** | `documentation/semantic-web/SEMANTIC_WEB_INTEGRATION.md`, `documentation/semantic-web/RDF_INTEGRATION_README.md`, `documentation/semantic-web/SEMANTIC_DISCOVERY_GUIDE.md` |
| **Set up the save / sync system** | `documentation/core-system/SAVE_COORDINATOR_README.md`, `documentation/core-system/GIT_FEDERATION.md` |
| **Understand the v4.0.0 format roadmap** | `documentation/data-format/FORMAT_REFACTOR_PLAN.md` (future-intent — SKOS/PROV/RDF-star alignment; **no code exists yet**) |
| **Run or write tests** | `documentation/dev-ops/TESTING_ONBOARDING.md`, `documentation/ai-agent-mcp/AI_TESTING_GUIDE.md`, `documentation/ai-agent-mcp/WIZARD_TESTING_GUIDE.md` |
| **Understand project philosophy / conceptual vocabulary** | `aiinstructions.txt` (plain text, not .md — read via `cat aiinstructions.txt`) |

---

## Where the files live

Only five documents sit at the repo root — `README.md`, `CLAUDE.md`, this file, `SECURITY.md`, and `aiinstructions.txt`. Everything else lives under `documentation/<category>/`, using the same seven categories as the indexes below:

```
documentation/
  ai-agent-mcp/        core-system/     data-format/    dev-ops/
  graph-layout/        semantic-web/    storage-federation/
```

Each index in `.compendium/` points into the matching `documentation/` folder. **`documentation/` is not `docs/`** — the latter is a separate nested git repository (see above) and holds nothing current.

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

- **Last reviewed**: 2026-08-27
- **Indexed**: 62 files under `documentation/` + 4 root files + `deployment/`, `cloudflare/` and two `docs/` entries
- **Excluded**: `docs/` (separate nested git repo, gitignored) and `CHANGELOG.md` (gitignored, local-only)
- When adding a significant doc, put it in the right `documentation/<category>/` folder, add an entry to the matching `.compendium/*.index.md`, and update the task table above if warranted

### 2026-08-27 cleanup

Reduced from 85 root .md files / 20,544 lines to 66 / ~17,600. Everything deleted is recoverable from git history; each category index carries a "Removed" note naming its files and why.

- **23 files deleted.** Four completed agent handoff prompts (verified shipped before removal), three session transcripts and one-time completion checklists, four docs the compendium itself already marked superseded, four small "what I changed" notes, and nine per-iteration layout summaries.
- **Nine layout summaries → `documentation/graph-layout/LAYOUT_HISTORY.md`.** They had drifted badly: the most recent documented `repulsionStrength: 500000` against a shipped value of `2200`. The replacement records design rationale only and points at code for values.
- **Two documents added for existing, previously undocumented code**: `documentation/ai-agent-mcp/ONE_SHOT_CALLS.md` (the `oneShot.js` subsystem, wired into ~12 call sites and never indexed) and `documentation/graph-layout/LAYOUT_HISTORY.md`.
- **Four documents newly indexed**: `documentation/graph-layout/ZOOM_PERF_DIAGNOSIS.md` (was in no index at all despite describing live issues), `documentation/core-system/HEADLESS.md` and `documentation/storage-federation/CAPACITOR_IOS_SETUP.md` (were in the task table but no index), `documentation/ai-agent-mcp/SMALL_MODEL_ROADMAP.md`.
- **`documentation/semantic-web/SEMANTIC_WEB_ENHANCEMENT.md` was kept**, against the initial plan to delete it as superseded. It is the only record of several conceptual sections, and its OWL/RDF-Schema "verdict" needed an explicit contradiction note rather than silent deletion. See the semantic-web index.

### 2026-08-27 reorganization

After the cleanup, the remaining docs were moved out of the repo root into `documentation/<category>/`, and root-level scripts were reorganized.

- **62 docs moved** into the seven category folders. Category assignment was taken from the compendium indexes themselves, so the structure on disk and the structure in the indexes cannot disagree.
- **Root went from 85 .md + 59 other files to 5 + 34.** What is left at root is what convention requires there: `README.md`, `CLAUDE.md`, `AI_COMPENDIUM.md`, `SECURITY.md`, `aiinstructions.txt`, plus servers, build configs, and deploy manifests.
- **5 dead scripts deleted**, 15 ad-hoc probes moved to `test/manual/`, 5 utilities moved to `scripts/`. The moves broke `__dirname` and `./src/...` assumptions in six files; those are fixed and verified.
- `.refactor-{inventory,progress,summary}.md` stay at root as hidden dotfiles — they are indexed under dev-ops but contribute no visible clutter.
- Every markdown link in the repo was verified to resolve after the move. Two pre-existing broken links remain in `documentation/dev-ops/PRE_RELEASE_AUDIT.md` (`./docs/API.md`, `./docs/USER_GUIDE.md`); those targets never existed and predate this work.
