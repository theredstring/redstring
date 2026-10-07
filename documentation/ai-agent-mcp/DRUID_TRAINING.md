# Training Redstring's small model

> Status: **built and paused, 2026-10-06.** The whole pipeline up to training
> itself is built and tested, and the first data was gathered and labeled. No
> model has been trained yet. Grant expects to leave this until after 1.0.0;
> this document is what you need to pick it up again.
>
> How to run each step is in [`training/druid/README.md`](../../training/druid/README.md).
> This document is the why: the decisions, what was measured, what went wrong
> on the way, and what is left. What the Druid is: [`DRUID.md`](DRUID.md) (v1)
> and [`DRUID_PLAN.md`](DRUID_PLAN.md) (v2, the one that runs now).

## The goal

One small open-weight model, run on the user's own computer, that is very good
at what Redstring asks of it, in both of its roles:

- **The Druid** (`src/druid/`) makes hundreds of tiny calls per run, each one
  JSON answer under a 4K window: name the parts of a thing, pick a next move,
  say how two Things relate, answer yes or no, think a sentence, talk to the
  person.
- **The wizard** (`src/wizard/`) builds webs on request with native tool calls,
  many steps per request. A local model gets its small tier: 9 tools and a
  compact prompt, about 9K tokens before the request.

## Grant's direction (the rules every choice below follows)

1. **One post-training process for both roles, with no crossover.** The Druid
   must not pick up tool-calling habits; the wizard must not pick up the
   Druid's voice.
2. **Guardrails in code, personality not.** We harden what is deterministic and
   do not train in a temperament. The Druid should listen to a person, but not
   as a robot that follows orders (see the project memory `druid-open-brain`).
3. **Save money.** A Gemini key with a $50 a month cap. Spend on the teacher only
   where training will use the result.
4. **Nothing on the internal disk that can go elsewhere.** It was 99% full.
   Big files go on Grant's external SSD.

## How the design answers them

**No crossover, by construction.** One base model, two LoRA adapters, one per
role, each trained only on its own role's examples (`prepare.py` writes
`sft-druid/`, `grpo-druid/` and `sft-wizard/`; `ROLE=druid|wizard
sft_mlx.sh`). Each role is judged only by its own benchmark
(`scripts/druid-bench-compare.mjs` refuses to compare across roles). What the
roles share is the subject lists (held-out subjects are held out for both) and
the naming guardrails (`badName`: no positions, qualities, doings, sentences as
Thing names). A single merged model was considered and rejected: it would need
a crossover test to prove what separate adapters guarantee.

**The teacher grades truth and structure, never voice or taste.**

- *Facts and naming* (parts lists, single names, relations, the yes-or-no
  helpers) are labeled by the teacher once per prompt: best answers, acceptable
  ones, and the wrong answers a small model tends to give. Any answer can then
  be scored offline (`rewardWithLabel`), so RL never calls the teacher.
- *Choices* (the menu of moves) are where the Druid's temperament lives. Every
  option the teacher calls reasonable scores the same (0.5); only options it
  marks bad (drift, repeats, building something wrong) score badly (-0.6).
  Which reasonable path it takes stays its own.
- *Voice* (thoughts, the through-line, speech) is learned from the Druid's own
  recorded answers that its checks passed (`prepare.py` `OWN`), never from the
  teacher's wording. Training removes the failures and leaves the voice.

**The wizard needs no teacher.** The local model runs the wizard for free;
only runs that pass the wizard benchmark's checks (`GOOD_RUN` in `prepare.py`:
a connected web of the subject, accepted names, at most 20% failed tool calls,
an answer at the end) become examples. This is rejection sampling: it can make
the model reliably as good as its best runs, not better. Going further would
mean RL on the wizard's outcomes, graded by the same truth labels.

**Label only what training uses** (`scripts/druid-label.mjs`). Own-voice calls
are skipped, and the yes-or-no helpers (58% of all calls) are labeled only up
to their 30% share of the training data, picked by hash so a resumed run picks
the same ones. This cut the labels needed by about 73%. `--all` labels
everything.

## What was measured

### The Druid's baseline: Qwen3-4B-Instruct-2507, 16 held-out subjects, 30 moments each

Saved in `training/druid/runs/druid-qwen4b-base.json` (git-ignored).

