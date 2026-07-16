# Handoff: One-Off Model Calls, Phase 3 — The Wiring Pass

This completes the work of `ONESHOT_HANDOFF.md` (phase 1) and `ONESHOT_HANDOFF_2.md` (phase 2). Read both for context. Phases 1–2 built and tested all the services; several are **built but orphaned** — zero call sites outside their tests. This phase wires them in. It should be run as ONE focused session with **no other agent concurrently editing** `AgentLoop.js` or `NodeCanvas.jsx` (a prior session deliberately stopped short because of concurrent edits).

## Verified current state (as of this handoff; re-verify before starting)

**Live and wired (do not redo):**
- `src/services/oneShot.js` — full utility with JSONL logging, buildId correlation, outcome attachment. 27 tests passing.
- `resolveNodeSmart` → all 7 tools (createEdge, createNode, updateNode, deleteNode, setNodeType, selectNode, edgeValidator). Includes the C2 missing-node proposal path (`proposeMissingNode` called inside resolveNodeSmart on true resolution failure).
- Shape classification in `createPopulatedGraph.js` (~lines 81–96): `classifyGraphShape`, `set` → edges stripped, `ladder` → edges stripped + result tagged `shapeRouting: 'abstraction-axis'`, buildId threaded.
- C1 reconcile-before-create in `createNode.js` (~line 47, `callSite: 'reconcilePrototype'`, produces `reconcileSuggestion`).
- C5 group naming (`createGroup.js`), C6 abstraction prefill (`NodeCanvas.jsx` imports `suggestAbstractionName`), edge-label prefill (`NodeCanvas.jsx` `oneShotLabel`), dedup (`DuplicateManager.jsx` → `aiDuplicateDetector`).

**Built, tested, ORPHANED (this phase wires them):**
- `shouldUnfoldMembers` (`src/wizard/tools/utils/classifyGraphShape.js` ~line 61) — A3 recursion decision.
- `runStructureReview` / `reviewGraphStructure` / `detectCandidateClusters` (`src/wizard/tools/utils/structureReview.js`) — all of Part B.
- `suggestRelationKind` (C3), `suggestArrowDirection` (C4), `conformNamingStyle` (C7) in `src/wizard/tools/utils/suggestionCalls.js`.

**Known deficiency to fix here:** `ladder` shape routing is advisory-only — it strips canvas edges and tags the result but never constructs the abstraction chain, leaving a disconnected node pile.

Line numbers are approximate — verify everything before editing.

## Step 0 — Commit the current working tree first

There are ~18 modified + ~13 new uncommitted files from phases 1–2 (all tests passing). Commit them as-is on the current branch before touching anything, so this phase has a clean rollback point. Then commit incrementally per task below.

## Task 1 — A3 recursive unfold controller (highest priority; unblocks the Radiohead test)

**Scoping rule that keeps this legal:** the handoff series forbids refactoring `AgentLoop.js`'s conversation flow. The controller therefore lives at the TOOL layer, not in AgentLoop — a post-build step in (or wrapped around) `createPopulatedGraph`. Code walks the structure; the conversation loop is untouched.

