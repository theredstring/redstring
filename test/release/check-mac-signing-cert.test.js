// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { evaluateCertificate, readCscLink, WARN_DAYS } from '../../scripts/check-mac-signing-cert.mjs';

const NOW = new Date('2026-10-21T12:00:00Z');
// The two subject formats openssl prints: LibreSSL (macOS /usr/bin/openssl) and OpenSSL 3.
const LIBRESSL = '/UID=24MPFEY5BE/CN=Developer ID Application: Interfaith Softworks LLC (24MPFEY5BE)/OU=24MPFEY5BE/O=Interfaith Softworks LLC/C=US';
const OPENSSL3 = 'UID=24MPFEY5BE, CN=Developer ID Application: Interfaith Softworks LLC (24MPFEY5BE), OU=24MPFEY5BE, O=Interfaith Softworks LLC, C=US';

const check = (subject, notAfter) => evaluateCertificate({ subject, notAfter, now: NOW });

describe('macOS signing certificate check', () => {
  it('passes a current Developer ID certificate for our team, in either openssl format', () => {
    for (const subject of [LIBRESSL, OPENSSL3]) {
      const r = check(subject, 'Nov 20 18:39:27 2027 GMT');
      expect(r.status).toBe('ok');
      expect(r.message).toContain('Interfaith Softworks LLC (24MPFEY5BE)');
      expect(r.message).toContain('2027-11-20');
    }
  });

  it(`warns within ${WARN_DAYS} days of expiry`, () => {
    expect(check(LIBRESSL, 'Dec 10 00:00:00 2026 GMT').status).toBe('warn');
    expect(check(LIBRESSL, 'Jan 10 00:00:00 2027 GMT').status).toBe('ok');
  });

  it('fails once the certificate has expired', () => {
    const r = check(LIBRESSL, 'Oct 20 00:00:00 2026 GMT');
    expect(r.status).toBe('fail');
    expect(r.message).toContain('expired');
  });

  it('fails an Apple Development or Apple Distribution certificate', () => {
    for (const cn of ['Apple Development: GRANT WILLIAM EUBANKS (8YW64M73PD)', 'Apple Distribution: Interfaith Softworks LLC (24MPFEY5BE)']) {
      expect(check(`/UID=X/CN=${cn}/OU=24MPFEY5BE/C=US`, 'Nov 20 18:39:27 2027 GMT').status).toBe('fail');
    }
  });

  it("fails another team's Developer ID certificate", () => {
    const r = check('/UID=ABCDE12345/CN=Developer ID Application: Someone Else (ABCDE12345)/OU=ABCDE12345/C=US', 'Nov 20 18:39:27 2027 GMT');
    expect(r.status).toBe('fail');
    expect(r.message).toContain('ABCDE12345');
  });

  it('does not depend on the name on the certificate, only the team', () => {
    // The pre-LLC certificate still counts: renaming the owner never strands an update.
    const old = '/UID=24MPFEY5BE/CN=Developer ID Application: GRANT WILLIAM EUBANKS (24MPFEY5BE)/OU=24MPFEY5BE/O=GRANT WILLIAM EUBANKS/C=US';
    expect(check(old, 'Jan 23 20:09:54 2031 GMT').status).toBe('ok');
  });

  it('reads CSC_LINK as base64, and skips a URL', () => {
    expect(readCscLink(Buffer.from('p12 bytes').toString('base64')).toString()).toBe('p12 bytes');
    expect(readCscLink('https://example.com/cert.p12')).toBeNull();
  });
});
