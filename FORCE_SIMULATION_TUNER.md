# Force Simulation Tuner

## Overview
Interactive, draggable modal for tuning force-directed graph layout parameters in real-time. It runs directly against the active Redstring graph (no preview canvas), so every tick is applied to the live instances you see on NodeCanvas.

## Access
**Redstring Menu → Debug → Force Simulation Tuner**

## Features

### Live Graph Editing
- Applies forces straight onto the active graph via the Zustand store
- Play/Pause the solver without leaving NodeCanvas
- Reset injects jitter + alpha=1.0 so stacked nodes instantly separate

### Interactive Controls
- **Play/Pause**: Start or stop the simulation
- **Reset**: Randomize node positions and restart from alpha=1.0
- **Apply to Graph**: Apply the current positions to your actual Redstring graph

### Layout Scale & Iteration Presets (Auto-Layout Synced)
- **Layout Scale Slider (0.5–2.5×)**: Controls the global spacing multiplier saved in `autoLayoutSettings.layoutScaleMultiplier`. The new adaptive solver amplifies this value on large graphs, so sliding toward Spacious now meaningfully expands dense clusters.
- **Scale Presets (Compact / Balanced / Spacious)**: Chips that set both the preset key and reset the multiplier to 1.0. Auto-layout, auto-graph generation, and the tuner stay in sync.
- **Iteration Presets (Fast / Balanced / Deep)**: Updates `autoLayoutSettings.layoutIterations`. Large graphs automatically add extra passes on top of the preset so Deep genuinely performs a longer settle.
- The tuner reads + writes these same settings, so whatever you dial in here is exactly what `Auto-Layout Active Graph` and `Generate Test Graph` will use (including the adaptive spread multiplier + multi-phase cooling introduced in 2025.11).

### Tunable Parameters

#### Repulsion Strength (100-5000)
- Default: **2000**
- How strongly nodes push away from each other
- Higher values = more spread out
- Too high = nodes fly away
- Too low = nodes clump together

#### Attraction Strength (0.1-2.0)
- Default: **0.5**
- Spring strength along edges (connected nodes)
- Higher values = edges pull nodes closer
- Lower values = looser connections

#### Link Distance (50-500)
- Default: **200**
- Desired distance between connected nodes
- The "rest length" of edge springs
- Adjust based on your node size and desired spacing

#### Center Force (0.0-1.0)
- Default: **0.1**
- How strongly nodes are pulled toward the center
- Prevents graph from drifting off canvas
- Higher values = tighter clustering toward center

#### Collision Radius (20-100)
- Default: **60**
- Prevents nodes from overlapping
- Should match your actual node size
- Visual representation shown in the preview

#### Alpha Decay (0.001-0.1)
- Default: **0.02**
- How quickly the simulation "cools down"
- Lower values = simulation runs longer
- Higher values = faster convergence

#### Velocity Decay (0.1-0.9)
- Default: **0.4**
- Friction/damping on node movement
- Lower values = bouncier, more movement
- Higher values = smoother, slower settling

## Workflow

1. **Open the tuner** from Debug menu
2. **Drag the modal** by its header to reposition
3. **Adjust parameters** using the sliders
4. **Click Play** to start the simulation
5. **Watch** as nodes arrange themselves
6. **Pause** when you like the layout
7. **Fine-tune** parameters as needed
8. **Apply to Graph** to update your actual Redstring graph

## Tips

### For Dense Graphs (many nodes):
- Increase **Repulsion Strength** (3000-4000)
- Increase **Link Distance** (300-400)
- Lower **Attraction Strength** (0.2-0.3)

### For Sparse Graphs (few nodes):
- Lower **Repulsion Strength** (1000-1500)
- Decrease **Link Distance** (100-150)
- Increase **Center Force** (0.3-0.5)

### For Hierarchical Layouts:
- High **Attraction Strength** (1.0-1.5)
- Lower **Repulsion Strength** (1500-2000)
- Moderate **Link Distance** (150-200)

### For Organic/Natural Look:
- Moderate all values
- Lower **Velocity Decay** (0.2-0.3) for more movement
- Run simulation longer (lower **Alpha Decay**)

## Technical Details

### Simulation Algorithm
Custom force-directed layout implementation based on:
- N-body repulsion (Barnes-Hut style, but O(n²) for simplicity)
- Spring forces on edges
- Centering force
- Collision detection and resolution
- Alpha cooling schedule

### Adaptive Spread & Phases
- The core solver in `src/services/graphLayoutService.js` now computes an **auto spread multiplier** from node count + cluster count. The tuner feeds it by writing layout-scale settings back through the store.
- Repulsion, spring targets, and collision radii run in three phases (expand → stabilize → settle) so large graphs open up quickly and then lock into a steady state without drifting.
- After each run, the shared service performs cluster anchoring, multi-pass collisions, and radial relaxation. Running auto-layout after a tuning session gives you the exact same pipeline.

### Performance
- Runs at 60 FPS in browser
- Real-time parameter updates
- Suitable for graphs up to ~50-100 nodes
- Larger graphs may need optimization

## Files
- `/src/components/ForceSimulationModal.jsx` - Main component
- `/src/components/ForceSimulationModal.css` - Styling
- Integrated into `NodeCanvas.jsx`, `Header.jsx`, and `RedstringMenu.jsx`

## Future Enhancements
- D3-force integration for better performance
- Preset parameter configurations
- Export/import parameter sets
- Grid/hierarchical constraint options
- WebWorker-based simulation for large graphs

