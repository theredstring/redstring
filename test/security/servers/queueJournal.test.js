// @vitest-environment node
/**
 * S-54: the queue journal (data/queues/*.jsonl) must never contain API keys or
 * tokens; a live request's key stays in memory only, so a replay after restart
 * has none.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QueueManager, redactSecrets, isSecretKey } from '../../../src/services/queue/Queue.js';
import { tmpDir } from './helpers.js';

const dir = tmpDir('rs-sec-queue-');
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

const SECRET = 'sk-or-v1-THIS-MUST-NOT-BE-JOURNALED';

describe('queue journal secret hygiene', () => {
  it('journals items without apiKey / tokens / authorization, keeps the rest', () => {
    const q = new QueueManager(dir);
    q.enqueue('patches', {
      threadId: 't1',
      meta: {
        cid: 'c1',
        apiKey: SECRET,
        api_key: SECRET,
        apiConfig: { provider: 'openrouter', model: 'm', settings: { max_tokens: 800 }, headers: { Authorization: `Bearer ${SECRET}` } },
        nested: [{ accessToken: SECRET, refresh_token: SECRET, clientSecret: SECRET, keep: 'yes' }],
      },
    });
    const journal = fs.readFileSync(path.join(dir, 'patches.jsonl'), 'utf8');
    expect(journal).not.toContain(SECRET);
    expect(journal).not.toMatch(/"apiKey"|"api_key"|"accessToken"|"refresh_token"|"clientSecret"|"Authorization"/);
    expect(journal).toContain('"max_tokens":800'); // token COUNTS are not secrets
    expect(journal).toContain('"keep":"yes"');
    expect(journal).toContain('"cid":"c1"');
  });

  it('keeps the live key in memory for this run only; a replay has none', () => {
    const live = new QueueManager(dir);
    const [item] = live.pull('patches', { max: 1 });
    // same process, same instance that loaded the journal → no key (it was never written)
    expect(item.meta.apiKey).toBeUndefined();

    const q2 = new QueueManager(tmpDir('rs-sec-queue2-'));
    q2.enqueue('patches', { meta: { apiKey: SECRET } });
    const [liveItem] = q2.pull('patches', { max: 1 });
    expect(liveItem.meta.apiKey).toBe(SECRET); // live request: still usable in-process
    const replay = new QueueManager(q2.journalRoot);
    expect(JSON.stringify(replay.getQueue('patches').items)).not.toContain(SECRET);
  });

  it('isSecretKey / redactSecrets', () => {
    for (const k of ['apiKey', 'API_KEY', 'api-key', 'token', 'accessToken', 'id_token', 'authorization', 'clientSecret', 'password', 'credentials']) {
      expect(isSecretKey(k), k).toBe(true);
    }
    for (const k of ['max_tokens', 'maxTokens', 'tokenCount', 'total_tokens', 'name', 'graphId']) {
      expect(isSecretKey(k), k).toBe(false);
    }
    expect(redactSecrets({ a: [{ token: 1, b: 2 }] })).toEqual({ a: [{ b: 2 }] });
  });

  it('Committer no longer logs the patch meta (which carries the key)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../src/services/Committer.js'), 'utf8');
    expect(src).not.toMatch(/console\.\w+\([^;]*JSON\.stringify\([^)]*\bmeta\b/);
  });
});
