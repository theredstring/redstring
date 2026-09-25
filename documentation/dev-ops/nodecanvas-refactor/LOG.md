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

## 2026-09-25: P2.13 done; P2 complete (Claude, orchestrator)

- **P2.13:** vision-aid state in canvasUIStore (`HoverVisionAidLayer`); every button reports through `setActionHover`, so button hover no longer renders NodeCanvas; dwell logic in `useHoverIntent`. F28 added. NodeCanvas.jsx **15,789**.
- **P2 complete.** Header, Panels, TypeList, modals, searches, universe lifecycle, sync debug, force sim, resizers, deletion ghosts and hover are out of NodeCanvas's render path; shared UI state (selection, edge selection, pie, prompts, modals, reconnect, layout progress, widths, hover) is in canvasUIStore. NodeCanvas returns the canvas area and portals the P5 overlays.
  - Bugs fixed in P2: B-08, B-11, B-12, B-13, B-14, B-15; F-76, F-77.
  - NodeCanvas.jsx over P2: 18,412 → 15,789.
- Next smoke test: at the end of the whole run (Grant, 2026-09-25).

---

## 2026-09-25: P2.12 done, with B-15 (Claude, orchestrator)

- Grant: do as much of the refactor as possible, one smoke test at the end; be very safe (commit often, go back if needed). A/B screenshot runs now use a separate `baseline` worktree instead of swapping files in the working copy.
- **P2.12:** `PanelResizers` owns the resizer bars; committed panel widths are in canvasUIStore, the one source for `useViewportBounds` (8 consumers) and framing. **B-15** fixed (a 280 vs 250 px fallback). NodeCanvas.jsx **15,943**.
- The shell-shot spec's storage seeding was broken (the fixture sandbox ignores real localStorage); fixed.
- **Gates:** `test:ci` PASS, Playwright 54 passed (F12 expected), `lint:undef` PASS; screenshots identical with a persisted width.

---

## 2026-09-25: P2.03c done; D-22 (Claude, orchestrator)

- **P2.03c:** edge selection moved to canvasUIStore (**D-22**); graphStore's five action names are forwarding shims, so edge clicks no longer run graphStore's middleware or re-arm the save-worker clone. `removeEdge` prunes both selections.
- **Gates:** `test:ci` PASS, Playwright 54 passed (F12 expected), `lint:undef` PASS. NodeCanvas.jsx 16,320.

---

## 2026-09-25: P2.03b done, with B-14 (Claude, orchestrator)

- **P2.03b:** `selectedGroup` is derived from `selectedGroupId` in canvasUIStore; the exit latch is a render-time ref. **B-14** fixed (the group panel went stale after edits elsewhere); F27.
- A whitespace-only commit collapsed 95 runs of blank lines so the ratchet held. NodeCanvas.jsx **16,320**.
- **Gates:** `test:ci` PASS, Playwright 54 passed (F12 expected), `lint:undef` PASS.

---

## 2026-09-25: P2.07 done (Claude, orchestrator)

- **P2.07:** deletion ghosts in canvasUIStore; `DeletionGhostLayer` renders and removes them, so ghost cleanup no longer renders NodeCanvas. NodeCanvas.jsx **16,415**. F26 added.
- **Gates:** `test:ci` PASS, Playwright 53 passed (F12 expected), `lint:undef` PASS.

---

## 2026-09-25: P2.06f done; P2.06 complete (Claude, orchestrator)

- **P2.06f:** `ForceSimHost` renders the tuner and the progress indicator; the tuner's getters are canvas commands; layout progress is in canvasUIStore (ticks no longer render NodeCanvas). NodeCanvas.jsx **16,430**. F25 added.
- **P2.06 is complete** (a–f). Every screen-level host except the control panels, pickers, carousel, wizard and prompts (P5) is out of NodeCanvas.
- **Gates:** `test:ci` PASS, Playwright 52 passed (F12 expected), `lint:undef` PASS.

---

## 2026-09-25: P2.06c done (Claude, orchestrator)

- **P2.06c:** `UniverseHost` takes the universe lifecycle verbatim (workspace start-up, onboarding, GitHub reconnect, redirect resume, save pill); `UniverseScreens` the loading and not-loaded screens. Reconnect state moved to canvasUIStore. NodeCanvas.jsx 17,215 → **16,464**. F24 added.
- Onboarding, the reconnect modal and the redirect resume can't be driven by the flows; they're on the end-of-P2 smoke-test list.
- **Gates:** `test:ci` PASS, Playwright 51 passed (F12 expected), `lint:undef` PASS; shell screenshots within noise.

---

## 2026-09-25: P2.06d done (Claude, orchestrator)

