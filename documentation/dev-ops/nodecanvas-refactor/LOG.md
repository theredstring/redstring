# Log

Newest entries go at the top. Each entry records:
- the date and who ran the session
- the task IDs
- commit hashes
- what changed
- measurements
- surprises
- the next step

Keep entries short. The details belong in the card's Handoff note.

---

## 2026-09-23: Audit and plan (Claude, initial session)

- **Audit.** Read-only audit of `NodeCanvas.jsx` @1e6ab02 (19,255 lines). Five analyses ran in parallel:
  - re-render triggers
  - render pipeline
  - input layer
  - feature clusters
  - history and tests
- **Spot checks.** I checked these headline claims by hand:
  - F-01: dead `panStart` state
  - F-02: duplicate mousemove binding
  - F-20: `nodes` is always a new array
  - F-21: selection feeds `labelCrossingIndex`
  - F-26: `debugLogSync` POSTs from render; `DIAGNOSE_ZOOM_FLICKER = true`
  - F-05: hurtle sets state every frame
  - F-07: `clearImage` has no guard; `setSelectedEdgeIds` always creates a new Set
  - F-14: keyboard deps
  - B-03: undefined `setShowOnboardingModal`
  - X-02: `nodesVisibleInStrictViewport` is unused
  - X-03: `useNodeActions` is imported but never called
- **Decisions.** Grant decided on the full refactor before 1.0 (D-01) and on a persistent plan across agents (D-02).
- **Docs changed.**
  - Created this folder.
  - Pointed `CLAUDE.md` here.
  - Indexed the plan in `AI_COMPENDIUM.md` and `.compendium/dev-ops.index.md`, and marked the Oct-2025 `.refactor-*.md` files superseded.
- **Source changes.** None.
- **Noticed, not changed.** AI_COMPENDIUM's "zoom performance regression" row says culling has been disabled since April. It was re-enabled on 2026-09-01 (d040601).
- **Next.**
  1. Grant answers Q1–Q5 in the README.
  2. P0.01 (render probe) and P1.01 (`panStart`, pre-P0 OK) can start right away.
  3. P0.02 needs Q2, and P0.03 needs Q3.
