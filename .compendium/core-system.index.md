---
compendium_version: 1
category: core-system
last_reviewed: 2026-06-13
---

# Core System Reference — Document Index

## Summary

These documents describe what Redstring fundamentally is: its data model (prototype/instance/graph/edge), its state management layer (Zustand store), its save coordination system, and the philosophical vocabulary used throughout the codebase. Read these before starting any task. `CLAUDE.md` is the highest-priority read for any AI agent.

Key code paths this category maps to: `src/store/graphStore.jsx`, `src/core/Graph.js`, `src/core/Node.js`, `src/core/Edge.js`, `src/services/SaveCoordinator.js`, `src/services/gitNativeFederation.js`.

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [CLAUDE.md](../CLAUDE.md) | Architecture guidance written specifically for AI agents: data model, key patterns, important implementation details, common pitfalls | **Start here for any task** |
| [README.md](../README.md) | Full project overview: features, architecture overview, local-first storage model, user-facing capabilities | Understanding what Redstring does and why |
| [SAVE_COORDINATOR_README.md](../SAVE_COORDINATOR_README.md) | Authoritative reference for SaveCoordinator: batching middleware, drag-aware saves, FNV-1a hashing, viewport exclusion, worker communication | Any work touching saves, file I/O, or performance during interactions |
| [GIT_FEDERATION.md](../GIT_FEDERATION.md) | Authoritative single-source guide for the universe/Git storage model: multi-slot storage, federation, conflict resolution | Universe management, Git integration, multi-device sync |
| [GRAPH_QUERY_ABSTRACTION.md](../GRAPH_QUERY_ABSTRACTION.md) | Documents the `graphQueries.js` API surface and query patterns for reading graph state without touching the store directly | Querying graph data, building selectors |

## Future-Intent Documents

| File | Summary | Note |
|------|---------|------|
| [docs/COLLABORATION_PLAN.md](../docs/COLLABORATION_PLAN.md) | "One Graph, many Webs" model — a reversible fold/hydrate membrane between personal and shared graph representations | **Not implemented** — design decisions recorded; no code exists yet |

## Supplementary (not .md)

| File | Summary | Key for |
|------|---------|---------|
| `aiinstructions.txt` | Detailed project philosophy, comprehensive development patterns, conceptual vocabulary (Latour blackboxing, Tree of Porphyry, etc.) | Understanding the *why* behind design decisions; writing prompts that use Redstring's intentional vocabulary |

> Read `aiinstructions.txt` via: `cat aiinstructions.txt` — it is plain text, not markdown.
