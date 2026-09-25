# P4: Input controllers (DRAFT: refine at kickoff)

**Goal.** Move the ~5,600 lines of input and interaction code (about 29% of the file) out of NodeCanvas into proper boundaries:
- pure modules,
- a camera controller that isn't React, and
- a pointer-gesture state machine with stable handlers.

Collapse the duplication (F-43) and the parameter bags (F-41, F-42).

**Exit criteria.**
- No input hook is called with more than about 15 parameters.
- Mouse-up runs once per release.
- The constants are reconciled.
- Every P0 flow passes.
- Grant has completed the device checklist.

**Kickoff checklist.**
1. Get answers to Q5 (touch constants, F-44) and to F-45 (should trackpad pan-glide exist?).
2. Re-verify the parameter counts.
3. Re-read `useGamepad`'s control-object pattern. It is the template (F-41).

**Ordering constraints.**
- P4.01 comes before P4.02, P4.03 and P4.04.
- P4.02 comes before P4.04 and P4.06.
- P4.03 comes before P4.04.
- P4.04 comes before P4.05, P4.06 and P4.07.
- `isPanningOrZooming` is declared at ~9848 but captured at ~3500. The camera controller has to own it.
- `useCanvasTouch` currently relies on function-declaration hoisting to receive `handleMouseDown`/`Move`/`Up`.

---

