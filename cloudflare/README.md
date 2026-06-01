# Cloudflare Staging Deploy

Parallel staging stack for Redstring on Cloudflare Pages + Pages Functions. Built so that the existing GCP Cloud Run production deployment is untouched — this lives entirely on the `cloudflare-staging` branch and uses the **dev** GitHub credentials.

## What this is

The current production architecture bundles three Node processes (`oauth-server.js`, `bridge-daemon.js`, `app-semantic-server.js`) into one Cloud Run container at CPU 2 / 1Gi. With Redstring's BYOK model (users provide their own Anthropic/OpenAI keys), the bridge daemon and all LLM/enrich/catalog proxies are vestigial — they hide no secret. Only GitHub OAuth + GitHub App endpoints genuinely need a server.

This staging stack replaces that with:

- **Static SPA on Cloudflare Pages** (edge CDN, free tier, no cold starts on page load).
- **One Pages Function** ([`functions/api/github/[[path]].ts`](../functions/api/github/%5B%5Bpath%5D%5D.ts)) handling the ~17 GitHub-related endpoints. Hono for routing, `jose` for GitHub App RS256 JWT signing.
- **Static OAuth callback** ([`public/oauth/callback.html`](../public/oauth/callback.html)) replacing the server-generated callback page.

Expected staging cost: $0/mo (Cloudflare free tier).

## File map

```
wrangler.toml                              # Pages project config (root)
functions/
  _lib/
    env.ts                                 # Env binding type
    jwt.ts                                 # GitHub App JWT signing (jose, PKCS#1→#8 conversion)
    github.ts                              # Installation discovery + verification helpers
  api/github/[[path]].ts                   # Hono router, all endpoints
  tsconfig.json
public/
  oauth/callback.html                      # Static OAuth callback (replaces server HTML)
  _routes.json                             # Route only /api/github/* through Functions
cloudflare/README.md                       # This file
```

## Prerequisites

1. A Cloudflare account.
2. Wrangler CLI authenticated locally:
   ```bash
   npx wrangler login
   ```
3. Existing dev credentials for the GitHub OAuth App + GitHub App. These should already be in your local `.env` / `github.env.local` as `GITHUB_CLIENT_ID_DEV`, `GITHUB_CLIENT_SECRET_DEV`, `GITHUB_APP_ID_DEV`, `GITHUB_APP_PRIVATE_KEY_DEV`, `GITHUB_APP_SLUG_DEV`.

## One-time setup

### 1. Install the new dependencies

```bash
npm install
```

This pulls in `hono`, `jose`, `wrangler`, and `@cloudflare/workers-types`.

### 2. Create the Pages project

```bash
npx wrangler pages project create redstring-staging \
  --production-branch=cloudflare-staging
```

