# Redstring threat model

Status: current (2026-09-29, written with the pre-1.0 security hardening sweep). Owner: Grant.
Related: [HARDENING_PLAN.md](HARDENING_PLAN.md) (findings and their status), [RUNBOOK.md](RUNBOOK.md) (manual actions), [`test/security/README.md`](../../test/security/README.md) (how the rules below are tested), [`SECURITY.md`](../../SECURITY.md) (reporting).

Redstring is local-first: there is no Redstring database and no Redstring user account. What an attacker can reach is the user's own device, the user's GitHub account through the tokens Redstring holds, and the user's AI provider key. The repository is public.

## What we protect (assets)

| Asset | Where it lives | Why it matters |
|---|---|---|
| **GitHub tokens**: OAuth user token (`repo` scope), GitHub App user token, installation tokens | Device storage (OS keychain on desktop/mobile, encrypted localStorage on web) | Read/write access to the user's repositories, including ones unrelated to Redstring |
| **GitHub App private key** and OAuth client secrets | Cloudflare Pages secrets (`redstring-prod`, `redstring-staging`); legacy copies in GCP Secret Manager | Mints installation tokens for *every* user who installed the App |
| **BYOK AI keys** (OpenRouter, Anthropic, OpenAI, …) | Device storage, same as GitHub tokens | Costs the user money; can be resold |
| **Users' graphs** (`.redstring` universes) | Local files, browser storage, the user's GitHub repos | Private thinking; loss is worse than exposure for most users |
| **The user's machine** | Desktop app (Electron main process, file IPC, local servers), CLI | Code execution or arbitrary file read/write |
| **The release pipeline** | GitHub Actions (`release.yml`), signing certificates, notarisation credentials, auto-updater | A compromised release is installed automatically on every desktop |

## Who attacks (attackers)

| Attacker | Capability | Typical goal |
|---|---|---|
| **Malicious universe / file author** | Crafts a `.redstring`, RDF, JSON-LD or CSV file, or a GitHub repo the user links, or content the AI wizard reads | Script execution in the app (steal tokens and keys, drive Electron IPC), CSS/URL tricks, prompt injection that makes the wizard delete or rewrite the graph |
| **Drive-by website** | JavaScript in any page the user visits while Redstring runs | Talk to `localhost` servers (agent/wizard :3001, MCP :3003, Vite dev :4001) via fetch, forms or DNS rebinding |
| **Same-network attacker** | Same Wi-Fi / LAN; can observe or tamper with plaintext traffic | Reach servers bound to all interfaces; read cleartext traffic |
| **Malicious GitHub user** | Has their own GitHub account and can call redstring.io's API | Get an installation token for someone else's GitHub App installation (S-01), forge webhooks, inject an `installation_id` into another user's OAuth callback |
| **Compromised dependency or action** | Code in an npm package or a GitHub Action | Run in the release job with the signing keys; ship in the app |
| **Compromised release channel / local malware** | Writes to the update staging directory, or runs as the user | Get an unsigned bundle installed as "Redstring", or use the signed app as a trusted Node runtime (fuses) |
| **Someone with the public repo** | Reads every file and every commit ever pushed | Harvest keys committed in history |

## Trust boundaries by platform

**Web (redstring.io, Cloudflare Pages).** Untrusted: every file, repo and API response the app loads, plus other origins. The SPA is protected by the CSP meta (C-8), response headers in `public/_headers` (framing, HSTS, nosniff), and the URL/colour/HTML sanitizers (C-1, C-2, `sanitizeHtml`). The Pages Functions are the only server: they must never act on a GitHub installation without verifying the caller owns it (C-9), and never trust an unsigned webhook.

**Desktop (Electron).** The renderer is treated as untrusted: it renders attacker-supplied graphs. Boundary: preload (`electron/preload.cjs`) → `ipcMain` handlers. Each handler checks the sender (`isTrustedSender`), file access is limited to app folders and paths the user picked in a main-process dialog (never paths the renderer supplies), external URLs are scheme-checked before `shell.openExternal`, and navigation away from `app://redstring` is blocked. Fuses stop the signed binary being used as a Node runtime. The updater verifies the code signature before swapping bundles. The local agent server requires a per-launch token (C-6), checks Host and Origin, and binds `127.0.0.1`.

**Mobile (Capacitor).** The WebView runs the same untrusted-content defences as web. Secrets go to the Keychain / Keystore, not WebView storage; Android backups exclude app data; no cleartext traffic; files opened from other apps go through the same sanitised import path with a size cap.

