/**
 * oneShot — stateless, constrained single-question model calls.
 *
 * Each call is a tiny multiple-choice / yes-no / short-label question designed
 * to run reliably on small local models (Ollama / LM Studio) as well as cloud
 * models. There is NO agent loop and NO conversation state: small input →
 * constrained output → validated by code → done.
 *
 * Design contract (every caller depends on this):
 *   - If no model is configured, the call times out, or the response can't be
 *     parsed into the expected shape, the helper returns `null`. Callers MUST
 *     fall back to their existing heuristic so the app behaves identically with
 *     zero models configured.
 *   - Nothing here ever throws into caller code.
 *   - Every call is logged (see logOneShotCall) so the corpus can later train a
 *     fine-tuned small model. Callers may attach a user outcome with
 *     attachOneShotOutcome(callId, 'accepted' | 'rejected' | 'edited' | 'ignored').
 *
 * MCP stdio rule: this module may be pulled (via resolveNodeSmart) into files
 * imported by redstring-mcp-server.js. It must NEVER use console.log — only
 * console.error — because stdout is the MCP transport. In that Node context
 * there is no localStorage and no configured key, so getModelConfig() returns
 * null and every helper degrades to the heuristic path.
 */

import apiKeyManager from './apiKeyManager.js';
import { callLLM } from './agent/llmCaller.js';

const LOG_KEY = 'redstring_oneshot_log';
const LOG_MAX = 500; // ring buffer size (JSONL lines)
const DEFAULT_TIMEOUT_MS = 3000; // interactive paths — fall back fast

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getLocalStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    // Accessing localStorage can throw (e.g. sandboxed / Node). Treat as absent.
  }
  return null;
}

let _seq = 0;
function makeId() {
  _seq += 1;
  return `os_${Date.now()}_${_seq}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Mint a build id that correlates all one-shot calls made during a single build
 * or review pass. Pass it as `buildId` to any helper. Callers on a shared build
 * (shape classification → unfold decisions → review verdicts → outcomes) reuse
 * the same id so the log can join them.
 */
export function newBuildId() {
  _seq += 1;
  return `build_${Date.now()}_${_seq}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Call logging (training-data pipeline) — JSONL ring buffer in localStorage
// ---------------------------------------------------------------------------

/**
 * Append a one-shot call record. Returns the record id (usable with
 * attachOneShotOutcome). In environments without localStorage this is a no-op
 * but still returns a stable id.
 * @param {Object} record - { callSite, instruction, input, rawResponse, parsedResult, latencyMs }
 * @returns {string} record id
 */
export function logOneShotCall(record = {}) {
  const id = record.id || makeId();
  const entry = {
    id,
    timestamp: new Date().toISOString(),
    callSite: record.callSite || 'unknown',
    // buildId correlates every call made during a single build/review pass so the
    // shape classification, unfold decisions, review verdicts, and user outcomes
    // can be joined in the training log. null for standalone calls.
    buildId: record.buildId ?? null,
    instruction: record.instruction ?? null,
    input: record.input ?? null,
    rawResponse: record.rawResponse ?? null,
    parsedResult: record.parsedResult ?? null,
    latencyMs: typeof record.latencyMs === 'number' ? record.latencyMs : null,
    // meta carries extra correlatable fields (candidate ids, shape key, etc.).
    meta: record.meta ?? null,
    outcome: null
  };

  const ls = getLocalStorage();
  if (!ls) return id;

  try {
    const raw = ls.getItem(LOG_KEY) || '';
    const lines = raw ? raw.split('\n').filter(Boolean) : [];
    lines.push(JSON.stringify(entry));
    while (lines.length > LOG_MAX) lines.shift();
    ls.setItem(LOG_KEY, lines.join('\n'));
  } catch (e) {
    console.error('[oneShot] Failed to write call log:', e?.message || e);
  }
  return id;
}

/**
 * Attach a user outcome to a previously-logged call.
 * @param {string} id - id returned by a helper (result.callId) or logOneShotCall
 * @param {'accepted'|'rejected'|'edited'|'ignored'} outcome
 */
export function attachOneShotOutcome(id, outcome) {
  if (!id) return;
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    const raw = ls.getItem(LOG_KEY) || '';
    if (!raw) return;
    const lines = raw.split('\n').filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch { continue; }
      if (obj && obj.id === id) {
        obj.outcome = outcome;
        lines[i] = JSON.stringify(obj);
        ls.setItem(LOG_KEY, lines.join('\n'));
        return;
      }
    }
  } catch (e) {
    console.error('[oneShot] Failed to attach outcome:', e?.message || e);
  }
}

