import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

// UniverseManager used to be the "Git-Native Semantic Web" provider form
// (GitHub token / Gitea endpoint fields wired to SemanticSyncEngine and
// SemanticFederation). It is now the universes / repositories / accounts panel,
// and GitHub access goes through the shared OAuth flow in githubAuthFlows.js.
// These tests cover that panel. Icons are real: nothing here asserts on them,
// and a hand-listed lucide-react mock broke the whole file every time the
// panel started using a new icon.

vi.mock('../../src/services/githubAuthFlows.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    connectOAuth: vi.fn(),
    disconnectOAuth: vi.fn(),
  };
});

import UniverseManager from '../../src/UniverseManager.jsx';
import universeBackendBridge from '../../src/services/universeBackendBridge.js';
import { connectOAuth } from '../../src/services/githubAuthFlows.js';

const UNIVERSES = [
  { slug: 'research', name: 'Research Notes', sourceOfTruth: 'browser' },
  { slug: 'garden', name: 'Idea Garden', sourceOfTruth: 'browser' },
];

const NOT_CONNECTED = { hasOAuthTokens: false, isAuthenticated: false };
const CONNECTED = { hasOAuthTokens: true, isAuthenticated: true };

let authStatus;

beforeEach(() => {
  authStatus = NOT_CONNECTED;
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({
    observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
  })));

  // The panel reads everything through universeManagerService, which reads the
  // backend through this bridge. Stubbing the bridge keeps the service's own
  // mapping (names, active flag, auth merge) under test.
  vi.spyOn(universeBackendBridge, 'getAllUniverses').mockResolvedValue(UNIVERSES);
  vi.spyOn(universeBackendBridge, 'getActiveUniverse').mockResolvedValue(UNIVERSES[0]);
  vi.spyOn(universeBackendBridge, 'getGitStatusDashboard').mockResolvedValue(null);
  vi.spyOn(universeBackendBridge, 'getAuthStatus').mockImplementation(async () => authStatus);

  connectOAuth.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderLoaded = async () => {
  const utils = render(<UniverseManager />);
  await waitFor(() => {
    expect(screen.getByText('Research Notes')).toBeTruthy();
  });
  return utils;
};

describe('UniverseManager', () => {
  describe('Initial State', () => {
    it('renders the universes, repositories and accounts sections', async () => {
      await renderLoaded();

      expect(screen.getByText('Universes')).toBeTruthy();
      expect(screen.getByText('Manage your knowledge spaces')).toBeTruthy();
      expect(screen.getByText('Repositories')).toBeTruthy();
      expect(screen.getByText('Accounts & Access')).toBeTruthy();
    });

    it('lists the universes the backend reports', async () => {
      await renderLoaded();

      expect(screen.getByText('Research Notes')).toBeTruthy();
      expect(screen.getByText('Idea Garden')).toBeTruthy();
      expect(universeBackendBridge.getAllUniverses).toHaveBeenCalled();
    });

    it('shows GitHub as not connected, with Connect and Install App offered', async () => {
      await renderLoaded();

      expect(screen.getByText('GitHub OAuth')).toBeTruthy();
      expect(screen.getByText('Not connected')).toBeTruthy();
      expect(screen.getByText('Connect OAuth to browse repositories')).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Connect$/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Install App/ })).toBeTruthy();
    });

    it('shows the empty repositories state', async () => {
      await renderLoaded();

      expect(screen.getByRole('button', { name: /Add Repositories/ })).toBeTruthy();
      expect(screen.getByText(/No repositories in your list/)).toBeTruthy();
    });
  });

  describe('Connection Management', () => {
    it('connects through the GitHub OAuth flow and refreshes auth', async () => {
      connectOAuth.mockImplementation(async () => {
        authStatus = CONNECTED;
        return { connected: true };
      });
      await renderLoaded();

      fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }));

      await waitFor(() => {
        expect(connectOAuth).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeTruthy();
      });
      expect(screen.getByText('OAuth available for browsing')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Reconnect/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Disconnect/ })).toBeTruthy();
    });

    it('stays not connected when the flow does not complete', async () => {
      connectOAuth.mockResolvedValue({ connected: false });
      await renderLoaded();

      fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }));

      await waitFor(() => {
        expect(connectOAuth).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByText('Not connected')).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('displays an OAuth failure', async () => {
      connectOAuth.mockRejectedValue(new Error('Invalid credentials'));
      await renderLoaded();

      fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }));

      await waitFor(() => {
        expect(screen.getByText(/OAuth authentication failed: Invalid credentials/)).toBeTruthy();
      });
      expect(screen.getByText('Not connected')).toBeTruthy();
    });

    it('reports a failed state load', async () => {
      universeBackendBridge.getAllUniverses.mockRejectedValue(new Error('backend down'));
      render(<UniverseManager />);

      await waitFor(() => {
        expect(screen.getByText(/Unable to load Git federation state/)).toBeTruthy();
      });
    });
  });

  describe('Accessibility', () => {
    it('gives the primary actions accessible names', async () => {
      await renderLoaded();

      for (const name of [/^Load$/, /^New$/, /Add Repositories/, /^Connect$/, /Install App/]) {
        expect(screen.getByRole('button', { name })).toBeTruthy();
      }
    });
  });

  describe('Responsive Design', () => {
    it('renders at phone and desktop widths', async () => {
      const originalWidth = window.innerWidth;
      try {
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
        const { unmount } = await renderLoaded();
        expect(screen.getByText('Accounts & Access')).toBeTruthy();
        unmount();

        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1920 });
        await renderLoaded();
        expect(screen.getByText('Accounts & Access')).toBeTruthy();
      } finally {
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth });
      }
    });
  });
});
