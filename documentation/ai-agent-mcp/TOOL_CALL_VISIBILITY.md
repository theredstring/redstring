# Tool Call Visibility & Completion Status

## Problem Statement

**User Feedback**:
> "all i see on my end is the 4 calls at the end. btw create subgraph and define connections don't have that completed state either."

## Root Cause

The UI was only seeing the **initial** tool call reporting (`status: 'queued'`) but never received **completion** updates (`status: 'completed'`).

### What Was Happening:
```
Bridge → UI: toolCalls: [{ name: 'create_subgraph', status: 'queued' }]
  ↓
Executor runs create_subgraph
  ↓
Committer applies operations
  ↓
UI never notified of completion ❌
```

### Why It Happened:
1. Bridge reports tool calls as `'queued'` when goals are enqueued
2. Committer applies operations but doesn't report back to UI
3. UI shows tool calls stuck in `'queued'` state forever

## Solution: Completion Status Reporting

### Architecture:
```
1. Bridge (/api/ai/agent):
   Returns toolCalls: [{ name: 'create_subgraph', status: 'queued', args: {...} }]
   
2. Executor:
   Runs operations (nodes, edges, layout)
   
3. Committer:
   - Applies operations to UI
   - Detects which tools completed (based on operation types)
   - Reports to /api/bridge/tool-status
   
4. Bridge (/api/bridge/tool-status):
   Pushes telemetry events: { type: 'tool_call', status: 'completed' }
   
5. UI:
   Receives telemetry → Updates tool call status to 'completed' ✅
```

## Implementation

### 1. **New Endpoint: `/api/bridge/tool-status`**

**Location**: `bridge-daemon.js` lines 579-605

```js
app.post('/api/bridge/tool-status', (req, res) => {
  try {
    const { cid, toolCalls } = req.body || {};
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return res.status(400).json({ error: 'toolCalls array required' });
    }
    
    // Push telemetry events for each completed tool
    for (const tool of toolCalls) {
      telemetry.push({
        ts: Date.now(),
        type: 'tool_call',
        name: tool.name,
        args: tool.args || {},
        status: tool.status || 'completed',
        cid
      });
    }
    
    logger.debug(`[Bridge] Tool status update: ${toolCalls.length} tool(s) completed for cid=${cid}`);
    res.json({ ok: true, updated: toolCalls.length });
  } catch (err) {
    logger.error('[Bridge] Tool status update error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});
```

### 2. **Committer Reports Completion**

**Location**: `src/services/Committer.js` lines 214-249

```js
// Report tool call completion status updates to chat
// Determine which tool completed based on operation types
const hasPrototypes = ops.some(o => o.type === 'addNodePrototype');
const hasInstances = ops.some(o => o.type === 'addNodeInstance');
const hasEdges = ops.some(o => o.type === 'addEdge');
const hasEdgeUpdates = ops.some(o => o.type === 'updateEdgeDefinition');

const completedTools = [];

if (hasPrototypes && hasInstances && hasEdges) {
  completedTools.push({
    name: 'create_subgraph',
    status: 'completed',
    args: { graphId, nodeCount, edgeCount }
  });
}

if (hasEdgeUpdates || (hasEdges && !hasInstances)) {
  completedTools.push({
    name: 'define_connections',
    status: 'completed',
    args: { graphId, edgeCount }
  });
}

// Send tool call status updates if any tools completed
if (completedTools.length > 0) {
  await bridgeFetch('/api/bridge/tool-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cid: threadId,
      toolCalls: completedTools
    })
  }).catch(err => console.warn('[Committer] Tool status update failed:', err.message));
}
```

**Key Logic**:
- **Detects tool type** by examining operation types
- **create_subgraph**: Has prototypes + instances + edges
- **define_connections**: Has edge updates OR edges without instances
- **Sends batch update** to `/api/bridge/tool-status`

## Tool Detection Logic

### create_subgraph
```
Operations:
- addNodePrototype (✓)
- addNodeInstance (✓)
- addEdge (✓)

→ Tool: create_subgraph completed
```

