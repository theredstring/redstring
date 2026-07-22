/**
 * Finish sequence for the onboarding GitHub wizard: repo → universe →
 * attach → initial push → promote git → optional local file.
 *
 * Mirrors the canonical panel flow (UniverseManager handleAttachRepoCreateNew
 * + handleCreateUniverseFromLocalFile) but reports progress per sub-step so
 * the wizard can render a checklist.
 *
 * Safety: git is only promoted to source of truth after a successful initial
 * push — a failed push leaves the universe browser-backed with the repo
 * linked, so an empty repo can never become primary and clobber data.
 */
import universeManagerService, { STORAGE_TYPES } from './universeManagerService.js';
import universeBackend from './universeBackend.js';
import { createRepository } from './githubRepoService.js';
import { isElectron, pickSaveLocation, writeFile } from '../utils/fileAccessAdapter.js';

const { warn: __nativeWarn } = console;
const goWarn = (...args) => __nativeWarn.call(console, '[GitOnboarding]', ...args);

export const GIT_ONBOARDING_TASKS = [
  { id: 'repo', label: 'Set up repository' },
  { id: 'universe', label: 'Create universe' },
  { id: 'attach', label: 'Link repository' },
  { id: 'push', label: 'Push initial data' },
  { id: 'promote', label: 'Make GitHub the source of truth' },
  { id: 'local-file', label: 'Save local file copy' }
];

/**
 * @param {object} opts
 * @param {'create'|'existing'} opts.repoChoice
 * @param {string} [opts.repoName]        — for 'create'
 * @param {boolean} [opts.isPrivate]      — for 'create' (default true)
 * @param {object} [opts.existingRepo]    — GitHub repo object for 'existing'
 * @param {string} opts.universeName
 * @param {boolean} [opts.linkLocalFile]  — desktop only
 * @param {'oauth'|'github-app'} [opts.authMethod]
 * @param {string} [opts.reuseSlug]       — slug from a prior failed attempt; skips re-creating the universe on retry
 * @param {(taskId: string, status: 'running'|'done'|'warning'|'error', detail?: string) => void} [opts.onProgress]
 * @returns {Promise<{ slug: string, owner: string, repo: string, warnings: string[] }>}
 *   Errors thrown after universe creation carry `.slug` so callers can retry without duplicating universes.
 */
