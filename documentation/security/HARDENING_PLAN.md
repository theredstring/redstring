# Pre-1.0 security hardening plan

Status: current (opened 2026-09-29). Source: six-way security audit of 2026-09-29. This is the plan the fix areas A1–A7 worked from, with a status column to keep up to date.

- Threats and the invariant tests: [THREAT_MODEL.md](THREAT_MODEL.md)
- The owner's manual steps: [RUNBOOK.md](RUNBOOK.md)
- How the tests are organised: [`test/security/README.md`](../../test/security/README.md)

**Status values:** `in progress` (being fixed), `fixed` (merged; its test passes in CI), `verified` (fixed and smoke-tested on the shipped build), `deferred` (decision pending), `won't fix` (accepted risk, with the reason in THREAT_MODEL.md). When you change a status, change it here in the same commit as the fix.

Platforms: redstring.io (Cloudflare Pages + Pages Functions), Electron (GitHub-release auto-update), iOS/Android (Capacitor), local CLI/MCP. The repo is public.

## Shared contracts

Names are fixed: fixes and invariant tests depend on them. `test/security/invariants/contracts.test.js` checks each exists and behaves as specified.

| ID | Contract | Owner | Status |
|---|---|---|---|
| C-1 | `src/utils/safeUrl.js`: `safeExternalHref(url)` → normalised URL for `https:`/`http:`/`mailto:` only, else `null` (rejects `javascript:`, `data:`, `file:`, `vbscript:`, `blob:`, custom schemes, whitespace/control-character tricks). `safeImageSrc(url)` allows `https:`, `http:`, `blob:`, raster `data:image/(png\|jpeg\|jpg\|gif\|webp\|avif)` only (no SVG data URLs). `openExternalUrl(url)` is the only sanctioned `window.open` in `src/`. | A3 | fixed |
| C-2 | `src/utils/safeColor.js`: `sanitizeColor(value, fallback = null)` accepts hex, `rgb/rgba/hsl/hsla` with numeric args, CSS named colours; rejects `url(`, `;`, braces, other functions, `expression`, `var(`, backslashes, quotes. Pure. | A3 | fixed |
| C-3 | `electron/ipcGuards.cjs`: `isValidStoreName`, `createPathApprovals({ persistPath })` (approve only from main-side dialog results), `isSafeExternalUrl`, `isTrustedSender(event)`. | A2 | fixed |
| C-4 | `electron/updaterSignature.cjs`: `verifyBundleSignature(bundlePath, { teamId, bundleId, exec })` → `{ ok, reason }` via `codesign --verify --deep --strict`, designated requirement (team `24MPFEY5BE`, bundle `io.redstring.app`) and `spctl --assess`. | A2 | fixed |
| C-5 | Electron origin becomes `app://redstring` (privileged scheme + `protocol.handle`), with a lossless one-time migration of `file://`-origin storage. | A2 | fixed |
| C-6 | Local agent server auth: per-launch 32-byte token (`REDSTRING_AGENT_TOKEN`), preload `window.electron.agent.getConnection()`, header `X-Redstring-Token`, shared middleware `src/security/localServerGuard.js` → `createLocalServerGuard({ token, port, allowedOrigins })` (Host, token, Origin never `null`, JSON only). CLI token in `~/.redstring/agent.json` (0600). | A2 + A4 | fixed |
| C-7 | Secrets at rest: `window.electron.secrets = { isAvailable, get, set, delete }` via `safeStorage`; Keychain/Keystore on mobile; `src/utils/secureStore.js` picks the backend, same API. | A2 + A5 | fixed |
| C-8 | CSP `<meta>` in `index.html` for web, Electron and Capacitor. No `'unsafe-eval'`, no `'unsafe-inline'` in `script-src`; header-only directives in `public/_headers`. | A3 | fixed |
| C-9 | `functions/_lib/ownership.ts`: `verifyInstallOwnership(rawId, oauthToken, appJwt, configuredAppId)`, fail closed (user installs: account id matches; org installs: active membership; wrong app, suspended or any GitHub error → deny). Mint uses the verified installation id. | A1 | fixed |

## Areas

