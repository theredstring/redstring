# Headless Redstring

Redstring's knowledge graph normally lives in a browser-side Zustand store. The
**headless** stack runs that *same* store in Node, so the graph is fully
functional without a browser — driven from a CLI, an HTTP API, or the MCP
server. There is one tool, `redstring`, with two front-ends over one core: the
existing GUI (the web app) and this command line. Changes persist to
`.redstring` files and (optionally) sync back to the UI when it's open.

This is a **library-first extraction**: the browser, the CLI, the background
HTTP service, and the MCP server all host one environment-agnostic core. The
hosted static-SPA deployment never imports any headless code — running headless
is purely optional and local.

---

## First time? (human or AI)

**If you just cloned this repo and want to use Redstring without a browser**, you
need two things: a **workspace** (a local folder that holds your universes) and
an **active universe** (a single `.redstring` file that's currently loaded). You
can't use Redstring without a universe — so the tools create a sensible default
for you on first run.

```bash
npm install

# One-shot setup (interactive if you have a terminal; flags for automation):
node cli/redstring.js init --workspace ~/redstring --name "My Universe"

# ...or skip init entirely — any command auto-creates ~/redstring + a default
# universe the first time it needs one:
node cli/redstring.js graph create "Solar System"
node cli/redstring.js list
```

Optionally install the `redstring` command globally so you can drop the
`node cli/redstring.js` prefix:

```bash
npm link          # then just: redstring list
```

Everything below uses `redstring` as shorthand for `node cli/redstring.js`.

---

## Concepts

- **Workspace** — a local folder of `.redstring` universe files, plus a small
  registry at `<workspace>/.redstring/workspace.json` (active pointer, display
  names, git links). The folder *is* the registry: any `.redstring` file you drop
  in is discovered. The machine remembers your current workspace in
  `~/.redstring/config.json`.
- **Active universe** — the one `.redstring` file loaded into the store. Exactly
  one is active per running process (the store is a singleton). Switching flushes
  the current file and loads another.
- **Running vs. one-shot** — `redstring run` starts Redstring in the background
  serving your workspace over HTTP. Any other command talks to it if it's up; if
  not, it runs the store directly for a single command and exits.

## Commands

```bash
# Getting started
redstring init [--workspace <dir>] [--name <u>] [--pull <user/repo>]

# Lifecycle
redstring run [<universe>]        # start the background Redstring (+ activate a universe)
redstring stop                    # stop it
redstring status                  # is it running? which workspace / active universe
redstring workspace [link <dir>]  # show or set the workspace folder

# Universes
redstring list                    # list universes (─ * marks the active one)
redstring create <name>           # create a universe (and make it active)
redstring use <universe>          # switch the active universe
redstring show <universe>         # a universe's details
redstring rm <universe> [--keep-file]

# GitHub-backed universes (BYOK token)
redstring auth github <token>     # save a token to ~/.redstring/config.json
redstring pull <user/repo>[/path] [--name <n>] [--no-activate]
redstring push [<universe>] [<user/repo>] [-m <msg>]
redstring link <universe> <user/repo>
redstring unlink <universe> [--local]

# Graph operations (act on the active universe)
redstring graph list | create <name> | show <id>
redstring node create <name> --graph <id> [--color <hex>] | list --graph <id>
redstring edge create <src> <dst> --graph <id> [--type <name>]
redstring search <query>
redstring apply <specs.json|->
redstring export [--out <file>]
redstring state
```

Add `--json` to any command for machine-readable output. All store/handler
logging goes to **stderr**; stdout carries only intentional output, so
`redstring ... --json | jq` is safe.

### Example: build a small graph

```bash
GID=$(redstring --json graph create "Solar System" | jq -r .id)
redstring node create "Sun"   --graph "$GID"
redstring node create "Earth" --graph "$GID"
redstring edge create "Sun" "Earth" --graph "$GID" --type orbits
redstring state
```

## GitHub-backed universes

Universes can be pulled from and pushed to a GitHub repository. Auth is **BYOK**
(bring your own token) — no funded inference, no shared secret. Provide a token
one of three ways (highest precedence first): `--token <t>`,
`REDSTRING_GITHUB_TOKEN` / `GITHUB_TOKEN` in the environment, or
`redstring auth github <token>` (stored in `~/.redstring/config.json`).

```bash
redstring auth github ghp_xxx
redstring pull alice/knowledge-graphs         # discovers a .redstring, imports + activates it
redstring pull alice/graphs/universes/physics/physics.redstring   # or an explicit path
# ...edit locally...
redstring push                                # commit the active universe back to its linked repo
```

`pull` discovers `.redstring` files at the repo root and one level under
`universes/`. `push` writes to the universe's linked path (defaulting to
`universes/<slug>/<slug>.redstring`). This is **API-based** (the GitHub Contents
API over `fetch`) — no local `git` binary and no cloning.

## Truth model

