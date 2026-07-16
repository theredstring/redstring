/**
 * parseTextToolCalls — salvage tool calls that a model wrote as prose.
 *
 * Small local models (e.g. Qwe3 4B) sometimes fall out of the native tool-call
 * format and instead write the call as text, e.g.
 *
 *   createGraph({"name": "GTA San Andreas Locations", "color": "sunset"})
 *
 * When that happens nothing executes and the pseudo-call lands in the chat. This
 * scanner recovers those calls so the AgentLoop can feed them through the normal
 * dispatch path.
 *
 * ⚠️ This file is imported (transitively) by redstring-mcp-server.js — use
 * console.error only, never console.log (console.log corrupts the MCP stdio transport).
 */

/**
 * Walk a JSON object literal starting at `text[start] === '{'` and return the
 * index of its matching closing brace, respecting string contents (so braces
 * inside strings don't affect nesting). Returns -1 if unterminated.
 */
function findObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let quote = '';
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') { i++; continue; } // skip the escaped character
      if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") { inString = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * JSON.parse a candidate object; on failure try ONE repair round
 * (single→double quotes, strip trailing commas) before giving up.
 * Returns the parsed value, or undefined if it can't be parsed.
 */
function forgivingParse(raw) {
  try {
    return JSON.parse(raw);
  } catch { /* fall through to repair */ }

  try {
    const repaired = raw
      .replace(/'/g, '"')             // single-quoted → double-quoted
      .replace(/,\s*([}\]])/g, '$1'); // strip trailing commas before } or ]
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}

/**
 * Find text-register tool calls in `text`.
 *
 * @param {string} text - Raw model response text.
 * @param {Iterable<string>|Set<string>} availableToolNames - The tools offered on
 *   the CURRENT turn. An extracted name must match one exactly or it is ignored —
 *   prose that merely mentions a tool name can never trigger anything not offered.
 * @returns {{ calls: Array<{name: string, arguments: object}>, remainingText: string }}
 *   `calls` in written order; `remainingText` is the prose with the matched call
 *   spans removed (so it isn't also rendered as a chat message).
 */
export function parseTextToolCalls(text, availableToolNames = []) {
  if (!text || typeof text !== 'string') {
    return { calls: [], remainingText: text || '' };
  }
  const whitelist = availableToolNames instanceof Set
    ? availableToolNames
    : new Set(availableToolNames);

  const calls = [];
  const spans = []; // [start, end) ranges to strip from the prose

  // Match "identifier(" (allowing whitespace before the paren).
  const idRe = /([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = idRe.exec(text)) !== null) {
    const name = m[1];
    // Only consider names offered this turn.
    if (!whitelist.has(name)) continue;

    // The argument must be a JSON object literal — find the first non-space char
    // after '(' and require it to be '{'.
    let i = m.index + m[0].length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '{') continue;

    const objStart = i;
    const objEnd = findObjectEnd(text, objStart);
    if (objEnd < 0) continue; // unterminated object

    // After the object, allow whitespace then require the closing ')'.
    let j = objEnd + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== ')') continue;
    const callEnd = j + 1;

    const parsed = forgivingParse(text.slice(objStart, objEnd + 1));
    if (parsed === undefined) continue; // malformed & unrepairable → discard

    calls.push({ name, arguments: parsed });
    spans.push([m.index, callEnd]);

    // Resume scanning after this call (handles multiple calls in one response).
    idRe.lastIndex = callEnd;
  }

  let remainingText = text;
  if (spans.length > 0) {
    let out = '';
    let cursor = 0;
    for (const [s, e] of spans) {
      out += text.slice(cursor, s);
      cursor = e;
    }
    out += text.slice(cursor);
    // Collapse the blank lines the removed spans left behind.
    remainingText = out.replace(/\n{3,}/g, '\n\n').trim();
  }

  return { calls, remainingText };
}
