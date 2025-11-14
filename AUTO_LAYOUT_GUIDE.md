# Auto Layout & Graph Generation Guide

## Overview

The Auto Layout and Graph Generation system allows you to quickly create and visualize graph structures from various data formats. This feature is designed for testing, prototyping, and importing external data into Redstring.

## Features

### 🎯 Data Input Formats

**Simple JSON**
```json
{
  "nodes": [
    { "name": "Concept A", "description": "First concept", "color": "#8B0000" },
    { "name": "Concept B", "description": "Second concept" }
  ],
  "edges": [
    { "source": "Concept A", "target": "Concept B", "relation": "relates to" }
  ]
}
```

**JSON-LD / RDF**
```json
{
  "@context": "http://schema.org",
  "@graph": [
    {
      "@id": "http://example.org/person/alice",
      "@type": "Person",
      "name": "Alice",
      "knows": "http://example.org/person/bob"
    }
  ]
}
```

**Auto-detect**: The system can automatically detect the format based on structure.

### 📐 Layout Algorithms

1. **Force-Directed** (Default)
   - Physics-based simulation
   - General purpose, works well for most graphs
   - Uses Fruchterman-Reingold algorithm
   - Best for: Networks, general graphs, connected data

2. **Hierarchical**
   - Tree-like structure
   - Arranges nodes in levels
   - Best for: Organizational charts, file systems, taxonomies

3. **Radial**
   - Concentric circles around center node
   - Most connected node becomes center
   - Best for: Hub-and-spoke networks, centrality visualization

4. **Grid**
   - Regular rows and columns
   - Predictable, organized layout
   - Best for: Lists, catalogs, uniform data

5. **Circular**
   - Nodes arranged on circle perimeter
   - Equal spacing between nodes
   - Best for: Cycle visualization, simple relationships

### 🎨 Sample Data Templates

- **Simple Network**: 5 nodes with basic connections (good for testing)
- **Family Tree**: Hierarchical structure with parent-child relationships
- **Knowledge Graph**: JSON-LD format with semantic web URIs
- **Concept Network**: Dense network showing abstract concepts

## Architecture

### Three-Layer System

The generator respects Redstring's architecture:

1. **Prototypes** (Semantic Layer)
   - Reusable concept definitions
   - The generator searches for existing prototypes by name
   - Creates new prototypes only when needed
   - Maintains semantic consistency across the universe

2. **Instances** (Positional Layer)
   - Positioned occurrences of prototypes
   - Each instance gets unique x, y coordinates from layout algorithm
   - Contained within specific graphs

3. **Graphs** (Spatial Context)
   - Collections of positioned instances
   - Can create new graphs or add to existing ones
   - Preserves existing graph content (unless "replace" mode)

### Generation Flow

```
Input Data
    ↓
Parse Format (JSON-LD / Simple JSON)
    ↓
Find/Create Prototypes
    ↓
Create Temp Instances (x=0, y=0)
    ↓
Build Edge List
    ↓
Apply Layout Algorithm → Calculate Positions
    ↓
Add Instances to Graph (with positions)
    ↓
Create Edges Between Instances
    ↓
Done!
```

## Usage

### Via Debug Menu

1. Click Redstring menu (top left)
2. Navigate to **Debug** → **Generate Test Graph**
3. Choose your options:
   - **Data Source**: Sample or Custom
   - **Sample Template**: Select from pre-built examples
   - **Layout Algorithm**: Choose positioning strategy
   - **Target**: New graph, current graph, or replace

### Programmatic API

```javascript
import { parseInputData, generateGraph } from './services/autoGraphGenerator';
import { applyLayout } from './services/graphLayoutService';

// Parse input
const parsedData = parseInputData(jsonData, 'simple');

// Generate graph
const results = generateGraph(
  parsedData,
  targetGraphId,
  storeState,
  storeActions,
  {
    layoutAlgorithm: 'force',
    createNewGraph: true,
    graphName: 'My Graph',
    layoutOptions: {
      width: 2000,
      height: 1500,
      padding: 200
    }
  }
);
```

## Layout Configuration

### Force-Directed Options

```javascript
{
  width: 2000,              // Canvas width
  height: 1500,             // Canvas height
  iterations: 300,          // Simulation iterations (more = better, slower)
  springLength: 150,        // Ideal distance between connected nodes
  springStrength: 0.05,     // How strongly edges pull nodes together
  repulsionStrength: 3000,  // How strongly nodes push each other away
  damping: 0.9,             // Velocity damping (prevents oscillation)
  centeringStrength: 0.01,  // How strongly nodes are pulled to center
  padding: 200              // Distance from edges
}
```

### Other Layout Options

```javascript
{
  // Hierarchical
  levelSpacing: 200,        // Vertical space between levels
  nodeSpacing: 150,         // Horizontal space between nodes
  direction: 'vertical',    // 'vertical' or 'horizontal'
  
  // Radial
  radiusStep: 200,          // Distance between orbits
  startRadius: 150,         // Radius of first orbit
  
  // Grid
  cellSpacing: 200,         // Space between grid cells
  
  // Circular
  // (uses only width, height, padding)
}
```

## Files

### Core Services