After `createPopulatedGraph` succeeds:
1. Determine the member kind (e.g. "albums") from the request/shape context.
2. One call: `shouldUnfoldMembers({ memberKind, request, shape, buildId })`. No/null → done, return as today.
3. If yes: the controller (plain code) loops over the created member nodes. For each:
   a. Create/attach its definition graph (see `addDefinitionGraph.js` / `populateDefinitionGraph.js` for the existing mechanics — reuse, don't reinvent).
   b. Ask `classifyGraphShape` again for the inside (e.g. songs → `sequence`), scoped to that member ("the songs on the album <name>").
   c. Fill it via the existing populate path with the same shape handling (sequence → directed chain in order).
   d. **Non-active graphs need offscreen layout**: use the existing `applyOffscreenLayout()` pattern AND dispatch the layout event — do both (project convention; `rs-trigger-auto-layout` only fires for the active graph).
4. Depth limit: recurse at most 2 levels total for now (top + one unfold). A constant, not a model decision.
5. Content for the insides should prefer the existing enrichment path (Wikipedia/semantic tools) over model recall where the build already uses it; do not add new enrichment machinery.
6. Everything shares the top-level buildId in the log.
7. The tool result must report what was unfolded (member → definition graph id + shape) so the agent can narrate it.

Mind the stale-snapshot rule: after store mutations, re-fetch state (`useGraphStore.getState()` again) rather than reusing a captured snapshot. Resolve entities by NAME against the real store, take the LAST match on duplicates (project convention — predictive IDs from tool results never match real store IDs).

## Task 2 — Ladder shape constructs the abstraction chain

When `createPopulatedGraph` classifies `ladder`: instead of only tagging `shapeRouting: 'abstraction-axis'` and stripping edges, actually build the chain — order the nodes from most specific to most general (the model already produced them; if order is ambiguous, one `oneShotChoice` to pick the ordering) and wire them onto the abstraction axis using the existing `abstractionChain.js` / `editAbstractionChain.js` tooling. Result reports the chain. If chain construction fails, fall back to current behavior (nodes + tag), never a hard error.

## Task 3 — Wire Part B structure review into build completion

Cheapest viable wiring — NO new approval UI in this phase:
- At the end of `createPopulatedGraph` (after Task 1's unfolding) and `expandGraph`: run `runStructureReview(nodes, edges, { request, shape, buildId })`.
- Remember its layering: `detectCandidateClusters` is deterministic and free; most builds find nothing and make zero model calls. Keep it that way — do not lower the detection thresholds.
- Any suggestions go INTO THE TOOL RESULT (e.g. `structureSuggestions: [{ nodeNames, action: 'group'|'fold', suggestedName }]`) so the agent relays them conversationally and the user can act via existing tools (`createGroup`, `condenseToNode`). Never auto-apply.
- Log user follow-through when determinable (if the next tool call in the conversation creates the suggested group, attach outcome `accepted`).

## Task 4 — C3 + C4 into the edge-creation paths

Two integration points:
1. **`createEdge.js` (wizard path):** after resolution, before creation — `suggestRelationKind({ sourceName, targetName, buildId })`. If `kind of` → include an `abstractionSuggestion` in the tool result (suggest the abstraction axis instead of/in addition to the edge; do NOT silently convert the edge). If the edge label is a verb phrase, `suggestArrowDirection` and set `directionality.arrowsToward` accordingly (edge directionality is a Set of node IDs — see Edge.js / store conventions).
2. **`NodeCanvas.jsx` (UI path):** when the user confirms a connection label in the connection prompt / UnifiedSelector connection-creation flow, fire `suggestArrowDirection` in the background and pre-set the arrow (user can flip; a late-arriving suggestion must never override a direction the user already set). Follow the exact pattern the existing edge-label prefill uses (same file — imitate it, including outcome attachment).

## Task 5 — C7 naming conformance where generated names land

In `createPopulatedGraph` (and the Task 1 unfold path): after node specs are finalized, if the target graph has ≥5 existing nodes with an evident naming style, run `conformNamingStyle({ name, exampleNames })` per NEW model-generated name (batch: skip if >10 new names — cost guard). Apply only unambiguous restyles (function returns a restyled name or 'keep'); log everything. Never rename user-typed names — model-generated names only.

## Constraints (unchanged from phases 1–2)

- One-off constrained calls only; no agent loops, no fine-tuning, no embeddings.
- Every call through `oneShot.js`, logged, with buildId; outcomes attached where determinable.
- Zero-model behavior identical to current behavior; suggestions never auto-commit; user input beats late suggestions.
- `console.error` only in anything imported by `redstring-mcp-server.js` (all of `src/wizard/tools/**`). Never pretty-print JSON in MCP responses.
- Do not refactor `AgentLoop.js` conversation flow (Task 1's controller lives at the tool layer).
- Plain JavaScript; Zustand actions only; match surrounding style. Commit after each task.

## Acceptance checks

1. **Radiohead test:** "show me the Radiohead albums and their songs" → top-level sequence of album nodes, each album node has a definition graph containing its songs as a directed sequence in track order. All correlated under one buildId in the log.
2. **Ladder test:** "poodle to animal" style request → an actual abstraction-axis chain (visible in the carousel), not a disconnected node pile.
3. **Review test:** a small clean build produces zero review model calls and no suggestions; a build with an obvious dense cluster returns a group/fold suggestion in the tool result, nothing auto-applied.
4. **Edge tests:** wizard-created "Kubrick → 2001: A Space Odyssey" edge gets a direction set; a "Poodle → Dog" edge yields an abstraction suggestion in the tool result while still honoring the requested edge.
5. With no model configured: every touched flow behaves exactly as it does today.
6. All existing tests still pass; new controller logic has tests (unfold loop with mocked one-shots: yes-path, no-path, null-path, depth limit).

## Out of scope (unchanged)

Scratch-space/promotion membrane, perception-rendering framework, approval UI for review suggestions, any training. The one-shot log remains the protected asset.
