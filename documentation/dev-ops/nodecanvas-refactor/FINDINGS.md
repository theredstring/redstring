# Findings

This file records what the audit found. It is pinned to commit **@1e6ab02** (2026-09-23). `NodeCanvas.jsx` was last changed in 9b5eab1, so its content at 1e6ab02 is the same.

**How to use this file**
- **Tags.** VERIFIED means the code path was read. INFERRED means a rate, sequence or user-visible effect was reasoned about but not measured.
- **Anchors.** Anchors are symbol names; `~NNNN` is a line-number hint, and line numbers drift.
- **Re-verify before acting.** Grep the symbol and read the region before you act on any finding.
- **Resolving a finding.** Strike it through, add `→ resolved in <task> <commit>`, and keep it here for the record.
- **Adding a finding.** Use the next free ID in its section.

Sources: five parallel read-only analyses on 2026-09-23 (re-render triggers, render pipeline, input layer, feature clusters, history and tests). The headline claims were then spot-checked by hand.

---

## Re-render triggers (F-01 – F-19)

**F-01. Dead `panStart` state is set on every drag-pan frame.** VERIFIED (rate INFERRED). **→ resolved in P1.01 (013cfa8). The base cost was actually 2 commits per frame; see F-67**
- `setPanStart` (~2972) writes both `panStartRef` and the `panStart` state.
- It is called inside the drag-pan rAF (~11804) on every frame where the view moves. It is also inside a `setPanOffset` updater, which makes that updater impure.
- The `panStart` state value is never read anywhere; only `panStartRef` is used.
- One-finger touch pan reaches the same path through `useCanvasTouch`, which calls `handleMouseMove`.
- Result: about 60 full NodeCanvas renders per second while drag-panning.
- → P1.01

**F-02. The mouse handlers fire more than once per event.** VERIFIED.
- `handleMouseMove` is bound on the `.canvas-area` div (~16038) *and* on the `<svg>` nested inside it (~16270). Bubbling runs it twice per move.
- `handleMouseUp` runs 2–3 times per release:
  - the window pointerup capture (`useWindowGestureEnd.js:46`)
  - the svg's `onMouseUp`
  - the div's `handleMouseUpCanvas`
- The re-entry guard (~11979) only blocks synchronous re-entry.
- → P1.03 (move), P4.04 (idempotent release)

**F-03. The marquee commits on every mousemove.** VERIFIED.
- Each mousemove does `await canvasWorker.calculateSelection`, then `setSelectionRect` and `setSelectedInstanceIds(new Set)` (~11666–11676).
- The gamepad marquee does the same every frame (~13456).
- The release path re-implements selection without skipping group anchors (~12170), unlike `selectionFromRect` (~10135). → B-01.
- A worker reply that arrives after mouseup can restore the rectangle. → B-02.
- → P1.04

**F-04. Panel resize sets state every frame.** VERIFIED. **→ resolved in P1.05: S9 71 → 17 commits, NodeCanvas runs 65 → 7.** **measured (P0.04): S9, a 300 px drag of the right resizer in 60 moves, renders NodeCanvas 60 times, all `rightPanelWidth`.** `applyResizeUpdate` calls `setLeftPanelWidth`/`setRightPanelWidth` on every rAF during a drag (~1182/1187). `getFramingRegion` depends on these widths. → P1.05, P2.12

**F-05. Hurtle sets state every frame.** VERIFIED. **→ resolved in P1.06 (b235244): S13 went from 35 commits (31 NodeCanvas runs) to 12 (8).** `setHurtleAnimation(prev => ({...prev, …}))` runs on every rAF for the whole ~400 ms flight (~14238). → P1.06

**F-06. Carousel physics drives NodeCanvas state every frame.** VERIFIED; **measured (P0.04): S12 (open, 3 steps, close) is about 200 commits and 155 NodeCanvas renders: `currentPieMenuData` ×69, `carouselFocusedNodeScale` ×53, `carouselFocusedNodeDimensions` ×13.** The worst scenario measured.
- `AbstractionCarousel.jsx` (~745–791) sets `carouselFocusedNodeDimensions`, `Scale` and `Node` in NodeCanvas state every physics frame.
- The pie-data effect then cascades on top of that.
- → P5.04. **Per-frame part fixed** 5f6a10a (P5.04a): S12 NodeCanvas 148 → 18 runs.

**F-07. Whole-collection subscriptions re-render NodeCanvas on writes anywhere in the universe.** VERIFIED. **→ partly: no-op guards landed in P1.09 (2aaa2cf, 4f97ba0); whole-collection subscriptions remain until P3.01**
- **Measured (P0.04):** each write costs one NodeCanvas render plus one render bailout (the body runs a second time and is discarded):
  - S11: 10 `updateGraph` calls on a graph that isn't on screen → 10 renders + 9 bailouts, through the `graphs` subscription.
  - S10a: 20 thumbnails for nodes on screen → 20 renders + about 20 bailouts, through the image cache.
  - Each of those renders also re-renders the right panel's whole content (F-74).
- NodeCanvas subscribes to all of these (~1443–1529):
  - `graphs`, `nodePrototypes`, `edges`, `edgePrototypes`
  - `savedNodeIds`, `openGraphIds`
  - `useImageCache` `images` / `loading` / `failed`
- Immer with `enableMapSet` produces a new Map on every write, and that includes writes to graphs that aren't active.
- `imageCache.setImage` always creates a new `images` object, and `clearImage` has no no-op guard (`imageCache.js` ~36–77). So every thumbnail that lands re-renders the canvas.
- `graphStore.setSelectedEdgeIds` always builds a new Set and `console.log`s (graphStore ~7386). NodeCanvas calls it with `new Set()` even when the selection is already empty (~6363, ~14464, ~18702).
- → P1.08, P1.09, P3.01

