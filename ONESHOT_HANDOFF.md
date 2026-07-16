# Handoff: One-Off Model Calls (SLM Wizard MVP — Phase 1)

You are working in **Redstring**, a React/Zustand graph-of-graphs knowledge tool (see CLAUDE.md and AI_COMPENDIUM.md for architecture). This task is the first implementation step of a larger direction: replacing brittle heuristics with **one-off small-language-model calls** — single, tiny, constrained questions (pick from a list, yes/no, one short label), no agent loop, designed to work well with small local models (Ollama / LM Studio on Apple silicon) as well as cloud models.

## The core idea

The codebase makes judgment-like decisions all over the place using substring matching, Levenshtein distance, keyword lists, and magic thresholds. Each of these is really a tiny multiple-choice question a small model answers reliably. We are NOT building agents here — each call is stateless: small input → constrained output → validated by code → done.

An audit found the full set of opportunities. This handoff covers the shared utility plus the first three integrations.

## Step 0 — Build the shared `oneShot` utility (do this first)

Create `src/services/oneShot.js`. Requirements:

1. **Reuse existing plumbing**: `src/services/apiKeyManager.js` already supports Anthropic, OpenAI, OpenRouter, and local Ollama/LM Studio endpoints (~lines 337-416). Do not build new provider code.
2. **Constrained-output API**, something like:
   - `oneShotChoice({ instruction, input, options })` → returns one of `options` (by index) or `null`
   - `oneShotBoolean({ instruction, input })` → `true | false | null`
   - `oneShotLabel({ instruction, input, maxWords })` → short string or `null`
3. **Strict parsing**: the model's raw text is parsed against the expected shape; anything malformed returns `null`. Never throw into caller code.
4. **Graceful degradation is mandatory**: if no model is configured, the call times out (default ~3s for interactive paths), or parsing fails → return `null`, and every caller falls back to its current heuristic behavior. The app must work identically with zero models configured.
5. **Log every call** — this is critical, not optional. Every one-shot call appends a record: `{ timestamp, callSite, instruction, input, rawResponse, parsedResult, latencyMs }`. Callers can later attach an outcome (`accepted` / `rejected` / `edited` by the user). Store as JSONL (localStorage ring buffer or file via existing persistence — keep it simple). This log is the training-data pipeline for future fine-tuning; it must exist from day one.
6. **Small-model-friendly prompts**: instructions of a few sentences max, options presented as a numbered list, ask for the number only. No JSON output from the model unless unavoidable — prefer "answer with the number" / "answer yes or no".

⚠️ **MCP stdio rule**: files under `src/wizard/tools/` are imported by `redstring-mcp-server.js`. If `oneShot.js` is ever imported from there, it must NEVER use `console.log` (corrupts stdio transport) — use `console.error` for all logging.

## Step 1 — Wire in the dormant AI duplicate detector

`src/services/aiDuplicateDetector.js` is a **complete, working LLM dedup implementation that is dead code** — imported nowhere.

- Wire it into `src/components/DuplicateManager.jsx` (currently uses `findPotentialDuplicates` from `graphStore.js` ~line 1860, pure Levenshtein at 0.8 threshold) so candidate pairs get a semantic yes/no verdict.
- Optionally also into `addNodePrototypeWithDeduplication` (`graphStore.js` ~1798) for dedup-at-creation.
- **Fix its prefilter**: `aiDuplicateDetector.js` ~lines 28-40 pre-filters candidates with a bigram similarity > 0.3 cutoff *before* the LLM sees them — which filters out exactly the synonym cases ("NYC" / "New York City") the LLM exists to catch. Loosen or make recall-oriented.
- Keep the Levenshtein path as the fallback when no model is available.

## Step 2 — Shared name→node resolution call (biggest correctness win)

The same broken pattern (exact match → substring match → arbitrary first/last pick) is hand-rolled in at least six places, and it **silently corrupts graphs**:

