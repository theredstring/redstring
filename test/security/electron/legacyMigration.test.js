// @vitest-environment node
// (Node's Blob/WebCrypto stand in for the browser's; jsdom's Blob lacks
// arrayBuffer().)
//
// C-5: file:// → app://redstring storage migration. Exercises the real page
// exporter (run here against an in-memory IndexedDB and Node's WebCrypto), the
// secret handoff, and the renderer import — including idempotent retries.
import { describe, it, expect } from 'vitest';
import {
  legacyExportInPage,
  buildLegacyExportScript,
  findCiphertexts,
  planSecretHandoff,
  buildHandoffPayload,
  SKIP_DATABASES
} from '../../../electron/legacyMigration.cjs';
import { applyLegacyState, decodeLegacyValue } from '../../../src/electronLegacyImport.js';
import { createFakeIndexedDB, createFakeLocalStorage } from './helpers/fakeIndexedDB.js';

const subtle = globalThis.crypto.subtle;
const toB64 = (b) => Buffer.from(b).toString('base64');

// Encrypt exactly like src/utils/secureStore.js.
async function secureStoreEncrypt(key, text) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return `rsenc:v1:${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

async function runExport(indexedDB, options) {
  const prev = globalThis.indexedDB;
  globalThis.indexedDB = indexedDB;
  try {
    return JSON.parse(await legacyExportInPage({ skipDatabases: SKIP_DATABASES, ...options }));
  } finally {
    globalThis.indexedDB = prev;
  }
}

describe('secret handoff (rsplain:v1: contract with secureStore)', () => {
  it('replaces top-level and nested ciphertexts in place, JSON-safely', () => {
    const ctA = 'rsenc:v1:AAAA.BBBB';
    const ctB = 'rsenc:v1:CCCC.DDDD';
    const entries = [
      ['github_access_token', ctA],
      ['redstring_ai_api_profiles', JSON.stringify({ p1: { key: ctB, provider: 'openrouter' } })],
      ['redstring_ai_api_key', JSON.stringify({ key: ctB })],
      ['plain', 'hello'],
      ['undecryptable', 'rsenc:v1:ZZZZ.YYYY']
    ];
    expect(findCiphertexts(entries).sort()).toEqual([ctA, ctB, 'rsenc:v1:ZZZZ.YYYY'].sort());
    const { entries: out, secretsHandedOff } = planSecretHandoff({
      localStorageEntries: entries,
      decrypted: [[ctA, 'gho_token'], [ctB, 'sk-"quoted"\\key']]
    });
    const m = Object.fromEntries(out);
    expect(secretsHandedOff).toBe(2);
    expect(m.github_access_token).toBe('rsplain:v1:gho_token');
    expect(JSON.parse(m.redstring_ai_api_profiles).p1.key).toBe('rsplain:v1:sk-"quoted"\\key');
    expect(JSON.parse(m.redstring_ai_api_profiles).p1.provider).toBe('openrouter');
    expect(JSON.parse(m.redstring_ai_api_key).key).toBe('rsplain:v1:sk-"quoted"\\key');
    expect(m.plain).toBe('hello');
    expect(m.undecryptable).toBe('rsenc:v1:ZZZZ.YYYY');
  });

  it('an empty legacy origin is "nothing to migrate"', () => {
    const h = buildHandoffPayload({ localStorageEntries: [], exported: { databases: [], decrypted: [] } });
    expect(h.isEmpty).toBe(true);
  });

  it('the injected script is self-contained and carries its options', () => {
    const script = buildLegacyExportScript({ ciphertexts: ['rsenc:v1:A.B'] });
    expect(script.startsWith('(async function legacyExportInPage')).toBe(true);
    expect(script).toContain('"ciphertexts":["rsenc:v1:A.B"]');
    expect(script).toContain('"redstring-secure"');
  });
});

describe('legacy export → import round trip', () => {
  it('decrypts with the old key, carries IndexedDB faithfully, and fills only what is missing', async () => {
    const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const token = await secureStoreEncrypt(key, 'gho_fake_token');
    const legacyIdb = createFakeIndexedDB({
      'redstring-secure': { stores: { keys: { records: [['secret-store-aes-key', key]] } } },
      'redstring-label-sprites': { stores: { sprites: { records: [['k', 'cache']] } } },
      RedstringUniverses: {
        version: 1,
        stores: { universes: { keyPath: 'id', records: [['u1', { id: 'u1', data: { nodes: [1, 2] }, when: new Date(1700000000000) }]] } }
      },
      RedstringBackups: {
        version: 1,
        stores: {
          backups: {
            keyPath: 'key',
            indexes: [{ name: 'slug', keyPath: 'slug' }],
            records: [['s:1', { key: 's:1', slug: 's', raw: new Blob(['{"a":1}'], { type: 'application/json' }), bytes: new Uint8Array([1, 2, 3]), map: new Map([['x', 1]]), set: new Set([1]), neg: -0, nan: NaN, missing: undefined }]]
          }
        }
      },
      RedstringFileHandles: {
        version: 2,
        stores: { fileHandles: { records: [['slug-a', { fileName: 'a.redstring', __rsMigrationType: 'looks-like-a-tag' }], ['slug-b', { handle: key }]] } }
      }
    });

    const localStorageEntries = [['github_access_token', token], ['onboarding', 'done']];
    const exported = await runExport(legacyIdb, { ciphertexts: findCiphertexts(localStorageEntries) });

    expect(exported.errors).toEqual([]);
    expect(exported.decrypted).toEqual([[token, 'gho_fake_token']]);
    expect(exported.databases.map((d) => d.name).sort()).toEqual(['RedstringBackups', 'RedstringFileHandles', 'RedstringUniverses']);
    // A CryptoKey can't leave the origin: that one record is skipped, not the store.
    expect(exported.skippedRecords).toBe(1);
    // The export is JSON: nothing structured-clone-only survives un-tagged.
    expect(() => JSON.parse(JSON.stringify(exported))).not.toThrow();

    const { payload } = buildHandoffPayload({ localStorageEntries, exported });
    expect(Object.fromEntries(payload.localStorage).github_access_token).toBe('rsplain:v1:gho_fake_token');

    // New origin already has a newer value for one key and one record.
    const ls = createFakeLocalStorage({ onboarding: 'newer' });
    const idb = createFakeIndexedDB({
      RedstringUniverses: { version: 1, stores: { universes: { keyPath: 'id', records: [['u1', { id: 'u1', data: 'NEWER' }]] } } }
    });
    const counts = await applyLegacyState(payload, { localStorage: ls, indexedDB: idb });
    expect(counts.localStorageAdded).toBe(1);
    expect(counts.localStorageExisting).toBe(1);
    expect(ls.getItem('onboarding')).toBe('newer');
    expect(ls.getItem('github_access_token')).toBe('rsplain:v1:gho_fake_token');
    expect(counts.recordsExisting).toBe(1);
    expect(idb._dbs.get('RedstringUniverses').stores.get('universes').records.get('"u1"').value.data).toBe('NEWER');

    // Created at the legacy version with the legacy schema.
    const backups = idb._dbs.get('RedstringBackups');
    expect(backups.version).toBe(1);
    const bstore = backups.stores.get('backups');
    expect(bstore.keyPath).toBe('key');
    expect([...bstore.indexes.keys()]).toEqual(['slug']);
    const rec = bstore.records.get('"s:1"').value;
    expect(rec.raw).toBeInstanceOf(Blob);
    expect(await rec.raw.text()).toBe('{"a":1}');
    expect(rec.raw.type).toBe('application/json');
    expect([...rec.bytes]).toEqual([1, 2, 3]);
    expect(rec.map).toBeInstanceOf(Map);
    expect(rec.map.get('x')).toBe(1);
    expect(rec.set.has(1)).toBe(true);
    expect(Object.is(rec.neg, -0)).toBe(true);
    expect(Number.isNaN(rec.nan)).toBe(true);
    expect('missing' in rec).toBe(true);
    expect(idb._dbs.get('RedstringFileHandles').version).toBe(2);
    const fh = idb._dbs.get('RedstringFileHandles').stores.get('fileHandles').records.get('"slug-a"').value;
    expect(fh).toEqual({ fileName: 'a.redstring', __rsMigrationType: 'looks-like-a-tag' });
    expect(idb._dbs.has('redstring-secure')).toBe(false);
    expect(idb._dbs.has('redstring-label-sprites')).toBe(false);

    // A retry (e.g. the marker write failed) changes nothing.
    const again = await applyLegacyState(payload, { localStorage: ls, indexedDB: idb });
    expect(again.localStorageAdded).toBe(0);
    expect(again.recordsAdded).toBe(0);
  });

  it('counts undecryptable secrets instead of failing (no key in the old origin)', async () => {
    const exported = await runExport(createFakeIndexedDB({}), { ciphertexts: ['rsenc:v1:AAAA.BBBB'] });
    expect(exported.decrypted).toEqual([]);
    expect(exported.undecryptable).toBe(1);
  });

  it('decodeLegacyValue rejects unknown tags', () => {
    expect(() => decodeLegacyValue({ __rsMigrationType: 'Function' })).toThrow();
  });
});
