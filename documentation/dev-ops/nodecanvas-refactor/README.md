# NodeCanvas Refactor: Plan of Record

> **Status:** active. Started 2026-09-23. Target: done before the 1.0.0 release. Owner: Grant.
>
> This folder is the source of truth for the NodeCanvas refactor. **Every agent that touches `src/NodeCanvas.jsx`, anything it renders, or the canvas hooks reads this file first, every session**, and follows the protocol below. If this folder and your context disagree, this folder wins; if this folder and the code disagree, the code wins and you fix this folder.

## Why

`src/NodeCanvas.jsx` is, pre-refactor, 19,255 lines (at commit 1e6ab02) in a single function component. It has no props and is mounted once. It renders the entire app shell: Header, both Panels, TypeList, every control panel, about ten modals, and the SVG canvas. So any state change anywhere in it re-renders all of it. On a real universe that noticeably slows ordinary use.

Earlier extractions made the file smaller for a while. They never made it re-render less, and it grew back each time (see FINDINGS F-41 and F-49).

**Goals, in priority order:**
1. Cut how often the canvas re-renders, and how much each render costs.
2. Break it into units that own their own state, so it stops growing back.

## Success criteria

Primary criteria are measured by the P0 harness (METRICS.md), not by line count.

1. No NodeCanvas commits per frame during:
   - drag-pan
   - wheel, trackpad and pinch zoom
   - node drag
   - marquee
   - panel resize
   - hurtle
   - carousel scroll
2. Hovering, selecting, or opening a pie menu re-renders only the components that display that state. It must not re-render the shell (Header, Panels, TypeList, modals), and it must not re-render every edge.
3. Store writes that don't touch the active graph cause 0 canvas commits. That includes other graphs, thumbnails for prototypes that aren't on the active graph, and enrichment.
4. Commit cost for S6 (open pie menu) and S7 (select node) is at least halved from the P0 baseline. Confirm the exact target once the baseline exists.
5. Every P0 interaction flow passes. No feature is lost.

Secondary:

6. `NodeCanvas.jsx` is at most 4,000 lines, enforced by a ratchet test whose budget only goes down.
7. No hook is called with more than about 15 parameters.

## Principles

These exist because past efforts regrew.

1. **Measure commits and milliseconds, not lines.** Line count is a side effect.
2. **A unit only counts if it is a render boundary.**
   - A hook called inside NodeCanvas *is* NodeCanvas: its state re-renders the whole thing. Hooks organise code; they do not make it faster.
   - Speed comes from components that subscribe to stores themselves, from stores, and from controllers that aren't React at all.
3. **Take work out of React where it doesn't need React:** camera, gestures, per-frame animation. Every perf win so far came from doing this: DOM-bypass pan/zoom, drag DOM writes, culling, the `graphViews` slice.
4. **Nothing is done until it is wired in, used, and measured.** `useNodeActions` and `EdgeRenderer` were both marked done and never called.
5. **Preserve behaviour by default.** Bug fixes are separate commits with a B-ID. Behaviour questions go to Grant.
6. **New canvas features go into the new structure, never back into `NodeCanvas.jsx`.**

## Agent protocol

### Start of session
1. Read this README, then the three newest entries in `LOG.md`.
2. Open your phase file in `phases/`. Read your task card and the FINDINGS it cites.
3. Run `git log --oneline -8 -- src/NodeCanvas.jsx`. If there are commits the LOG doesn't mention, note them and re-check your task's anchors.
4. **Re-verify every finding you act on**: grep the symbol and read the region. Findings are pinned to a commit, and code moves.
5. Set your card to `in-progress (<who>, <date>)` and add it to **In flight** below.

### Working in a 19k-line file
- **Never read `NodeCanvas.jsx` whole.** It is about 250k tokens. Find code by grepping the symbol anchors in `MAP.md`, and read windows of 300 lines or fewer.
- Line numbers in these docs are hints pinned to a commit (`@1e6ab02`). **Symbols are the real anchors.**
- Use subagents (Explore) for broad searches, and keep only their conclusions in your context.
- One task per commit series. Keep diffs reviewable: mechanical moves up to about 1,000 lines, logic changes up to about 200.
- Comments move with their code. Delete a comment only if it is stale. When you touch a stale one, fix it; examples are the stale "143 ms" figure (F-63) and links to plan files that no longer exist.

### Verification (every task)
1. Tests:
   - Always: `npx vitest run src/NodeCanvas.smoke.test.jsx`, plus the tests near your change.
   - Once P0 lands, also: `npm run test:canvas` (interaction flows) and `npm run perf:canvas` for the scenarios your card names.
