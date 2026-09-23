# P0: Measure and build the safety net

**Goal.** Before moving state and handlers around, make it possible to answer two questions quickly:
- Did this change reduce commits and milliseconds?
- Did it break an interaction?

Right now neither can be answered (F-60 to F-63).

**Why this phase comes first.** Every later phase moves handlers, and none of that movement is covered by tests today.

**Exit criteria.**
- The probe works on a profiling build.
- The fixtures load without going through onboarding.
- The interaction flows pass on `main`.
- The baseline is recorded in METRICS.md.
- CI runs tests.
- The size ratchet is active.

**Card format.** Every card in every phase file uses the same fields:
- **Status:** `todo`, `in-progress (<who>, <date>)`, `review`, `done (<commits>)`, `blocked (<why>)`, or `deferred (<why>)`
- **Lane / Size / Depends**
- **Findings:** the F-, B- and X- IDs the card addresses
- **Change:** what to do
- **Don't:** what is out of scope
- **Accept:** what must be true when the card is done
- **Verify:** how to check it
- **Handoff:** notes written for the next agent

---

### P0.01: Render probe and profiling build
- **Status:** todo
- **Lane:** B and C (App.jsx wrapper, vite config) · **Size:** M · **Depends:** none
- **Findings:** F-28, F-63
- **Change:**
  - Create `src/utils/perf/renderProbe.js`.
    - Export an `onRender` sink for `<Profiler>`, keyed by id.
    - Expose `window.__renderProbe` with `start(label)`, `stop()` → `{ label, commits, totalMs, maxMs, byId }`, and `reset()`.
    - It must be inert unless `?probe=1` is present or `window.__renderProbe.enable()` has been called.
  - In `App.jsx`, wrap `<NodeCanvas />` in `<Profiler id="NodeCanvas" onRender={…}>`. Later tasks add a Profiler for each layer and host they create.
  - Add a profiling build:
    - `npm run build:profile` builds in Vite mode `profile`, aliasing `react-dom$` → `react-dom/profiling` (plus `scheduler/tracing` if needed).
    - Serve it with `vite preview`.
    - Confirm that `onRender` fires in that build.
  - Pick one way to attribute a render to its cause, and record the choice as a DECISION. Options:
    - React DevTools' "record why each component rendered"
    - `@welldone-software/why-did-you-render`
    - a small dev-only helper that diffs store selectors and state
- **Don't:**
  - Add `performance.mark` calls throughout NodeCanvas.
  - Leave any probe active in a normal production build.
- **Accept:**
  - The probe reports NodeCanvas commits and milliseconds in both the dev build and the profile build.
  - Zero cost when the probe is off.
- **Verify:** Manually pan and select in the profile build, with DevTools open, and compare the probe's counts against the Profiler tab.
- **Handoff:**

### P0.02: Fixture universes and a dev-only fixture loader
- **Status:** todo
- **Lane:** B · **Size:** M · **Depends:** Q2 (whether a real universe can be used)
- **Findings:** F-65
- **Change:**
  - Add three fixtures under `test/fixtures/canvas/`:
    - **small:** about the smoke-test size
    - **medium:** about 150 nodes and 250 edges, with nested groups, node-groups, self-loops, parallel edges and connection labels on
    - **large:** about 600 nodes and 1,000 edges
  - Prefer deriving medium and large from one of Grant's real universes, with names scrubbed.
  - Add a dev/test-only loader: `?fixture=<name>` skips onboarding and calls `useGraphStore.getState().loadUniverseFromFile(data)`.
    - It must be compiled out of production builds (guard with `import.meta.env.DEV` or a dedicated mode).
    - Leads: `window.useGraphStore` (App.jsx:17); `?test=true` storage isolation (TESTING_ONBOARDING.md); how the smoke test stubs `WorkspaceService`.
- **Don't:**
  - Touch real universe storage.
  - Ship the loader.
- **Accept:** `npm run dev` with `?fixture=medium` opens straight into an interactive canvas on the fixture's graph.
- **Verify:** Load all three fixtures. Pan, zoom and select work in each.
- **Handoff:**

