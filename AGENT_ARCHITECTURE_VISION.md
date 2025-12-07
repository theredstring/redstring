# Hierarchical Agent Architecture Vision

## The Core Insight

The current Wizard architecture works well because of **strict separation**:
- LLM decides WHAT (intent, semantics)
- System handles HOW (execution, layout, deduplication)
- Single-writer guarantee prevents chaos

This pattern scales. An executive agent doesn't need to do everything - it delegates to specialized minions, each with their own well-defined scope.

---

## Hierarchical Control Structure

```
                    ┌─────────────────┐
                    │   THE WIZARD    │  ← Executive: interprets user intent
                    │  (You talk to)  │     routes to appropriate minion
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │  Graph      │   │  Knowledge  │   │  Analysis   │
    │  Builder    │   │  Enricher   │   │  Engine     │
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                 │                 │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │  Layout     │   │  Wikipedia  │   │  Pattern    │
    │  Engine     │   │  Fetcher    │   │  Matcher    │
    └─────────────┘   └─────────────┘   └─────────────┘
```

Each layer:
- Has a **specific, bounded purpose**
- Only talks to its parent/children
- Cannot modify things outside its scope
- Reports results up, receives tasks down

---

## Agents AS Graphs: The Meta-Layer

### The Revolutionary Idea

What if agents are defined **inside Redstring itself**?

- A node represents an agent component
- The node's **description/bio** contains its prompt/instructions
- Edges represent control flow and data dependencies
- Definition graphs decompose agent capabilities

```
┌─────────────────────────────────────────────────────────────┐
│  Graph: "The Wizard Agent Definition"                        │
│                                                               │
│  ┌─────────────┐        ┌─────────────┐                      │
│  │   Intent    │───────▶│   Router    │                      │
│  │  Detector   │        │             │                      │
│  │             │        │ Bio: "Route │                      │
│  │ Bio: "Parse │        │ to correct  │                      │
│  │ user intent │        │ handler..." │                      │
│  │ from..."    │        └──────┬──────┘                      │
│  └─────────────┘               │                             │
│                    ┌───────────┼───────────┐                 │
│                    │           │           │                 │
│              ┌─────▼─────┐ ┌───▼───┐ ┌─────▼─────┐          │
│              │  Create   │ │ Edit  │ │  Query    │          │
│              │  Handler  │ │Handler│ │  Handler  │          │
│              └───────────┘ └───────┘ └───────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### Node Bio as Agent Prompt

Each agent node's description field becomes its **system prompt**:

```json
{
  "name": "Intent Detector",
  "color": "#8B0000",
  "description": "You are the Intent Detector. Your job is to analyze user messages and classify them into one of these intents: create_graph, create_node, analyze, update_node, delete_node, enrich_node. Return JSON with 'intent' and 'confidence' fields. Do not execute anything - only classify."
}
```

### Edges as Control Flow

Connection definitions describe how agents interact:

| Edge Type | Meaning |
|-----------|---------|
| `Delegates To` | Parent assigns task to child |
| `Reports To` | Child returns results to parent |
| `Depends On` | Must wait for this agent to complete |
| `Validates` | Checks output of another agent |
| `Fallback To` | If primary fails, try this one |

---

## The Druid: Agent Living in Redstring

### Concept

The Druid is an agent whose **entire cognitive state is a Redstring graph**.

- **Working memory** = Active graph's nodes
- **Long-term memory** = Saved/closed graphs
- **Reasoning** = Creating/connecting nodes
- **Learning** = Modifying definition graphs
- **Goals** = Root nodes with "Goal" type
- **Beliefs** = Nodes with confidence scores

```
┌─────────────────────────────────────────────────────────────┐
│  The Druid's Mind (Internal Redstring Instance)             │
│                                                               │
│  ┌─────────────┐                                             │
│  │ Current     │──────────────────────┐                      │
│  │ Goal        │                      │                      │
│  └─────────────┘                      ▼                      │
│                              ┌─────────────────┐             │
│  ┌─────────────┐            │ Working Memory  │             │
│  │ Observation │───────────▶│ (Active Graph)  │             │
│  │ from User   │            └────────┬────────┘             │
│  └─────────────┘                     │                       │
│                                      ▼                       │
│                              ┌─────────────────┐             │
│                              │ Reasoning Path  │             │
│                              │ (Edge Chains)   │             │
│                              └────────┬────────┘             │
│                                       │                       │
│                              ┌────────▼────────┐             │
│                              │ Action Decision │             │
│                              │ (Output Node)   │             │
│                              └─────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

