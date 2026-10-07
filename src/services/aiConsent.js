/**
 * One-time consent before graph content goes to a third-party AI provider.
 *
 * Redstring is BYOK: the Wizard talks to the user's chosen provider directly,
 * with the user's own key, and each request carries what they typed, any
 * files they attached and the parts of the open universe the Wizard needs.
 * App Store guideline 5.1.2(i) and Play's AI policy both require saying so,
 * and naming who receives it, before the first such request. This module owns
 * that promise:
 *
 *   - the acknowledgement is stored per provider + host, so a new provider (or
 *     a custom endpoint on another host) asks again;
 *   - local servers (localhost / 127.0.0.1 / provider 'local') never ask:
 *     nothing leaves the machine;
 *   - the check runs at the single place every renderer request passes
 *     through, `streamLLM` in src/wizard/LLMClient.js, via its request gate.
 *     The renderer installs it (src/ai/aiConsentPrompt.js, loaded with the
 *     panel's key setup); Node callers (MCP server, CLI) never do.
 *
 * Declining throws `AI_CONSENT_DECLINED`; nothing is sent.
 */

import { setLLMRequestGate, resolveEndpoint } from '../wizard/LLMClient.js';

const CONSENT_STORAGE_KEY = 'redstring_ai_consent_v1';

const PROVIDER_LABELS = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google (Gemini)',
  cohere: 'Cohere',
  apple: 'Apple Intelligence (on this device)'
};

// Providers the Wizard reaches without a configurable endpoint.
const DEFAULT_HOSTS = {
  google: 'generativelanguage.googleapis.com'
};

const REPORT_ADDRESS = 'info@redstring.io';

function safeHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

const isLoopbackHost = (host) =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost');

/**
 * Who receives a request for this provider/endpoint.
 * @returns {{ key: string, label: string, host: string, isLocal: boolean }}
 */
export function describeAIProvider(provider, endpoint) {
  const name = String(provider || 'openrouter').toLowerCase();
  const resolved = resolveEndpoint(name, endpoint) || endpoint || '';
  const host = safeHost(resolved) || DEFAULT_HOSTS[name] || '';
  // Apple's on-device model never leaves the device, like a local server.
  const isLocal = name === 'local' || name === 'apple' || (host !== '' && isLoopbackHost(host));
  const label = PROVIDER_LABELS[name] || (host ? host : String(provider || 'the configured provider'));
  return { key: `${name}@${host || 'default'}`, label, host, isLocal };
}

function readConsents() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const parsed = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function hasAIConsent(provider, endpoint) {
  const { key } = describeAIProvider(provider, endpoint);
  return !!readConsents()[key];
}

export function recordAIConsent(provider, endpoint) {
  const { key } = describeAIProvider(provider, endpoint);
  try {
    const consents = readConsents();
    consents[key] = { acceptedAt: new Date().toISOString() };
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consents));
  } catch { /* storage blocked: the dialog will simply ask again next session */ }
}

/** Forget every acknowledgement (so the next request asks again). */
export function clearAIConsents() {
  try { localStorage.removeItem(CONSENT_STORAGE_KEY); } catch { /* storage blocked */ }
}

export function needsAIConsent(provider, endpoint) {
  const description = describeAIProvider(provider, endpoint);
  return !description.isLocal && !hasAIConsent(provider, endpoint);
}

/** The words the dialog shows, kept here so they are tested and reviewed together. */
export function consentCopy(description) {
  const who = description.host && description.label !== description.host
    ? `${description.label} (${description.host})`
    : description.label;
  return {
    title: `Send to ${description.label}?`,
    message:
      `The Wizard works by sending your request to ${who}, using your own API key. ` +
      'Each request includes what you type, any files you attach, and the parts of the open universe the Wizard needs: ' +
      'names, descriptions and connections of the things in your webs.',
    details:
      `${description.label}'s own terms and privacy policy cover what it receives. ` +
      'Redstring runs no server in between and keeps no copy. You will be asked once for each provider.',
    confirmLabel: 'Continue',
    cancelLabel: 'Not now'
  };
}

function declinedError(description) {
  const error = new Error(`Nothing was sent: sharing with ${description.label} was not approved.`);
  error.code = 'AI_CONSENT_DECLINED';
  return error;
}

// One dialog per provider at a time; concurrent requests wait on the same answer.
const pending = new Map();

// The dialog. Supplied by the renderer (src/ai/aiConsentPrompt.js) so this
// module stays free of React: LLMClient is shared with Node (MCP server, the
// agent bundle), and nothing on that side may pull in the UI.
let installedAsker = null;

/**
 * Resolve when this provider may receive graph content; throw
 * `AI_CONSENT_DECLINED` when the user says no — or when there is no way to
 * ask (fail closed).
 *
 * @param {{ provider?: string, endpoint?: string }} config
 * @param {{ ask?: (description, copy) => Promise<boolean> }} [options]
 */
export async function ensureAIConsent(config = {}, { ask = installedAsker } = {}) {
  const { provider, endpoint } = config;
  const description = describeAIProvider(provider, endpoint);
  if (description.isLocal || hasAIConsent(provider, endpoint)) return true;

  if (!pending.has(description.key)) {
    const answer = Promise.resolve()
      .then(() => (typeof ask === 'function' ? ask(description, consentCopy(description)) : false))
      .then((accepted) => {
        if (accepted === true) recordAIConsent(provider, endpoint);
        return accepted === true;
      }, () => false)
      .finally(() => pending.delete(description.key));
    pending.set(description.key, answer);
  }

  if (await pending.get(description.key)) return true;
  throw declinedError(description);
}

let gateInstalled = false;

/**
 * Route every renderer LLM request through the consent check, asking with
 * `ask` (resolves true to continue). Called once, by the renderer.
 */
export function installAIConsentGate({ ask } = {}) {
  if (typeof ask === 'function') installedAsker = ask;
  if (gateInstalled) return;
  gateInstalled = true;
  setLLMRequestGate((config) => ensureAIConsent(config));
}

/**
 * A mailto: link for reporting offensive or harmful AI output (Play's AI
 * policy). The user sees and can edit the message before anything is sent.
 * Open it with openExternalUrl (src/utils/safeUrl.js).
 *
 * @param {{ provider?: string, model?: string, excerpt?: string }} info
 */
export function buildAIOutputReportUrl({ provider, model, excerpt } = {}) {
  const trimmed = String(excerpt || '').slice(0, 1000);
  const body = [
    'What was wrong with this response?',
    '',
    '',
    '---',
    `Provider: ${provider || 'unknown'}`,
    `Model: ${model || 'unknown'}`,
    trimmed ? `Response excerpt:\n${trimmed}` : ''
  ].join('\n');
  return `mailto:${REPORT_ADDRESS}?subject=${encodeURIComponent('Report AI output')}&body=${encodeURIComponent(body)}`;
}

export const __testing = { CONSENT_STORAGE_KEY, pending, resetGate: () => { gateInstalled = false; installedAsker = null; } };