### define_connections
```
Operations:
- updateEdgeDefinition (✓)

OR

Operations:
- addEdge (✓)
- No addNodeInstance (✗)

→ Tool: define_connections completed
```

### read_graph_structure
```
Operations:
- readResponse (✓)

→ Already handled by existing Committer logic
```

## Before vs After

### Before (No Completion Status):
```
UI shows:
  Tool Calls:
    1. create_subgraph (queued)  ← Stuck forever
       Args: { graphId: "...", nodes: 7, edges: 9 }
    
    2. define_connections (queued)  ← Stuck forever
       Args: { graphId: "...", includeGeneralTypes: true }
```

### After (With Completion Status):
```
UI shows:
  Tool Calls:
    1. create_subgraph (completed) ✅
       Args: { graphId: "...", nodeCount: 7, edgeCount: 9 }
    
    2. define_connections (completed) ✅
       Args: { graphId: "...", edgeCount: 9 }
```

## Telemetry Flow

### Queued (Initial)
```json
{
  "ts": 1763261052000,
  "type": "tool_call",
  "name": "create_subgraph",
  "args": { "graphId": "...", "layoutAlgorithm": "force", "layoutMode": "auto", "nodes": 7, "edges": 9 },
  "status": "queued"
}
```

### Completed (From Committer)
```json
{
  "ts": 1763261053500,
  "type": "tool_call",
  "name": "create_subgraph",
  "args": { "graphId": "...", "nodeCount": 7, "edgeCount": 9 },
  "status": "completed",
  "cid": "cid-1763261052189-qwqpzs"
}
```

## Testing

### Test Case 1: Basic Graph Creation
```
User: "make a new graph of the Avengers"

Expected UI:
  Tool Calls:
    1. create_populated_graph (queued) → (completed)
    2. define_connections (queued) → (completed)
```

### Test Case 2: Add to Existing Graph
```
User: "add more to this graph"

Expected UI:
  Tool Calls:
    1. read_graph_structure (queued) → (completed)
    2. verify_state (queued) → (completed)
    [Auto-chain triggers]
    3. create_subgraph (queued) → (completed)
    4. define_connections (queued) → (completed)
```

### Test Case 3: Only Define Connections
```
User: "define the connections"

Expected UI:
  Tool Calls:
    1. define_connections (queued) → (completed)
```

## Logs to Watch

```bash
tail -f /tmp/bridge-debug.log | grep -E "Tool status|toolCalls|completed"
```

**Good output**:
```
[Bridge] Tool status update: 2 tool(s) completed for cid=cid-1763261052189-qwqpzs
[Committer] Applied 7 nodes and 9 edges
```

**Bad output** (pre-fix):
```
[Committer] Applied 7 nodes and 9 edges
(no tool status update)
```

## Edge Cases Handled

### 1. **Multiple Tools in One Commit**
```
Operations:
- addNodePrototype
- addNodeInstance
- addEdge (for nodes)
- updateEdgeDefinition (for connections)

Result:
- create_subgraph (completed)
- define_connections (completed)

Both reported in same batch
```

### 2. **Read-Only Operations**
```
Operations:
- readResponse

Result:
- No tool status update (read is handled separately)
```

### 3. **Empty Operations**
```
Operations: []

Result:
- No tool status update
```

## Summary

**Problem**: Tool calls shown as 'queued' forever, no completion feedback  
**Solution**: Committer detects completed tools and reports to `/api/bridge/tool-status`

**Key Changes**:
1. ✅ New endpoint: `/api/bridge/tool-status` (bridge-daemon.js)
2. ✅ Committer reports completion (Committer.js)
3. ✅ Tool detection logic (based on operation types)
4. ✅ Telemetry events pushed for UI consumption

**Result**: Tool calls now show proper lifecycle: queued → completed ✅

**Test It**: Create a new graph and watch the tool calls update from (queued) to (completed) in the UI! 🎯