### P4.01: Pure modules and constant reconciliation
- **Status:** parts a and b done (reports/P4.01a.md, P4.01b.md): `inputTuning.js`, `clampPan` (4 identical copies), `clientToCanvas` (17 copies), `edgeHitTest.js`, `canvasHitTest.js`, all with unit tests. Open: `zoomAboutAnchor` and the non-identical `clampPan` copies (their shapes differ; they go with P4.02's single camera write path), and the Q5 touch-constant reconciliation.
- **Lane:** B, then A · **Size:** M
- **Findings:** F-43, F-44
- **Change:**
  - `src/utils/canvas/viewportMath.js`:
    - `clampPan`, replacing 15+4 copies
    - `clientToCanvas`, replacing 16 inline copies
    - `zoomAboutAnchor`
  - `src/utils/canvas/canvasHitTest.js`:
    - `findNodeAtClientPoint`, which reads the container rect once
    - `findGroupTitleAtPoint`, `selectionFromRect`, `findConnectionDropTarget`, `buildGroupDragOffsets`
  - `src/utils/canvas/edgeHitTest.js`:
    - `findNearestEdgeAtCanvasPoint`, a 207-line pure function with about 17 inputs
    - `getEdgeHitThreshold`
  - `src/utils/canvas/input/inputTuning.js`:
    - the module constants (~462–689)
    - `measureTrackpadZoomVelocity`
    - the glide math
  - Reconcile the touch constants according to the answer to Q5.
- **Accept:**
  - Unit tests exist for each module.
  - Each duplicated copy is replaced by an import.
  - F2, F3, F7 and F10 pass.

### P4.02: `CameraController`
- **Status:** part a done (wave 6): `components/canvas/camera/cameraController.js`, `createCameraController(ctxRef)`. It owns the pan and zoom momentum refs, view-motion sampling, trackpad zoom smoothing and glide, the wheel-burst rect cache, `handleWheel`, the wheel guard and the Safari gesture listeners, all moved verbatim; NodeCanvas creates it once and keeps name-for-name aliases. Its context (31 live values) is assigned during render, so effects in the same commit see that render's values as the old closures did. Unit tests (`test/components/cameraController.test.js`) include one that reads NodeCanvas's source and checks every name it takes from the camera exists (a missing one broke node clicks during the move; see F-81). All 60 flows pass; S1/S2/S3 unchanged (3 / 2 / 2 NodeCanvas runs). Open: one camera write path (clampPan shapes, zoomAboutAnchor), middle-mouse zoom, view restore on graph switch, and `isPanningOrZooming` as camera state (it is still NodeCanvas's ref, passed in).
- **Lane:** B, then A · **Size:** L (about 1,050 lines)
- **Findings:** F-43, F-45, F-46
- **Change:** A plain JS class in `src/utils/canvas/input/CameraController.js`, plus a thin `useCameraController` hook.
  - It owns:
    - pan momentum and view-motion sampling
    - zoom momentum
    - trackpad zoom smoothing and glide
    - `handleWheel` and the Safari gesture events
    - middle-mouse zoom, moved onto the synchronous zoom maths (F-46)
    - view restore and save on graph switch
    - the `busy` flag that replaces `isPanningOrZooming`
  - Its API:
    - `wheel(e)`
    - `gestureStart` / `gestureChange` / `gestureEnd`
    - `middleZoomBegin` / `middleZoomMove` / `middleZoomEnd`
    - `startPanGlide`, `startZoomGlide`, `stopAll`
    - `isViewMoving`, `sampleViewMotion`
  - All camera writes go through `transform`; there must be one write path.
  - Handle F-45 according to Grant's answer.
- **Accept:** Grant runs the device checklist (below) and pan and zoom feel identical.

### P4.03: `useConnectionDraw`
- **Lane:** B, then A · **Size:** M (about 360 lines)
- **Change:**
  - Move connection drawing: the DOM-bypass endpoint, detents, the edge-pan loop, `beginConnectionDrawFromNode` and keyboard pan-travel.
  - API: `begin`, `moveTo`, `reproject`, `cancel`, and `finish(clientX, clientY)` → `{ edge | selfLoop | none }`.
- **Accept:** F5 passes, including the self-loop case and drawing while the canvas edge-pans.

### P4.04: `usePointerGestures` state machine
- **Lane:** B, then A · **Size:** XL (**split at kickoff**)
- **Findings:** F-02, F-42, F-43
- **Change:**
  - States: idle → pressed (canvas | node | group | edge) → panning | marquee | drawingConnection | draggingNode | middleZoom → released.
  - It absorbs:
    - the shared gesture refs (MAP: "Shared gesture refs")
    - `handleNodeMouseDown`
    - the mechanics of `handleMouseMove` / `Down` / `Up`
    - the group-title input path from the JSX
  - Its handlers are stable (D-09).
  - **Release is idempotent per gesture id.** That fixes the 2–3 mouseup calls per release.
  - React-facing commands go through one `commandsRef`, in the gamepad style.
  - Low-frequency flags (`isPanning`, `drawingConnectionFrom`, marquee active) are exposed through the UI or viewport store.
- **Accept:** Every flow passes, and mouseup logic runs once per release (assert it with a counter in a test).

### P4.05: `resolveCanvasTap` policy
- **Lane:** B, then A · **Size:** M (about 280 lines)
- **Change:**
  - Move `handleCanvasClick` and the group-drop detection (~12054–12143) into a pure `resolveCanvasTap(snapshot) → action`.
  - Mouse and touch share it. Touch currently duplicates this logic (touch ~990–1040).
- **Accept:** Unit tests cover the tap-policy matrix. F14 passes. Tapping on touch behaves the same as clicking.

### P4.06: Re-plumb `useCanvasTouch`
- **Lane:** C + A · **Size:** L
- **Findings:** F-41, F-42
- **Change:**
  - Pass it the `gestures`, `camera` and `policy` APIs in place of the 73 parameters; target 15 or fewer.
  - Stop synthesising mouse events wherever the gesture machine can take touch input directly.
  - Remove the shadow long-press ref.
  - Update the touch tests.
- **Accept:** F10 passes and the touch tests pass. Grant checks touch on iOS and Android.

### P4.07: `useGamepadBindings`
- **Lane:** A + C · **Size:** M (about 280 lines)
- **Change:** The control objects become thin wrappers over `gestures`, `camera` and `connectionDraw`.
- **Accept:** Grant runs the gamepad items on the device checklist.

### P4.08: Reduce `useNodeDrag`'s parameters
- **Lane:** C + A · **Size:** L
- **Change:** Cut its inputs from 42 to 15 or fewer by:
  - reading from the stores and controllers directly
  - deleting the mirror refs NodeCanvas maintains only for it
  - dropping the re-aliasing of 12 return fields
- **Accept:** F1, F4 and F11 pass. S4 is unchanged or better.

### P4.09: Reduce `useCanvasKeyboard`'s parameters
- **Lane:** C + A · **Size:** M
- **Change:** Cut its inputs from 48 to 15 or fewer, using the stores, the camera and commands.
- **Accept:** F13 passes.

---

## Device checklist (Grant runs this after P4.02, P4.04, P4.06 and P4.07)

- **Mac trackpad:** two-finger pan, and glide after release. Pinch zoom, zoom smoothing, and glide after release. Pinch then pan without lifting.
- **Mouse:** wheel zoom by notches. Middle-mouse zoom, if enabled. Drag-pan with momentum.
- **iOS Safari / Capacitor:** one-finger pan, pinch, long-press drag, tapping nodes and edges, the plus sign, the pie menu.
- **Android:** the same items as iOS.
- **Electron:** smoke-test all of the above.
- **Gamepad:** pan, zoom, marquee, pie navigation, group drag, panel resize, header tab focus.
