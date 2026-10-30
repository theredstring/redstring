# Redstring ![App Version](https://img.shields.io/badge/version-v0.15.9-blue) [![GitHub Sponsors](https://img.shields.io/github/sponsors/theredstring?logo=github&label=Sponsor)](https://github.com/sponsors/theredstring)

A semantic knowledge graph application that bridges human cognition and machine intelligence through visual node-based interface, W3C semantic web standards, and AI-powered knowledge discovery.

**[Download the desktop app](https://github.com/theredstring/redstring/releases)** · **[Use it online at redstring.io](https://redstring.io)** · **[Learn more at redstring.net](https://redstring.net)**

## What is Redstring?

Redstring enables you to create, connect, and explore concepts through an intuitive visual interface while maintaining full semantic web standards compliance. It's designed for the intersection of personal knowledge management and collective intelligence—where individual thinking becomes collaborative understanding through RDF-based linking.

**Core Philosophy**: Everything is connected. Most things can be generalized as a community of components and relations. Redstring makes these connections visible, explorable, and shareable.

## Key Features

### Visual Knowledge Graphs
- **Node-based Interface**: Drag-and-drop concept creation and connection
- **Hierarchical Organization**: Nodes can expand to reveal internal definition graphs
- **Contextual Definitions**: Same concept can have different meanings in different contexts
- **Visual Abstractions**: Multi-dimensional abstraction chains (specific → general)
- **Formulas**: Equations drawn as webs, where every symbol is a Thing you can connect to

### Semantic Web Integration
- **Linked Data Native**: A `.redstring` file is a JSON-LD document, aligned with SKOS and PROV
- **RDF Export**: Turtle, TriG and N-Quads
- **Ontology Import**: Turtle, TriG, N-Triples, N-Quads, RDF/XML (most `.owl` files), JSON-LD and OBO Graphs
- **External Knowledge Sources**: Direct integration with Wikidata, DBpedia, and Wikipedia
- **Property-Based Discovery**: Find related concepts through semantic relationships
- **Cross-Domain Linking**: Connect knowledge across different sources and domains

### Local-First Storage Architecture
- **Multi-Storage Sync**: Save to all enabled storage locations simultaneously
  - Local `.redstring` files (first-class, independent storage)
  - Git repositories (GitHub or self-hosted Gitea, opt-in)
  - Browser storage (universal fallback/cache)
- **Source of Truth**: Choose which storage drives your UI (matters for loading, not saving)
- **Privacy by Design**: Git/GitHub cannot access data unless you explicitly enable it
- **Resilient**: If one storage method fails, others still succeed

### Git Federation
- **Background Sync**: Commits a few seconds after you stop editing
- **Providers**: GitHub (OAuth or GitHub App) or a self-hosted Gitea
- **Shared Universes**: Several people can work in one universe; their edits merge automatically
- **Version History**: Every Git save is a commit, and History shows who saved and what each save did

### The Wizard (AI Agent)
- **Mystical Guide**: The Wizard is Redstring's AI agent — a guide through your knowledge graph with first-class access to create, explore, and transform your semantic space
- **51 Specialized Tools**: Comprehensive tool suite spanning graph creation, formulas, semantic web discovery, tabular data import, and more
- **Bring Your Own Key**: The Wizard uses your own model provider key, stored on your device
- **Model Context Protocol (MCP)**: Full MCP server for integration with external AI clients
- **3-Tier Dynamic Tool Selection**: Core tools always available, advanced tools surface contextually based on graph state and user intent
- **Transparent Operations**: Full visibility into AI tool calls and actions

### Format Versioning
- **Automatic Migration**: Files from older versions (v1 through v3) auto-upgrade on open
- **Forward Compatible**: Fields from a newer minor version are kept, not dropped
- **Version Validation**: A file from a newer major version is refused, after a backup is taken
- **Data Protection**: Comprehensive validation before any data changes

## Getting Started for Humans

Redstring is a desktop-first app. The fastest path is the Electron build.

### Prerequisites
- Node.js 20+ and npm (CI runs Node 24)

### Electron (recommended)

```bash
git clone https://github.com/theredstring/redstring.git
cd redstring
npm install
npm run electron:dev
```

The app opens directly. Create a universe from the header menu, start adding nodes, and connect them on the canvas. The Wizard (AI assistant) is available inside the app once you provide an API key in settings.

### Browser (web dev server)

```bash
npm install
npm run dev
```

Open `http://localhost:4001`. File save uses the browser's File System Access API — you'll be prompted to grant access to a folder the first time you save.

### Full Stack (with OAuth and server features)

```bash
npm run dev:full   # frontend + OAuth server + main server in one terminal
```

---

## Getting Started for AIs

Redstring has a headless stack — the same Zustand store that powers the GUI runs in Node, driven by a CLI, HTTP API, or MCP server. **Start with `documentation/core-system/HEADLESS.md`** for the complete reference. The short version:

```bash
git clone https://github.com/theredstring/redstring.git
cd redstring
npm install

# Create a workspace and your first universe
node cli/redstring.js init --workspace ~/redstring --name "My Universe"

# Build a graph
GID=$(node cli/redstring.js --json graph create "Concepts" | jq -r .id)
node cli/redstring.js node create "Idea A" --graph "$GID"
node cli/redstring.js node create "Idea B" --graph "$GID"
node cli/redstring.js edge create "Idea A" "Idea B" --graph "$GID" --type "leads to"

# Apply a batch of mutations from a JSON spec
node cli/redstring.js apply mutations.json

# See the full store state
node cli/redstring.js state --json
```

### If the Electron app is already open

The CLI auto-detects the running wizard on port 3001 and routes mutations through the live bridge — the canvas updates in real time. **Drop `--universe`** so the CLI uses the bridge instead of writing to the file directly:

```bash
# Routes through the bridge → canvas updates live
node cli/redstring.js apply mutations.json

# Forces direct file mode (use only when the app is closed)
node cli/redstring.js apply mutations.json --universe ~/path/to/universe.redstring
```

### MCP

The MCP server exposes the full Wizard tool suite to any MCP-compatible AI client:

```bash
node redstring-mcp-server.js
```

See `documentation/core-system/HEADLESS.md` for HTTP endpoints, workspace management, GitHub-backed universes, and the full architecture.

## Core Concepts

### Universes
A **Universe** is a complete workspace containing your knowledge graph. Each universe is independent with its own nodes, edges, and storage configuration.

- Create multiple universes for different projects or domains
- Switch between universes instantly
- Configure storage options per universe (local file, Git, browser)

### Nodes (Concepts)
**Nodes** represent concepts, entities, or ideas in your knowledge graph.

- **Prototypes**: The semantic concept (e.g., "Climate Policy")
- **Instances**: Specific occurrences of a concept in different graphs
- **Expandable**: Nodes can contain internal definition graphs
- **Contextual**: Same node can have different definitions in different contexts

### Edges (Relationships)
**Edges** connect nodes and represent relationships between concepts.

- **Directional**: Specify arrow direction (one-way or bidirectional)
- **Typed**: Use connection type nodes to categorize relationships
- **Semantic**: Edges export as RDF triples for semantic web integration

### Graphs
**Graphs** are collections of nodes and edges that form coherent knowledge structures.

- **Hierarchical**: Graphs can define nodes, which can contain more graphs
- **Spatial**: Each graph has its own 2D canvas space
- **Composable**: Build complex knowledge structures from simpler components

### Abstraction Chains
**Abstraction chains** represent generalization hierarchies across multiple dimensions.

- Specific → General relationships (e.g., "Lawyer" → "Professional" → "Person")
- Multiple dimensions (e.g., by profession, by species, by social role)
- Exports as `rdfs:subClassOf` relationships in RDF

## Storage & Federation

### Local-First Architecture

Redstring is designed as a **local-first** application where your data lives on your machine by default.

#### Storage Options (Mix and Match)

1. **Local `.redstring` Files**
   - First-class storage option
   - Works completely independently without Git
   - Use File System Access API to save directly to your filesystem
   - Perfect for personal knowledge management

2. **Git Repository Sync**
   - Opt-in collaboration and backup
   - Supports GitHub or a self-hosted Gitea
   - Commits a few seconds after you stop editing
   - Enable only when you want to collaborate or backup to Git

3. **Browser Storage (IndexedDB)**
   - Universal fallback and cache
   - Always enabled for offline access
   - Synchronizes with other storage options

#### Multi-Storage Sync

When you save, Redstring saves to **ALL enabled storage locations** to keep them in sync:

```
Your Edit → Save
    ↓
    ├─→ Local File (if enabled)
    ├─→ Git Repo (if enabled)
    └─→ Browser Cache (always)
```

**Source of Truth** only matters when **loading** data—it determines which storage to trust if they differ.

### Git Federation

Git federation enables collaborative knowledge building across teams and organizations.

#### Key Features
- **Providers**: GitHub and self-hosted Gitea behind one interface
- **Authentication**: OAuth or a GitHub App for GitHub, a token for Gitea
- **Repository Structure**: Standard layout with `universes/<slug>/<file>.redstring`
- **Merging**: When two people save the same universe, their edits are merged against the version they both started from
- **Rate Limiting**: Intelligent batching and circuit breaker protection

#### Typical Workflow

1. **Create or Open Universe**
   - Start with local file storage
   - Build your knowledge graph

2. **Link Git Repository (Optional)**
   - Connect to a GitHub or Gitea repository
   - Enable Git sync for backup and collaboration
   - Data stays local, with copies pushed to Git

3. **Collaborate**
   - Give others access to the repository
   - Multiple people can work in the same universe
   - Edits merge automatically; History shows who saved what

## The Wizard

The Wizard is Redstring's mystical guide through your knowledge graph — an AI agent that can create, explore, and transform your semantic space through natural conversation. With first-class access to 51 specialized tools organized in a 3-tier dynamic selection system, it works alongside you: core tools are always available, while advanced tools surface contextually based on your graph state and what you're asking about.

### Wizard Tools

#### Graph Creation & Navigation
- `createGraph` - Create a new graph workspace
- `createPopulatedGraph` - Create a new graph with nodes, edges, and groups in one step
- `expandGraph` - Add nodes, edges, and groups to an existing graph
- `buildComposition` - Build nested layers (Things with webs inside them) in one call
- `readGraph` - Read all nodes, edges, and groups from the active graph
- `switchToGraph` - Navigate to a different graph
- `inspectWorkspace` - Quick comprehensive overview of entire workspace
- `sketchGraph` - Sketch a graph structure in lightweight shorthand before building it

#### Node Operations
- `createNode` - Create a single node in the active or target graph
- `updateNode` - Update an existing node's properties (name, description, color)
- `setNodeSize` - Change the size of one node on the canvas
- `deleteNode` - Remove a node and its connections by name
- `selectNode` - Select and highlight a node on the canvas
- `getNodeContext` - Get a node and its neighbors
- `search` - Search for nodes or connections by keyword, or list all
- `setNodeType` - Set or clear a node's type/category (auto-creates type node)
- `inspectPrototype` - Get detailed properties of a node prototype and find all instances

#### Edge Operations
- `createEdge` - Connect two existing nodes by name
- `updateEdge` - Update properties of an existing connection
- `deleteEdge` - Remove a connection between nodes
- `replaceEdges` - Bulk-replace or update connections between existing nodes

#### Groups
- `createGroup` - Create a visual group to organize nodes together
- `updateGroup` - Update a group (rename, change color, add/remove members)
- `deleteGroup` - Delete a group (member nodes are kept)
- `thingGroup` - Convert a Group into a Thing-Group, or collapse it back to a node

#### Definitions & Structure
- `populateDefinitionGraph` - Create and populate a definition graph for a node in one step
- `manageDefinitions` - List or remove definition graphs for a node
- `decomposeNode` - Unpack a node into its definition graph contents as a Thing-Group
- `condenseToNode` - Package selected nodes into a new concept with a definition graph
- `abstractionChain` - Read, add to, or remove from a node's abstraction chains

#### Formulas
- `addFormula` - Write an equation into a web, each symbol a Thing
- `searchFormulaBank` - Find an equation in this universe or in the formula bank (well-known equations by discipline, from Wikidata)
- `formula` - Place, open or edit a formula that exists

#### Semantic Web Discovery
- `discoverOrbit` - Discover linked-data connections from Wikidata/DBpedia (returns 4 quality rings)
- `semanticSearch` - Search Wikidata/DBpedia for entity data (enrich or related mode)
- `materializeSemanticEntities` - Turn semantic web discoveries into Redstring nodes/edges
- `importKnowledgeCluster` - BFS crawl of Wikidata/DBpedia linked data around a seed entity
- `querySparql` - Execute raw SPARQL SELECT queries against Wikidata/DBpedia/Schema.org

#### Identifiers & Sources
- `linkIdentifier` - Attach a DOI, a Wikidata/Wikipedia/DBpedia entry, or any URL to Things
- `findWork` - Look up the real DOIs for papers from their title, author and year

#### Enrichment & Styling
- `enrichFromWikipedia` - Pull Wikipedia data for a node (image, description, link)
- `themeGraph` - Re-color all nodes and connections based on a palette

#### Duplicate Management
- `findDuplicates` - Find potential duplicate nodes by name similarity
- `mergeNodes` - Merge two nodes into one (primary survives, secondary absorbed)
- `mergeGraphs` - Find and merge duplicate nodes between two graphs

#### Tabular Data Import
- `analyzeTabularData` - Analyze attached tabular file (CSV, TSV, XLSX, JSON) structure
- `importTabularAsGraph` - Import tabular data as a graph (entity lists, edge lists, adjacency matrices, relational data)

#### Planning & Interaction
- `planTask` - Create or update a step-by-step task plan for complex operations
- `declareGoal` - In goal mode, state what a build must satisfy before building it
- `askMultipleChoice` - Ask the user a multiple-choice question
- `listTools` - List all available tools with descriptions

### Tool Selection Strategy

The Wizard uses 3-tier dynamic filtering so conversations stay focused:

- **Tier 1 (Always Available)**: Core creation, search, navigation, formula and planning tools
- **Tier 2 (Context-Triggered)**: Groups, definitions, merging, and styling tools — included when your graph has relevant content
- **Tier 3 (Keyword-Triggered)**: Semantic web discovery and tabular import tools — included when your message mentions related concepts

### Tool Call Flow

1. **You speak**: Describe what you want in natural language
2. **Wizard plans**: The agent selects and sequences tool calls
3. **MCP Server**: Receives tool calls and queues actions
4. **Bridge execution**: Frontend executes actions in the Redstring store
5. **UI updates**: Your canvas reflects changes in real-time

All steps are logged for full transparency.

### Setting Up the Wizard

```bash
# Run the connection wizard
npm run ai-wizard

# Or test AI integration
npm run test:ai:all
```

See `documentation/ai-agent-mcp/MCP_TOOLS_QUICK_REFERENCE.md` for the MCP tool reference.

### CLI + Canvas Coworking

The CLI (`cli/redstring.js`) can drive the live canvas while the app is open. When Electron (or any browser session with the wizard running) is detected on port 3001, the CLI auto-routes mutations through the bridge instead of writing directly to the file — changes land in the live store and the canvas updates immediately.

```bash
# With Electron open, drop --universe so the CLI uses the bridge
node cli/redstring.js apply my-mutations.json

# Without the app open, --universe targets the file directly
node cli/redstring.js apply my-mutations.json --universe ~/path/to/universe.redstring
```

See `documentation/core-system/HEADLESS.md` for the full CLI reference and coworking details.

## Semantic Web Features

### Enhanced Semantic Search

Redstring integrates multiple semantic web sources for comprehensive knowledge discovery:

```javascript
// Example: Search for related concepts
const results = await enhancedSemanticSearch('LittleBigPlanet', {
  timeout: 25000,
  limit: 50,
  includeWikipedia: true
});

// Returns 40-70 related entities from:
// - DBpedia (70%): Property-based relationships, categories
// - Wikidata (20%): Fuzzy search, SPARQL queries
// - Wikipedia (10%): Article summaries, links
```

### Search Strategies

1. **Direct Entity Search**: Exact and fuzzy matching across sources
2. **Property-Based Search**: Find entities through shared properties
3. **Category-Based Search**: Discover concepts in related categories
4. **Relationship Traversal**: Follow semantic connections between entities

### RDF Export and Ontology Import

A `.redstring` file is already linked data: one JSON-LD document whose webs are RDF named graphs. From the app's export menu (or `src/formats/rdfExport.js`) the same dataset can be written as Turtle, TriG or N-Quads:

```javascript
import { exportToTurtle, exportToTrig } from './src/formats/rdfExport.js';

const turtle = await exportToTurtle(storeState);
const trig = await exportToTrig(storeState);
```

Ontologies and RDF files come in through **Import Ontology** (in the File menu or the universe list), or from the CLI:

```bash
node cli/redstring.js import my-ontology.owl
```

### Cross-Domain Linking

Link concepts across different knowledge bases using standard RDF:

```turtle
# In alice's knowledge graph
@prefix alice: <https://alice.github.io/semantic/vocabulary/> .
@prefix bob: <https://bob.example.org/knowledge/concepts/> .

alice:ClimatePolicy 
    alice:influences bob:EconomicGrowth ;
    alice:derivedFrom <https://dbpedia.org/resource/Climate_change_policy> .
```

## File Format

### Redstring Format (.redstring)

Redstring uses a JSON-based format with JSON-LD context for semantic web compatibility.

**v4** (June 2026) introduced the `prototypeSpace` / `spatialGraphs` top-level shape: node prototypes live in a shared namespace and each graph is a named spatial context that owns its instances and edges. The current version is **4.1.0**, which adds per-instance node size; later additions within 4.1.0 (images by reference, definitions opened in place, formulas) are optional fields that older builds keep untouched.

```json
{
  "@context": "https://redstring.net/contexts/v1.jsonld",
  "@type": "redstring:CognitiveSpace",
  "format": "redstring-v4.1.0",
  "metadata": {
    "version": "4.1.0",
    "created": "2024-01-01T00:00:00Z",
    "modified": "2024-01-01T12:00:00Z"
  },
  "prototypeSpace": {
    "nodePrototypes": { /* shared node type definitions */ }
  },
  "spatialGraphs": {
    "graph-id": {
      "nodes": { /* positioned instances of prototypes */ },
      "edges": { /* edges scoped to this graph */ }
    }
  },
  "userInterface": { /* UI state */ }
}
```

Edges are embedded inside each `spatialGraph` entry (they were in a global `relationships` section in v3). Each edge carries both native instance IDs and an RDF statement for semantic web interoperability:

```json
{
  "edge-id": {
    "sourceId": "instance-a",
    "destinationId": "instance-b",
    "directionality": { "arrowsToward": [] },
    "definitionNodeIds": ["conn-leads-to"],
    "rdfStatement": {
      "subject": { "@id": "node:prototype-a" },
      "predicate": { "@id": "node:relationship-type" },
      "object": { "@id": "node:prototype-b" }
    }
  }
}
```

### Version Support

- **Current**: v4.1.0 — `prototypeSpace`/`spatialGraphs` shape, graph-scoped edges, SKOS+PROV alignment (v4 was a breaking change from v3)
- **Supported**: v1.0.0, v2.0.0-semantic, v3.0.0, v4.0.0 (all auto-migrated on open)
- **Format History**: Metadata tracks migrations and applied changes

See `documentation/data-format/redstring-format-spec.md` for the complete specification.

## Development

### Project Structure

```
redstring/
├── src/
│   ├── components/       # React UI components (canvas layers, hosts, panels)
│   ├── store/            # Zustand state management
│   ├── services/         # Core services
│   │   ├── universeBackend.js      # Universe loading, saving, switching
│   │   ├── gitSyncEngine.js        # Git synchronization
│   │   └── semanticWebQuery.js     # Semantic search
│   ├── formats/          # The .redstring format, RDF codecs, ontology import
│   ├── wizard/           # The Wizard's agent loop and tools
│   └── ...
├── electron/             # Desktop app main process, preload, updater
├── functions/            # Cloudflare Pages functions behind redstring.io (OAuth, API)
├── cli/                  # Headless CLI
├── android/, ios/        # Capacitor mobile shells
├── test/                 # Unit, security and meta tests
└── documentation/        # Architecture and design documentation
```

### Key Services

#### Universe Management
- `universeBackend.js`: Universes: loading, saving, switching, storage slots

#### Synchronization
- `gitSyncEngine.js`: Background sync with batching and conflict resolution
- `gitNativeProvider.js`: Provider abstraction (GitHub, Gitea)
- `persistentAuth.js`: Authentication and token management

#### Semantic Web
- `semanticWebQuery.js`: Multi-source semantic search
- `knowledgeFederation.js`: Cross-domain knowledge linking

### Testing

```bash
# Run all tests
npm test

# What CI runs
npm run test:ci

# Format tests
npm run test:format
npm run test:consistency
npm run test:roundtrip

# AI integration tests
npm run test:ai:all
npm run test:mcp
npm run test:bridge
```

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

**Note**: This is significant work. Test your changes thoroughly and verify they work before submitting.

### Environment Variables

The OAuth server used by `npm run dev:full` reads a `.env` file:

```bash
# GitHub OAuth
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret

# GitHub App (optional)
GITHUB_APP_ID=your_app_id
GITHUB_APP_CLIENT_ID=your_app_client_id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...your private key...
-----END RSA PRIVATE KEY-----"

# Server Configuration
NODE_ENV=development
PORT=4000
OAUTH_PORT=3002
```

## Documentation

### Core Documentation
- `AI_COMPENDIUM.md` - Index of all documentation, tagged by status
- `documentation/core-system/CANVAS_ARCHITECTURE.md` - The canvas: stores, layers, hosts, controllers
- `documentation/data-format/redstring-format-spec.md` - File format specification
- `documentation/core-system/HEADLESS.md` - Run and drive Redstring without a browser (CLI, workspaces, universes, GitHub) — start here if you're an AI that cloned this repo
- `documentation/semantic-web/SEMANTIC_WEB_INTEGRATION.md` - Semantic web features and RDF integration
- `documentation/ai-agent-mcp/MCP_TOOLS_QUICK_REFERENCE.md` - Wizard tools and MCP integration
- `documentation/core-system/GIT_FEDERATION.md` - Git federation architecture and workflows

### Guides
- `documentation/storage-federation/LOCAL_DEVELOPMENT.md` - Local setup and testing
- `documentation/storage-federation/DEPLOYMENT.md` - Production deployment guide
- `documentation/data-format/REDSTRING_FORMAT_VERSIONING.md` - Format versioning system

### Troubleshooting
- `documentation/storage-federation/TROUBLESHOOTING.md` - Common issues and solutions
- `documentation/ai-agent-mcp/AI_INTEGRATION_TROUBLESHOOTING.md` - Wizard and AI tool debugging

## Architecture Highlights

### Local-First Design
- Your data lives on your machine by default
- Git/cloud sync is opt-in, not required
- Multiple storage options work together, not exclusively
- Privacy by design: no external access without explicit permission

### Semantic Web Integration
- W3C standards: JSON-LD native, RDF export, SKOS and PROV alignment, OWL ontology import
- Cross-domain linking via RDF
- Integration with major knowledge bases (Wikidata, DBpedia, Wikipedia)

### Git-Native Federation
- Background sync a few seconds after you stop editing
- GitHub or self-hosted Gitea
- Shared universes that merge everyone's edits
- Version history via Git

### The Wizard (AI-First Design)
- Built-in AI agent with 51 specialized tools
- 3-tier dynamic tool selection based on context
- Model Context Protocol (MCP) for external AI client integration
- Transparent operation logging and full tool call visibility

## Performance

### Semantic Search
- DBpedia search: ~2-5 seconds, 30-50 entities
- Wikidata search: ~1-3 seconds, 10-20 entities
- Wikipedia search: ~1-2 seconds, 1-5 articles
- **Total**: ~5-10 seconds, 40-70 total entities

### Git Sync
- Commits 3 seconds after you stop editing, and at least every 30 seconds while you keep going
- Conflict retry: Exponential backoff with fresh SHA
- Circuit breaker: Opens after excessive API calls, resumes after cooldown

### UI
- Instant local updates (sub-100ms)
- Debounced drag operations to reduce churn
- Background persistence without blocking UI

## Philosophy

Redstring is built on the belief of holism, that **everything is connected**. Understanding the Universe lives in the relationships between concepts, the contexts that shape meaning, and the communities that create compositions when they work together.

Redstring is infrastructure for **distributed cognition**, where individual data management meets collective intelligence through the power of a decentralized design pattern where you own the data. It is a shared knowledge commons built on top of the Semantic Web.

### Key Principles

1. **User Sovereignty**: Your data, your control, your infrastructure
2. **Semantic Standards**: W3C compliance for true interoperability
3. **Local-First**: Work offline, sync when you choose
4. **Privacy by Design**: No external access without explicit permission
5. **Community Intelligence**: Individual graphs compose into larger understanding

## License

MIT License - See `LICENSE` file for details.

## Support

- **Documentation**: See `AI_COMPENDIUM.md` and the `documentation/` directory
- **Issues**: [GitHub Issues](https://github.com/theredstring/redstring/issues)
- **Discussions**: [GitHub Discussions](https://github.com/theredstring/redstring/discussions)
- **Sponsor**: [Support development on GitHub Sponsors](https://github.com/sponsors/theredstring)

## Credits

An endless thank you to everyone who has provided input, patience, and support.
- Grant Eubanks

Built with:
- The help of nearly every mainstream LLM Since GPT 3
- React & Vite
- Zustand (state management)
- RDF.js & JSON-LD
- Model Context Protocol (MCP)
- Solid Project
- Express.js
- And many other amazing open source projects

---
