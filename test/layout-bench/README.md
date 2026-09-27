# Layout bench

Lays out a fixed corpus of graphs exactly the way the app does, grades what
gets **drawn**, and writes the numbers to `results/<label>.json` (gitignored).
It's a report, not a gate: it's skipped unless `LAYOUT_BENCH` is set.

```sh
npm run bench:layout                                   # baseline vs app
LAYOUT_BENCH_CONFIGS=app,force,pattern npm run bench:layout
LAYOUT_BENCH_SEEDS=3 LAYOUT_BENCH_LABEL=my-change npm run bench:layout
LAYOUT_BENCH_SVG=1 LAYOUT_BENCH_ONLY=parse-tree npm run bench:layout   # renders to results/svg/
LAYOUT_BENCH_LARGE=1 ...                               # + the 606-node stress web (~20s)
python3 test/layout-bench/compare.py my-change         # dev vs held-out means
```

## What's graded (`metrics.js`)

The scene is rebuilt the way the canvas paints it: node boxes at rendered
size, connections clipped at the node borders, labels at the visible midpoint,
rotated and truncated to 85% of the run, group shells from the renderer's own
`computeGroupLayout`, node-group anchors drawn as title tabs.

| Hard ("never") | Readability |
|---|---|
| node on node, line through a node (Dunne & Shneiderman 2009) | crossings per connection (Purchase 1997/2002), crossing angle (Huang et al. 2008) |
| label on label, label on node, line through a label (Kakoulis & Tollis 2003) | label crowding (0.3em breathing room), characters lost to truncation |
| group shells overlapping, foreign node inside a group | cluster separation: silhouette (Rousseeuw 1987) + Gestalt proximity |
| | stress (Gansner, Koren & North 2004), angular resolution, edge-length CV, ink density |

The grade is a weighted geometric mean (0–100), so one bad criterion can't be
hidden by the rest. **Weights are fixed** (`WEIGHTS`, `SCORER_VERSION`): don't
retune them to make a change look better — add a criterion and bump the version.
v1 raised compactness after a 92,000px circle outscored every real layout; v2
fixed how anchor→own-member connections are clipped.

## Corpus (`corpus.js`)

Seeded synthetic graphs, one per failure mode or special path (sentence tree,
planted communities, mixed components, hub, dense, ring, lattice, long labels,
parallel connections, flat groups, nested node-groups, groups + clusters), the
committed canvas fixtures, and — when present locally — the real graphs in
`test/fixtures/canvas/local/claudes-chambers.redstring`. Those are the
**held-out set**: tune on the rest, check there.

## Results so far (scorer v2, 3 seeds)

| | overall | dev | held-out | node overlaps | line through node | label on label | label on node | line through label |
|---|---|---|---|---|---|---|---|---|
| baseline (force, no repair) | 62.8 | 66.3 | 60.1 | 8 | 429 | 513 | 668 | 1793 |
| app (`best`) | 82.5 | 89.1 | 77.2 | 0 | 9 | 123 | 156 | 609 |
