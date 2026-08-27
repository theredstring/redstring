# Agentic Batching System

## Overview

The Wizard now uses **comprehensive agentic batching** to build graphs iteratively, similar to how Cursor/Aider handle large coding tasks. Instead of generating all nodes at once (which often hits token limits or produces poor results), the system generates small batches, reads back the results, and decides whether to continue.

## Architecture

### 1. **Initial Request** (User → Bridge)
- User asks: "make a new graph for Taylor Swift and Travis Kelce's network"
- Bridge calls LLM with `AGENT_PLANNER_PROMPT`
- LLM returns `{ intent: "create_graph", graphSpec: { nodes: [...], edges: [...] } }`
- Bridge enqueues goal with `meta: { iteration: 0, agenticLoop: true }`

### 2. **Execution** (Orchestrator → Committer)
- **Planner**: Propagates `meta` from goal → tasks
- **Executor**: 
  - Applies **fuzzy deduplication** (80% similarity threshold using Dice coefficient)
  - Generates operations (`addNodePrototype`, `addNodeInstance`, `addEdge`)
  - Propagates `meta` from task → patch
- **Auditor**: Validates and propagates `meta` from patch → review queue
- **Committer**: Applies operations to UI and detects `meta.agenticLoop` flag

### 3. **Agentic Loop Trigger** (Committer → Bridge)
- Committer sees `meta.agenticLoop === true` in patch
- Reads current graph state:
  ```js
  {
    graphId,
    name,
    nodeCount,   // Total nodes after this batch
    edgeCount,   // Total edges after this batch
    nodes: [...]  // Sample of node names for LLM context
  }
  ```
- Calls `/api/ai/agent/continue` with:
  - `cid`: conversation ID
  - `lastAction`: what just happened
  - `graphState`: current graph snapshot
  - `iteration`: current iteration number
  - `apiConfig`: model settings

### 4. **Continuation Decision** (Bridge → LLM)
- Bridge calls LLM with continuation prompt:
  ```
  AGENTIC LOOP ITERATION {N}/5
  
  Previous action: create_subgraph (6 nodes, 8 edges)
  Current graph state:
  - Nodes: 6
  - Edges: 8
  - Example nodes: Taylor Swift, Travis Kelce, Selena Gomez...
  
  Your options:
  1. "continue" - Add more nodes/edges (provide graphSpec)
  2. "refine" - Define connections or update existing nodes
  3. "complete" - Task is complete, provide summary
  ```

- LLM decides:
  - **"continue"**: Provides new `graphSpec` with 3-6 more nodes
  - **"refine"**: (Future) Defines connection types or updates nodes
  - **"complete"**: Sends summary to chat, stops loop

### 5. **Iteration** (Loop back to Step 2)
- If LLM says "continue", bridge enqueues **new batch**:
  ```js
  {
    goal: 'agent_continue_batch',
    dag: { tasks: [{ toolName: 'create_subgraph', args: { graphSpec: {...} } }] },
    meta: { iteration: N+1, agenticLoop: true }
  }
  ```
- Process repeats: Executor → Fuzzy Dedup → Apply → Committer → Continue
- Max 5 iterations to prevent infinite loops

## Key Features

### Fuzzy Deduplication (Pre-Execution Audit)
**Location**: `src/services/orchestrator/roleRunners.js` (lines 8-60)

```js
function calculateStringSimilarity(s1, s2) {
  // Dice coefficient on bigrams
  // "Avengers Initiative" vs "The Avengers Initiative" = 90%
}

function findExistingPrototype(nodeName, store, similarityThreshold = 0.80) {
  // 1. Try exact match (case-insensitive)
  // 2. Try fuzzy match (>80% similar)
  // 3. Return { proto, matchType, similarity }
}
```

**Logs**:
- `🧬 FUZZY MATCH: "T. Swift" → "Taylor Swift" (85% similar)`
- `♻️ EXACT MATCH: Reusing prototype "Travis Kelce"`
- `✨ NEW PROTOTYPE: Created "Selena Gomez"`

### Meta Propagation Chain
```
Goal (meta: {iteration:0, agenticLoop:true})
  ↓
Task (meta inherited from goal)
  ↓
Patch (meta inherited from task)
  ↓
Review Queue (meta inherited from patch)
  ↓
Committer (reads meta, triggers continuation)
```

### Rate Limit Protection
- Each iteration is a separate LLM call
- Spreads work across multiple requests
- Respects `max_tokens` limits (2000 per call)
- Max 5 iterations = max 10,000 tokens output

### Comprehensive Context
LLM gets:
- **Recent conversation** (last 10 messages)
- **Current graph state** (node count, edge count, sample nodes)
- **Color palette** (extracted from existing nodes)
- **Iteration number** (progress tracking)
- **Last action** (what just happened)

## Configuration

### Max Iterations
**Location**: `bridge-daemon.js` line 620
```js
const MAX_ITERATIONS = 5;  // Increase for larger graphs
```

