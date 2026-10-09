/**
 * A universe file written and read in pieces must be exactly the file it
 * always was: the same bytes as JSON.stringify, the same object as JSON.parse.
 * Anything else here risks every universe on every save, so the comparison is
 * byte for byte, over real universes and over random values built to hit
 * JSON.stringify's corners.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  serializeJsonToBytes, serializeRedstring, writesCompact, redstringSize, COMPACT_AT,
  parseRedstringBytes, isBlankBytes, bytesToTextIfSmall,
} from '../../src/formats/universeBytes.js';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';
import { importOntologyText } from '../../src/formats/ontology/importOntology.js';

const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Small seeded generator, so a failure always reproduces. */
const rng = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const STRINGS = ['', 'plain', 'with "quotes" and \\ backslash', 'line\nbreak\ttab\r', 'emoji 🧬 and ü é ñ',
  'α-D-glucose', '  ', '\u0000\u001f', 'lone \ud83d surrogate', '中文', 'a'.repeat(50)];

const randomValue = (r, depth = 0) => {
  const pick = Math.floor(r() * (depth > 5 ? 9 : 14));
  switch (pick) {
    case 0: return null;
    case 1: return r() < 0.5;
    case 2: return Math.floor(r() * 2000) - 1000;
    case 3: return [NaN, Infinity, -Infinity, -0, 1e21, 1.5e-7, 0.1 + 0.2][Math.floor(r() * 7)];
    case 4: case 5: return STRINGS[Math.floor(r() * STRINGS.length)];
    case 6: return undefined;
    case 7: return [() => 1, Symbol('s')][Math.floor(r() * 2)];
    case 8: return new Date(Math.floor(r() * 2e12));
    case 9: case 10: {
      const n = Math.floor(r() * 6);
      return Array.from({ length: n }, () => randomValue(r, depth + 1));
    }
    case 11: return r() < 0.5 ? new Map([['a', 1]]) : new Set([1]);
    case 12: { const gone = r() < 0.5; return { toJSON: () => (gone ? undefined : { replaced: true }) }; }
    default: {
      const obj = r() < 0.2 ? Object.create(null) : {};
      const n = Math.floor(r() * 7);
      for (let i = 0; i < n; i++) {
        const key = r() < 0.2 ? String(Math.floor(r() * 20)) : STRINGS[Math.floor(r() * STRINGS.length)] + i;
        obj[key] = randomValue(r, depth + 1);
      }
      return obj;
    }
  }
};

let zooExport;
beforeAll(async () => {
  const zoo = fs.readFileSync(path.resolve(__dirname, '../fixtures/ontology/zoo.ttl'), 'utf8');
  const built = await importOntologyText(zoo, 'zoo.ttl');
  zooExport = JSON.parse(JSON.stringify(exportToRedstring(built.state)));
});

describe('writing in pieces', () => {
  it('writes a real universe byte for byte as JSON.stringify does, pretty and compact', () => {
    for (const indent of [0, 2]) {
      const expected = encode(JSON.stringify(zooExport, null, indent || undefined));
      for (const pieceChars of [1, 64, 1 << 20]) {
        for (const walkDepth of [0, 1, 2, 4, 8]) {
          expect(sameBytes(serializeJsonToBytes(zooExport, { indent, pieceChars, walkDepth }), expected), `indent ${indent} piece ${pieceChars} depth ${walkDepth}`).toBe(true);
        }
      }
    }
  });

  it('matches JSON.stringify on random values built to hit its corners', () => {
    const r = rng(20261009);
    for (let i = 0; i < 1500; i++) {
      const value = { root: randomValue(r), list: [randomValue(r), undefined, randomValue(r)] };
      for (const indent of [0, 2]) {
        const expected = encode(JSON.stringify(value, null, indent || undefined));
        const got = serializeJsonToBytes(value, { indent, pieceChars: 1 + (i % 9), walkDepth: i % 6 });
        if (!sameBytes(got, expected)) {
          throw new Error(`case ${i}, indent ${indent}:\nexpected ${decode(expected)}\nreceived ${decode(got)}`);
        }
      }
    }
  });

  it('never splits a character across pieces', () => {
    const value = { names: Array.from({ length: 200 }, (_, i) => `🧬${i}α中`) };
    const bytes = serializeJsonToBytes(value, { pieceChars: 3 });
    expect(decode(bytes)).toBe(JSON.stringify(value));
  });

  it('writes a large universe compact and a small one pretty', () => {
    expect(writesCompact(zooExport)).toBe(false);
    expect(decode(serializeRedstring(zooExport))).toBe(JSON.stringify(zooExport, null, 2));
    const prototypes = Object.fromEntries(Array.from({ length: COMPACT_AT }, (_, i) => [`p${i}`, { name: `P${i}` }]));
    const large = { ...zooExport, prototypeSpace: { ...zooExport.prototypeSpace, prototypes } };
    expect(redstringSize(large)).toBeGreaterThanOrEqual(COMPACT_AT);
    expect(writesCompact(large)).toBe(true);
    expect(decode(serializeRedstring(large))).toBe(JSON.stringify(large));
    // Either way can be asked for.
    expect(decode(serializeRedstring(zooExport, { compact: true }))).toBe(JSON.stringify(zooExport));
  });
});

