// Earlier copies of universe files (Settings → Data → Backups).
//
// Each universe gets a folder under a root main owns, outside every file-IPC
// root, so the renderer reaches it only through backups:* and can name a
// universe and a backup id, never a path. A universe stays one file wherever
// the user keeps it; its backups live here, not beside it.
//
// A backup is normally a clone of the file just saved: on APFS (and other
// copy-on-write filesystems) that costs no time and shares the unchanged
// blocks, so keeping a dozen copies of a big universe is cheap. Which copies
// to keep is the renderer's call (src/services/universeBackups.js); this
// module only makes, lists, reads and removes them.
//
// Kept free of `require('electron')` so it can be tested in plain Node.

const path = require('node:path');
const nodeFs = require('node:fs');
const crypto = require('node:crypto');

// 20261009T143200123Z: an ISO timestamp with the separators taken out, so it
// sorts as text, reads as a time, and is safe as a filename everywhere.
const ID_RE = /^\d{8}T\d{9}Z$/;
const EXT = '.redstring';

const isValidBackupId = (id) => typeof id === 'string' && ID_RE.test(id);

const idFromTime = (ms) => new Date(ms).toISOString().replace(/[-:.]/g, '');

const timeFromId = (id) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(id);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : NaN;
};

// A universe slug as a folder name. Plain slugs pass through; anything else
// is reduced to safe characters plus a short hash of the original, so two
// slugs that reduce alike still get different folders.
function folderNameForSlug(slug) {
  if (typeof slug !== 'string' || !slug) throw new Error('Invalid universe');
  if (/^[A-Za-z0-9_-]{1,64}$/.test(slug)) return slug;
  const safe = slug.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
  const hash = crypto.createHash('sha256').update(slug).digest('hex').slice(0, 12);
  return `${safe}-${hash}`;
}

function createBackupStore({ root, fs = nodeFs.promises, now = () => Date.now() } = {}) {
  if (!root || !path.isAbsolute(root)) throw new Error('Backup root must be an absolute path');

  const folderFor = (slug) => path.join(root, folderNameForSlug(slug));

  const pathFor = (slug, id) => {
    if (!isValidBackupId(id)) throw new Error('Invalid backup');
    return path.join(folderFor(slug), `${id}${EXT}`);
  };

  // A fresh id for now, moved on a millisecond if a backup already has it.
  const freshTarget = async (slug) => {
    const dir = folderFor(slug);
    await fs.mkdir(dir, { recursive: true });
    let at = now();
    for (let i = 0; i < 50; i++, at++) {
      const id = idFromTime(at);
      const target = path.join(dir, `${id}${EXT}`);
      try {
        await fs.access(target);
      } catch {
        return { id, at, target };
      }
    }
    throw new Error('Could not name the backup');
  };

  // Write through a temp name and rename, so a crash mid-copy never leaves a
  // truncated file that lists as a backup.
  const land = async (target, write) => {
    const tmp = `${target}.${process.pid}.tmp`;
    try {
      await write(tmp);
      await fs.rename(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  };

  const describe = async (target, id, at) => {
    const stat = await fs.stat(target);
    return { id, at, size: stat.size };
  };

  /** Copy (clone, where the filesystem can) the file at `sourcePath`. */
  async function snapshotFile(slug, sourcePath) {
    const { id, at, target } = await freshTarget(slug);
    await land(target, (tmp) => fs.copyFile(sourcePath, tmp, nodeFs.constants.COPYFILE_FICLONE));
    return describe(target, id, at);
  }

  /** Keep these bytes as a backup. */
  async function writeBytes(slug, bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('Backup content must be bytes');
    const { id, at, target } = await freshTarget(slug);
    await land(target, (tmp) => fs.writeFile(tmp, bytes));
    return describe(target, id, at);
  }

  /** This universe's backups, newest first. */
  async function list(slug) {
    let names;
    try {
      names = await fs.readdir(folderFor(slug));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const entries = [];
    for (const name of names) {
      if (!name.endsWith(EXT)) continue;
      const id = name.slice(0, -EXT.length);
      if (!isValidBackupId(id)) continue;
      try {
        entries.push(await describe(path.join(folderFor(slug), name), id, timeFromId(id)));
      } catch { /* removed while listing */ }
    }
    return entries.sort((a, b) => b.at - a.at);
  }

  async function read(slug, id) {
    const buffer = await fs.readFile(pathFor(slug, id));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  async function remove(slug, id) {
    await fs.rm(pathFor(slug, id), { force: true });
  }

  /** Bytes and count across every universe's backups. */
  async function usage() {
    let folders;
    try {
      folders = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return { bytes: 0, count: 0 };
      throw error;
    }
    let bytes = 0;
    let count = 0;
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      const dir = path.join(root, folder.name);
      let names = [];
      try { names = await fs.readdir(dir); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith(EXT) || !isValidBackupId(name.slice(0, -EXT.length))) continue;
        try {
          bytes += (await fs.stat(path.join(dir, name))).size;
          count++;
        } catch { /* removed while counting */ }
      }
    }
    return { bytes, count };
  }

  /** Every universe's backups, gone. Only on the user's say-so. */
  async function clearAll() {
    await fs.rm(root, { recursive: true, force: true });
  }

  return { folderFor, snapshotFile, writeBytes, list, read, remove, usage, clearAll };
}

module.exports = { createBackupStore, folderNameForSlug, isValidBackupId, idFromTime, timeFromId };
