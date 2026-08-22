// Simple in-memory queue with file-backed journal and partition support
// Ready to be swapped with Redis/SQS via a thin adapter layer

import fs from 'fs';
import os from 'os';
import path from 'path';

// The wizard's tools import this queue, and the wizard now runs in the browser
// as well as in Node. There is no filesystem there, so the journal is optional:
// in Node the queue is file-backed and survives a restart exactly as before, in
// the browser it is purely in-memory.
//
// Every `fs`/`os`/`path` use below is gated on IS_NODE. The bundler resolves
// those imports to a stub whose properties throw on access, so touching one in
// the browser is a runtime error — the gate is what keeps them untouched.
const IS_NODE = typeof process !== 'undefined'
  && !!process.versions?.node
  && typeof window === 'undefined';

// `fileURLToPath` cannot be imported here — it is a named export, and the
// browser stub has none, which fails the build outright rather than at runtime.
// This is the same conversion for the platforms this server runs on.
function moduleDir() {
  try {
    const p = decodeURIComponent(new URL('.', import.meta.url).pathname);
    return /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p; // Windows: /C:/… → C:/…
  } catch {
    return '';
  }
}

const __dirname = IS_NODE ? moduleDir() : '';

function ensureDir(dirPath) {
  if (!IS_NODE || !dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function nowTs() {
  return Date.now();
}

function randomId(prefix = 'q') {
  return `${prefix}-${nowTs()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultJournalRoot() {
  if (!IS_NODE) return null;
  return __dirname
    ? path.resolve(__dirname, '../../../data/queues')
    : path.join(os.tmpdir(), 'redstring-queues');
}

class QueueManager {
  constructor(journalRoot = defaultJournalRoot()) {
    this.journalRoot = journalRoot;
    ensureDir(this.journalRoot);
    // Map<string, { items: Array, inflight: Map<leaseId,itemId>, byId: Map, metrics: {} }>
    this.queues = new Map();
  }

  getQueue(name) {
    if (!this.queues.has(name)) {
      const q = { items: [], inflight: new Map(), byId: new Map(), metrics: { enq: 0, deq: 0, ack: 0, nack: 0 } };
      this.queues.set(name, q);
      // Load journal if exists
      const journalPath = this._journalPath(name);
      if (journalPath && fs.existsSync(journalPath)) {
        try {
          const lines = fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean);
          for (const line of lines) {
            const entry = JSON.parse(line);
            if (entry.type === 'enq') {
              q.items.push(entry.item);
              q.byId.set(entry.item.id, entry.item);
            } else if (entry.type === 'ack') {
              const it = q.byId.get(entry.itemId);
              if (it) {
                q.byId.delete(entry.itemId);
                q.items = q.items.filter(x => x.id !== entry.itemId);
              }
            } else if (entry.type === 'nack') {
              // no-op; we keep items in queue
            }
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[Queue] Failed to load journal for ${name}:`, e.message);
        }
      }
    }
    return this.queues.get(name);
  }

  _journalPath(name) {
    if (!IS_NODE || !this.journalRoot) return null;
    return path.join(this.journalRoot, `${name}.jsonl`);
  }

  _appendJournal(name, record) {
    const journalPath = this._journalPath(name);
    if (!journalPath) return; // in-memory only (browser)
    fs.appendFileSync(journalPath, JSON.stringify(record) + '\n');
  }

  enqueue(name, item, { partitionKey } = {}) {
    const q = this.getQueue(name);
    const wrapped = {
      ...item,
      id: item.id || randomId('itm'),
      partitionKey: partitionKey || item.partitionKey || 'default',
      enqueuedAt: nowTs(),
      status: 'queued'
    };
    q.items.push(wrapped);
    q.byId.set(wrapped.id, wrapped);
    q.metrics.enq++;
    this._appendJournal(name, { type: 'enq', item: wrapped });
    return wrapped.id;
  }

  // Pull up to max items, optionally limited to a partition and filtered
  pull(name, { partitionKey, max = 1, filter } = {}) {
    const q = this.getQueue(name);
    const out = [];
    for (const item of q.items) {
      if (out.length >= max) break;
      if (item.status !== 'queued') continue;
      if (partitionKey && item.partitionKey !== partitionKey) continue;
      if (typeof filter === 'function' && !filter(item)) continue;
      const leaseId = randomId('lease');
      item.status = 'inflight';
      item.leasedAt = nowTs();
      item.leaseId = leaseId;
      q.inflight.set(leaseId, item.id);
      q.metrics.deq++;
      out.push({ ...item });
    }
    return out;
  }

  ack(name, leaseId) {
    const q = this.getQueue(name);
    const itemId = q.inflight.get(leaseId);
    if (!itemId) return false;
    const item = q.byId.get(itemId);
    if (item) {
      item.status = 'acked';
      item.ackedAt = nowTs();
      // Remove from main list and byId
      q.items = q.items.filter(x => x.id !== itemId);
      q.byId.delete(itemId);
      q.metrics.ack++;
      this._appendJournal(name, { type: 'ack', itemId, leaseId, ts: nowTs() });
    }
    q.inflight.delete(leaseId);
    return true;
  }

  nack(name, leaseId) {
    const q = this.getQueue(name);
    const itemId = q.inflight.get(leaseId);
    if (!itemId) return false;
    const item = q.byId.get(itemId);
    if (item) {
      item.status = 'queued';
      item.leasedAt = null;
      item.leaseId = null;
      q.metrics.nack++;
      this._appendJournal(name, { type: 'nack', itemId, leaseId, ts: nowTs() });
    }
    q.inflight.delete(leaseId);
    return true;
  }

  // Pull a batch available within a coalescing window
  pullBatch(name, { windowMs = 300, max = 100, partitionKey, filter } = {}) {
    const batch = this.pull(name, { partitionKey, max, filter });
    if (batch.length === 0) return batch;
    const start = nowTs();
    while (nowTs() - start < windowMs) {
      const extra = this.pull(name, { partitionKey, max: max - batch.length, filter });
      if (extra.length === 0) break;
      batch.push(...extra);
    }
    return batch;
  }

  metrics(name) {
    const q = this.getQueue(name);
    return { ...q.metrics, depth: q.items.length, inflight: q.inflight.size };
  }
}

const queueManager = new QueueManager();
export default queueManager;