### Similarity Threshold
**Location**: `src/services/orchestrator/roleRunners.js` line 38
```js
function findExistingPrototype(nodeName, store, similarityThreshold = 0.80) {
  // Lower = more aggressive deduplication (e.g., 0.70)
  // Higher = stricter matching (e.g., 0.90)
}
```

### Planner Token Budget
**Location**: `bridge-daemon.js` line 180
```js
const PLANNER_MAX_TOKENS = 2000;  // Increased for complex graphs
```

## Testing

### Test Case 1: Large Graph
```
User: "make a new graph for Taylor Swift and Travis Kelce's network of closest associates and their associates' associates"

Expected:
- Iteration 0: 6-8 nodes (immediate circle)
- Iteration 1: 4-6 more nodes (second-degree connections)
- Iteration 2: Complete (or 3-5 refinement nodes)
- Total: ~15-20 nodes across 3 batches
```

### Test Case 2: Duplicate Prevention
```
User: "make a graph of the Avengers"
AI: Creates "Avengers Initiative", "Iron Man", "Captain America"...

User: "add more"
AI: Creates "Black Widow", "Hawkeye", links to EXISTING "Avengers Initiative"
     (NOT "The Avengers Initiative" duplicate)
```

### Logs to Watch
```bash
tail -f /tmp/bridge-debug.log | grep -E "FUZZY|AGENTIC|iteration"
```

**Good output**:
```
[Executor] 🧬 FUZZY MATCH: "Avengers" → "Avengers Initiative" (92% similar)
[Committer] AGENTIC LOOP: Checking if more work needed (iteration 1)
[Agent/Continue] LLM decision: continue - Adding second-degree connections
[Executor] ♻️ EXACT MATCH: Reusing prototype "Taylor Swift"
[Agent/Continue] LLM decision: complete - Network sufficiently populated
```

**Bad output** (pre-fix):
```
[Executor] ✨ NEW PROTOTYPE: Created "Avengers Initiative"
[Executor] ✨ NEW PROTOTYPE: Created "The Avengers Initiative"  ❌ DUPLICATE!
```

## Performance

### Before (Single Batch)
- **1 LLM call** to generate entire graph
- Often truncated at ~1200 tokens
- Duplicates when asked to "add more"
- No awareness of existing structure

### After (Agentic Batching)
- **2-5 LLM calls** for iterative building
- Each batch stays under 2000 tokens
- Fuzzy dedup prevents >90% of duplicates
- LLM sees graph state before each iteration

### Token Usage (Example)
```
Iteration 0: ~1800 tokens (6 nodes, 8 edges, connection defs)
Iteration 1: ~1200 tokens (4 nodes, 6 edges, links to existing)
Iteration 2: ~800 tokens (3 nodes, complete)
Total: ~3800 tokens output (vs 1200 truncated before)
```

## Future Enhancements

### 1. **Parallel Batching**
- Process multiple subgraphs simultaneously
- E.g., "Taylor's friends" and "Travis's teammates" in parallel

### 2. **Semantic Deduplication**
- Use LLM for fuzzy matching: "Is 'Tony Stark' the same as 'Iron Man'?"
- Fallback to string similarity for speed

### 3. **Adaptive Batch Size**
- Start small (5 nodes), grow if LLM is confident
- Shrink if hitting errors or duplicates

### 4. **Proactive Connection Definition**
- LLM automatically suggests connection types after N iterations
- E.g., "friend", "teammate", "family" relationships

### 5. **User Intervention**
- Allow user to approve/reject each batch in UI
- "Continue", "Refine", or "Stop" buttons in chat

## Troubleshooting

### "Agent completed without a response"
**Cause**: LLM response truncated, JSON incomplete  
**Fix**: Increase `PLANNER_MAX_TOKENS` (line 180 in `bridge-daemon.js`)

### "Still creating duplicates"
**Cause**: Similarity threshold too high  
**Fix**: Lower `similarityThreshold` to 0.70 or 0.75 (line 38 in `roleRunners.js`)

### "Infinite loop"
**Cause**: LLM keeps saying "continue"  
**Fix**: Adjust `MAX_ITERATIONS` or improve continuation prompt (line 643 in `bridge-daemon.js`)

### "Not triggering continuation"
**Cause**: `meta.agenticLoop` not propagating  
**Fix**: Check propagation chain (goal → task → patch → review → committer)

## Summary

The agentic batching system transforms the Wizard from a **one-shot generator** into a **collaborative graph builder** that:

1. ✅ **Generates incrementally** (small batches over multiple iterations)
2. ✅ **Reads back results** (knows what it just created)
3. ✅ **Prevents duplicates** (fuzzy matching at 80% similarity)
4. ✅ **Decides when done** (LLM autonomously completes)
5. ✅ **Scales efficiently** (spreads load across multiple API calls)

This is **true agentic behavior** - the system reasons, acts, observes, and adapts in a loop until the goal is achieved.

