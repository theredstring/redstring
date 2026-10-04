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

### M9 — Taste: bloat, helpers, commands — **in progress (2026-10-04)**

Grant's first in-app run (`DruidTest.redstring`, read from a copy) measured with `scripts/druid-health.mjs`, connections and insides judged by qwen3-4b:

| | |
|---|---|
| bookkeeping | 84% of 274 Things (episodes alone 68%) |
| sentences as names | 8 ("Pine wood is a soft and flexible type of wood") |
| relation types | 28 for 95 links; Made Of / Is Made Of, Sit / Sits, Support / Supports… |
| beliefs treated as Things | 15 links to a belief; one belief opened up, a 12-Thing web grew inside it |
| insides that hold parts | 13% (the inside of House held Feet, Footwear, Comfort…) |
| connections that make sense | 18% ("Floor —Sit→ Footwear", "Wood —Soft→ Comfort") |

What changed:
- **Names** (`names.js`). A long name that reads as a sentence is shortened, and the sentence becomes its description. Titles and proper names are kept ("The Hitchhiker's Guide to the Galaxy"). Code decides what it can; a helper decides the rest. Beliefs and contrasts get short handles, with the claim kept in `druid.claim`.
- **Helpers** (`mind/helpers.js`): contextless, single-question model calls at low temperature, made where content enters. The rule from the probes on Apple's model: one question per call.
  - "Does this make sense?" asked alone: 12/12 on the run's own links.
  - Two questions in one call: every link "made sense".
  - Name or sentence: 2/6 when asked together with a short name; every statement right when asked alone.
  - Synonyms: pick, then confirm "roughly the same thing" (10/12).
  - Used by the world: an inside takes only parts ("is X a part of Y?"; if not, it goes one level out); a connection must make sense, and reuses a relation that means the same; a variant, subtype or shared kind must be a kind ("Modern is a kind of House": no).
- **Beliefs are claims** (`isObject`): never connected to, opened up, or connected from (except "is about").
- **Connecting** gets less attractive with every link the Thing already has, and stops being offered at six.
- **Plans**: one at a time; steps named as short to-dos; "step done" is offered only after real work since the step became next; "work on the next step" goes where the step points; a finished plan closes; a plan stalled for 36 cycles is let go in sleep, steps and all.
- **Sleep lets go**: episodes older than 24 cycles fold into one "Day …" Thing per day (count, and what it was mostly about); dead Things the Druid made (unconnected, unused for 48 cycles) and relation types nothing uses are pruned. Never what a person made.
- **Commands** (`commands/commands.js`, `--speak commands`): the Druid writes one plain line, a verb from a fixed list plus words ("connect Floor to Wood as made of", "make Bone inside Feet", "move White Oak out", "merge Flooring into Floor"). An executor parses it, resolves names, runs the same moves (checks included) and reports in plain words. What it can't parse is rewritten once by a helper. The menu's offers become suggested commands. Rename, move, merge and delete are new: tidying the Druid can choose. It can delete only what it made.
- **Health** (`lab/health.js`, `scripts/druid-health.mjs`): these numbers for any universe, so runs can be compared.