| Area | Owns |
|---|---|
| A1 Cloudflare + web auth | `functions/**`, `public/_headers`, `public/_routes.json`, `public/oauth/**`, `wrangler.toml`, `scripts/cf-deploy.sh`, `cloudflare/**`, `oauth-server.js`, GitHub auth services |
| A2 Electron | `electron/**`, `electron-builder.json`, `entitlements.mac.plist`, `.github/workflows/release.yml`, `scripts/publish-release.sh`, Electron deps |
| A3 Renderer untrusted content | `index.html`, `src/utils/safeUrl.js`, `src/utils/safeColor.js`, panel/import/format/wizard-tool sinks |
| A4 Local servers, CLI, data hygiene | MCP/wizard/agent servers, `cli/**`, `src/headless/**`, `src/security/localServerGuard.js`, queue, `vite.config.js` server, deployment and ignore files |
| A5 Mobile, secrets at rest, git sync | `android/**`, `ios/**`, `capacitor.config.ts`, secure storage, auth persistence, git sync guards |
| A6 Security tests, CI, docs | `test/security/invariants/**`, `scripts/security/**`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `SECURITY.md`, `documentation/security/**` |
| A7 Dependencies (after merge) | `package.json` / `package-lock.json` upgrades and removals |

## Findings

"Enforced by" names the repo-wide invariant (`test/security/invariants/`) where one exists; every finding also has behaviour tests in its area folder `test/security/<area>/`.

### A1: Cloudflare Functions and web auth

| ID | Finding | Status | Enforced by |
|---|---|---|---|
| S-01 | **Critical.** `/app/installation-token` minted for any installation when verification was `unverified`/`error`/`skipped`. Fix per C-9. | fixed | `functions/ownership-check`, `functions/attacker-scenarios` |
| S-02 | Legacy `oauth-server.js`: token/installation/create-repository routes lacked the ownership check; listened on all interfaces (with S-52). | fixed | `functions/ownership-check`, `servers/loopback-listen` |
| S-04 | `requireInstallOwnership` fail-open, used by `GET /app/installation/:id` and `POST /app/create-repository`. | fixed | `functions/ownership-check`, `functions/attacker-scenarios` |
| S-05 | `installation_id` accepted from the URL without a pending install; install `state` never checked. | fixed | area tests |
| S-06 | OAuth `state` from `Math.random`, fail-open comparison. | fixed | area tests |
| S-07 | No PKCE on the web OAuth flow. | fixed | area tests |
| S-08 | No rate limiting on `/api/github/*` (plus WAF rule, RUNBOOK). | fixed | area tests |
| S-09 | Error bodies echoed raw GitHub responses and configuration. | fixed | area tests |
| S-10 | `public/debug-viewer.html` shipped to production. | fixed | `web/public-dir`, `check-dist.mjs` |
| S-11 | No security response headers (`public/_headers`). | fixed | `web/headers`, `check-dist.mjs` |
| S-12 | Webhook accepted unsigned deliveries when no secret was set. | fixed | `functions/attacker-scenarios` |
| I-2 | CORS allowed localhost origins in production. | fixed | area tests |

### A2: Electron

| ID | Finding | Status | Enforced by |
|---|---|---|---|
| S-20 | `storage:*` IPC approved renderer-supplied file paths; `userData` was an allowed root. | fixed | `electron/no-renderer-approvals`, `contracts/present` (C-3) |
| S-21 | `getStoragePath(storeName)` path traversal. | fixed | `contracts/present` (C-3), area tests |
| S-22 | `setWindowOpenHandler` and `oauth:start` passed any scheme to `shell.openExternal`; unused `redstring://` handler. | fixed | `electron/open-external` |
| S-23 | No navigation locks, sender checks or permission handlers. | fixed | `electron/ipc-sender`, `electron/navigation-lock`, `electron/web-preferences` |
| S-24 | macOS updater installed without a signature check and stripped quarantine; bash script built by string interpolation. | fixed | `electron/updater-signature`, `electron/updater-argv` |
| S-25 | `debugDowngrade` exposed in packaged builds. | fixed | `electron/dev-only-surface` |
| S-26 | Default fuses; `file://` origin; agent server via `ELECTRON_RUN_AS_NODE`. | fixed | `electron/fuses`, `electron/app-origin`, `electron/no-run-as-node` |
| S-27 | Entitlements allowed unsigned executable memory and disabled library validation. | fixed | `electron/entitlements` |
| S-28 | Electron 39 end-of-life; electron-builder / electron-updater advisories. | fixed | `audit-gate.mjs` (dev deps: `--include-dev`) |
| S-29 | `isDev` from `NODE_ENV`; DevTools in the production menu. | fixed | `electron/is-dev` |
| S-30 | Release workflow: unpinned third-party builder action, broad permissions, Windows signing, re-pushable tags. | fixed | `workflows/*` |
| S-31 | Secrets IPC with `safeStorage` (C-7). | fixed | `contracts/present` (C-7) |