- `src/wizard/tools/createEdge.js` ~lines 10-67 (keeps LAST substring match)
- `src/wizard/tools/updateNode.js` ~lines 10-42 (keeps FIRST)
- `src/wizard/tools/deleteNode.js` ~lines 10-39 (destructive op on a fuzzy guess!)
- `src/wizard/tools/setNodeType.js` ~lines 14-45
- `src/wizard/tools/selectNode.js` ~lines 57-132 (ad-hoc point scoring)
- `src/wizard/tools/edgeValidator.js` ~lines 15-62 (**silently DROPS edges** whose endpoints aren't exact name matches — silent data loss)

Build ONE shared resolver, e.g. `src/wizard/tools/utils/resolveNodeSmart.js`:

1. **Exact case-insensitive match short-circuits deterministically** — no model call. (Per project convention: when multiple prototypes share a name, take the LAST match — Maps iterate oldest-first and old prototypes accumulate.)
2. **Ambiguous or fuzzy cases** → `oneShotChoice`: input = the mentioned name + numbered candidate list (name + short description), output = one index or "none".
3. **`null`/no-model fallback** → current substring behavior, unchanged.
4. **Special rule for destructive ops** (`deleteNode`): never act on a fuzzy/model-resolved match silently — if resolution wasn't exact, the tool result should say what it resolved to so the agent/user can confirm.
5. Replace the edgeValidator drop with: unmatched endpoint → one resolution call → only drop if truly unresolvable, and report dropped edges in the tool result instead of silently discarding.

Remember: `console.error` only in these files (MCP stdio rule).

## Step 3 — Edge-label suggestion (biggest daily-feel win)

When the user draws a connection, they get a blank field (`src/NodeCanvas.jsx` — `connectionNamePrompt` state ~line 3184, rendered ~8213-8330; the current live path is the UnifiedSelector `mode="connection-creation"` ~line 15075).

- On prompt open, fire `oneShotChoice`/`oneShotLabel` in the background: input = source node name + target node name (+ descriptions if short), plus the existing connection-prototype names as options. Output = one existing connection type OR a new short verb phrase ("directed by", "is a kind of").
- **Pre-fill as a suggestion the user can overwrite** — never auto-commit. If the call hasn't returned by the time the user types, discard it (user input always wins).
- Log accepted/edited/ignored as the outcome on the call record.

## Constraints & non-goals

- **No agent loops, no fine-tuning, no embeddings, no vector stores.** One-off calls only.
- **Don't refactor AgentLoop.js** or the existing wizard conversation flow.
- Plain JavaScript (no TypeScript syntax). Match surrounding code style.
- Zustand: all state changes through store actions; store uses Maps (mind serialization).
- Every integration must be a strict improvement with a heuristic fallback — the app with no model configured behaves exactly as today.
- Line numbers above are approximate — verify before editing.
- Test with a local model via LM Studio/Ollama (OpenAI-compatible endpoint, already supported by apiKeyManager) — that's the target deployment, not cloud.

## Acceptance checks

1. With no model configured: all touched flows behave identically to before (fallbacks work).
2. With a local model: "NYC" vs "New York City" flagged as duplicates; "membrane" resolving against {Outer Membrane, Membrane Potential} asks the model and picks correctly or returns none; drawing an edge between "Kubrick" and "2001: A Space Odyssey" pre-fills something like "directed".
3. edgeValidator no longer silently drops near-miss edges; dropped edges are reported.
4. The JSONL call log exists and records every call with latency and outcome.
5. Existing tests pass; add tests for `oneShot` parsing/fallback and `resolveNodeSmart` (exact-match short-circuit, last-match rule, null fallback).

## Future context (don't build now, don't preclude)

This utility is the beachhead for a larger plan: a perception-shaped small-model framework ("druid") where the model reads a rendered view of the active graph and emits tiny validated gestures, with scratch-space containment and human promotion. Design `oneShot`'s logging and constrained-output shapes so they'd serve that future without rework — but build only what's specified above.
