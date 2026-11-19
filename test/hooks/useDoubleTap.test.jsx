import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import useDoubleTap from '../../src/hooks/useDoubleTap.js';

afterEach(cleanup);

const Row = ({ label, onOpen }) => {
  const open = () => onOpen(label);
  const doubleTap = useDoubleTap(open);
  // As the rows wire it: their own onDoubleClick for the mouse, then the hook's handlers.
  return <div data-testid={label} onDoubleClick={open} {...doubleTap}>{label}</div>;
};

const tap = (el, x = 10, y = 10) => {
  fireEvent.touchStart(el, { touches: [{ clientX: x, clientY: y }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: x, clientY: y }] });
};

describe('useDoubleTap', () => {
  it('two taps on the same row open it once', () => {
    const onOpen = vi.fn();
    const { getByTestId } = render(<Row label="a" onOpen={onOpen} />);
    const a = getByTestId('a');
    tap(a);
    tap(a);
    // iOS (zoom off) also fires its own dblclick after the second tap.
    fireEvent.doubleClick(a);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('a tap on one row then the row below opens neither', () => {
    const onOpen = vi.fn();
    const { getByTestId } = render(<><Row label="a" onOpen={onOpen} /><Row label="b" onOpen={onOpen} /></>);
    tap(getByTestId('a'));
    tap(getByTestId('b'));
    // iOS counts the two taps as a double-tap and sends dblclick to the second row.
    fireEvent.doubleClick(getByTestId('b'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a mouse double-click still opens', () => {
    const onOpen = vi.fn();
    const { getByTestId } = render(<Row label="a" onOpen={onOpen} />);
    fireEvent.doubleClick(getByTestId('a'));
    expect(onOpen).toHaveBeenCalledWith('a');
  });
});
