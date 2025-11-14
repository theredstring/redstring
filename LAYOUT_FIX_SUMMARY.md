# Layout System Fixes (Nov 2025)

## Issues Fixed

### 1. Force Simulation Modal Crash
**Problem**: `Cannot read properties of undefined (reading 'toFixed')`
**Cause**: New defaults missing backward-compatible parameter names
**Fix**: Added aliases to `FORCE_LAYOUT_DEFAULTS`:
- `linkDistance` (alias for `targetLinkDistance`)
- `minLinkDistance` (alias for `minNodeDistance`)
- `velocityDecay` (alias for `damping`)
- `collisionRadius` (alias for `minNodeRadius`)
- `edgeAvoidance`, `edgeAvoidanceRadius` (set to 0/200, not used in new algo)

### 2. Nodes Too Close Together
**Problem**: Graphs still collapsing, nodes clustered tightly
**Root Causes**:
- Repulsion strength too weak (200k → need 500k+)
- Target distances too short (250 → need 400+)
- Initial positioning too tight

**Fixes Applied**:

#### Increased Force Strengths
```javascript
// Before → After
repulsionStrength: 200000 → 500000    // 2.5× stronger
attractionStrength: 0.3 → 0.2         // Weaker to allow spreading
centerStrength: 0.02 → 0.015          // Gentler pull to center
```

#### Increased Target Distances
```javascript
// Before → After
targetLinkDistance: 250 → 400    // 60% longer
minNodeDistance: 150 → 250       // 67% more space
maxRepulsionDistance: 1000 → 1500  // Extended range
```

#### Updated Scale Presets
```javascript
// COMPACT
targetLinkDistance: 180 → 280
minNodeDistance: 120 → 180
repulsionStrength: 150k → 350k

// BALANCED
targetLinkDistance: 250 → 400
minNodeDistance: 150 → 250
repulsionStrength: 200k → 500k

// SPACIOUS
targetLinkDistance: 350 → 550
minNodeDistance: 200 → 350
repulsionStrength: 280k → 700k
```

#### Improved Initial Positioning
```javascript
// Single cluster
clusterRadius: 0.4 → 0.45  // 12% larger spread

// Multiple clusters
mainRadius: 0.25 → 0.2      // Tighter main
orbitRadius: 0.55 → 0.65    // 18% further out
clusterRadius: 0.15 → 0.18  // 20% larger
```

## Testing Checklist

- [ ] Open Force Simulation Tuner (Debug menu) - should load without crashing
- [ ] Run Auto-Layout on a small connected graph (5-10 nodes) - should spread nicely
- [ ] Run Auto-Layout on disconnected clusters - should stay separated
- [ ] Test Compact preset - nodes should have breathing room
- [ ] Test Spacious preset - nodes should be well-spaced
- [ ] Test layout scale multiplier slider - should scale distances
- [ ] Generate test graph from Auto Graph Generator - should look good
- [ ] Repeated auto-layout runs should be stable

## Expected Behavior

### Single Cluster Graph
- Nodes should spread across ~45% of canvas radius
- Connected nodes ~400px apart (balanced preset)
- Minimum 250px between any nodes
- No overlapping labels or images

### Multi-Cluster Graph
- Main cluster in center (~20% radius)
- Other clusters at 65% radius orbit
- Each cluster ~18% internal radius
- Clusters stay separated (2.5× repulsion between clusters)

### All Graphs
- Stronger repulsion = nodes pushed apart more aggressively
- Weaker attraction = edges don't pull nodes too close
- Gentle centering = graph doesn't collapse to tiny ball
- More iterations = smoother, more stable final positions

## Rollback Plan

If nodes are now TOO spread out:

1. Reduce `repulsionStrength`: 500k → 350k
2. Reduce `targetLinkDistance`: 400 → 320
3. Reduce `orbitRadius`: 0.65 → 0.58

If Force Tuner still crashes:

1. Check FORCE_LAYOUT_DEFAULTS has all aliases
2. Check LAYOUT_SCALE_PRESETS have both old/new names
3. Verify ForceSimulationModal destructures with fallbacks

## Files Changed

- `src/services/graphLayoutService.js` - Core layout engine
  - Updated FORCE_LAYOUT_DEFAULTS
  - Updated LAYOUT_SCALE_PRESETS  
  - Updated generateInitialPositions()

## Performance Impact

- Same O(n²) complexity for repulsion
- Same number of iterations (200-450)
- Slightly more work per iteration (stronger forces = bigger numbers)
- Overall: negligible performance difference

## Next Steps

1. Test with real graphs
2. Gather user feedback on spacing
3. Consider adding a "spacing intensity" slider (0.5× - 2× multiplier)
4. Document new parameter values in guides

