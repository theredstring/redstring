# The Druid — implementation plan (v2)

> Status: **plan, not started** (2026-10-03). Branch `druid`. Builds on what is already there, described in [`DRUID.md`](DRUID.md).
>
> The goal: a **persistent entity** that runs on a tiny on-device model (Apple's Foundation Models, ~3B parameters, 4,096-token window, on a Mac or an iPhone 15 Pro and later), with a Redstring universe as its memory. It keeps that universe in shape faster than a person could, because code does nearly all the work. The model makes judgments; it never builds structure.

## Rules this plan follows

These came out of the design conversation and decide every choice below.

1. **Deterministic first.** Anything code can do, code does. Multi-step operations are chained in code and appear to the model as a single move.
2. **The model chooses and names; it never types structure.** Code lists the candidates, the model picks one, or fills one short blank, or gives a judgment from a fixed scale. No JSON schemas, no ids, no native tool calling.
3. **Prescribe verbs, not nouns.** We define the *operations* of thought (open, specialize, chunk, contrast, doubt…). What it thinks about, and how it files it, is its own.
4. **Furniture vs. physics.** Goals, beliefs, plans and every web are furniture: the Druid can rename, reshape, specialize or delete them. The loop, the guards and the authored prompt space are physics: fixed.
5. **The context window is the phonological loop.** Short, verbatim, cleared freely. Nothing important lives only there.
6. **The graph is ground truth.** Claims are checked against it. Probabilities are computed from evidence, never stored as bare numbers.
7. **Nothing is destructive.** Every restructure is a new web with provenance. Epoch snapshots and git keep its whole history.
8. **Additive format changes only.** New fields go in `semanticMetadata` on Things and connections (already round-trips) and in the existing `provenance`. No side maps.

## What carries over

| From v1 (`src/druid/`) | Becomes |
|---|---|
| Headless store + universe file + CLI (`scripts/druid.mjs`) | unchanged: the body |
| `recall.js` (index, spreading activation, drift, `ungroundedNames`) | the core of `activation/` and of the grounding guard |
| Guards (placeholder, unchanged note, unbacked claims, fallback) | kept. Most become impossible under locked output shapes, but stay as checks |
| `runDruid.js` free-form agent turn | **replaced** by the cycle in `cycle/` |
| Self-written note string | **replaced** by the working-memory web. A one-line "rehearsal" may stay |
| `oneShot.js` (`oneShotChoice`/`Boolean`/`Label`/`List`, `parseChoice`/`parseLabel`) | the basis of `mind/`: these already are choose/judge/fill |
| Wizard tool functions (`createNode`, `createEdge`, `condenseToNode`, `decomposeNode`, `abstractionChain`, `mergeNodes`, `findDuplicates`…) | what moves call underneath. The model never sees them |

## Architecture

```
               ┌─────────────────────── code (fast, deterministic, testable) ───────────────────────┐
 universe  ◄──►│ activation/   attention/   workingMemory/   moves/   belief/   sleep/              │
 (.redstring)  │        └──────────────── cycle/ ─────────────────┘                                 │
               └───────────────────────────────┬────────────────────────────────────────────────────┘
                                               │  choose(menu) · fill(blank) · judge(scale)
                                          mind/ (the only model calls)
                                     ┌─────────┴──────────┐
                              afm-bridge (Swift)    OpenAI-compatible
                              Apple on-device       (LM Studio etc.), structured output
                                         prompt space (read-only .redstring) ──► procedures + vocabulary
```

### Modules (`src/druid/`)

| Module | Responsibility | Model? |
|---|---|---|
| `activation/` | how likely each Thing is to be needed: ACT-R base-level from use times, plus spread along connections, part–whole links and (D1) associations | no |
| `attention/` | the **locus**: focus Thing, path (breadcrumbs), and the bounded **view** from it (focus, top of its inside, its container, strongest neighbours) | no |
| `workingMemory/` | the working-memory web: ~4 slots counted in chunks, fading per cycle, rehearsal on use, scratch items, letting go, inhibition, promotion to long-term memory | no |
| `moves/` | registry of cognitive moves (shape below). Builds the ranked **menu** for the current view | no |
| `belief/` | evidence links, judgment → likelihood ratio, log-odds confidence, source deduplication, contradiction finding | no |
| `sleep/` | consolidation between epochs: misfit detectors, restructure proposals, compression score, revisions as new webs | judges proposals |
| `cycle/` | the loop: perceive → menu → choose/fill → execute → episode → fade → (sleep) | via `mind/` |
| `mind/` | `choose(menu)`, `fill(blank, maxWords)`, `judge(question, scale)`. Backend-agnostic, strict per-call token budget | **yes** |
| `promptSpace/` | loads the read-only prompt-space universe into an index. Serves the procedure and wording for a given move | no |

### A move

```js
{
  id: 'specialize',
  label: (c) => `make a kind of ${c.focus.name} that is ___`,   // menu wording — tested in the lab
  applies: (view, mind) => [...candidates],                    // deterministic; [] = not offered
  blank: { maxWords: 4 },                                      // or null: a pure choice
  run: async (store, candidate, text) => { /* chained tool calls */ },
  episode: (candidate, text, result) => ({ ... })              // what the loop records
}
```

The menu shows 5–7 moves, ranked by activation and active goals, always ending with **"something else: ___"**. Free text there is mapped to a move where possible. If it can't be mapped, it's logged as a **missing-move report**, and the move list grows from those reports.

### Per-call budget (4,096 tokens, input and output together)

| | tokens |
|---|---|
| fixed instructions (from prompt space) | ≤ 500 |
| view at the locus | ≤ 1,200 |
| working memory (rendered) | ≤ 400 |
| phonological loop (last 1–2 cycles verbatim) | ≤ 600 |
| menu or blank | ≤ 400 |
| output | ≤ 300 |
| headroom | ~600 |

`mind/` enforces this. It trims the view first and the loop second, never working memory or the menu.

## Data model (additive)

Everything Druid-specific sits under `semanticMetadata.druid` on the entity it describes. Authorship uses the existing `semanticMetadata.provenance` (`wasAttributedTo: 'druid'`).

| What | Where |
|---|---|
| Uses (for activation) | Thing: `druid.uses` = last ~20 use times. Activation is computed from these, never stored |
| Role types (Goal, Belief, Plan, Episode, Scratch) | real Things seeded into its home web. Each carries `druid.role`. A Thing's behavior comes from walking its `typeNodeId` chain to a role, so renamed or specialized types keep their behavior, and deleting a role type turns it off |
| Goal state | `druid.status`: open / resolved / abandoned. Subgoals are its inside |
| Plan | a Thing whose inside is its steps, ordered by "then" connections. `druid.cursor` marks the next step |
| Belief evidence | connections Episode → Belief, `druid.judgment` (strong+ … strong−), `druid.source`. Confidence is computed |
| Episodes | Things the loop writes for meaningful events (a write, a judgment, a failure), chunked into per-day webs by code |
| Working memory | a web named for it. Its instances are the slots. Slot activation lives in **instance** metadata *(verify instances round-trip extra fields; if not, on the web's metadata keyed by instance, M3)* |
| Associations | **D1**: either connections of type "associated with" with `druid.strength`, or a hidden layer |
| Schema revisions | a new web over the same Things, `druid.revision = { of, reason, before, after, at }`. The type Thing records `druid.activeSchema` |
| Loop counters, locus, phonological loop | sidecar `state.json` (as now). Not knowledge, so not in the graph |

## Milestones

Each ends in something runnable with tests. Most of the system can be tested **without a model**. Only `mind/` and the lab need one.

### M1 — Fix the "Soul" bug
`createNode` reported success five times in run 4 and nothing landed. It happened in a web that sits inside a Thing of the same name ("Redstring Universe" inside "Redstring Universe").
- Reproduce in `test/druid/` with the headless store; find where the write drops (applier graph targeting vs. the agent's active graph).
- Fix it in the wizard path (it likely affects the Wizard too). Add a regression test there.
- **Done when:** a scripted run creating a Thing in a self-named web lands in the store, and a failing write reports failure.

### M2 — Cycle v2 skeleton and the lab
- `attention/` (locus, path, view), `mind/` with the OpenAI-compatible backend (LM Studio structured output), `cycle/`.
- Six moves: **open**, **close**, **follow**, **make a Thing here** (blank: name), **connect** (pick target, blank: relation), **let go**.
- The prompt space as a stub file holding these moves' wording.
- **The usability lab:** `test/druid/lab/` scenarios (a universe state + focus + the picks a person would call sensible) and `scripts/druid-lab.mjs`. It runs N trials per scenario per backend and reports valid-pick rate, sensible-pick rate, latency and tokens per call. It supports A/B label wording.
- **Done when:** qwen3-4b capped at 4K runs 50 cycles with zero invalid outputs, and the lab gives a baseline sensible-pick rate.

### M3 — Working memory, activation, episodes
- `activation/` (base-level + spread; recall.js folded in), the working-memory web (slots, fading, rehearsal, scratch, let go, inhibit, promote), episodes written by the loop.
- Restart = a fading event (waking).
- **Done when:** deterministic tests show items fading and staying through use, and scratch items either promote or disappear. In a live run, working memory stays at or under its budget for 100 cycles.

### M4 — Apple bridge
- `native/afm-bridge`: a Swift package, executable, HTTP on `127.0.0.1` only (consistent with the security audit). Endpoints: `/health` (model availability), `/choose`, `/fill`, `/judge`. Output shapes are locked with runtime-defined schemas. *(Confirm the exact FoundationModels API for runtime schemas at the start of M4.)* A stateless session per call; prewarm on start.
- `mind/` backend for it. The CLI gets `--mind afm`.
- **Done when:** the M2 lab runs on Apple's model, with a side-by-side report against qwen.
- Later (not this milestone): the same Swift core as a Capacitor plugin for iPhone.

### M5 — Goals, beliefs, plans with behavior
- Seed role types into a home web at birth. The prompt says plainly that it's furniture.
- Goals act as constant sources of activation. Plans advance by cursor, and a failed step reopens the plan. Beliefs get evidence and computed confidence, `judge()` on a five-step scale, source deduplication, and the Druid's own inferences weighted below observations.
- Moves: commit to, resolve, abandon, break down (goal); believe, doubt (belief); plan, next step (plan).
- **Done when:** tests cover the log-odds math, deduplication, and plan cursor behavior. In a live run, a goal stays active across a restart.

### M6 — The bigger cognitive moves
**variant**, **specialize**, **chunk**, **contrast**, **generalize**, **analogy** (structure match proposed by code, judged by the model), **wonder** (code-ranked gaps), and Hebbian association updates on co-activation.
- **Done when:** each move has deterministic tests of its chain, and a lab scenario.

### M7 — Sleep: schema reconstruction
- Misfit detectors: exceptions piling up, a category splitting into clusters, overlapping categories, a part always reached through the wrong whole, clustered contradictions, missing-move reports.
- Proposals scored by **compression** (description length before vs. after). Hysteresis: misfit must build up, and there's a cooldown per category.
- Accepted restructures become new webs over the same Things. The old schema stays, with provenance.
- **Done when:** a seeded universe with a planted misfit (e.g. "Bird" with a non-flying cluster) is proposed for a split and scores better after it. Reverting restores the old web exactly.

### M8 — In the app
- The prompt space opened read-only behind a debug setting.
- A read-only **follow** mode: reload the Druid's universe as it changes, so you can watch it think on the canvas.
- Associations rendered per D1. Its working memory visible.
- Follows the canvas architecture rules (layers and hosts, nothing in `NodeCanvas.jsx`).

## Risks

| Risk | Mitigation |
|---|---|
| Judgment quality at volume | everything reversible; structural changes need evidence to build up; the lab measures quality per move |
| The 4K window | strict per-call budget in `mind/`; views bounded by construction; chunks count as one slot |
| Graph clutter (episodes, associations, scratch) | fading prunes, episodes chunked by day, D1 overlay |
| Restructure churn | hysteresis, cooldowns, compression must improve by a margin |
| Self-confirming beliefs | count sources, not mentions; its own inferences weighted below observations |
| Activation writes on every cycle | write uses only for Things touched; saves are already debounced; git sync per epoch, not per cycle |
| Apple API details | confirmed at the start of M4; the OpenAI-compatible backend keeps everything else unblocked |

## Decisions for Grant

- **D1 — Association visibility.** Ordinary connections (legible, but they'd swamp the canvas) or a separate layer shown through an overlay or the debug view. Leaning: overlay.
- **D2 — Episodes on the canvas.** Visible Things in a per-day web, or kept out of view like associations.
- **D3 — Where the Druid lives in the app** once it's more than a CLI: its own universe in the universe list, a panel, or both.