### A3: Renderer, untrusted content

| ID | Finding | Status | Enforced by |
|---|---|---|---|
| S-40 | Any-scheme URLs from graph data reached `window.open` / `<a href>`; substring host matching; unsanitised import. | fixed | `renderer/window-open`, `renderer/anchor-href`, `renderer/navigation`, `renderer/contract-wiring` |
| S-41 | No Content-Security-Policy (C-8). | fixed | `web/csp`, `check-dist.mjs` |
| S-42 | CSS injection through node/prototype colours (`style`, `cssText`), on import and via wizard tools. | fixed | `renderer/css-string-from-data`, `renderer/contract-wiring` |
| S-43 | Wizard prompt injection: any-scheme identifier links; destructive tools without confirmation. | fixed | `renderer/contract-wiring`, area tests |
| S-44 | `innerHTML` on Wikipedia HTML. | fixed | `renderer/html-injection` |
| S-45 | jsonld default document loader fetched remote `@context`. | fixed | area tests |
| S-46 | Image URLs from files rendered unchecked. | fixed | `renderer/contract-wiring` |
| S-47 | `apiKeyOverride` in `prototype.agentConfig` would be exported. | fixed | area tests |
| S-48 | External universe loader: unbounded body, http allowed. | fixed | area tests |

### A4: Local servers, CLI, data hygiene

| ID | Finding | Status | Enforced by |
|---|---|---|---|
| S-50 | MCP server: open CORS, urlencoded bodies, unauthenticated `/api/mcp/request` on :3003. | fixed | `servers/no-open-cors`, `servers/local-guard`, `servers/mcp-http-opt-in` |
| S-51 | Wizard/agent server: no auth, no Host check (DNS rebinding); state-changing GET. | fixed | `servers/local-guard`, `contracts/present` (C-6) |
| S-52 | `oauth-server.js` listened on all interfaces. | fixed | `servers/loopback-listen` |
| S-53 | `deployment/app-semantic-server.js`: unauthenticated writes, public analytics, proxies without Authorization. | fixed | `servers/loopback-listen`, area tests |
| S-54 | Queue journal wrote `meta.apiKey` to `data/queues/*.jsonl` (two keys leaked into history). | fixed | `servers/queue-journal-secrets`, `secret-scan.mjs` |
| S-55 | CLI config file permissions, token on the command line, `localFile.path` traversal. | fixed | area tests |
| S-56 | 20 MB body limits; unbounded SSE clients. | fixed | area tests |
| S-57 | `debugLogger` posted LLM output to 127.0.0.1:7242 in production. | fixed | `check-dist.mjs` |
| S-58 | Vite dev server on all interfaces serving the project root. | fixed | `servers/vite-dev-exposure` |
| S-59 | `.dockerignore` / `.gcloudignore` missed secret files. | fixed | `repo/ignore-files` |
| S-60 | `data/analytics/*.json` tracked; absolute home paths in two files. | fixed | `repo/tracked-secrets` |

### A5: Mobile, secrets at rest, git sync

| ID | Finding | Status | Enforced by |
|---|---|---|---|
| S-70 | Android `allowBackup="true"`; no backup / data-extraction exclusion rules. | fixed | `mobile/android-manifest` |
| S-71 | Tokens and BYOK keys in WebView localStorage. | fixed | area tests |
| S-72 | `github_app_user_token` unencrypted and not cleared on disconnect. | fixed | area tests |
| S-73 | Disconnect doesn't revoke at GitHub; refresh token discarded. | fixed | area tests |
| S-74 | Tokens posted to a localhost endpoint where nothing legitimate listens (Electron). | fixed | area tests |
| S-75 | Empty-write guard decided "file absent" from a message substring. | fixed | `sync/not-found-structured` |
| S-76 | Slug collision when linking a discovered universe overwrote a local universe's repo link. | fixed | area tests |
| S-77 | Android universes in external storage. | fixed | area tests |
| S-78 | Git reads up to 100 MB. | fixed | area tests |
| S-79 | iOS privacy manifest, export-compliance and device-capability keys. | fixed | `mobile/ios-plist` |
| S-80 | Android target/compile SDK 35 → 36. | fixed | area tests / RUNBOOK 17 |
| S-81 | No consent before sending graph content to a third-party LLM; no way to report AI output. | fixed | `ai/consent-gate` |
| S-82 | `.redstring` document type declared on iOS with no handler. | fixed | area tests |
| S-83 | LGPL `heic-to` in store builds; third-party notices with an LGPL source offer for web/desktop. | fixed | `mobile/no-lgpl-in-store-builds`, `scripts/security/third-party-notices.mjs` |
| S-84 | `FileProvider` exposed all external storage. | fixed | area tests |
| S-85 | OAuth App `repo` scope / device-flow phishing. | won't fix | accepted for 1.0; reason in THREAT_MODEL.md (adding a repo would need GitHub's settings page) |

