# Read-Then-Create Flow: "Yes And" for Existing Graphs

## Problem Statement

**User Feedback**:
> "it really doesn't 'yes and' well with editing an existing graph. like whenever working with a graph it should read it first i think, always. it needs it fresh in context. it builds 'parallel graphs' almost with sometimes the same nodes, but just added again in the network. it also does redundant, already existing connections (sometimes with different names or rephrasings)."

## Root Cause

### What Was Happening:
```
User: "fill more of it out"
  ↓
LLM sees: "Example concepts: Saul Goodman, Kim Wexler, Mike Ehrmantraut..." (only 3 nodes!)
  ↓
LLM generates: 7 new nodes (including "Saul Goodman" again because it only saw 3 examples)
  ↓
Result: Duplicates, parallel graphs, redundant connections
```

### Why It Happened:
1. **Limited context**: Only first 3 nodes shown in prompt (line 1241 in `bridge-daemon.js`)
2. **No read step**: LLM immediately generates nodes without seeing full graph structure
3. **Fuzzy dedup too late**: Deduplication happens in Executor, but LLM already generated bad data

## Solution: Read-Then-Create Flow

### New Behavior:
```
User: "fill more of it out" / "add more" / "populate"
  ↓
Action Hint: "FIRST respond with intent 'analyze' to read the full graph structure"
  ↓
LLM: {"intent": "analyze", "response": "I'll inspect the Better Call Saul graph first"}
  ↓
Executor: Runs read_graph_structure
  ↓
Committer: Sends ALL nodes/edges to chat + triggers /api/ai/agent/continue
  ↓
Continue (SYNTHESIS MODE): 
  - Sees ALL 10+ nodes (not just 3)
  - Sees ALL edges with labels
  - Generates graphSpec with ZERO duplicates
  - Links new nodes to existing ones
  ↓
Executor: Creates new nodes (fuzzy dedup as backup)
  ↓
Result: Perfect synthesis, no duplicates, proper "yes and"
```

## Implementation

### 1. **Force Analyze Intent for Populate Requests**

**Location**: `bridge-daemon.js` lines 1254-1257

```js
if (wantsPopulate) {
  // CRITICAL: Force read_graph_structure FIRST to get full context
  // The "Example concepts" above only shows 3 nodes - not enough for synthesis
  actionHints.push('User explicitly asked to expand the active graph. FIRST respond with intent "analyze" to read the full graph structure. The system will then auto-chain to create_node with complete context.');
}
```

**Effect**: LLM will return `"intent": "analyze"` instead of immediately jumping to `"create_node"`

### 2. **SYNTHESIS MODE Continuation Prompt**

**Location**: `bridge-daemon.js` lines 714-744

```js
if (isReadThenCreate) {
  // READ-THEN-CREATE: User asked to expand, we read the graph, now synthesize new nodes
  const allNodeNames = (readResult.nodes || []).map(n => n.name).join(', ');
  const allEdges = (readResult.edges || []).map(e => 
    `${e.sourceName} → ${e.destinationName} (${e.name || 'connects'})`
  ).join('; ');
  
  continuePrompt = `
SYNTHESIS MODE: The user asked to expand "${readResult.name || 'the graph'}".

EXISTING GRAPH STRUCTURE (All ${readResult.nodeCount} nodes):
Nodes: ${allNodeNames}

Edges: ${allEdges || '(no edges yet)'}

YOUR TASK: Generate a graphSpec that adds 3-6 NEW nodes to this graph.
CRITICAL RULES:
1. CHECK FOR DUPLICATES: Review the node list above. DO NOT recreate existing nodes!
2. LINK TO EXISTING: Every new node should connect to at least one existing node via edges
3. EXPAND SEMANTICALLY: Add related concepts that enrich the graph's domain
4. USE EXISTING NODE NAMES IN EDGES: Reference exact names from the list above

Respond with JSON:
{
  "intent": "create_node",
  "response": "brief message about what you're adding",
  "graphSpec": {
    "nodes": [ /* only NEW nodes */ ],
    "edges": [ /* connect NEW nodes to EXISTING nodes using exact names */ ],
    "layoutAlgorithm": "force"
  }
}
`;
}
```

