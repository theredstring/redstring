# Canvas architecture

**Status:** current (2026-09-25, after the pre-1.0 NodeCanvas refactor, wave 6).
**Read this before** changing `src/NodeCanvas.jsx`, anything it renders, or the canvas hooks.
The refactor's plan of record, with its findings, decisions and metrics, is
[`documentation/dev-ops/nodecanvas-refactor/`](../dev-ops/nodecanvas-refactor/README.md) (historical once closed).

## The shape in one paragraph

`src/NodeCanvas.jsx` was a 19,000-line component that owned everything the canvas did. It is now an orchestrator of about 3,600 lines, with a line budget enforced by a test.
It still owns four things:
- the canvas `<svg>` and its content group;
- the shared refs the input paths read (pan/zoom, gesture flags, mirrors of derived data);
- the derived data every layer needs (hydrated nodes, dimensions, edge routing, culling);
- the wiring: it creates the controllers once and hands each layer and host its inputs.

Everything else lives in:
- **stores**, for state that more than one place reads;
- **layers**, drawn inside the SVG;
- **hosts**, drawn outside it;
- **controllers and hooks**, for input and the camera;
- **plain modules**, for actions, builders and geometry.

State that changes often is read by the leaf component that draws it, so a hover, a selection or an open pie menu re-renders what shows it rather than the whole canvas.

## Stores

| Store | File | Holds | Rule |
|---|---|---|---|
| graphStore | `src/store/graphStore.js` | The universe: graphs, prototypes, instances, edges, groups, and every user setting | Saved (SaveCoordinator). Fields the MCP bridge serialises must be updated in all three places (see CLAUDE.md) |
| canvasUIStore | `src/store/canvasUIStore.js` | Canvas UI state shared across components: node and edge selection, the selected group id, hover, the pie and carousel lifecycle, the panel show/visible latches, the name prompts, the pie page, the abstraction axes, deletion ghosts, panel widths | Not saved. Setters skip equal writes. The lifecycle fields are written only through `dispatchPie` (below) |
| Feature stores | `colorPickers/colorPickers.js`, `wizard/canvasWizard.js`, `dialogs/canvasDialogs.js` | One feature's open/closed state: the three colour pickers, the Ask The Wizard picker and destination, the two confirmations | Small `create()` stores with plain setter functions. The host that draws the feature subscribes to them |
| imageCache | `src/services/imageCache.js` | Auto-enriched thumbnails, by prototype | Never saved (see the image OOM notes in CLAUDE.md) |
| historyStore | `src/store/historyStore.js` | Undo and redo | |

`storeFieldRef(store, field)` (`src/utils/storeFieldRef.js`) gives a store field a ref-shaped `.current`. Code that used to hold a local ref keeps its call sites.

## The pie and carousel lifecycle: one machine

`components/canvas/pie/pieMachine.js` exports `reducePie(state, event, env) → { patch, commands }`. It is a pure reducer over canvasUIStore's lifecycle fields: the pie target, transition flags, carousel visibility and stage, pending actions, exit guards and the prompt.

Every lifecycle change is an event, sent with `useCanvasUIStore.getState().dispatchPie({ type, ... })`. Senders include:
- the pie buttons and the context menu;
- the control panels;
- touch;
- the Wizard;
- the carousel's callbacks;
- selection changes: `setSelectedInstanceIds` dispatches `SELECTION_CHANGED` itself.

`dispatchPie` applies the patch in one store write, then runs the commands:
- `after`: a timer;
- `cancel`: cancel a timer;
- `frame`: camera framing;
- `graph`: a store action, such as applying a Swap;
- `local`: resets of NodeCanvas-local state.

NodeCanvas registers the handler for `frame`, `graph` and `local` (`pie/pieCommands.js`).

Unit tests: `pie/__tests__/pieMachine.test.js` (every transition) and `test/store/canvasUIStore.pie.test.js`. The browser-level check is the lifecycle traces (see Verification).

Do not write the lifecycle fields with their setters from new code. Add an event.

## Controllers and input hooks

Controllers are created once (`useMemo(() => createX(ctxRef), [])`). NodeCanvas assigns their context object during render, so every call site holds a stable function that reads the latest values when it runs.

