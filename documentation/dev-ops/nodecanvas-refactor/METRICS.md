# Metrics

**Primary metrics (D-03).** For each scenario, measure:
- NodeCanvas commits
- total commit ms
- max commit ms
- once layers exist, commits per layer

**Fixtures (D-15).**
- **"medium" means `chambers`:** the local snapshot of Claude's Chambers. Run on its graph with 54 instances, 40 edges and 13 groups. Where a scenario needs a different graph (e.g. S11), it names one. When the local file is absent, fall back to `stress` and note the fallback.
- **"large" means `stress`:** the synthetic ~600-node graph, used to find scaling cliffs.

**How to measure.** Use a **profiling production build** with the medium fixture, unless the scenario says otherwise. Take the median of 5 runs. Until P0.04 lands, do it manually:
1. Open React DevTools Profiler.
2. Record the scenario.
3. Count the NodeCanvas commits and read their durations.
4. Note in the Method column that the measurement was manual.

## Scenarios

Every card names the scenarios it affects. Keep their definitions stable: if you change one, add a new ID instead.

| ID | Scenario | Steps | Fixture |
|---|---|---|---|
| S1 | Drag-pan | Mouse-drag on empty canvas for 2 s, then release (momentum included) | medium |
| S1t | Touch pan | One-finger pan for 2 s (touch emulation) | medium |
| S2 | Wheel zoom | 10 wheel notches in, then 10 out, over the canvas centre | medium |
| S3 | Trackpad-style zoom | Ctrl+wheel with fractional deltas at 60 Hz for 1.5 s | medium |
| S4 | Node drag | Press a node, wait out the lift delay, drag 400 px over 1 s, release | medium |
| S5 | Marquee | Drag-select across about 30 nodes, then release | medium |
| S6 | Pie open/close | Click a node until its pie menu is open, then click empty canvas | medium |
| S7 | Select node, labels on | Click a node with connection labels on, in a routed style (lombardi, then manhattan) | medium |
| S8 | Hover sweep | Move across 10 edges and 10 nodes, pausing more than 180 ms on each | medium |
| S9 | Panel resize | Drag the right panel resizer 300 px | medium |
| S10a | Thumbnail burst, on the graph | 20 `imageCache.setImage` calls for prototypes on the active graph | medium |
| S10b | Thumbnail burst, off the graph | 20 `setImage` calls for prototypes **not** on the active graph | medium |
| S11 | Write to another graph | 10 `updateGraph` calls on a graph that isn't active | medium |
| S12 | Carousel | Open the abstraction carousel, scroll 3 steps, close it | medium |
| S13 | Hurtle | Expand a node's definition through the hurtle path | medium |
| L-* | Large-universe runs | S1, S4, S6, S7 repeated on the large fixture | large |

## Baseline

Filled in by P0.04; details and method are in reports/P0.04.md.
- **Profile build.** Median of 5 runs.
- **Pre-refactor:** the canvas files from f1f07dd.
- **Now:** c34b0ca, wave 2 up to P1.04.
- **Commits** count everything under NodeCanvas's Profiler, children included. **NodeCanvas ran (rendered)** counts the NodeCanvas function itself (F-73; single runs).
- **For each card,** run `npm run perf:canvas -- --scenario <ids>` before and after, and `--explain <id>` to see which state caused each render.

