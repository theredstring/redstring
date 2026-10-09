/**
 * Backups (Settings → Data, History → Backups): after a save lands, a copy if
 * the last one is ten minutes old; kept, the newest ten plus the last of each
 * day for two weeks. A backup never holds up or fails a save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  backupsToDrop, isBackupDue, noteUniverseSaved, backUpNow, setBackupMode, getBackupMode,
  BACKUP_INTERVAL_MS, KEEP_RECENT, KEEP_DAYS, DEFAULT_BACKUP_MODE, __resetUniverseBackups
} from '../../src/services/universeBackups.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const NOW = new Date(2026, 9, 9, 15, 0).getTime();

const entry = (at, id = `b${at}`) => ({ id, at, size: 1 });

describe('which backups are kept', () => {
  it('keeps everything while there are no more than ten', () => {
    const entries = Array.from({ length: KEEP_RECENT }, (_, i) => entry(NOW - i * MIN));
    expect(backupsToDrop(entries, NOW)).toEqual([]);
  });

  it('past ten, keeps one a day: the last of each day', () => {
    // Twenty copies today ten minutes apart, three a day for the five days before.
    const today = Array.from({ length: 20 }, (_, i) => entry(NOW - i * 10 * MIN));
    const earlier = [];
    for (let d = 1; d <= 5; d++) {
      for (let h = 0; h < 3; h++) earlier.push(entry(NOW - d * DAY - h * 60 * MIN));
    }
    const dropped = new Set(backupsToDrop([...earlier, ...today], NOW).map((e) => e.id));
    const kept = [...today, ...earlier].filter((e) => !dropped.has(e.id));

    expect(kept.slice(0, KEEP_RECENT)).toEqual(today.slice(0, KEEP_RECENT));
    // Of each earlier day, only its latest copy (h = 0).
    for (let d = 1; d <= 5; d++) {
      expect(kept.filter((e) => Math.abs(e.at - (NOW - d * DAY)) < 3 * 60 * MIN)).toEqual([entry(NOW - d * DAY)]);
    }
    expect(kept.length).toBe(KEEP_RECENT + 5);
  });

  it('lets go of daily copies older than two weeks, but never the newest ten', () => {
    const old = Array.from({ length: 10 }, (_, i) => entry(NOW - (KEEP_DAYS + 30 + i) * DAY));
    expect(backupsToDrop(old, NOW)).toEqual([]);
    const plusRecent = [...Array.from({ length: KEEP_RECENT }, (_, i) => entry(NOW - i * MIN)), ...old];
    expect(backupsToDrop(plusRecent, NOW).map((e) => e.id).sort()).toEqual(old.map((e) => e.id).sort());
  });

  it('is due ten minutes after the last one', () => {
    expect(isBackupDue(0, NOW)).toBe(true);
    expect(isBackupDue(NOW - BACKUP_INTERVAL_MS + 1, NOW)).toBe(false);
    expect(isBackupDue(NOW - BACKUP_INTERVAL_MS, NOW)).toBe(true);
  });
});

describe('taking backups after a save', () => {
  let api;
  let saved;
  let clock;

  beforeEach(() => {
    localStorage.clear();
    clock = NOW;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    saved = [];
    api = {
      list: vi.fn(async () => [...saved].sort((a, b) => b.at - a.at)),
      snapshot: vi.fn(async (slug, filePath) => { const e = { id: `s${clock}`, at: clock, size: 1, filePath }; saved.push(e); return e; }),
      write: vi.fn(async () => { const e = { id: `w${clock}`, at: clock, size: 1 }; saved.push(e); return e; }),
      remove: vi.fn(async (slug, id) => { saved = saved.filter((e) => e.id !== id); }),
      read: vi.fn(), usage: vi.fn(), clear: vi.fn(), reveal: vi.fn()
    };
    window.electron = { backups: api };
    __resetUniverseBackups();
  });

  afterEach(() => {
    delete window.electron;
    vi.restoreAllMocks();
  });

  it('is on unless switched off, and remembers the switch', () => {
    expect(DEFAULT_BACKUP_MODE).toBe('on');
    expect(getBackupMode()).toBe('on');
    setBackupMode('off');
    __resetUniverseBackups();
    expect(getBackupMode()).toBe('off');
  });

  it('copies the saved file, then not again for ten minutes', async () => {
    await noteUniverseSaved('ideas', { filePath: '/u/Ideas.redstring' });
    expect(api.snapshot).toHaveBeenCalledWith('ideas', '/u/Ideas.redstring');

    clock += BACKUP_INTERVAL_MS - 1;
    await noteUniverseSaved('ideas', { filePath: '/u/Ideas.redstring' });
    expect(api.snapshot).toHaveBeenCalledTimes(1);

    clock += 1;
    await noteUniverseSaved('ideas', { filePath: '/u/Ideas.redstring' });
    expect(api.snapshot).toHaveBeenCalledTimes(2);
  });

  it('counts from the newest backup already there, not from launch', async () => {
    saved.push({ id: 'old', at: NOW - MIN, size: 1 });
    await noteUniverseSaved('ideas', { filePath: '/u/Ideas.redstring' });
    expect(api.snapshot).not.toHaveBeenCalled();
  });

  it('takes nothing when switched off', async () => {
    setBackupMode('off');
    await noteUniverseSaved('ideas', { filePath: '/u/Ideas.redstring' });
    expect(api.list).not.toHaveBeenCalled();
    expect(api.snapshot).not.toHaveBeenCalled();
  });

  it('drops what the policy lets go after taking one', async () => {
    for (let i = 1; i <= KEEP_RECENT; i++) saved.push({ id: `old${i}`, at: NOW - BACKUP_INTERVAL_MS - i * 10 * MIN, size: 1 });
    await noteUniverseSaved('ideas', { filePath: '/u/Ideas.redstring' });
    expect(saved.length).toBe(KEEP_RECENT);
    expect(saved.some((e) => e.id === `old${KEEP_RECENT}`)).toBe(false);
  });

  it('never throws into the save that called it', async () => {
    api.snapshot.mockRejectedValueOnce(new Error('disk full'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(noteUniverseSaved('ideas', { filePath: '/u/Ideas.redstring' })).resolves.toBeNull();
  });

  it('keeps bytes when there is no file path, and backs up now whatever the switch says', async () => {
    setBackupMode('off');
    await backUpNow('ideas', { content: new TextEncoder().encode('{}') });
    expect(api.write).toHaveBeenCalledTimes(1);
  });
});
