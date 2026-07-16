/**
 * Tests for the oneShot constrained-output utility.
 * Focus: strict parsing, graceful null fallback, and call logging.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the underlying model call and key manager so no network happens.
vi.mock('./agent/llmCaller.js', () => ({ callLLM: vi.fn() }));
vi.mock('./apiKeyManager.js', () => ({
  default: {
    getAPIKeyInfo: vi.fn(),
    getAPIKey: vi.fn()
  }
}));

import { callLLM } from './agent/llmCaller.js';
import apiKeyManager from './apiKeyManager.js';
import {
  oneShotChoice,
  oneShotBoolean,
  oneShotLabel,
  oneShotList,
  parseChoice,
  parseBoolean,
  parseLabel,
  parseList,
  optionLabel,
  logOneShotCall,
  attachOneShotOutcome,
  getOneShotLog,
  clearOneShotLog
} from './oneShot.js';

const withModel = () => {
  apiKeyManager.getAPIKeyInfo.mockResolvedValue({
    hasKey: true, provider: 'local', endpoint: 'http://localhost:1234/v1/chat/completions', model: 'test'
  });
  apiKeyManager.getAPIKey.mockResolvedValue('local');
};
const withoutModel = () => {
  apiKeyManager.getAPIKeyInfo.mockResolvedValue(null);
  apiKeyManager.getAPIKey.mockResolvedValue(null);
};

beforeEach(() => {
  vi.clearAllMocks();
  clearOneShotLog();
});

describe('parseChoice', () => {
  it('parses a bare number to a 0-based index', () => {
    expect(parseChoice('2', 3, false)).toEqual({ index: 1 });
  });
  it('extracts the number from noisy text', () => {
    expect(parseChoice('The answer is 1.', 3, false)).toEqual({ index: 0 });
  });
  it('returns null when out of range', () => {
    expect(parseChoice('9', 3, false)).toBeNull();
  });
  it('returns null for non-numeric', () => {
    expect(parseChoice('none of them', 3, false)).toBeNull();
  });
  it('recognizes the None sentinel when allowNone', () => {
    expect(parseChoice('4', 3, true)).toEqual({ none: true });
    expect(parseChoice('4', 3, false)).toBeNull();
  });
  it('returns null for empty/undefined', () => {
    expect(parseChoice('', 3, false)).toBeNull();
    expect(parseChoice(null, 3, false)).toBeNull();
  });
});

describe('parseBoolean', () => {
  it('parses yes/no', () => {
    expect(parseBoolean('yes')).toBe(true);
    expect(parseBoolean('No.')).toBe(false);
  });
  it('parses true/false and 1/0', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('0')).toBe(false);
  });
  it('returns null when ambiguous/empty', () => {
    expect(parseBoolean('maybe')).toBeNull();
    expect(parseBoolean('')).toBeNull();
    expect(parseBoolean(null)).toBeNull();
  });
});

describe('parseLabel', () => {
  it('strips quotes and trailing punctuation', () => {
    expect(parseLabel('"directed by".', 4)).toBe('directed by');
  });
  it('takes only the first line', () => {
    expect(parseLabel('is a kind of\n(because ...)', 5)).toBe('is a kind of');
  });
  it('rejects labels longer than maxWords', () => {
    expect(parseLabel('this label has way too many words in it', 4)).toBeNull();
  });
  it('rejects very long strings (likely a refusal)', () => {
    expect(parseLabel('a'.repeat(80), 10)).toBeNull();
  });
  it('returns null for empty', () => {
    expect(parseLabel('', 4)).toBeNull();
    expect(parseLabel(null, 4)).toBeNull();
  });
});

describe('parseList', () => {
  it('parses one item per line and strips numbering/bullets/quotes', () => {
    expect(parseList('1. OK Computer\n2) Kid A\n- Amnesiac\n* "In Rainbows".', 12)).toEqual(
      ['OK Computer', 'Kid A', 'Amnesiac', 'In Rainbows']
    );
  });
  it('de-duplicates case-insensitively and caps at maxItems', () => {
    expect(parseList('A\nA\nB\nC\nD', 2)).toEqual(['A', 'B']);
  });
  it('drops prose-length lines and returns null when nothing parseable', () => {
    expect(parseList('a'.repeat(90), 5)).toBeNull();
    expect(parseList('', 5)).toBeNull();
    expect(parseList(null, 5)).toBeNull();
  });
  it('respects maxWordsPerItem', () => {
    expect(parseList('Short One\nthis one has quite a lot of extra words', 5, 3)).toEqual(['Short One']);
  });
});

describe('optionLabel', () => {
  it('handles strings and objects', () => {
    expect(optionLabel('foo')).toBe('foo');
    expect(optionLabel({ name: 'Bar' })).toBe('Bar');
    expect(optionLabel({ label: 'Baz' })).toBe('Baz');
  });
});

describe('graceful fallback with no model', () => {
  beforeEach(withoutModel);

  it('oneShotChoice returns null', async () => {
    expect(await oneShotChoice({ instruction: 'x', options: ['a', 'b'] })).toBeNull();
    expect(callLLM).not.toHaveBeenCalled();
  });
  it('oneShotBoolean returns null', async () => {
    expect(await oneShotBoolean({ instruction: 'x' })).toBeNull();
  });
  it('oneShotLabel returns null', async () => {
    expect(await oneShotLabel({ instruction: 'x' })).toBeNull();
  });
  it('oneShotList returns null', async () => {
    expect(await oneShotList({ instruction: 'x' })).toBeNull();
    expect(callLLM).not.toHaveBeenCalled();
  });
  it('still logs the (empty) call', async () => {
    await oneShotChoice({ instruction: 'x', options: ['a', 'b'] });
    const log = getOneShotLog();
    expect(log.length).toBe(1);
    expect(log[0].rawResponse).toBeNull();
    expect(log[0].parsedResult).toBeNull();
  });
});

describe('oneShotChoice with a model', () => {
  beforeEach(withModel);

  it('returns the chosen option', async () => {
    callLLM.mockResolvedValue('2');
    const r = await oneShotChoice({ instruction: 'pick', options: ['alpha', 'beta', 'gamma'] });
    expect(r).toMatchObject({ index: 1, value: 'beta', none: false });
    expect(r.callId).toBeTruthy();
  });

  it('returns none when the model picks the None sentinel', async () => {
    callLLM.mockResolvedValue('3');
    const r = await oneShotChoice({ instruction: 'pick', options: ['a', 'b'], allowNone: true });
    expect(r).toMatchObject({ none: true, value: null, index: null });
  });

  it('returns null (fallback) when the model answer is malformed', async () => {
    callLLM.mockResolvedValue('I cannot help with that');
    const r = await oneShotChoice({ instruction: 'pick', options: ['a', 'b'] });
    expect(r).toBeNull();
  });

  it('returns null when the model call rejects', async () => {
    callLLM.mockRejectedValue(new Error('boom'));
    const r = await oneShotChoice({ instruction: 'pick', options: ['a', 'b'] });
    expect(r).toBeNull();
  });
});

describe('oneShotBoolean / oneShotLabel with a model', () => {
  beforeEach(withModel);

  it('boolean returns parsed value + callId', async () => {
    callLLM.mockResolvedValue('Yes, they are the same.');
    const r = await oneShotBoolean({ instruction: 'dupe?' });
    expect(r).toMatchObject({ value: true });
    expect(r.callId).toBeTruthy();
  });

  it('label returns a cleaned short string', async () => {
    callLLM.mockResolvedValue('"directed by"');
    const r = await oneShotLabel({ instruction: 'label', maxWords: 4 });
    expect(r).toMatchObject({ value: 'directed by' });
  });

  it('list returns parsed items + callId', async () => {
    callLLM.mockResolvedValue('1. Airbag\n2. Paranoid Android\n3. Exit Music');
    const r = await oneShotList({ instruction: 'songs', maxItems: 12 });
    expect(r.items).toEqual(['Airbag', 'Paranoid Android', 'Exit Music']);
    expect(r.callId).toBeTruthy();
  });

  it('list returns null (fallback) when the model gives nothing parseable', async () => {
    callLLM.mockResolvedValue('   ');
    expect(await oneShotList({ instruction: 'songs' })).toBeNull();
  });
});

describe('call log + outcome attachment', () => {
  beforeEach(withModel);

  it('records and updates an outcome', async () => {
    callLLM.mockResolvedValue('1');
    const r = await oneShotChoice({ instruction: 'pick', options: ['a', 'b'] });
    attachOneShotOutcome(r.callId, 'accepted');
    const log = getOneShotLog();
    const entry = log.find((e) => e.id === r.callId);
    expect(entry).toBeTruthy();
    expect(entry.outcome).toBe('accepted');
    expect(entry.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('logOneShotCall returns a stable id and rings the buffer', () => {
    const id = logOneShotCall({ callSite: 'test', instruction: 'i', input: 'in', rawResponse: 'r', parsedResult: 'p', latencyMs: 5 });
    expect(id).toBeTruthy();
    const entry = getOneShotLog().find((e) => e.id === id);
    expect(entry).toMatchObject({ callSite: 'test', parsedResult: 'p', latencyMs: 5, outcome: null });
  });
});
