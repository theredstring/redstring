# Redstring - Semantic Knowledge Graph

A semantic knowledge graph application that bridges human cognition and machine intelligence through visual node-based interface, W3C semantic web standards, and AI-powered knowledge discovery.

## What is Redstring?

Redstring enables you to create, connect, and explore concepts through an intuitive visual interface while maintaining full semantic web standards compliance. It's designed for the intersection of personal knowledge management and collective intelligence—where individual thinking becomes collaborative understanding through RDF-based linking.

**Core Philosophy**: Everything is connected. Most things can be generalized as a community of components and relations. Redstring makes these connections visible, explorable, and shareable.

## Key Features

### Visual Knowledge Graphs
- **Node-based Interface**: Drag-and-drop concept creation and connection
- **Hierarchical Organization**: Nodes can expand to reveal internal definition graphs
- **Contextual Definitions**: Same concept can have different meanings in different contexts
- **Visual Abstractions**: Multi-dimensional abstraction chains (specific → general)

### Semantic Web Integration
- **W3C Standards Compliant**: Full RDF, OWL, and JSON-LD support
- **Dual-Format Storage**: Native Redstring format + RDF export for interoperability
- **External Knowledge Sources**: Direct integration with Wikidata, DBpedia, and Wikipedia
- **Property-Based Discovery**: Find related concepts through semantic relationships
- **Cross-Domain Linking**: Connect knowledge across different sources and domains

### Local-First Storage Architecture
- **Multi-Storage Sync**: Save to all enabled storage locations simultaneously
  - Local `.redstring` files (first-class, independent storage)
  - Git repositories (GitHub/Gitea/GitLab - opt-in collaboration)
  - Browser storage (universal fallback/cache)
- **Source of Truth**: Choose which storage drives your UI (matters for loading, not saving)
- **Privacy by Design**: Git/GitHub cannot access data unless you explicitly enable it
- **Resilient**: If one storage method fails, others still succeed

### Git Federation
- **Real-Time Sync**: Sub-5-second auto-commits to Git repositories
- **Hot-Swappable Providers**: Switch between GitHub, GitLab, Gitea, or self-hosted
- **Multi-Provider Redundancy**: Backup to multiple Git providers simultaneously
- **Instant Migration**: Move your entire semantic space between providers in minutes
- **Version History**: Complete audit trail using Git's native capabilities
- **Conflict Resolution**: Git merge capabilities for collaborative knowledge building

### AI-Powered Tools (Experimental - Disabled by Default)
- **First-Class AI Integration**: AI can interact with Redstring like a human user (requires manual setup)
- **Model Context Protocol (MCP)**: Comprehensive tool suite for AI agents
- **Semantic Discovery**: AI-powered exploration of knowledge connections
- **Enhanced Search**: Multi-source queries (70% DBpedia, 20% Wikidata, 10% Wikipedia)
- **Transparent Operations**: Full visibility into AI tool calls and actions

**Note**: AI features are experimental and disabled by default. Users must explicitly enable and configure them.

### Format Versioning
- **Automatic Migration**: Files from older versions (v1.0.0, v2.0.0) auto-upgrade to v3.0.0
- **Version Validation**: Clear error messages for incompatible formats
- **User Feedback**: Migration progress displayed during import
- **Data Protection**: Comprehensive validation before any data changes

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Git (for federation features)
- Modern browser with File System Access API support

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/redstring.git
cd redstring

# Install dependencies
npm install

# Start development server
npm run dev
```

The application will be available at `http://localhost:5173` (Vite dev server) or `http://localhost:4000` (production server).

### Full Stack Development

**Option 1: Docker Compose (Recommended)**
```bash
docker-compose -f deployment/docker/docker-compose.yml up
```

**Option 2: Manual (3 terminals)**
```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: OAuth Server (for GitHub federation)
npm run oauth

# Terminal 3: Main Server
npm run server
```

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
   - Supports GitHub, GitLab, Gitea, or self-hosted Git
   - Real-time sync with sub-5-second auto-commits
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
    ├─→ Local File (if enabled) ✓
    ├─→ Git Repo (if enabled)   ✓
    └─→ Browser Cache (always)  ✓