**Runtime-canonical-when-present.** If a background Redstring is running it owns
the file; the browser hydrates from it and forwards edits. With nothing running,
the browser behaves exactly as before.

## Architecture

```
        src/store/graphStore.js            the real Zustand store (unchanged logic)
        src/services/
          bridgeStateSerializer.js         buildBridgeState — the MCP read contract
          toolResultApplier.js             applyToolResultToStore (tool/MCP mutations)
          storeActions.js                  createStoreActions (bridge action handlers) + priority()
          daemonCoexistence.js             browser controller for coexistence with a running instance
        src/headless/
          nodeEnvironment.js               installs the localStorage shim (Node only)
          createHeadlessStore.js           shim → dynamic-import the store (one per process)
          config.js                        ~/.redstring/config.json — workspace, port, token
          HeadlessUniverse.js              owns a .redstring file: load + atomic debounced save + lock
          HeadlessWorkspace.js             a folder of universes: registry, create/list/switch/rm
          githubSync.js                    lean Node GitHub Contents-API client (pull/push)
          runtime.js                       store + workspace + in-process action executor
                    │
   ┌────────────────┼───────────────────────┐
Browser SPA     wizard-server.js         cli/redstring.js
(unchanged)     (background on :3001)     (HTTP or direct-library)
                    ▲
                    │  HTTP /api/bridge/* + /api/store/* + /api/workspace/*
             redstring-mcp-server.js
```

Headless is **opt-in**: `wizard-server.js` only serves a workspace when a
workspace/universe is explicitly configured (via `--workspace`/`--universe` or
`REDSTRING_WORKSPACE`/`REDSTRING_UNIVERSE`). With none set it stays in its
original browser-relay mode (zero change), so `npm run wizard` for the Electron
bridge is unaffected.

## HTTP endpoints

| Endpoint | Purpose |
|---|---|
| `GET  /api/bridge/health` | `{ headless, storeMode, workspace, activeUniverse, stateVersion }` |
| `GET  /api/bridge/state` | live store as the MCP-contract bridge payload |
| `POST /api/bridge/pending-actions/enqueue` | execute actions in-process (priority-ordered) |
| `GET  /api/bridge/action-status/:id` | poll a mutation to completion |
| `GET  /api/store/export` | full lossless universe JSON |
| `POST /api/store/save` | force a flush to disk |
| `POST /api/store/import` | browser→runtime forward-edit (optimistic `baseVersion`, 409 on conflict) |
| `GET  /api/workspace` | `{ workspace, active, universes[] }` |
| `POST /api/workspace/universes` | create a universe `{ name }` |
| `POST /api/workspace/active` | switch active `{ slug }` |
| `DELETE /api/workspace/universes/:slug` | delete (`?keepFile=true` to keep the file) |
| `POST /api/workspace/pull` | import from GitHub `{ repo, name?, activate? }` |
| `POST /api/workspace/push` | publish to GitHub `{ slug?, repo?, message? }` |
| `POST /api/workspace/link` / `unlink` | manage a universe's repo/local slot |

## Persistence

`HeadlessUniverse` subscribes to the store and writes debounced, **atomic**
(`.tmp` + rename) exports. A **shrink guard** refuses to overwrite a non-empty
universe with an empty one. An exclusive **lockfile**
(`~/.redstring/locks/<sha1(path)>.lock`) prevents two processes fighting over one
file (stale locks from dead PIDs are stolen). `SIGINT`/`SIGTERM` flush and
release the lock.

## Coexistence (browser + background instance)

When the browser detects a running headless instance (`health.headless`), the
`daemonCoexistence` controller hydrates from `GET /api/store/export`, suspends
the browser's own file writes, forwards edits via `POST /api/store/import`
(re-hydrating on 409), and re-hydrates when the instance advances (MCP/CLI). When
it disappears, the browser resumes standalone.

## Testing

```bash
npm run test:headless   # vitest, @vitest-environment node — real store, no browser
npm run test:e2e        # smoke + CLI round-trip + MCP-over-HTTP scripts
```

- `test/headless/*.test.js` — store boots in Node; the extracted modules; the
  bridge-state contract; `HeadlessUniverse` persistence/lock/shrink-guard; the
  `HeadlessWorkspace` registry (create/list/switch/rm/reconcile/git pull-push);
  the runtime executor; and coexistence (vs a real background subprocess).
- `test/e2e/cli-roundtrip.sh` — the CLI in both direct and running modes.
- `test/e2e/*smoke*` — boot → HTTP mutations → persistence, and the real MCP
  server (stdio) driving a running instance with no browser.

## Constraints (v1)

- **One active universe per process** — the store is a module singleton.
  Switching is a sequential flush→load (same as the browser).
- **Auto-layout is a no-op headless** — text measurement needs a canvas Node
  lacks; the layout call is caught. Nodes keep their positions; explicit
  positions from mutations are honored.
