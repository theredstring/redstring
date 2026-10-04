# The Druid — implementation plan (v2)

> Status: **M1–M7 built and tested; M8 (in the app) started: the Druid lives in the open universe, watched from a panel** (2026-10-04). Run it: `npm run druid -- --mind afm` (Apple's on-device model) or `npm run druid` (LM Studio). Results are under [What the runs showed](#what-the-runs-showed). Branch `druid`. Builds on what is already there, described in [`DRUID.md`](DRUID.md).
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

### M1 — Fix the "Soul" bug — **done 2026-10-03**
`createNode` reported success five times in run 4 and nothing landed.
- **Found and fixed:** `createNode` passed a web *name* in `targetGraphId` through unresolved (`graphId: "Redstring Universe"`), so the applier found no such web and dropped the write while the tool reported success. It now resolves names like `createEdge` does, and fails with the list of available webs when nothing matches. This affected the Wizard too. Tests in `createNode.test.js`.
- **Systemic fix:** the loop now checks the store after every `createNode`/`createEdge`/`createGraph` (`src/druid/verifyWrite.js`). A write that left no trace is a failed call, and the Druid is told so next cycle. Edges are checked by name, because in-turn results carry the agent loop's predicted ids.
- **Visibility:** the CLI always prints save failures, and every journal line records the store's size.
- **Not reproduced:** qwen's first four Soul calls had no web name. Replayed with their exact arguments against run 4's file, they land with today's code. What looked like saving stopping early was not: the store simply stopped changing once Soul was being dropped. Run 5 (8 cycles) wrote Soul and three connections, all verified, and the file matched the store throughout. If it recurs, verification will flag it in the journal.

### M2 — Cycle v2 and the lab — **done**
`src/druid/life.js` (the loop), `attention.js` (locus, bounded view), `mind/` (`createMind`: choose / fill / judge with string-enum schemas and a hard 4K budget; `backends.js`: OpenAI-compatible with `response_format: json_schema`), `moves/basic.js` (new web, make, connect, follow, look, open, close, describe, go to web, let go, note, keep a thought, **remember**), `moves/menu.js` (ranked menu, 4 ranked + 2 exploration slots, "something else" escape hatch with missing-move reports), `world.js` (the store adapter: tools + apply + verify), `promptSpace.js`. The lab is `scripts/druid-lab.mjs` with `src/druid/lab/scenarios.js`.

### M3 — Working memory, activation, episodes — **done**
`activation.js` (ACT-R base level from use ticks, spread with fan, Hebbian associations that fade), `heldInMind.js` (the Working Memory web: 4 slots, fading, rehearsal, scratch thoughts deleted unless promoted, letting go and inhibition, waking), `episodes.js` (per-day episode webs written by the loop).

### M4 — Apple bridge — **done**
`native/afm-bridge` (Swift package): **stdio JSON lines instead of an HTTP port.** No listener at all, so nothing but the spawning process can reach it. Locked answers through `DynamicGenerationSchema` (string `anyOf`); `/health` reports availability and `contextSize` (4096 on this Mac); token counts on macOS 26.4+. `src/druid/mind/afmBackend.js` spawns it. Build: `swift build -c release --package-path native/afm-bridge`.
- **Found:** the on-device model sometimes refuses a prompt as `unsupportedLanguageOrLocale` (26 of 73 calls in one long run, deterministic per prompt; a Druid's view is dense with capitalized names). A leading "This is written in English." fixed every captured case; the backend adds it, and retries once with a second English cue.

### M5 — Goals, beliefs, plans — **done**
`roles.js`, `moves/roles.js`. Role types live in an ordinary **Home** web and are found by a marker (`druid.roleType`), not by name. Renaming or specializing a type keeps its behavior; deleting it turns the behavior off, and it stays deleted. Open goals feed activation and survive waking. Plans are a Thing whose inside holds steps chained by "then", with a cursor. Beliefs keep `druid.evidence` **on the belief** (not as Episode→Belief connections: connections cannot cross webs). Confidence is log-odds over the latest judgment per source, with the Druid's own inferences (Things it made, `druid.madeBy`) weighted at half. A seed becomes the first open goal at birth.

### M6 — Cognitive moves — **done**
`moves/cognitive.js`: variant (shares parts by reference), specialize (is-a, inherits parts), chunk (from strong associations, via `condenseToNode`), contrast (code lists the differences; kept as a belief), generalize, analogy (same shape of relations elsewhere; judged), wonder (code-ranked gaps). Comparisons are boosted when the two Things' descriptions share a word. Structural moves skip goals, plans, episodes and the role types (`isBookkeeping`).

### M7 — Sleep — **done**
`sleep.js`: duplicates by normalized name (English plurals included), judged then merged. Splits: features (webs, relations, parts), two-means by Jaccard, description length with a kind costing one. Proposed only on the **second** sighting, with a cooldown per kind. The kinds are named by the model; a name that already exists is **reused and not deleted on revert**. Revisions are Things in a "Revisions" system web carrying `druid.revision` (the before-map, what was created, what was reused, both scores); `revert` restores exactly. A web per revision was simpler as a record than as a new web over the same Things, and reverts just as exactly.

### M8 — In the app
- **Done (2026-10-04): the Druid lives in the open universe.** Settings › Debug › The Druid shows a panel (`src/components/canvas/druid/`, a host mounted by CanvasShell). From there you pick Apple's model or LM Studio, give it something to have on its mind, and press Wake. `src/druid/inApp/druidSession.js` runs the same `createDruid` as the CLI over the live store, so every Thing appears on the canvas as it is made. The panel streams each moment: its thought, what it chose and what happened. With **Follow** on, the camera centres on whatever it is looking at.
  - Its loop state (cycle, locus, last thoughts) is kept on its Home Thing, so it travels with the universe and a later Wake resumes.
  - Models are reached from Electron's main process (`electron/druidBridge.cjs`): the afm-bridge over stdio, and a chat-completions server on loopback only. This is development only for now: the preload exposes `druid` only with `--redstring-dev`, and the helper isn't shipped.
  - It stops itself, and says why, when the model fails three cycles running (LM Studio not started).
  - Its own webs (episodes, working memory) no longer take the canvas when it writes to them. `focusWeb` now opens a web that isn't open (`setActiveGraph` falls back to the first open web).
- Still to do: the prompt space opened read-only behind the debug setting; associations rendered per D1; working memory shown on the canvas, not just listed in the panel.
- Follows the canvas architecture rules (layers and hosts, nothing in `NodeCanvas.jsx`).

## What the runs showed

**Lab** (one cycle per trial from a built state; 10 scenarios × 5 trials):

| | valid | sensible | "best" | writes landed | ms per call (choose / fill) |
|---|---|---|---|---|---|
| qwen3-4b (LM Studio), round 1 | 100% | 91% | 49% | 100% | 348 / 2173 |
| qwen3-4b, round 2 | 100% | 98% | 58% | 100% | 348 / 2216 |
| Apple on-device, round 2 | 100% | 88% | 52% | 100% | 490 / 531 |

What round 1 taught, and the fixes before round 2:
- Name blanks answered with lists ("quartz, feldspar, mica"): split. A name list in "open up" makes each part.
- "Go to the web Engine" beside "go inside Engine": inner webs are no longer offered as places to go.
- Items with no target scored as half-active: "note a thought" sat on every menu.
- About 30 moves for 6 slots: added exploration slots, and an aptness boost for comparisons.

The models have different temperaments. qwen loves "open up X". Apple's model connects and describes more, and is four times faster at filling a blank.

**Long lives** (fresh universes, sleeping every 10–12 cycles):
- **No material, no seed:** it thinks about its own medium ("Web of ideas", "Creative network"). With nothing to perceive, the only thing in its context is the description of webs. A seed now becomes its first open goal.
- **Seeded, before "keep a thought":** its *thoughts* were right ("rivers carve valleys by eroding hills and depositing sediments") but its graph held one Thing. Nothing carried a thought into memory. The `remember` move is that bridge.
- **Seeded, Apple's model, after:** 30 cycles, 29 ok, 25 writes, 1 invalid in 95 calls, 0.65 s per call. The result is a web of River, Channel erosion, Sediment deposition, Erosion and Flow with 15 connections, plus a chunk. **qwen, same seed:** 28 ok, 17 writes, 2.6 s per call, with an odder graph ("Granite drips through Valley floor").
- **Tending** (a kitchen-garden universe with planted flaws, Apple's model, 36 cycles): 36 ok, 19 writes, 1 invalid in 103 calls. **Sleep split "Plant" into "Herbs" and "Fruit Tree" on its second sighting**, with a recorded revision. It merged the relation names "Grows" and "Grow" (vocabulary tidying, a side effect of duplicates including relation types). Two bugs surfaced and are fixed: a split reusing an existing Thing would have deleted it on revert, and "Tomatoes" did not match "Tomato".
- **Restart:** it wakes with working memory faded and its open goal still pulling (cycle 31 resumed by working toward it).

Problems still open:
- Small-model judgment errors ("Seed Packets and Thyme are both kinds of Herbs"). They are cheap to undo, but nothing yet notices them.
- It follows connections a lot (15 of 36 tending cycles).
- Undescribed Things are only described when they come into focus.

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
