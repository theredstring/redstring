// GitHub API helpers — installation discovery used by the App endpoints.
// Ported from oauth-server.js (listInstallationsViaOAuth).
//
// Ownership checks do NOT live here: the old verifyInstallationWithOAuth let
// 'unverified' / 'error' results fall through to a mint (S-01). Every route
// that acts on an installation id uses verifyInstallOwnership in
// ./ownership.ts, which fails closed.

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

// Look up the OAuth user behind a token. Used by /installations fallback.
export async function fetchOAuthUser(accessToken: string): Promise<{ id?: number; login?: string } | null> {
  try {
    const res = await fetch('https://api.github.com/user', { headers: ghHeaders(accessToken) });
    if (!res.ok) return null;
    return await res.json() as any;
  } catch { return null; }
}

// Extract OAuth bearer/token from Authorization header. The SPA passes its
// own user token here — the Worker is stateless about user identity.
export function extractOAuthToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^(?:token|Bearer)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