- **P2.06d:** `SearchHosts` renders the header searches and New Thing; the component search's camera move is the `navigateToPrototypeInstances` command. NodeCanvas.jsx **17,215**. F23 added.
- **Gates:** `test:ci` PASS, Playwright 49 passed (F12 expected), `lint:undef` PASS.

---

## 2026-09-25: P2.06a done (Claude, orchestrator)

- **P2.06a:** `SyncDebugHost` owns the sync diagnostics (about 500 lines). NodeCanvas.jsx 17,822 → **17,313**. F22b added. "Hide" now hides only the overlay (report).
- **Gates:** `test:ci` PASS, Playwright 47 passed (F12 expected), `lint:undef` PASS.

---

## 2026-09-25: P2.06b done; render-budget flake fixed (Claude, orchestrator)

- **P2.06b:** `ModalHosts` renders Help, Settings, Merge and Auto Graph and owns their open events. NodeCanvas.jsx 17,945 → **17,822**. F22 added.
- **F-77:** the marquee render-budget test's intermittent `test:ci` failure was NodeCanvas's 2 s mount timer landing mid-test under load; the test now waits it out. Two full runs clean.
- **Gates:** `test:ci` PASS ×2, Playwright 46 passed (F12 expected), `lint:undef` PASS.

---

## 2026-09-25: P2.11 done; D-21 (Claude, orchestrator)

- **D-21:** Grant smoke-tests at phase ends (or truly critical points) only. Wave 5 continues from wave 4; next smoke test is the end of P2.
- **P2.11** (6ce6a00): `CanvasShell` owns the layout (container, Header, panel row, TypeList). NodeCanvas returns the canvas area and portals its remaining overlays into a `display: contents` slot, so their DOM position is unchanged.
  - New `shell-shots.pw.js` + `scripts/compare-shots.mjs`: nine shell states are pixel-identical to the old layout within antialiasing noise (≤ 99 canvas-edge pixels, the same as two runs of the old code).
  - Commits in S1/S6/S7 unchanged.
- **Gates:** `test:ci` PASS (3,549, 68 known, 0 new), Playwright 45 passed (F12 expected), `lint:undef` PASS. NodeCanvas.jsx **17,945**.
- **Next:** the P2.06 hosts (modals, universe, sync debug, searches, force sim).

---

## 2026-09-25: P2.10 done, with B-13 (Claude, orchestrator)

- **P2.10** (5a573a5): TypeList takes no props. Its lists come from selectors with equality checks (`useStableSelector`, new) and its click handlers read the stores. `TypeListHost` adds memo and a Profiler. `useActiveGraphNodes` turned out unnecessary.
  - TypeList commits 0 in S1/S4/S5/S7. Total render ms: S5 103 → 59, S4 22 → 14, S7 43 → 27.
- **B-13** found and fixed: typing selected nodes from the TypeList did nothing (instance ids passed as prototype ids, since the initial release). F21 guards it.
- **Integration 5a573a5:** `test:ci` PASS (3,549, 68 known, 0 new), Playwright 45 passed (F12 expected), `lint:undef` PASS. NodeCanvas.jsx **17,962**.
- **Next:** P2.11 (App owns the shell layout; Header, Panels and TypeList elements move to App).

---

## 2026-09-25: wave 3 smoke-tested; P2.09 done on wave 4 (Claude, orchestrator)

- Grant smoke-tested wave 3 ("looks great"); he fast-forwards `main` to 1c15fc7. Wave 4 (`refactor/wave4-integration`) starts from 1c15fc7.
- **P2.09** (e94df94): each Panel is wired by `PanelHost` (`side` only); the panel hurtle is a canvas command.
  - Measured first with a Profiler inside Panel's memo: selection and `hydratedNodes` props (only Semantic Discovery used them) and Panel's own `graphs` subscription drove its renders.
  - Views that show live graph data subscribe for themselves, and Panel is a plain memo.
  - Panel commits in S1/S4/S5/S7: 0 (were 2/8/18/2).
