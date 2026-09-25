# P2: UI store for shared state; lift the shell out of NodeCanvas

**Goal.** NodeCanvas stops being the app shell. Shared UI state (the "spine", F-47) moves into `canvasUIStore` (D-04). Then `App.jsx` renders Header, the Panels, TypeList, the modals and the other hosts as siblings of the canvas, each subscribing to the store itself.

After this phase:
- A canvas-only change no longer re-renders the shell.
- A shell-only change no longer re-renders the canvas.

**Exit criteria.**
- NodeCanvas returns only the `.canvas-area` subtree.
- Header, Panel and TypeList each have a Profiler. They show 0 commits in S1, S4 and S8, and in S7 only the hosts that display selection re-render.
- All P0 flows pass.
- The size budget is lowered.

**Kickoff checklist.** Do this before starting the cards.
1. Re-verify F-47 reference counts.
2. Check whether the MCP bridge (`BridgeClient.sendStoreToServer`) reads any spine field. If it does, those fields stay reachable to the bridge.
3. Decide whether edge selection moves out of graphStore (D-04 note).

---

### P2.01: `canvasUIStore` scaffold
- **Status:** done (80e0c39, 9c9087c; report reports/P2.01.md). Wired by P2.02, so it counts as done
- **Lane:** B · **Size:** M · **Depends:** P1 done
- **Findings:** F-47
- **Change:**
  - Create `src/store/canvasUIStore.js`: a plain zustand store with no middleware.
  - It holds these slices, taken from F-47 items 1–15:
    - `selection` (`selectedInstanceIds`)
    - `selectedGroupId`
    - `pie` (target id, transitioning latch)
    - `previewingNodeId`
    - `nodeDefinitionIndices`
    - `modes` (carousel visible, node, animation state, just-exited; `semanticOrbitActive`)
    - `prompts` and `modals` (which are open)
    - `textEntry` (focus flags, plus a derived `isTextEntryActive` selector)
    - `leftPanelView` request
    - `hover` (the vision-aid chip)
    - `gamepadFocus`
    - `clipboardVersion`
    - `trackpadZoomEnabled`
  - Setters accept either a value or an updater function (React semantics), so migrations are drop-in.
  - Setters skip the write when the value is equal (Set equality for selection).
  - Add unit tests.
- **Don't:** Wire any consumers yet.
- **Accept:** The tests pass and the store is importable. There are no consumers yet; say so in the Handoff so nobody counts it as done.
- **Handoff:** 220 tests pass. Setters keep the NodeCanvas names and accept a value or an updater. No-op writes are skipped (Set equality for selection, Map equality for definition indices, shallow compare for prompts). That's stricter than useState: an effect that re-fired on a new-but-equal Set will stop re-firing. P2.02 must check for that. See the report for kickoff research (bridge, edge selection, timing risks).

### P2.02: Move `selectedInstanceIds` into the store
- **Status:** done (c74a937, merged f29b9f0; report reports/P2.02.md)
- **Lane:** A (plus the hooks that receive it) · **Size:** L · **Depends:** P2.01
- **Findings:** F-47 item 1
- **Change:**
  - In NodeCanvas, keep the local names `selectedInstanceIds` / `setSelectedInstanceIds`, bound to the store selector and action. That keeps the diff small.
  - Update every hook that receives the value or the setter (touch, keyboard, drag, gamepad, control panels).
  - Remove the mirror refs that exist only to feed hooks. Hooks can read `useCanvasUIStore.getState()` directly.
- **Risk:**
  - Zustand updates are synchronous; useState updates are batched.
  - The selection → pie → control-panel effect chain (~13690–13840) and graph-change cleanup (~7756) depend on effect ordering.
  - Run F4, F6, F9, F11 and F13, and watch S6 and S7 for extra commits.
- **Accept:**
  - Behaviour is unchanged.
  - S6 and S7 have no more commits than before.
  - TypeList and Panel *can* read selection from the store, but they don't have to yet.
- **Handoff:** Bound in place under the old names; no call site changed. `selectedInstanceIdsRef` reads through to `getState()`; `useCanvasTouch` lost its mirror. `useNodeActions.js` deleted (no importers). S6 29 / S7 18 commits, no extra. The hooks still take selection as parameters; dropping them is optional clean-up.

