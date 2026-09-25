import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRenderProbe } from './renderProbe.js';

// onRender(id, phase, actualDuration, baseDuration, startTime, commitTime)
const report = (probe, id, phase, ms, commitTime) => probe.onRender(id, phase, ms, ms, commitTime - ms, commitTime);

describe('renderProbe: aggregation', () => {
  it('sums commits and durations per id and overall', () => {
    const probe = createRenderProbe({ enabled: true });
    probe.start('S1');
    report(probe, 'NodeCanvas', 'mount', 10, 100);
    report(probe, 'NodeCanvas', 'update', 4, 200);
    report(probe, 'NodeCanvas', 'update', 6, 300);
    report(probe, 'NodeCanvas', 'nested-update', 2, 301);
    const r = probe.stop();

    expect(r).toMatchObject({ label: 'S1', commits: 4, totalMs: 22, maxMs: 10 });
    expect(r.byId).toEqual({
      NodeCanvas: {
        commits: 4,
        totalMs: 22,
        maxMs: 10,
        phases: { mount: 1, update: 2, 'nested-update': 1 },
      },
    });
    expect(r.wallMs).toBeGreaterThanOrEqual(0);
  });

  it('counts Profilers reporting in the same commit as one commit, timed by the largest', () => {
    const probe = createRenderProbe({ enabled: true });
    probe.start('nested');
    // Inner reports before outer; the outer duration includes the inner one.
    report(probe, 'EdgeLayer', 'update', 3, 500);
    report(probe, 'NodeCanvas', 'update', 8, 500);
    report(probe, 'NodeCanvas', 'update', 5, 600);
    const r = probe.stop();

    expect(r.commits).toBe(2);
    expect(r.totalMs).toBe(13);
    expect(r.maxMs).toBe(8);
    expect(r.byId.EdgeLayer).toMatchObject({ commits: 1, totalMs: 3 });
    expect(r.byId.NodeCanvas).toMatchObject({ commits: 2, totalMs: 13, maxMs: 8 });
  });

  it('splits a synchronous follow-up commit that shares a commitTime', () => {
    const probe = createRenderProbe({ enabled: true });
    probe.start('cascade');
    report(probe, 'NodeCanvas', 'mount', 2, 50);
    report(probe, 'NodeCanvas', 'nested-update', 1, 50);
    const r = probe.stop();

    expect(r.commits).toBe(2);
    expect(r.totalMs).toBe(3);
  });

  it('keeps phases it does not know about', () => {
    const probe = createRenderProbe({ enabled: true });
    probe.start();
    report(probe, 'X', 'future-phase', 1, 1);
    expect(probe.stop().byId.X.phases).toEqual({ mount: 0, update: 0, 'nested-update': 0, 'future-phase': 1 });
  });

  it('returns plain JSON with rounded milliseconds', () => {
    const probe = createRenderProbe({ enabled: true });
    probe.start('json');
    report(probe, 'NodeCanvas', 'update', 1.23456789, 10);
    const r = probe.stop();

    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.totalMs).toBe(1.235);
  });
});

describe('renderProbe: sessions and labels', () => {
  it('records only between start and stop', () => {
    const probe = createRenderProbe({ enabled: true });
    report(probe, 'NodeCanvas', 'update', 5, 1);
    probe.start('a');
    report(probe, 'NodeCanvas', 'update', 1, 2);
    const a = probe.stop();
    report(probe, 'NodeCanvas', 'update', 5, 3);

    expect(a).toMatchObject({ label: 'a', commits: 1, totalMs: 1 });
    expect(probe.stop()).toBeNull();
  });

  it('start() discards a session already running', () => {
    const probe = createRenderProbe({ enabled: true });
    probe.start('a');
    report(probe, 'NodeCanvas', 'update', 1, 1);
    probe.start('b');
    report(probe, 'NodeCanvas', 'update', 2, 2);
    expect(probe.stop()).toMatchObject({ label: 'b', commits: 1, totalMs: 2 });
  });

  it('back-to-back sessions do not share data', () => {
    const probe = createRenderProbe({ enabled: true });
    probe.start('a');
    report(probe, 'NodeCanvas', 'update', 1, 1);
    expect(probe.stop().commits).toBe(1);
    probe.start('b');
    const b = probe.stop();
    expect(b).toMatchObject({ label: 'b', commits: 0, totalMs: 0, maxMs: 0, byId: {} });
  });

  it('reset() discards the running session', () => {
    const probe = createRenderProbe({ enabled: true });
    probe.start('a');
    report(probe, 'NodeCanvas', 'update', 1, 1);
    probe.reset();
    expect(probe.stop()).toBeNull();
    expect(probe.isEnabled()).toBe(true);
  });
});

describe('renderProbe: peek', () => {
  it('reads the running totals without ending the session', () => {
    const probe = createRenderProbe({ enabled: true });
    expect(probe.peek()).toBeNull();
    probe.start('S1');
    report(probe, 'NodeCanvas', 'update', 3, 100);
    expect(probe.peek()).toEqual({ commits: 1, totalMs: 3, maxMs: 3 });
    report(probe, 'NodeCanvas', 'update', 5, 200);
    expect(probe.stop()).toMatchObject({ commits: 2, totalMs: 8, maxMs: 5 });
    expect(probe.peek()).toBeNull();
  });
});

describe('renderProbe: inert when off', () => {
  it('records nothing and refuses to start while disabled', () => {
    const probe = createRenderProbe();
    expect(probe.isEnabled()).toBe(false);
    report(probe, 'NodeCanvas', 'update', 1, 1);
    expect(() => probe.start('x')).toThrow(/probe is off/);
    expect(probe.stop()).toBeNull();
  });

  it('enable() turns it on; disable() turns it off and drops the session', () => {
    const probe = createRenderProbe();
    expect(probe.enable()).toBe(true);
    probe.start('a');
    report(probe, 'NodeCanvas', 'update', 1, 1);
    expect(probe.disable()).toBe(false);
    report(probe, 'NodeCanvas', 'update', 1, 2);
    expect(probe.stop()).toBeNull();
    expect(() => probe.start('b')).toThrow();
  });
});

describe('renderProbe: the window singleton', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    window.history.replaceState(null, '', '/');
    delete window.__renderProbe;
  });

  const load = async () => {
    delete window.__renderProbe;
    vi.resetModules();
    return import('./renderProbe.js');
  };

  it('is installed but off in dev without ?probe=1', async () => {
    const mod = await load();
    expect(window.__renderProbe).toBe(mod.renderProbe);
    expect(mod.onRenderProbe).toBe(mod.renderProbe.onRender);
    expect(mod.renderProbe.isEnabled()).toBe(false);
  });

  it('is on when the page URL has ?probe=1', async () => {
    window.history.replaceState(null, '', '/?probe=1');
    const mod = await load();
    expect(mod.renderProbe.isEnabled()).toBe(true);
  });

  it('is installed in the profile build', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'profile');
    const mod = await load();
    expect(window.__renderProbe).toBe(mod.renderProbe);
  });

  it('is not installed in a normal production build, even with ?probe=1', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'production');
    window.history.replaceState(null, '', '/?probe=1');
    const mod = await load();
    expect(window.__renderProbe).toBeUndefined();
    expect(mod.renderProbe.isEnabled()).toBe(false);
  });
});
