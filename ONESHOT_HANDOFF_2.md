# Handoff: One-Off Model Calls, Phase 2 — Structural Shapes, Build Review, and Suggestion Calls

This continues the work described in `ONESHOT_HANDOFF.md` (phase 1). Read that first. Phase 1 established:

- `src/services/oneShot.js` — the shared constrained-call utility (`oneShotChoice` / `oneShotBoolean` / `oneShotLabel`), with strict parsing, null-on-failure, heuristic fallbacks, and JSONL logging of every call + outcome.
- `src/wizard/tools/utils/resolveNodeSmart.js` — shared name→node resolution.
- Dedup wiring and edge-label suggestions.

**Before starting: verify what phase 1 actually shipped** (check the files above and the modified wizard tools). Build on it; don't duplicate it.

Phase 2 adds the calls that don't replace existing heuristics but create new capability. Everything here follows the same rules: one-off constrained calls only (no agent loops), every call logged with outcome, every feature degrades gracefully to current behavior with no model configured, nothing auto-applied — model output is always a suggestion or a pre-fill the user can override.

**Naming note:** use plain descriptive names in code and UI (`classifyGraphShape`, `reviewGraphStructure`, `suggestPromotionMatch`). Do not use whimsical/persona names (no "druid", "gardener", "wizard brain", etc.) as formal identifiers.

---

## Part A — The structural shape library and shape-guided building

### A1. The shape library

When the wizard builds a graph from a request, the structure it should produce is almost always one of **nine shapes**. Define these as a constant (e.g. `src/wizard/tools/utils/graphShapes.js`), each with: key, one-line description, 2 example requests, and build notes. The library:

| Shape | What it is | Example request | Built from |
|---|---|---|---|
| `set` | Unrelated nodes, NO edges | "brainstorm 20 product ideas" | nodes only |
| `web` | Things + relations, flat, no center | "how do the Greek gods relate?" | nodes + labeled edges |
| `star` | One protagonist elaborated by aspects | "tell me about the Ottoman Empire" | center node + spokes |
| `sequence` | Ordered chain, start → end | "steps of photosynthesis", "albums in order" | directed edge chain |
| `cycle` | Directed loop, no start/end, feedback | "the water cycle" | directed edges closing a loop |
| `tree` | Branching parent–child **by role** (org, family, decision) | "the Tudor family tree" | edges fanning out on canvas |
| `ladder` | Chain of **kinds** (is-a): poodle→dog→mammal | "where does a virus sit between chemistry and life?" | **abstraction axis / carousel — NOT canvas edges** |
| `correspondence` | Two kinds of things + mapping across | "which actors played which characters" | two groups, edges only across |
| `dialectic` | Claims + supports/contradicts, left unresolved | "map the debate over nuclear power" | position/evidence nodes, support/oppose edges |

Critical routing rules baked into the library:
- **`set` exists to license NOT drawing edges.** Over-connection is a known model failure mode; when things don't clearly relate, `set` is the correct answer, not a sparse `web`.
- **`ladder` routes to the abstraction axis**, not canvas edges. Kind-of hierarchies are a different dimension in Redstring (the abstraction carousel / `abstractionChain` tooling), while `tree` (parts, roles, reporting) stays on canvas. This distinction is the single most valuable thing the shape call does.
- Default bias: when uncertain, `web` (or `set` if relations are unclear).

### A2. The shape call

`classifyGraphShape({ request })` → `oneShotChoice` over the nine shapes (numbered list with one-line descriptions + one example each). Returns a shape key or null (null → current behavior, no shape guidance).

### A3. Recursive build grammar (composition is the recursion, not a shape)

Shapes compose by recursion, one level at a time:

1. Shape call for the top level.
2. Fill the top level per that shape's build notes.
3. **Unfold decision** per member kind (one `oneShotBoolean`): "should each X open into its own definition graph of its contents?" (e.g. albums → yes, each contains songs).
4. If yes: the controller loops members (code does the iteration); for each, create/open its definition graph and **ask the shape call again inside** (e.g. songs → `sequence` for track order), then fill.

