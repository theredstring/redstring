# Training Redstring's small model

The goal: a small open-weight model that runs locally and is very good at what
Redstring asks of it, in both of its roles:

- **The Druid** makes hundreds of tiny, structured calls: naming the parts of
  a thing, choosing a next step, saying how two Things relate, answering yes or
  no, thinking in plain words, talking honestly. Each is one JSON answer.
- **The wizard** builds webs on request with tool calls, many steps a request
  (its small-model tier: 9 tools, a compact prompt).

One process trains both, with no crossover. The roles never share a dataset,
and each trains its own adapter (LoRA) on the same base model, so the Druid
can't learn tool calling habits and the wizard can't learn the Druid's voice.
Each role is judged by its own benchmark.

## Why this can work

The Druid splits its thinking into hundreds of tiny, structured calls
(`src/druid/mind/createMind.js`). Most of them can be checked:

- **The code checks form and sense.** The Druid's own guardrails already reject
  bad names (positions like "Middle", qualities, aspects, sentences),
  off-subject parts, empty relations, repeats and ungrounded thoughts.
- **A teacher checks truth, once per prompt.** A strong model labels each
  recorded call with the right answers, acceptable alternatives, and the wrong
  answers a small model tends to give. Any later answer can then be scored
  against that label, without calling the teacher again.

That makes two training methods available:

- **Distillation (SFT):** learn the teacher's checked answers.
- **RL with verifiable rewards (GRPO):** practise until the checks pass.

What only matters across a whole run (staying on subject, turning when asked,
building coherently) is measured by the benchmark. The benchmark decides
whether a model is used.

## The pipeline

| Step | Command | What it does |
|---|---|---|
| 1. Baseline | `npm run druid:bench -- --mind openai --model <id> --out runs/base.json` and `npm run wizard:bench -- --model <id> --out runs/wizard-base.json` | The numbers to beat, per role, on 16 held-out subjects (`src/druid/lab/subjects.js` EVAL) |
| 2. Gather | `npm run druid:bench -- --split train --record data/calls/x.jsonl` and `npm run wizard:bench -- --split train --record data/wizard/x.jsonl --out runs/wizard-x.json` | Runs each role over training subjects on the local model (free) and records every call |
| 3. Label | `npm run druid:label -- --in data/calls/x.jsonl --out data/labels/x.jsonl --provider gemini` | The teacher labels the Druid's calls, only those training will use. `--dry-run` first: counts and cost, nothing spent. The wizard needs no labels: its examples are its own runs that passed its checks |
| 4. Datasets | `python training/druid/prepare.py --labels '…' --wizard-calls '…' --wizard-runs '…'` | `sft-druid/`, `grpo-druid/`, `sft-wizard/`, split by subject |
| 5. SFT | `ROLE=druid sh training/druid/sft_mlx.sh`, `ROLE=wizard sh …` | One LoRA adapter per role on this Mac with MLX, loss on the answer only, then fused into a model LM Studio can load |
| 6. RL | `python training/druid/grpo.py --model … --adapter …` | GRPO with TRL on the Druid's checkable calls, rewarded by `scripts/druid-reward.mjs` |
| 7. Judge | the role's benchmark `--out runs/cand.json`, then `node scripts/druid-bench-compare.mjs runs/base.json runs/cand.json` | Use the new adapter only if it says USE IT |
| Any time | `npm run druid:canary -- --model <id>` | 14 hand-labeled probes: a fast check for regressions and gaming |

Then repeat: gather again with the new model, label, and train. A model gets
better on the prompts its own runs produce.

## Against gaming the rewards

- **Gates, not sums.** An answer that fails to parse, runs over its word
  limit, or says the question back scores -1, whatever else is in it.
- **Saying little earns little.** "none", empty answers, positions and names
  copied from what is already there score below zero. One safe name earns
  almost nothing. A name the label doesn't know earns a quarter of a right one,
  so inventing names never beats naming the right ones.
