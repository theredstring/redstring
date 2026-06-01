// GitHub API helpers — installation discovery and verification used by the
// App endpoints. Ported from oauth-server.js (findInstallationViaOAuth,
// listInstallationsViaOAuth, verifyInstallationWithOAuth).

import { USER_AGENT } from './env';

export const GITHUB_USER_INSTALLATIONS_URL = 'https://api.github.com/user/installations';

export interface GhInstallation {
  id: number;
  app_id?: number;
  app_slug?: string;
  account?: { id?: number; login?: string } | null;
  target_type?: string;
  permissions?: Record<string, string> | null;
  created_at?: string;
  [k: string]: unknown;
}

interface PaginatedListResult {
  ok: boolean;
  status?: number;
  reason?: string;
  details?: string | null;
  installations: GhInstallation[];
}

interface SingleLookupResult {
  ok: boolean;
  status?: number;
  reason?: string;
  details?: string | null;
  installation?: GhInstallation | null;
}

const ghHeaders = (token: string) => ({
  'Accept': 'application/vnd.github.v3+json',
  'Authorization': `token ${token}`,
  'User-Agent': USER_AGENT,
});

// List ALL installations the OAuth user can see (paginated).
export async function listInstallationsViaOAuth(accessToken: string): Promise<PaginatedListResult> {
  if (!accessToken) {
    return { ok: false, status: 0, reason: 'missing_token', installations: [] };
  }
  const all: GhInstallation[] = [];
  const perPage = 100;
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${GITHUB_USER_INSTALLATIONS_URL}?per_page=${perPage}&page=${page}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: ghHeaders(accessToken) });
    } catch (e: any) {
      return { ok: false, status: 0, reason: 'network_error', installations: [], details: e?.message || String(e) };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, reason: 'github_error', details: text, installations: [] };
    }
    let data: any;
    try { data = await res.json(); }
    catch (e: any) { return { ok: false, status: res.status, reason: 'parse_error', installations: [], details: e?.message || null }; }
    const installs: GhInstallation[] = Array.isArray(data?.installations) ? data.installations : [];
    all.push(...installs);
    const link = res.headers.get('link') || '';
    if (!/\brel="next"/.test(link) || installs.length === 0) break;
  }
  return { ok: true, installations: all };
}

// Find one specific install in the OAuth user's accessible list.
export async function findInstallationViaOAuth(accessToken: string, installationId: number | string): Promise<SingleLookupResult> {
  const targetId = installationId != null ? Number(installationId) : NaN;
  if (Number.isNaN(targetId)) {
    return { ok: false, status: 0, reason: 'invalid_installation_id' };
  }
  const list = await listInstallationsViaOAuth(accessToken);
  if (!list.ok) {
    return { ok: false, status: list.status, reason: list.reason, details: list.details };
  }
  const match = list.installations.find((i) => Number(i?.id) === targetId);
  return { ok: true, installation: match || null };
}

export interface VerificationResult {
  status: 'missing_installation' | 'skipped' | 'verified' | 'not_found' | 'oauth_invalid' | 'unverified' | 'error' | 'account_mismatch';
  reason: string | null;
  installation: GhInstallation | null;
  oauthUser: { id?: number; login?: string } | null;
  statusCode?: number | null;
  details?: string | null;
  checkedInstallationId: number | null;
}

// Verify that an installation_id is accessible to the supplied OAuth token.
// Mirrors verifyInstallationWithOAuth in oauth-server.js exactly, including
// the account-mismatch guard for User installs.
export async function verifyInstallationWithOAuth(
  installationId: number | string,
  oauthToken: string | null,
  oauthUser: { id?: number; login?: string } | null,
  opts: { enforceAccountMatch?: boolean } = {}
): Promise<VerificationResult> {
  const { enforceAccountMatch = true } = opts;
  const numericInstallationId = installationId != null ? Number(installationId) : NaN;

  if (Number.isNaN(numericInstallationId)) {
    return { status: 'missing_installation', reason: 'missing_installation_id', installation: null, oauthUser, checkedInstallationId: null };
  }
  if (!oauthToken) {
    return { status: 'skipped', reason: 'oauth_not_connected', installation: null, oauthUser, checkedInstallationId: numericInstallationId };
  }

  const lookup = await findInstallationViaOAuth(oauthToken, numericInstallationId);

  if (!lookup.ok) {
    if (lookup.status === 401) return { status: 'oauth_invalid', reason: 'oauth_token_invalid', installation: null, oauthUser, statusCode: lookup.status, details: lookup.details || null, checkedInstallationId: numericInstallationId };
    if (lookup.status === 404) return { status: 'not_found', reason: 'installation_not_found', installation: null, oauthUser, statusCode: lookup.status, details: lookup.details || null, checkedInstallationId: numericInstallationId };
    if (lookup.status === 403) return { status: 'unverified', reason: 'oauth_scope_insufficient', installation: null, oauthUser, statusCode: lookup.status, details: lookup.details || 'OAuth token lacks read:org scope required by /user/installations', checkedInstallationId: numericInstallationId };
    return { status: 'error', reason: lookup.reason || 'github_request_failed', installation: null, oauthUser, statusCode: lookup.status || null, details: lookup.details || null, checkedInstallationId: numericInstallationId };
  }

  if (!lookup.installation) {
    return {
      status: 'unverified',
      reason: lookup.reason || 'installation_not_listed',
      installation: null,
      oauthUser,
      statusCode: lookup.status || null,
      details: lookup.details || 'GitHub did not include this installation in /user/installations for the current OAuth token. Tokens without read:org scope cannot enumerate organization installs.',
      checkedInstallationId: numericInstallationId,
    };
  }

  const installation = lookup.installation;
  if (
    enforceAccountMatch &&
    installation?.target_type === 'User' &&
    oauthUser?.id &&
    installation?.account?.id &&
    installation.account.id !== oauthUser.id
  ) {
    return { status: 'account_mismatch', reason: 'installation_account_mismatch', installation, oauthUser, checkedInstallationId: numericInstallationId };
  }

  return { status: 'verified', reason: null, installation, oauthUser, checkedInstallationId: numericInstallationId };
}

// Look up the OAuth user behind a token. Used by /installations fallback.
export async function fetchOAuthUser(accessToken: string): Promise<{ id?: number; login?: string } | null> {
  try {
    const res = await fetch('https://api.github.com/user', { headers: ghHeaders(accessToken) });
    if (!res.ok) return null;
    return await res.json() as any;
  } catch { return null; }
}

export function formatVerificationForResponse(record: VerificationResult | null) {
  if (!record) return null;
  const out: Record<string, any> = {
    status: record.status,
    reason: record.reason,
    oauthLogin: record.oauthUser?.login ?? null,
    installationId: record.installation?.id ?? null,
    checkedInstallationId: record.checkedInstallationId,
    installationAccount: record.installation?.account?.login ?? null,
    targetType: record.installation?.target_type ?? null,
    appId: record.installation?.app_id ?? null,
    appSlug: record.installation?.app_slug ?? null,
    statusCode: record.statusCode ?? null,
    details: record.details ?? null,
    checkedAt: new Date().toISOString(),
  };
  // Strip nulls for cleaner JSON
  Object.keys(out).forEach((k) => { if (out[k] == null) delete out[k]; });
  return out;
}

// Extract OAuth bearer/token from Authorization header. The SPA passes its
// own user token here — the Worker is stateless about user identity.
export function extractOAuthToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^(?:token|Bearer)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
