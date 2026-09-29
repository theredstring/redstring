// Read-only LevelDB reader — just enough to read Chromium's localStorage
// database from disk (electron/legacyMigration.cjs).
//
// Why this exists: with the grantFileProtocolExtraPrivileges fuse off, a
// file:// page is an opaque origin and Chromium refuses it localStorage, so
// the old origin's localStorage can't be read from a page any more. It is
// still on disk, in `<profile>/Local Storage/leveldb`, and LevelDB's formats
// are small and stable: write-ahead log files, sorted table files (optionally
// Snappy-compressed blocks) and a MANIFEST naming the live files.
//
// Never writes, never takes the DB lock. Call it before Chromium opens the
// database (main does, before any window exists). Corruption throws; a torn
// record at the tail of a log (a crash mid-write) is dropped, as LevelDB's own
// recovery does.

const fs = require('node:fs');
const path = require('node:path');

// ── CRC32C (Castagnoli), LevelDB's record checksum ──────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0x82f63b78 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32c(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function unmaskCrc(masked) {
  const rot = (masked - 0xa282ead8) >>> 0;
  return ((rot >>> 17) | (rot << 15)) >>> 0;
}

// ── varints ─────────────────────────────────────────────────────
function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new Error('leveldb: truncated varint');
    const b = buf[pos++];
    result += (b & 0x7f) * Math.pow(2, shift);
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7;
  }
  throw new Error('leveldb: varint too long');
}

function readSlice(buf, pos) {
  const [len, p] = readVarint(buf, pos);
  if (p + len > buf.length) throw new Error('leveldb: truncated slice');
  return [buf.subarray(p, p + len), p + len];
}

// ── Snappy (raw block format) ───────────────────────────────────
function snappyDecompress(src) {
  let [length, pos] = readVarint(src, 0);
  const out = Buffer.alloc(length);
  let op = 0;
  while (pos < src.length) {
    const tag = src[pos++];
    const kind = tag & 3;
    if (kind === 0) {
      let len = tag >>> 2;
      if (len >= 60) {
        const bytes = len - 59;
        len = 0;
        for (let i = 0; i < bytes; i++) len |= src[pos++] << (8 * i);
        len >>>= 0;
      }
      len += 1;
      if (pos + len > src.length || op + len > out.length) throw new Error('snappy: literal overruns');
      src.copy(out, op, pos, pos + len);
      pos += len;
      op += len;
      continue;
    }
    let len;
    let offset;
    if (kind === 1) {
      len = 4 + ((tag >>> 2) & 7);
      offset = ((tag >>> 5) << 8) | src[pos++];
    } else if (kind === 2) {
      len = (tag >>> 2) + 1;
      offset = src[pos] | (src[pos + 1] << 8);
      pos += 2;
    } else {
      len = (tag >>> 2) + 1;
      offset = (src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16) | (src[pos + 3] << 24)) >>> 0;
      pos += 4;
    }
    if (offset === 0 || offset > op || op + len > out.length) throw new Error('snappy: bad copy');
    for (let i = 0; i < len; i++) out[op + i] = out[op - offset + i];
    op += len;
  }
  if (op !== length) throw new Error('snappy: length mismatch');
  return out;
}

// ── Log files (write-ahead log + MANIFEST share this format) ────
const BLOCK_SIZE = 32768;
const FULL = 1;
const FIRST = 2;
const MIDDLE = 3;
const LAST = 4;

// Yields each logical record. Stops quietly at a torn or corrupt tail.
function readLogRecords(buf) {
  const records = [];
  let pos = 0;
  let pending = null;
  while (pos < buf.length) {
    const blockLeft = BLOCK_SIZE - (pos % BLOCK_SIZE);
    if (blockLeft < 7) { pos += blockLeft; continue; }
    if (pos + 7 > buf.length) break;
    const masked = buf.readUInt32LE(pos);
    const len = buf.readUInt16LE(pos + 4);
    const type = buf[pos + 6];
    if (type === 0 && len === 0) { pos += blockLeft; continue; } // preallocated zeros
    const start = pos + 7;
    const end = start + len;
    if (end > buf.length || len > blockLeft - 7) break; // torn tail
    if (unmaskCrc(masked) !== crc32c(buf, pos + 6, end)) break; // corrupt: stop like LevelDB recovery
    const data = buf.subarray(start, end);
    pos = end;
    if (type === FULL) {
      pending = null;
      records.push(Buffer.from(data));
    } else if (type === FIRST) {
      pending = [Buffer.from(data)];
    } else if (type === MIDDLE) {
      if (pending) pending.push(Buffer.from(data));
    } else if (type === LAST) {
      if (pending) {
        pending.push(Buffer.from(data));
        records.push(Buffer.concat(pending));
      }
      pending = null;
    } else {
      break;
    }
  }
  return records;
}