```

**Source of Truth** only matters when **loading** data—it determines which storage to trust if they differ.

### Git Federation

Git federation enables collaborative knowledge building across teams and organizations.

#### Key Features
- **Provider Abstraction**: Unified interface for GitHub, GitLab, Gitea, etc.
- **Authentication**: OAuth for GitHub, token auth for self-hosted
- **Repository Structure**: Standard layout with `universes/<slug>/<file>.redstring`
- **Conflict Handling**: Git merge capabilities with exponential backoff on conflicts
- **Rate Limiting**: Intelligent batching and circuit breaker protection

#### Typical Workflow

1. **Create or Open Universe**
   - Start with local file storage
   - Build your knowledge graph

2. **Link Git Repository (Optional)**
   - Connect to GitHub/GitLab repository
   - Enable Git sync for backup and collaboration
   - Data stays local, with copies pushed to Git

3. **Collaborate**
   - Team members clone repository
   - Multiple people can work simultaneously
   - Conflicts resolved through Git merge

4. **Switch Providers**
   - Change Git provider anytime
   - Export to new repository
   - No data loss or migration complexity

### Solid Pod Federation (Experimental)

Redstring supports experimental integration with Solid Pods for decentralized storage.

- **WebID Authentication**: Connect to any Solid Pod provider
- **RDF Storage**: Store cognitive spaces as RDF/Turtle files
- **Cross-Pod References**: Link concepts across different users' Pods
- **Access Control**: Granular permissions using Solid protocols

**Note**: Solid integration is experimental. Git federation is recommended for production use.

## AI Integration (Experimental - Disabled by Default)

**IMPORTANT**: AI integration is experimental and disabled by default. These features require:
- Manual setup and configuration
- External AI service credentials
- Technical knowledge of MCP (Model Context Protocol)
- Explicit user opt-in to enable functionality

Most users will not use these features. Standard Redstring functionality works completely independently.

---

Redstring treats AI as a **first-class user** with comprehensive tool access via Model Context Protocol (MCP).

### Available AI Tools

#### Graph Operations
- `list_available_graphs` - List all graphs in current universe
- `get_active_graph` - Get details about currently active graph
- `open_graph` - Open a graph for viewing/editing
- `set_active_graph` - Switch to a different graph

#### Node Operations
- `add_node_prototype` - Create new concept types
- `add_node_instance` - Add nodes to graphs
- `update_node_prototype` - Modify node properties (name, description, color)
- `delete_node_instance` - Remove nodes from graphs
- `move_node_instance` - Reposition nodes on canvas
- `search_nodes` - Find nodes by name or description

#### Edge Operations
- `create_edge` - Connect two nodes with a relationship
- `create_edge_definition` - Define new relationship types

### Tool Call Flow

The AI integration provides complete transparency:

1. **AI Decision**: AI decides to call a tool (e.g., `open_graph`)
2. **MCP Server**: Receives tool call and queues action
3. **Bridge Polling**: Frontend polls for pending actions every 2 seconds
4. **Action Execution**: Bridge executes action in Redstring store
5. **UI Update**: Interface reflects changes in real-time

All steps are logged for debugging and transparency.

### Setting Up AI Integration

```bash
# Run the connection wizard
npm run ai-wizard

# Or test AI integration
npm run test:ai:all
```

See `COMPREHENSIVE_AI_TOOLS.md` for complete documentation.

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

### RDF Export/Import

Export your knowledge graph as standard RDF for semantic web integration:

```javascript
// Export to RDF/Turtle
const rdfData = await exportToRDF(graphState);

// Import from RDF sources
const graphData = await importFromRDF(turtleString);
```

**Dual-Format Approach**:
- Native Redstring format for application functionality
- RDF statements for semantic web interoperability
- Both formats maintained in `.redstring` files

### Cross-Domain Linking

Link concepts across different knowledge bases using standard RDF:

```turtle
# In alice's knowledge graph
@prefix alice: <https://alice.github.io/semantic/vocabulary/> .
@prefix bob: <https://bob.gitlab.com/knowledge/concepts/> .

alice:ClimatePolicy 
    alice:influences bob:EconomicGrowth ;
    alice:derivedFrom <https://dbpedia.org/resource/Climate_change_policy> .
