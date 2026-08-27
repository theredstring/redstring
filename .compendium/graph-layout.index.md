---
compendium_version: 1
category: graph-layout
last_reviewed: 2026-08-27
---

# Graph Engine and Layout — Document Index

## Summary

These documents cover the force-directed layout system, constraint solver, canvas viewport management, and drag/zoom performance. Key code paths: `src/services/graphLayoutService.js`, `src/services/layout.worker.js`, `src/hooks/useViewportBounds.js`, `src/hooks/useCanvasTransform.js`, `src/NodeCanvas.jsx`, `src/utils/canvas/edgeRouting.js`.

**Performance regressions split by gesture — they are different problems:**

- **Drag** → `DRAG_PERFORMANCE_COMPLETE.md` (historical; three-bottleneck analysis with exact line references)
- **Zoom** → `ZOOM_PERF_DIAGNOSIS.md` (**current — describes live, unfixed mechanisms**)

**Layout parameter values**: read them from `FORCE_LAYOUT_DEFAULTS` in `graphLayoutService.js` (~line 659), never from a document. Every doc that quoted them went stale by two orders of magnitude.

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [AUTO_LAYOUT_GUIDE.md](../AUTO_LAYOUT_GUIDE.md) | User guide for the auto-layout feature: input data formats (adjacency list, edge list, named format), triggering layout, expected outputs | Using or extending auto-layout; understanding what input formats the Wizard can generate |
| [FORCE_SIMULATION_TUNER.md](../FORCE_SIMULATION_TUNER.md) | Operational guide for the force simulation tuner UI (accessible via Debug menu): what each parameter does, how to use it to tune layout feel | Adjusting layout parameters; understanding the tuner component |
| [CANVAS_RESIZING_GUIDE.md](../CANVAS_RESIZING_GUIDE.md) | Implementation guide for the `useViewportBounds` hook: how canvas bounds are calculated and exposed for responsive layout | Modifying canvas resize behavior; working with viewport bounds |
| [ZOOM_PERF_DIAGNOSIS.md](../ZOOM_PERF_DIAGNOSIS.md) | **Live issues, not history.** Four layered zoom-specific mechanisms behind the Lombardi + connection-label collapse. The `<textPath>` cost described throughout is fixed (glyph-by-glyph placement via `labelArcGlyphFrames` in `edgeRouting.js`), but **mechanisms 1–4 are still present**: viewport culling has been off since April (see the comment at `NodeCanvas.jsx:269`), the detent-zoom forced layout remains, and the glow update is uncoalesced | Any zoom-specific performance work. Read before attempting a fix — it explains why previous fixes each removed a *different* mechanism |

---

## Historical Documents

| File | Summary | Consult when |
|------|---------|--------------|
| [DRAG_PERFORMANCE_COMPLETE.md](../DRAG_PERFORMANCE_COMPLETE.md) | **The drag doc.** Three-bottleneck analysis with exact NodeCanvas.jsx and utils.js line references from the definitive fix: redundant `getHydratedNodes` on every mouse move, synchronous edge recalculation, excessive re-renders | Investigating any drag performance regression — check these three locations first |
| [LAYOUT_HISTORY.md](../LAYOUT_HISTORY.md) | Consolidated design history of the force layout: the Nov 2025 rebuild and what it removed, the parameter-alias requirement, the 4-stage constraint pipeline, stiff mode, triplet (node↔edge) repulsion, adaptive scaling. Replaces nine per-iteration summary documents | Understanding *why* the layout is shaped the way it is; before renaming any layout parameter (aliases are mandatory) |
| [MOBILE_PORTRAIT_IMPROVEMENTS.md](../MOBILE_PORTRAIT_IMPROVEMENTS.md) | Documents creation of `useMobileDetection` hook and portrait-orientation layout adjustments | Mobile layout issues |

> **Consolidated 2026-08-27**: `REDESIGNED_LAYOUT_SUMMARY`, `RIGID_CONSTRAINTS_SUMMARY`, `ADAPTIVE_SCALING_SUMMARY`, `AUTOGRAPH_IMPLEMENTATION_SUMMARY`, `LAYOUT_FIX_SUMMARY`, `STIFF_LAYOUT_SUMMARY`, `TRIPLET_REPULSION_SUMMARY`, `CONSTRAINT_COMPARISON`, and `SCALING_EXAMPLES` → `LAYOUT_HISTORY.md`. `DRAG_PERFORMANCE_OPTIMIZATION` and `DRAG_PERFORMANCE_FIX_V2` were deleted as superseded by `DRAG_PERFORMANCE_COMPLETE.md`. All recoverable from git history.
