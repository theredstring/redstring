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

## 2026-09-23: Wave 1 reviewed and integrated (Claude, orchestrator)

**Branches reviewed and merged into `refactor/wave1-integration`, not yet into `main`:**
- Lane A: P1.01, P1.07, P1.02; P1.13 partial
- P1.09 + P1.11
- P0.01
- P0.05 + P0.07
- Plus d55fe5b, which lowers the size budget to 18,518.

**Results:**
- Drag-pan (mouse and touch): **60 → 0 commits per 30 moves** in jsdom. The base cost 126 commits for one pan in headless Chromium.
- Render-time POSTs: 3 → 0.
- Keyboard listener: attaches once per mount.
- NodeCanvas: 19,255 → 18,518 lines.

**Checks the orchestrator ran:**
- `no-undef` lint on the new NodeCanvas.jsx and useCanvasTouch.js matches the base: only B-03 remains.
- The keyboard handler takes all its hook params from `paramsRef`, none from a stale closure.
- `setPan` runs its updater synchronously, which P1.01 relies on.
- Full vitest: 3,189 pass. The **67 failures in 15 files are identical to f1f07dd** (F-69).
- `npm run build` passes.

**New entries:** B-09 (self-loop arrowhead scale mid-drag), B-10 (view-save gap), X-07 (dead hook params), F-67, F-68 (stale worktree base and Vite cache hazards; README rules added), F-69, and proposed D-16.

**Needs Grant:**
- OK to merge into `main`.
- B-03 decision.
- A manual check of pan and momentum feel.
- A visual check of B-09.

**Still running:** P0.02 + P0.03 (Playwright).

**Next (wave 2):** P0.04 baseline and P0.06 CI once Playwright lands; P1.03 → P1.04 → P1.05 → P1.06 → P1.08 → P1.10 → P1.12 in Lane A.

---

## 2026-09-23: Answers recorded; wave 1 started (Claude, orchestrator)

**Warning about commit 34649b4.** Its message, "Refactor NodeCanvas into a modular architecture", lists Phases 2–5 as done. **They are not done.** That commit contains only these plan docs. Trust the phase board and the cards, not that message.

**Decisions recorded:**
- Q1 → D-13: nobody hand-edits `NodeCanvas.jsx` while agents work on it.
- Q2 → D-15: Claude's Chambers becomes the local-only representative fixture.
- Q3 → D-12: Playwright approved.
- Q4 → D-14: parallel worktrees with an orchestrator.

**New finding F-66.** The real universe has 197 graphs and 1,913 prototypes, but its largest graph has only 54 nodes. The slowness comes from breadth, not from graph size.

**Fixture.** Copied the snapshot to `test/fixtures/canvas/local/claudes-chambers.redstring`. The copy is byte-identical and the original is untouched. Added that folder to `.gitignore`.

**Wave 1 launched in worktrees.** Each agent writes its report to `reports/<TASK>.md` on its own branch.
- **Lane A** (the only `NodeCanvas.jsx` editor): P1.01 → P1.07 → P1.02 → P1.13
- **Lane B:** P0.01 (render probe and profile build)
- **Lane B:** P0.02 + P0.03 (fixtures, loader, Playwright flows)
- **Lane B:** P0.05 + P0.07 (render-contract test, size ratchet)
- **Lane C:** P1.09 + P1.11 (no-op store guards, stable keyboard listener)

**Next:** review and merge each branch into `main` once Grant OKs committing to `main`. Then run wave 2: P0.04 baseline, P0.06 CI, P1.03–P1.06, P1.08, P1.10, P1.12.

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
