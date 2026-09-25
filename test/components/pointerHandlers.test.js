import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// utils.js measures text when it loads; jsdom has no 2D context.
import { vi } from 'vitest';
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    return { font: '', measureText: (text) => ({ width: text.length * 8 }) };
  };
});

import { createPointerHandlers } from '../../src/components/canvas/input/pointerHandlers.js';

// The canvas pointer handlers (P4.04a), moved out of NodeCanvas. NodeCanvas
// creates them once and destructures them; a name it expects that the module
// doesn't return would be undefined at the first event, which lint can't see.
describe('createPointerHandlers', () => {
  it('provides every name NodeCanvas takes from it, as stable functions', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/NodeCanvas.jsx'), 'utf8');
    const names = new Set();
    for (const m of src.matchAll(/const \{([^}]*)\} = pointer;/g)) m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => names.add(n));
    for (const m of src.matchAll(/\bpointer\.(\w+)/g)) names.add(m[1]);
    expect(names.size).toBeGreaterThan(5);
    const ctxRef = { current: null };
    const a = createPointerHandlers(ctxRef);
    for (const n of names) expect(typeof a[n], n).toBe('function');
  });
});
