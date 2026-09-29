/**
 * Anti-forgery state for the web GitHub redirects (OAuth sign-in and App
 * install), kept in sessionStorage for the one tab that started the flow.
 *
 * - OAuth (S-06/S-07): a crypto-random `state` plus a PKCE S256 pair. The
 *   callback is accepted only when a state was armed AND matches; the
 *   verifier goes to /api/github/oauth/token, which forwards it to GitHub.
 * - App install (S-05): a crypto-random `state` rides the install URL and
 *   comes back on the Setup URL. An installation_id from the URL (or the
 *   static callback page) is accepted only while an install is pending AND
 *   the state matches — otherwise a crafted link could bind this client to
 *   someone else's installation.
 *
 * Native shells use the device flow and never touch these.
 */

export const OAUTH_STATE_KEY = 'github_oauth_state';
export const OAUTH_PENDING_KEY = 'github_oauth_pending';
export const OAUTH_VERIFIER_KEY = 'github_oauth_pkce_verifier';
export const APP_PENDING_KEY = 'github_app_pending';
export const APP_STATE_KEY = 'github_app_install_state';

const getCrypto = () => (typeof globalThis !== 'undefined' ? globalThis.crypto : undefined);

const toBase64Url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * URL-safe random string from the platform CSPRNG. Throws when no CSPRNG is
 * available — there is no Math.random fallback on purpose.
 */
export function randomUrlSafe(byteLength = 32) {
  const c = getCrypto();
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Secure random numbers are unavailable in this browser');
  }
  const bytes = new Uint8Array(byteLength);
  c.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * RFC 7636 S256 pair. Returns null when SubtleCrypto is unavailable (an
 * insecure http:// origin other than localhost) — the flow then runs without
 * PKCE, still protected by the random state.
 */
export async function createPkcePair() {
  const c = getCrypto();
  if (!c?.subtle?.digest) return null;
  const verifier = randomUrlSafe(32); // 43 chars
  return { verifier, challenge: await s256Challenge(verifier), method: 'S256' };
}

/** BASE64URL(SHA256(ASCII(verifier))) — RFC 7636 §4.2. */
export async function s256Challenge(verifier) {
  const digest = await getCrypto().subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

const safeGet = (key) => {
  try { return sessionStorage.getItem(key); } catch { return null; }
};
const safeRemove = (key) => {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
};

/**
 * Arm an OAuth redirect: store state (+ verifier) and return the authorize
 * URL parameters. The caller builds the URL and navigates.
 */
export async function armOAuthRedirect() {
  const state = randomUrlSafe(32);
  const pkce = await createPkcePair();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  if (pkce) sessionStorage.setItem(OAUTH_VERIFIER_KEY, pkce.verifier);
  else safeRemove(OAUTH_VERIFIER_KEY);
  sessionStorage.setItem(OAUTH_PENDING_KEY, 'true');
  return { state, codeChallenge: pkce?.challenge || null, codeChallengeMethod: pkce ? 'S256' : null };
}

export function buildAuthorizeUrl({ clientId, redirectUri, scope, state, codeChallenge }) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope, state });
  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Check a returned OAuth state. Fails closed: no armed state → reject.
 * Returns { ok, codeVerifier } — codeVerifier is null when PKCE wasn't armed.
 */
export function checkOAuthState(returnedState) {
  const expected = safeGet(OAUTH_STATE_KEY);
  if (!expected || typeof returnedState !== 'string' || returnedState !== expected) {
    return { ok: false, codeVerifier: null };
  }
  return { ok: true, codeVerifier: safeGet(OAUTH_VERIFIER_KEY) || null };
}

export function clearOAuthState() {
  safeRemove(OAUTH_PENDING_KEY);
  safeRemove(OAUTH_STATE_KEY);
  safeRemove(OAUTH_VERIFIER_KEY);
}

/** Arm an App install redirect; returns the state to put on the install URL. */
export function armAppInstall() {
  const state = randomUrlSafe(32);
  sessionStorage.setItem(APP_STATE_KEY, state);
  sessionStorage.setItem(APP_PENDING_KEY, 'true');
  return state;
}

/**
 * May an installation_id delivered by redirect be used? Only while an install
 * this tab started is pending, and only with the state it armed.
 */
export function isAppInstallCallbackTrusted(returnedState) {
  if (safeGet(APP_PENDING_KEY) !== 'true') return false;
  const expected = safeGet(APP_STATE_KEY);
  return !!expected && typeof returnedState === 'string' && returnedState === expected;
}

export function clearAppInstallState() {
  safeRemove(APP_PENDING_KEY);
  safeRemove(APP_STATE_KEY);
}
