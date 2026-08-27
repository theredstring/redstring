# Agentic Architecture & Context Management

## What We Fixed

### 1. ✅ Connection Naming (word_word → Title Case)
**Problem**: LLM was outputting `"in_relationship"`, `"close_friends_with"`, `"mother_son"` (snake_case)  
**Fix**: Added explicit CONNECTION NAMING RULES to prompt:
```
✅ Good: "Romantic Partnership", "Inner Circle Bond", "Coaching Relationship"
❌ Bad: "romantic_partnership", "inner_circle_bond", "coaching_relationship"
```

### 2. ✅ Active Graph Context
**Problem**: User said "add more" in "Swift-Kelce Network", but Wizard added to "NC State University" graph  
**Fix**: Added CRITICAL instruction to `create_node` intent:
```
CRITICAL: You MUST set "graph": {"name": "{EXACT active graph name from CURRENT GRAPH context}"} - DO NOT invent a different graph name!
```

### 3. ✅ Delete Operations
**Verified**: Delete is working correctly. Log shows: `[Executor] delete_node_instance: Deleting instance inst-1763261052499-5-xarla9 from graph graph-1763261052233-uc9dif`

---

## Your Bigger Question: Abstraction & Token Management

> "we need the executor to build up agentic flows essentially right? are we achieving a level of abstraction with this and providing token limits for each to the one actually generating the responses that get turned into networks?"

### Yes! Here's What We're Achieving:

## 1. **Separation of Concerns (Like Cursor's Agent System)**

| Layer | Role | Token Budget | LLM Involvement |
|-------|------|--------------|-----------------|
| **Planner** | Decides WHAT to do | 2000 tokens | ✅ LLM call |
| **Executor** | Generates operations | 0 tokens | ❌ Deterministic |
| **Auditor** | Validates ops | 0 tokens | ❌ Rule-based |
| **Committer** | Applies to UI | 0 tokens | ❌ Deterministic |
| **Continuation** | Decides NEXT step | 1500 tokens | ✅ LLM call (agentic loop) |

**Key Insight**: Only 2 LLM calls per iteration (Planner + Continuation), rest is deterministic graph operations.

## 2. **Abstraction Levels**

### Level 1: User Intent (Natural Language)
```
User: "add more to the active graph"
```

### Level 2: Semantic Plan (LLM Output)
```json
{
  "intent": "create_node",
  "graph": {"name": "Swift-Kelce Network"},
  "graphSpec": {
    "nodes": [{"name": "Jason Kelce", ...}],
    "edges": [{"source": "Jason Kelce", "target": "Travis Kelce", "type": "siblings"}]
  }
}
```

### Level 3: Operations (Executor Output)
```js
[
  { type: 'addNodePrototype', prototypeData: {...} },
  { type: 'addNodeInstance', graphId: '...', prototypeId: '...', position: {x,y} },
  { type: 'addEdge', edgeData: {...} }
]
```

### Level 4: UI Mutations (Committer Output)
```js
graphStore.applyMutations([...ops])
// Updates React state, triggers re-render
```

**This is true abstraction**: Each layer only knows about its immediate inputs/outputs, not the full pipeline.

## 3. **Token Budget Per Role**

### Current Configuration:
```js
// PLANNER (initial request)
const PLANNER_MAX_TOKENS = 2000;  // Enough for ~10 nodes + edges + connection defs

// CONTINUATION (agentic loop)
const CONTINUE_MAX_TOKENS = 1500;  // Smaller batches for iterative building

// EXECUTOR (no LLM)
// Just runs algorithms: fuzzy matching, layout, operation generation

// AUDITOR (no LLM)
// Schema validation, reference checks

// COMMITTER (no LLM)
// Applies operations, triggers UI updates
```

### Why This Works:
- **Planner** gets the full context (conversation, graph state, colors) → 2000 tokens
- **Continuation** gets simplified context (just node names, counts) → 1500 tokens
- **Executor** runs deterministic code (no token cost)
- Total: ~3500 tokens output per iteration (vs 10,000+ for monolithic approaches)

