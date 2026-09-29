// Cloudflare Worker environment bindings.
//
// One credential set per deployment — the dev/prod conditional in the old
// oauth-server.js (GITHUB_CLIENT_ID_DEV vs GITHUB_CLIENT_ID, picked at runtime
// from NODE_ENV) is replaced by per-environment Wrangler secret bindings.
// `[env.staging]` binds the dev GitHub OAuth App + GitHub App credentials;
// `[env.production]` (later) binds the prod credentials. The handler code is
// identical across environments.

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_APP_ID: string;          // numeric, stored as string
  GITHUB_APP_PRIVATE_KEY: string; // PEM (PKCS#8 or PKCS#1 — converted in jwt.ts)
  GITHUB_APP_SLUG: string;
  // HMAC secret for the App's webhook deliveries. Required for the webhook
  // route: when it is not bound, every delivery is refused (503) rather than
  // accepted unverified.
  GITHUB_APP_WEBHOOK_SECRET?: string;
  // Optional: set to the string "true" to allow *.pages.dev / *.workers.dev
  // preview origins through CORS (off by default — those suffixes are
  // registrable by anyone).
  ALLOW_PREVIEW_ORIGINS?: string;
  // Optional: set to the string "true" to allow http://localhost / 127.0.0.1
  // origins through CORS (for a Vite dev server pointed at this deployment
  // with VITE_OAUTH_URL). Off by default so production never trusts a local
  // origin. `wrangler pages dev` (request host is localhost) allows them
  // without this flag.
  ALLOW_LOCALHOST_ORIGINS?: string;
  // Optional Workers Rate Limiting binding. Not configured today (Pages has
  // no such binding); consulted when present. See _lib/rateLimit.ts.
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export const USER_AGENT = 'Redstring-Worker/1.0';
