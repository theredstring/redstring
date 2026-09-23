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
- **Status:** todo
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
- **Handoff:**

### P2.02: Move `selectedInstanceIds` into the store
- **Status:** todo
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
- **Handoff:**

### P2.03: Move the pie target, preview, definition indices, mode flags, group selection and clipboard version
- **Status:** todo
- **Lane:** A · **Size:** L · **Depends:** P2.02
- **Findings:** F-47 items 2–6 and 15; B-08
- **Change:**
  - Migrate `selectedNodeIdForPieMenu`, `isTransitioningPieMenu`, `previewingNodeId`, `nodeDefinitionIndices`, the carousel and orbit *public* flags, `editingNodeIdOnCanvas`, `selectedGroup` (store the id and derive the object; this fixes its staleness), and `clipboardVersion`.
  - Panel reads `nodeDefinitionIndices` from the store. That fixes B-08; also remove it from Panel's comparator question.
  - Decide whether edge selection moves (kickoff item 3). Record the result as a DECISION.
- **Don't:** Move the carousel's internal physics or animation state. That is P5.
- **Accept:** F6, F9, F12 and F15 pass. Definition navigation in Panel and on the canvas stays in sync.
- **Handoff:**

### P2.04: Move prompt/modal open state and text-entry focus
- **Status:** todo
- **Lane:** A · **Size:** M · **Depends:** P2.02
- **Findings:** F-47 items 7–8, F-50
- **Change:**
  - Migrate the open state of the five prompts, `newWebPrompt`, the header searches and the `show*` / `*Visible` modal flags.
  - Replace the focus flags with one `isTextEntryActive` selector.
  - F-50: `onFocusChange` is never called. Either wire it through `PanelContentWrapper`, or delete the plumbing and rely on the DOM focus checks (`textEntry.js`). Record which as a DECISION.
- **Accept:**
  - Keyboard shortcuts are still suppressed while typing in the Header, the Panels and the prompts.
  - F13 and F14 pass.
- **Handoff:**

### P2.05: Left-panel view as store state
- **Status:** todo
- **Lane:** A and C (Panel) · **Size:** S · **Depends:** P2.01
- **Findings:** F-47 item 9
- **Change:**
  - Add a store field plus an `openLeftPanelView(view)` action.
  - Panel reacts to it.
  - Delete the 6 `leftPanelRef.setActiveView` call sites and `leftPanelInitialView`.
- **Accept:** Every path that opens the left panel to a specific view still works: the wizard, onboarding and git reconnect, universes, and the Federation event.
- **Handoff:**

### P2.06: Lift the self-contained (A) clusters into App-level hosts
One commit per sub-card. **Lane:** A (removal) plus B (new host). Each sub-card adds a Profiler to its host.

- **P2.06a SyncDebugHost + DebugOverlay** (F-48). About 515 lines leave NodeCanvas. Status: todo.
- **P2.06b ModalHosts: Help, Settings, Merge, AutoGraph.** These already open through window events or store flags. Status: todo.
- **P2.06c UniverseHost:**
  - the loading, error and empty states (the empty state's "create" button calls `openNewWebPrompt`, which becomes a store action)
  - `GitReconnectModal`, `StorageSetupModal`, `SaveStatusDisplay`
  - the reconnect and retry logic
  - About 1,000 lines. Status: todo.
- **P2.06d SearchHosts:** header searches plus the New Web prompt. Navigation goes through the existing `rs-navigate-to` event or a canvas command. Status: todo.
- **P2.06e Header file operations → a plain module** (`src/services/` or `src/utils/`), about 170 lines inlined in the Header JSX. Status: todo.
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
- **Status:** todo
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

### P2.09: Move the left and right Panel to App
- **Status:** todo
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

### P2.10: Move TypeList to App
- **Status:** todo
- **Lane:** A + C · **Size:** S · **Depends:** P2.02, P2.09
- **Change:** TypeList reads its nodes through `useActiveGraphNodes` and reads selection from the store.
- **Accept:** TypeList shows 0 commits in S1 and S4.
- **Handoff:**

### P2.11: App owns the shell layout
- **Status:** todo
- **Lane:** A + C · **Size:** M · **Depends:** P2.08–P2.10
- **Change:**
  - App renders the flex composition: Header / [Panel | canvas-area | Panel] / TypeList, respecting `useMobileLandscapeShell`.
  - NodeCanvas returns only the canvas-area subtree plus whatever canvas-local overlays remain.
- **Accept:**
  - Layout is pixel-identical on desktop, in the mobile landscape shell, and in overlay-panel mode.
  - Every flow passes.
- **Handoff:**

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
