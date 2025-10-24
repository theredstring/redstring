# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

**Redstring** is a React-based cognitive interface for constructing and navigating networks of conceptual nodes. It implements a sophisticated graph-based system where nodes can contain other graphs, enabling hierarchical recursion and composition.

### Core Technologies
- **React 18** with functional components and hooks
- **Zustand** for state management (`src/store/graphStore.jsx`)
- **React DnD** for drag-and-drop interactions
- **Vite** for build tooling with hot reload
- **Vitest** for testing
- **Framer Motion** for animations
- **Web Workers** for canvas operations (`src/canvasWorker.js`)

### Key Architecture Patterns

**Prototype/Instance Model**: The system uses a dual-layer architecture:
- **Node Prototypes** (`nodePrototypes` Map): Define the "type" of a node (name, color, description, definitions)
- **Node Instances** (`graph.instances` Map): Position and scale data for prototype instances within specific graphs
- **Edges** connect instance IDs, not prototype IDs

**Context-Aware Definitions**: Nodes can have multiple definition graphs, with context-specific active definitions tracked via `nodeDefinitionIndices` Map using `"nodeId-graphId"` composite keys.

**Recursive Graph Structure**: Nodes can define graphs, and graphs can contain instances of nodes, enabling infinite recursive nesting.

## Central Components

### NodeCanvas.jsx
The main orchestration component handling:
- SVG-based graph rendering
- Mouse/touch/keyboard interactions
- Pan/zoom with sophisticated input device detection
- State management coordination
- PieMenu system for contextual actions
- Drag-and-drop operations

### Store Management (src/store/graphStore.jsx)
Zustand store with SaveCoordinator middleware managing:
- Graph and node prototype data (using Maps for performance)
- UI state (active graph, expanded nodes, saved nodes)
- Tab management for right panel
- Context-aware definition tracking
- **SaveCoordinator Middleware**: Batches state changes and coordinates saves to prevent performance issues during interactions

### Core Data Structures (src/core/)
- **Graph.js**: Graph class with nodes/edges Maps
- **Node.js**: Node class extending Entry with position/definition data
- **Edge.js**: Edge class with directional arrow system

## Important Implementation Details

### Input Device Detection
The `handleWheel` function in NodeCanvas.jsx implements sophisticated cross-platform input detection:
- **Mac Trackpad**: Ctrl+scroll triggers zoom, fractional deltas trigger pan
- **Mouse Wheel**: Large integer deltas trigger zoom
- **Pattern Analysis**: Maintains rolling history of delta values for reliable device identification

### PieMenu System
Complex state management for contextual menus:
- `selectedNodeIdForPieMenu`: Target node for menu
- `isTransitioningPieMenu`: Animation state management
- `onExitAnimationComplete`: Callback for animation coordination
- Dynamic button generation based on node context

### File Management & RedstringMenu
- **Universe Files**: `.redstring` format for complete workspace state
- **Auto-save**: Debounced saves to prevent data loss
- **RedstringMenu**: Animated header menu with nested submenus for file operations
- **Recent Files**: Dynamic loading of recent `.redstring` files

### Dynamic Description Feature
- Context-aware descriptions that adapt to active definition graphs
- Dynamic height calculation using DOM measurement
- "Chin" expansion effect for expanded nodes
- Seamless panel-canvas synchronization

### Semantic Web Integration
- **Live SPARQL Queries**: Direct-fetch SPARQL client for real-time queries to Wikidata, DBpedia, and other semantic web endpoints
- **Federated Knowledge Import**: Mass knowledge cluster import system that discovers semantic relationships and builds comprehensive knowledge graphs
- **Cognitive Augmentation**: Semantic web infrastructure acts as invisible substrate, reducing free recall burden while increasing discovery opportunities
- **Connection Browser**: Interface for browsing and selectively materializing semantic web relationships as native Redstring nodes and connections
- **Semantic-to-Native Translation**: RDF triplets automatically converted to Redstring-native visual elements using appropriate colors and styling

### Save System & Performance Optimization
- **SaveCoordinator**: Centralized save management that coordinates local file saves and Git commits
- **Micro-Batching Middleware**: Batches rapid state changes within the same event loop tick to prevent excessive hash calculations
- **Drag-Aware Saves**: Detects drag operations via `isDragging` and `phase` context flags, deferring saves until interaction completes
- **Viewport Exclusion**: Pan/zoom changes excluded from hash calculation to prevent unnecessary saves
- **FNV-1a Hashing**: Fast hash algorithm for change detection on large state objects
- **Context Options**: All store actions accept `contextOptions` parameter to control save behavior (`isDragging`, `phase`, `finalize`)

## Testing Strategy

Tests are located in `test/` directory:
- `core/`: Unit tests for Graph, Node, Edge classes
- `store/`: Store functionality tests
- Component tests alongside components (e.g., `NodeCanvas.test.jsx`)

## Development Guidelines

1. **State Updates**: Always use Zustand store actions, never mutate state directly
2. **Map Usage**: Store uses Maps for performance - ensure proper serialization for file I/O
3. **Context Awareness**: Use composite keys (`"nodeId-graphId"`) for context-specific state
4. **Animation Coordination**: Respect PieMenu animation lifecycle and state transitions
5. **Input Handling**: Consider device-specific behavior in interaction code
6. **Recursive Safety**: Handle infinite nesting cases in graph traversal logic
7. **Save Context Options**: When calling store actions during drag operations, pass `contextOptions` with `isDragging` and `phase` flags to prevent save-induced performance issues

## Common Patterns

- **Hydrated Nodes**: Combine prototype + instance data using `getHydratedNodesForGraph` selector
- **Definition Navigation**: Use `onNavigateDefinition` callbacks for context-aware definition switching
- **Cleanup**: Use `cleanupOrphanedData` for removing unreferenced prototypes/graphs
- **Edge Directionality**: Arrows stored as Set of node IDs in `edge.directionality.arrowsToward`
- **Composite Keys**: Pattern of `"nodeId-graphId"` for context-specific state tracking

## Key Files to Understand

- `src/NodeCanvas.jsx`: Main rendering and interaction logic
- `src/store/graphStore.jsx`: State management and data model with SaveCoordinator middleware
- `src/services/SaveCoordinator.js`: Centralized save coordination with performance optimizations
- `src/core/Graph.js`: Core graph data structure
- `src/Panel.jsx`: Right panel interface
- `src/PieMenu.jsx`: Contextual menu system
- `src/services/sparqlClient.js`: Direct-fetch SPARQL client for semantic web queries
- `src/services/knowledgeFederation.js`: Mass knowledge import and cluster analysis
- `src/services/semanticWebQuery.js`: Unified semantic enrichment service
- `src/components/SemanticEditor.jsx`: Semantic web integration interface
- `aiinstructions.txt`: Detailed project philosophy and comprehensive development patterns
- `SAVE_COORDINATOR_README.md`: Documentation for save coordination system