| Piece | File | What it owns |
|---|---|---|
| Camera controller | `camera/cameraController.js` | Wheel and trackpad zoom, device discrimination, pan and zoom momentum, view-motion sampling, Safari gesture events |
| Transform | `src/hooks/useCanvasTransform.js` | The ref-owned pan and zoom, the single DOM write per frame, the settled view (`settledPan`, `settledZoom`), label suppression during moves |
| Transform wiring | `camera/transformWiring.js` | What the transform calls back into: culling, the live-transform event, the label fade predicate, the sprite bakery pause |
| Pointer handlers | `input/pointerHandlers.js` | Node press, move, press and release, canvas click, connection draw start, keyboard pan travel |
| Group input | `groups/groupInput.js` | Group title and node-group shell input |
| Node drag | `src/hooks/useNodeDrag.js` | Lift, the DOM-bypass drag (edges and labels redrawn without React), drag-zoom, drop |
| Touch | `src/hooks/useCanvasTouch.js` | One-finger pan, pinch, long-press drag, taps |
| Keyboard | `src/hooks/useCanvasKeyboard.js` | Shortcuts and the per-frame movement loop, which also runs the controller tick |
| Game controller | `src/hooks/useGamepad.js` | Crosshair aim, drift, and menu and panel navigation. What it can aim at comes from `input/controllerTargets.js` |
| Layout | `src/hooks/useGraphLayout.js` | Auto-layout, condense, snap to grid, zoom to fit |

The input hooks take a few groups rather than dozens of arguments:
- `transform`: the useCanvasTransform API;
- `camera`: the camera controller;
- `pointer`: the pointer handlers;
- `nodeDrag`: the drag hook's return;
- `gestures`: the shared gesture refs and the gesture block.

Each hook unpacks its groups at the top under the names its body uses. Store values and settings are subscribed inside the hook with the same selectors NodeCanvas uses. Hook unit tests regroup flat params (`test/hooks/seedCanvasTouchStores.js`, `renderKeyboard` in the keyboard test).

## Layers: inside the SVG, in paint order

NodeCanvas's JSX is a list of layers. From the bottom:

1. `ClusterHullsLayer`, `GridLayer`
2. The regular group shells (`groups/groupElements.jsx`, memoized elements)
3. `HitboxDebugLayer`
4. `EdgeLayer`: every visible connection, interleaved by z-slot with the node-group shells. It subscribes to hover itself. On a hover-only render, just the two edges whose hover changed re-render.
5. `ConnectionDrawOverlay`: the connection being drawn
6. `NodeLayer part="rest"`: memoized; subscribes to selection, preview, pie target and carousel itself
7. Group titles
8. `DeletionGhostLayer`
9. `PieMenusLayer`: the node pie (`NodePieMenuLayer`, memoized, reads its data from canvasUIStore) and the edge pie (memoized)
10. `OrbitDimRect`
11. `NodeLayer part="top"`: the active node (with the orbit overlay while orbiting), then the dragged node
12. `SvgOverlays`: marquee, plus sign, video node

Outside the content group, but still within the canvas area:
- `OrbitLayers`
- `CanvasHud`: the hover vision aid and the controller crosshair
- `CanvasChrome`
- `PromptsHost`
- `HurtleOrb`

Layers take a `ctx` prop built by NodeCanvas and subscribe to the fast-changing state they draw.

## Hosts: outside the SVG

- `hosts/CanvasShell.jsx` lays out the app:
  - Header / left Panel / canvas / right Panel / TypeList;
  - each piece has its own host (`HeaderHost`, `PanelHost`, `TypeListHost`), wired to the stores rather than to NodeCanvas.
- Hosts for screen-level UI:
  - `ModalHosts`, `SearchHosts`, `ForceSimHost`, `SyncDebugHost`;
  - `UniverseHost`: universe lifecycle and the welcome screen.
- NodeCanvas portals its screen-level overlays into the shell's slot after TypeList (`hosts/canvasOverlaySlot.js`):
  - `ControlPanelsHost`: the node, group, connection and abstraction panels, their show/hide effects and their action handlers.
  - `CanvasOverlaysHost`: the abstraction carousel, `ColorPickersHost`, the two confirmations and `WizardHost`.
- `PromptsHost`: the name prompts, their handlers and the one-shot name suggestions.

## The command registry

UI outside the canvas asks it to act by name, for example `runCanvasCommand('autoLayout')` (`src/utils/canvas/canvasCommands.js`). NodeCanvas registers the handlers while it is mounted (`useCanvasCommands`).

Use a command, not a new window event or a callback prop threaded through NodeCanvas.

## Modules under `src/components/canvas/`

