# Wizard AI Iteration & Auto-Layout Fixes

## Issues Fixed

### 1. **Hardcoded 5 Iterations - Too Slow**
**Problem**: The agent would iterate 5 times regardless of graph size, making it painfully slow for simple requests.

**Fix**: Reduced `MAX_ITERATIONS` from 5 to 2:
- **Iteration 0**: Initial creation (e.g., create 5 nodes)
- **Iteration 1**: Refinement pass (add connections, fill gaps)
- **Stop**: Complete

This is much faster while still allowing for quality refinement.

**File**: `bridge-daemon.js` (line 924)

---

### 2. **Smart Stopping Conditions**
**Problem**: The agent would blindly iterate even when the graph was already well-populated.

**Fix**: Added intelligent stopping based on node count:

```javascript
const REASONABLE_NODE_COUNT = 15; // Most graphs don't need more than this

// Stop if graph is already well-populated
if (nodeCount >= REASONABLE_NODE_COUNT) {
  logger.info(`[Agent/Continue] Graph has ${nodeCount} nodes (>= ${REASONABLE_NODE_COUNT}), stopping iteration`);
  return res.json({ success: true, completed: true, response: `✅ Graph complete with ${nodeCount} nodes...`, reason: 'sufficient_nodes' });
}
```

Now the agent will stop early if:
1. Max iterations (2) reached
2. Graph has 15+ nodes (reasonable size)
3. AI explicitly decides to complete

**File**: `bridge-daemon.js` (lines 927-942)

---

### 3. **Auto-Layout Already Works**
**Good News**: Auto-layout is already being triggered after each iteration!

The flow is:
1. **Committer** detects node additions (line 209-213 in `Committer.js`)
2. **Dispatches event** `rs-trigger-auto-layout` (line 221)
3. **NodeCanvas** listens for event (line 8108 in `NodeCanvas.jsx`)
4. **Applies auto-layout** with 200ms delay (line 8102-8104)
5. **Centers view** on completion (line 8122)

If auto-layout isn't running, it's likely because:
- The event isn't being dispatched (check browser console)
- The `hasLayoutOps` condition isn't being met
- The graph ID doesn't match

---

## Summary of Changes

### `bridge-daemon.js`
1. **Line 924**: Reduced `MAX_ITERATIONS` from 5 to 2
2. **Lines 927-942**: Added smart stopping conditions based on node count
3. **Line 1145**: Updated prompt text to "REFINEMENT PASS" instead of "ITERATION"

### Benefits
- **3x faster**: 2 iterations instead of 5
- **Smarter**: Stops early when graph is complete
- **Better UX**: Auto-layout already works, just needed fewer iterations to see it

---

## Testing

1. **Test reduced iterations**:
   - Ask: "create a graph about solar system"
   - Verify: Should complete in 2 iterations max (initial + refinement)
   - Check: Auto-layout runs after each iteration

2. **Test smart stopping**:
   - Ask: "create a comprehensive graph about Greek mythology"
   - Verify: Stops at 15 nodes even if only on iteration 1

3. **Test auto-layout**:
   - Create any graph with the Wizard
   - Verify: Nodes are automatically laid out after creation
   - Verify: View centers on the new nodes

---

## Future Improvements

### More Guardrails (Per User Request)
Instead of relying on AI interpretation, add more programmatic guardrails:

1. **Node count limits in prompt**:
   ```javascript
   const TARGET_NODE_COUNT = 8; // Ideal graph size
   const MAX_NODE_COUNT = 15;   // Hard limit
   ```

2. **Explicit stopping signals**:
   - If AI returns empty `graphSpec`, stop immediately
   - If AI returns `decision: "complete"`, stop
   - If node count hasn't changed in 2 iterations, stop

3. **Time-based limits**:
   - Max 30 seconds per iteration
   - Total timeout of 60 seconds

4. **Quality checks**:
   - Verify all nodes have connections
   - Check for duplicate nodes
   - Validate color palette usage

Would you like me to implement any of these additional guardrails?
