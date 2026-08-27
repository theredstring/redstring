# Semantic Discovery System - User Guide

## Overview

The enhanced semantic discovery system provides **fast, accurate knowledge graph exploration** with clear relationship labels and intelligent visualization.

## Key Improvements

### 1. **Property-Path Queries (10-50x Faster)**
Instead of slow fuzzy text matching, we now use SPARQL property paths that leverage database indexes:

```javascript
// OLD: Slow fuzzy search
?item rdfs:label ?label .
FILTER(CONTAINS(LCASE(?label), "mario"))

// NEW: Fast property-path traversal
<http://dbpedia.org/resource/Mario> dbo:series ?related .
```

### 2. **Clear Relationship Labels**
Every connection shows **what property creates the link**:

```javascript
{
  source: "Super Mario 64",
  target: "Nintendo",
  relation: "developed by",  // Clear semantic label
  confidence: 0.90
}
```

### 3. **Confident Entity Matching**
Multi-factor scoring prevents duplicate entities:

```javascript
{
  confidence: 0.95,
  factors: [
    { factor: 'wikidata_id_match', score: 0.95 },
    { factor: 'label_exact_match', score: 0.80 }
  ],
  shouldMerge: true  // Auto-merge at 0.85+ confidence
}
```

### 4. **Dimension-Aware Radial Layout**
Nodes sized based on label length, with intelligent overflow handling:

```javascript
{
  central: { node: "Mario", x: 0, y: 0 },
  nodes: [
    {
      node: { name: "Super Mario Bros" },
      angle: 0.785,
      radius: 180,
      dimensions: { width: 145, height: 40 }
    }
  ],
  connections: [
    {
      source: "Mario",
      target: "Super Mario Bros",
      relation: "part of series",
      path: { type: 'curved', ... }
    }
  ]
}
```

## Quick Start

### Basic Usage

```javascript
import { exploreEntity } from './services/semanticIntegration.js';

// Explore an entity with default settings
const result = await exploreEntity("Super Mario 64");

console.log(result);
// {
//   entity: "Super Mario 64",
//   central: { name: "Super Mario 64", ... },
//   entities: [...],        // All discovered entities
//   connections: [...],     // All relationships
//   orbits: [...],          // Organized by distance
//   layout: { ... },        // Positioned for rendering
//   metadata: { ... }
// }
```

### Quick Discovery (Faster, No Layout)

```javascript
import { quickDiscover } from './services/semanticIntegration.js';

const result = await quickDiscover("Nintendo");
// Returns connections without generating layout
```

### Deep Exploration (Multi-Level)

```javascript
import { deepExplore } from './services/semanticIntegration.js';

const result = await deepExplore("Mario", {
  maxDepth: 2,              // Explore 2 levels deep
  minConfidence: 0.65,      // Filter low-quality connections
  sources: ['dbpedia', 'wikidata']
});

// Result includes second-degree connections
// e.g., Mario → Nintendo → Shigeru Miyamoto
```

## Advanced API

### Semantic Discovery

```javascript
import { discoverConnections } from './services/semanticDiscovery.js';

// Discover direct connections
const result = await discoverConnections("Zelda", {
  timeout: 15000,
  limit: 30,
  sources: ['dbpedia', 'wikidata'],
  minConfidence: 0.6
});

console.log(result.connections);
// [
//   {
//     source: "Zelda",
//     target: "Nintendo",
//     relation: "developer",
//     confidence: 0.90,
//     description: "Nintendo Co., Ltd. is a Japanese..."
//   },
//   {
//     source: "Zelda",
//     target: "Action-adventure game",
//     relation: "genre",
//     confidence: 0.85
//   }
// ]

// Grouped results
console.log(result.byRelation);
// {
//   "developer": [...],
//   "genre": [...],
//   "platform": [...]
// }
```

### Entity Matching & Deduplication

```javascript
import {
  calculateEntityMatchConfidence,
  deduplicateEntities
} from './services/entityMatching.js';

// Check if two entities are the same
const entity1 = {
  name: "Super Mario Bros",
  uri: "http://dbpedia.org/resource/Super_Mario_Bros.",
  wikidataId: "Q854479",
  source: "dbpedia"
};

const entity2 = {
  name: "Super Mario Brothers",
  uri: "http://www.wikidata.org/entity/Q854479",
  wikidataId: "Q854479",
  source: "wikidata"
};

const matchResult = calculateEntityMatchConfidence(entity1, entity2);
console.log(matchResult);
// {
//   confidence: 0.95,
//   factors: [
//     { factor: 'wikidata_id_match', score: 0.95 },
//     { factor: 'label_fuzzy_match', score: 0.70, similarity: 0.92 }
//   ],
//   shouldMerge: true,
//   needsReview: false
// }

// Deduplicate a list of entities
const entities = [entity1, entity2, ...];
const deduplicated = deduplicateEntities(entities, {
  autoMergeThreshold: 0.85  // Merge if confidence >= 0.85
});

console.log(deduplicated.length); // Fewer entities after merging
```

