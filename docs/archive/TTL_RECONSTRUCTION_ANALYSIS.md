# TTL Reconstruction Analysis

## Current Capabilities ✅

Your `redstringFormat.js` already has:

1. **Rich JSON-LD Context** - Complete semantic web vocabulary
2. **RDF Edge Statements** - Triple representation of connections  
3. **Node Metadata** - All spatial and descriptive data
4. **Graph Structure** - Hierarchical relationships
5. **Abstraction Chains** - Via `subClassOf` properties

## Gaps for Complete TTL Reconstruction 🔄

### 1. TTL File Decomposition
Currently exports unified JSON-LD, but needs decomposition into separate TTL files:

```turtle
# nodes/node-abc123.ttl
@prefix redstring: <https://redstring.io/vocab/> .
@prefix schema: <http://schema.org/> .

<node:abc123> a redstring:Node ;
    schema:name "My Concept" ;
    schema:description "A sample concept" ;
    schema:color "#ff0000" ;
    redstring:xCoordinate 100 ;
    redstring:yCoordinate 200 ;
    redstring:scale 1.0 .
```

### 2. Graph Structure TTL
```turtle
# graphs/graph-def456.ttl  
@prefix redstring: <https://redstring.io/vocab/> .

<graph:def456> a redstring:Graph ;
    schema:name "Main Graph" ;
    redstring:contains <node:abc123>, <node:xyz789> ;
    redstring:directed true .
```

### 3. Edge Relationships TTL
```turtle
# edges/edges.ttl
@prefix redstring: <https://redstring.io/vocab/> .

<node:abc123> <predicate:relates-to> <node:xyz789> .
<edge:edge123> a redstring:Edge ;
    rdf:subject <node:abc123> ;
    rdf:predicate <predicate:relates-to> ;
    rdf:object <node:xyz789> ;
    redstring:directionality "bidirectional" .
```

### 4. Spatial Context TTL
```turtle
# spatial/layout.ttl
@prefix redstring: <https://redstring.io/vocab/> .

<spatial:main> a redstring:SpatialContext ;
    redstring:viewport [ 
        redstring:x 0 ;
        redstring:y 0 ;
        redstring:zoom 1.0 
    ] ;
    redstring:canvasSize [
        redstring:width 4000 ;
        redstring:height 3000 
    ] .
```

## Implementation Strategy

### Phase 1: TTL Export Functions
```javascript
// src/formats/ttlExport.js
export const exportNodesToTTL = (nodePrototypes) => {
  let ttl = `@prefix redstring: <https://redstring.io/vocab/> .
@prefix schema: <http://schema.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

`;
  
  nodePrototypes.forEach((node, id) => {
    ttl += `<node:${id}> a redstring:Node ;
    schema:name "${node.name}" ;
    schema:description "${node.description}" ;
    schema:color "${node.color}" ;
    redstring:xCoordinate ${node.x || 0} ;
    redstring:yCoordinate ${node.y || 0} ;
    redstring:scale ${node.scale || 1.0} `;
    
    // Add abstraction chain relationships
    if (node.abstractionChains) {
      Object.values(node.abstractionChains).forEach(chain => {
        if (chain.length > 1) {
          const superClass = chain[chain.indexOf(id) - 1];
          if (superClass) {
            ttl += `;
    rdfs:subClassOf <node:${superClass}>`;
          }
        }
      });
    }
    
    ttl += ' .\n\n';
  });
  
  return ttl;
};
```

### Phase 2: TTL Import/Reconstruction
```javascript
// src/formats/ttlImport.js
import { parseTurtle } from './turtleParser.js';

export const reconstructFromTTL = async (ttlFiles) => {
  const storeState = {
    graphs: new Map(),
    nodePrototypes: new Map(),
    edges: new Map(),
    openGraphIds: [],
    activeGraphId: null,
    expandedGraphIds: new Set(),
    // ... other state
  };
  
  // Parse each TTL file
  for (const [filename, ttlContent] of Object.entries(ttlFiles)) {
    const triples = await parseTurtle(ttlContent);
    
    if (filename.startsWith('nodes/')) {
      reconstructNodes(triples, storeState);
    } else if (filename.startsWith('graphs/')) {
      reconstructGraphs(triples, storeState);
    } else if (filename.startsWith('edges/')) {
      reconstructEdges(triples, storeState);
    } else if (filename.startsWith('spatial/')) {
      reconstructSpatialContext(triples, storeState);
    }
  }
  
  return storeState;
};
```

### Phase 3: Git Integration
```javascript
// Enhanced gitStorage.js
export const saveToGitDecomposed = async (storeState) => {
  // Save unified .redstring file
  const redstringData = exportToRedstring(storeState);
  await currentProvider.writeFileRaw('universe.redstring', 
    JSON.stringify(redstringData, null, 2));
  
  // Save decomposed TTL files
  const nodesTTL = exportNodesToTTL(storeState.nodePrototypes);
  await currentProvider.writeSemanticFile('nodes/all-nodes', nodesTTL);
  
  const graphsTTL = exportGraphsToTTL(storeState.graphs);
  await currentProvider.writeSemanticFile('graphs/all-graphs', graphsTTL);
  
  const edgesTTL = exportEdgesToTTL(storeState.edges);
  await currentProvider.writeSemanticFile('edges/all-edges', edgesTTL);
  
  const spatialTTL = exportSpatialToTTL(storeState);
  await currentProvider.writeSemanticFile('spatial/layout', spatialTTL);
};

export const loadFromGitDecomposed = async () => {
  try {
    // Try TTL reconstruction first
    const ttlFiles = await loadAllTTLFiles();
    if (Object.keys(ttlFiles).length > 0) {
      return await reconstructFromTTL(ttlFiles);
    }
  } catch (error) {
    console.log('TTL reconstruction failed, falling back to .redstring file');
  }
  
  // Fallback to unified .redstring file
  const redstringContent = await currentProvider.readFileRaw('universe.redstring');
  return importFromRedstring(JSON.parse(redstringContent));
};
```

## Benefits of TTL Reconstruction

1. **True Semantic Web Compliance** - Each concept is a proper RDF resource
2. **Granular Git History** - Changes to individual nodes/edges show up clearly
3. **External Tool Integration** - Standard RDF tools can query and manipulate data  
4. **Federation Ready** - TTL files can be easily shared between Redstring instances
5. **Backup Redundancy** - Multiple formats ensure data preservation

## Required Dependencies

```json
{
  "rdflib": "^2.2.37",          // Already in package.json!
  "jsonld": "^8.3.3",           // Already in package.json!
  "@tpluscode/rdf-string": "^1.3.0"  // For TTL parsing/generation
}
```

## Implementation Timeline

- **Week 1**: TTL export functions for nodes, graphs, edges
- **Week 2**: TTL import/reconstruction logic  
- **Week 3**: Git integration with decomposed storage
- **Week 4**: Testing and validation of round-trip fidelity

**The answer is YES** - complete graph reconstruction from TTL is absolutely attainable and would provide powerful semantic web capabilities!