2. `npm run build` passes.
3. Manually check the interaction you touched in `npm run dev`. Input tasks must list the device checks Grant needs to do (trackpad, iOS touch, Android, gamepad, Electron).
4. For before/after comparisons, use `git checkout <rev> -- <file>` and then restore it. **Never use `git stash`**: Grant's stash list holds real work.

### End of session (even if the task isn't finished)
1. Update your card:
   - status
   - commit hashes
   - a **Handoff** note: what's done, what's left, and the gotchas. Write it so the next agent needs none of your context.
2. Add a new entry at the top of `LOG.md`.
3. Record measurements in `METRICS.md`, and lower the size budget if the line count dropped.
4. Keep the other docs current:
   - If you moved a region, update `MAP.md` with where it went.
   - If you learned something, add a FINDING.
   - If you made a judgement call nobody should re-argue, add a DECISION.
5. Remove yourself from **In flight**, and update the phase board if the phase status changed.

### Commits
Message format examples:
- `refactor(canvas): P1.01 remove dead panStart state`
- `fix(canvas): B-03 …`
- `test(canvas): P0.03 …`

Name NodeCanvas changes honestly in the message. Past messages such as "MaroonSlider" hid 500-line NodeCanvas changes and made bisecting hard.

## Parallel work

`NodeCanvas.jsx` is one file, so concurrent edits to it conflict. Every card declares a **Lane**:

- **Lane A** edits `NodeCanvas.jsx`. **Only one Lane A task may be in flight at a time.**
- **Lane B** creates new files only: tests, harness, new modules that aren't wired in yet. It's safe to run in parallel; use a worktree.
- **Lane C** edits other existing files: hooks, stores, Panel, Header. Lane C tasks can run in parallel as long as they don't touch the same files.

**Pattern for big extractions:**
1. Build the new module and its tests in Lane B, against the card's spec.
2. A short Lane A task wires it in and deletes the old code.

This keeps Lane A turns short, so the single-file bottleneck doesn't serialise everything.

### Parallel mode (D-14)
One **orchestrating session** starts agents in git worktrees, reviews what they produce, merges it, and is the only writer of the shared plan docs.

**Worktree agents:**
- Edit only inside their own worktree. The main checkout is read-only to them.
- Commit each task separately on their own branch.
- Never merge, push, rebase `main`, or run `git stash`.
- Do **not** edit the shared docs: this README, LOG, METRICS, MAP, FINDINGS, DECISIONS, and the phase files.
- Instead, write one report per task to `reports/<TASK-ID>.md` and commit it on their branch. A report contains:
  - status and commits
  - what changed
  - verification evidence
  - measurements
  - new findings, labelled `NEW-n`
  - any deviations from the card
  - a handoff note
- **node_modules:** a new worktree has none. Symlink it from the main checkout (`ln -s /Users/granteubanks/Code/redstringuireact/node_modules node_modules`). If your task adds a dependency, delete the symlink and run a real `npm install` in the worktree instead.
- **Dev servers:** use a non-default port (e.g. `--port 48xx`). Grant's dev server may be on 4001. **Never run a Vite dev or preview server while `node_modules` is symlinked**: it writes into the main checkout's `.vite` cache (F-68). vitest and `vite build` are fine.
- **Check your base first.** Worktrees have been created from a stale commit (F-68). Before any work, run `git merge-base --is-ancestor main HEAD`. If `main` isn't an ancestor and you have no commits yet, move up with `git reset --keep main`.

**The orchestrator, after each agent finishes:**
1. Reviews the branch and runs its verification.
2. Merges it into `main`.
3. Folds the report into the card, LOG, METRICS, FINDINGS and MAP.
4. Updates **In flight**.

### Orchestrator runbook
This is how the orchestrating session reviews and lands agent work. A resumed or compacted session can pick up from here.

**Branches**
- Each wave has an integration branch, `refactor/waveN-integration`, checked out at `.claude/worktrees/integration-waveN`.
- Agents branch from it (see "Step 0" in their prompts) and work on `worktree-agent-<id>`.
- `main` changes only after Grant smoke-tests. **Grant fast-forwards `main` and pushes. Don't merge to `main` without his OK.**
- **Grant smoke-tests at phase ends or truly critical points only, not per wave (D-21).** Waves are a merge structure; keep going card to card and verify each one yourself.

**Per finished agent**
1. **Check scope.**
   - `git log --oneline refactor/waveN-integration..<branch>` and `git diff --stat refactor/waveN-integration...<branch>`.
   - Confirm the files stay within the agent's lane and base = wave (`git merge-base --is-ancestor <wave-base> <branch>`).
2. **Review the risky diffs yourself,** not just the report.
   - Run `npm run lint:undef` (P0.06). It fails on any undefined name in `src/` that isn't in `test/known-undefined-names.json`.
