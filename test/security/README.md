# Security tests

Everything under `test/security/` runs in CI's `security` job (`.github/workflows/ci.yml`) and in the normal `npm run test:ci` gate. Run it locally with:

```bash
npx vitest run test/security                 # everything
npx vitest run test/security/invariants      # only the repo-wide invariants
npx vitest run test/security/invariants/electron.test.js   # one file
```

The threat model these tests defend is in [`documentation/security/THREAT_MODEL.md`](../../documentation/security/THREAT_MODEL.md).

## How it is organised

| Folder | What it tests | Owner area |
|---|---|---|
| `invariants/` | Repo-wide rules that must stay true forever (below). Independent of how each fix was written. | A6 |
| `functions/` | Cloudflare Pages Functions: GitHub App ownership checks, OAuth state/PKCE, webhook, headers | A1 |
| `electron/` | IPC guards, path approvals, updater signature check, fuses, preload surface | A2 |
| `renderer/` | URL/colour sanitizers, import sanitisation, CSP (incl. a Playwright check) | A3 |
| `servers/` | Local agent/MCP servers: token, Host, Origin; queue journal; CLI config; Vite dev server | A4 |
| `mobile/` | Secure storage, git sync guards, Android/iOS manifests, AI consent | A5 |

The area folders test *behaviour* of each fix in depth. `invariants/` is the regression net: small, structural checks that fail the moment someone reintroduces a class of bug anywhere in the repo, not just in the file that was fixed.

### The invariants

Every rule has an id (e.g. `renderer/window-open`) defined once in `invariants/_lib/rules.js` with a title, why it matters, how to fix it and the audit findings it covers. A failing rule prints all of that, plus every offending `file:line`:

```
SECURITY INVARIANT BROKEN [renderer/window-open] window.open() is only called inside src/utils/safeUrl.js
  Why it matters: URLs in universe files are attacker-controlled; javascript:, file: and custom schemes must be filtered before opening.
  How to fix:     Call openExternalUrl(url) from src/utils/safeUrl.js instead of window.open(...).
  Audit refs:     S-40, C-1
  1 violation(s):
    src/components/panel/AboutSection.jsx:446  window.open(href, '_blank')
```

| File | Rules |
|---|---|
| `renderer-sinks.test.js` | `renderer/window-open`, `renderer/anchor-href`, `renderer/navigation`, `renderer/html-injection`, `code/dynamic-eval`, `renderer/css-string-from-data`, `renderer/contract-wiring`, `meta/unparseable` |
| `electron.test.js` | `electron/open-external`, `electron/ipc-sender`, `electron/no-renderer-approvals`, `electron/web-preferences`, `electron/fuses`, `electron/entitlements`, `electron/app-origin`, `electron/navigation-lock`, `electron/dev-only-surface`, `electron/is-dev`, `electron/no-run-as-node`, `electron/updater-signature`, `electron/updater-argv` |
| `servers.test.js` | `servers/no-open-cors`, `servers/loopback-listen`, `servers/local-guard`, `servers/mcp-http-opt-in`, `servers/queue-journal-secrets`, `servers/vite-dev-exposure` |
| `functions.test.js` | `functions/ownership-check`, `functions/attacker-scenarios` (replays S-01 and S-12 against the real handler with a fake GitHub API), `web/headers`, `web/public-dir` |
| `csp.test.js` | `web/csp` |
| `mobile.test.js` | `mobile/android-manifest`, `mobile/ios-plist`, `mobile/capacitor-config`, `mobile/no-lgpl-in-store-builds` |
| `sync-and-ai.test.js` | `sync/not-found-structured`, `ai/consent-gate` |
| `workflows.test.js` | `workflows/pinned-actions`, `workflows/permissions`, `workflows/no-third-party-builder`, `workflows/script-injection` |
| `ignore-files.test.js` | `repo/ignore-files`, `repo/tracked-secrets` |
| `contracts.test.js` | `contracts/present`: the shared modules C-1…C-9 exist at their contract paths and behave as specified |
| `tooling.test.js` | The scripts in `scripts/security/` themselves (patterns, redaction, audit allowlist, CSP checker, check-dist) |
| `allowlist.test.js` | `allowlist.json` is well-formed |

The code checks parse the source with `@babel/parser` and walk the syntax tree (`invariants/_lib/scan.js`), so comments and strings never trigger them, and a value is followed back to where it was defined (`const url = safeExternalHref(x)` then `href={url}` passes). Workflows are parsed as YAML, ignore files with the same matcher git uses. Files scanned are what git would commit: tracked plus new untracked files, minus ignored ones.

## When an invariant fails

1. Read the message: it says what rule, why, and how to fix.
2. Fix the code. That is almost always the answer.
3. Only if the flagged code genuinely cannot be reached by untrusted input, add an exception to `invariants/allowlist.json`:
   ```json
   { "rule": "renderer/anchor-href", "file": "src/ai/components/APIKeySetup.jsx", "contains": "selectedPreset.docsUrl",
     "reason": "selectedPreset is one of the hardcoded presets in apiKeyManager.js; no user or file data reaches it." }
   ```
   `contains` (optional) narrows the entry to violations whose text includes it. The reason must say *why it is safe*, not "false positive". Entries that stop matching fail the test, so delete them when the code changes.

Never "fix" a failure by weakening a rule in `_lib/` or by adding the test to `test/known-failures.json`.

## Adding an invariant

1. Add the rule to `invariants/_lib/rules.js`: id, `title`, `why` (one line), `fix` (what to type), `findings`, `test`.
2. Add an `it(...)` to the matching test file (or a new `*.test.js` beginning with `// @vitest-environment node`). Collect `violation(file, line, text)` objects and end with `assertRule('<id>', found)`.
3. Use the helpers in `_lib/scan.js`: `codeFiles([...prefixes])`, `parseAll`, `traverse` (Babel, with scope info), `importsFrom`, `functionTable` + `reaches` (follows calls through local helper functions), `memberName`, `calleeTail`.
4. Run it against the current code and check that it fails *only* where the bug is. Then fix or allowlist those.
5. Add the rule id to the table in `documentation/security/THREAT_MODEL.md` (a test checks every rule is listed there).

Test fixtures must never contain a string that looks like a real key: assemble fakes at runtime (`` `sk-or-v1-${'0'.repeat(64)}` ``). `scripts/security/secret-scan.mjs` scans the whole repo and would flag them.

## Related tooling (`scripts/security/`)

| Script | What it does |
|---|---|
| `secret-scan.mjs` | Scans tracked files (default), `--staged` changes, or `--history` (every blob in every ref) for API keys, tokens and private keys. Prints only redacted prefixes and fingerprints. Allowlist: `secret-scan-allowlist.json`. |
| `audit-gate.mjs` | `npm audit --omit=dev`; fails on high/critical advisories unless allowlisted with a reason and an expiry in `audit-allowlist.json`. |
| `check-dist.mjs` | After `npm run build`: no secrets, debug pages or key files in `dist/`, CSP meta present and strict, `_headers` present. |
| `install-pre-commit-hook.mjs` | Opt-in git hook that runs `secret-scan --staged` before each commit. |
| `third-party-notices.mjs` | Writes the licence notices (with the LGPL source offer for `heic-to`) for the runtime dependencies, offline. `--capacitor` for store builds. |
