/**
 * S-81: one-time consent before graph content goes to a third-party AI
 * provider (App Store 5.1.2(i), Play AI policy), enforced at the single place
 * every renderer request passes through (streamLLM's request gate), plus a
 * way to report offensive output.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ensureAIConsent,
  hasAIConsent,
  needsAIConsent,
  describeAIProvider,
  consentCopy,
  clearAIConsents,
  installAIConsentGate,
  buildAIOutputReportUrl,
  __testing
} from '../../../src/services/aiConsent.js';
import { streamLLM, setLLMRequestGate } from '../../../src/wizard/LLMClient.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(resolve(here, rel), 'utf8');

function installLocalStorage() {
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
  globalThis.localStorage = ls;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  installLocalStorage();
  clearAIConsents();
});
afterEach(() => {
  setLLMRequestGate(null);
  __testing.resetGate();
  globalThis.fetch = realFetch;
});

describe('who receives what', () => {
  it('names the provider and host, and says what is sent', () => {
    const d = describeAIProvider('openrouter');
    expect(d).toMatchObject({ label: 'OpenRouter', host: 'openrouter.ai', isLocal: false });
    const copy = consentCopy(d);
    expect(copy.title).toBe('Send to OpenRouter?');
    expect(copy.message).toContain('OpenRouter (openrouter.ai)');
    expect(copy.message).toMatch(/what you type/);
    expect(copy.message).toMatch(/files you attach/);
    expect(copy.message).toMatch(/names, descriptions and connections/);
    expect(copy.details).toMatch(/once for each provider/);
  });

  it('local servers never ask', () => {
    expect(needsAIConsent('local', 'http://localhost:11434/v1/chat/completions')).toBe(false);
    expect(needsAIConsent('custom', 'http://127.0.0.1:1234/v1/chat/completions')).toBe(false);
    expect(needsAIConsent('custom', 'https://llm.example.com/v1/chat/completions')).toBe(true);
  });
});

describe('ensureAIConsent', () => {
  it('asks once per provider and remembers acceptance', async () => {
    const ask = vi.fn(async () => true);
    await expect(ensureAIConsent({ provider: 'anthropic' }, { ask })).resolves.toBe(true);
    await expect(ensureAIConsent({ provider: 'anthropic' }, { ask })).resolves.toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(hasAIConsent('anthropic')).toBe(true);
    // A different provider asks again.
    await ensureAIConsent({ provider: 'openai' }, { ask });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('a custom endpoint on another host asks again', async () => {
    const ask = vi.fn(async () => true);
    await ensureAIConsent({ provider: 'custom', endpoint: 'https://a.example/v1' }, { ask });
    await ensureAIConsent({ provider: 'custom', endpoint: 'https://b.example/v1' }, { ask });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('declining throws AI_CONSENT_DECLINED and records nothing', async () => {
    const error = await ensureAIConsent({ provider: 'openrouter' }, { ask: async () => false }).catch((e) => e);
    expect(error.code).toBe('AI_CONSENT_DECLINED');
    expect(hasAIConsent('openrouter')).toBe(false);
  });

  it('concurrent requests share one dialog', async () => {
    let resolveAsk;
    const ask = vi.fn(() => new Promise((r) => { resolveAsk = r; }));
    const a = ensureAIConsent({ provider: 'google' }, { ask });
    const b = ensureAIConsent({ provider: 'google' }, { ask });
    await Promise.resolve();
    await Promise.resolve();
    resolveAsk(true);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('the gate sits in front of every provider request', () => {
  it('nothing is fetched when consent is declined', async () => {
    globalThis.fetch = vi.fn();
    setLLMRequestGate((config) => ensureAIConsent(config, { ask: async () => false }));
    const gen = streamLLM([{ role: 'user', content: 'my graph' }], [], { provider: 'openrouter', apiKey: 'k', model: 'm' });
    const error = await gen.next().catch((e) => e);
    expect(error.code).toBe('AI_CONSENT_DECLINED');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('a local model is not gated', async () => {
    const ask = vi.fn(async () => false);
    setLLMRequestGate((config) => ensureAIConsent(config, { ask }));
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    const gen = streamLLM([{ role: 'user', content: 'x' }], [], { provider: 'local', endpoint: 'http://localhost:11434/v1/chat/completions', model: 'm' });
    await gen.next().catch(() => {});
    expect(ask).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('installAIConsentGate wires ensureAIConsent into LLMClient', async () => {
    installAIConsentGate();
    localStorage.setItem('redstring_ai_consent_v1', JSON.stringify({ 'openrouter@openrouter.ai': { acceptedAt: 'x' } }));
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    const gen = streamLLM([{ role: 'user', content: 'x' }], [], { provider: 'openrouter', apiKey: 'k', model: 'm' });
    await gen.next().catch(() => {});
    expect(globalThis.fetch).toHaveBeenCalled(); // consent on file → request proceeds
  });
});

describe('fail closed and stay out of Node', () => {
  it('with the gate installed but no way to ask, nothing is sent', async () => {
    installAIConsentGate();
    globalThis.fetch = vi.fn();
    const gen = streamLLM([{ role: 'user', content: 'x' }], [], { provider: 'anthropic', apiKey: 'k', model: 'm' });
    const error = await gen.next().catch((e) => e);
    expect(error.code).toBe('AI_CONSENT_DECLINED');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('the consent logic imports no UI (LLMClient is shared with the Node agent bundle)', async () => {
    const src = readSource('../../../src/services/aiConsent.js');
    expect(src).not.toMatch(/from ['"]react|import\(['"]react|\.jsx['"]/);
    const manager = readSource('../../../src/services/apiKeyManager.js');
    expect(manager).not.toMatch(/aiConsentPrompt/);
  });

  it('the key setup UI installs the prompt', async () => {
    for (const rel of ['../../../src/ai/components/APIKeySetup.jsx', '../../../src/components/settings/AISection.jsx']) {
      const src = readSource(rel);
      expect(src).toMatch(/import '[./]*(ai\/)?aiConsentPrompt\.js';/);
    }
  });
});

describe('the dialog', () => {
  it('Continue resolves true; the dialog is removed afterwards', async () => {
    const { showAIConsentDialog } = await import('../../../src/ai/aiConsentPrompt.js');
    const d = describeAIProvider('openrouter');
    const answer = showAIConsentDialog(d, consentCopy(d));
    await vi.waitFor(() => expect(document.body.textContent).toContain('Send to OpenRouter?'));
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue');
    button.click();
    await expect(answer).resolves.toBe(true);
    await vi.waitFor(() => expect(document.querySelector('[data-redstring-ai-consent]')).toBeNull());
  });

  it('Not now resolves false', async () => {
    const { showAIConsentDialog } = await import('../../../src/ai/aiConsentPrompt.js');
    const d = describeAIProvider('anthropic');
    const answer = showAIConsentDialog(d, consentCopy(d));
    await vi.waitFor(() => expect(document.body.textContent).toContain('Send to Anthropic?'));
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Not now');
    button.click();
    await expect(answer).resolves.toBe(false);
  });
});

describe('reporting offensive output', () => {
  it('builds a mailto: link with provider, model and an excerpt', () => {
    const url = buildAIOutputReportUrl({ provider: 'openrouter', model: 'x/y', excerpt: 'bad text' });
    expect(url.startsWith('mailto:info@redstring.io?')).toBe(true);
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('Provider: openrouter');
    expect(body).toContain('Model: x/y');
    expect(body).toContain('bad text');
  });

  it('caps the excerpt', () => {
    const url = buildAIOutputReportUrl({ excerpt: 'a'.repeat(5000) });
    expect(decodeURIComponent(url).length).toBeLessThan(1400);
  });
});
