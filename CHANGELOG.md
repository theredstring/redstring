# Changelog

All notable changes to Redstring are documented in this file. Logs should be brief as possible.

Versions before 0.1.0-alpha were never released. They are numbered after the fact to mark milestones in development.

## [0.15.9] - 2026-10-09
### Added
- **Import an ontology.** File › Import Ontology… reads OWL, Turtle, N-Triples, TriG, JSON-LD, OBO Graphs and Wikidata exports, gzipped or not. Pick the roots and how deep to go, and it comes in as Things with their types, webs of their parts, kinds and connections. Each term keeps its IRI, so importing it again finds the same Thing. It can go into the open universe or a new one, and the Universes panel has New from Ontology… too. The command line has `redstring import`.
- **Backups.** A universe saved to a file leaves a copy on this device every ten minutes while you work, keeping the last ten and one a day. Restore one from History › Backups.
- **Choose when Redstring saves**, in the new Settings › Data: Adaptive, Always or Never. Adaptive, the default, stops saving on its own once a universe passes 5,000 Things and webs or 100 MB. When it isn't saving on its own, the save indicator offers Save, Cmd or Ctrl+S saves, and closing or switching universes asks first.
- **Settings › Data** also clears cached data and Discover history, and exports, imports or resets your settings. Repair Web Links moved there from Debug.
- **A zoom bar** on the canvas, at the bottom, left or right. It rests dimmed until you come near. Turn it off or move it in Settings › Display.
- **Blueprint canvas color** in Settings › Display.
- **Say which Discover result a Thing is.** A search from a Thing names it at the top, and a result's link button marks it as that Thing, so it's found as itself from then on instead of offered as a new Thing. Before there are results, Discover offers the Things on the active web to search from.
- **Drop a Thing on a connection to define it.** The connection lights up under the drag.
- **Double-click a Wizard or connection row's Thing** to open it in the panel.
- **Saved Things and All Things are one Library view**, picked from its title, and their Things have a right-click menu: Open Web, Open in Panel, Save or Unsave, Duplicate.

### Changed
- **Big universes save far faster** and never mid-pan. A save rebuilds only what changed, and a universe of 5,000 or more Things and webs is written compact, about a third smaller.
- **A universe synced to GitHub over 50 MB** keeps its older copy in the repository instead of failing to sync. An ontology import that would take it past that asks first, or offers a new universe.
- **Zooming on a big web animates instead of jumping**, when lifting or dropping a Thing and when framing the view.
- **The Wizard's entity rows stack their buttons under the drawing**, so narrow connections fit.
- **Edge glows hold to a panel's edge** while it's resized, and wait for it to finish sliding open.
- **To Current Web steps aside while the Open Webs list scrolls.**
- **The Android and iOS app ID is now io.redstring.app.**

### Fixed
- **A very large universe crashed the app every time it opened.** Files are now read and written in pieces, so a 500 MB universe opens.
- **Moving a Thing would select it on touch.** They don't do that now.


## [0.15.8] - 2026-10-08
### Added
- **Let the browser back into your files in one click.** On the web, when the browser has locked the workspace folder or a universe's file, a window names what's locked and asks for all of it at once, then loads the universe. Before, the canvas only said to grant access, with no way to do it.
- **The Open Webs list has a View menu**: one, two or three cards a row, or as many as fit, sorted by open order, name, most Things or color. It's kept on this device.
- **Drop onto the Open Webs list.** Drag a web's row or header tab to reorder it, or drop a Thing to open its web at that spot.
- **Middle-click closes a tab.** Header tabs and Wizard conversations ask first; right panel tabs close at once.
- **Drag from the Wizard and from connection rows.** Things a tool call made, pinned chips and the current web's chip drag onto the canvas or a web. A connection row in the panel drags onto the canvas too, the end it brings in landing where you let go.
- **Adding an "instance of" or "subclass of" connection asks first** whether its other end becomes the Thing's type, the connection, or both.
- **Open in Canvas and Open in Panel** on an open web's right-click menu. Double-clicking a web in the Open Webs list opens its Info tab.
- **A Tool Call Details setting** in Settings › Debug brings back the chevron with each call's arguments and raw result.

### Changed
- **The wheel and trackpad work while dragging**, so the Open Webs list and the header strip scroll mid-drag. Dragging near either end scrolls them too, with a bar showing where in the strip you are.
- **Open Webs cards and Web Definitions draw webs as the canvas does.** Only cards near the view draw their web, so long lists stay light.
- **Scrollbars match everywhere**: faint until you scroll or hover.
- **In Semantic Discovery the search scrolls with its results**, so a short panel isn't left with a sliver of list.
- **On a phone in landscape the hamburger menu wraps into two columns** instead of running under the footer.

### Fixed
- **The canvas grid vanished when zoomed out.** Its lines now keep their width at every zoom and fade as they crowd together.
- **Labels on bundled Lombardi connections slid off toward one end.** They now sit side by side at the middle.
- **Dragging a Thing in a group inside another group left the outer group's connections behind** until the drop.
- **Cmd or Ctrl with W, A, S, D or an arrow key panned the canvas.**
- **The desktop app's first Wizard request could fail** while its server was still starting.


## [0.15.7] - 2026-10-07
### Added
- **Apple Intelligence as a Wizard provider.** On an Apple silicon Mac, iPhone or iPad, Settings › AI offers Apple's on-device model: no key, and nothing leaves the device. It can chat about your universe but can't build or edit, since the Wizard's tools don't fit its window. The Druid can use it on iPhone and iPad too.
- **Pin Things to the Wizard's context.** Drag a Thing or a web's tab onto the Wizard, or pick one with Add Thing, and it shows as a chip beside the current web. Click a chip to take it out.
- **Wizard tool calls list what they made**, with buttons to open each one in the panel or as a web.
- **Choose a Thing's picture from its Wikipedia article.** The linked Wikipedia row in About shows the article's pictures. Pick any of them.
- **The type row has open and expand buttons**, like Web Definitions. A type opened this way gets the tab next to its Thing's.
- **Lifted Thing Shadow setting**: Off, Fast or Fancy. Fast, the new default, skips the blur so drags stay smooth. Fancy is the old shadow. Lifted groups get the fast shadow too.
- **Edge pan while box selecting.** The canvas pans when a selection box reaches the edge of the view. It can be turned off in Settings.

### Changed
- **Compacting a Wizard conversation leaves a divider in the transcript.** The messages above it stay. Open the divider to see the summary the Wizard reads instead.
- **The Wizard's context meter counts only what the next message sends.** Tool calls and their results are never resent, so they no longer count.
- **Side panels can't be dragged narrower than 180px.**

### Fixed
- **Dragging a group in a big web could make the web flicker out.**
- **Dragging a Thing slowed down when the drag zoom-out showed more of the web.** Connections the drag doesn't move now stay as they are.
- **The orb flying to a web opened from a panel button started under the panel.**
- **The connection panel came up empty for a connection inside an open Thing group.**


## [0.15.6] - 2026-10-06
### Added
- **The Druid, an early experiment, off by default.** A small model running on your own computer that builds in the open universe by itself while you watch and talk to it. It's in Settings › Debug, behind a warning: it isn't ready for real use yet.

### Changed
- **The Wizard copes better with small local models.** It repairs tool arguments sent in the wrong shape, and picks up tool calls written as plain text.
- **The Wizard lays a web out again once its Wikipedia pictures have loaded**, so Things that grew a picture no longer overlap.

### Fixed
- **Two Thing Groups with the same members drew one box twice**, with their titles on top of each other. One now sits inside the other.
- **Names from the Wizard could show "&amp;"** and other HTML codes instead of the characters they stand for.


## [0.15.5] - 2026-09-29
### Added
- **A Thing opens into its box, and a box folds back into its Thing, as one motion.** The card grows into the colored band with its title and definition carried along, instead of one shape swapping for the other. It's skipped when reduced motion is on.

### Fixed
- **On macOS the desktop app could lose its settings on the first launch after updating.** A Keychain prompt held up the settings move until it timed out. It now waits for your answer first.
- **Development builds prompted for the Keychain on every launch.** They now keep their own Keychain item.


## [0.15.4] - 2026-09-29
### Added
- **Refresh asks first.** Refresh in the header, the Redstring menu and the canvas menu confirms before reloading. It names any open webs that aren't bookmarked, since those are only kept while they're open, and says so when changes are still saving.
- **The Wizard asks before big removals.** Deleting a web, or deleting or merging more than ten Things in one reply, waits for your OK. Allowed changes undo in one step.
- **The Wizard asks once per AI provider** before its first request, saying what gets sent. Models running on your own computer never ask.
- **Report a Wizard response.** A flag next to Copy starts an email with the response attached.
- **Back in Semantic Discovery** returns from a concept's page to your results.
- **Open a .redstring file from the Files app on iOS.** It opens as a new universe and never replaces one you have.
- **Third-party license notices** ship with every build.

### Changed
- **The desktop app runs on a newer Electron.** The first launch after updating can take a few seconds longer while your settings move over. The 32-bit Windows build is discontinued.
- **Menu labels use title case**: Close Tab, Close All Others, Close All to the Right, Show More, Show Less.
- **On Android, universes live in the app's own storage.** Existing ones move over on first launch.
- **Loading a universe from a link needs an https:// address**, and so does a custom AI endpoint unless it runs on this computer.
- **Uploaded SVG pictures show as their thumbnail** on the canvas and in the panel. The SVG itself is kept.
- **The MCP server listens over HTTP only when started with `REDSTRING_MCP_HTTP=1`.** Claude Desktop connects as before.
- **`redstring auth github` asks for the token** instead of taking it on the command line. The old form still works.

