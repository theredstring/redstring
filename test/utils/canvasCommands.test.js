import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  registerCanvasCommands,
  runCanvasCommand,
  useCanvasCommands,
} from '../../src/utils/canvas/canvasCommands.js';

// P2.08: UI outside the canvas asks it to act by name.

describe('canvas command registry', () => {
  it('runs a registered command with its arguments and returns its result', () => {
    const unregister = registerCanvasCommands({ add: (a, b) => a + b });
    expect(runCanvasCommand('add', 2, 3)).toBe(5);
    unregister();
    expect(runCanvasCommand('add', 2, 3)).toBeUndefined();
  });

  it('does nothing for a command no one registered', () => {
    expect(runCanvasCommand('nobody')).toBeUndefined();
  });

  it("an older registration's cleanup leaves a newer one in place", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerCanvasCommands({ act: first });
    const unregisterSecond = registerCanvasCommands({ act: second });
    unregisterFirst();
    runCanvasCommand('act');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unregisterSecond();
  });

  it('the hook registers once, forwards to the latest handler, and unregisters on unmount', () => {
    const v1 = vi.fn(() => 1);
    const v2 = vi.fn(() => 2);
    const { rerender, unmount } = renderHook(({ fn }) => useCanvasCommands({ act: fn }), {
      initialProps: { fn: v1 },
    });
    expect(runCanvasCommand('act')).toBe(1);
    rerender({ fn: v2 });
    expect(runCanvasCommand('act')).toBe(2);
    expect(v1).toHaveBeenCalledTimes(1);
    unmount();
    expect(runCanvasCommand('act')).toBeUndefined();
  });
});
