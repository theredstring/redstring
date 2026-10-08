import { describe, it, expect, vi } from 'vitest';
import { middleClickHandlers } from '../../src/utils/middleClick.js';

const event = (button, currentTarget) => ({
  button,
  currentTarget,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn()
});

describe('middleClickHandlers', () => {
  it('fires when the middle button is pressed and released on the same tab', () => {
    const onMiddle = vi.fn();
    const tab = {};
    const h = middleClickHandlers(onMiddle);
    const down = event(1, tab);
    h.onMouseDown(down);
    h.onMouseUp(event(1, tab));
    expect(down.preventDefault).toHaveBeenCalled();
    expect(onMiddle).toHaveBeenCalledTimes(1);
  });

  it('does not fire when released over a different tab', () => {
    const onA = vi.fn();
    const onB = vi.fn();
    const a = {};
    const b = {};
    middleClickHandlers(onA).onMouseDown(event(1, a));
    middleClickHandlers(onB).onMouseUp(event(1, b));
    expect(onA).not.toHaveBeenCalled();
    expect(onB).not.toHaveBeenCalled();
  });

  it('ignores the left and right buttons', () => {
    const onMiddle = vi.fn();
    const tab = {};
    const h = middleClickHandlers(onMiddle);
    for (const button of [0, 2]) {
      const down = event(button, tab);
      h.onMouseDown(down);
      h.onMouseUp(event(button, tab));
      expect(down.preventDefault).not.toHaveBeenCalled();
    }
    expect(onMiddle).not.toHaveBeenCalled();
  });
});
