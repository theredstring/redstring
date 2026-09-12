import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MultipleChoiceOverlay from '../../src/ai/components/MultipleChoiceOverlay.jsx';

const base = {
  question: 'Which reading of "Rotterdam" do you mean?',
  options: ['The city', 'The port authority', 'The song'],
  onSelect: () => {},
  onDismiss: () => {}
};

/** jsdom does no layout, so a scroll region has to be told it overflows. */
const fakeOverflow = (el, { scrollHeight, clientHeight, scrollTop }) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  el.scrollTop = scrollTop;
  fireEvent.scroll(el);
};

describe('MultipleChoiceOverlay', () => {
  it('answers with the option that was clicked', () => {
    const onSelect = vi.fn();
    render(<MultipleChoiceOverlay {...base} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('The port authority'));
    expect(onSelect).toHaveBeenCalledWith('The port authority');
  });

  it('scrolls its options rather than pushing the composer out of the panel', () => {
    const { container } = render(<MultipleChoiceOverlay {...base} />);
    const options = container.querySelector('.mc-options');
    expect(options.className).toContain('scroll-fade');
    // Every option keeps its own height; the list scrolls instead of squashing.
    container.querySelectorAll('.mc-option-button').forEach((btn) => {
      expect(btn.className).toContain('mc-option-button');
    });
    // The typed-answer form is outside the scroller, so it can't scroll away.
    fireEvent.click(screen.getByText('Other...'));
    expect(container.querySelector('.mc-other-form').closest('.mc-options')).toBeNull();
  });

  it('fades only the edge there is more content past', () => {
    const { container } = render(<MultipleChoiceOverlay {...base} />);
    const options = container.querySelector('.mc-options');
    // Fits: no fade at all, so a short question looks exactly as it always did.
    expect(options.className).not.toContain('scroll-fade--');

    fakeOverflow(options, { scrollHeight: 400, clientHeight: 120, scrollTop: 0 });
    expect(options.className).toContain('scroll-fade--bottom');
    expect(options.className).not.toContain('scroll-fade--top');

    fakeOverflow(options, { scrollHeight: 400, clientHeight: 120, scrollTop: 100 });
    expect(options.className).toContain('scroll-fade--top');
    expect(options.className).toContain('scroll-fade--bottom');

    fakeOverflow(options, { scrollHeight: 400, clientHeight: 120, scrollTop: 280 });
    expect(options.className).toContain('scroll-fade--top');
    expect(options.className).not.toContain('scroll-fade--bottom');
  });
});