| Measure | Value | Reading |
|---|---|---|
| on subject | 100% | the code's guards already hold this |
| drift, positions | 0, 0 | same |
| Things per run, breadth, depth | 18.6, 3.9, 3 | |
| failed moves | 17.7% | **the main thing to improve** |
| ungrounded / daydream thoughts | 0.8% / 0.4% | |
| turned when asked, held after | 92%, 89% | the "polite" scenario on Octopus never turned to the Teapot |
| answered when spoken to | 96% | no invented claims |

So the deterministic work has already fixed drift and focus. What a trained
model can still improve is the quality of each answer: failed moves, weak
names, wrong yes-or-no calls, thoughts over their word limit.

### Where Qwen3-4B disagrees with the teacher (first 889 labels, 3 subjects)

| Kind of call | n | below zero |
|---|---|---|
| helper (yes or no, pick one) | 520 | 27% |
| choose | 103 | 17% |
| thought | 103 | 26% (mostly over 30 words) |
| sentence | 44 | 14% |
| list | 38 | 18% |
| name | 14 | 64% (questions or positions as names) |

Most helper disagreements were the teacher being right ("Axle" belongs in a
clock, a "Minute" is an idea). Some were arguable ("Edge" called an idea). The
helper labels are usable, with some noise.

### Canaries

`npm run druid:canary`: 14 hand-labeled probes, scored -1 to 1. Qwen3-4B
scores **0.75**. Its real misses: the parts of an empty Venus answered "No
parts. Empty. Only the web's silence", and "Sense of being inside" judged on
subject for Venus. Two canary labels were widened after seeing its answers, so
treat this as a sanity check, not the benchmark.

### Choosing the teacher

Pilot on the same 60 calls:

- **Gemini 3.8 Flash** named a clock's parts as face, hands, case, pendulum, gears.
- **Gemini 3.5 Flash-Lite** marked gears, spring and pendulum as *wrong*, and
  described the hour marks as "the short hand".

3.8 Flash was chosen. Gemini 2.5 Flash-Lite is closed to new accounts.

Price (until 2026-12-31): $0.75 per million tokens in, $3.75 out; batch mode
half that. **It doubles on 2027-01-01.** Usage so far: 1,346 labels for about
790K tokens in and 65K out, well under $1. All the Druid labels for 60
subjects should come to $3–6.

## Bugs the pipeline caught

- **The echo gate punished right answers.** "Says the question back" compared
  overlap against the shorter text, so picking "Tube, Lens, Mirror" out of a
  thought scored -1. It now counts as an echo only when most of the question
  is repeated, or a run of its instruction is copied word for word
  (`echoes` in `src/druid/lab/rewards.js`).
- **The Druid refused to name a microscope's "Stage"** as an aspect: `THINGS_TOO`
  in `src/druid/names.js`.
- **Scorer false negatives:** "White loaf" was matched against the wrong-list
  by a loose match (wrong-list matches are now exact), and "Mix" didn't match
  "Mixing" (a stem fallback).
- **The teacher sometimes packs a whole answer into one list entry**
  ("Numbers, hour markers, minute marks"); `tidy` splits these into names.

## Machine and storage

- **Mac:** M4 Pro, 24 GB, internal disk at 99% when this started. About 28 GB
  of it was swap built up over weeks without a restart; a restart gives it back.
- **The SSD is exFAT with 1 MB blocks.** A Python environment written straight
  onto it took 83 GB for 5.4 GB of files, and macOS's `._` sidecar files broke
  Python's imports. Everything therefore lives in an **APFS disk image** on it:
  `/Volumes/Grant's SSD/Redstring Training/redstring-training.sparsebundle`,
  mounted at `/Volumes/Redstring Training`, capped at 280 GB, grows as it
  fills. `training/druid/env.sh` mounts it; `models/`, `checkpoints/` and
  `.venv` in `training/druid/` are links into it.
- **Installed in it** (Python 3.12): mlx 0.32.3, mlx-lm 0.32.0, torch 2.14.1
  (MPS works), transformers 5.19.0, trl 1.14.2, peft 0.21.2. No model weights
  are downloaded yet.
- **Gathered data** stays small and in the repo, git-ignored:
  `training/druid/data/calls/` (recorded calls), `data/labels/`,
  `data/wizard/`, and `training/druid/runs/` (benchmark results and logs).

## Where it stopped

