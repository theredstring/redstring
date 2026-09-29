// S-05 / S-06 / S-07 — crypto-random state, PKCE, fail-closed checks.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  randomUrlSafe,
  createPkcePair,
  s256Challenge,
  armOAuthRedirect,
  buildAuthorizeUrl,
  checkOAuthState,
  clearOAuthState,
  armAppInstall,
  isAppInstallCallbackTrusted,
  clearAppInstallState,
  OAUTH_STATE_KEY,
  OAUTH_VERIFIER_KEY,
  OAUTH_PENDING_KEY,
  APP_PENDING_KEY,
  APP_STATE_KEY,
} from '../../../src/services/githubOAuthState.js';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('randomUrlSafe', () => {
  it('uses the CSPRNG, never Math.random', () => {
    const mathRandom = vi.spyOn(Math, 'random');
    const grv = vi.spyOn(globalThis.crypto, 'getRandomValues');
    randomUrlSafe();
    expect(grv).toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('yields 256 bits as 43 url-safe characters, never repeating', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const v = randomUrlSafe();
      expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(v);
    }
    expect(seen.size).toBe(200);
  });

  it('throws rather than degrade when no CSPRNG exists', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(() => randomUrlSafe()).toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('PKCE (RFC 7636 S256)', () => {
  it('matches the RFC 7636 Appendix B test vector', async () => {
    expect(await s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('creates a valid verifier and its SHA-256 challenge', async () => {
    const { verifier, challenge, method } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(method).toBe('S256');
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });
});

describe('OAuth redirect arming and checking', () => {
  it('stores state, verifier and the pending flag, and builds an S256 authorize URL', async () => {
    const { state, codeChallenge } = await armOAuthRedirect();
    expect(sessionStorage.getItem(OAUTH_STATE_KEY)).toBe(state);
    expect(sessionStorage.getItem(OAUTH_PENDING_KEY)).toBe('true');
    const verifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY);
    expect(await s256Challenge(verifier)).toBe(codeChallenge);

    const url = new URL(buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://redstring.io/oauth/callback', scope: 'repo read:org', state, codeChallenge }));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('code_challenge')).toBe(codeChallenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('repo read:org');
  });

  it('rejects a callback when no state was armed (the old code accepted it)', () => {
    expect(checkOAuthState('anything').ok).toBe(false);
  });

  it('rejects a mismatched or missing state', async () => {
    const { state } = await armOAuthRedirect();
    expect(checkOAuthState(`${state}x`).ok).toBe(false);
    expect(checkOAuthState('').ok).toBe(false);
    expect(checkOAuthState(null).ok).toBe(false);
  });

  it('accepts the armed state and hands back the verifier', async () => {
    const { state } = await armOAuthRedirect();
    const r = checkOAuthState(state);
    expect(r.ok).toBe(true);
    expect(r.codeVerifier).toBe(sessionStorage.getItem(OAUTH_VERIFIER_KEY));
  });

  it('clearOAuthState removes everything', async () => {
    await armOAuthRedirect();
    clearOAuthState();
    expect(sessionStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
    expect(sessionStorage.getItem(OAUTH_VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(OAUTH_PENDING_KEY)).toBeNull();
  });
});

describe('App install state', () => {
  it('trusts a returned installation only with a pending install and matching state', () => {
    expect(isAppInstallCallbackTrusted('x')).toBe(false); // nothing pending

    const state = armAppInstall();
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionStorage.getItem(APP_PENDING_KEY)).toBe('true');
    expect(sessionStorage.getItem(APP_STATE_KEY)).toBe(state);

    expect(isAppInstallCallbackTrusted(state)).toBe(true);
    expect(isAppInstallCallbackTrusted(`${state}x`)).toBe(false);
    expect(isAppInstallCallbackTrusted(null)).toBe(false);
    expect(isAppInstallCallbackTrusted(String(Date.now()))).toBe(false);
  });

  it('a pending flag without an armed state is not enough', () => {
    sessionStorage.setItem(APP_PENDING_KEY, 'true');
    expect(isAppInstallCallbackTrusted('')).toBe(false);
    expect(isAppInstallCallbackTrusted('anything')).toBe(false);
  });

  it('clearAppInstallState removes the flag and the state', () => {
    armAppInstall();
    clearAppInstallState();
    expect(sessionStorage.getItem(APP_PENDING_KEY)).toBeNull();
    expect(sessionStorage.getItem(APP_STATE_KEY)).toBeNull();
  });
});
