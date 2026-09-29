/**
 * S-40 — startOAuthFlow only ever navigates to (or hands the OS) an https
 * github.com URL.
 */
import { describe, it, expect } from 'vitest';
import { startOAuthFlow, githubAuthUrl } from '../../../src/utils/oauthAdapter.js';

describe('githubAuthUrl', () => {
  it('accepts GitHub authorize URLs', () => {
    expect(githubAuthUrl('https://github.com/login/oauth/authorize?client_id=x&state=y'))
      .toBe('https://github.com/login/oauth/authorize?client_id=x&state=y');
  });

  it.each([
    'javascript:alert(1)',
    'http://github.com/login/oauth/authorize',
    'https://github.com.evil.example/login',
    'https://evil.example/?github.com',
    'data:text/html,x',
    '',
    null,
  ])('refuses %j', (url) => {
    expect(githubAuthUrl(url)).toBeNull();
  });
});

describe('startOAuthFlow', () => {
  it('refuses a non-GitHub URL without navigating', async () => {
    const before = window.location.href;
    await expect(startOAuthFlow('javascript:alert(1)')).rejects.toThrow(/Refusing/);
    expect(window.location.href).toBe(before);
  });
});
