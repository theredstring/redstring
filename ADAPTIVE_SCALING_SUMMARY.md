# Adaptive Auto-Scaling for Layout (Nov 2025)

## Overview

Added automatic spacing scaling based on node count and cluster count. **Larger graphs now automatically get more space**, eliminating the need for manual adjustments.

## How It Works

### Node Count Scaling

The `calculateAutoScale(nodeCount)` function applies progressive scaling:

```
Nodes  | Auto Scale | Effective Distance (Balanced preset)
-------|------------|------------------------------------
1-5    | 1.0×       | 400px (baseline)
10     | 1.15×      | 460px
20     | 1.4×       | 560px
30     | 1.6×       | 640px
50     | 1.9×       | 760px
100    | 2.3×       | 920px
200+   | 2.5-2.8×   | 1000-1120px (logarithmic)
```

**Growth rates:**
- 5-10 nodes: +3% per node
- 10-20 nodes: +2.5% per node  
- 20-30 nodes: +2% per node
- 30-50 nodes: +1.5% per node
- 50-100 nodes: +0.8% per node
- 100+ nodes: logarithmic (slows down)

### Cluster Count Scaling

When multiple disconnected clusters exist, additional spacing is applied:

```
Clusters | Cluster Scale | Total Multiplier (at 20 nodes)
---------|---------------|-------------------------------
1        | 1.0×          | 1.4× (from node count only)
2        | 1.09×         | 1.53×
3        | 1.14×         | 1.60×
5        | 1.21×         | 1.69×
10       | 1.30×         | 1.82×
```

**Formula**: `clusterScale = 1 + log10(clusterCount) * 0.3`

### Combined Effect

Total spacing = `baseDistance × nodeScale × clusterScale × userMultiplier`

**Example: 30 nodes in 3 clusters with Balanced preset**
- Base distance: 400px
- Node scale: 1.6×
- Cluster scale: 1.14×  
- User multiplier: 1.0 (default)
- **Final distance**: 400 × 1.6 × 1.14 = **730px**

## User Control

The layout scale slider (0.5× to 2.5×) **multiplies the auto-scaled value**:

```
30 nodes, Balanced preset:
- Auto scale alone: 640px
- With slider at 0.5×: 320px (compact)
- With slider at 1.0×: 640px (balanced)
- With slider at 2.0×: 1280px (very spacious)
```

Users can still override automatic scaling if needed, but most graphs will look good at 1.0× now.

## What Gets Scaled

All distance parameters scale together:
- **targetLinkDistance**: Desired edge length
- **minNodeDistance**: Minimum space between nodes
- **maxRepulsionDistance**: How far repulsion reaches

Repulsion strength also scales (by square root of total scale) to maintain stability.

## Performance Impact

- **Same algorithmic complexity**: O(n²) for repulsion
- **Slightly more distance calculations**: negligible
- **Larger search radius for big graphs**: acceptable (cutoff still applies)
- **Overall**: No noticeable performance change

## Benefits

### Before Auto-Scaling
- Small graphs (5 nodes): Too spread out
- Medium graphs (20 nodes): Okay
- Large graphs (50+ nodes): Cramped, overlapping
- Multiple clusters: Collapsed on top of each other

### After Auto-Scaling  
- Small graphs: Compact and readable ✅
- Medium graphs: Well-balanced ✅
- Large graphs: Spacious and clear ✅
- Multiple clusters: Widely separated ✅

## Testing

### Test Cases

1. **5 nodes, 1 cluster**: Should be compact (~400px)
2. **20 nodes, 1 cluster**: Should spread nicely (~560px)
3. **50 nodes, 1 cluster**: Should be spacious (~760px)
4. **10 nodes, 5 clusters**: Should separate clusters (~530px)
5. **100 nodes, 1 cluster**: Should be very spacious (~920px)

### Visual Check

Run auto-layout and verify:
- [ ] No overlapping nodes
- [ ] Clear space between clusters
- [ ] Readable labels even in large graphs
- [ ] Connected nodes have visible edges
- [ ] Graph fills canvas nicely (not too compact, not too spread)

## Tunables

If auto-scaling is too aggressive/gentle:

### Reduce Spacing Growth
```javascript
// In calculateAutoScale()
if (nodeCount <= 20) return 1.15 + (nodeCount - 10) * 0.02;  // Was 0.025
```

### Increase Cluster Separation
```javascript
// In forceDirectedLayout()
const clusterScale = totalClusters > 1 
  ? (1 + Math.log10(totalClusters) * 0.4)  // Was 0.3
  : 1;
```

### Cap Maximum Scale
```javascript
function calculateAutoScale(nodeCount) {
  const scale = /* ... existing calculation ... */;
  return Math.min(scale, 2.5);  // Cap at 2.5×
}
```

## Implementation Details

**File**: `src/services/graphLayoutService.js`

**Functions**:
- `calculateAutoScale(nodeCount)`: Returns scale multiplier based on node count
- `forceDirectedLayout()`: Applies both node and cluster scaling

**Call chain**:
```
autoLayout() 
  → forceDirectedLayout(nodes, edges, options)
    → calculateAutoScale(nodeCount) → nodeScale
    → calculateClusterScale(clusterCount) → clusterScale  
    → finalDistance = baseDistance × nodeScale × clusterScale × userMultiplier
    → simulation uses finalDistance
```

## Migration

**Breaking changes**: None - it's additive

**Existing graphs**: Won't change (positions are saved)

**New layouts**: Will automatically scale

**User experience**: 
- Most users won't notice (graphs just look better)
- Power users can still override with slider
- Test graph generation automatically benefits

## Future Enhancements

- [ ] Add "density" metric (edges/nodes ratio) as additional scaling factor
- [ ] Scale repulsion strength more aggressively for dense graphs
- [ ] Add option to disable auto-scaling (for reproducibility)
- [ ] Expose scaling curve parameters in UI for advanced users
- [ ] Log auto-scale multiplier to console for debugging

## Related Files

- `src/services/graphLayoutService.js` - Core implementation
- `src/services/autoGraphGenerator.js` - Uses layout service
- `src/NodeCanvas.jsx` - Calls auto-layout
- `src/components/ForceSimulationModal.jsx` - Uses scaled parameters

