/**
 * The link that shares a universe, and who it opens for. A universe can be
 * shared once it's in a GitHub repository: the link points at its file there,
 * and the repository decides who can read it.
 */

import { buildSharedLink } from './sharedLink.js';
import { sanitizeGitFileBaseName } from './gitSyncEngine.js';

/** The shared link for a universe, or null if it has nowhere to point. */
export function sharedLinkForUniverse(universe) {
  const raw = universe?.raw || universe;
  if (raw?.readOnly?.sourceUrl) return buildSharedLink(raw.readOnly.sourceUrl);
  const gitRepo = raw?.gitRepo;
  const linked = gitRepo?.linkedRepo;
  if (!linked?.user || !linked?.repo || (linked.type && linked.type !== 'github')) return null;
  const folder = gitRepo.universeFolder || universe.slug;
  const file = gitRepo.universeFile || `${universe.slug}.redstring`;
  const branch = gitRepo.branch || 'main';
  return buildSharedLink(`https://github.com/${linked.user}/${linked.repo}/blob/${branch}/universes/${folder}/${sanitizeGitFileBaseName(file)}.redstring`);
}

/**
 * Who a repository lets read the file: 'anyone', 'repo' (a private repository's
 * people), or 'unknown'. Asked without a token first, so a repo the app can't
 * see still answers truthfully for someone without access.
 */
export async function repoAudience({ user, repo }) {
  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}`, {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (res.status === 404) return 'repo';
    if (!res.ok) return 'unknown';
    const data = await res.json();
    return data?.private === false ? 'anyone' : 'repo';
  } catch {
    return 'unknown';
  }
}

export async function copyText(text) {
  if (window.electron?.clipboard?.writeText) await window.electron.clipboard.writeText(text);
  else await navigator.clipboard.writeText(text);
}
