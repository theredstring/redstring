// electron/leveldbReader.cjs reads the old file:// origin's localStorage from
// disk (C-5 migration). The fixtures are real Chromium (Electron 44) LevelDB
// databases: one still in its write-ahead log, one flushed to a
// Snappy-compressed table with deletions and overwrites.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  crc32c,
  snappyDecompress,
  readLogRecords,
  readChromiumLocalStorage
} from '../../../electron/leveldbReader.cjs';

const FIX = path.join(__dirname, 'fixtures');

describe('readChromiumLocalStorage — real Chromium databases', () => {
  it('reads the file:// origin from a write-ahead log', () => {
    const entries = Object.fromEntries(readChromiumLocalStorage(path.join(FIX, 'chromium-localstorage-log')));
    expect(Object.keys(entries).sort()).toEqual([
      'github_access_token',
      'redstring_ai_api_key',
      'redstring_ai_api_profiles',
      'redstring_onboarding_complete',
      'redstring_universes_list'
    ]);
    expect(entries.redstring_onboarding_complete).toBe('true');
    expect(entries.github_access_token.startsWith('rsenc:v1:')).toBe(true);
    expect(JSON.parse(entries.redstring_ai_api_profiles).prof_1.provider).toBe('openrouter');
  });

  it('reads a Snappy-compressed table: newest value wins, deletions applied, UTF-16 decoded', () => {
    const entries = Object.fromEntries(readChromiumLocalStorage(path.join(FIX, 'chromium-localstorage-table')));
    const big = (i) => ('value-' + i + '-').repeat(120);
    for (let i = 0; i < 60; i++) {
      if (i % 3 === 0) expect(entries['k' + i], 'deleted k' + i).toBeUndefined();
      else expect(entries['k' + i], 'k' + i).toBe(big(i + 21));
    }
    expect(entries.unicode).toBe('héllo — 世界 🌍');
    expect(entries.latin).toBe('café');
    expect(entries['ключ']).toBe('значение');
    expect(entries.empty).toBe('');
    expect(Object.keys(entries)).toHaveLength(44);
  });

  it('returns nothing for another origin or a missing database', () => {
    expect(readChromiumLocalStorage(path.join(FIX, 'chromium-localstorage-log'), 'app://redstring')).toEqual([]);
    expect(readChromiumLocalStorage(path.join(os.tmpdir(), 'no-such-leveldb-' + Date.now()))).toEqual([]);
  });

  it('drops a torn record at the end of the log (crash mid-write) and keeps the rest', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-ldb-'));
    try {
      for (const f of fs.readdirSync(path.join(FIX, 'chromium-localstorage-log'))) {
        fs.copyFileSync(path.join(FIX, 'chromium-localstorage-log', f), path.join(tmp, f));
      }
      const full = new Map(readChromiumLocalStorage(tmp));
      const log = fs.readFileSync(path.join(tmp, '000003.log'));
      // A record header promising more bytes than were written.
      const torn = Buffer.concat([log, Buffer.from([1, 2, 3, 4, 0xff, 0x00, 1, 9, 9])]);
      fs.writeFileSync(path.join(tmp, '000003.log'), torn);
      expect(new Map(readChromiumLocalStorage(tmp))).toEqual(full);
      // Cut mid-record: whatever survives is a consistent subset, never garbage.
      fs.writeFileSync(path.join(tmp, '000003.log'), log.subarray(0, Math.floor(log.length / 2)));
      const partial = readChromiumLocalStorage(tmp);
      expect(partial.length).toBeLessThan(full.size);
      for (const [k, v] of partial) expect(full.get(k)).toBe(v);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('LevelDB primitives', () => {
  it('crc32c matches the standard check value', () => {
    expect(crc32c(Buffer.from('123456789'))).toBe(0xe3069283);
  });

  it('snappy: literals and overlapping copies', () => {
    // "abcabcabcabcX": literal "abc", copy(offset 3, len 9), literal "X"
    const compressed = Buffer.from([13, (3 - 1) << 2, 0x61, 0x62, 0x63, ((9 - 1) << 2) | 2, 3, 0, 0x00, 0x58]);
    expect(snappyDecompress(compressed).toString()).toBe('abcabcabcabcX');
  });

  it('snappy: rejects a copy that points before the start', () => {
    expect(() => snappyDecompress(Buffer.from([4, ((4 - 1) << 2) | 2, 9, 0]))).toThrow();
  });

  it('log reader ignores a record with a bad checksum', () => {
    const log = fs.readFileSync(path.join(FIX, 'chromium-localstorage-log', '000003.log'));
    const good = readLogRecords(log);
    const bad = Buffer.from(log);
    bad[0] ^= 0xff; // corrupt the first record's checksum
    expect(good.length).toBeGreaterThan(0);
    expect(readLogRecords(bad)).toHaveLength(0);
  });
});
