/**
 * A scripted stand-in for the model providers, at the network boundary.
 *
 * The wizard's other tests mock AgentLoop or LLMClient wholesale, so nothing
 * exercised the real SSE parsers, the loop and the tools together. This fakes
 * `fetch` instead: each scripted turn becomes a byte stream in the provider's
 * real wire format (split into odd-sized chunks so SSE buffering across
 * boundaries is exercised), and every request body is recorded so a test can
 * check the transcript the loop sent. No request leaves the process.
 */

const enc = new TextEncoder();

function streamOf(text) {
  const body = new ReadableStream({
    start(controller) {
      for (let i = 0; i < text.length; i += 37) controller.enqueue(enc.encode(text.slice(i, i + 37)));
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const pieces = (s, n) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) || [];

/** Anthropic Messages API stream, as documented (text_delta / input_json_delta). */
export function anthropicStream({ text, tools = [], promptTokens = 1000 }) {
  let out = '';
  const ev = (type, data) => { out += `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`; };
  ev('message_start', { message: { id: 'msg_fake', role: 'assistant', content: [], usage: { input_tokens: promptTokens, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  let index = 0;
  if (text) {
    ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
    for (const part of pieces(text, 12)) ev('content_block_delta', { index, delta: { type: 'text_delta', text: part } });
    ev('content_block_stop', { index });
    index++;
  }
  for (const t of tools) {
    ev('content_block_start', { index, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } });
    for (const part of pieces(JSON.stringify(t.args), 15)) ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: part } });
    ev('content_block_stop', { index });
    index++;
  }
  ev('message_delta', { delta: { stop_reason: tools.length ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 50 } });
  ev('message_stop', {});
  return streamOf(out);
}

/** OpenAI-style chat completions stream (OpenRouter, OpenAI, local servers). */
export function openaiStream({ text, tools = [], promptTokens = 1000 }) {
  let out = '';
  const d = (obj) => { out += `data: ${JSON.stringify(obj)}\n\n`; };
  if (text) for (const part of pieces(text, 12)) d({ choices: [{ index: 0, delta: { content: part } }] });
  tools.forEach((t, i) => {
    d({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: t.id, type: 'function', function: { name: t.name, arguments: '' } }] } }] });
    for (const part of pieces(JSON.stringify(t.args), 15)) d({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: part } }] } }] });
  });
  d({ choices: [{ index: 0, delta: {}, finish_reason: tools.length ? 'tool_calls' : 'stop' }] });
  d({ choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: 50, total_tokens: promptTokens + 50 } });
  out += 'data: [DONE]\n\n';
  return streamOf(out);
}

/**
 * Replace global fetch. `script(i, body)` returns the i-th model turn:
 * `{ text?, tools?: [{ id, name, args }], promptTokens? }`, or `{ status, errorBody }`
 * for an HTTP error. Any other URL is refused, so a tool that reaches for the
 * network fails the way it would offline, and the attempt is recorded.
 */
export function installFakeProvider(format, script) {
  const log = { model: [], other: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (/anthropic\.com|openrouter\.ai/.test(u)) {
      const body = JSON.parse(opts.body);
      log.model.push({ url: u, headers: opts.headers, body });
      const turn = typeof script === 'function' ? script(log.model.length - 1, body) : script[Math.min(log.model.length - 1, script.length - 1)];
      if (turn.status) return new Response(turn.errorBody || 'error', { status: turn.status });
      return format === 'anthropic' ? anthropicStream(turn) : openaiStream(turn);
    }
    log.other.push(u);
    throw new TypeError(`fetch refused in test: ${u}`);
  };
  log.restore = () => { globalThis.fetch = original; };
  return log;
}

/**
 * Problems in a request's transcript that a provider would reject with a 400:
 * a tool call without its result, a result without its call, same-role runs,
 * too many cache breakpoints, or loop bookkeeping fields leaking to the API.
 */
export function transcriptProblems(format, body) {
  const problems = [];
  const msgs = body.messages || [];
  if (format === 'anthropic') {
    const blocks = (m) => (Array.isArray(m?.content) ? m.content : []);
    if (msgs[0]?.role !== 'user') problems.push('first message is not from the user');
    msgs.forEach((m, i) => {
      if (i > 0 && msgs[i - 1].role === m.role) problems.push(`two ${m.role} messages in a row at ${i}`);
      if (!Array.isArray(m.content) && !m.content) problems.push(`empty content at ${i}`);
      if (m.role === 'assistant') {
        const answered = blocks(msgs[i + 1]).filter(b => b.type === 'tool_result').map(b => b.tool_use_id);
        for (const b of blocks(m)) if (b.type === 'tool_use' && !answered.includes(b.id)) problems.push(`tool_use ${b.id} unanswered at ${i}`);
      }
      if (m.role === 'user') {
        const asked = blocks(msgs[i - 1]).filter(b => b.type === 'tool_use').map(b => b.id);
        for (const b of blocks(m)) if (b.type === 'tool_result' && !asked.includes(b.tool_use_id)) problems.push(`orphan tool_result ${b.tool_use_id} at ${i}`);
      }
    });
    let breakpoints = 0;
    const count = (x) => { if (x && typeof x === 'object') { if (x.cache_control) breakpoints++; Object.values(x).forEach(count); } };
    count(body.tools); count(body.system); count(body.messages);
    if (breakpoints > 4) problems.push(`${breakpoints} cache breakpoints (Anthropic allows 4)`);
  } else {
    msgs.forEach((m, i) => {
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const answered = [];
        for (let j = i + 1; j < msgs.length && msgs[j].role === 'tool'; j++) answered.push(msgs[j].tool_call_id);
        for (const tc of m.tool_calls) if (!answered.includes(tc.id)) problems.push(`tool_call ${tc.id} unanswered at ${i}`);
      }
      if (m.role === 'tool') {
        let j = i - 1;
        while (j >= 0 && msgs[j].role === 'tool') j--;
        if (!msgs[j]?.tool_calls?.some(tc => tc.id === m.tool_call_id)) problems.push(`orphan tool result ${m.tool_call_id} at ${i}`);
      }
      for (const k of Object.keys(m)) if (k.startsWith('_')) problems.push(`internal field ${k} sent to the provider at ${i}`);
    });
  }
  return problems;
}
