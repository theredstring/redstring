/**
 * The mind backend for Apple's on-device model, over any transport.
 *
 * `send(request) → Promise<answer>` reaches native/afm-bridge: a child process
 * from Node (afmBackend.js), or Electron's main process from the app
 * (electron/druidBridge.cjs). What to ask and how to recover lives here, once.
 */

import { estimateTokens } from '../../wizard/tokenEstimate.js';

const ENGLISH = 'This is written in English.';
/** Tokens kept free in a session, beyond what a turn and its answer need. */
const SESSION_SLACK = 200;

/**
 * Reading the prompt is nearly all of a call's time on Apple's model (about
 * 1 ms a token on an M-series Mac; a two-word answer costs little more than a
 * one-word one). The calls of a moment share their context, so they share a
 * session: the bridge reads the context once, as the session's instructions,
 * and each call is a turn in it. A new context, or a session too full for the
 * next turn, starts a new session. Measured: a 1.3K-token context read fresh
 * took 1,224 ms; asked again in its session, 585 to 672 ms.
 */
const sameText = (a, b) => a === b;

/**
 * @param {Function} send     (request) → Promise<{ ok, content, usage, error }>
 * @param {Object}   health   the bridge's answer to { op: 'health' }
 * @param {Function} [close]
 */
export function afmClient(send, health, close = () => {}) {
  const window = health?.contextSize || 4096;
  // The open session: its context, and roughly how much of the window it has used.
  let session = null;
  let sessions = 0;
  const end = () => {
    if (session) send({ op: 'end', sid: session.sid }).catch(() => {});
    session = null;
  };

  /** A turn in this context's session; null when it needs the whole prompt. */
  async function inSession({ system, context, turn, schema, maxTokens, temperature }) {
    const turnCost = estimateTokens(turn) + maxTokens;
    const fits = (used) => used + turnCost + SESSION_SLACK <= window;
    if (session && sameText(session.system, system) && sameText(session.context, context) && fits(session.used)) {
      const r = await send({ op: 'complete', sid: session.sid, user: turn, schema, maxTokens, temperature });
      if (r.ok) { session.used += turnCost; return r; }
      end();
      return /exceededContextWindowSize|unknown session/i.test(r.error || '') ? null : r;
    }
    end();
    const base = estimateTokens(system) + estimateTokens(context) + 20;
    if (!fits(base)) return null;
    const sid = `m${++sessions}`;
    const r = await send({ op: 'complete', sid, system, context: `${ENGLISH}\n\n${context}`, user: turn, schema, maxTokens, temperature });
    if (r.ok) session = { sid, system, context, used: base + turnCost };
    else if (/exceededContextWindowSize/i.test(r.error || '')) return null;
    return r;
  }

  return {
    id: 'afm:apple-on-device',
    contextSize: health?.contextSize,
    async complete({ system, user, context, turn, schema, maxTokens, temperature }) {
      if (context) {
        const r = await inSession({ system, context, turn, schema, maxTokens, temperature });
        if (r?.ok) return { content: r.content, usage: { prompt: r.usage?.prompt || 0, completion: r.usage?.completion || 0 } };
        if (r && !/unsupportedLanguage/i.test(r.error || '')) throw new Error(`afm: ${r.error}`);
        // Too big for a session, or a language refusal: the whole prompt, as before.
      }
      // The on-device model checks the prompt's language first and refuses
      // what it cannot place. A Druid's view — many capitalized names, the
      // same few repeated — sometimes reads as no language at all:
      // "unsupportedLanguageOrLocale" on 26 of 73 calls in one long run, every
      // time for a given prompt. One plain sentence saying what language it is
      // fixed every captured case; a retry with a second one covers the rest.
      let r = await send({ op: 'complete', system, user: `${ENGLISH}\n\n${user}`, schema, maxTokens, temperature });
      if (!r.ok && /unsupportedLanguage/i.test(r.error || '')) {
        r = await send({ op: 'complete', system: `${system}\n\nAlways read and answer in English.`, user: `${ENGLISH} Plain English words follow.\n\n${user}`, schema, maxTokens, temperature });
      }
      if (!r.ok) throw new Error(`afm: ${r.error}`);
      return { content: r.content, usage: { prompt: r.usage?.prompt || 0, completion: r.usage?.completion || 0 } };
    },
    close: () => { end(); close(); }
  };
}

/** Throws a plain reason when the model cannot be used on this machine. */
export function assertAvailable(health) {
  if (!health?.available) throw new Error(`Apple's on-device model is unavailable: ${health?.reason || 'unknown reason'}`);
}
