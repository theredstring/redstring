/**
 * The left panel's History view, now carrying two different kinds of history.
 *
 * The first two tabs are undo steps from this session. The third is the
 * universe's committed history in its repository, which outlives the session
 * and is where an emptied universe is recovered from. They share a view because
 * they answer the same question at two timescales.
 */
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The git list does its own network work; this view's job is only to choose it
// and hand it a universe.
const gitProps = [];
vi.mock('../../src/components/panel/views/GitHistoryList.jsx', () => ({
  default: (props) => {
    gitProps.push(props);
    return <div data-testid="git-list">{props.universeSlug || 'active'}</div>;
  }
}));

const LeftHistoryView = (await import('../../src/components/panel/views/LeftHistoryView.jsx')).default;

/** jsdom has no ResizeObserver; this one reports a width we choose. */
const stubResizeObserver = (width) => {
  global.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback([{ contentRect: { width } }]); }
    disconnect() {}
  };
};

describe('LeftHistoryView', () => {
  beforeEach(() => {
    gitProps.length = 0;
    stubResizeObserver(400);
  });
  afterEach(() => {
    cleanup();
    delete global.ResizeObserver;
  });

  it('offers Git where Global used to be', () => {
    render(<LeftHistoryView />);

    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Web')).toBeTruthy();
    expect(screen.getByText('Git')).toBeTruthy();
    expect(screen.queryByText('Global')).toBeNull();
  });

  it('starts on the session history, not the repository', () => {
    render(<LeftHistoryView />);
    expect(screen.getByText('Action History')).toBeTruthy();
    expect(screen.queryByTestId('git-list')).toBeNull();
  });

  it('shows the repository versions when Git is chosen', () => {
    render(<LeftHistoryView />);
    fireEvent.click(screen.getByText('Git'));

    expect(screen.getByTestId('git-list')).toBeTruthy();
    expect(screen.getByText('Versions')).toBeTruthy();
    // The undo-step counter is meaningless for commits, so it goes away.
    expect(screen.queryByText(/steps back|actions/)).toBeNull();
  });

  it('opens straight to the universe a repository row asked for', () => {
    render(<LeftHistoryView gitRequest={{ universeSlug: 'claude-s-chambers-2', at: 1 }} />);

    expect(screen.getByTestId('git-list').textContent).toBe('claude-s-chambers-2');
  });

  it('re-selects the tab when the same universe is asked for again', () => {
    const { rerender } = render(<LeftHistoryView gitRequest={{ universeSlug: 'a', at: 1 }} />);
    fireEvent.click(screen.getByText('All'));
    expect(screen.queryByTestId('git-list')).toBeNull();

    // Same universe, new click: `at` is what makes it a fresh request.
    rerender(<LeftHistoryView gitRequest={{ universeSlug: 'a', at: 2 }} />);
    expect(screen.getByTestId('git-list')).toBeTruthy();
  });

  it('falls back to the active universe when Git is chosen from the tab', () => {
    render(<LeftHistoryView gitRequest={{ universeSlug: 'claude-s-chambers-2', at: 1 }} />);
    fireEvent.click(screen.getByText('All'));
    fireEvent.click(screen.getByText('Git'));

    expect(screen.getByTestId('git-list').textContent).toBe('active');
  });

  it('drops the tab labels when the panel is too narrow for them', () => {
    stubResizeObserver(220);
    const { container } = render(<LeftHistoryView />);

    expect(container.querySelector('.left-history-view').className).toContain('slim');
    expect(gitProps.length).toBe(0);
  });

  it('keeps the labels at a normal panel width', () => {
    const { container } = render(<LeftHistoryView />);
    expect(container.querySelector('.left-history-view').className).not.toContain('slim');
  });

  it('tells the git list when it is running narrow', () => {
    stubResizeObserver(220);
    render(<LeftHistoryView />);
    fireEvent.click(screen.getByText('Git'));

    expect(gitProps[gitProps.length - 1].isSlim).toBe(true);
  });
});
