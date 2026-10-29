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

describe('animation moments', () => {
  it('logs each animation with how long after the tap it started and which play it is', async () => {
    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a);
    try {
      startSession();
      const el = document.createElement('div');
      el.className = 'unified-selector-box';
      document.body.appendChild(el);
      const fire = () => {
        window.dispatchEvent(new Event('pointerup'));
        const e = new Event('animationstart', { bubbles: true });
        e.animationName = 'us-box-in';
        el.dispatchEvent(e);
      };
      fire();
      await new Promise((r) => setTimeout(r, 80));
      fire();
      stopSession();
      el.remove();
    } finally {
      console.log = log;
    }
    const anims = lines.filter((a) => a[1] === 'anim').map((a) => JSON.parse(a[2]));
    expect(anims.map((m) => m.play)).toEqual([1, 2]);
    expect(anims[0].what).toEqual(['us-box-in on div.unified-selector-box']);
    expect(anims[0].fromInput).toBeLessThan(50);
  });
});

describe('gestures', () => {
  it('names a press on a resize bar as its own activity and survives frames during it', async () => {
    const s = startSession({ log: false });
    const bar = document.createElement('div');
    bar.style.cursor = 'col-resize';
    document.body.appendChild(bar);
    bar.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    window.dispatchEvent(new Event('pointerup'));
    bar.remove();
    expect(Object.keys(s.report().byActivity)).toContain('gesture:resize');
  });
});

describe('script-driven animations', () => {
  it('times a perfMark like an animation event', async () => {
    const { perfMark } = await import('../../src/utils/perfSession.js');
    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a);
    try {
      startSession();
      perfMark('to-things');
      stopSession();
    } finally {
      console.log = log;
    }
    const anims = lines.filter((a) => a[1] === 'anim').map((a) => JSON.parse(a[2]));
    expect(anims[0].what).toEqual(['to-things (script)']);
    perfMark('ignored when no session runs');
  });
});