| Scenario | Fixture | Pre-refactor: commits · total ms · max ms | Now: commits · total ms · max ms | NodeCanvas ran (rendered), now |
|---|---|---|---|---|
| S1 | chambers (54) | 246 · 315.7 · 5.3 | 9 · 13.7 · 7.7 | 5 (3) |
| L-S1 | stress (606) | 160 · 898.7 · 11.2 | 14 · 64.8 · 12.6 |  |
| S1t | chambers (54) | 209 · 356.1 · 5.9 | 11 · 14.8 · 6.5 |  |
| S2 | chambers (54) | 9 · 13.2 · 7.1 | 9 · 9.5 · 3.2 |  |
| S3 | chambers (54) | 11 · 16.4 · 9.3 | 11 · 14.8 · 8.2 |  |
| S4 | chambers (54) | 18 · 55.6 · 13.2 | 16 · 34.8 · 10.8 | 7 (6) |
| L-S4 | stress (606) | 31 · 248 · 28.1 | 28 · 223.1 · 28.6 |  |
| S5 | chambers (54) | 100 · 244.6 · 8.9 | 52 · 141.9 · 9.5 |  |
| S6 | chambers (54) | 30 · 62.8 · 8.2 | 31 · 71.4 · 11 | 19 (17) |
| L-S6 | stress (606) | 29 · 141.7 · 15.1 | 30 · 139.4 · 14.3 |  |
| S7-lombardi | chambers (54) | 20 · 72.1 · 13.2 | 20 · 67.9 · 12.3 |  |
| L-S7-lombardi | stress (606) | 17 · 101.7 · 15.9 | 18 · 97.5 · 14.7 |  |
| S7-manhattan | chambers (54) | 21 · 57.2 · 13.7 | 20 · 54 · 13.2 |  |
| L-S7-manhattan | stress (606) | 18 · 103.4 · 13.7 | 18 · 97 · 14.3 |  |
| S8 | chambers (54) | 61 · 218.4 · 10.2 | 61 · 148.5 · 10.4 |  |
| S9 | chambers (54) | 71 · 206.7 · 9 | 71 · 186.7 · 8.4 | 65 (64) |
| S10a | chambers (54) | 47 · 87 · 8.3 | 48 · 85.3 · 9.1 | 47 (25) |
| S10b | chambers (54) | 40 · 57.1 · 5.3 | 41 · 52.5 · 4.4 |  |
| S11 | chambers (54) | 21 · 79.5 · 12.4 | 21 · 77.2 · 13.3 | 19 (10) |
| S12 | chambers (54) | 198 · 390.3 · 9.4 | 199 · 375.7 · 8.9 | 161 (155) |
| S13 | chambers (54) | 35 · 93.7 · 13 | 35 · 83.5 · 12 | 31 (30) → 8 (7) after P1.06 |

**Audit expectations vs measured:** see reports/P0.04.md.
- S1 was worse than guessed: 2 commits per frame.
- S6 is 19 NodeCanvas runs, not 5–8 (F-75).
- S9 is confirmed at one render per move.
- S10/S11 are a render plus a bailout per write.

## Per-task results

| Date | Task | Scenario | Before | After | Commit | Notes |
|---|---|---|---|---|---|---|
| 2026-09-23 | P0.01 | S1 (headless Chromium, profile build) | 126 commits for one pan | (baseline) | eb50e73 | Probe matched an independent counter 126/126 |
| 2026-09-23 | P1.01 | S1 / S1t (jsdom Profiler, 30 moves) | 60 commits | 0 | 013cfa8 | 2 commits per frame on the base (F-67). Test: src/NodeCanvas.renderBudget.test.jsx |
| 2026-09-23 | P1.07 | Render-time network requests (jsdom) | 3 POSTs | 0 | d26dc7a | debugLogSync removed from render |
| 2026-09-23 | P1.11 | keydown listener attachments over 5 re-renders | 4 → 9 | 4 → 4 | 9e4cdfe | Attaches once per mount |
| 2026-09-24 | P1.04 | S5 marquee (profile build, chambers) | 100 commits | 52 | 8702ad2 | Pre-refactor vs c34b0ca (also includes wave 1) |
| 2026-09-25 | P1.06 | S13 hurtle (profile build, chambers) | 35 commits, 31 NC runs, 75 ms | 12, 8, 29 ms | ebe2242 | Measured on integration just before and after the merge |
| 2026-09-25 | wave 1 + P1.03/04 | S1 drag-pan (profile build, chambers) | 246 commits, 316 ms | 9, 14 ms | c34b0ca | Browser confirmation of P1.01's jsdom result |

## Size history

The ratchet budget lives in `test/meta/nodecanvas-budget.json` once P0.07 lands. Lower it in the same commit that shrinks the file.

| Date | Commit | NodeCanvas.jsx lines | `//` comment lines | Note |
|---|---|---|---|---|
| 2025-10-23 | 48fb32f | 10,986 | — | initial release |
| 2026-09-09 | 071d5c3 | 20,519 | — | peak |
| 2026-09-23 | 1e6ab02 | 19,255 | 4,383 | audit baseline |
| 2026-09-23 | d55fe5b (wave 1 integration) | 18,518 | — | P1.01 + P1.07 + P1.02; budget lowered to 18,518 |