export async function runGitOnboardingSetup({
  repoChoice,
  repoName,
  isPrivate = true,
  existingRepo,
  universeName,
  linkLocalFile = false,
  authMethod = 'oauth',
  reuseSlug = null,
  onProgress = () => {}
}) {
  const warnings = [];

  // 1. Repository
  onProgress('repo', 'running');
  let owner;
  let repo;
  if (repoChoice === 'create') {
    const { repo: created, existed } = await createRepository({ name: repoName, isPrivate });
    owner = created.owner?.login || created.owner?.name;
    repo = created.name;
    if (existed) {
      onProgress('repo', 'done', `Repository already existed — linking @${owner}/${repo}`);
    } else {
      onProgress('repo', 'done', `Created @${owner}/${repo}`);
    }
  } else {
    owner = existingRepo?.owner?.login || existingRepo?.owner?.name || existingRepo?.owner
      || existingRepo?.full_name?.split('/')[0];
    repo = existingRepo?.name || existingRepo?.full_name?.split('/').pop();
    if (!owner || !repo) {
      onProgress('repo', 'error', 'Selected repository is missing owner/name metadata.');
      throw new Error('Selected repository is missing owner/name metadata.');
    }
    onProgress('repo', 'done', `Using @${owner}/${repo}`);
  }

  // 2. Universe (browser-backed until the push succeeds). On retry after a
  // partial failure, reuse the universe created by the earlier attempt.
  onProgress('universe', 'running');
  let slug = null;
  if (reuseSlug && universeBackend.getUniverse?.(reuseSlug)) {
    slug = reuseSlug;
  } else {
    const creationResult = await universeManagerService.createUniverse(universeName, {
      enableLocal: false,
      enableGit: false,
      sourceOfTruth: 'browser'
    });
    slug = creationResult?.createdUniverse?.slug
      || (creationResult?.universes || []).find((u) => u.name === universeName)?.slug;
  }
  if (!slug) {
    onProgress('universe', 'error', 'Unable to determine universe slug after creation');
    throw new Error('Unable to determine universe slug after creation');
  }
  onProgress('universe', 'done', universeName);

  // 3. Attach the repo to the universe
  onProgress('attach', 'running');
  try {
    await universeManagerService.attachGitRepository(slug, {
      user: owner,
      repo,
      authMethod,
      universeFolder: slug,
      universeFile: `${slug}.redstring`
    });
  } catch (attachErr) {
    attachErr.slug = slug;
    onProgress('attach', 'error', attachErr.message);
    throw attachErr;
  }
  onProgress('attach', 'done');

  // 4. Initial push. On failure we deliberately do NOT promote git.
  let pushOk = false;
  onProgress('push', 'running');
  try {
    await universeManagerService.forceSave(slug);
    pushOk = true;
    onProgress('push', 'done');
  } catch (pushErr) {
    goWarn('Initial push failed:', pushErr);
    const msg = `Initial push failed: ${pushErr.message}. Redstring will retry on the next save.`;
    warnings.push(msg);
    onProgress('push', 'warning', msg);
  }

  // 5. Promote git to source of truth — only over a repo that has the data.
  if (pushOk) {
    onProgress('promote', 'running');
    try {
      await universeManagerService.setPrimaryStorage(slug, STORAGE_TYPES.GIT);
      onProgress('promote', 'done');
    } catch (promoteErr) {
      goWarn('Failed to promote git to source of truth:', promoteErr);
      const msg = `Could not make GitHub the source of truth: ${promoteErr.message}`;
      warnings.push(msg);
      onProgress('promote', 'warning', msg);
    }
  } else {
    const msg = 'GitHub not promoted to source of truth yet (initial push pending).';
    warnings.push(msg);
    onProgress('promote', 'warning', msg);
  }

  // 6. Optional local file copy (desktop only). Non-fatal on failure.
  if (linkLocalFile) {
    onProgress('local-file', 'running');
    try {
      const suggestedName = `${slug}.redstring`;
      const { createFileInWorkspace } = await import('./workspaceFolderService.js');
      const { exportToRedstring } = await import('../formats/redstringFormat.js');

      const emptyState = {
        graphs: new Map(),
        nodePrototypes: new Map(),
        edges: new Map(),
        viewport: { x: 0, y: 0, zoom: 1 }
      };
      const defaultContent = JSON.stringify(exportToRedstring(emptyState), null, 2);

      let fileHandle = await createFileInWorkspace(suggestedName, defaultContent, { overwrite: false });
      if (!fileHandle) {
        fileHandle = await pickSaveLocation({ suggestedName });
        if (!fileHandle) {
          throw new Error('No save location chosen');
        }
        await writeFile(fileHandle, defaultContent);
      }

      const fileName = isElectron() && typeof fileHandle === 'string'
        ? fileHandle.split(/[/\\]/).pop()
        : (fileHandle?.name || suggestedName);
      const displayPath = isElectron() && typeof fileHandle === 'string' ? fileHandle : fileName;

      await universeBackend.setFileHandle(slug, fileHandle, {
        displayPath,
        fileName,
        suppressNotification: true
      });
      // Records the local slot; never demotes git (only promotes local when
      // no git link exists — see universeBackend.linkLocalFileToUniverse).
      await universeBackend.linkLocalFileToUniverse(slug, displayPath, { displayPath });
      // Write real universe content into the file.
      try {
        await universeManagerService.forceSave(slug);
      } catch (saveErr) {
        goWarn('Post-link local save failed:', saveErr);
      }
      onProgress('local-file', 'done', fileName);
    } catch (fileErr) {
      goWarn('Local file setup failed:', fileErr);
      const msg = `Local file not linked: ${fileErr.message}`;
      warnings.push(msg);
      onProgress('local-file', 'warning', msg);
    }
  }

  return { slug, owner, repo, warnings };
}