### Fixed
- **Replies from Anthropic models didn't reach the Wizard**, which then asked the model again as if it had said nothing.
- **The Wizard dropped connections to Things it had made earlier in the same request.**
- **Wizard edits could blank a description or name** when the model left a field empty.
- **The Wizard called a new Thing wired only to an existing one "orphaned".**
- **A Wizard goal with a long field was rejected after the work was done.** It's now kept, with a note.
- **The Wizard couldn't remove a definition.**
- **A Thing wired to its own group's Thing drew its connection to the group's box** instead of the title pill, and the line vanished while it was dragged into the group.
- Things with a named color had no connection glow.


## [0.15.3] - 2026-09-29
### Added
- **Semantic Web connections for any Thing.** The right panel's Semantic Web scope and a concept's page in Semantic Discovery list what Wikidata and DBpedia say about it, in both directions. Each row adds the other Thing beside this one, links to it if it's already in the web, or shows a check that takes you to it.
- **Add all connections at once.** "Add all" brings in every connection in the list, or every one matching the filter. It says first how many Things it will place, and one undo takes them all back out.
- **Following a connection in Semantic Discovery opens that concept's page**, and Back returns. Pages you visit show in the discovery history.
- **Search in Merge Things.** One search filters all three bands, and "Merge all" merges only the pairs shown.

### Changed
- **Things from the semantic web get title-case names**: "Artificial Photosynthesis", not "Artificial photosynthesis", and "DNA" stays "DNA".
- **Semantic lookups find the right subject first.** The orbit, Semantic Discovery and the right panel settle which subject a Thing is from the links it carries before asking for its facts, so a lower-case Wikidata label no longer finds nothing and a shared name no longer mixes two subjects' facts.
- **The connection scope chooser** is an outlined pill with an icon for each scope, like the Universes header.
- **Connection rows go compact in a narrow panel** instead of cutting names to a few letters.
- A concept's description opens with a "Show more" pill, as Web Definitions does.

### Fixed
- **Switching right-panel tabs showed the previous Thing's picture for a moment.** The panel now shows a shimmer until the new picture is ready.
- **One concept added two ways could become two Things.** A concept is now found again by its URI whether it comes from the orbit, a drop, Semantic Discovery or the right panel.
- **Related results in Semantic Discovery were added linked to nothing.**
- **A GitHub universe over 1 MB could load a cached reply instead of the file.** It is now read by its SHA and checked before use.


## [0.15.2] - 2026-09-28
### Fixed
- **Web previews draw connections the way the canvas does.** The Open Webs list, definitions in the right panel and hover previews drew every connection straight. They now follow your connection style, with the same arrowheads, parallel pairs and self-loops.
- **Web previews show Thing groups.** A Thing opened in as a Thing Group showed as a single Thing in the previews. It now shows its definition's contents inside its box, and a connection into a closed box is drawn to the box, as on the canvas.


## [0.15.1] - 2026-09-26
### Fixed
- **Thing Group control panels.** Thing Groups updated for sync with web definitions wouldn't show their control panel persistently when clicked and had visual bugs.


## [0.15.0] - 2026-09-26

A long-procrastinated restructuring of code out of NodeCanvas.jsx, that had ballooned to over 20,000 lines! It sits now under 4,000. This is the last major update for Redstring before its official release.

### Added
- **Decompose opens a definition in place.** A Thing opens into a box holding its definition's own contents, not a copy, so what you change there changes the definition. To get the old copying group back, turn off Settings → Panels → "Decompose Into The Definition".
- **Definitions in the right panel.** A Thing's Web Definitions section lets you step through its definitions, add and delete them, and open any of them in its own panel tab or on the canvas. Delete asks first and says what goes with the definition.
- **Connections animate in and out** when you make or delete them, and the Thing you're drawing a connection to glows.
- **A Thing made with the plus sign inside a group is offered that group**, the same "Add to group?" a Thing dragged there gets.
- **Double-tap a description to edit it** on touch screens.

### Changed
- **Auto-layout tries several layouts and keeps the cleanest.** The new default, Best, tries force, tree, ring, chain, star and cluster layouts, nudges each until labels, lines and Things stop colliding, and keeps the one that draws best.
- **Big selections are cut, not shrunk.** The selection panel shows two rows of Things, or a few connections, at full size, and "+ N others" opens the full list. Copies of the same Thing show once, with a count. Each connection gets its own row.
- **The plus sign glides to where the Thing lands**, and a Thing with a picture grows with it from the first frame.
- **"Open Things" is now "Open Webs"**, and right-clicking it lets you close one web or all the others.
- **Saving is faster and says what it's doing.** An edit reaches the file in about 1.5 seconds, down from 3.5. The indicator reads "Saving..." until the file is written, or "Not saved" with the reason on hover. Switching webs no longer rewrites a GitHub universe on every click.
- **A universe linked to both a file and a repository loads faster.** It reads each copy once instead of twice, doesn't rewrite a local file that already matches, and compares the two copies off the main thread.
- **The Universes panel opens showing its last list** instead of flashing "Loading universes...".
- **Onboarding puts Local File above GitHub** and asks for the workspace folder before the name.
- **Dragging a Thing to the screen edge pans at the same speed** on 60 Hz and 120 Hz displays.
- **The canvas does much less work.** It was rebuilt in separate layers, so hovering, selecting, box-selecting, resizing panels, the carousel and edits in other webs no longer redraw the whole canvas.

### Fixed
- **A new universe made after a large one never saved.** The check against a sudden shrink still used the previous universe's size, so it refused every write. The universe read "Unsaved" until a reload, then came back empty.
- **Semantic concepts added to a web weren't saved**, whether they came from orbit, a drop or the discovery panel.
- **Cmd/Ctrl+Z did nothing after an auto-layout, a snap to grid or a force run.** Each one now undoes in one step.
- **Copying a selection that held a connection made by The Wizard or by an older file copied nothing.**
- **Saving to GitHub could fail on a conflict instead of retrying, and could clear your sign-in.**
- **Clicking a type in the Type list didn't change the type of the selected Things.** This was broken since the first release.
- **View → Snap to Grid and Grid → Lattice / Dot did nothing.**
- **Show Welcome Screen did nothing.**
- **Layout could put loose Things next to the wrong group.**
- **A Thing's Components list always showed its first definition.**
- **A Wikipedia picture could make its Thing grow square, collapse, then grow again** while it loaded.
- After a cancelled Add Above/Below, Back swapped the carousel to its second stage instead of closing it, and the next carousel could open on that stage.
- A Thing's menu could stay out of date: "Save" after saving, or pie buttons that ignored The Wizard or right-panel toggles.
- The group panel kept a group's old name and color after it was changed somewhere else.
- A box selection could select group title tabs, or bring back a rectangle that had just been cleared.
- A self-loop's arrowhead shrank while its Thing was dragged.
- The orb that flies from the panel to the canvas was the same size at every zoom.
- On a fresh install, the save indicator, edge glows and some dialogs sat 30 px off.
- Touching a group title while the view was still moving threw an error.
- A drag that ended while the zoom was being restored could make the next drag pan too fast.

## [0.14.4] - 2026-09-23

### Added
- **Reconnect to GitHub.** When a GitHub universe can't load, or loads without the GitHub App linked, a window walks you through signing back in and loads it again. Close it and the save indicator reads "Reconnect" (or "Link App").
- **A palette editor** in Settings → Debug.

### Changed
- **Connection labels stay put while you pan and zoom.** Fading them is now an option in Settings instead of the default.
- **A failed load no longer shows as an alarm-red error.** The card says nothing has changed and offers Reconnect when the universe comes from GitHub.
- Several palette colors were adjusted.

### Fixed
- **"Connected" could mean a sign-in GitHub had already revoked.** Redstring now checks with GitHub when the Universes panel opens, and clears a revoked sign-in.
- **Linking the GitHub App on the web could loop.** Redstring finds the App through your OAuth sign-in, so with that broken it sent you to install an App it could never see. It now asks you to reconnect OAuth first.
- **A Git universe with nobody signed in showed "Syncing..." forever.** Nothing was going to start the sync. It now shows Reconnect.

## [0.14.3] - 2026-09-23

### Fixed
- **The Wizard kept working in the background after a run ended**, freezing the panel and draining the battery while idle. This was the real cause of the lock-up 0.14.2 set out to fix.
- **Ask The Wizard in a new conversation could land in the old one.** The new tab was left empty, and The Wizard was given the previous conversation's last messages as if they belonged to the new question.

## [0.14.2] - 2026-09-21

### Added
- **Create New Thing.** The header's + button now asks what the new Web is about before opening it. Name a new Thing, or pick one you already have. Cmd/Ctrl+N does the same in the desktop app.
- **Export has its own window.** Each format says what it is for, and it exports the universe you picked rather than whichever one is open.
- **Undo and Redo buttons in the header**, and Undo and Redo in the desktop app's Edit menu. They undo your work, not just typing in a text box.
- **The eyedropper takes a controller.** The stick moves the sight, A takes the color, B backs out.
- **Redstring Guide and Welcome Screen are in Settings.**
- **Refresh** sits with the canvas menu in the header.

### Changed
- **A universe loads until it is done, instead of giving up after five seconds.** A loading screen holds the canvas, shows how long it has been waiting once that is worth saying, and offers a button to stop waiting. The load keeps going in the background either way.
- **Tabs run the full width of the header.** The logo appears only where the menu it opens does, and the buttons float over the tabs instead of pushing them aside.
- **The logo menu stands down on narrow screens**, at the same width the hamburger appears. Its submenus ran off the side of a small screen.
- **The eyedropper reads more of what is on screen**: gradients at the exact point you aim at, see-through layers stacked up, faded elements, text in its own color, and pictures pixel by pixel, including connection labels.
- **Two requests for the same universe share one read** instead of loading the same file twice.
- Stepping through a panel with a controller scrolls what you are on into view.
- A menu asked to open in the middle of the screen sits in the middle, rather than hanging down and to the right of it.
- Header buttons that cannot be used now look like it.

