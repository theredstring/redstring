import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * Repository Selection is reached straight from onboarding's Open an Existing
 * Universe. It shows repositories only once GitHub is fully connected: OAuth
 * AND the App, as onboarding's own GitHub step requires. Until then it is the
 * Connect GitHub box onboarding shows, and OAuth alone keeps it there, asking
 * for the App.
 */

const auth = { status: { hasOAuthTokens: true, hasGitHubApp: false } };

vi.mock('../../src/services/persistentAuth.js', () => ({
  persistentAuth: {
    getAuthStatus: () => auth.status,
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('../../src/services/githubRepoService.js', () => ({
  listUserRepos: vi.fn(async () => [{ id: 1, name: 'things', owner: { login: 'someone' }, updated_at: '2026-11-01T00:00:00Z' }]),
  createRepository: vi.fn(),
}));

import RepositorySelectionModal from '../../src/components/modals/RepositorySelectionModal.jsx';

const open = () => render(<RepositorySelectionModal isOpen onClose={vi.fn()} intent="import" />);

describe('Repository Selection before GitHub is fully connected', () => {
  afterEach(() => cleanup());

  it('asks for the App when only OAuth is connected', async () => {
    auth.status = { hasOAuthTokens: true, hasGitHubApp: false };
    open();
    expect(await screen.findByText('Install the GitHub App for auto-sync. It will be detected automatically.')).toBeTruthy();
    expect(screen.getByText('Connect GitHub')).toBeTruthy();
    expect(screen.queryByText('things')).toBeNull();
  });

  it('asks to connect when nothing is connected', async () => {
    auth.status = { hasOAuthTokens: false, hasGitHubApp: false };
    open();
    expect(await screen.findByText('Connect GitHub OAuth to continue.')).toBeTruthy();
  });

  it('lists repositories once both are connected', async () => {
    auth.status = { hasOAuthTokens: true, hasGitHubApp: true };
    open();
    expect(await screen.findByText('things')).toBeTruthy();
  });
});