On 2026-10-06, still running when this was written:

1. **Druid gathering:** 60 training subjects × 25 moments on Qwen3-4B, about
   37 done (`runs/qwen4b-train-gather.txt`, calls in
   `data/calls/qwen4b-train.jsonl`).
2. **Druid labeling** by Gemini 3.8 Flash, which picks up the new calls when
   gathering ends (`runs/qwen4b-train-label.txt`).
3. **Then the wizard**, queued: Qwen3-4B reloaded in LM Studio with a 16K
   context, the wizard baseline on the 16 held-out subjects
   (`runs/wizard-qwen4b-base.{txt,json}`), then wizard runs on 40 training
   subjects recorded (`data/wizard/qwen4b-train.jsonl`,
   `runs/wizard-qwen4b-train.json`). **This is the wizard recorder's first real
   run**; it was only tested against a scripted model. Check its results
   before trusting them.

## Picking it up again

1. **Check what still holds.** The prompts the data was gathered on are the
   Druid's as of 2026-10-06. Labels are keyed to each prompt's hash, so if the
   Druid's prompts or moves changed since, gather and label again; old labels
   simply won't match. Check the Gemini model id still exists (ids get
   retired) and the price.
2. **Mount the disk** (`. training/druid/env.sh`) and make sure LM Studio's
   context is 16K for the wizard, 8K is enough for the Druid.
3. **Read the wizard results** from the overnight runs. If few runs pass
   `GOOD_RUN`, the wizard data is too thin to train on; loosen the gate, run
   more subjects, or have a stronger model run the wizard for the examples
   (costly: every step sends about 9K tokens).
4. **Build the datasets** (`prepare.py`), then **fine-tune each role's adapter**
   with MLX (`ROLE=druid` and `ROLE=wizard`), fuse, load in LM Studio, and run
   that role's benchmark. Use an adapter only if the compare gate says USE IT.
5. **RL second**, on the Druid's checkable calls only (`grpo.py`). On this Mac
   it will be slow for a 4B model; a rented GPU may be worth it.

## Open questions and risks

- **Student size.** Qwen3-4B was chosen because at 1–2B the wizard's tool
  calling isn't realistic. A Druid-only model could be smaller.
- **Apple's on-device model**, which the Druid runs on by default, can't be
  trained with TRL. Apple's adapter toolkit trains it by example only; the
  route there is to distill this model's checked answers into an Apple adapter.
- **Label noise** in the helpers and in which menu options are "bad". Labeling
  twice and keeping only agreements would cut noise, at twice the cost.
- **What only shows across a whole run** (staying on task, turning when asked,
  building coherently) is not in any single call's reward. Only the benchmark
  sees it, which is why the benchmark, not the reward, decides.
- **Free text is never rewarded by a judge**: a judge scoring free text is the
  easiest thing to game. It is learned from checked examples only.

## Anti-gaming, in one place

Gates before anything else (unparseable, over the word limit, or an echo
scores -1); a list scores by valid, new names, so "none", one safe name,
positions and copied names earn little or below zero; names the label doesn't
know earn a quarter; wrong-list matches are exact; RL only on checkable call
types; a watch in `grpo.py` stops training when answers abstain, break format
or collapse to one answer for 20 logs running; a KL pull to the starting
model; held-out subjects never labeled (`druid-label` refuses them) or put in
a dataset (`prepare.py` refuses them); and the benchmark decides.

## Files

| What | Where |
|---|---|
| How to run each step | `training/druid/README.md` |
| Druid benchmark, subjects (EVAL, TRAIN) | `src/druid/lab/bench.js`, `subjects.js`, `scripts/druid-bench.mjs` |
| Rewards, teacher, canaries | `src/druid/lab/rewards.js`, `teacher.js`, `canaries.js` |
| Wizard benchmark and call recording | `src/wizard/lab/bench.js`, `recorder.js`, `scripts/wizard-bench.mjs` |
| Labeling, reward bridge, compare gate | `scripts/druid-label.mjs`, `druid-reward.mjs`, `druid-bench-compare.mjs` |
| Datasets, fine-tuning, RL, storage | `training/druid/prepare.py`, `sft_mlx.sh`, `grpo.py`, `env.sh` |
| Tests | `test/druid/{bench,rewards,teacher,task}.test.js`, `test/wizard/wizardBench.test.js` |
