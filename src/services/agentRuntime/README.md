# AgentRuntime Module

Modular, AI-editable architecture for The Wizard agent runtime.

## Architecture

```
AgentCoordinator (orchestrator)
  ├── Planner (semantic planning)
  ├── Executor (geometric execution)
  └── StateMirror (state synchronization)
```

### Modules

- **`AgentCoordinator.js`**: Main orchestrator. Handles plan → execute flow.
- **`Planner.js`**: Model-agnostic planning. Produces typed plan JSON with retry + fallback.
- **`Executor.js`**: Executes plans via queue + roleRunners. Maps intents to tasks.
- **`StateMirror.js`**: State merge + local-apply logic. Keeps "brain-body" aligned.

## Extension Points

### Adding a New Intent

1. **Planner**: Add intent to `AGENT_PLANNER_PROMPT` schema (in `bridge-daemon.js` or passed to `Planner.setPlannerPrompt()`).
2. **Executor**: Add intent handler in `Executor.execute()` that maps plan → queue tasks.
3. **AgentCoordinator**: No changes needed - it automatically routes all intents.

### Model-Agnostic Planning

The Planner works with any model via:
- Strict JSON schema enforcement
- Retry logic with fallback models
- Deterministic fallback parsing (handles markdown, preamble, etc.)

### State Synchronization

StateMirror ensures:
- Test-created graphs/prototypes persist across UI syncs
- Local mutations are immediately reflected in bridge state
- Smart merge prevents overwriting test data

## Usage

```javascript
import { AgentCoordinator } from './AgentCoordinator.js';
import { setPlannerPrompt } from './Planner.js';

// Set planner prompt (from bridge-daemon.js)
setPlannerPrompt(AGENT_PLANNER_PROMPT);

const coordinator = new AgentCoordinator({
  logger,
  executionTracer,
  ensureSchedulerStarted,
  bridgeStoreData
});

const result = await coordinator.handle({
  message: 'Create a graph about solar systems',
  context: { activeGraphId, graphs, nodePrototypes },
  apiKey: '...',
  cid: 'conv-123'
});
```


