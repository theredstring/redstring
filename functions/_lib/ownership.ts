// Ownership check for GitHub App installations (contract C-9).
//
// Installation IDs are small enumerable integers, so every endpoint that acts
// on one with the App's credentials (minting a token, reading the install,
// creating a repo) must first prove the CALLER may use that installation.
//
// The caller is identified by the OAuth token the SPA sends. On the web that is
// an OAuth-App token (gho_, scope `repo read:org`), which GitHub refuses on
// GET /user/installations — so we cannot ask "which installs can this user
// see?". Instead we ask two questions GitHub will answer for that token:
//
//   1. GET /user                              (caller token)  → who is calling
//   2. GET /app/installations/{id}            (App JWT)       → who owns the install
//   3. Organization installs only:
//      GET /user/memberships/orgs/{login}     (caller token)  → is the caller an
//                                                              active member
//
// and allow only: a User install whose account IS the caller, or an
// Organization install the caller is an active member of. Everything else —
// including any GitHub error, timeout, malformed body, suspended install,
// another App's install, Enterprise installs — is denied. There is no
// "unverified, mint anyway" state: fail closed.
//
// The caller mints with `result.installationId` (the id GitHub returned for
// the install we checked), never with the raw request input.

import { USER_AGENT } from './env';

const API = 'https://api.github.com';

export type OwnershipDenyCode =
  | 'invalid_installation_id'
  | 'oauth_required'
  | 'wrong_token_type'
  | 'app_not_configured'
  | 'oauth_invalid'
  | 'installation_not_found'
  | 'app_credentials_mismatch'
  | 'installation_suspended'
  | 'account_mismatch'
  | 'not_org_member'
  | 'unsupported_target'
  | 'github_app_auth_failed'
  | 'github_error';

export interface OwnershipUser {
  id: number;
  login: string;
}

export interface OwnershipInstallation {
  id: number;
  app_id: number;
  app_slug?: string;
  target_type: string;
  account: { id: number; login: string; type?: string; [k: string]: unknown };
  permissions?: Record<string, string> | null;
  suspended_at?: string | null;
  [k: string]: unknown;
}

export type OwnershipResult =
  | { ok: true; installationId: number; installation: OwnershipInstallation; user: OwnershipUser }
  | { ok: false; code: OwnershipDenyCode; status: 400 | 401 | 403 | 404 | 409 | 500 | 502 };

const deny = (code: OwnershipDenyCode, status: 400 | 401 | 403 | 404 | 409 | 500 | 502): OwnershipResult =>
  ({ ok: false, code, status });

const isPositiveSafeInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

// Accept a JSON number or a plain decimal string. Rejects "12abc", "1e3",
// " 12", "0x1f", negative, zero, floats, and anything past 2^53.
export function parseInstallationId(raw: unknown): number | null {
  if (typeof raw === 'number') return isPositiveSafeInt(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const n = Number(raw);
  return isPositiveSafeInt(n) ? n : null;
}

// A token that can safely go into an Authorization header: printable ASCII,
// no whitespace, sane length. ghs_ (installation) tokens are not a user
// identity and are refused outright.
function checkCallerToken(token: unknown): OwnershipDenyCode | null {
  if (typeof token !== 'string' || token.length === 0) return 'oauth_required';
  if (token.length > 512 || !/^[\x21-\x7e]+$/.test(token)) return 'oauth_required';
  if (token.startsWith('ghs_')) return 'wrong_token_type';
  return null;
}

async function getJson(url: string, authorization: string): Promise<{ status: number; body: any } | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': authorization,
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'manual',
    });
  } catch {
    return null; // network error → caller treats as github_error
  }
  if (!res.ok) {
    // Drain so the connection can be reused; body is never surfaced.
    try { await res.text(); } catch { /* ignore */ }
    return { status: res.status, body: null };
  }
  try {
    return { status: res.status, body: await res.json() };
  } catch {
    return { status: 0, body: null };
  }
}

