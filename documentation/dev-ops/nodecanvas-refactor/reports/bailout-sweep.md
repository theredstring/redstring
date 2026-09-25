# Bailout sweep: same-value sets, dead locals (+ `--explain` names every update)

**Status:** done (orchestrator). Branch `refactor/sweep2`.

After the render sweep, S5 still had NodeCanvas **run 41 times but render only 21**. The other 20 were bailouts: React called NodeCanvas's function (about 1,270 hooks), found nothing had changed and threw the result away. The same thing happened in S6 (4 of 17) and S7 (2 of 9).

## Why they happened
A bailout with no update of its own is React re-running an update the previous render skipped:
1. A pointer event changes the selection. zustand's `useSyncExternalStore` schedules that as a **sync** render.
2. In the same event, or in an effect right after it, NodeCanvas also sets some state to the value it already has, for example `hoveredEdgeInfo = null`.
3. After a component has rendered from an update, React's eager same-value check stops working until the next render, so the set is queued at a lower lane.
4. The sync render skips it. React then renders again just for it, finds the same value and bails out.

So every "reset" that runs on each selection change, pointer release or pie change cost a thrown-away NodeCanvas run, even when there was nothing to reset.

## Tooling (35319ed)
`--explain` shows `[set: …]` on each commit: every update made since the previous commit.
- **Named setters:** the explain build wraps each `useState` setter in NodeCanvas and `hooks/`.
- **zustand notifies:** a selector whose result changed, shown by its source text.
- **React's own dispatches** (`dispatchSetState`, `dispatchReducerAction`, `forceStoreRerender`) aimed at NodeCanvas, with the caller from the stack. These are patched into the 18.3 profiling build; the build fails if the patterns stop matching.

A bailout line with nothing in it means: look at the sets on the commit before it.

## Changes
1. **Hover and orbit resets (3d1f082).**
   - `clearHoverImmediate` runs on every mouse move and set `hoveredEdgeInfo` to null each time. `useHoverIntent` is the only writer of a non-null value, so it now tracks what it last wrote and skips a null-over-null set. NodeCanvas's own reset on graph change also writes null, so at worst the hook writes once more than it needs to.
   - The orbit search effect reset `orbitData`/`orbitLoading` on every selection change. The setters now track their last requested value, pending updates included. A guard on the last *committed* value would have been wrong: a `setOrbitLoading(true)` still pending at a lower lane could land after a skipped reset and leave the spinner on.
   - The line budget was paid for by pruning 70 unused imports (22 lines). Every module dropped entirely is imported elsewhere (`folderPersistence`, `fileAccessAdapter`, `historyStore`) or side-effect free (`lucide-react`, `SelfLoopEdge`, `PanelIconButton`).
2. **Dead locals (16ae8e9).** Three store subscriptions nothing read: `activeDefinitionNodeId`, `savedGraphIds` (so bookmarking a graph re-rendered NodeCanvas) and `universeLoadingError`. Also `wrapperRef`, the `activeGraphData → projectTitle/projectBio` chain, `handleSaveNodeData`, `handleProjectBioChange`, `lineIntersectsRect`, `isEdgePanningRef`, `gestureActive`, `currentText` and `setIsHeaderEditing`. The 16 `no-unused-vars` left are callback parameters and catch bindings, kept on purpose.
3. **`useTrackedState` (9fc70dc).** `src/hooks/useTrackedState.js` is a `useState` whose setter skips the value it was last given (pending updates included). Updater functions receive that value too, and every write must go through the setter.
   - Used for the pie colour picker (`pieMenuColorPickerVisible`, `activePieMenuColorNodeId`), `pieMenuPage` and the eight control-panel visible/should-show flags. Effects reset all of these on every selection or pie change.
   - `setIsPanning` already tracked its last value in a ref; it now skips an equal one.
   - Three comment-only effects were deleted.
   - The unit test shows the mechanism: in jsdom, a plain `useState` re-runs the component on the second same-value set; `useTrackedState` doesn't.

## Numbers (chambers, profile build, 3–5 runs)
| Scenario | NodeCanvas ran (rendered) before | After |
|---|---|---|
| S4 node drag | 4 (3) | **3 (3)** |
| S5 marquee | 41 (21) | **21 (21)** |
| S6 pie open/close | 17 (13) | **13 (13)** |
| S7 select (both routings) | 9 (7) | **7 (7)** |

No NodeCanvas bailouts are left in S5, S6 or S7. Total-ms moved within run-to-run noise, so no timing claim is made. The runs saved are whole NodeCanvas runs, so the gain grows with how much the render does.

NodeCanvas.jsx: 15,555 → **15,491** lines.

## Verification
- `test:ci` PASS (68 known, 0 new). `lint:undef` PASS. Playwright 55 passed, after each stage.
- **Discrimination:** F7 ("moving off clears it") fails when the hover guard is mutated to skip every null set, and passes with the real guard.
- The explain build shows no `NC bailout` lines in S5, S6 or S7.

## Seen but left alone
- **B-03** (`openOnboardingModal` calls an undefined setter; the Help menu's onboarding item does nothing). Still open under D-17, which needs Grant's welcome-screen decision.
- **A `console.log` in the pie-visibility effect** runs on every selection change. It's cheap, but it's noise; it belongs with P5's pie lifecycle work.