### P0.03: Playwright interaction flows
- **Status:** todo
- **Lane:** B (plus `package.json`) · **Size:** L · **Depends:** P0.02, Q3
- **Findings:** F-61
- **Change:**
  - Add `@playwright/test`, a `playwright.config.js` that starts Vite, and `test/e2e/canvas/*.spec.js`.
  - Add the script `npm run test:canvas`.
  - Each flow asserts on store state (`window.useGraphStore.getState()`) and the DOM:
    - **F1** Dragging a node changes its instance position.
    - **F2** Drag-pan changes the view, and momentum settles.
    - **F3** Wheel zoom in and out around the pointer.
    - **F4** Marquee selects the expected set and does not select group anchors. This is **expected to fail until B-01 is fixed**: mark it `test.fail` with a link to P1.04.
    - **F5** Drawing a connection from node A to node B creates an edge. A self-loop opens the self-loop dialog.
    - **F6** Clicking a node opens its pie menu. One action (e.g. colour, or open in panel) works, and the menu closes.
    - **F7** Hovering an edge highlights it; clicking selects it; shift-click adds to the selection.
    - **F8** Dragging the panel resizer changes the width.
    - **F9** The abstraction carousel opens, steps and closes.
    - **F10** Touch: one-finger pan, two-finger pinch zoom, long-press drag. Use a context with `hasTouch` and CDP touch events.
    - **F11** Creating a group, then dragging it, moves its members.
    - **F12** The canvas and node context menus open with the expected options.
    - **F13** Keyboard: deleting a selected node, and WASD/arrow-key panning.
    - **F14** The plus sign: clicking empty canvas, then the name prompt, creates a node.
    - **F15** Switching graphs restores each graph's view.
- **Don't:**
  - Try to automate Mac trackpad gestures or a gamepad. Those go on the manual device checklist in P4.
- **Accept:**
  - Every flow passes on current `main`, apart from the documented expected failures.
  - The whole suite runs in about 3 minutes or less.
- **Verify:** Run the suite 3 times in a row. It must not be flaky.
- **Handoff:**

### P0.04: Perf scenarios and baseline
- **Status:** todo
- **Lane:** B · **Size:** M · **Depends:** P0.01, P0.02, P0.03
- **Findings:** F-63
- **Change:**
  - Implement scenarios S1–S13 from METRICS.md on top of the Playwright infrastructure.
  - Run them against the profile build (`vite preview`), with the medium and large fixtures.
  - Each scenario wraps its steps in `__renderProbe.start/stop`.
  - Output JSON plus a markdown table: median of 5 runs.
  - Add the script `npm run perf:canvas [-- --scenario S1,S6]`.
- **Accept:**
  - The baseline table in METRICS.md is filled in and records the commit hash.
  - Running a single scenario takes under a minute.
- **Verify:**
  - The audit's expectations should reproduce roughly: S1 about 60 commits per second, S6 5–8 commits.
  - If they don't, add a FINDING explaining why.
- **Handoff:**

### P0.05: Harden the jsdom render-contract test
- **Status:** todo
- **Lane:** B · **Size:** M · **Depends:** none (pre-P0 OK)
- **Findings:** F-60
- **Change:**
  - Extend `src/NodeCanvas.smoke.test.jsx`, or add a sibling test file:
    - a variant with culling on
    - each routing style: straight, manhattan, clean, lombardi
    - groups, node-groups, self-loops and parallel edges
  - Assert every DOM selector that `useNodeDrag.js` queries. Enumerate them with `grep -n "querySelector" src/hooks/useNodeDrag.js`. Examples: `[data-arrow]`, `[data-endpoint-dot]`, `path[data-shell-clip]`, `g[data-label-sprite]`, `[data-group-id]`, `.group-label`, `[data-edge-hit]`, `[data-connection-label]`, `[data-label-frame]`.
- **Accept:**
  - Passes on `main`.
  - Deleting any contract attribute makes it fail.
- **Handoff:**

### P0.06: Get CI running again
- **Status:** todo
- **Lane:** C (`.github/workflows/`, a known-failures file) · **Size:** M · **Depends:** none
- **Findings:** F-62, F-64
- **Change:**
  - Confirm today's vitest failure count and check in a known-failures list.
  - CI fails only on *new* failures.
  - Run the smoke and contract tests.
  - Add a Playwright job if it's affordable. If not, running `npm run test:canvas` locally becomes a required step before every Lane A merge (note that in README → Verification).
- **Accept:** A workflow run on `main` passes with the known-failures list in place.
- **Handoff:**

### P0.07: Size ratchet
- **Status:** todo
- **Lane:** B · **Size:** S · **Depends:** none (pre-P0 OK)
- **Findings:** F-49, F-64
- **Change:**
  - Add `test/meta/nodecanvas-budget.test.js`. It asserts that the line count of `src/NodeCanvas.jsx` is at most `budget` from `test/meta/nodecanvas-budget.json` (start: 19,255).
  - It also asserts a *minimum* sanity floor (e.g. more than 1,000 lines), so a near-wipe like F-64 fails loudly.
  - Every Lane A task that shrinks the file lowers the budget in the same commit.
- **Accept:** The test fails if the file grows past the budget or collapses below the floor.
- **Handoff:**
