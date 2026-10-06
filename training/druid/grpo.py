#!/usr/bin/env python3
"""
RL for the Druid's small model: GRPO (Hugging Face TRL) on the calls whose
answers can be checked, rewarded by the Druid's own code.

    python training/druid/grpo.py --model Qwen/Qwen3-1.7B --adapter runs/sft/adapter --out runs/grpo-1

For each prompt the model answers several times; each answer is scored by
scripts/druid-reward.mjs (src/druid/lab/rewards.js: the Druid's guardrails as
gates, the teacher's label for truth); answers better than their siblings are
made likelier. A pull back toward the starting model (beta, the KL term)
keeps it from wandering off into whatever the rewards happen to like.

Against gaming, on top of how the rewards are shaped (see rewards.js):

    watched   every logging step reports, per kind of call, how often answers
              abstain ("none", empty), fail their format, or repeat their
              siblings word for word, and how long they are
    stopped   if abstaining or format failures climb past their limits, or the
              answers to a prompt collapse to one, training stops and says why:
              a model that learned to say nothing scores well on nothing
    judged    a checkpoint is used only if the benchmark on held-out subjects
              (npm run druid:bench, then druid-bench-compare) says it is better

Thinking: the Druid sends no thinking instructions, and a model that thinks
aloud before its JSON fails the format gate, so it learns to answer directly,
as it must when the Druid asks.
"""

import argparse
import json
import os
import re
import subprocess
import threading
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

ABSTAIN = re.compile(r'^\s*(none|nothing|n/?a|unknown|i don\'?t know)?\s*[.!]?\s*$', re.I)
LIMITS = {'abstain': 0.25, 'format': 0.30, 'collapse': 0.60}
PATIENCE = 20


class Rewarder:
    """The Druid's rewards, in a node process kept open for the whole run."""

    def __init__(self):
        self.proc = subprocess.Popen(['node', 'scripts/druid-reward.mjs'], cwd=ROOT, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.lock = threading.Lock()

    def score(self, rec, label, completions):
        with self.lock:
            self.proc.stdin.write(json.dumps({'rec': rec, 'label': label, 'completions': completions}) + '\n')
            self.proc.stdin.flush()
            reply = json.loads(self.proc.stdout.readline())
        if 'error' in reply:
            raise RuntimeError(reply['error'])
        return reply


class Watch:
    """What the answers look like, per kind of call, since the last log."""

    def __init__(self):
        self.reset()
        self.bad_steps = 0

    def reset(self):
        self.n = defaultdict(int)
        self.abstain = defaultdict(int)
        self.format = defaultdict(int)
        self.words = defaultdict(int)
        self.groups = defaultdict(int)
        self.collapsed = defaultdict(int)

    def see(self, kind, texts, rewards):
        self.groups[kind] += 1
        if len(texts) > 1 and len(set(texts)) == 1:
            self.collapsed[kind] += 1
        for t, r in zip(texts, rewards):
            self.n[kind] += 1
            if r <= -1:
                self.format[kind] += 1
            try:
                inner = json.loads(t)
                text = str(inner.get('text', inner.get('answer', inner.get('choice', ''))))
            except Exception:
                text = t
            if ABSTAIN.match(text):
                self.abstain[kind] += 1
            self.words[kind] += len(text.split())

    def report(self):
        logs = {}
        worst = {}
        for k in self.n:
            n = self.n[k]
            a = self.abstain[k] / n
            f = self.format[k] / n
            c = self.collapsed[k] / max(1, self.groups[k])
            logs[f'watch/{k}/abstain'] = a
            logs[f'watch/{k}/format_fail'] = f
            logs[f'watch/{k}/collapse'] = c
            logs[f'watch/{k}/words'] = self.words[k] / n
            worst = {'abstain': max(worst.get('abstain', 0), a), 'format': max(worst.get('format', 0), f), 'collapse': max(worst.get('collapse', 0), c)}
        over = [k for k, v in worst.items() if v > LIMITS[k]]
        self.bad_steps = self.bad_steps + 1 if over else 0
        self.reset()
        return logs, over


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True, help='a Hugging Face model id or path (the student)')
    ap.add_argument('--adapter', default='', help='a LoRA adapter to start from (the SFT one)')
    ap.add_argument('--data', default=os.path.join(HERE, 'data', 'grpo-druid'))
    ap.add_argument('--out', default=os.path.join(HERE, 'checkpoints', 'grpo'))
    ap.add_argument('--generations', type=int, default=8)
    ap.add_argument('--beta', type=float, default=0.04)
    ap.add_argument('--lr', type=float, default=2e-6)
    ap.add_argument('--steps', type=int, default=1000)
    ap.add_argument('--batch', type=int, default=8)
    ap.add_argument('--temperature', type=float, default=1.0)
    ap.add_argument('--max-completion', type=int, default=96)
    args = ap.parse_args()

    from datasets import load_dataset
    from peft import LoraConfig, PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainerCallback
    from trl import GRPOConfig, GRPOTrainer

    data = load_dataset('json', data_files={'train': os.path.join(args.data, 'train.jsonl'), 'valid': os.path.join(args.data, 'valid.jsonl')})
    rewarder = Rewarder()
    watch = Watch()

    def druid_reward(prompts, completions, rec, label, type, **_):
        """Each group of answers to one prompt, scored by the Druid's rewards."""
        texts = [c[0]['content'] if isinstance(c, list) else c for c in completions]
        out = [0.0] * len(texts)
        groups = defaultdict(list)
        for i, (r, l) in enumerate(zip(rec, label)):
            groups[(r, l)].append(i)
        for (r, l), idx in groups.items():
            reply = rewarder.score(json.loads(r), json.loads(l), [texts[i] for i in idx])
            for j, i in enumerate(idx):
                out[i] = reply['rewards'][j]
            watch.see(type[idx[0]], [texts[i] for i in idx], reply['rewards'])
        return out

    class Watching(TrainerCallback):
        def on_log(self, _args, state, control, logs=None, **_):
            extra, over = watch.report()
            if logs is not None:
                logs.update(extra)
            if watch.bad_steps >= PATIENCE:
                print(f'\nStopping: {", ".join(over)} past the limit for {PATIENCE} logs running. '
                      f'The model is learning to game the rewards; see watch/* in the logs.')
                control.should_training_stop = True

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype='auto')
    if args.adapter:
        model = PeftModel.from_pretrained(model, args.adapter).merge_and_unload()

    config = GRPOConfig(
        output_dir=args.out,
        num_generations=args.generations,
        max_completion_length=args.max_completion,
        beta=args.beta,
        learning_rate=args.lr,
        temperature=args.temperature,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=1,
        max_steps=args.steps,
        logging_steps=10,
        save_steps=200,
        report_to='none',
        bf16=True,
    )
    trainer = GRPOTrainer(
        model=model,
        processing_class=tokenizer,
        reward_funcs=[druid_reward],
        args=config,
        train_dataset=data['train'],
        peft_config=LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules='all-linear', task_type='CAUSAL_LM'),
        callbacks=[Watching()],
    )
    trainer.train()
    trainer.save_model(os.path.join(args.out, 'adapter'))
    print(f'saved {os.path.join(args.out, "adapter")}: now judge it with the benchmark (training/druid/README.md)')


if __name__ == '__main__':
    main()
