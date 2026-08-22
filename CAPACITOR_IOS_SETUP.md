# Capacitor iOS Setup

Redstring runs on iPhone through Capacitor, with local `.redstring` file storage
that works the same way Electron does on the Mac — real files, autosave, restored
across launches.

## Storage model

Unlike desktop, iOS storage is **fully abstracted**: there are no file pickers and
no workspace-folder setup. The app owns a `Universes/` folder inside its Documents
container and creates one `.redstring` file per universe there automatically.

Because `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` are set,
those files are visible to the user in **Files → On My iPhone → Redstring →
Universes**, where they can be copied, AirDropped, or opened in another app.

File handles on iOS are prefixed strings:

```
capacitor://Documents/Universes/<slug>.redstring
```

They flow through the same code paths as Electron's absolute-path handles. They
deliberately encode a `Directory` enum plus a relative path rather than an
absolute `file:///var/mobile/...` URI, because iOS rotates the app-container UUID
on reinstall — an absolute path persisted today would be wrong tomorrow. Handles
are also deterministic from the universe slug, so a lost link (WKWebView evicting
IndexedDB) is rebuilt automatically rather than prompting the user to reconnect.

## Build and run

```bash
npm run cap:ios      # build web assets, sync to iOS, open Xcode
```

In Xcode: select the **App** target → *Signing & Capabilities* → check
*Automatically manage signing* → choose your team → select your iPhone as the run
destination → Run. On first install, trust the certificate under
*Settings → General → VPN & Device Management*.

To iterate after a code change: `npm run cap:sync`, then ⌘R in Xcode.

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build:cap` | Vite build in `capacitor` mode (no sourcemaps) |
| `npm run cap:sync` | `build:cap` + copy assets and plugins into `ios/` |
| `npm run cap:ios` | `cap:sync` + open Xcode |

The iOS deployment target is **16.4**, which is the minimum for ES-module Web
Workers in WKWebView. Redstring uses module workers for canvas, layout, saving,
and PDF parsing, so lowering it breaks those.

## Network configuration

**The iOS app has no default server and is not a client of redstring.io or any
other host.** Everything it needs to be a working Redstring — the canvas, local
universe files, autosave, and Git sync straight to `api.github.com` — runs on the
device.

The only features that currently want a server are the AI wizard and the MCP
bridge, and on iOS those are **opt-in**: `getConfiguredRemoteOrigin()` in
`src/services/bridgeConfig.js` reads an endpoint the user sets themselves (their
own machine on the LAN, a self-hosted instance, or a public deployment they
chose). With nothing configured, `bridgeUrl()`/`oauthUrl()` throw
`NoRemoteOriginError`, `bridgeFetch` rejects, and the wizard is simply
unavailable rather than quietly phoning home. Everything else keeps working.

If you do point the app at a server you run, that server needs to allow the
`capacitor://localhost` origin in CORS — `deployment/app-semantic-server.js` and
`wizard-server.js` already do.

> The better end state is not a configurable remote at all: most of what the
> "server" does is stateless logic that could run in-process. See
> **Why there is a server at all** below.

## GitHub authentication

iOS uses the **device flow**, the same one Electron uses, because it needs no
callback URL and no OAuth server. `github.com`'s device endpoints send no CORS
headers, so requests go through `CapacitorHttp` (native requests aren't subject to
CORS) instead of Electron's main-process proxy. The verification page opens in an
`SFSafariViewController` via `@capacitor/browser`; the user enters the code and
swipes back.

Git sync itself needs nothing special — it's plain `fetch` against
`api.github.com`, which works in WKWebView.

Full web OAuth with a `redstring://` callback scheme is **not** implemented; the
device flow covers sign-in.

## Where the code lives

