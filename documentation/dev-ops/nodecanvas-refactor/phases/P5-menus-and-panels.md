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
- **Status:** part a done (reports/P5.01a.md): the four memos are builder functions in `components/canvas/pie/`, moved verbatim; button sets identical in six states. Open (P5.01b): actions reading state at fire time; the control panels calling the builders.
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
- **Status:** in progress (wave 6).
  - Step 0 (`reports/P5.02-step0.md`): `test/e2e/canvas/lifecycleTrace.js`, flows F33–F37, 17 baseline traces in `test/e2e/canvas/lifecycle-baselines/` (byte-identical run to run; `zz-lifecycle-baseline.pw.js` with `LIFECYCLE_BASELINE_DIR` checks a recording may only drop states).
  - Steps 2–3 (`reports/P5.02b-steps2-3.md`): `components/canvas/pie/pieMachine.js` (`reducePie`, a commit-loop replay of the lifecycle effects, 73 unit tests) and `dispatchPie` + command runner in canvasUIStore (17 tests).
  - Step 1: the dead click-away flag and `onAutoClose` deleted.
  - Step 4: the node pie's exit, the carousel's entered / close / touch-close / exited callbacks dispatch to the machine (stable callbacks; the carousel's exit timer no longer restarts on a web change, the one intended timing change). The click guard, pending Swap, exit-in-progress, close-requested and return-focus state moved to the store (`storeFieldRef` keeps the `.current` call sites). NodeCanvas registers one command handler (Swap, return framing, local resets); its other lifecycle effects still run and converge on the same values. All 17 traces pass the drop-only comparison; all flows pass; S6 12 NodeCanvas renders (unchanged), S12 17 (18).
  - Step 5: every lifecycle write outside the effects is an event: the pie builders (Decompose, Abstraction, Back, Swap, Plus, Delete, Expand, Ask The Wizard, stage-2 Back, Add Above/Below, Compose, the decompose-further buttons, Delete / Duplicate / Orbit), the context menu (Decompose, Generalize, Delete, Color, Orbit), the node panel (Decompose, Generalize, Compose, Decompose Further), the abstraction prompt's submit and cancel, touch target writes, the Wizard's select-node, orbit enter/exit, and the defensive carousel teardowns. Builders dispatch through the store instead of taking lifecycle setters. Traces: drop-only; all flows pass.
  - Step 6: the selection → pie effect and the prompt-stage effect are gone. canvasUIStore's `setSelectedInstanceIds` dispatches `SELECTION_CHANGED` on a real change, and the marquee dispatches `MARQUEE`; the machine applies the rule in the same write. S6 12 → 10 NodeCanvas renders, S7 7 → 6. Traces drop-only; all flows pass.
  - Next: 7 (cleanup), 8 (small effects), 9 (panels), 10 (pie data into the layer), 11 (bug fixes NEW-2, NEW-4).
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
- **Lane:** A + B · **Size:** M
- **Findings:** F-27
- **Change:**
  - Memoized layers with stable callbacks, so PieMenu's `animationend` listeners stop re-subscribing.
  - Wrap PieMenu in `memo`.
- **Accept:** While a menu is open, an unrelated NodeCanvas render does not touch PieMenu.

### P5.04: Carousel host
- **Status:** part a done (reports/P5.04a.md): per-frame scale/size are refs, the pie data rebuilds directly, and `NodePieMenuLayer` reads it; S12 NodeCanvas 148 → 18. Open: the host itself (physics, dimension handlers, `AbstractionControlPanel`), after P5.02a.
- **Lane:** A + B · **Size:** L
- **Findings:** F-06
- **Change:**
  - The carousel physics and focused-node dimensions live inside the host.
  - The host exposes only the public mode flags in the UI store.
  - Move the abstraction-dimension handlers and `AbstractionControlPanel` along with it.
- **Accept:** S12 causes no per-frame NodeCanvas commits. F9 passes.

### P5.05: Control-panel hosts
- **Lane:** A + B + C (`useControlPanelActions`) · **Size:** L
- **Change:**
  - Node, group, connection and abstraction panels move to App-level hosts that use the builders and the UI store.
  - Replace the 22-setter bundle in `useControlPanelActions` with store actions and commands.
  - Move the show/visible exit-animation latch into each host.
- **Accept:** Every control-panel action works, and the panels animate the same way.

### P5.06: Remaining hosts
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
- **Status:** builders done (reports/P5.07.md): verbatim move into `components/canvas/menus/contextMenus.jsx`; F12 passes. Open: actions through commands / `getState()`.
- **Lane:** A + B · **Size:** M
- **Change:** `getCanvasContextMenuOptions` and `getContextMenuOptions` become pure builders plus commands.
- **Accept:** F12 passes.

### P5.08: Semantic orbit module
- **Lane:** A + B · **Size:** L (about 560 lines)
- **Change:**
  - The orbit state, data fetch, dim rect, overlay SVG and portal become an orbit component or host.
  - The active flag lives in the UI store.
- **Accept:** Orbit enters and exits the same way. The pie menu hides and restores as before.
