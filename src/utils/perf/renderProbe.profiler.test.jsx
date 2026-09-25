// The probe fed by real React <Profiler> callbacks in jsdom (React dev build),
// and App.jsx's NodeCanvas wrapper. NodeCanvas and App's other children are
// stubbed: this proves the wiring, not NodeCanvas's render counts.
import { Profiler, StrictMode, useLayoutEffect, useState } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRenderProbe, renderProbe } from './renderProbe.js';

const { nullComponent } = vi.hoisted(() => ({ nullComponent: () => ({ default: () => null }) }));
vi.mock('../../NodeCanvas', () => ({ default: () => <div data-testid="node-canvas-stub" /> }));
vi.mock('../../SpawningNodeDragLayer', nullComponent);
vi.mock('../../components/canvas/hosts/HeaderHost.jsx', nullComponent);
vi.mock('../../components/canvas/hosts/PanelHost.jsx', nullComponent);
vi.mock('../../components/canvas/hosts/TypeListHost.jsx', nullComponent);
vi.mock('../../components/canvas/hosts/ModalHosts.jsx', nullComponent);
vi.mock('../../components/canvas/hosts/SyncDebugHost.jsx', nullComponent);
vi.mock('../../ai/BridgeClient.jsx', nullComponent);
vi.mock('../../components/GlobalContextMenu.jsx', nullComponent);
vi.mock('../../components/UniverseManagerBootstrap.jsx', nullComponent);
vi.mock('../../components/UpdateToast.jsx', nullComponent);
vi.mock('../../services/haptics.js', () => ({ warmHaptics: () => {} }));
vi.mock('../../services/SaveCoordinator.js', () => ({
  saveCoordinator: { flush: async () => {}, hasUnsavedChanges: () => false },
}));
vi.mock('../../utils/capacitorAdapter.js', () => ({
  isCapacitor: () => false,
  registerCapacitorLifecycle: () => () => {},
  logPlatformDiagnostics: () => {},
}));
vi.mock('../../utils/fileAccessAdapter.js', () => ({ isElectron: () => false }));
// A real zustand store with only the field App reads, so a write re-renders App.
vi.mock('../../store/graphStore.js', async () => {
  const { create } = await import('zustand');
  return { default: create(() => ({ darkMode: false })) };
});

afterEach(() => {
  cleanup();
  renderProbe.disable();
});

// eslint-disable-next-line react/prop-types
function Counter({ n }) {
  return <span>{n}</span>;
}

describe('renderProbe with React Profiler (jsdom, dev build)', () => {
  it('counts mount and update commits', () => {
    const probe = createRenderProbe({ enabled: true });
    const tree = (n) => (
      <Profiler id="Tiny" onRender={probe.onRender}>
        <Counter n={n} />
      </Profiler>
    );
    probe.start('tiny');
    const { rerender } = render(tree(0));
    rerender(tree(1));
    rerender(tree(2));
    const r = probe.stop();

    expect(r.commits).toBe(3);
    expect(r.byId.Tiny).toMatchObject({ commits: 3, phases: { mount: 1, update: 2, 'nested-update': 0 } });
    expect(r.byId.Tiny.totalMs).toBeGreaterThanOrEqual(0);
    expect(r.totalMs).toBe(r.byId.Tiny.totalMs);
  });

  it('does not double-count commits under StrictMode (F-28)', () => {
    const probe = createRenderProbe({ enabled: true });
    const tree = (n) => (
      <StrictMode>
        <Profiler id="Tiny" onRender={probe.onRender}>
          <Counter n={n} />
        </Profiler>
      </StrictMode>
    );
    probe.start('strict');
    const { rerender } = render(tree(0));
    rerender(tree(1));
    expect(probe.stop().byId.Tiny.commits).toBe(2);
  });

  it('reports a layout-effect cascade as a nested-update commit', () => {
    function Cascade() {
      const [v, setV] = useState(0);
      useLayoutEffect(() => { if (v === 0) setV(1); }, [v]);
      return <span>{v}</span>;
    }
    const probe = createRenderProbe({ enabled: true });
    probe.start('cascade');
    render(
      <Profiler id="Cascade" onRender={probe.onRender}>
        <Cascade />
      </Profiler>
    );
    const r = probe.stop();

    expect(r.commits).toBe(2);
    expect(r.byId.Cascade.phases).toEqual({ mount: 1, update: 0, 'nested-update': 1 });
  });

  it('counts nested Profilers once per commit, timed by the outer one', () => {
    const probe = createRenderProbe({ enabled: true });
    const tree = (n) => (
      <Profiler id="Outer" onRender={probe.onRender}>
        <Profiler id="Inner" onRender={probe.onRender}>
          <Counter n={n} />
        </Profiler>
      </Profiler>
    );
    probe.start('nested');
    const { rerender } = render(tree(0));
    rerender(tree(1));
    const r = probe.stop();

    expect(r.commits).toBe(2);
    expect(r.byId.Outer.commits).toBe(2);
    expect(r.byId.Inner.commits).toBe(2);
    expect(r.totalMs).toBe(r.byId.Outer.totalMs);
  });

  it('records nothing while the probe is disabled', () => {
    const probe = createRenderProbe({ enabled: true });
    probe.start('off');
    probe.disable();
    render(
      <Profiler id="Tiny" onRender={probe.onRender}>
        <Counter n={0} />
      </Profiler>
    );
    expect(probe.stop()).toBeNull();
  });
});

describe('App renders NodeCanvas inside <Profiler id="NodeCanvas"> (CanvasShell, P2.11)', () => {
  it('reports NodeCanvas commits to window.__renderProbe, and an App re-render does not reach it', async () => {
    const { default: App } = await import('../../App.jsx');
    const { default: useGraphStore } = await import('../../store/graphStore.js');

    expect(window.__renderProbe).toBe(renderProbe);
    window.__renderProbe.enable();
    window.__renderProbe.start('app');
    const { getByTestId } = render(<App />);
    expect(getByTestId('node-canvas-stub')).toBeTruthy();
    // App re-renders on darkMode; the memoized shell keeps that from NodeCanvas.
    act(() => useGraphStore.setState({ darkMode: true }));
    const r = window.__renderProbe.stop();

    expect(r.label).toBe('app');
    // The mount, then the shell's overlay slot attaching (a nested update in
    // the same commit's layout phase).
    expect(r.byId.NodeCanvas).toMatchObject({ commits: 2, phases: { mount: 1, update: 0, 'nested-update': 1 } });
    expect(r.byId.NodeCanvas.totalMs).toBeGreaterThanOrEqual(0);
  });
});
