// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

// Like Capacitor's own: a Proxy that makes every property a native call,
// `then` included, and a method the plugin doesn't have never answers.
vi.mock('@capacitor/core', () => ({
  registerPlugin: (name) => new Proxy({}, {
    get: (_, prop) => (prop === 'send'
      ? async ({ request }) => ({ ok: true, via: name, op: request.op, available: true, contextSize: 4096 })
      : () => new Promise(() => {}))
  })
}));

const { appleModelTransport, appleModelHealth, askHealth, fitChat, streamApple, unavailableReason } = await import('./appleModel.js');
const { estimateTokens } = await import('../wizard/tokenEstimate.js');

/** A stand-in for the Mac app's helper, answering the way afm-bridge does. */
const mac = (answer = 'Hello there.', health = { ok: true, available: true, contextSize: 4096 }) => {
  const sent = [];
  return { sent, electron: { druid: { afm: async (req) => { sent.push(req); return req.op === 'health' ? health : { ok: true, content: answer, usage: {} }; } } } };
};

const drain = async (gen) => { let text = ''; for await (const c of gen) text += c.content; return text; };

afterEach(() => { delete globalThis.Capacitor; });

describe("Apple's on-device model", () => {
  it('reaches the Mac helper in the desktop app, the plugin on iPhone and iPad, and nothing elsewhere', async () => {
    const { electron, sent } = mac();
    await appleModelTransport(electron)({ op: 'health' });
    expect(sent).toEqual([{ op: 'health' }]);

    expect(appleModelTransport({})).toBeNull();

    globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    expect(await appleModelTransport({})({ op: 'health' })).toMatchObject({ via: 'AppleModel', op: 'health' });

    globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    expect(appleModelTransport({})).toBeNull();
  });

  it('gives up on a health check that never answers', async () => {
    await expect(askHealth(() => new Promise(() => {}), 20)).rejects.toThrow(/didn't answer/);
    expect(await askHealth(async () => ({ available: true }), 20)).toEqual({ available: true });
  });

  it('says why it is unavailable, in plain words', async () => {
    expect(unavailableReason({ reason: 'appleIntelligenceNotEnabled' })).toMatch(/Turn on Apple Intelligence/);
    expect(unavailableReason({ reason: 'osTooOld' })).toMatch(/macOS 26 or iOS 26/);
    const h = await appleModelHealth({ fresh: true, electron: {} });
    expect(h).toEqual({ available: false, reason: 'noTransport' });
  });

  it('fits a long chat into its window, keeping the newest turns', () => {
    const long = 'word '.repeat(400);
    const messages = [
      { role: 'system', content: 'You are a concise Redstring copilot.' },
      ...Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}: ${long}` })),
      { role: 'user', content: 'What is in a ham sandwich?' }
    ];
    const { system, user } = fitChat(messages, { window: 4096, maxTokens: 512 });
    expect(system).toBe('You are a concise Redstring copilot.');
    expect(estimateTokens(system) + estimateTokens(user)).toBeLessThan(4096 - 512);
    expect(user).toContain('What is in a ham sandwich?');
    expect(user).not.toContain('0: word');
    expect(user).toMatch(/Reply to the person's last message\.$/);

    // A single question goes as it is.
    expect(fitChat([{ role: 'user', content: 'Hi' }]).user).toBe('Hi');
  });

  it("chats, and refuses the Wizard's tools rather than dropping them", async () => {
    const { electron, sent } = mac('A ham sandwich holds bread, ham and often cheese.');
    const text = await drain(streamApple([{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'What is in a ham sandwich?' }], [], { electron, maxTokens: 300 }));
    expect(text).toBe('A ham sandwich holds bread, ham and often cheese.');
    expect(sent.at(-1)).toMatchObject({ op: 'complete', system: 'Be brief.', user: 'What is in a ham sandwich?', maxTokens: 300 });
    expect(sent.at(-1).schema).toBeUndefined();

    await expect(drain(streamApple([{ role: 'user', content: 'Build a web' }], [{ name: 'createGraph' }], { electron }))).rejects.toThrow(/can only chat/);
  });

  it('turns a refusal or an unavailable model into a plain error', async () => {
    const declined = { druid: { afm: async (req) => (req.op === 'health' ? { available: true, contextSize: 4096 } : { ok: false, error: 'guardrailViolation' }) } };
    await appleModelHealth({ fresh: true, electron: declined });
    await expect(drain(streamApple([{ role: 'user', content: 'x' }], [], { electron: declined }))).rejects.toThrow(/declined to answer/);

    const off = { druid: { afm: async () => ({ ok: true, available: false, reason: 'modelNotReady' }) } };
    await appleModelHealth({ fresh: true, electron: off });
    await expect(drain(streamApple([{ role: 'user', content: 'x' }], [], { electron: off }))).rejects.toThrow(/still downloading/);
  });
});

describe("the Wizard's 'apple' provider", () => {
  it('chats through the shared client with no key, and never asks for consent to send', async () => {
    const { callLLM } = await import('../wizard/LLMClient.js');
    const { describeAIProvider } = await import('./aiConsent.js');
    const { electron, sent } = mac('Bread, ham, cheese.');
    globalThis.window = { electron };
    try {
      await appleModelHealth({ fresh: true });
      const { content } = await callLLM([{ role: 'user', content: 'What is in a ham sandwich?' }], [], { provider: 'apple', model: 'apple-on-device', apiKey: 'apple' });
      expect(content).toBe('Bread, ham, cheese.');
      expect(sent.at(-1)).toMatchObject({ op: 'complete', user: 'What is in a ham sandwich?' });
    } finally {
      delete globalThis.window;
    }
    expect(describeAIProvider('apple')).toMatchObject({ isLocal: true, label: 'Apple Intelligence (on this device)' });
  });
});