**F-08. Opening a pie menu costs about 5–8 commits.** VERIFIED (sequence INFERRED). **→ partly resolved in P1.10: the camera-settle rebuild is gone. The pie → state copy remains until P5.** **Measured (P0.04): opening a pie and clicking it closed (S6) is 30 commits and 19 NodeCanvas runs. `currentPieMenuData` alone is set 5 times; the rest is F-75.**
- `nodePieMenuPages` (~8784, deps ~9112) and `targetPieMenuButtons` (~9115, deps ~9735) depend on:
  - `panOffset` and `zoomLevel`, which neither body reads
  - `graphsMap`, `edgesMap`, `nodes` and `savedNodeIds`
  - 22 lucide icon imports and `clipboardRef`, which are harmless noise
- The effect at ~9777 copies `targetPieMenuButtons` into `currentPieMenuData` state. So every invalidation while a menu is open costs an extra commit.
- The effect at ~13754–13821 behaves the same way on `nodes` and the carousel dimensions.
- → P1.10, P5.01–P5.02

**F-09. Some effects set state unconditionally.** VERIFIED.
- "Graph Change Cleanup" (~7756–7841) sets about 30 states, including a fresh Set and fresh objects.
- The effect at ~7963–7978 does the same on `activeGraphId`.
- The effect at ~8011 gives `setLastSelectedNodePrototypes` a fresh array whenever `nodes` changes during a selection.
- **The anchor-flush effect has no dependency array** (~4835–4869):
  - It runs after every commit.
  - If any group anchor has drifted by more than 1 px, it writes positions to the store. That adds a render and a history/save write.
- → P3.03, P5.02

**F-10. Hover re-renders the whole canvas.** VERIFIED.
- After the 180 ms dwell, `applyHoverCandidate`/`commitHoverTarget` (~6747–6848) set `hoveredNodeForVision`/`hoveredEdgeInfo`. That re-renders all of NodeCanvas, including every edge.
- Hovering a pie, header or panel button sets vision state with no dwell: 2 commits per button.
- → P2.13, P3.06

**F-11. Settling a gesture always renders.** VERIFIED. **→ partly: settles with no movement skipped in P1.09 (f85a6f5); settle still renders NodeCanvas until P3.10**
- `useCanvasTransform` sets a fresh `setSettledPan({...})` object on every settle (`useCanvasTransform.js` ~252–267).
- The culling prune pass (~4812) may add one more commit.
- → P1.09, P3.10, P3.11

**F-12. Deletion ghosts cost one full render each.** VERIFIED. Each ghost's `animationend` calls `setDeletionAnimations(filter)` (~17538), so deleting N nodes costs N renders. → P2.07

**F-13. Children that are always mounted and not memoized re-render on every NodeCanvas render.** VERIFIED.
- Header, TypeList, NodeControlPanel, UnifiedBottomControlPanel, ConnectionControlPanel, AbstractionControlPanel, PieMenu, AbstractionCarousel, and ColorPicker ×3.
- SettingsModal (54 store subscriptions), HelpModal, MergeThingsModal, StorageSetupModal and GitReconnectModal.
- Panel has a custom memo comparator (see F-50).
- → P2. **Header done** (P2.08: one-prop `HeaderHost`, 0 commits in S1/S5/S7). **Panels done** (P2.09: `PanelHost`, plain memo, 0 commits in S1/S4/S5/S7). **TypeList done** (P2.10: no props, `TypeListHost`, 0 commits in S1/S4/S5/S7).

**F-14. The keyboard listener is torn down and re-added on every render.** VERIFIED. **→ resolved in P1.11 (9e4cdfe)**
- The `useCanvasKeyboard` keydown effect has about 22 dependencies (`useCanvasKeyboard.js` ~784).
- One of them is `deleteMultipleNodesWithAnimation`, a plain arrow function in NodeCanvas (~6946), so its identity changes every render.
- → P1.11

**F-15. Not triggers (good news).** VERIFIED.
- Typing in the right panel's name or description keeps a local draft and commits only on blur or Enter (`SharedPanelContent.jsx` ~1356, ~1427).
- SaveCoordinator and git sync never write to graphStore.
- The exceptions are canvas-side editors:
  - On-canvas node rename writes to the store on every keystroke (`Node.jsx` ~175 → `handleCommitCanvasEdit` ~13602).
  - Group rename and the name prompts keep their drafts in NodeCanvas state.
- → P3.08, P5.06

---

## Render cost (F-20 – F-39)

**F-20. `nodes` is always a new array.** VERIFIED. **→ resolved in P1.08 (1247e9b). Also found: the per-node reuse check never matched for nodes without an image (`undefined` vs `null` `thumbnailSrc`), so those were rebuilt on every recompute; fixed.**
- The `nodes` memo (~2005) reuses element objects through `prevNodesRef`, but it always returns a new `result` array (~2100).
- So `nodeById`, `baseDimsById`, `cleanLaneOffsets`, `lombardiTangents`, `labelCrossingIndex`, the culling effect and `edgeRenderCtx` all invalidate on *any* write to instances, prototypes or images.
- `hydratedNodes` (~1633) is a second O(N) hydration of the same data, with no object reuse.
- → P1.08

**F-21. Selecting a node re-solves every connection label.** VERIFIED. **→ resolved in P1.12b (d8f9e53): selection re-solves only labels whose own route changed.**
- `labelCrossingIndex` (~5119) lists `selectedInstanceIds` among its dependencies.
- Each rebuild bumps `index.generation` (`labelCrossingGenerationRef`), and that value is part of every label's cache signature (`renderConnectionEdge.jsx` ~1444).
- Every routed label therefore goes back through `chooseRoutedLabelPlacement`.
- `labelObstacleOptions` (~5208) also depends on the selection and on `visibleNodeIds`.
- **Why (answered in P1.12a):** a selected node's hitbox grows by the 6 px selection stroke (`getNodeHitbox(node, dims, isSelected)`).
  - The drawn connection ends at that bigger box.
  - `occluderFor` trims the indexed polylines the same way, so that labels only dodge what's drawn.
  - So selection really does change the geometry, by 6 px at one end of the selected node's own connections.
