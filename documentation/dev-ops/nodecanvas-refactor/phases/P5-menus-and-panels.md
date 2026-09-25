# P5: Pie menu, carousel and abstraction state machine; control panels and other hosts (DRAFT: refine at kickoff)

**Goal.** Untangle the one cluster rated C in F-48. The pie menu, the abstraction carousel and the abstraction prompt behave as a single implicit state machine. That behaviour is spread across:
- the effects at ~13690–13840
- the graph-change cleanup at ~7756
- a ~90-line inline `onExitAnimationComplete` at ~17577
- the pie→state sync effect at ~9777

Then move out the control panels and the remaining hosts. About 2,500 lines are involved.

**This is UX-critical.** The animations and transitions are part of the design. The design card, P5.02a, is reviewed by Grant before anything is implemented.

**Exit criteria.**
- The pie, carousel and control-panel behaviour is an explicit machine with documented states.
- There are no effect cascades left.
- The control panels, colour pickers, wizard and prompts live in hosts.
- S6 and S12 meet their targets.
- F6, F9 and F12 pass.

**Kickoff checklist.**
1. Re-verify F-06, F-08, F-09 and F-27.
2. Record S6 and S12, and screen-capture the pie→carousel, pie→decompose and pie→prompt transitions as the visual reference.

---

### P5.01: Pure button builders
- **Status:** part a done (reports/P5.01a.md): the four memos are builder functions in `components/canvas/pie/`, moved verbatim; button sets identical in six states. Open (P5.01b): actions reading state at fire time; the control panels calling the builders. **P5.01b deferred (D-28)**: structural only. The control panel already pages through `nodePieMenuPages`.
- **Lane:** B, then A · **Size:** L
- **Findings:** F-08
- **Change:**
  - Replace these memos with builder functions in `src/components/canvas/pie/`:
    - `nodePieMenuPages`
    - `targetPieMenuButtons` (with its carousel and decompose sets)
    - `edgePieMenuButtons`
    - `decomposePanelInfo`
  - The builders take ids and the current mode, and return button specs.
  - Their actions read state at the moment they fire (`getState()`, commands), not through closures over render state.
- **Accept:**
  - The button sets are identical to the reference.
  - `NodeControlPanel` and `ConnectionControlPanel` can call the builders themselves.

### P5.02a: Lifecycle design (Grant reviews)
- **Status:** done (wave 6): `reports/P5.02a.md` (current machine, 17 transitions, findings NEW-1…8, the reducer design and a 12-step order). Per D-24 the orchestrator answered its questions (D-25).
- **Lane:** docs · **Size:** M
- **Change:**
  - Write down the current machine:
    - pie opening, open and closing
    - transitions from the pie to the carousel, to decompose and to the prompt
    - carousel entering, visible and exiting, with stage 1 and stage 2
    - the control-panel show/visible latches
    - what graph-change cleanup resets
  - Propose an explicit states-and-events design, and add it to this file.
- **Accept:** Grant approves it.

