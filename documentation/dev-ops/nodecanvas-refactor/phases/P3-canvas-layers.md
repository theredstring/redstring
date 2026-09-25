# P3: Canvas render layers (kicked off 2026-09-25)

**Goal.** Make each render cheap. Split the SVG into memoized layers that subscribe to exactly what they display, narrow store subscriptions to the active graph, and remove the render-phase side effects that tie the layers together.

**Exit criteria.**
- README success criteria 1–3 are met.
- S7 and S6 commit cost is at least halved from the baseline.
- Hover and select re-render only the affected layer.
- S10b and S11 cause 0 commits.

**Kickoff checklist.**
1. Re-verify F-20 to F-25.
2. Snapshot label and edge DOM for every routing style on the medium fixture. Every label-related card compares against these snapshots.
3. Confirm that P1.12 has landed. It changes what the label pipeline depends on.

---

### P3.01: Narrow the store subscriptions
- **Status:** done (reports/P3.01.md): S10b 0 commits, S11 0 NodeCanvas runs. `nodePrototypesMap`/`edgesMap` not narrowed yet (see report)
- **Lane:** A · **Size:** M
- **Findings:** F-07
- **Change:**
  - Replace the whole-collection subscriptions with active-graph selectors:
    - `graphs.get(activeGraphId)`, with an equality check
    - the edges for the active graph's `edgeIds`
    - the imageCache entries for prototypes on the active graph, compared shallowly
    - prototypes used on the active graph
  - `headerGraphs` and `bookmarkActive` should already have left with Header (P2.08). Handle whatever `graphsMap` consumers remain.
- **Accept:** S10b and S11 cause 0 NodeCanvas commits.

### P3.02: Stable handlers
- **Status:** done (reports/P3.02.md). B-05 fixed; F12 fully passes
- **Lane:** A + C · **Size:** L
- **Findings:** F-24, B-05, D-09
- **Change:**
  - Add `src/hooks/useStableCallback.js`.
  - Convert these to stable handlers that take an id parameter:
    - `handleNodeMouseDown`
    - `touch.handleNode*` (`useCanvasTouch` returns a new object every render)
    - `selectEdgeFromClick`, `edgeTouchHandlers`, `getEdgeHitboxHandlers`
    - the group-title handlers
    - the Node callbacks (`onCreateDefinition`, `onExpandDefinition`, `onNavigateDefinition`, …)
    - the node `onContextMenu` (`getContextMenuOptions` is rebuilt, but the closure the memoized Node holds is not)
  - This fixes B-05; commit that fix separately.
- **Accept:**
  - The B-05 repro is fixed: collapse the right panel, then double-click a node that hasn't re-rendered.
  - The Playwright flow `F12 … offers Unsave (B-05)` passes. Remove its `test.fail()`.
  - Handler identities stay stable across renders. Assert this in a test.

### P3.03: `useGroupLayouts`: group layout as pure data
- **Status:** part a done (reports/P3.03a.md): `computeGroupLayouts` memo; canvas markup byte-identical on small/stress/chambers-zoomed-out. Open: anchor geometry as a real dependency of the edge memos (with P3.05), the anchor flush keyed on the layout, the memoized layers (P3.04).
- **Lane:** A + B · **Size:** L
- **Findings:** F-22, F-25, F-09 (anchor flush)
- **Change:**
  - A memo computes group layouts, title rects, anchor geometry, thing-group member ids, anchor ids and per-depth descriptors from `groups`, `nodes`, `baseDimsById`, `textSettings`, `gridSize` and the rename override.
  - Remove every render-phase ref write in the groups IIFE.
  - Feed anchor geometry into `cleanLaneOffsets`, `lombardiTangents` and `labelCrossingIndex` as a real dependency. This removes the one-render lag noted at ~4892.
  - Replace the anchor-flush effect that has no dependencies with an effect keyed on the layout output.
  - Imperative consumers (drag, gamepad) get their ref mirrors from a layout effect.
- **Accept:**
  - Group DOM is identical to the kickoff snapshot.
  - F11 passes.
  - The anchor flush no longer runs after every commit.

### P3.04: `GroupLayer` components
- **Status:** done (wave 6). The groups pass is `buildGroupElements` (`components/canvas/groups/groupElements.jsx`), memoized on the layouts, the dragged group, the rename draft, theme and grid; its handlers are one stable set from `createGroupInputHandlers` (`groupInput.js`) that reads NodeCanvas's latest values from a ref when it fires. A render that changes nothing about groups hands React the same elements, so it skips them. Built as memoized elements rather than three components: the shells and titles are placed at different z-levels by NodeCanvas, and element identity gives the same skip. Canvas markup is byte-identical to `main` in ten scenes (small, grid, dark, rename draft, group selected, mid group-drag, dropped, stress, chambers framed and zoomed out). New flow F32 (title click, rename Enter/Escape, touch tap and long-press drag) passes on both. Found and fixed B-17 on the way.
- **Lane:** A + B · **Size:** M
- **Change:**
  - Add memoized `RegularGroups`, `GroupShells` (one per depth) and `GroupTitles`, fed by `useGroupLayouts`.
  - Group-title input uses stable handlers (P3.02). The group-title touch path is later absorbed by P4.04.
- **Accept:** GroupLayer shows 0 commits in S7 and S8 when no group changed.

