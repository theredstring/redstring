// Append-only JSON Lines event log with replay support
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

class EventLog {
  constructor(rootDir = path.resolve(__dirname, '../../events')) {
    this.rootDir = rootDir;
    ensureDir(this.rootDir);
    this.listeners = new Set();
  }

  _filePathFor(ts) {
    return path.join(this.rootDir, `${dayKey(ts)}.jsonl`);
  }

  append(event) {
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ts: Date.now(),
      ...event
    };
    const filePath = this._filePathFor(record.ts);
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
    // Notify live subscribers
    this.listeners.forEach(fn => {
      try { fn(record); } catch {}
    });
    return record.id;
  }

  // Replay events since a given timestamp (inclusive)
  replaySince(sinceTs = 0) {
    const files = fs.readdirSync(this.rootDir).filter(f => f.endsWith('.jsonl')).sort();
    const out = [];
    for (const file of files) {
      const full = path.join(this.rootDir, file);
      const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (e.ts >= sinceTs) out.push(e);
        } catch {}
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const eventLog = new EventLog();
export default eventLog;