| File | Role |
| --- | --- |
| [src/utils/capacitorAdapter.js](src/utils/capacitorAdapter.js) | Platform detection, handle codec, filesystem wrappers, lifecycle, native HTTP |
| [src/utils/fileAccessAdapter.js](src/utils/fileAccessAdapter.js) | Cross-platform file I/O; Capacitor is a third branch alongside Electron and the File System Access API |
| [src/services/fileHandlePersistence.js](src/services/fileHandlePersistence.js) | Persists handles (Capacitor uses the existing IndexedDB store; handles are plain strings) |
| [src/services/universeBackend.js](src/services/universeBackend.js) | Device config, auto-linking new universes, deterministic handle recovery |
| [src/utils/deviceDetection.js](src/utils/deviceDetection.js) | Keeps Capacitor out of Git-Only mode despite the mobile UA |
| [capacitor.config.ts](capacitor.config.ts) | App ID, name, `webDir: dist` |

Two predicates express the distinctions that matter:

- `usesPathHandles()` — Electron or Capacitor: handles are path strings and there
  is no File System Access permission dance. Use this instead of `isElectron()`
  wherever that was the real meaning.
- `usesDeviceFlowAuth()` — Electron or Capacitor: GitHub tokens come from the
  device flow rather than the hosted OAuth server.

## Why there is a server at all

Worth recording, because the answer is mostly "history," not necessity.
`wizard-server.js` is two unrelated things in one Express app:

**A stateless agent runtime** — `/api/wizard`, `/api/ai/chat`,
`/api/wizard/tools`, `/api/wizard/execute-tool`, `/api/enrich`. These hold no
cross-request state: the client posts a graph snapshot and gets events back.
`runAgent` is already an async generator, the tools in `src/wizard/tools/` are
pure functions returning action specs, and `LLMClient.js` uses global `fetch`.
None of it needs a network boundary; it needs a function call. LLM access is
BYOK, so the HTTP hop protects no secret — it just moves the user's API key
across a process boundary to an unauthenticated local listener.

**A rendezvous point for genuinely separate processes** — `/api/bridge/*`. This
one is real: `redstring-mcp-server.js` runs as a stdio child of Claude Desktop
and cannot touch the Zustand store, so it needs a mailbox. All the lease TTLs,
in-flight sets, and ring buffers exist solely because the queue owner can't see
whether the consumer is alive. On a phone there is no Claude Desktop attaching,
so this half is moot for iOS regardless.

The natural direction is an in-app runtime: keep the same call shapes, but
dispatch them in-process, with the HTTP listener kept only for the external-MCP
case on platforms that have one. That would make the wizard work on iOS with no
endpoint configured at all.

Two things to know before doing it:

- `src/wizard/AgentLoop.js` imports `fs` and `path` at the top. `fs` is unused
  and `path` only computes an unused `__dirname` — vestigial, but they block a
  browser bundle until removed.
- `oneShot.getModelConfig()` resolves the model from `localStorage` via
  `apiKeyManager`, which does not exist in Node. So `isOneShotAvailable()` is
  permanently `false` inside `wizard-server.js`, and the model-assisted paths in
  ~16 tools (`resolveNodeSmart`, `classifyGraphShape`, `structureReview`,
  `edgeValidator`, and the resolution paths in `createEdge`/`updateNode`/…) are
  silently running their exact-match fallbacks in production today. Moving the
  agent in-process **turns those on** — a real behavior and spend change, not a
  pure refactor.

## Verifying on device

1. Launch — no white screen. In Safari → Develop → iPhone, the console should show
   `gitOnlyMode: false` and `sourceOfTruth: 'local'`.
2. Create a universe — no picker appears; the file exists under Files → On My
   iPhone → Redstring → Universes and contains valid JSON.
3. Edit, wait >3s, force-quit, relaunch — edits are present and the universe
   reconnects without prompting.
4. Edit, then immediately background the app — the edit still persists (the
   `appStateChange` flush beats the 3s save debounce).
5. Reinstall the app — inspect IndexedDB in the Safari inspector and confirm every
   handle is a `capacitor://Documents/...` string with no absolute container path.
6. Sign in to GitHub via device flow, then push/pull a universe.
7. With no endpoint configured, opening the AI wizard fails cleanly (a
   `NoRemoteOriginError`, no network attempt) and nothing else is affected.