**Menu vs. commands, first lab (Apple's model, 10 scenarios × 5):**

| | valid | sensible | best | landed | ms per decision |
|---|---|---|---|---|---|
| menu (with the checks) | 98% | 94% | 54% | 88% | 544 |
| commands | 100% | 66% | 10% | 52% | 1013 |

Writing a command made a 3B model do the composing, and it did it badly. It reached for the verb it knew best: "make Rock: a solid substance" was 15 of the 26 failed commands, a description written as a new Thing. Choosing lets code do the hard part. Menu mode's own misses were the connection check refusing "River flows Delta" (the relation came back as one word); a refused connection is now asked again once, as words that make a sentence.

So the menu stays primary, and plain commands come in where they help:
- **"Something else, as a command: ___"** runs the line through the executor, so every verb is reachable (merge, move, rename, delete) without composing every cycle. Text that is not a command is still recorded as something it wanted.
- **Tidy moves** (`moves/tidy.js`) are offered when code sees a need. "Move X out of Y" comes from sleep's audit of insides ("is X a part of Y?", a few each sleep, flagged in `druid.misplaced`); "merge X into Y" comes from names that normalize the same. Sleep notices; waking decides.
- Command mode stays available (`--speak commands`, the panel's switch), with its executor fixes: making what already exists means describing it, and `go`/`open` fall back to a web of that name.

**Second and third rounds (same day).** The first fixes made the Druid timid: a fresh 40-cycle life made 8 Things and 4 links. Three of the causes were bugs introduced that day:
- the echo guard threw out relations the question had offered, so almost nothing got connected;
- notices were cleared before the model could read them, so it never learned why a move failed;
- "move X out" was offered only from inside that web, so a Druid that stayed in one web never saw the 15 Things sleep had flagged elsewhere.

Fixed, and added:
- **Refusal memory.** A suggestion a check refused stays off the menu for 24 cycles, whichever way round the pair is named.
- **Wandering notice.** Two moves in a row that went somewhere without doing anything are said out loud.
- **World invariants.** Nothing goes inside itself; nothing connects to itself.
- **Moving keeps connections.** Moving a Thing takes along every connection that can still be drawn and reports the rest.
- **Topic webs.** Webs started as topics are marked, so they are never checked as somebody's inside.
- **Plan steps as questions.** Steps are things to find out, not chores: a step written "Find tutorial" had turned a wooden-floor run into one about tutorials.
- **No examples in retry questions.** A small model copies them: asked to retry "like 'flows into'", it gave "flows into" for tutorials.
- **Relations from sentences** (`relations.js`). Asked for a short sentence that begins with one Thing and ends with the other ("Bones support the feet"), the model writes something checkable; the relation is what lies between the names. A relation from the Druid's own sentence is trusted, because the sense check wrongly refused good sentences 2 times in 5. Bare fragments are still checked.

**Dialogue** (`dialogue.js`):
- **The through line.** One sentence, rewritten every six moments and kept only if it is new and names what the universe holds. It is shown when choosing, never when thinking: shown there, it became the thought for ten moments running.
- **What a person says.** It is kept for 12 moments and shown with every choice. The Things it names pull attention. A request ("think about what holds the boards together") becomes its goal, replacing the last one a person asked for. It answers in a sentence.
- **Tested live.** Told at cycle 4 to think about what holds the boards together, it moved within ten moments from wood types to Attach, Boards and Screw. Asked "why did you make that?", it explained.

**Recency through lines** (`recency.js`, Grant's idea: a person remembers recent things better). Two through lines run side by side:
- **the phonological loop:** the last three thoughts, verbatim;
- **the recency trail:** the last few places and deeds, built by code from what happened ("just now: made Screw", "2 moments ago: looked at Boards", "3 moments ago: went to the web Wood"), newest first, fading after 24 moments.

The view carries recency on the graph too: the focus, the Things beside it, its connections and the other webs are marked "just now" or "4 moments ago" while recent.

The prose through line is now written from the trail, and it is refused only when it is a near-copy. At a looser threshold it stayed "the wood to build the floor" for 22 moments while the Druid worked on screwdrivers.

Also from that run:
- A connection sentence that names the two Things the other way round connects them that way round.
- A sentence that isn't one relation is refused, instead of being taken whole as a relation and mapped onto an existing one ("Boards are used to make Screwdriver").
- Name-clash failures ("Floor already exists") count as refusals, so the same failing grouping isn't offered again and again.

**In the app.** The Druid is now "The Druid" in the Wizard panel's mode menu (above Chat; shown while Settings › Debug › The Druid is on), with its moments, what you say and what it answers in one stream, and an input to talk to it. The floating panel and the old Druid's leftovers in the Wizard (`DruidInstance`, its six-folder workspace) are gone from the panel.

The panel shows the Druid's own header: Copy and Clear, not the Wizard's tabs and buttons. **Copy is how a run is reported.** It copies the whole run as plain text:
- each moment: where it was, its thought, the numbered menu with the choice starred, the result or the failure, every question it was asked and its answer, and what sleep did;
- what was said either way;
- an outline of the universe as found from Home (`lab/outline.js`).

Grant tests on a fresh universe each time and pastes this.

**No Wikipedia.** What the Druid makes is never looked up: not by the Wizard's apply path, which filled a Thing with no description yet with an article's text and picture, nor by the node panel's identifier lookup.

**Nothing lost: everything hangs off Home** (`world.shelve`). In a DruidTest universe only 6 of 15 webs could be reached from Home; Working Memory and the episodes sat in no web at all.
- Each web it starts gets a Thing in Home.
- Its own webs (Working Memory, Revisions, the Diary) sit in Home.
- Each day's episodes sit in the Diary.

A web whose Thing sits only in Home still counts as top-level for going between webs. The Druid does not see its own webs as content. Waking shelves anything left over.

**A Druid with no seed** (Grant's first pasted transcript, 2026-10-04). It thought about its own medium, making "Home Web", "New web", "Web", "Navigation" and "Contents" in five moments. Then, guarded against that, it made "Redstring".
- **The cause:** its instructions are about this place (Things, connections, webs), and an empty universe offers nothing else.
- **Now, its first goal:** waking with no seed and nothing built, it asks itself out of context (`helpers.curiosity`, warm) what in the world it wants to understand. The answer becomes its first goal, "Understand dark matter". Probing Apple's model gave DNA, gravity, earthquakes, how plants grow, black holes.
- **Now, its instructions** say the universe is where it keeps what it learns, not what it is about.
- **Now, a name guard** (`names.aboutTheMedium`): a name made only of words for this place is refused, unless the person seeded or said those words.
- **Bookkeeping places** (`attention.isOwnPlace`): goals' and plans' insides are bookkeeping, not places to keep what it learns. One run kept Mars, Earth and Water inside its plan and never started a web.
- **Subjects, not questions:** a web named as a question names its subject ("What is dark matter?" → "Dark matter").
- **Goals:** a goal is marked reached only after 5 Things were built toward it. One was declared reached on an empty web.
- **Beliefs** are named by the contextless name helper.
- **Live:** after these changes, a seedless run started a web called "Dark matter" by moment 5 and built Dark energy and Vacuum.

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
