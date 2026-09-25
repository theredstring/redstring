"""Compare lifecycle traces view by view (P5.05a).

usage: python3 test/e2e/canvas/lifecycleTraceViews.py BASELINE_DIR FRESH_DIR [--no-panels]

The recorder's own check (compareTraces) fails on any combined state the
baseline lacks. Once state that used to be React state lives in a store, store
writes are sampled at new moments, so a combined state can be new even when
nothing on screen changed order. This compares the store fields and the DOM
facts separately: in each view, the fresh trace must be the baseline with
states removed. --no-panels leaves the control panels out of the DOM view (a
host can mount a panel one commit apart from the pie; compare each panel's own
sequence separately).
"""
import json,sys,os
DOM={'panels','pies','carouselLevels','carouselFocus'}
def view(trace, dom):
    out=[]
    for s in trace:
        v=json.dumps({k:s[k] for k in sorted(s) if (k in DOM)==dom}, sort_keys=True)
        if not out or out[-1]!=v: out.append(v)
    return out
def subseq(small, big):
    i=0
    for x in small:
        while i<len(big) and big[i]!=x: i+=1
        if i==len(big): return False
        i+=1
    return True
A,B=sys.argv[1],sys.argv[2]; bad=0
if '--no-panels' in sys.argv: DOM.discard('panels')
for n in sorted(os.listdir(B)):
    a=json.load(open(os.path.join(A,n))); b=json.load(open(os.path.join(B,n)))
    ok_store=subseq(view(b,False),view(a,False)); ok_dom=subseq(view(b,True),view(a,True))
    if not (ok_store and ok_dom): bad+=1
    print(f"{n:28s} store {'ok' if ok_store else 'NEW/REORDERED'}  dom {'ok' if ok_dom else 'NEW/REORDERED'}")
print('scenarios with a new or reordered state in either view:', bad)
