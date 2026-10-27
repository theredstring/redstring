import { describe, it, expect } from 'vitest';
import { extractChatMath, chatMathHtml } from './chatMath.jsx';
import { sanitizeHtml } from '../../utils/sanitizeHtml.js';

const drawn = (text) => {
  const { text: out, restore } = extractChatMath(text);
  return restore(out);
};

describe('the wizard\'s math in the chat', () => {
  it('is drawn as a formula, inline and on its own line', () => {
    const inline = drawn('In textbooks, $F = ma$ and $E = mc^2$ are fragments.');
    expect(inline.match(/class="chat-math"/g)).toHaveLength(2);
    expect(inline).toContain('formula-tokens');
    expect(inline).not.toContain('$');

    const display = drawn('$$K = \\frac{p^2}{2m}$$');
    expect(display).toContain('chat-math is-display');
    expect(display).toContain('formula-frac');
  });

  it('reads a lone symbol or an expression, not only equations', () => {
    expect(chatMathHtml('m')).toContain('formula-tokens');
    expect(chatMathHtml('\\frac{1}{2} m v^2')).toContain('formula-frac');
  });

  it('what the reader refuses still reads as math, not LaTeX source', () => {
    const html = chatMathHtml('\\Delta T = \\dot{Q} R_{th}');
    expect(html).toContain('is-loose');
    expect(html).not.toMatch(/>[^<]*\\[A-Za-z]/); // no \command left in the text
    expect(html).toContain('Δ');
    expect(html).toContain('<sub>');
  });

  it('keeps the source on it', () => {
    expect(chatMathHtml('E = mc^2')).toContain('title="E = mc^2"');
  });

  it('leaves prices and code alone', () => {
    expect(drawn('It costs $5 and $10.')).toBe('It costs $5 and $10.');
    expect(drawn('Run `echo $HOME $PATH` now')).toBe('Run `echo $HOME $PATH` now');
  });

  it('survives the sanitizer, roots and all', () => {
    const html = chatMathHtml('\\sqrt{x}');
    expect(html).toContain('<svg');
    expect(sanitizeHtml(html, { svg: true })).toContain('<svg');
    expect(sanitizeHtml(html)).not.toContain('<svg');
  });
});
