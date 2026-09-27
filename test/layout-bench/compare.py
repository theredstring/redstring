"""Compare bench runs: per-config mean grade on the dev set (synthetic + committed
fixtures) and the held-out set (local real universes), plus per-case deltas."""
import json, sys
runs = [json.load(open(f'test/layout-bench/results/{n}.json')) for n in sys.argv[1:]]
def split(r):
    return 'holdout' if r['case'].startswith('chambers') else 'dev'
for run in runs:
    for cfg in run['summary']:
        rs = [r for r in run['results'] if r['config'] == cfg]
        out = []
        for part in ['dev', 'holdout']:
            g = [r['grade'] for r in rs if split(r) == part]
            if g: out.append(f"{part} {sum(g)/len(g):6.2f} (n={len(g)}, min {min(g):5.1f})")
        print(f"{run['label']:>14} {cfg:>14}: " + '   '.join(out))
if len(runs) >= 2 or len(runs[0]['summary']) >= 2:
    pairs = [(r['config'], r) for run in runs for r in run['results']]
    a_cfg, b_cfg = (runs[0], list(runs[0]['summary'])[0]), (runs[-1], list(runs[-1]['summary'])[-1])
    A = {(r['case'], r['seed']): r for r in a_cfg[0]['results'] if r['config'] == a_cfg[1]}
    B = {(r['case'], r['seed']): r for r in b_cfg[0]['results'] if r['config'] == b_cfg[1]}
    worse = sorted(((B[k]['grade'] - A[k]['grade'], k[0]) for k in A if k in B))
    print('biggest drops:', [(c, round(d, 1)) for d, c in worse[:5]])
    print('biggest gains:', [(c, round(d, 1)) for d, c in worse[-5:]])