### P2.03: Move the pie target, preview, definition indices, mode flags, group selection and clipboard version
- **Status:** done (144d898, 6970378, merged 4fbb562; report reports/P2.03.md). `selectedGroup` and the edge-selection decision split out as P2.03b and P2.03c
- **Lane:** A · **Size:** L · **Depends:** P2.02
- **Findings:** F-47 items 2–6 and 15; B-08
- **Change:**
  - Migrate `selectedNodeIdForPieMenu`, `isTransitioningPieMenu`, `previewingNodeId`, `nodeDefinitionIndices`, the carousel and orbit *public* flags, `editingNodeIdOnCanvas`, `selectedGroup` (store the id and derive the object; this fixes its staleness), and `clipboardVersion`.
  - Panel reads `nodeDefinitionIndices` from the store. That fixes B-08; also remove it from Panel's comparator question.
  - Decide whether edge selection moves (kickoff item 3). Record the result as a DECISION.
- **Don't:** Move the carousel's internal physics or animation state. That is P5.
- **Accept:** F6, F9, F12 and F15 pass. Definition navigation in Panel and on the canvas stays in sync.
- **Handoff:**
  - Moved, bound in place: the pie target and latch, `previewingNodeId`, `nodeDefinitionIndices`, the carousel and orbit flags, `editingNodeIdOnCanvas`, `clipboardVersion`. Also the pie's render and transition state and the control panel's latches: they are written in the same flush as the pie target, and splitting them between the store and `useState` rendered twice (see the report).
  - B-08 and B-11 fixed; F17 guards them.
  - One extra S6 NodeCanvas run remains: a bailout when the PieMenu mounts (body runs, nothing changed).

### P2.03b: `selectedGroup` → `selectedGroupId`
- **Status:** todo
- **Lane:** A · **Size:** S · **Depends:** P2.03
- **Findings:** F-47 item 2
- **Change:** Store the id in `canvasUIStore` (`selectedGroupId` already exists there) and derive the group object from the active graph, which fixes the stale snapshot. The same for `lastSelectedGroupId`.
- **Accept:** Group selection, the group control panel and group editing behave as before; the panel shows a renamed group's new name without reselecting.
- **Handoff:**

### P2.03c: Edge selection: decide, then move or keep
- **Status:** todo
- **Lane:** A · **Size:** M · **Depends:** P2.03
- **Findings:** D-04 note; P2.01 report §3 recommends the move
- **Change:** Record a DECISION on whether `selectedEdgeId` / `selectedEdgeIds` leave graphStore. If they move, bind them in place the same way and keep any field the bridge reads reachable (P2.01 §2 found none).
- **Accept:** Edge selection, the connection control panel and Delete on selected edges behave as before; S7 has no extra commits.
- **Handoff:**

### P2.04: Move prompt/modal open state and text-entry focus
- **Status:** done (391d978, merged 2d4c315; report reports/P2.04.md)
- **Lane:** A · **Size:** M · **Depends:** P2.02
- **Findings:** F-47 items 7–8, F-50
- **Change:**
  - Migrate the open state of the five prompts, `newWebPrompt`, the header searches and the `show*` / `*Visible` modal flags.
  - Replace the focus flags with one `isTextEntryActive` selector.
  - F-50: `onFocusChange` is never called. Either wire it through `PanelContentWrapper`, or delete the plumbing and rely on the DOM focus checks (`textEntry.js`). Record which as a DECISION.
- **Accept:**
  - Keyboard shortcuts are still suppressed while typing in the Header, the Panels and the prompts.
  - F13 and F14 pass.
- **Handoff:** Prompts, modal flags, header searches and `isHeaderEditing` bound in place. F-50: the panel focus plumbing was dead and is deleted (D-19); `selectIsTextEntryActive` is `isHeaderEditing` only, and the DOM check (`utils/textEntry.js`) covers panel fields (F13).

### P2.05: Left-panel view as store state
- **Status:** done (5c3b146, merged 87f11e7; report reports/P2.05.md)
- **Lane:** A and C (Panel) · **Size:** S · **Depends:** P2.01
- **Findings:** F-47 item 9
- **Change:**
  - Add a store field plus an `openLeftPanelView(view)` action.
  - Panel reacts to it.
  - Delete the 6 `leftPanelRef.setActiveView` call sites and `leftPanelInitialView`.
- **Accept:** Every path that opens the left panel to a specific view still works: the wizard, onboarding and git reconnect, universes, and the Federation event.
- **Handoff:** All 10 sites call `openLeftPanelView(view)`; `leftPanelRef`, `leftPanelInitialView`, the `initialViewActive` prop and Panel's `setActiveView` handle are gone. Each request carries a nonce, so a repeat request switches back after the user moved away (F18).

### P2.06: Lift the self-contained (A) clusters into App-level hosts
One commit per sub-card. **Lane:** A (removal) plus B (new host). Each sub-card adds a Profiler to its host.

