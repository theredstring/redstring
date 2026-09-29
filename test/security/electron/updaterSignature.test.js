// C-4: the manual macOS installer only swaps in a bundle signed by us.
import { describe, it, expect } from 'vitest';
import {
  verifyBundleSignature,
  buildDesignatedRequirement
} from '../../../electron/updaterSignature.cjs';

const BUNDLE = '/Users/x/Library/Caches/redstring-updater/manual-extract/Redstring.app';

// exec double: answers each tool by name, records every call.
function scriptedExec({ codesign = 0, requirement = 0, spctl = 0 } = {}) {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, args]);
    if (file === '/usr/bin/codesign' && args.includes('-R')) {
      return { code: requirement, stdout: '', stderr: requirement ? 'test-requirement: code failed to satisfy specified code requirement(s)' : '' };
    }
    if (file === '/usr/bin/codesign') {
      return { code: codesign, stdout: '', stderr: codesign ? `${BUNDLE}: code object is not signed at all` : '' };
    }
    if (file === '/usr/sbin/spctl') {
      return { code: spctl, stdout: '', stderr: spctl ? `${BUNDLE}: rejected` : '' };
    }
    return { code: 127, stdout: '', stderr: 'unexpected tool' };
  };
  return { exec, calls };
}

describe('verifyBundleSignature', () => {
  it('rejects an unsigned bundle', async () => {
    const { exec } = scriptedExec({ codesign: 1 });
    const r = await verifyBundleSignature(BUNDLE, { exec });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/codesign verify failed/);
  });

  it('rejects a bundle signed by another team', async () => {
    const { exec } = scriptedExec({ requirement: 3 });
    const r = await verifyBundleSignature(BUNDLE, { exec });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not match team 24MPFEY5BE/);
  });

  it('rejects a bundle Gatekeeper refuses (not notarized)', async () => {
    const { exec } = scriptedExec({ spctl: 3 });
    const r = await verifyBundleSignature(BUNDLE, { exec });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Gatekeeper/);
  });

  it('accepts only when all three checks pass, pinning team + bundle id', async () => {
    const { exec, calls } = scriptedExec();
    const r = await verifyBundleSignature(BUNDLE, { exec });
    expect(r).toEqual({ ok: true, reason: null });
    expect(calls.map(([f]) => f)).toEqual(['/usr/bin/codesign', '/usr/bin/codesign', '/usr/sbin/spctl']);
    const reqArgs = calls[1][1];
    const req = reqArgs[reqArgs.indexOf('-R') + 1];
    expect(req.startsWith('=')).toBe(true);
    expect(req).toContain('certificate leaf[subject.OU] = "24MPFEY5BE"');
    expect(req).toContain('identifier "io.redstring.app"');
    expect(req).toContain('anchor apple generic');
    expect(calls[0][1]).toEqual(expect.arrayContaining(['--verify', '--deep', '--strict', BUNDLE]));
    expect(calls[2][1]).toEqual(expect.arrayContaining(['--assess', '--type', 'execute', BUNDLE]));
  });

  it('treats a throwing tool as a failure', async () => {
    const r = await verifyBundleSignature(BUNDLE, { exec: async () => { throw new Error('ENOENT'); } });
    expect(r.ok).toBe(false);
  });

  it('refuses odd paths and injected identifiers without running anything', async () => {
    const { exec, calls } = scriptedExec();
    expect((await verifyBundleSignature('relative/Redstring.app', { exec })).ok).toBe(false);
    expect((await verifyBundleSignature('/tmp/not-an-app', { exec })).ok).toBe(false);
    expect((await verifyBundleSignature(BUNDLE, { exec, teamId: 'X" or anchor apple' })).ok).toBe(false);
    expect((await verifyBundleSignature(BUNDLE, { exec, bundleId: 'io.x" or "1' })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('builds a Developer ID requirement', () => {
    expect(buildDesignatedRequirement('24MPFEY5BE', 'io.redstring.app')).toBe(
      'anchor apple generic and identifier "io.redstring.app" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and ' +
      'certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "24MPFEY5BE"'
    );
  });
});
