# P1: Stop the per-frame and cascading re-renders

**Goal.** Remove the re-render sources that are cheap to fix and costly to leave in place, and delete dead code so every later task works in a smaller file.

Each card is small and can be reverted on its own. Each one is measured against the baseline, or with a manual Profiler before/after for cards marked **pre-P0 OK**.

**Exit criteria.**
- No per-frame NodeCanvas commits in S1, S1t, S5, S9 or S13.
- S6 has fewer commits than the baseline.
- Dead code is gone.
- The size budget has been lowered.

---

### P1.01: Remove the dead `panStart` state
- **Status:** done (013cfa8; report reports/P1.01.md)
- **Lane:** A · **Size:** S · **Depends:** none (**pre-P0 OK**)
- **Findings:** F-01
- **Change:**
  - Delete the `panStart` useState (`const [panStart, _setPanStartState]`).
  - `setPanStart` then writes `panStartRef` only.
  - Move the `setPanStart` call out of the `setPanOffset(prev => …)` updater in the `handleMouseMove` pan rAF. Updaters must stay pure.
- **Don't:** Change the pan maths, momentum, or the pinch→one-finger handoff.
- **Accept:**
  - S1 and S1t show no per-frame NodeCanvas commits. What remains should be press, threshold, release, settle, and culling growth.
  - Pan and momentum feel unchanged.
- **Verify:**
  - Smoke test.
  - Manually: mouse drag-pan with momentum, and touch pan in device emulation.
  - Record S1 before/after in METRICS.
- **Handoff:** jsdom Profiler count: mouse and touch drag-pan went from 60 commits per 30 moves (2 per frame: panStart + setHasMouseMovedSinceDown) to 0. The regression test is src/NodeCanvas.renderBudget.test.jsx. Grant still needs to check pan and momentum feel by hand.

### P1.02: Delete dead code and dead state
- **Status:** done (739c464, 560a08e, ddbc5fe; report reports/P1.02.md)
- **Lane:** A (plus `useCanvasTouch.js`) · **Size:** M (about 650 lines) · **Depends:** P1.01 (only to avoid conflicts)
- **Findings:** X-01, X-02, X-03, X-04, X-06
- **Change:**
  - Remove every item in the X-table except X-05, which is handled in P2.09.
  - For `isPaused` and `recentlyPanned`, both always false: delete the state *and* simplify each guard that reads them, as if the value were the constant `false`.
  - Keep whatever part of `pinchSmoothingRef` the touch hook actually reads (`lastFrameTime`).
  - Remove the dead `useCanvasTouch` parameters at both the call site and the hook signature, and update the touch tests that hand-build its input object.
- **Don't:** Remove anything you can't prove is unreferenced. Grep the setter name too, and check `src/hooks/`.
- **Accept:**
  - The smoke test and touch tests pass, and the build passes.
  - The line count drops by about 600 or more.
  - The size budget is lowered.
- **Handoff:** X-01, X-02, X-03, X-04 and X-06 removed. NodeCanvas.jsx went from 19,255 to 18,518 lines together with P1.01/P1.07. Lint no-undef is unchanged against the base (only B-03 remains). Follow-up X-07 (dead hook params).

### P1.03: Bind mousemove once
- **Status:** todo
- **Lane:** A · **Size:** S · **Depends:** P0.03 preferred
- **Findings:** F-02
- **Change:**
  - Remove one of the two `onMouseMove={handleMouseMove}` bindings (the `.canvas-area` div or the nested `<svg>`).
  - First read `handleMouseMove` for any reliance on `e.currentTarget` or `e.target` that differs between the two, and for any `stopPropagation`.
- **Don't:** Touch mouseup. The 2–3× release is handled structurally in P4.04.
- **Accept:**
  - `handleMouseMove` runs once per native event. Check with a dev-only counter, then remove the counter.
  - Flows F1, F2, F4, F5 and F7 pass.
- **Handoff:**

### P1.04: Marquee without a React commit on every move
- **Status:** todo
- **Lane:** A · **Size:** M · **Depends:** P1.03
- **Findings:** F-03, B-01, B-02
- **Change:**
  - Draw the selection rectangle imperatively through a ref, the way `drawingConnectionLineRef` is drawn.
  - Compute the selection synchronously with `selectionFromRect` (as the gamepad path already does), coalesced to at most one pass per rAF.
  - Call `setSelectedInstanceIds` **only when membership changes**.
  - Drop the `canvasWorker.calculateSelection` round trip. That also fixes B-02.
  - Make the release path use `selectionFromRect`, which fixes B-01, as a separate `fix(canvas): B-01` commit.
  - Route the gamepad marquee through the same code.
