import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import useElementWidth from '../../src/hooks/useElementWidth.js';

// A ResizeObserver the test fires by hand, and a width the test sets.
let observers = [];
let width = 300;
beforeEach(() => {
  observers = [];
  width = 300;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() {} };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 10, left: 0, top: 0, right: width, bottom: 10 }));
});
afterEach(() => vi.restoreAllMocks());

function Probe({ onWidth }) {
  const [ref, w] = useElementWidth(0);
  onWidth(w);
  return <div ref={ref} />;
}

const resize = (to) => { width = to; observers.forEach((o) => o.cb()); };
const panel = (type) => window.dispatchEvent(new CustomEvent(type, { detail: { side: 'right', width } }));

describe('useElementWidth', () => {
  it('follows the element as it resizes', () => {
    const seen = [];
    render(<Probe onWidth={(w) => seen.push(w)} />);
    act(() => resize(420));
    expect(seen.at(-1)).toBe(420);
  });

  it('follows a panel drag frame by frame', () => {
    const seen = [];
    render(<Probe onWidth={(w) => seen.push(w)} />);
    act(() => panel('panelWidthChanging'));
    act(() => resize(350));
    expect(seen.at(-1)).toBe(350);
    act(() => resize(450));
    expect(seen.at(-1)).toBe(450);
  });
});