- In the label fixture, that moves 2 labels (clean) or 1 (lombardi) when the hub is selected, and none in manhattan.
- **Every other label that moves on select moves because of F-72**, not because of geometry.
- → P1.12b: V1 + V2 in reports/P1.12a.md. It stops labels shifting on select, which Grant OK'd (D-18).

**F-22. Groups are laid out again on every render, inside JSX.** VERIFIED.
- The groups IIFE (~16365–17066) does a `hydratedNodes.filter` per group, which is O(groups × nodes).
- It calls `computeGroupLayout` with a fresh `_cache: new Map()`.
- Each title gets about 10 inline handlers, including a large `onTouchStart` that attaches document listeners.
- → P3.03, P3.04

**F-23. Edges have no memo boundary.** VERIFIED.
- `renderConnectionEdge` (`src/components/canvas/renderConnectionEdge.jsx`, about 1,985 lines) is called as a plain function for every visible edge on every render (~17342).
- `edgeRenderCtx` (~17206) is a 56-field inline object literal.
- The EDGE ELEMENT CACHE (~6580) and the IMPERATIVE EDGE PAINTER (~6600, `paintElementTree.js`) are **both off by default**, behind `window.__edgeCache` and `window.__edgePainter`. The step to measure them and then turn them on never happened.
- The cache key includes:
  - three handler callbacks that are rebuilt from `visibleEdges` and `selectedEdgeIds`
  - `selectedInstanceIds`, `labelObstacleOptions` and `draggingNodeInfo`
- So the cache misses on select, settle and drag; only hover would hit.
- Label placement depends on order through `placedLabelsRef`, so a cache hit changes which labels the later ones dodge.
- The painter still calls `renderConnectionEdge` for every edge. It also attaches native listeners, which changes event semantics.
- → P3.05–P3.07, D-06

**F-24. Node handlers are frozen by the memo comparator.** VERIFIED.
- `<Node>`'s memo comparator (`Node.jsx` ~897) deliberately ignores function props.
- `renderNodeElement` (~17436) passes 16 inline closures per node. The prop block is duplicated three times (~17445, ~17873, ~17970).
- The memo does bail out correctly for unchanged nodes. But their handlers stay as they were at the node's last real render, which produces stale closures (B-05).
- Each Node also has 7 store subscriptions of its own.
- → P3.02, P3.08

**F-25. The render phase has side effects.**
- These block splitting into memoized components, are unsafe under concurrent rendering, and run twice in development because StrictMode is on.
- **Groups IIFE:** writes `groupTitleRectsRef`, `anchorPositionUpdatesRef`, `nodeGroupBackgroundsByDepthRef`, `nodeGroupTitlesRef` (which holds JSX), `thingGroupMemberIdsRef`, `anchorInstanceIdsRef` and `nestedRegularGroupsByDepthRef`.
  - The edges and nodes passes read these later **in the same render**, so the passes depend on their order.
- **`renderConnectionEdge`:** writes `connectionOrbHitsRef`, `placedLabelsRef`, `labelTruncationRef`, and a module-level stabilisation map (`labelStabilization.js`), and schedules sprite bakes.
- **Memos:** `prevNodesRef`, `dimensionCacheRef` and `labelCrossingGenerationRef` are written inside memos.
- → P3.03, P3.05

**F-26. Debug work runs during render.** VERIFIED. **→ resolved in P1.07 (d26dc7a)**
- `debugLogSync(...)` (~17134) **POSTs to a local debug server during render** whenever parallel edge pairs exist, with a cooldown after a failure (`debugLogger.js` ~182–215).
- `edgePairGroupsDebug` does a sort+join per edge on every render.
- An `ArrowheadAudit` loop over the visible edges `console.warn`s (~17138).
- `DIAGNOSE_ZOOM_FLICKER = true` (~847), labelled "TEMPORARY", still gates `console.warn` blocks (~1557, ~2092), and its plan file no longer exists.
- → P1.07

**F-27. PieMenu listeners churn on every render.** VERIFIED.
- PieMenu is not memoized.
- The inline `onExitAnimationComplete` (~17577, about 90 lines) is recreated on every render. It sits in the deps of PieMenu's `handleAnimationEnd` and listener effect (`PieMenu.jsx` ~230, ~259).
- So every NodeCanvas render removes and re-adds the `animationend` listeners while a menu is mounted.
- → P5.03

**F-28. StrictMode doubles development renders.** VERIFIED. StrictMode is on (`main.jsx:49`), so measure performance on a profiling production build. → P0.01

---

## Structure and coupling (F-40 – F-59)

**F-40. NodeCanvas is the app shell.** VERIFIED.
- Counts at @1e6ab02:
  - 124 `useState`, 203 `useRef`, 158 `useEffect`, 5 `useLayoutEffect`
  - 147 `useCallback`, 31 `useMemo`
  - about 70 store selectors and 114 imports
- The hook body runs 823–15764; the JSX return runs ~15765–19253.
- About 4,383 lines start with `//`.

**F-41. Extracted hooks are seams, not boundaries.** VERIFIED.

| Hook | Parameters at the call site | Notes |
|---|---|---|
| `useNodeDrag` | 42 | 29 are refs; about 20 are mirror refs NodeCanvas maintains only to feed it |
| `useCanvasTouch` | 73 | includes NodeCanvas's own mouse handlers; 4 unused, 2 dead |
| `useCanvasKeyboard` | 48 | |
| `useGamepad` | 42 | |
| `useGraphLayout` | 32 | |

- Most commits since each extraction still touched NodeCanvas: `useNodeDrag` 58 of 71, touch 31 of 36, keyboard 25 of 33, transform 15 of 15.
- **`useGamepad`'s control-object pattern is the cleanest boundary.** It uses refs plus imperative control objects (`plusSignControlRef`, `marqueeControlRef`, …). Use it as the template.

