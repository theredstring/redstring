// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { evaluateNotarizeKey } from '../../scripts/check-notarize-key.mjs';

const TEAM = '24MPFEY5BE';
const ISSUER = '57246542-96fe-1a63-e053-0824d011072a';
const KEY_ID = '2X9R4HXF34';
// Built at runtime so the secret scan doesn't take this fake key for a real one.
const PEM_LABEL = ['PRIVATE', 'KEY'].join(' ');
const P8 = `-----BEGIN ${PEM_LABEL}-----\n${'A'.repeat(48)}\n-----END ${PEM_LABEL}-----\n`;

const check = (overrides) => evaluateNotarizeKey({ p8: P8, keyId: KEY_ID, issuer: ISSUER, teamId: TEAM, ...overrides });

describe('App Store Connect API key check', () => {
  it('passes the three secrets in their right shapes', () => {
    expect(check({})).toEqual({ status: 'ok', errors: [], warnings: [] });
  });

  it('skips when there is no key, as the release then uses the Apple ID login', () => {
    expect(check({ p8: '' }).status).toBe('skip');
  });

  it('fails an Issuer ID that is a Key ID or the Team ID, and says which it looks like', () => {
    const asKey = check({ issuer: KEY_ID });
    expect(asKey.status).toBe('fail');
    expect(asKey.errors[0]).toMatch(/^APPLE_API_ISSUER .*looks like a Key ID/);
    expect(check({ issuer: TEAM }).errors[0]).toContain('looks like the Team ID');
  });

  it('fails a Key ID that is the Team ID or the Issuer ID', () => {
    expect(check({ keyId: TEAM }).errors[0]).toMatch(/^APPLE_API_KEY_ID is the Team ID/);
    expect(check({ keyId: ISSUER }).errors[0]).toContain('looks like an Issuer ID');
  });

  it('fails a .p8 secret that is not the key file', () => {
    expect(check({ p8: 'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg' }).errors[0]).toMatch(/^APPLE_API_KEY_P8 /);
  });

  it('only warns about spaces and line breaks around the IDs, which the build trims', () => {
    const r = check({ issuer: `${ISSUER}\n`, keyId: ` ${KEY_ID}` });
    expect(r.status).toBe('ok');
    expect(r.warnings).toHaveLength(2);
  });

  it('fails an Issuer ID pasted with quotes around it', () => {
    expect(check({ issuer: `"${ISSUER}"` }).status).toBe('fail');
  });

  it('never puts a value in a message', () => {
    const r = check({ issuer: 'not-the-issuer-value', keyId: 'secret-key-id', p8: 'secret-p8-text' });
    const text = [...r.errors, ...r.warnings].join('\n');
    for (const value of ['not-the-issuer-value', 'secret-key-id', 'secret-p8-text']) expect(text).not.toContain(value);
  });
});
