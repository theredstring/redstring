# Render sweep: selection latches, memoized leaves (+ F-78, `--explain` whole-tree)

**Status:** done (orchestrator).

Found with `--explain`, which now names components rendered anywhere in the tree (ce1342e). Since P2 the hosts render outside NodeCanvas, where the old walk couldn't see them.

## Changes
1. **F-78** (bda014c): CanvasModal, PanelModal and ConnectionBrowser used selector-less `useGraphStore()`, so all five modal frames re-rendered on every store write. They now subscribe per field. S11: 12 → 2 commits.
2. **Selection latches in render:** the node panel's exit-animation latches (`lastSelectedNodePrototypes`, `lastSingleSelectedInstanceId`) were written by effects after each selection change, which cost a second NodeCanvas render on every change. They are now refs latched during the render; only NodeCanvas read them, so their canvasUIStore fields are gone.
3. **Memoized leaves:** GamepadCrosshair, EdgeGlowIndicator, BackToCivilization, DownloadAppPill and HurtleOrb re-rendered on every NodeCanvas render with unchanged props. HeaderGraphTab re-rendered all 145 tabs whenever Header rendered. All are `memo()` now; each was checked for render-time ref reads (there are none).

## Numbers (chambers, 3 runs)
| Scenario | Before | After |
|---|---|---|
| S5 marquee | 59 commits, NC rendered 38, 89–103 ms | **42**, **21**, **71 ms** |
| S6 pie open/close | 26, 43 ms | **24**, **40 ms** |
| S7 select (manhattan) | 15–16, 41 ms | **14**, **32 ms** |
| S4 node drag | 22 ms | **19 ms** |
| S11 off-web updateGraph | 12 | **2** |

## Seen but left alone
- **WizardIntentModal:** inline handlers, so `memo` wouldn't help; it's cheap while closed.
- **S6/S7's second render for the pie target:** P5.
- **`isPanning` and `longPressingInstanceId` set on every press:** P4 (F-75).

## Verification
- `test:ci` PASS. Playwright: 55 passed. `lint:undef` PASS.
- Shell screenshots identical within antialiasing noise.
