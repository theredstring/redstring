import { describe, it, expect, afterEach } from 'vitest';
import { startSession, stopSession } from '../../src/utils/perfSession.js';

afterEach(() => stopSession());

describe('perfSession', () => {
  it('restores the frame loop and timers it wraps when stopped', () => {
    const raf = window.requestAnimationFrame;
    const si = window.setInterval;
    startSession({ log: false });
    expect(window.requestAnimationFrame).not.toBe(raf);
    stopSession();
    expect(window.requestAnimationFrame).toBe(raf);
    expect(window.setInterval).toBe(si);
  });

  it('attributes frame loops and intervals to where they were registered', () => {
    const s = startSession({ log: false });
    const loop = () => {};
    window.requestAnimationFrame(loop);
    window.requestAnimationFrame(loop);
    const id = window.setInterval(() => {}, 250);
    const r = s.report();
    expect(r.frameLoops.reduce((n, l) => n + l.calls, 0)).toBe(2);
    expect(Object.keys(r.intervals).some((k) => k.endsWith('every 250ms'))).toBe(true);
    window.clearInterval(id);
    expect(Object.keys(s.report().intervals).some((k) => k.endsWith('every 250ms'))).toBe(false);
  });
});