**CLI / MCP / local servers.** Anything on the machine can connect to `localhost`, and any website can try. The servers require a token stored in `~/.redstring/agent.json` (mode 0600), check Host and Origin, accept JSON only, and bind loopback. The MCP HTTP listener is off unless `REDSTRING_MCP_HTTP=1` (Claude Desktop uses stdio). Queue journals never persist keys.

**Repository and CI.** Every workflow has least-privilege `permissions`, SHA-pinned actions and no untrusted event text in scripts. Secret scanning runs on every push and weekly over full history; dependency audits gate high/critical advisories in runtime dependencies.

## Secrets and data at rest, per platform

| Platform | Where GitHub tokens and BYOK keys live | Notes |
|---|---|---|
| Web | `src/utils/secureStore.js`: AES-GCM encrypted in localStorage, non-extractable key in IndexedDB | The same browser holds key and ciphertext (see accepted risks) |
| Electron | `window.electron.secrets` → main-process `safeStorage` (OS keychain), files under `<userData>/secrets/`, outside every file-IPC root | One-time lossless migration from the old `file://`-origin storage |
| iOS | Keychain via `@aparajita/capacitor-secure-storage`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, iCloud Keychain sync off | Keychain items survive app deletion: after a reinstall the old token is still there until the user disconnects |
| Android | Android Keystore via the same plugin; `allowBackup="false"` plus backup and data-extraction rules exclude app data | Universes moved from external to app-private storage |

All migrations are verify-then-delete: read the old value, write the new one, read it back, and only then remove the old copy. A failure leaves the old data in place so the next launch retries. The Android universe move keeps a marker, retries, and empties the old folder only after a byte-for-byte comparison.

Repository reads during sync are capped (50 MB web/desktop, 25 MB native) using the listing size before download; a too-large file is "unreadable", never "absent". The empty-write guard decides "absent" only from structured fields (`code`, `name`, and `status` when present), never from message text (`isConfirmedNotFound` in `src/services/emptyWriteGuard.js`).

AI consent: before the first request that sends graph content to a provider, `src/services/aiConsent.js` (logic, UI-free) and `src/ai/aiConsentPrompt.js` (dialog) ask once per provider and host; `localhost` providers never ask. Declining throws `AI_CONSENT_DECLINED` before any network request. The gate is installed with `setLLMRequestGate` in `src/wizard/LLMClient.js`.

## Invariants and the test that enforces each

Each rule id is defined in `test/security/invariants/_lib/rules.js`; its failure message explains why and how to fix. Area suites (`test/security/<area>/`) test the fixes' behaviour in depth.

