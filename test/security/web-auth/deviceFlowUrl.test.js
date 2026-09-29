// The device-flow verification URL comes from GitHub's response (network
// input) and is handed to window.open / the OS browser. Only https GitHub
// pages may pass.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../src/utils/capacitorAdapter.js', () => ({ isCapacitor: () => false, usesDeviceFlowAuth: () => true }));
vi.mock('../../../src/utils/fileAccessAdapter.js', () => ({ isElectron: () => false }));

const { openVerificationUrl, isGitHubHttpsUrl } = await import('../../../src/services/githubDeviceFlow.js');

afterEach(() => vi.restoreAllMocks());

describe('openVerificationUrl', () => {
  it.each([
    'https://github.com/login/device',
    'https://github.com/login/device?user_code=ABCD-1234',
    'https://github.com/settings/installations/123',
    'https://github.com/apps/redstring/installations/new',
  ])('opens %s', async (url) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(await openVerificationUrl(url)).toBe(true);
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  });

  it.each([
    'javascript:alert(1)',
    'http://github.com/login/device',
    'https://github.com.evil.com/login/device',
    'https://evilgithub.com/',
    'https://user:pass@github.com/',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'redstring://auth',
    '',
    null,
  ])('refuses %j', async (url) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(await openVerificationUrl(url)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(isGitHubHttpsUrl(url)).toBe(false);
  });
});
