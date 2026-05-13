/**
 * Hardcoded public GitHub OAuth identifiers for the desktop build.
 *
 * These are not secrets — they're embedded in every authorize URL GitHub
 * shows users and are visible to anyone inspecting network traffic. Same
 * pattern as the GitHub CLI (`gh`), VSCode, Docker Desktop, etc. shipping
 * their public client IDs in source.
 *
 * Anything truly secret (OAuth `client_secret`, the GitHub App's RSA
 * private key) is server-only — device flow doesn't use either, so a
 * forked or repackaged Redstring can authenticate users against the
 * official apps without compromising them. The worst a fork can do is
 * trigger an authorize prompt that names "Redstring" as the consumer.
 *
 * Override at build time via Vite env vars to point a custom desktop
 * build at a fork's own OAuth/GitHub App registrations:
 *   VITE_GITHUB_CLIENT_ID=...     npm run electron:build:mac
 *   VITE_GITHUB_APP_CLIENT_ID=... npm run electron:build:mac
 *   VITE_GITHUB_APP_SLUG=...      npm run electron:build:mac
 */

// Production OAuth App (https://github.com/settings/applications)
export const DEFAULT_OAUTH_CLIENT_ID = 'Ov23liUqh1qwPrgoPke8';

// Production GitHub App (https://github.com/settings/apps/redstring-semantic-sync)
export const DEFAULT_APP_CLIENT_ID = 'Iv23lilIiCB6USwPB28i';

// App slug for the install URL: https://github.com/apps/<slug>/installations/new
export const DEFAULT_APP_SLUG = 'redstring-semantic-sync';
