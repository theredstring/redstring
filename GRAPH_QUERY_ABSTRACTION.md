# Graph Query Abstraction Layer

## Purpose

The **Graph Query Abstraction Layer** (`src/services/graphQueries.js`) provides a clean, semantic API for accessing graph data throughout the system. It hides the complexity of the internal data structure (Maps, instances, prototypes, edges) and provides consistent, well-documented functions.

## Why This Exists

Previously, graph queries were scattered throughout the codebase with inconsistent patterns:
- Direct access to `store.graphs.get(id)`
- Manual iteration over Maps and arrays
- Different patterns for checking if `instances` is a Map vs array
- Repeated prototype lookups
- Inconsistent error handling

This led to:
- **Bugs** (like the `(graph.instances || []).map is not a function` error)
- **Inconsistency** between bridge-daemon and roleRunners
- **Confusion** for the LLM about what data is available

## Core Functions

### Graph Access

```javascript
import { getGraphById, getActiveGraph, graphExists } from './graphQueries.js';

// Get a specific graph
const graph = getGraphById(store, 'graph-123');

// Get the currently active graph
const activeGraph = getActiveGraph(store);

// Check if a graph exists
if (graphExists(store, graphId)) { ... }
```

### Semantic Structure (for LLM)

```javascript
import { getGraphSemanticStructure } from './graphQueries.js';

// Get nodes, edges, metadata WITHOUT x/y coordinates
const structure = getGraphSemanticStructure(store, graphId, {
  includeDescriptions: true,
  includeColors: true
});

// Returns:
// {
//   graphId, name, nodeCount, edgeCount, isEmpty,
//   nodes: [{ id, prototypeId, name, description?, color? }],
//   edges: [{ id, sourceId, destinationId, label, directionality, definitionNodeIds }]
// }
```

### Statistics & Discovery

```javascript
import { getGraphStatistics, listAllGraphs, findGraphsByName } from './graphQueries.js';

// Get high-level stats for LLM context
const stats = getGraphStatistics(store);
// Returns: { totalGraphs, activeGraph: {...}, allGraphs: [...] }

// List all graphs with node/edge counts
const allGraphs = listAllGraphs(store);

// Search for graphs by name
const results = findGraphsByName(store, 'solar system');
```

## Integration Points

### 1. Bridge Daemon (Prompting)

**Before**: Direct access to `bridgeStoreData.graphs`, manual instance counting
**After**: Uses `getGraphStatistics()` and `getGraphSemanticStructure()`

```javascript
// bridge-daemon.js lines 990-1013
const stats = getGraphStatistics(bridgeStoreData);
let graphContext = '';

if (stats.activeGraph) {
  const ag = stats.activeGraph;
  graphContext = `\n\n🎯 CURRENT GRAPH: "${ag.name}"`;
  graphContext += `\nStatus: ${ag.nodeCount} nodes, ${ag.edgeCount} connections`;
  
  const structure = getGraphSemanticStructure(bridgeStoreData, ag.id);
  const exampleNodes = structure.nodes.slice(0, 3).map(n => n.name).join(', ');
  graphContext += `\nExample concepts: ${exampleNodes}`;
}
```

### 2. Role Runners (Tool Execution)

**Before**: Manual prototype lookups, edge iteration, Map/array handling
**After**: Uses `getGraphSemanticStructure()` for `read_graph_structure` tool

```javascript
// roleRunners.js lines 602-624
const result = getGraphSemanticStructure(store, graphId, {
  includeDescriptions: validation.sanitized.include_descriptions !== false,
  includeColors: true
});

ops.push({
  type: 'readResponse',
  toolName: 'read_graph_structure',
  data: result
});
```

### 3. Future: Tool Descriptions

The abstraction layer should be **referenced in tool schemas**:

```javascript
// toolValidator.js
this.registerSchema('read_graph_structure', {
  description: 'Read semantic graph structure (nodes, edges, NO spatial data). See graphQueries.js for data format.',
  // ...
});
```

## Benefits

1. **Single Source of Truth**: One place to handle graph data access
2. **Consistent Error Handling**: Returns `{ error: 'Graph not found' }` instead of crashing
3. **Type Safety**: Clear return types, handles Map vs array internally
4. **Maintainability**: Update data structure in one place
5. **LLM Clarity**: Clear semantic API that maps to tool descriptions
6. **Debugging**: Easier to trace graph access through abstraction layer

## Next Steps

1. ✅ Create `graphQueries.js` module
2. ✅ Update `roleRunners.js` to use `getGraphSemanticStructure()`
3. ✅ Update `bridge-daemon.js` to use `getGraphStatistics()`
4. 🔄 Update tool descriptions to reference query functions
5. 🔄 Update LLM prompts to explicitly list available query functions
6. 🔄 Consider adding more semantic queries (e.g., `getNodesByPrototype`, `findNodesByName`)

## API Reference

See `src/services/graphQueries.js` for full function signatures and JSDoc comments.

### Quick Reference

| Function | Purpose | Returns |
|----------|---------|---------|
| `getGraphById(store, id)` | Get graph by ID | `{id, name, instances, edgeIds, metadata}` |
| `getActiveGraph(store)` | Get active graph | Same as above |
| `getGraphSemanticStructure(store, id, opts)` | Get LLM-friendly structure | `{graphId, name, nodes, edges, isEmpty}` |
| `getPrototypeById(store, id)` | Get node prototype | `{id, name, description, color}` |
| `getEdgeById(store, id)` | Get edge | `{id, sourceId, destinationId, ...}` |
| `listAllGraphs(store)` | List all graphs | `[{id, name, nodeCount, edgeCount, isActive}]` |
| `getGraphStatistics(store)` | Get high-level stats | `{totalGraphs, activeGraph, allGraphs}` |
| `findGraphsByName(store, term)` | Search graphs by name | `[{id, name, ...}]` |
| `graphExists(store, id)` | Check if graph exists | `boolean` |