/** Read the full call log (array of records). Empty array if none/unavailable. */
export function getOneShotLog() {
  const ls = getLocalStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(LOG_KEY) || '';
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Clear the call log. */
export function clearOneShotLog() {
  const ls = getLocalStorage();
  if (!ls) return;
  try { ls.removeItem(LOG_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Model configuration + raw call
// ---------------------------------------------------------------------------

/**
 * Resolve the currently-configured model from apiKeyManager, or null if none.
 * Reuses existing key/profile plumbing — no new provider code.
 */
async function getModelConfig() {
  try {
    const info = await apiKeyManager.getAPIKeyInfo();
    if (!info || !info.hasKey) return null;
    const apiKey = await apiKeyManager.getAPIKey();
    // Local providers use the 'local' placeholder / may need no key.
    if (!apiKey && info.provider !== 'local') return null;
    return {
      apiKey: apiKey || '',
      provider: info.provider,
      endpoint: info.endpoint,
      model: info.model
    };
  } catch (e) {
    console.error('[oneShot] Failed to load model config:', e?.message || e);
    return null;
  }
}

/** True if a model is configured that oneShot can call. */
export async function isOneShotAvailable() {
  return (await getModelConfig()) != null;
}

/**
 * Escape hatch for callers that need a raw (unconstrained) completion from the
 * currently-configured model — e.g. the AI duplicate detector, which asks for a
 * small JSON verdict. Returns the raw text, or null if no model is configured /
 * the call fails / it times out. Never throws.
 * @param {string} prompt
 * @param {{ maxTokens?: number, temperature?: number, timeoutMs?: number, callSite?: string }} [opts]
 * @returns {Promise<string|null>}
 */
export async function rawModelCall(prompt, opts = {}) {
  const { raw } = await rawOneShot({
    callSite: opts.callSite || 'rawModelCall',
    prompt,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxTokens: opts.maxTokens ?? 200,
    temperature: opts.temperature ?? 0
  });
  return raw;
}

function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`oneShot timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

const SYSTEM_PROMPT =
  'You are a precise classifier inside a knowledge-graph tool. ' +
  'Follow the requested answer format exactly and output ONLY what is asked — ' +
  'no explanation, no preamble, no punctuation beyond what is requested.';

/**
 * Low-level: send a single prompt, return the raw text (or null on any failure).
 * Never throws.
 */
async function rawOneShot({ callSite, prompt, timeoutMs, maxTokens, temperature }) {
  const cfg = await getModelConfig();
  if (!cfg) return { raw: null, latencyMs: 0 };

  const start = Date.now();
  let raw = null;
  try {
    const call = callLLM({
      apiKey: cfg.apiKey,
      provider: cfg.provider,
      endpoint: cfg.endpoint,
      model: cfg.model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: prompt,
      maxTokens: maxTokens ?? 32,
      temperature: temperature ?? 0
    });
    const result = await withTimeout(call, timeoutMs ?? DEFAULT_TIMEOUT_MS);
    raw = typeof result === 'string' ? result : null;
  } catch (e) {
    console.error(`[oneShot:${callSite}] call failed:`, e?.message || e);
    raw = null;
  }
  return { raw, latencyMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Parsing helpers (exported for testing)
// ---------------------------------------------------------------------------

export function optionLabel(o) {
  if (o == null) return '';
  if (typeof o === 'string') return o;
  if (typeof o === 'object') return o.label || o.name || o.title || JSON.stringify(o);
  return String(o);
}

/**
 * Parse a numbered choice. Returns { index } (0-based), { none: true }, or null.
 * @param {string} raw
 * @param {number} n - number of real options
 * @param {boolean} allowNone - whether option n+1 ("None of these") is valid
 */
export function parseChoice(raw, n, allowNone) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/-?\d+/);
  if (!m) return null;
  const num = parseInt(m[0], 10);
  if (Number.isNaN(num)) return null;
  if (allowNone && num === n + 1) return { none: true };
  if (num >= 1 && num <= n) return { index: num - 1 };
  return null;
}

/** Parse a yes/no answer. Returns true, false, or null. */
export function parseBoolean(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.toLowerCase();
  const m = s.match(/\b(yes|no|true|false)\b/);
  if (m) return m[1] === 'yes' || m[1] === 'true';
  // Bare 1/0 as a last resort.
  const n = s.match(/\b([01])\b/);
  if (n) return n[1] === '1';
  return null;
}

/** Parse a short label. Returns the cleaned string or null if malformed/too long. */
export function parseLabel(raw, maxWords) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().split('\n')[0].trim();          // first line only
  // Repeatedly peel wrapping quotes/markdown and trailing punctuation until stable,
  // so inputs like `"directed by".` fully unwrap.
  let prev;
  do {
    prev = s;
    s = s.replace(/^["'`*_\s]+|["'`*_\s]+$/g, '').trim();
    s = s.replace(/[.!?,;:]+$/g, '').trim();
  } while (s !== prev);
  if (!s) return null;
  if (s.length > 60) return null;                    // long → likely a refusal/sentence
  if (maxWords) {
    const words = s.split(/\s+/);
    if (words.length > maxWords) return null;
  }
  return s;
}

function previewInput(input, labels) {
  const parts = [];
  if (input) parts.push(String(input).slice(0, 500));
  if (Array.isArray(labels) && labels.length) parts.push(`[options: ${labels.join(' | ')}]`);
  return parts.join(' ') || null;
}

// ---------------------------------------------------------------------------
// Public constrained-output helpers
// ---------------------------------------------------------------------------

/**
 * Ask the model to pick one of `options`.
 * @param {Object} p
 * @param {string} p.instruction - short task framing (a sentence or two)
 * @param {string} [p.input] - the thing being classified
 * @param {Array}  p.options - array of strings or objects ({name|label|title})
 * @param {boolean} [p.allowNone] - offer an explicit "None of these" choice
 * @param {string} [p.callSite]
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{ index:number, value:any, none:false, callId:string }
 *                  | { index:null, value:null, none:true, callId:string }
 *                  | null>}
 *   null means "no answer" (no model / timeout / malformed) → caller falls back.
 */
export async function oneShotChoice({ instruction, input, options, allowNone = false, callSite = 'oneShotChoice', timeoutMs, buildId, meta }) {
  const opts = Array.isArray(options) ? options.filter((o) => o != null) : [];
  if (opts.length === 0) return null;

  const labels = opts.map(optionLabel);
  const numbered = labels.map((l, i) => `${i + 1}. ${l}`).join('\n');
  const noneLine = allowNone ? `\n${opts.length + 1}. None of these` : '';
  const prompt =
    `${instruction}\n\n` +
    (input ? `Input:\n${input}\n\n` : '') +
    `Options:\n${numbered}${noneLine}\n\n` +
    `Answer with only the number of the best option.`;

  const { raw, latencyMs } = await rawOneShot({ callSite, prompt, timeoutMs });
  const parsed = parseChoice(raw, opts.length, allowNone);
  const callId = logOneShotCall({
    callSite,
    buildId,
    meta,
    instruction,
    input: previewInput(input, labels),
    rawResponse: raw,
    parsedResult: parsed ? (parsed.none ? 'none' : labels[parsed.index]) : null,
    latencyMs
  });

  if (!parsed) return null;
  if (parsed.none) return { index: null, value: null, none: true, callId };
  return { index: parsed.index, value: opts[parsed.index], none: false, callId };
}

/**
 * Ask the model a yes/no question.
 * @returns {Promise<{ value:boolean, callId:string } | null>}
 */
export async function oneShotBoolean({ instruction, input, callSite = 'oneShotBoolean', timeoutMs, buildId, meta }) {
  const prompt =
    `${instruction}\n\n` +
    (input ? `Input:\n${input}\n\n` : '') +
    `Answer with only "yes" or "no".`;

  const { raw, latencyMs } = await rawOneShot({ callSite, prompt, timeoutMs });
  const parsed = parseBoolean(raw);
  const callId = logOneShotCall({ callSite, buildId, meta, instruction, input, rawResponse: raw, parsedResult: parsed, latencyMs });
  if (parsed === null) return null;
  return { value: parsed, callId };
}

/**
 * Ask the model for a short label / phrase.
 * @returns {Promise<{ value:string, callId:string } | null>}
 */
export async function oneShotLabel({ instruction, input, maxWords = 4, callSite = 'oneShotLabel', timeoutMs, buildId, meta }) {
  const prompt =
    `${instruction}\n\n` +
    (input ? `Input:\n${input}\n\n` : '') +
    `Answer with a short label of at most ${maxWords} words. ` +
    `Output only the label — no quotes, no trailing punctuation.`;

  const { raw, latencyMs } = await rawOneShot({ callSite, prompt, timeoutMs, maxTokens: 24 });
  const parsed = parseLabel(raw, maxWords);
  const callId = logOneShotCall({ callSite, buildId, meta, instruction, input, rawResponse: raw, parsedResult: parsed, latencyMs });
  if (parsed === null) return null;
  return { value: parsed, callId };
}