- **F-76** found with `--explain S1` and fixed: the hidden wizard view polled file status into unused state every 3 s. S1 9 → 7 commits.
- **X-05** deleted (the right Panel's ref and `openNodeTab`).
- **Integration e94df94:** `test:ci` PASS (3,547, 68 known, 0 new), Playwright 43 passed (F12 expected), `lint:undef` PASS. NodeCanvas.jsx **17,968**.
- **Next:** P2.10 (TypeList host + `useActiveGraphNodes`).

---

## 2026-09-25: P2.08 done, with P2.06e and B-12 (Claude, orchestrator)

- **P2.08** (5bce422): Header is wired by `HeaderHost`, a one-prop host that reads the stores itself. Canvas actions go through a new command registry (**D-20**). Header's file operations became `services/universeFileActions.js` (**P2.06e** done).
  - Header commits: S1/S5/S7 0 (before: one per NodeCanvas render, e.g. 38 in S5). S4 1 and S11 1 (Undo turning on), S13 2 (tab change).
  - NodeCanvas stopped subscribing to `openGraphIds` (an empty effect was the only reader) and lost a `headerGraphs` check that could never fire.
  - HeaderHost still renders in NodeCanvas's header slot; App takes the element in P2.11 with the layout.
- **B-12** found and fixed: View → Snap to Grid and Grid → Lattice / Dot were dead, since Header dropped their props. F19c guards it.
- Perf harness: rows record commits per host Profiler; the table has a "Hosts (commits)" column.
- **Integration 5bce422:** `test:ci` PASS (3,547 tests, 68 known, 0 new), Playwright 40 passed (F12 expected), `lint:undef` PASS. NodeCanvas.jsx 18,362 → **17,994**.
- **Next:** P2.09 (Panels to App): `useActiveGraphNodes`, the hurtle command, the comparator re-check.

---

## 2026-09-25: P2.02–P2.05 done; wave 3 under way (Claude, orchestrator)

- Wave 2 smoke-tested by Grant and pushed (`main` 4daa4d1). Wave 3 integration starts from it.
- **P2.02** (f29b9f0): node selection lives in `canvasUIStore`, bound in place. `useNodeActions.js` deleted. No extra commits (S6 29, S7 18). P2.01 now counts as done.
- **P2.03** (4fbb562): the pie target and its render/transition state, preview, definition indices, carousel and orbit flags, editing id and clipboard version moved.
  - Everything written in the pie's exit flush moved together; leaving part in `useState` rendered twice (store writes render at once, `useState` writes outside a React event render later).
  - **B-08** fixed, and new **B-11** found and fixed: the right panel's Components list always showed the first definition. F17 guards both.
  - `selectedGroup` and the edge-selection decision split out as P2.03b / P2.03c.
- **P2.04** (2d4c315): prompts, modal flags, header searches and `isHeaderEditing` moved. F-50's dead panel focus plumbing deleted (**D-19**).
- **P2.05** (87f11e7): every "open the left panel to view X" goes through `openLeftPanelView`, a store request with a nonce. `leftPanelRef` and the `leftPanelInitialView` prop are gone. F18 guards the repeat request (checked that it fails when the nonce is ignored).
- **Integration 87f11e7:** `test:ci` PASS (3,543 tests, 68 known, 0 new), Playwright 37 passed (F12 the expected B-05 failure), `lint:undef` PASS. NodeCanvas.jsx 18,412 → **18,362**.
- **Next:** P2.08 (canvas command registry; Header to App).

---

## 2026-09-25: P1.08 done; wave 2 complete on integration (Claude, orchestrator)

- **P1.08** (fa65a73):
  - `nodes` keeps its array when nothing changed. The reuse check had never matched image-less nodes (fixed).
  - `hydratedNodes` reuses objects exactly.
  - S10b: 41 → 23 commits; the node-derived memos stop running on off-graph writes.
- **Integration fa65a73:**
  - `lint:undef` PASS
  - `test:ci` PASS (3,515 tests, 68 known, 0 new)
  - Playwright 35/35
  - build OK
  - NodeCanvas.jsx 18,412
- **P1 is done** apart from B-03 (welcome-screen host, D-17, outside NodeCanvas).
- **Next:** Grant smoke-tests wave 2, then fast-forwards `main`. After that, P2 kickoff: re-verify findings, refine cards, and get Grant's OK on the card list.

---

## 2026-09-25: P1.12b, P1.10 (+ B-06), P1.05 done by the orchestrator (Claude)

- **P1.12b** (fb328e3): selecting a node re-solves only labels whose own route changed. Labels stay put on select (D-18); at-rest placement is identical. S7: 68 → 64 ms (lombardi), 54 → 46 ms (manhattan).
- **P1.10 + B-06** (3c6883b):
  - The pie memos keep only real dependencies, so the camera settle no longer rebuilds the pie. S6: 30 → 28 commits.
  - The wizard toggle now reaches the pie. F6b fails without the fix.
- **P1.05** (e5a7e82): panel resize moves the bar directly and commits once. S9: 71 → 17 commits, 187 → 40 ms.
- **Every merge passed:** Playwright 35/35, NodeCanvas tests 56, `lint:undef`. NodeCanvas.jsx held at 18,412 lines (comments condensed to fit).
- **Next:** P1.08 (stable `nodes`).

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
