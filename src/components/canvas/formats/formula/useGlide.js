/**
 * Numbers that glide to new values: a formula's boxes when one of its tokens
 * switches between its symbol and its name, so the rest slide aside instead
 * of jumping. Plain numbers for plain SVG attributes (framer-motion's x/y and
 * width/height on SVG are CSS, which the canvas's transforms throw off).
 */
import { useEffect, useRef, useState } from 'react';

export const GLIDE_MS = 240;
export const glideEase = (t) => 1 - Math.pow(1 - t, 3);

/**
 * @param {Record<string, number>} target - where the numbers should be
 * @param {Record<string, number>} [from] - where they start, the first time
 *   (else where they should be)
 * @returns {Record<string, number>} where they are now
 */
export function useGlide(target, from = null) {
  const key = Object.keys(target).map(k => `${k}:${target[k]}`).join('|');
  const [now, setNow] = useState(from ?? target);
  const ref = useRef({ current: from ?? target, frame: 0 });

  useEffect(() => {
    const glide = ref.current;
    const from = glide.current;
    const keys = Object.keys(target);
    if (keys.every(k => from[k] === target[k])) return undefined;
    // Something new (or missing before) starts where it should be.
    if (keys.some(k => typeof from[k] !== 'number')) {
      glide.current = target;
      setNow(target);
      return undefined;
    }
    const start = performance.now();
    cancelAnimationFrame(glide.frame);
    const step = (t) => {
      const p = Math.min(1, (t - start) / GLIDE_MS);
      const e = glideEase(p);
      const next = {};
      for (const k of keys) next[k] = from[k] + (target[k] - from[k]) * e;
      glide.current = next;
      setNow(next);
      if (p < 1) glide.frame = requestAnimationFrame(step);
    };
    glide.frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(glide.frame);
    // `key` stands for `target`'s values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return now;
}