// A WriteBatch → [{ key, value|null, seq }]
function parseWriteBatch(rec) {
  if (rec.length < 12) return [];
  const seqLo = rec.readUInt32LE(0);
  const seqHi = rec.readUInt32LE(4);
  let seq = seqHi * 0x100000000 + seqLo;
  const count = rec.readUInt32LE(8);
  const out = [];
  let pos = 12;
  for (let i = 0; i < count && pos < rec.length; i++) {
    const type = rec[pos++];
    let key;
    [key, pos] = readSlice(rec, pos);
    if (type === 1) {
      let value;
      [value, pos] = readSlice(rec, pos);
      out.push({ key: Buffer.from(key), value: Buffer.from(value), seq: seq++ });
    } else if (type === 0) {
      out.push({ key: Buffer.from(key), value: null, seq: seq++ });
    } else {
      throw new Error('leveldb: unknown batch record type ' + type);
    }
  }
  return out;
}

// ── Table files (.ldb / .sst) ───────────────────────────────────
const TABLE_MAGIC_LO = 0x8b80fb57;
const TABLE_MAGIC_HI = 0xdb477524;

function readBlock(file, offset, size) {
  if (offset + size + 5 > file.length) throw new Error('leveldb: block out of range');
  const raw = file.subarray(offset, offset + size);
  const type = file[offset + size];
  const masked = file.readUInt32LE(offset + size + 1);
  if (unmaskCrc(masked) !== crc32c(file, offset, offset + size + 1)) throw new Error('leveldb: block checksum mismatch');
  if (type === 0) return raw;
  if (type === 1) return snappyDecompress(raw);
  throw new Error('leveldb: unsupported block compression ' + type);
}

function blockEntries(block) {
  if (block.length < 4) return [];
  const numRestarts = block.readUInt32LE(block.length - 4);
  const limit = block.length - 4 * (numRestarts + 1);
  if (limit < 0) throw new Error('leveldb: bad block restarts');
  const entries = [];
  let pos = 0;
  let lastKey = Buffer.alloc(0);
  while (pos < limit) {
    let shared;
    let nonShared;
    let valueLen;
    [shared, pos] = readVarint(block, pos);
    [nonShared, pos] = readVarint(block, pos);
    [valueLen, pos] = readVarint(block, pos);
    if (shared > lastKey.length || pos + nonShared + valueLen > limit) throw new Error('leveldb: bad block entry');
    const key = Buffer.concat([lastKey.subarray(0, shared), block.subarray(pos, pos + nonShared)]);
    pos += nonShared;
    const value = block.subarray(pos, pos + valueLen);
    pos += valueLen;
    entries.push([key, value]);
    lastKey = key;
  }
  return entries;
}

function readBlockHandle(buf, pos) {
  let offset;
  let size;
  [offset, pos] = readVarint(buf, pos);
  [size, pos] = readVarint(buf, pos);
  return [{ offset, size }, pos];
}

function readTable(file) {
  if (file.length < 48) throw new Error('leveldb: table too small');
  const footer = file.subarray(file.length - 48);
  if (footer.readUInt32LE(40) !== TABLE_MAGIC_LO || footer.readUInt32LE(44) !== TABLE_MAGIC_HI) {
    throw new Error('leveldb: bad table magic');
  }
  let pos = 0;
  let index;
  [, pos] = readBlockHandle(footer, pos); // metaindex (filters) — not needed
  [index] = readBlockHandle(footer, pos);
  const out = [];
  for (const [, handleBytes] of blockEntries(readBlock(file, index.offset, index.size))) {
    const [handle] = readBlockHandle(handleBytes, 0);
    for (const [ikey, value] of blockEntries(readBlock(file, handle.offset, handle.size))) {
      if (ikey.length < 8) throw new Error('leveldb: bad internal key');
      const trailerLo = ikey.readUInt32LE(ikey.length - 8);
      const trailerHi = ikey.readUInt32LE(ikey.length - 4);
      const type = trailerLo & 0xff;
      const seq = trailerHi * 0x1000000 + (trailerLo >>> 8);
      out.push({
        key: Buffer.from(ikey.subarray(0, ikey.length - 8)),
        value: type === 1 ? Buffer.from(value) : null,
        seq
      });
    }
  }
  return out;
}

