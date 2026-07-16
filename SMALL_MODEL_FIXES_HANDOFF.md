# Handoff: Small-Model Conversation-Loop Fixes

Context: Redstring's wizard (conversation-path agent in `src/wizard/`) is being tested against small local models (Qwen3 4B via LM Studio, OpenAI-compatible endpoint). Live testing produced two diagnosed failure classes:

1. **Text-register tool calls** — the model writes `createGraph({"name": ...})` as plain prose instead of native `tool_calls`, so nothing executes and the pseudo-calls land in chat.
2. **Plan churn loop** — the model calls `planTask` repeatedly (rewriting/shrinking the plan each time, marking steps done that never ran), narrates instead of acting, and the plan-incomplete nudge ("You MUST call a tool right now") is satisfied by calling planTask again — an infinite loop the existing loop detection can't see because it only matches EXACT repeated arguments and the plan text mutates every call.

Contributing causes confirmed in code/logs:
- `normalizeTools` in `src/wizard/LLMClient.js` calls `makeAllRequired()` (line ~218; the function at ~130 does `schema.required = Object.keys(schema.properties)`) for EVERY provider — so honest schemas from `src/wizard/tools/schemas.js` (e.g. createGraph `required: ['name']`) arrive on the wire with all 7 params required, several of which are JSON-arrays-escaped-inside-strings. Under that pressure a 4B falls out of the tool-call format into prose.
- Default `temperature: 0.7` (`LLMClient.js` ~line 17) is sent explicitly in every request, which **overrides** anything set in LM Studio's UI. Small models need ~0.1 for format adherence.
- `planTask` is Tier 1 in `TOOL_TIERS` (`src/wizard/tools/schemas.js` ~line 937) — always offered to every model tier.
- Loop detection (`AgentLoop.js` ~lines 942–958) stops only when the exact same tool+arguments repeat 3×.

This handoff DOES touch `AgentLoop.js` — that's intentional and scoped to the specific additions below. Do not otherwise restructure the conversation flow. Run with no other agent co-editing AgentLoop/LLMClient. Commit after each task.

Model tier context: `apiKeyManager._computeModelTier()` returns `'small'` for provider `local` or localhost endpoints; `AgentLoop` already has `modelTier`. Thread it where needed rather than recomputing.

---

## Task 1 — Honest schemas for local/small models

In `src/wizard/LLMClient.js`:
- `normalizeTools(tools)` currently applies `makeAllRequired(params)` unconditionally. Add a parameter (e.g. `normalizeTools(tools, { strictRequired })`) and skip `makeAllRequired` when the provider is `local` (or endpoint is localhost). KEEP it for the providers that need it (it exists for OpenAI-strict/Gemini quirks — verify which before changing their path; big-model behavior must not regress).
- Result: the honest `required` arrays from `schemas.js` reach the wire for local models (createGraph requires only `name`, etc.).

## Task 2 — Small-tier temperature

In `src/wizard/LLMClient.js`: default temperature stays 0.7 for cloud, but for local/small (provider `local` or localhost endpoint) default to **0.1** unless the user config explicitly sets one. Note in a comment: the request parameter overrides LM Studio's UI setting, so this is the only place it can be fixed.

## Task 3 — Remove planTask from the small tier

