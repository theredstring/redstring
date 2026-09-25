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

**D-06. The edge element cache and imperative painter are not enabled now.** *Proposed, 2026-09-23.* **Amended (wave 6, P3.07): both deleted, before P3.06 rather than after.** They were off by default, the painter throws on component elements (so it can't coexist with a memoized `ConnectionEdge`), and the cache is a hand-rolled `React.memo` whose hits corrupted the dodge order. Markup with both flags off is byte-identical to `main` in 28 scenes (four routing styles × small at rest / node selected / edge hovered / edge selected, stress, chambers framed and zoomed out).
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

**D-16. Render-cause attribution.** *Proposed by the P0.01 agent, 2026-09-23.*
- Use a small dev-only helper that diffs store selectors and state between renders. Fall back to React DevTools' "record why each component rendered" for manual checks.
- Rejected: `@welldone-software/why-did-you-render`. Its current release needs React 19, and it patches React.
- Details are in `reports/P0.01.md`.

**D-17. "Show Welcome Screen" comes back (resolves B-03).** *Decided (Grant), 2026-09-23.*
- Keep both "Show Welcome Screen" menu items (the Help menu and the Electron app menu). Restore a real welcome screen for them to open.
- Build it as its own App-level host component, not inside `NodeCanvas.jsx` (D-13). Check the removed welcome modal (5d6e650) for what it showed.
- Until then, the dead `openOnboardingModal` listener in NodeCanvas stays. It gets rewired to the new host when that lands (P2.06c or a standalone card).

**D-18. Connection labels may stay put when a node is selected (Q6, unblocks P1.12b).** *Decided (Grant: "i don't think that's a big deal at all. that's fine."), 2026-09-25.*
- P1.12b may stop re-solving labels on selection (V1 + V2 in reports/P1.12a.md), even though labels then no longer shift on select.
- The "at rest" snapshots must stay identical.
- The "selected" snapshots get updated, and every "labels that moved" list becomes `[]`.

**D-19. Delete the panel focus plumbing; the DOM check guards panel fields (F-50, P2.04).** *Decided (orchestrator, within the P2.04 card's either/or), 2026-09-25.*
- `onFocusChange` went from NodeCanvas through Panel to `PanelContentWrapper`, which never called it, so `isLeftPanelInputFocused` / `isRightPanelInputFocused` were never true.
- Typing in panel fields was already kept from the canvas by the DOM focus check in `utils/textEntry.js` (F13 covers it). Wiring the flags up would have added a second mechanism for the same job.
- So the flags, their setters, `handleLeftPanelFocusChange` and every `onFocusChange` prop are gone. `selectIsTextEntryActive` is `isHeaderEditing` only: the header title editor is the one field that reports its focus.

**D-20. UI outside the canvas asks it to act through a command registry, not window events (P2.08).** *Decided (orchestrator, per the P2.08 card), 2026-09-25.*
- `src/utils/canvas/canvasCommands.js`: NodeCanvas registers named handlers with `useCanvasCommands` while mounted; callers use `runCanvasCommand(name, …args)`. An unregistered command does nothing and returns undefined.
- Why not callbacks as props: they tie the receiver's renders to NodeCanvas's. Why not new window events: they are global, untyped, and a grep for the handler doesn't find the caller.
- Existing window events (`redstring:open-federation`, `rs-navigate-to`, …) stay; new canvas actions use commands. State that isn't an action (open flags, selection) goes in a store, not a command.

**D-21. Smoke tests at phase ends only (or truly critical points).** *Decided (Grant: "i think i'm being offered to smoke test too much. i want to do this faster personally but idc how long you do it."), 2026-09-25.*
- Grant smoke-tests at the end of each phase, or when something can't be verified without him or needs his decision (e.g. P5.02a). Not at the end of each wave.
- Between smoke tests the orchestrator verifies each card itself (tests, Playwright, targeted perf, screenshots where visuals can change) and keeps going.
- `main` still moves only when Grant fast-forwards it after a smoke test.

**D-22. Edge selection lives in canvasUIStore (P2.03c; the D-04 note, P2.01 §3).** *Decided (orchestrator, following the P2.01 kickoff research), 2026-09-25.*
- Every edge-selection write through graphStore ran its middleware, including a debounced whole-universe clone and hash for the save worker, for state that is neither persisted nor bridged.
- `selectedEdgeId` / `selectedEdgeIds` move to canvasUIStore with Set equality. graphStore keeps the five action names as forwarding shims until callers migrate; its state no longer has the fields.

**D-23. Edge multi-select modifiers stay as they are (F7).** *Decided (Grant: "i don't really care about edge multi select i don't think we need it"), 2026-09-25.*
- Cmd/Ctrl-click adds a connection to the selection and Shift-click replaces it, as today. No work on it.

**D-24. Engineering questions are decided by the orchestrator, not Grant.** *Decided (Grant, 2026-09-25: "this is an entirely llm driven coding project in general so i don't even know much about it").*
- Constants, modifiers, code structure and implementation order are the orchestrator's call, recorded here with the reasoning. Grant is asked only about how Redstring looks or behaves, in plain words, batched into the final smoke list.
- Q5 (touch constants): keep the current values in each path. Nothing reported feels off, and reconciling them would change feel on some device.
- P3.05's questions: X1 (a stale one-render label layout after routing, size, font or rename changes goes away) is taken; it is invisible at rest. X5 (labels still dodge the old boxes of culled or deleted connections) keeps today's behaviour. Step 7 (anchor geometry as a real dependency) moves labels near node-groups once and goes on the smoke list if it lands.

**D-25. The pie/carousel lifecycle questions (P5.02a §8), answered under D-24.** *Decided (orchestrator), 2026-09-25.*
- Behaviour that is a design choice stays as it is: a click-away closes the carousel exactly like Back (A-6); the carousel may fade when the selection is lost without the pie shrinking first (A-4); control-panel Compose/Decompose keep skipping the pie's shrink/pop (A-7); teardowns keep cutting the abstraction panel (A-8).
- Losing the one-render `isVisible=false` blip on a retarget is fine (A-2): it is never painted.
- NEW-2 (Back after a cancelled Add Above/Below goes to stage 2) and NEW-4 (the carousel reopens in stage 2) are bugs; they are fixed as B-commits after the machine is wired, and go on the final smoke list.
- The carousel's exit/enter callbacks are stable, so its 200 ms exit timer no longer restarts on a web change (Q7).

