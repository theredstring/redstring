// NodeCanvas's own renders, as distinct from the probe's commits (refactor P0.04).
//
// __renderProbe counts every commit under <Profiler id="NodeCanvas">, and that
// includes commits in which only a child rendered: the pie menu's animation,
// the panel, the carousel. This counts what NodeCanvas itself did:
//   ran      - the NodeCanvas function executed (all ~18k lines of it)
//   rendered - ...and React kept the result and reconciled its children.
// ran - rendered is render bailouts: the body ran, found nothing changed, and
// React threw the result away. They cost the body's time but no children.
//
// It uses the hook React DevTools uses. React calls
// __REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot after every commit, in
// production and profiling builds too, so this needs no app code. Install it
// with context.addInitScript(countNodeCanvasRenders) so it exists before React
// loads; then read or reset window.__nodeCanvasRenders.
//
// How a commit's NodeCanvas fiber tells what happened:
//   - same object as last commit: its subtree wasn't even cloned. Nothing ran.
//   - running the body rebuilds the hook list, so memoizedState differs from
//     its alternate's. Cloned without running, it's copied across.
//   - a body that rendered carries PerformedWork; a bailout doesn't. That's the
//     test DevTools uses.
// Renders thrown away mid-way (interrupted concurrent work) never commit and
// aren't seen. Cross-checked against a counter in the function body: equal.

export function countNodeCanvasRenders() {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return; // real DevTools attached: leave it alone
  const PERFORMED_WORK = 1;
  const PROFILER = 12;
  const counter = { ran: 0, rendered: 0, found: false };
  window.__nodeCanvasRenders = counter;

  const isNodeCanvas = (f) => !!f && f.return?.tag === PROFILER && f.return.memoizedProps?.id === 'NodeCanvas';

  // Child/sibling steps from root.current to the NodeCanvas fiber, found once.
  let path = null;
  const follow = (root) => {
    let f = root.current;
    for (const siblings of path) {
      f = f?.child;
      for (let i = 0; i < siblings && f; i++) f = f.sibling;
    }
    return f;
  };
  const find = (root) => {
    const stack = [[root.current, []]];
    while (stack.length) {
      const [f, p] = stack.pop();
      if (isNodeCanvas(f)) return p;
      let c = f.child;
      for (let i = 0; c; i++, c = c.sibling) stack.push([c, [...p, i]]);
    }
    return null;
  };

  let last = null;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject() { return 1; },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_rendererId, root) {
      let f = path && follow(root);
      if (!isNodeCanvas(f)) {
        path = find(root);
        f = path && follow(root);
      }
      if (!isNodeCanvas(f)) { last = null; return; }
      counter.found = true;
      if (f !== last && (!f.alternate || f.memoizedState !== f.alternate.memoizedState)) {
        counter.ran += 1;
        if (f.flags & PERFORMED_WORK) counter.rendered += 1;
      }
      last = f;
    },
  };
}