```

## File Format

### Redstring Format (.redstring)

Redstring uses a JSON-based format with JSON-LD context for semantic web compatibility:

```json
{
  "@context": "https://redstring.net/contexts/v1.jsonld",
  "@type": "redstring:CognitiveSpace",
  "format": "redstring-v3.0.0",
  "metadata": {
    "version": "3.0.0",
    "created": "2024-01-01T00:00:00Z",
    "modified": "2024-01-01T12:00:00Z"
  },
  "graphs": { /* Graph definitions */ },
  "nodes": { /* Node prototypes and instances */ },
  "edges": { /* Edge definitions with RDF statements */ },
  "userInterface": { /* UI state */ },
  "federation": { /* Solid Pod references */ }
}
```

### Version Support

- **Current**: v3.0.0 (includes format versioning system)
- **Supported**: v1.0.0, v2.0.0-semantic (auto-migrated)
- **Format History**: Metadata tracks migrations and changes

### Dual-Format Edges

Edges are stored in both native and RDF formats:

```json
{
  "edge-id": {
    "sourceId": "instance-a",
    "destinationId": "instance-b",
    "directionality": { "arrowsToward": [] },
    "rdfStatement": {
      "subject": { "@id": "node:prototype-a" },
      "predicate": { "@id": "node:relationship-type" },
      "object": { "@id": "node:prototype-b" }
    }
  }
}
```

This enables:
- Full application functionality using instance IDs
- Semantic web interoperability using RDF triples
- AI reasoning over semantic relationships

See `redstring-format-spec.md` for complete specification.

## Development

### Project Structure

```
redstring/
├── src/
│   ├── components/        # React UI components
│   ├── store/            # Zustand state management
│   ├── services/         # Core services
│   │   ├── universeManager.js      # Universe orchestration
│   │   ├── gitSyncEngine.js        # Git synchronization
│   │   ├── semanticWebQuery.js     # Semantic search
│   │   └── solidAuth.js            # Solid Pod integration
│   ├── formats/          # Import/export formats
│   │   ├── redstringFormat.js      # Native format
│   │   └── rdfExport.js            # RDF serialization
│   └── ...
├── deployment/
│   ├── app-semantic-server.js      # Production server
│   ├── docker/                     # Docker configs
│   └── gcp/                        # Google Cloud deployment
├── test/
│   ├── formats/          # Format validation tests
│   └── ai/              # AI integration tests
├── docs/                # Additional documentation
└── universes/           # Local universe storage
```

### Key Services

#### Universe Management
- `universeManager.js`: Orchestrates universes, loading, saving, switching
- `universeBackend.js`: Façade for UI components
- `gitFederationService.js`: Git repository management and status

#### Synchronization
- `gitSyncEngine.js`: Background sync with batching and conflict resolution
- `gitNativeProvider.js`: Provider abstraction (GitHub, GitLab, Gitea)
- `persistentAuth.js`: Authentication and token management

#### Semantic Web
- `semanticWebQuery.js`: Multi-source semantic search
- `knowledgeFederation.js`: Cross-domain knowledge linking
- `solidAuth.js` / `solidData.js`: Solid Pod integration

### Testing

```bash
# Run all tests
npm test

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

## Deployment

### Local Development

```bash
# Quick start
npm run dev

# Full stack with OAuth and main server
npm run dev:full
```

### Docker

```bash
# Build and run
npm run prod:docker

# Or use docker-compose
npm run prod:compose
```

### Google Cloud Platform

```bash
# Setup GCP project
npm run setup:gcp

# Deploy to production
npm run deploy:gcp:prod

# Deploy to test environment
npm run deploy:gcp:test
```

#### GCP Architecture

```
Frontend (Port 4000) → Main Server → OAuth Server (Port 3002) → GitHub API
                          ↓
                    Cloud Run Service
                          ↓
                    Secret Manager (OAuth credentials)
```

#### Required Secrets

Store in Google Cloud Secret Manager:
- `github-client-id`: GitHub OAuth app client ID
- `github-client-secret`: GitHub OAuth app client secret
- `github-app-private-key`: GitHub App private key (optional)

#### OAuth Configuration

**GitHub OAuth App Settings:**
- Homepage URL: `https://your-app.run.app`
- Callback URL: `https://your-app.run.app/oauth/callback`

**GitHub App Settings (optional, for enhanced features):**
- Webhook URL: `https://your-app.run.app/api/github/webhook`
- Permissions: Repository contents (read/write)