### A6: Tests, CI, documentation

| Item | Status |
|---|---|
| Invariant suite `test/security/invariants/` with allowlist | fixed |
| `scripts/security/secret-scan.mjs` (tracked, `--staged`, `--history`), `audit-gate.mjs`, `check-dist.mjs`, `third-party-notices.mjs`, opt-in pre-commit hook | fixed |
| CI `security` job, top-level permissions, SHA-pinned actions, weekly history scan + audit, Dependabot, CODEOWNERS | fixed |
| `SECURITY.md`, THREAT_MODEL, RUNBOOK, this plan | fixed |

### A7: Dependencies (after merge)

| Item | Status |
|---|---|
| hono ≥ 4.12.25 (CORS advisory) and ≥ 4.13.5 per plan | fixed |
| xlsx → SheetJS 0.20.3 tarball with integrity (done); jsonld 8 → 9 clears the undici advisories | fixed |
| vite ≥ 5.4.21, dompurify ≥ 3.4.13, express latest 4.x | fixed |
| Remove unused `@inrupt/*` (removed; only dead `Federation.jsx`/`DynamicFederation.jsx` imported it). `rdflib` kept: `deployment/app-semantic-server.js` uses it | fixed |
| `npm audit fix` for the remaining runtime advisories (`@modelcontextprotocol/sdk`, `@xmldom/xmldom`, `fast-uri`, `js-yaml`, `jws`, `lodash`, `path-to-regexp`, `ip-address`, `undici`, `builder-util-runtime`, `serialize-javascript`) until `node scripts/security/audit-gate.mjs` passes | fixed |
| `package.json` scripts `security:scan`, `security:test`, `security:audit`, `security:dist`, `security:notices`, `security:all`; explicit devDependencies for the tooling (`@babel/parser`, `@babel/traverse`, `js-yaml`, `ignore`, `picomatch`) | fixed |

## Owner actions (RUNBOOK)

| # | Action | Status |
|---|---|---|
| 1 | Rotate the Test OAuth App secret; confirm the `b15138…` and `0cfeba…` secrets are dead | fixed |
| 2 | Revoke OpenRouter keys `sk-or-v1-053…`, `sk-or-v1-be3…`, the WIZARD_KEY key and the chat-pasted key | fixed |
| 3 | Allowlist the revoked keys' fingerprints so the weekly history scan is green | fixed |
| 4 | Delete local `data/queues/*.jsonl` | fixed |
| 5 | Commit the removal of `data/analytics/` from git | fixed |
| 6 | Deploy the fixed Functions: staging, smoke test, production | fixed |
| 7 | Rotate the GitHub App private key in both Pages projects (and delete the old one) | fixed |
| 8 | Set `GITHUB_APP_WEBHOOK_SECRET` on both Pages projects | fixed |
| 9 | Delete old Pages deployments (or Cloudflare Access on `*.pages.dev`) | fixed |
| 10 | Cloudflare WAF rate-limit rules for `/api/github/*` | fixed |
| 11 | Delete legacy Cloud Run services, secrets and build triggers | fixed |
| 12 | Enable secret scanning, push protection, private vulnerability reporting, Dependabot alerts | fixed |
| 13 | Require the `security` check on `main` | fixed |
| 14 | (Optional) install the pre-commit secret check | fixed |
| 15 | Windows code-signing certificate check | fixed |
| 16 | Confirm Electron fuses and the storage migration on the next release | fixed |
| 17 | Play Console target API level; JDK 21; edge-to-edge check | fixed |
| 18 | App Store privacy label, export compliance, Play data safety | fixed |
| 19 | Ship `THIRD_PARTY_NOTICES.txt` in every build | fixed |
