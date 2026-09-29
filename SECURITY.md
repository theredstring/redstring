# Security Policy

## Supported versions

Redstring is pre-1.0. Security fixes go into the latest release line only; update to the newest release to get them. The desktop app updates itself.

| Version | Supported |
| ------- | --------- |
| 1.x (when released) | Yes |
| 0.15.x (current) | Yes |
| < 0.15 | No: please update |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

1. **Preferred:** report it privately through GitHub: [Security → Report a vulnerability](https://github.com/theredstring/redstring/security/advisories/new). Only the maintainer can see it, and we can work on a fix and an advisory together there.
2. Or email [info@redstring.io](mailto:info@redstring.io) with "SECURITY" in the subject.

Include what you found, how to reproduce it, which platform (web at redstring.io, desktop, iOS, Android, CLI/MCP) and version, and what an attacker could do with it. A proof of concept helps; please don't access other people's data or repositories to build one.

What to expect:

| Severity | First response | Fix target |
|---|---|---|
| Critical (e.g. access to other users' GitHub repos or tokens, code execution) | 48 hours | as soon as possible, days |
| High | 1 week | 2 weeks |
| Medium / Low | 2 weeks | next releases |

We'll credit you in the advisory unless you'd rather not be named.

## How Redstring is built (what's in scope)

- **Web app, redstring.io**: a static single-page app on Cloudflare Pages. The only server code is a small set of Cloudflare Pages Functions under `/api/github/*` and `/github/app/callback` (`functions/`), which exchange GitHub OAuth codes and mint GitHub App installation tokens. There is no Redstring database and no user accounts: your graphs live in your browser, on your disk, or in your own GitHub repositories.
- **Desktop app** (Electron, macOS / Windows / Linux), distributed from GitHub Releases and updated automatically. It runs a local agent server bound to `127.0.0.1` for the AI wizard.
- **Mobile apps** (Capacitor, iOS and Android).
- **CLI and MCP server** (`cli/`, `redstring-mcp-server.js`) for headless and Claude Desktop use.
- **Legacy:** the Google Cloud Run deployment (`oauth-server.js`, `deployment/`, `cloudbuild*.yaml`) is retired and being shut down. Reports about it are still welcome.

In scope: all of the above, the release pipeline (`.github/workflows/`), and anything in this repository. Out of scope: GitHub, OpenRouter, Anthropic or other providers themselves; social engineering; denial of service by traffic volume.

## Your keys (BYOK)

Redstring never pays for or proxies AI inference. The AI features use **your own** API key (bring your own key). The key is stored on your device (the OS keychain on desktop and mobile, encrypted browser storage on the web) and sent only to the provider you configured. Redstring's servers never receive it. GitHub access uses GitHub's own OAuth and GitHub App flows; tokens stay on your device.

## For contributors

- Never commit keys, tokens, `.env` files, `github.env*`, `WIZARD_KEY.txt` or `*.pem` files. `npm run security:scan` (or `node scripts/security/secret-scan.mjs`) checks the repo; `node scripts/security/install-pre-commit-hook.mjs` installs an opt-in hook that checks every commit.
- Security rules are enforced by tests in `test/security/`; see [`test/security/README.md`](test/security/README.md). CI's `security` job must pass.
- Threat model, hardening status and the owner's runbook: [`documentation/security/`](documentation/security/THREAT_MODEL.md).