### Radial Layout

```javascript
import { layoutRadialGraph } from './services/radialLayout.js';

const centralNode = { name: "Mario" };

const orbits = [
  {
    level: 1,
    entities: [
      { name: "Super Mario Bros" },
      { name: "Nintendo" },
      { name: "Platform game" }
    ]
  },
  {
    level: 2,
    entities: [
      { name: "Shigeru Miyamoto" },
      { name: "Game Boy" }
    ]
  }
];

const connections = [
  { source: "Mario", target: "Super Mario Bros", relation: "part of series" },
  { source: "Mario", target: "Nintendo", relation: "developer" }
];

const layout = layoutRadialGraph(centralNode, orbits, connections, {
  baseRadius: 180,
  orbitSpacing: 140,
  minNodeMargin: 28,
  overflowStrategy: 'subdivide'  // Handle crowded orbits
});

// Use layout for rendering
console.log(layout.central);  // Central node position
console.log(layout.nodes);    // All orbit node positions
console.log(layout.connections); // Connection paths
```

## Configuration Options

### Discovery Options

```javascript
{
  maxDepth: 2,              // How many levels to explore (1-3)
  maxConnectionsPerLevel: 20, // Max entities per level
  timeout: 30000,           // Total timeout in milliseconds
  minConfidence: 0.6,       // Filter connections below this
  enableDeduplication: true, // Merge duplicate entities
  generateLayout: true,     // Generate radial layout
  sources: ['dbpedia', 'wikidata'] // Which sources to query
}
```

### Layout Options

```javascript
{
  baseRadius: 180,          // Radius of first orbit (pixels)
  orbitSpacing: 140,        // Space between orbits
  minNodeMargin: 28,        // Minimum space between nodes
  maxNodesPerOrbit: 16,     // Subdivide if more than this
  overflowStrategy: 'subdivide', // 'subdivide' | 'force-adjust'
  connectionRouting: 'curved',   // 'straight' | 'curved'
  connectionCurvature: 0.3  // Curve amount for curved routing
}
```

## Understanding Results

### Connection Object

```javascript
{
  source: "Mario",           // Source entity name
  target: "Nintendo",        // Target entity name
  targetUri: "http://...",   // Target URI (if available)
  relation: "developer",     // Human-readable relationship
  relationUri: "dbo:developer", // Property URI
  description: "Nintendo...", // Target description
  confidence: 0.90,          // Relationship strength (0-1)
  distance: 1,               // Degrees of separation
  provider: "dbpedia"        // Data source
}
```

### Layout Object

```javascript
{
  central: {
    node: { name: "Mario" },
    x: 0,
    y: 0,
    dimensions: { width: 80, height: 40 }
  },
  nodes: [
    {
      node: { name: "Nintendo" },
      angle: 1.57,           // Radians from center
      radius: 180,           // Distance from center
      x: 0,                  // Cartesian X
      y: 180,                // Cartesian Y
      dimensions: { width: 95, height: 40 },
      orbitIndex: 0,
      zIndex: 5,
      opacity: 1.0
    }
  ],
  connections: [
    {
      source: "Mario",
      target: "Nintendo",
      relation: "developer",
      path: {
        type: 'curved',
        x1: 0, y1: 0,
        cx: 30, cy: 90,      // Control point
        x2: 0, y2: 180
      }
    }
  ]
}
```

## Relationship Types

### DBpedia Properties (High Confidence)

- `dbo:series` (0.95) - "part of series"
- `dbo:developer` (0.90) - "developed by"
- `dbo:publisher` (0.90) - "published by"
- `dbo:creator` (0.90) - "created by"
- `dbo:genre` (0.85) - "genre"
- `dbo:platform` (0.85) - "platform"
- `dbo:engine` (0.80) - "uses engine"
- `dbo:influencedBy` (0.75) - "influenced by"

### Wikidata Properties

