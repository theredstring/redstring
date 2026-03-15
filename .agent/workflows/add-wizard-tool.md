---
description: How to add a new wizard tool to the AI agent system
---

# Adding a New Wizard Tool

When adding a new wizard tool, you MUST update **5 files** in the tool pipeline. Missing any one of these will cause the tool to silently fail or not persist changes.

> **Note:** The MCP bridge now automatically proxies any wizard tool through `applyToolResultToStore` via the compatibility layer — you no longer need to add handlers to `BridgeClient.jsx`.

## Checklist

### 1. Create the tool function
- **File**: `src/wizard/tools/<toolName>.js`
- Export an async function that takes `(args, graphState, cid, ensureSchedulerStarted)` and returns an action spec object
- The action spec must include `action: '<actionName>'` — this is how the UI routes it
- Use `graphState.nodePrototypes`, `graphState.edges`, etc. to resolve names to IDs
- Read-only tools (no mutations) should still return a result object but can omit `action`
- **Important**: Never use `console.log()` — use `console.error()` for logging (MCP stdio transport rule)

### 2. Add the tool schema
- **File**: `src/wizard/tools/schemas.js`
- Add an entry to the array returned by `getToolDefinitions()`
- Define `name`, `description`, `parameters` (with `properties` and `required`)
- If the tool is too complex for small local LLMs, add it to the `ADVANCED_TOOLS` set

### 3. Register in the tool index
- **File**: `src/wizard/tools/index.js`
- Import the tool function at the top
- Add it to the `TOOLS` object

### 4. Add store mutation handler in `applyToolResultToStore`
- **File**: `src/components/panel/views/LeftAIView.jsx`
- **Function**: `applyToolResultToStore` (~line 312)
- Add an `if (result.action === '<actionName>')` block
- This is where the **actual Zustand store mutation** happens on the client side
- ⚠️ **THIS IS THE STEP THAT IS MOST COMMONLY MISSED** — without it, the tool will appear to work in the chat UI but changes won't persist
- For async operations (e.g., fetching external data), kick off the async work here but don't block the return

### 5. Add predictive state handler in AgentLoop
- **File**: `src/wizard/AgentLoop.js`
- **Function**: `updateGraphState` (~line 29)
- Add an `else if (result.action === '<actionName>')` block
- This updates the in-memory `graphState` so subsequent tools in the same agent loop see the changes
- Without this, the agent can't chain tools that depend on each other's results
- For read-only or async tools, this can be a no-op (just add a comment explaining why)

### 6. (Optional) Add usage examples
- **File**: `src/services/agent/PromptFragments.js`
- The `REDSTRING_TOOLS` section is auto-generated from `getToolDefinitions()`, so tool descriptions appear automatically
- Add usage examples to the `EXAMPLE_FLOWS` section only if the tool requires specific patterns to be understood

## ~~Optional: BridgeClient action handler~~ *(no longer needed)*
- The MCP bridge now automatically proxies all wizard tool actions through `window.__rs_applyToolResultToStore`.
- **You do NOT need to add anything to `BridgeClient.jsx`** for new wizard tools.
- The bridge fallback handler in `checkForBridgeUpdates` catches any action not in `window.redstringStoreActions` and routes it through the same pipeline as the internal wizard.

## Testing
- Create `src/wizard/tools/<toolName>.test.js`
- Test the tool function directly with mock `graphState`
- Run: `npx vitest run src/wizard/tools/<toolName>.test.js`

## Architecture Overview

```
[Internal Wizard path]
User message → Agent Server → AgentLoop (calls tool fn)
                                  ↓
                             Tool returns { action: '...' }
                                  ↓
                        updateGraphState (predictive state)
                                  ↓
                        SSE stream → LeftAIView
                                  ↓
                        applyToolResultToStore (store mutation)

[MCP Bridge path]
Claude → MCP Server → enqueue pending action
                                  ↓
                    BridgeClient.checkForBridgeUpdates
                                  ↓
            window.redstringStoreActions[action]? ← bridge-only actions
                      else: window.__rs_applyToolResultToStore(action, ...)
                                  ↓
                        applyToolResultToStore (SAME function as above)
```

## Quick Reference: Key Patterns

- **Name resolution**: Use `resolveNodeByName(name, nodePrototypes, graphs, graphId)` — see `updateNode.js` for the pattern
- **Read-only tools**: Return data without `action` field; no handler needed in `applyToolResultToStore` or `updateGraphState`
- **Mutating tools**: Must have `action` field; needs handlers in both `applyToolResultToStore` AND `updateGraphState`
- **Async/client-only tools**: Return an `action` spec from the tool function; do the async work in the `applyToolResultToStore` handler (which runs in browser context with full API access)