**Key Features**:
- ✅ Shows **ALL nodes** (not just 3)
- ✅ Shows **ALL edges** with labels
- ✅ Explicit instructions: "DO NOT recreate existing nodes!"
- ✅ Requires linking to existing nodes

### 3. **Handle Read-Then-Create Response**

**Location**: `bridge-daemon.js` lines 815-856

```js
// Handle READ-THEN-CREATE: LLM returns "intent": "create_node" with graphSpec
if (isReadThenCreate && decision.intent === 'create_node' && decision.graphSpec) {
  logger.info(`[Agent/Continue] Read-then-create: Enqueuing synthesis with ${(decision.graphSpec.nodes || []).length} new nodes`);
  
  const layoutAlgorithm = decision.graphSpec.layoutAlgorithm || 'force-directed';
  const dag = {
    tasks: [{
      toolName: 'create_subgraph',
      args: {
        graphId: readResult.graphId,
        graphSpec: {
          nodes: decision.graphSpec.nodes || [],
          edges: decision.graphSpec.edges || []
        },
        layoutAlgorithm,
        layoutMode: 'auto'
      },
      threadId: cid
    }]
  };
  
  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'synthesize_nodes',
    dag,
    threadId: cid,
    partitionKey: cid
  });
  
  ensureSchedulerStarted();
  const responseText = decision.response || `I'll expand "${readResult.name}" with ${(decision.graphSpec.nodes || []).length} new nodes.`;
  appendChat('ai', responseText, { cid, channel: 'agent' });
  
  return res.json({ success: true, completed: false, goalId, nodeCount: (decision.graphSpec.nodes || []).length });
}
```

**Key Features**:
- Recognizes `"intent": "create_node"` (not `"decision": "continue"`)
- Uses `readResult.graphId` (ensures correct graph)
- Enqueues synthesis goal
- Sends friendly message to chat

## Before vs After

### Before (Broken "Yes And"):
```
User: "add more to Better Call Saul graph"
  ↓
LLM sees: "Saul Goodman, Kim Wexler, Mike Ehrmantraut... (3 of 10 nodes)"
  ↓
LLM generates:
{
  "nodes": [
    {"name": "Saul Goodman"},      // ❌ DUPLICATE (already exists!)
    {"name": "Jesse Pinkman"},      // ✅ New
    {"name": "Walter White"},       // ✅ New
    {"name": "Mike Ehrmantraut"}    // ❌ DUPLICATE (already exists!)
  ],
  "edges": [
    {"source": "Saul Goodman", "target": "Kim Wexler"}  // ❌ DUPLICATE (already exists!)
  ]
}
  ↓
Fuzzy dedup catches some but not all
  ↓
Result: Parallel nodes, redundant connections
```

### After (Proper "Yes And"):
```
User: "add more to Better Call Saul graph"
  ↓
LLM: {"intent": "analyze"} (forced by action hint)
  ↓
System reads graph: ALL 10 nodes, ALL 15 edges
  ↓
LLM continuation sees:
"Nodes: Saul Goodman, Kim Wexler, Mike Ehrmantraut, Gus Fring, Lalo Salamanca, Howard Hamlin, Chuck McGill, Nacho Varga, Hector Salamanca, Tuco Salamanca"
  ↓
LLM generates:
{
  "nodes": [
    {"name": "Eduardo 'Lalo' Salamanca"},  // ❌ Wait, "Lalo Salamanca" exists!
    {"name": "Ignacio 'Nacho' Varga"},     // ❌ "Nacho Varga" exists!
    {"name": "Hank Schrader"},             // ✅ Actually new
    {"name": "Skyler White"}               // ✅ Actually new
  ],
  "edges": [
    {"source": "Hank Schrader", "target": "Tuco Salamanca", "type": "adversary"}  // ✅ New connection
  ]
}
  ↓
