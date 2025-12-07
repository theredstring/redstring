# The Wizard Testing Guide

This guide covers how to test and debug The Wizard, Redstring's AI agent.

## Quick Start

### 1. Start the Bridge Daemon

The bridge daemon handles AI requests and state synchronization:

```bash
npm run bridge
```

This starts the daemon on port 3001. Keep this terminal open.

### 2. Start the UI (Optional)

For full end-to-end testing with goal execution:

```bash
npm run dev
```

This starts the UI on port 4000. The UI's Committer processes queued goals.

### 3. Run the Test Harness

**Dry-run mode** (tests bridge connectivity, no API key needed):
```bash
npm run test:wizard:dry
```

**Full mode** (tests AI intent detection, requires API key):
```bash
API_KEY=your-openrouter-key npm run test:wizard
```

**Auto-discover mode** (tests all wizard tools automatically):
```bash
API_KEY=your-openrouter-key npm run test:wizard:auto
```

## What Gets Tested

| Test | Description | Requires API Key |
|------|-------------|------------------|
| Bridge State Sync | UI can sync state to bridge | No |
| Create Edge | AI detects "connect X to Y" intent | Yes |
| Update Edge | AI detects "change connection" intent | Yes |
| Delete Edge | AI detects "remove connection" intent | Yes |
| Delete Graph | AI uses context instead of asking for ID | Yes |
| Pending Actions API | Bridge returns pending actions | No |
| Telemetry API | Bridge returns telemetry data | No |
| **Auto-Discover Tools** | **Discovers and tests all wizard tools** | **Yes (with --auto-discover)** |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        User Request                          │
│                    "connect Earth to Sun"                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Bridge Daemon (:3001)                     │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐       │
│  │   Planner   │ → │   Queue     │ → │  Executor   │       │
│  │  (LLM Call) │   │  Manager    │   │ (roleRunners)│       │
│  └─────────────┘   └─────────────┘   └─────────────┘       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      UI Committer (:4000)                    │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐       │
│  │   Patch     │ → │   Apply     │ → │   Store     │       │
│  │  Auditor    │   │  Mutations  │   │  (Zustand)  │       │
│  └─────────────┘   └─────────────┘   └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `bridge-daemon.js` | Main AI agent, intent detection, prompt engineering |
| `src/services/orchestrator/roleRunners.js` | Task executor (handles tool operations) |
| `src/services/Committer.js` | Applies patches to the store |
| `src/ai/BridgeClient.jsx` | Syncs UI state to bridge |
| `test/ai/wizard-e2e.js` | E2E test harness |

## Debugging Tips

### Check Bridge Health
```bash
curl http://localhost:3001/api/bridge/health
```

### Check Bridge State
```bash
curl http://localhost:3001/api/bridge/state
```

### Check Pending Actions
```bash
curl http://localhost:3001/api/bridge/pending-actions
```

### Check Telemetry
```bash
curl http://localhost:3001/api/bridge/telemetry
```

### Check Execution Traces
```bash
curl http://localhost:3001/api/bridge/debug/traces
```

## Common Issues

### "Bridge server not running"
Start the bridge with `npm run bridge`.

### "AI agent service unavailable" in deployed version
The app-semantic-server needs to proxy requests to the internal bridge daemon. Check that `/api/bridge/state` and `/api/bridge/actions` are being proxied.

### Goals queued but not executing
Goals execute in the UI's Committer. Make sure the UI is running (`npm run dev`).

### AI asks for graph ID instead of using context
The prompt should instruct the AI to use context. Check `AGENT_PLANNER_PROMPT` in `bridge-daemon.js`.

### Edge operations not working
1. Check that nodes exist in the graph
2. Check that the executor handles `create_edge`, `delete_edge` tools
3. Check that `definitionNode` is being processed correctly

## Adding New Intents

1. **Update the prompt** in `bridge-daemon.js`:
   - Add to intent enum in OUTPUT FORMAT
   - Add intent documentation with example

2. **Add intent handler** in `bridge-daemon.js`:
   - Add `if (resolvedIntent === 'your_intent')` block
   - Queue tasks via `queueManager.enqueue`

3. **Add executor handler** in `roleRunners.js`:
   - Add `else if (task.toolName === 'your_tool')` block
   - Push operations to `ops` array

4. **Add test** in `wizard-e2e.js`:
   - Add test case with example prompt
   - Validate expected behavior

## Auto-Discovery Testing

The wizard can now **test itself automatically**! The `--auto-discover` flag enables a self-testing mode that:

1. **Discovers all tools** - Queries `/api/bridge/tools` to get the complete list of wizard capabilities
2. **Generates test cases** - Creates appropriate test messages for each tool
3. **Executes tests** - Runs the wizard with test messages and validates responses
4. **Reports results** - Shows which tools work and which fail

### Benefits

✅ **Zero maintenance** - New tools are automatically tested
✅ **Full coverage** - Every intent gets exercised
✅ **Regression safety** - Know immediately if something breaks
✅ **Self-documenting** - Living examples of what the wizard can do

### Example Output

```bash
$ API_KEY=your-key npm run test:wizard:auto

Test 8: Auto-discover all wizard tools...
  Discovered 12 tools: qa, create_graph, create_node, analyze, update_node, delete_node, delete_graph, update_edge, delete_edge, create_edge, bulk_delete, enrich_node
  Testing qa: "What graphs do I have?"
    ✓ qa returns response
  Testing analyze: "Analyze the current graph structure"
    ✓ analyze returns response
  Testing create_node: "Add a Computer node to this graph"
    ✓ create_node returns response

📊 Test Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Passed: 11
  Failed: 0
✅ All tests passed!
```

## API Reference

### GET /api/bridge/tools
Returns all available wizard tools/intents for auto-discovery testing.

**Response:**
```json
{
  "tools": [
    {
      "name": "create_graph",
      "description": "Create a new knowledge graph with nodes and edges",
      "parameters": { "type": "object", ... }
    },
    ...
  ],
  "count": 12,
  "type": "intent-based",
  "note": "The wizard uses intent-based planning, not function calling..."
}
```

### POST /api/ai/agent
Main AI agent endpoint. Accepts user message and context.

```javascript
{
  "message": "connect Earth to Sun",
  "context": {
    "activeGraphId": "graph-123",
    "activeGraph": {
      "name": "Solar System",
      "nodeCount": 2,
      "edgeCount": 1
    },
    "conversationHistory": [],
    "apiConfig": {
      "provider": "openrouter",
      "model": "openai/gpt-4o-mini"
    }
  }
}
```

### POST /api/bridge/state
Sync UI state to bridge.

### GET /api/bridge/pending-actions
Get queued actions for UI to process.

### GET /api/bridge/telemetry
Get execution telemetry and chat history.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BRIDGE_PORT` | Bridge daemon port | 3001 |
| `API_KEY` | OpenRouter/Anthropic API key | - |
| `BRIDGE_URL` | Bridge URL for tests | http://localhost:3001 |



