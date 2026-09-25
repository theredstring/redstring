# Sweep 5: nine more small-input blocks

**Status:** done (orchestrator). Branch `refactor/sweep5`.

Verbatim moves by the P5.01a method. One addition: helpers declared at NodeCanvas.jsx's module level (e.g. `decodeThumbnail`) are passed through `ctx` too.

| Block | Now | Inputs |
|---|---|---|
| `nodes` memo | `components/canvas/data/canvasNodes.js` `computeCanvasNodes` | 7 (incl. P1.08's stability refs) |
| `baseDimsById` memo | same file, `computeBaseDims` | 3 |
| `recordTrackpadZoomSample` | `components/canvas/camera/momentum.js` `recordTrackpadZoom` | 2 |
| `startPanMomentum` | same file, `runPanMomentum` | 7 |
| `startZoomMomentum` | same file, `runZoomMomentum` | 9 |
| `navigateToPrototypeInstances` | `camera/navigateToInstances.js` | 8 |
| `runWizardIntent` | `actions/wizardIntent.js` | 5 |
| `handleNodeGroupDiveIntoDefinition` | `actions/nodeGroupDive.js` | 7 |
| `handleNodeSelection` | `actions/plusSignSelection.js` | 8 |

- The momentum functions are the first pieces of P4.02's camera controller to leave NodeCanvas. They keep their refs-and-setters signature until the controller owns them.
- 40 tuning-constant imports that only the momentum code used were pruned from NodeCanvas.
- NodeCanvas.jsx: 12,796 → **12,204**.

## Verification
- No late bindings in either memo. No `ctx` name is assigned in any moved body (scan).
- `test:ci` PASS. `lint:undef` PASS. Playwright 58 passed. `npm run build` passes.
- **Perf** (chambers, 3 runs): S1, S1t, S2, S3 and S4 commits, NodeCanvas renders and wall time are unchanged.
- **Discrimination:** with `runPanMomentum` disabled, F2 (drag-pan glide) and F10 (touch pan glide) fail.