- **Don't:** Change what counts as "inside" the marquee.
- **Accept:**
  - In S5, commits equal the number of membership changes plus about 2.
  - F4 passes, including the group-anchor assertion.
- **Handoff:**

### P1.05: Panel resize without a commit every frame
- **Status:** todo
- **Lane:** A · **Size:** M · **Depends:** none
- **Findings:** F-04
- **Change:**
  - While dragging, write the width imperatively (a style or CSS variable on the panel element) and commit `setLeft/RightPanelWidth` on drag end.
  - First list everything that reads the width during a drag: overlay layout, `getFramingRegion`, `useViewportBounds`, and Panel itself.
  - If the imperative write turns out too invasive before the shell moves out, mark this card `deferred` to P2.12 and log why.
- **Accept:**
  - S9 shows no per-frame commits.
  - The panel tracks the pointer with no lag.
  - F8 passes.
- **Handoff:**

### P1.06: `HurtleOrb` component
- **Status:** todo
- **Lane:** A (plus a new file) · **Size:** M · **Depends:** none
- **Findings:** F-05, B-04
- **Change:**
  - Create `src/components/canvas/layers/HurtleOrb.jsx`. It owns the rAF loop and writes its position, size and z-index imperatively.
  - NodeCanvas sets the hurtle only at start (with its target) and at end.
  - Fix B-04 in a separate commit:
    - read zoom from `transform.zoomRef` / the canvas transform, not from `svg.style.transform`
    - add the missing `canvasSize` dependency
- **Accept:**
  - S13: at most 2 NodeCanvas commits during the flight.
  - The orb looks the same.
  - The orb size scales with zoom (B-04).
- **Handoff:**

### P1.07: Remove debug work from render
- **Status:** done (d26dc7a; report reports/P1.07.md)
- **Lane:** A · **Size:** S · **Depends:** none (**pre-P0 OK**)
- **Findings:** F-26
- **Change:**
  - Delete the `debugLogSync(...)` call and the `edgePairGroupsDebug` build inside the edges IIFE.
  - Move ArrowheadAudit into a dev-only effect keyed on `visibleEdges`, behind a `window.__arrowheadAudit` flag. Alternatively delete it; say which in the Handoff.
  - Remove `DIAGNOSE_ZOOM_FLICKER` and every block it gates.
- **Accept:**
  - No network requests and no console output come from render during normal use.
  - The smoke test passes.
- **Handoff:** debugLogSync POSTs from render went from 3 to 0. ArrowheadAudit DELETED rather than flag-gated: Grant's real universe has 0 stale arrowsToward ids. DIAGNOSE_ZOOM_FLICKER and its blocks removed.

### P1.08: Stable `nodes` identity; fold `hydratedNodes` into it
- **Status:** todo
- **Lane:** A · **Size:** M · **Depends:** P0.01 (to measure)
- **Findings:** F-20
- **Change:**
  - The `nodes` memo returns the *previous array* when its length, order and every element are unchanged.
  - Compare the fields of `hydratedNodes` and `nodes`:
    - If they carry the same data, derive `hydratedNodes` from `nodes`, reusing the same objects.
    - If they differ, document how, and make `hydratedNodes` reuse objects too.
  - Consumers to check: the groups IIFE, `EdgeGlowIndicator`, `Panel`, `ForceSimulationModal`, and the node hitbox debug overlay.
- **Accept:** Under S10b and S11, `nodeById`, `baseDimsById` and the routing memos don't recompute. Prove it with a dev-only memo-run counter, then remove the counter.
- **Handoff:**

### P1.09: Skip store writes that change nothing
- **Status:** done (2aaa2cf, 4f97ba0, f85a6f5; report reports/P1.09.md)
- **Lane:** C (`imageCache.js`, `graphStore.js`, `useCanvasTransform.js`) · **Size:** S · **Depends:** none (**pre-P0 OK**)
- **Findings:** F-07, F-11
- **Change:**
  - `imageCache.clearImage`: return `state` when the key is absent.
  - `imageCache.setImage`: return `state` when the new data is the same value.
  - `graphStore.setSelectedEdgeIds`: skip when the new selection equals the current one (compare by size and contents), and remove its `console.log`.
  - `useCanvasTransform` settle: only set `settledPan`/`settledZoom` when the values actually changed.
