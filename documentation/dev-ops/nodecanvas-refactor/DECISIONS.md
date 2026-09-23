# Decisions

This file records calls that nobody should re-argue mid-task.

**Statuses**
- **Decided (Grant):** Grant made the call.
- **Proposed:** Claude recommended it. It stands as the working decision unless Grant overrides it.
- **Superseded by D-xx:** replaced by a later decision.

**Adding a decision.** Use the next number. Include the date, who decided, the decision, why, and any alternatives that were rejected.

---

**D-01. The full refactor happens before 1.0.** *Decided (Grant), 2026-09-23.*
- This is one of the last real items before the official release.
- After the marketing push, the user base and the dependencies built on this code will grow, and the refactor gets harder and riskier.
- Rejected: doing only quick wins before 1.0 and the structural work afterwards (Claude's initial suggestion).

**D-02. This folder is the persistent plan of record.** *Decided (Grant) that the plan must persist across agents; location proposed by Claude.* 2026-09-23.
- The plan lives in `documentation/dev-ops/nodecanvas-refactor/`, in the repo. CLAUDE.md and AI_COMPENDIUM point here.
- Why in the repo:
  - It is versioned alongside the code it describes.
  - Every session, subagent and worktree sees the same copy.
  - Each task can update the docs in the same commit that changes the code.
- Rejected: a claude.ai doc, which is not visible from worktrees or subagents and not versioned with the code; and project memory alone, which is per-machine and may not load in worktrees.

**D-03. The primary metric is commits per interaction and milliseconds per commit.** *Proposed, 2026-09-23.*
- Measured by the P0 harness on a profiling production build (StrictMode doubles development renders, F-28).
- Line count is secondary, enforced by the size ratchet.
- Why: past efforts reduced lines without reducing renders (F-41).

**D-04. Shared UI state goes in a new zustand store, `src/store/canvasUIStore.js`, not graphStore.** *Proposed, 2026-09-23.*
- Why:
  - Every graphStore `set()` runs the SaveCoordinator middleware: history batching, Immer patches, `countUserData` twice, and save scheduling.
  - Selection, pie target, hover and similar state must never trigger saves or history.
  - `useImageCache` and `useHistoryStore` already set the precedent for separate stores.
- Edge selection (`selectedEdgeId(s)`) currently lives in graphStore. Whether it moves is decided in P2.03, **after checking whether the MCP bridge serialises it** (see the MCP rule in README).

**D-05. Hooks are not render boundaries.** *Proposed, 2026-09-23.*
- An extraction justified by performance must produce one of:
  - a component that subscribes to the store itself,
  - a store, or
  - a controller that isn't React.
- A hook that takes the parent's state and returns state is organisation only. Label it that way in the card and don't count it toward the perf criteria.

**D-06. The edge element cache and imperative painter are not enabled now.** *Proposed, 2026-09-23.*
- Revisit in P3.07, once edges are memoized components and label placement is deterministic. **The default outcome is to retire both, along with their window flags.**
- Why (F-23):
  - The cache key misses on select, settle and drag.
  - Label placement depends on order, so a cache hit changes what later labels dodge.
  - The painter still calls `renderConnectionEdge` for every edge.
  - The painter's native listeners change event semantics.

**D-07. Behaviour is preserved by default.** *Proposed, 2026-09-23.*
- A refactor commit does not change behaviour.
- Bug fixes are separate commits that cite a B-ID.
- If the intended behaviour is unclear (e.g. F-44, F-45), ask Grant and record the answer here.

**D-08. Rendering stays plain SVG/DOM.** *Decided (Grant, standing project philosophy).*
- No canvas or WebGL rendering.
- Performance comes from rendering less and doing less per render, not from switching render technology.

**D-09. Handlers given to memoized children must be stable.** *Proposed, 2026-09-23.*
- They must be referentially stable, read current values through refs (`useStableCallback`), and take an id as a parameter instead of being a closure per item.
- Why: Node's memo comparator deliberately ignores function props (F-24). Any handler that reads render-scope values goes stale without anyone noticing (B-05).

**D-10. Work lands trunk-based.** *Proposed, 2026-09-23.*
- Each task lands on `main` as small commits and leaves the app shippable.
- No long-lived refactor branch, because a branch of a 19k-line file diverges quickly. Short-lived per-task branches and worktrees are fine.

**D-11. New modules go in the existing folders.** *Proposed, 2026-09-23.*
- Stores → `src/store/`
- Hooks → `src/hooks/`
- Components → `src/components/canvas/` (`layers/`, `hosts/`, `pie/`)
- Pure logic → `src/utils/canvas/` (`input/` for the camera and gesture code)
- `src/NodeCanvas.jsx` stays where it is until P6. See MAP.md for the target tree.

**D-12. Testing stack.** *Proposed, 2026-09-23; waiting on Grant for Q3.*
- **Playwright:** browser interaction flows and perf scenarios.
- **vitest + jsdom:** unit tests and the render-contract smoke test.
- Mac trackpad, iOS/Android hardware and gamepad are covered by a manual device checklist, because they can't be automated faithfully.

**D-13. New canvas features go in new modules during the refactor.** *Proposed, 2026-09-23; waiting on Grant for Q1.*
- If a change *must* touch `NodeCanvas.jsx`, log it in LOG.md so the task in flight can account for it.