### Fixed
- **The app could lock up at the end of a Wizard run.** Clearing the finished plan wrote to the store in the middle of a render, which restarted the render, which wrote again. It also filled the console with hundreds of thousands of repeated lines.
- **An empty universe could still replace a full one on load.** The check counted the app's own starting Thing as your data.
- **A load that finished without producing anything left the loading screen up forever.**
- **Connection labels stopped shortening while a node was dragged**, so they held their old length until the drop.
- Redo (Cmd/Ctrl+Shift+Z) zoomed the canvas in, because Shift on its own is the zoom key.
- The eyedropper could not read pictures from the web at all, and answered with the color behind them.

## [0.14.1] - 2026-09-13

### Added
- **Fullscreen landscape on Android.** The header, the Type bar and the system bars step aside so the canvas gets the whole screen. Off / On / Adaptive in Settings, where Adaptive turns it on for phones but not while a controller is in use.
- **Dialogs take a controller**, and B closes the one on top.
- **The left panel's tab strip collapses when it runs out of room**, to the view you're in plus an ellipsis holding the rest.

### Fixed
- **An empty repository could still replace a full universe on sign-in.** The check counted the starting Thing as content, and missed a universe that lost its Things but kept its Webs.
- **"Saved" could show before anything had loaded.** It now needs something loaded this session, and a stalled write says "Unsaved".
- **Copying on Android said it worked when it didn't.**

## [0.14.0] - 2026-09-13

### Added
- **Game controller support.** Move around the canvas, work the menus, step through and resize the side panels, and use the pie and context menus from a gamepad. Sensitivity and buttons are in Settings.
- **Version history.** A universe saved to a repository now shows every earlier version it has had, and you can preview one and restore it. Restoring saves as a new version, so nothing is overwritten.
- **Recovery when a universe opens empty.** Redstring looks back through the saved versions, finds the last one that actually had things in it, and offers to bring it back.
- **Labels on connections.** Connections can carry their name on the line, with options for color and an outer ring, and long names shorten with an ellipsis. Labels fade out while you pan and zoom so movement stays smooth, and fade back in when you stop.
- **Off-screen glow.** Things outside the view glow at the edge of the screen so you can tell where the rest of the graph is. Four quality settings, including one that adjusts itself to the size of the web.
- **Ask The Wizard now asks what you want.** Instead of one fixed question per button, you pick from a short list of things to ask about that Thing, Connection or Web. The old question is pre-selected, so the familiar path is one extra click.
- **Goal mode for The Wizard.** Say what you want to end up with, and The Wizard keeps working and checking its own result against that goal instead of following a fixed plan.
- **Orbit works with a controller**, and hovering a suggestion previews the whole connection before you commit to it.

### Changed
- Universes and Semantic Discovery use context menus instead of dropdowns, so the same right-click gesture works everywhere.
- Dialogs across the app share one look, and long lists inside them fade at the edges so it's clear there's more to scroll.
- Group titles wrap onto more than one line instead of running off the side.
- Connections keep a gentle curve instead of collapsing to a straight line at close range.

### Fixed
- Building an abstraction ladder no longer adds a second copy of a type the Thing already has.
- "Refine this Connection" failed silently and never showed its chip.
- Warnings about unfamiliar files in a repository said less than they knew, and an empty universe could be written over a full one.
- Layout faults in The Wizard's picker, like rows overhanging the list and an invisible Cancel button.
- Touching the backdrop no longer moves the canvas underneath it.

## [0.13.0] - 2026-09-06

Merging: two universes into one, two Things into one. A guard on the file a universe writes, and an update to The Wizard that grounds what it builds with DOIs and abstraction chains.

### Added
- **Merge Things.** A duplicate scan sorts pairs by how sure it is: Certain (a shared Wikidata link, mergeable in bulk), Needs Review (a shared name) and Unlikely. A merge keeps what only the other Thing had, and undoes in one step.
- **Merge universes.** Everything from both comes through, and duplicates are settled afterward with Merge Things. A link from outside can merge into the open universe instead of making a new one.
- **A universe won't write an empty state over a file that has content**, and two universes can no longer share one file. Linking to a folder another universe uses asks first.
- **The Wizard finds real citations.** It looks DOIs up instead of making them up, and only links ones the registry recognizes.
- **The Wizard builds a whole abstraction chain at once**, instead of making the Things and failing to connect them.
- **Debug is a page in Settings**, opened by tapping About five times or from the logo's right-click menu.
- Trackpad pan glide has its own setting, and how far focus-on-select zooms is adjustable.
- Rename a universe in place, and right-click a right-panel tab for its menu.

### Changed
- **Trackpad zoom glide is one motion** from the pinch into the coast, with no pause before it glides.
- **Layout Scale works on nested groups.** Setting it lower could make a nested web bigger.
- **Nested groups are packed tighter.** A four-deep web drew at about 2.5 times the size of the same web without groups.
- **With several Things selected, the pie menu offers only actions that make sense for all of them.**
- **Panning while holding a Thing starts a connection**, as dragging off it does.
- Settings and Help share one look.
- Enrichment uses a link a Thing already has instead of searching its name again.
- A group's inside takes a faint tint of its Thing's color, and connections draw a little thinner by default.

### Fixed
- **Pinch zoom let the content drift out from under your fingers.**
- **Backspace in The Wizard's chat could delete the selected Things.**
- Two fingers landing on Things didn't zoom.
- Curved (Lombardi) labels slid off their arcs.
- Group title tabs were sized for about half their text.
- Duplicate scanning called related but different Things the same, like "Mario" and "Mario Kart".
- Building an abstraction chain could add "Company" beside an existing "Companies".
- Merging lost how closely each link matched, and scrambled abstraction chains.
- Right-panel tabs for deleted Things are cleared on load.

## [0.12.2] - 2026-09-01

Canvas performance and touch, plus an Android build.

### Added
- **Android app.**
- **A one-time prompt on the web to get the desktop app.** Use it or dismiss it and it's gone for good.

### Changed
- **Things off screen are skipped again while drawing**, so big webs pan and zoom faster, without the flicker that turned this off in April.
- **Touching the canvas while the view is still moving catches the view**, instead of grabbing the Thing under your finger.

### Fixed
- Dragging a Thing or pinching showed blank canvas until you let go.

## [0.12.1] - 2026-08-30

Connections get the actions Things already had, pictures stop bloating every GitHub save, and the color picker gets an eyedropper.

### Added
- **Pictures are stored as their own files on GitHub**, so autosaves stop re-uploading every photo. Thumbnails stay in the universe file, so it still opens offline, and older files work as before.
- **A Thing whose picture can't load shows a crossed-out image**, and the panel says why.
- **Palette, Copy and Paste on connections.** Copy takes the connection's definition, and Paste puts it on another connection.
- **An eyedropper in the color picker**, in every browser and the apps. Escape cancels.
- **Touch in the abstraction carousel**: drag, flick, tap to focus, double-tap to open, tap off to close.
- A haptic tick for each grid line you cross while dragging.
- Connection menus wrap into rows past five buttons.

### Changed
- **A file from a newer minor version opens** instead of being refused.
- **Separate clusters in a web keep a real gap between them.**
- **Curved (Lombardi) trees are drawn more compactly.**
- Concept search merges results about the same subject into one card.
- Zooming to fit leaves room for the bottom control panel, and no longer crops the name off a tall picture.

### Fixed
- Separate clusters could overlap and drop Things onto labels.
- Palette did nothing from the bottom control panels.
- Deleting a connection from its panel left the panel open.
- Swiping and tapping off the carousel didn't work on touch.
- Dragging a connection's color slider now undoes in one step.

## [0.12.0] - 2026-08-28

Two large pieces. The right panel gained an About section, saying what other systems call a Thing and where it came from. And undo now records everything by default, which finally put connection types, arrows, abstraction chains, groups and deletions on the timeline.

### Added
- **About.** A right-panel section for what the rest of the world calls a Thing and where it came from. Wikidata, Wikipedia and DBpedia each have a row showing that source's own description, so a wrong match is easy to spot.
- **Say how sure a link is.** Each link is Auto-Populated, Close Match or Exact Match, set from its menu, and exports that way. Redstring no longer writes `owl:sameAs`.
- **Info buttons** explain a control in plain words, right next to it.
- **Undo covers everything.** Connection types, arrows, abstraction chains, groups and deletions can be undone. A gesture that makes several changes undoes in one step, a typed name undoes as a whole, and undo takes you to the Web the change was in.
- **Concept search in Semantic Discovery.** It asks Wikidata, Wikipedia and DBpedia what a word could mean, keeping same-named results apart. A concept dragged onto the canvas fills itself in from the article you picked.
- **Things take the shape of their picture**, from wide to tall, and crop only past that.
- **The bottom control panel shows the pie menu's pages**, with arrows to turn them, so everything on the canvas menu is there too.
- A haptic bump for each Thing the abstraction carousel passes.

### Changed
- **Panels can be made narrower**, and their contents still fit.
- **Connection previews keep room for the connection's name** instead of letting long Thing names crowd it out.
- **The Semantic Web section holds only the RDF Schema view and class mappings.** Links moved to About.
- **The Catalog view in Semantic Discovery is off** until it's rewritten. It returned the wrong matches and could write test data into a universe.
- GitHub sign-in by code no longer opens the browser for you, so you can copy the code first. Each account row says which account it is.
- On a narrow screen, opening one panel closes the other from every place that opens it.
- Zooming to fit aims at the part of the screen you can see.
- Panel buttons grow on hover like pie menu buttons, delete buttons aren't red, and menu labels are title case.

