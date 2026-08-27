# Force Layout — Design History

Consolidated from nine per-iteration summary documents (Nov 2025 – Jan 2026) that each
described one pass at `src/services/graphLayoutService.js`. They are collapsed here because
their parameter values had all gone stale — the last of them documented
`repulsionStrength: 500000` while the shipped value is `2200`.

> **Source of truth is the code, not this file.** Read `FORCE_LAYOUT_DEFAULTS`
> (`src/services/graphLayoutService.js` ~line 659) and the scale presets below it for
> current values. This document explains *why* the system is shaped the way it is; it
> deliberately does not restate tunable numbers.

Related current docs: `AUTO_LAYOUT_GUIDE.md` (how to use it), `FORCE_SIMULATION_TUNER.md`
(the in-app tuner that produced today's refined values).

---

## The mechanism, in the order it was built

### 1. Initial build — `graphLayoutService.js`

The layout service was extracted as a standalone module with `autoGraphGenerator.js` feeding
it. It supports several algorithms (force-directed, hierarchical, radial, grid, circular)
behind one entry point, wired to the store's `autoLayoutSettings`.

### 2. The Nov 2025 rebuild

The first force system collapsed graphs into a knot. The rebuild removed four mechanisms
that were each individually reasonable but interacted badly:

| Removed | Why |
|---|---|
| `computeAutoSpreadMultiplier` | Adaptive scaling made output unpredictable between runs |
| `applyClusterAnchors` | Post-simulation anchoring was the direct cause of the collapse |
| `radialRelaxation` | Redundant once initialization placed clusters properly |
| Adaptive iteration boosting + multi-phase cooling | Fixed presets and linear alpha decay behaved better |

What replaced it: clean force calculation, cluster-aware initialization (clusters are placed
apart *before* the simulation rather than pulled apart during it), strong cross-cluster
repulsion, multi-phase simulation, and a final overlap-resolution pass. Scale presets
(Compact/Balanced/Spacious), the 0.5–2.5× multiplier, and the non-force algorithms all
survived unchanged.

### 3. Backward-compatible parameter aliases

The rebuild renamed the tunables, which crashed `ForceSimulationModal` with
`Cannot read properties of undefined (reading 'toFixed')`. `FORCE_LAYOUT_DEFAULTS` therefore
carries aliases that must be preserved: `linkDistance` → `targetLinkDistance`,
`minLinkDistance` → `minNodeDistance`, `velocityDecay` → `damping`,
`collisionRadius` → `minNodeRadius`, plus `edgeAvoidance` / `edgeAvoidanceRadius` which are
accepted and ignored by the current algorithm. The alias mapping is applied at
`graphLayoutService.js` ~line 871.

**If you rename a layout parameter, add an alias.** This is the one durable lesson here.

### 4. Rigid constraints — the 4-stage post-simulation pipeline

Force simulation alone leaves overlaps and inconsistent edge lengths. A constraint pipeline
runs after it:

1. **Enforce edge constraints** — pull every edge toward its target length
2. **Resolve overlaps** — aggressive separation pass
3. **Re-enforce edges** — step 2 breaks step 1, so it is repeated
4. **Final polish**

The ordering matters and steps 1 and 3 are not redundant. The effect is that connected
components behave like rigid bodies rather than rubber bands, which is what makes symmetric
structures (triangles, stars, grids) resolve cleanly.

### 5. Stiff mode — constraint interleaving

Rather than running constraints only *after* the simulation, stiff mode calls
`enforceEdgeConstraints` every tick and `resolveOverlaps` every other tick, inside the loop.
Edges strictly target the ideal distance (or `r1 + r2` when that is larger) instead of
allowing slop.

The rationale is geometric: in an unweighted graph, uniform edge lengths are what make
hexagons, triangles and grids emerge. Iteratively forcing all edges toward length *L* pushes
the layout into those symmetric configurations. Controlled by `stiffness` (0.0 organic →
1.0 rigid).

### 6. Triplet repulsion — node↔edge

Nodes are repelled from edges they are not endpoints of. For each node/edge pair the distance
to the line segment is computed, repulsion is applied to the node, and an equal and opposite
force is distributed to the edge's endpoints by projection ratio `t`.

This replaced an O(E²) edge–edge loop with an O(N·E) node–edge loop that is both cheaper and
more general — it also keeps unconnected nodes off of edges. Incident edges are skipped, but
a node *does* get repelled by adjacent edges one hop away, which opens up angles at hubs.
Toggled by `enableEdgeRepulsion`.

### 7. Adaptive scaling by node and cluster count

Spacing scales with graph size — fewer nodes get stronger forces and more spread, so a
5-node graph doesn't sit in a tiny clump in the middle of the canvas while a 50-node graph
overlaps. Cluster count scales separation independently. This sits under the user-facing
scale multiplier rather than replacing it.

---

## What was dropped in consolidation

Four of the nine documents were worked examples rather than reference material —
before/after constraint comparisons, ASCII scaling illustrations at 5/20/50 nodes, testing
checklists, and rollback plans for changes long since shipped. All of their parameter values
were stale. The tuner (`FORCE_SIMULATION_TUNER.md`) does this job interactively and against
live code.
