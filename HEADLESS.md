# Headless Redstring

Redstring's knowledge graph normally lives in a browser-side Zustand store. The
**headless** stack runs that *same* store in Node — as a persistent daemon, a
CLI, or under the MCP server — so the graph is fully functional without a
browser. Changes persist to a `.redstring` file and (optionally) sync back to
the UI when it's open.

This is a **library-first extraction**: the browser, daemon, CLI, and MCP server
all host one environment-agnostic core. The hosted static-SPA deployment
(Cloudflare Pages) never imports any of the headless code — the daemon is purely
optional and local.

## Truth model

**Daemon-canonical-when-present.** If a daemon is running it owns the file; the
browser hydrates from it and forwards edits. With no daemon, the browser behaves
exactly as before.

## Architecture

```
        src/store/graphStore.js            the real Zustand store (unchanged logic)
        src/services/
          bridgeStateSerializer.js         buildBridgeState — the MCP read contract
          toolResultApplier.js             applyToolResultToStore (tool/MCP mutations)
          storeActions.js                  createStoreActions (bridge action handlers) + priority()
          daemonCoexistence.js             browser controller for daemon coexistence
        src/headless/
          nodeEnvironment.js               installs the localStorage shim (Node only)
          createHeadlessStore.js           shim → dynamic-import the store (one per process)
          HeadlessUniverse.js              owns a .redstring file: load + atomic debounced save + lock
          daemonRuntime.js                 store + universe + in-process action executor
                    │
   ┌────────────────┼───────────────────────┐
Browser SPA     wizard-server.js         cli/redstring.js
(unchanged)     (daemon on :3001)        (HTTP or direct-library)
                    ▲
                    │  HTTP /api/bridge/* + /api/store/*
             redstring-mcp-server.js
```

## Quick start

### Run the daemon

```bash
# point it at a universe file (created if missing)
REDSTRING_UNIVERSE=~/graphs/my.redstring npm run daemon
# or
node wizard-server.js --universe ~/graphs/my.redstring
```

Universe resolution order: `--universe` → `REDSTRING_UNIVERSE` →
`~/.redstring/daemon.json` (`{ "universe": "..." }`). With none configured the
server runs in its original browser-relay mode (zero change).

### Use the CLI

The CLI auto-detects a running daemon (HTTP mode); otherwise it runs the store
itself against `--universe` (direct-library mode).

```bash
node cli/redstring.js --universe ~/graphs/my.redstring graph create "Solar System"
node cli/redstring.js --universe ~/graphs/my.redstring node create "Sun"  --graph <graphId>
node cli/redstring.js --universe ~/graphs/my.redstring node create "Earth" --graph <graphId>
node cli/redstring.js --universe ~/graphs/my.redstring edge create "Sun" "Earth" --graph <graphId> --type orbits
node cli/redstring.js --universe ~/graphs/my.redstring state
node cli/redstring.js --universe ~/graphs/my.redstring export --out backup.json
```

Commands: `daemon start|stop|status`, `universe create|info`,
`graph list|create|show`, `node create|list`, `edge create`, `search`,
`apply <specs.json|->`, `export`, `state`. Add `--json` for machine output.
(All store/handler logging goes to **stderr**; stdout is clean.)

### MCP server against the daemon

The MCP server is a pure HTTP client of the bridge. Start the daemon, then run
the MCP server pointed at the same port:

```bash
REDSTRING_UNIVERSE=~/graphs/my.redstring npm run daemon &
BRIDGE_PORT=3001 node redstring-mcp-server.js     # no browser needed
```

## HTTP endpoints (daemon mode)

| Endpoint | Purpose |
|---|---|
| `GET  /api/bridge/health` | `{ headless, storeMode, universe, stateVersion }` |
| `GET  /api/bridge/state` | live store as the MCP-contract bridge payload |
| `POST /api/bridge/pending-actions/enqueue` | execute actions in-process (priority-ordered), mark `action-status` completed |
| `GET  /api/bridge/action-status/:id` | poll a mutation to completion |
| `GET  /api/store/export` | full lossless universe JSON |
| `POST /api/store/save` | force a flush to disk |
| `GET  /api/store/status` | counts + version |
| `POST /api/store/import` | browser→daemon forward-edit (optimistic `baseVersion`, 409 on conflict) |

## Persistence

`HeadlessUniverse` subscribes to the store and writes debounced, **atomic**
(`.tmp` + rename) exports. A **shrink guard** refuses to overwrite a non-empty
universe with an empty one. An exclusive **lockfile**
(`~/.redstring/locks/<sha1(path)>.lock`) prevents two daemons fighting over one
file (stale locks from dead PIDs are stolen). `SIGINT`/`SIGTERM` flush and
release the lock.

## Coexistence (browser + daemon)

When the browser detects a headless daemon (`health.headless`), the
`daemonCoexistence` controller hydrates from `GET /api/store/export`, suspends
the browser's own file writes (`saveCoordinator.setEnabled(false)`), forwards
edits via `POST /api/store/import` (re-hydrating on 409), and re-hydrates when
the daemon advances (MCP/CLI). When the daemon disappears it resumes standalone.
In headless mode `GET /api/bridge/pending-actions` returns `[]` so the browser
never double-executes actions the daemon already ran.

## Testing

```bash
npm run test:headless   # vitest, @vitest-environment node — real store, no browser
npm run test:e2e        # daemon-smoke.sh + cli-roundtrip.sh + mcp-daemon-smoke.mjs
```

- `test/headless/*.test.js` — store boots in Node, the extracted modules, the
  bridge-state shape contract, HeadlessUniverse persistence/lock/shrink-guard,
  the daemon runtime executor, and the coexistence controller (vs a real daemon
  subprocess).
- `test/e2e/daemon-smoke.sh` — boot → HTTP mutations → state → import/conflict →
  SIGTERM → on-disk assert → restart persistence.
- `test/e2e/cli-roundtrip.sh` — CLI in both direct and daemon modes.
- `test/e2e/mcp-daemon-smoke.mjs` — the real MCP server (stdio) driving the
  daemon with no browser.

## Constraints (v1)

- **One universe per daemon process** — the store is a module singleton. Run one
  daemon per universe (the CLI's `daemon start` manages a pidfile).
- **Auto-layout is a no-op headless** — text measurement needs a canvas that Node
  lacks; the layout call is caught. Nodes keep their positions; explicit
  positions from mutations are honored.