### Fixed
- **Undo could break for good on one bad entry**, or block saving with "data shrank unexpectedly".
- **Undo history is cleared when you switch universes.**
- **Cmd/Ctrl+Z in a text field undoes typing again**, and Cmd/Ctrl+Y redoes.
- **Auto-enrichment wasn't saved** until some later edit.
- **Links could be lost on save and load**, and uploading a photo turned every link into an exact match.
- **A concept dragged in from discovery exported without its links.**
- **A panel picture showed the previous Thing's picture** while the new one loaded, and a deleted picture could come back after undo and redo.
- **Clicking an orbit item placed it away from where you clicked.** Orbit labels sat outside their Things on iOS, and orbit framing zoomed out forever.
- The abstraction carousel wouldn't close on touch, and froze its Thing.
- Things with pictures were all drawn square.
- Wikipedia identifier search didn't work, and DBpedia links pointed at the web page instead of the subject.
- Load More in Semantic Discovery ran the wrong search.
- Dismissing the connection control panel took two clicks, and a tapped panel button could fire twice.
- Panel cards were unreadable in dark mode.
- The bottom control panel showed the wrong size for a Thing.
- Connection labels in previews wrapped differently from the canvas.

## [0.11.2] - 2026-08-26

Orbit mode: what it cost to draw, how far out it threw its rings, and where it points the camera. The black-tile flicker blamed on the animation for several releases turned out to be one see-through rectangle.

### Added
- **Orbit frames itself** when it opens, and keeps fitting as results arrive, in the part of the screen you can see.

### Changed
- **Orbit rings stay close.** A long connection name used to push its ring, and every ring outside it, far out. Now only that item steps out.
- **Orbit labels are centered on the line you can see**, arrows stop at the item's edge, and hovering one connection fades the others.
- **The orbit animates smoothly again**, including while you pan and zoom.

### Fixed
- **Black tiles flickered in orbit mode**, worst when zooming into a crowded orbit.
- **Installing the GitHub App failed for new users** after the move to a new host.
- **Loose Things in a web with groups piled up in one spot.** They're laid out properly now, and a small cluster sits beside the group it connects to.
- **Arrowheads on curved connections sit on the curve**, and a curved connection no longer flexes when hovered.
- The pie menu comes back on the page it left from after orbit.
- The abstraction carousel stays on its Thing while the view moves.

## [0.11.1] - 2026-08-25

No app changes. This release re-ships the macOS build that 0.11.0 got wrong.

### Fixed
- **macOS downloads and auto-update from 0.11.0 were broken.** The update's checksums didn't match its files, so updates were rejected.

## [0.11.0] - 2026-08-25

### Added
- **Haptics on phones.** Lifting and dropping a Thing, finishing a connection, switching Webs and scrolling tabs each have their own feel. Off switch in Settings.
- **Fullscreen landscape on phones.** The header and Type bar step aside so the canvas gets the whole screen.
- **Tap a connection on touch** anywhere near it, not only right on the line.
- **The Wizard runs without a server.** The Wizard, enrichment and testing an API key all work in the browser with your own key.
- **The Universes panel opens instantly** from its last list, and doesn't download files that haven't changed.
- **Universes reconnect when you link a workspace folder**, without a reload.
- A count that isn't known yet shows as "?", not 0.

### Changed
- **Tap to select is 250 ms faster.**
- **Touch selects a connection when you lift your finger**, so a pan that starts on a line doesn't select it.
- **The Wizard's small helper calls stay off cloud models** unless you turn them on, so they don't cost you money.
- Connection previews look the same everywhere they appear.
- Names that only just fit no longer wrap to a second line.
- On iPhone, the layout respects the notch and home bar.
- The repository picker and storage setup window were tidied.
- New app icon.

### Fixed
- **Webs The Wizard made weren't laid out**, and stayed at random positions.
- **An API key saved over a non-secure address was scrambled.**
- **The iOS app asked to be set up on every launch.**
- **Universe counts in the repository lists read 0** for every file.
- A selected connection's end dots stayed behind while you dragged a Thing.
- Testing an API key failed when no server was running.
- Tapping the Web you're already in no longer gives feedback.

## [0.10.2] - 2026-08-21

### Added
- **An iOS app.** Universes are kept inside the app, so there's no folder to pick, and a lost link is rebuilt as long as the file is there. Saves finish before the app is put away, GitHub sign-in uses a code, and the app talks to no server unless you set one.
- **Layout Scale works on pattern layouts** (Lombardi, Manhattan and Clean), not only force.

### Changed
- **Connection labels curve again** on ordinary webs, with less wobble. Labels that look straight when zoomed out are drawn straight.
- **Curved (Lombardi) layouts give labels the right amount of room.**
- **Wikipedia enrichment rejects poor matches** instead of accepting any direct hit.
- **The Wizard asks which Thing you meant** when a name is ambiguous, instead of guessing, including before it deletes.

### Fixed
- **Nested groups scattered across the canvas.**
- **Groups landed up and to the left of their place**, overlapping their neighbors.
- **Group title tabs drifted and piled up.**
- **Ambiguous Wikipedia names ("Mercury", "Java") failed to enrich.**
- One Thing without a name stopped a whole enrichment batch.
- The app kept trying to reach a server that wasn't there, and uploaded your universe to it.

## [0.10.1] - 2026-08-07

### Added
- **Live model lists.** The model picker fetches each provider's current models, newest first, with a Refresh button, instead of a fixed list that went stale.
- **The provider list marks which providers already have a key.**
- **Laying out a web with groups gives the same result every time.**

### Changed
- **Routing style works on webs with groups.** Lombardi, Manhattan and Clean used to fall back to force layout if a web had even one group.
- **Long chains coil into a spiral** instead of a circle, and short ones lie flat. Connection names get more room along the line.
- **The Wizard accepts more of the ways small models write graph specs**, and says what it got when it can't use one.
- **The Wizard's edits re-run layout.**
- Curved layouts keep their shape while they're refined.

### Fixed
- **Things could end up inside groups they don't belong to.**
- Connections between groups get room for their names, and group title bars no longer overhang the next group.
- Choosing "Custom..." in the model picker snapped back.

## [0.10.0] - 2026-08-07

### Added
- **Groups inside groups.** A decomposed Thing can hold another decomposed Thing, all editable on one canvas. Adding a Thing to an inner group adds it to every group around it, and nesting survives decompose, combine, moves and saves.
- **Update Definition and Refresh From Definition** in a group's control panel write the group into its definition, or reload it from there.
- **Decompose works on a Thing with no definition yet**, opening an empty box you can drag Things into.
- **The Wizard builds nested compositions**, checks what it built for problems like everything hanging off one Thing, and can set sizes as it goes.
- **Trackpad zoom glide**, with a Zoom Glide switch and strength in Settings.
- **Long Wizard conversations are compacted** so they stop growing without limit.

### Changed
- **Connection labels are drawn letter by letter along the curve**, faster and more accurately, and keep their shape as you zoom.
- **Labels stay on their curve** and move only to avoid real overlap.
- **Panning and zooming are faster.**
- **Layout knows which way arrows point**, so hierarchies are laid out as hierarchies.
- **The Wizard finds Webs by name** instead of failing on an old id.

### Fixed
- **Applying a composition twice duplicated Things.** It now reuses the ones already there.
- **Wizard steps could show "Running..." forever.**
- Decomposing could create a duplicate group, and Webs could be open twice.
- Wizard messages could appear twice.
- Web previews now match the canvas.
- Group titles overflowed narrow groups.
- Curved labels froze or jumped sides while you dragged.
- Combining an empty group moved its Thing to the origin.
- Invisible leftovers from lost groups are cleaned up.
- The abstraction carousel could freeze mid-snap, and deleting a Thing from it lost your place.
- The control panel could open and close at once over a group.
- A Thing's description could cut off its last line.

## [0.9.6] - 2026-08-05

Tagged but not published on its own. Most of its changes are listed under 0.10.0, which was the first release to ship them.

### Changed
- **A decomposed Thing keeps the Thing's name and color.** Renaming or recoloring the group renames or recolors the Thing everywhere, and changing the Thing updates every group made from it.

### Fixed
- **Decomposing one copy of a Thing could open a different copy**, and decomposing it again stacked a second group on the first.

## [0.9.5] - 2026-08-04

### Added
- **Lombardi routing** joins Straight, Manhattan and Clean. Connections are circular arcs spread evenly around each Thing, with labels that follow the curve and an Arc Curvature slider. Every routed style keeps parallel connections in their own lanes and clear of Things.
- **Auto-layout recognizes shapes.** Chains, cycles, stars, trees and hierarchies each get a tidy layout of their own, and force layout is kept for the rest.
- **Layout runs in the background**, with a progress bar and Cancel.
- **Layout settings are remembered** between sessions.

### Changed
- **Connection labels avoid crossing other connections**, and stay steady while you drag.
- Panning and zooming do less work.

### Fixed
- Connections on the same side of a Thing no longer share one attachment point.

## [0.9.4] - 2026-07-26

### Added
- Sync Diagnostics shows when saving is paused for a load, and a load that never finishes is caught.

### Fixed
- **A slow load could be saved over.** On a slow connection, saving could start before the universe finished loading and overwrite it. Nothing is written now until the load is done, and edits made meanwhile are kept.
- **A returning device could skip the check against saving an empty universe.**
- **Selected connections show the same end dots as hovered ones**, and the dots follow a dragged Thing.

### Security
- Patched **CVE-2026-0621** (dependency vulnerability).

## [0.9.3] - 2026-07-25

### Added
- **Pinch-zoom glide**, adjustable in Settings.
- **Focus-on-select** zooms onto a Thing when you select it, if you turn it on.
- **HEIC photos from iPhones upload.**
- **A shimmer while a picture loads**, instead of an empty Thing.
- Connection end dots can be toggled by touch.

### Changed
- Pinch gestures are read more reliably on iOS.
- Stopping a pan glide no longer stops a zoom glide, and the reverse.

### Fixed
- The hover dot now shows on selected connections.

## [0.9.2] - 2026-07-24

### Security
- Patched **CVE-2025-66414** (dependency vulnerability).

## [0.9.1] - 2026-07-24