- **The judge only grades.** Its answers are fixed labels, made once. The
  student never sees the judge, so it can't talk to it.
- **RL only on what can be checked.** Lists, names, relations, choices and
  yes/no calls. Free text (thoughts, descriptions, replies) is learned from
  examples only, because a judge scoring free text is the easiest thing to game.
- **A watch during RL** (`grpo.py`). It tracks, per kind of call, how often
  answers abstain, fail their format, or collapse to one answer per prompt. If
  any of these stays past its limit for 20 logs in a row, training stops and
  says so.
- **A KL pull** (beta) back toward the starting model.
- **Held-out subjects.** They are never labeled (`druid-label` refuses them)
  and never put in a dataset (`prepare.py` refuses them).
- **The benchmark decides.** A model must be no worse on every measure, and
  better on at least one.

## What the teacher judges, and what it doesn't

The teacher judges structure and truth: whether these are the parts of a crust,
whether a yes or no is right, which menu options would drift, repeat or build
something wrong. It does not lend the Druid its voice or its taste:

- **Choices.** Every option the teacher calls reasonable scores the same; only
  the bad ones score badly. Which reasonable option the Druid takes, and how
  strongly it weighs a person against its own aims, is its temperament
  (`src/druid/conversation.js`), and that is not trained in.
- **Voice.** Thoughts, the through line and speech are learned from the
  Druid's own recorded answers that its checks passed (`prepare.py` OWN), never
  from the teacher's wording. Training removes the failures (over the word
  limit, naming nothing here, claiming what it didn't do) and leaves the rest.

## Decisions so far

- **Student:** Qwen3-4B-Instruct-2507, the model already in LM Studio. At 1–2B
  the wizard's tool calling isn't realistic.
- **Teacher:** Gemini 3.8 Flash (`--provider gemini`, `GEMINI_API_KEY` in the
  repo's `.env`). A pilot against 3.5 Flash-Lite on the same 60 calls: 3.8
  Flash named a clock's parts right where Flash-Lite marked gears and pendulum
  wrong. `--provider anthropic` (Claude) and `--provider openai` (any
  OpenAI-compatible endpoint) also work.
- **SFT on this Mac with MLX.** GRPO with TRL; a CUDA GPU is best, but a model
  of 1–2B runs slowly on MPS.
- **Apple's on-device model** can't be trained with TRL. Apple's adapter
  toolkit trains LoRA adapters for it by example only. The route there is to
  distill this model's checked answers into an adapter, later.

## Where things are kept

Model weights, checkpoints, the Hugging Face cache and the Python environment
live on Grant's external SSD, inside an APFS disk image
(`Redstring Training/redstring-training.sparsebundle`, mounted at
`/Volumes/Redstring Training`; `env.sh` opens it). `models/`, `checkpoints/` and
`.venv` here are links into it. The SSD itself is exFAT, whose 1 MB blocks and
`._` sidecar files make a Python environment unusable directly on it. Gathered
calls, labels and datasets are small and stay in `data/`.

## Files

- `src/druid/lab/bench.js`, `subjects.js`: the benchmark and its subjects
- `src/druid/lab/rewards.js`: rewards (`rewardFor`, `rewardWithLabel`)
- `src/druid/lab/teacher.js`: the teacher's prompts, labels and targets
- `src/druid/lab/canaries.js`: hand-labeled probes
- `src/wizard/lab/bench.js`, `recorder.js`, `scripts/wizard-bench.mjs`: the wizard's benchmark and call recording
- `scripts/druid-bench.mjs`, `druid-label.mjs`, `druid-reward.mjs`, `druid-canary.mjs`, `druid-bench-compare.mjs`
- `training/druid/prepare.py`, `sft_mlx.sh`, `grpo.py`, `env.sh`, `requirements-*.txt`
- `training/druid/data/`, `runs/`, `models/`: data and checkpoints (git-ignored)
