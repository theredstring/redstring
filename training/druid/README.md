# Training the Druid's model

The goal: a small, specialized model (about 1–2B parameters) that runs locally
and is very good at exactly what the Druid asks it. That covers naming the
parts of a thing, choosing a next step, saying how two Things relate, answering
yes or no, thinking in plain words, and talking honestly.

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
| 1. Baseline | `npm run druid:bench -- --mind openai --model <id> --out runs/base.json` | The numbers to beat, on 16 held-out subjects (`src/druid/lab/subjects.js` EVAL) |
| 2. Gather | `npm run druid:bench -- --split train --record data/calls/x.jsonl` | Runs the Druid over training subjects and records every call: prompt, schema and answer |
| 3. Label | `npm run druid:label -- --in data/calls/x.jsonl --out data/labels/x.jsonl` | The teacher labels each call. Use `--dry-run` first: it prints counts and cost and spends nothing |
| 4. Datasets | `python training/druid/prepare.py --labels 'training/druid/data/labels/*.jsonl'` | SFT examples and RL prompts, split by subject |
| 5. SFT | `MODEL=… sh training/druid/sft_mlx.sh` | LoRA on this Mac with MLX, loss on the answer only, then fused into a model LM Studio can load |
| 6. RL | `python training/druid/grpo.py --model … --adapter …` | GRPO with TRL, rewarded by `scripts/druid-reward.mjs` |
| 7. Judge | `npm run druid:bench -- … --out runs/cand.json` then `node scripts/druid-bench-compare.mjs runs/base.json runs/cand.json` | Use the new model only if it says USE IT |
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
and which menu option builds something correct and on subject. It does not
reward obedience. Taking up what a person asked is marked good, and finishing a
nearly done step is marked good too. How strongly the Druid weighs a person
against its own aims is its temperament, and that is not trained in
(`src/druid/conversation.js`).

## Decisions so far

- **Student:** a small open-weight instruct model, such as Qwen3-1.7B, compared
  against Qwen3-0.6B and against Qwen3-4B (already in LM Studio).
- **Teacher:** Claude through `ANTHROPIC_API_KEY`, Haiku-class by default
  (`--model` to change it). `--provider openai` takes any OpenAI-compatible
  endpoint instead.
- **SFT on this Mac with MLX.** GRPO with TRL; a CUDA GPU is best, but a model
  of 1–2B runs slowly on MPS.
- **Apple's on-device model** can't be trained with TRL. Apple's adapter
  toolkit trains LoRA adapters for it by example only. The route there is to
  distill this model's checked answers into an adapter, later.

## Waiting on

- **A teacher.** An API key with a spending cap. `--dry-run` shows the cost before anything is spent.
- **Disk space.** About 30 GB for the Python packages, model weights and checkpoints.
- **The student**, if a different one is wanted.

## Files

- `src/druid/lab/bench.js`, `subjects.js`: the benchmark and its subjects
- `src/druid/lab/rewards.js`: rewards (`rewardFor`, `rewardWithLabel`)
- `src/druid/lab/teacher.js`: the teacher's prompts, labels and targets
- `src/druid/lab/canaries.js`: hand-labeled probes
- `scripts/druid-bench.mjs`, `druid-label.mjs`, `druid-reward.mjs`, `druid-canary.mjs`, `druid-bench-compare.mjs`
- `training/druid/prepare.py`, `sft_mlx.sh`, `grpo.py`, `requirements-*.txt`
- `training/druid/data/`, `runs/`, `models/`: data and checkpoints (git-ignored)
