# Wizard + Auto-Layout Integration Test

## What Changed

The Wizard now uses **deterministic auto-layout** instead of trying to do spatial reasoning. The LLM focuses on semantics (what nodes/edges to create), and your existing `graphLayoutService.js` handles all spatial positioning.

## Architecture

```
User: "Add cookie recipe components"
   ↓
LLM: { graphSpec: { nodes: [...], edges: [...], layoutAlgorithm: "hierarchical" } }
   ↓
Queue Goal → Planner → Executor
   ↓
Executor calls applyLayout(nodes, edges, "hierarchical")
   ↓
Positioned ops → Auditor → Committer → UI
   ↓
Graph appears with proper spatial layout!
```

## Setup

1. **Start UI**:
   ```bash
   npm run dev
   ```

2. **Start Bridge** (separate terminal):
   ```bash
   npm run bridge
   ```

3. **Verify Health**:
   ```bash
   curl http://localhost:3001/health
   # Should return: {"status":"ok","source":"bridge-daemon",...}
   ```

4. **Store API Key**:
   - Open UI at http://localhost:4000
   - Click 🔑 icon in AI panel
   - Paste your Anthropic or OpenRouter key
   - Click "Store API Key"

## Test Cases

### Test 1: Single Node (Baseline)
**Input**: "Add Solar Energy"

**Expected**:
- LLM generates: `{ graphSpec: { nodes: [{ name: "Solar Energy" }], layoutAlgorithm: "force" } }`
- Executor uses force-directed layout (default for single node)
- Node appears in the active graph

**Verify**: Check browser console for `[Agent] Queued create_subgraph goal` with layoutAlgorithm.

---

### Test 2: Simple Graph with Edges
**Input**: "Add a recipe with Flour, Sugar, and Eggs"

**Expected**:
- LLM generates graphSpec with 4 nodes (Recipe + 3 ingredients) and 3 edges
- Executor chooses `"hierarchical"` or `"radial"` layout (Recipe at center/top, ingredients around it)
- Nodes appear with proper spacing and connections

**Verify**: 
- Check `/telemetry?limit=50` for the `agent_queued` entry showing node/edge counts
- Nodes should NOT overlap
- Edges should be visible

---

### Test 3: Complex Graph
**Input**: "Fill out the components of a web application"

**Expected**:
- LLM generates 8-12 nodes (Frontend, Backend, Database, API, Auth, etc.)
- LLM chooses appropriate layout (probably `"force"` for general graph)
- Auto-layout positions nodes with collision avoidance
- Network structure is clear and readable

**Verify**:
- No nodes stacked on top of each other
- Related components are near each other (force-directed clustering)
- Canvas feels balanced, not all nodes in one corner

---

### Test 4: Layout Algorithm Selection
Try different phrases to see if LLM picks appropriate layouts:

- **Hierarchical**: "Create a company org chart with CEO, managers, and employees"
  - Should use `"hierarchical"` layout (top-down tree)

- **Radial**: "Add planets orbiting the Sun"
  - Should use `"radial"` layout (Sun at center, planets in orbit)

- **Grid**: "Create a periodic table with elements"
  - Might use `"grid"` layout (uniform spacing)

**Verify**: Check telemetry for the chosen `layoutAlgorithm` in each case.

---

## Debugging

### Check Queue Flow
```bash
# See what's in the goal queue
curl http://localhost:3001/queue/peek?name=goalQueue&head=5

# See what's in the task queue
curl http://localhost:3001/queue/peek?name=taskQueue&head=5

# Check if patches are being generated
curl http://localhost:3001/queue/metrics?name=patchQueue
```

### Check Telemetry
```bash
# See recent agent activity
curl 'http://localhost:3001/telemetry?limit=20' | jq '.items[] | select(.type == "agent_queued" or .type == "agent_plan")'

# Filter by correlation ID (cid from agent response)
curl 'http://localhost:3001/telemetry?cid=cid-1731626400000-abc123' | jq
```

### Common Issues

**1. "Something went wrong planning the graph"**
- Check browser console for LLM API errors
- Verify API key is stored (🔑 icon should show "Manage API Key" not "Setup API Key")
- Check if LLM returned invalid JSON (telemetry will show parse errors)

**2. Nodes appear but all at same position**
- Auto-layout failed - check console for `[Executor] Task execution failed`
- Verify `graphLayoutService.js` is being imported correctly
- Check if `applyLayout` returned empty positions array

**3. Nothing happens after sending message**
- Bridge might be down - check if `npm run bridge` is still running
- Verify BridgeClient is mounted - check browser console for "MCP Bridge: Connection" messages
- Check if scheduler is running: `curl http://localhost:3001/orchestration/scheduler/status`

**4. Scheduler not processing tasks**
- Manually start it via bridge startup (should auto-start on first goal enqueue)
- Check: `curl http://localhost:3001/orchestration/scheduler/status`
- If not enabled, something in `ensureSchedulerStarted()` failed

## Success Criteria

✅ LLM generates graphSpec **without** x/y coordinates
✅ Executor logs show `[Executor]` creating positioned ops
✅ Nodes appear in UI with proper spacing (no overlaps)
✅ Different layout algorithms produce visually distinct results
✅ Complex graphs (10+ nodes) are readable and well-structured

## What To Look For

**In Browser Console**:
- `[Agent] Queued create_subgraph goal: { cid, graphId, nodeCount, edgeCount, layoutAlgorithm }`
- No `[Executor] Task execution failed` errors
- BridgeClient logs showing pending actions being executed

**In Telemetry** (`/telemetry?limit=50`):
- `agent_queued` entries with correct node/edge counts
- `tool_call` entries for `applyMutations` with positioned ops
- No entries with `error` field

**In UI**:
- Nodes appear in active graph after 1-2 seconds
- Edges connect the right nodes
- Layout looks intentional (not random scatter)
- Refresh button in AI panel stays green (connected)

## Performance Expectations

- **Simple graphs** (1-3 nodes): < 2 seconds end-to-end
- **Medium graphs** (5-10 nodes): 2-4 seconds
- **Complex graphs** (10-20 nodes): 4-6 seconds

Most time is spent in:
1. LLM API call (~1-2s for Claude/GPT-4)
2. Auto-layout calculation (~0.1-0.5s depending on algorithm)
3. UI applying mutations (~0.5-1s for rendering)

---

## Next Steps After Testing

Once basic flow works:
1. **Enhance layout heuristics**: Teach LLM when to use each layout type
2. **Add layout options to UI**: Let users override the chosen algorithm
3. **Implement prototype reuse**: Check for existing prototypes before creating new ones
4. **Add undo/redo**: For when Wizard creates unwanted nodes
5. **Multi-graph support**: Let Wizard create new graphs and populate them

The hard part (auto-layout integration) is now done. The rest is UX polish! 🎉