// ── MANIFEST → live files ───────────────────────────────────────
function readManifest(dir) {
  const current = fs.readFileSync(path.join(dir, 'CURRENT'), 'utf-8').trim();
  if (!/^MANIFEST-\d+$/.test(current)) throw new Error('leveldb: bad CURRENT');
  const buf = fs.readFileSync(path.join(dir, current));
  const live = new Set();
  let logNumber = 0;
  let prevLogNumber = 0;
  for (const rec of readLogRecords(buf)) {
    let pos = 0;
    while (pos < rec.length) {
      let tag;
      [tag, pos] = readVarint(rec, pos);
      switch (tag) {
        case 1: [, pos] = readSlice(rec, pos); break; // comparator
        case 2: [logNumber, pos] = readVarint(rec, pos); break;
        case 3: [, pos] = readVarint(rec, pos); break; // next file number
        case 4: [, pos] = readVarint(rec, pos); break; // last sequence
        case 5: [, pos] = readVarint(rec, pos); [, pos] = readSlice(rec, pos); break; // compact pointer
        case 6: {
          let num;
          [, pos] = readVarint(rec, pos);
          [num, pos] = readVarint(rec, pos);
          live.delete(num);
          break;
        }
        case 7: {
          let num;
          [, pos] = readVarint(rec, pos); // level
          [num, pos] = readVarint(rec, pos);
          [, pos] = readVarint(rec, pos); // size
          [, pos] = readSlice(rec, pos); // smallest
          [, pos] = readSlice(rec, pos); // largest
          live.add(num);
          break;
        }
        case 9: [prevLogNumber, pos] = readVarint(rec, pos); break;
        default: throw new Error('leveldb: unknown manifest tag ' + tag);
      }
    }
  }
  return { liveTables: live, logNumber, prevLogNumber };
}

/**
 * Every live key/value in the database at `dir`, newest version per key,
 * deletions applied. Returns Map<latin1 key string, Buffer value>.
 */
function readLevelDb(dir) {
  const files = fs.readdirSync(dir);
  const { liveTables, logNumber, prevLogNumber } = readManifest(dir);
  const newest = new Map();
  const apply = ({ key, value, seq }) => {
    const k = key.toString('latin1');
    const prev = newest.get(k);
    if (!prev || seq >= prev.seq) newest.set(k, { seq, value });
  };
  for (const name of files) {
    const m = name.match(/^(\d+)\.(ldb|sst)$/);
    if (!m || !liveTables.has(Number(m[1]))) continue;
    for (const entry of readTable(fs.readFileSync(path.join(dir, name)))) apply(entry);
  }
  for (const name of files) {
    const m = name.match(/^(\d+)\.log$/);
    if (!m) continue;
    const num = Number(m[1]);
    if (num < logNumber && num !== prevLogNumber) continue;
    for (const rec of readLogRecords(fs.readFileSync(path.join(dir, name)))) {
      for (const entry of parseWriteBatch(rec)) apply(entry);
    }
  }
  const result = new Map();
  for (const [k, { value }] of newest) {
    if (value !== null) result.set(k, value);
  }
  return result;
}

// ── Chromium localStorage on top of it ──────────────────────────
// Keys: "_" + serialized storage key + "\0" + encoded key; values encoded the
// same way. Encoding byte 0 = UTF-16LE, 1 = Latin-1.
function decodeChromiumString(buf) {
  if (!buf || buf.length === 0) return '';
  const body = buf.subarray(1);
  if (buf[0] === 0) return body.toString('utf16le');
  if (buf[0] === 1) return body.toString('latin1');
  throw new Error('localStorage: unknown string encoding ' + buf[0]);
}

/**
 * localStorage entries for one origin (default the file:// origin older
 * Redstring builds ran at) from a profile's `Local Storage/leveldb` dir.
 * Returns [[key, value], …]; [] when the database doesn't exist.
 */
function readChromiumLocalStorage(leveldbDir, origin = 'file://') {
  if (!fs.existsSync(path.join(leveldbDir, 'CURRENT'))) return [];
  const prefix = '_' + origin + '\u0000';
  const out = [];
  for (const [k, v] of readLevelDb(leveldbDir)) {
    if (!k.startsWith(prefix)) continue;
    const keyBytes = Buffer.from(k.slice(prefix.length), 'latin1');
    out.push([decodeChromiumString(keyBytes), decodeChromiumString(v)]);
  }
  return out;
}

module.exports = {
  crc32c,
  snappyDecompress,
  readLogRecords,
  parseWriteBatch,
  readTable,
  readLevelDb,
  readChromiumLocalStorage
};