### Wizard vs Druid

| Aspect | The Wizard | The Druid |
|--------|------------|-----------|
| Role | Graph editor | Agent brain |
| State | Stateless | Graph IS state |
| Memory | Conversation only | Persistent graphs |
| Purpose | Help user build | Autonomous reasoning |
| Control | User-directed | Self-directed |

---

## Implementation Phases

### Phase 1: Agent Node Type (Foundation)
- [ ] Add `agentPrompt` field to node prototypes
- [ ] Add `agentType` enum: `executor`, `validator`, `router`, `transformer`
- [ ] Create "Agent" abstraction chain for typing

### Phase 2: Agent Definition Graphs
- [ ] Allow nodes to have `agentPrompt` in their bio
- [ ] Parse agent definitions from graph structure
- [ ] Execute agent chains based on edge traversal

### Phase 3: Agent Builder UI
- [ ] "New Agent" workflow in Wizard
- [ ] Visual prompt editor in node panel
- [ ] Test agent button (run with sample input)
- [ ] Agent template library

### Phase 4: The Druid MVP
- [ ] Internal Redstring instance for agent state
- [ ] Goal → Observation → Reasoning → Action loop
- [ ] Memory persistence across sessions
- [ ] Introspection API (see the Druid's "thoughts")

### Phase 5: Agent Marketplace
- [ ] Export agent as `.redstring-agent` format
- [ ] Import community agents
- [ ] Agent versioning and updates
- [ ] Performance benchmarks

---

## Technical Architecture

### Agent Execution Engine

```javascript
class AgentExecutor {
  constructor(agentGraph) {
    this.graph = agentGraph;
    this.entryPoint = this.findNodeByType('entry');
  }

  async execute(input) {
    let currentNode = this.entryPoint;
    let context = { input, results: {} };

    while (currentNode) {
      // Get agent prompt from node description
      const prompt = currentNode.description;
      
      // Execute this agent step
      const result = await this.runAgentStep(prompt, context);
      context.results[currentNode.name] = result;

      // Follow edges to next node
      currentNode = this.getNextNode(currentNode, result);
    }

    return context.results;
  }

  getNextNode(current, result) {
    const edges = this.getOutgoingEdges(current);
    
    // Router pattern: edge labels are conditions
    for (const edge of edges) {
      if (this.matchesCondition(edge.name, result)) {
        return this.getNode(edge.targetId);
      }
    }
    return null; // End of chain
  }
}
```

### Agent Definition Schema

```json
{
  "agentMeta": {
    "name": "Research Assistant",
    "version": "1.0.0",
    "entryPoint": "node-intent-classifier",
    "author": "The Wizard"
  },
  "nodes": [
    {
      "id": "node-intent-classifier",
      "name": "Intent Classifier",
      "agentConfig": {
        "type": "router",
        "prompt": "Classify the user's research request...",
        "outputFormat": "json",
        "routes": {
          "search": "node-search-executor",
          "summarize": "node-summarizer",
          "compare": "node-comparator"
        }
      }
    }
  ],
  "edges": [
    {
      "source": "node-intent-classifier",
      "target": "node-search-executor",
      "condition": "intent === 'search'"
    }
  ]
}
```

---

## Why This Works

1. **Composability**: Small, focused agents combine into complex behaviors
2. **Debuggability**: You can literally see the agent's structure as a graph
3. **Modifiability**: Change one node's prompt, update one edge
4. **Testability**: Run individual nodes with mock inputs
5. **Shareability**: Export agent as graph, import elsewhere
6. **Self-improvement**: Agent can modify its own definition graph

---

## The Celtic Connection 🌿

Grant, you mentioned Eubanks from "yew banks" - sacred to Celtic druids.

The Druid agent name isn't just whimsy. Druids were:
- **Knowledge keepers** → Graph as memory
- **Advisors to chiefs** → Agent advises Wizard
- **Nature interpreters** → Pattern recognition in data
- **Ritual specialists** → Structured, repeatable processes

The Wizard conjures; the Druid remembers and reasons.

---

## Next Steps

1. **Validate**: Does this architecture feel right?
2. **Prototype**: Add `agentPrompt` field to nodes
3. **Test**: Build a simple 3-node agent manually
4. **Iterate**: What's missing? What's overcomplicated?

The goal: **Anyone can build an AI agent by drawing a graph.**



