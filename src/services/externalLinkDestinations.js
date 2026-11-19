/**
 * Where a universe loaded from a link (ExternalLinkLoadModal) goes to be kept:
 * a local file the person picks, or a new file in one of their repositories.
 * Both make a new universe and put the link's contents on the canvas. Shared by
 * the Universes panel and onboarding's Open an Existing Universe → Link, which
 * runs the link box inside its own modal.
 */
import universeManagerService from './universeManagerService.js';
import universeBackend from './universeBackend.js';
import { persistentAuth } from './persistentAuth.js';
import { usesPathHandles, isCapacitor, universeFileHandle } from '../utils/capacitorAdapter.js';

const loadIntoCanvas = async (storeState) => {
  const { default: useGraphStore } = await import('../store/graphStore.js');
  const state = useGraphStore.getState();
  state.loadUniverseFromFile(storeState);
  state.setUniverseConnected(true);
};

// iOS/Android: no save picker. It is kept in the app's own Universes folder,
// under the handle createUniverse gives every universe there.
async function saveLinkedOnDevice(storeState, suggestedName) {
  const createResult = await universeManagerService.createUniverse(suggestedName, {
    enableLocal: true,
    enableGit: false,
    sourceOfTruth: 'local'
  });
  const slug = createResult?.createdUniverse?.slug;
  if (!slug) throw new Error('Unable to determine universe slug after creation');
  await loadIntoCanvas(storeState);
  const handle = universeFileHandle(slug);
  const fileName = `${slug}.redstring`;
  await universeBackend.setFileHandle(slug, handle, { displayPath: handle, fileName, suppressNotification: true });
  await universeBackend.linkLocalFileToUniverse(slug, handle, { displayPath: handle });
  await universeManagerService.forceSave(slug, { skipGit: true });
  return { slug, name: createResult?.createdUniverse?.name || suggestedName, fileName };
}

export async function saveLinkedAsLocalFile(storeState, suggestedName) {
  if (isCapacitor()) return saveLinkedOnDevice(storeState, suggestedName);
  const { pickSaveLocation, writeFile } = await import('../utils/fileAccessAdapter.js');
  const { exportToRedstring } = await import('../formats/redstringFormat.js');

  let handle;
  try {
    handle = await pickSaveLocation({ suggestedName: `${suggestedName}.redstring` });
  } catch (err) {
    throw new Error(err?.message || 'Save cancelled');
  }

  const redstringData = exportToRedstring(storeState);
  await writeFile(handle, JSON.stringify(redstringData, null, 2));

  const displayPath = (usesPathHandles() && typeof handle === 'string')
    ? handle
    : (handle?.name || `${suggestedName}.redstring`);
  const fileName = displayPath.split(/[\\/]/).pop();

  const createResult = await universeManagerService.createUniverse(suggestedName, {
    enableLocal: true,
    enableGit: false,
    sourceOfTruth: 'local'
  });
  const slug = createResult?.createdUniverse?.slug;

  await loadIntoCanvas(storeState);

  if (slug) {
    try {
      await universeBackend.setFileHandle(slug, handle, { displayPath, fileName });
      await universeBackend.linkLocalFileToUniverse(slug, displayPath, { displayPath });
      await universeManagerService.forceSave(slug, { skipGit: true });
    } catch (linkErr) {
      console.warn(`[ExternalLink] Failed to link local file for ${slug}:`, linkErr);
    }
  }
  return { slug, name: createResult?.createdUniverse?.name || suggestedName, fileName };
}

export async function publishLinkedToRepo({ storeState, suggestedName, repoOwner, repoName, folder, file }) {
  const { SemanticProviderFactory } = await import('./gitNativeProvider.js');
  const { exportToRedstring } = await import('../formats/redstringFormat.js');

  const token = await persistentAuth.getAccessToken();
  if (!token) {
    throw new Error('Not connected to GitHub. Connect GitHub and try again.');
  }

  const provider = SemanticProviderFactory.createProvider({
    type: 'github',
    user: repoOwner,
    repo: repoName,
    token,
    authMethod: 'oauth',
    semanticPath: 'schema'
  });

  const filePath = `universes/${folder}/${file}`;
  const content = JSON.stringify(exportToRedstring(storeState), null, 2);

  try {
    await provider.writeFileRaw(filePath, content);
  } catch (writeErr) {
    const status = writeErr?.status;
    const code = writeErr?.code;
    if (status === 401) {
      throw new Error('GitHub authentication expired. Connect GitHub again.');
    }
    if (code === 'FILE_INFO_UNKNOWN') {
      throw new Error('Could not verify whether this path exists on the remote. Check repo permissions.');
    }
    throw new Error(`Push failed: ${writeErr?.message || 'unknown error'}`);
  }

  const createResult = await universeManagerService.createUniverse(suggestedName, {
    enableLocal: false,
    enableGit: true,
    sourceOfTruth: 'git'
  });
  const slug = createResult?.createdUniverse?.slug;

  if (slug) {
    await universeManagerService.attachGitRepository(slug, {
      user: repoOwner,
      repo: repoName,
      authMethod: 'oauth',
      universeFolder: folder,
      universeFile: file
    });
  }

  await loadIntoCanvas(storeState);

  if (slug) {
    try {
      await universeManagerService.forceSave(slug);
    } catch (saveErr) {
      console.warn('[ExternalLink] forceSave after publish failed (data is already on remote):', saveErr);
    }
  }
  return { slug, name: createResult?.createdUniverse?.name || suggestedName };
}