### Added
- **Pie menu pages**, with arrows, so a Thing with many actions isn't crowded.
- **Swap** in the pie menu points a Thing at another existing Thing, or a new one, in place.
- **Copy and Add Image** in the pie menu.
- **Each copy of a Thing can have its own size.**
- Zoom limits adjust to the web.

### Changed
- Resizing Things and hover previews is smoother, and selection outlines stay even at every zoom.
- One hover preview size setting covers everywhere.
- Pie menu pages animate as they turn.

### Removed
- The browser storage option in setup.

## [0.9.0] - 2026-07-23

This release changes how Things are drawn, how you enter Redstring the first time, and how The Wizard works, especially with local models.

### Added
- **Onboarding creates your first universe.** New users no longer start in a preloaded empty universe. Onboarding asks where to save it (a file on this device, a GitHub repository, or both) and creates it there.
- **Connect GitHub during onboarding.** Sign in, install the GitHub App (Redstring notices on its own) and pick or create a repository without leaving the window. In the desktop app you sign in by entering a short code on GitHub.
- **See what The Wizard is thinking.** Models that reason before answering show that reasoning in a collapsible block, and the notes Redstring sends the model to keep it on task ("your plan isn't finished") show as small notes in the conversation.
- **Ask The Wizard while it's working.** New asks wait in a queue and run in order, in the tab they came from. Three failed asks in a row pause the queue. Right-click a tab to close it, the others, or those to its right.
- **Token counts and limits for The Wizard.** Each reply shows the tokens it used. Settings sets how many steps a turn may take, separately for local and cloud models, and an ask that reaches its token budget stops until you say "continue".
- **More size settings.** Sliders for Node Size, Plus Sign Size, Pie Menu Size, Connection Width and connection Label Size, and a Multi Connection Curve slider for how far several connections between the same two Things bow apart.
- **Grid options.** Choose a lattice or dot grid, snap everything to it with View → Snap to Grid, and choose whether auto-layout snaps to it.
- **Things lift when you grab them and settle when you drop them**, and deleted Things shrink away instead of vanishing.
- **Naming a connection can set its arrow.** With a model set up, a label like "causes" points the arrow the right way, unless you've already chosen a direction.
- **Headless mode and a command line.** The `redstring` command runs your universes without a browser: create and switch universes, add graphs, Things and connections, search, export, and pull or push universes kept on GitHub. `redstring init` walks through first setup.
- **AI tools can work without the app open.** The MCP server works against headless Redstring directly, and when the app is open too, the two stay in sync.

### Changed
- **Things are drawn larger**, with bigger names. Font Size and Line Spacing now resize a Thing's text right away.
- **Auto-layout animates** Things to their new places and zooms to fit. It keeps ungrouped Things out of groups and gives groups more room, and webs The Wizard builds in the background are laid out before you open them.
- **Connection labels wrap, resize and truncate** to fit their connection, and arrowheads are larger.
- **The Wizard works better with small local models.** It runs them at a lower temperature, recovers tool calls they write out as plain text, keeps its plan with the conversation, stops re-planning in circles, and shows the model a working example when a step fails.
- **The Wizard builds more structured webs.** It can define each member of a new web, set up abstraction chains, match a web's naming style and suggest groups for dense clusters.
- **The Wizard's connection status is live.** It checks every few seconds instead of trusting the last result.
- The connection control panel is on by default, hover previews appear faster, and Semantic Orbit no longer flickers while you zoom.

### Fixed
- **Choosing a folder that already holds a universe loads it** instead of overwriting it with an empty one, and a new universe never takes a file name already in use.
- **Switching universes could write one universe's data into the other's file.**
- **A universe could show as unlinked after a restart.** A file that was briefly unavailable could also make Redstring forget every linked file.
- **GitHub sync failed after an hour** in a long session, and a push could overwrite changes another device had just made. Redstring now asks which copy to keep.
- A web's color and picture were lost on every save.

### Security
- **API keys and GitHub tokens are encrypted** in storage instead of kept in near plain text.
- Formatted text in The Wizard's messages is sanitized before it's shown.

## [0.8.2] - 2026-06-25

### Added
- **Clicking a connection opens a pie menu.** Delete, Define, Open Definition, Open in Panel and Ask The Wizard sit in a row along the connection. When there isn't room on screen, they fold into one "..." button that opens a menu.
- **Choose when the bottom control panel appears.** Settings → Display → Control Panels has a switch for each case: one Thing, several Things, a connection, a group, and the abstraction carousel.
- **Lift Delay** (Settings → Input → Dragging) sets how long you hold a Thing before it picks up for dragging. The hold on touch screens scales with it.
- **Trackpad Zoom Sensitivity and Pan Sensitivity** in Settings → Input.

### Changed
- **Ask The Wizard, for a Thing with no definition yet, moved to the right panel** from the bottom control panel.
- Pinching on a Windows precision touchpad now zooms, as it does on a Mac trackpad.
- The bottom control panel can be swiped away in either direction.

### Fixed
- **A fresh install could skip onboarding.** An empty placeholder universe counted as one you had set up.
- **Decompose Further froze the app** when the Thing's definition was the Web you were in.
- **On touch screens, a small wobble while holding a Thing started drawing a connection**, and a Thing jumped a few pixels when it was picked up.
- Clicking empty canvas right after a pan didn't deselect or dismiss the plus sign.
- Connections to a decomposed Thing pointed at its top instead of its middle.
- Background colors in The Wizard's API key setup and in Settings didn't match the theme.

## [0.8.1] - 2026-06-25

### Added
- **Decomposed Things have their own pie menu**, with Open, Add, Delete, Decompose Further and Compose, and arrows to step through definitions. It replaces the buttons drawn on the Thing.
- **The Wizard keeps separate conversations for each Web.** Opening a Web switches to its latest conversation, or starts one, so a parent Web's tabs no longer follow you into a definition.

### Fixed
- **A decomposed Thing showed up blank on iPhone and iPad.** Its contents are now drawn in a way iOS handles, with long names cut short to fit.
- **Decompose Further left the new Thing-Group empty**, and placed it far from where the Thing had been.
- **Hover previews popped up when you tapped on a touch screen.** They are now off on touch, and an expanded Thing no longer stops you panning with a finger.
- **Starting a new Wizard conversation could copy in the previous one's messages.**
- Opening a definition from a decomposed Thing left its controls and selection showing in the new Web.
- Pie menu buttons now win over Things and connections underneath them.
- The Wizard's panel could get stuck redrawing when switching conversations.
- Clicking another Thing in the abstraction carousel now dismisses the More/Less Specific hints, as scrolling does.

## [0.8.0] - 2026-06-24

### Added
- **Hover Preview settings.** Settings can turn off the preview of a Thing you hover inside an expanded Thing, or change its size (0.75x by default).
- **Double-click a Thing in the abstraction carousel to open it in the right panel.**

### Changed
- **The abstraction carousel holds the view still.** Opening it centers the Thing at a set zoom (further out on narrow screens, so the pie buttons stay reachable), and closing it puts the view back. Clicking the canvas background closes it, like Back.
- **Decomposing a Thing zooms to fit it**, with an animation, instead of leaving the view where it was.
- **Opening a Thing's Web opens the right panel** to show it.
- **The Wizard no longer slows the canvas down over time.** Its conversation stops redrawing while the panel is hidden, and new conversations and tab switches show at once.
- A decomposed Thing's contents read more cleanly: names stay on one line and are cut short, and arrowheads are smaller.

### Fixed
- **Thing-Groups couldn't be connected to or from.** Groups missing the part connections attach to are repaired when their Web opens.
- **Converting a Thing to a Thing-Group deleted its connections.** It now keeps them.
- **A Thing taken out of a Thing-Group kept snapping back** to where the group's title had been.
- **Connections to a Thing-Group now end at the group's edge**, with the arrowhead showing and the label centered, and follow the group as it grows while you drag a member.
- **The pie menu could stop appearing until a refresh.**
- **The Wizard's steps could land in another conversation** if you switched tabs during a run.
- Adding a Thing above or below in the abstraction carousel could add it to a different chain, so it never appeared. The new Thing is now brought into focus.
- Starting a connection with a quick drag from a Thing-Group's title could fail.
- A Thing's title no longer reflows while it expands or collapses.

## [0.7.6] - 2026-06-22

### Fixed
- **Install Update could still fail on macOS** when an earlier attempt had already unpacked the update. Clearing that old copy threw an error.

## [0.7.5] - 2026-06-22

### Fixed
- **The desktop app froze for about a third of a second after you dropped a Thing**, and wheel and trackpad zoom lagged. Saving and canvas work had been falling back onto the main thread in the packaged app.

## [0.7.4] - 2026-06-22

### Fixed
- **Install Update still failed on some Macs.** The app now finds the downloaded update itself when the updater doesn't say where it saved it.

## [0.7.3] - 2026-06-21

### Fixed
- **An older universe was converted to the new format again on every refresh.** The converted copy is now written straight back to the local file, the GitHub repository and browser storage.

## [0.7.2] - 2026-06-21

### Added
- **File → Export... offers six formats:** Redstring (.redstring), JSON (.json), a plain-text outline (.txt), and three RDF formats that other semantic web tools can open: Turtle (.ttl), TriG (.trig) and N-Quads (.nq). It replaces Export as RDF/Turtle.

## [0.7.1] - 2026-06-21

### Fixed
- **Install Update failed on macOS 26** with "No staged update found", even after the download finished. The desktop app now unpacks the update itself when the system helper hasn't.

## [0.7.0] - 2026-06-21

### Added
- **A backup before an older file is converted.** The desktop app keeps a copy of the original next to it. In the browser, the last three copies of each universe are kept.
- Redstring's own RDF vocabulary is published with the app, so exported terms have labels and definitions.

