// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createMind, readChoice, readText, readKey, echoes } from '../../src/druid/mind/createMind.js';
import { scripted } from '../../src/druid/mind/backends.js';
import { assemble, clipToTokens, WINDOW } from '../../src/druid/mind/budget.js';

describe('readers', () => {
  it('reads a choice from the schema field, or from bare text, and rejects out-of-range', () => {
    expect(readChoice('{"choice":"2"}', 3)).toBe(1);
    expect(readChoice('{ "choice": "3" }', 3)).toBe(2);
    expect(readChoice('I pick 2.', 3)).toBe(1);
    expect(readChoice('{"choice":"9"}', 3)).toBeNull();
    expect(readChoice('{3}', 3)).toBe(2); // LM Studio's integer-enum output
  });

  it('reads text, clips it to its words, and refuses placeholders', () => {
    expect(readText('{"text":"desert rock"}', 4)).toBe('desert rock');
    expect(readText('{"text":"one two three four five six"}', 4)).toBe('one two three four');
    // Cut where a phrase ends, not mid-phrase.
    expect(readText('{"text":"Yeast ferments sugars to produce carbon dioxide gas, causing the dough to rise"}', 10)).toBe('Yeast ferments sugars to produce carbon dioxide gas');
    expect(readText('{"text":"Knead the dough until it is smooth and"}', 7)).toBe('Knead the dough until it is smooth');
    expect(readText('{"text":"..."}', 4)).toBeNull();
    expect(readText('{"text":"___"}', 4)).toBeNull();
    expect(readText('{"text":"  "}', 4)).toBeNull();
    expect(readText('{"text":"new thing"}', 4)).toBeNull();
    expect(readText('{"text":"Something"}', 4)).toBeNull();
    expect(readText('{"text":"Thingamajig"}', 4)).toBe('Thingamajig');
  });

  it('reads a scale key', () => {
    expect(readKey('{"answer":"supports"}', ['supports', 'weakens'])).toBe('supports');
    expect(readKey('it weakens it', ['supports', 'weakens'])).toBe('weakens');
    expect(readKey('{"answer":"maybe"}', ['supports', 'weakens'])).toBeNull();
  });
});

describe('budget', () => {
  it('keeps every section within its cap, so a 4K window always fits', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `line ${i} of a very long view`).join('\n');
    const p = assemble({ system: big, view: big, wm: big, loop: big, notice: big, question: 'Pick one.' }, 300);
    expect(p.tokens).toBeLessThanOrEqual(WINDOW);
  });

  it('trims surroundings before thoughts when the window is tighter, never the question', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `line ${i} of a very long view`).join('\n');
    const p = assemble({ system: 'sys', view: big, loop: big, wm: 'held: River', question: 'Pick one.' }, 300, 1600);
    expect(p.tokens).toBeLessThanOrEqual(1600);
    expect(p.user).toContain('Pick one.');
    expect(p.user).toContain('held: River');
    expect(p.trimmed[0]).toBe('view');
  });

  it('clips by whole lines', () => {
    expect(clipToTokens('aaaa\nbbbb\ncccc', 3)).toBe('aaaa\n…');
  });
});

describe('createMind', () => {
  it('poses numbered options and returns the index; counts invalid answers instead of acting on them', async () => {
    const seen = [];
    const answers = ['{"choice":"2"}', '{"choice":"7"}'];
    const mind = createMind({ backend: scripted((req) => { seen.push(req); return answers.shift(); }) });
    const a = await mind.choose({ system: 'S', view: 'V', question: 'Where next?', options: ['open River', 'follow to Valley'] });
    expect(a.index).toBe(1);
    expect(seen[0].user).toMatch(/Where next\?\n1\. open River\n2\. follow to Valley/);
    expect(seen[0].schema.schema.properties.choice.enum).toEqual(['1', '2']);
    const b = await mind.choose({ question: 'Again?', options: ['a', 'b'] });
    expect(b.ok).toBe(false);
    expect(mind.stats).toMatchObject({ calls: 2, invalid: 1 });
  });

  it('asks again when a name comes back as a sentence, and never clips a name into a fragment', async () => {
    const twice = createMind({ backend: scripted(() => ({ text: 'a stone made of quartz grains' })) });
    expect((await twice.fill({ question: 'Name it.', maxWords: 3 })).text).toBeNull();
    expect(twice.stats.calls).toBe(2);

    const answers = [{ text: 'a stone made of quartz grains' }, { text: 'Quartzite' }];
    const seen = [];
    const second = createMind({ backend: scripted((req) => { seen.push(req.user); return answers.shift(); }) });
    expect((await second.fill({ question: 'Name it.', maxWords: 3 })).text).toBe('Quartzite');
    expect(seen[1]).toMatch(/a name, not a sentence/);
  });

  it('clips a longer fill (a description) to its word limit', async () => {
    const mind = createMind({ backend: scripted(() => ({ text: 'one two three four five six seven eight nine ten' })) });
    expect((await mind.fill({ question: 'Describe it.', maxWords: 8 })).text).toBe('one two three four five six seven eight');
  });

  it('judges on a fixed scale', async () => {
    const mind = createMind({ backend: scripted(() => ({ answer: 'weakens' })) });
    const r = await mind.judge({ question: 'Does it hold?', scale: [{ key: 'supports', label: 'yes' }, { key: 'weakens', label: 'no' }] });
    expect(r.key).toBe('weakens');
  });

  it('survives a backend that throws', async () => {
    const mind = createMind({ backend: { complete: async () => { throw new Error('down'); } } });
    const r = await mind.choose({ question: 'x', options: ['a'] });
    expect(r).toMatchObject({ ok: false, error: 'down' });
  });
});

describe('an answer that only repeats the question', () => {
  const Q = 'In one plain sentence: what are you thinking now? Name the Things you mean.';
  it('is recognized', () => {
    expect(echoes('What are you thinking now? Name the Things you mean.', Q)).toBe(true);
    expect(echoes('Yeast makes the dough rise.', Q)).toBe(false);
    expect(echoes('now', Q)).toBe(false);
  });

  it('is asked again, and a real answer is kept', async () => {
    const answers = ['{"text":"What are you thinking now? Name the Things you mean."}', '{"text":"Yeast makes the dough rise."}'];
    const seen = [];
    const mind = createMind({ backend: scripted((req) => { seen.push(req.user); return answers.shift(); }) });
    const r = await mind.fill({ system: 's', question: Q, maxWords: 30 });
    expect(r.text).toBe('Yeast makes the dough rise.');
    expect(seen[1]).toMatch(/Do not repeat the question/);
  });
});