describe('reading in pieces', () => {
  const both = async (bytes) => [
    await parseRedstringBytes(bytes),
    await parseRedstringBytes(bytes, { streamAt: 0, sliceBytes: bytes.length > 2000 ? 257 : 3 }),
  ];

  it('reads a real universe to the same object either way, pretty or compact', async () => {
    for (const indent of [0, 2]) {
      const bytes = encode(JSON.stringify(zooExport, null, indent || undefined));
      const [small, streamed] = await both(bytes);
      expect(small).toEqual(zooExport);
      expect(streamed).toEqual(zooExport);
    }
  });

  it('agrees with JSON.parse on random values, slices cutting through characters', async () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const text = JSON.stringify({ v: randomValue(r) });
      const streamed = await parseRedstringBytes(encode(text), { streamAt: 0, sliceBytes: 1 + (i % 5) });
      expect(streamed).toEqual(JSON.parse(text));
    }
  });

  it('keeps a "__proto__" key as data, as JSON.parse does', async () => {
    const text = '{"a":{"__proto__":{"polluted":true},"b":1}}';
    const [small, streamed] = await both(encode(text));
    for (const parsed of [small, streamed]) {
      expect(Object.getPrototypeOf(parsed.a)).toBe(Object.prototype);
      expect(parsed.a.polluted).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(parsed.a, '__proto__')).toBe(true);
    }
    expect({}.polluted).toBeUndefined();
  });

  it('takes the last of two same keys, as JSON.parse does', async () => {
    const [small, streamed] = await both(encode('{"k":1,"k":2}'));
    expect(small).toEqual({ k: 2 });
    expect(streamed).toEqual({ k: 2 });
  });

  it('reads past a byte-order mark', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode('{"a":1}')]);
    const [small, streamed] = await both(bytes);
    expect(small).toEqual({ a: 1 });
    expect(streamed).toEqual({ a: 1 });
  });

  it('gives null for an empty or blank file', async () => {
    for (const text of ['', '   \n\t ']) {
      expect(isBlankBytes(encode(text))).toBe(true);
      const [small, streamed] = await both(encode(text));
      expect(small).toBeNull();
      expect(streamed).toBeNull();
    }
  });

  it('refuses what JSON.parse refuses: cut short, broken, or with more after the end', async () => {
    for (const text of ['{"a":1', '{"a":}', '{"a":1} x', '{"a":1}{"b":2}', 'nonsense', '{"a":"unterminated}']) {
      await expect(parseRedstringBytes(encode(text)), text).rejects.toBeInstanceOf(SyntaxError);
      await expect(parseRedstringBytes(encode(text), { streamAt: 0, sliceBytes: 2 }), text).rejects.toBeInstanceOf(SyntaxError);
    }
  });

  it('reports progress through a big file', async () => {
    const seen = [];
    const bytes = encode(JSON.stringify(zooExport));
    await parseRedstringBytes(bytes, { streamAt: 0, sliceBytes: 4096, onProgress: (done, total) => seen.push([done, total]) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toEqual([bytes.length, bytes.length]);
  });

  it('accepts an ArrayBuffer and gives text only for a small file', async () => {
    const bytes = encode('{"a":1}');
    expect(await parseRedstringBytes(bytes.buffer)).toEqual({ a: 1 });
    expect(bytesToTextIfSmall(bytes)).toBe('{"a":1}');
    expect(bytesToTextIfSmall(bytes, 3)).toBeNull();
  });
});