### Changed
- **Universes save in a new file format (4.0).** Older files still open and are converted when loaded. Files are smaller, since each Web, Thing and connection is now stored once instead of up to three times.
- **Export as RDF/Turtle produces clean, standard linked data** with far fewer statements. It uses common vocabularies (SKOS, PROV), marks what The Wizard made, and says how closely each Thing matches an outside source.

### Fixed
- **Data Redstring didn't recognize was dropped** when a file was opened and saved again. It is now kept.
- **A local file and its GitHub repository could be flagged as conflicting** when they held the same universe written differently.
- **Connections with arrows both ways, or pointing backwards, exported in the wrong direction** to RDF.
- **In the desktop app, a new universe's file came back disconnected after a restart.** Its full path was being cut down to the file name.

## [0.6.15] - 2026-06-12

### Added
- **Mouse Glide.** A click-drag pan can keep gliding after you let go, like a touch flick. Mouse Glide and Touch Glide each have an on/off switch and a strength slider in Settings.

### Fixed
- **The desktop app could open twice on macOS.** The second copy shared the first one's data. A second launch now brings the open window forward.
- The desktop app no longer reads a half-written settings file as a fresh install, and quitting shuts down The Wizard's background server so the next launch can start it.

## [0.6.14] - 2026-05-26

### Fixed
- **"Restart to update" now installs the update on macOS.** The installer the desktop app relied on failed silently on macOS 26, so it now swaps in the new version and relaunches itself.
- Update Diagnostics can reinstall the previous version.

## [0.6.13] - 2026-05-26

### Fixed
- **Dropping a Thing no longer stutters at the end of the zoom back in.** Autosave waits until that animation finishes.

## [0.6.12] - 2026-05-26

### Fixed
- **"Restart to update" relaunches the desktop app on macOS.** Before, the app closed and stayed closed, and the update prompt came back on every launch.

## [0.6.11] - 2026-05-26

### Added
- **Load from External Link.** File → Load from External Link... opens a universe from a file link, or lists the universes in a GitHub repository or folder. You see what it holds first, then copy it to a repository, save it locally or just look.
- **Copy a universe's GitHub link.** Each universe saved to GitHub has a button next to its download button that copies its public link.
- The Universes panel's Load menu has "Load from Link", and its New menu reads "New from Local File" and "New from Repository".

### Fixed
- **A failed GitHub read could replace a real universe with an empty one.** When Redstring couldn't tell whether the file was missing or just unreadable, it started a blank universe and saved it over the file. It now refuses.
- **Publishing a universe to GitHub pushes it before linking it**, so reloading from GitHub can't overwrite your work. It also saves right away, so "All changes saved" shows at once instead of three seconds later.

### Security
- **Rate limits and origin checks on Redstring's servers and the desktop app.** Queries to the semantic web can no longer point at local or private network addresses.

## [0.6.10] - 2026-05-24

### Fixed
- **A half-downloaded update no longer fails to install without saying why.** The desktop app checks the downloaded update when it starts, and Update Diagnostics names the problem.

## [0.6.9] - 2026-05-24

### Added
- **Update Diagnostics.** The desktop app's update notice can open a card that shows what the updater is doing. From there you can check for updates, clear the update cache, open the update log or open the releases page.

### Changed
- **Side panels open narrower and can be made narrower**, so they fit small windows better.

## [0.6.8] - 2026-05-22

### Fixed
- **The Wizard failed with newer Gemini models.** Gemini 2.5 and later send turns that hold only thinking, which The Wizard couldn't handle.
- On touch screens, a dialog opened with a tap no longer closes the moment it opens.

## [0.6.7] - 2026-05-22

### Fixed
- **The desktop app wouldn't quit.** The "leave this page?" prompt added in 0.6.6 blocked it. The prompt now only appears in the browser.

## [0.6.6] - 2026-05-22

### Added
- **The Wizard lists the Gemini models your API key can use** when you set up a Gemini key.

### Changed
- **The browser asks before you leave the page**, so an accidental back swipe on Android doesn't close Redstring.
- **Fast flicks on touch glide farther.** Slow, careful flicks stop where they did before.
- **Dragging a Thing zooms out noticeably even when you're already zoomed out**, and the default zoom amount changed.
- Touch zoom is more sensitive by default.
- The color picker in the naming dialog opens down and to the right, and no longer hides behind other panels.

### Fixed
- **Lifting a finger after a pinch could create a Thing.** A stray tap on bare canvas dropped a plus sign, and the plus sign could fire more than once.
- Hover effects no longer stick on touch screens.

## [0.6.5] - 2026-05-16

### Changed
- No changes of its own. This is the first published build with the 0.6.4 fixes.

## [0.6.4] - 2026-05-16

### Fixed
- **Switching which copy of a universe comes first could wipe it.** Saves pause while a universe hands over from one storage to another, and the checks against saving an empty universe now remember what they've seen across restarts.
- The Universes panel shows fresh counts and save times after every autosave.

## [0.6.3] - 2026-05-15

### Changed
- **Linking a repository asks before making it the main copy.** You choose "Use Repository as Primary" or "Keep Local as Primary", and the question only comes up once the repository really has your data.
- With a local file as the main copy, the GitHub backup is updated within about 10 seconds of your last edit.

### Fixed
- **A newly linked GitHub universe could clear its local file.** Making an empty repository the main copy let it overwrite the local file on the next load. Redstring now copies your data to the new main copy first, and cancels the switch if that fails.

## [0.6.2] - 2026-05-13

### Fixed
- **GitHub sign-in in the desktop app works.** The desktop build was missing the IDs it needed to start it.

## [0.6.1] - 2026-05-13

### Added
- **Sign in to GitHub from the desktop app.** It shows a code to enter on GitHub.com and notices when you've approved it, so universes in the desktop app can sync with GitHub.

### Fixed
- **A universe that failed to load could be saved over.** Redstring no longer writes a universe whose load failed or never finished, and a failed load shows as an error instead of an empty canvas.
- **On iPhone, the abstraction carousel drifted off its Thing** when the address bar showed or hid, and a tap in the Add Above/Below dialog could close the carousel.
- Panning in orbit view on touch no longer exits it.

## [0.6.0] - 2026-05-13

### Added
- **Narrow screens show one panel at a time.** At 1100 px wide or less, opening one side panel closes the other, the open panel fills the width, and the header's buttons fold into one menu.
- **Swipe the bottom control panel away.** On phones it has a handle you drag down to close it.
- **Touch works in more places:** the abstraction carousel scrolls by touch with momentum, pie menu buttons respond to taps, and orbit view takes taps. Tapping a selected Thing deselects it.
- **Edge panning.** Dragging a Thing or drawing a connection to the edge of the screen pans the canvas, with mouse or touch. Each can be turned off in Settings.
- **More input settings:** touch and keyboard zoom and pan sensitivity, Hold Middle Click to Zoom, and a switch for the glows that point to offscreen Things (turning them off helps panning on large Webs).
- **Disconnect GitHub.** GitHub sign-in and the GitHub App each have a Disconnect button, and a removed App stays disconnected instead of being found again.
- **Detect install.** After you install the GitHub App, Redstring finds it when you come back to the tab, or when you tap Detect install.
- A banner says when Redstring can't reach its GitHub sign-in server, with Try again.
- Linking an existing universe to a repository offers Load from Repo, which pulls the repository's universe in instead of overwriting it.

### Changed
- **Connection names show by default**, and connections are drawn at the same width whether names are shown or not.
- **A GitHub universe reads "Syncing..." until it has loaded**, so you don't start editing an empty canvas that's about to be replaced.
- **New Webs and Things are named "New Thing"** instead of "Untitled", and a name can't be set to blank.
- **A universe with a repository or local file no longer falls back to an old browser copy** when that storage fails to load. You see the error instead.
- The warning that Redstring doesn't work on mobile is gone, and color pickers and dialogs are centered on phones.
- The synced status is green.

### Fixed
- **Loading a universe from GitHub could overwrite your edits.** Edits made while a repository reloaded or imported in the background could be replaced by the older copy.
- **Autosave could stop on phones.** A stuck save now recovers on its own.
- **Saving to GitHub failed on more errors than it had to.** It now falls back to your GitHub sign-in when the App lacks access, and treats an out-of-date file as a conflict to resolve.
- Touch pans no longer stop gliding early.
- The save indicator and connection status no longer disagree.
- Using The Wizard clears the current selection.

## [0.5.0] - 2026-05-10

### Changed
- **Touch screens work much more like a mouse.** Double-tap to open, long-press a Thing or group title to drag it, and draw connections with a finger. Long-press no longer brings up a menu.
- **The header's buttons moved into a menu.** Help, Settings, both searches, Create New Thing and Bookmark now sit behind one button on the right, leaving the header to the tabs.
- **On windows 1100 px wide or less, only one side panel is open at a time**, and it can widen up to the other panel's button.
- **The side panels' buttons, tabs and resize handles are bigger and easier to hit**, and the bottom control panel scales with the window.
- **Snap to grid picks the nearest grid line.** It used to pull toward the one up and to the left, so a Thing jumped when you started dragging it.
- The AI section of Settings was reorganized.

### Fixed
- **Ask The Wizard on a Thing with an empty definition could fill the wrong Web**, or make a new one, instead of filling the empty definition.
- **Dropping a dragged Thing or group could drop a plus sign where you let go.**
- While dragging with snap to grid on, connections and their labels could stay behind at the old spot.
- Tapping a connection on a touch screen selected it and then cleared it again.

## [0.4.0] - 2026-05-09

### Added
- **Ask The Wizard about a connection.** The Connection control panel has an Ask The Wizard button that defines the selected connections, including new ones that have no type yet.
- **Ask The Wizard to define a Thing.** When a Thing has no definition, or only empty ones, Ask The Wizard in its control panel or in its Components section in the right panel builds a Web for it in one click.
- **Settings choose where these requests go**: a new conversation, the current one, or ask each time.
- In the conversation, these requests show as a short card instead of the full instructions sent to The Wizard, and connection types The Wizard makes get their own colors instead of all being gray.

