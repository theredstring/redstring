# Security runbook: Grant's manual steps

Status: current (2026-09-29). These are the steps from the pre-1.0 security sweep that only the account owner can do: they happen in GitHub, Cloudflare, Google Cloud, OpenRouter, Apple or Google dashboards, not in code. Each step says what to do, then how to check it's done.

Tick them off in [HARDENING_PLAN.md](HARDENING_PLAN.md) → "Owner actions" as you go.

**Safety habit for this whole page:** never paste a key into a command line directly (it lands in shell history). Read it into a variable first:

```bash
read -rs KEY   # paste, press Enter; nothing is shown
```

and use `"$KEY"` in the command. Run `unset KEY` afterwards.

---

## Do first: leaked keys (the repo is public, so assume they're already harvested)

### 1. Rotate the Test OAuth App secret, confirm the older one is dead

Two OAuth client secrets are in the public git history of `.env`: one starting `b15138…` (2025-10-23) and one starting `0cfeba…` (2025-08-03).

1. github.com → your avatar → **Settings → Developer settings → OAuth Apps** → open the Test/dev OAuth App.
2. Under **Client secrets**, click **Generate a new client secret**. Copy it.
3. Put it where the app reads it:
   ```bash
   npx wrangler pages secret put GITHUB_CLIENT_SECRET --project-name=redstring-staging
   ```
   (paste when asked). If the production OAuth App ever used either secret, repeat for `--project-name=redstring-prod` with that app's new secret.
4. Back on the OAuth App page, **Delete** every older secret, leaving only the new one.

**Check it's done:** the OAuth App page lists exactly one secret, created today. Then test each old secret against GitHub (a valid secret answers `bad_verification_code`, a dead one `incorrect_client_credentials`):

```bash
read -rs OLD
curl -s -X POST https://github.com/login/oauth/access_token -H 'Accept: application/json' \
  -d client_id=<the app's client id> -d client_secret="$OLD" -d code=not-a-real-code
unset OLD
```

Both old secrets must print `incorrect_client_credentials`. Signing in with GitHub on redstring-staging.pages.dev still works.

### 2. Revoke the OpenRouter keys

Revoke all four: the two in git history (they start `sk-or-v1-053…` and `sk-or-v1-be3…`, from `data/queues/*.jsonl`, 2025-11-17), the key currently in your local `WIZARD_KEY.txt`, and the key that was pasted into a chat.