- `selectToolsForTurn` (`src/wizard/tools/schemas.js` ~1003) currently filters by tier/flags/keywords. Add a `modelTier` parameter; when `modelTier === 'small'`, exclude `planTask` from the returned tools. Find and update its call site(s) in AgentLoop to pass the tier.
- Also ensure the small-tier system prompt / nudge text doesn't reference planTask when it isn't offered (check `SMALL_MODEL_SYSTEM_PROMPT` and the plan-related nudges around AgentLoop ~1027–1046 — the nudge must not instruct the model to call a tool it doesn't have).
- Rationale: plans are model-maintained state; small models cannot maintain state (observed: plan replaced and shrunk on each resend, thinking-steps marked done without any tool running). Code-side planning (shape call → fill → unfold → review) already covers builds.

## Task 4 — Plan-churn detection and cap (all tiers)

Around the existing loop-detection block (`AgentLoop.js` ~942–958):
1. **Churn rule:** track iterations where `planTask` was called but NO mutating tool ran in the same iteration (mutating = createNode/createEdge/createGraph/expandGraph/populateDefinitionGraph/updateNode/deleteNode/createGroup etc. — derive from the tool registry rather than hardcoding if practical). After **2 consecutive** such iterations: strip planTask from the available tools for the remaining iterations and inject a user-role message: "Plan updates are locked. Execute the next incomplete step by calling an action tool."
2. **Hard cap:** max 3 planTask calls per user turn regardless of pattern; further calls return (as the tool result) "Plan locked — execute the next incomplete step" without modifying the stored plan.
3. Keep the existing exact-repeat detection unchanged.

## Task 5 — Text tool-call salvage parser

New util `src/wizard/utils/parseTextToolCalls.js` (⚠️ `console.error` only — wizard files are imported by `redstring-mcp-server.js`; `console.log` corrupts MCP stdio):

1. **Scanner:** find `identifier(` followed by `{`; balanced-brace walk (count `{`/`}`, respecting strings) to locate the end of the argument object. Handles multiple calls in one response, nested JSON, and surrounding prose.
2. **Whitelist:** extracted name must exactly match a tool in the CURRENT turn's available tool list; otherwise ignore (prose that mentions tool names can never trigger anything not offered).
3. **Forgiving parse:** `JSON.parse` the brace block; on failure try one repair round (single→double quotes, strip trailing commas); still failing → discard that candidate.
4. **Integration (AgentLoop response handling):** when a response contains NO native tool_calls and the parser finds ≥1 valid candidate, synthesize the same `{name, arguments}` objects the API would have returned and feed them through the EXISTING dispatch path, in written order, feeding each result back before the next. The parsed text should not also be rendered as a chat message (strip the matched spans; render remaining prose, if any).
5. Apply for all tiers (harmless for big models — they rarely produce the pattern without native calls), or gate to small tier if any big-model test regresses.
6. Fallback: nothing parses → exactly today's behavior (text to chat, existing nudges).
7. **Tests:** use this real transcript as the first fixture — it must parse into 2 calls:

```
createGraph({"name": "GTA San Andreas Locations", "color": "sunset"})

planTask({
  "steps": [
    {"description": "Identify major locations...", "status": "pending", "substeps": [{"description": "Sketch initial location structure...", "status": "pending"}]}
  ]
})
```

Plus fixtures for: no calls (plain prose), unknown tool name (ignored), malformed JSON (discarded), single-quoted args (repaired), call embedded mid-sentence.

## Task 6 — Errors carry examples

Find where "At least one node or edge is required" is thrown (expandGraph/createPopulatedGraph validation) and every similar validation error in the build tools: append a MINIMAL valid example payload to the error message (small models recover from errors via examples, not instructions). Keep examples one line, e.g.: `Example: expandGraph({"nodes": "[{\"name\": \"Los Santos\"}]"})` — matching the actual expected arg format.

---

## Verification

1. **Isolation curl** (run first — determines whether native tool calling works at all once pressure is removed):
```bash
curl http://localhost:1234/v1/chat/completions -H "Content-Type: application/json" -d '{
  "model": "qwen/qwen3-4b-2507",
  "messages": [{"role": "user", "content": "Create a graph called Test Graph"}],
  "tools": [{"type": "function", "function": {"name": "createGraph", "description": "Create a new graph workspace", "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}}}],
  "temperature": 0.1
}'
```
If `tool_calls` comes back: template is fine; Tasks 1–2 relieve most slippage and Task 5 catches the rest. If prose: the model/template can't native-call — Task 5 is the primary path; note this in the commit message.
2. **LM Studio request log** shows: temperature 0.1, honest `required` arrays (createGraph → `["name"]`), no planTask in the tools array for the small tier.
3. **Repro test:** "i want to map out all the locations in GTA San Andreas" against Qwen3 4B → a graph actually gets created (native or salvaged), no plan-churn loop, and the turn terminates on its own.
4. **Big-model regression:** run the same flows against a cloud provider — tool schemas for that provider unchanged (makeAllRequired still applied where it was needed), planTask still available, behavior unchanged.
5. All existing tests pass; new tests for the parser (fixtures above), churn rule (2 consecutive planTask-only iterations → locked), cap, and normalizeTools per-provider behavior.
6. User config hygiene note (not code): the active LM Studio profile should use the real model id (`qwen/qwen3-4b-2507`), not `llama2` — LM Studio currently ignores the field and serves the loaded model, which masks misconfiguration.

## Constraints

- `console.error` only in anything imported by `redstring-mcp-server.js`. Never pretty-print JSON in MCP responses.
- Plain JavaScript; match surrounding style; Zustand actions only for state.
- AgentLoop changes limited to: the tool-selection call site (Task 3), the churn/cap logic adjacent to existing loop detection (Task 4), and the salvage-parser hook in response handling (Task 5). No other restructuring.
- Every change must leave cloud/big-model behavior untouched (verification #4 is mandatory, not optional).
