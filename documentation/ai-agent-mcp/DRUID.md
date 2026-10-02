# The Druid

> Status: **experimental, `druid` branch.** A headless loop: a local model thinking to itself, with a Redstring universe as its long-term memory. No person in the loop and no UI. Watch it by opening its `.redstring` file in Redstring.

## The idea

The Wizard is a tool a person drives. The Druid has no person. Its output is its next input, and the only thing that accumulates is the graph.

It has two memories, and they work differently on purpose:

| | Long-term memory | Working memory |
|---|---|---|
| What | The graph: Things, connections, webs inside Things | A short note in the system prompt |
| Who writes it | The Druid, through tools | The Druid, in its own words |
| Lifetime | Persists (a real `.redstring` file) | Until the Druid rewrites it |
| How it is read | Recall (involuntary) + search/read tools (deliberate) | Always in context |

Between rewrites the context also holds the verbatim cycles of the current **epoch**. When the context fills, the Druid is asked to write the note that replaces it, so the model does its own compaction. It can also rewrite the note whenever it chooses. That is the "phonological loop": a small rehearsal buffer the mind maintains itself, in front of a large store it has to retrieve from.

### What it is not

The earlier Druid (`src/services/DruidInstance.js`, `src/services/agent/DruidPrompt.js`, still wired as a chat persona in `LeftAIView`) built six fixed mind-graphs before it had thought anything: Goals, Beliefs, Observations, Plans, Episodic, Semantic. This Druid starts with an empty graph and nobody has chosen its categories. The prompt describes the two memories and how to use each, and nothing about what to think or how to file it. Recall follows whatever shape the graph has, so a better-organized memory recalls better without code changes.

One finding from the first run belongs here. Given an empty graph and no seed, a 4B model's first act was to model itself as Mind → Perception, Memory, Decision. Removing the prescription from the code doesn't remove it from the model's priors; it moves it to where it can be watched.

## The loop

`src/druid/runDruid.js`, one cycle:

1. **Recall.** The graph is indexed and the working memory + last thought are used as a cue. Things the cue names are *in mind*: they send activation but are not handed back. What surfaces is adjacent to them, one step along the graph's own structure (connections, and the part–whole link between a Thing and the web inside it). Things surfaced in the last three cycles are damped. See `src/druid/recall.js`.
2. **Think.** One real wizard turn (`runWizardInProcess` → `AgentLoop` → tools) runs with the note as the system prompt, the epoch's earlier cycles as history, and the cycle message (last thought, what surfaced, how full the context is) as the user turn. Tool results are applied to the store as they arrive.
3. **Feed back.** The final text becomes the next cycle's "last thought".
4. **Compact.** A `<working_memory>…</working_memory>` block in the reply becomes the new note; the history is cleared and a new epoch begins. Past `--compact-at` of the window, or 16 verbatim history messages, the next cycle asks for one.

### Guards, each from a failure it prevents

- **No note when asked:** asked once more, then a mechanical note is written for it: the old note whole, plus the epoch's last thoughts under a heading that says they weren't consolidated. Memory is never lost to a malformed reply.
- **Note too long** (over a quarter of the window): sent back once, then clipped, with a notice.
- **Note rewritten unchanged:** ignored, and the context is kept. On the first real run, once a 4B model had compacted, it did nothing but re-emit the same note for three cycles. Each one wiped the context it would have needed to get out.
- **Idling** (no successful tool calls, or repeating the last thought) for 3 cycles: one memory drifts up at random from anywhere in the graph. This is the only outside perturbation a loop with no person can get.
- **Model errors:** the cycle is retried with backoff and doesn't count; 5 in a row stops the run.

### Cache-friendly by construction

On a local server the latency that matters is prompt processing, so the prompt layout is chosen to reuse the KV cache:

- The tool block is fixed (`druid` tool policy, `src/wizard/toolPolicy.js`): byte-identical every cycle.
- The note sits in the system prompt, which changes only when the note does. A new note also clears the history, so the cached prefix is lost exactly once per epoch.
- Between rewrites the history only grows at its end.