### P5.02b: Implement the machine
- **Status:** done except the deferred steps (wave 6).
  - Step 0 (`reports/P5.02-step0.md`): `test/e2e/canvas/lifecycleTrace.js`, flows F33–F37, 17 baseline traces in `test/e2e/canvas/lifecycle-baselines/` (byte-identical run to run; `zz-lifecycle-baseline.pw.js` with `LIFECYCLE_BASELINE_DIR` checks a recording may only drop states).
  - Steps 2–3 (`reports/P5.02b-steps2-3.md`): `components/canvas/pie/pieMachine.js` (`reducePie`, a commit-loop replay of the lifecycle effects, 73 unit tests) and `dispatchPie` + command runner in canvasUIStore (17 tests).
  - Step 1: the dead click-away flag and `onAutoClose` deleted.
  - Step 4: the node pie's exit, the carousel's entered / close / touch-close / exited callbacks dispatch to the machine (stable callbacks; the carousel's exit timer no longer restarts on a web change, the one intended timing change). The click guard, pending Swap, exit-in-progress, close-requested and return-focus state moved to the store (`storeFieldRef` keeps the `.current` call sites). NodeCanvas registers one command handler (Swap, return framing, local resets); its other lifecycle effects still run and converge on the same values. All 17 traces pass the drop-only comparison; all flows pass; S6 12 NodeCanvas renders (unchanged), S12 17 (18).
  - Step 5: every lifecycle write outside the effects is an event: the pie builders (Decompose, Abstraction, Back, Swap, Plus, Delete, Expand, Ask The Wizard, stage-2 Back, Add Above/Below, Compose, the decompose-further buttons, Delete / Duplicate / Orbit), the context menu (Decompose, Generalize, Delete, Color, Orbit), the node panel (Decompose, Generalize, Compose, Decompose Further), the abstraction prompt's submit and cancel, touch target writes, the Wizard's select-node, orbit enter/exit, and the defensive carousel teardowns. Builders dispatch through the store instead of taking lifecycle setters. Traces: drop-only; all flows pass.
  - Step 6: the selection → pie effect and the prompt-stage effect are gone. canvasUIStore's `setSelectedInstanceIds` dispatches `SELECTION_CHANGED` on a real change, and the marquee dispatches `MARQUEE`; the machine applies the rule in the same write. S6 12 → 10 NodeCanvas renders, S7 7 → 6. Traces drop-only; all flows pass.
  - Steps 7–8 (together: the effect-based watchdog would otherwise write the transition flag without the reset reacting): the graph-change cleanup and close-all effects are one `GRAPH_CHANGED` dispatch on `activeGraphId`; the watchdog, page reset (`pieMenuPage` now in canvasUIStore), colour-picker close, vision-hover clear and close-request reset effects are gone, all replayed by the machine. S6 20 commits / 10 NodeCanvas / **23.8 ms** (P0: 62.8 ms), S12 17 NodeCanvas / 81 ms. Traces drop-only; all flows pass.
  - Step 11: NEW-2 and NEW-4 fixed (B-18, B-19; f29d0e5), with F34, F35, the machine tests and the two lifecycle baselines updated.
  - Deferred (D-28): step 9 (the panels' effects into the machine), step 10 (the pie data rebuild into the layer: it reads the carousel's per-frame focused-node size, which lives with the pie data) and the camera framing effects as `frame` commands.
- **Lane:** A + B · **Size:** XL (**split**)
- **Findings:** F-08, F-09, F-27
- **Change:**
  - A reducer (or a small machine) plus a UI-store slice, following P5.02a.
  - Remove:
    - the pie→state sync effect (~9777)
    - the selection→pie effect chain (~13690–13840)
    - the parts of graph-change cleanup that the machine now owns
  - Move the inline `onExitAnimationComplete` logic into machine transitions.
- **Accept:** F6 and F9 pass, the transitions match the reference captures, and S6 meets its target.

### P5.03: `NodePieMenuLayer` / `EdgePieMenuLayer`
- **Status:** done (wave 6): `NodePieMenuLayer` is memoized and the edge menu renders a memoized PieMenu with a stable exit callback. S6: the node pie renders 12 → 6 times (F-83). The edge pie's buttons and open framing are hooks in `pie/edgePie.js`.
- **Lane:** A + B · **Size:** M
- **Findings:** F-27
- **Change:**
  - Memoized layers with stable callbacks, so PieMenu's `animationend` listeners stop re-subscribing.
  - Wrap PieMenu in `memo`.
- **Accept:** While a menu is open, an unrelated NodeCanvas render does not touch PieMenu.

### P5.04: Carousel host
- **Status:** part a done (reports/P5.04a.md): per-frame scale/size are refs, the pie data rebuilds directly, and `NodePieMenuLayer` reads it; S12 NodeCanvas 148 → 18. Open: the host itself (physics, dimension handlers, `AbstractionControlPanel`), after P5.02a. **Part b (wave 6):** the carousel's callbacks and axis handlers are plain functions in `carousel/carouselActions.js`; the axes (`abstractionDimensions`, `currentAbstractionDimension`) are in canvasUIStore, and the hosts read them directly. The carousel's own physics stays in `AbstractionCarousel.jsx`; its focused-node scale and size feed the pie's layout, so they stay with the pie data.
- **Lane:** A + B · **Size:** L
- **Findings:** F-06
- **Change:**
  - The carousel physics and focused-node dimensions live inside the host.
  - The host exposes only the public mode flags in the UI store.
  - Move the abstraction-dimension handlers and `AbstractionControlPanel` along with it.
- **Accept:** S12 causes no per-frame NodeCanvas commits. F9 passes.

### P5.05: Control-panel hosts
- **Status:** part a done (wave 6): the eight show/visible latches live in canvasUIStore; `components/canvas/hosts/ControlPanelsHost.jsx` holds the node, group, connection and abstraction panels and their management effects (moved verbatim; the marquee check reads `marqueeActive`), subscribing to what those effects react to. NodeCanvas passes the panels' handlers and derived data as `controlPanelsCtx` and no longer subscribes to the five panel settings. Lifecycle traces: the store view is drop-only in all 17 scenarios, and each panel's own show/hide sequence is identical; the one difference is that a panel can mount or unmount one commit apart from the pie (the host renders from its own subscription), which is at most a frame between two 200–300 ms animations. Checked with `test/e2e/canvas/lifecycleTraceViews.py`. All flows pass (F35 once flaky under load, 3/3 alone). Open (part b): the panel handlers and derived data (`useControlPanelActions`, the group-panel handlers, `nodePrototypesForPanel`, `decomposePanelInfo`) into the host; the edge pie latch with P5.03. **Part b done (wave 6):** `useControlPanelActions`, the group and node-group panel handlers, Copy/Duplicate, the exit callbacks and the exit-animation latches moved into ControlPanelsHost.
- **Lane:** A + B + C (`useControlPanelActions`) · **Size:** L
- **Change:**
  - Node, group, connection and abstraction panels move to App-level hosts that use the builders and the UI store.
  - Replace the 22-setter bundle in `useControlPanelActions` with store actions and commands.
  - Move the show/visible exit-animation latch into each host.
- **Accept:** Every control-panel action works, and the panels animate the same way.

### P5.06: Remaining hosts
- **Status:** part a done (wave 6): the JSX moved verbatim into `hosts/PromptsHost.jsx` (swap, new Thing, connection, node-group and Add Above/Below prompts) and `hosts/CanvasOverlaysHost.jsx` (the carousel, the three colour pickers, the add-to-group and self-loop confirmations and the Wizard picker), each taking NodeCanvas's state and handlers as `ctx`. Traces: drop-only in both views (panels excluded, as for P5.05a); all flows pass. Open (part b): the prompts', pickers', dialogs' and Wizard's state and handlers into the hosts, so NodeCanvas stops holding them. **Part b done (wave 6):** Ask The Wizard (`wizard/`), the three colour pickers (`colorPickers/`, flow F38), the prompts' handlers and one-shot suggestions (PromptsHost), and the two confirmations (`dialogs/`, flow F40) left NodeCanvas.
- **Lane:** A + B · **Size:** L (**split**)
- **Change:**
  - `ColorPickerHost` covers the dialog, pie and edge pickers.
  - `WizardHost` covers the picker, the intent modal and the API-key gate.
  - `PromptHosts` covers:
    - the connection-name, node-group and swap prompts (with `performInstanceSwap`)
    - the node-name prompt together with the plus sign and one-shot suggestions
    - the abstraction prompt, through the machine
    - the self-loop dialog and the add-to-group dialog
- **Accept:** F5, F6, F14 and the prompt flows pass.

### P5.07: Context-menu builders
- **Status:** builders done (reports/P5.07.md): verbatim move into `components/canvas/menus/contextMenus.jsx`; F12 passes. Open: actions through commands / `getState()`. **Actions through commands deferred (D-28)**: structural only.
- **Lane:** A + B · **Size:** M
- **Change:** `getCanvasContextMenuOptions` and `getContextMenuOptions` become pure builders plus commands.
- **Accept:** F12 passes.

### P5.08: Semantic orbit module
- **Status:** done (wave 6): `orbit/semanticOrbit.jsx` (`useSemanticOrbit`): candidates and loading, the dim rect, the fetch, leaving orbit, placing a candidate, and `renderOrbitOverlay`. Flow F39.
- **Lane:** A + B · **Size:** L (about 560 lines)
- **Change:**
  - The orbit state, data fetch, dim rect, overlay SVG and portal become an orbit component or host.
  - The active flag lives in the UI store.
- **Accept:** Orbit enters and exits the same way. The pie menu hides and restores as before.
