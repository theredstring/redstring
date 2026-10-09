/**
 * A universe file as bytes, written and read in pieces.
 *
 * A .redstring file used to be one JavaScript string on its way to and from
 * disk. A string can't be longer than about 536 million characters, and well
 * before that the window that has to hold one can run out of room: a 512 MB
 * universe (all of Mondo) saved, then crashed the app every time it tried to
 * open it. So:
 *
 *  - serializeRedstring() builds the file a piece at a time, straight into
 *    UTF-8 bytes. No string ever holds more than one Thing or one web. The
 *    bytes are exactly what TextEncoder(JSON.stringify(data, null, indent))
 *    would give, without building that string.
 *
 *  - A large universe is written compact (no indentation), which is about a
 *    third smaller. A small one stays pretty-printed, byte for byte as before,
 *    so it reads and diffs as it always has.
 *
 *  - parseRedstringBytes() reads a small file the way it always was read
 *    (JSON.parse), and a big one with a streaming parser, a slice at a time,
 *    letting the window breathe between slices. Both give the same object.
 */

import { JSONParser } from '@streamparser/json';

/** Things plus webs at which a universe is written compact. */
export const COMPACT_AT = 5000;

/** Files at least this big are parsed a slice at a time. */
export const STREAM_PARSE_AT = 64 * 1024 * 1024;

/** How much text is gathered before it's encoded to bytes. */
const PIECE_CHARS = 1 << 20;

/** Slice of bytes handed to the streaming parser between yields. */
const PARSE_SLICE_BYTES = 4 * 1024 * 1024;

const countKeys = (obj) => (obj && typeof obj === 'object' ? Object.keys(obj).length : 0);

/** Things plus webs in an exported (.redstring-shaped) universe. */
export function redstringSize(data) {
  return countKeys(data?.prototypeSpace?.prototypes) + countKeys(data?.spatialGraphs?.graphs);
}

/** Whether a universe of this size is written compact. */
export function writesCompact(data) {
  return redstringSize(data) >= COMPACT_AT;
}

/**
 * A finished piece of JSON, as compact UTF-8 bytes, written into a file as it
 * is: a Thing or web the save worker built on an earlier save and hasn't
 * changed since (exportCache.js). Only a compact file can hold one.
 */
export class RawJson {
  constructor(bytes) {
    this.bytes = bytes;
  }

  toJSON() {
    throw new Error('RawJson holds finished bytes: write it with serializeJsonToBytes');
  }
}

