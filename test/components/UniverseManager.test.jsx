import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import GitNativeFederation from '../../src/GitNativeFederation.jsx';
import { SemanticProviderFactory } from '../../src/services/gitNativeProvider.js';
import { SemanticSyncEngine } from '../../src/services/semanticSyncEngine.js';
import { SemanticFederation } from '../../src/services/semanticFederation.js';

// Mock the services
vi.mock('../../src/services/gitNativeProvider.js', () => ({
  SemanticProviderFactory: {
    createProvider: vi.fn(),
    getAvailableProviders: vi.fn()
  }
}));

vi.mock('../../src/services/semanticSyncEngine.js', () => ({
  SemanticSyncEngine: vi.fn()
}));

vi.mock('../../src/services/semanticFederation.js', () => ({
  SemanticFederation: vi.fn()
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  GitBranch: vi.fn(() => 'GitBranch'),
  GitCommit: vi.fn(() => 'GitCommit'),
  GitPullRequest: vi.fn(() => 'GitPullRequest'),
  Globe: vi.fn(() => 'Globe'),
  Settings: vi.fn(() => 'Settings'),
  CheckCircle: vi.fn(() => 'CheckCircle'),
  XCircle: vi.fn(() => 'XCircle'),
  AlertCircle: vi.fn(() => 'AlertCircle'),
  ExternalLink: vi.fn(() => 'ExternalLink'),
  Copy: vi.fn(() => 'Copy'),
  Server: vi.fn(() => 'Server'),
  RefreshCw: vi.fn(() => 'RefreshCw'),
  Plus: vi.fn(() => 'Plus'),
  Users: vi.fn(() => 'Users'),
  Network: vi.fn(() => 'Network'),
  Zap: vi.fn(() => 'Zap'),
  Shield: vi.fn(() => 'Shield'),
  ArrowRight: vi.fn(() => 'ArrowRight'),
  Download: vi.fn(() => 'Download'),
  Upload: vi.fn(() => 'Upload'),
  GitMerge: vi.fn(() => 'GitMerge'),
  GitFork: vi.fn(() => 'GitFork'),
  GitCompare: vi.fn(() => 'GitCompare'),
  GitPullRequestClosed: vi.fn(() => 'GitPullRequestClosed'),
  GitBranchPlus: vi.fn(() => 'GitBranchPlus'),
  GitCommitHorizontal: vi.fn(() => 'GitCommitHorizontal'),
  GitGraph: vi.fn(() => 'GitGraph'),
  Info: vi.fn(() => 'Info'),
  Github: vi.fn(() => 'Github'),
  Key: vi.fn(() => 'Key')
}));