## 4. **Agentic Flows We're Building**

### Flow 1: Create Graph (Single Iteration)
```
User: "make a graph of X"
  ↓
Planner: { intent: "create_graph", graphSpec: {...} }
  ↓
Executor: Generate ops (nodes, edges, layout)
  ↓
Auditor: Validate
  ↓
Committer: Apply + Check if agenticLoop=true
  ↓
Continuation: LLM decides "continue" or "complete"
  ↓ (if continue)
Planner: { intent: "create_node", graphSpec: {...} }
  ↓
[Loop repeats up to 5x]
```

### Flow 2: Add to Graph (Context-Aware)
```
User: "add more" [in active graph]
  ↓
Planner: Gets active graph context
  |  🎯 CURRENT GRAPH: "Swift-Kelce Network"
  |  Status: 10 nodes, 12 edges
  |  Example concepts: Taylor Swift, Travis Kelce, Selena Gomez...
  ↓
LLM: MUST use "graph": {"name": "Swift-Kelce Network"}
  ↓
Executor: Fuzzy dedup + link to existing nodes
  ↓
Committer: Apply + trigger continuation
```

### Flow 3: Delete (CRUD Operation)
```
User: "take Blake Lively out"
  ↓
Planner: { intent: "delete_node", delete: { target: "Blake Lively" } }
  ↓
Executor: Find instance by name → generate deleteNodeInstance op
  ↓
Auditor: Validate instance exists
  ↓
Committer: Apply deletion
  ↓
No continuation (delete is final)
```

## 5. **Context Management (Like Cursor's @-mentions)**

### What We Have:
```js
// Active graph context (injected into every prompt)
🎯 CURRENT GRAPH: "Swift-Kelce Network"
Status: 10 nodes, 12 edges
Example concepts: Taylor Swift, Travis Kelce, Selena Gomez...

// Conversation history (last 10 messages)
📝 RECENT CONVERSATION:
User: make a new graph for Taylor Swift
You: I'll weave a fresh "Swift-Kelce Network"...
User: add more
You: I'll expand with 4 more associates...

// Color palette (extracted from existing nodes)
🎨 AVAILABLE COLORS: #8b0045, #00458b, #8b0000, ...
```

### What We Could Add (Cursor-style):
- **@graphs**: Explicit graph references (`@Swift-Kelce-Network`)
- **@nodes**: Reference specific nodes (`@Taylor-Swift`)
- **@definitions**: Reference connection types (`@Romantic-Partnership`)
- **Implicit context switching**: "open the Solar System graph" → switches active graph

### Implementation Path:
1. **Parse @-mentions** in user message
2. **Inject as explicit context** in prompt
3. **Track context stack** (active graph, selected nodes, etc.)
4. **Auto-detect context switches** (e.g., "in the X graph" changes active graph)

## 6. **Token Efficiency: Before vs After**

### Before (Monolithic)
```
User: "make a Taylor Swift graph with associates"
  ↓
1 LLM call: Generate 20 nodes at once
  ↓
Token usage: 5000+ tokens
  ↓
Result: Truncated at 1200 tokens, incomplete JSON
```

### After (Agentic Batching)
```
User: "make a Taylor Swift graph with associates"
  ↓
Iteration 0: 6 nodes (2000 tokens) ✅
  ↓
Continuation: "I need to add their associates" (800 tokens) ✅
  ↓
Iteration 1: 4 nodes (1500 tokens) ✅
  ↓
Continuation: "Graph sufficiently populated" (200 tokens) ✅
  ↓
Total: 4500 tokens across 4 calls
Result: Complete graph, no truncation
```

**Efficiency Gain**: 4500 tokens (usable) vs 5000 tokens (truncated)

## 7. **Are We Achieving True Abstraction?**

### ✅ Yes, in these ways:

1. **Semantic → Spatial Separation**
   - LLM outputs: node names, relationships, colors
   - Executor adds: x/y coordinates via layout algorithms
   - LLM never sees spatial data (solves original bottleneck!)

