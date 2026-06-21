---
compendium_version: 1
category: graph-layout
last_reviewed: 2026-06-13
---

# Graph Engine and Layout — Document Index

## Summary

These documents cover the force-directed layout system, constraint solver, canvas viewport management, and drag/performance optimization. The layout algorithm was rebuilt multiple times — most summary docs here are historical (they describe a specific iteration). The three current documents describe what you can actually *use* today. Key code paths: `src/services/graphLayoutService.js`, `src/hooks/useViewportBounds.js`, `src/NodeCanvas.jsx` (drag handling), `src/workers/layoutWorker.js`.

**When investigating a drag/performance regression**: Go directly to `DRAG_PERFORMANCE_COMPLETE.md` — it contains the three-bottleneck analysis with exact file and line number references from the definitive fix. The other two drag docs (`DRAG_PERFORMANCE_OPTIMIZATION.md`, `DRAG_PERFORMANCE_FIX_V2.md`) are earlier passes at the same problem and are superseded by it.

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [AUTO_LAYOUT_GUIDE.md](../AUTO_LAYOUT_GUIDE.md) | User guide for the auto-layout feature: input data formats (adjacency list, edge list, named format), triggering layout, expected outputs | Using or extending auto-layout; understanding what input formats the Wizard can generate |
| [FORCE_SIMULATION_TUNER.md](../FORCE_SIMULATION_TUNER.md) | Operational guide for the force simulation tuner UI (accessible via Debug menu): what each parameter does, how to use it to tune layout feel | Adjusting layout parameters; understanding the tuner component |
| [CANVAS_RESIZING_GUIDE.md](../CANVAS_RESIZING_GUIDE.md) | Implementation guide for the `useViewportBounds` hook: how canvas bounds are calculated and exposed for responsive layout | Modifying canvas resize behavior; working with viewport bounds |

---

## Historical Documents

The layout algorithm was rebuilt multiple times. These docs describe specific iterations; read them for context when working in the relevant area, but do not copy parameter values or code snippets verbatim — the implementation has evolved.

| File | Summary | Consult when |
|------|---------|--------------|
| [DRAG_PERFORMANCE_COMPLETE.md](../DRAG_PERFORMANCE_COMPLETE.md) | **Most useful drag doc.** Three-bottleneck analysis with exact NodeCanvas.jsx and utils.js line references from the definitive fix: redundant `getHydratedNodes` on every mouse move, synchronous edge recalculation, excessive re-renders | Investigating any drag performance regression — check these three locations first |
| [REDESIGNED_LAYOUT_SUMMARY.md](../REDESIGNED_LAYOUT_SUMMARY.md) | Documents the Nov 2025 force system rebuild: why the previous system was replaced, what changed, the new multi-stage pipeline | Understanding the current pipeline's design rationale |
| [RIGID_CONSTRAINTS_SUMMARY.md](../RIGID_CONSTRAINTS_SUMMARY.md) | Documents the 4-stage post-simulation constraint pipeline: force run → constraint projection → collision → boundary | Understanding constraint ordering and why it matters |
| [ADAPTIVE_SCALING_SUMMARY.md](../ADAPTIVE_SCALING_SUMMARY.md) | Documents auto-scaling by node count (fewer nodes → stronger forces, more spread) | Understanding the adaptive behavior in `graphLayoutService.js` |
| [AUTOGRAPH_IMPLEMENTATION_SUMMARY.md](../AUTOGRAPH_IMPLEMENTATION_SUMMARY.md) | Documents the initial `graphLayoutService.js` build: module structure, force parameters, how it was wired to the store | Onboarding to the layout service architecture |
| [LAYOUT_FIX_SUMMARY.md](../LAYOUT_FIX_SUMMARY.md) | Documents Nov 2025 crash fix and parameter alias additions | Diagnosing layout crashes; understanding parameter fallback aliases |
| [STIFF_LAYOUT_SUMMARY.md](../STIFF_LAYOUT_SUMMARY.md) | Documents the stiff/constraint-interleaved mode implementation | Understanding why stiff mode exists and when it applies |
| [TRIPLET_REPULSION_SUMMARY.md](../TRIPLET_REPULSION_SUMMARY.md) | Documents node-edge repulsion (nodes repel from edges they aren't part of) | Understanding why nodes don't overlap with unrelated edges |
| [CONSTRAINT_COMPARISON.md](../CONSTRAINT_COMPARISON.md) | Before/after comparison of constraint systems; shows what the old system produced vs. the current one | Evaluating layout quality regressions |
| [SCALING_EXAMPLES.md](../SCALING_EXAMPLES.md) | Visual examples of adaptive scaling behavior at different node counts | Calibrating scaling parameters |
| [MOBILE_PORTRAIT_IMPROVEMENTS.md](../MOBILE_PORTRAIT_IMPROVEMENTS.md) | Documents creation of `useMobileDetection` hook and portrait-orientation layout adjustments | Mobile layout issues |
| [DRAG_PERFORMANCE_OPTIMIZATION.md](../DRAG_PERFORMANCE_OPTIMIZATION.md) | First diagnosis of drag performance problem — **superseded-by: DRAG_PERFORMANCE_COMPLETE.md** | Historical context only |
| [DRAG_PERFORMANCE_FIX_V2.md](../DRAG_PERFORMANCE_FIX_V2.md) | Second-pass drag fix summary — **superseded-by: DRAG_PERFORMANCE_COMPLETE.md** | Historical context only |