3. **Merge.** `git merge --no-ff` into the integration branch. If `wc -l src/NodeCanvas.jsx` dropped, lower `test/meta/nodecanvas-budget.json`.
4. **Full vitest.** Run `npm run test:ci` (P0.06). It fails on any failure not in `test/known-failures.json`, and on list entries that now pass (prune those in the same commit).
5. **Browser flows.** `CANVAS_E2E_PORT=48xx npm run test:canvas`.
   - It needs `@playwright/test` installed. The integration worktree now has its own `node_modules`, an APFS clone (`cp -Rc`) of an agent worktree's install. Give each new integration worktree the same.
   - F-68 still applies to any worktree whose `node_modules` is a symlink into the main checkout: no Vite dev server there. The e2e config uses a worktree-local `cacheDir` either way.
6. **Build.** `NODE_OPTIONS=--max-old-space-size=4096 npm run build` (CI uses the same heap).
7. **Fold the report into the docs.** Update the card, FINDINGS, METRICS, MAP, LOG and In flight, then commit on the integration branch.

**Handing a phase to Grant** (D-21: at the end of a phase, or at a point you truly can't verify yourself or that needs his decision)
1. Give him one visual smoke-test list covering everything since his last smoke test, and what "wrong" looks like.
2. He smoke-tests, then fast-forwards `main` to the integration branch and pushes.
3. Between smoke tests, start each new wave's integration branch from the previous one.

**Cancelled agents.** If an agent is cancelled (e.g. its session ended), its commits survive on its branch. The orchestrator may finish verifying and reporting that work itself. **Starting a new agent to redo a cancelled agent's unfinished work needs Grant's explicit OK.**

**In flight** (edit this when you claim or finish a task). Wave 5 is `refactor/wave5-integration`, based on wave 4 (a2b693a). Next smoke test: end of P2.
- ~~Lane A: P2.11~~ (6ce6a00), ~~P2.06b (+ F-77)~~, ~~P2.06a~~, ~~P2.06d~~, ~~P2.06c~~, ~~P2.06f~~, ~~P2.07~~, ~~P2.03b (+ B-14)~~, ~~P2.03c (D-22)~~
- ~~P2.12 (+ B-15)~~, ~~P2.13~~ — **P2 complete**
- Next: P3 kickoff (refine the P3 draft cards), then P3 cards

Wave 4 (smoke-tested by Grant), based on wave 3:
- ~~Lane A: P2.09 (+ X-05, F-76)~~ (e94df94), ~~P2.10 (+ B-13)~~ (5a573a5)

Wave 3 (smoke-tested by Grant; `main` fast-forwards to 1c15fc7), based on 4daa4d1:
- ~~Lane A: P2.02~~ (f29b9f0), ~~P2.03 (+ B-08, B-11)~~ (4fbb562), ~~P2.04 (D-19)~~ (2d4c315), ~~P2.05~~ (87f11e7), ~~P2.08 (+ P2.06e, B-12; D-20)~~ (5bce422)

Wave 2 (pushed to `main` at 4daa4d1):
- ~~Lane A: P1.03, P1.04 (+ B-01)~~ merged (7c188ba); ~~P1.06 (+ B-04)~~ merged (ebe2242)
- ~~Lane C: P0.06 (CI) + X-07~~ merged (7b74851)
- ~~Lane B: P0.04 (perf scenarios + baseline)~~ merged (0396b65)
- ~~Lane B: P1.12a~~ merged (a18248e); ~~Lane A: P1.12b~~ (fb328e3), ~~P1.10 + B-06~~ (3c6883b), ~~P1.05~~ (e5a7e82)
- ~~Lane A: P1.08~~ (fa65a73). Wave 2 complete; awaiting Grant's smoke test
- ~~Lane B: P2.01~~ pre-staged and merged into wave2-integration (5121cc7)
- ~~Lane B: P0.03b~~ flows F8–F13 + B-09 fix, merged into wave2-integration (517e9d8)

## Rules carried over from project memory

Worktree agents may not see Grant's memory, so these are repeated here.

- **Keep state updaters pure.** Never call setState or cause a side effect inside an updater. An impure updater once caused a real freeze. NodeCanvas currently calls `setPanStart` inside a `setPanOffset` updater; don't copy that.
- **`useGraphStore.getState()` snapshots go stale** after you call an action. Call `getState()` again.
- **If you change graphStore fields that the MCP bridge serialises, update all three together:** `BridgeClient.sendStoreToServer` → `redstring-mcp-server` `getRealRedstringState` → `toPlainState`.
- **Rendering stays plain SVG/DOM.** No canvas or WebGL rewrites (DECISION D-08).
- **Visuals:** use only the maroon accent, and don't colour-code destructive actions.
- **Images:** decode an image before its entrance animation starts.

## Phase board

| Phase | File | Goal | Status |
|---|---|---|---|
| P0 | [phases/P0-measure.md](phases/P0-measure.md) | Render instrumentation, fixture universes, Playwright flows, perf scenarios, CI, size ratchet | **done**: P0.01–P0.07 (P0.03 + P0.03b) |
| P1 | [phases/P1-stop-rerenders.md](phases/P1-stop-rerenders.md) | Remove per-frame and cascading re-renders; delete dead code | **done** except P1.13's B-03, which becomes the welcome-screen host (D-17), built outside NodeCanvas |
| P2 | [phases/P2-ui-store-and-shell.md](phases/P2-ui-store-and-shell.md) | UI store for shared state; move Header, Panels, TypeList and modals out of NodeCanvas | **done** (waves 3–5): shell out of NodeCanvas (`CanvasShell` + hosts), UI state in canvasUIStore. Overlays still portalled from NodeCanvas go to P5 hosts |
| P3 | [phases/P3-canvas-layers.md](phases/P3-canvas-layers.md) | Render layers for groups, edges, nodes and overlays; narrow subscriptions; stable handlers | not started |
| P4 | [phases/P4-input-controllers.md](phases/P4-input-controllers.md) | Camera controller, pointer-gesture state machine, input consolidation | not started |
| P5 | [phases/P5-menus-and-panels.md](phases/P5-menus-and-panels.md) | Pie menu, carousel and abstraction state machine; control panels; remaining hosts | not started |
| P6 | [phases/P6-closeout.md](phases/P6-closeout.md) | Remove flags, final metrics, architecture doc | not started |

**Order:** P0 → P1 → P2 → P3 → P4 → P5 → P6.
- Cards marked **pre-P0 OK** may start before the harness exists, provided they record a manual React DevTools Profiler before/after.
- P3–P5 cards are **drafts**; refine them at phase kickoff.

**Phase kickoff:**
1. Re-verify the phase's findings against the current code.
2. Refine the cards (split, reorder, add).
3. Get Grant's OK on the card list.
4. Log it.

**Phase close:**
- Every card is done, or explicitly deferred with a reason.
- Metrics are recorded.
- MAP is updated.
- A LOG entry summarises the phase.

## Questions for Grant

Answer them here; the answer becomes a DECISION.

- ~~Q1: Feature freeze.~~ Explained to Grant 2026-09-23. Working rule D-13: Grant doesn't edit `NodeCanvas.jsx` while agents are working on it; canvas feature ideas get queued or built in the new structure.
- ~~Q2: Fixture universe.~~ Answered: use Claude's Chambers. See D-15 and F-66.
- ~~Q3: Playwright.~~ Answered: yes. See D-12.
- ~~Q4: Concurrency.~~ Answered: parallel worktrees, Claude's call. See D-14.
- ~~Q6: may connection labels stay put when you select a node?~~ Answered yes (D-18). The original question:
  - Today, selecting any node re-solves every connection label on the graph, and a few land somewhere else each time: 1–7 of 16 in the test graph.
  - Only 1–2 of those move because the geometry changed: the selected node's outline is 6 px thicker, so its own connections end 6 px sooner.
  - The rest move because the label solver doesn't give the same answer twice (F-72).
  - The fix for the slowness (P1.12b) stops the re-solve, so labels would stay exactly where they were when you select or deselect. The labels' resting positions don't change.
  - Recommended: yes. Details: reports/P1.12a.md.
- **Q5 (needed by P4.01): touch constants.** `useCanvasTouch` uses different zoom limits and movement thresholds from NodeCanvas (F-44). Which values are intended? Ask when P4 starts.

## Files in this folder

| File | What it holds | Update when |
|---|---|---|
| `README.md` | Goals, principles, protocol, phase board, open questions | Phase status changes; In flight; answers to questions |
| `FINDINGS.md` | Verified audit facts (F-), bugs (B-), dead code (X-), pinned to a commit | You learn something, or a finding is resolved |
| `MAP.md` | Region map of `NodeCanvas.jsx`: symbol anchors → destination → task; target folder structure | You move a region |
| `DECISIONS.md` | Numbered decisions with rationale, so nobody re-argues them | You or Grant make a call |
| `METRICS.md` | Scenario definitions, baseline, per-task results, size history | Every measured task |
| `LOG.md` | Newest-first session log with commits, measurements and surprises | End of every session |
| `phases/P*.md` | Task cards, which are the single source of task status | You work a task |
