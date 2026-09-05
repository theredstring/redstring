/**
 * Tests for the shared name-matching rule.
 */
import { describe, it, expect } from 'vitest';
import { nameMatchScore, bestNameMatch } from './nameMatch.js';

describe('nameMatchScore', () => {
  it('scores an identical name highest', () => {
    expect(nameMatchScore('Fitts 1954', 'fitts 1954')).toBe(3);
  });

  it('scores containment above word overlap', () => {
    expect(nameMatchScore('Fitts 1954 Motor Capacity', 'Fitts 1954')).toBe(2);
  });

  // The case that silently dropped a link: neither string contains the other,
  // because of the parentheses alone.
  it('matches a citation across punctuation', () => {
    expect(nameMatchScore('Bliss & Lomo (1973) Long-Term Potentiation', 'Bliss & Lomo 1973')).toBe(1);
    expect(nameMatchScore('Miller (1956) Working Memory', 'Miller 1956')).toBe(1);
  });

  it('does not match on a single shared word', () => {
    expect(nameMatchScore('Reason (1990) Swiss Cheese Model', 'Rasmussen 1990')).toBe(0);
    expect(nameMatchScore('Cognitive Load Theory', 'Theory')).toBe(2); // containment is real
    expect(nameMatchScore('Sweller 1988 Cognitive Load', 'Nielsen 1988')).toBe(0);
  });

  it('rejects unrelated names', () => {
    expect(nameMatchScore('Photosynthesis', 'Fitts 1954')).toBe(0);
    expect(nameMatchScore('', 'Fitts')).toBe(0);
    expect(nameMatchScore('Fitts', '')).toBe(0);
  });
});

describe('bestNameMatch', () => {
  const protos = [
    { id: 'p1', name: 'Miller (1956) Working Memory' },
    { id: 'p2', name: 'Bliss & Lomo (1973) Long-Term Potentiation' },
    { id: 'p3', name: 'Miller 1956' }
  ];

  it('prefers a stronger match over an earlier one', () => {
    // p3 is an exact match and comes last; p1 only matches on words.
    expect(bestNameMatch('Miller 1956', protos, p => p.name).id).toBe('p3');
  });

  it('finds a Thing whose name the model paraphrased', () => {
    expect(bestNameMatch('Bliss & Lomo 1973', protos, p => p.name).id).toBe('p2');
  });

  it('returns null when nothing matches', () => {
    expect(bestNameMatch('Dekker 2006', protos, p => p.name)).toBe(null);
  });

  // Prototypes accumulate; the oldest same-named one is the stale one.
  it('takes the last of equally good matches', () => {
    const dupes = [{ id: 'old', name: 'Fitts 1954' }, { id: 'new', name: 'Fitts 1954' }];
    expect(bestNameMatch('Fitts 1954', dupes, p => p.name).id).toBe('new');
  });
});