| Folder | Contents |
|---|---|
| `actions/` | Things the canvas does: drop, swap, abstraction submit, node-group conversion and dive, plus sign, one-shot suggestions, the auto-layout listener, Wizard events, shortcuts, the page-zoom guard, universe restore |
| `camera/` | Camera controller, transform wiring, framing, momentum, hurtle, view persistence, back to civilization, navigate to instances |
| `carousel/` | The carousel's callbacks and axis handlers |
| `colorPickers/`, `dialogs/`, `wizard/` | Feature stores and their hosts |
| `data/` | Canvas nodes and dimensions, culling, active-graph data upkeep, back-to-civilization visibility, the store action bag |
| `edges/` | Whole-graph edge geometry, label budgets, the create/delete animations (`edgeTransitions.js`, mounted by `EdgeTransitionLayer` at the end of EdgeLayer) |
| `groups/` | Group layouts as data, group elements, group input, the anchor flush |
| `input/` | Pointer handlers, connection drawing, edge input, controller targets |
| `layers/`, `hosts/` | As above |
| `menus/` | Context-menu builders |
| `orbit/` | Semantic orbit: data, actions, constants, the hook, its layers |
| `pie/` | Pie button builders, pie data, the machine, its commands, the edge pie hooks |
| `renderConnectionEdge.jsx`, `SelfLoopEdge.jsx` | One connection's rendering |

## Where new features go

| You are adding | Put it in |
|---|---|
| Something drawn inside the canvas | A layer under `layers/` (or an existing one), subscribing to the store state it draws |
| A panel, dialog, prompt or overlay | A host, or the feature store plus host pattern (`colorPickers/`, `dialogs/`) |
| A pie or context-menu button | The builders in `pie/` or `menus/`. Lifecycle effects go through `dispatchPie` |
| Something UI outside the canvas asks the canvas to do | A command in the registry |
| Input handling | The controller or hook that owns that input. Shared gesture state goes through the `gestures` group |
| Shared UI state | canvasUIStore, or a small feature store if one feature owns it |
| An action with no UI of its own | A function in `actions/`, taking what it reads as arguments or reading the stores when it runs |

**Never add a feature to `NodeCanvas.jsx`.** Its line budget (`test/meta/nodecanvas-budget.json`) only goes down: a commit that shrinks the file lowers it, and raising it needs a DECISION in the refactor folder.

## Patterns

- **Moving code: verbatim first.**
  - Code leaves NodeCanvas unchanged in behaviour. The free names become a `ctx` object or parameters, and lint finds them.
  - Hook-wrapped moves are called where the code was, so hooks and effects keep their order.
  - Behaviour changes are separate commits, labelled B-nn for bug fixes.
- **Stable callbacks read the latest values.**
  - Pass a function created once that reads a context ref.
  - Don't pass a closure that changes every render into a memoized child.
- **Render-time latches.** Values an exit animation needs, such as the last selected prototypes or group, are latched during render in the component that animates, not by an effect.
- **Equal writes are skipped** (`useTrackedState`, the store setters), so a reset that changes nothing renders nothing.
- **Pure updaters.** Never call a setter or cause a side effect inside a state updater.

## Verification

| Tool | Command | What it catches |
|---|---|---|
| Interaction flows | `CI=1 CANVAS_E2E_PORT=4897 npx playwright test --workers=4` | F1–F40: every user-visible interaction. The fixture fails any flow with an uncaught page error |
| Lifecycle traces | `LIFECYCLE_TRACE_DIR=<dir> … playwright test zz-lifecycle-baseline`, then `python3 test/e2e/canvas/lifecycleTraceViews.py test/e2e/canvas/lifecycle-baselines <dir> --no-panels` | The pie, carousel and panel sequence in 17 scenarios. A change may drop states, never add or reorder them |
| Perf scenarios | `npm run perf:canvas [-- --scenario S6]` | Commits and NodeCanvas renders per interaction (S1–S12) |
| Unit tests | `npm run test:ci` | The machine, the controllers, the hooks, the stores |
| Undefined names | `npm run lint:undef` | A name that lost its definition in a move |
| Size ratchet | part of `test:ci` | NodeCanvas growing |

## Open items

These were deferred at the refactor's close. The reasons are in the refactor folder's DECISIONS and phase cards.
- **Deterministic label placement and per-edge memoization (P3.05, P3.06b).** These change where labels land, so they need Grant's review.
- **The viewport store (P3.10, P3.11).** Depends on the label work above.
- **The explicit pointer gesture machine and a shared tap policy (P4.04b, P4.05).** These change input control flow, so they need the device checklist.
- **The camera framing effects as machine `frame` commands.** This changes when the camera starts relative to the pie, which is a look question.
- **Smaller structural follow-ups, none visible to users:**
  - a connection-draw controller API (P4.03);
  - context-menu actions through commands (P5.07);
  - the panels' show/hide effects in the machine.
