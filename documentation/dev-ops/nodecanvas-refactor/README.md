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

**In flight** (edit this when you claim or finish a task):
- *(none)*

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
| P0 | [phases/P0-measure.md](phases/P0-measure.md) | Render instrumentation, fixture universes, Playwright flows, perf scenarios, CI, size ratchet | not started |
| P1 | [phases/P1-stop-rerenders.md](phases/P1-stop-rerenders.md) | Remove per-frame and cascading re-renders; delete dead code | not started |
| P2 | [phases/P2-ui-store-and-shell.md](phases/P2-ui-store-and-shell.md) | UI store for shared state; move Header, Panels, TypeList and modals out of NodeCanvas | not started |
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

## Open questions for Grant

Answer them here; the answer becomes a DECISION.

- **Q1: Feature freeze.** While the refactor runs, are new canvas features paused, or do they continue in new modules only?
- **Q2: Fixture universe.** Can one of your real universes (with names scrubbed if needed) serve as the medium and large perf fixtures? Which one is representative?
- **Q3: Playwright.** Is it OK to add `@playwright/test` as a devDependency for the interaction and perf harness?
- **Q4: Concurrency.** One agent at a time, or several in parallel worktrees? This decides how much Lane B pre-staging is worth.
- **Q5 (needed by P4.01): touch constants.** `useCanvasTouch` uses different zoom limits and movement thresholds from NodeCanvas (F-44). Which values are intended?

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
