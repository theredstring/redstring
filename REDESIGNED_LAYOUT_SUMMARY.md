# Auto-Layout System Redesign (Nov 2025)

## What Changed

Completely rebuilt the force-directed layout system from the ground up to solve cluster collapse issues.

## New Architecture

### Clean Force Calculation
- Pure physics: repulsion (inverse-square), springs (Hooke's law), centering
- No complex heuristics or fragile anchoring
- ~800 lines → ~1000 lines of clean, documented code

### Cluster-Aware Initialization
**Before**: All nodes started at canvas center, causing initial collapse
**After**: Disconnected clusters start spatially separated:
- Main cluster: center of canvas
- Other clusters: orbit around periphery (55% radius)
- Each cluster internally organized in concentric rings by degree

### Strong Cross-Cluster Repulsion  
**Key fix**: Nodes from different clusters repel **2.5× stronger** than same-cluster pairs.
- Prevents clusters from drifting together during simulation
- No post-processing needed to keep them apart
- Extends repulsion distance cutoff for cross-cluster pairs

### Multi-Phase Simulation
Progressive force adjustment across simulation:
1. **Early phase (0-30%)**: Repulsion ×1.4, Springs ×0.7 → Spread out
2. **Middle phase (30-70%)**: Balanced forces → Stable movement  
3. **Late phase (70-100%)**: Repulsion ×0.8, Springs ×1.2, Center ×1.0 → Clean settling

### Final Overlap Resolution
After simulation completes, 8 passes of collision detection:
- Respects actual node dimensions + labels
- Pushes apart any remaining overlaps
- No radial relaxation or cluster anchoring needed

## What Was Removed

- ❌ `computeAutoSpreadMultiplier` - adaptive scaling caused unpredictability
- ❌ `applyClusterAnchors` - post-simulation anchoring caused the collapse
- ❌ `radialRelaxation` - unnecessary with proper initialization
- ❌ Adaptive iteration boosting - simpler fixed presets work better
- ❌ Complex multi-phase cooling schedules - simple linear alpha decay

## What Stayed

✅ Layout scale presets (Compact/Balanced/Spacious)
✅ Scale multiplier (0.5–2.5×)
✅ Iteration presets (Fast/Balanced/Deep)
✅ Integration with store `autoLayoutSettings`
✅ All other layout algorithms (hierarchical, radial, grid, circular)

## Key Parameters

```javascript
FORCE_LAYOUT_DEFAULTS = {
  // Stronger repulsion to prevent overlap
  repulsionStrength: 200000,  // was 5200
  
  // Longer target distances for spaciousness  
  targetLinkDistance: 250,    // was springLength: 720
  minNodeDistance: 150,       // was minLinkDistance: 60
  
  // More iterations for better convergence
  iterations: 300,            // was 220
  
  // Simpler damping
  damping: 0.85,              // was 0.6
  alphaDecay: 0.015,          // was 0.02
}
```

## Usage

No API changes - it's a drop-in replacement:

```javascript
// Still works the same
applyAutoLayoutToActiveGraph();

// Force Simulation Tuner still works
// (though slider values map to new parameters)

// Auto-graph generation still works
generateGraph(data, graphId, ...);
```

## Testing

1. Test with single connected graph (5-20 nodes)
2. Test with multiple disconnected clusters
3. Test with large graphs (30+ nodes)
4. Test with layout scale slider
5. Test Force Simulation Tuner
6. Test repeated auto-layout (should be stable)

## Migration Notes

- Existing graphs won't change (positions are saved)
- Re-running auto-layout will use new algorithm
- May need to adjust Force Tuner slider values if you had custom presets
- Layouts should be more spacious and stable by default

## Documentation Updates

- `AUTO_LAYOUT_GUIDE.md` - Update "Adaptive Force Layout" section
- `FORCE_SIMULATION_TUNER.md` - Note algorithm change
- Both updated to reflect simpler, cleaner design