### Changed
- **When a Wizard step fails, the conversation says so.** Before, a step that couldn't find its connection or Web did nothing without a word.
- **Auto-layout handles groups inside groups**, laying out each inner group as a block within its outer one.
- **Coming back to the app after 30 seconds or more away rechecks your file access and sign-in**, so a connection that went stale while the computer slept no longer needs a refresh.

### Fixed
- **A universe that loaded slowly or failed to load could be saved over with an empty one.** Nothing is saved now until the universe has loaded, and a save that would suddenly shrink a universe to almost nothing is refused.
- **Startup could stay stuck on the loading screen.** Sign-in and restoring file access now give up after a few seconds and finish in the background.
- **The Wizard could change the wrong Web, or pick the wrong connection when asked to change or delete one.**
- A group listing a Thing that had since been deleted stretched toward the top-left corner when dragged.
- On a Mac, the canvas could keep panning after you let go of a movement key while holding Cmd.

## [0.3.13] - 2026-05-04

### Added
- **Cmd/Ctrl + middle-click and drag up or down to zoom** around the point you clicked. The cursor stays put while you drag. Cmd/Ctrl + middle-click on a Thing without moving opens it in the right panel.

### Fixed
- **Dragging a Thing by its picture dragged the picture out instead of moving the Thing.**

## [0.3.12] - 2026-04-29

### Changed
- **Cmd/Ctrl+W no longer closes the desktop app.** It was too easy to hit by accident.
- **New repositories made for a universe are tagged `redstring-universe` on GitHub**, so universes can be found.

### Fixed
- **Connection lines poked out past their arrowheads.** They now stop under the arrow.
- The universe menu in the Universes panel opened off to the wrong side when the header was narrow.

## [0.3.11] - 2026-04-28

### Changed
- **Grid lines are lighter, and darker in dark mode.**

### Fixed
- **The canvas flickered while you panned and zoomed.** It also takes less work to draw now.
- **A connection's label jumped when you dropped a Thing you'd been dragging.**

## [0.3.10] - 2026-04-22

### Fixed
- **Panning and zooming do less work.** They were still checking what was off screen even after 0.3.8 turned that off.

## [0.3.9] - 2026-04-22

### Fixed
- **Onboarding could come back after an update, and finishing it could overwrite your universe file with an empty one.** Redstring now remembers that you've been through onboarding, and if a universe file of that name already exists it links to it instead of writing over it.
- The update notice's buttons were hard to see.

## [0.3.8] - 2026-04-22

### Added
- **Connect a Thing to itself.** Draw a connection out of a Thing and back into it, and Redstring asks whether to make a loop. Loops follow the Thing as you drag it.

### Changed
- **A local file that can't be reached shows a Reconnect button** in the Universes panel, with the reason in a warning.
- **Things off screen are drawn again.** Skipping them, added in 0.3.6, caused bugs.

### Fixed
- **Starting a new drag right after dropping a Thing could make the first Thing jump** when you let go.
- **Onboarding showed up again for people who already had universes.**
- **The Wizard could attach a connection to an older Thing with the same name** instead of the one it had just made.
- Pasting could bring along connections to Things that weren't pasted.
- Linking a file in the desktop app could fail after a macOS iCloud dialog.

## [0.3.7] - 2026-04-21

### Added
- **Alt/Option + scroll pans sideways**, for mice that only scroll up and down.
- **The update notice appears as soon as an update is found** and shows how far the download has got.

### Changed
- **The mouse wheel pans the canvas, and Cmd/Ctrl + wheel zooms.** Redstring no longer guesses whether you're on a mouse or a trackpad, which it often got wrong. Pinching still zooms.
- **Keyboard zoom works while you drag a Thing**, and the Thing stays under the cursor.

### Fixed
- **Dragging a Thing could leave a stray black stub of a connection behind**, or make a connection you didn't mean to.
- While dragging, hover dots stayed where the connection had been, and connections without arrows ended at the Thing's edge instead of its center.

## [0.3.6] - 2026-04-21

### Changed
- **Dragging Things, panning and zooming are much smoother on big Webs.** Things off screen are no longer drawn, and dragging and the side panels do far less work.
- **Groups grow and shrink as you drag their Things**, instead of catching up when you let go.
- **Connection labels are easier to read**: a light shade of the connection's color with a dark outline.
- **The Wizard always knows which Web you're looking at**, even after a refresh.
- **Webs The Wizard changes are laid out**, even when they aren't the one on screen.

### Fixed
- **Trackpad scrolling could turn into zooming partway through a pan.**
- **Connections flickered while you zoomed.**
- A color The Wizard got wrong could leave a Thing with no color. It now falls back to the default, and the Safari palette's green was fixed.
- Holding Tab to switch tabs didn't work with Caps Lock on.

## [0.3.5] - 2026-04-02

### Fixed
- Build and release fixes. This was the first published build with 0.3.4's palette changes.

## [0.3.4] - 2026-04-02

### Changed
- **The Wizard's color palettes were adjusted**, and the Mesa palette is now called Piedmont.

## [0.3.3] - 2026-04-01

### Added
- **The desktop app tells you when an update is ready** and restarts to install it. If the install fails, it offers the download on GitHub instead.
- **An About section in Settings** shows the version you're running.

### Fixed
- **The Wizard didn't work in the desktop app.**
- **A Google Gemini key could be sent to OpenRouter**, which failed with "User not found".
- **Closing the welcome screen didn't stick**, so it came back.
- The side panels couldn't be dragged wider after the window grew.
- A connection being drawn now passes under Things instead of over them.

## [0.3.2] - 2026-03-30

### Fixed
- **The Wizard failed on some answers from the model**, such as a name sent in an unexpected shape or a blank field.
- Bullet lists written with `*` in The Wizard's replies now show as lists.

## [0.3.1] - 2026-03-30

### Fixed
- **The desktop app didn't check for updates.**

## [0.3.0] - 2026-03-30

The first beta.

### Added
- **The Wizard.** An AI agent in the left panel that builds and edits Webs, Things, connections, groups and definitions in your universe, looks things up on Wikidata and DBpedia, and adds Wikipedia descriptions and pictures. Bring your own key: OpenRouter, Anthropic, OpenAI, Gemini or a local model.
- **Working with The Wizard.** Conversations sit in tabs and are kept between sessions. For bigger jobs it shows its plan as a checklist, it can ask you multiple-choice questions, and undoing a message also undoes the changes it made.
- **Attach files to The Wizard**: text, Markdown, PDF, and tables (CSV, TSV, Excel, JSON), which it can turn into a Web.
- **Semantic Orbit**, in a Thing's pie menu and right-click menu. Related concepts from your universe, Wikidata and DBpedia circle the Thing in rings. Hover one to hold it still, click it to add it to the Web, connected to the Thing.
- **Settings.** A settings window with Display (text size, connection labels and routing, grid, keyboard pan and zoom speed, dark mode) and AI & API Keys, which can test a key before you use it.
- **Dark Mode**, in Settings or the Redstring menu.
- **Search.** A header button searches every Thing in the universe and opens the one you pick. Open Things, Saved Things and All Things in the left panel can be searched, and Cmd/Ctrl+F opens search.
- **Resizable text.** Font Size and Line Spacing in Settings change the text on Things.
- **Tab hides and shows the panels.** Hold Tab and press A / D, Q / E or Left / Right to step through your open Webs.
- **More GitHub in the Universes panel.** Browse your repositories, create a universe file in one, and save to it from the universe's card. When the local file and repository disagree, pick which to keep. Cards show how much each universe holds.
- **Icons in the Redstring menu.**
- The Type list has a Components mode that lists the Things in the current Web. Click one to select it and open it in the right panel.
- Copy a connection's definitions with Cmd/Ctrl+C and paste them onto other connections.
- Drag from a Thing-group's title to draw a connection from it.

### Changed
- **The header and the right panel header take the color of the Thing that defines the Web.** The header's Web tabs also scroll now, keeping the active one centered.
- **Text is easier to read.** Label colors adjust to each Thing's color for contrast, and long connection labels wrap.
- **Auto-layout keeps groups apart and gives connections room for their labels.** It runs faster, handles Webs of up to 200 Things, zooms to fit when done, and is in the canvas right-click menu as Auto Layout Web.
- **The welcome screen now introduces the open beta.**
- **Faster almost everywhere.** Long Thing lists in the left panel scroll smoothly, and the canvas redraws less.
- The save indicator reads "Saving..." in the bottom right and fades out once saved.

### Fixed
- **Many problems saving and loading universes.** Opening a universe no longer saves it right away, a pending save can't land in another universe, restoring linked files no longer hangs startup, and a new file no longer overwrites one with the same name.
- **Saving with Wikipedia pictures could run out of memory and crash.**
- A deleted Wikipedia picture came back after a reload.
- Dragging several Things while the view panned at the screen edge dropped them in the wrong place.

## [0.2.0] (start of beta) - 2026-01-22