- **P2.06a SyncDebugHost + DebugOverlay** (F-48). About 515 lines leave NodeCanvas. Status: todo.
- **P2.06b ModalHosts: Help, Settings, Merge, AutoGraph.** These already open through window events or store flags. Status: **done** (93c5764; reports/P2.06b.md). `hosts/ModalHosts` in CanvasShell after the overlay slot; owns the four open events.
- **P2.06c UniverseHost:**
  - the loading, error and empty states (the empty state's "create" button calls `openNewWebPrompt`, which becomes a store action)
  - `GitReconnectModal`, `StorageSetupModal`, `SaveStatusDisplay`
  - the reconnect and retry logic
  - About 1,000 lines. Status: todo.
- **P2.06d SearchHosts:** header searches plus the New Web prompt. Navigation goes through the existing `rs-navigate-to` event or a canvas command. Status: todo.
- **P2.06e Header file operations → a plain module** (`src/services/` or `src/utils/`), about 170 lines inlined in the Header JSX. Status: done with P2.08 (`src/services/universeFileActions.js`).
- **P2.06f ForceSim + LayoutProgress.**
  - They need `hydratedNodes`, `baseDimsById`, `edges`, `draggingNodeInfo` and `layoutProgress` from inside the canvas. Expose these through a selector hook or a command.
  - Rated B; do it last in P2.06.
  - Status: todo.

**Accept (each):**
- The host renders from App.
- NodeCanvas no longer holds its state.
- The host's Profiler shows it doesn't re-render during S1, S4 or S8.

### P2.07: Deletion-ghost layer
- **Status:** todo
- **Lane:** A + B · **Size:** S · **Depends:** P2.01
- **Findings:** F-12
- **Change:**
  - Add a tiny store (or a UI-store slice) holding the list of ghosts.
  - Add `src/components/canvas/layers/DeletionGhostLayer.jsx`, rendered inside the SVG content group.
  - `captureDeletionGhosts` pushes to the store, and the layer removes each ghost on `animationend`.
- **Accept:** Deleting N nodes causes 0 NodeCanvas commits for ghost cleanup.
- **Handoff:**

### P2.08: Canvas command registry; move Header to App
- **Status:** done (0d54da5 + B-12 90120ef, merged 5bce422; report reports/P2.08.md). Header renders from NodeCanvas's slot as a one-prop host; App takes the element in P2.11
- **Lane:** A + C (Header) · **Size:** L · **Depends:** P2.03, P2.04
- **Findings:** F-47 item 16, F-13
- **Change:**
  - Add `src/utils/canvas/canvasCommands.js`, a small registry.
    - NodeCanvas registers handlers on mount and unregisters them on unmount: `autoLayout`, `snapToGrid`, `condense`, `openForceSim`, `navigateTo`, `focusNode`, `startHurtleFromPanel`, and so on.
    - Callers invoke commands by name. Prefer this over new window events, and record it as a DECISION.
  - App renders `<Header>`.
    - `headerGraphs`, the `cleanupOrphanedGraphs` effect, fullscreen, the bookmark state and title editing move with it.
    - `onActionHoverChange` becomes a hover-store action (P2.13, or an interim command).
    - `gamepadFocusedGraphId` comes from the UI store.
  - Header gets a Profiler.
- **Accept:**
  - Every Header action still works: tabs, the new-web prompt, both searches, auto-layout, snap, condense, force sim, fullscreen, bookmark and file operations.
  - Header shows 0 commits in S1, S4, S5 and S7.
- **Handoff:**
  - `HeaderHost` (`src/components/canvas/hosts/`) wires Header to the stores, the command registry (D-20) and `services/universeFileActions.js`; its only prop is `hidden`. Header commits: S1/S5/S7 0, S4 1 (Undo turning on), S13 2.
  - Registered commands: `autoLayout`, `snapToGrid`, `condense`, `actionHover` (interim, P2.13). Add the Panels' needs in P2.09 with `useCanvasCommands`.
  - `trackpadZoomEnabled` and the gamepad's header focus live in canvasUIStore. NodeCanvas no longer subscribes to `openGraphIds`.
  - The orphan-graph cleanup effect stayed in NodeCanvas on purpose (see the report).

### P2.09: Move the left and right Panel to App
- **Status:** done (2908e9d + F-76 aa07e76, merged e94df94; report reports/P2.09.md). Panels render from NodeCanvas's slots as one-prop hosts; App takes the elements in P2.11
- **Lane:** A + C · **Size:** L · **Depends:** P2.03, P2.05, P2.08
- **Findings:** F-13, X-05
- **Change:**
  - Add `src/hooks/useActiveGraphNodes.js`, a selector hook that replaces the `hydratedNodes` prop.
  - Panels read selection, `nodeDefinitionIndices` and the left-panel view from the store.
  - `onStartHurtleAnimationFromPanel` becomes a command.
  - Drop the unused right-panel `ref` (X-05).
  - Re-check Panel's custom memo comparator. Once props come from the store, it may be unnecessary.
- **Accept:**
  - Panel shows 0 commits in S1, S4 and S5.
  - It re-renders in S7 only if it displays the selection.
  - Every panel tab works.
- **Handoff:**
  - `PanelHost` (`side` only) supplies store values, stable toggles and the `startHurtleFromPanel` command. Panel is a plain memo now (comparator, `forwardRef` and `openNodeTab` gone; X-05).
  - Panel doesn't subscribe to `graphs`/`edges`: Open Webs (LeftGridView), the wizard (LeftAIView) and Semantic Discovery subscribe for themselves. Panel commits: 0 in S1/S4/S5/S7 (were up to 18 in S5).
  - F-76: the hidden wizard view's unused 3 s poll is gone.
  - `useActiveGraphNodes` was not needed here; build it in P2.10 for TypeList.

### P2.10: Move TypeList to App
- **Status:** done (4c09950 + B-13 391a992, merged 5a573a5; report reports/P2.10.md). TypeListHost renders from NodeCanvas's slot; App takes it in P2.11
- **Lane:** A + C · **Size:** S · **Depends:** P2.02, P2.09
- **Change:** TypeList reads its nodes through `useActiveGraphNodes` (add `src/hooks/useActiveGraphNodes.js` here; P2.09 didn't need it) and reads selection from the store. Wrap it in a host with a Profiler, as P2.08/P2.09 did.
- **Accept:** TypeList shows 0 commits in S1 and S4.
- **Handoff:** TypeList takes no props: its lists come from `useStableSelector` (new, `src/hooks/`) and its click handlers read the stores. `useActiveGraphNodes` wasn't needed. TypeList commits: 0 in S1/S4/S5/S7; S5 total render ms 103 → 59. B-13 fixed (typing selected nodes from the TypeList).

### P2.11: App owns the shell layout
- **Status:** done (e90dc32, merged 6ce6a00; report reports/P2.11.md)
- **Lane:** A + C · **Size:** M · **Depends:** P2.08–P2.10
- **Change:**
  - App renders the flex composition: Header / [Panel | canvas-area | Panel] / TypeList, respecting `useMobileLandscapeShell`.
  - NodeCanvas returns only the canvas-area subtree plus whatever canvas-local overlays remain.
- **Accept:**
  - Layout is pixel-identical on desktop, in the mobile landscape shell, and in overlay-panel mode.
  - Every flow passes.
- **Handoff:** `CanvasShell` (App-rendered, memo) owns the container, Header, the panel row and TypeList. NodeCanvas returns `.canvas-area` + `HurtleOrb` and portals its remaining overlays into the shell's `display: contents` slot through `CanvasOverlaySlot` (inline when rendered alone, as in tests). Each P2.06/P5 host that takes an overlay out should render it from CanvasShell (or App) in the same DOM position: after TypeList. Layout checked with `shell-shots.pw.js` + `scripts/compare-shots.mjs`; use them for P2.12 too.

### P2.12: `PanelResizers` component and a single source for panel width
- **Status:** todo
- **Lane:** A + B + C · **Size:** M · **Depends:** P2.11 (and P1.05)
- **Findings:** F-04, F-47 item 10
- **Change:**
  - `hosts/PanelResizers` owns the drag.
  - The panel width lives in one place instead of three (NodeCanvas, `useViewportBounds`, Panel).
  - `getFramingRegion` reads the width from the store or a ref.
  - The gamepad's `panelResizeControlRef` still works.
- **Accept:** S9 shows 0 NodeCanvas commits. The gamepad can still resize the panels.
- **Handoff:**

### P2.13: Hover / vision-aid slice
- **Status:** todo
- **Lane:** A + B · **Size:** M · **Depends:** P2.01
- **Findings:** F-10
- **Change:**
  - Move the hovered node, hovered connection and active pie item into the hover slice.
  - `HoverVisionAid` subscribes to it directly.
  - Button hover (Header, panels, pie) calls a stable store action instead of NodeCanvas's `handlePieMenuHoverChange`.
  - Move the dwell logic into `useHoverIntent`.
  - The edge renderer still reads `hoveredEdgeInfo` until P3.06. Keep that path working.
- **Accept:**
  - Sweeping over pie, header or panel buttons causes 0 NodeCanvas commits.
  - Canvas hover still re-renders NodeCanvas until P3.06; note that in METRICS.
- **Handoff:**
