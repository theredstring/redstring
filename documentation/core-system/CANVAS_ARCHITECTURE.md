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
4. `EdgeLayer`: every visible connection, interleaved by z-slot with the node-group shells. It subscribes to hover itself. On a hover-only render, just the two edges whose hover changed re-render. Last in it, `EdgeTransitionLayer` (connection create/delete) and `BoxMorphLayer` (a Thing opening into its box and folding back), so both paint over shells and connections and under the nodes.
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
| `formats/` | Other ways to show a piece of a web (prototype, `feat/formulas`). `formatCandidates.js` finds the selection, group or web that reads as a format; `FormatsHost` (mounted in `CanvasChrome`) offers it in Back to Civilization's spot with an X. The formula is the first. In Things mode a formula is a chain of terms joined by connections whose defining Thing is the operation (`a —Addition→ b`); a part in parentheses is a nested Thing-group named after its term and typed by what is applied to it (Square Root, Negation, Natural Logarithm, Common Logarithm, sin; untyped is plain parentheses). A logarithm with a base is an operation like Exponentiation, its inverse: `b —Logarithm→ x`, written log_b(x) with the base lowered. Calculus is parts too, typed by what they apply and holding their arguments side by side in order (`notation: 'applied'` in the vocabulary, each with the counts it takes): Derivative and Partial Derivative (of, with respect to: drawn dm over dV, ∂²u over ∂t² for one taken twice), Integral and Line Integral (of, over or along, from, to: ∫ with its limits at its side, then d and the variable, or · dr⃗ along a path), Summation (of, over, from, to: ∑ with its limits under and over it), Limit (of, as, approaches: lim with n → ∞ under it); Differential (dQ) is a sign. In a line of text they are typed as functions (`derivative(m, V)`, `integral(f, x, a, b)`, `sum(a_i, i, 1, n)`, `lim(f, n, ∞)`, `differential(Q)`), which round-trips. A vector is a letter with U+20D7 after it (F⃗), drawn with an arrow of the canvas's own; between two vectors · and × are Scalar Product and Vector Product (typed ⋅ and ⨯, drawn · and ×). `formula/formulaChain.js` reads that (and typed text) into one chain shape and writes it out token by token, from the tree the chain's precedence makes (`treeOfItems`), so a division is stacked as a fraction over exactly its numerator and a root drawn over what it holds (tokens marked `inside`; the ÷ token is the bar, the √ token the sign, a ∑, ∫ or lim token the sign its limits sit around; `rowsOf` groups them for `layoutFormulaLine` and `FormulaTokens`; one-line places pass `stack: false`); `formula/formulaNotation.js` is the vocabulary and the text parser. A group shows as its formula when `group.format === 'formula'` (saved with the group, additive and optional in the file; set and cleared through `formatsStore.js`, so it undoes like any group edit). `formula/formulaObjects.js` works out one canvas object per such group; `NodeLayer` hides its Things and draws it (`FormulaObjectsLayer`), `EdgeLayer` drops its inner connections and lands outside ones on the Thing's token, at draw time only (no stored position changes). The object takes input like a Thing: a tap selects its group, whose panel opens in the `format` mode of `UnifiedBottomControlPanel` (◀ ▶ swap formats, `groupFormats.js`, `FormatPanelPreview`); a double tap on a token opens its Thing; hold-and-drag is the canvas's own group drag (below). Dismissed offers last the session. The equation is a Thing-group too (its Thing is the equation: a title, or its text while untitled), drawn like one: a band with the title, the formula inside. A Thing is written in formulas by its label (`prototype.labels.formula`, additive in the file as `redstring:labels`): Pressure as P. One instance can be written its own way (`instance.labels.formula`, the same field on the instance, kept by paste and copy): q₁ and q₂ in Coulomb's law are both Electric Charge, written q; `formulaLabelOf(proto, instance)` reads it. A click (or tap) on a token whose Thing means more than its text switches it between its symbol and its Thing, drawn by name in its color, the rest of the formula gliding aside (`useGlide`; hover only tints it); a bare symbol, or a standard operation (+, =, √), is plain text. The panel's toggle writes that one formula by names (`formatsStore` `namesShown`/`flipped`, per formula, for the session). Placing a bank equation again links the same definition web (`convertGroupToNodeGroup` with `useDefinitionIndex`). `formula/bank/formulaBank.js` loads the bank of equations by discipline, populated from Wikidata and MathModDB (the MaRDI portal's models, CC BY 4.0, filling in where Wikidata is thin), never written by hand: `scripts/formula-bank/fetch-wikidata.mjs` snapshots every item whose defining formula has its symbols tied to concepts, the known results around them (theorems, laws, equations, formulas, models with an English article) and the field topics of every article's Wikipedia categories, plus MathModDB's disciplines, research problems, models and formulas (`population/fetchMathModDB.js`, through the portal's Wikibase API; the app's update reads down from the items listed in `bank.classes.json`). A MathModDB item's id is marked (`mardi:Q…`, `population/sources.js`: the portal's numbers collide with Wikidata's); a MathModDB quantity that is also a Wikidata item is that item's concept, its formula's section is the nearest MathModDB discipline above it (by its Wikidata item), its model goes with it (shown under its title in the picker, and in its bio), initial and boundary conditions are left out, and an item both sources have is Wikidata's. Then `build-bank.mjs` reads their LaTeX (`formula/latex/latexToFormula.js`) into `bank.generated.json`, keeping only equations with a description, a formula the notation can write, and every symbol tied to one concept (what a sum or integral runs over excepted); a concept has one symbol across the bank, and an equation that writes it otherwise keeps its own on the instance. Each discipline is divided into sections (its fields: Thermodynamics, Graph Theory), and `bank.known.json` lists what each section knows of and doesn't have yet, with why (the wizard's work list); `REPORT.md` and `bank.report.json` list what was left out. The fetch and build are shared modules (`bank/population/fetchWikidata.js`, `buildBank.js`), so Settings → Data → Formula Bank (`settings/FormulaBankRows.jsx`) can update the bank on the device (kept in IndexedDB, `population/deviceBank.js`, starting from the shipped `bank.classes.json` traces) and show what was left out and why. New Formula lists it (`FormulaBankPicker`, loaded on first use) and `buildBankEquation` builds one fully formed: its Thing's bio is the item's description, and each concept Thing carries its Wikidata item as an exact link, found again by provenance or that link (an ontology import's Thing for the same item), never by name, and only ever added to; the equation is placed in its section's web, and the section (its Wikidata item) in its discipline's (only ever adding). The picker narrows a discipline to a section and lists that section's known results not yet written, each opening its article. The panel's Equations section (`EquationsSection`, `formulaEquations.js`) lists "P in Ideal Gas Law". **Replacement:** what a format draws its own way is not there for input: `formats/replaced.js` holds the active web's replaced instances and groups (written by `computeFormulaObjects`), and the shared hit tests (`geometryUtils.isInsideNode`, `canvasHitTest`) skip them; it also holds each replaced Thing's stand-in (its token), which the drag's connection updater draws to. The format itself is there in their place the way a node group's title is, so a formula is a node group to connect: each format is held by its group's anchor with the box it is drawn in (`anchorBoxOf`, `formatAnchorAt`). A connection is drawn from it (its press arms the anchor, as a title's does; `beginConnectionDrawFromNode` and `connectionDraw.js` take the formula's box for the pill's) and dropped anywhere on it (`groupTitleAtCanvasPoint` checks it first; `ConnectionDrawOverlay` glows the formula), and `groupLayouts.publishGroupLayouts` publishes a replaced group's anchor as the format draws it (the title, with the formula's band as the box the connection stops at, as a shell is; a part's anchor is its token) and no title pill to aim at, so draw, hit test, drag (`useNodeDrag`, `formatAnchorPosition`) and the gamepad (`controllerTargets`, which aims at the formula) agree. Nothing selects a replaced Thing (`canvasUIStore` prunes them from every selection; showing a selection as a formula lets it go), and a Thing dropped on a formula isn't offered as one of its Things (`groupDropTarget`). **Something drawn its own way reuses the canvas's behaviour, never a copy of it** (React's answer to "extends Draggable" is composition: one shared controller, called by everything that wants the behaviour). A format is a group underneath, so its press calls the canvas's group input (`groups/groupInput.getCanvasGroupInput()`: the title's own press handlers), and its root element carries one of its Things' `data-instance-id`, so `useNodeDrag`'s DOM-bypass moves it with the group: edge panning, panning and zooming mid-drag, grid snap and the drop's undo step all come from there; while it is the dragged group (`draggingGroupId`, through `NodeLayer`) it wears the group's lift (`groupLiftShadow`, the 1.05 scale). New formats do the same |
| `groups/` | Group layouts as data, group elements, group input, the anchor flush, the box morph (`boxMorph.js`) |
| `input/` | Pointer handlers, connection drawing, edge-pan (connection draw and marquee), edge input, controller targets |
| `layers/`, `hosts/` | As above |
| `menus/` | Context-menu builders |
| `orbit/` | Semantic orbit: data, actions, constants, the hook, its layers |
| `pie/` | Pie button builders, pie data, the machine, its commands, the edge pie hooks |
| `renderConnectionEdge.jsx`, `SelfLoopEdge.jsx` | One connection's rendering. Its resting geometry (not hovered, not selected) is mirrored as data in `utils/canvas/settledConnection.js`, which the web previews draw from (`components/webPreview/`: the Open Webs list, a definition in the right panel, a node's decomposition preview). `NodeCanvas.previewParity.test.jsx` checks the two agree in every routing style, so a change to the resting geometry here has to follow there |

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

## Definitions opened in place

Decompose opens a Thing onto its definition itself (`src/core/openDefinitions.js`); nothing is copied. The instance carries `openDefinition: { index, offset }`, and the definition graph at that index is projected into whatever web is being viewed.

- **Reading: the canvas sees each web as viewed.**
  - `projectGraphView(state, graphId)` returns the web with every open definition's instances (shifted by the box's offset), connections and groups added, plus one synthetic group per open box (`open:<anchorId>`, `isOpenDefinition: true`).
  - An open box's anchor is flagged `isGroupAnchor` in the view only, so it hides behind the shell.
  - NodeCanvas's `graphsMap.get` and `edgesMap` both go through it (`createGraphViewMap`, `viewEdges`). Code that reads `useGraphStore.getState().graphs.get(...)` directly sees the raw web and misses open boxes; use `projectGraphView` there.
  - With nothing open, the raw graph comes back unchanged, so the view costs nothing until a box is opened.
- **Writing: store actions route by owner.**
  - The instance actions take the viewed web's id, as before. `updateNodeInstance`, `updateMultipleNodeInstancePositions`, the removes and `addEdge` find the graph each instance really lives in and write there, in that graph's coordinates.
  - A batch that moves everything inside a box moves only the box's offset, so the definition's arrangement (and every other place it shows) stays put.
  - Group actions given an `open:` id do the right thing: rename or recolour the Thing, add nodes into the definition, and close on combine or delete.
- **Connections across a box's edge** live in the outer web, with `sourceVia` / `destinationVia` naming the boxes the end is reached through. With the box closed they are drawn to the Thing's node (`openView.edges`); nothing is rewritten.
- **One opening per view.** A definition opens once per web and never inside itself, so every drawn instance id is unique.
- **The setting.** Settings › Panels › "Decompose Into The Definition" (`openDefinitionsInPlace`, default on). Off, Decompose copies into a node-group as before (`actions/expandInPlace.js` chooses).
- **The morph.** Opening and combining animate (`groups/boxMorph.js`), in the DOM like the connection transitions: the store writes at once, and a stand-in carries the node's card, interior, title and content to the box's band, interior, tab and 1:1 nodes (or back) while the real elements wait hidden. A preview's drawing is carried as one matrix, which works because the preview is the canvas under a `scale()`. Both ends are read from the DOM, so the morph never duplicates layout. Connections crossing the box's edge stay attached: `groups/boxMorphConnections.js` redraws each one every frame from its resting geometry (`settledConnectionGeometry`), riding the stand-in's outline and sliding onto the node inside it ends on, so at either end it is exactly what the canvas draws. Labels ride along each connection's middle, the before and after labels crossfading; an outside end the canvas culled is sized from the store. The title takes the destination's wrapping in the first 15% of the morph's time, so a long name never hangs off a shrinking node. After Decompose Further the camera brings the whole box into view (`frameBoxInViewWith` in `camera/framing.js`): nudged if it fits at the current zoom, zoomed out to fit if not, never zoomed in; recomposing a plain node waits on focus-on-select. Call `withBoxOpenMorph` / `withBoxCloseMorph` around the store write (`expandNodeInPlace` and the group panel's Combine do); F41 covers it.
- **Old copy-style boxes** keep working. Closing one saves only what changed, keeps both definitions if the definition changed elsewhere meanwhile (`definitionFingerprint`), and carries its outside connections into the definition instead of collapsing them onto the node.

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
