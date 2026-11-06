/**
 * Reading a .redstring file someone picked, before any of it goes anywhere.
 *
 * The file is whatever its author made it, so nothing from it is trusted: it
 * goes through the same gate as every other load (validateFormatVersion's shape
 * and version checks, then importFromRedstring, which strips prototype keys and
 * drops unsafe links, images, colours and agent credentials). What a repository
 * ends up holding is a fresh export of that cleaned state, never these bytes.
 *
 * Paths are safe by construction too: they are built from the universe's slug
 * (generateUniqueSlug), not from anything the file says about itself.
 */
import { parseRedstringBytes } from '../formats/universeBytes.js';
import { importFromRedstring, validateFormatVersion } from '../formats/redstringFormat.js';
import { countUserPrototypes } from '../formats/userDataCounts.js';
import { GIT_WRITE_CAP_BYTES } from './gitSyncEngine.js';
import { gitUniversePath } from './universeTarget.js';

const megabytes = (bytes) => Math.round(bytes / (1024 * 1024));

/**
 * @param {File} file - The picked file.
 * @returns {Promise<{ storeState: Object, name: string, thingCount: number, webCount: number }>}
 * @throws {Error} with a message fit to show, when the file can't be uploaded
 */
export async function readUniverseUpload(file) {
  const fileName = file?.name || 'This file';
  const notValid = () => new Error(`${fileName} isn't a valid .redstring file.`);

  if (!/\.redstring$/i.test(fileName)) throw notValid();
  // Before reading it: a file this size is refused whatever is inside it.
  if (file.size > GIT_WRITE_CAP_BYTES) {
    throw new Error(`${fileName} is ${megabytes(file.size)} MB, over the ${megabytes(GIT_WRITE_CAP_BYTES)} MB a repository can carry.`);
  }

  // Outside the try: a file that couldn't be read isn't a file that's invalid.
  const bytes = new Uint8Array(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseRedstringBytes(bytes);
  } catch {
    throw notValid();
  }
  if (parsed === null) throw new Error(`${fileName} is empty.`);

  const validation = validateFormatVersion(parsed);
  if (!validation.valid) {
    if (validation.tooNew) throw new Error(`${fileName} was made with a newer version of Redstring (${validation.version}). Update the app to upload it.`);
    if (validation.tooOld) throw new Error(`${fileName} is in a format too old to open (${validation.version}).`);
    throw notValid();
  }

  let storeState;
  try {
    ({ storeState } = importFromRedstring(parsed));
  } catch {
    throw notValid();
  }

  const thingCount = countUserPrototypes(storeState);
  const webCount = storeState?.graphs?.size ?? 0;
  if (thingCount === 0 && webCount === 0) throw new Error(`${fileName} has no things or webs in it.`);

  const name = fileName.replace(/\.redstring$/i, '').trim() || 'Uploaded universe';
  return { storeState, name, thingCount, webCount };
}

/**
 * Where a new universe's file goes in a repository: the folder and file a new
 * universe always gets, numbered past anything already there. Slugs are only
 * unique on this device, and a repository holds universes from everywhere.
 *
 * @param {string} slug
 * @param {Array<{ path?: string }>} discovered - The repository's current listing.
 * @returns {{ folder: string, file: string }}
 */
export function freeRepoTarget(slug, discovered = []) {
  const taken = new Set(discovered.map((item) => String(item?.path || '').toLowerCase()));
  const targetFor = (base) => ({ folder: base, file: `${base}.redstring` });
  const isFree = ({ folder, file }) => !taken.has(gitUniversePath(folder, file).toLowerCase());

  if (isFree(targetFor(slug))) return targetFor(slug);
  let counter = 1;
  while (!isFree(targetFor(`${slug}-${counter}`))) counter++;
  return targetFor(`${slug}-${counter}`);
}