| Rule | Threat it stops | Test |
|---|---|---|
| `renderer/window-open` | Malicious file → `javascript:`/`file:` URL opened | `invariants/renderer-sinks.test.js` |
| `renderer/anchor-href` | Malicious file → clickable `javascript:` link | `invariants/renderer-sinks.test.js` |
| `renderer/navigation` | `location.href`/`element.href` set to an unvetted URL | `invariants/renderer-sinks.test.js` |
| `renderer/html-injection` | Wikipedia/LLM/file HTML rendered as markup | `invariants/renderer-sinks.test.js` |
| `code/dynamic-eval` | Strings turned into code (also blocked by CSP) | `invariants/renderer-sinks.test.js` |
| `renderer/css-string-from-data` | Node colour injecting CSS via `cssText` | `invariants/renderer-sinks.test.js` |
| `renderer/contract-wiring` | The audited sinks skipping the shared sanitizers | `invariants/renderer-sinks.test.js` |
| `meta/unparseable` | A file the scanner cannot see into | `invariants/renderer-sinks.test.js` |
| `electron/open-external` | Renderer → `shell.openExternal('file:…'/'smb:…')` | `invariants/electron.test.js` |
| `electron/ipc-sender` | Untrusted frame driving file/storage/updater IPC | `invariants/electron.test.js` |
| `electron/no-renderer-approvals` | Renderer planting "approved" file paths (S-20) | `invariants/electron.test.js` |
| `electron/web-preferences` | Renderer given Node or cross-origin powers | `invariants/electron.test.js` |
| `electron/fuses` | Signed app used as a Node runtime by malware | `invariants/electron.test.js` |
| `electron/entitlements` | Unsigned code loaded into the notarised app | `invariants/electron.test.js` |
| `electron/app-origin` | `file://` origin privileges / `Origin: null` | `invariants/electron.test.js` |
| `electron/navigation-lock` | Window navigated to a remote page that keeps the preload API | `invariants/electron.test.js` |
| `electron/dev-only-surface` | Debug downgrade reachable in packaged builds | `invariants/electron.test.js` |
| `electron/is-dev` | `NODE_ENV` flipping a packaged app into dev mode | `invariants/electron.test.js` |
| `electron/no-run-as-node` | Agent server depending on the runAsNode fuse | `invariants/electron.test.js` |
| `electron/updater-signature` | Tampered update bundle installed and de-quarantined | `invariants/electron.test.js` |
| `electron/updater-argv` | Shell injection through a crafted update path | `invariants/electron.test.js` |
| `servers/no-open-cors` | Any website reading local server responses | `invariants/servers.test.js` |
| `servers/loopback-listen` | LAN access to local servers | `invariants/servers.test.js` |
| `servers/local-guard` | Drive-by website / DNS rebinding against the agent and MCP servers | `invariants/servers.test.js` |
| `servers/mcp-http-opt-in` | Always-on MCP HTTP port | `invariants/servers.test.js` |
| `servers/queue-journal-secrets` | API keys written to `data/queues/*.jsonl` (then committed) | `invariants/servers.test.js` |
| `servers/vite-dev-exposure` | Dev server serving `WIZARD_KEY.txt`, `github.env` to the LAN | `invariants/servers.test.js` |
| `functions/ownership-check` | Token minted for someone else's installation (S-01, S-04) | `invariants/functions.test.js` |
| `functions/attacker-scenarios` | S-01 and S-12 replayed against the real handler | `invariants/functions.test.js` |
| `web/headers` | Clickjacking, protocol downgrade, MIME sniffing | `invariants/functions.test.js` |
| `web/public-dir` | Debug/test pages on the production origin | `invariants/functions.test.js` |
| `web/csp` | Injected script running at all | `invariants/csp.test.js` (+ `scripts/security/check-dist.mjs` on the build) |
| `mobile/android-manifest` | Tokens copied off-device via backup; cleartext traffic | `invariants/mobile.test.js` |
| `mobile/ios-plist` | Cleartext traffic; App Store rejection (privacy manifest) | `invariants/mobile.test.js` |
| `mobile/capacitor-config` | Cleartext / mixed content / remote URL in the WebView | `invariants/mobile.test.js` |
| `mobile/no-lgpl-in-store-builds` | LGPL `heic-to`/libheif shipping in App Store / Play binaries | `invariants/mobile.test.js` |
| `sync/not-found-structured` | An ambiguous read (403, 5xx, "404" in a message) treated as "absent", then overwritten with an empty universe | `invariants/sync-and-ai.test.js` |
| `ai/consent-gate` | Graph content sent to a third-party LLM without the user being told | `invariants/sync-and-ai.test.js` |
| `workflows/pinned-actions` | A moved action tag running in the release job | `invariants/workflows.test.js` |
| `workflows/permissions` | Over-privileged `GITHUB_TOKEN` | `invariants/workflows.test.js` |
| `workflows/no-third-party-builder` | Unmaintained action holding signing credentials | `invariants/workflows.test.js` |
| `workflows/script-injection` | PR title/branch name executed in CI | `invariants/workflows.test.js` |
| `repo/ignore-files` | Secrets uploaded via git, docker build or gcloud deploy | `invariants/ignore-files.test.js` |
| `repo/tracked-secrets` | Secret or private-data files committed | `invariants/ignore-files.test.js` |
| `contracts/present` | A shared security helper missing or weakened | `invariants/contracts.test.js` |

Outside the unit tests: `scripts/security/secret-scan.mjs` (tracked files on every CI run, full history weekly), `scripts/security/audit-gate.mjs` (runtime dependency advisories), `scripts/security/check-dist.mjs` (what the build actually ships).

## Accepted and residual risks

- **OAuth `repo` scope and device-flow phishing (S-85)**: the OAuth App token can reach all of a user's repositories. Narrowing it is an owner decision, deferred.
- **Web BYOK keys** are encrypted in browser storage with a key held in the same browser (IndexedDB). This defends against casual disclosure (exports, screenshots of devtools, backups), not against script running in the page; the CSP and sanitizers are the defence there.
- **History is permanent.** Keys that were committed are revoked (RUNBOOK) and fingerprint-allowlisted; they remain readable in git history by design of git.
- **Images from graph data** (`https:`/`http:` in `img-src`) can reveal the user's IP to the image host when a universe is opened. Accepted: remote thumbnails are a core feature.
- **Local malware running as the user** can read anything the user can. Out of scope beyond the fuses and keychain use.
