# Stiff Layout & Emergent Geometry

## Overview
Implemented a **"Stiff"** layout mode by interleaving constraint enforcement directly into the force-directed simulation loop.
This makes the graph feel like a network of rigid rods rather than rubber bands, which encourages **emergent geometry** (symmetries, grids, rings) and significantly reduces overlaps.

## Changes
1.  **Constraint Interleaving**: `enforceEdgeConstraints` is now called inside the simulation loop (every tick), not just at the end.
2.  **Strictness**: Edges now strictly target the ideal `targetLinkDistance` (or `r1+r2` if that is larger), rather than allowing a "slop" range.
3.  **In-Loop Collision Resolution**: `resolveOverlaps` is also run inside the loop (every other tick), ensuring nodes don't pass through each other easily.
4.  **Stiffness Parameter**: Added `stiffness` (default `0.6`) to `FORCE_LAYOUT_DEFAULTS`. A higher value (e.g., 0.8) makes the graph very rigid; a lower value (0.2) makes it organic/floppy.

## Why this helps "Emergent Geometry"
In unweighted graphs, geometric patterns (hexagons, triangles, grids) emerge when all edge lengths are uniform. By enforcing rigid length constraints iteratively, the layout algorithm is forced to find a configuration where all edges are as close to length $L$ as possible, which naturally converges on these symmetric geometric forms.