- `wdt:P123` (0.90) - publisher
- `wdt:P178` (0.90) - developer
- `wdt:P136` (0.85) - genre
- `wdt:P400` (0.85) - platform

## Performance Tips

1. **Start with Quick Discovery**: Use `quickDiscover()` for initial exploration
2. **Adjust Timeouts**: Increase timeout for complex queries, decrease for faster results
3. **Filter by Confidence**: Higher minConfidence = fewer but better results
4. **Limit Depth**: maxDepth=1 is much faster than maxDepth=2
5. **Choose Sources**: DBpedia is usually faster than Wikidata

## Common Patterns

### Pattern 1: Show Related Items

```javascript
const result = await quickDiscover("Mario");
const relatedItems = result.connections
  .filter(c => c.confidence > 0.7)
  .map(c => c.target);

console.log("Related to Mario:", relatedItems);
```

### Pattern 2: Build Knowledge Graph

```javascript
const graph = await deepExplore("Nintendo", { maxDepth: 2 });

// Export for D3.js visualization
import { exportForVisualization } from './services/semanticIntegration.js';
const d3Data = exportForVisualization(graph, 'd3');
```

### Pattern 3: Find Connections Between Entities

```javascript
import { discoverConnectionGraph } from './services/semanticDiscovery.js';

const graph = await discoverConnectionGraph("Mario", { maxDepth: 2 });

// Check if there's a path from Mario to Zelda
const hasPath = graph.graph.edges.some(e =>
  (e.source === "Mario" && e.target === "Zelda") ||
  (e.source === "Zelda" && e.target === "Mario")
);
```

## Troubleshooting

### Issue: Slow Queries

**Solution**: Reduce `maxDepth`, `limit`, or increase `minConfidence`

```javascript
const result = await quickDiscover(entity, {
  limit: 10,
  minConfidence: 0.75  // Higher threshold = fewer results = faster
});
```

### Issue: Too Many Duplicate Entities

**Solution**: Lower the auto-merge threshold

```javascript
const result = await exploreEntity(entity, {
  enableDeduplication: true,
  autoMergeThreshold: 0.80  // More aggressive merging
});
```

### Issue: Layout Overlap

**Solution**: Increase orbit spacing or margins

```javascript
const layout = layoutRadialGraph(central, orbits, connections, {
  orbitSpacing: 160,      // Increase spacing
  minNodeMargin: 35       // More space between nodes
});
```

### Issue: No Results Found

**Solution**: Try different sources or lower confidence threshold

```javascript
const result = await discoverConnections(entity, {
  sources: ['dbpedia', 'wikidata'],  // Try both
  minConfidence: 0.5                  // Lower threshold
});
```

## Integration Examples

### Example 1: Orbit Overlay

```javascript
import { exploreEntity } from './services/semanticIntegration.js';

async function showOrbitsForNode(nodeName) {
  const result = await exploreEntity(nodeName, {
    maxDepth: 1,
    maxConnectionsPerLevel: 12
  });

  // Use result.layout for positioning
  renderOrbitOverlay(result.layout);
}
```

### Example 2: Search Enhancement

```javascript
import { quickDiscover } from './services/semanticIntegration.js';

async function enrichSearchResults(searchTerm) {
  const semantic = await quickDiscover(searchTerm);

  return {
    searchTerm,
    relatedTopics: semantic.connections
      .filter(c => c.confidence > 0.7)
      .slice(0, 5)
      .map(c => ({ name: c.target, relation: c.relation }))
  };
}
```

### Example 3: Knowledge Panel

```javascript
async function buildKnowledgePanel(entityName) {
  const result = await quickDiscover(entityName);

  return {
    title: result.central.name,
    description: result.central.description,
    properties: result.connections.reduce((acc, conn) => {
      if (!acc[conn.relation]) acc[conn.relation] = [];
      acc[conn.relation].push(conn.target);
      return acc;
    }, {}),
    sources: result.metadata.sources
  };
}
```

## Next Steps

1. **Test the System**: Try exploring different entities
2. **Tune Parameters**: Adjust timeouts, confidence thresholds for your use case
3. **Build UI**: Use the layout data to render interactive visualizations
4. **Extend**: Add more SPARQL endpoints or property mappings

## API Reference

See individual service files for detailed documentation:

- `semanticDiscovery.js` - Property-path SPARQL queries
- `entityMatching.js` - Entity deduplication
- `radialLayout.js` - Dimension-aware layout
- `semanticIntegration.js` - Unified high-level API
