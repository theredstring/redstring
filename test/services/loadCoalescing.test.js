/**
 * Two callers asking for the same universe at the same time share one read.
 *
 * On a cold boot the init path and the auth-connected handler both load the
 * active universe, and they overlap. The console showed it plainly: two load
 * gates armed for `claude-s-chambers-2`, and the 6.9 MB file probed and fetched
 * twice, concurrently.
 *
 * The duplicated network is the visible half. The worse half is the save gate:
 * each read arms it, so `loadInFlight` reaches 2, every save is deferred behind
 * both, and the indicator reports syncing until the slower one lands — or until
 * the gate's two-minute watchdog gives up on it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const universe = { slug: 'claude-s-chambers-2', name: "Claude's Chambers" };

/** A backend whose actual read is a controllable, counted stub. */
const makeBackend = () => {
  const backend = Object.create(UniverseBackend.prototype);
  backend._inFlightLoads = new Map();
  backend.reads = 0;
  let release;
  backend.releaseRead = (value) => release(value);
  backend._loadUniverseDataGated = vi.fn(() => {
    backend.reads += 1;
    return new Promise((resolve) => { release = resolve; });
  });
  return backend;
};

describe('loadUniverseData coalescing', () => {
  let backend;
  beforeEach(() => { backend = makeBackend(); });

  it('reads once when boot and the auth handler race for the same universe', async () => {
    const a = backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    const b = backend.loadUniverseData(universe, { allowPermissionPrompt: false });

    expect(backend.reads).toBe(1);

    backend.releaseRead({ ok: true });
    expect(await a).toEqual({ ok: true });
    expect(await b).toEqual({ ok: true });
  });

  it('gives both callers the same result object, not two parses of it', async () => {
    const a = backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    const b = backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    const state = { nodePrototypes: new Map() };
    backend.releaseRead(state);
    expect(await a).toBe(await b);
  });

  it('lets a later caller start fresh once the first read has settled', async () => {
    const first = backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    backend.releaseRead({ ok: 1 });
    await first;

    backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    expect(backend.reads).toBe(2);
  });

  it('does not latch the slug when a read fails', async () => {
    const failing = backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    // A rejected read must clear the entry, or the universe could never be
    // loaded again for the life of the session.
    backend.releaseRead(Promise.reject(new Error('network down')));
    await expect(failing).rejects.toThrow('network down');

    backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    expect(backend.reads).toBe(2);
  });

  it('never shares a no-prompt read with a caller that needs to prompt', async () => {
    // A read that could not ask for local file access cannot answer for one
    // that must — the second caller would silently lose its prompt.
    backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    backend.loadUniverseData(universe, { allowPermissionPrompt: true });
    expect(backend.reads).toBe(2);
  });

  it('shares a prompting read with a caller that does not need one', async () => {
    backend.loadUniverseData(universe, { allowPermissionPrompt: true });
    backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    expect(backend.reads).toBe(1);
  });

  it('keeps different universes independent', async () => {
    backend.loadUniverseData(universe, { allowPermissionPrompt: false });
    backend.loadUniverseData({ slug: 'other' }, { allowPermissionPrompt: false });
    expect(backend.reads).toBe(2);
  });
});