### Added
- **A desktop app.** Redstring now comes as an app for macOS (signed and notarized), Windows and Linux. It opens and saves files through the system's own dialogs, has a native menu bar, and downloads updates in the background, installing them when you quit.
- **Undo and redo.** Cmd/Ctrl+Z undoes and Shift+Cmd/Ctrl+Z redoes, and both are in the Edit menu.
- **Action History.** A new left-panel tab lists everything you've done, newest first, filtered by All, this Graph, or Global. Click any entry to go back (or forward) to that point.
- **Copy, cut and paste.** Cmd/Ctrl+C, X and V work on selected Things. Paste places new copies of the same Things at your cursor, along with the connections between them.
- **Several connections between the same two Things.** You can draw more than one, and they curve apart so each can be seen, hovered and clicked.
- **Text Size.** View → Text Size sets the font size and line spacing of names on Things. Names now start at 1.2x the old size.
- **A workspace folder.** Choose one folder for your universes in the Universes tab. New and exported universes are saved there.
- **A config file for the desktop app.** Its settings and list of universes are kept in files in the app's data folder instead of browser storage.
- **A new welcome flow.** It asks where to save your universes (a folder, or skip for now), then asks you to name your first universe. Help → Show Welcome Screen opens it again.
- **Auto-layout.** Edit → Auto-Layout Active Graph arranges the Things in a graph, and Condense Nodes to Center pulls them together. View → Force Simulation Tuner runs the layout live, with sliders for its forces and speed, and lets you drag Things while it runs.
- **The canvas zooms out while you drag a Thing** so you can see where it's going, then zooms back. Turn it off or change how far it zooms under Edit → Zoom on Drag.
- **Dragging a Thing to the edge of the screen pans the canvas**, and a drag keeps going when the pointer passes over a panel.
- **Search and Create New Thing buttons in the header.** Search finds a Thing in the current graph and takes you to it. The plus button starts a new graph.
- **Redstring Guide.** A Help & Guide button in the header, and Help → Redstring Guide, explain the controls, the pie menu and navigation.
- **More ways to start a universe.** The Universes tab's New menu offers an empty universe, one from a local .redstring file, or one from a GitHub repository.
- **Saturation and brightness sliders** in the color picker.
- **Groups get the color picker** instead of a box asking for a hex code.
- **Choosing a source of truth.** When a universe is linked to both GitHub and a local file, Redstring asks which one is primary, and asks before saving to or reloading from the other.
- A window tells you when your GitHub sign-in has expired and asks you to reconnect.
- A universe imported from a file but not yet linked says so, and offers Pick File / Save As to turn on auto-save.

### Changed
- **Dragging Things is much faster**, most of all in large graphs.
- **Saving no longer makes the canvas stutter.** Saves wait until you finish dragging, panning or zooming, and run without holding up the page.
- **Zoom in much further.** The limit was 3x.
- **Names on light-colored Things are drawn in dark text** so they stay readable.
- **Group titles are sized to their text.**
- **The Debug menu is hidden.** Right-click the Redstring logo to show it.
- Zooming back after a drag keeps the point under your cursor in place.
- Touch: pinch zoom centers between your fingers, and taps on menus and the bottom panel no longer reach the canvas behind them.
- Wikipedia pictures are found for more articles, including ones without a main image.

### Fixed
- **Deleting the open universe left you in it.** Redstring now switches to another universe and loads it.
- **A Thing whose link to its definition was lost opened a new, empty definition.** It now finds and reconnects its existing one.
- **Deleting Things left them listed in their groups.**
- If a universe's primary storage can't be read, Redstring loads the backup and tells you which one.
- Backspace or Delete while the abstraction carousel was open could delete the selected Thing.
- Letting go of a dragged Thing or group could also count as a click on it.
- Connection hover flickered as the pointer moved along a connection.
- The connection panel could stay open when you clicked off it with a slight drag.
- Things with a description were sized a little wrong.
- The right panel stayed closed when you opened a Thing into it.

## [0.1.0] (start of alpha) - 2025-10-23

The first public release of Redstring, after about a year of private development that began in November 2024. It ran in the browser; the desktop app came in 0.2.0.

### Added
- **Things that hold their own webs.** A Thing (node) can have one or more definitions, each a web of its own, and the same Thing can appear in many webs. Decompose opens a Thing's definition in place on the canvas, and Expand (Open Web) opens it in its own tab in the header.
- **Types.** Every Thing has a type, and every type traces back to the base type, Thing. The Type list along the bottom shows the types for Things or for connections, and the 3 key switches between them.
- **Connections with direction.** Drag from one Thing to another to connect them, name the connection, and put arrows on either end or both. Connections can be drawn straight, Manhattan or Clean.
- **The canvas.** Click empty space for the plus sign and name a new Thing. Pan and zoom with a trackpad, mouse wheel, touch or keyboard. Things off screen glow at the edge, and Back to Civilization brings you back.
- **The pie menu.** Selecting a Thing opens a ring of actions around it: Expand, Decompose, Abstraction, Edit, Save, Palette and Delete. Right-click gives the same actions as a menu.
- **The abstraction carousel.** Abstraction lays out a Thing's chain from specific to general ("Lawyer", "Professional", "Person"). Add Above and Add Below extend it, and a Thing can have several chains, one per dimension.
- **Groups.** Group a selection, name it, or ungroup it. Convert to Thing-Group makes a group the definition of a Thing, and Combine Into Thing folds it into that one Thing.
- **Two panels.** The left panel holds All Things, Saved Things, Open Things, Federation and Semantic Discovery. The right panel gives each open Thing a tab with its name, color, image, bio, components and links.
- **Universes saved as .redstring files.** A universe holds all your webs and saves itself to a file, with Open... and recent files in the File menu. The file is JSON-LD, and older formats are upgraded when opened.
- **Saving to GitHub.** Sign in and install the GitHub App to keep a universe in a repository, committed as you work. A universe can live in a local file and a repository at once, and you choose which is the Source of Truth.
- **Semantic web search.** Semantic Discovery searches Wikidata, DBpedia and Wikipedia for a concept, and results can be dragged onto the canvas as Things. Selecting a Thing shows related concepts orbiting it.
- **Linked Things.** A Thing's Semantic Web section links it to Wikidata, DBpedia and Wikipedia, and Enrich from Web fills in what they know. Mass Import brings in a cluster of related concepts.
- **Merge Duplicates** in the Edit menu finds similar Things and merges them into one, keeping their definitions.
- View menu options for the grid (off, on move, always, and its size), connection names, and fullscreen.

## [0.0.6] - 2025-10-17

### Added
- **The GitHub App.** Install it alongside the GitHub sign-in to save to repositories, create a new repository from the picker, and keep a list of the repositories Redstring manages. Sign-ins are kept between sessions.
- **A universe can live in a local file and a repository at once.** When the two disagree, Redstring shows both and asks which to keep.
- **A save indicator** that shows unsaved changes, and saves them on its own to the file and to GitHub.
- **Older .redstring files are upgraded when opened**, now that the format has versions.
- **Group names edit in place**, and a group can become the definition of a node and be combined back into it.

### Changed
- **Saves are coordinated.** Rapid edits are batched into one save instead of each writing the file, and nothing saves mid-drag.
- **GitHub connects only when it's needed**, so startup no longer floods it with requests.

## [0.0.5] - 2025-08-31

### Added
- **Save a universe to GitHub.** Sign in, pick a repository or start one, and choose whether the repository or the local file is the source of truth.
- **Semantic Discovery.** Search Wikidata, DBpedia and Wikipedia from the left panel, and drag a result onto the canvas to make it a node.
- **Semantic web links.** A node's panel links it to its Wikidata, DBpedia and Wikipedia entries, and Enrich from Web fills in what they know. Connections are also saved as RDF statements.
- **Manhattan and Clean connection routing**, alongside straight lines.
- **A grid** that nodes snap to, with its size in the menu.
- **Right-click menus** on the canvas and on nodes.
- **Duplicate management** finds nodes that look alike and merges them.
- **Build the abstraction chain from the carousel.** Add Above and Add Below make a more general or more specific node, and a node can be taken out of the chain.
- **The connection panel** can delete a connection or open its definition, and several connections can be selected at once. Connection names can be shown or hidden.
- An AI experiment: an MCP server and a chat panel that let a model read and change a graph. It was still switched off when 0.1.0-alpha shipped.

### Changed
- Keyboard panning and zooming speed up and slow down smoothly.
- A new typeface, EmOne.

## [0.0.4] - 2025-07-06

### Added
- **Universe files.** Create, open and save a whole universe as one file, with recent files in the Redstring menu.
- **Open graphs sit as tabs in the header**, and each one remembers where you left its view.
- **Arrows on connections.** Click either end of a connection to point it.
- **The abstraction carousel.** A node's chain from specific to general, scrolled with momentum and snapping into place.
- **One node, many graphs.** A node can be placed in as many graphs as you like, and a change to it shows in all of them. Drag a node from the panel onto the canvas to place it.
- **Types.** Every node has a type, all tracing back to a base "Thing" type, and you can make your own with a name and color. Saved nodes are grouped by type.
- **Pick an existing node from the plus sign**, with search.
- **A color picker** in the pie menu and the panel.
- **The connection panel.** Select a connection to name it or change its type. Selected connections glow.
- A node's description shows when it's expanded, and follows the definition you're on.

## [0.0.3] - 2025-05-28

### Added
- **Two panels.** The right panel fills the side of the screen, with a tab for each open node and pages for its components. The left panel lists your saved nodes.
- **Save nodes** with the bookmark.
- **The pie menu.** Selecting a node opens a ring of actions around it, such as Expand and a preview of its contents.
- **More than one definition per node.** Step between them on the node itself, and open or delete each one. The panel's Component Of section lists the nodes a graph defines.
- **Rename a node right on the canvas.**

### Changed
- Pan and zoom tell a mouse from a trackpad more reliably on each platform.

## [0.0.2] - 2025-04-14

### Added
- **Pictures on nodes.** Add an image to a node and it's shown in the node, which resizes and wraps its name to fit.
- **A side panel** with a node's name, description and picture, in tabs you can reorder.
- **Select and move several nodes at once.**
- **Trackpad support on Mac**: two-finger pan and pinch zoom.
- **The type bar** along the bottom, for node and connection types.
- **A first look at decomposition**: preview what's inside a node.
- Rename the graph from the header.

## [0.0.1] - 2024-11-18

The first draft of Redstring in React, rebuilt from a demo in Flutter and a previous demo in Java. The core structure and foundation of the program to this day.

### Added
- **A canvas of nodes and connections** that you can pan and zoom.
- **The header and the Redstring menu**, with the animated logo.