### Environment Variables

Create `.env` file for local development:

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
- `aiinstructions.txt` - Project overview and recent enhancements
- `redstring-format-spec.md` - File format specification
- `SEMANTIC_WEB_INTEGRATION.md` - Semantic web features and RDF integration
- `COMPREHENSIVE_AI_TOOLS.md` - AI integration and MCP tools
- `GIT_FEDERATION.md` - Git federation architecture and workflows

### Guides
- `LOCAL_DEVELOPMENT.md` - Local setup and testing
- `DEPLOYMENT.md` - Production deployment guide
- `REDSTRING_FORMAT_VERSIONING.md` - Format versioning system
- `DYNAMIC_FEDERATION_GUIDE.md` - Dynamic federation and cross-domain linking

### Troubleshooting
- `TROUBLESHOOTING.md` - Common issues and solutions
- `AI_INTEGRATION_TROUBLESHOOTING.md` - AI tool debugging
- `AUTH_401_FIX.md` - OAuth authentication issues

## Architecture Highlights

### Local-First Design
- Your data lives on your machine by default
- Git/cloud sync is opt-in, not required
- Multiple storage options work together, not exclusively
- Privacy by design: no external access without explicit permission

### Semantic Web Integration
- W3C standards compliant (RDF, OWL, JSON-LD)
- Dual-format storage (native + semantic)
- Cross-domain linking via RDF
- Integration with major knowledge bases (Wikidata, DBpedia, Wikipedia)

### Git-Native Federation
- Real-time sync with background commits
- Hot-swappable providers (GitHub, GitLab, Gitea)
- Multi-provider redundancy and backup
- Version history and conflict resolution via Git

### AI-First Design
- Model Context Protocol (MCP) integration
- Comprehensive tool suite for AI agents
- Transparent operation logging
- First-class AI user experience

## Performance

### Semantic Search
- DBpedia search: ~2-5 seconds, 30-50 entities
- Wikidata search: ~1-3 seconds, 10-20 entities
- Wikipedia search: ~1-2 seconds, 1-5 articles
- **Total**: ~5-10 seconds, 40-70 total entities

### Git Sync
- Auto-commit interval: 20-30 seconds (depending on auth method)
- Conflict retry: Exponential backoff with fresh SHA
- Circuit breaker: Opens after excessive API calls, resumes after cooldown

### UI
- Instant local updates (sub-100ms)
- Debounced drag operations to reduce churn
- Background persistence without blocking UI

## Future Roadmap

### Near-Term
- [ ] Additional Git providers (GitLab, Gitea native support)
- [ ] Enhanced semantic discovery UI
- [ ] Real-time collaborative editing
- [ ] Mobile app with full feature parity

### Mid-Term
- [ ] SPARQL endpoint for semantic queries
- [ ] Vocabulary alignment with standard ontologies
- [ ] Advanced AI reasoning over knowledge graphs
- [ ] Cross-Pod semantic linking (Solid)

### Long-Term
- [ ] Federated query across multiple knowledge bases
- [ ] Automatic ontology extraction from text
- [ ] Collective intelligence features
- [ ] Planetary-scale knowledge federation

## Philosophy

Redstring is built on the belief that **everything is connected**. Knowledge doesn't exist in isolation—it lives in the relationships between concepts, the contexts that shape meaning, and the communities that create understanding.

We're not just building a knowledge management tool. We're architecting infrastructure for **distributed cognition**—where individual thinking becomes collective intelligence through the power of semantic web standards and user-controlled data.

### Key Principles

1. **User Sovereignty**: Your data, your control, your infrastructure
2. **Semantic Standards**: W3C compliance for true interoperability
3. **Local-First**: Work offline, sync when you choose
4. **Privacy by Design**: No external access without explicit permission
5. **Community Intelligence**: Individual graphs compose into larger understanding

## License

MIT License - See `LICENSE` file for details.

## Support

- **Documentation**: See `docs/` directory
- **Issues**: [GitHub Issues](https://github.com/theredstring/redstring/issues)
- **Discussions**: [GitHub Discussions](https://github.com/theredstring/redstring/discussions)

## Credits

An endless thank you to everyone who has provided input and support.
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

**The spark begins with your local files and Git repositories. It ends with a new type of knowledge that spans the planet.**
