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
}

export const USER_AGENT = 'Redstring-Worker/1.0';