(If you'd rather configure via the dashboard, create a Pages project named `redstring-staging` and connect it to this branch.)

### 3. Set the secrets

Use your **dev** GitHub credentials. Run each command and paste the value when prompted:

```bash
npx wrangler pages secret put GITHUB_CLIENT_ID         --project-name=redstring-staging
npx wrangler pages secret put GITHUB_CLIENT_SECRET     --project-name=redstring-staging
npx wrangler pages secret put GITHUB_APP_ID            --project-name=redstring-staging
npx wrangler pages secret put GITHUB_APP_PRIVATE_KEY   --project-name=redstring-staging
npx wrangler pages secret put GITHUB_APP_SLUG          --project-name=redstring-staging
```

For `GITHUB_APP_PRIVATE_KEY`, paste the **entire PEM** including the `-----BEGIN ... PRIVATE KEY-----` and `-----END ... PRIVATE KEY-----` lines. Both PKCS#1 (`BEGIN RSA PRIVATE KEY`) and PKCS#8 (`BEGIN PRIVATE KEY`) formats are accepted — the Function converts PKCS#1 to PKCS#8 automatically since Workers' Web Crypto only accepts PKCS#8.

### 4. Add the staging callback URL to GitHub

After the first deploy (next step) you'll get a URL like `https://redstring-staging.pages.dev`. Add `https://redstring-staging.pages.dev/oauth/callback` to your **dev** GitHub OAuth App's "Authorization callback URLs" list. Leave the existing prod callback in place — both can coexist.

## Deploy

```bash
npm run cf:deploy:staging
```

This runs `npm run build` (Vite) then `wrangler pages deploy dist --project-name=redstring-staging`. Functions are auto-discovered from `functions/` next to the build output.

First deploy emits the URL. Subsequent pushes to `cloudflare-staging` will auto-build via Cloudflare's Git integration if you wired that up in the dashboard.

## Local development

```bash
npm run cf:dev
```

This builds the SPA and runs `wrangler pages dev dist` locally. Pages dev simulates Pages Functions + static serving on `localhost:8788`. It will prompt for secrets the first time — paste the same dev values.

Hot-reload of the Function code while iterating: edit `functions/api/github/[[path]].ts`, save, Wrangler detects the change. The SPA bundle requires a rebuild (`npm run build`) — or run Vite dev separately at `:4001` and point `VITE_OAUTH_URL=http://localhost:8788` for combined hot reload.

## Logs

```bash
npm run cf:tail:staging
```

Streams live logs from the deployed Pages Function. Useful for debugging the OAuth and App flows.

## Verification checklist

After deploying, walk through this end-to-end. None of it touches prod GCP.

1. **SPA loads**: open `https://redstring-staging.pages.dev`. The Redstring UI appears.
2. **OAuth client-id endpoint works**:
   ```bash
   curl https://redstring-staging.pages.dev/api/github/oauth/client-id
   # → {"clientId":"...","configured":true,"service":"oauth-server"}
   ```
3. **OAuth flow end-to-end**: click "Connect GitHub" in the SPA. The popup opens to `github.com/login/oauth/authorize` with the dev client_id. Authorize. GitHub redirects to `/oauth/callback` (the static HTML). Popup posts the code/state to the opener and closes. SPA exchanges the code via `POST /api/github/oauth/token` and stores the resulting access token in browser localStorage.
4. **GitHub App install + token mint**: install the dev GitHub App on a test repo. SPA calls `GET /api/github/app/installations` (passes the user's OAuth token in `Authorization`). Worker calls GitHub, filters to your App's installations, returns the list. SPA picks one, calls `POST /api/github/app/installation-token`. Worker mints the JWT via `jose`, exchanges for an installation token, returns it. SPA pushes a universe to the repo.
5. **BYOK paths bypass the Worker**: open SPA settings, add an Anthropic API key, run the wizard. DevTools → Network: confirm requests go to `api.anthropic.com` directly, **not** through `redstring-staging.pages.dev/api/wizard`. Same for Wikipedia (`en.wikipedia.org/api/rest_v1/...`) and Wikidata (`query.wikidata.org/sparql`).
6. **Expected 404s** (these are intentional — the proxies are dropped): `/api/wizard`, `/api/ai/*`, `/api/enrich`, `/api/catalog/*`, `/api/bridge/*`, `/api/analytics/*` will all 404. The SPA should handle this gracefully (the bridgeFetch path silently absorbs network failures, and BYOK code paths don't call the proxy at all). If a feature *does* break because it relied on one of these endpoints, file it as a finding — that endpoint either needs to be added to the Worker or the SPA needs to switch to a direct browser call.

## What this does NOT do

- Does not modify `main`, `oauth-server.js`, `bridge-daemon.js`, `app-semantic-server.js`, or any GCP-related file.
- Does not change `redstring.io` DNS or production GitHub App settings.
- Does not delete Cloud Run services, Container Registry images, or Cloud Build triggers.
- Does not implement rate limiting on the Worker — staging URL is obscure; add Cloudflare Rate Limiting before prod cutover.

## Production cutover (not yet)

When staging validation succeeds, the production migration is a separate phase:

1. Add `[env.production]` block to `wrangler.toml` with prod-named secret bindings.
2. Create a `redstring-prod` Pages project, set prod secrets.
3. Add the prod callback URL (`https://redstring.io/oauth/callback`) to the prod GitHub App.
4. Test against prod credentials in a non-prod domain first.
5. Point `redstring.io` DNS to Cloudflare Pages with the prod project. Keep Cloud Run running in parallel — instant rollback is just a DNS change.
6. After 1-2 weeks of confidence, tear down Cloud Run + Container Registry + Cloud Build, delete `bridge-daemon.js` / `app-semantic-server.js` / `oauth-server.js` from the repo.

## Troubleshooting

**"GITHUB_APP_PRIVATE_KEY is not a recognized PEM"**: paste includes the full BEGIN/END lines? PKCS#1 (`BEGIN RSA PRIVATE KEY`) and PKCS#8 (`BEGIN PRIVATE KEY`) both work; anything else (e.g., SSH key format) doesn't.

**`/api/github/app/installations` returns "OAuth token required"**: the SPA must pass `Authorization: token <user_oauth_token>` to this endpoint. This is intentional — listing installs by App JWT alone would leak installs across accounts. If you're calling it from curl, add the header manually.

**"GitHub App credential mismatch" (409)**: the installation belongs to a different App than the one this Worker is configured for (e.g., you installed the prod App but the staging Worker has dev credentials). Install via the dev App's install URL, or set the correct `GITHUB_APP_*` secrets.

**Functions fail with module-not-found errors during deploy**: ensure `hono` and `jose` are in `dependencies` (not devDependencies) so Cloudflare's build picks them up. Run `npm install` and commit `package-lock.json` if it changed.

**Page loads fine but OAuth callback URL 404s**: confirm `public/oauth/callback.html` shipped to `dist/oauth/callback.html`. Run `npm run build` and look for it in `dist/`.

**Worker not invoking for `/api/github/*`**: check `public/_routes.json` shipped to `dist/_routes.json`. Without it, Pages may serve a static 404 for the `/api/github/*` path instead of invoking the Function.