- **`src/services/graphLayoutService.js`**
  - Force-directed, hierarchical, radial, grid, circular layouts
  - Physics simulation for force-directed
  - BFS for hierarchical tree detection
  - Collision avoidance and bounds management

- **`src/services/autoGraphGenerator.js`**
  - JSON-LD and Simple JSON parsers
  - Prototype reuse logic
  - Instance creation with positions
  - Edge creation between instances
  - Sample data templates

### UI Components

- **`src/components/AutoGraphModal.jsx`**
  - Modal dialog for configuration
  - Sample template selection
  - Custom data input
  - Layout algorithm picker
  - Target mode selection (new/current/replace)

- **`src/components/AutoGraphModal.css`**
  - Maroon-themed styling matching Redstring aesthetic
  - Responsive layout
  - Form controls and buttons

### Integration Points

- **`src/RedstringMenu.jsx`**
  - "Generate Test Graph" menu item in Debug menu
  - Triggers modal open

- **`src/Header.jsx`**
  - Passes `onGenerateTestGraph` handler to menu

- **`src/NodeCanvas.jsx`**
  - Handles modal state
  - Executes generation with store actions
  - Displays results notification

## Best Practices

### Creating Test Data

1. **Start Small**: Test with 5-10 nodes first
2. **Name Carefully**: Node names are used for prototype matching
3. **Add Descriptions**: Helps distinguish similar concepts
4. **Use Colors**: Visual differentiation improves clarity

### Choosing Layout Algorithms

- **Unknown structure** → Force-directed
- **Tree/hierarchy** → Hierarchical
- **Star/hub pattern** → Radial
- **Equal importance** → Grid or Circular
- **Very large graphs** → Grid (most predictable)

### Performance Considerations

- Force-directed is O(n²) for repulsion, can be slow with >100 nodes
- Use fewer iterations for faster (less optimal) layouts
- Grid and circular are always fast (O(n))
- Hierarchical requires cycle-free graphs for best results

## Semantic Web Integration

The generator respects Redstring's semantic web features:

- **URI Mapping**: JSON-LD URIs are preserved in node metadata
- **Type Hierarchies**: Nodes can specify `typeNodeId` for type relationships
- **RDF Predicates**: Edge `relation` fields map to semantic predicates
- **Prototype Reuse**: Matching names reuse existing semantic concepts

## Future Enhancements

Potential improvements:

- [ ] Preview mode (show layout before committing)
- [ ] Incremental layout (position new nodes without moving existing)
- [ ] Custom layout constraints (pin nodes, define regions)
- [ ] Import from CSV, GraphML, Cypher
- [ ] Layout optimization (minimize edge crossings)
- [ ] Animated layout transitions
- [ ] Save/load layout presets
- [ ] Batch import from multiple files
- [ ] Undo/redo for generated graphs

## Troubleshooting

**Problem**: Generated graph is cluttered
- **Solution**: Try grid or hierarchical layout, or increase spacing parameters

**Problem**: Nodes overlap
- **Solution**: Increase `repulsionStrength` for force-directed, or use more iterations

**Problem**: Edges not created
- **Solution**: Ensure source/target names match exactly (case-sensitive)

**Problem**: Wrong prototype reused
- **Solution**: Use more specific names, or manually merge after generation

**Problem**: Layout takes too long
- **Solution**: Reduce iterations, use simpler algorithm (grid/circular)

## Examples

### Creating a Knowledge Graph

```json
{
  "nodes": [
    { "name": "Artificial Intelligence", "color": "#1976D2", "type": "Field" },
    { "name": "Machine Learning", "color": "#1976D2", "type": "Subfield" },
    { "name": "Neural Networks", "color": "#1976D2", "type": "Technique" },
    { "name": "Deep Learning", "color": "#1976D2", "type": "Technique" }
  ],
  "edges": [
    { "source": "Artificial Intelligence", "target": "Machine Learning", "relation": "includes" },
    { "source": "Machine Learning", "target": "Neural Networks", "relation": "uses" },
    { "source": "Machine Learning", "target": "Deep Learning", "relation": "includes" }
  ]
}
```

Use **Hierarchical** layout for best results.

### Importing Academic Citations

```json
{
  "@context": "http://schema.org",
  "@graph": [
    {
      "@id": "http://doi.org/10.1234/paper1",
      "@type": "ScholarlyArticle",
      "name": "Attention Is All You Need",
      "author": "Vaswani et al.",
      "citation": "http://doi.org/10.1234/paper2"
    },
    {
      "@id": "http://doi.org/10.1234/paper2",
      "@type": "ScholarlyArticle",
      "name": "BERT: Pre-training of Deep Bidirectional Transformers",
      "author": "Devlin et al."
    }
  ]
}
```

Use **Force-directed** or **Radial** layout to see citation patterns.

## Contributing

When extending this system:

1. **Add new layouts**: Implement in `graphLayoutService.js` following the pattern
2. **Add new parsers**: Extend `parseInputData()` in `autoGraphGenerator.js`
3. **Add sample data**: Extend `getSampleData()` with new templates
4. **Update docs**: Add examples and guidance to this file

## License

This feature is part of Redstring and follows the same license terms.