1. openrouter.ai → **Settings → Keys**. Delete every key matching those prefixes, and the WIZARD_KEY and chat ones. (If you can't tell which is which, delete them all and make one new key.)
2. Create a new key for yourself. Put it only in `WIZARD_KEY.txt` (gitignored) and in the app's AI settings. Never in a file git tracks.

**Check it's done:** for each old key,

```bash
read -rs OLD
curl -s -o /dev/null -w '%{http_code}\n' https://openrouter.ai/api/v1/key -H "Authorization: Bearer $OLD"
unset OLD
```

prints `401`. The new key prints `200`. The OpenRouter activity page shows no usage you don't recognise (if it does, also check your billing).

### 3. Mark the revoked keys as handled in the weekly history scan

History can't be un-published, so the weekly CI job (`security-weekly`) will keep reporting these keys until they're allowlisted **as revoked**. Only do this after steps 1 and 2.

```bash
node scripts/security/secret-scan.mjs --history
```

For each line it prints, copy the `fp:` value into `scripts/security/secret-scan-allowlist.json`:

```json
{ "fingerprint": "<the 16 hex characters>", "reason": "OpenRouter key sk-or-v1-053…, revoked 2026-10-01" }
```

(The fingerprint is a one-way hash, safe to commit; it can't be turned back into the key.)

**Check it's done:** `node scripts/security/secret-scan.mjs --history` prints `clean` and exits 0.

### 4. Delete the local queue journals

`data/queues/*.jsonl` is where those OpenRouter keys leaked from. The code no longer writes keys there (S-54), but old files on disk still hold them. In every checkout of the repo (main folder and any worktrees):

```bash
rm -f data/queues/*.jsonl
```

**Check it's done:** `ls data/queues` shows no `.jsonl` files, and `grep -rl "sk-or-v1-" data/ 2>/dev/null` prints nothing.

### 5. Stop tracking the analytics files

`data/analytics/users.json` and `sessions.json` (GitHub logins and IDs) are committed. The fix stages their removal; you commit it:

```bash
git rm --cached -r data/analytics   # if not already staged
git commit -m "Stop tracking analytics data"
```

**Check it's done:** `git ls-files data/analytics` prints nothing, and `npx vitest run test/security/invariants/ignore-files.test.js` passes. (They stay in history; they're user IDs, not credentials, so a history rewrite isn't worth the disruption.)

---

## GitHub App and Cloudflare

### 6. Deploy the fixed Functions: staging first, then production

The GitHub routes changed (ownership check, PKCE, webhook, rate limit, headers). Deploy in this order:

1. `npm run cf:deploy:dev` (staging). The deploy script refuses a `dist/` that contains debug/test pages, `.env*` or `*.pem`, requires `dist/_headers`, and afterwards checks that an unauthenticated token mint is refused (`401`).
2. Smoke-test on https://redstring-staging.pages.dev: connect GitHub (web OAuth), connect your personal GitHub App installation, start an org install (it should redirect to GitHub and back), sync a universe.
3. `npm run cf:deploy:prod` and repeat the smoke test on redstring.io.
4. Only if you develop against staging from `localhost`: set `ALLOW_LOCALHOST_ORIGINS=true` on **redstring-staging only** (`npx wrangler pages secret put ALLOW_LOCALHOST_ORIGINS --project-name=redstring-staging`, value `true`). Never on production.

**Check it's done:** both smoke tests pass, and
`curl -s -o /dev/null -w '%{http_code}\n' -X POST https://redstring.io/api/github/app/installation-token -H 'content-type: application/json' -d '{"installation_id":1}'` prints `401`.

### 7. Rotate the GitHub App private key

The GitHub App private key can mint tokens for every installation. Rotate it because the legacy servers held copies and the token-minting route was open (S-01). Do it right after step 6: deleting the old key at GitHub also stops every old, still-reachable deployment from minting tokens.

1. github.com → **Settings → Developer settings → GitHub Apps** → the Redstring App → **Private keys → Generate a private key**. A `.pem` downloads.
2. Put it in both Pages projects (the command reads the file, so the key never hits your shell history):
   ```bash
   npx wrangler pages secret put GITHUB_APP_PRIVATE_KEY --project-name=redstring-prod < ~/Downloads/<app-name>.<date>.private-key.pem
   npx wrangler pages secret put GITHUB_APP_PRIVATE_KEY --project-name=redstring-staging < ~/Downloads/<dev-app-name>.<date>.private-key.pem
   ```
   (Staging uses the dev GitHub App's key if you have a separate dev App; see `cloudflare/README.md`.)
3. Redeploy both (`npm run cf:deploy:staging`, then `npm run cf:deploy:prod`) so the Functions pick up the secret, and check "Connect GitHub" works on each.
4. Back on the App page, **Delete** the old private key(s).
5. Delete the downloaded `.pem` from Downloads (and empty the Trash).

**Check it's done:** the App page lists exactly one private key with today's date. On redstring.io, connecting GitHub and syncing a universe works.

### 8. Set the webhook secret on both projects

Webhook deliveries are now refused (`503`) until a secret is configured (S-12).

1. Generate one: `openssl rand -hex 32`.
2. GitHub App settings → **Webhook secret** → paste → Save (for each App whose webhook points at a project).
3. ```bash
   npx wrangler pages secret put GITHUB_APP_WEBHOOK_SECRET --project-name=redstring-prod
   npx wrangler pages secret put GITHUB_APP_WEBHOOK_SECRET --project-name=redstring-staging
   ```
   (the value that matches the App each project serves), then redeploy both.

**Check it's done:** GitHub App → **Advanced → Recent Deliveries** → pick one → **Redeliver** → response `200`. And an unsigned request is refused:
`curl -s -o /dev/null -w '%{http_code}\n' -X POST https://redstring.io/api/github/app/webhook -d '{}'` prints `401`.

### 9. Remove old Pages deployments (after step 6)

Every old deployment stays reachable at its own `https://<hash>.redstring-prod.pages.dev` URL, still running the vulnerable token-minting code. Do this **after** the fixed version is live.

```bash
npx wrangler pages deployment list --project-name=redstring-prod
npx wrangler pages deployment delete <deployment-id> --project-name=redstring-prod   # each one older than the fix
```

Repeat for `redstring-staging`. Keep the current production deployment. (Alternative if there are too many: Cloudflare dashboard → **Zero Trust → Access → Applications → Add** → self-hosted, domain `*.redstring-prod.pages.dev`, allow only your email. That puts a login in front of every preview URL.)

**Check it's done:** the deployment list shows only deployments from after the fix. For one old URL you noted:
`curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<old-hash>.redstring-prod.pages.dev/api/github/app/installation-token -H 'content-type: application/json' -d '{"installation_id":1}'` → `404` (deleted) or `302/403` (Access).

### 10. Add rate-limit rules for the API

The Functions have a best-effort, per-instance limiter; Cloudflare's WAF is the real one.

Cloudflare dashboard → the **redstring.io** zone → **Security → WAF → Rate limiting rules → Create rule**. Two rules, both counting **per IP**, action **Block** for **60 seconds**:

1. `api-github-sensitive`: **60 requests / 1 minute** when the path is a token or installation route. Expression (Edit expression):
   ```
   http.request.uri.path eq "/api/github/app/installation-token" or http.request.uri.path eq "/api/github/oauth/token" or starts_with(http.request.uri.path, "/api/github/app/installation/")
   ```
2. `api-github`: **300 requests / 1 minute** for everything else under the API:
   ```
   http.request.uri.path wildcard "/api/github/*"
   ```
   Put rule 1 above rule 2.

**Check it's done:** both rules are listed as Active. From your machine:
`for i in $(seq 70); do curl -s -o /dev/null -w '%{http_code}\n' -X POST https://redstring.io/api/github/oauth/token -d '{}'; done | sort | uniq -c` shows some `429`s near the end (you're blocked for a minute afterwards).

---

## Legacy Google Cloud

### 11. Shut down the old Cloud Run services and their secrets

The GCP deployment is retired but may still be running with the GitHub App key and OAuth secrets, and some services allowed unauthenticated access.

```bash
gcloud config set project <your project id>          # gcloud projects list, if unsure
gcloud run services list                             # all regions
gcloud run services delete <name> --region <region>  # for each Redstring service
gcloud secrets list
gcloud secrets delete <name>                         # for each GitHub/OAuth/OpenRouter secret
gcloud builds triggers list                          # delete any trigger that would redeploy:
gcloud builds triggers delete <trigger-id>
```

If nothing else in the project is needed, **IAM & Admin → Settings → Shut down** the whole project instead (30-day grace period).

The deploy scripts in `deployment/gcp/` and the `cloudbuild*.yaml` files are kept for reference but now refuse to run unless you set `REDSTRING_ALLOW_LEGACY_GCP=1` (Cloud Build: `--substitutions=_ALLOW_LEGACY_GCP=1`), so nothing redeploys them by accident.

**Check it's done:** `gcloud run services list` and `gcloud secrets list` return nothing Redstring-related, and the old `*.run.app` URLs you used to hit return `404`.

---

## GitHub repository settings

### 12. Turn on GitHub's security features

github.com/theredstring/redstring → **Settings → Code security** (called "Advanced Security" on some accounts). Enable:
- **Private vulnerability reporting** (SECURITY.md sends reporters there)
- **Dependabot alerts** and **Dependabot security updates** (`.github/dependabot.yml` handles regular version updates)
- **Secret scanning** and **Push protection** (blocks a push that contains a known key format)

**Check it's done:** the repo's **Security** tab shows a **Report a vulnerability** button; `gh api repos/theredstring/redstring --jq .security_and_analysis` shows `"status":"enabled"` for secret scanning and push protection.

### 13. Require the security check on main

**Settings → Rules → Rulesets → New branch ruleset** (or **Branches → Add rule** on older UI) for `main`:
- **Require status checks to pass**: add `security` and `test` (they appear after CI has run once with the new workflow).
- **Block force pushes**.
- Leave "Require review from Code Owners" **off** while you're the only maintainer (you can't approve your own PR). `.github/CODEOWNERS` still marks the security-sensitive paths for later.

**Check it's done:** open any PR: `security` shows as **Required**. The rule is listed as Active.

### 14. (Optional) Install the pre-commit secret check on your machine

```bash
node scripts/security/install-pre-commit-hook.mjs
```

Every `git commit` then scans the staged changes for keys first. `--uninstall` removes it.

**Check it's done:** stage a file containing `sk-or-v1-` followed by 64 `a`s and try to commit: it's refused. Unstage it.

---

## Release signing and stores

### 15. Windows code signing

Windows builds should be signed so SmartScreen doesn't warn and the auto-updater can verify them.

1. GitHub repo → **Settings → Secrets and variables → Actions**: check `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` (or `CSC_LINK` used for Windows) exist.
2. Check the certificate's expiry date with whoever issued it (or `openssl pkcs12 -in cert.p12 -nokeys | openssl x509 -noout -enddate`).

**Check it's done:** on the next release, on Windows, right-click the installer → **Properties → Digital Signatures** shows your name and "This digital signature is OK". Or in PowerShell: `Get-AuthenticodeSignature .\Redstring-win-x64.exe` → `Status: Valid`.

### 16. Confirm the Electron fuses on the next macOS release

```bash
npx @electron/fuses read --app /Applications/Redstring.app
```

**Check it's done:** it shows `RunAsNode is Disabled`, `EnableNodeOptionsEnvironmentVariable is Disabled`, `EnableNodeCliInspectArguments is Disabled`, `EnableEmbeddedAsarIntegrityValidation is Enabled`, `OnlyLoadAppFromAsar is Enabled`, `GrantFileProtocolExtraPrivileges is Disabled`, `EnableCookieEncryption is Enabled`. And after updating from the previous version, your linked universes and saved AI key are still there (the one-time storage migration worked).

### 17. Google Play target API level

Play requires new app updates to target a recent Android API level (the deadline moves every August).

Play Console → the app → **Policy and programs → App content** (or **Policy status**) → look for a "Target API level" warning.

**Check it's done:** no target-API warning in Play Console, and `grep targetSdkVersion android/variables.gradle` shows the level Play currently requires (36 as of this sweep).

Two things to know when building:
- Android builds need **JDK 21**. JDK 25 breaks Gradle 8.11.1. (`java -version` should say 21; in Android Studio: Settings → Build Tools → Gradle → Gradle JDK.)
- Targeting 36 makes Android 16 draw the app **edge to edge**. On an Android 16 device or emulator, check nothing sits under the status bar or the gesture bar (header, panels, the bottom of the canvas).

### 18. App Store and Play store answers

When you submit the next mobile build:
- **App Store Connect → App Privacy:** "Data Not Collected". Redstring has no analytics; graphs, tokens and keys stay on the device or go to services the user chose (their GitHub, their AI provider).
- **Export compliance:** "No" (the app only uses the OS's standard encryption; `ITSAppUsesNonExemptEncryption` is already `false` in `Info.plist`, so the question may not appear).
- **Play Console → Data safety:** no data collected or shared by the developer; data is encrypted in transit.
- **Support note:** on iOS, Keychain items survive deleting the app. A user who deletes and reinstalls is still signed in to GitHub until they disconnect in the app.

**Check it's done:** the build is accepted without a privacy-manifest or export-compliance query, and the store listing shows "Data Not Collected" / "No data collected".

### 19. Ship the third-party notices

Every build must carry the open-source licence notices, and `heic-to` (it bundles LGPL-3.0 libheif) needs a written source offer. The generator reads `node_modules`, no network:

```bash
npm run build
node scripts/security/third-party-notices.mjs --out dist/THIRD_PARTY_NOTICES.txt
# mobile store builds leave heic-to out (it is replaced by a stub there):
npm run build:cap
node scripts/security/third-party-notices.mjs --capacitor --out dist/THIRD_PARTY_NOTICES.txt
```

(Ideally this becomes part of the build scripts; see the package.json note in HARDENING_PLAN.md, area A7.)

**Check it's done:** `https://redstring.io/THIRD_PARTY_NOTICES.txt` opens and starts with the LGPL source offer; the file is inside the desktop app (`Redstring.app/Contents/Resources/app.asar` contains `dist/THIRD_PARTY_NOTICES.txt`: `npx asar list <path>/app.asar | grep NOTICES`). Consider linking to it from the app's About/Settings screen.

---

## Settings that changed behaviour (reference)

Not actions, just things that work differently after the sweep, in case something looks broken:

| What | Now | If you need the old behaviour |
|---|---|---|
| Local agent server (desktop app, CLI daemon) | Every request needs the per-launch token; the app and CLI handle it. The CLI keeps it in `~/.redstring/agent.json` (owner-only permissions; `REDSTRING_HOME` moves it) | Electron dev on a port other than 4001: set `REDSTRING_AGENT_ALLOWED_ORIGINS` to that origin |
| MCP server over HTTP | Off. Claude Desktop uses stdio and needs nothing | `REDSTRING_MCP_HTTP=1` (still token-protected) |
| `npm run dev` (Vite) | Listens on `localhost` only; secret files are never served | `VITE_HOST=0.0.0.0 npm run dev` to test from a phone on your Wi-Fi (only on a network you trust) |
| Staging Functions and `localhost` | Production never accepts `localhost` origins | `ALLOW_LOCALHOST_ORIGINS=true` on redstring-staging only |
| GitHub webhook | Refused (`503`) until `GITHUB_APP_WEBHOOK_SECRET` is set | Step 8 |
| `deployment/app-semantic-server.js` (Docker) | Binds `127.0.0.1` unless `HOST` is set (the Docker `start.sh` sets `HOST=0.0.0.0`); universe writes return `503` without `UNIVERSE_WRITE_TOKEN`; analytics routes need `ANALYTICS_ADMIN_TOKEN` | Set those env vars on that deployment |
| Legacy GCP deploy scripts | Refuse to run | `REDSTRING_ALLOW_LEGACY_GCP=1` |
