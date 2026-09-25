import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import HurtleOrb, { hurtleFrame } from './HurtleOrb.jsx';

vi.mock('../../../services/haptics.js', () => ({
  createDetentTrack: () => ({ reset: vi.fn(), update: vi.fn() }),
}));

const flightAt = (startTime, over = {}) => ({
  startTime, duration: 400,
  startPos: { x: 100, y: 500 }, targetPos: { x: 640, y: 25 },
  orbSize: 30, nodeColor: 'rgb(128, 0, 0)', targetGraphId: 'g2',
  ...over,
});

describe('hurtleFrame', () => {
  const f = flightAt(0);

  it('starts at the node as a 1 px dot under it, and ends on the tab faded out', () => {
    expect(hurtleFrame(f, 0)).toMatchObject({ x: 100, y: 500, size: 1, zIndex: 500, opacity: 1 });
    expect(hurtleFrame(f, 1)).toMatchObject({ x: 640, y: 25, size: 1, zIndex: 5000 });
    expect(hurtleFrame(f, 1).opacity).toBeCloseTo(0);
  });

  it('balloons to 1.9x the orb size mid-flight, over the header', () => {
    expect(hurtleFrame(f, 0.5)).toMatchObject({ x: 370, y: 263, size: 57, zIndex: 15000, opacity: 1 });
  });

  it('eases in and out', () => {
    expect(hurtleFrame(f, 0.25).eased).toBeCloseTo(0.125);
    expect(hurtleFrame(f, 0.75).eased).toBeCloseTo(0.875);
  });
});

describe('<HurtleOrb>', () => {
  let now = 0;
  let queue = [];
  const frame = (ms) => { now += ms; const q = queue; queue = []; act(() => q.forEach(([, cb]) => cb(now))); };

  beforeEach(() => {
    now = 1000; queue = [];
    let id = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { queue.push([++id, cb]); return id; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((rid) => { queue = queue.filter(([i]) => i !== rid); });
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing without a flight', () => {
    const { container } = render(<HurtleOrb flight={null} onLand={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('writes the orb straight to the DOM each frame and lands exactly once', () => {
    const onLand = vi.fn();
    const renders = vi.fn();
    const flight = flightAt(1000);
    const Probe = () => { renders(); return <HurtleOrb flight={flight} onLand={onLand} />; };
    const { container } = render(<Probe />);
    const orb = container.querySelector('[data-hurtle-orb]');
    // Positioned before the first frame: a 1 px dot on the node.
    expect(orb.style.width).toBe('1px');
    expect(orb.style.left).toBe('99.5px');
    const rendersAtLaunch = renders.mock.calls.length;

    frame(200); // halfway
    expect(orb.style.width).toBe('57px');
    expect(orb.style.zIndex).toBe('15000');
    frame(250); // past the end
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLand).toHaveBeenCalledWith(flight);
    frame(16);
    expect(onLand).toHaveBeenCalledTimes(1);
    // The flight itself never re-rendered the parent.
    expect(renders.mock.calls.length).toBe(rendersAtLaunch);
  });

  it('cancels without landing when unmounted mid-flight', () => {
    const onLand = vi.fn();
    const { unmount } = render(<HurtleOrb flight={flightAt(1000)} onLand={onLand} />);
    frame(100);
    unmount();
    frame(400);
    expect(onLand).not.toHaveBeenCalled();
  });

  it('restarts for a new flight and lands only the new one', () => {
    const onLand = vi.fn();
    const first = flightAt(1000);
    const { rerender } = render(<HurtleOrb flight={first} onLand={onLand} />);
    frame(100);
    const second = flightAt(now, { targetGraphId: 'g3' });
    rerender(<HurtleOrb flight={second} onLand={onLand} />);
    frame(450);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLand).toHaveBeenCalledWith(second);
  });
});
