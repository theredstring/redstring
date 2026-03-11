---
description: How to add a new wizard tool to the AI agent system
---

# Adding a New Wizard Tool

When adding a new wizard tool, you MUST update **4 layers** of the tool pipeline. Missing any one of these will cause the tool to silently fail or not persist changes.

> **Note:** The MCP bridge now automatically proxies any wizard tool through `applyToolResultToStore` via the compatibility layer — you no longer need to add handlers to `BridgeClient.jsx`.

## Checklist

### 1. Create the tool function
- **File**: `src/wizard/tools/<toolName>.js`
- Export an async function that takes `(args, graphState)` and returns an action spec object
- The action spec must include `action: '<actionName>'` — this is how the UI routes it
- Use `graphState.nodePrototypes`, `graphState.edges`, etc. to resolve names to IDs

### 2. Register in the tool index
- **File**: `src/wizard/tools/index.js`
- Import the tool function
- Add it to the `TOOLS` map: `TOOLS.set('<toolName>', toolFn)`
- Add the tool schema (name, description, parameters) to the exported tools array

### 3. Add store mutation handler in `applyToolResultToStore`
// turbo
- **File**: `src/components/panel/views/LeftAIView.jsx`
- **Function**: `applyToolResultToStore` (top of file, ~line 302)
- Add an `if (result.action === '<actionName>')` block
- This is where the **actual graph store mutation** happens on the client side
- ⚠️ **THIS IS THE STEP THAT IS MOST COMMONLY MISSED** — without it, the tool will appear to work in the chat UI but changes won't persist

### 4. Add predictive state handler in AgentLoop
- **File**: `src/wizard/AgentLoop.js`
- **Function**: `updateGraphState` (~line 280)
- Add an `else if (result.action === '<actionName>')` block
- This updates the in-memory `graphState` so subsequent tools in the same agent loop see the changes
- Without this, the agent can't chain tools that depend on each other's results

### 5. Add usage examples
- **File**: `src/services/agent/PromptFragments.js`
- The `REDSTRING_TOOLS` section is auto-generated from `getToolDefinitions()`, so you don't need to add the description manually!
- Add usage examples to `EXAMPLE_FLOWS` section if the tool requires specific patterns to be understood

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