- **Don't:** Change what any of these actions do when the value *does* change.
- **Accept:**
  - S10b with already-cached images produces 0 commits.
  - A settle with no movement produces 0 commits.
  - The `useCanvasTransform` tests pass.
- **Handoff:** The settle guard skips only when the view hasn't moved since the last settle, not merely when the end values match: the culling prune needs a settle after a gesture that returns to the same spot. setImage's only caller always passes a fresh blob URL, so its guard rarely fires; the real no-op writes come from clearImage. The view-save gap is logged as B-10. Existing graphStore.test.js failures are pre-existing (F-62).

### P1.10: Fix the pie menu memo dependencies
- **Status:** todo
- **Lane:** A · **Size:** M · **Depends:** P0.03 (flow F6)
- **Findings:** F-08, B-06
- **Change:**
  - In `nodePieMenuPages`, `targetPieMenuButtons` and `edgePieMenuButtons`, remove from the dependency arrays:
    - `panOffset` and `zoomLevel`, which the bodies don't read
    - the lucide icon imports and `clipboardRef`
  - Add `rightPanelExpanded` and `wizardEnabled` (B-06, as its own commit).
  - Where `graphsMap`, `edgesMap` or `nodePrototypesMap` are only used inside `onClick`, read them with `useGraphStore.getState()` at click time and drop them from the deps.
  - Apply the same treatment to the deps of `getContextMenuOptions` and `getCanvasContextMenuOptions`.
- **Don't:** Restructure the pie→state sync effect (~9777) or the pie state machine. That is P5.
- **Accept:**
  - S6 has fewer commits than the baseline.
  - After toggling the right panel or the wizard, the pie buttons reflect the change.
  - F6 passes.
- **Handoff:**

### P1.11: Stable keyboard listener
- **Status:** done (9e4cdfe; report reports/P1.11.md)
- **Lane:** C (`useCanvasKeyboard.js`) · **Size:** S · **Depends:** none (**pre-P0 OK**)
- **Findings:** F-14
- **Change:**
  - The keydown handler reads everything through the hook's existing `paramsRef` (the latest-props pattern), so the listener effect's dependencies shrink to `[]`, plus anything truly structural.
- **Accept:**
  - The listener attaches once per mount. Check with a dev-only counter.
  - F13 passes.
  - Keyboard pan and zoom feel unchanged.
- **Handoff:** The listener attaches once per mount: 4 before, 9 after five re-renders; it stays at 4 now. The orchestrator verified the handler reads no hook params from closure (only paramsRef).

### P1.12: Stop selection from re-solving every label
- **Status:** todo
- **Lane:** A · **Size:** M · **Depends:** P0.04 (to measure); P0.05 (label DOM baselines)
- **Findings:** F-21
- **Change:**
  - **First investigate** why `labelCrossingIndex` and `labelObstacleOptions` depend on `selectedInstanceIds`. For example, selected nodes may render scaled or elevated, which would change the obstacles. Write the answer into F-21.
  - If selection doesn't affect geometry, remove the dependency.
  - If it does, narrow it to the geometry that actually changes, and don't bump `generation` when the rebuilt index is equivalent.
- **Don't:** Change how labels are placed.
- **Accept:**
  - In S7, selecting a node doesn't re-solve every routed label. Verify with the `__edgePerf` or label-solve counters.
  - Label positions for the medium fixture match the pre-change DOM snapshot in every routing style.
- **Handoff:**

### P1.13: Batch of small bug fixes
- **Status:** partial: B-07 done (c7453a4); B-03 blocked on Grant (report reports/P1.13.md)
- **Lane:** A · **Size:** S · **Depends:** none
- **Findings:** B-03, B-07
- **Change:** One commit per bug.
  - **B-03:** Make the `openOnboardingModal` listener do what it intended. Find out which modal it should open. If nothing should open, delete the listener and its dispatchers.
  - **B-07:** Make the `onNavigateDefinition` updaters pure: `prev => { const next = new Map(prev); next.set(k, v); return next; }`. There are three copies.
- **Accept:** Each bug is verified fixed. The smoke test passes.
- **Handoff:** B-03: both 'Show Welcome Screen' menu items (the Help menu and the Electron app menu) have done nothing since the welcome modal was removed in 5d6e650 (Jan). Options: open StorageSetupModal, remove the items (the agent's lean), or wait for a real welcome screen. Grant decides.
