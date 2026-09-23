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

**D-12. Testing stack.** *Decided (Grant approved Playwright), 2026-09-23.*
- **Playwright:** browser interaction flows and perf scenarios.
- **vitest + jsdom:** unit tests and the render-contract smoke test.
- Mac trackpad, iOS/Android hardware and gamepad are covered by a manual device checklist, because they can't be automated faithfully.

**D-13. Nobody else edits `NodeCanvas.jsx` while agents are working on it.** *Proposed, 2026-09-23. Explained to Grant; stands unless he objects.*
- Grant doesn't hand-edit `NodeCanvas.jsx` during the refactor. Canvas feature ideas are either queued or built in the new structure.
- Why: the worry is merge conflicts, and edits to the file being taken apart are what cause them.
- If a change *must* touch `NodeCanvas.jsx`, log it in LOG.md so the Lane A task in flight can account for it.

**D-14. Parallel worktrees with an orchestrating session.** *Decided (Grant left it to Claude), 2026-09-23.*
- The orchestrating session starts agents in git worktrees:
  - at most one Lane A agent, which edits `NodeCanvas.jsx`, at a time
  - Lane B and Lane C agents in parallel when their files don't overlap
- The orchestrator is the only writer of the shared plan docs. Agents write `reports/<TASK-ID>.md` instead (see README → Parallel mode).
- Why: this is faster, and conflicts can only happen in small shared files (`package.json`, `App.jsx`), which the orchestrator resolves at merge time.
- Merging into `main`: the orchestrator does it only after verification, with Grant's permission to commit to `main`. It never force-pushes, and never merges while Grant has uncommitted changes to the same files.

**D-15. Fixtures: a real universe stays local; synthetic stress data is committed.** *Decided (Grant: "use Claude's Chambers"), 2026-09-23.*
- **Representative fixture ("chambers"):** a snapshot copy of `~/Documents/Redstring/Claude's Chambers.redstring`, stored at `test/fixtures/canvas/local/claudes-chambers.redstring`.
  - That folder is gitignored and **must never be committed**, because the repo is open source and this is personal content. Never quote its contents in docs, logs or artifacts.
  - Worktrees don't contain gitignored files. Reach it by the absolute path `/Users/granteubanks/Code/redstringuireact/test/fixtures/canvas/local/claudes-chambers.redstring`, or through `REDSTRING_LOCAL_FIXTURE`. Tests that need it **skip when it's absent** (CI won't have it).
  - Refresh the snapshot by copying the original again. Never modify the original.
- **Committed fixtures:**
  - **small:** smoke-test sized
  - **stress:** a synthetic ~600-node / ~1,000-edge graph with groups, produced by a deterministic generator script
- Why: the real universe is representative (F-66), but it's personal, 7.2 MB, and has no single large graph.