**F-42. `useCanvasTouch` is an adapter onto the mouse path.** VERIFIED.
- It turns touch into synthetic `handleMouseDown`/`Move`/`Up` calls.
- It co-owns 8 gesture refs: `isMouseDown`, `mouseMoved`, `startedOnNode`, `mouseInsideNode`, `mouseDownPosition`, `ignoreCanvasClick`, `suppressNextMouseDownRef` and `isPanningOrZooming`.
- Its own `longPressingInstanceIdRef` shadows `useNodeDrag`'s.
- `isPanningOrZooming` is written in about 34 places across NodeCanvas, the keyboard hook and the touch hook.

**F-43. The input code duplicates the same logic many times.** VERIFIED.
- Pan clamp: 15 copies in NodeCanvas, plus 2 in keyboard and 2 in `useNodeDrag`.
- Client-to-canvas conversion: 16 inline copies, even though `clientToCanvasCoordinates` (~3754) exists. There are 35 `getBoundingClientRect` calls in total.
- Zoom about an anchor: 5 copies.
- The momentum-loop skeleton: 3 copies.
- Camera writes: 4 different paths.
- Edge selection toggle: 4 copies.
- Plus-sign spawn/dismiss: 3 copies, and they have drifted apart. The touch dismiss protects fewer modes than the others.
- Press, long-press and double-press detection: 3 copies each.

**F-44. `useCanvasTouch`'s constants don't match NodeCanvas's.** VERIFIED. Nobody knows which values are intended; this is question Q5.

| Constant | `useCanvasTouch` | NodeCanvas |
|---|---|---|
| Zoom limits | `MIN_ZOOM` 0.1, `MAX_ZOOM` 4 | viewport-derived minimum, maximum 1000 |
| `MOVEMENT_THRESHOLD` | 6 | 3 |
| `TOUCH_MOVEMENT_THRESHOLD` | 12 | 10 |

**F-45. The trackpad pan-glide branches can never run.** VERIFIED.
- `'trackpad'` is never assigned as a pan source, so the branches at ~3509, ~12203, ~12209 and ~12246 are unreachable.
- The trackpad glide setting probably does nothing (INFERRED).
- → P4.02, which needs a behaviour decision from Grant.

**F-46. Middle-mouse zoom still uses the worker.** VERIFIED.
- It still calls `canvasWorker.calculateZoom` (~11539).
- The wheel path removed that call because it caused correctness problems (comment ~11090–11107).
- → P4.02

**F-47. There is a shared spine of UI state.**
This state is used across clusters and must move to a store before the clusters can leave NodeCanvas. It is listed in priority order, and verified by reference counts.
1. `selectedInstanceIds`: 84 references, 43 setter call sites. Edge selection already lives in graphStore.
2. `selectedGroup` / `lastSelectedGroup`, which are object snapshots. Store the id and derive the object.
3. `selectedNodeIdForPieMenu` (48 references) and the `isTransitioningPieMenu` latch (23).
4. `previewingNodeId`: 53 references, including Node sizing and hit testing.
5. `nodeDefinitionIndices`, read by Node, both Panels, the pie menu and the decompose panel.
6. Mode flags: the carousel's visible / node / animation-state / just-exited flags (68 references to the visible flag), and `semanticOrbitActive`.
7. Which prompts and modals are open: 5 prompts, `newWebPrompt`, the header searches and the `show*` flags.
8. Text-entry focus: `isHeaderEditing`, `isLeftPanelInputFocused` and `isRightPanelInputFocused`, which feed only keyboard suppression.
9. Left-panel view: `leftPanelInitialView` plus 6 call sites of the imperative `leftPanelRef.setActiveView`.
10. Panel widths, which are tracked three times: NodeCanvas, `useViewportBounds` and Panel.
11. The hover chip for the vision aid (`handlePieMenuHoverChange`, passed to Header, the panels and the pie menus).
12. `trackpadZoomEnabled`, set by Header and read by the input handlers.
13. Gamepad focus outputs: mode, pie focus index, and the header-focused graph id.
14. A read-only "canvas busy" and viewport snapshot for overlays: `draggingNodeInfo`, `drawingConnectionFrom`, `isPanning`, `selectionRect`, `plusSign`, and the settled pan/zoom.
15. `clipboardVersion`.
16. Canvas **commands** (not state): navigate, auto-layout, snap, condense, focus node, hurtle, and deletion ghosts.
- → P2

**F-48. Feature clusters and how easily each can be extracted.** See MAP.md.
- **A (can leave now):** sync debug; Help, Settings, Merge and AutoGraph modals; the universe loading / onboarding / git host; header searches and New Web; header file operations; hurtle; deletion ghosts.
- **B (needs the spine store first):** Header, Panels, TypeList, colour pickers, wizard, the connection / node-group / swap prompts, the group and connection panels, BackToCivilization, orbit.
- **C (deeply tangled):** pie menu + abstraction carousel + abstraction prompt, which form one state machine; the node-name prompt together with the plus sign.

**F-49. What drives the regrowth.** VERIFIED from git history.
- 252 commits touched NodeCanvas between 2026-06-23 and 2026-09-23.
- The top additions were input modes (trackpad glide, gamepad, mobile/touch, keyboard pan) and menus/overlays (pie pages, edge pie, carousel). Their state only exists inside NodeCanvas, so they got added there.
- About 69% of the last three months' net growth was comments: comment lines went from 1,663 to 4,787.
- The extracted hooks kept growing after they left (`useNodeDrag` 989 → 3,133 lines).
- Size history: 10,986 (2025-10-23) → 12,389 (2026-04) → 20,519 at the peak (2026-09-09) → 19,255.

