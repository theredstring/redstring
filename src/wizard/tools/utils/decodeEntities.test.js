import { describe, it, expect } from 'vitest';
import { decodeEntities, decodeArgEntities } from './decodeEntities.js';

describe('decodeEntities', () => {
  it('decodes the ampersand the model escaped in a connection name', () => {
    expect(decodeEntities('Reduces Separation Rates &amp; Vacancy Duration'))
      .toBe('Reduces Separation Rates & Vacancy Duration');
  });

  it('decodes XML entities, &nbsp; and numeric references', () => {
    expect(decodeEntities('&lt;a&gt; &quot;b&quot; &apos;c&#39; d&nbsp;e &#x2014;'))
      .toBe('<a> "b" \'c\' d e —');
  });

  it('decodes one layer only and leaves unknown entities alone', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('R&D &copy; & &#0;')).toBe('R&D &copy; & &#0;');
  });

  it('walks nested args and leaves non-strings as they are', () => {
    expect(decodeArgEntities({
      name: 'A &amp; B',
      edges: [{ source: 'X', type: 'Causes &amp; Sustains' }],
      count: 3,
      flag: null,
    })).toEqual({
      name: 'A & B',
      edges: [{ source: 'X', type: 'Causes & Sustains' }],
      count: 3,
      flag: null,
    });
  });
});
