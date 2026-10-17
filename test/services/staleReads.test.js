import { describe, it, expect, vi, afterEach } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';

// GitHub's reads trail its writes. A version this device just moved past,
// read back, is stale, not someone else's save (see _isRecentlySuperseded).

afterEach(() => vi.useRealTimers());

const engineWith = (provider) => {
  const engine = new GitSyncEngine({ name: 'stub', ...provider }, 'git', 'u', 'u', 'u');
  engine.onRemoteUpdate = vi.fn(async () => null);
  return engine;
};

describe('stale reads', () => {
  it('a version moved past moments ago is ignored by the remote check', async () => {
    const engine = engineWith({ getRemoteFileSha: async () => 'v1', readFileRawWithMeta: vi.fn() });
    engine._setSyncBase('v1');
    engine._setSyncBase('v2');
    expect(await engine.checkRemote()).toEqual({ changed: false, stale: true });
    expect(engine.onRemoteUpdate).not.toHaveBeenCalled();
  });

  it('is believed again after the window (a file put back by hand)', () => {
    vi.useFakeTimers();
    const engine = engineWith({});
    engine._setSyncBase('v1');
    engine._setSyncBase('v2');
    expect(engine._isRecentlySuperseded('v1')).toBe(true);
    vi.advanceTimersByTime(2 * 60 * 1000 + 1);
    expect(engine._isRecentlySuperseded('v1')).toBe(false);
    expect(engine._isRecentlySuperseded('v2')).toBe(false);
  });

  it('after a refused save, waits out a read that still shows the refused version', async () => {
    vi.useFakeTimers();
    const reads = [{ sha: 'v1', content: '{}' }, { sha: 'v1', content: '{}' }, { sha: 'v3', content: '{"x":1}' }];
    const engine = engineWith({ readFileRawWithMeta: vi.fn(async () => reads.shift()) });
    const pending = engine._readRemoteAfterRefusal('p', 'v1');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ sha: 'v3' });
  });

  it('gives up with a retryable error if the read never catches up', async () => {
    vi.useFakeTimers();
    const engine = engineWith({ readFileRawWithMeta: vi.fn(async () => ({ sha: 'v1', content: '{}' })) });
    const pending = engine._readRemoteAfterRefusal('p', 'v1');
    const settled = expect(pending).rejects.toMatchObject({ code: 'REMOTE_READ_STALE' });
    await vi.runAllTimersAsync();
    await settled;
  });
});
