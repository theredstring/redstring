import { describe, it, expect } from 'vitest';
import {
  GROUP_LIFT_SHADOW_LAYERS, groupLiftShadowOn, groupLiftShadowRect, placeGroupLiftShadow,
} from '../../src/components/canvas/groups/groupLiftShadow.js';

const box = { x: 100, y: 200, w: 300, h: 150 };

describe('group lift shadow', () => {
  it('follows the Lifted Thing Shadow setting: only off turns it off', () => {
    expect(groupLiftShadowOn('off')).toBe(false);
    expect(groupLiftShadowOn('fast')).toBe(true);
    expect(groupLiftShadowOn('fancy')).toBe(true);
    expect(groupLiftShadowOn(undefined)).toBe(true);
  });

  it('grows filled layers around the box and drops them down', () => {
    const r = groupLiftShadowRect('box', box, { dy: 10, spread: 6 });
    expect(r).toEqual({ x: 94, y: 204, width: 312, height: 162 });
  });

  it('keeps an outline layer the size of the box, offset only', () => {
    const r = groupLiftShadowRect('outline', box, { dy: 10, spread: 6 });
    expect(r).toEqual({ x: 100, y: 210, width: 300, height: 150 });
  });

  it('places a rendered shadow where the render would for the same box', () => {
    const rects = GROUP_LIFT_SHADOW_LAYERS.map(l => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      el.setAttribute('data-dy', l.dy);
      el.setAttribute('data-spread', l.spread);
      return el;
    });
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-group-shadow', 'box');
    rects.forEach(r => g.appendChild(r));
    placeGroupLiftShadow(g, box);
    GROUP_LIFT_SHADOW_LAYERS.forEach((l, i) => {
      const want = groupLiftShadowRect('box', box, l);
      expect(Number(rects[i].getAttribute('x'))).toBe(want.x);
      expect(Number(rects[i].getAttribute('y'))).toBe(want.y);
      expect(Number(rects[i].getAttribute('width'))).toBe(want.width);
      expect(Number(rects[i].getAttribute('height'))).toBe(want.height);
    });
  });
});
