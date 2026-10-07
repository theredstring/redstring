/**
 * Apple's on-device model, wherever this device has it: the desktop app on a
 * Mac (Electron's main process runs native/afm-bridge) or the iPhone and iPad
 * app (the AppleModel Capacitor plugin, built from the same Swift core). Both
 * take the same requests (native/afm-bridge/Sources/AFMCore/AppleModelCore.swift).
 *
 * Used by the Druid (its mind backend, src/druid/inApp/druidSession.js) and by
 * the Wizard's chat (provider 'apple' in src/wizard/LLMClient.js). The model's
 * whole window is 4,096 tokens, so the Wizard can only chat on it: its tools
 * alone are twice that.
 *
 * Safe to import anywhere: in Node, or a browser without the app, there is
 * simply no transport.
 */

import { estimateTokens } from '../wizard/tokenEstimate.js';

export const APPLE_PROVIDER = 'apple';
export const APPLE_MODEL_ID = 'apple-on-device';
export const APPLE_LABEL = 'Apple Intelligence (on this device)';

let pluginPromise = null;

/**
 * The AppleModel plugin on iOS, or null anywhere else.
 *
 * Capacitor's plugin object is a Proxy that turns any property into a native
 * method call, `then` included, so it must never resolve a promise or be
 * awaited: the promise would call the plugin's "then", which never answers,
 * and waking the Druid on an iPad waited forever (2026-10-07). It is kept
 * inside a plain object instead.
 */
function iosPlugin() {
  const cap = globalThis.Capacitor;
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'ios') return null;
  pluginPromise ||= import('@capacitor/core').then(({ registerPlugin }) => {
    const plugin = registerPlugin('AppleModel');
    return { send: (args) => plugin.send(args) };
  });
  return pluginPromise;
}

/**
 * `send(request) → Promise<reply>` to Apple's model on this device, or null
 * when this device has no way to reach it.
 * @param {Object} [electron] window.electron (passed in tests)
 */
export function appleModelTransport(electron = globalThis.window?.electron) {
  if (electron?.druid?.afm) return (req) => electron.druid.afm(req);
  const plugin = iosPlugin();
  if (plugin) return async (req) => (await plugin).send({ request: req });
  return null;
}

/** How long a health check may take before the model counts as not answering. */
const HEALTH_MS = 15000;

/**
 * Ask whether the model is there, giving up after HEALTH_MS: a check that
 * never answers must not leave the Druid waking, or Settings waiting, forever.
 */
export function askHealth(send, ms = HEALTH_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(send({ op: 'health' })).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Apple's on-device model didn't answer.")), ms); })
  ]);
}

/** Why the model can't be used, in words for the person. */
export function unavailableReason(health) {
  switch (health?.reason) {
    case 'deviceNotEligible': return "This device can't run Apple Intelligence.";
    case 'appleIntelligenceNotEnabled': return 'Turn on Apple Intelligence in System Settings to use it.';
    case 'modelNotReady': return "Apple's model is still downloading. Try again in a little while.";
    case 'osTooOld': return "Apple's on-device model needs macOS 26 or iOS 26.";
    default: return health?.error ? `Apple's model isn't available here (${health.error}).` : "Apple's model isn't available here.";
  }
}

let healthCache = null;

/**
 * Whether Apple's model can be used on this device: { available, reason,
 * contextSize }. Asked once, then remembered; `fresh` asks again.
 */
export async function appleModelHealth({ fresh = false, electron } = {}) {
  if (healthCache && !fresh) return healthCache;
  const send = appleModelTransport(electron);
  // Not remembered: there is nothing to ask yet (the iOS bridge may not be up).
  if (!send) return { available: false, reason: 'noTransport' };
  try {
    const h = await askHealth(send);
    healthCache = { available: !!h?.available, reason: h?.reason || null, contextSize: h?.contextSize || 4096 };
  } catch (err) {
    healthCache = { available: false, reason: null, error: err?.message || String(err) };
  }
  return healthCache;
}

const textOf = (c) => (Array.isArray(c) ? c.map(b => (typeof b === 'string' ? b : b?.text || '')).join('') : String(c ?? ''));

/**
 * A chat, fitted to the window: the system prompt, then as much of the
 * conversation as fits, newest kept, as one transcript the model answers.
 * Returns { system, user } for a single plain-text request.
 */
export function fitChat(messages, { window = 4096, maxTokens = 512 } = {}) {
  const system = messages.filter(m => m.role === 'system').map(m => textOf(m.content)).join('\n\n');
  const turns = messages.filter(m => (m.role === 'user' || m.role === 'assistant') && textOf(m.content).trim());
  const room = window - maxTokens - 200;
  // The system prompt gets at most half; the conversation the rest.
  let sys = system;
  while (estimateTokens(sys) > room / 2 && sys.length > 200) sys = sys.slice(0, Math.floor(sys.length * 0.8));
  let left = room - estimateTokens(sys);
  const kept = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const line = `${turns[i].role === 'user' ? 'Person' : 'You'}: ${textOf(turns[i].content).trim()}`;
    const cost = estimateTokens(line);
    if (cost > left) {
      // The newest message always goes in, cut to fit if it must.
      if (!kept.length) kept.unshift(line.slice(0, Math.max(200, Math.floor(left * 3.5))));
      break;
    }
    kept.unshift(line);
    left -= cost;
  }
  const last = turns[turns.length - 1];
  const user = kept.length > 1 || (last && last.role !== 'user')
    ? `The conversation so far:\n${kept.join('\n')}\n\nReply to the person's last message.`
    : textOf(last?.content).trim();
  return { system: sys, user };
}

/** An error written for the person: the chat shows it as it is. */
const said = (message) => Object.assign(new Error(message), { userFacing: true });

/** What a failed answer means, in plain words. */
function failureText(r) {
  const e = String(r?.error || '');
  if (e === 'guardrailViolation') return "Apple's model declined to answer that.";
  if (e === 'exceededContextWindowSize') return "That was too long for Apple's model. Try a shorter question.";
  if (r?.available === false) return unavailableReason(r);
  // The system's model service stuck (seen on a Mac after days awake); a restart clears it.
  if (/ModelManagerError|1026/.test(e)) return "Apple's model isn't responding on this device right now. Restarting the device usually fixes it.";
  return `Apple's model couldn't answer (${e || 'no reply'}).`;
}

/**
 * The Wizard's provider stream for Apple's model: plain text only, one chunk.
 * Tools can't fit in its window, so a request that brings tools is refused.
 */
export async function* streamApple(messages, tools = [], { maxTokens = 512, temperature = 0.7, electron } = {}) {
  if (tools?.length) {
    throw said("Apple's on-device model can only chat. To build or edit with the Wizard, pick another provider in Settings › AI.");
  }
  const send = appleModelTransport(electron);
  if (!send) throw said("Apple's on-device model needs the Mac app or the iPhone and iPad app.");
  let health;
  try { health = await appleModelHealth({ electron }); } catch (err) { throw said(err?.message || "Apple's on-device model didn't answer."); }
  if (!health.available) throw said(health.error ? failureText(health) : unavailableReason(health));
  const answer = Math.min(Number(maxTokens) || 512, 1024);
  const { system, user } = fitChat(messages, { window: health.contextSize || 4096, maxTokens: answer });
  let r;
  try { r = await send({ op: 'complete', system, user, maxTokens: answer, temperature }); } catch (err) { throw said(failureText({ error: err?.message || String(err) })); }
  if (!r?.ok) throw said(failureText(r));
  yield { type: 'text', content: String(r.content || '') };
}
