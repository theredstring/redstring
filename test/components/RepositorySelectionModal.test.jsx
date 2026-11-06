import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('../../src/services/persistentAuth.js', () => ({
  persistentAuth: {
    getAuthStatus: () => ({ hasOAuthTokens: true }),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('../../src/services/githubRepoService.js', () => ({
  listUserRepos: vi.fn(async () => [{
    id: 1,
    name: 'things',
    owner: { login: 'someone' },
    updated_at: '2026-11-01T00:00:00Z',
  }]),
  createRepository: vi.fn(),
}));

import RepositorySelectionModal from '../../src/components/modals/RepositorySelectionModal.jsx';
import repoDiscoveryCache from '../../src/services/repoDiscoveryCache.js';

const picked = new File(['{}'], 'Ideas.redstring');

const openRepo = async (props = {}) => {
  const onUploadUniverseFile = vi.fn(async () => {});
  const utils = render(
    <RepositorySelectionModal
      isOpen
      onClose={vi.fn()}
      intent="attach"
      onCreateUniverseFile={vi.fn()}
      onUploadUniverseFile={onUploadUniverseFile}
      {...props}
    />,
  );
  fireEvent.click(await screen.findByTitle('Show universes'));
  await screen.findByText('Upload Universe File');
  return { ...utils, onUploadUniverseFile: props.onUploadUniverseFile || onUploadUniverseFile };
};

const fileInput = () => document.querySelector('input[type="file"]');

describe('Upload Universe File in the repository list', () => {
  beforeEach(() => {
    repoDiscoveryCache.setRepoItems('someone', 'things', []);
  });

  afterEach(() => {
    cleanup();
    repoDiscoveryCache.forgetRepo('someone', 'things');
  });

  it('sits under New Universe File', async () => {
    await openRepo();
    const newFile = screen.getByText('New Universe File');
    const upload = screen.getByText('Upload Universe File');
    expect(newFile.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens a picker limited to .redstring, and hands over the repo it was clicked on with the file', async () => {
    const { onUploadUniverseFile } = await openRepo();
    const click = vi.spyOn(fileInput(), 'click');

    fireEvent.click(screen.getByText('Upload Universe File'));
    expect(click).toHaveBeenCalled();
    expect(fileInput().accept).toBe('.redstring');

    fireEvent.change(fileInput(), { target: { files: [picked] } });
    await waitFor(() => expect(onUploadUniverseFile).toHaveBeenCalledTimes(1));
    expect(onUploadUniverseFile.mock.calls[0][0].name).toBe('things');
    expect(onUploadUniverseFile.mock.calls[0][1]).toBe(picked);
  });

  it('does nothing when the picker is cancelled', async () => {
    const { onUploadUniverseFile } = await openRepo();
    fireEvent.click(screen.getByText('Upload Universe File'));
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(onUploadUniverseFile).not.toHaveBeenCalled();
  });

  it('says why a file was refused, and stays open to pick another', async () => {
    const onUploadUniverseFile = vi.fn(async () => {
      throw new Error("Ideas.redstring isn't a valid .redstring file.");
    });
    await openRepo({ onUploadUniverseFile });

    fireEvent.click(screen.getByText('Upload Universe File'));
    fireEvent.change(fileInput(), { target: { files: [picked] } });

    expect(await screen.findByText("Ideas.redstring isn't a valid .redstring file.")).toBeTruthy();
    expect(screen.getByText('Upload Universe File')).toBeTruthy();
  });

  it('shows what a later scan found in a repo this modal already listed', async () => {
    await openRepo();
    expect(screen.getByText('No universes found in this repository')).toBeTruthy();

    repoDiscoveryCache.setRepoItems('someone', 'things', [
      { name: 'ideas', slug: 'ideas', path: 'universes/ideas/ideas.redstring', fileName: 'ideas.redstring' },
    ]);

    expect(await screen.findByText('universes/ideas/ideas.redstring')).toBeTruthy();
  });
});
