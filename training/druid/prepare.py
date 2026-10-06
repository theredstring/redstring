#!/usr/bin/env python3
"""
Datasets for Redstring's small model, one per role: the Druid's, from the
teacher's labels (scripts/druid-label.mjs), and the wizard's, from its own
recorded runs that passed the wizard benchmark's checks (scripts/wizard-bench.mjs).

    python training/druid/prepare.py --labels 'training/druid/data/labels/*.jsonl' \
        --wizard-calls 'training/druid/data/wizard/*.jsonl' --wizard-runs 'training/druid/runs/wizard-*.json'

The roles never share a dataset. Each trains its own adapter on the same base
model (sft_mlx.sh ROLE=druid|wizard), so neither can pick up the other's
habits: the Druid's one-answer JSON calls and voice, the wizard's tool calls.

Writes, under training/druid/data/:

    sft-wizard/train.jsonl, valid.jsonl every call of a wizard run that built a
                                        web of its subject cleanly (GOOD_RUN):
                                        the messages and tools it was sent, and
                                        the reply it gave
    sft-druid/train.jsonl, valid.jsonl  chat examples: what the Druid showed the
                                        model, and the teacher's answer (kept only
                                        when the Druid's own checks passed it);
                                        for its voice and its choices, its own
                                        answer instead (see OWN)
    grpo-druid/train.jsonl, valid.jsonl prompts for RL, with the call and its
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
# The teacher grades structure and truth; it does not lend the Druid its voice
# or its taste. For these, an example is the Druid's own recorded answer, kept
# only when its checks pass it (and, for a choice, when the teacher did not
# mark it bad): training removes failures and leaves the personality alone.
OWN = {'thought', 'throughLine', 'speech', 'choose'}
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
    # The limit that leaves every kind at most MAX_SHARE of what remains
    # after the larger kinds are cut down to it.
    sizes = sorted((len(xs) for xs in by.values()), reverse=True)
    limit = sizes[0] if sizes else 0
    for i in range(len(sizes)):
        rest = sum(sizes[i + 1:])
        fair = max(1, int(MAX_SHARE * rest / (1 - MAX_SHARE * (i + 1)))) if MAX_SHARE * (i + 1) < 1 else limit
        if sizes[i] <= fair or i + 1 == len(sizes):
            break
        limit = fair
    out = []
    for k, xs in by.items():
        rng.shuffle(xs)
        out.extend(xs[:limit])
    rng.shuffle(out)
    return out


class Rewarder:
    """The Druid's rewards (scripts/druid-reward.mjs), in one node process."""

    def __init__(self):
        self.proc = None

    def score(self, rec, label, content):
        if self.proc is None:
            self.proc = subprocess.Popen(['node', 'scripts/druid-reward.mjs'], cwd=ROOT, stdin=subprocess.PIPE,
                                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.proc.stdin.write(json.dumps({'rec': rec, 'label': label, 'completions': [content]}) + '\n')
        self.proc.stdin.flush()
        reply = json.loads(self.proc.stdout.readline())
        if 'error' in reply:
            raise RuntimeError(reply['error'])
        return reply['rewards'][0]


REWARDER = Rewarder()


def own_target(rec, label):
    """The Druid's own answer as the example, when its checks pass it."""
    content = rec.get('content')
    if not content or rec.get('ok') is False:
        return {}
    return {'content': content, 'ok': REWARDER.score(rec, label, content) > 0}


def GOOD_RUN(m):
    """A wizard run worth learning from: it built a connected web of its
    subject, with names the guardrails accept, few failed tool calls, no
    error, and said what it did."""
    return (not m.get('error') and m.get('subjectWeb') and not m.get('refused') and m.get('things', 0) >= 4
            and m.get('connectedPct', 0) >= 50 and m.get('failedPct', 100) <= 20 and m.get('answered'))


def plain(content):
    """Message content as text: blocks joined, cache markers dropped."""
    if isinstance(content, list):
        return ''.join(b.get('text', '') for b in content if isinstance(b, dict))
    return content


def wizard_examples(call_globs, run_globs, held, dropped):
    """The calls of good wizard runs, as chat examples with their tools."""
    good = set()
    for pattern in run_globs:
        for path in glob.glob(pattern):
            with open(path) as f:
                for r in json.load(f).get('results', []):
                    if r.get('run') and GOOD_RUN(r.get('metrics', {})):
                        good.add(r['run'])
                    elif r.get('run'):
                        dropped['wizard run that did not pass'] += 1
    out = {'train': [], 'valid': []}
    for pattern in call_globs:
        for path in glob.glob(pattern):
            with open(path) as f:
                for line in f:
                    if not line.strip():
                        continue
                    c = json.loads(line)
                    subject = str(c.get('subject') or '')
                    if subject.lower() in held or c.get('heldOut'):
                        dropped['held-out subject'] += 1
                        continue
                    if c.get('run') not in good:
                        continue
                    reply = c.get('message') or {}
                    if not (reply.get('content') or reply.get('tool_calls')):
                        dropped['wizard call with no reply'] += 1
                        continue
                    req = c.get('request') or {}
                    msgs = [{**m, 'content': plain(m.get('content'))} for m in req.get('messages', [])]
                    answer = {'role': 'assistant', 'content': reply.get('content') or ''}
                    if reply.get('tool_calls'):
                        answer['tool_calls'] = reply['tool_calls']
                    ex = {'messages': msgs + [answer], 'type': 'wizard'}
                    if req.get('tools'):
                        ex['tools'] = req['tools']
                    out['valid' if in_valid(subject) else 'train'].append(ex)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--labels', nargs='*', default=[])
    ap.add_argument('--wizard-calls', nargs='*', default=[])
    ap.add_argument('--wizard-runs', nargs='*', default=[])
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
        if r['type'] in OWN:
            target = own_target(rec, r.get('label') if r['type'] == 'choose' else None)
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

    wizard = wizard_examples(args.wizard_calls, args.wizard_runs, held, dropped)
    for name, data in (('sft-druid', sft), ('grpo-druid', grpo), ('sft-wizard', wizard)):
        if not any(data.values()):
            continue
        os.makedirs(os.path.join(args.out, name), exist_ok=True)
        for split, xs in data.items():
            xs = cap(xs, lambda e: e['type'], rng) if split == 'train' and name != 'sft-wizard' else xs
            with open(os.path.join(args.out, name, f'{split}.jsonl'), 'w') as f:
                for x in xs:
                    # mlx-lm reads {"messages": [...]}; the type is kept for the report.
                    f.write(json.dumps({k: v for k, v in x.items() if not (name.startswith('sft') and k == 'type')}) + '\n')
            kinds = Counter(x['type'] for x in xs)
            print(f'{name}/{split}: {len(xs)} · ' + ' · '.join(f'{k} {v}' for k, v in kinds.most_common()))
    if dropped:
        print('dropped: ' + ' · '.join(f'{k} {v}' for k, v in dropped.items()))
    # A last guard: no held-out subject in the RL prompts written (they carry the call and its subject).
    for name in ('grpo-druid',):
        for split in ('train', 'valid'):
            if not os.path.exists(os.path.join(args.out, name, f'{split}.jsonl')):
                continue
            with open(os.path.join(args.out, name, f'{split}.jsonl')) as f:
                for line in f:
                    rec = json.loads(line).get('rec')
                    if rec and str(json.loads(rec).get('subject', '')).lower() in held:
                        sys.exit(f'held-out subject in {name}/{split}: refusing')


if __name__ == '__main__':
    main()
