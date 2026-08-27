# One-Shot Model Calls

A pattern used throughout the wizard and several UI paths: replace a brittle heuristic
(substring match, Levenshtein distance, keyword list, magic threshold) with a **single,
tiny, constrained model call**. Pick from a list, yes/no, one short label, one short list.

There is **no agent loop and no conversation state** — small input → constrained output →
validated by code → done. This is deliberately not the wizard's `AgentLoop`; the two are
separate systems and should stay that way.

**Implementation**: `src/services/oneShot.js` (the module header is the authoritative API
contract — read it before changing anything here).

---

## The design contract

Every caller depends on all four of these:

1. **Null on any failure.** No model configured, timeout (default 3s on interactive paths),
   or unparseable response → the helper returns `null`.
2. **Callers must fall back to their existing heuristic.** The app must behave *identically*
   with zero models configured. A one-shot call is always an improvement path, never a
   dependency.
3. **Nothing ever throws into caller code.**
4. **Every call is logged.** `logOneShotCall` writes a JSONL ring buffer (500 entries,
   `redstring_oneshot_log` in localStorage). Callers attach a user verdict with
   `attachOneShotOutcome(callId, 'accepted' | 'rejected' | 'edited' | 'ignored')`. This log
   is the training corpus for a future fine-tuned small model — it is load-bearing, not
   debug output.

`newBuildId()` mints an id that correlates every call made during one build or review pass,
so shape classification → unfold decisions → review verdicts → outcomes can be joined in the
log afterward.

### MCP stdio rule

`oneShot.js` is reachable from `redstring-mcp-server.js` via `resolveNodeSmart`. It must
**never** use `console.log` — stdout is the MCP transport. In that Node context there is no
`localStorage` and no configured key, so every helper degrades to the heuristic path
automatically.

---

## Primitives

| Helper | Returns |
|---|---|
| `oneShotChoice({ instruction, input, options, allowNone })` | one of `options`, or `null` |
| `oneShotBoolean({ instruction, input })` | `true` / `false` / `null` |
| `oneShotLabel({ instruction, input, maxWords })` | short string or `null` |
| `oneShotList({ instruction, input, maxItems, maxWordsPerItem })` | string[] or `null` |
| `rawModelCall(prompt, opts)` | escape hatch for a raw completion (used by the AI duplicate detector) |

Prompts are written small-model-first: a few sentences of instruction, options as a numbered
list, "answer with the number only". Avoid asking the model for JSON unless unavoidable.

Model resolution reuses `apiKeyManager` — no separate provider code. By default only `local`
providers are used; `configureOneShot({ allowCloudProviders: true })` opens it up.

---

## Where it is wired

**Shared utilities** (`src/wizard/tools/utils/`)

| Module | Does |
|---|---|
| `resolveNodeSmart.js` | name → node resolution for all wizard tools; on true failure, proposes creating the missing node |
| `classifyGraphShape.js` | classifies a requested build into one of the nine shapes; `shouldUnfoldMembers` decides recursion |
| `graphShapes.js` | the nine-shape library (`set`, `ladder`, …) with build notes |
| `ladderChain.js` | orders an abstraction chain for `ladder`-shaped builds |
| `unfoldController.js` | drives recursive unfolding of member nodes |
| `structureReview.js` | post-build review: coherence check, cluster detection, group naming |
| `suggestionCalls.js` | relation kind, arrow direction, naming conformance, group/abstraction names |

**Call sites**: `createNode`, `createEdge`, `updateNode`, `deleteNode`, `setNodeType`,
`selectNode`, `edgeValidator`, `createGroup`, `createPopulatedGraph`, `expandGraph`
(all `src/wizard/tools/`), plus `src/components/DuplicateManager.jsx` (dedup) and
`src/NodeCanvas.jsx` (edge-label and abstraction-name prefill).

---

## Rules for adding a new one-shot call

- **Nothing is auto-applied.** Model output is a suggestion or a pre-fill the user can
  override. Deterministic short-circuits (QID/URI matches, exact-name hits) run *first* and
  win.
- **Plain descriptive identifiers** — `classifyGraphShape`, `reviewGraphStructure`,
  `suggestPromotionMatch`. No persona names ("druid", "gardener", "wizard brain") in code
  or UI.
- Pass a `callSite` string and, where applicable, a `buildId`.
- Keep the heuristic you are replacing — it is the fallback, not dead code.

Remaining unbuilt candidates are catalogued in `SMALL_MODEL_ROADMAP.md`.
