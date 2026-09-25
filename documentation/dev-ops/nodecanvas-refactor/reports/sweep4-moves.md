# Sweep 4: six blocks move out of NodeCanvas; B-16

**Status:** done (orchestrator). Branch `refactor/sweep4`.

## Moves (780e19d)
These are verbatim moves by the P5.01a method:
- free variables found by ESLint in isolation (`no-undef` plus `react/jsx-no-undef`);
- NodeCanvas's imports copied across with rewritten paths;
- no `ctx` name assigned in the body (a scan over every extracted module, P5.01a/P5.07 included, found none);
- a temporal-dead-zone check. Only a `useMemo` evaluates its `ctx` during render; a `useCallback` or plain function builds it when called.

| Block | Now | Inputs |
|---|---|---|
| `handleOrbitItemClick` | `components/canvas/orbit/orbitActions.js` `placeOrbitCandidate` | 7 |
| `startHurtleAnimation` | `components/canvas/camera/hurtle.js` `startHurtle` | 8 |
| `handleBackToCivilizationClick` | `components/canvas/camera/backToCivilization.js` | 10 |
| `handleNodeConvertToNodeGroup` | `components/canvas/actions/nodeGroupConversion.js` | 11 |
| `cleanLaneOffsets` (memo) | `utils/canvas/cleanLaneOffsets.js` `computeCleanLaneOffsets` | 11 |
| `handleAbstractionSubmit` | `components/canvas/actions/abstractionSubmit.js` `submitAbstraction` | 12 |

**Not moved:** blocks whose input bags would be 19 or more (`runCulling`, the focus framers, `labelCrossingIndex`, `selectedEdgeMidpoint`). F-41/F-42 argue against parameter bags; these go with their controller or layer cards (P3.11, P4.02, P3.05/06).

NodeCanvas.jsx: 13,742 → **13,073**.

## Coverage for moved code with no flow (d9164f6)
- **F30:** pan clear of every node; the back-to-civilization pill appears, and clicking it brings the nodes back. Fails with a no-op handler.
- **F31:** carousel Plus → Add Above → a named concept joins the chain above the focused one. Fails with a no-op submit; passes on the wave5 tip.
- **Unit tests:** `computeCleanLaneOffsets`, and `placeOrbitCandidate` against the real store. Orbit needs live Wikidata, so it can't be an e2e flow.

## B-16, found by the orbit test (0e03477)
- `addNodePrototype` saves a new prototype by default. Four places then called `toggleSavedNode` on the fresh prototype *intending* to save it ("Auto-save semantic nodes to Library"), which **unsaved** it and scheduled an orphan cleanup:
  - orbit placement: the concept and its predicate node
  - the canvas drop of a semantic concept
  - the discovery panel's add
- Each now saves only if not already saved.
- The toggle predates the refactor. The prototype default changed under it at some point.

## Verification
`test:ci` PASS, `lint:undef` PASS, Playwright **58** passed, `npm run build` passes.
