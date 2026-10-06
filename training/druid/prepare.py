#!/usr/bin/env python3
"""
Datasets for training the Druid's small model, from the teacher's labels
(scripts/druid-label.mjs).

    python training/druid/prepare.py --labels training/druid/data/labels/*.jsonl

Writes, under training/druid/data/:

    sft/train.jsonl, sft/valid.jsonl    chat examples: what the Druid showed the
                                        model, and the teacher's answer (kept only
                                        when the Druid's own checks passed it)
    grpo/train.jsonl, grpo/valid.jsonl  prompts for RL, with the call and its
                                        label, only for calls whose answers can be
                                        checked (lab/rewards.js CHECKABLE)

Held-out subjects (src/druid/lab/subjects.js EVAL) never enter a dataset; this
refuses to write one that holds any. Validation is split by subject, so it
measures subjects the model has not seen. No kind of call may be more than
MAX_SHARE of the examples: the yes-or-no helpers are asked far more often than
anything else, and a model trained mostly on them learns mostly them.
"""

import argparse
import glob
import hashlib
import json
import os
import random
import subprocess
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CHECKABLE = {'list', 'name', 'relationWords', 'relationSentence', 'choose', 'helper', 'scale'}
MAX_SHARE = 0.3
VALID_SHARE = 0.1


def subjects():
    """The subject lists, from the one place they are kept."""
    out = subprocess.run(
        ['node', '--input-type=module', '-e', "import('./src/druid/lab/subjects.js').then(m => process.stdout.write(JSON.stringify({ EVAL: m.EVAL, TRAIN: m.TRAIN })))"],
        cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def in_valid(subject):
    """A tenth of the training subjects, the same tenth every time."""
    h = int(hashlib.sha1(subject.lower().encode()).hexdigest(), 16)
    return (h % 1000) < VALID_SHARE * 1000


def cap(examples, key, rng):
    """No kind of call more than MAX_SHARE of the whole."""
    by = defaultdict(list)
    for e in examples:
        by[key(e)].append(e)
    total = len(examples)
    limit = max(1, int(MAX_SHARE * total))
    out = []
    for k, xs in by.items():
        rng.shuffle(xs)
        out.extend(xs[:limit])
    rng.shuffle(out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--labels', nargs='+', required=True)
    ap.add_argument('--out', default=os.path.join(HERE, 'data'))
    ap.add_argument('--seed', type=int, default=7)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    s = subjects()
    held = {x.lower() for x in s['EVAL']}

    rows = []
    for pattern in args.labels:
        for path in glob.glob(pattern):
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if line:
                        rows.append(json.loads(line))

    sft = {'train': [], 'valid': []}
    grpo = {'train': [], 'valid': []}
    dropped = Counter()
    for r in rows:
        subject = str(r.get('subject') or '')
        if subject.lower() in held:
            dropped['held-out subject'] += 1
            continue
        split = 'valid' if in_valid(subject) else 'train'
        rec = r['rec']
        target = r.get('target') or {}
        prompt = [{'role': 'system', 'content': rec['system']}, {'role': 'user', 'content': rec['user']}]
        if target.get('ok'):
            sft[split].append({'messages': prompt + [{'role': 'assistant', 'content': target['content']}], 'type': r['type']})
        else:
            dropped['no target the checks pass'] += 1
        if r['type'] in CHECKABLE and r.get('label'):
            grpo[split].append({
                'prompt': prompt,
                'type': r['type'],
                'max_tokens': rec.get('maxTokens') or 64,
                'rec': json.dumps(rec),
                'label': json.dumps(r['label'])
            })

    for name, data in (('sft', sft), ('grpo', grpo)):
        os.makedirs(os.path.join(args.out, name), exist_ok=True)
        for split, xs in data.items():
            xs = cap(xs, lambda e: e['type'], rng) if split == 'train' else xs
            with open(os.path.join(args.out, name, f'{split}.jsonl'), 'w') as f:
                for x in xs:
                    # mlx-lm reads {"messages": [...]}; the type is kept for the report.
                    f.write(json.dumps({k: v for k, v in x.items() if not (name == 'sft' and k == 'type')}) + '\n')
            kinds = Counter(x['type'] for x in xs)
            print(f'{name}/{split}: {len(xs)} · ' + ' · '.join(f'{k} {v}' for k, v in kinds.most_common()))
    if dropped:
        print('dropped: ' + ' · '.join(f'{k} {v}' for k, v in dropped.items()))
    # A last guard: no held-out subject in the RL prompts written (they carry the call and its subject).
    for name in ('grpo',):
        for split in ('train', 'valid'):
            with open(os.path.join(args.out, name, f'{split}.jsonl')) as f:
                for line in f:
                    rec = json.loads(line).get('rec')
                    if rec and str(json.loads(rec).get('subject', '')).lower() in held:
                        sys.exit(f'held-out subject in {name}/{split}: refusing')


if __name__ == '__main__':
    main()