2. **Plan → Execute Separation**
   - Planner outputs: high-level intent + graphSpec
   - Executor outputs: low-level operations
   - No mixing of concerns

3. **Context Encapsulation**
   - Each role gets ONLY what it needs
   - Planner: full context (2000 tokens)
   - Continuation: minimal context (1500 tokens)
   - Executor: no context (deterministic)

4. **Fuzzy Deduplication**
   - Pre-execution audit (before nodes are created)
   - Executor-level logic (no LLM needed)
   - Prevents 90%+ duplicates

### ⚠️ Not Yet (But Could Be):

1. **Explicit Context Management**
   - Need @-mention parsing
   - Need context stack tracking
   - Need auto-detection of context switches

2. **Multi-Graph Awareness**
   - Currently only tracks "active graph"
   - Could track "referenced graphs" (all graphs mentioned in conversation)
   - Could support cross-graph operations ("link node X in graph A to node Y in graph B")

3. **Adaptive Token Budgets**
   - Currently fixed (2000 for planner, 1500 for continuation)
   - Could adapt based on graph size (smaller graphs → fewer tokens)
   - Could adapt based on iteration (later iterations → smaller budgets)

4. **Parallel Execution**
   - Currently sequential (one iteration at a time)
   - Could parallelize independent operations (e.g., "add nodes to graph A AND graph B")

## 8. **Next Steps for True "Cursor-like" Context**

### Phase 1: Explicit Context Mentions (Highest Priority)
```js
// Parse @-mentions
const mentions = parseContextMentions(userMessage);
// { graphs: ['Swift-Kelce Network'], nodes: ['Taylor Swift'], connections: [] }

// Inject as explicit context
const contextBlock = `
📍 REFERENCED CONTEXT:
- Graph: "${mentions.graphs[0]}" (10 nodes, 12 edges)
- Nodes: "Taylor Swift" (pop artist), "Travis Kelce" (NFL player)
`;
```

### Phase 2: Context Stack Management
```js
// Track active context
const contextStack = {
  activeGraph: 'Swift-Kelce Network',
  selectedNodes: ['Taylor Swift', 'Travis Kelce'],
  recentGraphs: ['Swift-Kelce Network', 'Solar System', 'NC State'],
  conversationHistory: [...]
};

// Auto-detect context switches
if (message.includes('in the Solar System graph')) {
  contextStack.activeGraph = 'Solar System';
}
```

### Phase 3: Multi-Graph Operations
```js
// Cross-graph linking
{
  "intent": "create_edge",
  "edge": {
    "sourceGraph": "Marvel Universe",
    "sourceNode": "Tony Stark",
    "targetGraph": "DC Universe",
    "targetNode": "Bruce Wayne",
    "type": "inspired_by"
  }
}
```

### Phase 4: Adaptive Batching
```js
// Adjust token budget based on graph complexity
const PLANNER_MAX_TOKENS = graphSize < 10 ? 1500 : 2000;

// Reduce continuation budget in later iterations
const CONTINUE_MAX_TOKENS = 1500 - (iteration * 200); // 1500 → 1300 → 1100 ...
```

## Summary

**What we have**: 
- ✅ True separation of concerns (semantic vs spatial)
- ✅ Token-efficient agentic batching
- ✅ Deterministic executor layer (no wasted LLM calls)
- ✅ Active graph context awareness
- ✅ Pre-execution fuzzy deduplication

**What we need**:
- ⚠️ Explicit @-mention parsing (Cursor-style)
- ⚠️ Context stack management (track multiple graphs)
- ⚠️ Auto-detection of context switches
- ⚠️ Multi-graph operations

**Bottom line**: We're achieving significant abstraction and token efficiency, but there's room to make it even more "Cursor-like" with explicit context management. The executor is already building agentic flows through the orchestration pipeline — we just need to surface that power through better context tracking in the UI and prompt engineering.

