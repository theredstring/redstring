# Smoke test: wave 5 (everything since the wave-4 smoke test)

Branch `refactor/wave5-integration`. It contains wave 4, so one fast-forward covers both:

```
git checkout main && git merge --ff-only refactor/wave5-integration && git push
```

Everything below passed the automated gates: unit suite, the undefined-names check, 58 Playwright flows, the build, and screenshot/markup comparisons against the previous build where visuals could change. This list covers what those can't reach: real devices and accounts, feel, and animation.

Items marked **★** changed the most, or can't be exercised by the flows at all.

## Start-up and layout (P2.11, P2.06c)
1. **★ Onboarding on a fresh profile** (new browser profile, or clear site data). Onboarding and storage setup appear, and finishing them leaves you in a universe.
   - Wrong: a blank canvas, no onboarding, or onboarding coming back.
2. **Reload with an existing universe.** The loading screen appears, then the canvas, with no flash of the "no universe" screen.
3. **★ GitHub reconnect modal.** With a git-linked universe whose auth has lapsed, the reconnect prompt appears and reconnecting works.
4. **★ OAuth / GitHub App redirect.** Start a GitHub connect; when the redirect lands back, the flow resumes instead of sitting idle.
5. **Save pill.** It still shows saving and saved.
6. **Layout.** Header, both panels, TypeList and canvas sit where they did. Check the landscape mobile shell too.

## Panels (P2.12)
7. **★ Drag both panel resizers.** Widths persist across reload, and focusing a node frames it inside the remaining space. If you use the gamepad resize, check it.
8. **Narrow window.** The panels overlay the canvas, as before.

## Modals, searches, tools (P2.06, F-78)
9. Help, Settings, Merge Duplicates and Auto Graph open and close from their menus.
10. Header search (this web / all things) and New Thing. Picking a result moves the camera to it.
11. The Force Simulation tuner opens, and auto-layout shows its progress.

## Selection and hover (P2.03, P2.13, bailout sweeps)
12. **Selecting nodes** by click, Cmd/Ctrl-click and marquee (the marquee extends an existing selection). The control panel appears and dismisses as before.
13. **Clicking a group title** opens the group panel. Renaming or recolouring the group elsewhere shows up in the panel.
14. **Edges.** Click and Cmd/Ctrl-click select edges. Deleting a selected edge clears it from the selection.
15. **★ Hover vision aid.** Hover a node, then a connection, then a header button: the aid shows each and doesn't flicker between near-tied connections.
16. **★ Semantic orbit.**
    - Open it on a node and hover candidates: the aid previews the triplet.
    - Click one: the node lands with its connection, and orbit exits.
    - **Bug fix B-16:** the placed concept and its predicate now appear in Saved Things. Before, they were silently un-bookmarked. The same goes for dropping a concept from the discovery panel onto the canvas, and for the panel's add.

## Pie menu and carousel (P5.01a, P5.04a)
17. **Node pie menu:**
    - every button, and the page chevrons;
    - the colour picker from the pie;
    - the bookmark toggle;
    - delete and edit;
    - decompose (package icon), then compose back.
18. **★ Carousel.**
    - Open it (layers) and scroll through the levels. The pie bubbles should hug the focused node as it grows and shrinks. **This is the one intended visual change:** they now track in the same frame instead of a frame behind, so it should look tighter, never jumpier.
    - Plus → Add Above / Add Below → name → the new concept joins the axis.
    - Swap, Back / Escape, and Expand (hurtle into its definition).
19. **Edge pie menu:** delete, name, colour, open definition, copy and paste the connection, and the wizard.

## Right-click menus (P5.07)
20. Right-click the canvas and a node. Check the items (they're pinned exactly by F12) and that they run: Auto Layout, Snap to Grid, Condense, Semantic Orbit, and so on.

## Moving around (P4.01, culling, long-press)
21. **★ Feel.**
    - Pan by drag, trackpad and touch; zoom by wheel, trackpad pinch and touch pinch. Momentum and glide should feel unchanged.
    - During fast pans, nodes should appear at the edges without gaps.
22. **Dragging.**
    - Node drag, and long-press lift on touch.
    - Group drag by long-pressing the title pill; drop a node into a group.
23. **★ Connection hover and click** in lombardi, manhattan and clean routing. The nearest connection wins, and hover holds steady on crossings.
24. **Back to Civilization.** Pan into empty space and the pill appears; clicking it brings the nodes back.
25. **Hurtle** into a definition graph from the panel and from the pie. The orb should be sized to the zoom.
26. **Node ↔ node-group.** Convert a node into a node-group. Double-click a group title to rename it; the tab should grow with the text.
26b. **Plus sign → pick an existing Thing** (not typing a new one). It morphs into that Thing, with its image if it has one.
26c. **Diving into a node-group's definition** from its control panel.
26d. **Wizard entry points** (Ask the Wizard from the pie, the edge pie and the canvas menu) open the right wizard surface.

## Grid, groups, deletion (P3.09, P3.03a, P2.07)
27. **Grid:** always, and while moving; lattice and dots; a size change; the grid inside node-groups.
28. **Groups:** plain, node-group and nested; rename, colour, drag. Connections into a node-group attach to its title pill.
29. **Deleting nodes** leaves brief ghost shapes that fade.

## Open, and yours to decide
- **B-03:** the Help menu's "Onboarding" item does nothing. D-17 says to restore a welcome screen, which needs your design call.
- **F7:** Cmd/Ctrl-click adds to the edge selection; Shift-click replaces it. Which is intended?
- **Waiting on you:** P3.05/P3.06 (label placement and the edge layer; label changes need your eye), P5.02a (the pie/carousel lifecycle design you review), and P4's device checklist plus Q5 (touch constants).