The model only ever works on one graph at a time. The controller walks the structure. Integrate this into the existing populated-graph build path (`createPopulatedGraph`, `populateDefinitionGraph`, `expandGraph` — see how they're invoked from AgentLoop) without refactoring the conversation loop itself. Reuse the existing offscreen-layout pattern for non-active definition graphs (`applyOffscreenLayout` + event dispatch — see project memory/conventions).

Acceptance example: "show me the Radiohead albums and their songs" → top level `sequence` of album nodes (chronological, directed chain), each album unfolds into a definition graph that is itself a `sequence` of its songs in track order. Facts should come from the existing enrichment path (Wikipedia/semantic tools) where available, not model recall.

---

## Part B — End-of-build structure review pass

After any multi-node build completes, run a **review pass** that looks for regions that could become more compositional — but is strongly biased toward doing nothing. Layered so most runs cost zero model calls:

1. **Deterministic candidate detection (code, free).** Find candidate clusters: subsets densely connected internally, sparsely connected outward (simple community detection is fine), and/or graph node count exceeding a readability threshold (~25–40 nodes, constant). **No candidates → review ends. No model calls.**
2. **Coherence check (one `oneShotBoolean` per candidate).** "Do these N nodes form one nameable concept? Answer yes only if clearly so." Biased to no.
3. **Weakest-sufficient-structure choice (one `oneShotChoice`).** Three options, in this order: `leave as is` / `group them` (visual containment, cheap, reversible) / `fold into a node with a definition graph` (full composition — only when the cluster is a concept the rest of the graph should reference as one thing). Default/bias: leave.
4. **Name it** (existing naming-style call or `oneShotLabel`, ≤3 words).
5. **Present as a suggestion** — a proposal the user approves or dismisses. NEVER auto-apply. Use the existing group/`condenseToNode` machinery to execute on approval.

Log the full chain (candidates found, verdicts, user decision). Bonus signal: if reviews repeatedly fold regions inside graphs the shape call classified as flat, that's classifier under-estimation — the log makes it measurable. No need to act on it now; just make sure shape-call results and review outcomes are correlatable in the log (share a build id).

---

## Part C — New suggestion calls (independent, small, do in this order)

1. **Reconcile-before-create.** When wizard tools are about to create a new prototype, one call: "does '<name>' match any of these existing prototypes (name + description) — pick one or 'new'?" On match, reuse instead of create. This is the highest-leverage duplicate *prevention* (cheaper than detection after the fact). Wire into the prototype-creation path used by wizard tools (and respect the existing take-LAST-match convention for exact name hits — no model call needed for exact matches).
2. **Missing-node proposal.** Extend `resolveNodeSmart`: when resolution truly fails, one `oneShotBoolean` — "is '<name>' plausibly a distinct concept that belongs in this graph?" Yes → the tool result includes a `proposedNode` suggestion (surfaced to the user as an offer to create it) instead of a bare failure.
3. **Relation-kind classification.** When a connection is created (wizard or UI path), one 3-way call: "is A *a kind of* B, *a part of* B, or *related to* B?" `kind of` → suggest placing it on the abstraction axis instead of (or in addition to) a canvas edge. Others → normal edge.
4. **Arrow direction.** When an edge label is a verb phrase, one 2-way call: which way does it point? Pre-set `directionality.arrowsToward` accordingly (user can flip).
5. **Group auto-naming.** On group creation (`createGroup` path), suggest a ≤3-word collective name from the member names ({Mercury, Venus, Earth} → "Inner Planets"). Pre-fill, user overwrites.
6. **Abstraction suggestion.** When the user opens the add-above/add-below prompt on the abstraction axis, pre-fill one suggested name: input = node name + direction (more general / more specific) + existing chain names. ("Dog" + above → "Mammal".)
7. **Naming-style conformance.** When a model-generated node name lands in a graph with an evident naming style, one call: "existing nodes here are named like {examples}; restyle '<name>' to match, or answer 'keep'."

Lower priority / only if time: color-slot suggestion for new prototypes (name → one of ~12 palette hues); tension flagging ("do these two claims conflict — yes/no" → mark, never resolve).

---

## Constraints (same as phase 1, restated)

- One-off constrained calls only. No agent loops, no fine-tuning, no embeddings, no vector stores.
- Every call through `src/services/oneShot.js`; every call logged with outcome.
- Zero-model behavior must equal current behavior. Suggestions never auto-commit; user input always wins over a late-arriving suggestion.
- `console.error` only (never `console.log`) in any file imported by `redstring-mcp-server.js` (all of `src/wizard/tools/**`).
- Plain JavaScript, match surrounding style. Zustand actions only for state changes; store uses Maps.
- Don't refactor `AgentLoop.js`'s conversation flow. Verify all file paths/line references before editing.
- Test against a local model (LM Studio/Ollama via the existing OpenAI-compatible support) — small local models are the target.

## Acceptance checks

1. Radiohead test (A3) produces the two-level sequence structure described above.
2. "Brainstorm 15 startup ideas" → `set`: 15 nodes, zero edges.
3. "Poodle to animal" style request → abstraction-axis chain, not canvas edges.
4. Review pass on a small clean graph: zero model calls, no suggestions. Review pass on a 40-node graph with an obvious tight cluster: one group-or-fold suggestion, awaiting approval.
5. Creating "NYC" when "New York City" exists → reconcile-before-create offers the existing prototype.
6. All shape calls, unfold decisions, review verdicts, and user outcomes appear in the one-shot log with a shared build id.
7. Everything still works with no model configured.

## Explicitly out of scope (future phases)

- Scratch-space/draft universes and the full promotion workflow (containment membrane). Reconcile-before-create (C1) is the interim measure.
- The perception-shaped rendering framework ("view codec"), fovea/periphery rendering, and region labeling.
- Any training/fine-tuning. The logs this phase produces are its raw material — protect them.