**F-50. Panel's memo comparator skips things it should compare.** VERIFIED (effect INFERRED).
- The comparator (`Panel.jsx` ~431–467) ignores callbacks and `nodeDefinitionIndices`, so it can show stale definition indices.
- `PanelContentWrapper` never calls `onFocusChange`, so `isLeft/RightPanelInputFocused` are always false.
- → P2.04
- **Resolved.** Definition indices: Panel and `PanelContentWrapper` read them from `canvasUIStore` (P2.03; B-08, B-11). Focus: the plumbing is deleted (P2.04, D-19). The comparator still ignores callbacks, which is B-05's territory (P3.02).

---

## Safety net and measurement (F-60 – F-69)

**F-60. The smoke test only checks that things render.** VERIFIED.
- `NodeCanvas.smoke.test.jsx` has 7 tests.
- It fires no events and forces culling off.
- It covers one routing style, with no groups, self-loops or sprites.
- It asserts 4 of the roughly 20 DOM selectors that `useNodeDrag` queries.

**F-61. No interaction is tested.** VERIFIED.
- There are no browser or end-to-end tests for the canvas.
- Nothing covers:
  - `useNodeDrag` and `useCanvasKeyboard`
  - wheel and trackpad zoom
  - the mouse handlers, the marquee, and connection drawing
  - drag-and-drop from the panels
  - pie menus, the carousel, control panels, context menus, the plus sign, prompts and hurtle
  - group drag and group titles, the clipboard, and `runCulling`
  - the gamepad as it is wired into NodeCanvas

**F-62. CI is not running tests.** VERIFIED.
- `.github/workflows/ci.yml` last ran on 2026-01-16, and those runs failed.
- Only Build/Release is active, and the release workflow has no test step.
- About 67 tests were already failing according to 4dfb1e1's commit message. Today's count is unconfirmed.

**F-63. Nothing measures a full render, and the 143 ms figure is stale.** VERIFIED. **→ resolved in P0.04: `npm run perf:canvas` (S1–S13, profile build, median of 5; baseline in METRICS.md) and `--explain` (F-73).** On chambers, NodeCanvas's longest single commit in any scenario is now about 13 ms (28 ms on the 600-node stress graph), not 143.
- Existing probes: `window.__zoomPerf`, `__edgePerf`, `__edgeCacheStats` and `__spritePerf`, plus `window.__diag` (`canvasDiagnostics.js`).
- Missing: a React Profiler, `performance.mark`, a render counter, and a benchmark script.
- **The "143 ms per render" figure is stale.** It is quoted at ~738, ~3949, ~5241, `useCanvasTransform.js:19/129` and `renderConnectionEdge.jsx:30`. It was measured around 2026-08-07 with culling **off**, before label sprites were added.

**F-64. A near-wipe of the file went unnoticed.** VERIFIED.
- A "whitespace cleanup" commit (e16564c, 2025-12-07) cut NodeCanvas to 4,104 lines.
- It was restored three days later under an unrelated message (eeac4ea). Nothing caught it.
- → P0.06, P0.07

**F-65. Leads for building the harness.** VERIFIED.
- `window.useGraphStore` is exposed (`App.jsx:17`).
- `graphStore.loadUniverseFromFile(data)` (~7895) loads a universe.
- `?test=true` isolates storage but still shows onboarding (`documentation/dev-ops/TESTING_ONBOARDING.md`).
- The smoke test shows how to keep `WorkspaceService.initialize` inert.
- `window.__diag` already exists for DOM and frame audits.

**F-66. What a real universe looks like.** VERIFIED on 2026-09-23 against "Claude's Chambers", Grant's largest universe.
- Size: 7.2 MB, 197 graphs, 1,913 prototypes, 1,266 instances in total.
- **The largest graph has only 54 instances.** The top graphs, as instances / edges / groups:
  - 54 / 6 / 13
  - 54 / 40 / 13
  - 37 / 49 / 0
  - 36 / 51 / 6
- No graph has 100 or more instances.
- Implication: in real use the slowness isn't caused by huge graphs. It comes from **breadth**:
  - whole-universe subscriptions: F-07 across 197 graphs and 1,913 prototypes
  - the shell re-rendering (F-13)
  - labels and groups being recomputed (F-21, F-22)
- Consequences for measurement:
  - Weight S10b, S11, S6 and S7 heavily.
  - Use the synthetic stress fixture only to find scaling cliffs, not to represent real use.

**F-67. Measured baseline for drag-pan (wave 1).** VERIFIED.
- In jsdom (Profiler): mouse and one-finger drag-pan cost **2 commits per frame** on the base (`panStart` + a repeated `setHasMouseMovedSinceDown(true)`), i.e. 60 commits per 30 moves. After P1.01: 0.
- In headless Chromium: one pan gesture on the base was **126 NodeCanvas commits** (P0.01 probe, cross-checked against an independent counter).

**F-68. Process hazards found running wave 1.** VERIFIED.
- Agent worktrees were created at `b5444cc`, several commits behind `main`, not at `main`'s HEAD. Agents had to fast-forward themselves. Always check the base (`git merge-base --is-ancestor main HEAD`) before starting work.
- A Vite dev or preview server run from a worktree whose `node_modules` is symlinked to the main checkout writes into the main checkout's `node_modules/.vite` cache, which Grant's dev server shares. vitest and `vite build` are fine.

**F-69. Pre-existing test failures (confirms F-62).** VERIFIED on f1f07dd.
- 67 failing tests in 15 files, identical before and after wave 1:
  - App.test, groupMembership, grouplessRemainder, semanticSystem
  - wizard expandGraph and replaceEdges
  - OrbitOverlay, UniverseManager, formats consistency
  - SaveCoordinator (18), gitNativeProvider (11), rdfResolver
  - graphStore (11, stale tests for an old API), tools-health, edgeLabelPlacement (2)
- **Superseded by P0.06:** `test/known-failures.json` is now the list, and `npm run test:ci` does the compare.