## Tools

The `druid` policy: `search`, `readGraph`, `getNodeContext`, `inspectWorkspace`, `switchToGraph`, `createGraph`, `createNode`, `createEdge`, `updateNode`, `populateDefinitionGraph`, `mergeNodes`, `deleteNode`, `deleteEdge`.

Left out: `askMultipleChoice` (it would end a cycle waiting for a person), `planTask` and `declareGoal` (their contracts steer a turn toward finishing a user's build), and `expandGraph` (`createNode` does the same one Thing at a time).

**Tool schemas are the biggest tenant of a small window.** The full set measured ~6,600 tokens, most of an 8K window, and `expandGraph` + `populateDefinitionGraph` were 4,200 of that. The Druid gets `populateDefinitionGraph` slimmed to a part list (names, descriptions, connections). The styling guidance for webs a person will look at is dropped. The set now costs ~2,570 tokens. Every dropped field is optional, so the tool runs unchanged.

Deletes are applied without the confirmation gate (`confirmed: true`): there is nobody to confirm, and a held delete would tell the Druid its memory changed when it hadn't. Every rewrite snapshots the universe into `epochs/`, so any forgetting can be undone.

## Running it

```bash
# Ollama — set the server's context first; its default is small and it truncates silently
OLLAMA_CONTEXT_LENGTH=16384 ollama serve
npm run druid -- --model gemma4 --context 16384

# LM Studio — set the context length in the model's load settings, pass the same number
npm run druid -- --endpoint http://localhost:1234/v1/chat/completions --model qwen/qwen3-4b-2507 --context 8192

# A fresh Druid with something on its mind
npm run druid -- --model gemma4 --context 16384 --seed "What is a river?"
```

`--context` **must match the server.** If the server's window is smaller, it drops the front of the prompt, which is the system prompt and with it the working memory, and the Druid never finds out.

Files, beside the universe (default `~/.redstring/druid/druid.redstring`):

| | |
|---|---|
| `<name>.druid/state.json` | cycle, epoch, note, last thought, history; a restart resumes here (`--fresh` ignores it; the graph is kept) |
| `<name>.druid/journal.jsonl` | one line per cycle: thought, tools run, what surfaced, context fill, any rewrite |
| `<name>.druid/epochs/` | the universe at each rewrite |

Give the Druid its own universe file. The headless writer takes a lock, and Redstring holding the same file open will fight it. To watch, open a copy, or one of the epoch snapshots.

## Files

| | |
|---|---|
| `src/druid/runDruid.js` | the loop (dependencies injected) |
| `src/druid/workingMemory.js` | note extraction, when to compact, budgets, the fallback note |
| `src/druid/recall.js` | memory index, spreading-activation recall, drift |
| `src/druid/druidPrompt.js` | the system prompt and the cycle/compaction messages |
| `src/druid/graphStateFromStore.js` | the agent's view of the store, shaped as the panel builds it |
| `scripts/druid.mjs` | CLI: headless store + universe file + local server |
| `test/druid/` | unit tests, the loop against a scripted turn, and an end-to-end run through the real agent loop, tools and store |

## Open directions

- **Retrieval is the bottleneck.** Recall is lexical, plus one hop of spread. Next steps, roughly in order of cost: two hops with decay; frequency/recency weighting stored on the graph itself (a Thing that keeps being useful gets easier to reach); embeddings from the local server (LM Studio already serves `nomic-embed-text`), used only as a cue-matching layer under the same graph spread.
- **Sleep.** A cycle type with no new thinking: consolidate. Merge duplicates, give orphans a home, open up a Thing that has gathered too many connections. It runs on epoch boundaries, when the context is empty anyway.
- **The note pointing into the graph.** The prompt asks for names rather than copies. Measure it: what share of the note's nouns resolve to Things?
- **Watching it live.** Redstring can't open the file the Druid holds. A read-only follow mode (reload on change) would let the canvas become the window into the mind.
- **Two Druids, one universe.** Each with its own note, sharing long-term memory. Does a shared graph converge on a shared vocabulary?
