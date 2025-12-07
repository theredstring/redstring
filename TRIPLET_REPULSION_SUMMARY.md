# Triplet Repulsion (Edge Repulsion)

## Overview
Improved edge repulsion logic to include general **Node-Edge Repulsion**.
This ensures that:
1.  Nodes do not sit on top of edges they are not connected to.
2.  Edges effectively repel each other because each edge's endpoints (nodes) are repelled by the other edge's segment.
3.  Crossings are minimized and angular resolution is improved.

## Implementation
- File: `src/services/graphLayoutService.js`
- Function: `forceDirectedLayout` (simulation loop)
- **Logic**:
  - Iterates over all Nodes vs all Edges.
  - Skips if the node is an endpoint of the edge.
  - Calculates distance from Node to Line Segment of the edge.
  - Applies repulsion force to the Node.
  - Applies equal and opposite reaction force to the Edge's endpoints (distributed by projection ratio `t`).
  - This effectively replaces the $O(E^2)$ edge-edge loop with an $O(N \cdot E)$ node-edge loop, which is more general and covers unconnected nodes as well.

## Constraints
- **Parallel Edges**: Repulsion is naturally handled. Parallel edges share endpoints, so they don't repel via this mechanism (endpoints are skipped), but if a *third* node is near them, it is pushed away.
- **Incident Edges**: Nodes are not repelled by edges they are directly connected to (endpoints skipped). However, if Node A is connected to B, and there is another edge B-C, Node A *will* be repelled by edge B-C (as long as A != C), which helps open up the angle at node B.

## Configuration
- Enabled by default via `FORCE_LAYOUT_DEFAULTS.enableEdgeRepulsion`.
- Can be disabled by passing `{ enableEdgeRepulsion: false }` in options.