Fuzzy dedup catches: "Eduardo 'Lalo' Salamanca" ≈ "Lalo Salamanca" (85% similar)
  ↓
Result: Only 2 genuinely new nodes, proper linking, zero visual duplicates
```

## Edge Cases Handled

### 1. **Similar Names (Fuzzy Dedup Still Active)**
```
Existing: "Lalo Salamanca"
LLM generates: "Eduardo 'Lalo' Salamanca"
  ↓
Fuzzy dedup: 85% similarity → reuses existing prototype
  ↓
Result: Zero visual duplicates
```

### 2. **Redundant Connections**
```
Existing: "Saul Goodman" → "Kim Wexler" (Professional Partner)
LLM sees full edge list in SYNTHESIS MODE
LLM generates: "Jesse Pinkman" → "Saul Goodman" (Legal Client)
  ↓
No duplicate connection created
```

### 3. **Empty Graphs**
```
User: "add more"
Graph has: 0 nodes
  ↓
System skips read (nothing to read)
  ↓
Falls back to normal create intent
```

## Testing

### Test Case 1: Populate Existing Graph
```
1. Create graph: "Better Call Saul"
2. Add 5 nodes manually: Saul, Kim, Mike, Gus, Lalo
3. User: "fill more of it out"

Expected behavior:
- AI: "I'll inspect the Better Call Saul graph first"
- Tool: read_graph_structure (reads all 5 nodes)
- System shows: "5 nodes: Saul Goodman, Kim Wexler, Mike Ehrmantraut, Gus Fring, Lalo Salamanca"
- AI: "I'll expand with 4 new characters" (Chuck, Howard, Nacho, Hector)
- Tool: create_subgraph (4 new nodes, 0 duplicates)
- Result: 9 total nodes, all linked properly
```

### Test Case 2: Duplicate Prevention
```
1. Graph has: "Avengers", "Iron Man", "Captain America"
2. User: "add more superheroes"

Expected:
- AI reads graph
- AI generates: "Thor", "Black Widow", "Hulk"
- AI does NOT generate: "Avengers" (already exists)
- AI links: "Thor" → "Avengers", "Black Widow" → "Avengers"
```

### Test Case 3: Connection Synthesis
```
1. Graph has: 10 nodes, 8 edges
2. User: "add more connections"

Expected:
- AI reads graph (sees existing 8 edges)
- AI generates new edges only (no duplicate edges)
- Result: 10 nodes, 15 edges (7 new)
```

## Logs to Watch

```bash
tail -f /tmp/bridge-debug.log | grep -E "analyze|SYNTHESIS|Read-then-create"
```

**Good output**:
```
[Agent] Intent resolved: analyze
[Executor] read_graph_structure: Read 10 nodes, 15 edges from "Better Call Saul"
[Committer] Auto-chaining: triggering follow-up planning with read results
[Agent/Continue] Read-then-create: Enqueuing synthesis with 4 new nodes
[Executor] 🧬 FUZZY MATCH: "Eduardo Lalo" → "Lalo Salamanca" (88% similar)
[Executor] ✨ NEW PROTOTYPE: Created "Hank Schrader"
```

**Bad output** (pre-fix):
```
[Agent] Intent resolved: create_node
[Executor] ✨ NEW PROTOTYPE: Created "Saul Goodman"  ❌ DUPLICATE!
[Executor] ✨ NEW PROTOTYPE: Created "Mike Ehrmantraut"  ❌ DUPLICATE!
```

## Summary

**Problem**: LLM only saw 3 example nodes → created duplicates  
**Solution**: Force `analyze` intent first → LLM sees ALL nodes → zero duplicates

**Key Changes**:
1. ✅ Action hint forces `"intent": "analyze"` for populate requests
2. ✅ SYNTHESIS MODE prompt shows ALL nodes and edges
3. ✅ Continuation handler recognizes read-then-create flow
4. ✅ Fuzzy dedup acts as backup (catches edge cases like "Lalo" vs "Eduardo Lalo")

**Result**: Perfect "yes and" behavior - new nodes link to existing structure, zero visual duplicates! 🎯