export async function verifyInstallOwnership(
  rawId: unknown,
  oauthToken: unknown,
  appJwtStr: unknown,
  configuredAppId: unknown,
): Promise<OwnershipResult> {
  const installationId = parseInstallationId(rawId);
  if (installationId == null) return deny('invalid_installation_id', 400);

  const tokenProblem = checkCallerToken(oauthToken);
  if (tokenProblem === 'wrong_token_type') return deny('wrong_token_type', 400);
  if (tokenProblem) return deny('oauth_required', 401);

  const appId = typeof configuredAppId === 'string' && /^[1-9][0-9]{0,15}$/.test(configuredAppId.trim())
    ? Number(configuredAppId.trim())
    : configuredAppId;
  if (!isPositiveSafeInt(appId)) return deny('app_not_configured', 500);
  if (typeof appJwtStr !== 'string' || appJwtStr.length === 0) return deny('app_not_configured', 500);

  // 1. Who is calling?
  const userRes = await getJson(`${API}/user`, `token ${oauthToken}`);
  if (!userRes) return deny('github_error', 502);
  if (userRes.status === 401) return deny('oauth_invalid', 401);
  if (userRes.status !== 200) return deny('github_error', 502);
  const userId = userRes.body?.id;
  const userLogin = userRes.body?.login;
  if (!isPositiveSafeInt(userId) || typeof userLogin !== 'string') return deny('github_error', 502);
  const user: OwnershipUser = { id: userId, login: userLogin };

  // 2. Who owns the installation? (App JWT only sees this App's installs.)
  const instRes = await getJson(`${API}/app/installations/${installationId}`, `Bearer ${appJwtStr}`);
  if (!instRes) return deny('github_error', 502);
  if (instRes.status === 404) return deny('installation_not_found', 404);
  if (instRes.status === 401) return deny('github_app_auth_failed', 502);
  if (instRes.status !== 200) return deny('github_error', 502);
  const inst = instRes.body;
  if (!inst || typeof inst !== 'object') return deny('github_error', 502);
  if (inst.id !== installationId) return deny('github_error', 502);
  if (!isPositiveSafeInt(inst.app_id) || inst.app_id !== appId) return deny('app_credentials_mismatch', 409);
  if (inst.suspended_at) return deny('installation_suspended', 403);
  const account = inst.account;
  if (!account || !isPositiveSafeInt(account.id) || typeof account.login !== 'string' || account.login.length === 0) {
    return deny('github_error', 502);
  }
  // account.type, when present, must agree with target_type.
  if (account.type != null && account.type !== inst.target_type) return deny('unsupported_target', 403);

  const ok = (): OwnershipResult => ({ ok: true, installationId: inst.id, installation: inst as OwnershipInstallation, user });

  // 3. Does the caller own it?
  if (inst.target_type === 'User') {
    return account.id === user.id ? ok() : deny('account_mismatch', 403);
  }

  if (inst.target_type === 'Organization') {
    const memRes = await getJson(
      `${API}/user/memberships/orgs/${encodeURIComponent(account.login)}`,
      `token ${oauthToken}`,
    );
    if (!memRes) return deny('github_error', 502);
    if (memRes.status === 401) return deny('oauth_invalid', 401);
    // 403 (no read:org / SSO / OAuth-app restriction) and 404 (not a member)
    // both mean we cannot establish membership.
    if (memRes.status === 403 || memRes.status === 404) return deny('not_org_member', 403);
    if (memRes.status !== 200) return deny('github_error', 502);
    const m = memRes.body;
    if (m?.state === 'active' && isPositiveSafeInt(m?.organization?.id) && m.organization.id === account.id) {
      return ok();
    }
    return deny('not_org_member', 403);
  }

  return deny('unsupported_target', 403);
}

// Summary the SPA stores alongside an installation (shape kept compatible
// with the older formatVerificationForResponse output).
export function verificationSummary(result: Extract<OwnershipResult, { ok: true }>) {
  return {
    status: 'verified',
    oauthLogin: result.user.login,
    installationId: result.installationId,
    checkedInstallationId: result.installationId,
    installationAccount: result.installation.account.login,
    targetType: result.installation.target_type,
    appId: result.installation.app_id,
    ...(result.installation.app_slug ? { appSlug: result.installation.app_slug } : {}),
    checkedAt: new Date().toISOString(),
  };
}
