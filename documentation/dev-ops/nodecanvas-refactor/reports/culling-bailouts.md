# Culling bailouts (F-79, continued)

**Status:** done (orchestrator). Branch `refactor/sweep3`.

After P5.04a, `--explain` showed bailouts left in S1 (3), S1t (3) and S10a (11). All of them were `runCulling`'s `setVisibleNodeIds(fn)` / `setVisibleEdges(fn)`.
- The updaters already returned `prev` when membership was unchanged. But a set made from the post-render culling pass can't take React's eager bailout, so each one re-ran NodeCanvas for nothing (F-79's mechanism).
- **Fix:** both use `useTrackedState`, which runs the updater against the last value set and skips an unchanged result. The updaters are pure, so running them at call time is equivalent. All three writes go through the setter.

| Scenario (chambers, profile build, 3 runs) | Before | After |
|---|---|---|
| S1 drag-pan | 6 commits, NodeCanvas 6 (3) | **3, 3 (3)** |
| S1t touch pan | 7, 7 (4) | **4, 4 (4)** |
| S10a thumbnails on the active graph | 40, 36 (25) | **32, 25 (25)** |
| S2 wheel zoom | 6, 2 (2) | 6, 2 (2) |

**Verification:** `test:ci` PASS, `lint:undef` PASS, Playwright 56 passed. `--explain` shows no NodeCanvas bailouts in S1, S1t or S10a.

**Other `return prev` updaters in NodeCanvas:** `setConnectionNamePrompt` and `setAbstractionPrompt`. They're rarely written, so they're left as they are.