**F-71. Latent ReferenceErrors in src/ (P0.06 report).** VERIFIED (ESLint no-undef).
- These names don't exist in their file, so each call throws the first time its path runs:
  - `setShowAPIKeySetup` ×4 (`LeftAIView.jsx`)
  - `minOccurrences` ×4 (`mcpProvider.js`)
  - `persistentAuth` (`backend/auth/index.js`)
  - `file` (`UniverseManager.jsx` ~3165)
  - `edgeId` (`PanelContentWrapper.jsx` ~476)
  - `fileName` (`fileHandlePersistence.js` ~241)
  - `layoutMode` (`roleRunners.js` ~1304)
  - `findEntitiesInSameCategories` (`semanticWebQuery.js` ~1612)
  - `theme` and `clearTabularData` (`toolResultApplier.js`)
  - `setShowOnboardingModal` (NodeCanvas, B-03)
- The remaining entries (`process`, `Buffer`, `require`) are Node-only files linted as browser code.
- All of them are in `test/known-undefined-names.json`. `npm run lint:undef` fails on any new one.
- Outside the refactor's scope, but worth fixing before 1.0. Prune the baseline with each fix.

**F-70. P2 kickoff research (P2.01 report).** VERIFIED at b2314ce.
- **MCP bridge:** reads **no** spine field, selection included. The wizard only *writes* selection, via the `rs-select-node` window event (~14911). That listener must keep working after P2.02.
- **Edge selection** (`selectedEdgeId(s)` in graphStore) should move to canvasUIStore in P2.03:
  - It isn't serialised or saved.
  - Each write currently runs the save middleware and schedules a whole-universe clone and hash about 500 ms later.
  - `removeEdge` clears `selectedEdgeId` but never cleans `selectedEdgeIds`. The move must handle both.
- **Timing risk.** Zustand notifies synchronously, while `useState` outside React event handlers renders later. A callback that writes both kinds renders twice, and the first render sees half the change.
  - **Worst case is P2.03:** PieMenu `onExitAnimationComplete` (~16845) can flash the old menu. Move the pie render state together with the pie target, or use `flushSync`.
  - **Graph Change Cleanup (~7646)** relies on selection landing in the same render.
- **Equality semantics.** canvasUIStore skips equal writes, including an equal Set. Any effect that re-fired on a new-but-equal selection Set will stop re-firing. Audit this in P2.02.
- **F-47 count corrections:**
  - `setActiveView` has 7 call sites, not 6.
  - "43 setter call sites" is 43 references, of which 29 are calls.
  - The prompt counts dropped after wave 1.

**F-72. Connection-label placement is path-dependent (P1.12a).** VERIFIED in jsdom on the label fixture.
- Re-solving identical geometry moves labels. A no-op write (the `edges` Map replaced by an identical copy) re-solves every label:
  - The 1st re-solve after mount moves 2 of 16 labels (manhattan) or 5 (clean).
  - The 2nd moves 0 (manhattan) or 1 more (clean).
  - Lombardi doesn't move.
- Cause: placement has hysteresis (`labelStabilization`), and the solve at mount has nothing to be sticky against.
- In the app, any edge write anywhere replaces `edges` (F-07), so labels can shift on an edit somewhere else in the universe.
- It also makes every selection reshuffle labels, which is most of what selection "moves" (F-21).
- → P1.12b's V1 (no rebuild when the polylines are unchanged) removes the no-op re-solves. Whether the hysteresis itself should change is outside the refactor: raise it with Grant.

