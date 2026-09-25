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

## 2026-09-25: P0.04, P1.06 and P1.12a merged; perf numbers explained (Claude, orchestrator)

- **Merged into wave2 integration:**
  - P1.12a at a18248e
  - P0.04 at 0396b65
  - P1.06 + B-04 at ebe2242
- **Integration checks:**
  - `lint:undef` PASS
  - `test:ci` PASS (3,512 tests, 68 known, 0 new)
  - Playwright 34 passed
  - build OK, with no fixture code in `dist`
  - label snapshots unchanged by P1.03/P1.04
- **P0.04:**
  - Baseline in METRICS, pre-refactor vs now: drag-pan 246 → 9 commits, touch pan 209 → 11, marquee 100 → 52.
  - Commits include children rendering on their own, so perf runs now also count NodeCanvas's own runs (F-73).
  - `perf:canvas -- --explain <id>` names the state behind every render. It found:
    - F-74: every render re-renders 145 header tabs, and every selection re-renders about 270 panel sections
    - F-75: a pie open/close is 19 NodeCanvas runs, most of it press/pan flags and the selection cascade
- **P1.06:** S13 went from 35 to 12 commits, and from 31 to 8 NodeCanvas runs; 2 runs during the flight.
- **P1.12a:**
  - Selection is a real label input: the 6 px selection stroke (F-21).
  - Label placement is path-dependent (F-72).
  - Grant OK'd labels staying put on select (D-18), so P1.12b is unblocked.
- **Grant:** stop spending time on measurement and keep refactoring. A second full baseline (40 min) was stopped; per card, measure only the scenarios it names.
- **Next:** Lane A in order: P1.12b, P1.10, P1.05, P1.08.

---

## 2026-09-24: Wave-2 agents found cancelled; orchestrator finished P0.06, X-07, P1.04 (Claude, orchestrator)

- **All four wave-2 agents stopped** when the old session ended (about 21:06), each with uncommitted work.
  - The orchestrator is finishing that work itself. New agents for cancelled work need Grant's OK.
- **P0.06 + X-07** (merged 7b74851):
  - The known-failures gate (`test:ci`) and a new no-undef gate (`lint:undef`).
  - `ci.yml` rewritten.
  - Verified in a node:20 Linux container: identical failure set; the build needs the 4 GB heap `release.yml` already uses.
  - Found F-71 (latent ReferenceErrors), X-09 (two unparseable dead files).
- **P1.03 + P1.04 + B-01** (merged 7c188ba):
  - Marquee S5: sweep 115 → 12 commits, hold 90 → 0.
  - **Playwright caught a regression jsdom couldn't:** the box's trailing click deselected everything, because `mouseMoved` had only been set by accident before. Fixed in the P1.04 commit.
  - B-01 and B-02 fixed. NodeCanvas.jsx is at 18,516 lines.
- **Integration after both merges:**
  - `lint:undef` PASS
  - `test:ci` PASS (3,496 tests, 68 known, 0 new)
  - Playwright 33 passed (B-05 expected)
  - build OK
- **Still to finish:** P0.04 (perf baseline, barely started), P1.12a (label investigation, exploration files only), P1.06 (Lane A's next card).

---

## 2026-09-24: P0.03b done by the orchestrator; B-09 fixed; B-05 reproduced (Claude, orchestrator)

- **Grant's go-ahead:** "you finish them". The orchestrator wrote the flows itself, on `refactor/p0.03b`, merged at 517e9d8.
- **Flows:** F8 panel resize, F9 carousel, F10 touch (CDP), F11 groups, F12 context menus, F13 keyboard, plus F1b (B-09). That's 19 new tests. The suite is 33 tests, 3/3 green, about 40 s.
- **Vitest:** unchanged, 67 failures in 15 files (F-69).
- **B-09 fixed** (2c9a1e7): the self-loop arrowhead measured 0.80× mid-drag. Fixed with one line in useNodeDrag, so the visual check no longer needs Grant.
- **B-05 reproduced:** after Save from a Thing's right-click menu, its menu still says "Save". F12 is `test.fail` until P3.02.
- **Surprises:**
  - A touch pan looked unsaved, but the camera lives in `graphViews`. It was a test error, not an app bug.
  - Holding a lifted item near the top edge starts edge auto-pan. Flows must keep the grip away from the edges.

---

## 2026-09-24: Wave 2 started (Claude, orchestrator, new session)

- **Wave 1 is live.** Grant smoke-tested it ("looks pretty fantastic") and pushed `main` at 8ce03f0.
- **P0.02/P0.03 taken over.** The Playwright agent was cancelled at session end with 3 commits and no reports. The orchestrator:
  - rebased it onto main
  - ran the suite 3/3 green (14 passed, about 21 s)
  - verified the loader is absent from the production build
  - confirmed vitest's failures are unchanged (same 67)
  - wrote the reports
  - reversed the "don't commit the stress fixture" ask: it's 2.2 MB against a 493 MB pack, it's needed at dev-server start, and the `--check` script catches drift
- **Remaining flows F8–F13 → new card P0.03b.** This waits on Grant's OK to launch a new agent for the cancelled agent's work.
- **Wave 2 base:** `refactor/wave2-integration` (main + P0.02/P0.03). In flight: Lane A P1.03 → P1.04 → P1.06; P0.06 + X-07; P0.04; P1.12a; P2.01 (pre-stage).

---

## 2026-09-23: Wave 1 on local main; Grant smoke-testing (Claude, orchestrator)

- Local `main` was fast-forwarded to `0a8f5e0` (wave 1). **Not pushed**; Grant is smoke-testing before pushing. (The "not yet into main" note in the entry below is outdated.)
- B-03 decided (D-17): "Show Welcome Screen" returns as its own host component.
- Still running: P0.02 + P0.03 (Playwright). Wave 2 waits on Grant's smoke test and the Playwright flows.

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
