/**
 * Recording what the wizard asks its model, at the network boundary, so the
 * wizard's calls can become training examples the way the Druid's do
 * (scripts/wizard-bench.mjs --record; training/druid/README.md).
 *
 * Wraps `fetch` for one OpenAI-compatible endpoint: each request's body
 * (messages, tools, settings) is kept, the streamed reply is read from a copy
 * of the stream and put back together as the assistant message it was (text
 * and tool calls), and `onCall` gets both. The wizard reads the other copy as
 * it always does, so recording changes nothing it sees.
 */

/** The assistant message an OpenAI-style SSE stream adds up to. */
export function assembleStream(text) {
  let content = '';
  let reasoning = '';
  const calls = [];
  let finish = null;
  let usage = null;
  for (const line of String(text).split('\n')) {
    const m = line.match(/^data:\s?(.*)$/);
    if (!m || m[1].trim() === '[DONE]') continue;
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    if (j.usage) usage = j.usage;
    const choice = j.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    const d = choice.delta || choice.message || {};
    if (d.content) content += d.content;
    if (d.reasoning_content) reasoning += d.reasoning_content;
    if (d.reasoning) reasoning += d.reasoning;
    for (const t of d.tool_calls || []) {
      const i = t.index ?? calls.length;
      const c = (calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (t.id) c.id = t.id;
      if (t.function?.name) c.function.name += t.function.name;
      if (t.function?.arguments) c.function.arguments += t.function.arguments;
    }
  }
  const message = { role: 'assistant', content: content || null };
  const toolCalls = calls.filter(Boolean);
  if (toolCalls.length) message.tool_calls = toolCalls;
  return { message, reasoning, finish, usage };
}

/**
 * Record every call to `endpoint` while installed.
 * @param {{ endpoint: string, onCall: (call) => void, fetchImpl?: Function }} opts
 * @returns {{ restore: () => void }}
 */
export function recordCalls({ endpoint, onCall, fetchImpl = globalThis.fetch }) {
  const original = fetchImpl;
  const wrapped = async (url, init = {}) => {
    const res = await original(url, init);
    if (String(url) !== endpoint || !res.body) return res;
    let body = null;
    try { body = JSON.parse(init.body); } catch { /* not ours to read */ }
    const started = Date.now();
    const [mine, theirs] = res.body.tee();
    (async () => {
      const text = await new Response(mine).text();
      const reply = res.headers.get('content-type')?.includes('json')
        ? (() => { try { const j = JSON.parse(text); return { message: j.choices?.[0]?.message, usage: j.usage, finish: j.choices?.[0]?.finish_reason }; } catch { return { message: null }; } })()
        : assembleStream(text);
      onCall({ request: body, ...reply, status: res.status, ms: Date.now() - started });
    })().catch(() => {});
    return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
  globalThis.fetch = wrapped;
  return { restore: () => { globalThis.fetch = original; } };
}
