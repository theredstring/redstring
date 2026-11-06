# Shared links and read-only universes

**Status:** current (2026-11-05, on `feat/shared-links`).

A shared link opens a hosted universe read-only, in the browser, with an option to open it in the app. Make a Copy turns it into a universe of your own.

## The link

```
https://redstring.io/open?gh=owner/repo/main/universes/foo/foo.redstring
https://redstring.io/open?url=https%3A%2F%2Fexample.com%2Ffoo.redstring
redstring://open?gh=...
```

`src/services/sharedLink.js` builds and parses these.

- **A link grants nothing.** It says where the file is, and the host decides who can read it. A raw link's `?token=` is dropped.
- **Always `/open`, one level deep.** Assets load relative to the page (`base: './'`), so a deeper path would break them.
- **Any direct https file works, if its host allows it.** The app fetches the file, so the host has to send CORS headers (GitHub raw and gists do). Redstring doesn't proxy. Files over the size cap (50 MB, 25 MB on phones) are refused.
- **Dropbox links work as Copy link gives them.** `www.dropbox.com` can't be read from the app, so `classifyUrl` reads the same file from `dl.dropboxusercontent.com`, keeping only `rlkey`. Dropbox staff describe that host as legacy but still supported, so it could change.
- **Private GitHub files** are read as the person: an anonymous 404 retries through `api.github.com` with their token (`fetchSharedUniverse`). The token goes nowhere else.

## How a link arrives

| Where | How | Code |
|---|---|---|
| Web | The page opens on `/open`; boot reads the address and opens it instead of your active universe | `universeBackend._doInitialize`, `UniverseHost` skips workspace setup and onboarding |
| Desktop | `redstring://`, by "Open in App". macOS `open-url`; Windows and Linux `second-instance` and argv. Main holds it until the renderer takes it | `electron/main.cjs`, `electron/appLink.cjs`, `window.electron.sharedLinks` |
| iOS, Android | `redstring://` via `appUrlOpen`, cold or running | `capacitorFileOpen.js`, `Info.plist`, `AndroidManifest.xml` |

`https://redstring.io/open` going straight to the phone app (Universal Links, App Links) isn't set up. It needs the Associated Domains capability, `apple-app-site-association` and `assetlinks.json`; `parseSharedLink` already reads those links.

## Read-only

`universeBackend.openReadOnlyUniverse` registers the universe in memory and brings it in through `switchActiveUniverse`, so whatever was open is saved and let go as usual. A load that fails changes nothing.

Three layers keep it read-only, all keyed on `src/store/readOnlyUniverse.js`:

1. **The store.** `graphStore`'s middleware refuses, whole, any write that would change a document root (`withDocumentKept`), so a refused "new web" doesn't also go to the web it would have made. Where you are in the universe (active web, open tabs, camera) still changes. The only load it takes is its own, stamped with its slug by the switch that opened it (`readOnlyRefusesLoad`): a file, a late reload of the universe left behind, anything unstamped is refused. `mergeUniverseState` refuses, which covers ontology import, the formula starter and merging a link in. `test/store/readOnlyUniverse.test.js` calls every store action with real ids and checks all this; a new action is covered without anyone adding it.
2. **Saving.** SaveCoordinator's `onStateChange`, `executeSave`, `flush` and `forceSave` refuse, beside the load gate. So do the backend's direct paths, `saveActiveUniverseInternal` and `forceSave`, restoring a backup or a Git version, the File menu's own open and save (`universeFileActions`), and forwarding to a headless daemon (`daemonCoexistence`).
3. **Gestures.** Dragging and drawing connections don't start (`useNodeDrag`, `pointerHandlers`), because a drag moves the DOM before the store hears about it. Neither do the things a refused write would leave half done: the plus sign and its bubbles, the formula box and its offer, and cut, paste and delete from the keyboard (`useCanvasKeyboard`). Settings rows and File menu items that edit are dimmed.

A refused edit, within a moment of the person's own gesture, nudges the bar (`nudgeReadOnlyUniverse`). Background writes don't.

The Wizard still works here, and its writes are refused like any other, but it doesn't know that: it can say it built something it didn't.

**What stays live.** The pill (`ReadOnlyHost`) sits over the TypeList and rides on top of whichever control panel is up (`store/bottomPanelTop.js`; the panel reports its own top edge). Its X hides it until the next visit and the visit goes on. A visit opens the left panel on Universes (the tab is ready but the panel stays shut where panels are exclusive), and the universe's row there is the way out. Editing buttons stay where they are, dimmed, in the node, connection and group pies (`pie/readOnlyButtons.js`), the context menus, the bottom panel (`data-view-only` marks what stays live) and the right panel. The pie and bottom panel lists name what only looks, so a new button dims by default.

**Expanding is a flip-through.** Decompose opens the Thing's preview card and the arrows move between its definitions. Both are canvasUIStore state (`previewingNodeId`, `nodeDefinitionIndices`), so they change nothing and save nothing. Opening a definition as a Thing-group writes the document, so Decompose Further is dimmed.

**Never remembered.** `saveToStorage` leaves read-only universes out of the list and records your own universe as active. A web reload follows the link again; closing goes back to where you were.

**A page booted on a link** (`bootVisit`) hasn't read your universes or started workspace setup. Going to one of them is an ordinary reload with that universe active.

## Make a Copy

`makeCopyOfActiveUniverse`, from the bar, the active row in the Universes panel and File in the Redstring menu. It round-trips the store through the file format into a new universe: Capacitor's managed file, or elsewhere the browser-backed shell onboarding starts from, with its slots ready to fill. It starts autosave, which a page booted on a link hasn't done, and writes the first save itself. A universe of your own comes out as "Copy of"; one from a link keeps its name.

## Sharing your own

`ShareUniverse.jsx`, the Share section of the active row in the Universes panel, and Copy Link under File in the Redstring menu. A universe gets a link once it's in a GitHub repository; without one, the section offers Add Repository and the menu item opens the panel. `universeShare.js` builds the link to the file the sync engine writes, and asks GitHub, without a token, whether the repository is public, so the section can say who the link opens for. Manage Access goes to the repository's settings, because access is GitHub's. Gitea repositories don't get a link yet.

## Not yet

- **Embeds.** Viewing without the panels, on a separate origin with no sign-in code. `redstring.io` refuses to be framed on purpose, because a frame there would share storage with the encrypted tokens.
- **Pro links**, `/open?u=<id>`, resolved by the server.
- **The Wizard** still runs in a read-only universe. Its writes are refused, but it isn't told why.
