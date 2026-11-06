import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isAppLink, appLinkFromArgv } = require('../../../electron/appLink.cjs');

describe('redstring:// links reaching the desktop app', () => {
  it('holds only open links', () => {
    expect(isAppLink('redstring://open?gh=a/b/main/f.redstring')).toBe(true);
    expect(isAppLink('redstring://auth?code=1')).toBe(false);
    expect(isAppLink('https://redstring.io/open?gh=a/b/main/f.redstring')).toBe(false);
    expect(isAppLink(`redstring://open?${'x'.repeat(9000)}`)).toBe(false);
    expect(isAppLink(null)).toBe(false);
  });

  it('finds the link among the arguments', () => {
    expect(appLinkFromArgv(['/app', '--flag', 'redstring://open?url=x'])).toBe('redstring://open?url=x');
    expect(appLinkFromArgv(['/app', '--flag'])).toBe(null);
    expect(appLinkFromArgv(undefined)).toBe(null);
  });
});