### P3.05: Deterministic label placement
- **Status:** todo
- **Lane:** A + B · **Size:** XL. **Split this before starting.**
- **Findings:** F-21, F-23, F-25
- **Change:**
  1. **Design sub-card.** Document the current placement semantics:
     - the order in which labels dodge each other (`placedLabelsRef`)
     - stabilisation
     - truncation
     - sprites and glyph sprites
     - the curved-label and crossing budgets
  2. **Implementation.** `useLabelPlacements` runs one pass over the whole graph and returns placements for each edge. `renderConnectionEdge` consumes them and stops writing `placedLabelsRef` and `labelTruncationRef`.
     - Orb hit geometry moves from the render-time writes to `connectionOrbHitsRef` into a memo or layout effect.
- **Accept:** Label positions match the kickoff snapshots in every routing style, or every difference is listed and approved by Grant.

### P3.06: `EdgeLayer`, `EdgeSlot` and memoized `ConnectionEdge`
- **Status:** part a done (wave 6): the edges pass is `components/canvas/layers/EdgeLayer.jsx`, moved verbatim, and the hovered connection lives in canvasUIStore (`hoveredEdgeInfo`, equal by `edgeId`); EdgeLayer subscribes to it, NodeCanvas and its handlers read it at event time. **S8: NodeCanvas 0 renders** (EdgeLayer 18), 218 → 96 ms. The whole pass still renders together, so label order is unchanged; markup identical to `main` in 28 scenes (one known font-timing truncation flip). Open (part b, after P3.05): split the context, per-edge `ConnectionEdge` memo with hover/selection booleans, `SelfLoopEdge`, and EdgeLayer memoized so a NodeCanvas render that changes nothing about edges skips it.
- **Lane:** A + C (`renderConnectionEdge.jsx`) · **Size:** L
- **Findings:** F-23
- **Change:**
  - `renderConnectionEdge` becomes the `ConnectionEdge` component.
  - Split the 56-field context into memoized pieces by concern: geometry context, style/settings context, label placements, and handlers.
  - Hover and selection arrive per edge as booleans.
  - The edge layer subscribes to hover and edge selection itself, so NodeCanvas doesn't re-render on hover.
  - Align `SelfLoopEdge` with this.
- **Accept:**
  - Hovering one edge re-renders only that edge and the edge it replaced.
  - S8 causes 0 NodeCanvas commits.
  - Edge DOM matches the kickoff snapshots.

### P3.07: Decide the fate of the edge cache and painter
- **Status:** done (wave 6): both deleted (D-06 amended), with `paintElementTree.js`, its tests and the two smoke cases. Markup byte-identical to `main` in 28 scenes with sprites off (two scenes differed once from font-timing truncation and matched on a rerun; each side varies between its own runs). F1, F5, F7, F10, F11, F28 pass. Design for P3.05/P3.06 (the order this card came out of): `reports/P3.05-design.md`.
- **Lane:** A · **Size:** S–M
- **Findings:** F-23, D-06
- **Change:**
  - Measure with P3.06 in place.
  - Default outcome: delete `edgeElementCacheRef`, the painter (`paintElementTree.js` usage, `edgeSlotElsRef`, the paint layout effect), the `window.__edgeCache`/`__edgePainter` flags, and the smoke-test equivalence cases.
  - Keep a scoped version only if the numbers justify it.
- **Accept:** The decision is recorded in DECISIONS, and the code and flags are removed or scoped.

### P3.08: `NodeLayer`
- **Status:** part a done: the active and dragging `<Node>` copies go through `renderNodeElement` (one prop block); markup identical with no selection, pie open and mid-drag. Open: the partition memo, the layer and its subscriptions, the rename draft inside Node.
- **Lane:** A + B · **Size:** L
- **Findings:** F-24, F-15
- **Change:**
  - A memo partitions the nodes into normal, thing-group members, active and dragging.
  - One prop block replaces the three copies (~17445, ~17873, ~17970).
  - The layer subscribes to selection, preview and definition indices from the UI store.
  - The on-canvas rename keeps its draft inside `Node` and writes to the store on commit or throttled.
- **Accept:**
  - Selecting a node re-renders only the Nodes that changed, plus `NodeLayer`, not NodeCanvas.
  - F1, F6 and F14 pass.

### P3.09: Overlay and grid layers
- **Status:** grid part done: `GridLayer` and `ClusterHullsLayer` (memoized, primitives in); grid screenshots pixel-identical in four settings. The overlays (marquee rect, PlusSign, VideoNodeAnimation, hitbox debug) are already small components interleaved at different z-levels; grouping them into one layer would change z-order, so they stay until P3.08's NodeLayer settles the stacking.
- **Lane:** A + B · **Size:** M
- **Change:**
  - `GridLayer`, which includes the cluster hulls debug view.
  - `OverlayLayer`: the connection-draw line, self-loop preview, selection rect, `PlusSign`, `VideoNodeAnimation`, and the node hitbox debug view.
- **Accept:** The overlays behave identically. F5 and F14 pass.

### P3.10: Viewport store: consumers subscribe to the settled view directly
- **Status:** todo
- **Lane:** A + C (`useCanvasTransform`) · **Size:** M
- **Findings:** F-11
- **Change:**
  - `useCanvasTransform` publishes the settled pan and zoom to `src/store/viewportStore.js` instead of NodeCanvas state.
  - These consumers subscribe to the store themselves:
    - `BackToCivilization`, together with the relevant-nodes memo
    - `EdgeGlowIndicator`
    - the label sprite scale and min-bow
    - context menus
- **Accept:** A settle causes 0 NodeCanvas commits; only the subscribers re-render.

### P3.11: `useViewportCulling` publishes to the viewport store
- **Status:** todo
- **Lane:** A + B · **Size:** M
- **Change:**
  - `runCulling` moves to a hook.
  - The visible node and edge sets go into the viewport store, and the layers subscribe to them.
- **Accept:**
  - Culling growth during S1 and S2 re-renders only the layers, not NodeCanvas.
  - The culling-on contract test passes.
