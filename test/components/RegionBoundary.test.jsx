import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RegionBoundary, AppBoundary } from '../../src/components/shared/RegionBoundary.jsx';
import useGraphStore from '../../src/store/graphStore.js';

let shouldThrow = true;
function Fragile() {
  if (shouldThrow) throw new Error('a Thing has no name');
  return <div>types bar ok</div>;
}

describe('RegionBoundary', () => {
  let errorSpy;
  beforeEach(() => {
    shouldThrow = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('contains a crash to its region; the rest keeps rendering', () => {
    render(
      <div>
        <RegionBoundary region="canvas"><div>canvas ok</div></RegionBoundary>
        <RegionBoundary region="type-list" variant="bar"><Fragile /></RegionBoundary>
      </div>,
    );
    expect(screen.getByText('canvas ok')).toBeTruthy();
    expect(screen.getByText('The types bar hit an error')).toBeTruthy();
    expect(errorSpy.mock.calls.some((c) => String(c[0]).startsWith('[crash] type-list'))).toBe(true);
  });

  it('recovers on Try again once the cause is gone', () => {
    render(<RegionBoundary region="canvas"><Fragile /></RegionBoundary>);
    shouldThrow = false;
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.getByText('types bar ok')).toBeTruthy();
  });

  it('clears itself when the active web changes', () => {
    render(<RegionBoundary region="canvas"><Fragile /></RegionBoundary>);
    expect(screen.getByText('The canvas hit an error')).toBeTruthy();
    shouldThrow = false;
    act(() => useGraphStore.setState({ activeGraphId: 'another-web' }));
    expect(screen.getByText('types bar ok')).toBeTruthy();
  });

  it('AppBoundary never leaves a blank screen', () => {
    render(<AppBoundary><Fragile /></AppBoundary>);
    expect(screen.getByText('Redstring hit an error')).toBeTruthy();
    expect(screen.getByText('Reload')).toBeTruthy();
  });
});
