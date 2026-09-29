/**
 * S-42 — C-2 contract: sanitizeColor.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeColor, isSafeColor } from '../../../src/utils/safeColor.js';

describe('sanitizeColor', () => {
  it.each([
    '#fff', '#FFFA', '#8B0000', '#8b0000cc',
    'maroon', 'Maroon', 'rebeccapurple', 'transparent', 'currentColor',
    'rgb(1,2,3)', 'rgb( 1 , 2 , 3 )', 'rgba(1, 2, 3, 0.5)', 'rgba(1,2,3,.5)',
    'rgb(10% 20% 30%)', 'rgb(1 2 3 / 0.4)', 'hsl(0, 50%, 40%)', 'hsla(120deg, 50%, 40%, 0.3)',
    'hsl(0.5turn 50% 40% / 50%)',
  ])('accepts %s', (c) => {
    expect(sanitizeColor(c)).toBe(c.trim());
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeColor('  #abc  ')).toBe('#abc');
  });

  it.each([
    'red);background:url(x)',
    'red;background:url(https://evil/x)',
    'url(https://x)',
    'URL(https://x)',
    'expression(alert(1))',
    'red; } body { display:none',
    'var(--x)',
    'rgb(var(--x), 1, 2)',
    'rgb(1,2,3);color:red',
    'calc(1px)',
    'linear-gradient(red, blue)',
    'image-set("x.png" 1x)',
    '#ggg',
    '#12345',
    'red\\3b background',
    '"red"',
    "'red'",
    '<script>',
    'notacolor',
    'rgb(1,2)',
    'rgb(a,b,c)',
    'rgb(1,2,3',
    '',
    '   ',
    'x'.repeat(200),
    null,
    undefined,
    0xff0000,
    {},
  ])('rejects %s', (c) => {
    expect(sanitizeColor(c)).toBeNull();
    expect(isSafeColor(c)).toBe(false);
  });

  it('returns the fallback when rejected', () => {
    expect(sanitizeColor('url(x)', '#8B0000')).toBe('#8B0000');
    expect(sanitizeColor(undefined, 'maroon')).toBe('maroon');
  });
});
