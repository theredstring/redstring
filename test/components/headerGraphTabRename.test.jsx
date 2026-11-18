import React, { useState } from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

vi.mock('../../src/components/VectorText.jsx', () => ({
  VectorText: ({ text }) => <span>{text}</span>,
}));
vi.mock('../../src/services/haptics.js', () => ({ haptic: () => {} }));

import useGraphStore from '../../src/store/graphStore.js';
import HeaderGraphTab from '../../src/HeaderGraphTab.jsx';

// The header renders the active and inactive tab at the same spot in the tree,
// so a tab keeps its instance when it becomes active. A rename must not count
// the tap that switched to the tab as the first half of its double-click.
const Harness = ({ onRename }) => {
  const [active, setActive] = useState(false);
  return (
    <DndProvider backend={HTML5Backend}>
      <HeaderGraphTab
        graph={{ id: 'g1', name: 'Web One', color: '#800000', definingNodeId: 'p1' }}
        isActive={active}
        onSelect={() => setActive(true)}
        onDoubleClick={active ? onRename : undefined}
      />
    </DndProvider>
  );
};

const tab = (container) => container.querySelector('[title="Web One"]');

describe('HeaderGraphTab rename gesture', () => {
  beforeEach(() => {
    useGraphStore.setState({ nodePrototypes: new Map([['p1', { id: 'p1', name: 'Web One' }]]) });
  });
  afterEach(cleanup);

  it('does not rename when the first click of the pair switched to the tab', () => {
    const onRename = vi.fn();
    const { container } = render(<Harness onRename={onRename} />);
    const el = tab(container);
    act(() => { fireEvent.click(el, { detail: 1 }); });
    act(() => { fireEvent.click(el, { detail: 2 }); });
    act(() => { fireEvent.doubleClick(el); });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('renames on a double-click while the tab is already active', () => {
    const onRename = vi.fn();
    const { container } = render(<Harness onRename={onRename} />);
    const el = tab(container);
    act(() => { fireEvent.click(el, { detail: 1 }); }); // switch
    act(() => { fireEvent.click(el, { detail: 1 }); });
    act(() => { fireEvent.click(el, { detail: 2 }); });
    act(() => { fireEvent.doubleClick(el); });
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('does not rename when the switching tap is followed by one more tap', () => {
    const onRename = vi.fn();
    const { container } = render(<Harness onRename={onRename} />);
    const el = tab(container);
    // iPad: tap 1 switches (touchend runs while inactive), tap 2 lands on the
    // now-active tab, and WebKit emulates a dblclick for the pair.
    act(() => { fireEvent.touchEnd(el); fireEvent.click(el, { detail: 1 }); });
    act(() => { fireEvent.touchEnd(el); fireEvent.click(el, { detail: 2 }); });
    act(() => { fireEvent.doubleClick(el); });
    expect(onRename).not.toHaveBeenCalled();
  });
});