const isPlainContainer = (value) => {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const omitted = (value) => value === undefined || typeof value === 'function' || typeof value === 'symbol';

/**
 * JSON for `value`, as UTF-8 bytes, byte-identical to
 * new TextEncoder().encode(JSON.stringify(value, null, indent)).
 *
 * The top few levels are walked here, following JSON.stringify's own rules
 * (toJSON, omitted keys, null for omitted array items, key order); everything
 * below them is one JSON.stringify call per value, so no piece of text is
 * bigger than one Thing, one web, or one entry of the like.
 *
 * @param {*} value
 * @param {Object} [options]
 * @param {number} [options.indent=0] - spaces per level; 0 = compact
 * @param {number} [options.walkDepth=4] - how many levels to walk before stringifying whole
 * @param {number} [options.pieceChars] - text gathered per encoded chunk
 * @returns {Uint8Array}
 */
export function serializeJsonToBytes(value, { indent = 0, walkDepth = 4, pieceChars = PIECE_CHARS } = {}) {
  const encoder = new TextEncoder();
  const chunks = [];
  let parts = [];
  let partsLength = 0;
  let total = 0;

  // A chunk that is a piece's own bytes: never handed out as the result, since
  // the caller may transfer it to another thread, which would empty the cache.
  const borrowed = new Set();
  const flush = () => {
    if (partsLength === 0) return;
    const bytes = encoder.encode(parts.join(''));
    chunks.push(bytes);
    total += bytes.length;
    parts = [];
    partsLength = 0;
  };
  const push = (text) => {
    parts.push(text);
    partsLength += text.length;
    if (partsLength >= pieceChars) flush();
  };

  const space = indent > 0 ? ' '.repeat(indent) : '';
  const pad = (depth) => (indent > 0 ? '\n' + space.repeat(depth) : '');
  // A whole value nested `depth` levels down: its own line breaks move in by the depth.
  const leaf = (v, depth) => {
    const text = JSON.stringify(v, null, indent || undefined);
    return indent > 0 && depth > 0 ? text.replace(/\n/g, '\n' + space.repeat(depth)) : text;
  };
  const colon = indent > 0 ? ': ' : ':';

  // JSON.stringify asks a value for toJSON once, with its key, before anything else.
  const resolve = (v, key) => (v !== null && typeof v === 'object' && !(v instanceof RawJson) && typeof v.toJSON === 'function' ? v.toJSON(key) : v);

  // `v` is already resolved.
  const write = (v, depth) => {
    if (v instanceof RawJson) {
      if (indent > 0) throw new Error('A finished piece (RawJson) can only go into a compact file');
      flush();
      chunks.push(v.bytes);
      borrowed.add(v.bytes);
      total += v.bytes.length;
      return;
    }
    if (depth >= walkDepth || !isPlainContainer(v)) {
      push(leaf(v, depth));
      return;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) { push('[]'); return; }
      push('[');
      for (let i = 0; i < v.length; i++) {
        if (i > 0) push(',');
        push(pad(depth + 1));
        const item = resolve(v[i], String(i));
        if (omitted(item)) push('null');
        else write(item, depth + 1);
      }
      push(pad(depth) + ']');
      return;
    }
    let first = true;
    for (const k of Object.keys(v)) {
      const item = resolve(v[k], k);
      if (omitted(item)) continue;
      push(first ? '{' : ',');
      first = false;
      push(pad(depth + 1) + JSON.stringify(k) + colon);
      write(item, depth + 1);
    }
    push(first ? '{}' : pad(depth) + '}');
  };

  write(resolve(value, ''), 0);
  flush();

  if (chunks.length === 1 && !borrowed.has(chunks[0])) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * A universe file's bytes: pretty-printed when small, compact when large
 * (writesCompact), built a piece at a time.
 *
 * @param {Object} redstringData - from exportToRedstring()
 * @param {Object} [options]
 * @param {boolean} [options.compact] - force one way or the other
 * @returns {Uint8Array}
 */
export function serializeRedstring(redstringData, { compact = writesCompact(redstringData) } = {}) {
  return serializeJsonToBytes(redstringData, { indent: compact ? 0 : 2 });
}

const isWhitespaceByte = (b) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

/** True when the bytes hold nothing but whitespace (or a byte-order mark). */
export function isBlankBytes(input) {
  const bytes = asBytes(input);
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  for (; i < bytes.length; i++) if (!isWhitespaceByte(bytes[i])) return false;
  return true;
}

// By tag rather than instanceof: bytes can come from another realm (a worker,
// IPC, a test environment) whose Uint8Array and ArrayBuffer aren't this one's.
const tagOf = (value) => Object.prototype.toString.call(value);
const asBytes = (input) => {
  if (tagOf(input) === '[object Uint8Array]') return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (tagOf(input) === '[object ArrayBuffer]' || tagOf(input) === '[object SharedArrayBuffer]') return new Uint8Array(input);
  throw new TypeError('Expected the file as bytes (Uint8Array or ArrayBuffer)');
};

/**
 * Parse a universe file from its bytes. A file under STREAM_PARSE_AT is
 * decoded and given to JSON.parse, as files always were; a bigger one goes
 * through the streaming parser a slice at a time, never as one string.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - (bytesRead, totalBytes) between slices of a big file
 * @param {number} [options.streamAt] - size from which to stream (tests)
 * @param {number} [options.sliceBytes] - bytes per slice (tests)
 * @returns {Promise<*>} the parsed value, or null when the file is empty or blank
 * @throws {SyntaxError} when the file isn't valid JSON
 */
export async function parseRedstringBytes(input, { onProgress = null, streamAt = STREAM_PARSE_AT, sliceBytes = PARSE_SLICE_BYTES } = {}) {
  const bytes = asBytes(input);
  if (isBlankBytes(bytes)) return null;

  if (bytes.length < streamAt) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  let result;
  let done = false;
  const parser = new JSONParser({ paths: ['$'], keepStack: false });
  parser.onValue = ({ value, stack }) => {
    if (stack.length === 0) { result = value; done = true; }
  };
  try {
    for (let offset = 0; offset < bytes.length; offset += sliceBytes) {
      parser.write(bytes.subarray(offset, Math.min(offset + sliceBytes, bytes.length)));
      onProgress?.(Math.min(offset + sliceBytes, bytes.length), bytes.length);
      // Let the window paint and take input between slices.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!parser.isEnded) parser.end();
  } catch (error) {
    throw new SyntaxError(`Not valid JSON: ${error.message}`);
  }
  if (!done) throw new SyntaxError('Not valid JSON: the file ended before its contents did');
  return result;
}

/**
 * Text for a parsed universe's small file, or null for a big one: for the few
 * callers that hand text on (a pre-migration backup of the original file).
 * Only decodes what's safe to hold as one string.
 */
export function bytesToTextIfSmall(input, limit = STREAM_PARSE_AT) {
  const bytes = asBytes(input);
  return bytes.length < limit ? new TextDecoder().decode(bytes) : null;
}