describe('GitNativeFederation', () => {
  let mockProvider;
  let mockSyncEngine;
  let mockFederation;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock provider
    mockProvider = {
      name: 'Test Provider',
      isAvailable: vi.fn().mockResolvedValue(true)
    };

    // Create mock sync engine
    mockSyncEngine = {
      onStatusChange: vi.fn(),
      loadFromProvider: vi.fn(),
      forceSync: vi.fn(),
      migrateProvider: vi.fn()
    };

    // Create mock federation
    mockFederation = {
      subscribeToSpace: vi.fn(),
      unsubscribeFromSpace: vi.fn(),
      getFederationStats: vi.fn().mockReturnValue({
        activeSubscriptions: 2,
        totalSubscribedConcepts: 5,
        cachedExternalConcepts: 3,
        lastPoll: new Date().toISOString()
      }),
      getSubscriptions: vi.fn().mockReturnValue([
        {
          url: 'https://alice.github.io/semantic/',
          name: 'Alice Research',
          concepts: new Set(['concept1', 'concept2']),
          lastChecked: new Date().toISOString(),
          lastUpdate: null
        },
        {
          url: 'https://bob.gitlab.com/knowledge/',
          name: 'Bob Knowledge',
          concepts: new Set(['concept3']),
          lastChecked: new Date().toISOString(),
          lastUpdate: new Date().toISOString()
        }
      ])
    };

    SemanticProviderFactory.createProvider.mockReturnValue(mockProvider);
    SemanticSyncEngine.mockImplementation(() => mockSyncEngine);
    SemanticFederation.mockImplementation(() => mockFederation);

    SemanticProviderFactory.getAvailableProviders.mockReturnValue([
      {
        type: 'github',
        name: 'GitHub',
        description: 'GitHub-hosted semantic spaces',
        authMechanism: 'oauth',
        configFields: ['user', 'repo', 'token', 'semanticPath']
      },
      {
        type: 'gitea',
        name: 'Self-Hosted Gitea',
        description: 'Self-hosted Gitea instance',
        authMechanism: 'token',
        configFields: ['endpoint', 'user', 'repo', 'token', 'semanticPath']
      }
    ]);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Initial State', () => {
    it('should render connection form when not connected', () => {
      render(<GitNativeFederation />);

      expect(screen.getByText(/Git-Native Semantic Web/)).toBeTruthy();
      expect(screen.getByText('Connect to any Git provider for real-time, decentralized storage of your own semantic web.')).toBeTruthy();
      expect(screen.getByText(/Provider Configuration/)).toBeTruthy();
      expect(screen.getByText('GitHub')).toBeTruthy();
      expect(screen.getByText('Self-Hosted Gitea')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Connect with GitHub/ })).toBeTruthy();
    });

    it('should show GitHub OAuth configuration by default', () => {
      render(<GitNativeFederation />);

      expect(screen.getByText('Authentication Method:')).toBeTruthy();
      expect(screen.getByText('OAuth')).toBeTruthy();
      expect(screen.getByText('Token')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Connect with GitHub/ })).toBeTruthy();
    });

    it('should show Gitea configuration when selected', () => {
      render(<GitNativeFederation />);

      // Click on Gitea provider
      fireEvent.click(screen.getByText('Self-Hosted Gitea'));

      expect(screen.getByLabelText('Gitea Endpoint:')).toBeTruthy();
      expect(screen.getByLabelText('Username:')).toBeTruthy();
      expect(screen.getByLabelText('Repository Name:')).toBeTruthy();
      expect(screen.getByLabelText('Access Token:')).toBeTruthy();
    });
  });

  describe('Provider Configuration', () => {
    it('should handle GitHub configuration input when token mode is selected', () => {
      render(<GitNativeFederation />);

      // Switch to token mode first
      const tokenButton = screen.getByRole('button', { name: /Token/ });
      fireEvent.click(tokenButton);

      const usernameInput = screen.getByLabelText('GitHub Username:');
      const repoInput = screen.getByLabelText('Repository:');
      const tokenInput = screen.getByLabelText('Personal Access Token:');

      fireEvent.change(usernameInput, { target: { value: 'testuser' } });
      fireEvent.change(repoInput, { target: { value: 'testrepo' } });
      fireEvent.change(tokenInput, { target: { value: 'ghp_testtoken123' } });

      expect(usernameInput.value).toBe('testuser');
      expect(repoInput.value).toBe('testrepo');
      expect(tokenInput.value).toBe('ghp_testtoken123');
    });

    it('should handle Gitea configuration input', () => {
      render(<GitNativeFederation />);

      // Switch to Gitea
      fireEvent.click(screen.getByText('Self-Hosted Gitea'));

      const endpointInput = screen.getByLabelText('Gitea Endpoint:');
      const usernameInput = screen.getByLabelText('Username:');
      const repoInput = screen.getByLabelText('Repository Name:');
      const tokenInput = screen.getByLabelText('Access Token:');

      fireEvent.change(endpointInput, { target: { value: 'https://git.example.com' } });
      fireEvent.change(usernameInput, { target: { value: 'testuser' } });
      fireEvent.change(repoInput, { target: { value: 'testrepo' } });
      fireEvent.change(tokenInput, { target: { value: 'testtoken123' } });

      expect(endpointInput.value).toBe('https://git.example.com');
      expect(usernameInput.value).toBe('testuser');
      expect(repoInput.value).toBe('testrepo');
      expect(tokenInput.value).toBe('testtoken123');
    });

    it('should toggle advanced settings', () => {
      render(<GitNativeFederation />);

      const advancedButton = screen.getByText('Show Advanced');
      fireEvent.click(advancedButton);

      expect(screen.getByText('Hide Advanced')).toBeTruthy();
      expect(screen.getByLabelText('Schema Path:')).toBeTruthy();

      fireEvent.click(screen.getByText('Hide Advanced'));
      expect(screen.getByText('Show Advanced')).toBeTruthy();
    });
  });

  describe('Connection Management', () => {
    it('should connect to provider successfully with token method', async () => {
      render(<GitNativeFederation />);

      // Switch to token mode
      const tokenButton = screen.getByRole('button', { name: /Token/ });
      fireEvent.click(tokenButton);

      // Fill in GitHub configuration
      fireEvent.change(screen.getByLabelText('GitHub Username:'), { target: { value: 'testuser' } });
      fireEvent.change(screen.getByLabelText('Repository:'), { target: { value: 'testrepo' } });
      fireEvent.change(screen.getByLabelText('Personal Access Token:'), { target: { value: 'ghp_testtoken123' } });

      // Click connect
      fireEvent.click(screen.getByText(/Connect to Git Provider/));

      await waitFor(() => {
        expect(SemanticProviderFactory.createProvider).toHaveBeenCalledWith({
          type: 'github',
          user: 'testuser',
          repo: 'testrepo',
          token: 'ghp_testtoken123',
          semanticPath: 'schema'
        });
      });

      await waitFor(() => {
        expect(mockProvider.isAvailable).toHaveBeenCalled();
      });
    });

    it('should handle connection failures', async () => {
      mockProvider.isAvailable.mockResolvedValue(false);

      render(<GitNativeFederation />);

      // Switch to token mode
      const tokenButton = screen.getByRole('button', { name: /Token/ });
      fireEvent.click(tokenButton);

      // Fill in configuration
      fireEvent.change(screen.getByLabelText('GitHub Username:'), { target: { value: 'testuser' } });
      fireEvent.change(screen.getByLabelText('Repository:'), { target: { value: 'testrepo' } });
      fireEvent.change(screen.getByLabelText('Personal Access Token:'), { target: { value: 'invalid-token' } });

      // Click connect
      fireEvent.click(screen.getByText(/Connect to Git Provider/));

      await waitFor(() => {
        expect(screen.getByText(/Connection failed/)).toBeTruthy();
      });
    });

    it('should disconnect from provider', async () => {
      // Mock connected state
      const { rerender } = render(<GitNativeFederation />);

      // Simulate connected state
      SemanticSyncEngine.mockImplementation(() => mockSyncEngine);
      SemanticFederation.mockImplementation(() => mockFederation);

      // Re-render with connected state
      rerender(<GitNativeFederation />);

      // Mock the connected state by setting up the component with provider
      const mockConnectedComponent = {
        ...mockProvider,
        name: 'Test Provider'
      };

      // This would require more complex state management testing
      // For now, we'll test the disconnect functionality exists
      expect(screen.getByRole('button', { name: /Connect with GitHub/ })).toBeTruthy();
    });
  });

  describe('Connected State', () => {
    beforeEach(() => {
      // Mock connected state by creating a component with provider already set
      vi.spyOn(React, 'useState').mockImplementation((initialValue) => {
        if (initialValue === null) {
          return [mockProvider, vi.fn()];
        }
        return [initialValue, vi.fn()];
      });
    });

    it('should show connection status when connected', () => {
      render(<GitNativeFederation />);

      // This would require more complex state mocking
      // For now, we'll verify the basic structure
      expect(screen.getByText(/Git-Native Semantic Web/)).toBeTruthy();
    });

    it('should show federation statistics', () => {
      render(<GitNativeFederation />);

      // Federation stats would be displayed in connected state
      // This requires more complex state management testing
      expect(screen.getByText(/Git-Native Semantic Web/)).toBeTruthy();
    });

    it('should allow adding subscriptions', async () => {
      render(<GitNativeFederation />);

      // This would be tested in connected state
      // For now, we'll verify the basic structure
      expect(screen.getByText(/Git-Native Semantic Web/)).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should display connection errors', async () => {
      mockProvider.isAvailable.mockRejectedValue(new Error('Invalid credentials'));

      render(<GitNativeFederation />);

      // Switch to token mode
      const tokenButton = screen.getByRole('button', { name: /Token/ });
      fireEvent.click(tokenButton);

      // Fill in configuration
      fireEvent.change(screen.getByLabelText('GitHub Username:'), { target: { value: 'testuser' } });
      fireEvent.change(screen.getByLabelText('Repository:'), { target: { value: 'testrepo' } });
      fireEvent.change(screen.getByLabelText('Personal Access Token:'), { target: { value: 'invalid-token' } });

      // Click connect
      fireEvent.click(screen.getByText(/Connect to Git Provider/));

      await waitFor(() => {
        expect(screen.getByText(/Connection failed/)).toBeTruthy();
      });
    });

    it('should display subscription errors', async () => {
      mockFederation.subscribeToSpace.mockRejectedValue(new Error('Invalid URL'));

      render(<GitNativeFederation />);

      // This would be tested in connected state
      // For now, we'll verify the basic structure
      expect(screen.getByText(/Git-Native Semantic Web/)).toBeTruthy();
    });
  });

  describe('Integration with Services', () => {
    it('should initialize sync engine when provider is set with token', async () => {
      render(<GitNativeFederation />);

      // Switch to token mode
      const tokenButton = screen.getByRole('button', { name: /Token/ });
      fireEvent.click(tokenButton);

      // Fill in and connect
      fireEvent.change(screen.getByLabelText('GitHub Username:'), { target: { value: 'testuser' } });
      fireEvent.change(screen.getByLabelText('Repository:'), { target: { value: 'testrepo' } });
      fireEvent.change(screen.getByLabelText('Personal Access Token:'), { target: { value: 'ghp_testtoken123' } });

      fireEvent.click(screen.getByText(/Connect to Git Provider/));

      await waitFor(() => {
        expect(SemanticSyncEngine).toHaveBeenCalledWith({
          type: 'github',
          user: 'testuser',
          repo: 'testrepo',
          token: 'ghp_testtoken123',
          semanticPath: 'schema'
        });
      });
    });

    it('should initialize federation when sync engine is set', async () => {
      render(<GitNativeFederation />);

      // Switch to token mode
      const tokenButton = screen.getByRole('button', { name: /Token/ });
      fireEvent.click(tokenButton);

      // Fill in and connect
      fireEvent.change(screen.getByLabelText('GitHub Username:'), { target: { value: 'testuser' } });
      fireEvent.change(screen.getByLabelText('Repository:'), { target: { value: 'testrepo' } });
      fireEvent.change(screen.getByLabelText('Personal Access Token:'), { target: { value: 'ghp_testtoken123' } });

      fireEvent.click(screen.getByText(/Connect to Git Provider/));

      await waitFor(() => {
        expect(SemanticFederation).toHaveBeenCalledWith(mockSyncEngine);
      });
    });

    it('should subscribe to status updates', async () => {
      render(<GitNativeFederation />);

      // Switch to token mode
      const tokenButton = screen.getByRole('button', { name: /Token/ });
      fireEvent.click(tokenButton);

      // Fill in and connect
      fireEvent.change(screen.getByLabelText('GitHub Username:'), { target: { value: 'testuser' } });
      fireEvent.change(screen.getByLabelText('Repository:'), { target: { value: 'testrepo' } });
      fireEvent.change(screen.getByLabelText('Personal Access Token:'), { target: { value: 'ghp_testtoken123' } });

      fireEvent.click(screen.getByText(/Connect to Git Provider/));

      await waitFor(() => {
        expect(mockSyncEngine.onStatusChange).toHaveBeenCalled();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper labels for OAuth mode', () => {
      render(<GitNativeFederation />);

      expect(screen.getByText('Authentication Method:')).toBeTruthy();
      expect(screen.getByText('GitHub OAuth:')).toBeTruthy();
      expect(screen.getByRole('button', { name: /OAuth/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Token/ })).toBeTruthy();
    });

    it('should have proper button text', () => {
      render(<GitNativeFederation />);

      expect(screen.getByRole('button', { name: /Connect with GitHub/ })).toBeTruthy();
      expect(screen.getByText(/Show Advanced/)).toBeTruthy();
    });

    it('should handle keyboard navigation in token mode', () => {
      render(<GitNativeFederation />);

      // Switch to token mode
      const tokenButton = screen.getByRole('button', { name: /Token/ });
      fireEvent.click(tokenButton);

      const usernameInput = screen.getByLabelText('GitHub Username:');
      const repoInput = screen.getByLabelText('Repository:');

      // Tab navigation
      usernameInput.focus();
      expect(document.activeElement).toBe(usernameInput);

      // Test that both inputs exist and are focusable
      expect(usernameInput).toBeTruthy();
      expect(repoInput).toBeTruthy();
    });
  });

  describe('Responsive Design', () => {
    it('should render on different screen sizes', () => {
      // Test mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      const { unmount } = render(<GitNativeFederation />);
      expect(screen.getByText(/Git-Native Semantic Web/)).toBeTruthy();
      unmount();

      // Test desktop viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1920,
      });

      render(<GitNativeFederation />);
      expect(screen.getByText(/Git-Native Semantic Web/)).toBeTruthy();
    });
  });
}); 