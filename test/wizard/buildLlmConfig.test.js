import { describe, it, expect } from 'vitest';
import {
  buildLlmConfig,
  resolveMaxIterations,
  resolveMaxAskTokens
} from '../../src/wizard/buildLlmConfig.js';

/**
 * These two clamps are cost ceilings, not preferences. They used to live inside
 * anonymous IIFEs in wizard-server.js with no coverage; now that the browser
 * builds the same config, a drift here means a runaway bill on one platform and
 * not the other. Pin the exact numbers.
 */

const small = (settings = {}) => ({ modelTier: 'small', settings });
const large = (settings = {}) => ({ modelTier: 'large', settings });

describe('resolveMaxIterations', () => {
  it('defaults per tier', () => {
    expect(resolveMaxIterations(small())).toBe(177);
    expect(resolveMaxIterations(large())).toBe(77);
  });

  it('treats an absent tier as large', () => {
    expect(resolveMaxIterations({})).toBe(77);
    expect(resolveMaxIterations()).toBe(77);
  });

  it('reads the tier-specific setting and ignores the other tier’s', () => {
    expect(resolveMaxIterations(small({ maxIterationsLocal: 50, maxIterationsCloud: 5 }))).toBe(50);
    expect(resolveMaxIterations(large({ maxIterationsLocal: 50, maxIterationsCloud: 5 }))).toBe(5);
  });

  it('clamps to the tier ceiling', () => {
    expect(resolveMaxIterations(small({ maxIterationsLocal: 9999 }))).toBe(300);
    expect(resolveMaxIterations(large({ maxIterationsCloud: 9999 }))).toBe(100);
  });

  it('reads 0 / negative / Infinity as "as many as allowed" — the ceiling, not 9999', () => {
    expect(resolveMaxIterations(small({ maxIterationsLocal: 0 }))).toBe(300);
    expect(resolveMaxIterations(large({ maxIterationsCloud: 0 }))).toBe(100);
    expect(resolveMaxIterations(large({ maxIterationsCloud: -1 }))).toBe(100);
    // Infinity is not finite, so it falls back to the default rather than the
    // ceiling. Documented here because the difference is easy to misread.
    expect(resolveMaxIterations(large({ maxIterationsCloud: Infinity }))).toBe(77);
  });

  it('falls back to the default for non-numeric configuration', () => {
    expect(resolveMaxIterations(large({ maxIterationsCloud: 'lots' }))).toBe(77);
    expect(resolveMaxIterations(large({ maxIterationsCloud: null }))).toBe(77);
  });

  it('floors fractional values and never returns less than 1', () => {
    expect(resolveMaxIterations(large({ maxIterationsCloud: 12.9 }))).toBe(12);
    expect(resolveMaxIterations(large({ maxIterationsCloud: 0.5 }))).toBe(100); // floors to 0 → ceiling
  });
});

describe('resolveMaxAskTokens', () => {
  it('defaults to 500k', () => {
    expect(resolveMaxAskTokens(large())).toBe(500000);
    expect(resolveMaxAskTokens()).toBe(500000);
  });

  it('clamps to the 2M hard ceiling', () => {
    expect(resolveMaxAskTokens(large({ maxAskTokens: 99000000 }))).toBe(2000000);
  });

  it('honours a configured value below the ceiling', () => {
    expect(resolveMaxAskTokens(large({ maxAskTokens: 120000 }))).toBe(120000);
  });

  it('treats 0 / negative / non-numeric as unset — the default, never unbounded', () => {
    expect(resolveMaxAskTokens(large({ maxAskTokens: 0 }))).toBe(500000);
    expect(resolveMaxAskTokens(large({ maxAskTokens: -5 }))).toBe(500000);
    expect(resolveMaxAskTokens(large({ maxAskTokens: 'none' }))).toBe(500000);
  });
});

describe('buildLlmConfig', () => {
  it('produces the shape runAgent expects', () => {
    const config = buildLlmConfig({
      apiKey: 'sk-test',
      apiConfig: {
        provider: 'anthropic',
        endpoint: 'https://example.test/v1',
        model: 'claude-x',
        modelTier: 'large',
        settings: { temperature: 0.2, max_tokens: 4096 }
      },
      cid: 'cid-123',
      systemPrompt: 'custom',
      contextItems: [{ id: 'a' }],
      conversationHistory: [{ role: 'user', content: 'hi' }]
    });

    expect(config).toMatchObject({
      apiKey: 'sk-test',
      provider: 'anthropic',
      endpoint: 'https://example.test/v1',
      model: 'claude-x',
      modelTier: 'large',
      temperature: 0.2,
      maxTokens: 4096,
      cid: 'cid-123',
      systemPrompt: 'custom',
      maxIterations: 77,
      maxAskTokens: 500000
    });
    expect(config.contextItems).toEqual([{ id: 'a' }]);
    expect(config.conversationHistory).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('defaults provider to openrouter and mints a cid when none is given', () => {
    const config = buildLlmConfig({ apiKey: 'k' });
    expect(config.provider).toBe('openrouter');
    expect(config.modelTier).toBe('large');
    expect(config.cid).toMatch(/^wizard-\d+$/);
    expect(config.conversationHistory).toEqual([]);
    expect(config.contextItems).toEqual([]);
  });
});
