# Small-Model Roadmap — Everything Discussed, Not Yet Implemented

Summary of the design conversation behind `ONESHOT_HANDOFF.md` / `_2` / `_3`. Those three phases built: the `oneShot` utility with outcome logging, smart name resolution everywhere (incl. missing-node proposals and the edge-validator fix), dedup + reconcile-before-create, the nine-shape library with classification and routing, the recursive unfold controller, ladder→abstraction-chain construction, post-build structure review, relation-kind/arrow-direction/naming-conformance calls, and group/abstraction/edge-label suggestions.

Everything below was discussed and is NOT built. Ordered roughly near-term → far-term. Items within a section are independent unless noted.

---

## A. Remaining audit findings (same pattern as phases 1–3; each is a small, independent job)

From the codebase audit — heuristics identified but never covered by any handoff:

1. **Tool-tier gating router** — `src/wizard/tools/schemas.js` (~931–1012): tier-3 tools unlock only if the user's message contains literal keywords ("I discovered a bug" unlocks `discoverOrbit`; "pull in linked data" unlocks nothing). Replace with one multi-label one-shot classification.
2. **cognitiveAgent keyword NLU** — `src/services/cognitiveAgent.js` (~60–124, 478–519): intent by `.includes()` chains, entity extraction by "words after 'create'", position by `Math.random()`. One constrained-JSON call replaces all of it.
3. **Wikipedia disambiguation** — `src/wizard/services/wikipediaEnrichment.js` (~183–199): ambiguous pages resolved by taking the FIRST search result (planet Mercury gets the element's image); plural handling strips "s" ("Feet"→"Fee"). One-shot pick using the node's neighbors as context.
4. **Tabular import shape/column detection** — `src/services/tabularParser.js` (~283–458): CSV structure guessed from header regexes ("Origin"/"Destination" not recognized as edges). One call: headers + sample rows → `{shape, roleColumns}`.
5. **Reuse-selector relevance ranking** — `src/UnifiedSelector.jsx` (~77): exact-substring only; "dog" never surfaces "Canine". One-shot rerank of candidates when substring search is thin. (Directly prevents duplicate prototypes.)
6. **Entity-matching fuzzy verdicts** — `src/services/entityMatching.js` (~133–231): keep the deterministic QID/URI short-circuits; replace the summed magic-constant fuzzy scoring with one same-entity yes/no call.
7. **Semantic-web ranking & predicate labeling** — `src/services/orbitResolver.js`, `knowledgeFederation.js` (~845–887), `automaticEnrichment.js` (~312–340): hardcoded trust tables, 10-entry predicate dictionary, substring type matching. One-shot relevance picks and label generation.
8. **Merge survivor recommendation** — `src/components/DuplicateManager.jsx` (~34–79): user picks which duplicate survives with zero guidance; one-shot recommends survivor + merge strategy.
9. **Semantic seed selection** — `src/Panel.jsx` (~925–933): discovery seeds = first N prototypes in map order; one-shot picks the most representative.
10. **AgentLoop "task-like" check** — `AgentLoop.js` (~1041): message >15 chars = task. Tiny `{needsTools}` classification. (Touches AgentLoop — do in a quiet window.)

## B. One-shot calls designed in conversation, never assigned to a handoff

1. **Hydration check** — "does this node's description contain structure that should become a definition graph — yes/no?" Surfaces which nodes are ready to unfold. (Maintenance role.)
2. **Granularity check** — "does this long description mention concepts that deserve to be their own nodes — pick the phrases?"
3. **Ambient structure review** — Part B's review currently runs only post-build; running the same deterministic-detection + coherence + leave/group/fold pipeline over EXISTING user graphs (on open, or on demand) is not wired. Same restraint rules: math nominates, model confirms, user approves.
4. **Common-parent proposal** — proactive: given sibling nodes on canvas, "what one concept generalizes {Mercury, Venus, Earth}?" (C6 is reactive prefill only.)
5. **Tension flagging** — "do these two claims conflict — yes/no?" Marks contested structure, never resolves it. On-thesis: the medium holds disagreement.
6. **Color-slot suggestion** — name → one of ~12 palette hues (everything currently defaults maroon).
7. **Outcome labeling** — when the user EDITS a suggestion (vs accept/reject), one call: "did the edit keep the substance or replace it?" — labels the training log itself.

## C. Conversation-path instrumentation (the original "step 1"; feeds everything in G)

The one-shot log exists, but the LLM wizard's conversation-path calls (full prompt, response, tool calls, and kept/reverted/edited outcome) are NOT systematically logged. This was the original first recommendation: the LLM wizard running today is the data-collection instrument for task clustering and distillation. Every month un-instrumented is training data lost.

## D. The perception framework (the "entirely separate framework" for small models)

The current small-model support is the LLM conversation loop with accommodations (`modelTier === 'small'` patches in AgentLoop). The designed replacement — perception-shaped, stateless, one graph at a time — is unbuilt:

1. **View codec** — canonical, deterministic text rendering of the active graph (same structure always renders identically). One codec, versioned, boring; many scenario prompts. Names scoped to the active graph (resolution against what's in view = validation).
2. **Gesture codec** — the small closed vocabulary of operations the model may emit; illegal gestures unrepresentable/rejected; each gesture validated by the medium like the UI validates a drag.
3. **Fovea + periphery rendering** — active graph at full fidelity; deterministic low-res shell around it (neighboring region names, counts, the abstraction level above).
4. **Region labeling call** — "name this folded neighborhood in ≤3 words" (needed by the periphery).
5. **Fovea triage call** — when even the active graph exceeds budget: "which of these nodes matter most for the current task — pick 5?"
6. **The controller loop** — perceive → one gesture → validate → re-render → repeat. State lives in the graph; the model holds nothing between calls. (Contrast: conversation-shaped LLM framework accumulates history. The two frameworks stay separate by design.)

## E. Scratch space & the promotion membrane (precondition for anything autonomous)

1. **Containment, not attribute**: internal/draft material lives in its own webs — never an "internal" flag on prototypes (flags leak; containment doesn't).
2. **Promotion act** — crossing from scratch to universe, with provenance recorded; revert as a first-class operation. (Interim measure shipped: reconcile-before-create.)
3. **Promotion-time reconciliation call** — "does this scratch node match an existing universe prototype — pick or new?" The single most important call in the architecture; prevents duplicates at the boundary instead of cleaning them later.
4. **Promotion readiness call** — "is this scratch web coherent enough to propose — yes/no?"
5. **Change-summary call** — "describe what this scratch web adds, one sentence" (becomes the promotion UI text).
6. **Per-task ephemeral universes** — scratch webs spun up per task, discard-by-default; where the model can be wrong cheaply.
7. **Approval UI** — suggestion chips for review/promotion proposals (phase 3 deliberately returns suggestions in tool results only).

## F. The model's own memory (built ON Redstring, not beside it)

1. **Functional anatomy, not taxonomy** — predetermine ORGANS (task scratch, observations about the user's vocabulary/preferences, procedural what-worked notes, pending proposals), never content categories. Structure gives a small model slots to fill (its strength) instead of open space (its weakness).
2. **Exemplar webs** — worked examples stored AS graphs (this request → these gestures → promoted/rejected): few-shot prompting as structure, replacing the big system prompt small models can't hold. Accretes from accepted work; the model's education and its memory become the same mechanism.
3. **Exemplar selection call** — "which of these past worked examples most resembles the current task?"

## G. The learning pipeline (gated on C's logs; months out by design)

1. **Task clustering** — cluster the accumulated call logs to find the real task distribution (the head of the distribution = fine-tune candidates; expected to be power-law).
2. **Per-cluster LoRA adapters** — one base model resident, small swappable adapters per task (MLX on Apple silicon; overnight local runs). Adapters do NOT transfer across base models — the datasets + evals are the portable asset; new base model = re-derive all adapters + regression-gate (a "recompile").
3. **Distillation** — the LLM wizard as teacher: its validated outputs in codec format become small-model training data.
4. **Eval harness** — machine-checkable gestures (parsed? resolved? accepted?) make evaluation nearly free; build the harness before the first training run, not after.
5. **Trigger discipline**: fine-tune only clusters the logs prove the codec alone can't handle. Push the no-training frontier (prompt wording, constrained decoding, exemplars) first.

## H. The far horizon (discussed, directional)

1. **Persistent inhabitant** — a separate program accessing Redstring through the same tool surface as a person, looping continuously, controlled by a UI element. Gated on E (membrane) + demonstrated per-tick competence; a looping model without the membrane produces compounding graph pollution.
2. **Attention-as-navigation** — the inhabitant's context = which graph is open; it navigates (opens definitions, comes back up) like a user; its attention is visible in the UI.
3. **Embeddings as matching organ** — deliberately deferred; later, for prototype matching at scale (never as junk-drawer retrieval — topology is the relevance function).

## I. Non-code items

1. **The thesis document** — a few pages naming the concepts (graph as externalized cognition; the membrane; knowledge-as-structure replacing knowledge-as-prompt; composition discipline = computational efficiency; the two-framework split). For category-staking and to sharpen design decisions against.
2. **"What is a good graph?"** — the open evaluation question the persistent-loop vision ultimately rests on; a UX-research question as much as a technical one.
3. **The failure-noting habit** — when a suggestion is wrong, note the call site; distinguishes "reword the question" fixes from genuine fine-tuning candidates.

---

**Dependency spine:** A and B are independent and can be done anytime in the phases 1–3 style. C (instrumentation) should start ASAP because G is gated on months of its output. D (perception framework) and E (membrane) are the two big builds; F and H sit on top of them. I.1 is parallel to everything.
