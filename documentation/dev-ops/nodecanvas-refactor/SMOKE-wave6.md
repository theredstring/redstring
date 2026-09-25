# Smoke test: wave 6, the end of the refactor (everything since the wave-5 smoke test)

Branch `refactor/wave6`, based on `main` (wave 5), so one fast-forward:

```
git checkout main && git merge --ff-only refactor/wave6 && git push
```

This is the last of the refactor. NodeCanvas went from 12,190 lines to about 3,600. Almost everything it did now lives in its own piece, and most of those pieces re-render on their own instead of with the whole canvas.

Everything below passed the automated checks:
- the unit suite and the undefined-names check;
- 77 browser flows (four of them new this wave);
- the pie and carousel sequence checks in 17 scenarios;
- markup comparisons against wave 5 in 28 scenes.

This list covers what those can't reach: real devices, a game controller, AI features, feel and animation.

Items marked **★** changed the most, or nothing automated exercises them. The two **bug fixes** are behaviour you'll notice.

## Pie menu and carousel
1. **★ Bug fix: Back after cancelling Add Above/Below.**
   - Open the carousel on a node, press plus, then Add Above, then close the name prompt without naming anything.
   - Press Back. The carousel should close.
   - Before, it jumped to the Add Above/Below buttons instead, and you had to press Back twice more.
2. **★ Bug fix: the carousel reopens on its first buttons.**
   - Open the carousel, press plus, then press Escape. Reopen the carousel on the same node.
   - It should show the normal carousel buttons (Back, Swap, plus…).
   - Before, it reopened on Back / Add Above / Add Below.
3. **Carousel, the rest:**
   - scroll through levels;
   - Add Above / Add Below with a name;
   - Swap;
   - Expand (the hurtle into its definition);
   - Back, Escape and clicking away.
   Each should close with the pie coming back on the node.
4. **Carousel while switching webs.** Close the carousel and switch webs in the header straight away. It should finish closing normally. Its closing timer no longer restarts when the web changes.
5. **The axis controls on the carousel's bottom panel.** Change, add and delete an axis.
6. **Node pie menu:** every page and every button, including Swap (pick another Thing), Duplicate, Copy, Orbit, and Decompose and Compose.
7. **Connection pie menu:**
   - It appears when you select a connection, and the view frames it if it's off to the side.
   - Try delete, name, open definition, copy and paste, and the Wizard.

## Bottom control panels
8. **★ Panel timing.** Select a node and watch the pie and the node panel appear. The panel may now arrive a frame apart from the pie (these are 200–300 ms animations, so it should be invisible). If the two ever look out of step, note it.
9. **Node panel buttons, with one node selected and then several:**
   - delete (the shrink-away ghosts should play);
   - duplicate, copy, group;
   - Palette (with several selected it recolours all of them);
   - Orbit;
   - decompose, then compose.
10. **Group panel:**
    - ungroup;
    - rename (inline title edit);
    - colour;
    - convert to a Thing-group.
    With a Thing-group: dive into its definition, open in panel, combine, update the definition, refresh from it.

## Colours, prompts, dialogs
11. **Colour pickers.** Change a colour from each of these; each should apply live and close on click-away (a node's or connection's recolour undoes as one step):
    - a node's Palette (from the pie, the panel, and right-click → Color);
    - a defined connection's Palette;
    - a group's colour from the group panel.
12. **Name prompts:**
    - click empty canvas, then the plus sign, then a name: the plus morphs into the new node;
    - pick an existing Thing from the plus-sign prompt instead;
    - name a new connection;
    - name a Thing-group.
13. **★ AI name suggestions**, if you have a model configured:
    - a new connection's name field pre-fills with a suggestion;
    - Add Above/Below pre-fills with a more general or more specific name.
    Overwrite one and accept one.
14. **Dialogs.** Drag a node onto a group and release: "Add to Group?" appears, and Add puts it in. Draw a connection off a node and back onto it: "Self-referential connection?" appears.
15. **★ Ask The Wizard** from a node's pie, a connection's pie and the canvas right-click. The picker opens and remembers where answers go (new chat or current).

## Semantic orbit
16. **★ Orbit on a node.**
    - The rings fill in from the web, and hover previews a candidate.
    - Clicking a candidate places it with its connection.
    - Clicking the dimmed area, or deselecting the node, leaves orbit, and the node panel comes back.

## Groups (P3.04, B-17)
17. **Group titles:**
    - a click selects the group;
    - a double-click renames it (Enter keeps the name, Escape cancels);
    - press-and-hold drags the whole group.
18. **★ Touch.**
    - Tap a group title, and long-press to drag it.
    - **Bug fix B-17:** touching a group title while the view is still gliding after a pan used to throw an error and ignore the touch. It should now just stop the glide, like touching anywhere else.

## Welcome screen (B-03)
19. **Show Welcome Screen** (Help menu, or the Electron app menu) opens the "Welcome to Redstring" onboarding screen. Closing it with a universe open changes nothing. Before, it did nothing at all.

## Moving around, and every input device
20. **★ Mouse and trackpad.**
    - drag-pan with momentum;
    - wheel zoom by notches;
    - trackpad two-finger pan and pinch zoom with glide;
    - node drag (the drag-zoom out and back);
    - marquee selection;
    - drawing connections, including dragging near the edge so the view scrolls.
21. **★ Touch (phone or tablet, and the Capacitor app):**
    - one-finger pan and pinch;
    - long-press drag;
    - tapping nodes, connections and connection-end arrows;
    - the plus sign;
    - the pie menu.
    The touch input code was reorganised (the same code, handed its inputs differently), so a quick pass on each gesture is the check.
22. **★ Game controller.** Nothing automated drives one, so this is the only check. Everything should work as before:
    - crosshair aim and drift onto nodes;
    - A on a node, a group title, the plus sign and a connection-end arrow;
    - marquee;
    - node and group drag;
    - pie menu navigation;
    - the canvas context menu;
    - panel resize;
    - orbit.
23. **Keyboard:**
    - pan (arrows / WASD) and zoom keys;
    - Delete;
    - copy and paste;
    - undo and redo;
    - the panel toggles.
24. **Back to Civilization.** Pan far away from everything; after a moment the button appears, and clicking it brings the view back.
25. **Layout tools:** Auto Layout (and a Wizard-built web laying itself out), Snap to Grid, Condense, and the Force Simulation tuner while it runs.

## Look and feel
26. **Connections and labels** look as they did: every routing style, labels on curves, and the arrowheads.
27. **Speed.** Hovering across many connections and opening and closing the pie should feel at least as quick as before; in the measurements they are.
28. **Electron.** A quick pass of the above in the desktop app.

## What is deliberately not done (for later, with you)
- **Label placement changes** (making connection labels land in the same place every time): they move labels, so they wait for a session where you can look at them.
- **Rewriting the input code's control flow** (one gesture state machine for mouse and touch): it needs a pass on every device, so it's post-1.0.
