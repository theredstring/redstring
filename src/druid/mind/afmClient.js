/**
 * The mind backend for Apple's on-device model, over any transport.
 *
 * `send(request) → Promise<answer>` reaches native/afm-bridge: a child process
 * from Node (afmBackend.js), or Electron's main process from the app
 * (electron/druidBridge.cjs). What to ask and how to recover lives here, once.
 */

const ENGLISH = 'This is written in English.';

/**
 * @param {Function} send     (request) → Promise<{ ok, content, usage, error }>
 * @param {Object}   health   the bridge's answer to { op: 'health' }
 * @param {Function} [close]
 */
export function afmClient(send, health, close = () => {}) {
  return {
    id: 'afm:apple-on-device',
    contextSize: health?.contextSize,
    async complete({ system, user, schema, maxTokens, temperature }) {
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
    close
  };
}

/** Throws a plain reason when the model cannot be used on this machine. */
export function assertAvailable(health) {
  if (!health?.available) throw new Error(`Apple's on-device model is unavailable: ${health?.reason || 'unknown reason'}`);
}
