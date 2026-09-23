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

This table is filled in by P0.04. Record the commit hash.

| Scenario | NodeCanvas commits | Total ms | Max ms | Method | Commit |
|---|---|---|---|---|---|
| S1 | TBD | | | | |
| S4 | TBD | | | | |
| S5 | TBD | | | | |
| S6 | TBD | | | | |
| S7 | TBD | | | | |
| … | | | | | |

**Expected from the audit (INFERRED, confirm these first):**
- S1: about 60 commits per second of panning (F-01).
- S5: at least one commit per mousemove (F-03).
- S6: 5–8 commits (F-08).
- S9: about 60 per second (F-04).
- S10b and S11: 1 commit per write (F-07).

## Per-task results

| Date | Task | Scenario | Before | After | Commit | Notes |
|---|---|---|---|---|---|---|

## Size history

The ratchet budget lives in `test/meta/nodecanvas-budget.json` once P0.07 lands. Lower it in the same commit that shrinks the file.

| Date | Commit | NodeCanvas.jsx lines | `//` comment lines | Note |
|---|---|---|---|---|
| 2025-10-23 | 48fb32f | 10,986 | — | initial release |
| 2026-09-09 | 071d5c3 | 20,519 | — | peak |
| 2026-09-23 | 1e6ab02 | 19,255 | 4,383 | audit baseline |