**F-73. "NodeCanvas commits" are not NodeCanvas renders (P0.04).** VERIFIED.
- The probe counts every commit under `<Profiler id="NodeCanvas">`, including commits in which only a child rendered (the pie's animation, the panel).
- `perf:canvas` therefore reports three numbers:
  - commits
  - how often the NodeCanvas function **ran**
  - how many of those runs **rendered** (the rest are bailouts: the whole body ran and React discarded it)

  Counted from the fiber after each commit, with no app code; equal to a counter in the function body on 8 scenarios.
- **`npm run perf:canvas -- --explain S6`** prints each commit of a scenario. For each one it shows which NodeCanvas state or store hook changed (state hooks by name) and which children rendered. Use it to see what a card has to fix, and afterwards what it did fix.

**F-74. In a real universe, children multiply every NodeCanvas render (P0.04).** VERIFIED on chambers with `--explain`.
- **Every NodeCanvas render** re-renders the Header's **145 `HeaderGraphTab`s** (chambers has 145 open graphs) and 35 `EdgeType` chips.
- **Every selection change and every `graphs` write** also re-renders the right panel's whole content: about 270 `LazySection`, 270 `ChevronRight` and 270 `StandardDivider`. A `graphs` write also re-renders the left panel's 51 `DraggableNodeComponent`s.
- So one NodeCanvas render in real use is several hundred component renders. F-13 (unmemoized shell) and F-50 (Panel's comparator) are where this comes from.
- → P2 (the shell leaves NodeCanvas; Header tabs and Panel get their own subscriptions).
- **Header, Panels and TypeList resolved:** P2.10 (TypeList and its 35 `EdgeType`s: 0 commits; S5 total render ms 103 → 59), P2.08 (Header 0 commits per NodeCanvas render) and P2.09 (Panels 0 commits in S1/S4/S5/S7; Panel no longer subscribes to `graphs`).

**F-75. What a pie open and close actually renders (S6, 19 NodeCanvas runs) (P0.04).** VERIFIED with `--explain`.

| Step | NodeCanvas runs | What changes |
|---|---|---|
| Press and release on the node | 2 | `longPressingInstanceId` set on **every** press, cleared on release (~10568), even for a plain click |
| Selection lands | 2 | `selectedInstanceIds`, then an effect sets `selectedNodeIdForPieMenu`, `lastSelectedNodePrototypes`, `lastSingleSelectedInstanceId` |
| Pie shows | 1 | `isPieMenuRendered` + `currentPieMenuData` (F-08's copy into state) |
| Hover vision | 1 | `hoveredNodeForVision` |
| Framing animation settles | 4 | `settledPan`/`settledZoom`, then `currentPieMenuData` again (F-08), culling (`visibleNodeIds`, `visibleEdges`), `labelSpriteVersion` |
| Click on empty canvas | 2 | `isPanning` true then false (~11594): set on every canvas press, before any movement |
| Deselect | 4 | `selectedInstanceIds`, then `currentPieMenuData` twice with the pie target cleared, plus 1 bailout |
| Pie exit | 3 | `labelSpriteVersion`, `isPieMenuRendered` false, plus 1 bailout |

- The avoidable ones: the press/pan flags (4 runs per click-select-click-off), the selection cascade (1 each way) and `currentPieMenuData` (5).
- → P1.10 (pie data), P2 (selection cascade into canvasUIStore), P4.02–P4.04 (press and pan state into the gesture controller, as refs until something needs to draw).

**F-79. A same-value set still re-ran NodeCanvas: half of S5's runs (bailout sweep).** VERIFIED with `--explain` (dispatch logging, 35319ed); **fixed** e0abe3c.
- zustand store changes render at SyncLane. A `setX(sameValue)` in the same event or in a following effect can't take React's eager bailout (the fiber just rendered from an update), so it's queued at a lower lane. The sync render skips it, and React then runs NodeCanvas again only to find nothing changed.
- The offenders: `hoveredEdgeInfo = null` on every mouse move; the orbit, pie colour-picker, pie-page and control-panel resets in selection/pie effects; `isPanning = false` on every release.
- **Rule for new code:** state that an effect or handler resets unconditionally should use `useTrackedState` (`src/hooks/useTrackedState.js`), or guard on the last *requested* value. Not on the committed one: a pending lower-lane set would land after a skipped reset.

**F-78. Every modal re-rendered on every store write (P3.01).** VERIFIED with `--explain S11`; **fixed** bda014c.
- `CanvasModal` (the frame of help, settings, merge, reconnect and storage setup), `PanelModal` and `ConnectionBrowser` called `useGraphStore()` with no selector, which subscribes to the entire store. All five CanvasModals, open or closed, re-rendered on every write anywhere.
- They now subscribe to the three (four) fields they read. S11: 12 commits → 2 (Header's Undo turning on).
- `--explain` now names components rendered anywhere in the tree (ce1342e), not just under NodeCanvas.

**F-77. The render-budget marquee test failed about one full run in two (P2.06b).** VERIFIED; **fixed** 3d10fbb.
- NodeCanvas sets `isInitialLoadComplete` on a real 2 s timer after mount. The test never let it fire, so under the loaded full suite it landed in the marquee's hold window ("expected 1 to be +0").
- The test's settle step now waits 2.1 s. Any new render-budget test should settle the same way.

**F-76. The hidden wizard view re-rendered every 3 s (P2.09).** VERIFIED with `--explain S1`; **fixed** aa07e76.
- LeftAIView stays mounted while hidden (to keep wizard sessions). It polled `fileStorage.getFileStatus()` every 3 s into state that nothing read; the call returns a new object each time.
- So the left Panel committed every 3 s for as long as the app was open. That was the only left-panel activity left in S1 after P2.09.

---

## Bugs found along the way (B-)

Fix each bug in its own commit with its B-ID. **Re-verify it first.**

| ID | Bug | Status | Fix in |
|---|---|---|---|
| B-01 | A mouse marquee release selects group-anchor instances: the release path (~12170) skips the anchor filter that `selectionFromRect` applies | **FIXED** 8702ad2 (P1.04). F4's B-01 flow passes as a normal test | done |
| B-02 | A marquee worker reply that arrives after mouseup can restore a selection rectangle that was just cleared | **FIXED** ea34291 (P1.04): the worker round trip is gone | done |
| B-03 | The `openOnboardingModal` listener calls `setShowOnboardingModal` (~2748), which is never defined. The error is swallowed, so the event does nothing | VERIFIED; **decided (D-17)**: restore a welcome screen as an App-level host, then point the listener at it | P1.13 |
| B-04 | `startHurtleAnimationFromPanel` reads zoom from `svg.style.transform` (~14387), but the transform is now an attribute on the inner `<g>`. So zoom reads as 1 and the orb is always 30 px. `startHurtleAnimation` also uses `canvasSize` without listing it as a dependency (~14365) | **FIXED** 0d85cb7 (P1.06): reads `zoomLevelRef`; `canvasSize` listed. F16 checks the orb's size against the zoom | done |
| B-05 | Node handlers are stale. Node's comparator ignores functions, and `handleNodeMouseDown` (~10788) reads `isPaused`, `middleMouseZoomEnabled`, `rightPanelExpanded` and `nodeLiftDelay` from render scope. For example, after collapsing the right panel, double-clicking a node that hasn't re-rendered may not re-open it. `touch.handleNode*` has the same problem | **FIXED** (P3.02): Node handlers read the latest render through `useLatestRef`; F12 passes without `test.fail()` | done |
| B-06 | `nodePieMenuPages` / `targetPieMenuButtons` read `rightPanelExpanded` (~8889, ~8929) and `wizardEnabled` (~9048, ~9419) but don't list them as dependencies, so the pie buttons go stale | **FIXED** 98a6326 (P1.10). F6b fails without the fix | done |
| B-07 | `onNavigateDefinition` mutates the previous Map inside its state updater (`new Map(prev.set(…))`, ~17509, ~17944, ~18041). That updater is impure | **FIXED** c7453a4 | P1.13 |
| B-08 | Panel can render stale `nodeDefinitionIndices`, because its comparator ignores them (F-50) | **FIXED** 144d898 (P2.03): Panel reads the store; the prop is gone | done |
| B-09 | A self-loop's arrowhead draws at about 80% size during a node drag, then snaps back on drop: `useNodeDrag.js` ~1015 drops `scale(connectionWidth)` (found by P0.05) | **FIXED** 2c9a1e7 (P0.03b). Measured in the browser at 0.80× mid-drag before the fix, 1.00× after. F1b guards it | done |
| B-10 | After a pinch or drag-pan ends with the finger held still, the final camera isn't saved until the next move. The view-save effect (~9859) drops saves during gestures and has no retry of its own (found by P1.09) | VERIFIED code, INFERRED effect | P3.10 / P4.02 |
| B-11 | `PanelContentWrapper` read `nodeDefinitionIndices` from graphStore, which has no such field, so a node's Components list always showed its first definition (found by P2.03) | **FIXED** 144d898 (P2.03): reads `canvasUIStore`. F17 fails without the fix | done |
| B-12 | View → Snap to Grid and View → Grid → Lattice / Dot did nothing: RedstringMenu takes `onSnapToGrid`, `gridAppearance`, `onSetGridAppearance`, but Header never accepted or forwarded them (since 1eca3a8), so Lattice always showed the checkmark (found by P2.08) | **FIXED** 90120ef (P2.08). F19c fails without the fix | done |
| B-13 | Clicking a type in the TypeList with nodes selected typed nothing: selection holds instance ids, `setNodeType` takes a prototype id, so every call warned "prototype not found" (since the initial release; found by P2.10) | **FIXED** 391a992 (P2.10). F21 fails without the fix | done |
| B-14 | The group control panel showed the selected group as a snapshot taken at selection time, so a rename or recolor made elsewhere left it stale (found by P2.03b) | **FIXED** (P2.03b): the group is derived from `selectedGroupId`. F27 fails on the old code | done |
| B-15 | `useViewportBounds` fell back to a 280 px panel width while panels open at 250, so on a fresh profile the save pill, edge glows and modals placed off the viewport bounds sat 30 px off (found by P2.12) | **FIXED** (P2.12): one width source in canvasUIStore | done |
| B-16 | Semantic concepts added to a web were **unsaved**: `addNodePrototype` saves a new prototype, and the orbit placement, canvas drop and discovery-panel add then toggled it (meaning to save) | **FIXED** 0e03477: save only if not saved; `orbitActions.test.js` | sweep 4 |

---

## Dead code (X-)

**Before deleting any item, re-verify it has no references.**
- A plain `\b` grep misses setters: `setFooBar` does not match `\bfooBar\b`.
- Also check `src/hooks/*.js`.

| ID | Item | Delete in |
|---|---|---|
| X-01 | State that is never read: `panStart` (P1.01), `hasMouseMovedSinceDown`, `middleZoomAnchor`, `lastInteractionType`, `recentlyPanned` (its setter is never called; about 9 guards test it), `isPaused` (`setIsPaused` is never called), `autoLayoutRunning` (never set to true), `nodeSelectionGrid` (written but never rendered) | **deleted** in P1.02 (560a08e, ddbc5fe, 739c464) |
| X-02 | Functions that are never called: `animatePinchSmoothing` / `startPinchSmoothing` / `stopPinchSmoothing` (~9894–10092; keep the `lastFrameTime` the touch hook reads); `renderConnectionNamePrompt` (~12943); `renderCustomPrompt` (~13065) and the things only it uses (`handleDialogColorPickerOpen`, `handlePromptSubmit`, `handleNodeSelectionGridClose`, `dialogContainerRef`); `isNearEdge`; `handleEdgeClick`; `handleEdgeMouseEnter` / `Leave`; `schedulePositionUpdate` / `flushPositionUpdates`; `nodesVisibleInStrictViewport` (~15275), which still walks every node on every settle | **deleted** in P1.02 (560a08e, ddbc5fe, 739c464) |
| X-03 | Imports that are never used: `useNodeActions` (line 149) and `NodeSelectionGrid` | **deleted** in P1.02 (560a08e, ddbc5fe, 739c464) |
| X-04 | `useCanvasTouch` parameters: `panOffset`, `zoomLevel`, `setZoomLevel` and `setPanOffset` are unused; `recentlyPanned` and `setLastInteractionType` are dead | **deleted** in P1.02 (560a08e, ddbc5fe, 739c464) |
| X-05 | The right Panel's `ref={panelRef}` is never read (~8583) | **deleted** in P2.09 (2908e9d), with Panel's `forwardRef` and `openNodeTab` handle |
| X-06 | Dead refs and constants: `lastHoverCheckRef`, `isKeyboardZooming`, `resizeTimeoutRef`, `prevZoomForWatchdog`, and the constants at ~469–471 (`MOUSE_WHEEL_ZOOM_SENSITIVITY`, …) | **deleted** in P1.02 (560a08e, ddbc5fe, 739c464) |
| X-07 | ~~Hook params that are now always empty after P1.02: `isPaused` in `useCanvasKeyboard`, `isPausedRef` in `useGamepad`; two dead animation cancels in `useNodeDrag`~~ **Done** 13c4a15. Left over: NodeCanvas still passes `pinchSmoothingRef` to `useNodeDrag` (Lane A, one line) | done |
| X-08 | `src/hooks/useNodeActions.js` is imported nowhere since P1.02 removed its dead import: delete the file (the Oct-2025 "Phase 2" that was never wired) | any small cleanup commit |
| X-09 | Two files in src/ don't parse and nothing imports them: `src/examples/UniverseManagerPureUI.jsx` (a component body stored as one string with literal `\n`) and `src/components/repositories/RepositoryList.jsx` (`Eye Off` typo in its imports). Delete both, then remove them from `unparseable` in test/known-undefined-names.json (found by P0.06) | any small cleanup commit |
| X-10 | `calculateSelection` (`useCanvasWorker.js`) and `calculateSelectionRect` (`canvasWorker.js`) have no callers since P1.04 (found by P1.04) | any small cleanup commit |
