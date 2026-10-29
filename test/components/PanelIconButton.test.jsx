import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Plus } from 'lucide-react';
import PanelIconButton from '../../src/components/shared/PanelIconButton.jsx';

const touch = (x, y) => ({ clientX: x, clientY: y, identifier: 0 });

describe('PanelIconButton on touch', () => {
  it('fires on a tap', () => {
    const onClick = vi.fn();
    const { getByRole } = render(<PanelIconButton icon={Plus} onClick={onClick} title="Add" />);
    const b = getByRole('button');
    fireEvent.touchStart(b, { touches: [touch(10, 10)] });
    fireEvent.touchEnd(b, { changedTouches: [touch(12, 11)] });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the touch scrolled past it', () => {
    const onClick = vi.fn();
    const { getByRole } = render(<PanelIconButton icon={Plus} onClick={onClick} title="Add" />);
    const b = getByRole('button');
    fireEvent.touchStart(b, { touches: [touch(10, 100)] });
    fireEvent.touchMove(b, { touches: [touch(10, 60)] });
    fireEvent.touchEnd(b, { changedTouches: [touch(10, 40)] });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire when the end is far from the start even with no move events', () => {
    const onClick = vi.fn();
    const { getByRole } = render(<PanelIconButton icon={Plus} onClick={onClick} title="Add" />);
    const b = getByRole('button');
    fireEvent.touchStart(b, { touches: [touch(10, 100)] });
    fireEvent.touchEnd(b, { changedTouches: [touch(10, 30)] });
    expect(onClick).not.toHaveBeenCalled();
  });
});
